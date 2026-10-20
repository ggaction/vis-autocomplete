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
  };
}

const clamp = (value, min, max = 4096) => Math.round(Math.max(min, Math.min(max, value)));

// Every gesture is relative to its original state, never to its last preview.
export function resizeCanvasAction(start, handle, dx, dy) {
  dx = Math.round(dx); dy = Math.round(dy);
  const plot = { ...start.plot }, margin = { ...start.margin };
  const horizontal = handle.endsWith('e') || handle.endsWith('se');
  const vertical = handle.endsWith('s') || handle.endsWith('se');
  if (handle.startsWith('canvas')) {
    if (start.composition) {
      const padding = { ...start.padding };
      if (horizontal) padding.right = clamp((padding.right ?? 0) + dx, 0);
      if (vertical) padding.bottom = clamp((padding.bottom ?? 0) + dy, 0);
      return { method: 'editCompositionLayout', args: { padding } };
    }
    if (horizontal) margin.right = Math.max(12, Math.min(4096, margin.right + dx));
    if (vertical) margin.bottom = Math.max(12, Math.min(4096, margin.bottom + dy));
  } else {
    if (horizontal) {
      plot.width = clamp(start.plot.width + dx, 32);
      margin.right = Math.max(12, margin.right + start.plot.width - plot.width);
    }
    if (vertical) {
      plot.height = clamp(start.plot.height + dy, 32);
      margin.bottom = Math.max(12, margin.bottom + start.plot.height - plot.height);
    }
    // Drag the vertical (Y) axis to the left to lengthen X, keeping its far end.
    if (handle.endsWith('w')) {
      const delta = Math.min(dx, start.plot.width - 32, 4096 - margin.left);
      margin.left = clamp(start.margin.left + delta, 12);
      plot.width = clamp(start.plot.width + start.margin.left - margin.left, 32);
    }
  }
  const options = { plot, margin };
  return start.facet
    ? { method: 'editFacetSource', args: { action: { method: 'editCanvas', options } } }
    : { method: 'editCanvas', args: options };
}
