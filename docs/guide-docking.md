# Guide dragging and docking

A small drag moves a title or legend continuously. A drag of at least 48 screen pixels docks it at the nearest plot edge. Docking resets accumulated along-edge displacement and uses the occupied axis/header lane for clearance, including facet and nested composition bounds. A large move on the same edge also redocks it instead of retaining an arbitrarily large gap.

Dragging an unselected legend body or title moves the whole visible legend. Clicking to select Items keeps body-only movement: symbols and labels move while the title stays fixed. Selection, typography, resizing and explicit item offsets retain their separate scopes.

Docking uses public `editTitle` / `editLegend` calls. Item legends use measured painted labels and glyphs to choose columns that fit the plot width, retain all visible entries, flow horizontally at top/bottom, and return to one column at left/right. Gradients rotate their strip. The opacity family keeps its native position-derived layout. The Adjust legend card uses the same packing policy. Small subsequent nudges carry the current layout so coalescing multiple drags into one history entry cannot restore an old one-column configuration.

Selecting all blocks of one native owner uses `channel: 'all'` with wrapping horizontal or column side layout. A subset stays independent and receives its own clear outside lane. Local panel edits precede collected composition legends, whose final clearance is recomputed after those edits. Both movement and any required space allocation remain replayable public calls in one UI history transaction.

Native explicitly positioned legend groups still reject insufficient Canvas space atomically. Their diagnostic now includes exact overflow while forbidding native automatic growth. The app allocates the required margin through a separate `editCanvas` call before retrying. No release or deployment is part of this change.

Regression coverage: `test/guide-docking.test.js`, guide position/group/manipulation and legend parameter tests; native legend group/all-selection contracts. `test/browser/guide-docking.py` exercises natural pointer drags, title docking, multiple selection, a nudge after docking, history coalescing, and Undo/Redo in Preview and Transition for unit, facet and adjacent views. `test/browser/legend-items-movement.py` protects independent Items dragging.
