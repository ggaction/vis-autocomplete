import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToSVG } from 'ggaction/svg';
import { parse } from 'acorn';
import { createHistory } from '../web/history.js';
import { createProject, parseProject, validateProject, restoreSession, runnableCode } from '../web/project.js';

function example() {
  const rows = [{ X: 1, Y: 2 }, { X: 2, Y: 4 }];
  const setupCalls = [{ method: 'createCanvas', args: { width: 500, height: 400, margin: { left: 50, right: 30, top: 30, bottom: 50 } } },
    { method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } }];
  const calls = [{ method: 'createScatterPlot', args: { id: 'plot', data: 'dataset', x: 'X', y: 'Y', guides: false } }];
  const initial = { setupCalls, calls: [], axesCalls: [], steps: 0, phase: 'initial', selection: { x: 'X', y: 'Y', color: '' }, currentNote: '',
    context: {}, plotData: 'dataset', optionGroup: 'encoding' };
  const first = { ...initial, calls, steps: 1, phase: 'recommendations', currentNote: 'Scatter plot' };
  const second = { ...first, calls: [...calls, { method: 'encodeOpacity', args: { target: 'plot', value: .5 } }], steps: 2, currentNote: 'Opacity' };
  return { id: 'uploaded-stock', name: 'Uploaded stock', imported: { rows, rawRows: rows, fieldTypes: {}, metadata: { conversions: [] } },
    session: { entries: [initial, first, second], index: 1 } };
}

test('a project round trip retains original rows, editable public calls, history future and position', () => {
  const record = example();
  const exported = createProject([record], record.id, { commit: 'test-source' });
  const parsed = parseProject(JSON.stringify(exported));
  const restored = restoreSession(parsed.datasets[0].session, parsed.datasets[0].imported.rows);
  const h = createHistory(); h.restore(restored.entries, restored.index);
  assert.equal(h.index, 1); assert.equal(h.canRedo, true); assert.equal(h.canUndo, true);
  assert.equal(h.entries[1].program.semanticSpec.layers[0].encoding.opacity, undefined);
  const next = h.redo(); assert.match(renderToSVG(next.program), /opacity="0\.5"/);
  assert.deepEqual(next.program.semanticSpec.datasets[0].values, record.imported.rawRows);
  assert.ok(renderToSVG(next.view).startsWith('<svg'));
  assert.equal(h.undo().currentNote, 'Scatter plot');
});

test('a dataset registry project keeps distinct uploaded sessions and exact names', () => {
  const one = example(), two = { ...example(), id: 'cars', name: 'Cars', imported: { rows: [{ X: 3, Y: 6 }], rawRows: [{ X: 3, Y: 6 }] } };
  const project = parseProject(JSON.stringify(createProject([one, two], one.id)));
  assert.equal(project.activeId, one.id);
  assert.equal(project.datasets[0].imported.rows.length, 2);
  assert.equal(project.datasets[1].imported.rows.length, 1);
  assert.throws(() => parseProject(JSON.stringify({ ...project, activeId: 'missing' })), /active dataset/);
});

test('project input cannot invoke prototype methods or replace existing data before validation', () => {
  const packed = createProject([example()], 'uploaded-stock');
  for (const method of ['constructor', '__proto__', 'toString', 'unknown']) {
    const invalid = structuredClone(packed); invalid.datasets[0].session.entries[0].setupCalls[0].method = method;
    assert.throws(() => parseProject(JSON.stringify(invalid)), /unknown ggaction call/);
  }
  assert.throws(() => parseProject('{oops'), SyntaxError);
  assert.throws(() => parseProject(JSON.stringify({ ...packed, version: 999 })), /supported/);
});

test('runnable export embeds normalized data, includes all folded calls and writes an SVG', () => {
  const record = example(), snapshot = record.session.entries[2];
  const code = runnableCode(snapshot, record, { commit: 'native-revision' });
  parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  assert.ok(code.includes('const data = [{"X":1,"Y":2},{"X":2,"Y":4}];'));
  assert.ok(code.includes('.encodeOpacity({'));
  assert.ok(code.includes('await writeFile("chart.svg", renderToSVG(program)'));
  assert.ok(!code.includes('__LOADED_DATA__'));
  assert.ok(code.includes('native-revision'));
});

