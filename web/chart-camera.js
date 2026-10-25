export function zoomCamera(camera, zoom, anchor, size) {
  zoom = Math.max(.5, Math.min(4, zoom));
  const ratio = zoom / camera.zoom;
  const limit = side => Math.max(0, (zoom - 1) * side / 2);
  const clamp = (value, side) => Math.max(-limit(side), Math.min(limit(side), value));
  return { zoom, x: clamp(anchor.x - (anchor.x - camera.x) * ratio, size.width),
    y: clamp(anchor.y - (anchor.y - camera.y) * ratio, size.height) };
}

