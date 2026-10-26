# Performance engineering

See the [October 27 audit](performance-hardening-2026-10-27.md) for measured
findings, verification scope, and remaining limits.

Performance is part of correctness: a preview must stay responsive without losing
rows, available actions, parameters, history branches, saved revisions, or consented
research events. Optimizations reuse equivalent work or schedule derived work away
from input handling. They do not silently change chart semantics or fidelity.

## Regression gates

Run `npm run test:performance` for deterministic work, ownership, and replay checks.
The separate **Performance regression checks** GitHub workflow runs on `main` and
pull requests. It also exercises the browser and uploads measurements for 14 days.
It has no deployment credentials and never publishes a release.

The checks intentionally distinguish two kinds of evidence:

- **Blocking checks:** exact state/replay/pixel equivalence, cache invalidation,
  bounded retained resources, unique-object visit counts, and avoiding complete
  history scans during cursor changes. These should hold on a slow CI runner too.
- **Diagnostic measurements:** elapsed milliseconds, frame intervals, long tasks,
  and storage bytes. Review the uploaded results for the changed workload. A single
  fixed frame-rate threshold is not a reliable cross-machine regression test.

| Path | Invariant |
| --- | --- |
| Dataset profiling | Reuse summaries only for privately owned immutable datasets; caller changes and type overrides remain isolated. |
| Candidate generation | A requested group avoids unrelated inspections; its actions, alternatives, parameters, and ranking match the full ranking filtered to that group. |
| Graph History | Cursor movement does not read/rebuild the complete tree; viewport queries retain crossing edges and paint order. |
| Linear History | Pointer hit testing is logarithmic; retain at most 80 non-visible/visible thumbnail rasters unless the current visible set itself exceeds the cap. Evicted rasters regenerate exactly. |
| Code preview | Unchanged committed calls receive no DOM mutations on parameter hover. A folded panel retains current copy/export source while deferring its DOM update. |
| Typography input | Background refresh preserves the scoped typed draft; successful/failed commits settle to canonical values. Enter/blur cannot submit twice, and queued size steps retain their order. |
| Native Preview | Revisited immutable endpoints reuse exact pixels at the same density, viewport, zoom, and font epoch. Each preview host retains at most six images and eight million pixels; mutable callers and inline text masks bypass reuse. |
| Persistence | Compare shared calls once per comparison; retain every revision, exact delta replay, and account isolation. Thumbnail completion cannot overwrite a newer pending revision. |
| Saved-project thumbnails | Replay only the selected entry in the thumbnail worker; cancel invisible/disposed requests. Keep the existing full-resolution PNG dimensions and byte limit. |
| Native rendering | Cached immutable defaults/signatures preserve validation and output. Mutable caller inputs are never treated as stable merely because their top-level identity is unchanged. |

Existing checks also cover superseded worker jobs, Canvas endpoint caches,
lossless worker updates, restored history, dense transitions, and consent boundaries.

## Reproduce a measurement

Use the pinned Node version from `.nvmrc`, record the app and submodule commits,
and keep the same dataset, browser, viewport, display density, mode, and action
sequence. Run timing comparisons in separate otherwise idle processes. A CPU
profile changes timing; use it to locate work, then measure again without it.

```sh
npm ci
npm run build
npm run test:performance
mkdir -p output/performance-hardening
node scripts/benchmark-data-profiling.js > output/performance-hardening/profiling.json
node scripts/benchmark-persistence.js > output/performance-hardening/persistence.json
node scripts/benchmark-operation-workflows.js > output/performance-hardening/workflows.json
npm run benchmark:session
```

The operation benchmark covers 71 chart/action combinations and records exact
output fingerprints alongside time spent preparing, materializing, and restoring
native programs. The session benchmark exercises 41 successive facet edits and
compares complete replay with incremental state transfer. Neither measures DOM,
browser input latency, or painting; do not present their totals as frame rates.

For browser checks, install the [documented Playwright environments](development.md#browser-tests-without-cloud-credentials),
start a development server, and run:

```sh
PORT=5184 npm run dev
# In another terminal:
python test/browser/code-performance.py --url http://127.0.0.1:5184
python test/browser/history-performance.py --url http://127.0.0.1:5184
python test/browser/history-scaling.py --url http://127.0.0.1:5184
python test/browser/gallery-thumbnail-performance.py --url http://127.0.0.1:5184
python test/browser/preview-raster-cache.py --url http://127.0.0.1:5184
python test/browser/typography-click-queue.py
APP_URL=http://127.0.0.1:5184 npm run test:performance-browser
```

The real UI workflow uses an isolated account transport and synthetic/public data.
It covers a 41-step dense scatterplot, facets, Bike Sharing parallel coordinates,
beeswarm/box layers, and adjacent charts. Both view modes, rapid hover, later option
pages, Apply, Undo/Redo, and folded code are exercised. No real account or research
record is written. `PERF_CPU_RATE=4` adds Chromium CPU throttling;
`PERF_CASES=scatter,parallel` narrows a diagnostic run. Use the complete default
matrix before integrating a shared interaction change.

## Rules for future changes

1. Profile a real authoring sequence before changing the implementation. Separate
   cold preparation, warmed hover, worker transfer, native paint, and persistence.
2. Prefer immutable identity reuse and explicit invalidation. Keep caches bounded
   by retained work/pixels as well as entry count; release backing canvases.
3. Do not schedule native replay, PNG compression, or full-history serialization
   in a pointer handler. Derived background work may be superseded; committed
   actions and durable revisions may not be dropped.
4. Keep comparisons observable. Verify exact output, error rejection, defaults,
   empty/missing data, composition, restored history, and mutable external inputs.
5. Add a regression for the cause, not just a faster local stopwatch result.
   Examples include getter-read counts, unchanged DOM mutation counts, and the
   number/size of retained canvases or outbox entries.
6. Keep raw traces, screenshots, and benchmark exports under ignored `output/`.
   Commit small reusable workloads and a concise account of scope and limitations.

Native computation for a new dense chart can still exceed a display frame.
Structural graph changes still require layout, and cold historical states can
require replay. Worker execution, progressive cards, bounded caches, and exact
prepared endpoints keep that work separate from ordinary ready-state interaction;
they are not a guarantee of instantaneous arbitrary computation.
