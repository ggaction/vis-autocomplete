import { replayPrepared, assertPreparedTrace } from './support/prepared.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { createRecommendationEngine, prepareAction, configureRecommendation, applyRecommendation, profileDataset } from '../src/index.js';
import { INITIAL_PLOT_METHODS, getPlotDefinitions, defaultValues } from '../src/plot-catalog.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { cars, makeScenarios } from '../examples/scenarios.js';
import { parse } from 'acorn';
import { preferVisualFields } from '../src/profile.js';
import { programCode, codeDiff, codeCallBlocks } from '../web/code-view.js';
import { prepareStartingPlot, prepareGuidedAction, addDefaultGuides, defaultCanvasOptions } from '../web/plot-setup.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url), 'utf8'));
const engine = createRecommendationEngine(model);
const base = (rows = cars, canvas = { width: 700, height: 430,
  margin: { left: 80, right: 125, top: 42, bottom: 74 } }) => chart().createCanvas(canvas).applyTheme({ theme: { base: 'light', tokens: {
    background: '#ffffff', fontFamily: 'Arial', axisLabelFontFamily: 'Arial', axisTitleFontFamily: 'Arial',
  } } }).createData({ id: 'dataset', values: rows });

test('the UI uses all original Cars rows and retains nulls through every available starting plot', () => {
  const original = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url), 'utf8'));
  assert.equal(original.length, 406);
  assert.equal(Object.keys(original[0]).length, 9);
  assert.equal(original.filter(row => row.Horsepower === null).length, 6);
  assert.equal(original.filter(row => row.Miles_per_Gallon === null).length, 8);
  const p = base(original);
  const profile = profileDataset(p, 'dataset');
  assert.equal(profile.rowCount, 406);
  assert.equal(preferVisualFields(profile.fields.filter(f => f.usable && f.type === 'quantitative'))[0].name, 'Weight_in_lbs');
  assert.equal(preferVisualFields(profile.fields.filter(f => f.usable), 'color')[0].name, 'Origin');
  const definitions = getPlotDefinitions(profile);
  assert.equal(definitions.length, 29);
  assert.equal(definitions.filter(d => d.requirement).length, 2); // No unique X or unique radar series identity.
  for (const definition of definitions.filter(d => !d.requirement)) {
    const prepared = prepareStartingPlot(p, { method: definition.method, args: definition.build(defaultValues(definition)) });
    const { preview } = prepared; assertPreparedTrace(prepared);
    assert.deepEqual(replayPrepared(prepared).graphicSpec, preview.graphicSpec);
    assert.deepEqual(preview.semanticSpec.datasets.find(d => d.id === 'dataset').values, original);
    assert.ok(renderToSVG(preview).startsWith('<svg'), definition.method);
  }
});

test('code previews show exactly the proposed public call and preserve valid JavaScript', () => {
  const calls = [{ method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } }];
  const current = programCode(calls, 'Cars', 406);
  const proposed = programCode([...calls, { method: 'encodeColor', args: { target: 'plot', field: 'Origin' } }], 'Cars', 406);
  parse(current, { ecmaVersion: 'latest', sourceType: 'module' });
  parse(proposed, { ecmaVersion: 'latest', sourceType: 'module' });
  assert.ok(current.includes('"values": data'));
  assert.ok(!current.includes('encodeColor'));
  assert.ok(codeDiff(current, proposed).filter(line => line.change === 'added').some(line => line.text.includes('.encodeColor(')));
  assert.ok(codeDiff(current, proposed).filter(line => line.change !== 'removed').map(line => line.text).join('\n') === proposed);
  assert.ok(codeDiff(current, current).every(line => line.change === 'context'));
});

