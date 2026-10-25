# Composition option-card audit — 2026-10-25

Report-only audit. No chart behavior was modified. Browser sessions use a deterministic mock account and isolated Chromium storage; no real cloud project or report is written. The audit source is `scripts/audit-compositions-2026-10-25.mjs` and the raw evidence is in ignored `output/option-audit-2026-10-25/compositions/`.

## Method

- Start from the actual dataset dropdown and column selection buttons; apply an initial chart through its real card.
- Enumerate every recommended Layer chart and Follow results card. Exhaustively traverse adjacent-card pagination for Barley, Iris and Penguins; exercise the first adjacent page for the remaining new datasets, plus a partial Fashion-MNIST pagination sweep.
- On each card, exercise every enabled enumerated choice, and numeric min/mid/max. Capture the actual asynchronous preview state and error. Restore original values between controls where possible.
- Exercise facet fields, columns and gap, then add adjacent charts. Distinguish a native unsupported operation from a UI that incorrectly offers that operation without a viable parameter choice.
- Preserve per-card labels, baseline validity, parameter definitions and each attempted value in JSON. A failed automation selector or timeout is a harness interruption, **not an application defect**. Coverage counts exclude these interruptions and dynamically disabled choices.
- This is bounded empirical coverage, not a claim of all cross-products of all parameters. Parameter dependencies and repeated controls mean counts must be interpreted at the recorded scenario level.

## Confirmed findings

### C01 — Bar layers pass applicability inspection but all offered choices fail to render

**Priority: high.** Barley → select `variety`, `yield`, `year` → Bar plot → Add overlay → Layer chart.

The default source is horizontal: X=`sum(yield)`, Y=`year`, Color=`variety`. All four advertised layers fail immediately:

| Layer | Error |
| --- | --- |
| Bar | `Series layout scale "x" requires one layout policy.` |
| Dot | `Series layout scale "x" cannot be shared with another policy.` |
| Line | `Line x encoding does not support aggregate.` |
| Lollipop | `Series layout scale "x" cannot be shared with another policy.` |

Changing In front/Behind does not repair them; aggregation alternatives incompatible with the source are disabled. The Follow results line/point path works for this source, so the general overlay feature is reachable.

**Evidence:** `inspect.png`, `barley-horizontal-1.png` through `-3.png`, `barley-horizontal-source.json`, and `results.json`.

**Root boundary:** `web/composition-controls.js::layerSpecs` already asks the public `describeAction` API and filters unsupported/incompatible results. These cards survive that check but fail native materialization. The descriptor and execution contracts are inconsistent; simply hiding a named card would leave the broader policy/axis problem unresolved. Relevant runtime checks are in `vendor/ggaction/src/materialization/scales/policies/series.js` and the line measurement validator.

### C02 — A Violin chart advertises Follow results although its geometry cannot have one endpoint per category

**Priority: medium.** Palmer penguins → select `Species`, `Body Mass (g)`, `Sex` → Violin plot → Add overlay → Follow results.

The tab is enabled and presents Line overlay and Point overlay. Both fail by default, and all Missing values / Order by values retain:

`Categorically placed density areas do not have a single result endpoint per category.`

The audit does **not** assume this is a meaningful native operation. The defect is offering an unusable action as a normal selectable candidate. Raw-data layering of distribution charts is independently available and works.

**Evidence:** `new-data/results.json`, `new-data/penguins-null-distributions-1.png`.

**Root boundary:** `src/overlay-candidates.js` accepts point/bar/line/area mark types without checking the compound chart's result-item capability. The materialization contract explicitly rejects categorical density in `vendor/ggaction/src/materialization/overlayItems.js`.

### C03 — A Violin's raw measurement is incorrectly auto-shared with an adjacent raw Scatter

**Priority: high. Minimal reproduction:** Palmer penguins → select `Species`, `Body Mass (g)`, `Sex` → Violin plot → right `+` → Add Scatter plot.

No facet or overlay is necessary. Both charts use Body Mass (g) on Y and the card forces the shared linear Y scale, yet the untouched card fails:

`Cannot share y: field meaning and scale mapping must be compatible across views.`

The card labels Y as shared and disables every alternate scale; there is no parameter that releases the automatic sharing here. In the longer Violin + Raincloud + facet workflow, default Beeswarm, Interval, Strip, Box and Gradient adjacent cards fail similarly.

**Evidence:** `penguins-minimal-share.png`, `repro-share.mjs`, `new-data/results.json`.

**Root boundary:** `web/composition-controls.js::adjacentSpecs` decides compatibility from `sameAxisMeaning`, then forces the copied scale; the ggaction composition sharing validator subsequently rejects it. The app's compatibility decision and native distribution-to-raw coordinate/scale meaning contract need to agree.

### C04 — Adjacent Area receives an invalid measurement object

