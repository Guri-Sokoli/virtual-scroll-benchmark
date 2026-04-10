/**
 * Side-by-Side Demo Page
 *
 * Shows CDK and Optimized virtual scroll implementations scrolling
 * the SAME dataset simultaneously with synchronized scrolling.
 * Each panel has a live FPS counter overlay so the difference
 * is visible in real-time during a dissertation defense.
 *
 * Usage: navigate to /demo?size=100000 (or use presets in the navbar)
 */

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import {
  OvsVirtualScrollViewportComponent,
  OvsVirtualForDirective,
} from 'optimized-virtual-scroll';
import {
  BenchmarkItem,
  createBenchmarkItems,
} from './benchmark-data';

// ─── FPS Meter ──────────────────────────────────────────────────────

interface FpsSnapshot {
  current: number;
  avg: number;
  min: number;
  max: number;
  p99FrameTime: number;
  longFrames: number;
}

class FpsMeter {
  private frameTimes: number[] = [];
  private allFrameTimes: number[] = [];
  private lastTimestamp = 0;
  private rafId = 0;
  private running = false;
  private _snapshot: FpsSnapshot = { current: 0, avg: 0, min: 0, max: 0, p99FrameTime: 0, longFrames: 0 };

  get snapshot(): FpsSnapshot { return this._snapshot; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = 0;
    this.frameTimes = [];
    this.allFrameTimes = [];
    this._snapshot = { current: 0, avg: 0, min: 0, max: 0, p99FrameTime: 0, longFrames: 0 };
    this.tick = this.tick.bind(this);
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private tick(ts: number): void {
    if (!this.running) return;

    if (this.lastTimestamp > 0) {
      const dt = ts - this.lastTimestamp;
      this.frameTimes.push(dt);
      this.allFrameTimes.push(dt);

      // Update snapshot every ~500ms worth of frames
      if (this.frameTimes.length >= 30) {
        this.updateSnapshot();
        this.frameTimes = [];
      }
    }
    this.lastTimestamp = ts;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private updateSnapshot(): void {
    const times = this.frameTimes;
    const all = this.allFrameTimes;
    if (times.length === 0) return;

    const avgDt = times.reduce((a, b) => a + b, 0) / times.length;
    const currentFps = Math.round(1000 / avgDt);

    const allAvgDt = all.reduce((a, b) => a + b, 0) / all.length;
    const avgFps = Math.round(1000 / allAvgDt * 10) / 10;

    // Compute session-wide FPS per-second windows for min/max
    const fpsValues = [];
    for (let i = 0; i < all.length; ) {
      let windowSum = 0;
      let windowCount = 0;
      while (i < all.length && windowSum < 1000) {
        windowSum += all[i];
        windowCount++;
        i++;
      }
      if (windowCount > 0) {
        fpsValues.push(Math.round(windowCount / (windowSum / 1000)));
      }
    }

    // P99 frame time
    const sorted = [...all].sort((a, b) => a - b);
    const p99Idx = Math.floor(sorted.length * 0.99);
    const p99 = sorted[p99Idx] || 0;

    // Long frames (>33ms = below 30fps)
    const longFrames = all.filter(t => t > 33.34).length;

    this._snapshot = {
      current: currentFps,
      avg: avgFps,
      min: fpsValues.length > 0 ? Math.min(...fpsValues) : 0,
      max: fpsValues.length > 0 ? Math.max(...fpsValues) : 0,
      p99FrameTime: Math.round(p99 * 10) / 10,
      longFrames,
    };
  }
}

// ─── Component ──────────────────────────────────────────────────────

@Component({
  selector: 'app-demo',
  standalone: true,
  imports: [
    CommonModule,
    ScrollingModule,
    OvsVirtualScrollViewportComponent,
    OvsVirtualForDirective,
  ],
  template: `
    <div class="demo-header">
      <h1>Live Side-by-Side Comparison</h1>
      <div class="demo-controls">
        <span class="label">Dataset size:</span>
        @for (s of sizes; track s) {
          <button
            [class.active]="currentSize === s"
            (click)="changeSize(s)"
          >{{ s | number }}</button>
        }
        <span class="separator">|</span>
        <button (click)="syncEnabled = !syncEnabled" [class.active]="syncEnabled">
          {{ syncEnabled ? 'Sync ON' : 'Sync OFF' }}
        </button>
        <button (click)="resetCounters()" class="reset-btn">Reset FPS</button>
      </div>
    </div>

    <div class="demo-panels">
      <!-- ─── CDK Panel ─── -->
      <div class="panel">
        <div class="panel-header cdk-header">
          <h2>Angular CDK</h2>
          <span class="badge">Baseline</span>
        </div>
        <div class="fps-overlay" [class.good]="cdkFps.current >= 55" [class.warn]="cdkFps.current < 55 && cdkFps.current >= 30" [class.bad]="cdkFps.current < 30">
          <div class="fps-main">{{ cdkFps.current }} <small>FPS</small></div>
          <div class="fps-detail">
            <span>Avg: {{ cdkFps.avg }}</span>
            <span>Min: {{ cdkFps.min }}</span>
            <span>P99: {{ cdkFps.p99FrameTime }}ms</span>
            <span>Long: {{ cdkFps.longFrames }}</span>
          </div>
        </div>
        <cdk-virtual-scroll-viewport
          #cdkViewport
          class="viewport"
          [itemSize]="itemHeight"
          [minBufferPx]="256"
          [maxBufferPx]="768"
        >
          <div
            class="row"
            *cdkVirtualFor="let item of items; trackBy: trackById"
            [style.height.px]="itemHeight"
          >
            <span class="row-id">#{{ item.id }}</span>
            <span class="row-label">{{ item.label }}</span>
            <span class="row-value">{{ item.value }}</span>
          </div>
        </cdk-virtual-scroll-viewport>
      </div>

      <!-- ─── Optimized Panel ─── -->
      <div class="panel">
        <div class="panel-header opt-header">
          <h2>Optimized Library</h2>
          <span class="badge">Custom</span>
        </div>
        <div class="fps-overlay" [class.good]="optFps.current >= 55" [class.warn]="optFps.current < 55 && optFps.current >= 30" [class.bad]="optFps.current < 30">
          <div class="fps-main">{{ optFps.current }} <small>FPS</small></div>
          <div class="fps-detail">
            <span>Avg: {{ optFps.avg }}</span>
            <span>Min: {{ optFps.min }}</span>
            <span>P99: {{ optFps.p99FrameTime }}ms</span>
            <span>Long: {{ optFps.longFrames }}</span>
          </div>
        </div>
        <ovs-virtual-scroll-viewport
          #optViewport
          class="viewport"
          [itemCount]="items.length"
          [itemHeight]="itemHeight"
          [viewportHeight]="viewportHeight"
          testId="viewport-optimized"
        >
          <div
            *ovsVirtualFor="let item of items; trackBy: trackById"
            class="row"
            [style.height.px]="itemHeight"
          >
            <span class="row-id">#{{ item.id }}</span>
            <span class="row-label">{{ item.label }}</span>
            <span class="row-value">{{ item.value }}</span>
          </div>
        </ovs-virtual-scroll-viewport>
      </div>
    </div>

    <div class="demo-footer">
      <p>
        Scroll either panel — the other follows automatically when <strong>Sync</strong> is ON.<br>
        Enable <strong>CPU throttling</strong> in DevTools (Performance tab → ⚙ → CPU: 4× or 6×) to see the real difference.
      </p>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
      overflow: hidden;
      background: #f8fafc;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }

    /* ── Header ── */
    .demo-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    .demo-header h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: -0.02em;
    }

    .demo-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .demo-controls .label {
      font-size: 12px;
      color: #64748b;
      margin-right: 4px;
    }

    .demo-controls .separator {
      color: #cbd5e1;
      margin: 0 4px;
    }

    .demo-controls button {
      padding: 5px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: #ffffff;
      color: #475569;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .demo-controls button:hover {
      background: #f1f5f9;
      border-color: #94a3b8;
    }

    .demo-controls button.active {
      background: #3730a3;
      color: #ffffff;
      border-color: #3730a3;
    }

    .reset-btn {
      margin-left: 4px;
    }

    /* ── Panels ── */
    .demo-panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      padding: 16px 20px;
      height: calc(100vh - 130px);
    }

    .panel {
      position: relative;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.02);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 2px solid;
    }

    .cdk-header {
      border-bottom-color: #6366f1;
      background: linear-gradient(135deg, #eef2ff, #e0e7ff);
    }

    .opt-header {
      border-bottom-color: #10b981;
      background: linear-gradient(135deg, #ecfdf5, #d1fae5);
    }

    .panel-header h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
    }

    .badge {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(0,0,0,0.06);
      color: #475569;
    }

    /* ── FPS Overlay ── */
    .fps-overlay {
      position: absolute;
      top: 56px;
      right: 12px;
      z-index: 10;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
      border-radius: 10px;
      padding: 10px 14px;
      min-width: 130px;
      transition: background 0.3s ease;
    }

    .fps-overlay.good { border-left: 3px solid #10b981; }
    .fps-overlay.warn { border-left: 3px solid #f59e0b; }
    .fps-overlay.bad  { border-left: 3px solid #ef4444; }

    .fps-main {
      font-size: 32px;
      font-weight: 800;
      color: #ffffff;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    .fps-main small {
      font-size: 13px;
      font-weight: 500;
      color: #94a3b8;
      margin-left: 2px;
    }

    .fps-detail {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      margin-top: 6px;
    }

    .fps-detail span {
      font-size: 10px;
      font-weight: 500;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
    }

    /* ── Viewport ── */
    .viewport {
      flex: 1;
      width: 100%;
      min-height: 0;
    }

    .row {
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 16px;
      border-bottom: 1px solid #f1f5f9;
      box-sizing: border-box;
      font-size: 13px;
      color: #334155;
      transition: background 0.1s;
    }

    .row:hover {
      background: #f8fafc;
    }

    .row-id {
      font-weight: 600;
      color: #6366f1;
      min-width: 70px;
      font-variant-numeric: tabular-nums;
    }

    .row-label {
      flex: 1;
      color: #475569;
    }

    .row-value {
      font-weight: 500;
      color: #1e293b;
      font-variant-numeric: tabular-nums;
    }

    /* ── Footer ── */
    .demo-footer {
      text-align: center;
      padding: 8px;
    }

    .demo-footer p {
      margin: 0;
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.5;
    }

    .demo-footer strong {
      color: #64748b;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoComponent implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('cdkViewport', { read: ElementRef }) cdkViewportEl!: ElementRef<HTMLElement>;
  @ViewChild('optViewport', { read: ElementRef }) optViewportEl!: ElementRef<HTMLElement>;

  readonly sizes = [1_000, 10_000, 50_000, 100_000];
  readonly itemHeight = 32;
  readonly viewportHeight = 0;

  currentSize = 10_000;
  syncEnabled = true;

  items: BenchmarkItem[] = [];

  // FPS meters
  private cdkMeter = new FpsMeter();
  private optMeter = new FpsMeter();
  cdkFps: FpsSnapshot = { current: 0, avg: 0, min: 0, max: 0, p99FrameTime: 0, longFrames: 0 };
  optFps: FpsSnapshot = { current: 0, avg: 0, min: 0, max: 0, p99FrameTime: 0, longFrames: 0 };

  private syncingScroll = false;
  private uiRafId = 0;

  constructor() {
    const sizeParam = this.route.snapshot.queryParamMap.get('size');
    if (sizeParam) {
      const parsed = parseInt(sizeParam, 10);
      if (parsed > 0 && parsed <= 500_000) this.currentSize = parsed;
    }
    this.items = createBenchmarkItems(this.currentSize, this.itemHeight, false);
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.cdkMeter.start();
      this.optMeter.start();

      // Sync scroll between panels
      const cdkEl = this.cdkViewportEl.nativeElement.querySelector('.cdk-virtual-scroll-viewport') ?? this.cdkViewportEl.nativeElement;
      const optEl = this.optViewportEl.nativeElement.querySelector('.ovs-viewport') ?? this.optViewportEl.nativeElement;

      cdkEl.addEventListener('scroll', () => {
        if (this.syncingScroll || !this.syncEnabled) return;
        this.syncingScroll = true;
        optEl.scrollTop = cdkEl.scrollTop;
        requestAnimationFrame(() => this.syncingScroll = false);
      }, { passive: true });

      optEl.addEventListener('scroll', () => {
        if (this.syncingScroll || !this.syncEnabled) return;
        this.syncingScroll = true;
        cdkEl.scrollTop = optEl.scrollTop;
        requestAnimationFrame(() => this.syncingScroll = false);
      }, { passive: true });

      // Update UI at ~4 Hz for FPS display
      const updateUI = () => {
        this.cdkFps = this.cdkMeter.snapshot;
        this.optFps = this.optMeter.snapshot;
        this.cdr.detectChanges();
        this.uiRafId = requestAnimationFrame(updateUI);
      };
      // Throttle to ~4 Hz
      let lastUpdate = 0;
      const throttledUpdate = () => {
        const now = performance.now();
        if (now - lastUpdate > 250) {
          this.cdkFps = this.cdkMeter.snapshot;
          this.optFps = this.optMeter.snapshot;
          this.cdr.detectChanges();
          lastUpdate = now;
        }
        this.uiRafId = requestAnimationFrame(throttledUpdate);
      };
      this.uiRafId = requestAnimationFrame(throttledUpdate);
    });
  }

  ngOnDestroy(): void {
    this.cdkMeter.stop();
    this.optMeter.stop();
    if (this.uiRafId) cancelAnimationFrame(this.uiRafId);
  }

  changeSize(size: number): void {
    this.currentSize = size;
    this.items = createBenchmarkItems(size, this.itemHeight, false);
    this.resetCounters();
  }

  resetCounters(): void {
    this.cdkMeter.stop();
    this.optMeter.stop();
    this.cdkFps = { current: 0, avg: 0, min: 0, max: 0, p99FrameTime: 0, longFrames: 0 };
    this.optFps = { current: 0, avg: 0, min: 0, max: 0, p99FrameTime: 0, longFrames: 0 };
    this.zone.runOutsideAngular(() => {
      setTimeout(() => {
        this.cdkMeter.start();
        this.optMeter.start();
      }, 100);
    });
  }

  protected readonly trackById = (_: number, item: BenchmarkItem) => item.id;
}
