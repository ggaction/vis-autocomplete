import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewRasterCache } from '../web/preview-raster-cache.js';

function canvas(width, height) {
  return { width, height, ownerDocument: { createElement: () => ({
    width: 1, height: 1, getContext: () => ({ drawImage() {} }),
  }) } };
}

test('raster endpoints require the exact graphics identity and density variant', () => {
  const cache = createPreviewRasterCache(), spec = {};
  cache.remember(spec, 'DPR1 fit:0,0,400,300', canvas(400, 300));
  const first = cache.get(spec, 'DPR1 fit:0,0,400,300');
  assert.equal(first.width, 400);
  assert.equal(cache.get({}, 'DPR1 fit:0,0,400,300'), null);
  assert.equal(cache.get(spec, 'DPR2 fit:0,0,400,300'), null);
  cache.remember(spec, 'DPR2 fit:0,0,400,300', canvas(800, 600));
  assert.equal(cache.retainedEntries, 1);
  assert.equal(cache.retainedPixels, 480000);
  assert.equal(first.width, 1, 'replaced densities release their backing pixels');
  assert.equal(cache.get(spec, 'DPR1 fit:0,0,400,300'), null);
});

test('raster endpoints have independent entry and pixel bounds with LRU eviction', () => {
  const cache = createPreviewRasterCache({ maxEntries: 3, maxPixels: 500 });
  const specs = Array.from({ length: 5 }, () => ({}));
  for (const spec of specs.slice(0, 3)) cache.remember(spec, 'one', canvas(10, 10));
  const oldest = cache.get(specs[0], 'one'), evicted = cache.get(specs[1], 'one');
  cache.get(specs[0], 'one');
  cache.remember(specs[3], 'one', canvas(10, 10));
  assert.equal(cache.get(specs[2], 'one'), null);
  assert.equal(cache.get(specs[0], 'one'), oldest);
  cache.remember(specs[4], 'one', canvas(20, 20));
  assert.equal(cache.retainedEntries, 2);
  assert.equal(cache.retainedPixels, 500);
  assert.equal(evicted.width, 1);
  assert.equal(cache.get(specs[0], 'one'), oldest);
  cache.clear();
  assert.equal(cache.retainedEntries, 0);
  assert.equal(cache.retainedPixels, 0);
  assert.equal(oldest.width, 1);
});

test('a single oversized raster does not displace the existing working set', () => {
  const cache = createPreviewRasterCache({ maxPixels: 100 });
  const small = {}, large = {};
  cache.remember(small, 'one', canvas(10, 10));
  cache.remember(large, 'one', canvas(20, 20));
  assert.equal(cache.retainedEntries, 1);
  assert.ok(cache.get(small, 'one'));
  assert.equal(cache.get(large, 'one'), null);
});

test('default working set never exceeds six images or eight million pixels', () => {
  const cache = createPreviewRasterCache();
  for (let i = 0; i < 20; i++) {
    cache.remember({}, 'one', canvas(1000, i < 10 ? 1000 : 1500));
    assert.ok(cache.retainedEntries <= 6);
    assert.ok(cache.retainedPixels <= 8_000_000);
  }
  assert.equal(cache.retainedEntries, 5);
  assert.equal(cache.retainedPixels, 7_500_000);
});
