import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { exampleDatasets, loadExampleDataset } from '../web/example-datasets.js';

test('examples load only on demand, share in-flight imports, and retain schema overrides', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return { ok: true, json: async () => JSON.parse(await readFile(new URL(`..${url}`, import.meta.url))) };
  });
  const records = exampleDatasets();
  assert.equal(records.length, 9);
  assert.ok(records.every(record => !record.imported));
  assert.deepEqual(requests, []);
  const barley = records.find(record => record.id === 'barley');
  const [a, b] = await Promise.all([loadExampleDataset(barley), loadExampleDataset(barley)]);
  assert.equal(a, b);
  assert.equal(requests.length, 1);
  assert.equal(a.imported.fieldTypes.year.type ?? a.imported.fieldTypes.year, 'ordinal');
  await loadExampleDataset(barley);
  assert.equal(requests.length, 1);
  for (const record of records) await loadExampleDataset(record);
  assert.equal(requests.length, 8);
  assert.ok(records.every(record => record.imported.rows.length));
  const stocks = records.find(record => record.id === 'stocks');
  assert.equal(stocks.imported.fieldTypes.date.type ?? stocks.imported.fieldTypes.date, 'temporal');
});

test('failed imports can retry; restored/uploaded tables never fetch an example', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: ++calls > 1, json: async () => [{ value: 1 }] }));
  const record = exampleDatasets()[0];
  await assert.rejects(loadExampleDataset(record), /missing/);
  assert.equal(record.imported, undefined);
  await loadExampleDataset(record);
  assert.equal(calls, 2);
  const restored = { id: 'upload', imported: { rows: [{ x: 1 }] } };
  assert.equal(await loadExampleDataset(restored), restored);
  assert.equal(calls, 2);
});
