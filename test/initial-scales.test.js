import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { deserializeProgram, serializeProgram } from 'ggaction/persistence';
import { selectedPlotDefinitions } from '../src/selected-plots.js';
import { defaultValues } from '../src/plot-catalog.js';
import { profileDataset } from '../src/profile.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { createRecommendationEngine } from '../src/engine.js';
import { selectionData } from '../web/selection-setup.js';
import { initialParameters, activeControls } from '../web/parameters.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const rows = Array.from({ length: 36 }, (_, i) => ({ X: i + 10, Y: 20 + i % 11,
  Group: ['A', 'B', 'C'][i % 3], Date: `2020-01-${String(i % 28 + 1).padStart(2, '0')}` }));
function setup(selection, data = rows) {
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: data });
  const profile = profileDataset(base, 'dataset');
  const selected = selectionData(base, profile, data, selection);
  const definitions = selectedPlotDefinitions({ ...profile, id: selected.data }, selection, data, [], { availableProfile: profile });
  return { base, selected, definitions };
}
const prepare = (selected, rec, values = defaultValues(rec)) => prepareGuidedAction(selected.program,
  { method: rec.method, args: rec.build(values) }, selected.program, rec.setup?.(values) ?? []);
const scales = (p, channel) => {
  const layer = p.semanticSpec.layers.find(l => l.id === 'plot');
  return p.semanticSpec.scales.find(s => s.id === layer.encoding[channel].scale);
};
const ranked = (program, target = 'plot') => engine.rank(program, {
  ...FOLLOWUP_RECOMMENDATION_OPTIONS, target, group: 'encoding', hierarchy: false,
}).recommendations;

test('initial scatter scales/palette are native plot parameters, rendered and persisted in the same single action', () => {
  const { selected, definitions } = setup({ x: 'X', y: 'Y', color: 'Group' });
  const rec = definitions.find(r => r.method === 'createScatterPlot'), editor = initialParameters(rec);
  assert.equal(editor.controls.length, 1);
  assert.equal(editor.controls[0].key, 'scales');
  const controls = activeControls(editor.controls, defaultValues(rec));
  assert.deepEqual(controls.map(c => c.key), ['xScale', 'yScale', 'palette']);
  const palette = controls.find(c => c.key === 'palette');
  assert.equal(palette.choices.filter(c => c.featured).length, 5);
  assert.ok(palette.choices.some(c => c.value === 'pastel1' && !c.featured));
  const values = { ...defaultValues(rec), xScale: 'log', yScale: 'sqrt', palette: 'pastel1' };
  const args = editor.build(values), prepared = prepare(selected, rec, values), p = prepared.preview;
  assert.equal(args.x.scale.type, 'log');
  assert.equal(args.y.scale.type, 'sqrt');
  assert.equal(args.color.scale.palette, 'pastel1');
  assert.equal(prepared.recommendation.validation.topLevelActions, 1);
  assert.ok(!p.trace.children.some(n => /^edit.*Scale$/.test(n.op)), 'no extra authoring actions');
  assert.equal(scales(p, 'x').type, 'log'); assert.equal(scales(p, 'y').type, 'sqrt');
  assert.equal(scales(p, 'color').range.palette, 'pastel1');
  assert.equal(renderToSVG(deserializeProgram(serializeProgram(p))), renderToSVG(p));
});

test('initial axes and color scales join the used queue without changing scores or erasing their cards', () => {
  for (const selection of [{ x: 'X', y: 'Y' }, { x: 'X', y: 'Y', color: 'Group' }]) {
    const { selected, definitions } = setup(selection);
    const p = prepare(selected, definitions.find(r => r.method === 'createScatterPlot')).preview;
    const recs = ranked(p), baseline = engine.rank(p, { target: 'plot', includeRevisions: true, limit: 1000, group: 'encoding' }).recommendations;
    assert.deepEqual(recs.map(r => [r.id, r.score]).sort(), baseline.map(r => [r.id, r.score]).sort());
    for (const method of ['editXScale', 'editYScale', ...(selection.color ? ['editColorScale'] : [])]) {
      const rec = recs.find(r => r.method === method);
      assert.ok(rec?.previouslyApplied, method);
      assert.ok(recs.slice(recs.indexOf(rec)).every(r => r.previouslyApplied));
    }
    if (!selection.color) assert.equal(recs.find(r => r.method === 'encodeColor').previouslyApplied, false);
    const restored = ranked(deserializeProgram(serializeProgram(p)));
    assert.deepEqual(restored.map(r => [r.id, r.previouslyApplied]), recs.map(r => [r.id, r.previouslyApplied]));
  }
});