**Priority: high.** Barley → select `variety`, `yield`, `year` → Bar → Follow results Line overlay → facet → right `+` → Add Area plot.

The untouched Area card fails with `Unknown createAreaPlot measurement option "fieldType".` The tested mapping, aggregation, Y scale and palette choices do not repair it. This is a generated-call contract failure, not an intentional unsupported chart pairing.

**Evidence:** `results.json` entries with stage `adjacent`, title `Add Area plot`; the unique error screenshot is listed in that scenario's `errorScreenshots` map. The saved source/interrupted project snapshots preserve the committed chart leading to the add flow.

### C05 — Adjacent ECDF cannot use its offered categorical color

**Priority: high. Minimal reproduction:** Iris → `Species`, `Sepal.Length` → Beeswarm → right `+` → Add ECDF plot → Color / group = Species.

The card offers the field as enabled, but choosing it fails with `createECDFPlot color field must be a non-empty string.` Default uncolored ECDF works. This is a typed constructor adaptation problem: ECDF's color argument is not interchangeable with the object-form color channel accepted by other constructors.

**Evidence:** `iris-ecdf-color.png`, `repro-ecdf.mjs`; baseline/changed-value comparison in `results.json`.

### C06 — Adjacent Rug cards receive unsupported additional channels

**Priority: high.** In the committed Iris Beeswarm + Box layer + facet state, right `+` offers Add Rug plot with `createRugPlot requires exactly one of x or y.` In the corresponding Barley colored source, it instead fails with `Unknown createRugPlot option "color".`

The default cards and all tested edge/opacity/scale values retain these errors. Adjacent construction needs to respect a one-axis/no-constructor-color chart contract, even when its source has both axes and color. This is broader than disabling a particular dataset: inherited channel/scale settings must be written only to supported constructor bindings.

**Evidence:** `results.json`, `iris-distributions-interrupted.json`, `barley-horizontal-interrupted.json`; per-scenario error screenshot maps locate the rendered evidence.

**C03 additional native evidence:** `createViolinPlot` renders Y with `{field: 'Body Mass (g)_value', fieldType: 'quantitative', scale: 'y'}`, while `getPlotComposition(...).channels.y` correctly reports the original `Body Mass (g)` and `measurement: {unit:'value',operations:[]}`. The native composition sharing validator reads the former physical field rather than the latter semantic measurement lineage. This directly explains the false incompatibility with a raw scatter using `Body Mass (g)`.

### C07 — Choosing Color=None in an adjacent chart re-inherits a column its summary no longer contains

**Priority: high. Minimal reproduction:** Daily bike sharing → `dteday`, `cnt`, `season` → Line plot → right `+` → Add Area plot → Color / group = None.

The colored baseline is offered, but None fails with `Field "season" must contain a nominal value at row 0.` The longer Fashion-MNIST workflow reproduces the same issue for `label_name`; Budget forecasts' adjacent Line reproduces it for `budgetYear (color bin)`.

**Evidence:** `bike-area-no-color.png`, `repro-none-color.mjs`; `remaining/results.json` and `new-data/results.json` record the exact single control change.

**Root boundary:** clearing color deliberately omits it from the prepared chart/summary, but `inferCompositionOptions` can interpret omitted color as permission to re-inherit the source's channel. An explicit user choice to clear a channel needs a distinct meaning from an omitted role that should be inferred. Missing summary columns are a symptom of this ambiguity.

### C08 — Automatic title leaks a derived density column name

**Priority: medium.** In the Penguins Violin + Raincloud + facet composition, select All → Add a title. The default visible title is `Body Mass (g)_value by Species`, although the chosen source variable is `Body Mass (g)`.

The title generator reads a materialized density-sample encoding rather than the semantic input field. This is not a rendering crash, but it makes the recommended default incorrect for users and compounds the same lineage inconsistency found in C03.

**Evidence:** visually inspected `penguins-null-distributions-nested.png` and its portable `.visauto.json`. The original source name and the native rendered `_value` column were independently inspected.

### C09 — Adding a chart silently removes the shared categorical color legend

**Priority: high. Minimal reproduction:** Fashion-MNIST t-SNE → select `x_pos`, `y_pos`, `label_name` → Scatter → right `+` → Add Scatter. Accept the default shared Y and color.

The initial scatter has a ten-item categorical color legend. After the first adjacent chart, the colored points remain but there is no legend anywhere. Adding a third chart, adding a common title and reloading preserve the missing legend. No removeLegend action was invoked, and the generated final createGuides call explicitly targets both panels (all three after nesting).

**Evidence:** visually inspected `fashion-point-nested.png`, portable `fashion-point-nested.visauto.json`, and `fashion-legend-inspection.json`. Native replay of its saved history independently confirms that the initial view has a color legend configuration and rendered legend references; after the first concat, the root and both child views have no legend configurations or rendered color-legend references.

