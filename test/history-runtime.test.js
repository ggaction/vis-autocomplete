import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { createHistoryRuntimeCache } from '../web/history-runtime.js';
import { captureHistorySnapshot } from '../web/history.js';
import { packSession } from '../web/project.js';

for (const faceted of [false, true]) test(`bounded compiled history replays exact native states and branches (facet=${faceted})`, async () => {
  const rows = [{ x: 1, y: 2, g: 'A' }, { x: 3, y: 4, g: 'B' }];
  const cache = createHistoryRuntimeCache(2);
  const setupCalls = [{ method: 'createCanvas', args: { width: 500, height: 400, margin: {top: 60, bottom: 50, left: 60, right: 120} } }, { method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } }];
  const sourceRows = { dataset: rows }, entries = [], expected = [];
  let program = chart().createCanvas(setupCalls[0].args).createData({ id: 'dataset', values: rows });
  const axes = { program, calls: [] };
  const calls = [{ method: 'createScatterPlot', args: { id: 'plot', data: 'dataset', x: 'x', y: 'y', color: 'g' } }];
  program = program.createScatterPlot(calls[0].args);
  if (faceted) { calls.push({ method: 'facet', args: { field: 'g', data: 'dataset', columns: 2, guides: { legend: 'shared' } } }); program = program.facet(calls.at(-1).args); }
  for (let i = 0; i < 12; i++) {
    const action = { method: 'encodeOpacity', args: { target: 'plot', value: .2 + i * .04 } };
    const call = faceted ? { method: 'editFacetSource', args: { action: { method: action.method, options: action.args } } } : action;
    calls.push(call); program = program[call.method](call.args);
    const view = program.createGuides();
    const entry = cache.capture({ setupCalls, calls: [...calls], guideCall: { method: 'createGuides', args: {} } }, { program, view, selectionAxes: axes }, sourceRows);
    entries.push(entry); expected.push({ graphic: JSON.stringify(view.graphicSpec), trace: JSON.stringify(program.trace), semantic: JSON.stringify(program.semanticSpec) });
    assert.ok(cache.size <= 2);
  }
  // Force the same fallback used when GC collects an old weak reference.
  for (const i of [0, 10, 2, 11, 4]) {
    cache.release(entries[i]); await cache.prepare(entries[i]);
    assert.equal(JSON.stringify(entries[i].view.graphicSpec), expected[i].graphic);
    assert.equal(JSON.stringify(entries[i].program.trace), expected[i].trace);
    assert.equal(JSON.stringify(entries[i].program.semanticSpec), expected[i].semantic);
    assert.equal(entries[i].selectionAxes, axes);
    assert.ok(cache.size <= 2);
  }
  const before = entries[2], call = { method: 'createTitle', args: { text: 'Branch' } };
  const branch = before.program.createTitle(call.args);
  const entry = cache.capture({ ...before, calls: [...before.calls, call] }, { program: branch, view: branch.createGuides(), selectionAxes: axes }, sourceRows);
  cache.release(entry); await cache.prepare(entry);
  assert.deepEqual(entry.program.graphicSpec, branch.graphicSpec);
  assert.equal(entries.length, 12);
});

test('packing runtime history preserves all public authoring calls without materializing its graphics', () => {
  const program = chart().createCanvas({ width: 500, height: 400 });
  const entry = captureHistorySnapshot({ program, view: program, phase: 'initial', setupCalls: [{ method: 'createCanvas', args: { width: 500, height: 400 } }], calls: [], context: {}, selection: { fields: [] }, steps: 0 });
  const packed = packSession({ index: 0, entries: [entry] });
  assert.deepEqual(packed.entries[0].setupCalls, entry.setupCalls);
  assert.ok(!('program' in packed.entries[0]));
});
