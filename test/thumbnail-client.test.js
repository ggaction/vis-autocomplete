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

test('gallery replay transfers one snapshot and cancellation settles all derived work', async () => {
  const listeners = {}, sent = []; let terminated = 0;
  const client = createThumbnailClient({ workerFactory: () => ({
    addEventListener: (type, fn) => { listeners[type] = fn; }, postMessage: value => sent.push(value), terminate: () => terminated++,
  }) });
  const snapshot = { calls: ['current'] }, rows = [{ x: 1 }];
  const active = client.restore(snapshot, rows), pending = client.restore({ calls: ['next'] }, rows);
  assert.equal(sent.length, 1); assert.equal(sent[0].snapshot, snapshot); assert.equal(sent[0].rows, rows);
  client.destroy(); assert.equal(await active, null); assert.equal(await pending, null); assert.equal(terminated, 1);
  listeners.message({ data: { id: sent[0].id, image: 'late' } });
  assert.equal(await client.create({ graphicSpec: {} }), null); assert.equal(sent.length, 1);
});

test('a failed thumbnail worker is replaced and stale worker events cannot interrupt the replacement', async () => {
  const workers = [];
  const client = createThumbnailClient({ workerFactory: () => {
    const worker = { listeners: {}, sent: [], addEventListener(type, fn) { this.listeners[type] = fn; },
      postMessage(value) { this.sent.push(value); }, terminate() { this.closed = true; } };
    workers.push(worker); return worker;
  } });
  const failed = assert.rejects(client.create({ graphicSpec: {} }), /failed/);
  workers[0].listeners.messageerror({}); await failed; assert.equal(workers[0].closed, true);
  const next = client.create({ graphicSpec: { next: true } });
  await new Promise(resolve => setTimeout(resolve, 0));
  workers[0].listeners.error({ message: 'stale' });
  const current = workers[1]; assert.equal(current.closed, undefined);
  current.listeners.message({ data: { id: current.sent[0].id, image: 'current' } });
  assert.equal(await next, 'current'); client.destroy();
});
