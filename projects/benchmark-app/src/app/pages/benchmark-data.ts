/**
 * Shared benchmark data utilities.
 *
 * Provides dataset generation and configuration parsing used by both
 * the CDK baseline page and the optimized library page.
 */

import { ParamMap } from '@angular/router';

// ─── Types ──────────────────────────────────────────────────────

export interface BenchmarkItem {
  id: number;
  label: string;
  value: number;
  /** Per-item height for dynamic-height testing. */
  height: number;
}

export interface BenchmarkConfig {
  size: number;
  itemHeight: number;
  viewportHeight: number;
  dynamicHeights: boolean;
  maxCanvasHeight: number;
}

// ─── Configuration ──────────────────────────────────────────────

/**
 * Read benchmark configuration from Angular route query params.
 * Every parameter has a sensible default and is clamped to a safe range.
 */
export function readBenchmarkConfig(params: ParamMap): BenchmarkConfig {
  return {
    size:            clampInt(params.get('size'),            10_000,    1_000,  500_000),
    itemHeight:      clampInt(params.get('itemHeight'),      32,        20,     120),
    viewportHeight:  clampInt(params.get('viewportHeight'),  560,       280,    1_000),
    dynamicHeights:  params.get('dynamic') === '1',
    maxCanvasHeight: clampInt(params.get('maxCanvasHeight'), 8_000_000, 1_000_000, 32_000_000),
  };
}

// ─── Dataset Generation ─────────────────────────────────────────

/**
 * Generate a deterministic dataset of the given size.
 * Height varies if dynamicHeights is enabled (±offset from base height).
 */
export function createBenchmarkItems(
  size: number,
  itemHeight: number,
  dynamicHeights: boolean,
): BenchmarkItem[] {
  const items = new Array<BenchmarkItem>(size);
  for (let i = 0; i < size; i++) {
    items[i] = {
      id: i,
      label: `Item ${i}`,
      value: (i * 17) % 997,
      height: dynamicHeights ? dynamicHeightFor(i, itemHeight) : itemHeight,
    };
  }
  return items;
}

// ─── Helpers ────────────────────────────────────────────────────

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

/**
 * Deterministic dynamic height based on item index.
 * Produces a repeating pattern of offsets from the base height.
 */
function dynamicHeightFor(index: number, base: number): number {
  const pattern = [0, 6, -4, 10, -2, 14, -6, 8];
  const offset = pattern[index % pattern.length];
  return Math.max(20, base + offset);
}
