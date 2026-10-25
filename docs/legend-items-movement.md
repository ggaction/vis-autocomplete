# Independent legend item movement

Status: proposed public API; implementation awaits approval.

## Reproduced failure

Dragging `Legend items` currently resolves to its parent legend through
`moveTarget`. The resulting `editLegend` changes the block's `offset` and
`alongOffset`, moving its title as well as its items. A 10 px right / 6 px down
drag also moved the title by that amount in a unit scatterplot, a shared-legend
facet, and a shared-color adjacent composition. This is a selection-scope error,
not a Canvas hit-testing problem.

The current public API has block placement and title/item spacing, but no
two-dimensional item-only placement. It rejects `itemsOffset` today.

## Proposed contract

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

## Verification before completion

Cover categorical, sampled size, continuous gradient and combined legend
families; shared/per-cell facets; local/shared/nested adjacent charts; title
hidden/shown; offsets in both directions; complete and partial resets; text and
Canvas resize; scale/filter replay; rejected input immutability; exact saved-call
replay; multi-selection; and pointer drag/Undo/Redo in the local browser. Check
that only the body moves relative to the title and plot, and that dragging the
whole legend still moves both. Update ggaction declarations, inspection metadata,
the owning contract and API documentation with the implementation.

No deployment or release tag is authorized by this change.
