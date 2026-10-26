# Mark highlighting integration

Status: public extensions explicitly approved by the user on 2026-10-26 ("이 API 확장으로 진행"); implemented and regression-tested.

## Existing contract

Each option card invokes `highlightMarks`. Predicate controls are derived from
the resolved final items, not a chart-name allowlist. Field conditions, ranges,
ranked selections, dimming and mark-compatible appearance use the existing API.
Facet source and composition paths retain native scoped targets.

## Approved public extensions

1. `highlightMarks({ id, target, select, ...style })` updates an existing highlight
   with that explicit ID on the same target atomically. Omitted IDs keep their
   existing creation behavior. A conflicting selection owned by another target
   is rejected. This permits one replayable action to revise both selection and
   appearance, without composing hidden app-only actions.
2. Add `select: { rows: { data: "dataset", indices: [2, 5] } }` for exact source
   observations, including identical rows. Indices are zero-based positions in
   the named dataset's materialized rows, not screen positions. Select final
   items containing any of those observations. Aggregated marks and series are
   selected as whole items; this never recolors an arbitrary part of a path.
   Reject invalid indices and unsupported lineage instead of guessing by value.
3. `getMarkItems(program, { target, grain? })` in `ggaction/inspection` exposes
   selectable semantic items with field/channel values, bounds and source-row
   references. It excludes raw graphic IDs. The app uses this same capability
   for card eligibility, table-row selection and canvas picking; unknown or
   incompatible targets return explicit diagnostics rather than silent absence.
4. A composite plot ID is a valid highlight target: the owning chart expands
   selection to its component marks atomically (box, whiskers, caps, median;
   cloud, summary and observations; endpoints and connectors). A concrete child
   mark ID remains a component-only target. Support text marks with color,
   opacity, font size and offset, using the same item-selection lifecycle.

## UI and verification

Use a Highlight marks card with Selection, Appearance and Context groups.
Multi-value conditions, ranges, top/bottom N and per-group ranking stay editable.
Direct selection stages the same native call; Apply commits it. Escape cancels.
Persist native arguments through history, project restore, code and export.

Verify all starting chart families, composite members, overlays, facets and
adjacent chart paths; filtered/aggregated/duplicate rows; repeated edits and
immutable failures; Canvas/SVG output; history replay; training feature coverage
and actual recommendation availability. Cache inspection by immutable program
identity and resolve detailed picking data only when selection is active.

## Implementation and validation

- Style recommendations derive their conditions from public final-item inspection,
  including all facet cells. Search, ranking and replay retain the native action.
- The Highlight toolbar stages exact rows or clicked marks; Shift-click adds/removes
  membership, Clear restores the original preview, Apply commits, and Escape cancels.
- Composite components retain a live owner selection. Re-encoding, faceting and
  draw-order changes preserve semantic row membership; removing the assignment
  restores the native baseline. Attached text labels use emitted text-item grain.
- Row lists render 50 entries per page. Large parameter value lists render 40 choices
  per page with search. Immutable inspection and selector context are weakly cached.
- Training now retains `action.highlightMarks` (10 corpus programs) and selection
  features instead of dropping their method prefixes.
- Automated coverage: all 29 starting chart families; source rows and available
  condition/grain combinations; composite ownership, duplicate rows, text, removal,
  facets and concat. Browser tests cover Preview/Transition × unit/facet/concat,
  actual click/Shift-click, cancellation, Apply, Undo/Redo and the native card editor.
- Local timing sample with 5,000 rows: initial selector inspection about 273 ms for
  scatter and 127 ms for parallel coordinates; repeated cached lookup below 0.001 ms.
  These are local measurements, not a latency guarantee on every device.

Reproduce with `node --test test/highlighting.test.js` and
`node scripts/test-highlighting-browser.js` (local development server on port 5187,
with isolated mocked account endpoints; no production writes).
