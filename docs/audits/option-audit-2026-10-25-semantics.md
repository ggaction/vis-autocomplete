# Dataset semantics audit — 2026-10-25

This report records four confirmed defects and four separate improvements. It does not change application or ggaction behavior. The audit used real browser interactions with the local application at `http://127.0.0.1:5205/`, a deterministic mock account, and isolated storage. It did not write to production.

## Scope and reproduction

The saved evidence covers five new datasets (Wine, Glass, Income, Global temperature, and Fashion-MNIST), 12 initial selections, nine successfully created chart roots, and 12 captured applied states. Three requested initial charts were unavailable. All captured browser page-error arrays are empty; that does not imply the rendered results are semantically correct.

The [runner](../../scripts/audit-data-semantics-2026-10-25.mjs) uses the real dataset picker, variable selection, recommendation cards, parameter controls, and Apply button. It saves screenshots, SVGs, projects, and serialized semantic/graphic/transition scenes for applied states. The collected counts refer to [results.json](../../output/option-audit-2026-10-25/semantics/results.json), rather than a promise about future reruns of the evolving runner.

```sh
node scripts/audit-data-semantics-2026-10-25.mjs --case=glass-radar-id
node scripts/audit-data-semantics-2026-10-25.mjs --case=oracle-only
```

The first command requires the local build and mocked-session helper. The second recomputes the independent numerical checks from existing saved snapshots, without chart interactions. Omitting `--case` exercises the runner's current 12 configurations.

Generated evidence is intentionally ignored by Git. Its local root is `/Users/hj/Desktop/ggaction_autocomplete/output/option-audit-2026-10-25/semantics/`; the relative links below work when that directory is present. The tracked runner and this report preserve the reproduction steps. Saved project metadata identifies ggaction commit `aa8f1e285295b46672408849fc3cbd0929fee178` with an unmodified library checkout.

## Confirmed defects

### S1 — Radar defaults conflate series identity and color, creating 214 legend entries

**Priority: P1.** Glass identification → select `Id_number`, `RI`, `Na`, `Mg`, `Al`, `Si`, `K`, `Ca`, `Ba`, `Fe`, and `class` → Radar plot → Apply.

The unique `Id_number` becomes both `groupBy` and color. The selected `class` field has six categories, but the initial card has no independent color parameter. The 214 IDs cycle through ten colors and create 214 legend entries. The logical canvas becomes 700 × 3920.5 for a 314 × 314 plot; the radar is approximately 60 pixels wide in the captured current view.

**Expected:** keep series identity independent of color mapping. Let the user select the existing low-cardinality class, or use constant color where appropriate. A high-cardinality legend should not make the chart unreadably small.

**Root evidence:** [plot-catalog.js](../../src/plot-catalog.js) requires a unique series identity and then unconditionally sets `color.field = group` in the `createRadarPlot` recipe. [field-set-plots.js](../../src/field-set-plots.js) supplies a low-cardinality default only where a separate color control exists; Radar has none.

**Captured evidence:** [screenshot](../../output/option-audit-2026-10-25/semantics/glass-radar-id-default.png), [program and resolved scales](../../output/option-audit-2026-10-25/semantics/glass-radar-id-default-program.json), and [saved project](../../output/option-audit-2026-10-25/semantics/glass-radar-id-default-project.json).

### S2 — Shrinking the legend does not release its automatically reserved canvas height

**Priority: P1.** Continue S1 → apply the radar dimension edit described in S3/S4 → Encoding → search `encodeColor` → select `class` → Apply. The recorded reproduction includes that intervening dimension edit; a direct S1-to-color sequence was not independently captured.

The color domain drops from 214 IDs to six classes, but the canvas stays 700 × 3920.5 and the plot stays 314 × 314. Immediately before the color edit, the automatically generated top/bottom margins are 31.217445/3575.282555. Afterward they are 1789.217445/1817.282555. Space previously consumed by the legend remains as blank space, keeping the chart tiny.

