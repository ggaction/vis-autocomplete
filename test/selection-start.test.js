import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { profileDataset, createInitialChartRecommender, createRecommendationEngine, applyRecommendation } from '../src/index.js';
import { projectSelection } from '../src/selected-plots.js';
import { selectionAxes, selectionData } from '../web/selection-setup.js';
import { prepareGuidedAction, defaultCanvasOptions, addDefaultGuides } from '../web/plot-setup.js';
import { programCode, codeCallBlocks } from '../web/code-view.js';
import { deriveLineSeries } from '../vendor/ggaction/src/grammar/lineSeries.js';
import { initialParameters, activeControls } from '../web/parameters.js';

const rows = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
const model = JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url)));
const engine = createInitialChartRecommender(model);
const base = data => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: data });
const selection = { x: 'Horsepower', y: 'Miles_per_Gallon', color: '' };

test('initial and partially selected previews are genuine standalone axes with no marks', () => {
  const p = base(rows), profile = profileDataset(p, 'dataset'), before = JSON.stringify(p);
  for (const chosen of [{}, { x: 'Horsepower' }, selection,
    { x: 'Origin', y: 'Year', color: 'Cylinders' }, { x: 'Horsepower', y: 'Year' },
    { x: 'Name', y: 'Miles_per_Gallon' }]) {
    const axes = selectionAxes(p, profile, rows, chosen);
    assert.equal(axes.program.semanticSpec.layers.length, 0);
    assert.deepEqual(Object.keys(axes.program.semanticSpec.guides.axis).sort(), ['x', 'y']);
    assert.deepEqual(axes.program.semanticSpec.datasets[0].values, rows);
    const replay = axes.calls.reduce((program, call) => program[call.method](call.args), p);
    assert.deepEqual(replay.graphicSpec, axes.program.graphicSpec);
    assert.ok(renderToSVG(axes.program).startsWith('<svg'));
    for (const channel of ['x', 'y']) {
      const field = chosen[channel];
      if (field) assert.equal(axes.program.semanticSpec.guides.axis[channel].title, field);
      else assert.equal(axes.program.graphicSpec.objects[`${channel}AxisLabels`], undefined);
      if (field === 'Year') assert.ok(!Object.hasOwn(axes.calls.find(call => call.method === 'createScale' &&
        call.args.id === `selection-${channel}`).args, 'zero'));
    }
  }
  assert.equal(JSON.stringify(p), before);
});

test('selection projection includes only requested columns while preserving original rows and nulls', () => {
  const profile = profileDataset(base(rows), 'dataset');
  const projected = projectSelection(rows, profile, { ...selection, color: 'Origin' });
  assert.deepEqual(projected.fields, ['Horsepower', 'Miles_per_Gallon', 'Origin']);
  assert.equal(projected.rows.length, 406);
  assert.equal(projected.rows.filter(row => row.Horsepower === null).length, 6);
  assert.ok(projected.rows.every(row => Object.keys(row).length === 3));
  assert.equal(projectSelection(rows, profile, { ...selection, color: selection.x }).fields.length, 2);
  assert.deepEqual(projectSelection(rows, profile, { x: selection.x }).fields, [selection.x]);
  assert.throws(() => projectSelection(rows, profile, {}), /Select an X/);
  assert.throws(() => projectSelection(rows, profile, { ...selection, y: selection.x }), /different/);
  assert.throws(() => projectSelection(rows, profile, { ...selection, color: 'invented' }), /usable/);
});

