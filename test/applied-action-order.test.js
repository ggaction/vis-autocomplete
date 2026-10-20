import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createRecommendationEngine } from '../src/engine.js';
import { addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const options = { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS };
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
  Array.from({ length: 18 }, (_, i) => ({ X: i + 1, Y: i % 7 + 1, Other: i % 5 + 1, Group: i % 2 ? 'A' : 'B' })) })
  .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'Group' });
function assertUnusedFirst(recommendations) {
  let used = false;
  for (const rec of recommendations) {
    if (rec.previouslyApplied) used = true;
    else assert.equal(used, false, `${rec.method} is unused and must precede used actions`);
  }
}

test('UI retains used fixed and mapped encodings after unused actions without altering any paper score', () => {
  const raw = base().encodeOpacity({ target: 'plot', value: .43 }), view = addDefaultGuides(raw);
  const result = engine.rank(view, { ...options, group: 'encoding' });
  const baseline = engine.rank(view, { target: 'plot', includeRevisions: true, limit: 1000, group: 'encoding' });
  assert.deepEqual(result.recommendations.map(r => [r.id, r.score]).sort(), baseline.recommendations.map(r => [r.id, r.score]).sort());
  assertUnusedFirst(result.recommendations);
  for (const method of ['encodeX', 'encodeY', 'encodeColor', 'encodeOpacity']) {
    assert.ok(result.recommendations.some(r => r.method === method && r.category === 'encoding' && r.previouslyApplied), method);
  }
  assert.ok(result.recommendations.some(r => r.method === 'encodeSize' && !r.previouslyApplied));
  assert.ok(result.recommendations.slice(0, 5).every(r => !r.previouslyApplied));
  assert.throws(() => engine.rank(view, { deprioritizeAppliedActions: 'yes' }), /deprioritizeAppliedActions/);
});

test('actual Transform and Style calls move to the back, independently of feature revision labels', () => {
  const raw = base().editPointMark({ target: 'plot', opacity: .6 })
    .createStatisticalReference({ source: 'plot', axis: 'y', statistic: { op: 'mean' },
      stroke: '#222222', strokeWidth: 2.5, strokeDash: 'solid' });
  for (const [group, method] of [['style', 'editPointMark'], ['transform', 'createStatisticalReference']]) {
    const recs = engine.rank(addDefaultGuides(raw), { ...options, group }).recommendations;
    assert.ok(recs.some(r => r.method === method && r.previouslyApplied), method);
    assertUnusedFirst(recs);
  }
});

test('used action ordering follows immutable history and ignores calls on another mark', () => {
  const original = base().createScatterPlot({ id: 'other', x: 'X', y: 'Y' })
    .encodeOpacity({ target: 'other', value: .4 });
  const opacity = (raw, target = 'plot') => engine.rank(raw, { ...options, target, group: 'encoding' })
    .recommendations.find(r => r.method === 'encodeOpacity');
  const applied = original.encodeOpacity({ target: 'plot', value: .43 });
  assert.equal(opacity(original).previouslyApplied, false);
  assert.equal(opacity(original, 'other').previouslyApplied, true);
  assert.equal(opacity(applied).previouslyApplied, true);
  assert.equal(opacity(original).previouslyApplied, false, 'Undo restores the original ordering');
});

test('reapplying an action moves it behind earlier used actions, with Undo restoring usage order', () => {
  const first = base().encodeOpacity({ target: 'plot', value: .43 });
  const second = first.encodeSize({ target: 'plot', value: 100 });
  const third = second.encodeOpacity({ target: 'plot', value: .25 });
  const queue = raw => engine.rank(addDefaultGuides(raw), { ...options, group: 'encoding' }).recommendations;
  const methods = raw => queue(raw).map(r => r.method);
  assert.deepEqual(methods(second).slice(-2), ['encodeOpacity', 'encodeSize']);
  assert.deepEqual(methods(third).slice(-2), ['encodeSize', 'encodeOpacity']);
  assert.deepEqual(methods(second).slice(-2), ['encodeOpacity', 'encodeSize'], 'Undo');
  assert.deepEqual(queue(second).filter(r => !r.previouslyApplied).map(r => r.id),
    queue(third).filter(r => !r.previouslyApplied).map(r => r.id), 'new actions keep their paper ordering');
  assertUnusedFirst(queue(third));
});

test('unchanged Shape mapping remains on the final page and in search, including facet source edits', () => {
  for (const faceted of [false, true]) {
    let raw = base().encodeShape({ target: 'plot', field: 'Group', fieldType: 'nominal' });
    if (faceted) raw = raw.facet({ field: 'Group', columns: 2, spacing: 'plot', gap: 12,
      guides: { axes: 'outer', legend: 'shared' } }).editFacetSource({
        action: { method: 'encodeShape', options: { target: 'plot', field: 'Group', fieldType: 'nominal' } } });
    const before = serializeProgram(raw), service = createCalculationService(model);
    service.execute({ type: 'state', stateId: 1, snapshot: before,
      guideCall: { method: 'createGuides', args: { legend: { target: 'plot', channels: ['color', 'shape'] } } } });
    const request = (page = 0, searchQuery = '') => service.execute({
      type: 'recommend', stateId: 1, options, group: 'encoding', page, searchQuery });
    let deck = request();
    assert.ok(!deck.result.diagnostics.validatedCalls.some(call =>
      (call.args.action?.method ?? call.method) === 'encodeShape'), 'used pages remain lazy');
    for (let page = 1; page < deck.pagination.pageCount; page++) deck = request(page);
    const shape = deck.result.recommendations.at(-1);
    assert.equal(shape.sourceMethod ?? shape.method, 'encodeShape');
    assert.equal(shape.previouslyApplied, true);
    assert.equal(shape.validation.status, 'unchanged');
    assert.equal(shape.validation.changed, false);
    assert.equal(new Set(deck.result.recommendations.map(r => r.id)).size, deck.result.recommendations.length);
    assert.equal(deck.pagination.complete, true);
    assert.ok(deck.pagination.pageRanges.every(({ start, end }) => end > start), 'no phantom empty page');
    const searched = request(0, 'encodeShape');
    assert.deepEqual(searched.result.recommendations.map(r => r.id), [shape.id]);
    assert.equal(searched.defaults[0].prepared, null, 'unchanged is not a successful mutation');
    assert.throws(() => service.execute({ type: 'materialize', stateId: 1,
      action: searched.defaults[0].action }), error => error.reason === 'no-change');
    assert.equal(serializeProgram(raw), before, 'the unchanged card cannot add history');
  }
});

