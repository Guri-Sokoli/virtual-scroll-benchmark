# Quick Start Guide — V2 Benchmark System

## Prerequisites

- Node.js 20+ and npm
- Chromium installed via Playwright

## One-Time Setup

```powershell
cd V2/virtual-scroll-benchmark
npm install
npx playwright install chromium
```

## Run the Benchmark App (Manual Testing)

```powershell
npm run start:benchmark
# Open http://localhost:4200
# Navigate: /cdk?size=100000 or /optimized?size=100000
```

## Run Benchmarks (Automated)

### Quick Test (2 min) — Verify everything works
```powershell
$env:BENCH_WARMUP="1"; $env:BENCH_ITERATIONS="2"
$env:BENCH_SIZES="10000,50000"; $env:BENCH_SCENARIOS="continuous"
$env:BENCH_CPU_THROTTLE="4"
npx playwright test tools/benchmark/tests/frame-timing.spec.ts
```

### Standard Benchmark (15 min) — Dissertation quality data
```powershell
$env:BENCH_WARMUP="2"; $env:BENCH_ITERATIONS="5"
$env:BENCH_SIZES="10000,50000,100000"
$env:BENCH_SCENARIOS="continuous,variable-speed,direction-change,jump-to-index"
$env:BENCH_CPU_THROTTLE="4"
npx playwright test tools/benchmark/tests/frame-timing.spec.ts
```

### Full Benchmark (25 min) — All 5 scenarios including endurance
```powershell
$env:BENCH_WARMUP="2"; $env:BENCH_ITERATIONS="5"
$env:BENCH_SIZES="10000,50000,100000"
$env:BENCH_SCENARIOS="continuous,variable-speed,direction-change,jump-to-index,endurance"
$env:BENCH_CPU_THROTTLE="4"
npx playwright test tools/benchmark/tests/frame-timing.spec.ts
```

### Render-Time Benchmark (1 min)
```powershell
npx playwright test tools/benchmark/tests/render-time.spec.ts
```

### Classic FPS Benchmark (15 min) — Optional, for backward compatibility
```powershell
npx playwright test tools/benchmark/tests/virtual-scroll.spec.ts
```

## Analyze Results

```powershell
python tools/analysis/analyze_results.py
```

Generates:
- Console summary tables
- `benchmark-results/analysis_report.md`
- Charts (if matplotlib installed): `frame-time-boxplot.png`, `jank-frames-bar.png`, `p95-frame-time-bar.png`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BENCH_WARMUP` | 2 | Warmup iterations (discarded) |
| `BENCH_ITERATIONS` | 5 | Measurement iterations per config |
| `BENCH_SIZES` | 10000,50000,100000 | Comma-separated dataset sizes |
| `BENCH_SCENARIOS` | all 5 | Comma-separated scenario names |
| `BENCH_CPU_THROTTLE` | 4 | CPU throttle factor (1 = no throttle) |

## Output Files

After running benchmarks, check `benchmark-results/`:

| File | Description |
|------|-------------|
| `frame-timing.json` | Full frame-timing data (JSON) |
| `frame-timing-summary.csv` | Aggregated summary |
| `frame-timing-samples.csv` | Per-iteration samples |
| `frame-times-cdk.csv` | Raw frame durations (CDK) |
| `frame-times-optimized.csv` | Raw frame durations (Optimized) |
| `render-time.json` | Render-time data (JSON) |
| `render-time.csv` | Render-time samples |
| `analysis_report.md` | Generated analysis (after running analyzer) |
