# Independent legend item movement

Status: approved and implemented; verification recorded below.

## Reproduced failure

Before this change, dragging `Legend items` resolved to its parent legend through
`moveTarget`. The resulting `editLegend` changes the block's `offset` and
`alongOffset`, moving its title as well as its items. A 10 px right / 6 px down
drag also moved the title by that amount in a unit scatterplot, a shared-legend
facet, and a shared-color adjacent composition. This is a selection-scope error,
not a Canvas rendering problem. At small display scales, neighboring legend
resize handles could also intercept a body drag; parent stacking contexts now
keep those handles below subpart hit areas.

The previous public API had block placement and title/item spacing, but rejected
two-dimensional item-only placement through `itemsOffset`.

## Implemented contract

```js
program.editLegend({
  target: 'plot',
  channel: 'color',
  itemsOffset: { x: 10, y: 6 },
});
```

- `itemsOffset` shifts the body of the selected legend block: symbols and labels,
  or the continuous gradient strip and its tick labels. Its title stays anchored.
- Coordinates are finite signed logical Canvas pixels, positive right/down,
  relative to the body's automatically laid-out position. Default is zero.
- A partial `{ x }` / `{ y }` preserves the other coordinate. Omission preserves
  intent; `itemsOffset: 'auto'` removes it. Reject empty/unknown fields, non-finite
  values, null, booleans, and unsupported strings atomically.
- Existing target/channel selection rules apply, including shared facet and
  composition legends. No new app-only action or raw graphic edit is introduced.
- Existing whole-legend placement continues to move the title and shifted body
  together. Item movement does not change `position`, `offset`, `alongOffset`,
  item spacing, title alignment, or any other block's stored settings.
- Body offsets survive style/scale/data/Canvas rematerialization and serialized
  public-call replay. Final painted bounds include the body offset for fitting,
  clipping and bounding boxes; offsets never accumulate during replay.
- The app resolves Items to its own native edit, preserves component identity
  through nested scopes, and deduplicates selected parents/children without
  applying the same drag twice. Consecutive Items drags coalesce independently
  from whole-Legend drags in History/code; Undo/Redo restores the exact state.

## Verification

- ggaction unit suite: 4,584 passed, including 42 independent-body cases covering
  categorical, sampled size, continuous gradient and combined legends;
  shared/per-cell facets; local/shared/nested adjacent charts; visibility,
  clipping, border bounds, partial/reset edits, scale/filter/Canvas changes,
  immutable failures, and serialized replay.
- App guide, typography, scope, history and resize checks: 71 passed. Tests cover
  complete displayed-guide promotion before a multi-selection edit, parent/child
  deduplication, independent history keys and whole-legend movement after a body edit.
- Browser: `test/browser/legend-items-movement.py` verifies real Shift selection,
  repeated pointer drags, title invariance, history coalescing and Undo/Redo in
  both Preview/Transition modes on unit/facet charts. Saved facet movement also
  survives reload. Screenshots remain ignored under `output/legend-items-movement/`.
- Documentation suite: 157 passed. Public types, inspection metadata, current
  contracts, generated action cards and reference documentation include the option.
- Production asset build and package artifact checks passed. The two new native
  modules raise the entry budget from 647 to 649; byte budgets remain unchanged.
- Broader contract sweep: 664/666 initially passed. The new package-entry failure
  was resolved and all 7 package tests then passed. The other failure is existing
  `cars-origin-histogram-facet` primitive/public title drift (title Y 21 vs 19;
  subtitle Y 47 vs 45). Loading all changed source modules from the unchanged
  library HEAD `53a5ecbb` reproduces the exact same failure. This change does not
  alter that fixture or claim that the entire contract suite is green.

No deployment or release tag is authorized by this change.
