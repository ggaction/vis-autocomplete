# Operation and rendering performance — 2026-10-25

This pass optimizes shared calculation, transfer, validation and drawing paths.
It retains source rows, marks, recommendation choices, public action calls,
history, export behavior and parameter validation. It does not claim that every
new calculation on arbitrarily large data completes within one display frame.

## Changes

- **Immutable copying:** native object snapshots avoid an intermediate mapped
  entries array and its pairs. Special own properties, sparse arrays, caller
  isolation, and rejection of cycles/functions keep their previous semantics.
- **Parallel-coordinate geometry:** positional scales map a complete column at
  once. Appearance edits reuse coordinates when the owned row set, dimensions,
  resolved scales, bounds, key and missing-value policy are identical. Each
  weakly held row set retains at most four geometry configurations.
- **Native validation and bounds:** successfully validated owned path commands,
  typed concrete properties and path bounds are reused. Mutable caller inputs
  are still checked on every call; bounds returned to callers cannot modify the
  cached value. The caches do not retain complete historical programs.
- **Stable scene identity:** immutable row identity hashes survive across
  revisions. SVG namespace hashing uses two exact 32-bit lanes instead of
  per-character BigInt arithmetic, retaining the same UTF-16/FNV output.
- **Worker updates:** same-path identity/equality is tested before constructing
  a complete baseline object index. Cross-path discovery is deferred to new
  dataset/composition branches. Newly restored nodes are owned bottom-up without
  copying their already owned descendants a second time.
- **Immediate Canvas transitions:** setting an endpoint with zero duration
  paints it directly, without constructing correspondence maps, interpolators
  or exit nodes. This also covers reduced motion and explicit immediate sets.
- **Prepared endpoint drawing:** exact-resolution bitmaps reuse finalized scenes
  when returning to a prepared option or Current. Animation frames continue
  through the native renderer. The cache retains at most six entries and eight
  million pixels (about 32 MB of RGBA pixel storage, excluding browser overhead).
  Display density changes invalidate the entry; eviction releases its backing
  canvas. There is no downsampling of data or reuse of stretched old pixels.
- **Resize invalidation:** repeated identical Canvas requests retain their paint
  state. Batches of invalidated thumbnails yield between complete paints after
  a 6 ms scheduling budget. A single native paint is not interruptible; this
  budget is not a promise that every individual chart renders in 6 ms.

## Prepared hover measurements

Headless Chromium on this Mac, 1200 × 800, DPR 1. The fixture contains 5,000
points / 5,022 scene nodes and five fully prepared options. Three rounds of 30
hover switches were measured for each condition. The table reports the median
of the three round-level percentiles. The baseline loads the original native
and transition sources and draws endpoints without the new bitmap cache.

| CPU condition | Synchronous hover work p95, before → after | Frame interval p95, before → after |
| --- | ---: | ---: |
| Normal | 14.2 → 1.8 ms | 16.7 → 16.7 ms |
| 4× CPU slowdown | 51.7 → 5.1 ms | 66.7 → 16.7 ms |

These are prepared, warmed endpoint measurements, not first-time option
calculation or end-to-end input latency. The five-entry working set retained
2,497,500 pixels. Cached and native output had **zero pixel differences** at
multiple endpoints, including after resizing the host. Dense charts retain
the existing complete-endpoint transition policy; ordinary charts retain
geometry interpolation.

## New-operation calculation measurements

`scripts/benchmark-operation-workflows.js` exercises the actual calculation
service: prepare the preview and scene, materialize the action and worker
updates, then restore both authoring and guided programs. Node v23.5.0,
three independent runs per chart family, 1,200 rows (200 for beeswarm).

There are **71 chart/action cases** across eight families, including encodings,
color scales, axes, grid, title, legend, resizing, facets, regression, adjacent
charts, derived overlays and native layers. For each case, take each stage's
median over the three runs and add them. The table is the median of those
per-case totals within each family; it excludes browser IPC, DOM and paint.