test('unselected columns cannot affect initial chart ranking, neighbors or fixed encoding arguments', () => {
  const changed = rows.map((row, i) => ({ ...row, Name: `unrelated ${i}`, Weight_in_lbs: -i * 100000,
    Acceleration: null, unrelated: i % 3, extraDate: `2020-01-${String(i % 28 + 1).padStart(2, '0')}` }));
  for (const color of ['', 'Origin', 'Displacement']) {
    const chosen = { ...selection, color };
    const a = engine.recommend(rows, profileDataset(base(rows), 'dataset'), { selection: chosen });
    const b = engine.recommend(changed, profileDataset(base(changed), 'dataset'), { selection: chosen });
    assert.deepEqual(a.query.vector, b.query.vector);
    assert.deepEqual(a.neighbors, b.neighbors);
    assert.deepEqual(a.query.fields.map(field => field.name).sort(), a.selectedFields.toSorted());
    assert.deepEqual(a.recommendations.map(r => [r.method, r.score, r.build(r.values)]),
      b.recommendations.map(r => [r.method, r.score, r.build(r.values)]));
    assert.ok(a.recommendations.every(r => activeControls(initialParameters(r).controls, r.values).filter(c => c.section !== 'scales').length <= 4 &&
      !r.controls.some(control => ['x', 'y', 'category', 'value', 'color'].includes(control.key))));
    assert.deepEqual(a.recommendations.map(r => r.setup(r.values)), b.recommendations.map(r => r.setup(r.values)));
    for (const r of a.recommendations) if (color) assert.equal(r.build(r.values).color.field, r.colorBinField ?? color);
    if (color === 'Origin') assert.ok(!a.recommendations.some(r => r.method === 'createHeatmap'));
    else assert.ok(a.recommendations.some(r => r.method === 'createHeatmap'));
  }
});

test('complete-case chart setup uses explicit native filters and keeps the full source CSV intact', () => {
  const p = base(rows), profile = profileDataset(p, 'dataset');
  const setup = selectionData(p, profile, rows, selection);
  assert.deepEqual(setup.calls.map(call => call.method), ['filterData', 'filterData']);
  assert.equal(setup.program.semanticSpec.datasets.find(d => d.id === 'dataset').values.length, 406);
  assert.equal(setup.program.semanticSpec.datasets.find(d => d.id === setup.data).values.length, 392);
  const result = engine.recommend(rows, { ...profile, id: setup.data }, { selection });
  assert.equal(result.query.rowCount, 406);
  assert.deepEqual(setup.calls.reduce((program, call) => program[call.method](call.args), p).semanticSpec, setup.program.semanticSpec);
});

test('every selected-variable plot renders and Apply matches preview using one native plot action', () => {
  const p = base(rows), profile = profileDataset(p, 'dataset');
  for (const chosen of [selection, { ...selection, color: 'Origin' }, { ...selection, color: 'Acceleration' },
    { x: 'Origin', y: 'Miles_per_Gallon', color: '' }, { x: 'Miles_per_Gallon', y: 'Origin', color: '' },
    { x: 'Year', y: 'Miles_per_Gallon', color: 'Origin' },
    { x: 'Horsepower', y: 'Year', color: '' },
    { x: 'Origin', y: 'Cylinders', color: 'Origin' },
    { x: 'Origin', y: 'Name', color: 'Horsepower' }]) {
    const setup = selectionData(p, profile, rows, chosen);
    const result = engine.recommend(rows, { ...profile, id: setup.data }, { selection: chosen });
    assert.ok(result.recommendations.length, JSON.stringify(chosen));
    for (const rec of result.recommendations) {
      const args = rec.build(rec.values);
      let prepared;
      try { prepared = prepareGuidedAction(setup.program, { method: rec.method, args }, setup.program, rec.setup(rec.values)); }
      catch (error) { throw new Error(`${rec.method} ${JSON.stringify(chosen)}: ${error.message}`); }
      assert.equal(prepared.recommendation.validation.topLevelActions, 1);
      const applied = applyRecommendation(prepared.actionBase, prepared.recommendation);
      const committed = addDefaultGuides(applied, prepared.guideCall);
      assert.deepEqual(committed.graphicSpec, prepared.preview.graphicSpec);
      assert.ok(renderToSVG(committed).startsWith('<svg'));
      assert.equal(args.data, rec.setup(rec.values).at(-1)?.args.id ?? setup.data);
      if (['createPolarScatterPlot', 'createPolarLinePlot'].includes(rec.method)) {
        assert.equal(args.theta, chosen.x); assert.equal(args.radius, chosen.y); continue;
      }
      if (['createParallelCoordinates', 'createRadarPlot'].includes(rec.method)) {
        assert.ok((args.dimensions ?? args.wide.fields).includes(chosen.x));
        assert.ok((args.dimensions ?? args.wide.fields).includes(chosen.y)); continue;
      }
      if (['createPiePlot', 'createRosePlot', 'createRadialBarPlot', 'createDumbbellPlot'].includes(rec.method)) {
        assert.ok([chosen.x, chosen.y].includes(args.category));
        assert.ok([chosen.x, chosen.y].includes(args.value?.field ?? args.start?.field ?? args.value ?? args.start)); continue;
      }
      assert.equal(args.x?.field ?? (typeof args.x === 'string' ? args.x : undefined) ??
        (args.orientation === 'horizontal' ? args.value?.field ?? args.value : args.category), rec.binField ?? chosen.x);
      assert.equal(args.y?.field ?? (typeof args.y === 'string' ? args.y : undefined) ??
        (args.orientation === 'horizontal' ? args.category : args.value?.field ?? args.value), rec.yBinField ?? chosen.y);
    }
  }
});

