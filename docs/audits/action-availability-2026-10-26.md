# Action availability audit and fixes

The reported edited Rose chart lost **Add annotation** because the app offered it only for Cartesian coordinates. The native annotation API already supports a plot-relative text frame. Restoring the card also exposed a native facet-family check that treated that text frame as a second data chart.

## Fixed behavior and reproduction

| Reproduce | Root cause | Result |
| --- | --- | --- |
| Create Pie, Rose, Radial Bar, Polar Line, Polar Scatter, Radar or Parallel Coordinates; search Style for `annotation`. | A Cartesian-only candidate guard excluded valid public actions. Passing a polar/parallel coordinate directly to an X/Y annotation would also be invalid. | `createAnnotation({ anchor: 'plot-center', ... })` is offered with an independent plot-space frame. Text and appearance remain editable. Repeated notes receive distinct IDs. |
| Add a note before faceting a polar/parallel chart, or add one through the facet's source editor. | Native facet classification counted literal positioned text as a competing Cartesian chart. | Notes decorate each facet. Actual mixed-coordinate data layers remain rejected. Text-only charts still define their own coordinate family. |
| Open Transform on a Rose/Pie or Parallel Coordinates chart and look for category/observation filters. | Existing recipes depended on Cartesian channels and missed field-based filtering. | `filterMarks` cards use native final-item provenance: **Filter categories** supports multiple values and Select all; **Filter by variable** supports numeric thresholds. Changing variables refreshes the dependent values/range. Excluded categories remain available for restoration. |
| Search Style for radial/angular grid editing on a Rose chart. | The detailed grid candidate loop visited only horizontal/vertical directions. | `editRadialGrid` and `editThetaGrid` are searchable with width, color and dash controls. Ordinary hierarchy folding remains intact. |
| Add value labels to a Box plot. | The box body is a bar mark, but ordinary bar value/category content does not describe its statistics. | The label card falls back to real summary fields and defaults to the median. Choices show readable statistic names instead of generated field IDs. |
| Change positional variables in a colored arc, bar or high-cardinality Violin/Gradient chart. | Dropdowns could offer variables whose missingness, sector grain, positional roles or generated item count violated native requirements. | Incompatible choices are disabled with reasons. Existing native `missing: 'skip'` behavior remains available. Density-group limits use the native capacity constant. |
| Remove an X/Y axis, then edit an ECDF or endpoint plot's source variable. | Facade reconstruction restored construction-time guides, resurrecting the removed axis and blocking correct guide regeneration. | Reconstruction preserves axis presence independently for X/Y. An explicit later guide creation uses the new domain. |

Filter eligibility is based on fields that have one meaningful value per rendered item. A sector therefore cannot filter arbitrary member-row measurements, while one Parallel Coordinates path can filter its observation's fields. The new recipes reuse the learned `transform.filter` feature, with separate parameter-editor groups; applied-action ordering and revision suppression remain consistent. There is no app-only public action or modified shared prototype.

## Coverage and limits

The executable audit uses **29 chart definitions × four datasets** (Cars, Iris, Barley and Gapminder). Each case runs in a separate process to bound rendering/cache accumulation. Expected actions are probed through public ggaction calls independently of the recommendation provider, then checked against the actual calculation service's paginated decks with hierarchy folding disabled.

The audit covers default calls for every returned card, all enabled positional/owned-chart dropdown alternatives at their default companion settings, appearance encodings, source-variable editing, annotations, titles, canvas editing, value labels, filters, grid details and faceting. It does not enumerate every cross-product of every parameter, arbitrary uploaded schemas, or every public library function.

- 116 attempted cases; 112 valid chart/dataset pairs.
- Four explicit construction requirements were skipped: Horizon on Iris, Barley and Gapminder lacks a unique ordered X; Radar on Barley lacks three numeric dimensions.
- 3,837 returned cards: no missing supported methods in these probes and no invalid tested parameter calls.
- Cars uses the small representative fixture in `examples/scenarios.js`; the other three use the bundled datasets through the normal import normalization.
- `test/fixtures/edited-rose-annotation.json` preserves the user's authoring calls. Original data were not attached, so that exact call sequence is exercised with representative region rows. Full bundled Gapminder is checked separately, without claiming it is the original dataset.
- The broad positional audit also checks native chart-owner editors, rather than exposing implementation-level pieces of Radar/Raincloud as independent authoring controls. Horizon source-variable editing has no corresponding public facade and is not counted as an available action.

## Verification

- Native unit suite: **4,606 passed**. Native generated-reference checks passed.
- Application regression suite: **793 tests passed** across the full run and the two server-test retries. The server tests require the completed build; their initial missing-artifact failure was resolved by running them after the build, with both passing. Focused recommendation/parameter checks and the production asset build also passed.
- The browser check passes **six workflows**: Preview and Transition, each with single-chart, facet and adjacent-chart scopes. Each searches the actual card, edits note text, previews, applies, undoes/redoes, saves and reopens the saved project. No browser errors were observed. It uses an isolated mock account and makes no production/account writes.

Re-run from the repository root:

```sh
npm run build
npm test
npm run audit:coverage
npm --prefix vendor/ggaction run test:unit
```

For the browser check, start `PORT=5205 npm run dev`, then `node scripts/open-audit-browser.js` in another terminal. With Python Playwright installed, run:

```sh
python test/browser/noncartesian-actions.py --cdp http://127.0.0.1:9333
```

Audit JSON is regenerated in ignored `output/action-coverage/`; browser screenshots and saved-project fixtures are regenerated in ignored `output/noncartesian-actions/`. Source tests and the reproduction fixture are tracked. These changes do not create a release tag or deploy the service.
