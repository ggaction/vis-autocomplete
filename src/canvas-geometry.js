import { resolveConcreteGraphicBounds } from '../vendor/ggaction/src/grammar/schemas/graphicBounds.js';
const geometries = new WeakMap();
// Small, serializable geometry shared by the UI and native-preview worker.
export function canvasGeometry(program) {
  if (program.canvasGeometry) return program.canvasGeometry;
  if (geometries.has(program)) return geometries.get(program);
  const objects = program.graphicSpec?.objects;
  const canvas = objects?.canvas?.properties;
  if (!canvas) return null;
  const composition = program.compositionSpec;
  const child = composition && program.children?.[composition.children[0]];
  const source = child ?? program;
  const unit = source.graphicSpec.objects.canvas.properties;
  const margin = { top: 0, right: 0, bottom: 0, left: 0, ...source.materializationConfigs.canvas.margin };
  // Materialized child canvases follow composition.children; promoted legends
  // are appended separately and must never count as facet panels.
  const roots = composition ? objects.canvas.children.filter(id => objects[id]?.type === 'canvas')
    .slice(0, composition.children.length) : [];
  const placed = child && objects[roots[0]]?.properties;
  const grid = composition?.facet?.grid;
  const columns = composition ? composition.columns ?? 1 : 1;
  const rows = grid ? grid.rows.values.length : composition ? Math.ceil(composition.children.length / columns) : 1;
  const panels = composition?.facet ? roots.map((id, index) => {
    const bounds = canvasGeometry(program.children[composition.children[index]]);
    const position = objects[id].properties;
    return { x: (position.x ?? 0) + bounds.x, y: (position.y ?? 0) + bounds.y, ...bounds.plot };
  }) : null;
  // Keep authored per-cell plot dimensions separate from the visible grid.
  const plotBounds = panels?.length ? {
    x: Math.min(...panels.map(p => p.x)), y: Math.min(...panels.map(p => p.y)),
    width: Math.max(...panels.map(p => p.x + p.width)) - Math.min(...panels.map(p => p.x)),
    height: Math.max(...panels.map(p => p.y + p.height)) - Math.min(...panels.map(p => p.y)),
  } : null;
  const geometry = {
    controlInset: 44,
    content: resolveConcreteGraphicBounds(program.graphicSpec, 'canvas', program.materializationConfigs.textMetrics),
    spacing: composition?.spacing,
    width: canvas.width, height: canvas.height,
    margin, plot: source.materializationConfigs.canvas.plot ?? { width: unit.width - margin.left - margin.right, height: unit.height - margin.top - margin.bottom },
    x: (placed?.x ?? 0) + margin.left, y: (placed?.y ?? 0) + margin.top,
    facet: Boolean(composition?.facet), composition: Boolean(composition),
    padding: composition ? { ...composition.padding } : null,
    columns, rows,
    ...(plotBounds ? { plotBounds } : {}),
  };
  geometries.set(program, geometry);
  return geometry;
}

// A cheap gesture-only estimate between authoritative native renders. Text
// fitting and guide repairs still come from ggaction before Apply/history.
export function projectCanvasGeometry(start, action) {
  for (const setup of action.setupCalls ?? []) start = projectCanvasGeometry(start, setup);
  if (action.method === 'editCompositionLayout') {
    const padding = action.args.padding, before = start.padding ?? {};
    const delta = side => (padding[side] ?? 0) - (before[side] ?? 0);
    return { ...start, padding, width: start.width + delta('left') + delta('right'),
      height: start.height + delta('top') + delta('bottom'), x: start.x + delta('left'), y: start.y + delta('top'),
      ...(start.plotBounds ? { plotBounds: { ...start.plotBounds,
        x: start.plotBounds.x + delta('left'), y: start.plotBounds.y + delta('top') } } : {}) };
  }
  const { plot, margin } = action.method === 'editFacetSource' ? action.args.action.options : action.args;
  const dw = (plot.width - start.plot.width) * (start.columns ?? 1) +
    (margin.left + margin.right - start.margin.left - start.margin.right) * (start.spacing === 'plot' ? 1 : start.columns ?? 1);
  const dh = (plot.height - start.plot.height) * (start.rows ?? 1) +
    (margin.top + margin.bottom - start.margin.top - start.margin.bottom) * (start.spacing === 'plot' ? 1 : start.rows ?? 1);
  return { ...start, plot, margin, width: Math.max(1, start.width + dw),
    height: Math.max(1, start.height + dh),
    x: start.x + margin.left - start.margin.left, y: start.y + margin.top - start.margin.top,
    ...(start.plotBounds ? { plotBounds: { ...start.plotBounds,
      x: start.plotBounds.x + margin.left - start.margin.left, y: start.plotBounds.y + margin.top - start.margin.top,
      width: start.plotBounds.width + (plot.width - start.plot.width) * start.columns +
        (start.spacing === 'plot' ? 0 : start.columns - 1) * (margin.left + margin.right - start.margin.left - start.margin.right),
      height: start.plotBounds.height + (plot.height - start.plot.height) * start.rows +
        (start.spacing === 'plot' ? 0 : start.rows - 1) * (margin.top + margin.bottom - start.margin.top - start.margin.bottom) } } : {}) };
}

