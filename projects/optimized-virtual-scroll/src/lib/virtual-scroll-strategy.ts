/**
 * Virtual Scroll Strategy
 *
 * Encapsulates the core calculations for determining which items are visible
 * within the viewport. Supports both fixed-size and dynamic-height strategies.
 *
 * Fixed-size: simple arithmetic (O(1) per lookup).
 * Dynamic-height: binary search over pre-computed cumulative offsets (O(log n)).
 */

export interface ScrollRange {
  /** First visible item index (inclusive) */
  startIndex: number;
  /** Last visible item index (exclusive) */
  endIndex: number;
}

export interface LayoutEntry {
  /** Offset from the top of the virtual canvas in pixels */
  offset: number;
  /** Height of this item in pixels */
  height: number;
}

export class VirtualScrollStrategy {
  private itemHeights: number[] = [];
  private cumulativeOffsets: number[] = [];
  private _totalContentHeight = 0;

  /** Total logical content height in pixels (before any downscaling). */
  get totalContentHeight(): number {
    return this._totalContentHeight;
  }

  /**
   * Initialise or rebuild the layout data for a given set of item heights.
   * For fixed-size items, pass an array where every entry equals `itemHeight`.
   */
  rebuild(heights: number[]): void {
    const len = heights.length;
    this.itemHeights = heights;

    // Pre-allocate cumulative offset array
    if (this.cumulativeOffsets.length !== len) {
      this.cumulativeOffsets = new Array(len);
    }

    let running = 0;
    for (let i = 0; i < len; i++) {
      this.cumulativeOffsets[i] = running;
      running += heights[i];
    }

    this._totalContentHeight = running;
  }

  /**
   * Fast rebuild for uniform (fixed-size) items.
   * Avoids per-item iteration by using arithmetic.
   */
  rebuildFixed(itemCount: number, itemHeight: number): void {
    this._totalContentHeight = itemCount * itemHeight;

    // Only allocate full arrays if we need them for other lookups
    if (this.itemHeights.length !== itemCount) {
      this.itemHeights = new Array(itemCount);
      this.cumulativeOffsets = new Array(itemCount);
    }

    for (let i = 0; i < itemCount; i++) {
      this.itemHeights[i] = itemHeight;
      this.cumulativeOffsets[i] = i * itemHeight;
    }
  }

  /**
   * Determine which items fall within a pixel range [startPx, endPx).
   */
  getVisibleRange(startPx: number, endPx: number): ScrollRange {
    const len = this.cumulativeOffsets.length;
    if (len === 0) {
      return { startIndex: 0, endIndex: 0 };
    }

    const startIndex = startPx <= 0 ? 0 : this.findIndex(startPx);
    const endIndex = Math.min(len, this.findIndex(endPx) + 1);

    return { startIndex, endIndex };
  }

  /**
   * Return the layout (offset + height) for a specific item index.
   */
  getLayout(index: number): LayoutEntry {
    return {
      offset: this.cumulativeOffsets[index] ?? 0,
      height: this.itemHeights[index] ?? 0,
    };
  }

  /**
   * Return the pixel offset for a given item index.
   */
  getOffsetForIndex(index: number): number {
    return this.cumulativeOffsets[index] ?? 0;
  }

  /**
   * Binary-search for the item index whose cumulative offset is <= the given
   * pixel offset. Uses bitwise shift for integer midpoint (micro-optimisation
   * avoiding Math.floor).
   */
  private findIndex(offset: number): number {
    const offsets = this.cumulativeOffsets;
    const len = offsets.length;
    if (len === 0) return 0;

    let low = 0;
    let high = len - 1;
    let answer = 0;

    while (low <= high) {
      const mid = (low + high) >> 1; // Bitwise shift instead of Math.floor
      if (offsets[mid] <= offset) {
        answer = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return answer;
  }
}
