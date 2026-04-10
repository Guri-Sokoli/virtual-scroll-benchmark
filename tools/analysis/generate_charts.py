#!/usr/bin/env python3
"""
Dissertation Chart Generator

Reads V2 benchmark results and produces publication-quality charts
for inclusion in the dissertation. All charts use a consistent
color scheme and are exported at 300 DPI as PNG files.

Usage:
    cd V2/virtual-scroll-benchmark
    pip install matplotlib seaborn pandas numpy
    python tools/analysis/generate_charts.py

Output: benchmark-results/charts/ directory with PNG files.
"""

import json
import csv
import os
import sys
from pathlib import Path
from statistics import mean, median, stdev
from collections import defaultdict

RESULTS_DIR = Path(__file__).resolve().parent.parent.parent / "benchmark-results"
CHARTS_DIR = RESULTS_DIR / "charts-2"

# ─── Colors ──────────────────────────────────────────────────────

CDK_COLOR = "#6366f1"       # Indigo
OPT_COLOR = "#10b981"       # Emerald
CDK_LIGHT = "#c7d2fe"
OPT_LIGHT = "#a7f3d0"
DANGER_COLOR = "#ef4444"
WARNING_COLOR = "#f59e0b"
BG_COLOR = "#fafbfc"
GRID_COLOR = "#e2e8f0"
TEXT_COLOR = "#1e293b"
MUTED_COLOR = "#94a3b8"

# ─── Data Loading ────────────────────────────────────────────────

def load_json(name: str):
    path = RESULTS_DIR / name
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def load_csv_rows(name: str):
    path = RESULTS_DIR / name
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_frame_timing_summary():
    """Load frame-timing summary preferring CSV, with JSON fallback."""
    rows = load_csv_rows("frame-timing-summary.csv")
    if rows:
        numeric_fields = {
            "size", "cpuThrottle", "sampleCount", "meanAvgFps", "meanMedianFrameTime",
            "meanP95FrameTime", "meanP99FrameTime", "meanStdDevFps", "meanJankFrames",
            "meanLongFrames", "meanTotalFrames", "meanMemoryDeltaMb"
        }
        parsed = []
        for r in rows:
            item = dict(r)
            for key in numeric_fields:
                if key in item and item[key] not in (None, ""):
                    item[key] = float(item[key])
            if "size" in item:
                item["size"] = int(item["size"])
            parsed.append(item)
        return parsed

    data = load_json("frame-timing.json") or {}
    return data.get("summary", [])


def safe_higher_is_better(cdk_value: float, opt_value: float) -> float:
    if cdk_value == 0:
        return 0.0
    return (opt_value - cdk_value) / cdk_value * 100


def safe_lower_is_better(cdk_value: float, opt_value: float) -> float:
    if cdk_value == 0:
        if opt_value == 0:
            return 0.0
        return -100.0
    return (cdk_value - opt_value) / cdk_value * 100


def robust_lower_is_better(cdk_value: float, opt_value: float, floor: float = 1.0, cap: float = 100.0) -> float:
    """
    Stable lower-is-better score for near-zero baselines.

    Uses a symmetric denominator so tiny CDK baselines don't explode to
    misleading percentages (e.g. -300% to -1400%).
    """
    denom = max((abs(cdk_value) + abs(opt_value)) / 2.0, floor)
    score = (cdk_value - opt_value) / denom * 100.0
    return max(-cap, min(cap, score))


# ─── Chart Configuration ────────────────────────────────────────

def setup_matplotlib():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as ticker

    plt.rcParams.update({
        "figure.facecolor": BG_COLOR,
        "axes.facecolor": "#ffffff",
        "axes.edgecolor": GRID_COLOR,
        "axes.grid": True,
        "grid.color": GRID_COLOR,
        "grid.alpha": 0.6,
        "grid.linestyle": "--",
        "font.family": "sans-serif",
        "font.sans-serif": ["Inter", "Segoe UI", "Helvetica", "Arial"],
        "font.size": 11,
        "axes.titlesize": 14,
        "axes.titleweight": "bold",
        "axes.labelsize": 12,
        "xtick.labelsize": 10,
        "ytick.labelsize": 10,
        "legend.fontsize": 10,
        "figure.dpi": 150,
        "savefig.dpi": 300,
        "savefig.bbox": "tight",
        "savefig.facecolor": BG_COLOR,
    })
    return plt