const clamp = (value, min, max = 4096) => Math.round(Math.max(min, Math.min(max, value)));

// Center the occupied chart (including native guides), not the plot rectangle.
// Required guide space stays asymmetric; only unused space is split equally.
function resizePair(start, margin, padding, first, second, delta, length) {
  const bounds = start.content;
  const before = first === 'left' ? bounds.left : bounds.top;
  const after = start[length] - (second === 'right' ? bounds.right : bounds.bottom);
  const count = start.composition && start.spacing !== 'plot' ? (length === 'width' ? start.columns : start.rows) : 1;
  const requiredFirst = margin[first] + (padding?.[first] ?? 0) - before;
  const requiredSecond = margin[second] + (padding?.[second] ?? 0) - after;
  const free = Math.max(6, Math.min(4096 - Math.max(requiredFirst, requiredSecond), (before + after) / 2 + delta / count));
  for (const [side, blank] of [[first, before], [second, after]]) {
    const total = Math.max(0, margin[side] + (padding?.[side] ?? 0) + free - blank);
    if (padding) {
      // Spend outer padding before touching source margins. This also lets a
      // zero-padding facet shrink whitespace retained inside its source Canvas.
      const required = Math.max(0, side === first ? requiredFirst : requiredSecond);
      padding[side] = Math.min(padding[side] ?? 0, Math.max(0, total - required));
      margin[side] = total - padding[side];
    } else margin[side] = total;
    margin[side] = Number(margin[side].toFixed(6));
    if (padding) padding[side] = Number(padding[side].toFixed(6));
  }
}

// Always refit, even when shrinking: native dimensions and exported code remain
// independent of the uniform display scale. Reserve space for resize handles.
export function fitCanvasViewport(geometry, width, height) {
  const inset = geometry.controlInset ?? 12;
  const scale = Math.min(Math.max(0, width - inset * 2) / geometry.width, Math.max(0, height - inset * 2) / geometry.height);
  return { scale, left: (width - geometry.width * scale) / 2, top: (height - geometry.height * scale) / 2, inset };
}

// Every gesture is relative to its original state, never to its last preview.
export function resizeCanvasAction(start, handle, dx, dy) {
  dx = Math.round(dx); dy = Math.round(dy);
  const plot = { ...start.plot }, margin = { ...start.margin };
  const horizontal = handle.endsWith('e') || handle.endsWith('se');
  const vertical = handle.endsWith('s') || handle.endsWith('se');
  if (handle.startsWith('canvas')) {
    if (start.composition && !start.facet) {
      const padding = { ...start.padding };
      for (const [first, second, delta] of [['left','right',horizontal ? dx : 0], ['top','bottom',vertical ? dy : 0]]) {
        const change = Math.max(-Math.min(padding[first],padding[second]),delta);
        padding[first] += change; padding[second] += change;
      }
      return { method: 'editCompositionLayout', args: { padding } };
    }
    const padding = start.composition ? { ...start.padding } : null;
    // Center both dimensions, even when the user grabs just one edge.
    resizePair(start, margin, padding, 'left', 'right', horizontal ? dx : 0, 'width');
    resizePair(start, margin, padding, 'top', 'bottom', vertical ? dy : 0, 'height');
    const options = { plot, margin };
    const action = start.facet
      ? { method: 'editFacetSource', args: { action: { method: 'editCanvas', options } } }
      : { method: 'editCanvas', args: options };
    if (padding && Object.keys(padding).some(side => padding[side] !== start.padding[side])) {
      action.setupCalls = [{ method: 'editCompositionLayout', args: { padding } }];
    }
    return action;
  } else {
    // Keep guide space while growing the plot symmetrically around its center.
    // The handle encloses the entire facet grid, not one cell. Distribute the
    // full-grid displacement so the grabbed edge follows the pointer once.
    const columns = start.facet ? start.columns : 1, rows = start.facet ? start.rows : 1;
    if (horizontal) plot.width = clamp(start.plot.width + 2 * dx / columns, 32);
    if (vertical) plot.height = clamp(start.plot.height + 2 * dy / rows, 32);
    if (handle.endsWith('w')) plot.width = clamp(start.plot.width - 2 * dx / columns, 32);
  }
  const options = { plot, margin };
  return start.facet
    ? { method: 'editFacetSource', args: { action: { method: 'editCanvas', options } } }
    : { method: 'editCanvas', args: options };
}
