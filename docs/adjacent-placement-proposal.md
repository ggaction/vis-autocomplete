# Adjacent chart placement: panels and groups

Status: proposed; public API approval pending. Existing behavior is unchanged.

## User-facing behavior

An edge `+` opens a placement chooser before the chart-type cards. For `[A | B]`,
Bottom offers `Below A`, `Below B`, and `Below A + B`. Top, Left and Right offer
the equivalent choices. Selection highlights the affected panel/group boundary.
Overlays belong to their containing panel; they do not produce duplicate placement
choices. An existing nested group is a placement candidate alongside its leaf
panels and the overall composition. Names follow visible chart names and order,
not internal IDs. The selected chart remains the initial data source; a group with
multiple possible sources exposes explicit source selection.

```
Starting layout:       [ A | B ]

Below A:               [ A | B ]
                       [ C |   ]

Below B:               [ A | B ]
                       [   | C ]

Below A + B:           [ A | B ]
                       [   C   ]
```

These diagrams show containment, not exact canvas padding. Native plot alignment
continues to reserve space for axes, titles, and legends. The new chart spans the
chosen group's plot extent rather than stretching a rendered bitmap.

## Proposed public API extension

Keep `createAdjacentPlot` as the single public function for each recommendation.
Keep all existing leaf calls compatible. Extend `source` from `string` to
`string | { childPath: readonly string[]; id: string }`.

- `target.childPath` identifies the receiving panel or existing concat group.
  Omitted target selects the root view.
- A structured `source.childPath` is relative to that receiving view and identifies
  an explicit source panel; `source.id` is its base chart mark. It supplies data,
  encoding defaults, theme, and the default thickness of the new row/column.
- A concat receiver requires the structured source selector. No implicit first
  child/data-source selection occurs.
- Existing string-source calls on units/facets remain unchanged.
- For a group receiver, preserve the original group as one child of a new outer
  concat. Use the original composition ID as that child's ID; reject a new chart
  ID that collides with it. Other descendants retain their existing local IDs.
- Top/Bottom: new plot width equals the receiving group's plot-union width; its
  height starts from the source panel. Left/Right: new plot height equals the
  group's plot-union height; its width starts from the source panel.
- Existing `share`, `gap`, and `align` policies remain in force. Invalid shared
  field/type/domain combinations stay explicit validation errors.
- Existing group-local titles and guide edits remain attached to the original
  group. Normal existing composition rules govern shared outer guides.

Example, assuming the current root is `[area | bar]`:

```js
// Attach to the bar panel only (existing API).
program.createAdjacentPlot({
  target: { childPath: ["bar"] },
  source: "bar",
  id: "bottom",
  position: "bottom",
  plot: { action: "createLinePlot", options: { x: "Month", y: "Sales" } },
  share: { x: true },
  align: "plot"
});

// Attach below the complete group, using the bar panel's data.
program.createAdjacentPlot({
  source: { childPath: ["bar"], id: "bar" },
  id: "bottom",
  position: "bottom",
  plot: { action: "createLinePlot", options: { x: "Month", y: "Sales" } },
  share: { x: true },
  align: "plot"
});
```

For an inner group, pass its path as `target.childPath`, and a source path relative
to that group. UI placement and data-source choices are separate and visible.

## Implementation and verification checklist

1. Native action: resolve explicit group/source ownership, reuse native concat and
   plot sizing, synchronize types, inspection metadata, contract, API docs, and
   generated references. Preserve immutability, persistence, and one authored call.
2. App: enumerate leaf and existing group placement choices in visual order;
   highlight the chosen extent; retain source settings; scope setup calls to the
   source and creation to the receiving group. Update selected target paths after
   wrapping, including existing history/project restoration behavior.
3. Tests: all four edges for one panel, two siblings, a nested group, three panels,
   overlays and facets. Compare plot-union bounds, shared domains, legends/titles,
   scoped edits, undo/redo, saved project replay, and Canvas transitions.
4. Browser: create `[Area | Bar+Line]` and exercise all three placement scopes on
   each edge in both layouts/modes, including rapid hover and cancel.
5. Push verified library changes first, then the app/submodule checkpoint; verify
   remote hashes. This proposal does not authorize an npm release.
