import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { ACTION_HIERARCHY, createHierarchyProjection } from '../src/action-hierarchy.js';
import { createRecommendationEngine, applyRecommendation } from '../src/engine.js';
import { addDefaultGuides, defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { trainCooccurrenceModel } from '../src/model.js';

const corpusModel = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
  Array.from({ length: 30 }, (_, i) => ({ X: i + 1, Y: i % 7 + 1, Other: i % 5 + 1, Group: i % 2 ? 'A' : 'B' })) })
  .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'Group' });
const options = { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS };
const rec = (method, score, args = {}, category = 'style', extra = {}) => ({
  id: JSON.stringify([method, args]), method, score, args, category, feature: `action.${method}`,
  previouslyApplied: false, explanation: { score, candidateFeature: `action.${method}` }, ...extra,
});
const axes = () => [rec('editYAxisTitle', .9, { target: 'y', text: 'Value' }),
  rec('createTitle', .8, { text: 'Example' }), rec('editXAxisLabels', .7, { target: 'x', fontSize: 13 }),
  rec('editYAxis', .3, { target: 'y', labels: { fontSize: 13 } }),
  rec('editXAxis', .2, { target: 'x', labels: { fontSize: 13 } }),
  rec('editAxes', .1, { x: { target: 'x', labels: { fontSize: 13 } }, y: { target: 'y', labels: { fontSize: 13 } } })];

test('containment names real public functions and has no cycles', () => {
  const p = chart();
  const visit = (name, path = []) => {
    assert.equal(typeof p[name], 'function', name);
    assert.ok(!path.includes(name), `cycle: ${[...path, name]}`);
    for (const child of ACTION_HIERARCHY[name] ?? []) visit(child, [...path, name]);
  };
  Object.keys(ACTION_HIERARCHY).forEach(name => visit(name));
});

test('rank first, promote second: a low-score ancestor inherits the first descendant, once, without sum or re-sort', () => {
  const input = axes(), before = structuredClone(input);
  const output = createHierarchyProjection(input, base()).project();
  assert.deepEqual(output.map(r => [r.method, r.score]), [['editAxes', .9], ['createTitle', .8]]);
  assert.deepEqual(output[0].args, input.at(-1).args);
  assert.strictEqual(output[0].explanation, input[0].explanation);
  assert.equal(output[0].hierarchy.sourceMethod, 'editYAxisTitle');
  assert.equal(output[0].hierarchy.sourceRank, 1);
  assert.deepEqual(input, before);
});

test('Apply advances only explicit functions; Undo and persistence derive the same stage from authored history', () => {
  const initial = base(), first = initial.editAxes({ y: { labels: { fontFamily: 'Arial', fontSize: 13 } } });
  const second = first.editYAxis({ labels: { fontFamily: 'Arial', fontSize: 14 } });
  const top = program => createHierarchyProjection(axes(), program).project()[0].method;
  assert.equal(top(initial), 'editAxes', 'automatic guides are not user edits');
  assert.equal(top(first), 'editYAxis', 'internal editYAxis inside editAxes is not another Apply');
  assert.equal(top(second), 'editYAxisTitle');
  assert.equal(top(deserializeProgram(serializeProgram(second))), 'editYAxisTitle');
  assert.equal(top(first), 'editYAxis', 'Undo');
  assert.equal(top(initial), 'editAxes', 'History return to start');
});

test('missing and execution-rejected parents expose the next available ancestor and finally the leaf', () => {
  const input = axes(), projection = createHierarchyProjection(input, base());
  const missing = createHierarchyProjection(input.filter(r => r.method !== 'editAxes'), base()).project();
  assert.equal(missing[0].method, 'editYAxis');
  const unavailable = new Set(input.filter(r => r.method === 'editAxes').map(r => r.id));
  assert.equal(projection.project(unavailable)[0].method, 'editYAxis');
  unavailable.add(input.find(r => r.method === 'editYAxis').id);
  assert.equal(projection.project(unavailable)[0].method, 'editYAxisTitle');
});

test('same post-ranking policy applies to Encoding and Transform without borrowing a parent from another group', () => {
  const input = [rec('encodeOpacity', .9, { target: 'plot', value: .4 }, 'encoding'),
    rec('encodeSize', .8, { target: 'plot', value: 80 }, 'encoding'),
    rec('encodeChannels', .1, { target: 'plot', channels: { opacity: { value: .4 } } }, 'encoding'),
    rec('createReferenceLine', .7, { source: 'plot', axis: 'y', value: 3 }, 'transform'),
    rec('createStatisticalReference', .2, { source: 'plot', axis: 'y', statistic: { op: 'mean' } }, 'transform')];
  const output = createHierarchyProjection(input, base()).project();
  assert.deepEqual(output.map(r => [r.method, r.score]), [['encodeChannels', .9], ['createStatisticalReference', .7]]);
  for (const r of output) assert.equal(base()[r.method](r.args).trace.children.at(-1).op, r.method);
  const separated = input.map(r => r.method === 'encodeChannels' ? { ...r, category: 'transform' } : r);
  assert.equal(createHierarchyProjection(separated, base()).project()[0].method, 'encodeOpacity');
});

