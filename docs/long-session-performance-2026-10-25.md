# Long-session option performance — 2026-10-25

The reported failure was progressively delayed option preparation and hover feedback after many edits. This change keeps all source rows, authoring calls, history positions, recommendation choices and parameter validation.

## Findings and changes

- **Foreground autosave rendering:** saving every applied action synchronously measured chart pixels, rendered a high-resolution project thumbnail and compressed PNGs. The Bike Sharing parallel-coordinate facet reproduced a roughly 220 ms main-thread stall per Apply. A dedicated OffscreenCanvas worker now performs this derived work. Its pending thumbnail queue retains only the latest request; every authored revision enters the durable account outbox before waiting for PNG completion, including if the tab closes mid-export. The thumbnail resolution and 180 KB ceiling are unchanged and tested against the foreground export.
- **Retained historical graphics:** history entries and thumbnail canvases retained full native trees for every edit. History now preserves permanent public-call metadata plus a bounded eight-entry compiled working set. Weak references reuse trees still owned by Current or a live deck. Evicted states replay their exact public calls when requested, yielding between chunks; thumbnail canvases retain pixels rather than the native program. Reload replay has a bounded prefix cache and finds the longest retained prefix before executing any missing call.
- **Chart-count cache limits:** a many-segment path had the same cache weight as a tiny chart. Native preparation, worker decks, browser candidate artifacts and saved galleries now account for graphical items and path commands. Current results remain cacheable even if a single chart exceeds the normal budget. Eviction changes retention, never which actions exist.
- **Duplicate transition work and a fixed wait:** Apply reused neither the already prepared transition scene nor the interval during its finishing animation. The committed scene now comes from the validated worker artifact. Current is updated beneath the animation layer; the next cards unlock immediately and a newer hover can retarget that layer.
- **Path-aware frame budget:** long path commands now count toward the app’s existing Canvas transition fallback. Dense charts use complete endpoint images during the transition instead of repeatedly interpolating every path command; ordinary charts retain geometry interpolation. A restored baseline scene is prepared in the worker before first hover.

## Browser evidence

Local Chromium, authenticated mock account, 1800 × 1200 viewport, complete 731-row Daily Bike Sharing dataset. Five parallel dimensions (`temp`, `hum`, `atemp`, `windspeed`, `casual`), facet by `yr`, two panels. The script searched and applied opacity values cyclically, then waited for all five first-page option cards after each edit. This exercises public action preparation, worker transfer, autosave, native rendering and history together.

| Measurement | Before | Updated |
| --- | --- | --- |
| Recurring main-thread Apply stall | about 219–230 ms each edit | recurring stall removed; four isolated 51–76 ms tasks in 40 edits |
| Early full-page completion, median of first 5 edits | 1.754 s | 1.375 s |
| Full-page completion, last 5 edits of each run | 1.609 s at edits 21–25 (maximum 2.87 s) | 1.403 s |
| Hover response after 40 edits, 25 rapid card switches | not measured in this baseline | 27–73 ms; median 35.3 ms |

Full-page timings include Playwright input/actionability overhead and all five native candidates; they are not frame rates or hover timings. The baseline had 25 dense edits; the updated run had 40. Main-thread stalls, worker request durations and heap samples were recorded separately. The smaller Iris scatterplot also ran 40 UI edits and 61 calculation-service edits; its calculation time was already broadly stable, which is why the fix targets retained dense work rather than blaming trace length alone.

The final path-budget/baseline-preparation check at step 43 measured **14–91 ms** across 25 rapid hovers (median **29.2 ms**) and **293 ms** from Apply to the first interactive next card. That card no longer waits for the 700 ms animation to finish.

The updated sequence also passed: a jump to the oldest history entry and back, Undo/Redo, rapid hover, Preview mode, Transition mode, and refresh restoration at step 42. No browser errors were recorded. Screenshots and raw profiles are local ignored artifacts under `output/long-session-performance/`.

## Regression coverage

The complete suite passed **728 tests**. A final 13-test cloud persistence run also covers closing the tab before PNG completion. The production asset build passed.

- Compiled-cache eviction and exact replay of graphics, semantics and native trace for unit charts, facets and branched history.
- Complexity-weighted retention of dense unit paths as well as compositions.
- Superseded derived thumbnails without discarding project revisions; final saved image belongs to the final revision.
- Identical foreground/background PNG export, dimensions and byte ceiling.
- Existing project, cloud, native worker replay, history, recommendation and composition regressions.

A newly requested dense five-card page still requires native computation; the measured improvement is responsive ready-card hover, removal of repeated foreground stalls, and bounded derived work as sessions grow. No sampling or hidden reduction of rows, options or history was used. No release tag or deployment is part of this change.
