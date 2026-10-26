import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { getPlotDefinitions, defaultValues } from '../src/plot-catalog.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { replayPrepared } from './support/prepared.js';
import { canvasGeometry } from '../src/canvas-geometry.js';
import { itemFilterCandidates } from '../src/item-filter-candidates.js';
import { valueLabelCandidates } from '../src/value-labels.js';
import { createRecommendationEngine } from '../src/engine.js';
import { createCalculationService } from '../web/calculation-service.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from '../web/parameters.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { scopedCall } from '../src/composition-context.js';
import { positionCandidates } from '../src/position-candidates.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const rows = Array.from({ length: 24 }, (_, i) => ({ x: i + 1, y: (i % 8) + 2, z: (i % 4) + .5,
  group: ['A', 'B', 'C'][i % 3], split: i % 2 ? 'First' : 'Second' }));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows });
const candidates = p => {
  const layer = p.semanticSpec.layers.find(l => l.id === 'plot');
  return generateCandidates(p, { layer, profile: profileDataset(p, layer.data) });
};
const editorFor = (p, rec) => ({ ...recommendationParameters(rec, profileDataset(p, 'dataset')), method: rec.method });
const apply = (p, rec) => {
  const prepared = prepareGuidedAction(p, rec, p);
  assert.equal(prepared.recommendation.validation.topLevelActions, 1);
  assert.deepEqual(replayPrepared(prepared).graphicSpec, prepared.preview.graphicSpec);
  assert.deepEqual(deserializeProgram(serializeProgram(prepared.preview)).graphicSpec, prepared.preview.graphicSpec);
  return prepared.preview;
};

for (const method of ['createPiePlot', 'createRosePlot', 'createRadialBarPlot', 'createPolarLinePlot',
  'createPolarScatterPlot', 'createRadarPlot', 'createParallelCoordinates']) {
  test(`${method}: annotation is a centered, replayable public action`, () => {
    const initial = base(), definition = getPlotDefinitions(profileDataset(initial, 'dataset')).find(d => d.method === method);
    const p = prepareGuidedAction(initial, { method, args: definition.build(defaultValues(definition)) }).preview;
    const rec = candidates(p).find(c => c.method === 'createAnnotation');
    assert.ok(rec);
    assert.equal(rec.args.anchor, 'plot-center');
    assert.equal(rec.args.coordinate, undefined, 'annotation must not inherit a polar/parallel coordinate');
    const next = apply(p, rec), item = next.graphicSpec.objects[rec.args.id].items[0].properties;
    const geometry = canvasGeometry(next);
    assert.ok(Math.abs(item.x - geometry.x - geometry.plot.width / 2) < 1e-7);
    assert.ok(Math.abs(item.y - geometry.y - geometry.plot.height / 2) < 1e-7);
    assert.deepEqual(Object.keys(next.semanticSpec.guides.axis ?? {}), Object.keys(p.semanticSpec.guides.axis ?? {}));
    const repeat = candidates(next).find(c => c.method === 'createAnnotation');
    assert.notEqual(repeat.args.id, rec.args.id);
    assert.ok(apply(next, repeat).graphicSpec.objects[repeat.args.id]);
  });
}

test('the reported edited rose program exposes annotation through the actual searched worker deck', () => {
  // The report supplied authoring calls but no data. Preserve every call with
  // representative region rows; the full Gapminder dataset is audited separately.
  const data = { rows: ['Asia', 'Europe', 'Americas'].flatMap((region, i) => Array.from({ length: i + 1 }, () => ({ region }))) };
  const calls = JSON.parse(readFileSync(new URL('fixtures/edited-rose-annotation.json', import.meta.url)));
  const p = calls.reduce((p, call) => p[call.method]({ ...call.args,
    ...(call.method === 'createData' ? { values: data.rows } : {}) }), chart());
  const service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(p) });
  const response = service.execute({ type: 'recommend', stateId: 1, group: 'style', searchQuery: 'annotation',
    options: { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS } });
  const rec = response.result.recommendations.find(r => r.method === 'createAnnotation');
  assert.ok(rec, JSON.stringify(response.result.diagnostics));
  const editor = editorFor(p, rec), call = buildRecommendationCall(editor, { ...valuesFor(editor.controls), text: 'A note' });
  assert.ok(apply(p, call).graphicSpec.objects[call.args.id]);
});