# ═══════════════════════════════════════════════════════════════
# CHART 1: FPS Comparison Bar Chart (Continuous Scroll)
# ═══════════════════════════════════════════════════════════════

def chart_fps_comparison(plt):
    summary = load_frame_timing_summary()
    if not summary:
        print("  [skip] frame-timing.json not found")
        return

    # Filter to continuous only
    cdk_rows = [r for r in summary if r["scenario"] == "continuous" and r["mode"] == "cdk"]
    opt_rows = [r for r in summary if r["scenario"] == "continuous" and r["mode"] == "optimized"]

    if not cdk_rows or not opt_rows:
        print("  [skip] No continuous scroll data")
        return

    cdk_by_size = {r["size"]: r for r in cdk_rows}
    opt_by_size = {r["size"]: r for r in opt_rows}
    sizes = sorted(cdk_by_size.keys())

    import numpy as np
    x = np.arange(len(sizes))
    width = 0.35

    fig, ax = plt.subplots(figsize=(10, 6))

    cdk_fps = [cdk_by_size[s]["meanAvgFps"] for s in sizes]
    opt_fps = [opt_by_size[s]["meanAvgFps"] for s in sizes]

    bars1 = ax.bar(x - width/2, cdk_fps, width, label="Angular CDK", color=CDK_COLOR, edgecolor="white", linewidth=0.5, zorder=3)
    bars2 = ax.bar(x + width/2, opt_fps, width, label="Optimized", color=OPT_COLOR, edgecolor="white", linewidth=0.5, zorder=3)

    # Add value labels on bars
    for bar in bars1:
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3,
                f"{bar.get_height():.1f}", ha="center", va="bottom", fontsize=9, fontweight="bold", color=CDK_COLOR)
    for bar in bars2:
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3,
                f"{bar.get_height():.1f}", ha="center", va="bottom", fontsize=9, fontweight="bold", color=OPT_COLOR)

    # 60 FPS reference line
    ax.axhline(y=60, color=MUTED_COLOR, linestyle=":", alpha=0.5, label="60 FPS (V-Sync cap)")

    ax.set_xlabel("Dataset Size (items)")
    ax.set_ylabel("Average FPS")
    ax.set_title("Average FPS — Continuous Scroll (Higher is Better)")
    ax.set_xticks(x)
    ax.set_xticklabels([f"{s:,}" for s in sizes])
    ax.legend(loc="lower left")
    ax.set_ylim(0, 65)

    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "01_fps_comparison.png"))
    plt.close(fig)
    print("  ✓ 01_fps_comparison.png")


# ═══════════════════════════════════════════════════════════════
# CHART 2: P95 / P99 Frame Time Comparison
# ═══════════════════════════════════════════════════════════════