test('after the initial plot the existing action engine still sees all source variables', () => {
  const p = base(rows), profile = profileDataset(p, 'dataset');
  const setup = selectionData(p, profile, rows, selection);
  const rec = engine.recommend(rows, { ...profile, id: setup.data }, { selection }).recommendations.find(r => r.method === 'createScatterPlot');
  const prepared = prepareGuidedAction(setup.program, { method: rec.method, args: rec.build(rec.values) });
  const actionEngine = createRecommendationEngine(JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url))));
  const next = actionEngine.recommend(prepared.preview, { target: 'plot', limit: 100, includeRevisions: true });
  assert.ok(next.recommendations.length >= 5);
  assert.equal(profileDataset(prepared.preview, setup.data).fields.length, 9);
});

test('uploaded-style categorical color groups and temporal color choices only produce native-compatible chart calls', () => {
  const data = Array.from({ length: 48 }, (_, i) => ({ Group: ['A', 'B', 'C'][i % 3],
    Value: 5 + i * 7 % 17, Series: i % 2 ? 'One' : 'Two',
    When: `2020-${String(Math.floor(i / 4) + 1).padStart(2, '0')}-01` }));
  const p = base(data), profile = profileDataset(p, 'dataset');
  for (const chosen of [{ x: 'Group', y: 'Value', color: 'Series' }, { x: 'Value', y: 'Group', color: 'Series' },
    { x: 'Group', y: 'Value', color: 'When' }, { x: 'When', y: 'Value', color: '' }]) {
    const setup = selectionData(p, profile, data, chosen);
    const result = engine.recommend(data, { ...profile, id: setup.data }, { selection: chosen });
    assert.ok(result.recommendations.length);
    for (const rec of result.recommendations) {
      const args = rec.build(rec.values);
      const prepared = prepareGuidedAction(setup.program, { method: rec.method, args }, setup.program, rec.setup(rec.values));
      assert.equal(prepared.recommendation.validation.topLevelActions, 1);
      if (chosen.color) assert.equal(args.color.field, rec.colorBinField ?? chosen.color);
    }
  }
});

