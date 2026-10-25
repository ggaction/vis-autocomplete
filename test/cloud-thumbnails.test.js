import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { chart } from 'ggaction';
import { chartViewport } from '../web/chart-viewport.js';
import { createProjectThumbnail } from '../web/cloud/thumbnail.js';
import { projectThumbnails } from '../web/cloud/project-thumbnails.js';

globalThis.document = { createElement: () => createCanvas(1, 1) };
globalThis.Path2D = Path2D;
const pixels = image => {
  const buffer = Buffer.from(image.split(',')[1], 'base64');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};
const rows = Array.from({ length: 120 }, (_, i) => ({ x: i + 1, y: i % 17 + 2, group: i % 2 ? 'A' : 'B' }));
test('project PNGs retain high-density detail, proportions and guides across wide, tall and faceted charts', () => {
  for (const [width, height, facet] of [[700, 430, false], [430, 900, false], [1500, 430, true]]) {
    let p = chart().createCanvas({ width, height, margin: { left: 80, right: 180, top: 50, bottom: 60 } })
      .createData({ id: 'dataset', values: rows }).createScatterPlot({ id: 'plot', data: 'dataset', x: 'x', y: 'y', color: 'group' });
    if (facet) p = p.facet({ field: 'group', data: 'dataset', columns: 2, guides: { legend: 'shared' } });
    p = p.createGuides();
    const before = JSON.stringify(p.graphicSpec), viewport = chartViewport(p);
    const image = createProjectThumbnail(p), size = pixels(image);
    assert.ok(image.length <= 180_000);
    assert.ok(size.width > 560 || size.height > 360, 'Keep detail above the old 2x export');
    const ratio = Math.min(size.width / viewport.width, size.height / viewport.height);
    assert.ok(size.width - viewport.width * ratio <= 1 && size.height - viewport.height * ratio <= 1,
      'Dimensions may round up by one raster pixel, without stretching the chart');
    assert.equal(JSON.stringify(p.graphicSpec), before);
  }
});

let observer;
globalThis.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; this.targets = new Set(); observer = this; }
  observe(image) { this.targets.add(image); }
  unobserve(image) { this.targets.delete(image); }
  disconnect() { this.targets.clear(); }
  intersect(image, isIntersecting) { this.callback([{ target: image, isIntersecting }]); }
};
const until = async condition => {
  for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Thumbnail work did not complete');
};
const record = {
  imported: { rows }, session: { index: 1, entries: [null, {
    phase: 'recommendations', steps: 1, selection: { fields: ['x', 'y', 'group'] },
    setupCalls: [{ method: 'createCanvas', args: { width: 700, height: 430 } },
      { method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } }],
    calls: [{ method: 'createScatterPlot', args: { id: 'plot', data: 'dataset', x: 'x', y: 'y', color: 'group' } }],
    guideCall: { method: 'createGuides', args: {} },
  }, { calls: [{ method: 'untrustedLaterHistory' }] }] },
};
function fixture() {
  const saved = new Map(), reads = [], user = { id: 'owner' };
  const account = { user, local: { get: async key => saved.get(key), put: async (key, value) => saved.set(key, value) },
    preview: async row => { reads.push(row.id); return record; } };
  const image = () => Object.assign(new EventTarget(), { isConnected: true, naturalWidth: 240, naturalHeight: 160, src: 'legacy' });
  const row = { id: 'p', revision: 4, updated_at: 'today', thumbnail: 'legacy' };
  return { account, saved, reads, image, row };
}
test('legacy repair is lazy, replays the selected snapshot only, caches per owner/revision, and never mutates history', async () => {
  const f = fixture(), before = JSON.stringify(record);
  let loader = projectThumbnails(f.account, {}), image = f.image();
  loader.observe(image, f.row); image.dispatchEvent(new Event('load'));
  assert.deepEqual(f.reads, [], 'Do not replay offscreen projects');
  observer.intersect(image, true); await until(() => image.src !== 'legacy');
  const png = image.src; assert.ok(pixels(png).height > 360); assert.equal(JSON.stringify(record), before);
  loader.dispose();
  loader = projectThumbnails(f.account, {}); image = f.image();
  loader.observe(image, f.row); image.dispatchEvent(new Event('load')); observer.intersect(image, true);
  await until(() => image.src === png); assert.deepEqual(f.reads, ['p']); loader.dispose();
  loader = projectThumbnails(f.account, {}); image = f.image();
  loader.observe(image, { ...f.row, revision: 5 }); image.dispatchEvent(new Event('load')); observer.intersect(image, true);
  await until(() => image.src === png); assert.deepEqual(f.reads, ['p', 'p']); loader.dispose();
});
test('closing the menu or switching accounts discards pending thumbnail work', async () => {
  for (const cancel of ['close', 'switch']) {
    const f = fixture(); let release;
    f.account.preview = () => new Promise(resolve => { release = () => resolve(record); });
    const loader = projectThumbnails(f.account, {}), image = f.image();
    loader.observe(image, f.row); image.dispatchEvent(new Event('load')); observer.intersect(image, true);
    await until(() => release);
    if (cancel === 'close') loader.dispose(); else f.account.user = { id: 'another-owner' };
    release(); await until(() => !observer.targets.size);
    assert.equal(image.src, 'legacy'); assert.equal(f.saved.size, 0); loader.dispose();
  }
});
test('a full thumbnail cache still displays the regenerated image', async () => {
  const f = fixture(); f.account.local.put = async () => { throw new Error('Quota exceeded'); };
  const loader = projectThumbnails(f.account, {}), image = f.image();
  loader.observe(image, f.row); image.dispatchEvent(new Event('load')); observer.intersect(image, true);
  await until(() => image.src !== 'legacy'); assert.ok(pixels(image.src).height > 360); loader.dispose();
});
