import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { profileDataset } from '../src/profile.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { initialParameters, activeControls } from '../web/parameters.js';
import { selectionData, selectionAxes } from '../web/selection-setup.js';
import { columnSelectionChange } from '../web/data-table.js';
import { buildInitialIndex, canonicalDataFingerprint } from '../scripts/initial-corpus.js';
import { captureHistorySnapshot } from '../web/history.js';
import { packSession, restoreSession } from '../web/project.js';
const read = name => JSON.parse(readFileSync(new URL(`../web/data/${name}.json`, import.meta.url)));
const model = JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url)));
const engine = createInitialChartRecommender(model);
const base = rows => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows });
function recommend(rows, fields) {
  const program = base(rows), profile = profileDataset(program, 'dataset');
  return { program, profile, ...engine.recommend(rows, profile, { selection: { fields } }) };
}
function prepare(program, rec, changes = {}) {
  const editor = initialParameters(rec), values = editor.normalizeValues({ ...editor.values, ...changes });
  const call = { method: rec.method, args: editor.build(values) };
  return { editor, values, call, prepared: prepareGuidedAction(program, call, program, editor.setup?.(values) ?? []) };
}

test('field selection is unbounded, reversible, and produces no premature axes or filters', () => {
  let selection = { fields: [] };
  for (const field of ['A', 'B', 'C', 'D', 'E', 'F']) selection = columnSelectionChange(selection, field);
  assert.equal(selection.fields.length, 6);
  selection = columnSelectionChange(selection, 'B'); assert.deepEqual(selection.fields, ['A', 'C', 'D', 'E', 'F']);
  const rows = read('cars'), p = base(rows), profile = profileDataset(p, 'dataset');
  const input = { fields: ['Horsepower', 'Miles_per_Gallon', 'Origin'] };
  assert.equal(selectionData(p, profile, rows, input).program, p);
  assert.deepEqual(selectionAxes(p, profile, rows, input).calls, []);
  assert.equal(engine.recommend(rows, profile, { selection: { fields: [] } }).recommendations.length, 0);
  assert.throws(() => engine.recommend(rows, profile, { selection: { fields: ['unknown'] } }), /no usable/);
});

test('all shipped 1/3/5-field chart suggestions execute with public calls on original rows', () => {
  const cases = [['cars', ['Horsepower']], ['cars', ['Origin']],
    ['cars', ['Horsepower', 'Miles_per_Gallon', 'Origin']],
    ['cars', ['Miles_per_Gallon', 'Horsepower', 'Year']],
    ['barley', ['variety', 'site', 'yield']],
    ['iris', ['Sepal.Length', 'Sepal.Width', 'Petal.Length', 'Petal.Width', 'Species']]];
  for (const [file, fields] of cases) {
    const { program, recommendations } = recommend(read(file), fields);
    assert.ok(recommendations.length >= 3, `${file}: ${fields}`);
    assert.equal(new Set(recommendations.map(rec => rec.method)).size, recommendations.length, 'one card per chart type');
    for (const rec of recommendations.filter(rec => !rec.requirement)) {
      const { prepared, call, editor, values } = prepare(program, rec);
      assert.equal(typeof program[call.method], 'function');
      assert.equal(prepared.recommendation.method, rec.method);
      assert.ok(renderToSVG(prepared.preview).startsWith('<svg'));
      assert.ok(editor.usage(values).every(field => fields.includes(field)), 'no unselected fields');
    }
  }
});

test('two categories and a measure become categorical-grid heatmap roles automatically', () => {
  const fields = ['variety', 'site', 'yield'], result = recommend(read('barley'), fields);
  const rec = result.recommendations.find(rec => rec.method === 'createHeatmap');
  assert.deepEqual(rec.usedFields, fields);
  const { values, call } = prepare(result.program, rec);
  assert.ok(['variety', 'site'].includes(values.mapping_x));
  assert.ok(['variety', 'site'].includes(values.mapping_y));
  assert.equal(values.mapping_color, 'yield'); assert.equal(call.args.color.field, 'yield');
});

test('all selected numeric dimensions participate in parallel coordinates, with editable order', () => {
  const fields = ['Sepal.Length', 'Sepal.Width', 'Petal.Length', 'Petal.Width', 'Species'];
  const result = recommend(read('iris'), fields), rec = result.recommendations.find(rec => rec.method === 'createParallelCoordinates');
  assert.equal(result.recommendations[0], rec);
  const dims = fields.slice(0, 4).reverse(), { call } = prepare(result.program, rec, { dimensions: dims });
  assert.deepEqual(call.args.dimensions, dims); assert.equal(call.args.color.field ?? call.args.color, 'Species');
});

test('mapping edits preserve pinned settings, swap atomically, and update dependent controls', () => {
  const result = recommend(read('cars'), ['Horsepower', 'Miles_per_Gallon', 'Origin']);
  const scatter = initialParameters(result.recommendations.find(rec => rec.method === 'createScatterPlot'));
  const start = scatter.normalizeValues(scatter.values);
  const swapped = scatter.normalizeValues({ ...start, mapping_x: start.mapping_y, __previousMapping: start }, 'mapping_x');
  assert.equal(swapped.mapping_x, start.mapping_y); assert.equal(swapped.mapping_y, start.mapping_x);
  const recolored = scatter.normalizeValues({ ...swapped, palette: 'set1' }, 'palette');
  assert.equal(scatter.build(recolored).color.scale.palette, 'set1');
  const plain = scatter.normalizeValues({ ...recolored, mapping_color: '' }, 'mapping_color');
  assert.equal(scatter.build(plain).color, undefined);
  assert.ok(!activeControls(scatter.resolveControls(plain), plain).some(c => c.key === 'palette'));
  const bar = initialParameters(result.recommendations.find(rec => rec.method === 'createBarPlot'));
  for (const binding of [{ mapping_x: 'Horsepower', mapping_y: 'Miles_per_Gallon', mapping_color: 'Origin' },
    { mapping_x: 'Origin', mapping_y: 'Horsepower', mapping_color: '' }]) {
    const v = bar.normalizeValues({ ...bar.values, ...binding });
    const names = activeControls(bar.resolveControls(v), v).map(c => c.key);
    assert.equal(names.includes('bins'), binding.mapping_x === 'Horsepower');
    prepareGuidedAction(result.program, { method: bar.method, args: bar.build(v) }, result.program, bar.setup(v));
  }
});

