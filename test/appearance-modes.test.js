import { replayPrepared, assertPreparedTrace } from './support/prepared.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { createRecommendationEngine, applyRecommendation, profileDataset } from '../src/index.js';
import { recommendationParameters, valuesFor, activeControls } from '../web/parameters.js';
import { prepareGuidedAction, addDefaultGuides, defaultCanvasOptions } from '../web/plot-setup.js';
import { programCode } from '../web/code-view.js';
const cars = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url), 'utf8'));

const engine = createRecommendationEngine(JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url), 'utf8')));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'cars', values: cars })
  .createScatterPlot({ id: 'plot', x: 'Weight_in_lbs', y: 'Acceleration', guides: false, missing: 'skip' });

test('appearance cards expose native fixed and field calls with at most three visible parameter groups', () => {
  const raw = base();
  const view = addDefaultGuides(raw);
  const result = engine.recommend(view, { target: 'plot', limit: 100, includeRevisions: true });
  for (const [method, value] of [['encodeColor', '#e45756'], ['encodeStroke', '#555555'], ['encodeSize', 120], ['encodeOpacity', 0]]) {
    const rec = result.recommendations.find(r => r.method === method);
    assert.ok(rec, method);
    assert.ok(rec.alternatives.some(a => a.args.field), `${method} field alternatives`);
    assert.ok(rec.alternatives.some(a => Object.hasOwn(a.args, 'value')), `${method} fixed alternative`);
    const editor = recommendationParameters(rec, profileDataset(view, 'cars'));
    const defaults = valuesFor(editor.controls);
    const fixed = { ...defaults, mode: 'fixed', value };
    assert.deepEqual(editor.build(fixed), { target: 'plot', value });
    for (const mode of ['fixed', 'variable']) {
      const v = { ...defaults, mode, value };
      assert.ok(editor.controls.filter(c => !c.when || c.when(v)).length <= 3);
      const active = activeControls(editor.controls, v).map(c => c.key);
      assert.equal(active.includes('field'), mode === 'variable');
      assert.equal(active.includes('value'), mode === 'fixed');
      const args = editor.build(v);
      assert.equal(Object.hasOwn(args, 'value'), mode === 'fixed');
      assert.equal(Object.hasOwn(args, 'field'), mode === 'variable');
      const prepared = prepareGuidedAction(raw, { method, args }, view);
      const next = applyRecommendation(prepared.actionBase, prepared.recommendation);
      assert.equal(next.trace.children.length, raw.trace.children.length + 1);
      assert.equal(next.trace.children.at(-1).op, method);
      const applied = replayPrepared(prepared);
      assert.deepEqual(applied.graphicSpec, prepared.preview.graphicSpec);
      assert.equal(applied.trace.children.at(-1).op, 'createGuides');
      const code = programCode([{ method, args }]);
      assert.ok(code.includes(`.${method}(`));
      assert.equal(code.includes('"value"'), mode === 'fixed');
    }
  }
});

test('field and constant assignments stay editable only through explicit appearance revisions', () => {
  let raw = base().encodeColor({ target: 'plot', field: 'Origin' })
    .encodeSize({ target: 'plot', field: 'Displacement' })
    .encodeOpacity({ target: 'plot', field: 'Acceleration' });
  let view = addDefaultGuides(raw);
  for (const [method, value] of [['encodeColor', '#e45756'], ['encodeSize', 90], ['encodeOpacity', 0.5]]) {
    const recommendations = engine.recommend(view, { target: 'plot', includeRevisions: true, limit: 100 }).recommendations;
    const rec = recommendations.find(r => r.method === method);
    assert.equal(rec.kind, 'revision');
    const editor = recommendationParameters(rec, profileDataset(view, 'cars'));
    const fixed = prepareGuidedAction(raw, { method, args: editor.build({ ...valuesFor(editor.controls), mode: 'fixed', value }) }, view);
    raw = applyRecommendation(fixed.actionBase, fixed.recommendation);
    view = addDefaultGuides(raw, fixed.guideCall);
    const channel = method.slice(6).toLowerCase();
    assert.equal(raw.semanticSpec.layers[0].encoding[channel], undefined);
    assert.ok(!engine.recommend(view, { target: 'plot', limit: 100 }).recommendations.some(r => r.method === method), 'a fixed assignment is still an applied primitive');
    const restore = engine.recommend(view, { target: 'plot', limit: 100, includeRevisions: true }).recommendations.find(r => r.method === method);
    assert.ok(restore?.alternatives.some(a => a.args.field), `${method} can return to variable`);
  }
});

test('continuous mapping ranges normalize reversed endpoints and disabled field mode reflects missing field alternatives', () => {
  const raw = base(), view = addDefaultGuides(raw);
  const rec = engine.recommend(view, { target: 'plot', limit: 100 }).recommendations.find(r => r.method === 'encodeSize');
  const editor = recommendationParameters(rec, profileDataset(view, 'cars'));
  const values = editor.normalizeValues({ ...valuesFor(editor.controls), mode: 'variable', min: 200, max: 100 }, 'min');
  assert.deepEqual(editor.build(values).scale.range, [200, 200]);
  assert.throws(() => raw.encodeSize({ target: 'plot', field: 'Weight_in_lbs', scale: { range: [200, 100] } }), /range|ascending|greater|increas/i);
  const fixedOnly = recommendationParameters({ method: 'encodeColor', args: { target: 'plot', value: '#555555' } }, profileDataset(view, 'cars'));
  assert.equal(fixedOnly.controls.find(c => c.key === 'mode').choices.find(c => c.value === 'variable').disabled, true);
});

test('parallel paths expose per-observation appearance fields, including numeric color', async () => {
  const { appearanceCandidates } = await import('../src/appearance-candidates.js');
  const rows = [{ a:1,b:2,c:3,group:'A' },{ a:4,b:5,c:6,group:'B' }];
  let p = chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 100 })
    .createData({ id:'data',values:rows }).createParallelCoordinates({ id:'plot',dimensions:['a','b','c'] });
  for (const facet of [false,true]) {
    if(facet) p=p.facet({field:'group',columns:2});
    const candidates=appearanceCandidates(p,{layer:p.semanticSpec.layers[0],profile:profileDataset(p,'data')});
    for(const method of ['encodeColor','encodeOpacity','encodeStrokeWidth']) {
      assert.ok(candidates.some(c=>c.method===method&&c.args.field==='a'),`${method} must accept a row value`);
    }
    assert.ok(candidates.some(c=>c.method==='encodeColor'&&c.args.field==='group'));
  }
});
