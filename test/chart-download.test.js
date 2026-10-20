import assert from 'node:assert/strict';
import test from 'node:test';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { renderChartDownload } from '../scripts/chart-download.js';
import { createDevServer } from '../scripts/dev-server.js';

const current = () => chart().createCanvas({ width: 500, height: 400, margin: 70 })
  .createData({ values: [{ x: 1, y: 2, group: 'A' }, { x: 2, y: 3, group: 'B' }, { x: 3, y: 1, group: 'A' }] })
  .createScatterPlot({ id: 'plot', x: 'x', y: 'y', color: 'group' });

test('JSON chart payload exports a real 2× PNG, vector PDF and standalone SVG via native ggaction renderers', async () => {
  const p = current(), graphicSpec = JSON.parse(JSON.stringify(p.graphicSpec));
  const png = await renderChartDownload('png', graphicSpec);
  assert.equal(png.contentType, 'image/png');
  assert.deepEqual([...png.buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.buffer.readUInt32BE(16), 1000);
  assert.equal(png.buffer.readUInt32BE(20), 800);
  const pdf = await renderChartDownload('pdf', graphicSpec);
  assert.equal(pdf.contentType, 'application/pdf');
  assert.match(pdf.buffer.toString('latin1'), /^%PDF-/);
  assert.match(pdf.buffer.toString('latin1'), /\/Type\s*\/Page\b/);
  assert.ok(pdf.buffer.length > 1000);
  const svg = await renderChartDownload('svg', graphicSpec);
  assert.equal(svg.contentType, 'image/svg+xml');
  assert.equal(svg.buffer.toString(), renderToSVG(p));
  assert.match(svg.buffer.toString(), /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
});

test('exporting the current state never mutates it or exports a different preview state', async () => {
  const p = current(), before = JSON.stringify(p.graphicSpec);
  const preview = p.encodeColor({ target: 'plot', value: '#e45756' });
  const result = await renderChartDownload('svg', JSON.parse(before));
  assert.equal(result.buffer.toString(), renderToSVG(p));
  assert.notEqual(result.buffer.toString(), renderToSVG(preview));
  assert.equal(JSON.stringify(p.graphicSpec), before);
});

test('download endpoint returns binary attachments and handles unsupported/invalid requests', async t => {
  const server = createDevServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/export`;
  const p = current();
  for (const [format, mime] of [['svg', 'image/svg+xml'], ['png', 'image/png'], ['pdf', 'application/pdf']]) {
    const response = await fetch(`${url}/${format}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphicSpec: p.graphicSpec }) });
    assert.equal(response.status, 200, format);
    assert.equal(response.headers.get('Content-Type'), mime);
    assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="visualization.${format}"`);
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
  }
  assert.equal((await fetch(`${url}/svg`)).status, 405);
  const invalid = await fetch(`${url}/svg`, { method: 'POST', body: '{}' });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /graphicSpec/);
  assert.equal((await fetch(`${url}/jpg`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await fetch(`${url}/svg`, { method: 'POST', body: '{' })).status, 400);
});