| Family | Before | After |
| --- | ---: | ---: |
| Scatter | 62.9 ms | 53.9 ms |
| Line | 54.2 ms | 46.2 ms |
| Bar | 25.4 ms | 21.3 ms |
| Area | 85.6 ms | 70.9 ms |
| Box | 31.3 ms | 24.1 ms |
| Beeswarm | 24.6 ms | 21.6 ms |
| Parallel coordinates | 159.7 ms | 116.4 ms |
| Pie | 20.2 ms | 15.0 ms |

The sum of all 71 per-case totals fell from 4,681.7 to 3,958.3 ms (15.5%).
All 71 SHA-256 fingerprints match the baseline exactly, covering the complete
prepared artifact, authoring semantics/graphics/trace and guided graphics/trace.
This verifies representative operations through the shared paths, rather than
claiming a separate benchmark of every public action and parameter combination.

First-time dense operations still require native computation. Bitmap reuse
helps only after preparation and one paint at the required density. Heavy new
facets, aggregations and large datasets can therefore still exceed a frame;
worker execution keeps that work away from input handling.

The separate Cars facet session benchmark applies 41 successive edits and
requests the style page every five edits. Across its nine sampled steps,
the median combined calculation time fell from 174.2 to 157.2 ms. After the
initial 273.9 ms sample, the updated run stayed between 148.2 and 159.5 ms
through step 40; it did not grow with history in this run. Authoring and guided
state remained exactly equal to full replay. These single-run session samples
are diagnostic evidence, not a guarantee against garbage-collection outliers
or other workloads.

## Functional verification

- Complete application suite: **737 tests passed**, zero failed test processes.
- Native library: **4,588 unit tests**, **15 affected contracts**, **15 package /
  renderer contracts**, and **157 documentation tests** passed. Package budgets
  passed without raising the limits. This is not a claim that the entire native
  contract suite was run.
- Transition package: unit and browser suites passed, including rapid retargets,
  clipping, resize, display density, rendering errors and reduced motion.
- Existing app Canvas fixture: **16 chart families / 960 interruptions**, with
  exact final pixels. Scatter, line, box, violin, donut, heatmap, gradient,
  parallel, bar, area, radar, rose and facet cases include multiple datasets.
- Actual option-card UI: 30 rapid hovers each in a 41-step / 1,500-point scatter
  session, a three-panel scatter facet, a complete 731-row Bike Sharing parallel
  facet, and a shared-scale adjacent composition. Both modes, Apply, Undo and
  Redo passed; pointer resizing also passed for the first three cases. Hover did
  not add history steps. No page errors were recorded.
- Production asset build passed. No release tag or deployment was created.

Two existing parameter tests still expected flat controls after the earlier
grouped On/Off UI change. Their failures reproduced with baseline sources.
They now inspect the actual groups; axis coverage also probes nested controls.

## Reproduce

```sh
npm test
npm run build
node scripts/benchmark-operation-workflows.js > output/workflow-timings.json
node scripts/benchmark-session.js
python test/browser/realtime-performance.py --url http://127.0.0.1:5205
```

Browser tests require Playwright and its Chromium installation. The performance
fixture does not require a login. Without `--baseline-sources`, it compares the
current native renderer with and without endpoint caching. The recorded full
before/after run additionally routes a JSON map of module URLs to original source
strings through `--baseline-sources`; this also includes the native/transition
optimizations in the comparison.

`test/browser/realtime-workflows.py --cdp http://127.0.0.1:9333` uses an isolated
authenticated mock session created with `newSession` from
`scripts/audit-browser-session-2026-10-25.mjs`. Start Chromium with that debugging
port, initialize the mock session, then attach the test. It imports generated
local projects and exercises the real UI without writing to a real account.

Baseline: app `e703d36f`, ggaction `52740d04`, transition `1693936a`.
Updated libraries: ggaction `d2b0fcd8`, transition `84c605d8`.
Raw timings, profiles and screenshots are under the ignored
`output/realtime-optimization/` directory. Library commits were pushed before
the application's updated source pins.
