import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { createRecommendationEngine, applyRecommendation, profileDataset, ACTION_METHODS } from '../src/index.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../web/plot-setup.js';
import { groupRecommendations, optionGroup } from '../web/option-groups.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { scoreCandidate } from '../src/model.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const rows = Array.from({ length: 30 }, (_, i) => ({ X: i % 10 + 1, Y: i % 7 + 2, Other: i * 3 + 1, Group: ['A', 'B', 'C'][i % 3] }));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
// Legacy engine exclusion remains opt-in; the UI now retains these cards at the back.
const FOLLOWUP_RECOMMENDATION_OPTIONS = { limit: 1000, includeRevisions: true,
  excludeMappedChannels: ['x', 'y', 'color'], excludeAppliedEncodings: true };

test('execution inventory follows public ggaction types and excludes internal and extension primitives', () => {
  for (const method of ['encodeStrokeWidth', 'encodePointRadius', 'editColorScale', 'editCanvas', 'filterMarks', 'editSummaryData',
    'editWindowData', 'editComputedData', 'editLegendLayout', 'editXAxisTicksAndLabels']) assert.ok(ACTION_METHODS.includes(method), method);
  for (const method of ['createBoxMedian', 'editSemantic', 'editGraphics', 'createDerivedData', 'rematerializeLineMark']) assert.ok(!ACTION_METHODS.includes(method), method);
});

test('every observed corpus action has training evidence and an explicit context policy', () => {
  const report = JSON.parse(readFileSync(new URL('../data/corpus-report.json', import.meta.url)));
  assert.deepEqual(new Set(model.actionEvidence.methods.map(r => r.method)), new Set(Object.keys(report.actionFrequency)));
  assert.equal(model.actionEvidence.provenance.chartCount, report.chartCount);
  const p = base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y' });
  const result = engine.recommend(p, { target: 'plot', includeRevisions: true, limit: 1000 });
  assert.equal(result.diagnostics.corpusActions.length, model.actionEvidence.methods.length);
  assert.ok(result.diagnostics.corpusActions.every(a => a.role && typeof a.candidates === 'number'));
});

test('all groups keep valid revisions and retain every rank beyond their first page without changing paper scores', () => {
  const p = base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y' }).createGuides();
  const result = engine.recommend(p, { target: 'plot', includeRevisions: true, limit: 1000 });
  const groups = groupRecommendations(result.recommendations, 1000);
  assert.ok(groups.encoding.length > 5);
  const transformMethods = new Set(groups.transform.flatMap(rec => rec.alternatives.map(option => option.method)));
  assert.ok(transformMethods.size >= 4, 'the unified statistical action retains the other transform families');
  assert.equal(groups.transform.filter(rec => rec.method === 'createStatisticalReference').length, 1);
  assert.ok(transformMethods.has('createStatisticalReference'));
  assert.ok(!transformMethods.has('createReferenceLine') && !transformMethods.has('createReferenceBand'));
  assert.ok(groups.style.length > 5);
  assert.equal(Object.values(groups).flat().length, result.recommendations.length);
  for (const rec of result.recommendations) {
    const anchors = rec.kind === 'revision' ? result.state.features.filter(f => f !== rec.feature) : result.state.features;
    assert.equal(rec.score, scoreCandidate(model, anchors, rec.feature).score);
    assert.ok(groups[optionGroup(rec)].includes(rec));
  }
  const axes = result.recommendations.find(r => r.method === 'editAxes');
  const next = applyRecommendation(p, axes);
  const revisions = engine.recommend(next, { target: 'plot', includeRevisions: true, limit: 1000 });
  assert.ok(groupRecommendations(revisions.recommendations, 1000).style.some(r => r.method === 'editAxes' && r.kind === 'revision'));
});

test('position reassignments bind new scale owners for categorical fields', () => {
  const p = base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y' }).createGuides();
  const result = engine.recommend(p, { target: 'plot', includeRevisions: true, limit: 1000 });
  const rec = result.recommendations.find(r => r.method === 'encodeX' && r.category === 'encoding');
  const editor = recommendationParameters(rec, profileDataset(p, 'data'));
  const args = editor.build({ ...valuesFor(editor.controls), field: 'Group' });
  assert.equal(args.scale.type, 'band');
  assert.notEqual(args.scale.id, p.semanticSpec.layers[0].encoding.x.scale);
  assert.doesNotThrow(() => prepareGuidedAction(p, { method: rec.method, args }, p));
});