test('area and horizon bin nearby distinct X positions and aggregate Y per Color with replayable native calls', () => {
  const data = [{ X: 1, Y: 2, C: 'A' }, { X: 1.1, Y: 6, C: 'A' }, { X: 1.2, Y: 16, C: 'A' },
    { X: 9, Y: 8, C: 'A' }, { X: 9.2, Y: 10, C: 'A' },
    { X: 1, Y: 10, C: 'B' }, { X: 1.2, Y: 14, C: 'B' },
    { X: 9, Y: 20, C: 'B' }, { X: 9.2, Y: 24, C: 'B' }];
  const p = base(data), original = JSON.stringify(p), profile = profileDataset(p, 'dataset');
  for (const color of ['', 'C']) {
    const result = engine.recommend(data, profile, { selection: { x: 'X', y: 'Y', color } });
    for (const method of ['createAreaPlot', ...(!color ? ['createHorizonPlot'] : [])]) {
      const rec = result.recommendations.find(r => r.method === method);
      assert.ok(rec, method);
      assert.equal(rec.values.aggregate, 'mean');
      assert.equal(rec.values.bins, 10);
      assert.ok(rec.controls.some(c => c.key === 'bins'));
      assert.ok(rec.controls.filter(c => c.section !== 'scales').length <= 3);
      const expected = color ? { mean: 8, median: 6, sum: 24, min: 2, max: 16 }
        : { mean: 9.6, median: 10, sum: 48, min: 2, max: 16 };
      for (const aggregate of rec.controls.find(c => c.key === 'aggregate').choices.map(c => c.value)) {
        const values = { ...rec.values, bins: 2, aggregate }, args = rec.build(values), calls = rec.setup(values);
        const prepared = prepareGuidedAction(p, { method, args }, p, calls);
        const summary = prepared.actionBase.semanticSpec.datasets.find(d => d.id === (method === 'createAreaPlot' && color ? args.data.replace(/-aligned$/, '') : args.data));
        assert.equal(summary.values.length, color ? 4 : 2);
        assert.equal(summary.values.find(row => row[rec.binField] === 2.5 && (!color || row.C === 'A')).Y, expected[aggregate]);
        assert.deepEqual(summary.transform[0].groupBy, color ? [rec.binField, 'C'] : [rec.binField]);
        assert.deepEqual(calls.map(c => c.method), ['createBinData', 'createComputedData', 'createSummaryData', ...(method === 'createAreaPlot' && color ? ['createCompleteData'] : [])]);
        const line = result.recommendations.find(r => r.method === 'createLinePlot');
        const lineProgram = prepareGuidedAction(p, { method: line.method, args: line.build(values) }).preview;
        const series = deriveLineSeries(data, lineProgram.semanticSpec.layers.find(l => l.id === 'plot'));
        const vertices = series.series.flatMap(s => s.values.map(v => ({ ...s.key, x: v.x, y: v.y })));
        for (const row of summary.values) assert.equal(vertices.find(v => v.x === row[rec.binField] &&
          (!color || v.C === row.C)).y, row.Y, 'all plot families must share native line binning and aggregates');
        assert.equal(prepared.recommendation.validation.topLevelActions, 1);
        const applied = addDefaultGuides(applyRecommendation(prepared.actionBase, prepared.recommendation), prepared.guideCall);
        assert.deepEqual(applied.graphicSpec, prepared.preview.graphicSpec);
        const replay = [...calls, { method, args }, prepared.guideCall].reduce((q, call) => q[call.method](call.args), p);
        assert.deepEqual(replay.graphicSpec, prepared.preview.graphicSpec);
        assert.ok(renderToSVG(replay).startsWith('<svg'));
        if (method === 'createAreaPlot' && aggregate === 'sum') {
          const before = programCode([]), after = programCode([...calls, { method, args }, prepared.guideCall]);
          const added = codeCallBlocks(before, after).calls.filter(c => c.change === 'added');
          assert.ok(added.find(c => c.method === 'createSummaryData').lines.join('\n').includes('"op": "sum"'));
        }
      }
    }
    const scatter = result.recommendations.find(r => r.method === 'createScatterPlot');
    assert.deepEqual(scatter.setup(scatter.values), []);
    assert.equal(scatter.build(scatter.values).data, 'dataset');
  }
  assert.equal(JSON.stringify(p), original, 'hovered aggregates cannot mutate source data or the current program');
});