def chart_frame_time_percentiles(plt):
    summary = load_frame_timing_summary()
    if not summary:
        return

    cdk_rows = {r["size"]: r for r in summary if r["scenario"] == "continuous" and r["mode"] == "cdk"}
    opt_rows = {r["size"]: r for r in summary if r["scenario"] == "continuous" and r["mode"] == "optimized"}
    sizes = sorted(cdk_rows.keys())

    if not sizes:
        return

    import numpy as np

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6), sharey=True)

    x = np.arange(len(sizes))
    width = 0.35

    # P95
    cdk_p95 = [cdk_rows[s]["meanP95FrameTime"] for s in sizes]
    opt_p95 = [opt_rows[s]["meanP95FrameTime"] for s in sizes]

    bars1 = ax1.bar(x - width/2, cdk_p95, width, label="CDK", color=CDK_COLOR, edgecolor="white", zorder=3)
    bars2 = ax1.bar(x + width/2, opt_p95, width, label="Optimized", color=OPT_COLOR, edgecolor="white", zorder=3)
    ax1.axhline(y=16.67, color=DANGER_COLOR, linestyle="--", alpha=0.7, label="16.67ms (60 FPS)")
    ax1.axhline(y=33.33, color=WARNING_COLOR, linestyle="--", alpha=0.5, label="33.33ms (30 FPS)")

    for bar in bars1:
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3,
                f"{bar.get_height():.1f}", ha="center", va="bottom", fontsize=8, color=CDK_COLOR)
    for bar in bars2:
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3,
                f"{bar.get_height():.1f}", ha="center", va="bottom", fontsize=8, color=OPT_COLOR)

    ax1.set_xlabel("Dataset Size")
    ax1.set_ylabel("Frame Time (ms)")
    ax1.set_title("P95 Frame Time (Lower is Better)")
    ax1.set_xticks(x)
    ax1.set_xticklabels([f"{s:,}" for s in sizes])
    ax1.legend(fontsize=8)

    # P99
    cdk_p99 = [cdk_rows[s]["meanP99FrameTime"] for s in sizes]
    opt_p99 = [opt_rows[s]["meanP99FrameTime"] for s in sizes]

    ax2.bar(x - width/2, cdk_p99, width, label="CDK", color=CDK_COLOR, edgecolor="white", zorder=3)
    ax2.bar(x + width/2, opt_p99, width, label="Optimized", color=OPT_COLOR, edgecolor="white", zorder=3)
    ax2.axhline(y=16.67, color=DANGER_COLOR, linestyle="--", alpha=0.7, label="16.67ms (60 FPS)")
    ax2.axhline(y=33.33, color=WARNING_COLOR, linestyle="--", alpha=0.5, label="33.33ms (30 FPS)")

    for i, s in enumerate(sizes):
        ax2.text(i - width/2, cdk_p99[i] + 0.3, f"{cdk_p99[i]:.1f}", ha="center", va="bottom", fontsize=8, color=CDK_COLOR)
        ax2.text(i + width/2, opt_p99[i] + 0.3, f"{opt_p99[i]:.1f}", ha="center", va="bottom", fontsize=8, color=OPT_COLOR)

    ax2.set_xlabel("Dataset Size")
    ax2.set_title("P99 Frame Time (Lower is Better)")
    ax2.set_xticks(x)
    ax2.set_xticklabels([f"{s:,}" for s in sizes])
    ax2.legend(fontsize=8)

    fig.suptitle("Frame Time Percentiles — Continuous Scroll", fontsize=16, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "02_frame_time_percentiles.png"))
    plt.close(fig)
    print("  ✓ 02_frame_time_percentiles.png")


# ═══════════════════════════════════════════════════════════════
# CHART 3: Frame Time Distribution (Box Plot)
# ═══════════════════════════════════════════════════════════════

