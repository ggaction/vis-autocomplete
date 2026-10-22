import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { profileDataset } from '../src/profile.js';
import { applyRecommendation } from '../src/engine.js';
import { selectionData } from '../web/selection-setup.js';
import { prepareGuidedAction, addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';
import { binnedFieldSetup } from '../src/plot-aggregation.js';
import { initialParameters, activeControls } from '../web/parameters.js';

const rows = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
const engine = createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url))));
const base = rows => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows });
const methods = ['createScatterPlot', 'createRegressionPlot', 'createTextPlot', 'createLinePlot', 'createAreaPlot', 'createBarPlot', 'createHeatmap', 'createParallelCoordinates', 'createPolarScatterPlot', 'createPolarLinePlot'].sort();
const selection = { x: 'Miles_per_Gallon', y: 'Horsepower', color: 'Year' };
const recommend = (data, chosen) => {
  const program = base(data), profile = profileDataset(program, 'dataset');
  const selected = selectionData(program, profile, data, chosen);
  return { program, selected, result: engine.recommend(data, { ...profile, id: selected.data }, { selection: chosen }) };
};
const prepare = (selected, rec, values = rec.values) => prepareGuidedAction(selected.program,
  { method: rec.method, args: rec.build(values) }, selected.program, rec.setup(values));

test('Miles_per_Gallon × Horsepower × Year offers ten native chart types with replayable dates and unchanged source', () => {
  const { program, selected, result } = recommend(rows, selection), before = JSON.stringify(program.semanticSpec);
  assert.deepEqual(result.recommendations.map(r => r.method).sort(), methods);
  assert.deepEqual(result.selectedFields, Object.values(selection));
  for (const rec of result.recommendations) {
    const prepared = prepare(selected, rec);
    const applied = addDefaultGuides(applyRecommendation(prepared.actionBase, prepared.recommendation), prepared.guideCall);
    assert.deepEqual(applied.graphicSpec, prepared.preview.graphicSpec, rec.method);
    assert.equal(prepared.recommendation.validation.topLevelActions, 1);
    assert.ok(renderToSVG(applied).startsWith('<svg'));
    const editor = initialParameters(rec), values = editor.normalizeValues(rec.values);
    assert.ok(activeControls(editor.resolveControls(values), values).filter(c => c.section !== 'scales').length <= 4, rec.method);
    assert.ok(editor.resolveControls(values).filter(c => c.key === 'scales').length <= 1, 'initial scales share one compact group');
    assert.deepEqual(applied.semanticSpec.datasets.find(d => d.id === 'dataset').values, rows);
    if (rec.colorBinField) {
      assert.ok(rec.setup(rec.values).some(c => c.method === 'createComputedData' && c.args.expression.op === 'parseTime'));
      const encoding = applied.semanticSpec.layers.find(l => l.id === 'plot').encoding.color;
      assert.equal(encoding.fieldType, 'ordinal');
      const domain = applied.resolvedScales[encoding.scale].domain;
      assert.ok(domain.every(label => /\[\d{4}-\d\d-\d\d/.test(label)), 'human-readable UTC intervals');
    }
  }
  assert.equal(JSON.stringify(program.semanticSpec), before);
  assert.equal(result.diagnostics.chartEligibility.length, 29);
  assert.equal(result.diagnostics.chartEligibility.filter(d => d.eligible).length, methods.length);
  assert.ok(result.diagnostics.chartEligibility.filter(d => !d.eligible).every(d => d.reason));
});

test('temporal Color support depends on values and type, not on a Year field name or Cars-specific columns', () => {
  const data = rows.map(row => ({ fuel: row.Miles_per_Gallon, power: row.Horsepower, published: row.Year }));
  const { selected, result } = recommend(data, { x: 'fuel', y: 'power', color: 'published' });
  assert.deepEqual(result.recommendations.map(r => r.method).sort(), methods);
  for (const rec of result.recommendations) assert.doesNotThrow(() => prepare(selected, rec), rec.method);
});

test('full datetime, timezone offsets and dates before the epoch share the same continuous Color adapter', () => {
  for (const start of [Date.UTC(1900, 0, 1, 12), Date.UTC(2020, 5, 1, 12)]) {
    const data = Array.from({ length: 48 }, (_, i) => ({ X: i % 8, Y: 5 + i % 13,
      Date: new Date(start + i * 60_000).toISOString().replace('Z', '+00:00') }));
    const { selected, result } = recommend(data, { x: 'X', y: 'Y', color: 'Date' });
    assert.deepEqual(result.recommendations.map(r => r.method).sort(), methods);
    for (const rec of result.recommendations) assert.doesNotThrow(() => prepare(selected, rec), `${rec.method} ${start}`);
  }
});

test('date interval controls keep every filtered row and handle reserved source columns and the final boundary', () => {
  const data = rows.map(row => ({ ...row, 'Year (timestamp)': 'original timestamp column', 'Year (color bin)': 'original bin column' }));
  const { selected, result } = recommend(data, selection);
  for (const rec of result.recommendations.filter(r => r.colorBinField)) for (const colorBins of [2, 6]) {
    const values = { ...rec.values, colorBins }, prepared = prepare(selected, rec, values);
    const output = prepared.preview.semanticSpec.datasets.find(d => d.id === rec.setup(values).find(c => c.method === 'createComputedData' && c.args.as === rec.colorBinField).args.id);
    const source = prepared.preview.semanticSpec.datasets.find(d => d.id === selected.data);
    assert.equal(output.values.length, source.values.length);
    assert.ok(output.values.every(row => row['Year (timestamp)'] === 'original timestamp column' && row['Year (color bin)'] === 'original bin column'));
    const domain = rec.build(values).color.scale.domain;
    assert.ok(output.values.some(row => row[rec.colorBinField] === domain.at(-1)), 'last closed interval contains the maximum date');
    assert.ok(new Set(output.values.map(row => row[rec.colorBinField])).size <= colorBins);
  }
});

test('time interval labels preserve membership at fractional millisecond boundaries', () => {
  const start = Date.UTC(2020, 0, 1);
  const data = Array.from({ length: 11 }, (_, i) => ({ Date: new Date(start + i).toISOString() }));
  const plan = binnedFieldSetup({ source: 'dataset', rows: data, field: 'Date', as: 'interval', role: 'color', type: 'temporal' })(3);
  const p = plan.calls.reduce((p, call) => p[call.method](call.args), base(data));
  const output = p.semanticSpec.datasets.find(d => d.id === plan.data).values;
  assert.equal(output[3].interval, plan.domain[0]);
  assert.equal(output[4].interval, plan.domain[1]);
  assert.match(plan.domain[0], /\.004Z\)$/);
  assert.match(plan.domain[1], /\.004Z,.*\.007Z\)$/);
  assert.equal(output[10].interval, plan.domain.at(-1));
});

