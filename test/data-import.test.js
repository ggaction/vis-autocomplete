import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { profileDataset } from '../src/profile.js';
import { describeDataset } from '../src/dataset-profile.js';
import { importDataset, readCSV, parseCSV, parseDateValue } from '../src/data-import.js';
import { tableWindow, columnSelectionChange, TABLE_ROW_HEIGHT, TABLE_COLUMN_WIDTH } from '../web/data-table.js';
import { importReviewSettings, createCategoryOrderDrafts } from '../web/import-dialog.js';
import { createImportClient } from '../web/import-client.js';
const data = name => JSON.parse(readFileSync(new URL(`../web/data/${name}.json`, import.meta.url)));
const csv = rows => {
  const keys = Object.keys(rows[0]); const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\n');
};
const profile = imported => profileDataset(chart().createData({ id: 'dataset', values: imported.rows, ...(imported.storageSchema ? { schema: imported.storageSchema } : {}) }), 'dataset', imported.fieldTypes);

test('duplicate category orders fail in review, import and restored profiles before plotting', () => {
  const rows = [{ category: 'conventional', count: 9126 }, { category: 'organic', count: 9123 }];
  const overrides = { category: { type: 'ordinal', order: ['organic', 'organic'] } };
  const drafts = createCategoryOrderDrafts(overrides);
  assert.match(drafts.error('category'), /unique/);
  assert.equal(drafts.commit().valid, true, 'untouched drafts are validated by the import pipeline');
  assert.throws(() => importDataset(rows, { fieldOverrides: overrides }), /category.*unique/);
  const imported = importDataset(rows);
  const p = chart().createData({ id: 'dataset', values: rows });
  assert.throws(() => profileDataset(p, 'dataset', overrides), /unique/);
  assert.throws(() => importDataset(imported, { fieldOverrides: overrides }), /unique/);
  drafts.write('category', '["organic","organic"]');
  assert.equal(drafts.commit().valid, false);
  drafts.write('category', '["missing","organic","conventional"]');
  assert.equal(drafts.commit().valid, true);
  assert.deepEqual(profile(importDataset(rows, { fieldOverrides: overrides })).fields[0].order,
    ['organic', 'conventional']);
  for (const order of [[null], [1, '1'], [Infinity], {}]) {
    assert.throws(() => importDataset(rows, { fieldOverrides: { category: { type: 'ordinal', order } } }), /Category order/);
  }
});

test('actual Stocks and Weather JSON/CSV share values, field types and descriptors while originals remain intact', () => {
  for (const name of ['stocks', 'weather', 'tips', 'iris']) {
    const raw = data(name), before = JSON.stringify(raw);
    const json = importDataset(raw, { format: 'rows', name }), fromCSV = importDataset(csv(raw), { format: 'csv', name });
    assert.deepEqual(json.rows, fromCSV.rows); assert.deepEqual(json.fieldTypes, fromCSV.fieldTypes);
    assert.deepEqual(describeDataset(json.rows, json.fieldTypes), describeDataset(fromCSV.rows, fromCSV.fieldTypes));
    assert.equal(JSON.stringify(raw), before); assert.deepEqual(json.rawRows, raw);
    assert.ok(profile(json).fields.every(field => field.usable));
    if (name === 'stocks' || name === 'weather') assert.equal(profile(json).fields.find(field => field.name === 'date').type, 'temporal');
  }
});

test('actual Gapminder NA measurements remain usable, all rows and source tokens are preserved', () => {
  const raw = data('gapminder'), imported = importDataset(raw, { name: 'Gapminder' });
  assert.equal(imported.rows.length, 2618); assert.equal(imported.rawRows.filter(row => row.lifeExp === 'NA').length, 15);
  assert.equal(imported.rows.filter(row => row.lifeExp === null).length, 15);
  assert.equal(imported.rows.filter(row => typeof row.lifeExp === 'number').length, 2603);
  const f = profile(imported).fields.find(field => field.name === 'lifeExp'); assert.equal(f.type, 'quantitative'); assert.equal(f.usable, true); assert.equal(f.missing, 15);
  assert.ok(imported.metadata.conversions.find(c => c.field === 'lifeExp').missingTokens.includes('na'));
});