test('native editors replacing applied creators are retained at the back instead of promoted or erased', () => {
  for (const [group, creator, args, editor] of [
    ['style', 'createTitle', { text: 'My chart' }, 'editTitle'],
    ['transform', 'createRegression', { target: 'plot', method: 'linear' }, 'editRegression'],
  ]) {
    const raw = base()[creator](args), service = createCalculationService(model);
    service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(raw),
      guideCall: { method: 'createGuides', args: {} } });
    const request = page => service.execute({ type: 'recommend', stateId: 1, options, group, page });
    let deck = request(0);
    for (let page = 1; page < deck.pagination.pageCount; page++) deck = request(page);
    assertUnusedFirst(deck.result.recommendations);
    const used = deck.result.recommendations.filter(r => r.method === editor);
    assert.equal(used.length, 1);
    assert.equal(used[0].previouslyApplied, true);
    assert.equal(deck.result.recommendations.at(-1).method, editor);
    assert.ok(!deck.result.recommendations.some(r => r.method === creator));
  }
});

test('lazy worker pagination keeps used actions discoverable and validates their editable defaults', () => {
  const raw = base().encodeOpacity({ target: 'plot', value: .43 }), service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(raw), guideCall: { method: 'createGuides', args: {} } });
  const request = page => service.execute({ type: 'recommend', stateId: 1, options, group: 'encoding', page });
  const first = request(0);
  assert.equal(first.result.recommendations.length, 5);
  assert.ok(first.result.recommendations.every(r => !r.previouslyApplied));
  assert.ok(first.result.diagnostics.validatedCalls.every(call => !/Regression|Axes|Grid|Title/.test(call.method)));
  let response = first;
  for (let page = 1; page < response.pagination.pageCount; page++) response = request(page);
  assertUnusedFirst(response.result.recommendations);
  const used = response.result.recommendations.find(rec => rec.method === 'encodeOpacity');
  assert.ok(used?.previouslyApplied);
  assert.equal(used.validation.topLevelActions, 1);
  assert.deepEqual(request(0).result.recommendations, first.result.recommendations);
});

test('a short pie action page never backfills with the color scale that was just applied', () => {
  const before = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
    Array.from({ length: 18 }, (_, i) => ({ X: i + 1, Y: i % 7 + 1, Group: i % 2 ? 'A' : 'B' })) })
    .createPiePlot({ id: 'plot', category: 'Group', value: 'Y', aggregate: 'sum' })
    .encodeStroke({ target: 'plot', value: '#000000' })
    .editThetaScale({ target: 'plot', reverse: true })
    .orderCategories({ target: 'plot', channel: 'theta', by: 'category', direction: 'descending' });
  const after = before.editColorScale({ target: 'plot', palette: 'set2' });
  const service = createCalculationService(model);
  for (const [stateId, raw] of [[1, before], [2, after]]) {
    service.execute({ type: 'state', stateId, snapshot: serializeProgram(raw),
      guideCall: { method: 'createGuides', args: {} } });
  }
  const request = (stateId, page = 0, searchQuery = '') => service.execute({
    type: 'recommend', stateId, options, group: 'encoding', page, searchQuery });
  const original = request(1), first = request(2);
  assert.ok(original.result.recommendations.some(r => r.method === 'editColorScale' && !r.previouslyApplied));
  assert.ok(first.result.recommendations.length > 0 && first.result.recommendations.length < 5);
  assert.ok(first.result.recommendations.every(r => !r.previouslyApplied));
  assert.ok(!first.result.diagnostics.validatedCalls.some(call => call.method === 'editColorScale'),
    'an unopened used-action page must not perform native validation');
  assert.deepEqual(first.pagination.pageRanges, [{ start: 0, end: first.result.recommendations.length }]);
  const next = request(2, 1), range = next.pagination.pageRanges[1];
  assert.equal(range.start, first.result.recommendations.length);
  const later = next.result.recommendations.slice(range.start, range.end);
  assert.ok(later.every(r => r.previouslyApplied));
  const scale = later.find(r => r.method === 'editColorScale');
  assert.ok(scale, 'used color scale remains accessible on the next page');
  assert.equal(scale.validation.topLevelActions, 1);
  assert.deepEqual(next.defaults.map(entry => entry.action.method), later.map(r => r.method));
  assert.deepEqual(request(2).result.recommendations, first.result.recommendations,
    'opening a later page must not backfill the cached first page');
  const searched = request(2, 0, 'editColorScale');
  assert.deepEqual(searched.result.recommendations.map(r => r.method), ['editColorScale']);
  assert.equal(searched.result.recommendations[0].score, scale.score);
  assert.deepEqual(request(1).result.recommendations, original.result.recommendations,
    'Undo returns the color-scale action to its unused position');
});
