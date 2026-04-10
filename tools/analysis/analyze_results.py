#!/usr/bin/env python3
"""
Benchmark Results Analyzer

Reads the benchmark JSON/CSV output and produces:
1. Summary statistics table (console + markdown)
2. Comparison of CDK vs Optimized across all metrics
3. Bar charts, box plots, and distribution histograms (if matplotlib available)
4. Markdown report suitable for dissertation appendix

Usage:
    python tools/analysis/analyze_results.py
"""

import json
import csv
import os
import sys
from pathlib import Path
from statistics import mean, median, stdev
from typing import Any

RESULTS_DIR = Path(__file__).resolve().parent.parent.parent / "benchmark-results"

# ───────────────────────────────────────────────────────────────
# Data Loading
# ───────────────────────────────────────────────────────────────

def load_json(name: str) -> dict | None:
    path = RESULTS_DIR / name
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def load_csv_rows(name: str) -> list[dict]:
    path = RESULTS_DIR / name
    if not path.exists():
        return []
    with open(path) as f:
        return list(csv.DictReader(f))


# ───────────────────────────────────────────────────────────────
# Frame-Timing Analysis (Primary Metric)
# ───────────────────────────────────────────────────────────────

def analyze_frame_timing():
    data = load_json("frame-timing.json")
    if not data:
        print("  [skip] frame-timing.json not found")
        return None

    summary = data.get("summary", [])
    if not summary:
        print("  [skip] No summary data in frame-timing.json")
        return None

    cpu_throttle = data.get("cpuThrottle", "?")
    print(f"\n{'═' * 80}")
    print(f"  FRAME-TIMING ANALYSIS  (CPU throttle: {cpu_throttle}×)")
    print(f"{'═' * 80}\n")

    # Group by scenario+size for CDK vs Optimized comparison
    comparisons = []
    grouped: dict[str, dict[str, Any]] = {}

    for row in summary:
        key = f"{row['scenario']}|{row['size']}"
        if key not in grouped:
            grouped[key] = {}
        grouped[key][row["mode"]] = row

    print(f"  {'Scenario':<20} {'Size':>8}  {'Metric':<18} {'CDK':>10} {'Opt':>10} {'Δ%':>8}")
    print(f"  {'─' * 20} {'─' * 8}  {'─' * 18} {'─' * 10} {'─' * 10} {'─' * 8}")

    for key, modes in sorted(grouped.items()):
        cdk = modes.get("cdk")
        opt = modes.get("optimized")
        if not cdk or not opt:
            continue

        scenario, size = key.split("|")

        metrics = [
            ("Avg FPS",           cdk["meanAvgFps"],           opt["meanAvgFps"]),
            ("Median Frame (ms)", cdk["meanMedianFrameTime"],  opt["meanMedianFrameTime"]),
            ("P95 Frame (ms)",    cdk["meanP95FrameTime"],     opt["meanP95FrameTime"]),
            ("P99 Frame (ms)",    cdk["meanP99FrameTime"],     opt["meanP99FrameTime"]),
            ("FPS Std Dev",       cdk["meanStdDevFps"],        opt["meanStdDevFps"]),
            ("Jank Frames",       cdk["meanJankFrames"],       opt["meanJankFrames"]),
            ("Long Frames",       cdk["meanLongFrames"],       opt["meanLongFrames"]),
            ("Memory Δ (MB)",     cdk["meanMemoryDeltaMb"],    opt["meanMemoryDeltaMb"]),
        ]

        first = True
        for label, cdk_val, opt_val in metrics:
            # For frame times and jank: LOWER is better → positive Δ% means improvement
            # For FPS: HIGHER is better
            if "FPS" in label and "Std" not in label:
                delta = ((opt_val - cdk_val) / cdk_val * 100) if cdk_val else 0
            else:
                delta = ((cdk_val - opt_val) / cdk_val * 100) if cdk_val else 0

            comparisons.append({
                "scenario": scenario,
                "size": int(size),
                "metric": label,
                "cdk": cdk_val,
                "optimized": opt_val,
                "delta_pct": round(delta, 1),
            })

            prefix = f"  {scenario:<20} {int(size):>8}" if first else f"  {'':<20} {'':>8}"
            sign = "+" if delta > 0 else ""
            print(f"{prefix}  {label:<18} {cdk_val:>10.2f} {opt_val:>10.2f} {sign}{delta:>7.1f}%")
            first = False
        print()

    return comparisons


# ───────────────────────────────────────────────────────────────
# FPS Benchmark Analysis
# ───────────────────────────────────────────────────────────────