test('safe CSV parsing preserves identifiers and rejects row/quote corruption with location', () => {
  const rows = parseCSV('id,value\n9007199254740993,2\n001,3');
  assert.deepEqual(rows.map(r => r.id), ['9007199254740993', '001']);
  assert.throws(() => readCSV('x,y\n1,2,IMPORTANT'), e => e.row === 2 && e.actual === 3 && /No values were discarded/.test(e.message));
  assert.throws(() => readCSV('x,y\n1'), /Row 2 has 1 cells/);
  assert.throws(() => readCSV('x,y\n"abc"suffix,1'), /row 2, column 1/);
  assert.throws(() => readCSV('x,y\n"abc,1'), /Unclosed quoted/);
  assert.deepEqual(readCSV('text,n\r\n"one\n""two""",2\r\n').rows, [{ text: 'one\n"two"', n: '2' }]);
  assert.equal(importDataset('[{"id":9007199254740993,"value":2}]', { format: 'json' }).rows[0].id, '9007199254740993');
});

test('header repair retains all columns and raw CSV, empty data rejects before replacement', () => {
  const source = ',name,name\n1,A,B'; assert.throws(() => readCSV(source), /unique/);
  const imported = importDataset(source, { format: 'csv' });
  assert.deepEqual(imported.rows, [{ 'Column 1': 1, name: 'A', 'name (2)': 'B' }]);
  assert.deepEqual(imported.metadata.rawHeaders, ['', 'name', 'name']); assert.equal(imported.metadata.sourceText, source);
  assert.deepEqual(imported.metadata.rawRecords, [['1', 'A', 'B']]); assert.equal(imported.metadata.warnings.length, 2);
  assert.throws(() => importDataset([{}]), /No usable fields/); assert.throws(() => importDataset([]), /non-empty/);
  const revised = importDataset(imported, { fieldOverrides: { 'Column 1': { exclude: true }, 'name (2)': { name: 'second name' } } });
  assert.deepEqual(revised.rows, [{ name: 'A', 'second name': 'B' }]);
  assert.deepEqual(revised.fieldTypes, { name: 'nominal', 'second name': 'nominal' });
  assert.deepEqual(revised.rawRows, imported.rawRows); assert.deepEqual(revised.metadata.rawHeaders, ['', 'name', 'name']);
  const restored = importDataset(revised, { fieldOverrides: { 'Column 1': { exclude: false }, 'name (2)': { name: 'second name' } } });
  assert.deepEqual(restored.rows, [{ 'Column 1': 1, name: 'A', 'second name': 'B' }]);
  assert.throws(() => importDataset(imported, { fieldOverrides: { 'name (2)': { name: 'name' } } }), /unique, non-empty/);
});

test('date formats are explicit for ambiguous slash dates and deterministic across time zones', () => {
  const raw = [{ date: '03/07/2020', value: '1' }, { date: '04/08/2020', value: '2' }];
  const inferred = importDataset(raw); assert.equal(inferred.fieldTypes.date, 'nominal'); assert.ok(inferred.metadata.warnings.some(w => w.code === 'date-format'));
  const mdy = importDataset(raw, { fieldOverrides: { date: { type: 'temporal', dateFormat: 'mdy' } } });
  const dmy = importDataset(raw, { fieldOverrides: { date: { type: 'temporal', dateFormat: 'dmy' } } });
  assert.equal(mdy.rows[0].date, '2020-03-07'); assert.equal(dmy.rows[0].date, '2020-07-03');
  assert.equal(parseDateValue('2020-02-30', 'iso'), null);
  assert.equal(parseDateValue('2020-01-01 01:00:00'), '2020-01-01T01:00:00.000Z');
  assert.equal(parseDateValue('2020-01-01T01:00:00+02:00'), '2019-12-31T23:00:00.000Z');
  assert.equal(parseDateValue('1960 JAN'), '1960-01-01');
  assert.equal(parseDateValue('1/2/20', 'mdy'), null);
});

