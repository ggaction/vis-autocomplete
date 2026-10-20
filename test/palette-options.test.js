import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { paletteChoices } from '../src/palette-options.js';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';

const rows = Array.from({ length: 9 }, (_, i) => ({ X: i + 1, Y: i * 2, Group: ['A', 'B', 'C'][i % 3] }));
const base = () => chart().createCanvas({ width: 400, height: 400, margin: 50 })
  .createData({ id: 'data', values: rows }).createScatterPlot({ id: 'plot', x: 'X', y: 'Y', guides: false });

test('each color family offers five featured palettes and all remaining native choices in More', () => {
  for (const type of ['nominal', 'ordinal', 'quantitative', 'temporal']) {
    const choices = paletteChoices(type, { auto: true });
    assert.equal(choices.filter(c => c.featured).length, 5);
    assert.ok(choices.filter(c => !c.featured).length > 5);
    assert.equal(new Set(choices.map(c => c.value)).size, choices.length);
    assert.equal(choices.find(c => c.value === 'auto').featured, false);
  }
});

test('all palette choices execute and render through native color and stroke scale actions', () => {
  for (const type of ['nominal', 'quantitative']) for (const channel of ['Color', 'Stroke']) {
    const field = type === 'nominal' ? 'Group' : 'X';
    const program = base()[`encode${channel}`]({ target: 'plot', field, fieldType: type });
    const profile = profileDataset(program, 'data');
    const rec = generateCandidates(program, { layer: program.semanticSpec.layers[0], profile })
      .find(c => c.method === `edit${channel}Scale`);
    const editor = recommendationParameters(rec, profile), control = editor.controls[0];
    assert.equal(control.choices.filter(c => c.featured).length, 5);
    for (const choice of control.choices) {
      const args = editor.build({ ...valuesFor(editor.controls), [control.key]: choice.value });
      assert.equal(args.palette, choice.value);
      assert.match(renderToSVG(program[rec.method](args)), /<svg/);
    }
  }
});

test('encoding palettes switch family with the variable and retain a selected More choice', () => {
  const program = base(), profile = profileDataset(program, 'data');
  for (const method of ['encodeColor', 'encodeStroke']) {
    const alternatives = ['Group', 'X'].map(field => ({ method, args: { target: 'plot', field,
      fieldType: field === 'Group' ? 'nominal' : 'quantitative' } }));
    const editor = recommendationParameters({ ...alternatives[0], alternatives }, profile);
    let values = { ...valuesFor(editor.controls), mode: 'variable', field: 'Group', palette: 'pastel1' };
    assert.equal(editor.build(values).scale.palette, 'pastel1');
    assert.equal(editor.resolveControls(values).find(c => c.key === 'palette').choices.filter(c => c.featured).length, 5);
    values = editor.normalizeValues({ ...values, field: 'X' }, 'field');
    assert.equal(values.palette, 'auto');
    const args = editor.build({ ...values, palette: 'spectral' });
    assert.equal(args.scale.palette, 'spectral');
    assert.match(renderToSVG(program[method](args)), /<svg/);
  }
});
