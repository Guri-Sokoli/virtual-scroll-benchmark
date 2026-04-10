/**
 * Optimized Library Benchmark Page
 *
 * Uses the custom OvsVirtualScrollViewport + OvsVirtualFor directive
 * from the optimized-virtual-scroll library. Content projection lets
 * the template define its own row layout — matching the CDK's DX.
 */

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  OvsVirtualScrollViewportComponent,
  OvsVirtualForDirective,
} from 'optimized-virtual-scroll';
import {
  BenchmarkConfig,
  BenchmarkItem,
  createBenchmarkItems,
  readBenchmarkConfig,
} from './benchmark-data';

@Component({
  selector: 'app-optimized-benchmark',
  standalone: true,
  imports: [
    CommonModule,
    OvsVirtualScrollViewportComponent,
    OvsVirtualForDirective,
  ],
  template: `
    <h2>Optimized Virtual Scroll Library</h2>

    <div class="meta">
      <span>Dataset: {{ config.size | number }}</span>
      <span>Item height: {{ config.itemHeight }}px</span>
      <span>Viewport: {{ config.viewportHeight }}px</span>
      <span>Dynamic heights: {{ config.dynamicHeights ? 'Enabled' : 'Disabled' }}</span>
      <span>Max canvas: {{ config.maxCanvasHeight | number }}px</span>
    </div>

    <ovs-virtual-scroll-viewport
      [itemCount]="items.length"
      [itemHeight]="config.itemHeight"
      [viewportHeight]="config.viewportHeight"
      [itemHeights]="config.dynamicHeights ? perItemHeights : null"
      [maxCanvasHeight]="config.maxCanvasHeight"
      testId="viewport-optimized"
    >
      <div
        *ovsVirtualFor="let item of items; trackBy: trackById"
        class="row"
        [style.height.px]="item.height"
        [attr.data-index]="item.id"
      >
        #{{ item.id }} — {{ item.label }} — {{ item.value }}
      </div>
    </ovs-virtual-scroll-viewport>
  `,
  styles: [`
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 12px;
    }

    .meta span {
      border: 1px solid #dce1f0;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      color: #475569;
    }

    .row {
      display: flex;
      align-items: center;
      padding: 0 10px;
      border-bottom: 1px solid #f1f3f8;
      box-sizing: border-box;
      font-size: 13px;
      color: #334155;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptimizedBenchmarkComponent {
  private readonly route = inject(ActivatedRoute);

  readonly config: BenchmarkConfig = readBenchmarkConfig(
    this.route.snapshot.queryParamMap,
  );

  items = createBenchmarkItems(
    this.config.size,
    this.config.itemHeight,
    this.config.dynamicHeights,
  );

  /** Pre-computed per-item heights for dynamic mode. */
  perItemHeights = this.items.map(item => item.height);

  protected readonly trackById = (_: number, item: BenchmarkItem) => item.id;
}
