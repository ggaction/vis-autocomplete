import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { createRecommendationEngine, profileDataset, prepareAction, configureRecommendation, applyRecommendation } from '../src/index.js';
import { getPlotDefinitions, defaultValues } from '../src/plot-catalog.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';

const rows = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const base = data => chart().createCanvas({ width: 700, height: 430,
  margin: { left: 80, right: 125, top: 42, bottom: 74 } }).applyTheme({ theme: { base: 'light', tokens: {
    fontFamily: 'Arial', axisLabelFontFamily: 'Arial', axisTitleFontFamily: 'Arial',
  } } }).createData({ id: 'dataset', values: data });
const definitions = p => getPlotDefinitions(profileDataset(p, 'dataset'));
const barGeometry = p => p.graphicSpec.objects.plot.items.map(({ properties: { x, y, width, height } }) => ({ x, y, width, height }));

test('all nine original Cars variables remain available, including nullable and nonnumeric positions', () => {
  const p = base(rows), profile = profileDataset(p, 'dataset');
  assert.equal(profile.fields.length, 9);
  assert.equal(profile.fields.filter(field => field.usable).length, 9);
  assert.equal(profile.fields.filter(field => field.type === 'quantitative').length, 6);
  const scatter = definitions(p).find(d => d.method === 'createScatterPlot');
  for (const axis of ['x', 'y']) {
    const control = scatter.controls.find(control => control.key === axis);
    assert.deepEqual(new Set(control.choices.map(choice => choice.value)), new Set(Object.keys(rows[0])));
    for (const choice of control.choices) {
      const { preview } = prepareAction(p, { method: scatter.method,
        args: scatter.build({ ...defaultValues(scatter), [axis]: choice.value }) });
      assert.equal(preview.trace.children.length, p.trace.children.length + 1);
      assert.ok(renderToSVG(preview).startsWith('<svg'), `${axis}: ${choice.value}`);
    }
  }
});

test('native missing-value handling plots 392 Cars pairs while preserving all 406 original rows', () => {
  const p = base(rows), scatter = definitions(p).find(d => d.method === 'createScatterPlot');
  const args = scatter.build({ x: 'Horsepower', y: 'Miles_per_Gallon', color: '' });
  assert.equal(args.missing, 'skip');
  const { recommendation, preview } = prepareAction(p, { method: scatter.method, args });
  assert.equal((renderToSVG(preview).match(/<circle /g) ?? []).length, 392);
  assert.deepEqual(preview.semanticSpec.datasets.find(data => data.id === 'dataset').values, rows);
  assert.deepEqual(p.semanticSpec.datasets[0].values, rows);
  assert.equal(applyRecommendation(p, recommendation).trace.children.length, p.trace.children.length + 1);
  assert.throws(() => p.createScatterPlot({ ...args, missing: 'error' }), /finite|missing/i);
  assert.throws(() => p.createScatterPlot({ ...args, missing: 'invented' }), /missing/i);
});

test('bar candidates include the X category, aggregate measures, styles, labels and sorting without filler', () => {
  const p = base(rows), bar = definitions(p).find(d => d.method === 'createBarPlot');
  const b = prepareAction(p, { method: bar.method,
    args: bar.build({ category: 'Origin', value: 'Displacement', aggregate: 'mean' }) }).preview;
  const before = JSON.stringify([b.semanticSpec, b.graphicSpec, b.trace]);
  const result = engine.recommend(b, { target: 'plot', limit: 100 });
  assert.ok(result.recommendations.length >= 5);
  for (const method of ['encodeColor', 'editBarMark', 'createMarkLabels', 'orderCategories']) {
    assert.ok(result.recommendations.some(rec => rec.method === method), method);
  }
  const color = result.recommendations.find(rec => rec.method === 'encodeColor');
  const editor = recommendationParameters(color, profileDataset(b, 'dataset'));
  const aggregation = editor.controls.find(control => control.key === 'aggregate');
  assert.equal(aggregation.when({ mode: 'variable', field: 'Origin' }), false);
  assert.equal(aggregation.when({ mode: 'variable', field: 'Miles_per_Gallon' }), true);
  assert.ok(editor.controls.find(c => c.key === 'field').choices.some(choice => choice.value === 'Origin'));
  assert.ok(editor.controls.find(c => c.key === 'field').choices.some(choice => choice.value === 'Horsepower'));
  for (const field of editor.controls.find(c => c.key === 'field').choices) {
    const call = editor.build({ ...valuesFor(editor.controls), field: field.value });
    assert.equal(call.field, field.value);
    if (profileDataset(b, 'dataset').fields.find(f => f.name === field.value).type === 'quantitative') {
      assert.equal(call.aggregate, 'mean');
    } else assert.equal(call.aggregate, undefined);
    const configured = configureRecommendation(b, color, call);
    const applied = applyRecommendation(b, configured.recommendation);
    assert.equal(applied.trace.children.length, b.trace.children.length + 1);
    if (field.value === 'Origin') assert.deepEqual(barGeometry(applied), barGeometry(b));
  }
  for (const rec of result.recommendations) {
    const next = applyRecommendation(b, rec);
    assert.ok(!engine.recommend(next, { target: 'plot', limit: 100 }).recommendations.some(r => r.feature === rec.feature), rec.method);
    assert.ok(renderToSVG(next).startsWith('<svg'));
  }
  assert.equal(JSON.stringify([b.semanticSpec, b.graphicSpec, b.trace]), before);
});

test('same-field color and bar styling work on other datasets without Cars-specific exceptions', () => {
  const p = base([{ Region: 'East', Revenue: 3 }, { Region: 'East', Revenue: 5 },
    { Region: 'West', Revenue: 8 }, { Region: 'West', Revenue: 4 }])
    .createBarPlot({ id: 'plot', x: 'Region', y: { field: 'Revenue', aggregate: 'mean' } });
  const result = engine.recommend(p, { target: 'plot', limit: 100 });
  const color = result.recommendations.find(rec => rec.method === 'encodeColor');
  assert.ok(color.alternatives.some(option => option.args.field === 'Region'));
  const editor = recommendationParameters(color, profileDataset(p, 'dataset'));
  const configured = configureRecommendation(p, color, editor.build({ ...valuesFor(editor.controls), field: 'Region' }));
  assert.deepEqual(barGeometry(configured.preview), barGeometry(p));
  assert.ok(color.alternatives.some(option => option.args.field === 'Revenue'));
  assert.ok(result.recommendations.some(rec => rec.method === 'editBarMark'));
  for (const rec of result.recommendations) {
    const count = result.state.features.length;
    assert.equal(rec.score, rec.explanation.contributions.reduce((sum, c) => sum + c.chartCount / model.chartCount, 0) / count);
  }
});
