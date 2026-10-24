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
  result.canvasBounds = new Map();
  const visit = (view, childPath = [], x = 0, y = 0) => {
    const bounds = compositionPlotBounds(view);
    result.set(JSON.stringify(childPath), { ...bounds, x: x + bounds.x, y: y + bounds.y });
    const canvas = view.graphicSpec.objects.canvas.properties;
    result.canvasBounds.set(JSON.stringify(childPath), { x, y, width: canvas.width, height: canvas.height });
    if (!view.compositionSpec || view.compositionSpec.facet) return;
    const snapshot = prepareCompositionSnapshots(view);
    for (const child of snapshot.layout.children) visit(snapshot.children[child.id], [...childPath, child.id], x + child.x, y + child.y);
  };
  visit(program);
  return result;
}

// Place buttons outside each canvas, rather than on axis/plot resize handles.
// The fitted view reserves these lanes, so an edge never pushes buttons back
// onto the canvas. Keep the plot center as the tangential anchor.
export function adjacentHandlePositions(placements, bounds, viewport, size) {
  return ['left', 'right', 'top', 'bottom'].flatMap(position => {
    const horizontal = ['left', 'right'].includes(position), before = ['left', 'top'].includes(position);
    const root = bounds.canvasBounds?.get('[]');
    const rootEdge = root && (horizontal ? viewport.left : viewport.top) +
      ((horizontal ? root.x : root.y) + (before ? 0 : horizontal ? root.width : root.height)) * viewport.scale;
    const unique = new Map();
    for (const choice of placements) {
      const box = bounds.get(JSON.stringify(choice.childPath));
      if (!box) continue;
      const edge = horizontal ? box.x + (before ? 0 : box.width) : box.y + (before ? 0 : box.height);
      const span = horizontal ? [box.y, box.height] : [box.x, box.width];
      const key = [edge, ...span].map(value => Math.round(value * 100) / 100).join(':');
      unique.set(key, choice);
    }
    const handles = [...unique.values()].flatMap(choice => {
      const frame = bounds.get(JSON.stringify(choice.childPath));
      if (!frame) return [];
      const canvas = bounds.canvasBounds?.get(JSON.stringify(choice.childPath)) ?? frame;
      const x = viewport.left + canvas.x * viewport.scale, y = viewport.top + canvas.y * viewport.scale;
      const width = canvas.width * viewport.scale, height = canvas.height * viewport.scale;
      const offset = choice.grouped || placements.length === 1 ? 28 : 24;
      return [{ choice, position, x: horizontal ? x + (before ? -offset : width + offset) : viewport.left + (frame.x + frame.width / 2) * viewport.scale,
        y: horizontal ? viewport.top + (frame.y + frame.height / 2) * viewport.scale : y + (before ? -offset : height + offset) }];
    });
    const axis = horizontal ? 'x' : 'y', extent = horizontal ? size.width : size.height;
    // Shared legends can extend the outer canvas beyond the last child. A
    // child's button must not end up on that outer canvas's resize boundary.
    if (root) {
      const edge = rootEdge;
      for (const handle of handles) {
        const offset = handle.choice.grouped || placements.length === 1 ? 28 : 24;
        if (before ? handle[axis] < edge + 32 : handle[axis] > edge - 32) {
          handle[axis] = before ? Math.min(handle[axis], edge - offset) : Math.max(handle[axis], edge + offset);
        }
      }
    }
    const edge = before ? Math.min(...handles.map(handle => handle[axis])) : Math.max(...handles.map(handle => handle[axis]));
    const shift = before ? Math.max(0, 16 - edge) : Math.min(0, extent - 16 - edge);
    for (const handle of handles) handle[axis] += shift;
    // A small nested composition can put two panel controls on the same outer
    // edge. Separate those controls along the edge, keeping their outward gap.
    const tangent = horizontal ? 'y' : 'x', tangentExtent = horizontal ? size.height : size.width;
    for (let pass = 0; pass < handles.length; pass++) {
      let moved = false;
      for (let i = 0; i < handles.length; i++) for (let j = i + 1; j < handles.length; j++) {
        const a = handles[i], b = handles[j];
        if (Math.abs(a[axis] - b[axis]) >= 30 || Math.abs(a[tangent] - b[tangent]) >= 30) continue;
        const center = Math.max(31, Math.min(tangentExtent - 31, (a[tangent] + b[tangent]) / 2));
        const sign = a[tangent] <= b[tangent] ? 1 : -1;
        a[tangent] = center - sign * 15; b[tangent] = center + sign * 15; moved = true;
      }
      if (!moved) break;
    }
    return handles;
  });
}