**Expected:** recompute and release automatically reserved guide space when its content shrinks, while preserving geometry intentionally set by the user.

**Root evidence:** [prepare.js](../../src/prepare.js) regenerates guides and invokes `centerCanvasContent`. [canvas-centering.js](../../src/canvas-centering.js) requests a zero-resize margin redistribution and only accepts unchanged overall width/height. That path does not distinguish automatic reservations from intentional user geometry.

**Captured evidence:** [before color change](../../output/option-audit-2026-10-25/semantics/glass-radar-id-class-dimension-project.json), [after color change](../../output/option-audit-2026-10-25/semantics/glass-radar-id-class-color-project.json), [result screenshot](../../output/option-audit-2026-10-25/semantics/glass-radar-id-class-color.png), and [resolved scales](../../output/option-audit-2026-10-25/semantics/glass-radar-id-class-color-program.json).

### S3 — Radar dimension editing forgets the current semantic field types

**Priority: P2.** Continue S1 → Encoding → search `editRadarPlot` → select `class` in the dimension list → Apply.

The card offers `Id_number` and `class` as numeric dimensions even though this example explicitly marks both nominal and the initial chart excludes them. Applying `class` creates a tenth numeric radial axis with values 1, 2, 3, 5, 6, and 7.

**Expected:** owner-specific editors should preserve the same field-type overrides used by initial mapping. Treating a categorical code as a measurement must be an explicit change. This is a mismatch within one example session, not an expected loss of optional type hints when uploading a plain CSV.

**Root evidence:** [owned-chart-candidates.js](../../src/owned-chart-candidates.js) re-profiles `owner.source` without the incoming field-type overrides and then derives dimension choices from raw numeric fields.

**Captured evidence:** [card controls](../../output/option-audit-2026-10-25/semantics/glass-radar-id-edit-controls.html), [controls screenshot](../../output/option-audit-2026-10-25/semantics/glass-radar-id-edit-controls.png), and [applied dimension list](../../output/option-audit-2026-10-25/semantics/glass-radar-id-class-dimension-project.json).

### S4 — “Dimensions and order” conceals a reversal of the existing axes

**Priority: P2.** Continue S1 → Encoding → Edit radar dimensions. The buttons display `RI, Na, Mg, Al, Si, K, Ca, Ba, Fe` in source order. Select only `class` and Apply.

The applied `wide.fields` becomes `Fe, Ba, Ca, K, Si, Al, Mg, Na, RI, class`. Every existing axis reverses, despite unchanged visible button order and no reordering controls.

**Expected:** show the actual dimension sequence and provide explicit reorder controls. Changing membership should not silently reverse the existing sequence.

**Root evidence:** [owned-chart-candidates.js](../../src/owned-chart-candidates.js) seeds the editor using a reversed copy of `owner.transform.fields`. Its multiselect lacks `ordered: true`, so the source-choice order displayed in the card does not reveal the applied value order.

**Captured evidence:** [card markup](../../output/option-audit-2026-10-25/semantics/glass-radar-id-edit-controls.html), [card screenshot](../../output/option-audit-2026-10-25/semantics/glass-radar-id-edit-controls.png), and [applied project](../../output/option-audit-2026-10-25/semantics/glass-radar-id-class-dimension-project.json).

## Improvements, distinct from correctness defects

