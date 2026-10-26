import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToSVG } from 'ggaction/svg';
import { createHistory, normalizeHistoryGraph } from '../web/history.js';
import { createResizeHistory } from '../web/resize-history.js';
import { layoutHistoryGraph } from '../web/history-graph-layout.js';
import { createProject, parseProject, restoreSession, prepareHistorySnapshot, checkpointRevision } from '../web/project.js';

function example() {
  const h = createHistory(), rows = [{ x: 1, y: 3, c: 'A' }, { x: 3, y: 2, c: 'B' }];
  const initial = { setupCalls: [{ method: 'createCanvas', args: { width: 500, height: 400 } },
    { method: 'createData', args: { id: 'd', values: '__LOADED_DATA__' } }], calls: [], axesCalls: [],
    steps: 0, phase: 'initial', selection: { fields: ['x', 'y', 'c'] }, context: {}, plotData: 'd', currentNote: 'Variables', optionGroup: 'encoding' };
  h.reset(initial);
  const first = { ...initial, phase: 'recommendations', steps: 1, currentNote: 'Scatter plot', calls: [
    { method: 'createScatterPlot', args: { id: 'plot', data: 'd', x: 'x', y: 'y', guides: false } }] };
  h.push(first); const fork = h.activeId;
  h.push({ ...first, steps: 2, currentNote: 'Color', calls: [...first.calls, { method: 'encodeColor', args: { target: 'plot', field: 'c' } }] });
  const color = h.activeId;
  h.undo(); h.push({ ...first, steps: 2, currentNote: 'Opacity', calls: [...first.calls, { method: 'encodeOpacity', args: { target: 'plot', value: .3 } }] });
  return { h, rows, fork, color, opacity: h.activeId };
}

test('node jumps choose redo paths without adding history; replacements never alter ancestors', () => {
  const { h, fork, color, opacity } = example();
  h.jump(color); h.undo(); assert.equal(h.redo().currentNote, 'Color');
  h.jump(opacity); h.undo(); assert.equal(h.redo().currentNote, 'Opacity');
  assert.equal(h.nodes.length, 4);
  h.jump(fork); h.replace({ currentNote: 'Different selection' });
  assert.equal(h.nodes.length, 5); assert.equal(h.nodes.find(n => n.id === fork).snapshot.currentNote, 'Scatter plot');
  const latest = h.activeId; h.replace({ currentNote: 'Updated selection' });
  assert.equal(h.activeId, latest); assert.equal(h.nodes.length, 5);
});

test('coalesced moves are one leaf per branch and preserve other branches after navigation', () => {
  const { h, fork, color } = example(), run = createResizeHistory(h);
  h.jump(fork); run.commit(run.begin(), { currentNote: 'Resize 1' }); const id = h.activeId;
  run.commit(run.begin(), { currentNote: 'Resize 2' }); assert.equal(h.activeId, id);
  run.reset(); h.jump(color); h.push({ currentNote: 'Other work' });
  h.jump(id); assert.equal(h.entries.at(-1).currentNote, 'Resize 2'); assert.equal(h.nodes.length, 6);
});

test('legacy and branching projects restore exact native states lazily and preserve topology across saves', async () => {
  const { h, rows, color, opacity } = example();
  const record = { id: 'd', name: 'Example', imported: { rows }, session: h.exportSession() };
  const project = parseProject(JSON.stringify(createProject([record], 'd')));
  const session = restoreSession(project.datasets[0].session, rows, { lazy: true }), restored = createHistory();
  restored.restore(session.entries, session.index, session.graph);
  assert.equal(restored.activeId, opacity); assert.equal(restored.nodes.length, 4);
  const old = restored.jump(color); await prepareHistorySnapshot(old);
  assert.equal(old.program.semanticSpec.layers[0].encoding.color.field, 'c');
  assert.equal(old.program.semanticSpec.layers[0].encoding.opacity, undefined);
  const next = restored.jump(opacity); await prepareHistorySnapshot(next);
  assert.match(renderToSVG(next.program), /opacity="0\.3"/);
  const saved = createProject([{ ...record, session: restored.exportSession() }], 'd');
  assert.deepEqual(saved.datasets[0].session.graph, project.datasets[0].session.graph);
  const before = checkpointRevision(saved);
  restored.jump(color); const changed = createProject([{ ...record, session: restored.exportSession() }], 'd');
  assert.notEqual(checkpointRevision(changed), before);
  const legacy = structuredClone(project); legacy.version = 1; delete legacy.datasets[0].session.graph;
  const imported = parseProject(JSON.stringify(legacy));
  restored.restore(imported.datasets[0].session.entries, imported.datasets[0].session.index);
  assert.equal(restored.nodes[3].parentId, restored.nodes[2].id);
});

test('invalid graph references, cycles, duplicate IDs, roots and cursors are rejected before execution', () => {
  const { h } = example(), { graph, entries, index } = h.exportSession();
  for (const change of [g => g.nodes[1].id = g.nodes[0].id, g => g.nodes[0].parentId = g.nodes[1].id,
    g => g.nodes[1].parentId = g.nodes[3].id, g => g.nodes[2].parentId = null,
    g => g.nodes[0].preferredChildId = g.nodes[3].id, g => g.activeId = 'missing', g => g.nodes.pop(), g => g.version = 9]) {
    const bad = structuredClone(graph); change(bad); assert.throws(() => normalizeHistoryGraph(bad, entries.length, index), /history graph/);
  }
  assert.throws(() => normalizeHistoryGraph(false, entries.length, index), /history graph/);
});

test('incremental layout stays stable and does not overlap for a thousand branched edits', () => {
  const h = createHistory(); h.reset({});
  for (let i = 0; i < 1000; i++) {
    const before = layoutHistoryGraph(h.nodes);
    if (i % 7 === 0) h.jump(h.nodes[Math.floor(i / 3)].id);
    h.push({});
    const after = layoutHistoryGraph(h.nodes);
    for (const node of before.items) assert.deepEqual([after.positions.get(node.id).x, after.positions.get(node.id).y], [node.x, node.y]);
  }
  const layout = layoutHistoryGraph(h.nodes), positions = layout.items.map(n => `${n.x},${n.y}`);
  assert.equal(new Set(positions).size, 1001); assert.equal(layout.nodeWidth, 75);
  const restored = createHistory(), session = h.exportSession(); restored.restore(session.entries, session.index, session.graph);
  assert.deepEqual(restored.exportSession().graph, session.graph);
});
