import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { arcMarkCandidates } from '../src/arc-candidates.js';
import { createRecommendationEngine } from '../src/engine.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const rows = ['A', 'B', 'C'].flatMap((g, i) => [{ g, v: i + 1, panel: 'P' }, { g, v: (i + 1) * 2, panel: 'Q' }]);
const base = values => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values });
const pie = () => base(rows).createPiePlot({ id: 'plot', category: 'g', value: 'v' });

test('corpus arc recipes merge into two semantic cards with real controls, not raw preset buttons', () => {
  const p = pie(), engine = createRecommendationEngine(model), profile = profileDataset(p, 'data');
  const cards = engine.recommend(p, { target: 'plot', limit: 1000, includeRevisions: true, validationMode: 'deferred' })
    .recommendations.filter(c => c.method === 'editArcMark');
  assert.deepEqual(cards.map(c => c.category).sort(), ['encoding', 'style']);
  for (const rec of cards) {
    assert.equal(rec.parameterMode, undefined);
    const editor = recommendationParameters(rec, profile), initial = valuesFor(editor.controls);
    assert.ok(!editor.controls.some(c => c.key === 'variant'));
    assert.ok(editor.controls.length <= 4);
    if (rec.category === 'encoding') {
      assert.ok(editor.controls.some(c => ['Inner radius (px)', 'Hole size (%)'].includes(c.label)));
      const args = editor.build(initial), next = p.editArcMark(args);
      assert.equal(args.stroke, undefined);
      assert.equal(args.opacity, undefined);
      assert.deepEqual(next.markConfigs.plot.stroke, p.markConfigs.plot.stroke);
      assert.deepEqual(args.innerRadius, rec.args.innerRadius);
      for (const variant of rec.alternatives.filter(c => c.args.innerRadius !== undefined)) {
        const variantEditor = recommendationParameters({ ...rec, args: variant.args, skipParameterDefaults: true }, profile);
        assert.deepEqual(variantEditor.build(valuesFor(variantEditor.controls)).innerRadius, variant.args.innerRadius);
      }
    } else {
      assert.ok(editor.controls.some(c => c.label === 'Outline'));
      assert.ok(rec.alternatives.every(c => c.args.innerRadius === undefined && c.args.padAngle === undefined));
      const args = editor.build(initial);
      assert.equal(args.innerRadius, undefined);
      assert.equal(args.padAngle, undefined);
      assert.doesNotThrow(() => p.editArcMark(args));
      assert.doesNotThrow(() => p.editArcMark(editor.build({ ...initial, border: true, strokeWidth: 2, stroke: '#000000' })));
      assert.doesNotThrow(() => p.editArcMark(editor.build({ ...initial, border: false })));
    }
  }
});

test('pie, tiny slices, rose, radial bars and facets support control endpoints as one native action', () => {
  const tiny = base([{ g: 'A', v: 1 }, { g: 'B', v: 100000 }]).createPiePlot({ id: 'plot', category: 'g', value: 'v' });
  const programs = [pie(), tiny, base(rows).createRosePlot({ id: 'plot', category: 'g', value: 'v' }),
    base(rows).createRadialBarPlot({ id: 'plot', category: 'g', value: 'v' }),
    pie().facet({ field: 'panel', columns: 2 })];
  for (const p of programs) {
    const layer = p.semanticSpec.layers.find(l => l.id === 'plot'), profile = profileDataset(p, layer.data);
    const recipes = [...arcMarkCandidates(p, layer), ...arcMarkCandidates(p, layer, {
      innerRadius: { unit: 'px', value: 60 }, padAngle: 1.1459155902616465, stroke: false,
    })];
    if (['rose', 'radialBar'].includes(p.markConfigs.plot.compositionRole)) {
      assert.ok(recipes.every(c => c.category === 'style'), 'measured sectors use native radial/angle scale controls');
    }
    for (const recipe of recipes) {
      const rec = p.compositionSpec?.facet ? { ...recipe, sourceMethod: recipe.method, method: 'editFacetSource',
        args: { action: { method: recipe.method, options: recipe.args } } } : recipe;
      const editor = recommendationParameters(rec, profile), initial = valuesFor(editor.controls);
      for (const control of editor.controls) {
        const probes = control.type === 'number' ? [control.min, control.max] : control.choices.map(c => c.value);
        for (const value of probes) {
          const args = editor.build({ ...initial, [control.key]: value });
          assert.doesNotThrow(() => {
            const next = p[rec.method](args);
            assert.equal(next.trace.children.length, p.trace.children.length + 1);
            try {
              const result = prepareGuidedAction(p, { method: rec.method, args });
              assert.equal(result.recommendation.validation.topLevelActions, 1);
            } catch (error) {
              // Returning a control to the current value is valid native
              // authoring, but intentionally isn't an applicable new action.
              if (error.reason !== 'no-change') throw error;
            }
          }, `${p.markConfigs.plot.compositionRole}/${control.label}/${value}`);
        }
      }
      if (p.markConfigs.plot.compositionRole !== 'pie' && recipe.category === 'encoding') {
        assert.ok(!editor.controls.some(c => c.key === 'innerRadius'), 'measured radius is controlled by the radial scale');
      }
    }
  }
});

test('mapped arc stroke is preserved, while worker search and facet wrappers expose the right intent', () => {
  const raw = pie().encodeStroke({ target: 'plot', field: 'g', fieldType: 'nominal' });
  for (const p of [raw, raw.facet({ field: 'panel', columns: 2 })]) {
    const service = createCalculationService(model);
    service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(p) });
    for (const group of ['encoding', 'style']) {
      const result = service.execute({ type: 'recommend', stateId: 1, group, searchQuery: 'editArcMark',
        options: { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS } }).result;
      const rec = result.recommendations.find(c => (c.sourceMethod ?? c.method) === 'editArcMark');
      assert.ok(rec, group);
      assert.equal(rec.category, group);
      const editor = recommendationParameters(rec, profileDataset(p, 'data'));
      const args = editor.build(valuesFor(editor.controls));
      assert.equal((args.action?.options ?? args).stroke, undefined);
      assert.equal(rec.validation.topLevelActions, 1);
    }
  }
});
