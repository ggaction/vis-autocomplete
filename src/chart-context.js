// A completed chart may use Cartesian, polar, parallel, ranged or one-axis
// geometry. The concrete owner covers recipes with implicit position channels.
export function hasChartContext(program, layer) {
  if (!layer) return false;
  const e = layer.encoding ?? {}, graphic = program.graphicSpec.objects[layer.id];
  return Boolean(e.x && e.y || e.theta && (e.radius || layer.mark.type === 'arc') || e.parallel ||
    layer.mark.type === 'rect' && (e.x && e.x2 || e.y && e.y2) ||
    !['point', 'line', 'bar', 'area'].includes(layer.mark.type) && (graphic?.items?.length || graphic?.properties));
}