test('annotation remains available in facet sources and selected adjacent charts', () => {
  const engine = createRecommendationEngine(model);
  const unit = base().createRosePlot({ id: 'plot', category: 'group', aggregate: 'count' });
  for (const scope of ['facet', 'adjacent']) {
    const p = scope === 'facet' ? unit.facet({ field: 'split', columns: 2, guides: { axes: 'each', legend: false } })
      : unit.createAdjacentPlot({ id: 'other', source: 'plot', position: 'right', plot: { action: 'createRosePlot', options: { category: 'split', aggregate: 'count' }, inherit: { color: false } }, share: {} });
    const local = scope === 'facet' ? p : p.children.other;
    const rec = engine.rank(local, { target: scope === 'facet' ? 'plot' : 'other', group: 'style', limit: 1000, includeRevisions: true }).recommendations
      .find(r => (r.sourceMethod ?? r.method) === 'createAnnotation');
    assert.ok(rec, scope);
    const call = scope === 'facet' ? rec : scopedCall(rec, [{ childPath: ['other'] }]);
    const next = apply(p, call);
    const id = rec.args.action?.options.id ?? rec.args.id;
    if (scope === 'facet') for (const child of Object.values(next.children)) assert.ok(child.graphicSpec.objects[id]);
    else { assert.ok(next.children.other.graphicSpec.objects[id]); assert.equal(next.children.plot.graphicSpec.objects[id], undefined); }
  }
});

test('radial and angular grid detail actions are available in keyword search', () => {
  const p = base().createRosePlot({ id: 'plot', category: 'group', aggregate: 'count' }).createGuides();
  const service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(p) });
  for (const method of ['editRadialGrid', 'editThetaGrid']) {
    const response = service.execute({ type: 'recommend', stateId: 1, group: 'style', searchQuery: method,
      options: { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS } });
    const rec = response.result.recommendations.find(r => r.method === method);
    assert.ok(rec, method);
    assert.ok(apply(p, { method, args: { lineWidth: 2.25 } }));
  }
});

test('filter parameter dependencies follow actual final-item grain and restore excluded categories', () => {
  const p = base().createParallelCoordinates({ id: 'plot', dimensions: ['x', 'y', 'z'] });
  const layer = p.semanticSpec.layers.find(l => l.id === 'plot'), recs = itemFilterCandidates(p, layer);
  assert.equal(recs.length, 2, 'field choices must not multiply preview candidates');
  const category = recs.find(r => r.variantGroup === 'categories'), editor = editorFor(p, category);
  const defaults = valuesFor(editor.controls);
  const switched = editor.normalizeValues({ ...defaults, p0: 'split' }, 'p0');
  assert.deepEqual(editor.resolveControls(switched).find(c => c.path === 'values').choices.map(c => c.value).sort(), ['First', 'Second']);
  assert.equal(switched.p1.length, 1);
  const filtered = apply(p, buildRecommendationCall(editor, switched));
  const restore = itemFilterCandidates(filtered, filtered.semanticSpec.layers.find(l => l.id === 'plot')).find(r => r.variantGroup === category.variantGroup);
  assert.ok(restore);
  const restoreEditor = editorFor(filtered, restore), values = valuesFor(restoreEditor.controls);
  assert.equal(restoreEditor.controls[1].selectAll, true);
  const all = restoreEditor.resolveControls(values)[1].choices.map(c => c.value);
  const restored = apply(filtered, buildRecommendationCall(restoreEditor, { ...values, p1: all }));
  assert.equal(restored.graphicSpec.objects.plot.items.length, p.graphicSpec.objects.plot.items.length);
  const numeric = recs.find(r => r.variantGroup === 'fields'), numberEditor = editorFor(p, numeric);
  const changed = numberEditor.normalizeValues({ ...valuesFor(numberEditor.controls), p0: 'z' }, 'p0');
  const threshold = numberEditor.resolveControls(changed).find(c => c.path === 'value');
  assert.equal(threshold.min, .5); assert.equal(threshold.max, 3.5); assert.ok(changed.p2 <= 3.5);
  assert.ok(apply(p, buildRecommendationCall(numberEditor, changed)));
  const sectors = base().createRosePlot({ id: 'plot', category: 'group', aggregate: 'count' });
  const sectorFilters = itemFilterCandidates(sectors, sectors.semanticSpec.layers.find(l => l.id === 'plot'));
  assert.deepEqual(sectorFilters[0].parameters[0].choices.map(c => c.value), ['group']);
  assert.ok(!sectorFilters.some(r => r.variantGroup === 'fields'), 'a sector cannot filter arbitrary member-row numbers');
  const engine = createRecommendationEngine(model);
  const ranked = engine.rank(p, { target: 'plot', group: 'transform', limit: 1000 }).recommendations.filter(r => r.method === 'filterMarks');
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].feature, ranked[1].feature);
  assert.equal(ranked[0].score, ranked[1].score);
  assert.ok(!engine.rank(filtered, { target: 'plot', group: 'transform', limit: 1000 }).recommendations.some(r => r.method === 'filterMarks'));
  const revised = engine.rank(filtered, { target: 'plot', group: 'transform', limit: 1000, includeRevisions: true, deprioritizeAppliedActions: true })
    .recommendations.filter(r => r.method === 'filterMarks');
  assert.ok(revised.length && revised.every(r => r.previouslyApplied));
});