test('temporal heatmap aggregates timestamps per cell and explicitly keeps millisecond values as timestamps', () => {
  const data = [{ X: 0, Y: 0, Date: '1970-01-01T00:00:01.000Z' },
    { X: .2, Y: .2, Date: '1970-01-01T00:00:03.000Z' }, { X: 2, Y: 2, Date: '1970-01-01T00:00:10.000Z' }];
  const { selected, result } = recommend(data, { x: 'X', y: 'Y', color: 'Date' });
  const rec = result.recommendations.find(r => r.method === 'createHeatmap');
  assert.ok(rec);
  assert.equal(rec.controls.find(c => c.key === 'aggregate').choices.some(c => c.value === 'sum'), false);
  for (const [aggregate, expected] of [['mean', 2000], ['median', 2000], ['min', 1000], ['max', 3000]]) {
    const values = { ...rec.values, bins: 2, aggregate }, args = rec.build(values), prepared = prepare(selected, rec, values);
    const summary = prepared.preview.semanticSpec.datasets.find(d => d.id === 'dataset-plot-summary');
    assert.equal(summary.values[0].Date, expected);
    assert.equal(args.color.temporalUnit, 'timestamp');
    const color = prepared.preview.semanticSpec.layers.find(l => l.id === 'plot').encoding.color;
    assert.equal(color.fieldType, 'temporal');
    assert.equal(color.temporalUnit, 'timestamp');
    assert.ok(prepared.preview.resolvedScales[color.scale].domain.every(v => v < 20000), 'seconds after epoch must not become calendar years');
  }
});

test('categorical grids summarize both numeric and temporal Color rather than overlaying one rect per observation', () => {
  const source = [{ X: 'A', Y: 'B', N: 2, Date: '2020-01-01' }, { X: 'A', Y: 'B', N: 6, Date: '2020-01-03' },
    { X: 'C', Y: 'D', N: 10, Date: '2020-01-10' }];
  for (const [color, expected] of [['N', 4], ['Date', Date.parse('2020-01-02')]]) {
    const { selected, result } = recommend(source, { x: 'X', y: 'Y', color });
    const rec = result.recommendations.find(r => r.method === 'createHeatmap'), prepared = prepare(selected, rec);
    const summary = prepared.preview.semanticSpec.datasets.find(d => d.id === 'dataset-plot-summary');
    assert.equal(summary.values.length, 2);
    assert.equal(summary.values[0][color], expected);
  }
});

test('a sparse color group does not erase valid paths or an all-observation regression fit', () => {
  const source = [{ X: 1, Y: 2, C: 'A' }, { X: 2, Y: 4, C: 'A' }, { X: 3, Y: 5, C: 'A' }, { X: 4, Y: 6, C: 'B' }];
  const { selected, result } = recommend(source, { x: 'X', y: 'Y', color: 'C' });
  for (const method of ['createLinePlot', 'createAreaPlot', 'createRegressionPlot']) {
    const rec = result.recommendations.find(r => r.method === method);
    assert.ok(rec, method);
    assert.doesNotThrow(() => prepare(selected, rec), method);
    if (method === 'createRegressionPlot') {
      assert.equal(rec.values.fit, 'all'); assert.equal(rec.build(rec.values).groupBy, false);
      assert.equal(rec.controls.find(c => c.key === 'fit').choices.find(c => c.value === 'group').disabled, true);
    }
  }
});