test('code disclosures keep call identities across parameter previews and highlight only the new function', () => {
  const calls = [{ method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } },
    { method: 'encodeColor', args: { target: 'plot', field: 'Origin', scale: { palette: 'viridis' } } }];
  const current = programCode(calls, 'Cars', 406);
  const nextCalls = [...calls, { method: 'encodeColor', args: { target: 'plot', field: 'Cylinders' } }];
  const first = codeCallBlocks(current, programCode(nextCalls, 'Cars', 406));
  assert.deepEqual(first.calls.map(c => c.change), ['context', 'context', 'added']);
  assert.equal(new Set(first.calls.map(c => c.key)).size, 3);
  assert.ok(first.calls[1].lines.join('\n').includes('"palette": "viridis"'));
  const second = codeCallBlocks(current, programCode([...calls,
    { method: 'encodeColor', args: { target: 'plot', field: 'Displacement' } }], 'Cars', 406));
  assert.deepEqual(first.calls.map(c => c.key), second.calls.map(c => c.key));
  assert.ok(second.calls.at(-1).lines.join('\n').includes('"field": "Displacement"'));
  assert.ok(codeCallBlocks(programCode(nextCalls, 'Cars', 406)).calls.every(c => c.change === 'context'));
});

test('all 29 starting plots execute one existing public function, render, and use Arial', () => {
  const p = base();
  const definitions = getPlotDefinitions(profileDataset(p, 'dataset'));
  assert.equal(definitions.length, INITIAL_PLOT_METHODS.length);
  for (const definition of definitions) {
    assert.equal(definition.requirement, null, definition.method);
    assert.ok(definition.controls.length > 0 && definition.controls.length <= 3);
    const { recommendation, preview } = prepareAction(p, {
      method: definition.method, args: definition.build(defaultValues(definition)),
    });
    const next = applyRecommendation(p, recommendation);
    assert.equal(next.trace.children.length, p.trace.children.length + 1, definition.method);
    assert.equal(next.trace.children.at(-1).op, definition.method);
    assert.equal(recommendation.validation.svgSerialized, true);
    const svg = renderToSVG(preview);
    assert.ok(svg.startsWith('<svg'));
    assert.ok([...svg.matchAll(/font-family="([^"]+)"/g)].every(match => match[1] === 'Arial'), definition.method);
  }
});

test('every starting plot leads to engine-ranked actions with up to four working controls', () => {
  const p = base();
  let checked = 0;
  for (const definition of getPlotDefinitions(profileDataset(p, 'dataset'))) {
    const prepared = prepareStartingPlot(p, { method: definition.method, args: definition.build(defaultValues(definition)) });
    const { preview } = prepared;
    const layers = preview.semanticSpec.layers;
    const root = layers.find(l => l.id === 'plot') ?? layers.find(l =>
      preview.semanticSpec.datasets.find(d => d.id === l.data)?.values?.length) ?? layers[0];
    const result = engine.recommend(preview, { target: root.id, group: 'encoding' });
    assert.ok(result.recommendations.length, definition.method);
    const profile = profileDataset(preview, result.state.data);
    for (const original of result.recommendations) {
      const editor = recommendationParameters(original, profile);
      assert.ok(editor.controls.filter(c => !c.when || c.when(valuesFor(editor.controls))).length <= 4, original.method);
      const { recommendation, preview: edited } = configureRecommendation(preview, original, editor.build(valuesFor(editor.controls)));
      const next = applyRecommendation(preview, recommendation);
      assert.equal(next.trace.children.length, preview.trace.children.length + 1);
      assert.equal(next.trace.children.at(-1).op, original.method);
      assert.ok(renderToSVG(edited).startsWith('<svg'));
      checked++;
    }
  }
  assert.ok(checked > 40);
});

test('default guide setup is explicit, matches the preview and leaves later recommendations single-call', () => {
  const p = base();
  const definition = getPlotDefinitions(profileDataset(p, 'dataset')).find(d => d.method === 'createScatterPlot');
  const args = definition.build({ ...defaultValues(definition), color: 'Origin' });
  const prepared = prepareStartingPlot(p, { method: definition.method, args });
  const committed = replayPrepared(prepared);
  assert.deepEqual(prepared.guideCall, { method: 'createGuides', args: {
    legend: { target: 'plot', channels: ['color'] },
  } });
  assert.deepEqual(committed.semanticSpec, prepared.preview.semanticSpec);
  assert.equal(prepared.recommendation.validation.topLevelActions, 1);
  assert.equal(p.trace.children.length, 3); // Previewing does not modify the input.
  const result = engine.recommend(committed, { target: 'plot', limit: 50, group: 'style' });
  assert.ok(result.state.features.includes('guide.legend'));
  assert.ok(result.recommendations.every(r => !['createAxes', 'createLegend', 'createGrid'].includes(r.method)));
  const title = result.recommendations.find(r => r.method === 'createTitle');
  assert.ok(title);
  const titlePreview = prepareGuidedAction(prepared.authoringPreview, { method: title.method, args: title.args });
  const next = titlePreview.preview;
  assertPreparedTrace(titlePreview);
  assert.deepEqual(replayPrepared(titlePreview).graphicSpec, next.graphicSpec);
  assert.equal(next.trace.children.filter(node => node.op === 'createGuides').length, 1);
  const code = programCode([{ method: definition.method, args }, prepared.guideCall]);
  const titleCode = programCode([{ method: definition.method, args }, { method: title.method, args: title.args }, titlePreview.guideCall]);
  assert.deepEqual(codeCallBlocks(code, titleCode).calls.map(call => call.change), ['context', 'added', 'context']);
  assert.ok(code.indexOf('.createScatterPlot(') < code.indexOf('.createGuides('));
  assert.ok(programCode([{ method: 'createGuides', args: {} }]).endsWith('.createGuides();'));
  parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const original = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url), 'utf8'));
  const full = base(original);
  const scatter = getPlotDefinitions(profileDataset(full, 'dataset')).find(d => d.method === 'createScatterPlot');
  for (const choice of scatter.controls.find(control => control.key === 'color').choices) {
    const prepared = prepareStartingPlot(full, { method: scatter.method,
      args: scatter.build({ ...defaultValues(scatter), color: choice.value }) });
    assert.ok(renderToSVG(prepared.preview).startsWith('<svg'), choice.label);
    assert.deepEqual(prepared.preview.semanticSpec.datasets.find(d => d.id === 'dataset').values, original);
  }
});