test('categorical and horizontal bars aggregate the selected measure while scatter and distributions keep observations', () => {
  const data = [{ Group: 'A', Value: 2 }, { Group: 'A', Value: 6 }, { Group: 'B', Value: 10 }, { Group: 'B', Value: 14 }];
  const p = base(data), profile = profileDataset(p, 'dataset');
  for (const horizontal of [false, true]) {
    const selection = { x: horizontal ? 'Value' : 'Group', y: horizontal ? 'Group' : 'Value', color: '' };
    const result = engine.recommend(data, profile, { selection });
    const rec = result.recommendations.find(r => r.method === 'createBarPlot');
    const measureChannel = horizontal ? 'x' : 'y';
    for (const aggregate of ['mean', 'median', 'sum', 'min', 'max']) {
      const args = rec.build({ ...rec.values, aggregate });
      const prepared = prepareGuidedAction(p, { method: rec.method, args });
      assert.equal(prepared.preview.semanticSpec.layers[0].encoding[measureChannel].aggregate, aggregate);
      assert.equal(prepared.preview.graphicSpec.objects.plot.items.length, 2);
    }
    for (const rec of result.recommendations.filter(r => ['createScatterPlot', 'createBoxPlot', 'createViolinPlot'].includes(r.method))) {
      assert.deepEqual(rec.setup(rec.values), []);
      assert.equal(rec.build(rec.values).data, 'dataset');
    }
  }
});

test('numeric-X line uses native X bins and Y aggregation, including separate Color series', () => {
  const data = [{ X: 1, Y: 2, C: 'A' }, { X: 1.1, Y: 6, C: 'A' }, { X: 1.2, Y: 16, C: 'A' },
    { X: 9, Y: 8, C: 'A' }, { X: 1, Y: 10, C: 'B' }, { X: 1.2, Y: 14, C: 'B' }, { X: 9, Y: 20, C: 'B' }];
  const p = base(data), profile = profileDataset(p, 'dataset'), before = JSON.stringify(p);
  const rec = engine.recommend(data, profile, { selection: { x: 'X', y: 'Y', color: 'C' } })
    .recommendations.find(r => r.method === 'createLinePlot');
  assert.deepEqual(rec.controls.filter(c => c.section !== 'scales').map(c => c.key), ['bins', 'aggregate']);
  assert.equal(rec.values.bins, 10);
  assert.equal(rec.values.aggregate, 'mean');
  assert.deepEqual(rec.setup(rec.values), []);
  for (const [aggregate, expected] of Object.entries({ mean: 8, median: 6, sum: 24, min: 2, max: 16 })) {
    const args = rec.build({ ...rec.values, bins: 2, aggregate });
    assert.deepEqual(args.x.bin, { maxBins: 2 });
    assert.equal(args.y.aggregate, aggregate);
    assert.equal(args.data, 'dataset');
    const prepared = prepareGuidedAction(p, { method: rec.method, args });
    const layer = prepared.preview.semanticSpec.layers.find(l => l.id === 'plot');
    const derived = deriveLineSeries(data, layer);
    assert.equal(derived.series.length, 2);
    const a = derived.series.find(series => series.key.C === 'A');
    assert.equal(a.values.length, 2, 'nearby distinct X observations must merge into bins');
    assert.equal(a.values[0].y, expected);
    assert.equal(a.values[1].y, 8);
    assert.equal(prepared.recommendation.validation.topLevelActions, 1);
    assert.deepEqual(prepared.prerequisiteCalls, []);
    const applied = addDefaultGuides(applyRecommendation(p, prepared.recommendation), prepared.guideCall);
    assert.deepEqual(applied.graphicSpec, prepared.preview.graphicSpec);
  }
  assert.equal(JSON.stringify(p), before);
});

test('all binned plot families honor negative boundaries, the final closed bin and derived field collisions', () => {
  const data = [-10, -5, 0, 5, 10].map((X, i) => ({ X, Y: (i + 1) * 2, 'X (bin)': `original-${i}` }));
  const p = base(data), profile = profileDataset(p, 'dataset');
  const recs = engine.recommend(data, profile, { selection: { x: 'X', y: 'Y', color: '' } }).recommendations;
  for (const rec of recs.filter(r => r.controls.some(c => c.key === 'bins') && r.method !== 'createHeatmap')) {
    const v = { ...rec.values, bins: 2 }, args = rec.build(v);
    const prepared = prepareGuidedAction(p, { method: rec.method, args }, p, rec.setup(v));
    if (!rec.binField) continue;
    assert.notEqual(rec.binField, 'X (bin)');
    const summary = prepared.preview.semanticSpec.datasets.find(d => d.id === args.data);
    assert.deepEqual(summary.values, [{ [rec.binField]: -5, Y: 3 }, { [rec.binField]: 5, Y: 8 }]);
    const binned = prepared.preview.semanticSpec.datasets.find(d => d.id === 'dataset-binned-rows');
    assert.deepEqual(binned.values.map(row => row.X), [-10, -5, 0, 5, 10]);
    assert.deepEqual(binned.values.map(row => row['X (bin)']), data.map(row => row['X (bin)']));
  }
});