**Root boundary:** guide generation/collection when moving from a single chart to a shared-color composition loses the only surviving legend. This is distinct from duplicate-legend suppression: successful deduplication must preserve one shared guide.

## Successful depth checks

Separate completion runs repaired an audit-driver pagination race without changing the product. Barley, Iris and Penguins saved source + layer + facet states were reopened through the actual project-import UI. Each successfully added a right adjacent chart, then a third chart below the combined group, selected All, applied a common title, performed Ctrl+Z / Ctrl+Shift+Z, and reloaded. All target labels survived and no JavaScript page errors were recorded. A fourth completion run used Fashion-MNIST Scatter as its source and passed the same three-panel / shared-title / undo / redo / reload sequence, while exposing the missing legend recorded in C09. Evidence: `replay-results.json`, `fashion-replay-results.json`, `*-nested.png`, and portable `*-nested.visauto.json` project exports. Thus earlier `interrupted` labels in the parameter sweeps must not be interpreted as failed concat/undo persistence.

## Validation boundaries

- Exponential regression on signed or zero values is mathematically invalid and its explicit error is an expected restriction; it is not counted as an independent defect here.
- A native unsupported Follow-result endpoint is not itself a bug; offering an enabled tab with only unusable candidates is the reported C02 issue.
- A dynamically disabled mapping after another mapping changes is skipped, not called a failed user value.
- Playwright selector/animation timing interruptions are logged separately. The first full sweeps' pagination-return race was corrected in the audit script and successful completion was verified independently.

## Capability gap distinct from a confirmed implementation defect

In the Iris three-panel nested composition, the first panel is faceted and contains Beeswarm + Box, while two other panels are ordinary Scatter charts. All → Encoding → search `opacity` returns no cards (`iris-scoped-failed.png`). A direct public `encodeOpacity` using all four explicit logical chart targets also rejects the facet source with `Target a facet source through editFacetSource, or identify an explicit childPath.`

This is not reported as an app hiding a currently supported native operation. A uniform whole-composition appearance operation across mixed faceted and ordinary panels needs a common semantic routing contract. The UI's All target presently does not provide that capability. The attempted scope test therefore did not reach an opacity Apply and is excluded from successful operation counts.

## Completed coverage

All **10 newly added datasets**, plus Barley and Iris, were exercised through actual editor UI chart creation. The composition sweep recorded **242 scenario-card instances**, **932 control instances**, and **3,141 changed-value preview checks**: 2,891 rendered ready and 250 returned validation errors. Repeated instances of one underlying failure are counted as checks, not independent bugs. The confirmed distinct findings are C01–C09.

The totals exclude 29 audit-driver exceptions, 23 choices that became disabled after a dependent change, and baseline-only `__default` probes. The 242 baseline card states are retained separately in the raw results. Numeric tests use min/mid/max, not every representable number; enumerated choices cover enabled values at the observed state. These counts do not imply the Cartesian product of all controls or full application-action coverage.

| Dataset / source | Card instances | Control instances | Changed values | Ready | Invalid |
| --- | ---: | ---: | ---: | ---: | ---: |
| Barley / horizontal Bar | 29 | 147 | 540 | 489 | 51 |
| Iris / Beeswarm | 40 | 151 | 400 | 389 | 11 |
| Penguins / Violin with missing values | 40 | 154 | 450 | 368 | 82 |
| Fashion-MNIST / Scatter | 13 | 43 | 133 | 65 | 68 |
| Wine / Scatter with five selected fields | 15 | 55 | 272 | 271 | 1 |
| Daily bike sharing / temporal Line | 13 | 53 | 201 | 200 | 1 |
| Global temperature / signed Area | 15 | 59 | 196 | 193 | 3 |
| US budgets / forecast Line | 16 | 57 | 204 | 186 | 18 |
| Household income / grouped Bar | 12 | 45 | 200 | 190 | 10 |
| Glass / Box | 23 | 65 | 181 | 181 | 0 |
| US employment / signed Line | 13 | 50 | 168 | 165 | 3 |
| Unemployment / temporal Line | 13 | 53 | 196 | 194 | 2 |

Wine, Bike, Temperature, Budgets, Income, Glass, Employment and Unemployment each completed an adjacent Apply, keyboard undo/redo and reload in the main run. Barley, Iris and Penguins completed the separate deeper nested replay described above after the first driver's return-pagination race; Fashion-MNIST's partial parameter sweep was followed by a successful independent nested replay. Earlier `interrupted` JSON statuses are retained honestly and do not overwrite later completion evidence.

Source files: `results.json`, `new-data/results.json`, `remaining/results.json`; aggregated counters: `coverage-summary.json`. All paths are relative to `output/option-audit-2026-10-25/compositions/`. Each card entry records stage, page, title, public method, controls, baseline state, changed value, resulting validation state and error; source/project snapshots and screenshots accompany the observed failures.
