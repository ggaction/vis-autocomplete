import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { createEncodingUsage } from '../src/encoding-usage.js';
import { createRecommendationEngine } from '../src/engine.js';
import { defaultCanvasOptions } from '../src/prepare.js';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const options = { ...FOLLOWUP_RECOMMENDATION_OPTIONS, target: 'plot', group: 'encoding' };
const rows = Array.from({ length: 18 }, (_, i) => ({ X: i + 1, Y: i % 7 + 1, N: i % 5 + 1, W: i % 2 + 1, G: i % 2 ? 'A' : 'B' }));
const data = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
const base = () => data().createScatterPlot({ id: 'plot', x: 'X', y: 'Y' });
const rank = program => engine.rank(program, options).recommendations;
const methodOf = rec => rec.sourceMethod ?? rec.method;
const lastAction = program => program.trace.children.length - 1;

function assertTail(recs, method, order) {
  const index = recs.findIndex(r => methodOf(r) === method);
  assert.ok(index >= 0, `${method} must remain discoverable`);
  assert.equal(recs[index].previouslyApplied, true, method);
  assert.equal(recs[index].appliedOrder, order, method);
  assert.ok(recs.slice(index).every(r => r.previouslyApplied && r.appliedOrder >= order), method);
}

test('all mapped appearance channels defer their scale editor with the mapping, preserving paper scores', () => {
  for (const [channel, field, type] of [
    ['Color', 'G', 'nominal'], ['Stroke', 'G', 'nominal'], ['Size', 'N', 'quantitative'],
    ['Opacity', 'N', 'quantitative'], ['Shape', 'G', 'nominal'],
    ['StrokeWidth', 'W', 'quantitative'], ['StrokeDash', 'G', 'nominal'],
  ]) {
    const p = (channel.startsWith('Stroke') && channel !== 'Stroke'
      ? data().createLinePlot({ id: 'plot', x: 'X', y: 'Y', color: 'G' }) : base())
      [`encode${channel}`]({ target: 'plot', field, fieldType: type });
    const recs = rank(p);
    assertTail(recs, `edit${channel}Scale`, lastAction(p));
    const scores = engine.rank(p, { ...options, deprioritizeAppliedActions: false }).recommendations;
    assert.deepEqual(recs.map(r => [r.id, r.score]).sort(), scores.map(r => [r.id, r.score]).sort());
    assert.ok(recs.slice(0, 5).every(r => !r.previouslyApplied), channel);
  }
});

test('polar, parallel and offset scale editors follow the same ownership policy', () => {
  for (const [p, channels] of [
    [data().createPolarScatterPlot({ id: 'plot', theta: 'X', radius: 'Y' }), ['Theta', 'R']],
    [data().createParallelCoordinates({ id: 'plot', dimensions: ['X', 'Y', 'N'] }), ['Parallel']],
    [data().createBarPlot({ id: 'plot', x: 'G', y: { field: 'Y', aggregate: 'mean' } })
      .encodeXOffset({ target: 'plot', field: 'G', fieldType: 'nominal' }), ['XOffset']],
  ]) {
    for (const channel of channels) assertTail(rank(p), `edit${channel}Scale`, channel === 'XOffset' ? lastAction(p) : -1);
  }
});

test('channel bundles track fixed values as well as scales; removal does not retain a phantom editor', () => {
  const initial = base();
  const p = initial.encodeChannels({ target: 'plot', channels: { size: { field: 'N' }, opacity: { value: .4 } } });
  assertTail(rank(p), 'encodeOpacity', lastAction(p));
  assertTail(rank(p), 'editSizeScale', lastAction(p));
  assert.ok(!rank(p).some(r => methodOf(r) === 'editOpacityScale'));
  const removed = p.removeEncoding({ target: 'plot', channel: 'size' });
  assert.ok(!rank(removed).some(r => methodOf(r) === 'editSizeScale'));
  assert.equal(createEncodingUsage(removed, removed.semanticSpec.layers[0]).channels.includes('size'), false);
  const restored = removed.encodeSize({ target: 'plot', field: 'N' });
  assertTail(rank(restored), 'editSizeScale', lastAction(restored));
});