test('followups exclude applied fixed and variable encodings without hiding unused channels or changing scores', () => {
  const original = base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y' });
  for (const [method, fixed] of [['encodeOpacity', 0], ['encodeSize', 64], ['encodeColor', '#e45756'],
    ['encodeStroke', '#555555'], ['encodeShape', undefined], ['encodeAngle', 45]]) {
    const variants = [...(fixed !== undefined ? [{ value: fixed }] : []),
      ...(method !== 'encodeAngle' ? [{ field: method === 'encodeShape' ? 'Group' : 'Other' }] : [])];
    for (const args of variants) {
      const raw = original[method]({ target: 'plot', ...args }), view = raw.createGuides();
      const result = engine.recommend(view, { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS, authoringProgram: raw });
      assert.ok(!result.recommendations.some(r => r.method === method), `${method} ${JSON.stringify(args)}`);
      assert.ok(result.recommendations.some(r => r.category === 'encoding'), 'unused channels remain');
      assert.ok(result.recommendations.some(r => r.method === 'editAxes'), 'style revisions remain');
      for (const rec of result.recommendations) {
        const anchors = rec.kind === 'revision' ? result.state.features.filter(f => f !== rec.feature) : result.state.features;
        assert.equal(rec.score, scoreCandidate(model, anchors, rec.feature).score);
      }
    }
  }
  // Undo returns to the original immutable state, not a global used-method list.
  const before = engine.recommend(original.createGuides(), { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS });
  assert.ok(before.recommendations.some(r => r.method === 'encodeOpacity'));
  assert.ok(before.recommendations.some(r => r.method === 'encodeSize'));
  const line = base().createLinePlot({ id: 'plot', x: 'X', y: 'Y' })
    .encodeStrokeWidth({ target: 'plot', value: 2 });
  assert.ok(!engine.recommend(line, { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS })
    .recommendations.some(r => r.method === 'encodeStrokeWidth'));
  assert.throws(() => engine.recommend(original, { excludeAppliedEncodings: 'yes' }), /excludeAppliedEncodings/);
});

test('applied encoding suppression is target-local and removal restores eligibility', () => {
  const p = base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y' })
    .createScatterPlot({ id: 'other', x: 'X', y: 'Y' })
    .encodeOpacity({ target: 'other', value: 0.5 });
  const options = { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS };
  assert.ok(engine.recommend(p, options).recommendations.some(r => r.method === 'encodeOpacity'));
  const encoded = p.encodeOpacity({ target: 'plot', field: 'Other' });
  assert.ok(!engine.recommend(encoded, options).recommendations.some(r => r.method === 'encodeOpacity'));
  const removed = encoded.removeEncoding({ target: 'plot', channel: 'opacity' });
  assert.ok(engine.recommend(removed, options).recommendations.some(r => r.method === 'encodeOpacity'));
});

test('followups exclude established X/Y/Color before ranking while unselected Color remains available', () => {
  const p = base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y' }).createGuides();
  const recommend = program => engine.recommend(program, { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS });
  const result = recommend(p);
  assert.deepEqual(result.diagnostics.establishedChannels, ['x', 'y']);
  assert.ok(!result.recommendations.some(r => ['encoding.x', 'encoding.y'].includes(r.feature) && r.category === 'encoding'));
  const color = result.recommendations.find(r => r.method === 'encodeColor');
  assert.ok(color?.alternatives.some(a => a.args.field === 'Group'));
  const next = applyRecommendation(p, color, { alternative: color.alternatives.findIndex(a => a.args.field === 'Group') });
  const colored = recommend(next);
  assert.deepEqual(colored.diagnostics.establishedChannels, ['x', 'y', 'color']);
  assert.ok(!colored.recommendations.some(r => ['encodeX', 'encodeY', 'encodeColor'].includes(r.method) && r.category === 'encoding'));
  assert.ok(colored.recommendations.some(r => r.method === 'encodeSize'));
  const first = engine.recommend(next, { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS, limit: 1 });
  assert.deepEqual(first.recommendations, colored.recommendations.slice(0, 1));
  const removed = next.removeEncoding({ target: 'plot', channel: 'color' });
  assert.ok(recommend(removed).recommendations.some(r => r.method === 'encodeColor'));
  assert.throws(() => engine.recommend(p, { excludeMappedChannels: ['absent'] }), /excludeMappedChannels/);
});

