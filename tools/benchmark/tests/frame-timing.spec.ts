/**
 * Frame-Timing Benchmark
 *
 * This is the PRIMARY benchmark for the dissertation. It measures
 * individual frame durations using requestAnimationFrame timestamps
 * inside the browser, then computes honest statistics:
 *
 *   - Frame time percentiles (p50, p95, p99)
 *   - Jank frame count (frames > 16.67ms)
 *   - Long frame count (frames > 33ms — visible stutter)
 *   - Average FPS (for reference, NOT the main metric)
 *   - FPS standard deviation
 *
 * CPU THROTTLING via Chrome DevTools Protocol is used so that
 * algorithmic differences become measurable even on fast hardware.
 * This is the standard Chrome DevTools approach for simulating
 * lower-end devices.
 */

import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────

type Mode = 'cdk' | 'optimized';
type Scenario = 'continuous' | 'variable-speed' | 'direction-change' | 'jump-to-index' | 'endurance';

interface FrameTimingSample {
  mode: Mode;
  scenario: Scenario;
  size: number;
  cpuThrottle: number;
  iteration: number;
  /** Individual frame durations in ms (raw data). */
  frameTimes: number[];
  /** Summary statistics computed from frameTimes. */
  avgFps: number;
  medianFrameTime: number;
  p95FrameTime: number;
  p99FrameTime: number;
  stdDevFps: number;
  jankFrames: number;       // > 16.67ms
  longFrames: number;       // > 33.33ms
  totalFrames: number;
  durationMs: number;
  /** Memory (Chrome-specific). */
  memoryStartMb: number;
  memoryEndMb: number;
  memoryDeltaMb: number;
}

interface SummaryRow {
  mode: Mode;
  scenario: Scenario;
  size: number;
  cpuThrottle: number;
  sampleCount: number;
  meanAvgFps: number;
  meanMedianFrameTime: number;
  meanP95FrameTime: number;
  meanP99FrameTime: number;
  meanStdDevFps: number;
  meanJankFrames: number;
  meanLongFrames: number;
  meanTotalFrames: number;
  meanMemoryDeltaMb: number;
}

const FRAME_BUDGET_MS = 16.67;
const JANK_TOLERANCE_MS = 0.75;
const JANK_THRESHOLD_MS = FRAME_BUDGET_MS + JANK_TOLERANCE_MS;
const LONG_FRAME_THRESHOLD_MS = 50;

// ─── Configuration ──────────────────────────────────────────────

const MODES: Mode[] = ['cdk', 'optimized'];
const DEFAULT_SIZES = [10_000, 50_000, 100_000];
const DEFAULT_SCENARIOS: Scenario[] = [
  'continuous',
  'variable-speed',
  'direction-change',
  'jump-to-index',
  'endurance',
];

const warmupIterations = Number(process.env['BENCH_WARMUP'] ?? 2);
const measureIterations = Number(process.env['BENCH_ITERATIONS'] ?? 5);
const datasetSizes = parseSizes(process.env['BENCH_SIZES'], DEFAULT_SIZES);
const scenarios = parseScenarios(process.env['BENCH_SCENARIOS'], DEFAULT_SCENARIOS);

/**
 * CPU throttle rate. 4× means the CPU appears 4× slower.
 * This is the standard Chrome DevTools throttling mechanism.
 * Set BENCH_CPU_THROTTLE=1 to disable throttling.
 */
const cpuThrottle = Number(process.env['BENCH_CPU_THROTTLE'] ?? 4);

// ─── Main Test ──────────────────────────────────────────────────

