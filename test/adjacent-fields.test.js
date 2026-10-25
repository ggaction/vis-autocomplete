import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { adjacentContext, adjacentSpecs } from '../web/composition-controls.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { activeControls } from '../web/parameters.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { renderToSVG } from 'ggaction/svg';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const engine = createInitialChartRecommender(read('../data/initial-model.json'));
const fields = ['Sepal.Length', 'Sepal.Width', 'Petal.Length', 'Petal.Width', 'Species'];
const base = () => chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 100 })
  .createData({ id: 'dataset', values: read('../web/data/iris.json') });
const scatter = () => base().createScatterPlot({ id: 'plot', x: fields[0], y: fields[1], color: { field: 'Species', fieldType: 'nominal', scale: { palette: 'tableau10' } } });
const find = (p, adding, method) => adjacentSpecs(engine, adding, p).find(s => !s.requirement && s.build(s.values).plot.action === method);

test('adjacent selection retains the full chosen field set and all multivariate dimensions', () => {
  const p = scatter();
  const adding = adjacentContext(p, { target: 'plot' }, 'right', {}, undefined, undefined, { fields });
  assert.deepEqual(adding.selection, { fields });
  const parallel = find(p, adding, 'createParallelCoordinates'); assert.ok(parallel);
  assert.deepEqual(parallel.build(parallel.values).plot.options.dimensions, fields.slice(0, 4));
  const pcp = base().createParallelCoordinates({ id: 'plot', dimensions: fields.slice(0, 4) })
    .encodeColor({ target: 'plot', field: 'Species', fieldType: 'nominal' });
  const fromPcp = adjacentContext(pcp, { target: 'plot' }, 'bottom', {});
  assert.deepEqual(new Set(fromPcp.selection.fields), new Set(fields));
  const prepared = prepareGuidedAction(p, { method: parallel.method, args: parallel.build(parallel.values) }, p, parallel.setup?.(parallel.values));
  assert.ok(renderToSVG(prepared.preview).startsWith('<svg'));
  assert.equal(p.compositionSpec, undefined, 'creating a candidate leaves the source untouched');
});

test('adding/removing fields restricts every card mapping and permits an empty selection', () => {
  const p = scatter(), adding = adjacentContext(p, { target: 'plot' }, 'right', {});
  adding.selection = { fields: [fields[2], fields[3]] };
  const spec = find(p, adding, 'createScatterPlot'); assert.ok(spec);
  assert.deepEqual(new Set(spec.usage(spec.values)), new Set(adding.selection.fields));
  for (const control of activeControls(spec.resolveControls(spec.values), spec.values).filter(c => c.type === 'select' && c.key.startsWith('mapping_'))) {
    assert.ok(control.choices.every(c => !c.value || adding.selection.fields.includes(c.value)));
  }
  assert.equal(spec.build(spec.values).share.color, undefined);
  assert.equal(spec.build(spec.values).share.y, undefined);
  adding.selection = { fields: [] };
  assert.deepEqual(adjacentSpecs(engine, adding, p), []);
});

test('card mappings recompute sharing and native setup rather than retaining the old X/Y/Color roles', () => {
  const p = scatter(), adding = adjacentContext(p, { target: 'plot' }, 'right', {}, undefined, undefined, { fields });
  const spec = find(p, adding, 'createScatterPlot');
  assert.equal(spec.build(spec.values).share.y, true);
  assert.equal(spec.build(spec.values).share.color, true);
  const changed = spec.normalizeValues({ ...spec.values, mapping_y: fields[2], mapping_color: '' }, 'mapping_y');
  const args = spec.build(changed);
  assert.equal(args.plot.options.y.field, fields[2]);
  assert.equal(args.share.y, undefined); assert.equal(args.share.color, undefined);
  const prepared = prepareGuidedAction(p, { method: spec.method, args }, p, spec.setup?.(changed));
  assert.ok(renderToSVG(prepared.preview).startsWith('<svg'));
});

test('adjacent heatmaps prepare their selected numeric fields into an ordinal grid', () => {
  const p = scatter(), adding = adjacentContext(p, { target: 'plot' }, 'right', {}, undefined, undefined, { fields });
  const spec = find(p, adding, 'createHeatmap'); assert.ok(spec);
  const args = spec.build(spec.values);
  assert.equal(args.plot.options.x.fieldType, 'ordinal');
  const prepared = prepareGuidedAction(p, { method: spec.method, args }, p, spec.setup(spec.values));
  assert.ok(renderToSVG(prepared.preview).startsWith('<svg'));
});
