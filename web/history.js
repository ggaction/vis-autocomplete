import { freezeResult } from '../src/cache.js';

const snapshots = new WeakSet(), calls = new WeakSet();
export const isHistorySnapshot = snapshot => snapshots.has(snapshot);
const recordCall = call => {
  if (calls.has(call)) return call;
  const copy = freezeResult(structuredClone(call)); calls.add(copy); return copy;
};

// Copy new authoring inputs once. Earlier immutable calls are shared across
// history entries, so N edits do not retain N(N+1)/2 copies of their arguments.
export function captureHistorySnapshot(state, currentNote = state.currentNote) {
  const snapshot = Object.freeze({ program: state.program, view: state.view,
    selectionAxes: state.selectionAxes, currentNote,
    ...freezeResult(structuredClone(Object.fromEntries(
      ['phase', 'context', 'steps', 'guideCall', 'selection', 'plotData', 'optionGroup'].map(key => [key, state[key]])))),
    setupCalls: Object.freeze(state.setupCalls.map(recordCall)), calls: Object.freeze(state.calls.map(recordCall)),
  });
  snapshots.add(snapshot); return snapshot;
}

// Snapshots retain immutable ggaction programs; previews never enter history.
export const historyLabel = snapshot => snapshot.phase === 'initial' ? 'Variables' : snapshot.currentNote;
export const historyPreview = snapshot => snapshot.phase === 'initial'
  ? snapshot.selectionAxes?.program ?? snapshot.view : snapshot.view;

export function createHistory() {
  let entries = [], index = -1;
  return {
    reset(snapshot) { entries = [snapshot]; index = 0; },
    restore(snapshots, position) {
      if (!Array.isArray(snapshots) || !snapshots.length || !Number.isInteger(position) || position < 0 || position >= snapshots.length) {
        throw new TypeError('Invalid history snapshot or position.');
      }
      entries = snapshots.slice(); index = position;
      return entries[index];
    },
    push(snapshot) {
      entries.splice(index + 1);
      entries.push(snapshot); index = entries.length - 1;
    },
    replace(snapshot) {
      if (index < 0) throw new Error('Cannot replace empty history.');
      entries.splice(index, entries.length - index, snapshot);
    },
    undo() {
      if (index <= 0) return null;
      return entries[--index];
    },
    redo() {
      if (index >= entries.length - 1) return null;
      return entries[++index];
    },
    jump(target) {
      if (!Number.isInteger(target) || target < 0 || target >= entries.length || target === index) return null;
      index = target; return entries[index];
    },
    get entries() { return entries.slice(); },
    get index() { return index; },
    get canUndo() { return index > 0; },
    get canRedo() { return index < entries.length - 1; },
  };
}
