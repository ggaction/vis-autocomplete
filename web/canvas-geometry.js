// Small, serializable geometry shared by the UI and native-preview worker.
export function canvasGeometry(program) {
  if (program.canvasGeometry) return program.canvasGeometry;
  const objects = program.graphicSpec?.objects;
  const canvas = objects?.canvas?.properties;
  if (!canvas) return null;
  const composition = program.compositionSpec;
  const child = composition && program.children?.[composition.children[0]];
  const source = child ?? program;
  const unit = source.graphicSpec.objects.canvas.properties;
  const margin = { top: 0, right: 0, bottom: 0, left: 0, ...source.materializationConfigs.canvas.margin };
  const placed = child && objects[objects.canvas.children.find(id => objects[id]?.type === 'canvas')]?.properties;
  return {
    width: canvas.width, height: canvas.height,
    margin, plot: { width: unit.width - margin.left - margin.right, height: unit.height - margin.top - margin.bottom },
    x: (placed?.x ?? 0) + margin.left, y: (placed?.y ?? 0) + margin.top,
    facet: Boolean(composition?.facet), composition: Boolean(composition),
    padding: composition ? { ...composition.padding } : null,
    columns: composition ? Math.min(composition.columns ?? 1, composition.children.length) : 1,
    rows: composition ? Math.ceil(composition.children.length / (composition.columns ?? 1)) : 1,
  };
}

// A cheap gesture-only estimate between authoritative native renders. Text
// fitting and guide repairs still come from ggaction before Apply/history.
export function projectCanvasGeometry(start, action) {
  if (action.method === 'editCompositionLayout') {
    const padding = action.args.padding, before = start.padding ?? {};
    const delta = side => (padding[side] ?? 0) - (before[side] ?? 0);
    return { ...start, padding, width: start.width + delta('left') + delta('right'),
      height: start.height + delta('top') + delta('bottom'), x: start.x + delta('left'), y: start.y + delta('top') };
  }
  const { plot, margin } = action.method === 'editFacetSource' ? action.args.action.options : action.args;
  const dw = plot.width - start.plot.width + margin.left + margin.right - start.margin.left - start.margin.right;
  const dh = plot.height - start.plot.height + margin.top + margin.bottom - start.margin.top - start.margin.bottom;
  return { ...start, plot, margin, width: Math.max(1, start.width + dw * (start.columns ?? 1)),
    height: Math.max(1, start.height + dh * (start.rows ?? 1)),
    x: start.x + margin.left - start.margin.left, y: start.y + margin.top - start.margin.top };
}

const clamp = (value, min, max = 4096) => Math.round(Math.max(min, Math.min(max, value)));

// Both edges move equally, retaining any intentional asymmetry for guides.
function growPair(values, first, second, delta, min) {
  const a = values[first] ?? 0, b = values[second] ?? 0;
  const change = Math.max(min - Math.min(a, b), Math.min(4096 - Math.max(a, b), delta));
  values[first] = a + change; values[second] = b + change;
}

// Always refit, even when shrinking: native dimensions and exported code remain
// independent of the uniform display scale. Reserve space for resize handles.
export function fitCanvasViewport(geometry, width, height) {
  const scale = Math.min(Math.max(0, width - 24) / geometry.width, Math.max(0, height - 24) / geometry.height);
  return { scale, left: (width - geometry.width * scale) / 2, top: (height - geometry.height * scale) / 2 };
}

// Every gesture is relative to its original state, never to its last preview.
export function resizeCanvasAction(start, handle, dx, dy) {
  dx = Math.round(dx); dy = Math.round(dy);
  const plot = { ...start.plot }, margin = { ...start.margin };
  const horizontal = handle.endsWith('e') || handle.endsWith('se');
  const vertical = handle.endsWith('s') || handle.endsWith('se');
  if (handle.startsWith('canvas')) {
    if (start.composition) {
      const padding = { ...start.padding };
      if (horizontal) growPair(padding, 'left', 'right', dx, 0);
      if (vertical) growPair(padding, 'top', 'bottom', dy, 0);
      return { method: 'editCompositionLayout', args: { padding } };
    }
    if (horizontal) growPair(margin, 'left', 'right', dx, 12);
    if (vertical) growPair(margin, 'top', 'bottom', dy, 12);
  } else {
    // Keep guide space while growing the plot symmetrically around its center.
    if (horizontal) plot.width = clamp(start.plot.width + 2 * dx, 32);
    if (vertical) plot.height = clamp(start.plot.height + 2 * dy, 32);
    if (handle.endsWith('w')) plot.width = clamp(start.plot.width - 2 * dx, 32);
  }
  const options = { plot, margin };
  return start.facet
    ? { method: 'editFacetSource', args: { action: { method: 'editCanvas', options } } }
    : { method: 'editCanvas', args: options };
}
