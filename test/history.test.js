import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { createHistory, historyLabel, historyPreview } from '../web/history.js';
import { defaultCanvasOptions, prepareGuidedAction, addDefaultGuides } from '../web/plot-setup.js';
import { applyRecommendation } from '../src/index.js';

test('history restores immutable native chart states, final guides and original data across undo/redo', () => {
  const rows = [{ X: 1, Y: 2, C: 'A' }, { X: 2, Y: 4, C: 'B' }];
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
  const starting = prepareGuidedAction(base, { method: 'createScatterPlot', args: {
    id: 'plot', data: 'data', x: 'X', y: 'Y',
  } });
  const plot = applyRecommendation(starting.actionBase, starting.recommendation);
  const colored = prepareGuidedAction(plot, { method: 'encodeColor', args: { target: 'plot', field: 'C' } }, starting.preview);
  const history = createHistory();
  const initial = { program: base, view: base, phase: 'initial' };
  const first = { program: plot, view: starting.preview, phase: 'recommendations' };
  const second = { program: applyRecommendation(colored.actionBase, colored.recommendation), view: colored.preview, phase: 'recommendations' };
  history.reset(initial);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
  history.push(first); history.push(second);
  assert.equal(history.undo(), first);
  assert.equal(history.undo(), initial);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(), first);
  const restored = history.redo();
  assert.equal(restored, second);
  assert.deepEqual(addDefaultGuides(restored.program, colored.guideCall).graphicSpec, second.view.graphicSpec);
  assert.equal(restored.view.trace.children.at(-1).op, 'createGuides');
  assert.equal(restored.view.semanticSpec.layers[0].encoding.color.field, 'C');
  assert.equal(history.canRedo, false);
  assert.deepEqual(base.semanticSpec.datasets[0].values, rows);
  assert.equal(base.semanticSpec.layers.length, 0);
  assert.equal(first.view.semanticSpec.layers[0].encoding.color, undefined);
});

test('a new Apply after Undo discards the abandoned branch, and dataset reset clears both directions', () => {
  const h = createHistory(), initial = {}, plot = {}, color = {}, size = {};
  h.reset(initial); h.push(plot); h.push(color);
  assert.equal(h.undo(), plot);
  h.push(size);
  assert.equal(h.canRedo, false);
  assert.equal(h.redo(), null);
  assert.equal(h.undo(), plot);
  assert.equal(h.redo(), size);
  h.reset({ dataset: 'another' });
  assert.equal(h.canUndo, false); assert.equal(h.canRedo, false);
});

test('thumbnail jumps preserve chronological future states until a new action branches', () => {
  const h = createHistory();
  const snapshots = Array.from({ length: 5 }, (_, steps) => ({ steps, calls: Array(steps).fill('applied') }));
  h.reset(snapshots[0]); snapshots.slice(1).forEach(snapshot => h.push(snapshot));
  assert.deepEqual(h.entries, snapshots);
  assert.equal(h.index, 4);
  assert.equal(h.jump(1), snapshots[1]);
  assert.equal(h.index, 1);
  assert.equal(h.canUndo, true); assert.equal(h.canRedo, true);
  assert.deepEqual(h.entries, snapshots);
  assert.equal(h.jump(4), snapshots[4]);
  assert.equal(h.undo(), snapshots[3]);
  assert.equal(h.jump(1), snapshots[1]);
  const branch = { steps: 2, calls: ['applied', 'different action'] };
  h.push(branch);
  assert.deepEqual(h.entries, [snapshots[0], snapshots[1], branch]);
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(), snapshots[1]); assert.equal(h.redo(), branch);
});

test('reading history and invalid or repeated jumps cannot change the current state', () => {
  const h = createHistory();
  assert.equal(h.index, -1); assert.deepEqual(h.entries, []);
  assert.equal(h.canUndo, false); assert.equal(h.canRedo, false);
  const first = {}, second = {};
  h.push(first); h.push(second);
  const exposed = h.entries; exposed.length = 0;
  assert.deepEqual(h.entries, [first, second]);
  for (const index of [-1, 2, 0.5, NaN, '0', 1]) assert.equal(h.jump(index), null);
  assert.equal(h.index, 1);
  assert.equal(h.jump(0), first); assert.equal(h.redo(), second);
  h.reset(first); assert.deepEqual(h.entries, [first]); assert.equal(h.index, 0);
});

test('History 0 previews selected axes and retains selection and future charts when revisited', () => {
  const base = {}, axes = {}, plot = {};
  const initial = { steps: 0, phase: 'initial', view: base, currentNote: '',
    selection: { x: 'Miles_per_Gallon', y: 'Horsepower', color: 'Origin' }, selectionAxes: { program: axes } };
  const first = { ...initial, steps: 1, phase: 'recommendations', view: plot, currentNote: 'Scatter plot' };
  const h = createHistory(); h.reset(initial); h.push(first);
  assert.equal(historyLabel(initial), 'Variables');
  assert.equal(historyPreview(initial), axes, 'zero shows the selected axes, not the data-only program');
  assert.equal(historyLabel(first), 'Scatter plot');
  assert.equal(historyPreview(first), plot, 'applied snapshots may still retain their initial axes metadata');
  const restored = h.jump(0);
  assert.equal(restored, initial);
  assert.deepEqual(restored.selection, { x: 'Miles_per_Gallon', y: 'Horsepower', color: 'Origin' });
  assert.equal(h.canUndo, false); assert.equal(h.canRedo, true);
  assert.equal(h.redo(), first);
  h.jump(0);
  const branch = { ...first, currentNote: 'Line plot' };
  h.push(branch);
  assert.deepEqual(h.entries, [initial, branch]);
  assert.equal(h.canRedo, false); assert.equal(h.undo(), initial);
});
