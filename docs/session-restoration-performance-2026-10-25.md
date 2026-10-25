# Saved-session loading — 2026-10-25

Follow-up to [the startup-transfer work](loading-performance-2026-10-25.md).
This measurement uses an existing chart with 31 history entries, not an empty
application. Baseline app: `e5bb86a`; baseline native source: `acaf50f2`.
Updated native source: `2cf7e4bb`.

The fixture uses the 392 Cars rows with complete Horsepower/Miles_per_Gallon,
color and three facets by Origin, followed by size, opacity and stroke edits.
Headless Chromium 153, 1700 × 1100, localhost; three isolated contexts per mode.
All figures are medians from this machine. The user's browser draft is untouched.

| Time after reload | Baseline Preview | Updated, no checkpoint | Updated, checkpoint | Transition, checkpoint |
| --- | ---: | ---: | ---: | ---: |
| Current chart mounted | 2,935 ms | 1,102 ms | 279 ms | 229 ms |
| First validated card mounted | 3,545 ms | 1,757 ms | 833 ms | 617 ms |
| Five validated cards ready | 4,537 ms | 2,667 ms | 1,920 ms | 1,509 ms |
| Longest main-thread task | 2,754 ms | 1,055 ms | 172 ms | 158 ms |

Readiness means actual native previews and enabled application controls. It does
not include the end of the existing card fade animation or imply zero rendering
cost. The Transition column is an additional check, not a separate matched
before/after comparison. Native preparation of five new candidate charts still
costs time; this change does not promise instantaneous recommendations.

## What was blocking

- Restoring a draft eagerly replayed and centered every history entry in every
  dataset before displaying the active chart. The visible history strip also
  immediately rendered all 31 thumbnails, including those outside its viewport.
- Every reload replayed the current public action chain, even though the saved
  chart had already been fully materialized before the reload.
- Startup waited for the initial-chart model even when restoring an existing
  chart and showing follow-up recommendations. It also built/profiled the active
  dataset twice.
- Streaming five defaults transported their large preview artifacts cumulatively:
  the same first preview appeared in later progress messages. The UI only needs
  to receive each artifact once.
- Native persistent trace updates allocated a new accessor per node and repeatedly
  froze objects with individually defined nonconfigurable properties. A shared
  accessor preserves lazy frozen arrays with fewer allocations.

## Implemented behavior

1. Restore only the active native chart immediately for local drafts. Keep all
   authoring metadata and history positions. Materialize other entries when
   inspected; render visible history thumbnails during idle time, yielding
   between missing prefix actions. File imports retain eager native validation.
2. Cache one completed native chart separately from the portable public-call
   project. Serialize it in the calculation worker after recommendation work,
   using public ggaction persistence and the existing lossless view transfer.
   Reuse that validated snapshot as the worker input after reload, avoiding a
   second main-thread serialization.
3. Bind the cache to the immutable dataset revision, active history position,
   setup/action/guide calls and exact runtime source. A runtime SHA-256 identifies
   uncommitted native builds too. Changed data, another branch, an old build or
   damaged cached data falls back to public-call replay. Cache writes cannot
   attach late results to a newer draft. Pagehide saves of an unchanged chart
   preserve cache identity. Authoritative draft writes do not wait for hashing
   source rows or compiling a cache.
4. Read the draft alongside source metadata; load the initial-chart model only
   when chart selection is requested. Expose already prepared cards as soon as
   the current chart is restored. Later user loading operations retain their
   own loading state.
5. Send each streamed preview once and reconstruct the same ordered response in
   the client. Ranking, alternatives, validation, controls and Apply semantics
   remain unchanged. An unchanged/no-op editor is still represented correctly.

Old drafts use the faster lazy replay on the first visit. After the background
cache finishes, subsequent reloads use the checkpoint. Cache failure never
replaces or removes the public-call draft. Offscreen history remains accessible
through scrolling, hover, Undo/Redo and saved project export.

## Verification

- 42 focused app tests passed: project validation, lazy/eager equivalence,
  immutable/shared history, draft persistence, worker/native state transfer,
  checkpoint replay, model verification, stream ordering and cancellation.
  The final storage refinement passed its 17 affected tests again.
- Both browser modes: three saved-session runs each; identical current Canvas
  pixels before/after checkpoint restore; Undo/Redo; offscreen thumbnail scrolling;
  applying another card; corrupted-cache fallback; no page errors.
- Applying the first streamed card while only one was ready passed, followed by
  a switch to Barley and deferred initial-chart recommendations.
- Fresh dataset picker, explicit example selection, upload/cancel, imported-data
  reload and invalid-draft recovery passed. Saved-chart reloads did not request
  the initial-chart model.
- Native unit suite: 4,409 / 4,410 passed. The existing test `themes Polar guides,
  chart titles, and multiple legend families` fails on a title/theta-axis text
  collision. The same failure was independently reproduced with the original
  `acaf50f2` action implementation; it is not introduced by the trace optimization.

## Reproduce

```sh
npm run dev
node scripts/benchmark-restoration.js
MODE=transition node scripts/benchmark-restoration.js
node scripts/test-dataset-startup-browser.js
node --test test/project.test.js test/project-regression.test.js \
  test/history.test.js test/history-sharing.test.js test/draft-store.test.js \
  test/recommendation-stream.test.js test/performance-reuse.test.js \
  test/program-transfer.test.js test/worker-guide-replay.test.js test/model-bundle.test.js
```

Run timings without other test jobs. Raw observations, CPU profiles and screenshots
remain ignored under `output/loading-deep/` and `output/restoration/`.
