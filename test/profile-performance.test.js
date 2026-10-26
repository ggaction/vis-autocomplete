import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { profileDataset } from '../src/profile.js';
import { describeDataset, describeColumn, FEATURE_NAMES } from '../src/dataset-profile.js';

const rows = Array.from({ length: 2500 }, (_, index) => ({ value: index + 1,
  group: `Group ${index % 16}`, date: `2020-01-${String(index % 28 + 1).padStart(2, '0')}` }));
const base = () => chart().createCanvas({ width: 700, height: 430, margin: 70 }).createData({ id: 'd', values: rows });

function countRowScans(values, run) {
  const map = Array.prototype.map;
  let scans = 0;
  Array.prototype.map = function (...args) {
    if (this === values) scans++;
    return Reflect.apply(map, this, args);
  };
  try { run(); } finally { Array.prototype.map = map; }
  return scans;
}

test('unchanged native data is profiled once across recommendation groups and style history', () => {
  const initial = base(), dataset = initial.semanticSpec.datasets[0];
  let first;
  assert.ok(countRowScans(dataset.values, () => { first = profileDataset(initial, 'd'); }) > 0);
  const restyled = initial.createTitle({ text: 'A different presentation' });
  assert.equal(restyled.semanticSpec.datasets[0], dataset, 'the native immutable dataset survives style edits');
  assert.equal(countRowScans(dataset.values, () => {
    for (let index = 0; index < 20; index++) assert.deepEqual(profileDataset(restyled, 'd'), first);
  }), 0, 'a warm profile must not revisit every source row');
});

test('profile consumers cannot leak field selections, type hints, or category order into another request', () => {
  const initial = base(), first = profileDataset(initial, 'd');
  const expected = structuredClone(first);
  first.fields.find(field => field.name === 'group').guideValues.push('Injected');
  first.fields[0].type = 'nominal';
  first.fields.length = 1;
  first.rowCount = 0;
  assert.deepEqual(profileDataset(initial, 'd'), expected);
  const hints = { group: { type: 'ordinal', order: ['Group 8', 'Group 2'] } };
  const ordered = profileDataset(initial, 'd', hints);
  assert.deepEqual(ordered.fields.find(field => field.name === 'group').order.slice(0, 2), hints.group.order);
  ordered.fields.find(field => field.name === 'group').order.reverse();
  hints.group.order = ['Group 5'];
  assert.equal(profileDataset(initial, 'd', hints).fields.find(field => field.name === 'group').order[0], 'Group 5');
  assert.deepEqual(profileDataset(initial, 'd'), expected);
  assert.throws(() => profileDataset(initial, 'd', { missingField: 'nominal' }), /Invalid field type hint/);
  assert.throws(() => profileDataset(initial, 'd', { group: { type: 'ordinal', order: ['Group 5', 'Group 5'] } }), /unique values/);
});

test('filtering and derived data invalidate profiling without changing the original profile', () => {
  const initial = base(), original = profileDataset(initial, 'd');
  const filtered = initial.filterData({ id: 'filtered', source: 'd', field: 'value', range: { min: 1, max: 100 } });
  const next = profileDataset(filtered, 'filtered');
  assert.equal(next.rowCount, 100);
  assert.equal(next.fields.find(field => field.name === 'value').distinct, 100);
  assert.deepEqual(profileDataset(filtered, 'd'), original);
});

test('statistical profiles retain multiplicity, extreme numbers, ordering, and numeric-string semantics', () => {
  const numeric = describeColumn([-0, 0, 1, 2, 2, null, undefined]);
  assert.equal(numeric.distinct, 3);
  assert.equal(numeric.count, 5);
  assert.equal(numeric.zero, 2 / 5);
  const numericStrings = describeColumn(['0', '1', '1', '2']);
  assert.equal(numericStrings.numericString, true);
  assert.equal(numericStrings.distinct, 3);
  const matrix = Array.from({ length: 700 }, (_, i) => ({ a: i % 17, b: (i * 7) % 113,
    c: i % 5 ? (i % 11) - 5 : null, d: String(i % 9), category: `Group ${i % 4}` }));
  const original = describeDataset(matrix);
  const reordered = describeDataset([...matrix].reverse().map(row => ({ renamed: row.category,
    strings: row.d, missing: row.c, second: row.b, first: row.a })));
  for (let i = 0; i < original.vector.length; i++) assert.ok(Math.abs(original.vector[i] - reordered.vector[i]) < 1e-12, FEATURE_NAMES[i]);
  assert.ok(describeDataset([{ x: -1e308, y: 1e308 }, { x: 1e308, y: -1e308 }]).vector.every(Number.isFinite));
  assert.deepEqual(matrix[0], { a: 0, b: 0, c: null, d: '0', category: 'Group 0' });
});
