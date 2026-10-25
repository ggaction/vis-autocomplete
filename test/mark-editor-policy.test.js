import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { defaultCanvasOptions } from '../src/prepare.js';
import { recommendationParameters, valuesFor, activeControls } from '../web/parameters.js';
import { focusMarkEditors } from '../src/mark-editor-policy.js';
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
  [{ x: 1, y: 2, g: 'A' }, { x: 2, y: 4, g: 'B' }, { x: 3, y: 3, g: 'A' }] });
function candidates(program) {
  const profile = profileDataset(program, 'data');
  return { profile, list: generateCandidates(program, { profile, layer: program.semanticSpec.layers[0] }) };
}

test('a replacement must offer a fixed value for the same target before removing a control', () => {
  const editor = { method: 'editPointMark', args: { target: 'p', shape: 'square' }, parameters: [] };
  for (const encoding of [{ method: 'encodeShape', args: { target: 'other', value: 'circle' } },
    { method: 'encodeShape', args: { target: 'p', field: 'g' } }])
    assert.ok(focusMarkEditors([encoding, editor]).includes(editor) || focusMarkEditors([encoding, editor]).some(c => c.method === 'editPointMark'));
  assert.ok(!focusMarkEditors([{ method: 'encodeShape', args: { target: 'p', value: 'circle' } }, editor]).some(c => c.method === 'editPointMark'));
});

test('shape card changes between all fixed shapes and nominal mappings as one native call', () => {
  const program = base().createScatterPlot({ id: 'p', x: 'x', y: 'y' });
  const { profile, list } = candidates(program);
  assert.ok(!list.some(c => c.method === 'editPointMark'));
  const alternatives = list.filter(c => c.method === 'encodeShape');
  const rec = { ...alternatives.find(c => c.args.value !== undefined), alternatives };
  const editor = recommendationParameters(rec, profile), values = valuesFor(editor.controls);
  const shape = activeControls(editor.controls, values).find(c => c.label === 'Shape');
  assert.equal(shape.choices.length, 14);
  for (const { value } of shape.choices) {
    const args = editor.build({ ...values, mode: 'fixed', value });
    assert.deepEqual(args, { target: 'p', value });
    assert.equal(program.encodeShape(args).markConfigs.p.shape, value);
  }
  const args = editor.build({ ...values, mode: 'variable', field: 'g' });
  assert.equal(args.value, undefined);
  assert.equal(program.encodeShape(args).semanticSpec.layers[0].encoding.shape.field, 'g');
});

for (const [method, options, editor, retained] of [
  ['createBarPlot', { x: 'g', y: { field: 'y', aggregate: 'sum' } }, 'editBarMark', ['cornerRadius']],
  ['createLinePlot', { x: 'x', y: 'y' }, 'editLineMark', ['curve', 'tension']],
  ['createAreaPlot', { x: 'x', y: 'y' }, 'editAreaMark', ['curve']],
  ['createHeatmap', { x: 'x', y: 'y', bin: { bins: 3 } }, 'editRectMark', ['cornerRadius']],
  ['createTextPlot', { x: 'x', y: 'y', text: { field: 'g' } }, 'editTextMark', ['opacity', 'fontSize', 'fontWeight']],
  ['createRugPlot', { x: 'x', edge: 'bottom' }, 'editTickMark', ['opacity', 'length']],
]) test(`${method} retains unique controls without generic encoding duplicates`, () => {
  const p = base()[method]({ id: 'p', ...options });
  const { list, profile } = candidates(p);
  const recipe = list.find(c => c.method === editor);
  assert.deepEqual(recipe.parameters.map(p => p.path), retained);
  const params = recommendationParameters(recipe, profile), values = valuesFor(params.controls);
  const args = params.build(values);
  assert.equal(args.stroke, undefined);
  if (!retained.includes('opacity')) assert.equal(args.opacity, undefined);
  assert.doesNotThrow(() => p[editor](args));
});
