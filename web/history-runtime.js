import { chart } from 'ggaction';
import { createLRU } from '../src/cache.js';

// Authoring calls remain permanent; native graphic trees are a bounded working
// set. Weak references reuse a tree still owned by Current or a live option deck.
export function createHistoryRuntimeCache(limit = 8) {
  const records = new WeakMap();
  const hot = createLRU(limit, (_, record) => { record.value = null; });
  const remember = (entry, record, value) => {
    record.value = value;
    record.refs = Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      item && typeof item === 'object' ? new WeakRef(item) : { deref: () => item }]));
    hot.set(entry, record); return value;
  };
  const available = record => {
    if (record.value) return record.value;
    const value = Object.fromEntries(Object.entries(record.refs).map(([key, ref]) => [key, ref.deref()]));
    return value.program && value.view ? value : null;
  };
  function* replay(entry, record) {
    let program = chart(), offset = 0;
    // Nearby Undo/Redo reuses a retained immutable public-call prefix.
    for (const candidate of hot.values()) {
      const other = candidate.entry, value = available(candidate);
      if (!value || !other.calls.length || Object.keys(candidate.rows).length !== Object.keys(record.rows).length ||
          Object.keys(record.rows).some(id => candidate.rows[id] !== record.rows[id]) || other.calls.length > entry.calls.length || other.calls.length < offset ||
          other.setupCalls.length !== entry.setupCalls.length || other.setupCalls.some((call, i) => call !== entry.setupCalls[i]) ||
          other.calls.some((call, i) => call !== entry.calls[i])) continue;
      program = value.program; offset = other.calls.length;
    }
    const calls = offset ? entry.calls.slice(offset) : [...entry.setupCalls, ...entry.calls];
    for (const call of calls) {
      const args = call.method === 'createData' && call.args.values === '__LOADED_DATA__'
        ? { ...call.args, values: record.rows[call.args.id] } : call.args;
      program = program[call.method](args); yield;
    }
    const view = entry.guideCall ? program[entry.guideCall.method](entry.guideCall.args) : program;
    return remember(entry, record, { program, view, selectionAxes: record.axes });
  }
  const resolve = entry => {
    const record = records.get(entry), cached = available(record);
    if (cached) return remember(entry, record, cached);
    const work = replay(entry, record); let step;
    do { step = work.next(); } while (!step.done);
    return step.value;
  };
  return {
    capture(metadata, value, rows) {
      const entry = Object.freeze({ ...metadata,
        get program() { return resolve(entry).program; }, get view() { return resolve(entry).view; },
        // Metadata packing must never materialize an evicted historical chart.
        get selectionAxes() { return records.get(entry).axes; } });
      // The selection-axis seed is small and shared across the dataset's edits.
      const record = { entry, rows, axes: value.selectionAxes };
      records.set(entry, record); remember(entry, record, value); return entry;
    },
    prepare(entry) {
      const record = records.get(entry); if (!record) return;
      const cached = available(record); if (cached) { remember(entry, record, cached); return; }
      // Hover, thumbnails and navigation can request the same cold snapshot
      // together. One replay owns it until completion, including across yields.
      if (!record.pending) record.pending = (async () => {
        const work = replay(entry, record); let deadline = performance.now() + 8;
        for (let step = work.next(); !step.done; step = work.next()) if (performance.now() >= deadline) {
          if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
          else await new Promise(resolve => setTimeout(resolve, 0));
          deadline = performance.now() + 8;
        }
      })().finally(() => { record.pending = null; });
      return record.pending;
    },
    // Also useful when leaving a dataset: all authoring metadata is preserved.
    release(entry) { const record = records.get(entry); if (record) { hot.delete(entry); record.refs = {}; } },
    get size() { return hot.size; },
  };
}
