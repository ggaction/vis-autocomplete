import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createRecommendationEngine, applyRecommendation } from '../src/engine.js';
import { addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS, optionGroup } from '../web/option-groups.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const options = { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS };
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
  Array.from({ length: 30 }, (_, i) => ({ X: i + 1, Y: i * 2 + i % 3, Other: i % 8 + 1, Group: i % 2 ? 'A' : 'B' })) });
const scatter = () => base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y' });
const ranking = recs => recs.map(r => [r.id, r.score]);
function serviceFor(raw) {
  const service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(raw), guideCall: { method: 'createGuides', args: {} } });
  return request => service.execute({ type: 'recommend', stateId: 1, options, group: 'encoding', ...request });
}

test('rank returns only the requested group with unchanged paper scores and unvalidated proposals', () => {
  const raw = scatter(), view = addDefaultGuides(raw), engine = createRecommendationEngine(model);
  const full = engine.recommend(view, { ...options, authoringProgram: raw });
  for (const group of ['encoding', 'transform', 'style']) {
    const ranked = engine.rank(view, { ...options, group });
    assert.ok(ranked.recommendations.length);
    assert.ok(ranked.recommendations.every(r => optionGroup(r) === group && r.validation.status === 'pending'));
    assert.deepEqual(ranking(ranked.recommendations).filter(([id]) => full.recommendations.some(r => r.id === id)),
      ranking(full.recommendations.filter(r => optionGroup(r) === group)));
    assert.throws(() => applyRecommendation(view, ranked.recommendations[0]), /different chart state/);
  }
  assert.throws(() => engine.rank(view, { group: 'other' }), /group/);
});

test('first page validates five defaults only; alternatives, later pages and other groups remain unexecuted', () => {
  const raw = scatter(), recommend = serviceFor(raw);
  const first = recommend({});
  assert.equal(first.result.recommendations.length, 5);
  assert.equal(first.defaults.length, 5);
  assert.equal(first.result.diagnostics.validatedCalls.length, 5);
  assert.ok(first.result.recommendations.every(r => optionGroup(r) === 'encoding' && r.validation.executed));
  assert.ok(first.result.recommendations.some(rec => rec.alternatives.length > 1));
  assert.ok(first.result.recommendations.flatMap(rec => rec.alternatives).every(a => a.validation.status === 'pending'));
  assert.ok(!first.result.diagnostics.validatedCalls.some(c => /Regression|Axis|Axes|Grid|Title/.test(c.method)));
  const again = recommend({});
  assert.equal(again.result.diagnostics.validatedCalls.length, 5);
  const next = recommend({ page: 1 });
  assert.ok(next.result.recommendations.length > 5);
  assert.deepEqual(ranking(next.result.recommendations.slice(0, 5)), ranking(first.result.recommendations));
  assert.ok(next.result.diagnostics.validatedCalls.length > 5);
  const style = recommend({ group: 'style' });
  assert.equal(style.result.recommendations.length, 5);
  assert.ok(style.result.recommendations.every(r => optionGroup(r) === 'style'));
  assert.deepEqual(ranking(recommend({}).result.recommendations), ranking(first.result.recommendations));
  assert.throws(() => recommend({ page: -1 }), /page/);
});

test('opening every group/page preserves the full eager order and scores and every default remains native-applicable', () => {
  for (const raw of [scatter(), base().createLinePlot({ id: 'plot', x: 'X', y: 'Y', color: 'Group' }),
    base().createBarPlot({ id: 'plot', x: 'Group', y: { field: 'Y', aggregate: 'mean' } })]) {
    const view = addDefaultGuides(raw), engine = createRecommendationEngine(model);
    const full = engine.recommend(view, { ...options, authoringProgram: raw });
    const recommend = serviceFor(raw);
    for (const group of ['encoding', 'transform', 'style']) {
      let response = recommend({ group });
      for (let page = 1; page < response.pagination.pageCount; page++) response = recommend({ group, page });
      assert.deepEqual(ranking(response.result.recommendations), ranking(full.recommendations.filter(r => optionGroup(r) === group)), `${raw.semanticSpec.layers[0].mark.type}/${group}`);
      for (const rec of response.result.recommendations) {
        const editor = recommendationParameters(rec, response.profile);
        const action = { method: rec.method, args: editor.build(valuesFor(editor.controls)) };
        const service = createCalculationService(null);
        service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(raw), guideCall: { method: 'createGuides', args: {} } });
        const prepared = service.execute({ type: 'prepare', stateId: 1, action });
        assert.equal(prepared.recommendation.validation.topLevelActions, 1);
      }
    }
  }
});

test('exhausted decks have only nonempty page ranges, including an overestimated last page', () => {
  const raw = scatter().encodeOpacity({ target: 'plot', value: .43 });
  const recommend = serviceFor(raw);
  for (const group of ['encoding', 'transform', 'style']) {
    const first = recommend({ group });
    const exhausted = recommend({ group, page: first.pagination.pageCount + 1 });
    assert.equal(exhausted.pagination.complete, true);
    assert.equal(exhausted.pagination.pageCount, exhausted.pagination.pageRanges.length);
    assert.equal(exhausted.pagination.pageCount, Math.ceil(exhausted.result.recommendations.length / 5));
    for (const range of exhausted.pagination.pageRanges.slice(0, -1)) {
      assert.equal(range.end - range.start, 5, `${group}: only the last page may have empty slots`);
    }
    let end = 0;
    for (const range of exhausted.pagination.pageRanges) {
      assert.equal(range.start, end);
      assert.ok(range.end > range.start && range.end - range.start <= 5);
      end = range.end;
    }
    assert.equal(end, exhausted.result.recommendations.length);
    assert.deepEqual(recommend({ group }).result.recommendations, first.result.recommendations);
  }
});
