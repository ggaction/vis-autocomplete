# Branching graphical history

History offers **Linear View** and **Graph View**. Both use the same cursor and
retain every authored branch. The view choice is an account preference (or a
local preference when account preferences are unavailable).

## Design rationale

The layout follows the horizontal/vertical navigation tree in Figure 3 of
Shrinivasan and van Wijk, *Supporting the Analytical Reasoning Process in
Information Visualization* (CHI 2008): continuing an action sequence goes right;
reusing an earlier state creates a branch below it. Nodes contain chart
thumbnails and action captions, using the existing recommendation category
colors. The current state has a stronger outline, its ancestor path has darker
edges, and hover is a separate temporary preview.

At 100% zoom a graph card is **75px wide and half the Linear View card height**
(the existing linear card is 150px wide), measured when Graph View first opens.
Those base dimensions stay fixed. The default zoom fits **two rows**, including
the gap and outer padding, into the available height. Panel resizing adjusts this
default scale uniformly; manually chosen zoom stays unchanged. Neither resizing
nor zoom changes the node aspect ratio.
Captions retain readable type rather than scaling their font to 50%. The full
caption is available on hover, focus, and in the History header. This keeps a
compact overview while preserving the action's identity.

Each subtree occupies contiguous rows in branch creation order, keeping its
connectors out of other subtrees. Continuing a leaf keeps every existing node in
place. A later branch inserts one row immediately after its parent's existing
subtrees; only rows below that insertion shift down by one node height plus gap.
Horizontal positions and sibling order stay fixed. This avoids crossings with
the smallest row shift that preserves these ordered subtree bands. Layout uses
linear, iterative passes, stays identical after reload or Undo/Redo, and never
runs a force simulation. Wheel/trackpad scrolling and empty-space drag
pan the graph. Ctrl/Cmd + wheel or the +/− buttons zoom around the pointer or
viewport center. The percentage button restores the two-row default, **Fit** shows the whole
graph, and **Current** centers the active node without changing zoom. Below 50%,
lightweight rectangles replace thumbnails; double-click returns to detailed
100% zoom at that location. This prevents a zoomed-out long session from mounting
or replaying thousands of charts.

## Editing semantics

- Hover previews; crossing gaps holds the previous preview for 180ms so the next
  node transitions directly from it. Sustained blank space or leaving the graph
  restores the committed visualization. Re-entry cancels the pending return. Click restores
  the chosen state, its ggaction code, selections, and recommendation context.
- Applying after Undo adds a child, preserving the abandoned future. Merely
  visiting a node does not create a node.
- Undo follows the parent. Redo follows the last chosen child; jumping to a
  different branch updates that preference along its ancestor path.
- Linear View projects the selected root-to-leaf path, including its Redo tail.
- Consecutive direct moves/resizes replace the current leaf. Nodes that already
  have children cannot be overwritten. Changing variables after revisiting an
  old selection also preserves previous chart branches.
- Different dataset sessions retain separate trees. Explicit dataset Reset
  still resets that dataset's history.

## Storage and rendering

Project format 2 adds `session.graph = { version: 1, activeId, nodes }`. Each node
has `id`, `parentId`, and `preferredChildId`, corresponding to a snapshot in
`session.entries` in creation order. `session.index` is the active snapshot's
index in that complete list. The history model's `entries`/`index` accessors are
only the active-path projection; persistence must use `exportSession()`.

Format 1 projects remain readable and become a chain. Graph validation rejects
duplicate IDs, forward/missing parents, multiple roots, cycles, invalid preferred
children, and cursor mismatches before replaying any public ggaction calls.
Program snapshots and dataset source values remain separate from research event
logging. No new ggaction API or database schema is required.

Graph layout never materializes chart programs. Only visible nodes are mounted;
thumbnail generation yields between nodes and reuses a bounded 80-entry raster
cache. Edges use a viewport-sized Canvas, never a graph-sized bitmap. Existing
bounded native-program caches and lazy project restoration are reused. The graph
view does not render hidden Linear View thumbnails.

## Validation

- `node --test test/history-graph.test.js test/history.test.js test/resize-history.test.js test/project.test.js test/cloud-view-preferences.test.js`
- `python test/browser/history-graph.py --url http://127.0.0.1:5184`
- `python test/browser/history-graph-app.py --url http://127.0.0.1:5184`

The browser tests use native chart rendering. The editor test isolates Supabase
transport in its test browser and makes no production writes. It exercises both
Preview and Transition modes, branching Apply, keyboard Undo/Redo, facet,
variable reselection, exact code restoration, and actual draft reloads. The graph
fixture checks half-size base dimensions, two-row fit, unchanged aspect ratio
across zoom/panel resizing, hover, nested branch insertion, scroll, zoom, and
1,005-node virtualization. Geometry tests check connector crossings, node
overlaps, and row movement across interleaved branches, plus a 20,000-node chain.