test('box summary labels default to median instead of disappearing behind bar content rules', () => {
  const p = base().createBoxPlot({ id: 'plot', x: { field: 'group', fieldType: 'nominal' }, y: { field: 'x' } });
  const layer = p.semanticSpec.layers.find(l => l.id === 'plot');
  const rec = valueLabelCandidates(p, layer, profileDataset(p, layer.data))[0];
  assert.ok(rec);
  assert.match(rec.args.field, /median/);
  const ranked = createRecommendationEngine(model).rank(p, { target: 'plot', group: 'encoding', includeRevisions: true, limit: 1000 })
    .recommendations.find(r => r.method === 'createMarkLabels');
  const editor = recommendationParameters(ranked, profileDataset(p, layer.data));
  assert.ok(editor.controls[0].choices.some(c => c.label === 'x: median'));
  assert.ok(editor.controls[0].choices.every(c => !c.label.includes('__boxPlot')));
  assert.ok(apply(p, rec).semanticSpec.layers.some(l => l.source === 'plot'));
  const filter = createRecommendationEngine(model).rank(p, { target: 'plot', group: 'transform', limit: 1000 })
    .recommendations.find(r => r.variantGroup === 'fields');
  assert.ok(filter);
  const filterEditor = recommendationParameters(filter, profileDataset(p, layer.data));
  assert.ok(filterEditor.controls[0].choices.some(c => c.label === 'x: median'));
  assert.ok(filterEditor.controls[0].choices.every(c => !c.label.includes('__boxPlot')));
});

test('positional choices retain valid remaps and explain invalid aggregation or missing-data roles', () => {
  const raw = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows.map((row, i) => ({ ...row, missing: i ? row.x : null })) });
  const plots = [raw.createBarPlot({ id: 'plot', x: 'group', y: { field: 'x', aggregate: 'mean' } }),
    raw.createRosePlot({ id: 'plot', category: 'group', aggregate: 'count', color: 'group' })];
  for (const p of plots) {
    const layer = p.semanticSpec.layers.find(l => l.id === 'plot');
    const recs = positionCandidates(p, { layer, profile: profileDataset(p, layer.data) });
    assert.ok(recs.length);
    assert.ok(recs.every(rec => rec.args.field !== 'missing'));
    assert.ok(recs.some(rec => rec.unavailableFields.some(field => field.value === 'missing' && field.disabled && /finite/.test(field.reason))));
    if (layer.mark.type === 'bar') {
      assert.ok(!recs.some(rec => rec.method === 'encodeX' && rec.args.fieldType === 'quantitative'));
      assert.ok(recs.some(rec => rec.method === 'encodeX' && rec.args.field === 'split'));
    } else {
      assert.ok(!recs.some(rec => rec.method === 'encodeTheta' && rec.args.field === 'split'));
      assert.ok(recs.some(rec => rec.unavailableFields.some(field => field.value === 'split' && /one color/.test(field.reason))));
    }
  }
  const skipping = raw.createScatterPlot({ id: 'plot', x: 'x', y: 'y', missing: 'skip' });
  const layer = skipping.semanticSpec.layers.find(layer => layer.id === 'plot');
  const rec = positionCandidates(skipping, { layer, profile: profileDataset(skipping, layer.data) })
    .find(rec => rec.method === 'encodeY' && rec.args.field === 'missing');
  assert.ok(rec, 'an existing native skip policy must keep incomplete numeric fields available');
  assert.ok(apply(skipping, rec));
});
