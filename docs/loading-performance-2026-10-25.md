# Loading performance — 2026-10-25

Measured against parent baseline `49f757f` using the same native ggaction source.
Browser: headless Chromium 153, 1700×1100, localhost, three isolated contexts per run.
Browser values below are medians, not hardware-independent guarantees. Tests never
read or replace the user's existing browser draft.

| Measurement | Before | After |
| --- | ---: | ---: |
| Fresh visit until dataset picker ready | 559 ms | 246 ms |
| Reload until dataset picker ready | 560 ms | 177 ms |
| Main-page resource requests at readiness | 858 | 9 |
| Fresh main-page resource transfer | 23.43 MB | 2.83 MB |
| Reload main-page resource transfer | 23.43 MB | 0.0032 MB |
| Initial recommendation CPU, 50,000 rows / 3 fields | 5,144 ms | 2,108 ms |

Resource Timing includes worker entry scripts but excludes fetches made inside
workers; the table is not a whole-process network total. The large-table CPU
comparison alternated old/new implementations three times in one Node process,
with the same model and rows. Every method, score and default value matched.

## Causes and changes

1. The unbundled browser graph fetched 858 resources. 133 native source modules
   appeared under both `node_modules/ggaction` and `vendor/ggaction` URLs. Bundle
   the app and workers with canonical source resolution, minification and source
   maps; watch and rebuild on source changes during development.
2. The server sent all resources with `no-store`. Gzip large text assets, retain
   bounded revision-keyed buffers and revalidate browser caches with ETags. Check
   file revisions on every request. Keep manifests uncached and preserve model
   SHA-256/generation validation, including retries during a corpus update.
3. Startup fetched and interpreted every example before restoring the active
   project. Load an example only when selected, share in-flight imports, preserve
   schema overrides and retry failed imports. Save only loaded dataset records.
   Existing projects still retain all of their original datasets and sessions.
4. Asynchronous initial recommendations projected/profiled the selected table
   and retrieved neighbors twice. Reuse one query result through generation and
   ranking, including ordinal type/order hints.
5. Candidate mappings repeatedly filtered the same complete rows and recomputed
   domains, numeric columns and group counts for different chart methods. Share
   these summaries within a query with a bounded cache keyed by selected columns,
   while checking source-row and source-profile identity. No sampling, chart
   exclusion, score changes, or action substitutions were introduced.

## Checks and remaining costs

- Unit/regression coverage: missing values and reordered mappings; distinct
  datasets/types; ranking/default equivalence; native scale controls; model
  update races; gzip/ETag freshness; import failure/retry; saved project replay;
  PNG/PDF/SVG exports.
- Actual browser: fresh visit, upload-first, cancel, save/reload, invalid-draft
  recovery, both view modes, zoom/pan/fit, guide/plot editing, facets and concat.
- Transition hover after six further edits including facet: three rounds of 20
  card hovers, 493 DOM nodes in every round; maximum frame interval 16.8 ms,
  zero intervals over 25 ms in this run.
- The existing 41-edit native worker benchmark still produced equivalent final
  programs, views and traces. Its legacy full-replay comparison is not a newly
  implemented optimization in this change.
- Apply-to-next-card time for Cars remains about 1.0 s in Preview mode, including
  the requested 560 ms flight animation; switching to Style is roughly 0.2 s
  with occasional longer samples. This change does not claim those animations
  or native rendering work have been eliminated.
- Saved-project restoration was variable: 0.48–0.90 s in the final Preview run,
  versus 0.76–0.83 s before. Earlier optimized samples were around 0.46 s, but a
  consistent restoration speedup was **not** established. Replaying complex
  history and preparing native recommendations remain costs to profile by case.
- A bundled first parse produced 55–71 ms long tasks on fresh visits; reloads
  showed none at picker readiness. The bundle reduces total startup work, but
  does not make first-parse CPU work disappear.

## Reproduction

```sh
npm run dev
node scripts/benchmark-loading.js
MODE=transition LABEL=transition node scripts/benchmark-loading.js
node scripts/benchmark-initial-loading.js
node scripts/test-dataset-startup-browser.js
```

Run timing benchmarks without concurrent CPU-heavy tests. Raw timing records,
profiles and screenshots belong in ignored `output/loading/`, not Git.
