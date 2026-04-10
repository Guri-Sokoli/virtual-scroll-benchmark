/**
 * CDK Baseline Benchmark Page
 *
 * Renders items using Angular CDK's FixedSizeVirtualScrollStrategy —
 * the out-of-the-box industry-standard implementation.
 */

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import {
  BenchmarkConfig,
  BenchmarkItem,
  createBenchmarkItems,
  readBenchmarkConfig,
} from './benchmark-data';

@Component({
  selector: 'app-cdk-benchmark',
  standalone: true,
  imports: [CommonModule, ScrollingModule],
  template: `
    <h2>Angular CDK Baseline</h2>

    <div class="meta">
      <span>Dataset: {{ config.size | number }}</span>
      <span>Item height: {{ config.itemHeight }}px</span>
      <span>Viewport: {{ config.viewportHeight }}px</span>
      <span>Dynamic heights: Disabled (fixed-size strategy)</span>
    </div>

    <cdk-virtual-scroll-viewport
      class="viewport"
      [itemSize]="config.itemHeight"
      [style.height.px]="config.viewportHeight"
      [minBufferPx]="256"
      [maxBufferPx]="768"
      data-testid="viewport-cdk"
    >
      <div
        class="row"
        *cdkVirtualFor="let item of items; trackBy: trackById"
        [style.height.px]="config.itemHeight"
      >
        #{{ item.id }} — {{ item.label }} — {{ item.value }}
      </div>
    </cdk-virtual-scroll-viewport>
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

    .viewport {
      width: 100%;
      border: 1px solid #d3d8e8;
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
export class CdkBenchmarkComponent {
  private readonly route = inject(ActivatedRoute);

  readonly config: BenchmarkConfig = readBenchmarkConfig(
    this.route.snapshot.queryParamMap,
  );

  items = createBenchmarkItems(this.config.size, this.config.itemHeight, false);

  protected readonly trackById = (_: number, item: BenchmarkItem) => item.id;
}
