// Compositor-only feedback while native layout runs in the workers. Keep the
// rasterized SVG image at its native size and move/scale its layer, rather than
// re-rasterizing six SVG images at a different resolution on every pointermove.
// This temporary projection is never used for code, export or persisted state.
export function presentResizeVector(svg, source, target, canvasOnly = false, viewport) {
  if (!svg?.querySelector(':scope > image') || !source || !target || !viewport) return;
  const scale = viewport.scale;
  const sx = canvasOnly ? 1 : target.width / source.width;
  const sy = canvasOnly ? 1 : target.height / source.height;
  const x = (viewport.left ?? 0) + (canvasOnly ? target.x - source.x : 0) * scale;
  const y = (viewport.top ?? 0) + (canvasOnly ? target.y - source.y : 0) * scale;
  svg.setAttribute('viewBox', `0 0 ${source.width} ${source.height}`);
  Object.assign(svg.style, { position: 'absolute', left: '0', top: '0',
    width: `${source.width}px`, height: `${source.height}px`, maxWidth: 'none', maxHeight: 'none',
    transformOrigin: '0 0', willChange: 'transform',
    transform: `matrix(${sx * scale},0,0,${sy * scale},${x},${y})` });
}
