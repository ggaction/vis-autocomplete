# Option-card parameter audit — 2026-10-25

This is a report-only audit. No application or ggaction fixes are part of this change. The reusable runner is `scripts/audit-parameters-2026-10-25.mjs`. Its generated case records, native replay snapshots, SVGs, and independent reproductions live in the ignored `output/option-audit-2026-10-25/parameters/` directory.

## Scope and evidence model

- Load the real bundled examples through `loadExampleDataset`, preserving the same field-type overrides used by the app.
- Select a field set through `createInitialChartRecommender`; build the actual initial editor with `initialParameters`.
- Use `createCalculationService` to enumerate Encoding, Transform, and Style cards through every page. `hierarchy: false` expands the fine-grained actions that are reachable through explicit search; it does not bypass default validation.
- Exercise enabled enum choices, number defaults/minimum/maximum/step-aligned midpoint, multiselect minima/all/reversed/single-alternative sets, text examples, dynamically revealed controls, and selected sequential interacting pairs.
- Apply `normalizeValues` and replay the same `buildRecommendationCall` / `prepareGuidedAction` paths as the application. Axis swaps require the UI's `__previousMapping`; earlier probes that omitted it are explicitly excluded and rerun, not reported as bugs.
- Serialize SVG and rasterize the concrete Canvas transition scene for every successful unique call. Save geometry/node counts and both hashes. Round-trip each default recommendation through public persistence.
- Deduplicate identical native calls and distinguish a valid unchanged call from an exception. Empty text validation is an expected rejection, not a bug.

This is a finite executable coverage matrix, not every real-number value or the infinite Cartesian product of all action sequences. Final counts and untested reasons are generated in `parameters/coverage.json`.

## Final coverage

| Measure | Result |
| --- | ---: |
| Datasets | 11 (all 10 new examples, plus Cars) |
| Rendered initial chart families | 29 |
| Scenario records | 40: 38 complete, 1 timeboxed partial, 1 initially ineligible |
| Visited card contexts | 1,210 |
| Distinct public action methods exercised through cards | 123 |
| Unique method/control IDs | 548, including 18 swap buttons |
| Parameter trial records | 27,479 |
| Non-deduplicated trial attempts | 27,273 |
| Successful SVG serialization + native Canvas rasterization | 26,330 |
| Identical-call variants / accepted unchanged results | 206 / 109 |
| Default persistence round trips / differences | 1,195 / 0 |
| Unexpected exception instances / method-message families | 292 / 58 |
| Expected empty-text validation rejections | 542 |
| Final driver artifacts / per-card budget-skipped variants | 0 / 0 |

The 58 exception families are **not 58 independent bugs**; many parameter choices share one owning-chart or guide-layout defect. `coverage.json` records a `findingGroup` for every unexpected method/message family, all example calls, all observed controls, disabled choices and reasons, and each scenario's status. The default replay checks passed; this does not establish every non-default action sequence or every rendered pixel as correct.

There are 294 current public ggaction methods in the runtime catalog. This card matrix observes 123; the other 171 are listed with their setup/data/alias/recommendation roles in `catalogCoverage.unobserved`. Many are intentionally outside these states (resource construction, removal, composition, or a different owner); the list must not be described as 171 missing features. Composition has a separate audit. Explicitly probed reachability gaps are documented below.

Numeric coverage samples finite boundary/default/midpoint values, enum traversal exercises generated enabled choices and revealed controls, and the pair pass samples sequential interactions. The 4,300 representative value records are a generated inventory, not a claim to test infinitely many slider values. Early records lack active-control keys, so retained value observations are not a trustworthy denominator for every possible active-control combination.

**Stopped or unavailable states:** Bike Area was stopped at the 12-minute native per-state cap after all Encoding/Transform methods and part of Style; remaining served Style methods are listed in its record, and similar Area style editors were tested in Budget Area. Wine Radar was legitimately ineligible because class does not uniquely identify each series; Glass Id_number supplied a valid Radar state and its full card matrix completed. Two expensive repeat passes over the seeded Cars state's generic cards were stopped, preserved under `interrupted/`, and excluded from final counts; targeted dependent-editor runs replaced them. The corrected initial-editor reruns replace earlier driver probes that omitted previous mapping context.

