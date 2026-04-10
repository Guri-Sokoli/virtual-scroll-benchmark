# V2 Documentation Index

This folder contains the organized markdown sources for the V2 virtual scroll benchmark and dissertation workflow.

## Folder map

- `docs/dissertation/inputs/`
  - `DISSERTATION_PROMPT.md`: master prompt with complete benchmark narrative and dissertation generation constraints.
  - `DISSERTATION_GUIDANCE.md`: chapter-level writing guidance and methodology framing.
  - `DISSERTATION_FINAL_RESULTS.md`: frozen benchmark claims and release checklist.
- `docs/dissertation/deliverables/`
  - Final generated dissertation drafts and submission-ready markdown outputs.
- `docs/benchmarks/`
  - `BENCHMARK_RESULTS.md`: supplementary benchmark summaries and tabular references.
- `docs/architecture/`
  - `V2_ARCHITECTURE.md`: system architecture and data-flow technical documentation.
- `docs/project/`
  - `QUICK_START.md`: practical setup and execution guide.

## Source-of-truth priority for claims

1. `docs/dissertation/inputs/DISSERTATION_FINAL_RESULTS.md`
2. `benchmark-results/frame-timing.json` and `benchmark-results/frame-timing-summary.csv`
3. `benchmark-results/render-time.json` and `benchmark-results/render-time.csv`
4. `docs/dissertation/inputs/DISSERTATION_PROMPT.md`
5. Supporting narrative docs (`docs/benchmarks/*`, `docs/architecture/*`)

## Notes

- Scope is intentionally V2-only.
- Benchmark chart assets are in `benchmark-results/charts/`.
- Keep quantitative claims aligned with frozen artifacts before publishing updates.
