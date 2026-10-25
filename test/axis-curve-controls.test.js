import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor, activeControls } from '../web/parameters.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { actionTitle } from '../src/action-labels.js';
import { filterActionRecommendations } from '../src/action-search.js';

const rows = [1, 2, 3, 4, 5].map((x, i) => ({ x, y: [2, 5, 3, 6, 4][i], date: `2020-01-0${x}` }));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
function recipe(program, method) {
  const layer = program.semanticSpec.layers.find(l => l.id === 'plot') ?? program.semanticSpec.layers[0];
  const profile = profileDataset(program, layer.data);
  const rec = generateCandidates(program, { layer, profile }).find(r => r.method === method);
  return { rec, editor: recommendationParameters(rec, profile) };
}
for (const type of ['quantitative', 'temporal', 'nominal']) test(`${type} axes expose both sides and preserve their current position`, () => {
  const program = base().createScatterPlot({ id: 'plot', x: { field: type === 'temporal' ? 'date' : 'x', fieldType: type }, y: 'y' }).createGuides();
  for (const [method, side, channel] of [['editXAxis', 'top', 'x'], ['editYAxis', 'right', 'y']]) {
    const { editor } = recipe(program, method), values = valuesFor(editor.controls);
    const control = activeControls(editor.controls, values).find(c => c.label === 'Position');
    assert.ok(control); assert.ok(editor.controls.length <= 4);
    const result = prepareGuidedAction(program, { method, args: editor.build({ ...values, [control.key]: side }) }).authoringPreview;
    assert.equal(result.guideConfigs.axis[channel].line.position, side);
    const next = recipe(result, method).editor, nextValues = valuesFor(next.controls);
    assert.equal(activeControls(next.controls, nextValues).find(c => c.label === 'Position').value, side);
  }
  const { editor } = recipe(program, 'editAxes');
  const args = editor.build({ ...valuesFor(editor.controls), xPosition: 'top', yPosition: 'right' });
  assert.equal(args.x.position, 'top'); assert.equal(args.y.position, 'right');
  assert.ok(editor.controls.length <= 4);
  assert.doesNotThrow(() => prepareGuidedAction(program, { method: 'editAxes', args }));
});
for (const [create, edit] of [['createLinePlot', 'editLineMark'], ['createAreaPlot', 'editAreaMark']]) test(`${edit} exposes and executes all nine Cartesian curve choices`, () => {
  const program = base()[create]({ id: 'plot', x: 'x', y: 'y' }).createGuides();
  const { rec, editor } = recipe(program, edit), values = valuesFor(editor.controls);
  const curve = activeControls(editor.controls, values).find(c => c.label === 'Curve');
  assert.equal(curve.choices.length, 9); assert.ok(editor.controls.length <= 4);
  assert.equal(filterActionRecommendations([rec], 'smooth').length, 1);
  assert.equal(actionTitle(rec), edit === 'editLineMark' ? 'Adjust line' : 'Adjust area');
  for (const { value } of curve.choices) {
    const args = editor.build({ ...values, [curve.key]: value });
    const next = program[edit](args);
    assert.equal(next.markConfigs.plot.curve ?? 'linear', value);
    assert.equal(args.tension, undefined);
  }
  if (edit === 'editLineMark') {
    const cardinal = { ...values, [curve.key]: 'cardinal' };
    const tension = activeControls(editor.resolveControls(cardinal), cardinal).find(c => c.label === 'Tension');
    assert.ok(tension);
    assert.ok(!activeControls(editor.controls, values).some(c => c.label === 'Tension'));
    const adjusted = program[edit](editor.build({ ...cardinal, [tension.key]: .8 }));
    assert.equal(adjusted.markConfigs.plot.tension, .8);
    const after = recipe(adjusted, edit).editor, current = valuesFor(after.controls);
    const nextCurve = activeControls(after.controls, current).find(c => c.label === 'Curve');
    const cardinalControls = activeControls(after.controls, { ...current, [nextCurve.key]: 'cardinal' });
    assert.equal(cardinalControls.find(c => c.label === 'Tension').value, .8);
    const args = after.build({ ...current, [nextCurve.key]: 'natural' });
    assert.equal(args.tension, undefined);
    assert.equal(adjusted[edit](args).markConfigs.plot.tension, undefined);
  }
});
test('moving only the newly added left panel axis leaves its sibling and shared Y domain intact', () => {
  const original = base().createLinePlot({ id: 'plot', x: 'x', y: 'y' }).createGuides();
  const composition = prepareGuidedAction(original, { method: 'createAdjacentPlot', args: { id: 'left', source: 'plot', position: 'left', share: { y: true } } });
  const local = composition.preview.children.left;
  const { editor } = recipe(local, 'editYAxis');
  const values = valuesFor(editor.controls), position = activeControls(editor.controls, values).find(c => c.label === 'Position');
  const args = editor.build({ ...values, [position.key]: 'right' });
  const next = prepareGuidedAction(composition.authoringPreview, { method: 'editYAxis', args: { ...args, target: { childPath: ['left'], ...(args.target ? { id: args.target } : {}) } } }, composition.preview).preview;
  assert.equal(next.children.left.guideConfigs.axis.y.line.position, 'right');
  assert.notEqual(next.children.plot.guideConfigs.axis.y.line.position, 'right');
  assert.equal(next.compositionSpec.share.y, true);
});