test('project snapshots cannot overwrite dataset, program or busy state through extra metadata', () => {
  const packed = createProject([example()], 'uploaded-stock');
  for (const snapshot of packed.datasets[0].session.entries) Object.assign(snapshot, {
    datasetId: 'intruder', rows: [{ secret: 'wrong source' }], committing: true, generation: -1,
    base: 'bad base', program: 'not a program', cards: ['bad card'], active: 'wrong card', variableDraft: { bad: true },
  });
  const parsed = parseProject(JSON.stringify(packed)), stored = parsed.datasets[0].session;
  for (const snapshot of stored.entries) for (const key of ['datasetId', 'rows', 'committing', 'generation', 'base', 'program', 'cards', 'active', 'variableDraft']) assert.equal(key in snapshot, false);
  // Direct restoration is also safe even when a caller skipped parseProject.
  const restored = restoreSession(packed.datasets[0].session, packed.datasets[0].imported.rows);
  for (const snapshot of restored.entries) {
    for (const key of ['datasetId', 'rows', 'committing', 'generation', 'base', 'cards', 'active', 'variableDraft']) assert.equal(key in snapshot, false);
    assert.equal(typeof snapshot.program.semanticSpec, 'object');
  }
});

test('compatible omitted metadata gets explicit defaults while invalid UI state is rejected before restore', () => {
  const packed = createProject([example()], 'uploaded-stock');
  for (const snapshot of packed.datasets[0].session.entries) for (const key of ['optionGroup', 'context', 'plotData', 'currentNote']) delete snapshot[key];
  const compatible = validateProject(packed);
  assert.equal(compatible.datasets[0].session.entries[0].optionGroup, 'encoding');
  assert.equal(compatible.datasets[0].session.entries[0].plotData, 'dataset');
  assert.deepEqual(compatible.datasets[0].session.entries[0].context, {});
  assert.equal(compatible.datasets[0].imported, packed.datasets[0].imported, 'validating preserves immutable import identity for incremental persistence');
  for (const [key, value, message] of [
    ['optionGroup', 'unknown', /option group/], ['context', [], /chart context/],
    ['context', { target: 42 }, /chart context/], ['context', { data: 'dataset', committing: true }, /chart context/],
    ['selection', [], /history entry/], ['selection', { x: { field: 'X' } }, /selection/],
    ['selection', { x: 'absent' }, /selection/], ['plotData', 42, /dataset reference/],
  ]) {
    const invalid = structuredClone(compatible); invalid.datasets[0].session.entries[1][key] = value;
    assert.throws(() => validateProject(invalid), message, key);
  }
});

test('every dataset field schema is checked, including inactive datasets with no history', () => {
  const first = example(), second = { ...example(), id: 'inactive', name: 'Inactive', session: null };
  for (const hint of [{ absent: 'nominal' }, { X: 'bogus' }, { X: { type: 'ordinal', order: {} } }, []]) {
    const invalid = { ...second, imported: { ...second.imported, fieldTypes: hint } };
    assert.throws(() => createProject([first, invalid], first.id), /field type/);
  }
  assert.throws(() => createProject([first, { ...second, imported: { rows: [{}] } }], first.id), /usable columns/);
  assert.throws(() => createProject([first, { ...second, imported: { ...second.imported, rawRows: [] } }], first.id), /original rows/);
});

test('lazy draft history preserves calls and branching without executing unseen snapshots during save', async () => {
  const { packSession, prepareHistorySnapshot } = await import('../web/project.js');
  const record = example(), stored = record.session;
  const lazy = restoreSession(stored, record.imported.rows, { lazy: true });
  const eager = restoreSession(stored, record.imported.rows);
  assert.deepEqual(packSession(lazy), packSession(eager));
  const h = createHistory(); h.restore(lazy.entries, lazy.index);
  assert.deepEqual(h.entries[h.index].view.graphicSpec, eager.entries[eager.index].view.graphicSpec);
  await prepareHistorySnapshot(lazy.entries[2]);
  assert.deepEqual(h.redo().program.trace, eager.entries[2].program.trace);
  assert.deepEqual(h.undo().view.graphicSpec, eager.entries[1].view.graphicSpec);
  assert.deepEqual(packSession(lazy), packSession(eager));
  // Public file import still validates native execution eagerly. Saving a local
  // lazy history reads metadata only; it must not invoke offscreen chart calls.
  const invalid = structuredClone(stored);
  invalid.entries[0].calls = [{ method: 'encodeOpacity', args: { target: 'absent', value: .5 } }];
  const deferred = restoreSession(invalid, record.imported.rows, { lazy: true });
  assert.doesNotThrow(() => packSession(deferred));
  assert.doesNotThrow(() => deferred.entries[1].view);
  assert.throws(() => deferred.entries[0].program);
  assert.throws(() => restoreSession(invalid, record.imported.rows));
});