test('used-channel order follows edits, facet source wrappers, serialization, Undo and branches', () => {
  const first = base().encodeSize({ target: 'plot', field: 'N' });
  const second = first.encodeOpacity({ target: 'plot', field: 'W' });
  const third = second.encodeSize({ target: 'plot', field: 'Y' });
  const edited = third.editSizeScale({ target: 'plot', range: [30, 160] });
  for (const p of [first, second, third, edited, deserializeProgram(serializeProgram(third)), second]) {
    const expected = p === edited ? lastAction(edited) : p === second ? lastAction(first) : p === first ? lastAction(first) : lastAction(third);
    assertTail(rank(p), 'editSizeScale', expected);
  }
  const branch = second.encodeShape({ target: 'plot', field: 'G', fieldType: 'nominal' });
  assertTail(rank(branch), 'editSizeScale', lastAction(first));
  const faceted = first.facet({ field: 'G', columns: 2, guides: { axes: 'outer', legend: 'shared' } })
    .editFacetSource({ action: { method: 'encodeSize', options: { target: 'plot', field: 'Y' } } });
  assertTail(rank(faceted), 'editSizeScale', lastAction(faceted));
  assert.ok(rank(faceted).find(r => r.sourceMethod === 'editSizeScale')?.method === 'editFacetSource');
});

test('explicit scale IDs and shared consumers determine edit recency, not matching function names', () => {
  const first = base().encodeSize({ target: 'plot', field: 'N', scale: { id: 'firstSize' } });
  const multi = first.createScatterPlot({ id: 'other', x: 'X', y: 'Y' })
    .encodeSize({ target: 'other', field: 'N', scale: { id: 'otherSize' } });
  const edited = multi.editSizeScale({ id: 'otherSize', range: [20, 150] });
  assertTail(rank(edited), 'editSizeScale', lastAction(first));
  assertTail(engine.rank(edited, { ...options, target: 'other' }).recommendations, 'editSizeScale', lastAction(edited));
  const generic = edited.editScale({ id: 'firstSize', range: [30, 200] });
  assertTail(rank(generic), 'editSizeScale', lastAction(generic));
  const shared = first.createScatterPlot({ id: 'other', x: 'X', y: 'Y' })
    .encodeSize({ target: 'other', field: 'N', scale: { id: 'firstSize' } })
    .editSizeScale({ target: 'other', range: [30, 180] });
  assertTail(rank(shared), 'editSizeScale', lastAction(shared));
  const implicit = base().encodeSize({ field: 'N' });
  assertTail(rank(implicit), 'editSizeScale', lastAction(implicit));
});

test('worker pages and search retain deferred size editors instead of reintroducing them as fresh actions', () => {
  for (const facet of [false, true]) {
    let p = base().encodeSize({ target: 'plot', field: 'N' });
    if (facet) p = p.facet({ field: 'G', columns: 2, guides: { axes: 'outer', legend: 'shared' } });
    const service = createCalculationService(model);
    service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(p), guideCall: { method: 'createGuides', args: {} } });
    const request = (page = 0, searchQuery = '') => service.execute({ type: 'recommend', stateId: 1, options, group: 'encoding', page, searchQuery });
    let deck = request();
    assert.ok(!deck.result.recommendations.some(r => methodOf(r) === 'editSizeScale'));
    for (let page = 1; page < deck.pagination.pageCount; page++) deck = request(page);
    assertTail(deck.result.recommendations, 'editSizeScale', 3);
    assert.ok(deck.pagination.pageRanges.slice(0, -1).every(r => r.end - r.start === 5));
    const search = request(0, 'editSizeScale');
    assert.equal(search.result.recommendations.length, 1);
    assert.equal(methodOf(search.result.recommendations[0]), 'editSizeScale');
    assert.equal(search.result.recommendations[0].previouslyApplied, true);
    assert.equal(search.defaults[0].prepared.recommendation.validation.topLevelActions, 1);
  }
});