def chart_frame_time_distribution(plt):
    cdk_rows = load_csv_rows("frame-times-cdk.csv")
    opt_rows = load_csv_rows("frame-times-optimized.csv")

    if not cdk_rows or not opt_rows:
        print("  [skip] frame-times CSV not found")
        return

    import pandas as pd
    import seaborn as sns

    cdk_df = pd.DataFrame(cdk_rows)
    cdk_df["mode"] = "CDK"
    cdk_df["frameTimeMs"] = pd.to_numeric(cdk_df["frameTimeMs"])
    cdk_df["size"] = pd.to_numeric(cdk_df["size"])

    opt_df = pd.DataFrame(opt_rows)
    opt_df["mode"] = "Optimized"
    opt_df["frameTimeMs"] = pd.to_numeric(opt_df["frameTimeMs"])
    opt_df["size"] = pd.to_numeric(opt_df["size"])

    df = pd.concat([cdk_df, opt_df])
    # Filter to continuous only (primary scenario)
    df = df[df["scenario"] == "continuous"]
    if df.empty:
        print("  [skip] No continuous frame-time distribution data")
        return

    size_order = sorted(df["size"].unique().tolist())

    fig, ax = plt.subplots(figsize=(12, 7))

    palette = {"CDK": CDK_COLOR, "Optimized": OPT_COLOR}
    sns.boxplot(
        data=df, x="size", y="frameTimeMs", hue="mode",
        ax=ax, palette=palette, showfliers=False,
        linewidth=1.2, width=0.6, order=size_order
    )

    y99 = float(df["frameTimeMs"].quantile(0.99))
    y_top = max(20.0, min(40.0, y99 * 1.15))
    ax.set_ylim(0, y_top)

    ax.axhline(y=16.67, color=DANGER_COLOR, linestyle="--", alpha=0.7, linewidth=1.5, label="16.67ms (60 FPS target)")
    if y_top > 33.33:
        ax.axhline(y=33.33, color=WARNING_COLOR, linestyle="--", alpha=0.5, linewidth=1, label="33.33ms (30 FPS)")

    ax.set_xlabel("Dataset Size (items)")
    ax.set_ylabel("Frame Time (ms)")
    ax.set_title("Frame Time Distribution — Continuous Scroll\n(Lower and Tighter is Better)")
    ax.legend(loc="upper left")

    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "03_frame_time_boxplot.png"))
    plt.close(fig)
    print("  ✓ 03_frame_time_boxplot.png")


# ═══════════════════════════════════════════════════════════════
# CHART 4: Long Frames (>33ms) Comparison
# ═══════════════════════════════════════════════════════════════

def chart_long_frames(plt):
    data = load_json("frame-timing.json")
    summary = load_frame_timing_summary()
    if not summary:
        return

    cdk_rows = {r["size"]: r for r in summary if r["scenario"] == "continuous" and r["mode"] == "cdk"}
    opt_rows = {r["size"]: r for r in summary if r["scenario"] == "continuous" and r["mode"] == "optimized"}
    sizes = sorted(cdk_rows.keys())

    if not sizes:
        return

    import numpy as np

    fig, ax = plt.subplots(figsize=(10, 6))

    x = np.arange(len(sizes))
    width = 0.35

    cdk_long = [cdk_rows[s]["meanLongFrames"] for s in sizes]
    opt_long = [opt_rows[s]["meanLongFrames"] for s in sizes]

    bars1 = ax.bar(x - width/2, cdk_long, width, label="CDK", color=CDK_COLOR, edgecolor="white", zorder=3)
    bars2 = ax.bar(x + width/2, opt_long, width, label="Optimized", color=OPT_COLOR, edgecolor="white", zorder=3)

    for bar in bars1:
        v = bar.get_height()
        if v > 0:
            ax.text(bar.get_x() + bar.get_width()/2, v + 0.15,
                    f"{v:.1f}", ha="center", va="bottom", fontsize=10, fontweight="bold", color=CDK_COLOR)
    for bar in bars2:
        v = bar.get_height()
        ax.text(bar.get_x() + bar.get_width()/2, max(v, 0) + 0.15,
                f"{v:.1f}", ha="center", va="bottom", fontsize=10, fontweight="bold", color=OPT_COLOR)

    ax.set_xlabel("Dataset Size (items)")
    long_threshold = 33.33
    if data and isinstance(data.get("longFrameThresholdMs"), (int, float)):
        long_threshold = float(data["longFrameThresholdMs"])

    ax.set_ylabel(f"Long Frames (>{long_threshold:.0f}ms) per Run")
    ax.set_title(f"Long Frame Count — Continuous Scroll\n(Lower is Better — Frames >{long_threshold:.0f}ms)")
    ax.set_xticks(x)
    ax.set_xticklabels([f"{s:,}" for s in sizes])
    ax.legend()

    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "04_long_frames.png"))
    plt.close(fig)
    print("  ✓ 04_long_frames.png")


# ═══════════════════════════════════════════════════════════════
# CHART 5: FPS Consistency (Std Dev)
# ═══════════════════════════════════════════════════════════════

