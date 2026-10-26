import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createCloudLocal } from '../web/cloud/local.js';
globalThis.IDBKeyRange = IDBKeyRange;

test('cloud storage scans only a requested prefix and checks existence without reading bodies', async () => {
  const local = createCloudLocal(new IDBFactory());
  for (const key of ['job:a:01', 'job:a:02', 'job:b:01', 'research:a:01', 'data:one']) await local.put(key, { value: key });
  assert.deepEqual(await local.keys('job:a:'), ['job:a:01', 'job:a:02']);
  assert.equal((await local.keys()).length, 5);
  assert.equal(await local.has('job:a:01'), true); assert.equal(await local.has('job:a:absent'), false);
  assert.deepEqual((await local.entries('job:a:', 1)).map(([key]) => key), ['job:a:01']);
});

test('atomic cloud updates cannot lose a later revision or recreate deleted jobs', async () => {
  const local = createCloudLocal(new IDBFactory());
  await local.put('head:a:p', { operation: 'old', revision: 1 });
  const next = local.put('head:a:p', { operation: 'new', revision: 2 });
  const image = local.update('head:a:p', value => value?.operation === 'old' ? { ...value, image: 'stale' } : undefined);
  await Promise.all([next, image]);
  assert.deepEqual(await local.get('head:a:p'), { operation: 'new', revision: 2 });
  await local.remove('head:a:p');
  await local.update('head:a:p', value => value ? { ...value, image: 'late' } : undefined);
  assert.equal(await local.has('head:a:p'), false);
  await assert.rejects(local.update('head:a:p', () => { throw new Error('invalid'); }), /invalid/);
});