test('the final guide moves after each authored action and creates legends for new encodings', () => {
  for (const color of ['', 'Origin', 'Horsepower']) {
    // All appearance legends use the same automatic guide margins as the app.
    const p = base(cars, defaultCanvasOptions());
    const definition = getPlotDefinitions(profileDataset(p, 'dataset')).find(d => d.method === 'createScatterPlot');
    let prepared = prepareStartingPlot(p, { method: definition.method,
      args: definition.build({ ...defaultValues(definition), color }) });
    let authoring = prepared.authoringPreview, view = prepared.preview;
    const calls = [{ method: prepared.recommendation.method, args: prepared.recommendation.args }];
    const methods = [...(!color ? ['encodeColor'] : []), 'encodeSize', 'encodeShape', 'encodeOpacity', 'createTitle'];
    for (const method of methods) {
      const result = engine.recommend(view, { target: 'plot', limit: 50, group: method === 'createTitle' ? 'style' : 'encoding' });
      const original = result.recommendations.find(r => r.method === method);
      assert.ok(original, `${color || 'no color'}: ${method}`);
      const editor = recommendationParameters(original, profileDataset(view, result.state.data));
      prepared = prepareGuidedAction(authoring, { method, args: editor.build(valuesFor(editor.controls)) });
      const applied = applyRecommendation(authoring, prepared.recommendation);
      const guided = replayPrepared(prepared);
      assert.deepEqual(guided.semanticSpec, prepared.preview.semanticSpec);
      assert.equal(applied.trace.children.length, authoring.trace.children.length + 1);
      assertPreparedTrace(prepared);
      assert.equal(guided.trace.children.at(-1).op, 'createGuides');
      assert.equal(guided.trace.children.filter(node => node.op === 'createGuides').length, 1);
      assert.ok(renderToSVG(guided).startsWith('<svg'));
      const guidedRecommendations = engine.recommend(guided, { target: 'plot', limit: 50, group: 'style' });
      assert.ok(guidedRecommendations.state.features.includes('guide.legend'));
      assert.ok(guidedRecommendations.recommendations.every(r => r.method !== 'createLegend'));
      authoring = replayPrepared(prepared, false); view = guided;
      calls.push(...prepared.prerequisiteCalls, { method, args: prepared.recommendation.args }, ...(prepared.postActionCalls ?? []));
      const code = programCode([...calls, prepared.guideCall]);
      assert.equal(code.match(/\.createGuides\(/g).length, 1);
      assert.equal(codeCallBlocks(code).calls.at(-1).method, 'createGuides');
      if (method === 'encodeColor') assert.ok(view.semanticSpec.guides.legend.color);
      if (method === 'encodeSize') assert.ok(view.semanticSpec.guides.legend.size || view.semanticSpec.guides.legend.color?.sizeScale);
    }
  }
});

test('a changed field previews a new chart without mutating the current visualization', () => {
  const { program } = makeScenarios()[3];
  const before = renderToSVG(program);
  const original = engine.recommend(program, { group: 'encoding' }).recommendations.find(r => r.method === 'encodeColor');
  const profile = profileDataset(program, 'cars');
  const editor = recommendationParameters(original, profile);
  const values = { ...valuesFor(editor.controls), field: 'Origin' };
  const changed = configureRecommendation(program, original, editor.build(values));
  assert.equal(renderToSVG(program), before);
  assert.equal(changed.recommendation.method, 'encodeColor');
  assert.equal(changed.preview.semanticSpec.layers.find(l => l.id === 'points').encoding.color.field, 'Origin');
  assert.equal(applyRecommendation(program, changed.recommendation).trace.children.length, program.trace.children.length + 1);
  assert.throws(() => prepareAction(program, { method: 'inventedPlot', args: {} }), /public ggaction/);
});

test('unavailable plots stay in the gallery and categorical data can still use a count pie', () => {
  const p = chart().createCanvas({ margin: { left: 70, right: 130, top: 40, bottom: 60 } })
    .createData({ id: 'categories', values: [{ group: 'A' }, { group: 'B' }, { group: 'A' }] });
  const definitions = getPlotDefinitions(profileDataset(p, 'categories'));
  assert.equal(definitions.length, 29);
  assert.ok(definitions.find(d => d.method === 'createScatterPlot').requirement);
  const pie = definitions.find(d => d.method === 'createPiePlot');
  assert.equal(pie.requirement, null);
  const { preview } = prepareAction(p, { method: pie.method, args: pie.build(defaultValues(pie)) });
  assert.ok(renderToSVG(preview).startsWith('<svg'));
});

test('existing guides recommend real edit calls and a suffix-created legend stays editable and replayable', () => {
  const p = base();
  const definition = getPlotDefinitions(profileDataset(p, 'dataset')).find(d => d.method === 'createScatterPlot');
  let prepared = prepareStartingPlot(p, { method: definition.method, args: definition.build(defaultValues(definition)) });
  let raw = prepared.authoringPreview, view = prepared.preview;
  const recommendations = () => engine.recommend(view, { target: 'plot', limit: 100, group: 'style' }).recommendations;
  assert.ok(recommendations().some(r => r.method === 'editAxes'));
  assert.ok(recommendations().some(r => r.method === 'editGrid'));
  assert.ok(!recommendations().some(r => ['createAxes', 'createGrid', 'createLegend', 'editLegend'].includes(r.method)));
  prepared = prepareGuidedAction(raw, { method: 'encodeColor', args: { target: 'plot', field: 'Origin' } }, view);
  raw = prepared.authoringPreview; view = prepared.preview;
  assert.equal(Object.keys(raw.semanticSpec.guides.legend ?? {}).length, 0);
  assert.ok(Object.keys(view.semanticSpec.guides.legend).length);
  const legend = recommendations().find(r => r.method === 'editLegend');
  assert.ok(legend);
  const editor = recommendationParameters(legend, profileDataset(view, 'dataset'));
  const args = editor.build({ ...valuesFor(editor.controls), fontSize: 10, position: 'right' });
  const before = JSON.stringify(raw);
  prepared = prepareGuidedAction(raw, { method: legend.method, args }, view);
  assert.deepEqual(prepared.prerequisiteCalls.map(call => call.method), ['createLegend']);
  assert.equal(prepared.recommendation.validation.topLevelActions, 1);
  const applied = applyRecommendation(prepared.actionBase, prepared.recommendation);
  const committed = replayPrepared(prepared);
  assert.deepEqual(committed.semanticSpec, prepared.preview.semanticSpec);
  assert.deepEqual(committed.graphicSpec, prepared.preview.graphicSpec);
  assert.equal(committed.trace.children.filter(n => n.op === 'createGuides').length, 1);
  assertPreparedTrace(prepared);
  assert.equal(committed.trace.children.at(-1).op, 'createGuides');
  assert.equal(JSON.stringify(raw), before);
  const replay = prepared.prerequisiteCalls.reduce((p, call) => p[call.method](call.args), raw)
    .editLegend(args);
  const replayView = (prepared.postActionCalls ?? []).reduce((p, call) => p[call.method](call.args), replay).createGuides(prepared.guideCall.args);
  assert.deepEqual(replayView.graphicSpec, committed.graphicSpec);
  assert.ok(Object.values(committed.guideConfigs.legend).some(c => c.labels.fontSize === 10));
  const again = prepareGuidedAction(applied, { method: 'editLegend', args: { ...args, labels: { fontSize: 11 } } }, committed);
  assert.deepEqual(again.prerequisiteCalls, []);
  assert.ok(renderToSVG(again.preview).startsWith('<svg'));
});

test('grid controls offer Vertical, Horizontal and Both with matching native preview and Apply, including missing categorical grids', () => {
  for (const method of ['createScatterPlot', 'createBarPlot']) {
    const p = base();
    const definition = getPlotDefinitions(profileDataset(p, 'dataset')).find(d => d.method === method);
    const start = prepareStartingPlot(p, { method, args: definition.build(defaultValues(definition)) });
    const rec = engine.recommend(start.preview, { target: 'plot', limit: 100, group: 'style' }).recommendations.find(r => r.method === 'editGrid');
    assert.ok(rec, method);
    const editor = recommendationParameters(rec, profileDataset(start.preview, 'dataset'));
    assert.deepEqual(editor.controls[0].choices.map(c => c.label), ['Vertical', 'Horizontal', 'Both']);
    assert.equal(editor.controls.length, 4);
    const before = structuredClone(start.authoringPreview.graphicSpec);
    for (const direction of ['vertical', 'horizontal', 'both']) {
      const args = editor.build({ ...valuesFor(editor.controls), direction, color: '#6b7280', width: 2 });
      const selected = direction === 'both' ? ['vertical', 'horizontal'] : [direction];
      assert.deepEqual(Object.keys(args), ['vertical', 'horizontal']);
      const prepared = prepareGuidedAction(start.authoringPreview, { method: 'editGrid', args }, start.preview);
      assert.equal(prepared.recommendation.validation.topLevelActions, 1);
      const applied = applyRecommendation(prepared.actionBase, prepared.recommendation);
      const committed = replayPrepared(prepared);
      assert.deepEqual(committed.graphicSpec, prepared.preview.graphicSpec);
      for (const key of selected) {
        assert.equal(committed.guideConfigs.grid[key].color, '#6b7280');
        assert.equal(committed.guideConfigs.grid[key].lineWidth, 2);
      }
      if (method === 'createBarPlot' && selected.includes('vertical')) {
        assert.ok(prepared.prerequisiteCalls.some(call => call.method === 'createGrid' && call.args.vertical));
      }
      for (const key of ['vertical', 'horizontal'].filter(key => !selected.includes(key))) {
        assert.equal(args[key].lineWidth, 0);
        assert.equal(committed.guideConfigs.grid[key].lineWidth, 0, 'the unselected direction must be hidden');
        const graphic = committed.graphicSpec.objects[`${key}GridLines`];
        assert.ok(graphic.items.length > 0);
        assert.ok(graphic.items.every(item => item.properties.strokeWidth === 0), 'no visible opposite grid lines');
      }
      const replay = prepared.prerequisiteCalls.reduce((program, call) => program[call.method](call.args), start.authoringPreview)
        .editGrid(args);
      const replayView = (prepared.postActionCalls ?? []).reduce((p, call) => p[call.method](call.args), replay).createGuides(prepared.guideCall.args);
      assert.deepEqual(replayView.graphicSpec, committed.graphicSpec);
      assert.ok(renderToSVG(committed).startsWith('<svg'));
    }
    assert.deepEqual(start.authoringPreview.graphicSpec, before);
  }
});

test('aggregate axis editing uses full-corpus evidence and remains one function through preview and Apply', () => {
  assert.ok(model.featureCounts['action.editAxes'] > 1000);
  const p = base();
  const definition = getPlotDefinitions(profileDataset(p, 'dataset')).find(d => d.method === 'createBarPlot');
  const start = prepareStartingPlot(p, { method: definition.method, args: definition.build(defaultValues(definition)) });
  const result = engine.recommend(start.preview, { target: 'plot', limit: 100, group: 'style' });
  const rec = result.recommendations.find(r => r.method === 'editAxes');
  assert.ok(rec);
  const editor = recommendationParameters(rec, profileDataset(start.preview, 'dataset'));
  assert.equal(editor.controls.length, 4);
  const prepared = prepareGuidedAction(start.authoringPreview,
    { method: rec.method, args: editor.build(valuesFor(editor.controls)) }, start.preview);
  const q = applyRecommendation(prepared.actionBase, prepared.recommendation);
  assert.equal(q.trace.children.length, start.authoringPreview.trace.children.length + 1);
  assert.equal(q.trace.children.at(-1).op, 'editAxes');
  assert.deepEqual(q.trace.children.at(-1).children.map(n => n.op), ['editXAxis', 'editYAxis']);
  assert.equal(prepared.preview.trace.children.at(-1).op, 'createGuides');
  assert.ok(!engine.recommend(prepared.preview, { target: 'plot', limit: 100, group: 'style' }).recommendations.some(r => r.method === 'editAxes'));
});


test('default square plot accommodates all title and legend positions with matching previews and Apply', () => {
  const original = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url), 'utf8'));
  const canvas = defaultCanvasOptions();
  for (const fieldType of ['nominal', 'quantitative']) {
    const p = chart().createCanvas(canvas).createData({ id: 'dataset', values: original })
      .createScatterPlot({ id: 'plot', data: 'dataset', guides: false, missing: 'skip',
        x: { field: 'Horsepower', fieldType: 'quantitative' }, y: { field: 'Miles_per_Gallon', fieldType: 'quantitative' },
        color: { field: fieldType === 'nominal' ? 'Origin' : 'Acceleration', fieldType } });
    const initial = addDefaultGuides(p), before = structuredClone(initial.graphicSpec);
    const actions = [
      ...['top', 'bottom', 'left', 'right'].flatMap(position => [10, 30].map(size => ({ method: 'createTitle',
        args: { text: 'Miles_per_Gallon by Horsepower', position, titleStyle: { fontFamily: 'Arial', fontSize: size } } }))),
      ...['right', 'left', 'top', 'bottom', 'top-right', 'top-left', 'bottom-right', 'bottom-left']
        .map(position => ({ method: 'editLegend', args: { target: 'plot', channel: 'color', position,
          labels: { fontFamily: 'Arial', fontSize: 18 } } })),
    ];
    for (const action of actions) {
      const prepared = prepareGuidedAction(p, action, initial);
      const applied = applyRecommendation(prepared.actionBase, prepared.recommendation);
      assert.equal(applied.trace.children.length, prepared.actionBase.trace.children.length + 1);
      assert.equal(applied.trace.children.at(-1).op, action.method);
      const final = replayPrepared(prepared);
      assert.deepEqual(final.graphicSpec, prepared.preview.graphicSpec);
      assert.deepEqual(final.materializationConfigs.canvas.plot, { width: 314, height: 314 });
      assert.ok(renderToSVG(final).startsWith('<svg'));
    }
    // Move the legend and enlarge a bottom title after both have been authored.
    const title = prepareGuidedAction(p, { method: 'createTitle', args: { text: 'Cars', position: 'bottom' } }, initial);
    const authored = applyRecommendation(title.actionBase, title.recommendation);
    const moved = prepareGuidedAction(authored, { method: 'editLegend', args: { target: 'plot', channel: 'color',
      position: 'left', labels: { fontSize: 18 } } }, title.preview);
    const next = applyRecommendation(moved.actionBase, moved.recommendation);
    const edited = prepareGuidedAction(next, { method: 'editTitle', args: { position: 'bottom', titleStyle: { fontSize: 30 } } }, moved.preview);
    assert.deepEqual(edited.preview.materializationConfigs.canvas.plot, { width: 314, height: 314 });
    assert.deepEqual(initial.graphicSpec, before);
    assert.deepEqual(original, p.semanticSpec.datasets[0].values);
  }
});