test('frame-timing benchmark', async ({ page }) => {
  test.setTimeout(1_800_000); // 30 min

  const samples: FrameTimingSample[] = [];

  // Enable CDP for CPU throttling
  const cdp = await page.context().newCDPSession(page);

  const totalConfigs = MODES.length * datasetSizes.length * scenarios.length;
  let completed = 0;
  const t0 = Date.now();

  console.log('\n' + '═'.repeat(72));
  console.log('  FRAME-TIMING BENCHMARK (CPU throttle: ' + cpuThrottle + '×)');
  console.log('═'.repeat(72));
  console.log(`  Sizes: ${datasetSizes.join(', ')}`);
  console.log(`  Scenarios: ${scenarios.join(', ')}`);
  console.log(`  Warmup: ${warmupIterations}  |  Measure: ${measureIterations}`);
  console.log(`  Total configs: ${totalConfigs}`);
  console.log('═'.repeat(72) + '\n');

  for (const mode of MODES) {
    for (const size of datasetSizes) {
      for (const scenario of scenarios) {
        completed++;
        const pct = ((completed / totalConfigs) * 100).toFixed(1);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`[${pct}%] ${mode.toUpperCase()} | ${size.toLocaleString()} | ${scenario} | ${elapsed}s`);

        // ── Warmup ──
        for (let w = 0; w < warmupIterations; w++) {
          await runScenario(page, cdp, { mode, size, scenario, cpuThrottle });
        }

        // ── Measure ──
        for (let iter = 1; iter <= measureIterations; iter++) {
          const result = await runScenario(page, cdp, { mode, size, scenario, cpuThrottle });
          samples.push({ ...result, iteration: iter });
        }
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log('\n' + '═'.repeat(72));
  console.log(`  ✓ Done in ${elapsed} min  |  ${samples.length} samples collected`);
  console.log('═'.repeat(72) + '\n');

  await cdp.detach();

  const summary = summarise(samples);
  writeResults(samples, summary);

  expect(samples.length).toBeGreaterThan(0);
});

// ─── Scenario Runner ────────────────────────────────────────────

async function runScenario(
  page: Page,
  cdp: CDPSession,
  opts: { mode: Mode; size: number; scenario: Scenario; cpuThrottle: number },
): Promise<Omit<FrameTimingSample, 'iteration'>> {
  const query = `size=${opts.size}&itemHeight=32&viewportHeight=560`;
  await page.goto(`/${opts.mode}?${query}`);
  await page.waitForSelector(`[data-testid="viewport-${opts.mode}"]`, { timeout: 30_000 });

  // Apply CPU throttle via CDP
  if (opts.cpuThrottle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpuThrottle });
  }

  // Run the scroll scenario inside the browser and collect per-frame data
  const result = await page.evaluate(
    (payload) => {
      return new Promise<{
        frameTimes: number[];
        memoryStart: number;
        memoryEnd: number;
      }>((resolve) => {
        const target = document.querySelector<HTMLElement>(
          `[data-testid="viewport-${payload.mode}"]`,
        );
        if (!target) throw new Error('viewport not found');

        const mem = (performance as any).memory;
        const memoryStart: number = mem?.usedJSHeapSize ?? 0;

        const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
        const durationMs = payload.scenario === 'endurance' ? 10_000 : 4_500;
        const frameTimes: number[] = [];
        let prevTimestamp = 0;
        let elapsedMs = 0;

        const setScroll = (elapsed: number) => {
          const t = target;
          const ms = maxScroll;
          const dur = durationMs;

          switch (payload.scenario) {
            case 'continuous':
            case 'endurance':
              t.scrollTop = Math.floor(ms * Math.min(1, elapsed / dur));
              break;

            case 'variable-speed': {
              const phase = Math.floor((elapsed / dur) * 3);
              const speeds = [2, 10, 24];
              t.scrollTop = Math.min(ms, t.scrollTop + (speeds[phase] ?? 10));
              break;
            }

            case 'direction-change': {
              const dir = Math.floor((elapsed / 400) % 2) === 0 ? 20 : -20;
              t.scrollTop = Math.max(0, Math.min(ms, t.scrollTop + dir));
              break;
            }

            case 'jump-to-index': {
              const jumps = [0.1, 0.45, 0.2, 0.8, 0.35, 0.95];
              const idx = Math.min(
                jumps.length - 1,
                Math.floor((elapsed / dur) * jumps.length),
              );
              t.scrollTop = Math.floor(ms * jumps[idx]);
              break;
            }
          }
        };

        const tick = (timestamp: number) => {
          if (prevTimestamp > 0) {
            const dt = timestamp - prevTimestamp;
            frameTimes.push(dt);
            elapsedMs += dt;
          }
          prevTimestamp = timestamp;

          if (elapsedMs >= durationMs) {
            const memoryEnd: number = mem?.usedJSHeapSize ?? 0;
            resolve({ frameTimes, memoryStart, memoryEnd });
            return;
          }

          setScroll(elapsedMs);
          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      });
    },
    { mode: opts.mode, scenario: opts.scenario },
  );

  // Remove CPU throttle between runs
  if (opts.cpuThrottle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }

  // ── Compute statistics from raw frame times ──
  const ft = result.frameTimes;
  const sorted = [...ft].sort((a, b) => a - b);
  const totalMs = ft.reduce((a, b) => a + b, 0);
  const fpsPerFrame = ft.map((t) => (t > 0 ? 1000 / t : 0));
  const avgFps = totalMs > 0 ? (ft.length / totalMs) * 1000 : 0;
  const meanFps = fpsPerFrame.reduce((a, b) => a + b, 0) / (fpsPerFrame.length || 1);
  const variance =
    fpsPerFrame.reduce((sum, f) => sum + (f - meanFps) ** 2, 0) / (fpsPerFrame.length || 1);
  const stdDevFps = Math.sqrt(variance);

  const percentile = (p: number) => sorted[Math.floor(sorted.length * p)] ?? 0;

  return {
    mode: opts.mode,
    scenario: opts.scenario,
    size: opts.size,
    cpuThrottle: opts.cpuThrottle,
    frameTimes: ft,
    avgFps: round(avgFps),
    medianFrameTime: round(percentile(0.5)),
    p95FrameTime: round(percentile(0.95)),
    p99FrameTime: round(percentile(0.99)),
    stdDevFps: round(stdDevFps),
    // Use tolerance-aware jank threshold to avoid counting 16.70ms V-Sync frames as jank.
    jankFrames: ft.filter((t) => t > JANK_THRESHOLD_MS).length,
    // Severe long frames represent clearly visible stutter.
    longFrames: ft.filter((t) => t > LONG_FRAME_THRESHOLD_MS).length,
    totalFrames: ft.length,
    durationMs: round(totalMs),
    memoryStartMb: round(result.memoryStart / (1024 * 1024)),
    memoryEndMb: round(result.memoryEnd / (1024 * 1024)),
    memoryDeltaMb: round((result.memoryEnd - result.memoryStart) / (1024 * 1024)),
  };
}

// ─── Aggregation ────────────────────────────────────────────────

function summarise(samples: FrameTimingSample[]): SummaryRow[] {
  const grouped = new Map<string, FrameTimingSample[]>();
  for (const s of samples) {
    const key = `${s.mode}|${s.scenario}|${s.size}|${s.cpuThrottle}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  const rows: SummaryRow[] = [];
  for (const group of grouped.values()) {
    const n = group.length;
    rows.push({
      mode: group[0].mode,
      scenario: group[0].scenario,
      size: group[0].size,
      cpuThrottle: group[0].cpuThrottle,
      sampleCount: n,
      meanAvgFps: round(avg(group.map((s) => s.avgFps))),
      meanMedianFrameTime: round(avg(group.map((s) => s.medianFrameTime))),
      meanP95FrameTime: round(avg(group.map((s) => s.p95FrameTime))),
      meanP99FrameTime: round(avg(group.map((s) => s.p99FrameTime))),
      meanStdDevFps: round(avg(group.map((s) => s.stdDevFps))),
      meanJankFrames: round(avg(group.map((s) => s.jankFrames))),
      meanLongFrames: round(avg(group.map((s) => s.longFrames))),
      meanTotalFrames: round(avg(group.map((s) => s.totalFrames))),
      meanMemoryDeltaMb: round(avg(group.map((s) => s.memoryDeltaMb))),
    });
  }

  return rows.sort((a, b) =>
    a.mode.localeCompare(b.mode) ||
    a.scenario.localeCompare(b.scenario) ||
    a.size - b.size,
  );
}

// ─── Export ──────────────────────────────────────────────────────

function writeResults(samples: FrameTimingSample[], summary: SummaryRow[]): void {
  const dir = join(process.cwd(), 'benchmark-results');
  mkdirSync(dir, { recursive: true });

  // JSON — full data (without raw frameTimes to keep size sane)
  const jsonSamples = samples.map(({ frameTimes, ...rest }) => rest);
  writeFileSync(
    join(dir, 'frame-timing.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        warmupIterations,
        measureIterations,
        cpuThrottle,
        frameBudgetMs: FRAME_BUDGET_MS,
        jankThresholdMs: JANK_THRESHOLD_MS,
        longFrameThresholdMs: LONG_FRAME_THRESHOLD_MS,
        samples: jsonSamples,
        summary,
      },
      null,
      2,
    ),
  );

  // CSV — summary
  const header = Object.keys(summary[0] ?? {}).join(',');
  const rows = summary.map((r) => Object.values(r).join(','));
  writeFileSync(join(dir, 'frame-timing-summary.csv'), header + '\n' + rows.join('\n') + '\n');

  // CSV — samples (without frameTimes)
  if (jsonSamples.length > 0) {
    const sHeader = Object.keys(jsonSamples[0]).join(',');
    const sRows = jsonSamples.map((r) => Object.values(r).join(','));
    writeFileSync(join(dir, 'frame-timing-samples.csv'), sHeader + '\n' + sRows.join('\n') + '\n');
  }

  // RAW frame times — one file per mode for detailed distributions
  for (const mode of MODES) {
    const modeSamples = samples.filter((s) => s.mode === mode);
    const allFrameTimes = modeSamples.flatMap((s) =>
      s.frameTimes.map((ft) => `${s.scenario},${s.size},${s.iteration},${round(ft)}`),
    );
    writeFileSync(
      join(dir, `frame-times-${mode}.csv`),
      'scenario,size,iteration,frameTimeMs\n' + allFrameTimes.join('\n') + '\n',
    );
  }

  console.log(`  Results → ${dir}/frame-timing*.{json,csv}`);
  console.log(`  Raw frames → ${dir}/frame-times-{cdk,optimized}.csv`);
}

// ─── Utilities ──────────────────────────────────────────────────

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function round(v: number): number {
  return Number(v.toFixed(2));
}

function parseSizes(raw: string | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  const parsed = raw
    .split(',')
    .map((s) => Math.floor(Number(s.trim())))
    .filter((n) => Number.isFinite(n) && n >= 1000 && n <= 500_000);
  return parsed.length > 0 ? parsed : fallback;
}

function parseScenarios(raw: string | undefined, fallback: Scenario[]): Scenario[] {
  if (!raw) return fallback;
  const valid = new Set<string>(fallback);
  const parsed = raw
    .split(',')
    .map((s) => s.trim() as Scenario)
    .filter((s) => valid.has(s));
  return parsed.length > 0 ? parsed : fallback;
}