def analyze_fps():
    data = load_json("fps-benchmark.json")
    if not data:
        print("  [skip] fps-benchmark.json not found")
        return None

    summary = data.get("summary", [])
    if not summary:
        return None

    print(f"\n{'═' * 80}")
    print(f"  CLASSIC FPS ANALYSIS")
    print(f"{'═' * 80}\n")

    grouped: dict[str, dict] = {}
    for row in summary:
        key = f"{row['scenario']}|{row['size']}"
        if key not in grouped:
            grouped[key] = {}
        grouped[key][row["mode"]] = row

    print(f"  {'Scenario':<20} {'Size':>8}  {'CDK FPS':>10} {'Opt FPS':>10} {'Δ%':>8}  {'CDK σ':>8} {'Opt σ':>8} {'σ Δ%':>8}")
    print(f"  {'─' * 20} {'─' * 8}  {'─' * 10} {'─' * 10} {'─' * 8}  {'─' * 8} {'─' * 8} {'─' * 8}")

    for key, modes in sorted(grouped.items()):
        cdk = modes.get("cdk")
        opt = modes.get("optimized")
        if not cdk or not opt:
            continue

        scenario, size = key.split("|")
        fps_delta = ((opt["meanFps"] - cdk["meanFps"]) / cdk["meanFps"] * 100) if cdk["meanFps"] else 0
        std_delta = ((cdk["stdDevFps"] - opt["stdDevFps"]) / cdk["stdDevFps"] * 100) if cdk["stdDevFps"] else 0

        print(
            f"  {scenario:<20} {int(size):>8}  "
            f"{cdk['meanFps']:>10.2f} {opt['meanFps']:>10.2f} {'+' if fps_delta > 0 else ''}{fps_delta:>7.1f}%  "
            f"{cdk['stdDevFps']:>8.2f} {opt['stdDevFps']:>8.2f} {'+' if std_delta > 0 else ''}{std_delta:>7.1f}%"
        )

    return summary


# ───────────────────────────────────────────────────────────────
# Render-Time Analysis
# ───────────────────────────────────────────────────────────────

def analyze_render_time():
    data = load_json("render-time.json")
    if not data:
        print("  [skip] render-time.json not found")
        return None

    samples = data.get("samples", [])
    if not samples:
        return None

    print(f"\n{'═' * 80}")
    print(f"  RENDER-TIME ANALYSIS")
    print(f"{'═' * 80}\n")

    sizes = sorted(set(s["size"] for s in samples))

    print(f"  {'Size':>10}  {'CDK (ms)':>10} {'Opt (ms)':>10} {'Δ%':>8}")
    print(f"  {'─' * 10}  {'─' * 10} {'─' * 10} {'─' * 8}")

    for size in sizes:
        cdk_times = [s["totalMs"] for s in samples if s["mode"] == "cdk" and s["size"] == size]
        opt_times = [s["totalMs"] for s in samples if s["mode"] == "optimized" and s["size"] == size]
        if not cdk_times or not opt_times:
            continue

        cdk_avg = mean(cdk_times)
        opt_avg = mean(opt_times)
        delta = ((cdk_avg - opt_avg) / cdk_avg * 100) if cdk_avg else 0
        print(f"  {size:>10,}  {cdk_avg:>10.1f} {opt_avg:>10.1f} {'+' if delta > 0 else ''}{delta:>7.1f}%")

    return samples


# ───────────────────────────────────────────────────────────────
# Markdown Report
# ───────────────────────────────────────────────────────────────

def write_markdown_report(ft_comparisons, fps_summary, rt_samples):
    lines = ["# Benchmark Analysis Report\n"]
    lines.append(f"Generated by `analyze_results.py`\n")

    if ft_comparisons:
        lines.append("## Frame-Timing Results (Primary Metric)\n")
        lines.append("| Scenario | Size | Metric | CDK | Optimized | Δ% |")
        lines.append("|----------|------|--------|-----|-----------|-----|")
        for c in ft_comparisons:
            sign = "+" if c["delta_pct"] > 0 else ""
            lines.append(
                f"| {c['scenario']} | {c['size']:,} | {c['metric']} "
                f"| {c['cdk']:.2f} | {c['optimized']:.2f} | {sign}{c['delta_pct']}% |"
            )
        lines.append("")

    if fps_summary:
        lines.append("## Classic FPS Results\n")
        lines.append("| Mode | Scenario | Size | Mean FPS | Std Dev | Memory Δ (MB) |")
        lines.append("|------|----------|------|----------|---------|---------------|")
        for r in fps_summary:
            lines.append(
                f"| {r['mode']} | {r['scenario']} | {r['size']:,} "
                f"| {r['meanFps']:.2f} | {r['stdDevFps']:.2f} | {r['meanMemoryDeltaMb']:.2f} |"
            )
        lines.append("")

    if rt_samples:
        lines.append("## Render-Time Results\n")
        lines.append("| Mode | Size | Iteration | Total (ms) |")
        lines.append("|------|------|-----------|------------|")
        for s in rt_samples:
            lines.append(f"| {s['mode']} | {s['size']:,} | {s['iteration']} | {s['totalMs']:.1f} |")
        lines.append("")

    report_path = RESULTS_DIR / "analysis_report.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n  Report → {report_path}")


