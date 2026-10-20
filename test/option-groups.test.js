import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { createRecommendationEngine } from '../src/index.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../web/plot-setup.js';
import { OPTION_GROUPS, optionGroup, groupRecommendations } from '../web/option-groups.js';

test('each group gets its own top five in unchanged engine order, rather than filtering the global top five', () => {
  const ranked = [
    ...Array.from({ length: 8 }, (_, i) => ({ method: `encode${i}`, category: 'encoding', kind: 'addition', score: 1 - i / 100 })),
    { method: 'createRegression', category: 'transform', kind: 'addition', score: .3 },
    { method: 'editAxes', category: 'guide', kind: 'addition', score: .2 },
    { method: 'editPointMark', category: 'style', kind: 'addition', score: .1 },
  ];
  const before = JSON.stringify(ranked), groups = groupRecommendations(ranked);
  assert.deepEqual(groups.encoding, ranked.slice(0, 5));
  assert.equal(groups.transform[0], ranked[8]);
  assert.deepEqual(groups.style, ranked.slice(9));
  assert.equal(JSON.stringify(ranked), before);
  assert.equal(optionGroup({ method: 'orderCategories', category: 'encoding' }), 'encoding');
  assert.equal(optionGroup({ method: 'createPointMark', category: 'mark' }), 'encoding');
  assert.throws(() => optionGroup({ category: 'invented' }), /Unknown/);
  assert.deepEqual(OPTION_GROUPS.map(g => g.color), ['#0a6fc2', '#d6861a', '#1f9d55']);
});

test('native recommendations belong to exactly one group, preserve paper scores and keep appearance revisions', () => {
  const rows = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
  const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
  const engine = createRecommendationEngine(model);
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows })
    .filterData({ id: 'with-hp', source: 'data', field: 'Horsepower', noneOf: [null], nulls: 'exclude' })
    .filterData({ id: 'pairs', source: 'with-hp', field: 'Miles_per_Gallon', noneOf: [null], nulls: 'exclude' });
  for (const [method, args] of [
    ['createScatterPlot', { id: 'plot', data: 'pairs', x: 'Horsepower', y: 'Miles_per_Gallon', missing: 'skip' }],
    ['createBarPlot', { id: 'plot', data: 'pairs', x: { field: 'Origin', fieldType: 'nominal' },
      y: { field: 'Miles_per_Gallon', aggregate: 'mean' }, missing: 'skip' }],
  ]) {
    const program = prepareGuidedAction(base, { method, args }).preview;
    const ranked = engine.recommend(program, { target: 'plot', limit: 100, includeRevisions: true }).recommendations;
    const groups = groupRecommendations(ranked), selected = Object.values(groups).flat();
    assert.equal(new Set(selected).size, selected.length);
    for (const group of OPTION_GROUPS) {
      assert.ok(groups[group.id].length <= 5);
      const expected = ranked.filter(r => optionGroup(r) === group.id).slice(0, 5);
      assert.deepEqual(groups[group.id], expected);
      for (const rec of groups[group.id]) {
        assert.equal(rec.score, ranked.find(r => r.id === rec.id).score);
        assert.equal(rec.validation.topLevelActions, 1);
      }
    }
    assert.ok(groups.encoding.length && groups.style.length);
    const expectedGroup = method === 'createBarPlot' ? 'encoding' : 'transform';
    assert.ok(groupRecommendations(ranked, 1000)[expectedGroup].some(r => r.method === (method === 'createBarPlot' ? 'orderCategories' : 'createRegression')));
  }
});
