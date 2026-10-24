import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModel } from '../web/model-loader.js';

test('model loader verifies both bytes and generation and retries an interrupted bundle update', async t => {
  const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
  const model={provenance:{generation:'new'},chartCount:1387}, bytes=JSON.stringify(model);
  const hash=createHash('sha256').update(bytes).digest('hex');let count=0;
  globalThis.fetch=async url=>new Response(url.includes('manifest') ? JSON.stringify({generation:'new',files:{'model.json':{sha256:hash}}})
    : ++count===1 ? JSON.stringify({provenance:{generation:'old'}}) : bytes);
  assert.deepEqual(await loadModel('model.json'),model);assert.equal(count,2);
  globalThis.fetch=async url=>new Response(url.includes('manifest') ? JSON.stringify({generation:'other',files:{'model.json':{sha256:hash}}}) : bytes);
  await assert.rejects(loadModel('model.json'),/updating/);
});
