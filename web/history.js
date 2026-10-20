// Snapshots retain immutable ggaction programs; previews never enter history.
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
