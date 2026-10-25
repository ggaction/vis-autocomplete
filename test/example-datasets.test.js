import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exampleDatasets, loadExampleDataset } from '../web/example-datasets.js';

const localResponse = url => ({ ok: true,
  json: async () => JSON.parse(await readFile(new URL(`..${url}`, import.meta.url))),
  text: async () => readFile(new URL(`..${url}`, import.meta.url), 'utf8'),
});

test('examples load only on demand, share in-flight imports, and retain schema overrides', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return localResponse(url);
  });
  const records = exampleDatasets();
  assert.equal(records.length, 19);
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
  assert.equal(requests.length, 18);
  assert.ok(records.every(record => record.imported.rows.length));
  const stocks = records.find(record => record.id === 'stocks');
  assert.equal(stocks.imported.fieldTypes.date.type ?? stocks.imported.fieldTypes.date, 'temporal');
});

test('new examples preserve source rows, class semantics, missingness and signed values', async t => {
  t.mock.method(globalThis, 'fetch', async url => localResponse(url));
  const expectedRows = { fashion_mnist_tsne: 498, penguins: 344, wine: 178, glass: 214,
    'bike-sharing': 731, 'us-employment': 120, unemployment: 1708, budgets: 230, income: 520, 'global-temp': 144 };
  const records = exampleDatasets().filter(record => record.id in expectedRows);
  assert.equal(records.length, 10);
  for (const record of records) {
    await loadExampleDataset(record);
    assert.equal(record.imported.rows.length, expectedRows[record.id], record.id);
  }
  const dataset = id => records.find(record => record.id === id).imported;
  const type = (id, field) => dataset(id).fieldTypes[field]?.type ?? dataset(id).fieldTypes[field];
  for (const [id, field] of [['fashion_mnist_tsne', 'label'], ['wine', 'class'], ['glass', 'class'],
    ['glass', 'Id_number'], ['income', 'id'], ['bike-sharing', 'season'], ['bike-sharing', 'holiday']]) {
    assert.equal(type(id, field), 'nominal', `${id}.${field} is a code, not a numeric measure`);
  }
  assert.equal(new Set(dataset('fashion_mnist_tsne').rows.map(row => row.label)).size, 10);
  assert.deepEqual(dataset('fashion_mnist_tsne').rows[0], { x_pos: -27.591837, y_pos: 40.89699, label: '9', label_name: 'Ankle boot' });
  assert.equal(dataset('penguins').rows.filter(row => row['Beak Length (mm)'] === null).length, 2);
  for (const [id, field] of [['us-employment', 'nonfarm_change'], ['budgets', 'value'], ['global-temp', 'temp']]) {
    assert.ok(dataset(id).rows.some(row => row[field] < 0), `${id} retains negative values`);
    assert.ok(dataset(id).rows.some(row => row[field] > 0), `${id} retains positive values`);
  }
  for (const [id, field] of [['bike-sharing', 'dteday'], ['us-employment', 'month'], ['unemployment', 'date']]) {
    assert.equal(type(id, field), 'temporal', `${id}.${field}`);
  }
  const incomeOrder = dataset('income').fieldTypes.group.order;
  assert.equal(incomeOrder.at(-1), '200000+');
  assert.ok(incomeOrder.indexOf('50000 to 74999') < incomeOrder.indexOf('75000 to 99999'));
  assert.deepEqual(new Set(incomeOrder), new Set(dataset('income').rows.map(row => row.group)));
});

test('new example assets have byte-level source provenance and stay bounded', async () => {
  const sources = JSON.parse(await readFile(new URL('../web/data/sources.json', import.meta.url)));
  const newRecords = exampleDatasets().slice(9);
  let totalBytes = 0;
  for (const record of newRecords) {
    const source = sources.find(item => item.name === record.id);
    assert.ok(source, record.id);
    assert.equal(source.retrievedOn, '2026-10-25');
    assert.ok(source.source && source.licenses.length && source.fields.length && source.rows);
    assert.equal(source.originalValuesPreserved, true);
    const bytes = await readFile(new URL(`../web/data/${source.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, record.id);
    if (!source.transformations.length) assert.equal(source.sha256, source.sourceSha256, record.id);
    totalBytes += bytes.length;
  }
  assert.ok(totalBytes < 1_000_000, `new examples must remain a small lazy-loaded collection: ${totalBytes} bytes`);
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
