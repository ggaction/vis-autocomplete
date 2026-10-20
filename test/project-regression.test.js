import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { importDataset } from '../src/data-import.js';
import { profileDataset } from '../src/profile.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { selectionData, selectionAxes } from '../web/selection-setup.js';
import { createProject, parseProject, restoreSession, runnableCode } from '../web/project.js';
import { createHistory } from '../web/history.js';

const run = promisify(execFile);
const engine = createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url))));
function start(name, selection) {
  const imported = importDataset(JSON.parse(readFileSync(new URL(`../web/data/${name}.json`, import.meta.url))), { name });
  const baseCalls = [{ method: 'createCanvas', args: defaultCanvasOptions() },
    { method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } }];
  const base = chart().createCanvas(baseCalls[0].args).createData({ id: 'dataset', values: imported.rows });
  const profile = profileDataset(base, 'dataset', imported.fieldTypes);
  const selected = selectionData(base, profile, imported.rows, selection);
  const snapshot = { program: selected.program, view: selected.program, selectionAxes: selectionAxes(selected.program, profile, imported.rows, selection),
    setupCalls: [...baseCalls, ...selected.calls], calls: [], context: {}, steps: 0, guideCall: null,
    selection, plotData: selected.data, optionGroup: 'encoding', phase: 'initial', currentNote: '' };
  return { id: name, name, imported, profile, session: { entries: [snapshot], index: 0 } };
}
function append(record, action, setup = []) {
  const previous = record.session.entries.at(-1);
  const prepared = prepareGuidedAction(previous.program, action, previous.view, setup);
  const snapshot = { ...previous, program: prepared.authoringPreview, view: prepared.preview,
    calls: [...previous.calls, ...prepared.prerequisiteCalls, { method: prepared.recommendation.method, args: prepared.recommendation.args },
      ...(prepared.postActionCalls ?? [])],
    guideCall: prepared.guideCall, steps: previous.steps + 1, phase: 'recommendations', currentNote: action.method };
  record.session.entries.push(snapshot); record.session.index++;
  return { snapshot, prepared };
}
function plot(record, method, values = {}) {
  const initial = record.session.entries[0];
  const result = engine.recommend(record.imported.rows, { ...record.profile, id: initial.plotData }, { selection: initial.selection });
  const rec = result.recommendations.find(r => r.method === method); assert.ok(rec, method); assert.ok(!rec.requirement, rec.requirement);
  const options = { ...rec.values, ...values };
  return append(record, { method, args: rec.build(options) }, rec.setup?.(options) ?? []);
}
function roundTrip(record) {
  const packed = parseProject(JSON.stringify(createProject([record], record.id)));
  const restored = restoreSession(packed.datasets[0].session, packed.datasets[0].imported.rows);
  assert.equal(restored.index, record.session.index); assert.equal(restored.entries.length, record.session.entries.length);
  for (const [index, original] of record.session.entries.entries()) {
    const copy = restored.entries[index];
    assert.deepEqual(copy.program.semanticSpec, original.program.semanticSpec, `authoring state ${index}`);
    assert.deepEqual(copy.view.semanticSpec, original.view.semanticSpec, `displayed state ${index}`);
    assert.equal(renderToSVG(copy.view), renderToSVG(original.view), `displayed SVG ${index}`);
    assert.equal(copy.view.trace.children.filter(n => n.op === 'createGuides').length, index ? 1 : 0);
    if (!index) assert.equal(renderToSVG(copy.selectionAxes.program), renderToSVG(original.selectionAxes.program));
  }
  return restored;
}
async function executeExport(record, snapshot) {
  const folder = resolve('output'); await mkdir(folder, { recursive: true });
  const cwd = await mkdtemp(`${folder}/project-export-test-`);
  try {
    const source = runnableCode(snapshot, record, { commit: 'tested-native-source' });
    await writeFile(`${cwd}/chart.mjs`, source);
    await run(process.execPath, ['chart.mjs'], { cwd, timeout: 30000 });
    const actual = await readFile(`${cwd}/chart.svg`, 'utf8');
    const expected = snapshot.phase === 'initial' ? snapshot.selectionAxes.program : snapshot.view;
    assert.equal(actual, renderToSVG(expected));
    return source;
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

test('project preserves selected missing-value filters, temporal axes and calendar area prerequisites through undo/redo', async () => {
  const record = start('weather', { x: 'date', y: 'temp_max', color: 'weather' });
  const { prepared } = plot(record, 'createAreaPlot', { timeUnit: 'month' });
  assert.ok(prepared.prerequisiteCalls.some(call => call.method === 'createTimeUnitData'));
  assert.ok(prepared.prerequisiteCalls.some(call => call.method === 'createSummaryData'));
  append(record, { method: 'editYAxis', args: { ticksAndLabels: { count: 4 } } });
  record.session.index = 1;
  const restored = roundTrip(record), history = createHistory(); history.restore(restored.entries, restored.index);
  assert.equal(history.canRedo, true); assert.equal(history.redo().steps, 2); assert.equal(history.undo().steps, 1);
  await executeExport(record, record.session.entries[0]);
  const code = await executeExport(record, record.session.entries[2]);
  assert.ok(code.includes('.createTimeUnitData(')); assert.ok(code.includes('.createSummaryData('));
  assert.equal((code.match(/\.createGuides\(/g) ?? []).length, 1);

  const cars = start('cars', { x: 'Miles_per_Gallon', y: 'Horsepower', color: 'Origin' });
  assert.ok(cars.session.entries[0].setupCalls.some(call => call.method === 'filterData'));
  plot(cars, 'createScatterPlot'); roundTrip(cars);
  const final = cars.session.entries.at(-1); assert.equal(final.program.semanticSpec.datasets.find(d => d.id === final.plotData).values.length, 392);
  assert.equal(final.program.semanticSpec.datasets.find(d => d.id === 'dataset').values.length, 406);
  assert.ok((await executeExport(cars, final)).includes('.filterData('));
});

test('faceted histories replay promoted guide setup and edited facet source; runnable export matches displayed guides', async () => {
  const record = start('iris', { x: 'Sepal.Length', y: 'Petal.Length', color: 'Species' });
  plot(record, 'createScatterPlot');
  const legend = append(record, { method: 'editLegend', args: { target: 'plot', channel: 'color', position: 'bottom' } });
  assert.ok(legend.prepared.prerequisiteCalls.some(call => call.method === 'createLegend'));
  append(record, { method: 'facet', args: { field: 'Species', data: 'dataset', columns: 3 } });
  append(record, { method: 'editFacetSource', args: { action: { method: 'encodeOpacity', options: { target: 'plot', value: .5 } } } });
  append(record, { method: 'createTitle', args: { text: 'Iris by species', position: 'top' } });
  roundTrip(record);
  const code = await executeExport(record, record.session.entries.at(-1));
  for (const method of ['createLegend', 'facet', 'editFacetSource', 'createTitle']) assert.ok(code.includes(`.${method}(`));
});

test('automatic legend updates after an encoding remain explicit, saved and independently runnable', async () => {
  const record = start('iris', { x: 'Sepal.Length', y: 'Petal.Length', color: 'Species' });
  plot(record, 'createLinePlot');
  const { snapshot, prepared } = append(record, { method: 'encodeStrokeDash',
    args: { target: 'plot', field: 'Species', fieldType: 'nominal' } });
  assert.equal(prepared.recommendation.validation.topLevelActions, 1);
  assert.ok(prepared.postActionCalls.some(call => call.method === 'editLegend'));
  assert.deepEqual(snapshot.calls.slice(-2).map(call => call.method), ['encodeStrokeDash', 'editLegend']);
  roundTrip(record);
  const code = await executeExport(record, snapshot);
  assert.ok(code.indexOf('.encodeStrokeDash(') < code.indexOf('.editLegend('));
  assert.ok(code.indexOf('.editLegend(') < code.indexOf('.createGuides('));
});
