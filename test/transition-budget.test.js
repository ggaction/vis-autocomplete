import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionNodeBudget } from '../web/transition-budget.js';

test('ordinary marks retain geometry interpolation while dense polylines use the existing full-image transition', () => {
  const points = { nodes: Array.from({ length: 800 }, () => ({ type: 'circle', properties: { r: 3 } })) };
  assert.equal(transitionNodeBudget(points), 3000);
  const parallel = { nodes: Array.from({ length: 800 }, () => ({ type: 'path', properties: { commands: Array(6).fill({ op: 'L', x: 1, y: 2 }) } })) };
  assert.ok(transitionNodeBudget(parallel) < parallel.nodes.length);
  const hugePath = { nodes: [{ type: 'path', properties: { commands: Array(10000).fill({ op: 'L', x: 1, y: 2 }) } }, ...points.nodes.slice(0, 20)] };
  assert.ok(transitionNodeBudget(hugePath) < hugePath.nodes.length);
  assert.equal(parallel.nodes.length, 800, 'the budget never removes marks or commands');
  assert.equal(transitionNodeBudget({ nodes: [] }), 1);
});
