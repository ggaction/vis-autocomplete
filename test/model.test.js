import test from 'node:test';
import assert from 'node:assert/strict';
import { trainCooccurrenceModel, scoreCandidate } from '../src/model.js';

test('paper formula: divide pair counts by ALL charts and take an unweighted arithmetic mean', () => {
  const model = trainCooccurrenceModel([
    { id: '1', features: ['x', 'y', 'z', 'z'] },
    { id: '2', features: ['x', 'z'] },
    { id: '3', features: ['y'] },
    { id: '4', features: ['x', 'y'] },
  ]);
  const result = scoreCandidate(model, ['x', 'y'], 'z');
  // c(x,z)=2/4; c(y,z)=1/4; q = (0.5+0.25)/2 = 0.375.
  assert.equal(result.score, 0.375);
  assert.deepEqual(result.contributions.map(c => c.chartCount), [2, 1]);
  assert.equal(model.featureCounts.z, 2);
  assert.equal(scoreCandidate(model, ['unknown', 'x'], 'z').score, 0.25);
  assert.equal(scoreCandidate(model, ['x', 'y'], 'unseen').score, 0);
  assert.equal(scoreCandidate(model, ['x', 'y'], 'unseen').unseenCandidate, true);
});

test('chart IDs cannot be duplicated to overweight translation variants', () => {
  assert.throws(() => trainCooccurrenceModel([
    { id: 'one', features: ['x'] }, { id: 'one', features: ['y'] },
  ]), /duplicate/);
  assert.throws(() => trainCooccurrenceModel([]), /at least one/);
});

test('model is deterministic and survives a plain JSON round trip', () => {
  const model = trainCooccurrenceModel([{ id: '1', features: ['b', 'a'] }]);
  const loaded = JSON.parse(JSON.stringify(model));
  assert.deepEqual(scoreCandidate(model, ['a'], 'b'), scoreCandidate(loaded, ['a'], 'b'));
  assert.equal(loaded.chartCount, 1);
});