test('numeric syntax and explicit locale preserve quantitative measurements', () => {
  const imported = importDataset('Price,value\n"3,049.16",.5\n" 2,345.01 ",.75', { format: 'csv' });
  assert.deepEqual(imported.rows, [{ Price: 3049.16, value: .5 }, { Price: 2345.01, value: .75 }]);
  const european = importDataset([{ value: '1.234,56' }], { fieldOverrides: { value: { type: 'quantitative', numericFormat: 'comma-decimal' } } });
  assert.equal(european.rows[0].value, 1234.56);
});

test('nested scalar paths and literal dotted fields coexist; original nested data stays untouched', () => {
  const raw = [{ _source: { species: 'setosa', petal: 1.4 }, '_source.petal': 99, value: 2 }];
  const imported = importDataset(raw);
  assert.deepEqual(imported.rows, [{ '_source.species': 'setosa', '_source.petal (2)': 1.4, '_source.petal': 99, value: 2 }]);
  assert.deepEqual(imported.rawRows, raw); assert.equal(raw[0]._source.petal, 1.4);
  const sparse = importDataset([...raw, { _source: { petal: 2 }, value: 3 }]);
  assert.equal(sparse.rows[1]['_source.petal (2)'], 2);
  assert.equal(sparse.rows[1]['_source.petal'], null);
  const nestedTable = importDataset(JSON.stringify({ results: { rows: raw } }), { format: 'json', rowPath: 'results.rows' });
  const edited = importDataset(nestedTable, { fieldOverrides: { value: { type: 'nominal' } } });
  assert.equal(edited.rows.length, 1); assert.equal(edited.fieldTypes.value, 'nominal');
  const objectTable = importDataset({ results: { rows: raw } }, { format: 'rows', rowPath: 'results.rows' });
  assert.deepEqual(importDataset(objectTable).rawRows, raw);
});

test('schema review retains prior missing tokens and edits without mutating the source options', () => {
  const imported = importDataset([{ x: 'missing', y: 1 }, { x: '2', y: 2 }], { missingTokens: ['', 'missing'], fieldOverrides: { y: { type: 'ordinal', order: [1, 2] } } });
  const settings = importReviewSettings(imported, { reuse: true });
  assert.deepEqual(settings.missingTokens, ['', 'missing']);
  settings.fieldOverrides.y.order.reverse(); assert.deepEqual(imported.options.fieldOverrides.y.order, [1, 2]);
  assert.deepEqual(importDataset(imported, settings).rows.map(row => row.x), [null, 2]);
});

test('ordinal review preserves invalid/unblurred drafts across unrelated edits and applies only corrected orders', () => {
  const raw = [8, 6, 5, 4, 3].map((Cylinders, y) => ({ Cylinders, y }));
  const imported = importDataset(raw);
  const settings = importReviewSettings(imported);
  settings.fieldOverrides.Cylinders = { type: 'ordinal' };
  const drafts = createCategoryOrderDrafts(settings.fieldOverrides);
  drafts.write('Cylinders', '3,4,5,6,8');
  assert.equal(drafts.commit().valid, false, 'Update preview must reject invalid draft');
  settings.fieldOverrides.y = { type: 'nominal' };
  assert.equal(drafts.commit().valid, false, 'another field change cannot erase invalid order');
  assert.equal(drafts.read('Cylinders'), '3,4,5,6,8');
  assert.equal(settings.fieldOverrides.Cylinders.order, undefined);
  drafts.write('Cylinders', '[3,4,5,6,8]');
  assert.equal(drafts.commit().valid, true, 'input draft can be committed without a change/blur event');
  const revised = importDataset(imported, settings);
  assert.deepEqual(revised.fieldTypes.Cylinders, { type: 'ordinal', order: [3,4,5,6,8] });
  assert.deepEqual(revised.options.fieldOverrides.Cylinders.order, [3,4,5,6,8]);
  assert.deepEqual(profile(revised).fields.find(field => field.name === 'Cylinders').order, [3,4,5,6,8]);
  assert.deepEqual(revised.rawRows, raw);
  drafts.write('Cylinders', '[3,');
  assert.equal(drafts.commit().valid, false);
  assert.deepEqual(settings.fieldOverrides.Cylinders.order, [3,4,5,6,8], 'failed preview cannot replace the last valid interpretation');
  settings.fieldOverrides.Cylinders.type = 'nominal';
  assert.equal(drafts.commit().valid, true, 'switching away from ordinal can resolve the error');
  settings.fieldOverrides.Cylinders.type = 'ordinal';
  assert.equal(drafts.read('Cylinders'), '[3,');
  assert.equal(drafts.commit().valid, false, 'switching back retains the unfinished order');
});

