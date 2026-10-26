# Mark highlighting integration

Status: public extensions ready for review; existing API integration can proceed independently.

## Existing contract

Each option card invokes `highlightMarks`. Predicate controls are derived from
the resolved final items, not a chart-name allowlist. Field conditions, ranges,
ranked selections, dimming and mark-compatible appearance use the existing API.
Facet source and composition paths retain native scoped targets.

## Proposed public extensions

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
