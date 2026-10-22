// Compositor-only feedback while native layout runs in the workers. Keep the
// Canvas bitmap at its native size and move/scale its layer, rather than
// re-rasterizing six chart surfaces at a different resolution on every pointermove.
// The bitmap must stay proportional: only native layout can change axis lengths
// without also deforming text, symbols, circles and legends. Between completed
// worker frames, fit the last real render uniformly inside the requested canvas.
// This temporary projection is never used for code, export or persisted state.
export function resizeVectorProjection(source, target, canvasOnly = false) {
  const sx = canvasOnly ? 1 : Math.min(target.width / source.width, target.height / source.height);
  const sy = sx;
  const x = canvasOnly ? target.x - source.x : (target.width - source.width * sx) / 2;
  const y = canvasOnly ? target.y - source.y : (target.height - source.height * sy) / 2;
  return { sx, sy, x, y, plot: { x: source.x * sx + x, y: source.y * sy + y,
    width: source.plot.width * sx, height: source.plot.height * sy } };
}

export function presentResizeVector(canvas, source, target, canvasOnly = false, viewport) {
  if (canvas?.localName !== 'canvas' || !source || !target || !viewport) return;
  const scale = viewport.scale;
  const projection = resizeVectorProjection(source, target, canvasOnly);
  const { sx, sy } = projection;
  const x = (viewport.left ?? 0) + projection.x * scale;
  const y = (viewport.top ?? 0) + projection.y * scale;
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0',
    width: `${source.width}px`, height: `${source.height}px`, maxWidth: 'none', maxHeight: 'none',
    transformOrigin: '0 0', willChange: 'transform',
    transform: `matrix(${sx * scale},0,0,${sy * scale},${x},${y})` });
  return projection;
}