test('partial suggestions filter only their own variables, and unrelated columns cannot influence ranking', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ A: i + 1, B: i % 2 ? null : 20 - i, Group: i % 2 ? 'a' : 'b', Noise: 0 }));
  const result = recommend(rows, ['A', 'B', 'Group']);
  const histogram = result.recommendations.find(rec => rec.method === 'createHistogram');
  const { editor, values } = prepare(result.program, histogram, { mapping_x: 'A', mapping_color: '' });
  assert.deepEqual(editor.usage(values), ['A']); assert.deepEqual(editor.setup(values), []);
  const changed = recommend(rows.map(row => ({ ...row, Noise: Math.random(), Extra: 'unrelated' })), ['A', 'B', 'Group']);
  assert.deepEqual(changed.query, result.query);
  assert.deepEqual(changed.recommendations.map(r => [r.method, r.values, r.score]), result.recommendations.map(r => [r.method, r.values, r.score]));
});

test('corpus field profiles use chart-owned columns, not unused dataset columns', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i * i, unused: `id-${i}`, another: null }));
  const { model } = buildInitialIndex([{ id: 'a', data: rows, dataHash: canonicalDataFingerprint(rows), stages: [],
    source: { mark: 'point', encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } } } }]);
  assert.equal(model.groups[0].profile.fields.length, 4);
  assert.equal(model.viewGroups.length, 1);
  assert.deepEqual(model.viewGroups[0].profile.fields.map(f => f.name), ['x', 'y']);
  assert.equal(model.viewGroups[0].distribution.createScatterPlot, 1);
  const result = createInitialChartRecommender(model).recommend(rows, profileDataset(base(rows), 'dataset'), { selection: { fields: ['x', 'y'] } });
  assert.equal(result.diagnostics.corpusProfiles, 'chart-field-subsets');
  assert.equal(result.neighbors[0].distance, 0);
});

test('arbitrary field sets persist through project history round trips', () => {
  const rows = read('iris'), program = base(rows), fields = Object.keys(rows[0]);
  const snapshot = captureHistorySnapshot({ program, view: program, selectionAxes: { program, calls: [] },
    selection: { fields }, setupCalls: [{ method: 'createCanvas', args: defaultCanvasOptions() },
      { method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } }], calls: [], context: {},
    steps: 0, guideCall: null, plotData: 'dataset', optionGroup: 'encoding', phase: 'initial', currentNote: '' });
  const restored = restoreSession(packSession({ entries: [snapshot], index: 0 }), rows);
  assert.deepEqual(restored.entries[0].selection, { fields });
});


test('async search matches synchronous ranking and cancels obsolete selections between frames', async () => {
  const rows = read('iris'), p = base(rows), profile = profileDataset(p, 'dataset'), selection = { fields: Object.keys(rows[0]) };
  const sync = engine.recommend(rows, profile, { selection });
  let frames = 0;
  const asyncResult = await engine.recommendAsync(rows, profile, { selection, yieldFrame: async () => { frames++; } });
  assert.ok(frames > 0);
  assert.deepEqual(asyncResult.recommendations.map(r => [r.method, r.values]), sync.recommendations.map(r => [r.method, r.values]));
  let stale = false;
  const cancelled = await engine.recommendAsync(rows, profile, { selection, yieldFrame: async () => { stale = true; }, cancelled: () => stale });
  assert.equal(cancelled.cancelled, true);
});

test('derived corpus roles retain source lineage and unresolved charts remain audited in the index', () => {
  const rows = [{ raw: 10, category: 'A', unused: 1 }, { raw: 20, category: 'B', unused: 2 }];
  const records = [{ id: 'derived', data: rows, dataHash: canonicalDataFingerprint(rows),
    stages: [{ calls: [{ method: 'createComputedData', options: { as: 'amount', expression: { op: 'divide', left: { field: 'raw' }, right: { constant: 10 } } } }] }],
    source: { mark: 'bar', encoding: { x: { field: 'category' }, y: { field: 'amount' } } } },
    { id: 'unresolved', data: rows, dataHash: canonicalDataFingerprint(rows), stages: [],
      source: { mark: 'point', encoding: { x: { field: 'dynamic-x' }, y: { field: 'dynamic-y' } } } }];
  const { model, report } = buildInitialIndex(records);
  assert.equal(report.fieldProfileChartCount, 2);
  const derived = model.viewGroups.find(g => g.charts.some(c => c.id === 'derived'));
  assert.deepEqual(derived.profile.fields.map(f => f.name), ['category', 'raw']);
  assert.deepEqual(derived.charts[0].views[0].sourceRoles.y, ['raw']);
  assert.equal(report.fieldProfileFallbacks[0].basis, 'dataset-fallback');
  assert.equal(new Set(model.viewGroups.flatMap(g => g.charts.map(c => c.id))).size, 2);
});