**Dependent-editor breadth:** Real card sequences created title, mark labels, grouped regression, statistical references, annotation, and variable size/opacity/shape/stroke/stroke-width/stroke-dash encodings. Follow-up title, label placement, regression, rule, and scale editors were then targeted. `editMarkLabelSelection` and owner-level `editRegressionLine`/`editRegressionBand` were not served for the requested sampled targets; records identify this rather than claiming parameter coverage.

## Confirmed findings

### P1 — Newly selected fields with missing values break multiple enabled editors

**Reproduction A:** Palmer penguins → select Species and Body Mass (g) → Raincloud → find `editRaincloudPlot` → choose Sex for Group. The offered choice errors with `Field "Sex" must contain a nominal value at row 7.`

**Reproduction B:** Palmer penguins → select Species and Beak Depth (mm) → Beeswarm → Encode color or Encode stroke → Variable → Sex. Encode shape → Sex also fails.

**Other affected owners:** Dot/Lollipop category reassignment to Sex fails; Strip `facetGrid` can fail on missing Sex in one panel. Initial complete-case filtering handles only the original variables. Newly mapped fields can still have nulls, and several editors/owners have no corresponding missing-row adaptation.

**Expected contract:** Selecting an enabled original field should use a consistent explicit missing-data policy and recompute the owner and affected guides. If that capability is unsupported, the UI must explain it at the choice, rather than enabling a broken preview. Do not silently reinterpret missing values as a category.

**Evidence:** `penguins-raincloud.json`, `penguins-beeswarm.json`, `penguins-dot.json`, `penguins-lollipop.json`, `penguins-strip.json`; real browser confirmation is recorded separately by the root audit.

### P1 — Parallel coordinates Color=None leaves a malformed color encoding

**Reproduction:** Wine chemistry → select Alcohol, Malicacid, Ash, Alcalinity_of_ash, Magnesium, class → Parallel coordinates → Color=None.

The builder emits:

```js
color: { scale: { palette: 'tableau10' } }
```

without a field or fixed value. Native validation throws `encodeColor requires exactly one of value or field.` This is a direct single-control change, not an invalid combination.

**Expected contract:** Clearing color removes the complete encoding, including its palette/scale payload. An optional color must be possible after a colored default. The stale palette must not reintroduce an empty encoding.

**Evidence:** `wine-pcp.json`, initial `color=""` trial; source path to inspect is initial scale decoration for multivariate field-set recipes.

### P1 — Editing a legend makes a later valid variable stroke encoding fail

**Reproduction:** US household income → Bar with X=group, Y=pct, aggregate=sum, Color=region → apply Edit legend with right position, label size 10, item gap 18, show all → Encode stroke → Variable (region).

Identical `encodeStroke({ target:'plot', field:'region', fieldType:'nominal' })` succeeds before Edit legend and fails afterward:

> The right color legend and stroke legend overlap; guides require more margin space or different offsets.

The failure occurs while the app's automatic `createGuides` creates the second legend after preserving the explicitly edited first legend. It is therefore sequence-dependent guide layout, not an unsupported stroke mapping.

**Expected contract:** The automatic and user-edited legends need joint placement and margin reservation. Preserve the chosen position/style while adding enough non-overlapping space for newly required channels.

**Evidence:** `confirmed-legend.json`, `reproduce-legend.mjs`, root live case `live/03-createBarPlot-income.json`, entries 1 and 2. This independent replay uses the exact browser-authored call history.

### P2 — Statistics offers internal density fields for an incompatible population

**Reproduction:** Palmer penguins → Violin with Species / Body Mass (g) (Sex also selected) → Add statistic, axis Y, population Original observations → Group by `Body Mass (g)_value` or `Body Mass (g)_density`.

Both choices are enabled, but fail `Statistical reference groupBy field "…" is missing at item 0.` Group by Species succeeds in the same state. The same issue occurs for Raincloud and Glass Density (`RI_value` / `RI_density`), and extends to ECDF probability/cumulative fields and Horizon generated fields.

