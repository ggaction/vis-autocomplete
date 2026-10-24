// Use the same ggaction source as the browser. These renderers accept its
// resolved graphicSpec directly; no corpus code or user JavaScript is executed.
export const DOWNLOAD_TYPES = Object.freeze({ png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml' });
export const MAX_DOWNLOAD_REQUEST_BYTES = 24 * 1024 * 1024;

// PDF pages use integral backend dimensions, while chart layout and drag/fit
// geometry are fractional. Pad only the output page by less than one unit;
// never round chart objects, scale the content, or change the authored state.
function pdfPageGraphicSpec(graphicSpec) {
  const roots = graphicSpec.order.filter(id => graphicSpec.objects[id]?.type === 'canvas');
  if (roots.length !== 1) return graphicSpec; // Native validation owns ambiguity.
  const id = roots[0], canvas = graphicSpec.objects[id], { width, height } = canvas.properties ?? {};
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return graphicSpec;
  if (Number.isInteger(width) && Number.isInteger(height)) return graphicSpec;
  return { ...graphicSpec, objects: { ...graphicSpec.objects, [id]: { ...canvas,
    properties: { ...canvas.properties, width: Math.ceil(width), height: Math.ceil(height) } } } };
}

export async function renderChartDownload(format, graphicSpec) {
  if (!Object.hasOwn(DOWNLOAD_TYPES, format)) throw new TypeError('Unsupported chart download format.');
  if (!graphicSpec || typeof graphicSpec !== 'object' || !Array.isArray(graphicSpec.order) || !graphicSpec.objects) {
    throw new TypeError('A resolved chart graphicSpec is required.');
  }
  const program = { graphicSpec };
  let buffer;
  if (format === 'svg') {
    const { renderToSVG } = await import('ggaction/svg');
    buffer = Buffer.from(renderToSVG(program), 'utf8');
  } else if (format === 'png') {
    const { renderToPNGBuffer } = await import('ggaction/png');
    ({ buffer } = await renderToPNGBuffer(program, { pixelRatio: 2 }));
  } else {
    const { renderToPDFBuffer } = await import('ggaction/pdf');
    ({ buffer } = await renderToPDFBuffer({ graphicSpec: pdfPageGraphicSpec(graphicSpec) }));
  }
  return { buffer, contentType: DOWNLOAD_TYPES[format] };
}

export async function serveChartDownload(request, response, format) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' }); response.end(); return;
  }
  try {
    if (!Object.hasOwn(DOWNLOAD_TYPES, format)) throw new TypeError('Unsupported chart download format.');
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_DOWNLOAD_REQUEST_BYTES) {
        const error = new RangeError('Chart download request is too large.');
        error.statusCode = 413; throw error;
      }
      chunks.push(chunk);
    }
    const { graphicSpec } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const { buffer, contentType } = await renderChartDownload(format, graphicSpec);
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': buffer.length,
      'Content-Disposition': `attachment; filename="visualization.${format}"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(buffer);
  } catch (error) {
    if (response.destroyed) return;
    response.writeHead(error.statusCode === 413 ? 413 : 400,
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: error.message }));
  }
}
