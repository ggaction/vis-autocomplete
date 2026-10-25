# Dense hover previews and facet legends — 2026-10-25

## Reproduction

Use **Daily bike sharing** (731 observations). Select `temp`, `hum`, `atemp`,
`windspeed`, and `casual`; create parallel coordinates with opacity 0.55 and a
439.6 × 314 plot. Facet by `yr`, two columns, plot spacing, gap 33, axes per cell,
and no existing legend. Hover **Encode color**, then compare `season`, `temp`,
and `hum`. The reported program is reproduced by:

```sh
node scripts/benchmark-dense-hover.js
```

The benchmark also prepares opacity changes for 5,000 points and 5,000 line
vertices. It measures worker computation and structured cloning separately;
it does not use machine-dependent timing thresholds as correctness tests.

## Causes and corrections

- Adding the first color mapping after faceting generated legends in every
  cell. Their collisions triggered repeated full facet rebuilds in the gap
  search. Give a newly introduced, shared encoding one parent legend through
  the existing public `editFacetGuides` call, before generating guides.
- Parent legend intent lives in `guideConfigs`, while the default guide code
  only checked semantic unit guides. It therefore requested those same scales
  again. Both owners now count as existing guides. Existing per-cell legends,
  independent scale policies and suppressed channels retain their treatment.
- Ready thumbnails did not carry their transition endpoints. Hover requested
  another worker job, which could wait behind the next recommendation. The
  prepared artifact now carries its exact Canvas scene. A ready scene bypasses
  the worker queue, including an older in-flight scene request; the existing
  generation checks still reject stale results.
- Per-cell legend selection previously combined matching graphic suffixes
  across the entire facet. Targets now use each concrete, namespaced cell
  legend. Their edits route to the native facet source, with local coordinates
  and owner deduplication for multi-selection.
- Parallel coordinates draw one path per observation. They must not inherit
  the ordinary line/area rule that requires a constant appearance per series.
  Numeric color, opacity and width fields are now available for these paths.

No data rows or vertices are removed. Preview, Apply and saved-code replay
use the same public action sequence.

## Measurements

On this Mac, Node v23.5.0, without CPU profiling or parallel tests:

| Workload | New parameter: prepare + scene | Structured clone | Cached preparation |
| --- | ---: | ---: | ---: |
| 731 parallel paths, two facets, color | 225–263ms | 6–7ms | 0.05–0.16ms |
| 5,000 points, opacity | 154–304ms | 17–30ms | 0.05–0.16ms |
| 5,000 line vertices, opacity | 149–174ms | 3–5ms | 0.05–0.07ms |

Before the fix, the reported facet's preparation typically took 2–4 seconds;
profiling identified the repeated gap search as the dominant cost. With the
fix, the gap remains 33 and the shared legend appears only once.

An isolated headless Chrome session at 1800 × 1200, DPR 1, Transition mode
measured ready-card hover to transition start: **60ms first hover**, then
**20–22ms** over twelve repeated hovers. Frame interval median was 16.7ms,
95th percentile 16.8ms, maximum 50.1ms. These are local measurements of ready
cards; newly requested, uncached parameters still require worker preparation.

## Verification

- 710 tests passed, zero failed test processes; production build passed.
- Categorical and continuous color after scatter/parallel faceting: one legend,
  unchanged gap, no gap-repair prerequisites, exact public-call replay.
- Rapid field hover, final-choice settlement, Apply and Undo/Redo in the browser.
- Intentionally retained per-cell legends: separate bounds, corner resizing,
  Undo and Preview mode checked in the browser; no page errors.
- Source-owner resize/move/remove/text edits and multi-selection deduplication
  covered by regression tests.
- Cached scenes bypass a deliberately blocked worker in the regression test;
  the artifact scene equals the separately requested native scene.

Local screenshots, raw timings and CPU profiles are in `output/dense-hover/`
and excluded from Git. This change does not create a release tag or deployment.