test('changing bin count changes actual data grain for every related plot, including the full slider range', () => {
  const p = base(rows), profile = profileDataset(p, 'dataset');
  for (const color of ['', 'Origin']) {
    const chosen = { ...selection, color }, setup = selectionData(p, profile, rows, chosen);
    const recs = engine.recommend(rows, { ...profile, id: setup.data }, { selection: chosen }).recommendations;
    for (const rec of recs.filter(r => r.controls.some(c => c.key === 'bins'))) {
      if (rec.method === 'createHeatmap') continue;
      const grains = [];
      for (const bins of [2, 5, 10, 24]) {
        const v = { ...rec.values, bins }, args = rec.build(v);
        const prepared = prepareGuidedAction(setup.program, { method: rec.method, args }, setup.program, rec.setup(v));
        assert.ok(renderToSVG(prepared.preview).startsWith('<svg'));
        if (rec.binField) grains.push(prepared.preview.semanticSpec.datasets.find(d => d.id === args.data).values.length);
      }
      if (rec.binField) assert.ok(grains[0] < grains.at(-1), `${rec.method} must actually recompute bins`);
    }
  }
});

test('regression switches between actual Color-group models and one pooled model without aggregating points', () => {
  const p = base(rows), profile = profileDataset(p, 'dataset'), chosen = { ...selection, color: 'Origin' };
  const setup = selectionData(p, profile, rows, chosen);
  const rec = engine.recommend(rows, { ...profile, id: setup.data }, { selection: chosen }).recommendations.find(r => r.method === 'createRegressionPlot');
  assert.deepEqual(activeControls(initialParameters(rec).controls, rec.values).filter(c => c.section !== 'scales').map(c => c.key), ['method', 'fit', 'interval']);
  assert.ok(rec.controls.some(c => c.key === 'degree'));
  assert.ok(rec.controls.some(c => c.key === 'span'));
  assert.equal(rec.values.fit, 'group');
  for (const method of rec.controls.find(c => c.key === 'method').choices.map(c => c.value)) {
    for (const fit of ['group', 'all']) {
      const args = rec.build({ ...rec.values, method, fit });
      const prepared = prepareGuidedAction(setup.program, { method: rec.method, args });
      const config = prepared.preview.markConfigs.plot.regression;
      assert.equal(config.groupBy, fit === 'group' ? 'Origin' : undefined);
      assert.equal(prepared.preview.semanticSpec.layers.find(l => l.id === 'plot').data, setup.data);
      assert.equal(prepared.preview.semanticSpec.datasets.find(d => d.id === setup.data).values.length, 392);
      const derived = prepared.preview.semanticSpec.datasets.find(d => d.id === config.dataId);
      assert.equal(new Set(derived.values.map(row => row.Origin)).size, fit === 'group' ? 3 : 1);
      assert.equal(prepared.recommendation.validation.topLevelActions, 1);
    }
  }
});

