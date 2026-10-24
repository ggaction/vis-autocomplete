import { replayPrepared, assertPreparedTrace } from './support/prepared.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createRecommendationEngine, profileDataset } from '../src/index.js';
import { prepareGuidedAction, addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { createCalculationService } from '../web/calculation-service.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
test('Jitter points offers X, Y and Both with one native action and two parameter groups', () => {
  const raw = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
    Array.from({ length: 12 }, (_, i) => ({ X: i % 4 + 1, Y: i % 3 + 1 })) })
    .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', guides: false });
  const view = addDefaultGuides(raw), engine = createRecommendationEngine(model);
  const rec = engine.rank(view, { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS, group: 'transform' })
    .recommendations.find(r => r.method === 'jitterPoints');
  assert.ok(rec);
  const editor = recommendationParameters(rec, profileDataset(view, 'data'));
  assert.equal(editor.controls.length, 2);
  const direction = editor.controls.find(c => c.path === 'channel');
  assert.deepEqual(direction.choices, [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'both', label: 'Both' }]);
  const prepared = {};
  for (const channel of ['x', 'y', 'both']) {
    const args = editor.build({ ...valuesFor(editor.controls), [direction.key]: channel });
    prepared[channel] = prepareGuidedAction(raw, { method: rec.method, args }, view);
    assert.equal(prepared[channel].recommendation.validation.topLevelActions, 1);
    assertPreparedTrace(prepared[channel]);
    assert.equal(prepared[channel].authoringPreview.materializationConfigs.jitters.plot.channel, channel);
  }
  const positions = (program, channel) => program.graphicSpec.objects.plot.items.map(item => item.properties[channel]);
  for (const channel of ['x', 'y']) assert.deepEqual(positions(prepared.both.authoringPreview, channel), positions(prepared[channel].authoringPreview, channel));
  const service = createCalculationService(null);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(raw), guideCall: { method: 'createGuides', args: {} } });
  const remote = service.execute({ type: 'prepare', stateId: 1, action: { method: 'jitterPoints', args: prepared.both.recommendation.args } });
  assert.equal(remote.recommendation.validation.topLevelActions, 1);
  assert.deepEqual(remote.preview.graphicSpec, prepared.both.preview.graphicSpec);
});