def chart_fps_consistency(plt):
    summary = load_frame_timing_summary()
    if not summary:
        return

    cdk_rows = {r["size"]: r for r in summary if r["scenario"] == "continuous" and r["mode"] == "cdk"}
    opt_rows = {r["size"]: r for r in summary if r["scenario"] == "continuous" and r["mode"] == "optimized"}
    sizes = sorted(cdk_rows.keys())

    if not sizes:
        return

    import numpy as np

    fig, ax = plt.subplots(figsize=(10, 6))

    x = np.arange(len(sizes))
    width = 0.35

    cdk_std = [cdk_rows[s]["meanStdDevFps"] for s in sizes]
    opt_std = [opt_rows[s]["meanStdDevFps"] for s in sizes]

    bars1 = ax.bar(x - width/2, cdk_std, width, label="CDK", color=CDK_COLOR, edgecolor="white", zorder=3)
    bars2 = ax.bar(x + width/2, opt_std, width, label="Optimized", color=OPT_COLOR, edgecolor="white", zorder=3)

    for bar in bars1:
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.1,
                f"{bar.get_height():.2f}", ha="center", va="bottom", fontsize=9, fontweight="bold", color=CDK_COLOR)
    for bar in bars2:
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.1,
                f"{bar.get_height():.2f}", ha="center", va="bottom", fontsize=9, fontweight="bold", color=OPT_COLOR)

    ax.set_xlabel("Dataset Size (items)")
    ax.set_ylabel("FPS Standard Deviation")
    ax.set_title("FPS Consistency — Continuous Scroll\n(Lower Std Dev = More Consistent/Smoother)")
    ax.set_xticks(x)
    ax.set_xticklabels([f"{s:,}" for s in sizes])
    ax.legend()

    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "05_fps_consistency.png"))
    plt.close(fig)
    print("  ✓ 05_fps_consistency.png")


# ═══════════════════════════════════════════════════════════════
# CHART 6: Render Time Comparison
# ═══════════════════════════════════════════════════════════════

def chart_render_time(plt):
    data = load_json("render-time.json")
    if not data:
        print("  [skip] render-time.json not found")
        return

    samples = data.get("samples", [])
    if not samples:
        return

    import numpy as np

    # Group by size and mode
    grouped = defaultdict(lambda: defaultdict(list))
    for s in samples:
        # Use firstRowAppearMs as the primary render-time metric
        t = s.get("firstRowAppearMs") or s.get("totalMs") or 0
        grouped[s["size"]][s["mode"]].append(t)

    sizes = sorted(grouped.keys())

    fig, ax = plt.subplots(figsize=(10, 6))

    x = np.arange(len(sizes))
    width = 0.35

    cdk_means = [mean(grouped[s].get("cdk", [0])) for s in sizes]
    opt_means = [mean(grouped[s].get("optimized", [0])) for s in sizes]
    cdk_stds = [stdev(grouped[s]["cdk"]) if len(grouped[s].get("cdk", [])) > 1 else 0 for s in sizes]
    opt_stds = [stdev(grouped[s]["optimized"]) if len(grouped[s].get("optimized", [])) > 1 else 0 for s in sizes]

    bars1 = ax.bar(x - width/2, cdk_means, width, yerr=cdk_stds, capsize=4,
                   label="CDK", color=CDK_COLOR, edgecolor="white", zorder=3, error_kw={"elinewidth": 1.5})
    bars2 = ax.bar(x + width/2, opt_means, width, yerr=opt_stds, capsize=4,
                   label="Optimized", color=OPT_COLOR, edgecolor="white", zorder=3, error_kw={"elinewidth": 1.5})

    for bar in bars1:
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 3,
                f"{bar.get_height():.0f}ms", ha="center", va="bottom", fontsize=9, fontweight="bold", color=CDK_COLOR)
    for bar in bars2:
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 3,
                f"{bar.get_height():.0f}ms", ha="center", va="bottom", fontsize=9, fontweight="bold", color=OPT_COLOR)

    ax.set_xlabel("Dataset Size (items)")
    ax.set_ylabel("Time to First Row (ms)")
    ax.set_title("Initial Render Time — Time to First Visible Row\n(Lower is Better)")
    ax.set_xticks(x)
    ax.set_xticklabels([f"{s:,}" for s in sizes])
    ax.legend()

    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "06_render_time.png"))
    plt.close(fig)
    print("  ✓ 06_render_time.png")


