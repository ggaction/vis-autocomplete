import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkbook, describeWorkbook } from '../src/xlsx-import.js';
import { importDataset } from '../src/data-import.js';
import { createWorkbookClient } from '../web/workbook-client.js';
import { createProject, parseProject } from '../web/project.js';
import { sampleWorkbook, workbookBytes } from './fixtures/xlsx-workbook.js';

test('XLSX sheets retain native numbers, booleans, dates and text identifiers through import, schema edit and project restore', () => {
  const sheets = readWorkbook(sampleWorkbook());
  assert.deepEqual(describeWorkbook(sheets).map(({ name, rows, columns }) => ({ name, rows, columns })), [
    { name: '매출 Sales', rows: 2, columns: 7 }, { name: 'Inventory', rows: 2, columns: 3 }, { name: 'Empty', rows: 0, columns: 0 },
  ]);
  assert.equal(sheets[0].table[1][4], '2024-01-02T00:00:00.000Z');
  assert.equal(sheets[0].table[2][4], '2024-02-02T00:00:00.000Z');
  const imported = importDataset(sheets[0].table, { format: 'xlsx', name: 'Research — 매출 Sales', workbook: { fileName: 'Research.xlsx', sheetName: sheets[0].name, warnings: [] } });
  assert.equal(imported.rows[0].Sales, 120); assert.equal(imported.rows[0].Code, '001'); assert.equal(imported.rows[0].Active, true);
  assert.equal(imported.fieldTypes.Recorded, 'temporal'); assert.equal(imported.fieldTypes.Sales, 'quantitative');
  const edited = importDataset(imported, { fieldOverrides: { Sales: { name: 'Revenue' }, Cost: { exclude: true } } });
  assert.equal(edited.rows[0].Revenue, 120); assert.equal(edited.rows[0].Cost, undefined);
  assert.equal(edited.rawRows[0].Cost, 90); assert.equal(edited.metadata.workbook.sheetName, '매출 Sales');
  assert.equal(edited.metadata.format, 'xlsx');
  assert.deepEqual(importDataset(edited, { fieldOverrides: {} }).rows, imported.rows);
  const restored = parseProject(JSON.stringify(createProject([{ id: 'excel', name: 'Research', imported: edited }], 'excel')));
  assert.deepEqual(importDataset(restored.datasets[0].imported).rows, edited.rows);
  assert.ok(!JSON.stringify(restored).includes('Inventory'), 'Only the selected sheet is saved with the project');
});

test('Excel 1904 dates and fractional-day times are interpreted without local timezone shifts', () => {
  const result = readWorkbook(workbookBytes([{ name: 'Dates', rows: [['When', 'Value'], [1, 2]],
    cells: { A2: { t: 'n', v: 1.5, z: 'yyyy-mm-dd hh:mm:ss' } } }], { WBProps: { date1904: true } }));
  assert.equal(result[0].table[1][0], '1904-01-02T12:00:00.000Z');
});

test('blank/duplicate Excel headers use CSV repair rules; blank rows/leading columns do not create fake records', () => {
  const sheets = readWorkbook(workbookBytes([{ name: 'Sparse', rows: [[], [], [null, 'name', 'name', null],
    [null, 'A', 'B', 3], [], [null, 'C', 'D', 4]] }]));
  const imported = importDataset(sheets[0].table, { format: 'xlsx' });
  assert.deepEqual(imported.rows, [{ name: 'A', 'name (2)': 'B', 'Column 3': 3 }, { name: 'C', 'name (2)': 'D', 'Column 3': 4 }]);
  assert.equal(imported.metadata.warnings.filter(w => w.code === 'header-repaired').length, 2);
});

test('formula cached results, missing results and Excel errors are represented and explained rather than recalculated', () => {
  const [sheet] = readWorkbook(workbookBytes([{ name: 'Formulas', rows: [['Cached', 'Uncached', 'Error'], [3, null, null]],
    cells: { A2: { t: 'n', v: 3, f: '1+2' }, B2: { t: 'n', f: '10+5' }, C2: { t: 'e', v: 7, f: '1/0' } }, ref: 'A1:C2' }]));
  assert.deepEqual(sheet.table[1], [3, null, '#DIV/0!']);
  assert.deepEqual(sheet.warnings.map(w => w.code), ['excel-formulas', 'excel-uncached-formulas', 'excel-cell-errors']);
  const imported = importDataset(sheet.table, { format: 'xlsx', workbook: { sheetName: sheet.name, warnings: sheet.warnings } });
  assert.ok(imported.metadata.warnings.some(w => w.code === 'excel-uncached-formulas'));
  assert.ok(importDataset(imported).metadata.warnings.some(w => w.code === 'excel-uncached-formulas'));
});

test('unreadable/renamed files fail and header-only/hidden sheets remain identifiable', () => {
  for (const data of [new Uint8Array(), new TextEncoder().encode('a,b\n1,2'), new Uint8Array([0x50, 0x4b, 3, 4, 1])]) {
    assert.throws(() => readWorkbook(data), /workbook|xlsx/);
  }
  const sheets = readWorkbook(workbookBytes([{ name: 'Header', rows: [['x', 'y']] }, { name: 'Hidden', rows: [['x'], [1]] }], { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] }));
  assert.equal(describeWorkbook(sheets)[0].rows, 0); assert.equal(sheets[1].hidden, true);
  assert.throws(() => importDataset(sheets[0].table, { format: 'xlsx' }), /at least one data row/);
});

test('workbook worker is lazy, reused between sheet selection, and canceled without applying stale results', async () => {
  const workers = [];
  const client = createWorkbookClient({ workerFactory() {
    const worker = { events: {}, sent: [], addEventListener(name, fn) { this.events[name] = fn; }, postMessage(data) { this.sent.push(data); }, terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  } });
  assert.equal(workers.length, 0);
  const opened = client.request('open', new ArrayBuffer(1)); const worker = workers[0];
  worker.events.message({ data: { id: worker.sent[0].id, result: [{ name: 'First' }] } });
  assert.deepEqual(await opened, [{ name: 'First' }]);
  const selected = client.request('sheet', 'First'); assert.equal(workers.length, 1);
  const rejected = assert.rejects(selected, { name: 'AbortError' }); client.cancel(); await rejected;
  assert.equal(worker.terminated, true);
  worker.events.message({ data: { id: worker.sent[1].id, result: [['late']] } });
  const reopened = client.request('open', new ArrayBuffer(1)); assert.equal(workers.length, 2);
  workers[1].events.message({ data: { id: workers[1].sent[0].id, result: [] } }); await reopened; client.cancel();
});
