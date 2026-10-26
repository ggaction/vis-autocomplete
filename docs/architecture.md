# Architecture and change boundaries

VisAutocomplete combines a recommendation engine with a browser editor. ggaction owns chart semantics and rendering; the app chooses and presents actions; transition plays changes between already computed scenes.

```text
Selected fields / committed ChartProgram
                  |
        Candidate generation + ranking       src/
                  |
         Public ggaction method + args
                  |
           Preview computation                workers + vendor/ggaction
                  |
       Option card / Canvas preview           web/ + vendor/transition
                  |
                Apply
                  |
     New committed program + history + code
                  |
   Local draft / optional private account save
```

## Find the owning module

| Area | Entry points |
| --- | --- |
| Recommendation exports and validation | `src/index.js`, `src/engine.js`, `src/catalog.js` |
| Initial chart choices and field roles | `src/initial-recommender.js`, `src/field-selection.js`, `src/plot-catalog.js` |
| Features and co-occurrence scores | `src/semantics.js`, `src/model.js`, `src/action-hierarchy.js` |
| Overlay, facets, adjacent charts | `src/overlay-candidates.js`, `src/facet-candidates.js`, `src/composition-recommendations.js` |
| Browser startup and orchestration | `web/entry.js`, `web/app.js` |
| Option controls and card rendering | `web/parameters.js`, `web/app.js`, `web/option-groups.js` |
| Expensive chart work and thumbnails | `web/calculation-worker.js`, `web/thumbnail-worker.js` |
| Account and consent handling | `web/cloud/`, `web/research/`, `scripts/research-ingest.js`, `supabase/` |
| Native actions, concrete graphics, inspection | `vendor/ggaction` |
| Animation timing and scene correspondence | `vendor/transition` |

Use repository search to find the specific action or UI label before editing a large orchestrator. Detailed feature contracts and regression reports are linked from the [documentation index](README.md).

## Recommendation contracts

Each recommended action must invoke one actual public ggaction function. Function names and parameters come from the library, not UI-only commands. The app may perform documented preparation, guide fitting, or a direct-edit transaction, but those calls must remain real and reproducible in generated code.

Initial recommendations consider selected fields, their data types, compatible chart roles, and corpus evidence. Subsequent recommendations use chart-state features and co-occurrence evidence, with action grouping and previously used actions handled by the recommendation/UI policies. A score is ranking evidence, not a calibrated probability or proof of chart quality. Supported capabilities should not disappear merely because the corpus contains no example.

The trained model and provenance are checked in. Corpus programs are analyzed statically; training is not execution of arbitrary corpus code. Model generations and hashes must agree when loading or regenerating them. There is no live LLM call in the authoring path.

## State and history

A ggaction `ChartProgram` is immutable. Build preview candidates from committed state; do not mutate previous programs, history nodes, user data, or caller-owned options. Hover is provisional. Applying a card or committing a direct manipulation creates the durable change; cancelling must preserve the prior state.

Linear and Graph History navigate the same authoring history. A restored branch, Undo/Redo, and a restored project must reproduce the same chart and editable code. Repeated direct edits may coalesce according to their existing transaction rules; do not flatten unrelated edits or discard branches to simplify caching.

Workspace mode, panel sizes, and view zoom are viewing preferences, separate from native chart geometry. Resizing a chart changes chart code; zooming the view does not.

## Rendering and performance

Current/preview views and thumbnails use Canvas. Workers prepare concrete native graphics; `@ggaction/transition` animates prepared scenes without running chart actions on each frame. SVG/PDF export remains available through ggaction.

Cache by stable program/state identity, use bounded retained resources, cancel or ignore stale work, and prioritize visible interaction. Reuse unchanged history thumbnails and card surfaces. A useful optimization preserves endpoints, selection, all data, and available actions. Test long histories and rapid retargeting, not only a first render.

Composition makes ownership significant: a layer, facet cell, panel, and shared legend are not interchangeable targets. Use explicit library target selectors and actual source-row/mark relationships. Never infer identity from screen proximity alone or choose the first resource when several are possible.

## Authentication, persistence, and research

Hosted and locally configured editors require a verified Supabase member or anonymous session. Private projects/datasets are distinct from optional research interaction logs. Guests keep their draft locally and cannot use private cloud project storage. Database policies enforce the boundary independently of UI controls.

With consent, research logging can include field names, chart text, search text, action/parameter context, and interactions; raw dataset rows are not part of that research event stream. Private cloud project storage and deliberately attached bug-report data have separate purposes. Consult [research logging v2](research-logging-v2.md), [the privacy notice](../privacy.html), and the actual schemas before changing any collection path.

Changes to account data or research events need client, server, and database tests. Use synthetic users and data. Never infer that an authenticated guest has member permissions, or that a private storage record is research consent.

## Library and release boundaries

Pinned submodules keep browser and Node behavior aligned. A missing native capability belongs in ggaction with its API contract, types, metadata, documentation, and tests. Playback behavior belongs in transition; app interaction policy remains here.

Merges and normal pushes run checks. They do not deploy. [Release procedures](releases.md) require an explicitly authorized version tag and verify the exact release commit. CI, package publication, provider configuration, and live production checks are separate evidence.
