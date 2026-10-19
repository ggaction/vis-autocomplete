const fittedBounds = new WeakMap();
const SVG_NS = 'http://www.w3.org/2000/svg';

// Fit display panels to painted chart content, rather than the canvas's large
// reserved guide margins. The recorded ggaction canvas and its aspect stay intact.
export function fitChartViewport(svg, program) {
  const cached = fittedBounds.get(program);
  if (cached) { svg.setAttribute('viewBox', cached); return; }
  if (!svg.isConnected) return;
  const original = svg.viewBox.baseVal;
  const content = svg.ownerDocument.createElementNS(SVG_NS, 'g');
  content.setAttribute('data-chart-content', '');
  let backgroundFound = false;
  for (const child of [...svg.children]) {
    if (['defs', 'title', 'desc', 'style', 'metadata'].includes(child.localName)) continue;
    const background = !backgroundFound && child.localName === 'rect' &&
      Number(child.getAttribute('x') ?? 0) === original.x && Number(child.getAttribute('y') ?? 0) === original.y &&
      Number(child.getAttribute('width')) === original.width && Number(child.getAttribute('height')) === original.height;
    if (background) { backgroundFound = true; continue; }
    content.append(child);
  }
  svg.append(content);
  const bounds = content.getBBox({ stroke: true, clipped: true });
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || !bounds.width || !bounds.height) return;
  const strokeWidth = Math.max(0, ...[...content.querySelectorAll('[stroke-width]')]
    .map(node => Number(node.getAttribute('stroke-width')) || 0));
  const padding = Math.max(6, strokeWidth / 2 + 2);
  const viewBox = `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`;
  fittedBounds.set(program, viewBox);
  svg.setAttribute('viewBox', viewBox);
}
