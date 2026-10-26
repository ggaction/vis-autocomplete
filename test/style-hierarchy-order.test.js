import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart, hconcat } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { createRecommendationEngine } from '../src/engine.js';
import { createStyleHierarchyUsage } from '../src/action-hierarchy.js';
import { addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const options = { ...FOLLOWUP_RECOMMENDATION_OPTIONS, target: 'plot', group: 'style' };
const base = () => addDefaultGuides(chart().createCanvas(defaultCanvasOptions())
  .createData({ id: 'd', values: Array.from({ length: 12 }, (_, i) => ({ X: i + 1, Y: i % 4 + 2, G: i % 2 ? 'A' : 'B' })) })
  .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'G' }));
const axes = { x: { labels: { fontSize: 14 } }, y: { labels: { fontSize: 14 } } };
const rank = program => engine.rank(program, options).recommendations;
const method = rec => rec.sourceMethod ?? rec.method;
function familyAtTail(recommendations, parent, children) {
  const methods = recommendations.map(method), tail = methods.slice(-children.length - 1);
  assert.equal(tail.at(-1), parent);
  assert.deepEqual(new Set(tail.slice(0, -1)), new Set(children));
  let used = false;
  for (const rec of recommendations) {
    if (rec.previouslyApplied) used = true;
    else assert.equal(used, false, `${method(rec)} must precede used families`);
  }
}

test('Axes Apply places new actions first, X/Y next, and Axes last without changing scores', () => {
  const p = base().editAxes(axes), result = rank(p);
  familyAtTail(result, 'editAxes', ['editXAxis', 'editYAxis']);
  const raw = engine.rank(p, { ...options, hierarchy: false }).recommendations;
  const scores = new Map(engine.rank(p, { ...options, hierarchy: false, deprioritizeAppliedActions: false })
    .recommendations.map(r => [r.id, r.score]));
  for (const rec of raw) assert.equal(rec.score, scores.get(rec.id), method(rec));
  const children = raw.filter(r => /^edit[XY]Axis/.test(method(r)));
  assert.ok(children.length > 4);
  assert.ok(children.every(r => r.previouslyApplied && r.appliedAncestor === 'editAxes'));
  assert.ok(!result.some(r => /^edit[XY]Axis(Title|Labels|Line)$/.test(method(r))), 'unopened levels remain compact');
});

test('Grid and Legend families use the same containment ordering', () => {
  const grid = base().createVerticalGrid({}).editGrid({ horizontal: { lineWidth: 2 }, vertical: { lineWidth: 2 } });
  familyAtTail(rank(grid), 'editGrid', ['editHorizontalGrid', 'editVerticalGrid']);
  const legend = base().editLegend({ target: 'plot', channel: 'color', position: 'bottom' });
  const recs = rank(legend), details = recs.filter(r => /^editLegend.+/.test(method(r)));
  assert.ok(details.length >= 4);
  familyAtTail(recs, 'editLegend', details.map(method));
});

test('child Apply and parent reapply rotate the family by history; Undo and persistence restore it', () => {
  const p = base().editAxes(axes), before = rank(p).map(method);
  const q = p.editXAxis({ labels: { fontSize: 16 } });
  const after = rank(q);
  assert.equal(method(after.at(-1)), 'editXAxis');
  assert.ok(after.some(r => /^editXAxis.+/.test(method(r)) && r.appliedAncestor === 'editXAxis'));
  const r = q.editAxes({ x: { labels: { fontSize: 18 } }, y: { labels: { fontSize: 18 } } });
  const reset = rank(r);
  assert.equal(method(reset.at(-1)), 'editAxes');
  assert.ok(reset.filter(r => /^edit[XY]Axis/.test(method(r))).every(r => r.appliedAncestor === 'editAxes'));
  assert.deepEqual(rank(p).map(method), before, 'Undo uses the prior immutable trace');
  assert.deepEqual(rank(deserializeProgram(serializeProgram(q))).map(method), after.map(method));
});

