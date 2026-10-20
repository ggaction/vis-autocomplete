import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { filterActionRecommendations, normalizeSearchQuery } from '../src/action-search.js';
import { createCalculationService } from '../web/calculation-service.js';
import { defaultCanvasOptions } from '../src/prepare.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS, optionGroup } from '../web/option-groups.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const methods = recs => recs.map(r => r.sourceMethod ?? r.method);
const records = ['encodeStrokeWidth', 'encodeOpacity', 'editAxes', 'encodeColor', 'createRegression',
  'createStatisticalReference', 'editLegend', 'encodeSize'].map((method, i) => ({ method, score: 1 - i / 10 }));

test('action keywords cover public function names, displayed names, related terms and modest typos', () => {
  for (const [query, expected] of [
    ['encodeStrokeWidth', 'encodeStrokeWidth'], ['storke widht', 'encodeStrokeWidth'],
    ['thickness', 'encodeStrokeWidth'], ['opactiy', 'encodeOpacity'], ['transparency', 'encodeOpacity'],
    ['colour', 'encodeColor'], ['regresion', 'createRegression'], ['trend', 'createRegression'],
    ['95 interval', 'createStatisticalReference'], ['legnd', 'editLegend'], ['radius', 'encodeSize'],
    ['투명도', 'encodeOpacity'], ['axsi', 'editAxes'],
  ]) assert.deepEqual(methods(filterActionRecommendations(records, query)), [expected], query);
  assert.deepEqual(filterActionRecommendations(records, 'totallyunrelated'), []);
  assert.deepEqual(filterActionRecommendations(records, 'stroke banana'), [], 'all query terms must match');
  assert.deepEqual(filterActionRecommendations(records, 'xy'), [], 'short queries cannot use fuzzy matching');
  assert.deepEqual(methods(filterActionRecommendations([{ method: 'editXAxisLabels' }], 'x axsi')), ['editXAxisLabels'],
    'axis acronyms in public method names split into searchable words');
});

test('search filters without rewriting scores, order, alternatives, or source-action identities', () => {
  const input = [{ method: 'encodeColor', score: .1, alternatives: [{ method: 'encodeColor', args: { value: '#000' } }] },
    { method: 'encodeStroke', score: .9 }, { method: 'editLegend', score: .5 },
    { method: 'editFacetSource', sourceMethod: 'encodeOpacity', score: .01,
      args: { action: { method: 'encodeOpacity', options: { target: 'plot', value: .4 } } } }];
  const before = JSON.stringify(input);
  assert.deepEqual(filterActionRecommendations(input, 'color'), input.slice(0, 2));
  assert.strictEqual(filterActionRecommendations(input, 'opacity')[0], input[3]);
  assert.strictEqual(filterActionRecommendations(input, '  '), input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(normalizeSearchQuery('  STROKE   Width  '), 'stroke width');
  assert.throws(() => normalizeSearchQuery(42), /string/);
});

function serviceFor(raw) {
  const service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(raw),
    guideCall: { method: 'createGuides', args: { legend: { target: 'plot', channels: ['color'] } } } });
  return (searchQuery = '', group = 'encoding', page = 0) => service.execute({ type: 'recommend', stateId: 1,
    options: { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS }, group, page, searchQuery });
}

test('worker filters the whole ranked deck before lazy validation, including already-used actions on later pages', () => {
  const raw = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
    Array.from({ length: 18 }, (_, i) => ({ X: i + 1, Y: i % 7 + 1, Other: i % 5 + 1, Group: i % 2 ? 'A' : 'B' })) })
    .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'Group' }).encodeOpacity({ target: 'plot', value: .43 });
  const request = serviceFor(raw), first = request();
  assert.equal(first.result.recommendations.length, 5);
  assert.ok(!first.result.recommendations.some(r => r.method === 'encodeOpacity'));
  const searched = request('opactiy');
  assert.deepEqual(methods(searched.result.recommendations), ['encodeOpacity']);
  assert.equal(searched.result.recommendations[0].previouslyApplied, true);
  assert.ok(searched.result.diagnostics.validatedCalls.every(call => call.method === 'encodeOpacity'));
  assert.equal(searched.pagination.complete, true);
  assert.equal(searched.pagination.rankedCandidates, 1);
  assert.strictEqual(searched.result.state, first.result.state, 'typing reuses the group ranking');
  let all = first;
  for (let page = 1; page < all.pagination.pageCount; page++) all = request('', 'encoding', page);
  assert.ok(!methods(all.result.recommendations).includes('removeEncoding'));
  assert.ok(!methods(request('removeEncoding').result.recommendations).includes('removeEncoding'));
  assert.equal(searched.result.recommendations[0].score, all.result.recommendations.find(r => r.method === 'encodeOpacity').score);
  const none = request('totallyunrelated');
  assert.deepEqual(none.result.recommendations, []);
  assert.deepEqual(none.result.diagnostics.validatedCalls, [], 'unmatched actions never execute');
  assert.deepEqual(request().result.recommendations, first.result.recommendations, 'clearing restores the unfiltered first page');
  const style = request('legnd', 'style');
  assert.ok(style.result.recommendations.length);
  assert.ok(style.result.recommendations.every(r => optionGroup(r) === 'style' && /Legend/.test(r.method)));
  assert.throws(() => request(null), /searchQuery/);
});

test('title editing is search-only after title creation and follows every ordinary match', () => {
  const raw = chart().createCanvas(defaultCanvasOptions()).createData({ values:
    Array.from({ length: 8 }, (_, i) => ({ X: i + 1, Y: i * 2 + 1, Group: i % 2 ? 'A' : 'B' })) })
    .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'Group' });
  const untitled = serviceFor(raw);
  assert.ok(methods(untitled('title', 'style').result.recommendations).includes('createTitle'));
  const request = serviceFor(raw.createTitle({ text: 'My chart' }));
  let deck = request('', 'style');
  for (let page = 1; page < deck.pagination.pageCount; page++) deck = request('', 'style', page);
  assert.ok(!methods(deck.result.recommendations).includes('editTitle'), 'absent even on later ordinary pages');
  assert.ok(!deck.result.diagnostics.validatedCalls.some(call => call.method === 'editTitle'));
  let matches = request('title', 'style');
  for (let page = 1; page < matches.pagination.pageCount; page++) matches = request('title', 'style', page);
  assert.equal(methods(matches.result.recommendations).at(-1), 'editTitle');
  assert.ok(matches.result.recommendations.at(-1).searchOnly);
  assert.deepEqual(methods(request('editTitle', 'style').result.recommendations), ['editTitle']);
  assert.ok(methods(request('titlte', 'style').result.recommendations).includes('editTitle'));
  assert.ok(!methods(request('   ', 'style').result.recommendations).includes('editTitle'));
});