test('used scale detection is scoped to the current mark and survives facet wrapping', () => {
  const { selected, definitions } = setup({ x: 'X', y: 'Y', color: 'Group' });
  const p = prepare(selected, definitions.find(r => r.method === 'createScatterPlot')).authoringPreview;
  const multi = p.createScatterPlot({ id: 'other', data: 'dataset', x: 'X', y: 'Y' });
  assert.equal(ranked(multi, 'other').find(r => r.method === 'encodeColor').previouslyApplied, false);
  const facet = p.facet({ field: 'Group', data: 'dataset', columns: 3, guides: { axes: 'outer', legend: 'shared' } });
  for (const method of ['editXScale', 'editYScale', 'editColorScale']) {
    assert.ok(ranked(facet).some(r => r.args?.action?.method === method && r.previouslyApplied), method);
  }
});

test('temporal, zero-baseline and nonpositive data never advertise an invalid log choice', () => {
  const cases = [
    [{ x: 'X', y: 'Date' }, 'createScatterPlot', 'yScale', rows, ['time']],
    [{ x: 'Group', y: 'Y' }, 'createBarPlot', 'yScale', rows],
    [{ x: 'X', y: 'Y' }, 'createAreaPlot', 'yScale', rows],
    [{ x: 'X', y: 'Y' }, 'createScatterPlot', 'xScale', rows.map((r, i) => ({ ...r, X: i - 10 }))],
  ];
  for (const [selection, method, key, data, expected] of cases) {
    const { selected, definitions } = setup(selection, data), rec = definitions.find(r => r.method === method);
    const editor = initialParameters(rec), values = defaultValues(rec);
    const control = activeControls(editor.resolveControls(values), values).find(c => c.key === key);
    if (expected) assert.deepEqual(control.choices.map(c => c.value), expected);
    else {
      assert.equal(control.choices.find(c => c.value === 'log').disabled, true, method);
      assert.equal(editor.normalizeValues({ ...values, [key]: 'log' })[key], 'linear');
    }
    assert.doesNotThrow(() => prepare(selected, rec));
  }
});

test('changing X bins refreshes Log availability and replaces an invalid pinned scale', () => {
  const data = Array.from({ length: 20 }, (_, i) => ({ X: i + 1, Y: i + 5 }));
  const { selected, definitions } = setup({ x: 'X', y: 'Y' }, data);
  const rec = definitions.find(r => r.method === 'createLinePlot'), editor = initialParameters(rec);
  const values = { ...defaultValues(rec), bins: 24, xScale: 'log' };
  const control = input => activeControls(editor.resolveControls(input), input).find(c => c.key === 'xScale');
  assert.equal(control(values).choices.find(c => c.value === 'log').disabled, false);
  assert.doesNotThrow(() => prepare(selected, rec, values));
  const coarse = { ...values, bins: 2 };
  assert.equal(control(coarse).choices.find(c => c.value === 'log').disabled, true);
  const normalized = editor.normalizeValues(coarse, 'bins');
  assert.equal(normalized.xScale, 'linear');
  assert.doesNotThrow(() => prepare(selected, rec, normalized));
});

test('native scale/palette choices render for Cartesian, distribution, binned, and radial chart construction', () => {
  const cases = [
    [{ x: 'X', y: 'Y', color: 'Group' }, ['createLinePlot', 'createBarPlot', 'createAreaPlot', 'createRegressionPlot']],
    [{ x: 'Group', y: 'Y', color: 'Group' }, ['createBoxPlot', 'createViolinPlot', 'createGradientPlot', 'createStripPlot', 'createBeeswarmPlot', 'createRaincloudPlot', 'createPiePlot', 'createRosePlot', 'createRadialBarPlot']],
    [{ x: 'X', y: 'Y' }, ['createHeatmap']],
    [{ x: 'X', color: 'Group' }, ['createHistogram', 'createDensityPlot']],
  ];
  for (const [selection, methods] of cases) {
    const { selected, definitions } = setup(selection);
    for (const method of methods) {
      const rec = definitions.find(r => r.method === method); assert.ok(rec, method);
      if (selection.color) assert.ok(rec.controls.some(c => c.key === 'palette'), `${method} honors selected Color`);
      const defaults = defaultValues(rec);
      for (const control of rec.controls.filter(c => c.section === 'scales')) {
        const choices = control.key === 'palette' ? control.choices.filter(c => c.featured).slice(0, 2) : control.choices.filter(c => !c.disabled);
        for (const choice of choices) {
          const prepared = prepare(selected, rec, { ...defaults, [control.key]: choice.value });
          assert.equal(prepared.recommendation.validation.topLevelActions, 1);
          assert.ok(renderToSVG(prepared.preview).startsWith('<svg'), `${method} ${control.key} ${choice.value}`);
        }
      }
    }
  }
});
