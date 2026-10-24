import { editableChartTargetGroups } from './composition-context.js';
import { compositionPlotBounds, prepareCompositionSnapshots } from '../vendor/ggaction/src/materialization/composition.js';

export const containsPath = (parent, child) => parent.every((id, index) => child[index] === id);

// Existing containers are the only group choices. Overlays and generated facet
// cells belong to their panel and must not create duplicate placement choices.
export function adjacentPlacements(program) {
  const panels = editableChartTargetGroups(program);
  const visit = (view, childPath = []) => {
    const members = panels.filter(panel => containsPath(childPath, panel.childPath));
    const sources = members.flatMap(panel => panel.targets.filter(target => !target.overlay));
    const grouped = Boolean(view.compositionSpec && !view.compositionSpec.facet);
    const label = grouped && !childPath.length ? 'All charts' : members
      .map(panel => panel.targets.map(target => target.label).join(' / ')).join(' + ');
    const choice = { childPath, label, grouped, sources };
    return grouped ? [...view.compositionSpec.children.flatMap(id => visit(view.children[id], [...childPath, id])), choice] : [choice];
  };
  return visit(program).filter(choice => choice.sources.length);
}

export function placementLabel(position, label) {
  return `${{ left: 'Left of', right: 'Right of', top: 'Above', bottom: 'Below' }[position]} ${label}`;
}

// Use materialized snapshots: shared plot alignment can resize authored children.
// Compute once per program revision, never for every pointer move.
export function adjacentPlacementBounds(program) {
  const result = new Map();
  const visit = (view, childPath = [], x = 0, y = 0) => {
    const bounds = compositionPlotBounds(view);
    result.set(JSON.stringify(childPath), { ...bounds, x: x + bounds.x, y: y + bounds.y });
    if (!view.compositionSpec || view.compositionSpec.facet) return;
    const snapshot = prepareCompositionSnapshots(view);
    for (const child of snapshot.layout.children) visit(snapshot.children[child.id], [...childPath, child.id], x + child.x, y + child.y);
  };
  visit(program);
  return result;
}

// Group handles sit one lane farther out than the panels they contain. Move a
// whole edge's lanes inward when space is tight, preserving their hierarchy.
export function adjacentHandlePositions(placements, bounds, viewport, size) {
  const levels = new Map();
  for (const choice of placements) {
    const descendants = placements.filter(other => other.childPath.length > choice.childPath.length && containsPath(choice.childPath, other.childPath));
    levels.set(choice, descendants.length ? 1 + Math.max(...descendants.map(other => levels.get(other) ?? 0)) : 0);
  }
  return ['left', 'right', 'top', 'bottom'].flatMap(position => {
    const horizontal = ['left', 'right'].includes(position), before = ['left', 'top'].includes(position);
    const handles = placements.flatMap(choice => {
      const frame = bounds.get(JSON.stringify(choice.childPath));
      if (!frame) return [];
      const x = viewport.left + frame.x * viewport.scale, y = viewport.top + frame.y * viewport.scale;
      const width = frame.width * viewport.scale, height = frame.height * viewport.scale;
      const offset = 36 + levels.get(choice) * 30;
      return [{ choice, position, x: horizontal ? x + (before ? -offset : width + offset) : x + width / 2,
        y: horizontal ? y + height / 2 : y + (before ? -offset : height + offset) }];
    });
    const axis = horizontal ? 'x' : 'y', extent = horizontal ? size.width : size.height;
    const edge = before ? Math.min(...handles.map(handle => handle[axis])) : Math.max(...handles.map(handle => handle[axis]));
    const shift = before ? Math.max(0, 16 - edge) : Math.min(0, extent - 16 - edge);
    return handles.map(handle => ({ ...handle, [axis]: handle[axis] + shift }));
  });
}
