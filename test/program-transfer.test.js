import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { renderToSVG } from 'ggaction/svg';
import { packProgramUpdate, unpackProgramUpdate } from '../web/program-transfer.js';
import { createCalculationService } from '../web/calculation-service.js';
import { addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';

const scatter = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
  Array.from({ length: 8 }, (_, i) => ({ X: i + 1, Y: i * 2, C: i % 2 ? 'A' : 'B' })) })
  .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'C' });

test('worker updates retain exact native state and every nested trace without resending historical branches', () => {
  let base = scatter().facet({ field: 'C', data: 'data', columns: 2, guides: { axes: 'outer', legend: 'shared' } });
  const originalProgram = base, original = serializeProgram(base), sizes = [];
  for (let i = 0; i < 32; i++) {
    const next = base.editFacetSource({ action: { method: 'encodeOpacity', options: { target: 'plot', value: i % 2 ? .5 : .7 } } });
    const packed = packProgramUpdate(base, next), restored = unpackProgramUpdate(base, structuredClone(packed));
    assert.deepEqual(restored.trace, next.trace);
    assert.deepEqual(restored.graphicSpec, next.graphicSpec);
    assert.equal(serializeProgram(restored), serializeProgram(next));
    assert.equal(restored.trace.children[0], base.trace.children[0], 'unchanged native trace branches retain identity');
    assert.equal(renderToSVG(restored.createGuides()), renderToSVG(next.createGuides()));
    sizes.push(JSON.stringify(packed).length);
    if (!i) assert.equal(serializeProgram(base), original, 'transport cannot mutate its baseline');
    base = restored;
  }
  assert.ok(sizes.at(-1) < sizes[0] * 1.2, 'wire size follows new work, not all historical materializations');
  assert.ok(JSON.stringify(packProgramUpdate(base, base)).length < serializeProgram(base).length / 3);
  const undo = unpackProgramUpdate(base, structuredClone(packProgramUpdate(base, originalProgram)));
  assert.equal(serializeProgram(undo), original);
  const redo = unpackProgramUpdate(undo, structuredClone(packProgramUpdate(undo, base)));
  assert.equal(serializeProgram(redo), serializeProgram(base));
  const restoredWorker = createCalculationService(null);
  restoredWorker.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(base) });
  restoredWorker.execute({ type: 'state-update', stateId: 2, baseStateId: 1, update: packProgramUpdate(base, undo) });
  const action = { method: 'editFacetSource', args: { action: { method: 'encodeOpacity', options: { target: 'plot', value: .9 } } } };
  const prepared=restoredWorker.execute({ type: 'prepare', stateId: 2, action });
  let replay=undo;
  for(const call of [...prepared.prerequisiteCalls,prepared.recommendation,...prepared.postActionCalls,prepared.guideCall]) replay=replay[call.method](call.args);
  assert.deepEqual(prepared.preview.graphicSpec,replay.graphicSpec);
});

test('worker retention and cross-worker advance match public replay including guides, edits and branches', () => {
  const primary = createCalculationService(null), secondary = createCalculationService(null);
  const start = scatter(), guideCall = { method: 'createGuides', args: {} }, snapshot = serializeProgram(start);
  for (const service of [primary, secondary]) service.execute({ type: 'state', stateId: 1, snapshot, guideCall });
  let current = start;
  for (let i = 1; i <= 15; i++) {
    const action = { method: 'encodeOpacity', args: { target: 'plot', value: i % 2 ? .4 : .8 } };
    const result = primary.execute({ type: 'materialize', stateId: i, nextStateId: i + 1, action });
    assert.equal(result.snapshot, undefined);
    current = unpackProgramUpdate(current, structuredClone(result.update));
    secondary.execute({ type: 'advance', baseStateId: i, stateId: i + 1, action });
    for (const service of [primary, secondary]) {
      assert.equal(service.execute({ type: 'activate', stateId: i + 1 }).exists, true);
      const follow = { method: 'encodeSize', args: { target: 'plot', value: 81 } };
      const preview = service.execute({ type: 'prepare', stateId: i + 1, action: follow });
      let replay=current;
      for(const call of [...preview.prerequisiteCalls,preview.recommendation,...preview.postActionCalls,preview.guideCall]) replay=replay[call.method](call.args);
      assert.deepEqual(preview.preview.graphicSpec,replay.graphicSpec);
    }
  }
  assert.equal(primary.execute({ type: 'activate', stateId: 1 }).exists, false);
  assert.throws(() => secondary.execute({ type: 'advance', baseStateId: 1, stateId: 50, action: {} }), /expired/);
  const action = { method: 'encodeSize', args: { target: 'plot', value: 90 } };
  const branch = primary.execute({ type: 'materialize', stateId: 12, nextStateId: 50, action });
  assert.ok(branch.update);
  assert.equal(primary.execute({ type: 'activate', stateId: 16 }).exists, true, 'branching retains the recent future state for Redo');
});

test('compiled reload checkpoint preserves native state, guides, history, and subsequent actions', () => {
  const program = scatter().facet({ field: 'C', data: 'data', columns: 2, guides: { legend: 'shared' } });
  const guideCall = { method: 'createGuides', args: {} };
  const service = createCalculationService(null);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(program), guideCall });
  const checkpoint = service.execute({ type: 'checkpoint', stateId: 1 });
  const restored = deserializeProgram(checkpoint.snapshot), view = unpackProgramUpdate(restored, checkpoint.viewUpdate);
  assert.deepEqual(restored.trace, program.trace);
  assert.equal(renderToSVG(view), renderToSVG(program.createGuides()));
  const action = { method: 'editFacetSource', args: { action: { method: 'encodeOpacity', options: { target: 'plot', value: .3 } } } };
  const expected = service.execute({ type: 'prepare', stateId: 1, action });
  service.execute({ type: 'state', stateId: 2, snapshot: checkpoint.snapshot, guideCall });
  assert.deepEqual(service.execute({ type: 'prepare', stateId: 2, action }).preview, expected.preview);
});