`statisticGroups` unions fields from multiple populations. Normalization may force original observations while retaining a field that exists only in the derived density marks; no population can satisfy the resulting action.

**Expected contract:** Group choices must have a compatible population, and changing either control must retain a valid pair. Internal generated fields should only appear when they express a meaningful supported operation, with appropriate labels.

**Evidence:** `confirmed-statistics.json`, `reproduce-statistics.mjs`, `penguins-violin.json`, `penguins-raincloud.json`, `glass-density.json`.

### P2 — Generic position remapping ignores packing/jitter constraints

**Reproduction:** Palmer penguins → Beeswarm with Species / Beak Depth (mm) → Encode X → Beak Length (mm). The enabled numeric choice fails `Point packing requires a categorical position scale with a positive slot.` The same operation on Strip fails `Band point jitter requires a categorical position scale with a positive slot.` Linear/log/sqrt/symlog variants do not resolve the category requirement.

**Expected contract:** The option editor must use the owning plot's role constraints, not generic scatter compatibility. Either preserve a valid categorical slot, perform a supported coordinated role swap, or mark incompatible choices unavailable with a reason.

**Evidence:** `penguins-beeswarm.json`, `penguins-strip.json`, direct `field="Beak Length (mm)"` / numeric-field trials.

### P2 — Filtering endpoints can invalidate distribution/interval owners without an explanatory constraint

**Reproduction:** Palmer penguins Violin/Raincloud → filter Body Mass (g) ≥ 6300, or ≤ 2700; Gradient → filter Flipper Length (mm) ≥ 231 or ≤ 172. These enabled slider endpoints leave too few distinct observations for density and throw `Density observed extent requires varying finite values.` Interval at the analogous endpoints fails with an empty scale-domain error.

The estimator's refusal is mathematically reasonable. The defect is the card's feasible-range contract: the slider advertises values that cannot produce its owner, while regression filtering already has estimator-aware limits. A bounded control should explain the limit or provide a deliberate supported empty/degenerate representation. This is not a request to fabricate a density estimate.

**Evidence:** `penguins-violin.json`, `penguins-raincloud.json`, `penguins-gradient.json`, `penguins-interval.json`.

### P2 — A supported density parameter pair can fail automatic axis fitting

**Reproduction:** Glass identification → select RI → Density → Normalization=count and Y scale=symlog. `createDensityPlot` fails with `The y-axis labels overlap each other.` These are enabled controls; the same individual choices are otherwise valid.

**Expected contract:** The preparer should resolve the guide density/format/layout for the resulting scale rather than reject a supported chart configuration. An independent 2×2 replay confirms unit/count × linear/symlog: only count+symlog fails. Supplying Y tick count 4, 3, or 2 to the native density plot succeeds, while 6 fails. The current fitting path reads ordinary `args.x`/`args.y` bindings and does not resolve Density’s `field`/`densityScale` roles, so its guide retry does not repair this case.

**Evidence:** `glass-density.json`, `pair:normalization+yScale`, `confirmed-density.json`, `reproduce-density.mjs`, and the three passing `density-*.svg` comparisons.

### P2 — Position/group editors ignore existing aggregation and path-series constraints

**Reproduction:** Daily bike sharing → Line with dteday / cnt / season. Encode Y offers instant, mnth, and dteday. Each enabled choice retains the existing mean aggregation internally and fails because mean does not support the newly selected nominal, ordinal, or temporal type.

In the same chart, Encode group → yr fails because a path series would then contain several season colors. Encode group → instant creates one observation per line and fails the two-point requirement. Facet grid → rows weekday / columns holiday can similarly create a sparse panel that rejects the whole chart.

**Expected contract:** Field choice compatibility must include existing aggregation, series grain, color consistency and sparse-panel semantics. Retain discoverability while explaining incompatible choices; support a native coordinated change where that is the intended operation. Do not infer compatibility from a field's datatype alone.

**Evidence:** `bike-line.json`: direct `encodeY field="instant"`, `field="mnth"`, `field="dteday"`, `encodeGroup p0="yr"`, `p0="instant"`, and `facetGrid p0="weekday"`.