# ═══════════════════════════════════════════════════════════════
# CHART 7: Scenario Comparison Heatmap
# ═══════════════════════════════════════════════════════════════

def chart_scenario_heatmap(plt):
    summary = load_frame_timing_summary()
    if not summary:
        return

    import pandas as pd
    import numpy as np
    import seaborn as sns

    # Build smoothness matrix: scenario × size → weighted smoothness improvement %
    # Weighted toward tail-latency (P99), then long frames and consistency.
    rows = []
    for r in summary:
        if r["mode"] == "cdk":
            # Find matching optimized row
            opt = next((o for o in summary if o["mode"] == "optimized"
                       and o["scenario"] == r["scenario"] and o["size"] == r["size"]), None)
            if opt and r["meanAvgFps"] > 0:
                p99_delta = safe_lower_is_better(r["meanP99FrameTime"], opt["meanP99FrameTime"])
                long_delta = robust_lower_is_better(r["meanLongFrames"], opt["meanLongFrames"], floor=0.5, cap=100.0)
                std_delta = robust_lower_is_better(r["meanStdDevFps"], opt["meanStdDevFps"], floor=1.0, cap=100.0)
                smoothness_delta = 0.5 * p99_delta + 0.3 * long_delta + 0.2 * std_delta
                rows.append({
                    "Scenario": r["scenario"].replace("-", " ").title(),
                    "Size": f"{r['size']:,}",
                    "Smoothness Δ%": round(smoothness_delta, 1),
                })

    if not rows:
        return

    df = pd.DataFrame(rows)

    # Pivot for heatmap
    pivot_smooth = df.pivot(index="Scenario", columns="Size", values="Smoothness Δ%")

    fig, ax = plt.subplots(figsize=(10, 6))
    sns.heatmap(
        pivot_smooth, annot=True, fmt=".1f", center=0,
        cmap="RdYlGn", linewidths=2, linecolor="white",
        ax=ax, cbar_kws={"label": "Smoothness Improvement (%)"},
        annot_kws={"fontsize": 12, "fontweight": "bold"}
    )

    ax.set_title("Smoothness Improvement Score: Optimized vs CDK (%)\n(Weighted P99 + Robust Long Frames + Robust Consistency)")
    ax.set_ylabel("")
    ax.set_xlabel("Dataset Size")

    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "07_scenario_heatmap.png"))
    plt.close(fig)
    print("  ✓ 07_scenario_heatmap.png")


# ═══════════════════════════════════════════════════════════════
# CHART 8: Improvement Summary (Grouped Bar)
# ═══════════════════════════════════════════════════════════════