test('numeric-X bars retain native bin intervals and expose all Color layouts through one plot call', () => {
  const data = [{ X: 1, Y: 2, C: 'A' }, { X: 1.1, Y: 6, C: 'A' }, { X: 1.2, Y: 16, C: 'A' },
    { X: 9, Y: 8, C: 'A' }, { X: 9.2, Y: 10, C: 'A' },
    { X: 1, Y: 10, C: 'B' }, { X: 1.2, Y: 14, C: 'B' }, { X: 9, Y: 22, C: 'B' }];
  const p = base(data), profile = profileDataset(p, 'dataset');
  for (const color of ['', 'C']) {
    const rec = engine.recommend(data, profile, { selection: { x: 'X', y: 'Y', color } })
      .recommendations.find(r => r.method === 'createBarPlot');
    assert.deepEqual(rec.controls.filter(c => c.section !== 'scales').map(c => c.key), color ? ['bins', 'aggregate', 'layout'] : ['bins', 'aggregate']);
    assert.deepEqual(rec.setup(rec.values), []);
    for (const aggregate of ['mean', 'median', 'sum', 'min', 'max']) {
      for (const layout of color ? ['overlay', 'stack', 'fill', 'group'] : ['overlay']) {
        const args = rec.build({ bins: 2, aggregate, layout });
        assert.deepEqual(args.x.bin, { maxBins: 2 });
        assert.equal(args.y.aggregate, aggregate);
        assert.equal(args.data, 'dataset');
        const prepared = prepareGuidedAction(p, { method: rec.method, args });
        const q = prepared.preview, layer = q.semanticSpec.layers[0];
        assert.deepEqual(layer.encoding.x.bin, args.x.bin);
        assert.equal(layer.layout.mode, layout);
        assert.equal(q.semanticSpec.datasets.length, 1);
        const rectangles = q.graphicSpec.objects.plot.items.map(i => i.properties);
        const binPixels = (q.resolvedScales.x.range[1] - q.resolvedScales.x.range[0]) / 2;
        assert.ok(rectangles.every(b => Math.abs(b.width - binPixels / (layout === 'group' ? 2 : 1)) < 1e-8));
        assert.equal(prepared.recommendation.validation.topLevelActions, 1);
        const applied = addDefaultGuides(applyRecommendation(prepared.actionBase, prepared.recommendation), prepared.guideCall);
        assert.deepEqual(applied.graphicSpec, q.graphicSpec);
        if (layout === 'fill') assert.deepEqual(q.resolvedScales.y.domain, [0, 1]);
      }
    }
    if (color) {
      const q = prepareGuidedAction(p, { method: rec.method, args: rec.build({ bins: 2 }) }).preview;
      const actionEngine = createRecommendationEngine(JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url))));
      const next = actionEngine.recommend(q, { target: 'plot', limit: 100, group: 'transform' });
      const modes = next.recommendations.filter(r => r.method === 'layoutSeries').flatMap(r => r.alternatives?.mode ?? []);
      assert.ok(next.recommendations.some(r => r.method === 'layoutSeries'), JSON.stringify(modes));
    }
  }
});

test('three continuous variables offer Cartesian and polar/parallel plot types with replayable bins and unchanged source data', () => {
  const p = base(rows), profile = profileDataset(p, 'dataset'), original = JSON.stringify(p.semanticSpec);
  for (const color of ['Acceleration', 'Weight_in_lbs', 'Displacement']) {
    const chosen = { ...selection, color }, selected = selectionData(p, profile, rows, chosen);
    const result = engine.recommend(rows, { ...profile, id: selected.data }, { selection: chosen });
    assert.deepEqual(result.recommendations.map(r => r.method).sort(), [
      'createScatterPlot', 'createRegressionPlot', 'createTextPlot', 'createLinePlot',
      'createAreaPlot', 'createBarPlot', 'createHeatmap', 'createPolarScatterPlot', 'createPolarLinePlot', 'createParallelCoordinates',
    ].sort());
    assert.deepEqual(result.selectedFields, [chosen.x, chosen.y, color]);
    for (const rec of result.recommendations) {
      assert.ok(activeControls(initialParameters(rec).controls, rec.values).filter(c => c.section !== 'scales').length <= 4, rec.method);
      const args = rec.build(rec.values), calls = rec.setup(rec.values);
      const prepared = prepareGuidedAction(selected.program, { method: rec.method, args }, selected.program, calls);
      assert.equal(prepared.recommendation.validation.topLevelActions, 1);
      const applied = addDefaultGuides(applyRecommendation(prepared.actionBase, prepared.recommendation), prepared.guideCall);
      assert.deepEqual(applied.graphicSpec, prepared.preview.graphicSpec);
      assert.ok(renderToSVG(applied).startsWith('<svg'));
      const encoding = applied.semanticSpec.layers.find(l => l.id === 'plot').encoding;
      assert.equal(encoding.color.field, rec.colorBinField ?? color);
      if (rec.colorBinField) {
        assert.equal(encoding.color.fieldType, 'ordinal');
        assert.deepEqual(rec.controls.filter(c => c.section !== 'scales').map(c => c.key), rec.method === 'createPolarLinePlot' ? ['colorBins'] : ['bins', 'aggregate', 'colorBins']);
        const derived = applied.semanticSpec.datasets.find(d => d.id === rec.setup(rec.values).find(c => c.method === 'createComputedData' && c.args.as === rec.colorBinField).args.id);
        assert.ok(derived.values.length > 300);
        assert.ok(new Set(derived.values.map(r => r[rec.colorBinField])).size <= 6);
        assert.ok(derived.values.every(row => row[color] !== undefined && typeof row[rec.colorBinField] === 'string'));
      }
    }
  }
  assert.equal(JSON.stringify(p.semanticSpec), original);
});

