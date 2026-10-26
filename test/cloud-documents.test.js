import test from 'node:test';
import assert from 'node:assert/strict';
import { changesBetween, sameDocument } from '../web/cloud/documents.js';

function apply(before, changes) {
  let value = structuredClone(before);
  for (const change of changes) {
    if (!change.path.length) { value = structuredClone(change.value); continue; }
    const parent = change.path.slice(0, -1).reduce((at, key) => at[key], value), key = change.path.at(-1);
    if (change.op === 'splice') parent[key].splice(change.index, change.deleteCount, ...structuredClone(change.values));
    else if (change.op === 'remove') delete parent[key];
    else Object.defineProperty(parent, key, { value: structuredClone(change.value), writable: true, enumerable: true, configurable: true });
  }
  return value;
}

test('project deltas preserve branches, middle edits, removals, insertions and JSON dates', () => {
  const before = { datasets: [{ id: 'a', session: { index: 1, entries: [{ calls: [1, 2] }, { calls: [1, 3] }] } }, { id: 'b' }], title: 'Before' };
  const cases = [
    { ...before, title: 'After' },
    { datasets: [before.datasets[0]] },
    { ...before, datasets: [before.datasets[1], before.datasets[0]] },
    { ...before, datasets: [{ ...before.datasets[0], session: { index: 0, entries: [{ calls: [1, 4] }, { calls: [1, 3] }] } }, before.datasets[1]] },
    { ...before, datasets: [{ id: 'new' }, ...before.datasets], date: new Date('2026-01-01') },
  ];
  for (const after of cases) assert.deepEqual(apply(before, changesBetween(before, after)), after);
  assert.deepEqual(changesBetween({ calls: [1, 2, 3] }, { calls: [1, 4] }), [
    { op: 'splice', path: ['calls'], index: 1, deleteCount: 2, values: [4] },
  ]);
  assert.equal(sameDocument({ value: new Date('2026-01-01') }, { value: new Date('2026-01-02') }), false);
  assert.equal(sameDocument([,], [1]), false, 'array holes cannot hide changed values');
  const mutable = { value: 1 }, snapshot = structuredClone(mutable);
  assert.equal(sameDocument(mutable, snapshot), true); mutable.value = 2;
  assert.equal(sameDocument(mutable, snapshot), false, 'no comparison cache survives across edits');
});

test('history deltas inspect shared call arguments once and only append the new snapshot', () => {
  const count = 400; let reads = 0;
  const calls = Array.from({ length: count + 1 }, (_, i) => ({ method: 'editTitle', get args() { reads++; return args[i]; } }));
  const args = calls.map((_, i) => ({ text: `Title ${i}`, titleStyle: { fontSize: 23 } }));
  const entries = Array.from({ length: count }, (_, i) => ({ calls: calls.slice(0, i + 1), steps: i }));
  const before = { datasets: [{ session: { entries, index: count - 1 } }] };
  const stored = structuredClone(before), after = { datasets: [{ session: { entries: [...entries, { calls, steps: count }], index: count } }] };
  reads = 0;
  const changes = changesBetween(stored, after);
  assert.ok(reads < count * 8, `${reads} argument reads should scale with unique calls`);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0].path, ['datasets', 0, 'session', 'entries']);
  assert.equal(changes[0].index, count); assert.equal(changes[0].values.length, 1);
  assert.deepEqual(apply(stored, changes), structuredClone(after));
});

test('deterministic mixed history edits always reconstruct the submitted project', () => {
  let seed = 17, before = { datasets: [{ id: 'a', session: { entries: [], index: 0 } }] };
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 150; i++) {
    const after = structuredClone(before), session = after.datasets[0].session;
    switch (i % 5) {
      case 0: session.entries.push({ calls: [i, { color: 'red', width: i % 8 }] }); break;
      case 1: session.index = Math.floor(random() * Math.max(1, session.entries.length)); break;
      case 2: if (session.entries.length) session.entries[Math.floor(random() * session.entries.length)].calls.push({ title: `Edit ${i}` }); break;
      case 3: after.title = `Title ${i}`; break;
      case 4: delete after.title; if (session.entries.length > 3) session.entries.splice(Math.floor(random() * session.entries.length), 1); break;
    }
    assert.deepEqual(apply(before, changesBetween(before, after)), after);
    before = after;
  }
});