def chart_improvement_summary(plt):
    summary = load_frame_timing_summary()
    if not summary:
        return

    paired = []
    for r in summary:
        if r["mode"] != "cdk":
            continue
        opt = next((o for o in summary if o["mode"] == "optimized"
                    and o["scenario"] == r["scenario"] and o["size"] == r["size"]), None)
        if opt:
            paired.append((r, opt))

    if not paired:
        return

    import numpy as np

    metrics = [
        (
            "FPS\n(↑ better)",
            mean([safe_higher_is_better(cdk["meanAvgFps"], opt["meanAvgFps"]) for cdk, opt in paired]),
        ),
        (
            "P95 Frame\n(↓ better)",
            mean([safe_lower_is_better(cdk["meanP95FrameTime"], opt["meanP95FrameTime"]) for cdk, opt in paired]),
        ),
        (
            "P99 Frame\n(↓ better)",
            mean([safe_lower_is_better(cdk["meanP99FrameTime"], opt["meanP99FrameTime"]) for cdk, opt in paired]),
        ),
        (
            "FPS Std Dev\n(↓ better)",
            mean([robust_lower_is_better(cdk["meanStdDevFps"], opt["meanStdDevFps"], floor=1.0, cap=100.0) for cdk, opt in paired]),
        ),
        (
            "Long Frames\n(↓ better)",
            mean([robust_lower_is_better(cdk["meanLongFrames"], opt["meanLongFrames"], floor=0.5, cap=100.0) for cdk, opt in paired]),
        ),
    ]

    labels = [m[0] for m in metrics]
    values = [m[1] for m in metrics]
    colors = [OPT_COLOR if v > 0 else DANGER_COLOR for v in values]

    fig, ax = plt.subplots(figsize=(12, 6))
    x = np.arange(len(labels))
    bars = ax.bar(x, values, color=colors, edgecolor="white", linewidth=0.5, zorder=3, width=0.6)

    for i, (bar, val) in enumerate(zip(bars, values)):
        ax.text(bar.get_x() + bar.get_width()/2,
                bar.get_height() + (1 if val > 0 else -3),
                f"{'+' if val > 0 else ''}{val:.1f}%",
                ha="center", va="bottom" if val > 0 else "top",
                fontsize=12, fontweight="bold", color=colors[i])

    ax.axhline(y=0, color=TEXT_COLOR, linewidth=0.8)
    ax.set_xlabel("")
    ax.set_ylabel("Improvement (%)")

    ax.set_title(f"Optimized vs CDK — Key Metric Improvements\n(Aggregated Across {len(paired)} Scenario-Size Configurations)")
    ax.set_xticks(x)
    ax.set_xticklabels(labels)

    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "08_improvement_summary.png"))
    plt.close(fig)
    print("  ✓ 08_improvement_summary.png")


# ═══════════════════════════════════════════════════════════════
# CHART 9: Frame Time CDF (Cumulative Distribution)
# ═══════════════════════════════════════════════════════════════

def chart_frame_time_cdf(plt):
    cdk_rows = load_csv_rows("frame-times-cdk.csv")
    opt_rows = load_csv_rows("frame-times-optimized.csv")

    if not cdk_rows or not opt_rows:
        return

    import numpy as np

    # Filter to continuous + largest size
    cdk_continuous = [float(r["frameTimeMs"]) for r in cdk_rows if r["scenario"] == "continuous"]
    opt_continuous = [float(r["frameTimeMs"]) for r in opt_rows if r["scenario"] == "continuous"]

    if not cdk_continuous or not opt_continuous:
        return

    # Use largest size
    sizes_cdk = set(int(r["size"]) for r in cdk_rows if r["scenario"] == "continuous")
    big_size = max(sizes_cdk) if sizes_cdk else 100000

    cdk_times = sorted(float(r["frameTimeMs"]) for r in cdk_rows
                       if r["scenario"] == "continuous" and int(r["size"]) == big_size)
    opt_times = sorted(float(r["frameTimeMs"]) for r in opt_rows
                       if r["scenario"] == "continuous" and int(r["size"]) == big_size)

    if not cdk_times or not opt_times:
        return

    fig, ax = plt.subplots(figsize=(10, 6))

    # CDF
    cdk_y = np.arange(1, len(cdk_times) + 1) / len(cdk_times) * 100
    opt_y = np.arange(1, len(opt_times) + 1) / len(opt_times) * 100

    ax.plot(cdk_times, cdk_y, color=CDK_COLOR, linewidth=2, label=f"CDK ({big_size:,} items)")
    ax.plot(opt_times, opt_y, color=OPT_COLOR, linewidth=2, label=f"Optimized ({big_size:,} items)")

    ax.axvline(x=16.67, color=DANGER_COLOR, linestyle="--", alpha=0.7, label="16.67ms (60 FPS)")
    ax.axvline(x=33.33, color=WARNING_COLOR, linestyle="--", alpha=0.5, label="33.33ms (30 FPS)")

    ax.set_xlabel("Frame Time (ms)")
    ax.set_ylabel("Cumulative % of Frames")
    ax.set_title(f"Frame Time CDF — Continuous Scroll ({big_size:,} items)\n(Curve Further Left = Better)")
    ax.legend(loc="lower right")
    ax.set_xlim(0, max(cdk_times[-1], opt_times[-1]) * 1.05)
    ax.set_ylim(0, 101)

    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "09_frame_time_cdf.png"))
    plt.close(fig)
    print("  ✓ 09_frame_time_cdf.png")


