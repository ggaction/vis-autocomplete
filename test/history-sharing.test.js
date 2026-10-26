import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHistorySnapshot } from '../web/history.js';
import { createProject, parseProject, restoreSession, prepareHistorySnapshot } from '../web/project.js';

test('successive draft saves share immutable calls and only pack new history entries', () => {
  const state = { phase: 'recommendations', calls: [], setupCalls: [], context: {}, steps: 0,
    selection: { x: 'x', y: 'y', color: '' }, plotData: 'dataset', optionGroup: 'encoding' };
  const record = { id: 'data', name: 'Data', imported: { rows: [{ x: 1, y: 2 }] }, session: { entries: [], index: 0 } };
  let previous;
  for (let i = 0; i < 150; i++) {
    const call = { method: 'encodeOpacity', args: { target: 'plot', value: i % 2 ? .4 : .8 } };
    state.calls.push(call); state.steps++;
    const snapshot = captureHistorySnapshot(state, 'Opacity'); state.calls = [...snapshot.calls];
    call.args.value = 0;
    assert.notEqual(snapshot.calls.at(-1).args.value, 0, 'caller mutations cannot change history');
    record.session.entries.push(snapshot); record.session.index = i;
    const project = createProject([record], 'data');
    if (previous) assert.equal(project.datasets[0].session.entries[0], previous.datasets[0].session.entries[0]);
    previous = project;
  }
  const entries = previous.datasets[0].session.entries;
  assert.equal(new Set(entries.flatMap(entry => entry.calls)).size, 150);
  const persisted = structuredClone(previous);
  assert.equal(persisted.datasets[0].session.entries[0].calls[0], persisted.datasets[0].session.entries[149].calls[0]);
  const external = JSON.parse(JSON.stringify(previous));
  external.datasets[0].session.entries[0].calls[0].method = 'notPublic';
  assert.throws(() => parseProject(JSON.stringify(external)), /unknown ggaction call/);
});

test('restored branches retain shared calls while preserving independent history positions', () => {
  const setupCalls = [{ method: 'createCanvas', args: { width: 500, height: 400 } },
    { method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } }];
  const calls = [{ method: 'createScatterPlot', args: { id: 'plot', x: 'x', y: 'y' } }];
  const entries = [0, 1, 2].map(i => ({ phase: 'recommendations', steps: i + 1, setupCalls,
    calls: [...calls, ...Array.from({ length: i }, (_, n) => ({ method: 'encodeOpacity', args: { target: 'plot', value: .5 + n * .1 } }))],
    selection: { x: 'x', y: 'y', color: '' }, context: { target: 'plot' }, plotData: 'dataset', optionGroup: 'encoding', currentNote: 'Plot' }));
  const restored = restoreSession(JSON.parse(JSON.stringify({ index: 1, entries })), [{ x: 1, y: 2 }, { x: 2, y: 3 }]);
  assert.equal(restored.index, 1);
  assert.equal(restored.entries[0].calls[0], restored.entries[2].calls[0]);
  assert.equal(restored.entries[0].setupCalls[0], restored.entries[2].setupCalls[0]);
  assert.notDeepEqual(restored.entries[1].program.graphicSpec, restored.entries[2].program.graphicSpec);
});

test('concurrent thumbnail and hover requests share a deferred project replay', async () => {
  const previous = globalThis.scheduler;
  let yields = 0;
  globalThis.scheduler = { async yield() { yields++; await new Promise(resolve => setImmediate(resolve)); } };
  const stored = { index: 0, entries: [{ phase: 'recommendations', steps: 1,
    setupCalls: [{ method: 'createCanvas', args: { width: 500, height: 400 } },
      { method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } }],
    calls: [{ method: 'createScatterPlot', args: { id: 'plot', x: 'x', y: 'y' } }],
    selection: { fields: ['x', 'y'] }, context: { target: 'plot' }, optionGroup: 'encoding' }] };
  const restore = () => restoreSession(stored, [{ x: 1, y: 2 }], { lazy: true }).entries[0];
  try {
    const one = restore(); await prepareHistorySnapshot(one);
    const single = yields; yields = 0;
    const shared = restore();
    await Promise.all([prepareHistorySnapshot(shared), prepareHistorySnapshot(shared), prepareHistorySnapshot(shared)]);
    assert.equal(yields, single);
    assert.ok(single > 0);
    assert.deepEqual(shared.view.graphicSpec, one.view.graphicSpec);
  } finally { if (previous === undefined) delete globalThis.scheduler; else globalThis.scheduler = previous; }
});