test('canceling and replacing an import ignores stale worker results', async () => {
  const workers = []; const workerFactory = () => {
    const callbacks = {}; const worker = { terminated: false, callbacks,
      addEventListener(type, handler) { callbacks[type] = handler; }, postMessage(message) { this.message = message; }, terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  };
  const client = createImportClient({ workerFactory });
  const first = client.import('first'); const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const second = client.import('second'); await firstRejected; assert.equal(workers[0].terminated, true);
  workers[0].callbacks.message({ data: { id: workers[0].message.id, result: 'stale' } });
  workers[1].callbacks.message({ data: { id: workers[1].message.id, result: 'fresh' } });
  assert.equal(await second, 'fresh');
  const third = client.import('third'); const thirdRejected = assert.rejects(third, { name: 'AbortError' }); client.cancel(); await thirdRejected;
  assert.equal(workers[2].terminated, true);
});

test('schema override changes category semantics and preserves explicit order in profiles and statistics', () => {
  const imported = importDataset([{ sex: 1, year: 2001, value: 2 }, { sex: 2, year: 2000, value: 4 }], {
    fieldOverrides: { sex: { type: 'nominal' }, year: { type: 'ordinal', order: [2000, 2001] } },
  });
  const p = profile(imported); assert.equal(p.fields.find(f => f.name === 'sex').type, 'nominal');
  assert.deepEqual(p.fields.find(f => f.name === 'year').order, [2000, 2001]);
  const descriptor = describeDataset(imported.rows, imported.fieldTypes); assert.equal(descriptor.fields.find(f => f.name === 'sex').type, 'nominal');
  assert.equal(descriptor.fields.find(f => f.name === 'year').type, 'ordinal');
  const repaired = importDataset([{ x: '2', y: 1 }, { x: 'bad', y: 2 }], { fieldOverrides: { x: { type: 'quantitative', invalid: 'exclude' } } });
  assert.deepEqual(repaired.rows.map(r => r.x), [2, null]); assert.equal(repaired.schema.find(f => f.name === 'x').invalid, 1);
});

test('virtual table windows retain source extent and bound mounted cells for original stress sizes', () => {
  for (const [rowCount, columnCount] of [[156771, 3], [293, 184]]) for (const [top, left] of [[0, 0], [3000, 1400], [rowCount * 24 - 250, columnCount * 58 - 430]]) {
    const w = tableWindow({ rowCount, columnCount, scrollTop: Math.max(0, top), scrollLeft: Math.max(0, left), width: 430, height: 210 });
    assert.ok(w.rowStart >= 0 && w.rowEnd <= rowCount); assert.ok(w.columnStart >= 0 && w.columnEnd <= columnCount);
    assert.equal(w.top + (w.rowEnd - w.rowStart) * TABLE_ROW_HEIGHT + w.bottom, rowCount * TABLE_ROW_HEIGHT);
    assert.equal(w.left + (w.columnEnd - w.columnStart) * TABLE_COLUMN_WIDTH + w.right, columnCount * TABLE_COLUMN_WIDTH);
    assert.ok((w.rowEnd - w.rowStart) * (w.columnEnd - w.columnStart) <= 204);
  }
  assert.deepEqual(columnSelectionChange({ x: 'a', y: '', color: '' }, 'b'), { y: 'b' });
  assert.deepEqual(columnSelectionChange({ x: '', y: '', color: 'a' }, 'b'), { x: 'b' });
  assert.deepEqual(columnSelectionChange({ x: 'a', y: 'b', color: 'a' }, 'a'), { x: '', color: '' });
  assert.equal(columnSelectionChange({ x: 'a', y: 'b', color: 'c' }, 'd'), null);
});