1. **Grouped-summary radar is unavailable.** Wine with `Alcohol`, `Malicacid`, `Ash`, `Magnesium`, `Proline`, and `class` has no unique selected row identity, so Radar is absent. Mean/median profiles by cultivar would be useful, but no card produces them. Glass without `Id_number` has the same restriction. This is a missing capability under the current identity contract, not a runtime failure. [Wine screenshot](../../output/option-audit-2026-10-25/semantics/wine-radar-failure.png).
2. **Radar needs an explicit normalization choice.** Glass Radar uses one radial domain `[0, 75.41]` across nine measurements with different units and ranges. Fe's range `[0, 0.51]` occupies only 1.06 logical pixels of the 157-pixel radius. Per-dimension normalized scales would make this dataset more interpretable; offer them explicitly alongside raw/common-unit scales. The current common scale is mathematically valid. [Resolved radial scale](../../output/option-audit-2026-10-25/semantics/glass-radar-id-default-program.json).
3. **Rate aggregation needs semantic guidance.** Income with `group`, `pct`, and `region` defaults to summed proportions in Bar, reaching 2.993; Area uses unweighted means. Both exactly match their visible parameters. A household-weighted regional share would instead use `sum(pct * total) / sum(total)` within each region/income bracket. Rate/weight awareness would improve defaults, but the observed arithmetic is not a bug. [Bar](../../output/option-audit-2026-10-25/semantics/income-bar-default.png), [Area](../../output/option-audit-2026-10-25/semantics/income-area-default.png), and [numerical checks](../../output/option-audit-2026-10-25/semantics/oracles.json).
4. **Year bins should disclose their intervals.** Temperature Area/Horizon use eight 20-year bins centered at 1890 through 2030, from observations covering 1880–2023. Every row survives, but the axis title is only `year`, which can make 2030 look like an observation. Bin labels or explicit interval notation would help. This follows the requested quantitative-X binning behavior; it is not row loss. [Area](../../output/option-audit-2026-10-25/semantics/temp-area-default.png), [Horizon](../../output/option-audit-2026-10-25/semantics/temp-horizon-default.png), and [checks](../../output/option-audit-2026-10-25/semantics/oracles.json).

## Independent numerical checks

All nine saved checks pass in [oracles.json](../../output/option-audit-2026-10-25/semantics/oracles.json). Coordinate and aggregate comparisons use an absolute tolerance of `1e-7`; categorical colors are compared exactly.

A separate [report cross-check](../../output/option-audit-2026-10-25/semantics/report-crosschecks.json) confirms that both PCP examples' resolved domains equal their raw per-dimension extents, and both Temperature binned datasets preserve every ordered `(year, temp)` pair rather than only matching the input row count.

| Captured state | Independently checked result |
| --- | --- |
| Wine Parallel coordinates | 178 paths × 5 dimensions = 890 Y-coordinate comparisons, each using its own raw-data extent |
| Glass Parallel coordinates | 214 paths × 9 dimensions = 1,926 Y-coordinate comparisons, including zeros |
| Wine Parallel coordinates, Proline log/full extent | 890 Y-coordinate comparisons; the other four scales remain linear and all 178 rows remain |
| Fashion-MNIST Scatter | 498 points, 996 X/Y-coordinate comparisons, and 498 categorical color comparisons; ten labels map to ten colors |
| Income Bar | Ten brackets retain numeric order; all 50 displayed grouped values match independent sums |
| Income Area | Ten brackets retain numeric order; all 50 upper-edge values match independent arithmetic means |
| Temperature Area | 144 source rows and 144 binned rows; all eight aggregate means match independent recomputation |
| Temperature Horizon | 144 source rows and 144 binned rows; all eight aggregate means match independent recomputation |
| Temperature Polar Line | 144 input rows and 144 vertices, including 78 negative-valued observations; radius domain is `[-0.48, 1.17]` |

No silent row loss or arithmetic discrepancy was found by those checks. Finite-coordinate assertions cover the listed PCP and Fashion mappings, not every coordinate of every tested chart. The polar check verifies vertex count and signed scale coverage rather than a complete geometric oracle.

## Exclusions and limits

- The raw runner labels the three unavailable initial cards as `interrupted`. Wine/Glass Radar without unique identity are capability gaps described above; Temperature Rose without any categorical field is an expected eligibility restriction. These are not three crashes.
- The audit does not claim to cover every parameter cross-product, every transformation, or all new datasets. The [parameter audit](option-audit-2026-10-25-parameters.md) and [composition audit](option-audit-2026-10-25-compositions.md) cover additional paths.
- A mock authenticated local browser session validates editor behavior, not live authentication, cloud persistence, or deployment.
