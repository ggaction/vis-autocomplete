import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { createRecommendationEngine } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { extendedCandidates } from '../src/extended-catalog.js';
import { optionGroup } from '../src/recommendation-groups.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const rows = Array.from({ length: 36 }, (_, index) => ({ x: index + 1, y: index % 9 + 0.25,
  other: index * 2, category: ['A', 'B', 'C'][index % 3] }));
const base = () => chart().createCanvas({ plot: { width: 314, height: 314 },
  margin: { left: 170, right: 216, top: 42, bottom: 74 } })
  .createData({ id: 'data', values: rows });
const fixtures = {
  scatter: () => base().createScatterPlot({ id: 'plot', data: 'data', x: 'x', y: 'y', color: 'category' }).createGuides(),
  labels: () => base().createBarPlot({ id: 'plot', data: 'data', x: 'category',
    y: { field: 'y', aggregate: 'sum' } }).createMarkLabels({ source: 'plot', content: 'value' }).createGuides(),
  parallel: () => base().createParallelCoordinates({ id: 'plot', data: 'data', dimensions: ['x', 'y', 'other'], color: 'category' }).createGuides(),
  facet: () => base().createScatterPlot({ id: 'plot', data: 'data', x: 'x', y: 'y', color: 'category' })
    .facet({ field: 'category', data: 'data', columns: 3, guides: { axes: 'outer', legend: 'shared' } }).createGuides(),
};

for (const [name, fixture] of Object.entries(fixtures)) test(`${name}: each requested group preserves the complete ranking and parameter space`, () => {
  const program = fixture();
  const options = { target: 'plot', includeRevisions: true, deprioritizeAppliedActions: true, limit: 1000 };
  const complete = engine.rank(program, options);
  for (const group of ['encoding', 'transform', 'style']) {
    const scoped = engine.rank(program, { ...options, group });
    assert.deepEqual(scoped.recommendations, complete.recommendations.filter(recommendation => optionGroup(recommendation) === group), group);
    assert.deepEqual(scoped.state, complete.state);
    assert.deepEqual(scoped.model, complete.model);
  }
});

test('explicit groups skip dedicated final-item inspection families while ungrouped callers retain them', () => {
  const program = fixtures.labels(), layer = program.semanticSpec.layers.find(layer => layer.id === 'plot');
  const context = { layer, profile: profileDataset(program, layer.data) };
  const families = { filterMarks: 'transform', encodeText: 'encoding', editMarkLabelPlacement: 'style' };
  const complete = extendedCandidates(program, context);
  for (const [method, owner] of Object.entries(families)) {
    const belongs = candidate => candidate.method === method && (method !== 'filterMarks' || candidate.variantGroup);
    const expected = complete.filter(belongs);
    assert.ok(expected.length, method);
    for (const group of ['encoding', 'transform', 'style']) {
      assert.deepEqual(extendedCandidates(program, { ...context, group }).filter(belongs),
        owner === group ? expected : [], `${method} in ${group}`);
    }
  }
});
