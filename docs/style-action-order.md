# Style action ordering

Applying a high-level Style action moves its family behind unused actions. The included editors appear immediately before the applied action: for example, new actions → Edit X/Y axis → Adjust axes. Grid and Legend use the same semantic containment table as the existing recommendation hierarchy.

Only authored public calls advance usage. Internal calls made by chart or guide creation do not count. Covered descendants inherit the parent's history position, but remain distinct from explicitly applied actions so deeper editors do not all expand at once. Reapplying a child or parent updates its position from the immutable trace; Undo, Redo and restored projects use the same rule.

This is presentation ordering. Co-occurrence scores, applicability, parameters and the one-public-function-per-card contract stay intact. The eager engine and lazy worker use the same ordering before pagination. Search still reaches specific low-level actions directly. Legend ownership and channels, facet source calls and adjacent chart scopes retain separate histories.

If one card contains multiple channel alternatives, applying any alternative advances that card. Canvas geometry edits do not advance the separate background-color card; only an explicit background change does.

Coverage: `test/style-hierarchy-order.test.js`, existing action hierarchy and applied-action tests, and `test/browser/style-hierarchy-order.py` for Apply, packed pages and Undo/Redo in both display modes.
