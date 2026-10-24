# Overlay and adjacent charts: integration evidence

The app consumes the `vendor/ggaction` v0.0.25 source and `vendor/transition`
v0.1.1 source in both browser workers and Node. The submodule commits in this
repository are the reproducible implementation. Registry publication and documentation
deployment are separate release operations.

## Behavior

- Add overlay invokes `createOverlay` once. Line/point overlays follow the source's
  final visible endpoints, including aggregation, bins and stacks. Overlay styling
  remains independently editable. Stacked bars also offer total-series endpoints.
- Target selects All, a chart, or an overlay. All produces one native call with an
  explicit target list; an invalid batch leaves every target unchanged. Data-bound
  operations that cannot share arguments require selecting their chart.
- The four edge `+` controls open adjacent chart choices with X/Y/Color and sharing.
  Left/right default to shared Y; top/bottom default to shared X. Apply invokes
  `createAdjacentPlot`. Shared scales use compatible measurements and union domains;
  plots align using their actual frames. Edit shared scales can release sharing.
- Adjacent data is an independent snapshot. A later source data edit updates its
  linked overlays, not the independently authored neighbor's data.
- Preview and Transition modes, interrupted Canvas transitions, code, history,
  Undo/Redo, saved projects and exports keep the same native action sequence.
- Facets remain source-editable; generated facet cells are not independent targets.
  Shared scales require compatible variables, scale kinds and aggregation semantics.

## Corpus

Pinned chart-datasets commit: `58791ace7212cacb98c2b64e3f92280722ab638e`.
All **1,387 chart families**, **10,174 stage programs** and **1,452 referenced JSON
files** were inspected. Learning unions every accepted stage within each chart ID,
without counting the same family repeatedly. Final panel/data ownership is extracted
statically; the paper co-occurrence score is unchanged. No synthetic frequency is
assigned to new functions absent from the corpus.

Training reports zero skipped families, unknown methods, unresolved dataset owners
and unresolved program structures. `data/corpus-report.json`, `initial-evaluation.json`
and `model-manifest.json` contain exact provenance, evaluation and asset hashes.
Browser and worker loaders reject mixed model generations.

All 10,174 modules were additionally executed against the source dependency. **10,159
materialized valid Canvas extents**. The 15 failures also fail on clean v0.0.24:
`vl_1686` G1–G7 (explicit ticks outside a scale domain), and `vl_1757` G1–G8
(bin extent coverage). They remain in training. This execution check does not claim
pixel verification of every corpus program.

## Reproducible checks

```sh
npm test
npm run test:composition       # running localhost:5173
npm run benchmark:composition
npm run validate:corpus-programs
npm --prefix vendor/ggaction run test:unit
npm --prefix vendor/ggaction run test:coverage
npm --prefix vendor/ggaction run test:realistic
npm --prefix vendor/transition test
npm --prefix vendor/transition run test:browser
```

Browser integration covers Cars bar + line/right, Barley bar + line/left,
Iris scatter + line/bottom and Stocks line + area/top. It applies common appearance
settings to three targets, performs 160 rapid pointer moves across the four sessions,
checks native project restoration, Undo/Redo and reload, and asserts no page errors.
The final screenshots were inspected. This is a targeted integration matrix, not an
exhaustive browser test of every chart-pair/parameter combination.

The repeat-edit benchmark executes 100 atomic edits across two panels plus an overlay,
including worker preparation, lossless program transfer, active-group recommendations
and Canvas scene creation. It excludes DOM paint, IPC and display frame timing.
At steps 1/20/50/100, materialization was 284/119/89/102 ms and scene creation was
17/18/11/12 ms in a contended validation run. Recommendation time was 909/780/851/965 ms.
These samples show no progressive growth in that session; they are not frame-rate targets.

Native source coverage: **95.67% lines, 93.08% branches, 98.69% functions**;
all **175 critical-file floors** passed. The installed-package consumer suite and
built documentation checks passed, including 150 pages, 1,148 machine artifacts and
320/390/768 px browser layouts. The release numerical/resource checks use Node 22;
Node 24 exposes different exact floating-point and resident-memory results in legacy
stress tests. Keep those environment-specific results distinct.

Generated reports, screenshots, runtime logs and local exports stay under ignored
`output/composition-v025/` or the library's ignored artifact directories.
