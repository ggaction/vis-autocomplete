import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { recommendationParameters, valuesFor, activeControls } from '../web/parameters.js';

const rows = Array.from({ length: 24 }, (_, i) => ({ X: i + 1, Y: i % 8 + 1, Group: ['A', 'B', 'C'][i % 3] }));
function fixture(method = 'createScatterPlot') {
  const categorical = method === 'createBarPlot';
  return chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows })
    [method]({ id: 'plot', ...(method === 'createAreaPlot' ? { groupBy: 'Group' } : {}), color: { field: 'Group', fieldType: 'nominal' }, x: { field: categorical ? 'Group' : 'X', fieldType: categorical ? 'nominal' : 'quantitative' }, y: { field: 'Y', ...(categorical ? { aggregate: 'mean' } : {}) } })
    .createGuides();
}
function candidates(program) {
  const profile = profileDataset(program, 'data');
  return { profile, list: generateCandidates(program, { layer: program.semanticSpec.layers.find(l => l.id === 'plot'), profile }) };
}

test('axis cards expose line width alongside labels and preserve category tick policies', () => {
  for (const method of ['createScatterPlot', 'createBarPlot']) {
    const program = fixture(method), { profile, list } = candidates(program);
    for (const action of ['editAxes', 'editXAxis', 'editYAxis']) {
      const rec = list.find(c => c.method === action), editor = recommendationParameters(rec, profile);
      assert.equal(editor.controls.length, 4, action);
      const control = activeControls(editor.controls, valuesFor(editor.controls)).find(c => c.label === 'Axis width');
      assert.ok(control, action);
      const values = { ...valuesFor(editor.controls), [control.key]: 3 };
      const args = editor.build(values);
      const prepared = prepareGuidedAction(program, { method: action, args });
      const next = prepared.authoringPreview;
      assert.equal(next.trace.children.at(-1 - prepared.postActionCalls.length).op, action);
      assert.equal(prepared.recommendation.validation.topLevelActions, 1);
      for (const channel of action === 'editAxes' ? ['x', 'y'] : [action === 'editXAxis' ? 'x' : 'y']) {
        assert.equal(next.guideConfigs.axis[channel].line.lineWidth, 3);
      }
      if (method === 'createBarPlot' && action !== 'editYAxis') {
        const x = action === 'editAxes' ? args.x : args;
        assert.equal(x.ticksAndLabels?.count, undefined);
      }
    }
  }
});

test('expanded style controls build executable single-function edits for every exposed option', () => {
  const methods = new Set(['editPointMark', 'editBarMark', 'editLineMark', 'editAreaMark',
    'editXAxis', 'editYAxis', 'editXAxisLabels', 'editYAxisLabels', 'editXAxisLine', 'editYAxisLine',
    'editXAxisTicks', 'editYAxisTicks', 'editXAxisTicksAndLabels', 'editYAxisTicksAndLabels',
    'editXAxisTitle', 'editYAxisTitle', 'editLegend', 'editLegendLabels', 'editLegendTitle',
    'editLegendLayout', 'editLegendBorder', 'editLegendBlock', 'editGrid', 'editHorizontalGrid', 'editVerticalGrid',
    'createTitle', 'createAnnotation', 'editAxes']);
  for (const chartMethod of ['createScatterPlot', 'createBarPlot', 'createLinePlot', 'createAreaPlot']) {
    const program = fixture(chartMethod), { list, profile } = candidates(program);
    for (const rec of list.filter(c => methods.has(c.method))) {
      const editor = recommendationParameters(rec, profile), initial = valuesFor(editor.controls);
      assert.ok(editor.controls.length >= 1 && editor.controls.length <= 4, rec.method);
      for (const control of activeControls(editor.controls, initial)) {
        const probes = control.type === 'number' ? [control.min, Math.min(control.max, control.value + control.step)]
          : control.type === 'text' ? ['Example'] : control.choices.filter(c => !c.disabled).map(c => c.value);
        for (const value of probes) {
          const args = editor.build({ ...initial, [control.key]: value });
          try {
            // Keeping the current font/size is a valid edit. It no longer has
            // the incidental side effect of forcing the font back to Arial.
            const prepared = prepareGuidedAction(program, { method: rec.method, args, allowUnchanged: true });
            assert.equal(prepared.recommendation.validation.topLevelActions, 1);
          } catch (error) {
            throw new Error(`${chartMethod}/${rec.method}/${control.label}=${JSON.stringify(value)}: ${error.message}`, { cause: error });
          }
        }
      }
    }
  }
});

