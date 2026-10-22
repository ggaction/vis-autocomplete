const SVG_NS = 'http://www.w3.org/2000/svg';
const sources = new WeakMap();

// A thumbnail keeps the full native SVG as an isolated vector image, rather
// than adding every mark to the application's live DOM. Its outer SVG retains
// the same sizing/accessibility contract as the full Current/Preview chart.
export function renderChartThumbnail(host, program, source, label) {
  let asset = sources.get(program);
  if (!asset) {
    const root = source.match(/<svg\b[^>]*>/)?.[0] ?? '';
    const attribute = name => root.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
    const viewBox = attribute('viewBox') ?? `0 0 ${attribute('width')} ${attribute('height')}`;
    const bounds = viewBox.trim().split(/[\s,]+/).map(Number);
    if (bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0) {
      throw new Error('Invalid native chart thumbnail viewport.');
    }
    asset = { viewBox, bounds, uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` };
    sources.set(program, asset);
  }
  const svg = host.querySelector(':scope > svg') ?? document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = '';
  svg.setAttribute('viewBox', asset.viewBox); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const image = svg.querySelector(':scope > image') ?? document.createElementNS(SVG_NS, 'image');
  image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  for (const [i, key] of ['x', 'y', 'width', 'height'].entries()) image.setAttribute(key, asset.bounds[i]);
  image.setAttribute('href', asset.uri);
  // Current switches from native mark nodes to this vector surface on drag.
  // Reusing its outer SVG must replace those nodes, not paint over a second chart.
  if (svg.childNodes.length !== 1 || svg.firstChild !== image) svg.replaceChildren(image);
  if (svg.parentNode !== host) host.replaceChildren(svg);
}
