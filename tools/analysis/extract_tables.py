"""Extract benchmark data in dissertation table format."""
import json
import statistics
from collections import defaultdict

with open("benchmark-results/frame-timing.json") as f:
    data = json.load(f)

groups = defaultdict(list)
for s in data["samples"]:
    key = (s["mode"], s["size"], s["scenario"])
    groups[key].append(s)

def avg(samples, key):
    return statistics.mean([s[key] for s in samples])

def pct(old, new):
    if old == 0:
        return "—"
    d = (new - old) / old * 100
    return f"{d:+.1f}%"

sizes = [10000, 50000, 100000]
metrics = [
    ("Avg FPS", "avgFps"),
    ("Median Frame (ms)", "medianFrameTime"),
    ("P95 Frame (ms)", "p95FrameTime"),
    ("P99 Frame (ms)", "p99FrameTime"),
    ("FPS Std Dev", "stdDevFps"),
    ("Jank Frames", "jankFrames"),
    ("Long Frames (>33ms)", "longFrames"),
    ("Total Frames", "totalFrames"),
]

# CONTINUOUS SCROLL
print("=== CONTINUOUS SCROLL ===")
for m_name, m_key in metrics:
    row = f"| **{m_name}** |"
    for size in sizes:
        c = groups[("cdk", size, "continuous")]
        o = groups[("optimized", size, "continuous")]
        cv = avg(c, m_key)
        ov = avg(o, m_key)
        delta = pct(cv, ov)
        row += f" {cv:.2f} | {ov:.2f} | {delta} |"
    print(row)

print()

# OTHER SCENARIOS
for scenario in ["variable-speed", "direction-change", "jump-to-index", "endurance"]:
    print(f"=== {scenario.upper()} ===")
    for m_name, m_key in [("Avg FPS", "avgFps"), ("P95 (ms)", "p95FrameTime"), ("Long Frames", "longFrames")]:
        row = f"| {m_name} |"
        for size in sizes:
            c = groups[("cdk", size, scenario)]
            o = groups[("optimized", size, scenario)]
            cv = avg(c, m_key)
            ov = avg(o, m_key)
            row += f" {cv:.2f} | {ov:.2f} |"
        print(row)
    print()

# SUMMARY TABLE
print("=== SUMMARY (continuous) ===")
for m_name, m_key in [("FPS", "avgFps"), ("P95 Frame Time", "p95FrameTime"), ("P99 Frame Time", "p99FrameTime"), ("FPS Std Dev", "stdDevFps"), ("Long Frames", "longFrames")]:
    row = f"| {m_name} |"
    for size in sizes:
        c = groups[("cdk", size, "continuous")]
        o = groups[("optimized", size, "continuous")]
        cv = avg(c, m_key)
        ov = avg(o, m_key)
        delta = pct(cv, ov)
        row += f" {delta} |"
    print(row)