# ═══════════════════════════════════════════════════════════════
# CHART 10: Multi-Scenario FPS Radar
# ═══════════════════════════════════════════════════════════════

def chart_scenario_radar(plt):
    data = load_json("frame-timing.json")
    if not data:
        return

    summary = data.get("summary", [])
    import numpy as np

    # Use the largest size
    sizes = sorted(set(r["size"] for r in summary))
    if not sizes:
        return
    big = sizes[-1]

    scenarios = sorted(set(r["scenario"] for r in summary))
    cdk_fps = []
    opt_fps = []
    labels = []

    for sc in scenarios:
        cdk_r = next((r for r in summary if r["scenario"] == sc and r["size"] == big and r["mode"] == "cdk"), None)
        opt_r = next((r for r in summary if r["scenario"] == sc and r["size"] == big and r["mode"] == "optimized"), None)
        if cdk_r and opt_r:
            labels.append(sc.replace("-", "\n").title())
            cdk_fps.append(cdk_r["meanAvgFps"])
            opt_fps.append(opt_r["meanAvgFps"])

    if len(labels) < 3:
        return

    N = len(labels)
    angles = np.linspace(0, 2 * np.pi, N, endpoint=False).tolist()
    angles += angles[:1]
    cdk_fps += cdk_fps[:1]
    opt_fps += opt_fps[:1]

    fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))

    ax.plot(angles, cdk_fps, 'o-', linewidth=2, color=CDK_COLOR, label="CDK", markersize=6)
    ax.fill(angles, cdk_fps, alpha=0.15, color=CDK_COLOR)
    ax.plot(angles, opt_fps, 's-', linewidth=2, color=OPT_COLOR, label="Optimized", markersize=6)
    ax.fill(angles, opt_fps, alpha=0.15, color=OPT_COLOR)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(labels, fontsize=10)
    ax.set_title(f"FPS by Scenario ({big:,} items)\n(Outer = Better)", pad=20)
    ax.legend(loc="upper right", bbox_to_anchor=(1.3, 1.1))

    fig.tight_layout()
    fig.savefig(str(CHARTS_DIR / "10_scenario_radar.png"))
    plt.close(fig)
    print("  ✓ 10_scenario_radar.png")


# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════

def main():
    print("\n" + "=" * 60)
    print("  DISSERTATION CHART GENERATOR")
    print("=" * 60)

    if not RESULTS_DIR.exists():
        print(f"\n  ERROR: Results dir not found: {RESULTS_DIR}")
        print("  Run benchmarks first.")
        sys.exit(1)

    CHARTS_DIR.mkdir(exist_ok=True)

    try:
        plt = setup_matplotlib()
    except ImportError:
        print("\n  ERROR: matplotlib not installed.")
        print("  pip install matplotlib seaborn pandas numpy")
        sys.exit(1)

    try:
        import seaborn
    except ImportError:
        print("  WARNING: seaborn not installed — some charts may fail")
        print("  pip install seaborn")

    chart_fps_comparison(plt)
    chart_frame_time_percentiles(plt)
    chart_frame_time_distribution(plt)
    chart_long_frames(plt)
    chart_fps_consistency(plt)
    chart_render_time(plt)
    chart_scenario_heatmap(plt)
    chart_improvement_summary(plt)
    chart_frame_time_cdf(plt)
    chart_scenario_radar(plt)

    print(f"\n  All charts saved to: {CHARTS_DIR}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
