# Adjacent chart placement: panels and groups

Status: implemented following the user's explicit approval on 2026-10-24 ("이 API 확장으로 진행할까? -> 이것도 ㅇㅇ").

Library checkpoint: `d5b7f59df14a8519d9ad056443e939662b6f9b12` on `codex/overlay-composition-v025`; pushed and remote hash verified.

## User-facing behavior

Each panel/group exposes its own spatial `+` handles; there is no placement menu.
For `[A | B]`, three bottom handles sit below A, below B, and in the center one
lane farther down for the whole group. Top, Left, and Right use the same rule.
Hover highlights the receiver; clicking immediately opens its chart-type cards.
This supersedes the original chooser design at the user's request.
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

## Approved public API extension

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

## Implementation and verification

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


### Verified evidence

- Native: 50 composition, inspection, and TypeScript checks passed; 28 API reference,
  documentation coverage, and executable example checks passed. Generated descriptors,
  action cards/catalogs, signatures, search, and machine references were checked.
- App: 34 targeted composition/placement/target tests passed; 21 placement and composition
  audit tests passed after the final source-selection adjustment; 19 project/history/draft
  tests passed. These suites overlap.
- `test/browser/adjacent-placement.py`: all 24 combinations of four edges, three
  placement scopes, and Preview/Transition modes passed on the Stocks Area + Bar/Line
  composition. Hover highlights and repeated card transitions were exercised.
- Narrow vertical controls were visually checked at 1350 px, with no horizontal
  overflow; explicit source changes and Escape/cancel cleanup passed.
- Saved project reopening and Undo/Redo passed. Immediate refresh exposed a delayed
  history-save path; persistence now starts before recommendation preparation. The
  saved-project/refresh/Undo/Redo/nested-chooser checks passed after that correction.
- Native fixtures also cover nested groups, explicit alternate sources, facet sources,
  invalid sources, retained local titles, a single shared color guide, and replay.
- Local browser evidence is under ignored `output/adjacent-placement/`; no exported
  project/data files are committed. Existing transition APIs handle the new compositions;
  no transition package change or npm publication was needed.


### Spatial handle revision

The placement menu was removed in response to the user's correction. Each real
panel and existing group now has a direct `+` on each edge. A group's handle is
30 px farther out than its descendants; for two columns the bottom handles read
left panel, whole row slightly lower in the center, right panel. Hover highlights
the affected bounds, and clicking opens chart cards without an intermediate dialog.
Handles follow fitted chart geometry and view resizing; geometry is computed once
per program revision. The option-card heading retains a text placement label.

Validation: 15 placement/geometry tests, the 24-case browser matrix with spatial
ordering checks, and saved-project/Undo/Redo/nested-handle restoration. The 1350 px
vertical layout was visually inspected; its twelve edge buttons do not overlap.

### Resize-handle clearance

Add controls now anchor outside each panel's canvas, including its guides, rather
than outside only its plot. Display fitting reserves a fixed 44 px clearance;
nesting never adds more whitespace or shrinks the chart further. Authored canvas
dimensions and exports do not change. Transition previews and the
Preview-to-Current transfer use the same fit.
Shared-guide extensions are included when avoiding the outer canvas resize strip.
When a narrow nested layout puts multiple buttons on the same edge, they separate
along that edge instead of covering one another. Placement regression checks also
verify button visibility, clearance from resize hit areas and independent clicks.

Equivalent exposed edges (same plot boundary and span) retain only the enclosing
group's button: the top of a vertical stack has one outer add control. Distinct
panel and whole-row spans remain separate. Controls appear only within 48 px of
their individual location, with only the closest one shown. Leaving the view
hides them; keyboard focus still reveals a control. Invisible controls cannot
intercept pointer events, and hovering a resize handle takes priority.
