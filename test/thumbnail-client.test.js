import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailClient } from '../web/cloud/thumbnail-client.js';

test('background thumbnails bound pending work and retain the newest exact chart', async () => {
  const listeners = {}, sent = [];
  const client = createThumbnailClient({ workerFactory: () => ({ addEventListener: (type, fn) => { listeners[type] = fn; }, postMessage: value => sent.push(value) }) });
  const a = client.create({ graphicSpec: { id: 'a' } }), b = client.create({ graphicSpec: { id: 'b' } }), c = client.create({ graphicSpec: { id: 'c' } });
  assert.equal(await b, null); assert.equal(sent.length, 1);
  listeners.message({ data: { id: sent[0].id, image: 'image-a' } });
  assert.equal(await a, 'image-a'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sent.length, 2); assert.deepEqual(sent[1].graphicSpec, { id: 'c' });
  listeners.message({ data: { id: sent[1].id, image: 'image-c' } });
  assert.equal(await c, 'image-c');
});
