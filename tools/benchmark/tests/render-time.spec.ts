/**
 * Render-Time Benchmark
 *
 * Measures Time-to-First-Visible-Row — how quickly each implementation
 * renders the first screen of items after navigation.
 *
 * Uses `page.addInitScript()` to inject timing code BEFORE Angular
 * bootstraps, combined with MutationObserver to detect when the viewport
 * and first row elements actually appear in the DOM. This gives honest
 * browser-side timing that starts from the earliest possible moment.
 *
 * Additionally captures Navigation Timing API data (domInteractive,
 * domContentLoaded, loadEventEnd) for correlation.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Mode = 'cdk' | 'optimized';

interface RenderTimeSample {
  mode: Mode;
  size: number;
  iteration: number;
  /** ms from page init-script to viewport element appearing. */
  viewportAppearMs: number;
  /** ms from page init-script to first data row appearing. */
  firstRowAppearMs: number;
  /** Navigation timing: domInteractive (ms). */
  domInteractiveMs: number;
  /** Navigation timing: domContentLoaded (ms). */
  domContentLoadedMs: number;
  /** Navigation timing: loadEventEnd (ms). */
  loadEventEndMs: number;
}

const sizes = [10_000, 50_000, 100_000, 250_000, 500_000];
const iterations = 5;

test('render-time benchmark', async ({ browser }) => {
  test.setTimeout(600_000);

  const samples: RenderTimeSample[] = [];
  const total = sizes.length * 2 * iterations;
  let done = 0;
  const t0 = Date.now();

  console.log('\n' + '═'.repeat(72));
  console.log('  RENDER-TIME (Time-to-First-Visible-Row) BENCHMARK');
  console.log('═'.repeat(72));
  console.log(`  Sizes: ${sizes.join(', ')}  |  Iterations: ${iterations}`);
  console.log('═'.repeat(72) + '\n');

  for (const mode of ['cdk', 'optimized'] as const) {
    for (const size of sizes) {
      for (let iter = 1; iter <= iterations; iter++) {
        done++;
        const pct = ((done / total) * 100).toFixed(1);
        console.log(
          `[${pct}%] ${mode.toUpperCase()} | ${size.toLocaleString()} items | #${iter}`,
        );

        const sample = await measureRenderTime(browser, mode, size, iter);
        samples.push(sample);
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log('\n' + '═'.repeat(72));
  console.log(`  ✓ Done in ${elapsed} min  |  ${samples.length} samples`);
  console.log('═'.repeat(72) + '\n');

  // Print summary
  for (const size of sizes) {
    const cdk = samples.filter((s) => s.mode === 'cdk' && s.size === size);
    const opt = samples.filter((s) => s.mode === 'optimized' && s.size === size);
    if (!cdk.length || !opt.length) continue;

    const cdkAvg = avg(cdk.map((s) => s.firstRowAppearMs));
    const optAvg = avg(opt.map((s) => s.firstRowAppearMs));
    const imp = cdkAvg > 0 ? ((cdkAvg - optAvg) / cdkAvg) * 100 : 0;
    console.log(
      `  ${size.toLocaleString().padStart(8)} items: CDK ${cdkAvg.toFixed(1)}ms  Opt ${optAvg.toFixed(1)}ms  ${imp > 0 ? '+' : ''}${imp.toFixed(1)}%`,
    );
  }

  // Write results
  const dir = join(process.cwd(), 'benchmark-results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'render-time.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), samples }, null, 2),
  );

  const header = Object.keys(samples[0] ?? {}).join(',');
  const rows = samples.map((s) => Object.values(s).join(','));
  writeFileSync(join(dir, 'render-time.csv'), header + '\n' + rows.join('\n') + '\n');

  console.log(`  Results → ${dir}/render-time.{json,csv}`);

  expect(samples.length).toBeGreaterThan(0);
});

/**
 * Measure render time for a single configuration by opening a fresh
 * browser context with an init script injected BEFORE page load.
 */
async function measureRenderTime(
  browser: any,
  mode: Mode,
  size: number,
  iteration: number,
): Promise<RenderTimeSample> {
  const viewportSel = `[data-testid="viewport-${mode}"]`;
  const firstRowSel =
    mode === 'cdk'
      ? `[data-testid="viewport-cdk"] .cdk-virtual-scroll-content-wrapper > *`
      : `[data-testid="viewport-optimized"] [data-index]`;

  // Create a fresh context so init-script runs before any navigation cache
  const context = await browser.newContext();
  const page = await context.newPage();

  // Inject timing code that runs BEFORE Angular bootstrap
  await page.addInitScript(
    (selectors: { viewport: string; firstRow: string }) => {
      const scriptStart = performance.now();
      (window as any).__RENDER_TIMING = {
        scriptStart,
        viewportAppear: 0,
        firstRowAppear: 0,
      };

      const timing = (window as any).__RENDER_TIMING;

      // Use MutationObserver to detect element appearance
      const observer = new MutationObserver(() => {
        if (!timing.viewportAppear && document.querySelector(selectors.viewport)) {
          timing.viewportAppear = performance.now() - scriptStart;
        }
        if (!timing.firstRowAppear && document.querySelector(selectors.firstRow)) {
          timing.firstRowAppear = performance.now() - scriptStart;
          observer.disconnect();
        }
      });

      // Start observing as soon as DOM body is available
      const startObserving = () => {
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
          // Also check immediately (elements may already exist)
          if (document.querySelector(selectors.viewport)) {
            timing.viewportAppear = performance.now() - scriptStart;
          }
          if (document.querySelector(selectors.firstRow)) {
            timing.firstRowAppear = performance.now() - scriptStart;
            observer.disconnect();
          }
        } else {
          requestAnimationFrame(startObserving);
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserving);
      } else {
        startObserving();
      }
    },
    { viewport: viewportSel, firstRow: firstRowSel },
  );

  const query = `size=${size}&itemHeight=32&viewportHeight=560`;
  await page.goto(`http://localhost:4200/${mode}?${query}`);
  await page.waitForSelector(firstRowSel, { timeout: 30_000 });

  // Small settle delay to ensure MutationObserver has fired
  await page.waitForTimeout(200);

  // Collect timings from the browser
  const timings = await page.evaluate(() => {
    const t = (window as any).__RENDER_TIMING ?? {};
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      viewportAppear: t.viewportAppear ?? 0,
      firstRowAppear: t.firstRowAppear ?? 0,
      domInteractive: nav?.domInteractive ?? 0,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
      loadEventEnd: nav?.loadEventEnd ?? 0,
    };
  });

  await context.close();

  return {
    mode,
    size,
    iteration,
    viewportAppearMs: round(timings.viewportAppear),
    firstRowAppearMs: round(timings.firstRowAppear),
    domInteractiveMs: round(timings.domInteractive),
    domContentLoadedMs: round(timings.domContentLoaded),
    loadEventEndMs: round(timings.loadEventEnd),
  };
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function round(v: number): number {
  return Number(v.toFixed(2));
}
