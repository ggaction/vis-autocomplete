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
// Compute only when opening the chooser, never for every pointer move.
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
