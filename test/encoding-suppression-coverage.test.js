import { replayPrepared, assertPreparedTrace } from './support/prepared.js';
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

test('established positional choices retain binning and aggregation transforms and scale encodings', () => {
  const p = base().createLinePlot({ id: 'plot', x: { field: 'X', bin: { maxBins: 10 } },
    y: { field: 'Y', aggregate: 'mean' }, color: 'Group' }).createGuides();
  const { recommendations } = engine.recommend(p, { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS });
  assert.ok(recommendations.some(r => r.method === 'encodeX' && r.feature === 'transform.bin'));
  assert.ok(recommendations.some(r => r.method === 'encodeY' && r.feature === 'transform.aggregate'));
  assert.ok(recommendations.some(r => r.method === 'editColorScale'));
  assert.ok(!recommendations.some(r => r.category === 'encoding' && ['encoding.x', 'encoding.y', 'encoding.color'].includes(r.feature)));
});