test('numeric heatmap aggregates the selected Color per occupied XY interval, rather than counting rows', () => {
  const data = [{ X: 0, Y: 0, C: 2 }, { X: .2, Y: .2, C: 6 }, { X: 2, Y: 2, C: 10 }];
  const p = base(data), profile = profileDataset(p, 'dataset');
  const rec = engine.recommend(data, profile, { selection: { x: 'X', y: 'Y', color: 'C' } })
    .recommendations.find(r => r.method === 'createHeatmap');
  assert.ok(rec);
  for (const [aggregate, expected] of Object.entries({ mean: 4, median: 4, sum: 8, min: 2, max: 6 })) {
    const values = { ...rec.values, bins: 2, aggregate };
    const prepared = prepareGuidedAction(p, { method: rec.method, args: rec.build(values) }, p, rec.setup(values));
    const summary = prepared.preview.semanticSpec.datasets.find(d => d.id === 'dataset-plot-summary');
    assert.equal(summary.values.length, 2);
    assert.equal(summary.values[0].C, expected);
    assert.equal(summary.values[1].C, 10, 'maximum X/Y belongs to the final closed bin');
    assert.deepEqual(summary.transform[0].groupBy, [rec.binField, rec.yBinField]);
    assert.deepEqual(summary.transform[0].aggregates, [{ op: aggregate, field: 'C', as: 'C' }]);
    const replay = rec.setup(values).reduce((program, call) => program[call.method](call.args), p);
    assert.deepEqual(replay.semanticSpec.datasets, prepared.actionBase.semanticSpec.datasets);
  }
});

test('continuous Color bin controls change native groups without losing observations or colliding with source columns', () => {
  const data = Array.from({ length: 180 }, (_, i) => ({ X: i % 30, Y: i % 7 + 1, C: i - 90,
    'C (color bin)': 'original', 'X (bin)': 'original', 'Y (bin)': 'original' }));
  const p = base(data), profile = profileDataset(p, 'dataset');
  const recs = engine.recommend(data, profile, { selection: { x: 'X', y: 'Y', color: 'C' } }).recommendations;
  for (const rec of recs.filter(r => r.colorBinField)) {
    assert.notEqual(rec.colorBinField, 'C (color bin)');
    let previous;
    for (const colorBins of [2, 6]) {
      const values = { ...rec.values, colorBins }, args = rec.build(values);
      const prepared = prepareGuidedAction(p, { method: rec.method, args }, p, rec.setup(values));
      const derived = prepared.preview.semanticSpec.datasets.find(d => d.transform?.some(t => t.type === 'computed' && t.as === rec.colorBinField));
      assert.equal(derived.values.length, data.length);
      assert.deepEqual(derived.values.map(r => r.C), data.map(r => r.C));
      assert.ok(derived.values.every(r => r['C (color bin)'] === 'original'));
      const groups = new Set(derived.values.map(r => r[rec.colorBinField]));
      assert.ok(groups.has(args.color.scale.domain.at(-1)), 'maximum Color remains in the last interval');
      if (previous) assert.ok(groups.size > previous, 'more Color bins produce more series');
      previous = groups.size;
    }
  }
});
