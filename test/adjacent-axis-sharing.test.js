import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { adjacentContext, adjacentSpecs } from '../web/composition-controls.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { axisValueMeaning } from '../src/axis-sharing.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { prepareCompositionSnapshots } from '../vendor/ggaction/src/materialization/composition.js';
import { activeControls } from '../web/parameters.js';

const engine = createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url))));
const data = JSON.parse(readFileSync(new URL('../web/data/barley.json', import.meta.url)));
const source = (axis, aggregate = 'sum') => chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 100 })
  .createData({ id: 'dataset', values: axis === 'y' ? data.map(row => ({ ...row, variety: `V${[...new Set(data.map(r => r.variety))].indexOf(row.variety)}` })) : data }).createBarPlot({ id: 'plot', data: 'dataset',
    [axis]: { field: 'yield', fieldType: 'quantitative', aggregate },
    [axis === 'x' ? 'y' : 'x']: { field: 'variety', fieldType: 'nominal' },
    color: { field: 'year', fieldType: 'ordinal', scale: { palette: 'tableau10' } } });
const card = (p, axis, name) => adjacentSpecs(engine, adjacentContext(p, { target: 'plot' }, axis === 'x' ? 'bottom' : 'right', { year: 'ordinal' }), p)
  .find(spec => new RegExp(`^Add ${name}`, 'i').test(spec.title));

for (const axis of ['x', 'y']) for (const facet of [false, true]) {
  test(`${axis}: raw scatter never automatically shares an aggregate axis (facet=${facet})`, () => {
    let p = source(axis).layoutSeries({ target: 'plot', mode: 'stack' });
    if (facet) p = p.createOverlay({ id: 'overlay', source: 'plot' }).facet({ field: 'year', columns: 2, guides: { legend: 'shared' } });
    const spec = card(p, axis, 'Scatter'); assert.ok(spec);
    const args = spec.build(spec.values);
    assert.equal(args.share[axis], undefined); assert.equal(args.share.color, true);
    const scale = activeControls(spec.resolveControls(spec.values), spec.values).find(c => c.key === `${axis}Scale`);
    assert.ok(!scale.label.includes('shared')); assert.ok(scale.choices.filter(c => !c.disabled).length > 1);
    const prepared = prepareGuidedAction(p, { method: spec.method, args }, p, spec.setup?.(spec.values) ?? []);
    const child = prepareCompositionSnapshots(prepared.preview).children[args.id];
    const id = child.semanticSpec.layers[0].encoding[axis].scale;
    assert.ok(child.resolvedScales[id].domain[1] < 100, 'scatter uses individual yields instead of 300/500 totals');
  });
}

test('aggregation changes immediately release/reinstate sharing, including summary-backed area plots', () => {
  const p = source('y');
  for (const name of ['Bar', 'Line', 'Area']) {
    const spec = card(p, 'y', name); assert.ok(spec, name);
    assert.equal(spec.values.aggregate, 'sum');
    assert.equal(spec.build(spec.values).share.y, true, `${name} sum shares sum`);
    const mean = { ...spec.values, aggregate: 'mean' };
    assert.equal(spec.build(mean).share.y, undefined, `${name} mean is independent`);
    const control = activeControls(spec.resolveControls(mean), mean).find(c => c.key === 'yScale');
    assert.ok(!control.label.includes('shared'));
    assert.equal(spec.build(spec.values).share.y, true);
  }
});

test('raw/raw and categorical axes still share automatically', () => {
  const raw = chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 100 }).createData({ id: 'dataset', values: data })
    .createScatterPlot({ id: 'plot', x: 'yield', y: { field: 'variety', fieldType: 'nominal' } });
  const spec = card(raw, 'x', 'Scatter'); assert.equal(spec.build(spec.values).share.x, true);
  const categorical = card(source('y'), 'x', 'Scatter');
  assert.equal(categorical.build(categorical.values).share.x, true);
});

test('summary aliases and successive aggregate operations retain their value meaning', () => {
  const datasets = [{ id: 'raw' }, { id: 'summary', source: 'raw', transform: [{ type: 'summary', aggregates: [{ field: 'yield', as: 'yield', op: 'mean' }] }] },
    { id: 'filtered', source: 'summary', transform: [{ type: 'filter' }] }];
  assert.deepEqual(axisValueMeaning({ field: 'yield' }, 'filtered', datasets).operations, ['mean']);
  assert.deepEqual(axisValueMeaning({ field: 'yield', aggregate: 'sum' }, 'filtered', datasets).operations, ['mean', 'sum']);
});

test('an inherited explicit shared axis is not silently changed by an incompatible new chart', () => {
  const p = source('y').createAdjacentPlot({ id: 'line', source: 'plot', position: 'right', plot: { action: 'createLinePlot', options: { guides: false } } });
  const adding = adjacentContext(p, { target: 'line', childPath: ['line'] }, 'right', { year: 'ordinal' });
  const scatter = adjacentSpecs(engine, adding, p).find(spec => /^Add Scatter/i.test(spec.title));
  assert.ok(!scatter.requirement, 'the card stays editable so independent sharing can recover it');
  const sharing = scatter.resolveControls(scatter.values).find(control => control.label === 'Shared scales');
  assert.ok(sharing.controls.some(control => control.key === 'share_y' &&
    control.choices.some(choice => choice.value === 'independent' && !choice.disabled)));
  assert.throws(() => scatter.build(scatter.values), /parent group already shares Y/i);
  assert.equal(p.compositionSpec.share.y, true);
});
