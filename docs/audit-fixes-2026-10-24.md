# Option-card audit fixes — 2026-10-24

This checkpoint addresses the 23 findings in the dataset and option-parameter audit.
Every recommendation still calls one public ggaction function. Required data or
layout preparation is explicit, replayable setup; hover, Apply, code and saved
projects use the same prepared result. Corpus co-occurrence scoring is unchanged.

## Changes

| Finding | Result |
| --- | --- |
| COMP-01 | Overlay encodings retain materialized scale domains through facet/filter rebuilds, including category counts absent from individual panels. |
| COMP-02 | Applying an overlay selects that overlay as the next editing target. |
| COMP-03 | Adjacent charts inherit the full shared source scale; incompatible independent choices explain the sharing constraint. |
| COMP-04 | Edit overlay exposes Source/Total following, allowing a total overlay to return to source-series endpoints before regrouping bars. |
| COMP-05 | Position editors retain the current variable while changing aggregate, bins or scale. |
| COMP-06 | Nested compositions disclose inherited sharing and expose each container's own shared-scale policy. |
| COMP-07 | Signed bars offer Diverging layout; positive-only Stack/Fill explain their unavailable state. |
| U01 | Raincloud palette edits preserve the categorical group-color role across compound marks and serialization. |
| U02 | Heatmap continuous/categorical color reassignment updates its scale and legend family together, preserving unrelated consumers. |
| U03 | Radar grouping and facets use source observations, excluding the generated dimension field. |
| U04 | Box cards expose whisker mode/factor, outlier and median/box appearance controls instead of opaque presets. |
| U05 | Color-scale cards expose direction, valid transforms, custom domain and midpoint. |
| U06 | Large-value Box axes fit non-linear ticks without losing the selected scale. |
| SD-01 | PDF export rounds only the outer page dimensions up to native integer units; authored geometry and SVG dimensions remain unchanged. Renderer errors are no longer misreported as oversized HTTP requests. |
| SD-02 | Native PNG/PDF text retains the requested font first and appends installed script fallbacks for missing glyphs. No fonts are downloaded or bundled. |
| SD-03 | Duplicate, mixed-type and invalid category orders fail schema review/import before chart creation. |
| SD-04 | Legend cards expose Show all/Limit and an entry count. Large in-plot legends grow their containing plot through explicit setup instead of silently dropping entries or changing placement. |
| ROOT-01 | Axis-title cards use label-relative gaps. Guide recovery preserves the axis being edited. |
| ROOT-02 | Add regression exposes polynomial degree, LOESS span/robust iterations, interval type and confidence level before Apply. |
| ROOT-03 | Statistical-reference population labels distinguish visible marks, aggregated axis values and original observations, including counts. Original-observation statistics use the native explicit-field contract. |
| MINOR-01 | Rug edges resolve the current physical axis and scale path; left/right no longer create contradictory X and Y bindings. |
| SD-X01 | Statistical groups follow the selected axis and population, preventing unavailable source fields on derived Y values. |
| SD-X02 | Horizon calendar choices that leave fewer than two dates show the concrete constraint before Apply. |

Unsupported combinations remain visible with a reason rather than creating a
misleading preview. This includes facet shared legends at unsupported inside
corners, source-incompatible total overlays and positive-only layouts with signed
values. These constraints do not change native public API contracts.

Boundary validation also caught overlapping automatic Symlog color-legend ticks
and missing native margin-growth metadata for large label-relative axis titles.
Gradient legends now space automatic transformed ticks in display coordinates;
explicit tick values are preserved. Label-relative titles use the existing native
guide-fitting transaction, with no app-specific margin retry.

## Regression checks

```sh
node --test test/audit-composition-contracts.test.js \
  test/audit-option-contracts.test.js test/audit-guide-recovery.test.js \
  test/legend-overflow-fit.test.js test/data-import.test.js test/chart-download.test.js
npm test
npm run build:workers
npm --prefix vendor/ggaction run test:unit
```

Native regressions are in `linked-overlay-rematerialization.test.js`,
`raincloud-owner-operations.test.js`, `color-reassignment-legend.test.js` and
`native-font-fallback.test.js`. Their coverage includes linked materialization,
compound mark colors, shared scale isolation, legend-family transitions,
immutability, serialization and native output. App tests exercise the candidate,
parameter builder and prepared public call together, rather than checking only
that a control exists.

Browser validation uses isolated profiles and the real cards, parameter controls,
Apply, target selection and download buttons. Generated reports, screenshots and
exports remain under ignored `output/system-audit-fixes-2026-10-24/`.

Verification: the full app suite passed 408 tests. After the final boundary fixes,
all 46 focused audit/import/export tests passed, including a 72-combination title
gap/font matrix. The final native unit suite passed 4,321 tests; related contract
checks passed 49 tests. These counts overlap and must not be summed. Browser work
covered seven composition scenarios, 13 option-card scenarios with 14 successful
Apply/export-replay steps, the original large-population Box and axis-title cases,
schema correction, and actual PDF/PNG/SVG downloads from restored projects.

The checked-in submodule reference identifies the exact library source consumed
by Node and browser workers. Source pushes do not imply npm publication or public
documentation deployment. Installed-font availability remains environment-specific;
the fallback fix cannot supply a script for which no installed font has glyphs.
