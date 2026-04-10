/**
 * OvsVirtualFor Structural Directive
 *
 * A structural directive similar to @for / *ngFor that works inside the
 * OvsVirtualScrollViewport. It renders only the items in the current
 * visible range, recycling DOM views via the TemplateCacheService.
 *
 * Usage:
 *   <div *ovsVirtualFor="let item of items; trackBy: trackById"
 *        [style.height.px]="32">
 *     {{ item.label }}
 *   </div>
 */

import {
  Directive,
  DoCheck,
  EmbeddedViewRef,
  Input,
  IterableDiffer,
  IterableDiffers,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import { TemplateCacheService, VirtualRowContext } from './template-cache.service';

@Directive({
  selector: '[ovsVirtualFor][ovsVirtualForOf]',
  standalone: true,
})
export class OvsVirtualForDirective<T> implements DoCheck, OnDestroy {
  /** The full data collection. */
  @Input()
  set ovsVirtualForOf(value: T[] | readonly T[] | null | undefined) {
    this._items = value ?? [];
    this._dirty = true;
  }

  /** TrackBy function for efficient view identity. */
  @Input() ovsVirtualForTrackBy?: (index: number, item: T) => unknown;

  /** Start index of the visible window (set by the viewport component). */
  startIndex = 0;
  /** End index of the visible window (exclusive). */
  endIndex = 0;

  private _items: T[] | readonly T[] = [];
  private _dirty = true;
  private _renderedStart = -1;
  private _renderedEnd = -1;
  private _activeViews = new Map<number, EmbeddedViewRef<VirtualRowContext<T>>>();

  constructor(
    public readonly templateRef: TemplateRef<VirtualRowContext<T>>,
    private readonly viewContainer: ViewContainerRef,
    private readonly cache: TemplateCacheService<T>,
  ) {}

  get items(): T[] | readonly T[] {
    return this._items;
  }

  ngDoCheck(): void {
    if (this._dirty) {
      this._dirty = false;
      this.syncViews();
    }
  }

  ngOnDestroy(): void {
    this.cache.clear();
    this.viewContainer.clear();
    this._activeViews.clear();
  }

  /**
   * Called by the viewport component when the visible range changes.
   */
  updateRange(startIndex: number, endIndex: number): void {
    this.startIndex = startIndex;
    this.endIndex = endIndex;
    this.syncViews();
  }

  /**
   * Synchronise the rendered views with the current [startIndex, endIndex).
   * Views outside the range are recycled; missing views are obtained from
   * cache and inserted at the correct DOM position to maintain order.
   */
  private syncViews(): void {
    const start = this.startIndex;
    const end = Math.min(this.endIndex, this._items.length);

    if (start === this._renderedStart && end === this._renderedEnd) {
      return; // Nothing changed
    }

    // 1. Recycle views that are no longer in visible range
    const toRecycle: number[] = [];
    for (const [idx, view] of this._activeViews) {
      if (idx < start || idx >= end) {
        toRecycle.push(idx);
      }
    }
    for (const idx of toRecycle) {
      const view = this._activeViews.get(idx)!;
      this.cache.recycle(view, this.viewContainer);
      this._activeViews.delete(idx);
    }

    // 2. Create / reuse / reorder views for items now in range.
    //    Each item at logical index `i` must sit at DOM position `i - start`.
    for (let i = start; i < end; i++) {
      const containerIdx = i - start;
      const existing = this._activeViews.get(i);

      if (existing) {
        // Ensure correct DOM position
        const currentPos = this.viewContainer.indexOf(existing);
        if (currentPos !== containerIdx) {
          this.viewContainer.move(existing, containerIdx);
        }
        // Update context (item reference may have changed)
        existing.context.$implicit = this._items[i];
        existing.context.ovsVirtualFor = this._items[i];
        existing.context.index = i;
      } else {
        const view = this.cache.obtainView(
          this.templateRef,
          this.viewContainer,
          this._items[i],
          i,
          containerIdx,
        );
        this._activeViews.set(i, view);
      }
    }

    this._renderedStart = start;
    this._renderedEnd = end;
  }
}
