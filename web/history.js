import { freezeResult } from '../src/cache.js';
import { createHistoryRuntimeCache } from './history-runtime.js';

const snapshots = new WeakSet(), calls = new WeakSet();
const runtime = createHistoryRuntimeCache();
export const prepareCapturedHistory = snapshot => runtime.prepare(snapshot);
export const isHistorySnapshot = snapshot => snapshots.has(snapshot);
const recordCall = call => {
  if (calls.has(call)) return call;
  const copy = freezeResult(structuredClone(call)); calls.add(copy); return copy;
};

// Copy new authoring inputs once. Earlier immutable calls are shared across
// history entries, so N edits do not retain N(N+1)/2 copies of their arguments.
export function captureHistorySnapshot(state, currentNote = state.currentNote) {
  const metadata = { currentNote,
    ...freezeResult(structuredClone(Object.fromEntries(
      ['phase', 'context', 'steps', 'guideCall', 'selection', 'plotData', 'optionGroup'].map(key => [key, state[key]])))),
    setupCalls: Object.freeze(state.setupCalls.map(recordCall)), calls: Object.freeze(state.calls.map(recordCall)),
  };
  const value = { program: state.program, view: state.view, selectionAxes: state.selectionAxes };
  const rows = Object.fromEntries(metadata.setupCalls.filter(call => call.method === 'createData' && call.args.values === '__LOADED_DATA__')
    .map(call => [call.args.id, state.rows ?? state.program?.semanticSpec?.datasets.find(data => data.id === call.args.id)?.values]));
  const snapshot = state.program?.semanticSpec && Object.values(rows).every(Array.isArray)
    ? runtime.capture(metadata, value, rows) : Object.freeze({ ...metadata, ...value });
  snapshots.add(snapshot); return snapshot;
}

// Snapshots retain immutable ggaction programs; previews never enter history.
export const historyLabel = snapshot => snapshot.phase === 'initial' ? 'Variables' : snapshot.currentNote;
export const historyPreview = snapshot => snapshot.phase === 'initial'
  ? snapshot.selectionAxes?.program ?? snapshot.view : snapshot.view;

// Persisted topology is creation ordered. Requiring parents before children
// validates connectivity and excludes cycles in one pass, without recursion.
export function normalizeHistoryGraph(graph, count, index) {
  if (graph === null || graph === undefined) return null;
  const invalid = () => { throw new TypeError('Invalid project history graph.'); };
  if (graph.version !== 1 || !Array.isArray(graph.nodes) || graph.nodes.length !== count) invalid();
  const seen = new Map();
  const nodes = graph.nodes.map((node, i) => {
    if (!node || typeof node.id !== 'string' || !node.id || node.id.length > 100 || seen.has(node.id) ||
        (i === 0 ? node.parentId !== null : !seen.has(node.parentId))) invalid();
    const normalized = { id: node.id, parentId: node.parentId, preferredChildId: node.preferredChildId ?? null };
    seen.set(node.id, normalized); return normalized;
  });
  for (const node of nodes) if (node.preferredChildId !== null && seen.get(node.preferredChildId)?.parentId !== node.id) invalid();
  if (graph.activeId !== nodes[index]?.id) invalid();
  return { version: 1, activeId: graph.activeId, nodes };
}

export function createHistory() {
  let nodes = [], byId = new Map(), snapshotIds = new WeakMap(), activeId = null, path = [], revision = 0;
  function select(id) {
    activeId = id;
    let node = byId.get(id);
    const ancestors = [];
    while (node) {
      ancestors.push(node);
      const parent = byId.get(node.parentId);
      if (parent) parent.preferredChildId = node.id;
      node = parent;
    }
    path = ancestors.reverse();
    node = byId.get(id);
    while (node?.preferredChildId) {
      node = byId.get(node.preferredChildId); path.push(node);
    }
    revision++;
    return byId.get(id)?.snapshot ?? null;
  }
  function push(snapshot) {
    const parent = byId.get(activeId);
    const node = { id: crypto.randomUUID(), parentId: activeId, preferredChildId: null, snapshot, children: [] };
    nodes.push(node); byId.set(node.id, node); snapshotIds.set(snapshot,node.id);
    if (parent) parent.children.push(node.id);
    select(node.id);
  }
  return {
    clear() { nodes = []; byId = new Map(); snapshotIds = new WeakMap(); activeId = null; path = []; revision++; },
    reset(snapshot) { this.clear(); push(snapshot); },
    restore(snapshots, position, graph = null) {
      if (!Array.isArray(snapshots) || !snapshots.length || !Number.isInteger(position) || position < 0 || position >= snapshots.length) {
        throw new TypeError('Invalid history snapshot or position.');
      }
      const topology = normalizeHistoryGraph(graph, snapshots.length, position);
      const ids = topology?.nodes.map(node => node.id) ?? snapshots.map(() => crypto.randomUUID());
      nodes = snapshots.map((snapshot, i) => ({ ...(topology?.nodes[i] ?? {
        id: ids[i], parentId: ids[i - 1] ?? null, preferredChildId: ids[i + 1] ?? null }), snapshot, children: [] }));
      byId = new Map(nodes.map(node => [node.id, node])); snapshotIds=new WeakMap(nodes.map(node=>[node.snapshot,node.id]));
      for (const node of nodes) byId.get(node.parentId)?.children.push(node.id);
      return select(ids[position]);
    },
    push,
    replace(snapshot) {
      const node = byId.get(activeId);
      if (!node) throw new Error('Cannot replace empty history.');
      // An ancestor is immutable once another state depends on it.
      if (node.children.length) push(snapshot);
      else { node.snapshot = snapshot; snapshotIds.set(snapshot,node.id); revision++; }
    },
    undo() { return byId.get(activeId)?.parentId ? select(byId.get(activeId).parentId) : null; },
    redo() { return byId.get(activeId)?.preferredChildId ? select(byId.get(activeId).preferredChildId) : null; },
    jump(target) {
      const id = typeof target === 'string' ? target : Number.isInteger(target) ? path[target]?.id : null;
      return id && id !== activeId && byId.has(id) ? select(id) : null;
    },
    // Linear View is a projection of the chosen branch, including its Redo tail.
    nodeId(snapshot) { return snapshotIds.get(snapshot) ?? null; },
    get current() { return byId.get(activeId)?.snapshot ?? null; },
    get entries() { return path.map(node => node.snapshot); },
    get index() { return path.findIndex(node => node.id === activeId); },
    get nodes() { return nodes.map(({ children, ...node }) => ({ ...node, children: [...children] })); },
    get pathIds() { return path.map(node => node.id); },
    get activeId() { return activeId; },
    get revision() { return revision; },
    get canUndo() { return Boolean(byId.get(activeId)?.parentId); },
    get canRedo() { return Boolean(byId.get(activeId)?.preferredChildId); },
    exportSession() {
      return { entries: nodes.map(node => node.snapshot), index: nodes.findIndex(node => node.id === activeId),
        graph: { version: 1, activeId, nodes: nodes.map(({ id, parentId, preferredChildId }) => ({ id, parentId, preferredChildId })) } };
    },
  };
}