test('legend family usage respects the selected owner and channel, including Both', () => {
  const p = base().encodeSize({ target: 'plot', field: 'X' }).createLegend({ target: 'plot', channels: ['size'] })
    .editLegend({ target: 'plot', channel: 'size', labels: { fontSize: 14 } });
  const rec = (target, channel) => ({ method: 'editLegendLabels', category: 'style', args: { target, channel, fontSize: 15 } });
  assert.equal(createStyleHierarchyUsage(p)(rec('plot', 'color')).order, undefined);
  assert.equal(createStyleHierarchyUsage(p)(rec('other', 'size')).order, undefined);
  assert.equal(createStyleHierarchyUsage(p)(rec('plot', 'size')).ancestor, 'editLegend');
  assert.equal(rank(p).at(-1).method, 'editLegend', 'choosing a non-default channel still moves the card to the tail');
  assert.ok(rank(p).some(r => method(r) === 'editLegendLabels' && r.appliedAncestor === 'editLegend'));
  const all = p.editLegend({ target: 'plot', channel: 'all', labels: { fontSize: 15 } });
  for (const channel of ['color', 'size']) assert.equal(createStyleHierarchyUsage(all)(rec('plot', channel)).ancestor, 'editLegend');
});

test('automatic guides do not count as Style Apply and hierarchy ranking is opt-in', () => {
  assert.ok(rank(base()).filter(r => /^edit(Axes|Grid|Legend)$/.test(method(r))).every(r => !r.previouslyApplied));
  const p = base().editAxes(axes);
  const plain = engine.rank(p, { ...options, deprioritizeAppliedActions: false }).recommendations;
  assert.ok(plain.every(r => !r.previouslyApplied));
});

test('canvas fitting after a Style Apply does not count as editing the background', () => {
  const p = base().editAxes(axes).editCanvas({ plot: { width: 350, height: 314 }, margin: 140 });
  familyAtTail(rank(p), 'editAxes', ['editXAxis', 'editYAxis']);
  assert.equal(rank(p).find(r => r.method === 'editCanvas').previouslyApplied, false);
  const background = p.editCanvas({ background: '#fff8d6' });
  assert.equal(rank(background).at(-1).method, 'editCanvas');
});

test('facet source edits and pre-facet edits preserve the family tail', () => {
  const facet = p => p.facet({ field: 'G', columns: 2, guides: { axes: 'outer', legend: 'shared' } });
  for (const p of [facet(base().editAxes(axes)), facet(base()).editFacetSource({ action: { method: 'editAxes', options: axes } })]) {
    familyAtTail(rank(p), 'editAxes', ['editXAxis', 'editYAxis']);
  }
});

test('worker pagination, search and adjacent chart targets keep the same used-family ordering', () => {
  const p = hconcat({ programs: [{ id: 'edited', program: base().editAxes(axes) }, { id: 'fresh', program: base() }] });
  const service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(p) });
  const request = (childPath, page = 0, searchQuery = '') => service.execute({ type: 'recommend', stateId: 1,
    options: { ...options, childPath }, group: 'style', page, searchQuery });
  const first = request(['edited']);
  assert.ok(first.result.recommendations.every(r => !r.previouslyApplied));
  let deck = first;
  for (let page = 1; page < deck.pagination.pageCount; page++) deck = request(['edited'], page);
  familyAtTail(deck.result.recommendations, 'editAxes', ['editXAxis', 'editYAxis']);
  for (const range of deck.pagination.pageRanges.slice(0, -1)) assert.equal(range.end - range.start, 5);
  assert.equal(new Set(deck.result.recommendations.map(r => r.id)).size, deck.result.recommendations.length);
  assert.ok(request(['edited'], 0, 'editXAxisLabels').result.recommendations.some(r => method(r) === 'editXAxisLabels'));
  assert.ok(request(['fresh'], 0, 'editAxes').result.recommendations.every(r => !r.previouslyApplied));
  assert.deepEqual(request(['edited']).result.recommendations, first.result.recommendations);
});
