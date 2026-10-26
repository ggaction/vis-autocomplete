# Performance hardening — October 27, 2026

This audit addressed repeated work during recommendations, chart previews, history
navigation, code preview, autosave, and saved-project thumbnail repair. It preserves
the available actions, chart data, visual output, history branches, saved revisions,
and research collection behavior. No release or production deployment accompanies
these changes.

## Findings and changes

| Path | Cause | Change |
| --- | --- | --- |
| Recommendations | Repeated profiles of the same immutable dataset; generation of unrelated action groups; redundant statistical sorting. | Cache compact profiles by native dataset identity and type hints; scope expensive candidate families to the requested group; reuse sorted numeric work. |
| Native rendering and fitting | Repeated validation of common stroke styles, whole-scene hashing when no resource namespace is needed, repeated immutable fitting signatures, and duplicate empty blend-isolation scans. | Reuse validated defaults, compute namespaces only when needed, reuse identity-stable signature work, and carry completed isolation preparation into drawing. |
| History | Cursor changes copied whole trees and active paths; viewport scans visited every node; linear thumbnails accumulated. | Separate structure, branch, and cursor changes; index viewport queries; bound linear thumbnail rasters and regenerate evicted images on demand. |
| Code preview | Every hover queried and rewrote unchanged committed calls. | Reuse parsed committed code and unchanged DOM nodes; defer folded-panel DOM updates while retaining the latest copy/export text. |
| Preview rendering | Returning to an already prepared dense preview replayed every native drawing operation. | Retain exact endpoint pixels per host, with density/viewport/font invalidation and a six-image/eight-million-pixel bound. |
| Autosave | Shared historical call prefixes were repeatedly serialized; small edits replaced large array records in deltas; project lookups read all queued revision bodies. | Memoize comparisons within one operation, produce smaller exact deltas, use scoped IndexedDB queries and validated pending-job pointers. |
| Gallery repair | Opening saved projects could replay old charts and compress PNGs on the foreground thread. | Restore only the selected snapshot and generate its PNG in the existing thumbnail worker; cancel work when its item becomes invisible. |

Cross-review also found and fixed a multi-tab recovery race: a queued job can be
reassigned to a recovered project while another tab holds its previous pointer.
The shortcut now verifies the job's project identity before trusting it. Atomic
thumbnail and conflict updates prevent derived images from overwriting newer work.

A final retention check exposed a second boundary condition: when more than 80
linear thumbnails were simultaneously visible, they evicted and repainted each
other indefinitely. Visible images are now protected; the cache returns to 80
when the viewport shrinks. The 100-visible-tile fixture changed from 31 idle
repaints in 500 ms to zero, with every visible image retained.

Full editor regression checks also exposed a compact-layout hit-testing bug: a
neighboring legend body intercepted a visible resize handle. Removing the
whole-legend stacking context lets individual handles stay reachable while keeping
title/item selection above the body. The browser test now asserts the actual hit
target before dragging, in both view modes and at two viewport sizes.

Slow-run verification also caught a typography race: starting background work
could replace a typed size with the previous size, or disabling the input could
submit an unfinished draft through a native blur/change event. Explicit scoped
draft ownership now preserves input through refreshes and settles it after commit,
failure, cancellation, or scope changes. Eight deterministic browser cases cover
this behavior together with queued size increments and boundary clamping.

Deletion checks uncovered two related hazards: enabled workspace controls could
silently ignore clicks while authoring was busy, and a late thumbnail could start
another save while deletion was in flight. Visible controls now reflect the busy
state. A project-specific fence serializes deletion with same-client saves, waits
for existing save RPCs, and cancels obsolete queued writes only after successful
deletion. Failure preserves pending edits and leaves subsequent operations usable.

## Measurements

The comparison baseline is app `967d819` with ggaction `7cbdaea`. The optimized
native dependency is `4b372276`. Component measurements were recorded on macOS
arm64 with Node 23.5 and Chromium through Playwright 1.64.1. CI uses the Node
version pinned in `.nvmrc`. These local milliseconds are diagnostic, not universal
latency promises; deterministic work counts and exact results are regression gates.

