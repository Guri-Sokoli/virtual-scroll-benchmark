/**
 * Classic FPS Benchmark (virtual-scroll.spec.ts)
 *
 * Measures traditional average FPS and memory during scrolling.
 * Kept for direct comparison with the dissertation's methodology section.
 *
 * NOTE: This is a SECONDARY metric. The frame-timing benchmark is the
 * primary measurement because average FPS is capped by V-Sync on most
 * systems and does not reveal algorithmic differences.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Mode = 'cdk' | 'optimized';
type Scenario = 'continuous' | 'variable-speed' | 'direction-change' | 'jump-to-index' | 'endurance';

interface FpsSample {
  mode: Mode;
  scenario: Scenario;
  size: number;
  iteration: number;
  fps: number;
  droppedFramesEstimate: number;
  renderMs: number;
  memoryStartMb: number;
  memoryEndMb: number;
  memoryDeltaMb: number;
}

interface FpsSummary {
  mode: Mode;
  scenario: Scenario;
  size: number;
  sampleCount: number;
  meanFps: number;
  medianFps: number;
  stdDevFps: number;
  p25Fps: number;
  p75Fps: number;
  minFps: number;
  maxFps: number;
  meanRenderMs: number;
  meanMemoryDeltaMb: number;
  meanDroppedFrames: number;
}

const MODES: Mode[] = ['cdk', 'optimized'];
const DEFAULT_SIZES = [10_000, 50_000, 100_000];
const DEFAULT_SCENARIOS: Scenario[] = [
  'continuous', 'variable-speed', 'direction-change', 'jump-to-index', 'endurance',
];

const warmupIterations = Number(process.env['BENCH_WARMUP'] ?? 2);
const measureIterations = Number(process.env['BENCH_ITERATIONS'] ?? 5);
const datasetSizes = parseSizes(process.env['BENCH_SIZES'], DEFAULT_SIZES);
const scenarios = parseScenarios(process.env['BENCH_SCENARIOS'], DEFAULT_SCENARIOS);

test('collect FPS benchmark results', async ({ page }) => {
  test.setTimeout(1_800_000);

  const samples: FpsSample[] = [];
  const totalConfigs = MODES.length * datasetSizes.length * scenarios.length;
  let completed = 0;
  const t0 = Date.now();

  console.log('\n' + '═'.repeat(72));
  console.log('  CLASSIC FPS BENCHMARK');
  console.log('═'.repeat(72));
  console.log(`  Sizes: ${datasetSizes.join(', ')}`);
  console.log(`  Scenarios: ${scenarios.join(', ')}`);
  console.log(`  Warmup: ${warmupIterations}  |  Measure: ${measureIterations}`);
  console.log('═'.repeat(72) + '\n');

  for (const mode of MODES) {
    for (const size of datasetSizes) {
      for (const scenario of scenarios) {
        completed++;
        const pct = ((completed / totalConfigs) * 100).toFixed(1);
        console.log(`[${pct}%] ${mode.toUpperCase()} | ${size.toLocaleString()} | ${scenario}`);

        for (let w = 0; w < warmupIterations; w++) {
          await runScenario(page, { mode, size, scenario });
        }

        for (let iter = 1; iter <= measureIterations; iter++) {
          const m = await runScenario(page, { mode, size, scenario });
          samples.push({
            mode,
            scenario,
            size,
            iteration: iter,
            fps: round(m.fps),
            droppedFramesEstimate: round(m.droppedFramesEstimate),
            renderMs: round(m.renderMs),
            memoryStartMb: round(m.startMemory / (1024 * 1024)),
            memoryEndMb: round(m.endMemory / (1024 * 1024)),
            memoryDeltaMb: round((m.endMemory - m.startMemory) / (1024 * 1024)),
          });
        }
      }
    }
  }

  console.log('\n' + '═'.repeat(72));
  console.log(`  ✓ Done in ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
  console.log('═'.repeat(72) + '\n');

  const summary = summarise(samples);
  writeResults(samples, summary);
  expect(samples.length).toBeGreaterThan(0);
});

// ─── Scenario runner ────────────────────────────────────────────

async function runScenario(
  page: Page,
  opts: { mode: Mode; size: number; scenario: Scenario },
) {
  // Angular dev-server can occasionally trigger a hot reload during long runs.
  // Retry once on transient execution-context resets.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await runScenarioOnce(page, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transientContextReset =
        message.includes('Execution context was destroyed') ||
        message.includes('most likely because of a navigation');

      if (!transientContextReset || attempt === 2) {
        throw error;
      }

      await page.waitForTimeout(250);
    }
  }

  throw new Error('Unreachable runScenario retry state.');
}

async function runScenarioOnce(
  page: Page,
  opts: { mode: Mode; size: number; scenario: Scenario },
) {
  const query = `size=${opts.size}&itemHeight=32&viewportHeight=560`;
  const navStart = Date.now();
  await page.goto(`/${opts.mode}?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(new RegExp(`/${opts.mode}\\?`));
  await page.waitForSelector(`[data-testid="viewport-${opts.mode}"]`, { state: 'visible' });
  const renderMs = Date.now() - navStart;

  return page.evaluate(
    (p) => {
      return new Promise<{
        fps: number;
        droppedFramesEstimate: number;
        renderMs: number;
        startMemory: number;
        endMemory: number;
      }>((resolve) => {
        const target = document.querySelector<HTMLElement>(
          `[data-testid="viewport-${p.mode}"]`,
        )!;
        const mem = (performance as any).memory;
        const startMemory: number = mem?.usedJSHeapSize ?? 0;
        const durationMs = p.scenario === 'endurance' ? 10_000 : 4_500;
        const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
        const start = performance.now();
        let frameCount = 0;

        const setScroll = (elapsed: number) => {
          switch (p.scenario) {
            case 'continuous':
            case 'endurance':
              target.scrollTop = Math.floor(maxScroll * Math.min(1, elapsed / durationMs));
              break;
            case 'variable-speed': {
              const phase = Math.floor((elapsed / durationMs) * 3);
              target.scrollTop = Math.min(maxScroll, target.scrollTop + [2, 10, 24][phase]);
              break;
            }
            case 'direction-change': {
              const d = Math.floor((elapsed / 400) % 2) === 0 ? 20 : -20;
              target.scrollTop = Math.max(0, Math.min(maxScroll, target.scrollTop + d));
              break;
            }
            case 'jump-to-index': {
              const jumps = [0.1, 0.45, 0.2, 0.8, 0.35, 0.95];
              const idx = Math.min(jumps.length - 1, Math.floor((elapsed / durationMs) * jumps.length));
              target.scrollTop = Math.floor(maxScroll * jumps[idx]);
              break;
            }
          }
        };

        const tick = (ts: number) => {
          const elapsed = ts - start;
          if (elapsed >= durationMs) {
            const endMemory: number = mem?.usedJSHeapSize ?? 0;
            const seconds = Math.max(0.001, elapsed / 1000);
            resolve({
              fps: frameCount / seconds,
              droppedFramesEstimate: Math.max(0, seconds * 60 - frameCount),
              renderMs: p.renderMs,
              startMemory,
              endMemory,
            });
            return;
          }
          frameCount++;
          setScroll(elapsed);
          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      });
    },
    { mode: opts.mode, scenario: opts.scenario, renderMs },
  );
}

// ─── Aggregation ────────────────────────────────────────────────

function summarise(samples: FpsSample[]): FpsSummary[] {
  const groups = new Map<string, FpsSample[]>();
  for (const s of samples) {
    const k = `${s.mode}|${s.scenario}|${s.size}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }

  const rows: FpsSummary[] = [];
  for (const g of groups.values()) {
    const fps = g.map((s) => s.fps).sort((a, b) => a - b);
    const meanFps = avg(fps);
    const variance = avg(fps.map((f) => (f - meanFps) ** 2));

    rows.push({
      mode: g[0].mode,
      scenario: g[0].scenario,
      size: g[0].size,
      sampleCount: g.length,
      meanFps: round(meanFps),
      medianFps: round(fps[Math.floor(fps.length / 2)] ?? 0),
      stdDevFps: round(Math.sqrt(variance)),
      p25Fps: round(fps[Math.floor(fps.length * 0.25)] ?? 0),
      p75Fps: round(fps[Math.floor(fps.length * 0.75)] ?? 0),
      minFps: round(fps[0] ?? 0),
      maxFps: round(fps[fps.length - 1] ?? 0),
      meanRenderMs: round(avg(g.map((s) => s.renderMs))),
      meanMemoryDeltaMb: round(avg(g.map((s) => s.memoryDeltaMb))),
      meanDroppedFrames: round(avg(g.map((s) => s.droppedFramesEstimate))),
    });
  }
  return rows.sort((a, b) => a.mode.localeCompare(b.mode) || a.scenario.localeCompare(b.scenario) || a.size - b.size);
}

// ─── Export ──────────────────────────────────────────────────────

function writeResults(samples: FpsSample[], summary: FpsSummary[]): void {
  const dir = join(process.cwd(), 'benchmark-results');
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, 'fps-benchmark.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), warmupIterations, measureIterations, samples, summary }, null, 2),
  );

  const header = Object.keys(summary[0] ?? {}).join(',');
  const rows = summary.map((r) => Object.values(r).join(','));
  writeFileSync(join(dir, 'fps-summary.csv'), header + '\n' + rows.join('\n') + '\n');

  const sHeader = Object.keys(samples[0] ?? {}).join(',');
  const sRows = samples.map((r) => Object.values(r).join(','));
  writeFileSync(join(dir, 'fps-samples.csv'), sHeader + '\n' + sRows.join('\n') + '\n');
}

// ─── Helpers ────────────────────────────────────────────────────

function avg(n: number[]) { return n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0; }
function round(v: number) { return Number(v.toFixed(2)); }

function parseSizes(raw: string | undefined, fb: number[]): number[] {
  if (!raw) return fb;
  const p = raw.split(',').map((s) => Math.floor(Number(s.trim()))).filter((n) => Number.isFinite(n) && n >= 1000);
  return p.length > 0 ? p : fb;
}
function parseScenarios(raw: string | undefined, fb: Scenario[]): Scenario[] {
  if (!raw) return fb;
  const valid = new Set<string>(fb);
  const p = raw.split(',').map((s) => s.trim() as Scenario).filter((s) => valid.has(s));
  return p.length > 0 ? p : fb;
}