test('title cards create, preserve, resize and remove subtitles through one native call without weight controls', () => {
  const raw = fixture(), { profile, list } = candidates(raw);
  const editor = recommendationParameters(list.find(c => c.method === 'createTitle'), profile);
  const initial = valuesFor(editor.controls);
  assert.equal(editor.controls.length, 4);
  assert.ok(!activeControls(editor.controls, initial).some(c => c.key === 'weight'));
  assert.equal(initial.size, 23);
  assert.equal(initial.subtitleSize, 17);
  assert.equal(initial.subtitle, '');
  const values = { ...initial, text: 'Measurements', subtitle: 'Across three groups', subtitleSize: 18 };
  const prepared = prepareGuidedAction(raw, { method: 'createTitle', args: editor.build(values) });
  const next = prepared.authoringPreview;
  assert.equal(prepared.recommendation.validation.topLevelActions, 1);
  assert.equal(next.semanticSpec.title.subtitle, values.subtitle);
  assert.equal(next.titleConfig.subtitleStyle.fontSize, 18);
  const existing = next.editTitle({ titleStyle: { fontWeight: 'normal' } });
  const edits = candidates(existing);
  const edit = recommendationParameters(edits.list.find(c => c.method === 'editTitle'), edits.profile);
  const saved = valuesFor(edit.controls);
  assert.equal(saved.subtitle, values.subtitle);
  assert.equal(saved.subtitleSize, 18);
  const changed = existing.editTitle(edit.build({ ...saved, text: 'New title', subtitleSize: 20 }));
  assert.equal(changed.semanticSpec.title.subtitle, values.subtitle);
  assert.equal(changed.titleConfig.subtitleStyle.fontSize, 20);
  assert.equal(changed.titleConfig.titleStyle.fontWeight, 'normal');
  const removed = changed.editTitle(edit.build({ ...saved, subtitle: '  ' }));
  assert.equal(removed.semanticSpec.title.subtitle, undefined);
  assert.ok(!Object.hasOwn(editor.build({ ...initial, subtitle: '  ' }), 'subtitle'));
});


test('dedicated point encodings replace generic style controls without overwriting other channels', () => {
  const program = fixture().encodeShape({ target: 'plot', field: 'Group', fieldType: 'nominal' });
  const { profile, list } = candidates(program);
  assert.ok(!list.some(c => c.method === 'editPointMark'));
  const rec = list.find(c => c.method === 'encodeStrokeWidth' && c.args.value !== undefined);
  const editor = recommendationParameters(rec, profile), values = valuesFor(editor.controls);
  const args = editor.build({ ...values, mode: 'fixed', value: 2 });
  assert.deepEqual(args, { target: 'plot', value: 2 });
  const next = program.encodeStrokeWidth(args);
  assert.equal(next.markConfigs.plot.strokeWidth, 2);
  for (const channel of ['shape', 'color']) assert.deepEqual(next.semanticSpec.layers[0].encoding[channel], program.semanticSpec.layers[0].encoding[channel]);
});

test('heatmap, pie, text and rug mark styles use their own native capabilities', () => {
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
  const programs = [base.createHeatmap({ id: 'plot', x: 'X', y: 'Y', bin: { bins: 4 } }),
    base.createPiePlot({ id: 'plot', category: 'Group', value: 'Y', aggregate: 'sum' }),
    base.createTextPlot({ id: 'plot', x: 'X', y: 'Y', text: { field: 'Group' } }),
    base.createRugPlot({ id: 'plot', x: 'X', edge: 'bottom' })];
  for (const raw of programs) {
    const program = raw.createGuides(), { list, profile } = candidates(program);
    const rec = list.find(c => c.category === 'style' && /^edit(Rect|Arc|Text|Tick)Mark$/.test(c.method));
    assert.ok(rec);
    const editor = recommendationParameters(rec, profile), initial = valuesFor(editor.controls);
    assert.ok(editor.controls.length >= 1 && editor.controls.length <= 4, rec.method);
    for (const control of editor.controls) {
      const value = control.type === 'number' ? Math.min(control.max, control.value + control.step)
        : control.choices.find(choice => choice.value !== control.value)?.value;
      assert.doesNotThrow(() => prepareGuidedAction(program, { method: rec.method,
        args: editor.build({ ...initial, [control.key]: value }) }), `${rec.method}: ${control.label}`);
    }
  }
});

test('facet source wrappers retain expanded axis controls and one public action', () => {
  const source = fixture(), { profile, list } = candidates(source);
  const axes = list.find(c => c.method === 'editXAxis');
  const wrapper = { ...axes, method: 'editFacetSource', args: { action: { method: axes.method, options: axes.args } } };
  const editor = recommendationParameters(wrapper, profile);
  assert.equal(editor.controls.length, 4);
  const width = activeControls(editor.controls, valuesFor(editor.controls)).find(c => c.label === 'Axis width');
  const args = editor.build({ ...valuesFor(editor.controls), [width.key]: 2.5 });
  const faceted = source.facet({ field: 'Group', columns: 3 });
  const next = prepareGuidedAction(faceted, { method: wrapper.method, args }).authoringPreview;
  assert.equal(next.trace.children.at(-1).op, 'editFacetSource');
  for (const child of Object.values(next.children)) assert.equal(child.guideConfigs.axis.x.line.lineWidth, 2.5);
});

test('polar and parallel line styles expose supported joins instead of Cartesian curves', () => {
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
  for (const program of [base.createPolarLinePlot({ id: 'plot', theta: 'X', radius: 'Y' }),
    base.createParallelCoordinates({ id: 'plot', dimensions: ['X', 'Y'] })]) {
    const { profile, list } = candidates(program);
    const rec = list.find(c => c.method === 'editLineMark'), editor = recommendationParameters(rec, profile);
    assert.ok(!editor.controls.some(c => c.label === 'Curve'));
    const join = editor.controls.find(c => c.label === 'Line join');
    assert.ok(join);
    for (const choice of join.choices) assert.doesNotThrow(() => program.editLineMark(
      editor.build({ ...valuesFor(editor.controls), [join.key]: choice.value })));
  }
});
