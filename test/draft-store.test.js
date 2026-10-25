import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore } from '../web/project.js';

// A deliberately small IndexedDB contract double: requests run asynchronously,
// gets clone records, and staged writes become visible only on transaction commit.
// This lets tests observe which objects are serialized and force atomic failures.
function fakeIDB(legacy) {
  const stores = new Map([['projects', new Map(legacy ? [['draft', structuredClone(legacy)]] : [])]]);
  let version = legacy ? 1 : 0, putsUntilFailure = null;
  const puts = [], db = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) { stores.set(name, new Map()); }, close() {},
    transaction(names, mode) {
      names = Array.isArray(names) ? names : [names];
      const staged = new Map(names.map(name => [name, new Map(stores.get(name))]));
      let count = 0, closed = false, scheduled;
      const tx = {
        abort() { if (closed) return; closed = true; clearTimeout(scheduled); queueMicrotask(() => tx.onabort?.()); },
        objectStore(name) {
          if (!names.includes(name)) throw new Error('Store outside transaction');
          const operation = run => {
            if (closed) throw new Error('Transaction inactive');
            clearTimeout(scheduled); count++; const request = {};
            queueMicrotask(() => {
              if (closed) return;
              try { request.result = run(); request.onsuccess?.(); }
              catch (error) { tx.error = error; tx.abort(); return; }
              if (--count === 0) scheduled = setTimeout(() => {
                if (closed) return; closed = true;
                if (mode === 'readwrite') for (const [key, values] of staged) stores.set(key, values);
                tx.oncomplete?.();
              }, 0);
            });
            return request;
          };
          return {
            get: key => operation(() => structuredClone(staged.get(name).get(key))),
            put(value, key) {
              if (putsUntilFailure === 0) { putsUntilFailure = null; throw new Error('Simulated quota error'); }
              if (putsUntilFailure !== null) putsUntilFailure--;
              const copy = structuredClone(value); puts.push({ name, key, value });
              return operation(() => { staged.get(name).set(key, copy); return key; });
            },
          };
        },
      };
      return tx;
    },
  };
  return { stores, puts, failPut(after = 0) { putsUntilFailure = after; }, open(name, requested) {
    assert.equal(name, 'visualization-autocomplete'); const request = {};
    queueMicrotask(() => { request.result = db; if (version < requested) { version = requested; request.onupgradeneeded?.(); } request.onsuccess?.(); });
    return request;
  } };
}

const record = (id = 'data') => ({ id, name: id, imported: { rows: [{ x: 1 }], rawRows: [{ x: '1' }], metadata: { sourceText: '[{"x":"1"}]' } }, session: { index: 0, entries: [{ calls: [] }] } });
const project = datasets => ({ format: 'visualization-autocomplete', version: 1, activeId: datasets[0].id, datasets });

test('draft saves clone immutable dataset once and only persist session metadata on later actions', async () => {
  const fake = fakeIDB(), store = createDraftStore(fake), source = record(), first = project([source]);
  await store.write(first);
  assert.equal(fake.puts.filter(p => p.name === 'datasets').length, 1);
  const next = project([{ ...source, session: { index: 1, entries: [{ calls: [] }, { calls: ['encodeOpacity'] }] } }]);
  await store.write(next);
  assert.equal(fake.puts.filter(p => p.name === 'datasets').length, 1);
  const manifest = fake.stores.get('projects').get('draft'); assert.equal(manifest.storageVersion, 2);
  assert.equal('imported' in manifest.datasets[0], false);
  assert.deepEqual(await store.read(), next);
  const loaded = await store.read(); await store.write(loaded);
  assert.equal(fake.puts.filter(p => p.name === 'datasets').length, 1);
});

test('revised identities and changed imported records persist once in the same transaction as active selection', async () => {
  const fake = fakeIDB(), store = createDraftStore(fake), one = record(); await store.write(project([one]));
  const revised = record('revision'); revised.imported.rows = [{ x: 2 }];
  await store.write({ ...project([one, revised]), activeId: revised.id });
  assert.equal(fake.puts.filter(p => p.name === 'datasets').length, 2);
  const loaded = await store.read(); assert.equal(loaded.activeId, revised.id); assert.equal(loaded.datasets[1].imported.rows[0].x, 2);
  const changed = { ...loaded.datasets[0], imported: { ...loaded.datasets[0].imported, rows: [{ x: 3 }] } };
  await store.write(project([changed])); assert.equal((await store.read()).datasets[0].imported.rows[0].x, 3);
});

test('v1 monolithic drafts migrate without losing raw data or history and v2 reads do not rewrite datasets', async () => {
  const legacy = project([record()]), fake = fakeIDB(legacy), store = createDraftStore(fake);
  assert.deepEqual(await store.read(), legacy);
  assert.equal(fake.stores.get('projects').get('draft').storageVersion, 2);
  const writes = fake.puts.length;
  const reloadedStore = createDraftStore(fake); assert.deepEqual(await reloadedStore.read(), legacy);
  assert.equal(fake.puts.length, writes);
  const loaded = await reloadedStore.read(); await reloadedStore.write(loaded);
  assert.equal(fake.puts.filter(p => p.name === 'datasets').length, 1);
});

test('failed atomic save preserves previous manifest/data; failed migration still returns the recoverable v1 draft', async () => {
  const old = project([record()]), fake = fakeIDB(old), store = createDraftStore(fake);
  fake.failPut(); assert.deepEqual(await store.read(), old);
  assert.equal(fake.stores.get('projects').get('draft').storageVersion, undefined);
  await store.write(old); const revision = record('new'); fake.failPut(1);
  await assert.rejects(store.write(project([revision])), /quota/);
  assert.equal(fake.stores.get('datasets').has('new'), false, 'abort rolls back the data record staged before manifest failure');
  assert.deepEqual(await store.read(), old);
  await store.write(project([revision])); assert.deepEqual(await store.read(), project([revision]));
});

test('compiled chart caches cannot overwrite or attach to a newer draft, source, or history branch', async () => {
  const { checkpointRevision } = await import('../web/project.js');
  const store = createDraftStore(fakeIDB()), first = project([record()]), source = { commit: 'native-one' };
  await store.write(first);
  const cached = { version: 1, revision: await checkpointRevision(first), source, snapshot: 'compiled' };
  await store.writeCheckpoint(cached);
  assert.equal(await checkpointRevision({ ...first, savedAt: 'later' }), cached.revision, 'pagehide saves of the same state preserve the cache');
  const changedData = structuredClone(first); changedData.datasets[0].imported.rows[0].x = 999;
  assert.notEqual(await checkpointRevision(changedData), cached.revision, 'data revisions invalidate compiled state even with the same dataset id');
  assert.deepEqual(await store.readCheckpoint(cached.revision, source), cached);
  assert.equal(await store.readCheckpoint(cached.revision, { commit: 'native-two' }), null);
  const next = structuredClone(first); next.datasets[0].session.entries[0].calls.push('encodeSize');
  await store.write(next); await store.writeCheckpoint(cached);
  assert.equal(await store.readCheckpoint(await checkpointRevision(next), source), null);
  assert.deepEqual(await store.read(), next, 'cache failures never alter the authoring draft');
});
