# Chart element selection

- Click a chart title, subtitle, axis title, or legend part to pin its bounding box.
  Shift-click adds/removes an element. Clicking blank chart space or pressing Esc
  clears the selection. Selecting alone creates no history entry.
- The typography toolbar shows the selected element or selection count. Its size
  field, +/− buttons, and font picker affect only the selected text. Mixed sizes
  remain relative when using +/−.
- After selecting a legend part, open that toolbar's selection menu to choose
  **All legends**, **Legend**, **Title**, or **Items**. Items changes label text;
  symbol sizes and gradient dimensions stay unchanged. Hidden titles cannot be
  selected or accidentally recreated.
- Drag a selected element or its resize handle to transform the selection together.
  Movement uses the same chart-space delta; resizing uses the same scale factor
  from the start of the gesture. Group movement keeps existing docking edges
  so elements do not independently jump to different sides. Single-element
  dragging retains edge docking. Non-movable guides keep their position.
  Overlapping selections and repeated facet copies affect each owner once.
  One gesture creates one undoable history step; Esc cancels the entire preview.
  Consecutive moves of the same selection replace that move history entry and code.
- Dragging a title or legend still moves it. Legend item dragging moves its whole
  legend; outer resize handles still resize the legend and its contents. Clicking
  without dragging only selects. Existing delete controls and Undo/Redo remain.
- Selection survives font edits and Undo/Redo while its native owner exists. A new
  dataset/project clears it. Facet copies share their source-owned text settings;
  collected legends edit their shared contributors, while independent legends
  remain independent.

Selection scopes are UI state, not synthetic ggaction actions. Edits use existing
public `editTitle`, `editLegend`, axis-title editors, `editParallelAxis`,
`editFacetSource`, and composition target routing. Saved code and history replay
those native calls. Overlapping parent/child selections edit each text owner once.

Verification:

```sh
node --test test/guide-group.test.js test/element-selection.test.js test/chart-typography.test.js test/guide-manipulation.test.js test/guide-resize-factor.test.js
npm run build
node scripts/test-cloud-auth-browser.js
```

The browser suite uses fake authentication and imported fixtures; it exercises
both modes, Shift selection, font edits, hierarchy, hidden/deleted elements,
Undo/Redo, drag/resize, facets, shared legends and native project replay.