### Additional guide-fitting reproduction

The symlog guide fitting problem is not limited to Density. Daily bike sharing → Bar with weekday / cnt / season → swap to X=cnt, Y=weekday, sum aggregation → X scale=symlog also fails `The x-axis labels overlap each other.` The field swap uses the same previous-mapping contract as the UI and the final native call has distinct, compatible positional fields. See `bike-bar.json`.

### P2 — Generic edits bypass specialized polar and Horizon ownership

**Pie:** Daily bike sharing → Pie with season / cnt → Encode theta → cnt. The card emits a quantitative theta with `aggregate: 'sum'`, which the arc contract rejects. The same editor offers dteday although temporal theta is unsupported, and categorical reassignments can retain incompatible season color groups.

**Rose/Radial:** Bike sharing → Rose with weathersit / cnt → Encode theta → yr. The existing polar guide values no longer lie inside the new categorical domain, so the preview fails `Polar guide values must be inside the scale domain.` Other category choices fail one-color-per-arc consistency.

**Horizon:** Global temperature → Horizon year / temp → Encode group → `plotHorizonSign` (or `plotHorizonColor`). These internal choices are enabled despite the owner explicitly requiring `plotHorizonGroup` and directing callers to `editHorizon`.

**Expected contract:** A generic channel editor must resolve the owning compound chart, legal roles, generated-data meaning, and dependent guides. An action can remain discoverable without advertising invalid choices; coordinated editing must use the owning public API where required.

**Evidence:** `bike-pie.json`, `bike-rose.json`, `bike-radial.json`, `temperature-horizon.json`; independent persisted-state replay in `confirmed-specialized.json` / `reproduce-specialized.mjs`.

### P2 — Area remapping treats synthesized gap rows as source observations

**Reproduction:** Bike sharing → Area dteday / casual / workingday → Encode X → casual. The input dataset contains finite casual values, but the app prepares `dataset-plot-summary-aligned` with synthetic nulls for absent series/time combinations and `missing: 'break'`. Generic Encode X reuses those mark rows and errors `Field "casual" must contain a finite number at row 2.`

Budget forecasts → Area with the recommended budgetYear / value / forecastYear mapping → Encode X → value fails the same way at row 7. These are not dirty input datasets: the nulls are generated by the app's series alignment.

**Expected contract:** Changing an owning plot's fields should rebuild its grouping/alignment from the correct source, preserving the intended missing policy. Generated mark rows must not masquerade as freely remappable raw observations.

**Evidence:** `confirmed-specialized.json` records the source and aligned dataset samples, exact native calls, and stacks; `bike-area.json` / `budget-area.json` show enabled controls.

### P2 — Large-category guides fail valid stroke and facet parameters

**Reproduction A:** US unemployment → Line date / rate / series → Encode stroke → Variable, field series. The only offered variable fails `In-plot legend group does not fit the plot inset.` The unchanged chart renders successfully.

**Reproduction B:** In the same chart → Facet by month (or year) → Columns=1. The enabled range includes 1 but its valid small-multiple configuration fails `Facet headers require sufficient non-overlapping space above every child plot.`

These are supported data/chart combinations whose automatic guide/layout capacity is insufficient. They are distinct from the mathematically impossible density endpoint cases and from assigning the wrong field type.

**Expected contract:** Reserve sufficient guide/header space or make a supported legible overflow/layout choice. Do not leave an enabled value with only a generic native layout exception.

**Evidence:** `unemployment-line.json`; independent replay in `confirmed-specialized.json`.

### P1 — High-cardinality color overflow leaks into unrelated continuous legends

**Reproduction:** Glass identification → select Id_number, RI, Na, Mg → Radar → Encode opacity → Variable, Al. The enabled parameter fails `Unknown createLegend option "overflow".` Variable stroke mapped to a numeric measure fails the same way.

**Isolated cause:** `defaultGuideCall` in `src/prepare.js` checks the existing color domain (214 Id_number categories) and adds categorical `overflow` to *all newly missing legend channels*. A new opacity legend is continuous and rejects that option. The exact same encoding followed by `createGuides({ legend: { target: 'plot', channels: ['opacity'], count: 3 } })` renders; adding the leaked overflow fails.