test('an Apply on another target or legend channel does not unlock this branch', () => {
  const initial = base().createScatterPlot({ id: 'other', x: 'X', y: 'Y', color: 'Group' })
    .createLegend({ target: 'other', channels: ['color'] });
  const input = [rec('editLegendTitle', .9, { target: 'plot', channel: 'color', title: 'Origin' }),
    rec('editLegend', .1, { target: 'plot', channel: 'color', position: 'left' })];
  const other = initial.editLegend({ target: 'other', channel: 'color', position: 'left' });
  assert.equal(createHierarchyProjection(input, other).project()[0].method, 'editLegend');
  const own = other.removeLegend({ target: 'other' }).createLegend({ target: 'plot', channels: ['color'] })
    .editLegend({ target: 'plot', channel: 'color', position: 'left' });
  assert.equal(createHierarchyProjection(input, own).project()[0].method, 'editLegendTitle');
  const size = base().encodeSize({ target: 'plot', field: 'Other', fieldType: 'quantitative' })
    .createLegend({ target: 'plot', channels: ['color', 'size'] })
    .editLegend({ target: 'plot', channel: 'size', labels: { fontFamily: 'Arial', fontSize: 13 } });
  assert.equal(createHierarchyProjection(input, size).project()[0].method, 'editLegend');
});

test('facet source wrappers keep the promoted function, target and real public wrapper together', () => {
  const input = axes().map(r => ({ ...r, id: `facet:${r.id}`, sourceMethod: r.method, method: 'editFacetSource',
    args: { action: { method: r.method, options: r.args } } }));
  const output = createHierarchyProjection(input, base()).project();
  assert.equal(output[0].method, 'editFacetSource');
  assert.equal(output[0].sourceMethod, 'editAxes');
  assert.equal(output[0].args.action.method, 'editAxes');
  assert.equal(output[0].hierarchy.sourceMethod, 'editYAxisTitle');
});

function titleModel(program) {
  const features = createRecommendationEngine(corpusModel).rank(program, { ...options, hierarchy: false }).state.features;
  return trainCooccurrenceModel(Array.from({ length: 10 }, (_, i) => ({ id: String(i),
    features: [...features, i < 9 ? 'action.editYAxisTitle' : 'action.editAxes'] })));
}

test('native eager engine keeps descendant evidence and issues a single valid ancestor call', () => {
  const program = base(), engine = createRecommendationEngine(titleModel(program));
  const raw = engine.recommend(program, { ...options, group: 'style', hierarchy: false });
  const projected = engine.recommend(program, { ...options, group: 'style' });
  const origin = raw.recommendations[0], top = projected.recommendations[0];
  assert.equal(origin.method, 'editYAxisTitle');
  assert.equal(top.method, 'editAxes');
  assert.equal(top.score, origin.score);
  const next = applyRecommendation(program, top);
  assert.equal(next.trace.children.length, program.trace.children.length + 1);
  assert.equal(next.trace.children.at(-1).op, 'editAxes');
  assert.equal(engine.recommend(next, { ...options, group: 'style' }).recommendations[0].method, 'editYAxis');
  assert.throws(() => engine.rank(program, { ...options, hierarchy: 'yes' }), /hierarchy/);
});

test('worker promotes before pagination, only validates displayed calls, and search directly reaches hidden details', () => {
  const program = base(), service = createCalculationService(titleModel(program));
  const state = (id, raw) => service.execute({ type: 'state', stateId: id, snapshot: serializeProgram(raw) });
  state(1, program);
  const request = (stateId = 1, searchQuery = '', page = 0) => service.execute({ type: 'recommend', stateId,
    options, group: 'style', searchQuery, page });
  const first = request();
  assert.equal(first.result.recommendations[0].method, 'editAxes');
  assert.ok(!first.result.diagnostics.validatedCalls.some(c => /AxisTitle|AxisLabels/.test(c.method)));
  const searched = request(1, 'editYAxisTitle');
  assert.ok(searched.result.recommendations.some(r => r.method === 'editYAxisTitle'));
  assert.ok(searched.result.diagnostics.validatedCalls.every(c => /edit[XY]AxisTitle/.test(c.method)), 'fuzzy matching can also match the other axis title');
  assert.strictEqual(searched.result.state, first.result.state, 'search reuses the raw group ranking');
  assert.deepEqual(request().result.recommendations, first.result.recommendations);
  const prepared = prepareGuidedAction(program, first.defaults[0].action, program);
  state(2, prepared.authoringPreview);
  assert.equal(request(2).result.recommendations[0].method, 'editYAxis');
  assert.equal(request().result.recommendations[0].method, 'editAxes', 'history stays immutable');
  let all = first;
  for (let page = 1; page < all.pagination.pageCount; page++) all = request(1, '', page);
  assert.equal(new Set(all.result.recommendations.map(r => r.id)).size, all.result.recommendations.length);
  assert.equal(all.pagination.complete, true);
  assert.equal(all.pagination.pageCount, Math.ceil(all.result.recommendations.length / 5));
});
