import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { renderToSVG } from 'ggaction/svg';
import { createCalculationService } from '../web/calculation-service.js';
import { defaultCanvasOptions } from '../src/prepare.js';

test('worker transports post-action guide calls and materializes the same public sequence as its preview', () => {
  const rows = [{ x: 1, y: 1, g: 'A' }, { x: 2, y: 3, g: 'A' },
    { x: 1, y: 3, g: 'B' }, { x: 2, y: 4, g: 'B' }];
  const program = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows })
    .createLinePlot({ id: 'plot', data: 'data', x: 'x', y: 'y', color: { field: 'g', fieldType: 'nominal' } });
  const service = createCalculationService();
  const guideCall = { method: 'createGuides', args: {} };
  service.execute({ type: 'state', stateId: 'line', snapshot: serializeProgram(program), guideCall });
  const request = { stateId: 'line', action: { method: 'encodeStrokeDash', args: { target: 'plot', field: 'g', fieldType: 'nominal' } } };
  const prepared = service.execute({ ...request, type: 'prepare' });
  assert.equal(prepared.recommendation.validation.topLevelActions, 1);
  assert.deepEqual(prepared.postActionCalls.map(call => call.method), ['editLegend']);
  let replay = program;
  for (const call of [...prepared.prerequisiteCalls, prepared.recommendation, ...prepared.postActionCalls, prepared.guideCall]) {
    replay = replay[call.method](call.args);
  }
  const materialized = service.execute({ ...request, type: 'materialize' });
  const restored = deserializeProgram(materialized.snapshot).createGuides(materialized.guideCall.args);
  assert.equal(renderToSVG(restored), renderToSVG(replay));
  assert.equal(prepared.preview.svg, renderToSVG(replay, { resourceNamespace: 'worker-preview' }));
});
