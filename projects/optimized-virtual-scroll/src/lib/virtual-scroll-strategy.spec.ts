/**
 * Unit Tests: VirtualScrollStrategy
 *
 * Tests the pure calculation engine for correctness across:
 * - Fixed-height layout
 * - Variable-height layout
 * - Binary search edge cases
 * - Empty/single-item datasets
 * - Large dataset scaling
 */

import { VirtualScrollStrategy } from './virtual-scroll-strategy';

describe('VirtualScrollStrategy', () => {
  let strategy: VirtualScrollStrategy;

  beforeEach(() => {
    strategy = new VirtualScrollStrategy();
  });

  // ─── Fixed-Height Mode ──────────────────────────────────────

  describe('rebuildFixed()', () => {
    it('should compute total content height correctly', () => {
      strategy.rebuildFixed(100, 32);
      expect(strategy.totalContentHeight).toBe(3200); // 100 × 32
    });

    it('should compute total height for single item', () => {
      strategy.rebuildFixed(1, 50);
      expect(strategy.totalContentHeight).toBe(50);
    });

    it('should handle zero items', () => {
      strategy.rebuildFixed(0, 32);
      expect(strategy.totalContentHeight).toBe(0);
    });

    it('should support re-initialization with different sizes', () => {
      strategy.rebuildFixed(100, 32);
      expect(strategy.totalContentHeight).toBe(3200);

      strategy.rebuildFixed(200, 40);
      expect(strategy.totalContentHeight).toBe(8000);
    });
  });

  // ─── Variable-Height Mode ──────────────────────────────────

  describe('rebuild()', () => {
    it('should compute total content height from variable heights', () => {
      strategy.rebuild([30, 40, 50, 60]); // sum = 180
      expect(strategy.totalContentHeight).toBe(180);
    });

    it('should handle empty array', () => {
      strategy.rebuild([]);
      expect(strategy.totalContentHeight).toBe(0);
    });

    it('should handle single item', () => {
      strategy.rebuild([42]);
      expect(strategy.totalContentHeight).toBe(42);
    });

    it('should work with identical heights (equivalent to fixed)', () => {
      const heights = new Array(100).fill(32);
      strategy.rebuild(heights);
      expect(strategy.totalContentHeight).toBe(3200);
    });
  });

  // ─── getLayout() ───────────────────────────────────────────

  describe('getLayout()', () => {
    it('should return correct offset and height for fixed items', () => {
      strategy.rebuildFixed(10, 32);

      expect(strategy.getLayout(0)).toEqual({ offset: 0, height: 32 });
      expect(strategy.getLayout(1)).toEqual({ offset: 32, height: 32 });
      expect(strategy.getLayout(5)).toEqual({ offset: 160, height: 32 });
      expect(strategy.getLayout(9)).toEqual({ offset: 288, height: 32 });
    });

    it('should return correct offset and height for variable items', () => {
      strategy.rebuild([30, 40, 50]);

      expect(strategy.getLayout(0)).toEqual({ offset: 0, height: 30 });
      expect(strategy.getLayout(1)).toEqual({ offset: 30, height: 40 });
      expect(strategy.getLayout(2)).toEqual({ offset: 70, height: 50 });
    });

    it('should return zero for out-of-bounds index', () => {
      strategy.rebuildFixed(5, 32);
      expect(strategy.getLayout(100)).toEqual({ offset: 0, height: 0 });
    });
  });

  // ─── getOffsetForIndex() ───────────────────────────────────

  describe('getOffsetForIndex()', () => {
    it('should return first item offset as 0', () => {
      strategy.rebuildFixed(10, 32);
      expect(strategy.getOffsetForIndex(0)).toBe(0);
    });

    it('should return correct offset for middle item', () => {
      strategy.rebuildFixed(100, 32);
      expect(strategy.getOffsetForIndex(50)).toBe(1600); // 50 × 32
    });

    it('should return correct offset for last item', () => {
      strategy.rebuildFixed(100, 32);
      expect(strategy.getOffsetForIndex(99)).toBe(3168); // 99 × 32
    });

    it('should return 0 for out-of-bounds index', () => {
      strategy.rebuildFixed(5, 32);
      expect(strategy.getOffsetForIndex(999)).toBe(0);
    });
  });

  // ─── getVisibleRange() ─────────────────────────────────────

  describe('getVisibleRange()', () => {
    describe('with fixed-height items', () => {
      beforeEach(() => {
        strategy.rebuildFixed(100, 32); // 100 items × 32px = 3200px total
      });

      it('should return first visible items from top', () => {
        const range = strategy.getVisibleRange(0, 320); // 320px viewport
        expect(range.startIndex).toBe(0);
        expect(range.endIndex).toBe(11); // ceil(320/32) + 1
      });

      it('should return correct range for middle scroll position', () => {
        const range = strategy.getVisibleRange(640, 960); // 320px window at 640px offset
        expect(range.startIndex).toBe(20); // 640 / 32
        expect(range.endIndex).toBe(31); // ceil(960/32) + 1
      });

      it('should clamp to dataset bounds at the end', () => {
        const range = strategy.getVisibleRange(3000, 3500); // past the end
        expect(range.endIndex).toBeLessThanOrEqual(100);
      });

      it('should return empty range for empty dataset', () => {
        strategy.rebuildFixed(0, 32);
        const range = strategy.getVisibleRange(0, 100);
        expect(range.startIndex).toBe(0);
        expect(range.endIndex).toBe(0);
      });

      it('should return single item for tiny viewport', () => {
        const range = strategy.getVisibleRange(0, 1); // 1px viewport
        expect(range.startIndex).toBe(0);
        expect(range.endIndex).toBeGreaterThanOrEqual(1);
      });
    });

    describe('with variable-height items', () => {
      beforeEach(() => {
        // Items at offsets: 0, 30, 70, 120, 180
        strategy.rebuild([30, 40, 50, 60, 70]);
      });

      it('should find correct range for first items', () => {
        const range = strategy.getVisibleRange(0, 50);
        expect(range.startIndex).toBe(0);
        // At 50px, we're in the second item (offset 30, height 40, end 70)
        expect(range.endIndex).toBe(2);
      });

      it('should find correct range for middle items', () => {
        const range = strategy.getVisibleRange(70, 180);
        expect(range.startIndex).toBe(2); // offset 70 = item 2
        expect(range.endIndex).toBe(5);   // offset 180 = item 4 end
      });

      it('should handle range spanning entire dataset', () => {
        const range = strategy.getVisibleRange(0, 500);
        expect(range.startIndex).toBe(0);
        expect(range.endIndex).toBe(5);
      });
    });
  });

  // ─── Binary Search Edge Cases ──────────────────────────────

  describe('binary search correctness', () => {
    it('should handle single-item dataset', () => {
      strategy.rebuildFixed(1, 100);
      const range = strategy.getVisibleRange(0, 100);
      expect(range.startIndex).toBe(0);
      expect(range.endIndex).toBe(1);
    });

    it('should handle two-item dataset', () => {
      strategy.rebuildFixed(2, 50);
      const range = strategy.getVisibleRange(0, 50);
      expect(range.startIndex).toBe(0);
      expect(range.endIndex).toBe(2);
    });

    it('should handle exact boundary alignment', () => {
      strategy.rebuildFixed(10, 32);
      // Pixel 32 is exactly at the start of item 1
      const range = strategy.getVisibleRange(32, 64);
      expect(range.startIndex).toBe(1);
    });

    it('should handle large datasets (100k items)', () => {
      strategy.rebuildFixed(100_000, 32);
      expect(strategy.totalContentHeight).toBe(3_200_000);

      // Check middle of dataset
      const range = strategy.getVisibleRange(1_600_000, 1_600_560);
      expect(range.startIndex).toBe(50_000);

      // The range should cover ~17.5 items (560/32)
      const count = range.endIndex - range.startIndex;
      expect(count).toBeGreaterThanOrEqual(17);
      expect(count).toBeLessThanOrEqual(19);
    });

    it('should handle pixel offset of 0', () => {
      strategy.rebuildFixed(10, 32);
      const range = strategy.getVisibleRange(0, 32);
      expect(range.startIndex).toBe(0);
    });

    it('should produce contiguous ranges during simulated scroll', () => {
      strategy.rebuildFixed(1000, 32);
      const viewportHeight = 560;

      // Simulate scrolling through the dataset
      let lastEnd = 0;
      for (let scrollTop = 0; scrollTop < 31000; scrollTop += 100) {
        const range = strategy.getVisibleRange(scrollTop, scrollTop + viewportHeight);
        // Each range should be valid
        expect(range.startIndex).toBeGreaterThanOrEqual(0);
        expect(range.endIndex).toBeLessThanOrEqual(1000);
        expect(range.startIndex).toBeLessThanOrEqual(range.endIndex);

        // Ranges should generally overlap with previous (no gaps)
        if (scrollTop > 0) {
          expect(range.startIndex).toBeLessThanOrEqual(lastEnd);
        }
        lastEnd = range.endIndex;
      }
    });
  });

  // ─── Performance Characteristics ────────────────────────────

  describe('performance', () => {
    it('rebuildFixed should be fast for 100k items', () => {
      const start = performance.now();
      strategy.rebuildFixed(100_000, 32);
      const elapsed = performance.now() - start;

      // Should complete in well under 50ms
      expect(elapsed).toBeLessThan(50);
    });

    it('rebuild (variable) should be fast for 100k items', () => {
      const heights = Array.from({ length: 100_000 }, (_, i) => 30 + (i % 8) * 2);

      const start = performance.now();
      strategy.rebuild(heights);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it('getVisibleRange should be fast (O(log n))', () => {
      strategy.rebuildFixed(100_000, 32);

      const start = performance.now();
      for (let i = 0; i < 10_000; i++) {
        strategy.getVisibleRange(i * 320, i * 320 + 560);
      }
      const elapsed = performance.now() - start;

      // 10,000 lookups should take well under 50ms
      expect(elapsed).toBeLessThan(50);
    });
  });
});