| Workload | Before | After |
| --- | ---: | ---: |
| Fresh Encoding ranking, 5,000 rows / 13 fields, median of five paired samples | 140.3 ms | 94.6 ms |
| Fresh Transform ranking, same dataset | 138.8 ms | 58.4 ms |
| Fresh Style ranking, same dataset | 227.7 ms | 100.4 ms |
| Graph cursor update, 10,000 nodes, median | 7.1 ms | 0.2 ms |
| 40 code previews over 1,001 unchanged calls: descendant queries | 80,320 | 120 |
| Same code previews: mutations to unchanged calls | 40,040 | 0 |
| Revision delta construction, 400 history entries, median | 124.76 ms | 4.30 ms |
| Same revision: serialized delta size | 10,459,468 bytes | 52,234 bytes |
| Duplicate snapshot comparison, same history, median | 21.37 ms | 3.51 ms |
| Dense faceted parallel-coordinate preview revisit, DPR2: native strokes | 1,557 | 0 |

The Preview fixture compares an uncached immutable native render with its cached
equivalent: approximately 86.4 ms versus 0.1–0.2 ms at DPR2, excluding compositing.
Both produce byte-identical decoded PNG pixels. The initial render still performs
native drawing. The cache does not substitute a lower-resolution image.

Gallery repair tested 1,800-row scatter, faceted parallel coordinates, and bar
charts. Foreground restore/render previously occupied approximately 141/297/50 ms.
The worker run recorded a maximum frame interval of 16.8 ms with no frame over
50 ms. Its PNGs match the existing OffscreenCanvas worker output pixel for pixel.
This measures foreground availability, not a reduction of all computation time.

## Verification and continuing protection

- All 71 operation-workflow output fingerprints match the baseline exactly.
- All 15 paired group-ranking fingerprints match, including order and parameters.
- Native ggaction unit suite: 4,635 passing tests.
- Complete app suite: 920 tests passed across 155 isolated processes before the
  final three deletion regressions, which also pass; focused performance checks
  cover 100 tests. Production build and contributor-document
  checks also pass.
- Work-count checks cover immutable ownership, mutated external inputs, type
  overrides, exact delta replay, all queued revisions, account isolation, and
  cross-tab recovery.
- Browser fixtures cover 10,000-node history navigation, bounded thumbnail
  retention and regeneration, stable code DOM, folded copy/export, worker
  cancellation, and exact Preview pixels at DPR1 and DPR2. Resize, zoom, late fonts,
  inline text masking, and mutable graphics are tested separately.
- Real authoring workflows cover dense scatter with 41 steps, facets, Bike Sharing
  parallel coordinates, beeswarm/box layers, and adjacent charts, using both
  Preview and Transition. They exercise rapid hover, later option pages, Apply,
  Undo/Redo, and code folding with an isolated account transport.
- The scatter and parallel-coordinate workflows also pass with Chromium's CPU
  throttled by a factor of four. Dense transitions and cold previews still produce
  long tasks in that diagnostic run; this is not a claim of 60 fps on slow devices.

The [performance engineering guide](performance.md) documents reproducible commands,
ownership/invalidation rules, and the distinction between work budgets and timing
diagnostics. The **Performance regression checks** workflow runs on pushes to
`main` and pull requests, checks exact behavior and bounded work, and retains
benchmark artifacts for 14 days. It cannot deploy the app.

Raw local evidence is intentionally untracked under `output/performance-hardening/`:
`group-scoping.json`, `history-browser-{before,after}.json`,
`code-{before,after}.json`, `persistence-{baseline,after}.json`,
`preview-raster-cache.json`, `gallery-thumbnail-worker.json`, and the complete
test/build/browser logs. Reusable fixtures and benchmark scripts are tracked.

## Remaining limits

A new dense chart or a previously unvisited historical state can still require
substantial computation. Structural history edits still require graph layout.
Complete cloud snapshots still require transport serialization; smaller revision
deltas do not eliminate that cost. Browsers without Worker/OffscreenCanvas keep
the existing synchronous gallery fallback. The changes avoid repeated work and
bound retained resources; they do not claim arbitrary workloads always complete
inside one display frame.
