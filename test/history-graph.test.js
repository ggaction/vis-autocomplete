import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToSVG } from 'ggaction/svg';
import { createHistory, normalizeHistoryGraph } from '../web/history.js';
import { createResizeHistory } from '../web/resize-history.js';
import { layoutHistoryGraph, historyGraphRowZoom } from '../web/history-graph-layout.js';
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

// Check actual orthogonal connector geometry, independently of row allocation.
// Shared stems between siblings are intentional junctions, not crossings.
function assertPlanar(layout) {
  const edges = layout.items.filter(n => n.parentId !== null).map(node => {
    const parent = layout.positions.get(node.parentId);
    const x = parent.x + layout.nodeWidth, y = parent.y + layout.nodeHeight / 2;
    const endY = node.y + layout.nodeHeight / 2, bend = x + 16;
    return { from: parent.id, to: node.id, segments: [[x, y, bend, y], [bend, y, bend, endY], [bend, endY, node.x, endY]] };
  });
  function intersects(a, b) {
    return Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2])) <= Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2])) &&
      Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3])) <= Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3]));
  }
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    for (const b of edges.slice(i + 1)) {
      if (a.from === b.from) continue;
      assert.ok(!a.segments.some(s => b.segments.some(t => intersects(s, t))), `Edges ${a.from}→${a.to} and ${b.from}→${b.to} cross`);
    }
    for (const node of layout.items) {
      assert.ok(!a.segments.some(([x1, y1, x2, y2]) => Math.max(x1, x2) > node.x && Math.min(x1, x2) < node.x + layout.nodeWidth &&
        Math.max(y1, y2) > node.y && Math.min(y1, y2) < node.y + layout.nodeHeight), `Edge ${a.from}→${a.to} crosses node ${node.id}`);
    }
  }
  assert.equal(new Set(layout.items.map(n => `${n.x},${n.y}`)).size, layout.items.length);
}

test('late branches stay beside their own subtree instead of crossing an intervening branch', () => {
  const nodes = [
    { id: 'root', parentId: null }, { id: 'a', parentId: 'root' }, { id: 'a1', parentId: 'a' },
    { id: 'b', parentId: 'root' }, { id: 'b1', parentId: 'b' },
  ];
  const before = layoutHistoryGraph(nodes);
  nodes.push({ id: 'a2', parentId: 'a' });
  const after = layoutHistoryGraph(nodes);
  assert.deepEqual(after.items.map(n => n.row), [0, 0, 0, 2, 2, 1]);
  for (const id of ['root', 'a', 'a1']) assert.deepEqual(after.positions.get(id), before.positions.get(id));
  for (const id of ['b', 'b1']) assert.equal(after.positions.get(id).y - before.positions.get(id).y, after.nodeHeight + after.gapY);
  assertPlanar(after);
  assert.deepEqual(after.items.map(n => n.id), nodes.map(n => n.id), 'chronological ordinals do not change');
});

test('a thousand branched edits only shift rows below insertion, without crossings or overlaps', () => {
  const h = createHistory(); h.reset({});
  for (let i = 0; i < 1000; i++) {
    const before = layoutHistoryGraph(h.nodes);
    if (i % 7 === 0) h.jump(h.nodes[Math.floor(i / 3)].id);
    const parent = before.positions.get(h.activeId), descendants = new Set([parent.id]);
    let insertionRow = parent.row + 1;
    for (const node of before.items) if (descendants.has(node.parentId)) {
      descendants.add(node.id); insertionRow = Math.max(insertionRow, node.row + 1);
    }
    const createsRow = descendants.size > 1;
    h.push({});
    const after = layoutHistoryGraph(h.nodes);
    for (const node of before.items) {
      const expectedRow = node.row + Number(createsRow && node.row >= insertionRow), actual = after.positions.get(node.id);
      assert.deepEqual([actual.x, actual.row], [node.x, expectedRow]);
    }
  }
  const layout = layoutHistoryGraph(h.nodes); assertPlanar(layout); assert.equal(layout.nodeWidth, 75);
  const restored = createHistory(), session = h.exportSession(); restored.restore(session.entries, session.index, session.graph);
  assert.deepEqual(restored.exportSession().graph, session.graph);
  assert.deepEqual(layoutHistoryGraph(restored.nodes).items.map(n => [n.id, n.x, n.y]), layout.items.map(n => [n.id, n.x, n.y]));
});

test('interleaved sibling and nested branches remain planar regardless of preferred redo paths', () => {
  let seed = 51237;
  for (let tree = 0; tree < 8; tree++) {
    const nodes = [{ id: '0', parentId: null }];
    for (let i = 1; i < 200; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      nodes.push({ id: String(i), parentId: String(seed % i) });
    }
    const layout = layoutHistoryGraph(nodes); assertPlanar(layout);
    assert.deepEqual(layoutHistoryGraph(nodes.map(n => ({ ...n, preferredChildId: 'unused' }))).items.map(n => [n.x, n.y]), layout.items.map(n => [n.x, n.y]));
  }
});

test('layout handles deep histories without recursion or unnecessary rows', () => {
  const nodes = Array.from({ length: 20000 }, (_, i) => ({ id: String(i), parentId: i ? String(i - 1) : null }));
  const layout = layoutHistoryGraph(nodes);
  assert.equal(layout.items.length, nodes.length);
  assert.equal(layout.height, 2 * layout.padding + layout.nodeHeight);
  assert.ok(layout.items.every(n => n.row === 0));
});


test('two-row default zoom fits both nodes, the gap and padding without changing node geometry', () => {
  const layout = layoutHistoryGraph([{ id: 'root', parentId: null }, { id: 'a', parentId: 'root' }, { id: 'b', parentId: 'root' }], { width: 75, height: 48 });
  const aspect = layout.nodeWidth / layout.nodeHeight;
  for (const available of [80, 120, 220, 500]) {
    const zoom = historyGraphRowZoom(layout, available);
    assert.ok(Math.abs(zoom * (2 * 48 + 22 + 24) - available) < 1e-10);
    assert.ok(Math.abs((75 * zoom) / (48 * zoom) - aspect) < 1e-10);
    assert.deepEqual([layout.nodeWidth, layout.nodeHeight], [75, 48]);
  }
});
