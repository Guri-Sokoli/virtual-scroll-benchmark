/**
 * OvsVirtualScrollViewport Component
 *
 * The container component that manages the scrollable viewport.
 * It coordinates with VirtualScrollStrategy for layout calculations
 * and OvsVirtualForDirective for view rendering.
 *
 * Performance optimisations:
 * 1. OnPush change detection — only runs when inputs change or we
 *    explicitly mark for check.
 * 2. Zone-managed scroll handling — scroll listener runs outside
 *    Angular's zone, entering zone only when the visible range changes.
 * 3. requestAnimationFrame coalescing — multiple scroll events within
 *    a single frame are collapsed to one layout update.
 * 4. Adaptive buffer — buffer size increases with scroll velocity
 *    for smoother fast-scroll experience.
 * 5. CSS containment — `contain: strict` on viewport and
 *    `contain: layout style paint` on spacer to give browser
 *    optimisation hints.
 * 6. Downscale factor — handles content heights exceeding browser
 *    max element height limits (~8M pixels).
 */

import {
  AfterContentInit,
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { VirtualScrollStrategy } from './virtual-scroll-strategy';
import { TemplateCacheService } from './template-cache.service';
import { OvsVirtualForDirective } from './virtual-for.directive';

@Component({
  selector: 'ovs-virtual-scroll-viewport',
  standalone: true,
  imports: [CommonModule],
  providers: [TemplateCacheService],
  template: `
    <div
      #viewport
      class="ovs-viewport"
      [style.height.px]="resolvedViewportHeight"
      [attr.data-testid]="testId"
    >
      <div class="ovs-spacer" [style.height.px]="displayTotalHeight">
        <div #content class="ovs-content" [style.transform]="contentTransform">
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
    }

    .ovs-viewport {
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      border: 1px solid #d3d8e8;
      box-sizing: border-box;
      position: relative;
      background: #fff;
      contain: layout style paint;
    }

    .ovs-spacer {
      position: relative;
      width: 100%;
      contain: layout style;
    }

    .ovs-content {
      position: relative;
      width: 100%;
      will-change: transform;
      transform: translate3d(0, 0, 0);
      backface-visibility: hidden;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OvsVirtualScrollViewportComponent
  implements AfterViewInit, AfterContentInit, OnChanges, OnDestroy
{
  @ViewChild('viewport') private viewportRef!: ElementRef<HTMLDivElement>;
  @ViewChild('content') private contentRef?: ElementRef<HTMLDivElement>;
  @ContentChild(OvsVirtualForDirective) private virtualFor?: OvsVirtualForDirective<any>;

  /** Total item count — required for layout calculation. */
  @Input() itemCount = 0;
  /** Height of each item in pixels (for fixed-size strategy). */
  @Input() itemHeight = 32;
  /** Visible viewport height in pixels. */
  @Input() viewportHeight = 560;
  /** Minimum buffer in pixels rendered above/below the viewport. */
  @Input() minBufferPx = 256;
  /** Maximum buffer in pixels (used during adaptive buffering). */
  @Input() maxBufferPx = 768;
  /** Per-item heights array for dynamic-height mode. Null = fixed height. */
  @Input() itemHeights: number[] | null = null;
  /** Maximum physical canvas height before downscaling kicks in. */
  @Input() maxCanvasHeight = 8_000_000;
  /** data-testid attribute for Playwright selectors. */
  @Input() testId = 'viewport-optimized';

  /** The total display height after downscaling (bound to spacer). */
  protected displayTotalHeight = 0;

  /** CSS transform applied to the single content wrapper div. */
  protected contentTransform = 'translate3d(0, 0px, 0)';

  private readonly strategy = new VirtualScrollStrategy();
  private downscaleFactor = 1;
  private currentBufferPx = 256;
  private lastScrollTop = 0;
  private lastScrollTimestamp = 0;
  private scrollVelocity = 0; // px/ms
  private scrollDirection: 1 | -1 = 1;
  private lastProcessedScrollTop = 0;
  private lastImmediateUpdateAt = 0;

  private renderedStartPx = 0;
  private renderedEndPx = 0;

  private pendingScrollTop = 0;
  private pendingWideOverscan = false;

  private scrollListener?: () => void;
  private rafId: number | null = null;

  // Track rendered range to avoid redundant updates
  private renderedStartIndex = -1;
  private renderedEndIndex = -1;

  constructor(private readonly zone: NgZone) {}

  protected get resolvedViewportHeight(): number | null {
    return this.viewportHeight > 0 ? this.viewportHeight : null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['itemCount'] ||
      changes['itemHeight'] ||
      changes['itemHeights'] ||
      changes['viewportHeight'] ||
      changes['maxCanvasHeight']
    ) {
      this.rebuildLayout();
      this.scheduleUpdate(true);
    }
  }

  ngAfterContentInit(): void {
    this.rebuildLayout();
  }

  ngAfterViewInit(): void {
    // Rebuild once view is mounted so downscaling math can use measured height.
    this.rebuildLayout();

    const viewportHeightPx = this.getViewportHeightPx();
    this.currentBufferPx = Math.max(this.minBufferPx, Math.floor(viewportHeightPx * 0.6));

    // Do initial synchronous render so first frame has content
    this.updateVisibleRange(
      this.clampScrollTop(this.viewportRef.nativeElement.scrollTop),
      true,
    );

    // Bind scroll listener *outside* Angular zone
    this.zone.runOutsideAngular(() => {
      const el = this.viewportRef.nativeElement;
      this.scrollListener = () => this.onScroll();
      el.addEventListener('scroll', this.scrollListener, { passive: false });
    });
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.scrollListener && this.viewportRef) {
      this.viewportRef.nativeElement.removeEventListener('scroll', this.scrollListener);
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Programmatically scroll to the given item index.
   */
  scrollToIndex(index: number): void {
    const offset = this.strategy.getOffsetForIndex(
      Math.max(0, Math.min(index, this.itemCount - 1)),
    );
    const displayOffset = this.clampScrollTop(offset / this.downscaleFactor);
    this.viewportRef.nativeElement.scrollTop = displayOffset;
  }

  /** Expose the strategy for external layout queries (used by the row positioning). */
  getLayoutForIndex(index: number) {
    const layout = this.strategy.getLayout(index);
    return {
      offset: layout.offset / this.downscaleFactor,
      height: layout.height / this.downscaleFactor,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────

  private rebuildLayout(): void {
    if (this.itemHeights && this.itemHeights.length > 0) {
      this.strategy.rebuild(this.itemHeights);
    } else {
      this.strategy.rebuildFixed(this.itemCount, this.itemHeight);
    }

    const fullHeight = this.strategy.totalContentHeight;
    this.downscaleFactor = this.computeDownscaleFactor(fullHeight);
    this.displayTotalHeight = fullHeight / this.downscaleFactor;

    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.renderedStartPx = 0;
    this.renderedEndPx = 0;
  }

  /**
   * Scroll event handler running OUTSIDE Angular zone.
   */
  private onScroll(): void {
    const viewport = this.viewportRef.nativeElement;
    const now = performance.now();
    const scrollTop = this.clampScrollTop(viewport.scrollTop);
    if (scrollTop !== viewport.scrollTop) {
      viewport.scrollTop = scrollTop;
    }

    const dt = now - this.lastScrollTimestamp;
    const deltaSigned = scrollTop - this.lastScrollTop;
    const deltaPx = Math.abs(deltaSigned);

    if (dt > 0) {
      this.scrollVelocity = deltaPx / dt;
    }
    if (deltaSigned !== 0) {
      this.scrollDirection = deltaSigned > 0 ? 1 : -1;
    }

    this.lastScrollTop = scrollTop;
    this.lastScrollTimestamp = now;

    const viewportHeightPx = this.getViewportHeightPx();
    const jumpSinceLastPaint = Math.abs(scrollTop - this.lastProcessedScrollTop);
    const largeJump = jumpSinceLastPaint > viewportHeightPx * 0.85;
    const ultraFast = dt > 0 && dt < 12 && deltaPx > this.itemHeight * 2;

    const logicalScrollTop = scrollTop * this.downscaleFactor;
    const logicalViewportHeight = viewportHeightPx * this.downscaleFactor;
    const logicalViewportEnd = logicalScrollTop + logicalViewportHeight;
    const outsideRenderedRange =
      this.renderedStartIndex === -1 ||
      logicalScrollTop < this.renderedStartPx ||
      logicalViewportEnd > this.renderedEndPx;

    // Ensure we never present an empty viewport after very large thumb jumps,
    // while still limiting synchronous work to at most once every ~1.5 frames.
    const jumpMode = outsideRenderedRange && largeJump;
    const shouldImmediate =
      outsideRenderedRange &&
      largeJump &&
      this.rafId === null &&
      now - this.lastImmediateUpdateAt > 24;

    if (shouldImmediate) {
      this.lastImmediateUpdateAt = now;
      this.updateVisibleRange(scrollTop, jumpMode);
      return;
    }

    // Skip tiny deltas while we're safely inside the rendered window.
    // This reduces range recomputation and keeps frame-time tails tighter.
    const tinyDelta = deltaPx < Math.max(4, this.itemHeight * 0.5);
    if (!outsideRenderedRange && !ultraFast && !largeJump && tinyDelta) {
      return;
    }

    this.scheduleUpdate(false, jumpMode || ultraFast || outsideRenderedRange);
  }

  private scheduleUpdate(sync: boolean, wideOverscan = false): void {
    if (!this.viewportRef) return;

    const scrollTop = this.clampScrollTop(this.viewportRef.nativeElement.scrollTop);
    this.pendingScrollTop = scrollTop;

    if (sync) {
      this.pendingWideOverscan = false;
      this.updateVisibleRange(scrollTop, wideOverscan);
      return;
    }

    this.pendingWideOverscan = this.pendingWideOverscan || wideOverscan;

    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (this.viewportRef) {
        const nextScrollTop = this.pendingScrollTop;
        const nextWideOverscan = this.pendingWideOverscan;
        this.pendingWideOverscan = false;
        this.updateVisibleRange(nextScrollTop, nextWideOverscan);
      }
    });
  }

  private updateVisibleRange(scrollTop: number, jumpMode = false): void {
    const viewportHeightPx = this.getViewportHeightPx();

    // For very large global jumps we render a smaller slice to keep each frame
    // cheap, since those positions are short-lived and replaced immediately.
    const velocityFactor = jumpMode ? 1 : Math.min(3, 1 + this.scrollVelocity * 0.45);
    const baseBufferPx = Math.max(
      this.minBufferPx,
      Math.floor(viewportHeightPx * (jumpMode ? 0.4 : 0.55)),
    );
    this.currentBufferPx = Math.min(
      jumpMode ? Math.max(this.minBufferPx, Math.floor(this.maxBufferPx * 0.75)) : this.maxBufferPx,
      Math.max(this.minBufferPx, Math.floor(baseBufferPx * velocityFactor)),
    );

    const forwardScale = jumpMode ? 0.9 : this.scrollVelocity > 1.2 ? 1.35 : 1;
    const backwardScale = jumpMode ? 0.7 : 0.8;
    const forwardBufferPx = Math.floor(this.currentBufferPx * forwardScale);
    const backwardBufferPx = Math.floor(this.currentBufferPx * backwardScale);

    const beforeBufferPx = this.scrollDirection >= 0 ? backwardBufferPx : forwardBufferPx;
    const afterBufferPx = this.scrollDirection >= 0 ? forwardBufferPx : backwardBufferPx;

    const logicalScrollTop = scrollTop * this.downscaleFactor;
    const logicalViewportHeight = viewportHeightPx * this.downscaleFactor;
    const logicalBeforeBuffer = beforeBufferPx * this.downscaleFactor;
    const logicalAfterBuffer = afterBufferPx * this.downscaleFactor;

    const rangeStartPx = Math.max(0, logicalScrollTop - logicalBeforeBuffer);
    const rangeEndPx = logicalScrollTop + logicalViewportHeight + logicalAfterBuffer;

    const rawRange = this.strategy.getVisibleRange(rangeStartPx, rangeEndPx);
    const totalItems = this.itemHeights && this.itemHeights.length > 0
      ? this.itemHeights.length
      : this.itemCount;
    const overscanMultiplier = jumpMode ? 0.4 : 0.65;
    const overscanItems = Math.max(
      3,
      Math.ceil((viewportHeightPx / Math.max(1, this.itemHeight)) * overscanMultiplier),
    );
    const startIndex = Math.max(0, rawRange.startIndex - overscanItems);
    const endIndex = Math.min(totalItems, rawRange.endIndex + overscanItems);

    this.lastProcessedScrollTop = scrollTop;

    this.renderedStartPx = this.strategy.getOffsetForIndex(startIndex);
    this.renderedEndPx =
      endIndex >= totalItems
        ? this.strategy.totalContentHeight
        : this.strategy.getOffsetForIndex(endIndex);

    if (startIndex === this.renderedStartIndex && endIndex === this.renderedEndIndex) {
      return;
    }

    this.renderedStartIndex = startIndex;
    this.renderedEndIndex = endIndex;

    // Position the single content wrapper at the first visible item's offset
    const contentOffset = this.strategy.getOffsetForIndex(startIndex) / this.downscaleFactor;
    const transform = `translate3d(0, ${contentOffset}px, 0)`;
    this.contentTransform = transform;
    if (this.contentRef?.nativeElement) {
      this.contentRef.nativeElement.style.transform = transform;
    }

    if (this.virtualFor) {
      this.virtualFor.updateRange(startIndex, endIndex);
    }
  }

  private computeDownscaleFactor(fullHeight: number): number {
    const vh = Math.max(1, this.getViewportHeightPx());
    const maxH = Math.max(vh + 1, Math.floor(this.maxCanvasHeight));

    if (fullHeight <= maxH) return 1;
    return (fullHeight - vh) / (maxH - vh);
  }

  private getViewportHeightPx(): number {
    if (this.viewportRef?.nativeElement) {
      const measured = this.viewportRef.nativeElement.clientHeight;
      if (measured > 0) return measured;
    }

    if (this.viewportHeight > 0) {
      return this.viewportHeight;
    }

    // Safe fallback for pre-view-init calculations in auto-height mode.
    return 560;
  }

  private clampScrollTop(rawScrollTop: number): number {
    if (!this.viewportRef?.nativeElement) {
      return Math.max(0, rawScrollTop);
    }

    const viewport = this.viewportRef.nativeElement;
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    if (!Number.isFinite(rawScrollTop)) return 0;
    return Math.max(0, Math.min(maxScrollTop, rawScrollTop));
  }
}
