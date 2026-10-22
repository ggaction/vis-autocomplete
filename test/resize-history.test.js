import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { createHistory } from '../web/history.js';
import { createResizeHistory, rebaseResizeAction } from '../web/resize-history.js';
import { canvasGeometry, resizeCanvasAction } from '../src/canvas-geometry.js';
import { addDefaultGuides, prepareGuidedAction } from '../src/prepare.js';
import { prepareAction } from '../src/engine.js';

test('consecutive resizes replace one cell; navigation and other actions start a new run', () => {
  const history = createHistory(), resize = createResizeHistory(history);
  const initial = {}, first = {}, second = {}, action = {}, third = {};
  history.reset(initial);
  resize.commit(resize.begin(), first);
  assert.equal(resize.begin(), initial);
  resize.commit(resize.begin(), second);
  assert.deepEqual(history.entries, [initial, second]);
  resize.reset(); assert.equal(history.undo(), initial); assert.equal(history.redo(), second);
  assert.equal(resize.begin(), second);
  history.push(action); resize.commit(resize.begin(), third);
  assert.deepEqual(history.entries, [initial, second, action, third]);
  resize.reset(); history.undo(); history.undo();
  resize.commit(resize.begin(), first);
  assert.deepEqual(history.entries, [initial, second, first]);
  assert.equal(history.canRedo, false);
});

test('a resize can return exactly to the run baseline without changing ordinary no-op filtering', () => {
  const program = chart().createCanvas({ plot: { width: 240, height: 220 } });
  const action = { method: 'editCanvas', args: { plot: { width: 240, height: 220 } } };
  assert.throws(() => prepareAction(program, action), error => error.reason === 'no-change');
  const prepared = prepareAction(program, { ...action, allowUnchanged: true });
  assert.equal(prepared.recommendation.validation.changed, false);
  assert.deepEqual(prepared.preview.graphicSpec, program.graphicSpec);
  assert.throws(() => prepareAction(program, action), error => error.reason === 'no-change');
});

for (const facet of [false, true]) test(`compacted mixed resize geometry matches sequential native execution (facet=${facet})`, () => {
  let base = chart().createCanvas({ plot: { width: 240, height: 220 }, margin: { left: 100, right: 100, top: 70, bottom: 70 } })
    .createData({ id: 'd', values: [{ x: 1, y: 2, c: 'A' }, { x: 2, y: 3, c: 'B' }] })
    .createScatterPlot({ id: 'plot', data: 'd', x: 'x', y: 'y', color: 'c' });
  if (facet) base = base.facet({ field: 'c', data: 'd', columns: 2, spacing: 'plot', gap: 40, padding: 30, guides: { axes: 'outer', legend: 'shared' } });
  const baselineView = addDefaultGuides(base), baseline = canvasGeometry(baselineView);
  let program = base, view = baselineView;
  const run = (p, v, action) => {
    const prepared = prepareGuidedAction(p, action, v, action.setupCalls ?? []);
    let next = prepared.actionBase[prepared.recommendation.method](prepared.recommendation.args);
    for (const call of prepared.postActionCalls ?? []) next = next[call.method](call.args);
    return { program: next, view: prepared.preview };
  };
  for (const [handle, dx, dy] of [['canvas-se', -12, -12], ['plot-e', 18, 0], ['canvas-s', 0, 24], ['plot-s', 0, -16]]) {
    const action = resizeCanvasAction(canvasGeometry(view), handle, dx, dy);
    const sequential = run(program, view, action);
    const compact = run(base, baselineView, rebaseResizeAction(action, canvasGeometry(view), baseline));
    assert.deepEqual(compact.view.graphicSpec, sequential.view.graphicSpec);
    assert.ok(compact.program.trace.children.length <= base.trace.children.length + 3, 'native trace stays bounded');
    ({ program, view } = compact);
  }
});