**Expected contract:** Derive automatic legend options per channel/legend type and reuse already-covered color legends. Cardinality of an existing channel must not determine unsupported options for another channel.

**Additional separate symptom:** In this Radar, Encode stroke dash → class fails `createCategoricalLegend requires a missing legend for series.` This indicates a guide ownership/recreation problem and is retained as a separate exception family, not claimed to share the overflow cause.

**Evidence:** `glass-radar.json`, `confirmed-specialized.json`, `confirmed-radar-overflow.json`, and `radar-opacity-overflow-false.svg`.

### P2 — Statistics target exposes an incompatible independent positional scale switch

Cars scatter → Add statistics → select the statistical-reference target → Encode X → choose linear/log/sqrt/symlog. Each enabled named scale choice fails `Cannot rebind x guides from shared scale "x" while it has other consumers.` Auto succeeds. This is another owner/guide dependency that the generic editor does not communicate or coordinate. Merely asking for Linear can fail even though the source plot is already linear, because the builder creates a new scale identity.

**Evidence:** `cars-scatter-seeded-statisticalReference-editRuleMark,encodeX,encodeY,encodeStroke,encodeStrokeWidth,encodeStrokeDash.json`.

### P2 — Variable stroke-dash scale card is generated with an unsupported argument and disappears

Cars scatter → Add statistics grouped by Origin → select statistical reference → Encode stroke width as variable → Encode stroke dash as variable (`group`). A native stroke-dash scale exists, but its edit card is dropped at preflight because the catalog emits `editStrokeDashScale({ target, reverse: true })`. `reverse` is not a valid public option.

An independent native call with a valid `range: [[1, 3], [5, 2], []]` renders successfully. This is an incorrect recipe hiding an available capability, not an absent corpus example or an unsupported chart.

**Evidence:** `cars-scatter-seeded-statisticalReference-editStrokeWidthScale,editStrokeDashScale.json` (rejection diagnostics), `confirmed-stroke-dash-scale.json`, `native-statistics-stroke-dash-scale.svg`.

### P2 — Supported individual polar/parallel axis editors are unreachable, and shape-scale editing has no parameters

Wine Polar Scatter supports native `editThetaAxis({ labels: { fontSize: 16 } })` and `editRadialAxis({ angle: 45 })`; both render. Wine Parallel Coordinates supports native `editParallelAxis({ target: 'plot', field: 'Alcohol', labels: { fontSize: 16 } })`. Exact-name option-card searches return no results for all three.

The app's fine-grained axis recipe loop in `extended-catalog.js` is restricted to X/Y. Its corpus recipe fallback handles mark styles, not these guide editors. Aggregate `editAxes` is present, but exposes only common all-axis controls; it cannot express an individual radial-axis angle or one parallel dimension's axis styling. This is a concrete breadth/parameter gap beyond default ranking.

After Cars → Encode shape → Origin, `editShapeScale` is reachable but contains **zero controls** and applies one hardcoded shape range. Users cannot compare or select different shape assignments through that card. Variable size/opacity/stroke/stroke-width scale controls, in contrast, were available and passed the targeted finite matrix.

**Evidence:** `confirmed-axis-coverage.json`, the three `native-wine-*-edit*Axis.svg` renders, and `cars-scatter-seeded-editSizeScale,editOpacityScale,editShapeScale,editStrokeScale,editColorScale.json`.

## Exclusions

- Empty chart/axis/legend/annotation text is intentionally rejected and is not counted as a discovered bug.
- Different facet column counts above the number of categories can draw identically; that is expected.
- Rotating a circular point is visually unchanged; this is not a rendering failure.
- An action that is already at the requested value produces the existing `no-change` result, not a failure.
- Mapping pairs generated without the UI's previous-mapping state were audit-harness errors and are excluded/retested.

## Timing limitation

Per-variant times in generated evidence include native preparation, SVG serialization and Canvas rasterization during a parallel exhaustive run. They are not measurements of live hover responsiveness and must not be quoted as isolated interactive latency. Performance findings require a separate quiescent browser reproduction.