test('established positional choices retain binning and aggregation transforms and scale styles', () => {
  const p = base().createLinePlot({ id: 'plot', x: { field: 'X', bin: { maxBins: 10 } },
    y: { field: 'Y', aggregate: 'mean' }, color: 'Group' }).createGuides();
  const { recommendations } = engine.recommend(p, { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS });
  assert.ok(recommendations.some(r => r.method === 'encodeX' && r.feature === 'transform.bin'));
  assert.ok(recommendations.some(r => r.method === 'encodeY' && r.feature === 'transform.aggregate'));
  assert.ok(recommendations.some(r => r.method === 'editColorScale'));
  assert.ok(!recommendations.some(r => r.category === 'encoding' && ['encoding.x', 'encoding.y', 'encoding.color'].includes(r.feature)));
});

test('one native size card replaces radius and supports fixed area and variable mapping', () => {
  const raw = base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'Group' });
  const p = raw.createGuides();
  const { recommendations } = engine.recommend(p, { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS });
  assert.ok(!recommendations.some(r => ['encodePointRadius', 'encodeRadius'].includes(r.method)));
  const sizes = recommendations.filter(r => r.method === 'encodeSize');
  assert.equal(sizes.length, 1);
  assert.ok(sizes[0].alternatives.some(a => a.args.field));
  assert.ok(sizes[0].alternatives.some(a => Object.hasOwn(a.args, 'value')));
  const editor = recommendationParameters(sizes[0], profileDataset(p, 'data'));
  for (const mode of ['fixed', 'variable']) {
    const args = editor.build({ ...valuesFor(editor.controls), mode, value: 100, field: 'Other' });
    const prepared = prepareGuidedAction(raw, { method: sizes[0].method, args }, p);
    const next = prepared.authoringPreview;
    assert.equal(next.trace.children.length, raw.trace.children.length + 1);
    assert.equal(next.trace.children.at(-1).op, 'encodeSize');
    if (mode === 'fixed') assert.equal(next.markConfigs.plot.radius, Math.sqrt(100 / Math.PI));
    else assert.equal(next.semanticSpec.layers.find(l => l.id === 'plot').encoding.size.field, 'Other');
  }
});

test('summary recommendations reach original source variables and replay dependent marks and inferred titles in one action', () => {
  const raw = base().createSummaryData({ id: 'summary', source: 'data', groupBy: ['X', 'Group'],
    aggregates: [{ op: 'mean', field: 'Y', as: 'Value' }] })
    .createBarPlot({ id: 'plot', data: 'summary', x: { field: 'X', fieldType: 'quantitative' }, y: 'Value', color: 'Group' });
  const p = raw.createGuides(), before = JSON.stringify(p);
  const rec = engine.recommend(p, { target: 'plot', includeRevisions: true, limit: 1000 }).recommendations.find(r => r.method === 'editSummaryData');
  assert.ok(rec.alternatives.some(a => a.args.aggregates[0].field === 'Other'));
  const editor = recommendationParameters(rec, profileDataset(p, 'summary'));
  const args = editor.build({ ...valuesFor(editor.controls), p0: 'Other', p1: 'mean' });
  const prepared = prepareGuidedAction(raw, { method: rec.method, args }, p);
  assert.equal(prepared.authoringPreview.trace.children.length, raw.trace.children.length + 1);
  assert.equal(prepared.authoringPreview.trace.children.at(-1).op, 'editSummaryData');
  assert.equal(prepared.preview.semanticSpec.guides.axis.y.title, 'mean(Other)');
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(prepared.preview.semanticSpec.datasets.find(d => d.id === 'data').values, rows);
});

test('every issued default parameter editor remains usable when guides are materialized on Apply', () => {
  const raw = base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'Group' });
  const p = raw.createGuides();
  const result = engine.recommend(p, { target: 'plot', includeRevisions: true, limit: 1000 });
  assert.equal(result.diagnostics.rejected.length, 0);
  for (const rec of result.recommendations) {
    const editor = recommendationParameters(rec, profileDataset(p, result.state.data));
    const args = editor.build(valuesFor(editor.controls));
    assert.doesNotThrow(() => prepareGuidedAction(raw, { method: rec.method, args }, p), rec.method);
    assert.ok(editor.controls.length <= 4);
  }
});