# ───────────────────────────────────────────────────────────────
# Charts (optional — requires matplotlib + seaborn)
# ───────────────────────────────────────────────────────────────

def generate_charts():
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import seaborn as sns
    except ImportError:
        print("  [skip] matplotlib/seaborn not installed — no charts generated")
        print("         pip install matplotlib seaborn")
        return

    sns.set_theme(style="whitegrid")

    # ── Frame-time distribution box plot ──
    for mode_label, filename in [("cdk", "frame-times-cdk.csv"), ("optimized", "frame-times-optimized.csv")]:
        rows = load_csv_rows(filename)
        if not rows:
            continue

    # Load both for comparison
    cdk_rows = load_csv_rows("frame-times-cdk.csv")
    opt_rows = load_csv_rows("frame-times-optimized.csv")

    if cdk_rows and opt_rows:
        import pandas as pd

        cdk_df = pd.DataFrame(cdk_rows)
        cdk_df["mode"] = "CDK"
        cdk_df["frameTimeMs"] = pd.to_numeric(cdk_df["frameTimeMs"])
        cdk_df["size"] = pd.to_numeric(cdk_df["size"])

        opt_df = pd.DataFrame(opt_rows)
        opt_df["mode"] = "Optimized"
        opt_df["frameTimeMs"] = pd.to_numeric(opt_df["frameTimeMs"])
        opt_df["size"] = pd.to_numeric(opt_df["size"])

        df = pd.concat([cdk_df, opt_df])

        # Box plot: frame times by size and mode
        fig, ax = plt.subplots(figsize=(12, 6))
        sns.boxplot(data=df, x="size", y="frameTimeMs", hue="mode", ax=ax, showfliers=False)
        ax.axhline(y=16.67, color="red", linestyle="--", alpha=0.7, label="16.67ms (60 FPS target)")
        ax.set_title("Frame Time Distribution: CDK vs Optimized")
        ax.set_xlabel("Dataset Size")
        ax.set_ylabel("Frame Time (ms)")
        ax.legend()
        fig.tight_layout()
        fig.savefig(str(RESULTS_DIR / "frame-time-boxplot.png"), dpi=300)
        plt.close(fig)
        print(f"  Chart → frame-time-boxplot.png")

        # Bar chart: jank frames by scenario
        ft_data = load_json("frame-timing.json")
        if ft_data and ft_data.get("summary"):
            summary_df = pd.DataFrame(ft_data["summary"])
            fig, ax = plt.subplots(figsize=(12, 6))
            sns.barplot(data=summary_df, x="scenario", y="meanJankFrames", hue="mode", ax=ax)
            ax.set_title("Mean Jank Frames (>16.67ms) per Scenario")
            ax.set_xlabel("Scenario")
            ax.set_ylabel("Jank Frame Count")
            fig.tight_layout()
            fig.savefig(str(RESULTS_DIR / "jank-frames-bar.png"), dpi=300)
            plt.close(fig)
            print(f"  Chart → jank-frames-bar.png")

            # P95 frame time comparison
            fig, ax = plt.subplots(figsize=(12, 6))
            sns.barplot(data=summary_df, x="scenario", y="meanP95FrameTime", hue="mode", ax=ax)
            ax.axhline(y=16.67, color="red", linestyle="--", alpha=0.7, label="16.67ms target")
            ax.set_title("P95 Frame Time: CDK vs Optimized")
            ax.set_xlabel("Scenario")
            ax.set_ylabel("P95 Frame Time (ms)")
            ax.legend()
            fig.tight_layout()
            fig.savefig(str(RESULTS_DIR / "p95-frame-time-bar.png"), dpi=300)
            plt.close(fig)
            print(f"  Chart → p95-frame-time-bar.png")


# ───────────────────────────────────────────────────────────────
# Main
# ───────────────────────────────────────────────────────────────

def main():
    print("\n" + "=" * 80)
    print("  BENCHMARK ANALYSIS")
    print("=" * 80)

    if not RESULTS_DIR.exists():
        print(f"\n  ERROR: Results directory not found: {RESULTS_DIR}")
        print("  Run benchmarks first: npm run benchmark:frame-timing")
        sys.exit(1)

    ft_comparisons = analyze_frame_timing()
    fps_summary = analyze_fps()
    rt_samples = analyze_render_time()

    write_markdown_report(ft_comparisons, fps_summary, rt_samples)
    generate_charts()

    print("\n" + "=" * 80)
    print("  ANALYSIS COMPLETE")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
