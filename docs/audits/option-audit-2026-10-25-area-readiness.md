# Unemployment Area recommendation readiness — independent verification

Report-only check on 2026-10-25, after the parallel native sweep had finished. A fresh isolated Chromium context used the shared local development server and fake authenticated account. No production data, account or product code was changed.

## Confirmed finding — P1

**Reproduction:** choose Unemployment by industry → select `date`, `rate`, `series` → choose Area plot → Apply, keeping every default parameter. Do not hover or change subsequent cards.

The current chart and history entry are created, but the first five recommendation cards take **49.193 seconds** to become ready. This independently reproduces the earlier live audit's two 30-second timeouts without requiring its parameter sweep or concurrent native audit load. The operation eventually completes; it is not an indefinite freeze.

| Elapsed after Apply | Observed first-page state |
| --- | --- |
| 0.522 s | Commit transition underway; initial phase, one history entry |
| 1.614 s | Current Area exists, two history entries; only Encode stroke color ready; row `aria-busy=true` |
| 26.729 s | Facet becomes the second ready card; row remains busy |
| 30.747 s | Still only two ready cards; row remains busy |
| 49.193 s | Five ready cards: Encode stroke color, Facet, Create facet grid, Adjust Y scale, Adjust X scale; first row `aria-busy=false` |

The relevant Chromium renderer process consumed **49.607 CPU seconds** between the before-Apply and final observations. The inspected page's main-thread `TaskDuration` increased by **0.432 seconds**. These measurements support ongoing computation rather than an idle stalled request. They suggest substantial work outside the page's main thread, such as a worker, but no worker profile was taken; **the specific function, candidate and algorithm responsible are not yet proven**. The timing of a card appearing does not establish that card as the sole expensive operation.

There were **zero JavaScript page errors**. Sampling stopped on successful completion at 49 seconds, so the planned 60/90/120-second observations were unnecessary. The application wasn't modified to run this check.

## Evidence and repeatability

- Driver: `scripts/audit-area-readiness-2026-10-25.mjs` (syntax checked).
- Full one-second DOM, Chromium process CPU and page performance samples: `output/option-audit-2026-10-25/area-readiness/default-results.json`.
- Screenshots: `default-0s.png`, `default-30s.png`, `default-final.png` in that directory.
- Original earlier run for comparison: `output/option-audit-2026-10-25/live/04-createAreaPlot-unemployment.json`.
- Run against an already running local server with `node scripts/audit-area-readiness-2026-10-25.mjs`; `APP_URL` overrides the default `http://127.0.0.1:5205/`.

Performance numbers are this local Chromium run, not a production SLA or cross-browser benchmark. They are enough to confirm the reported long recommendation wait independently; root-cause profiling remains follow-up work.
