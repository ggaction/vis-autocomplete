import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { getPlotComposition } from 'ggaction/inspection';
import { adjacentContext, adjacentSpecs } from '../web/composition-controls.js';
import { adjacentColorContext } from '../src/adjacent-color.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { editableGuides, moveGuide, resizeGuide } from '../src/guide-manipulation.js';
import { compositionPlotBounds, prepareCompositionSnapshots } from '../vendor/ggaction/src/materialization/composition.js';
import { mapScaleConsumerValues } from '../vendor/ggaction/src/materialization/scales/map.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const rows = read('../web/data/glass.json');
const engine = createInitialChartRecommender(read('../data/initial-model.json'));
const selection = { fields: ['RI', 'Na', 'Mg', 'Fe', 'class'] };
const source = () => chart().createCanvas({ plot: { width: 314, height: 314 },
  margin: { left: 170, right: 216, top: 42, bottom: 74 } })
  .createData({ id: 'dataset', values: rows })
  .createBeeswarmPlot({ id: 'plot', data: 'dataset', missing: 'skip', x: { field: 'class', fieldType: 'nominal' },
    y: { field: 'Na', scale: { type: 'linear' } }, point: { radius: 2.5 }, packing: { overflow: 'overlap' } })
  .encodeColor({ target: 'plot', value: '#555555' })
  .createLayerPlot({ id: 'layer', source: 'plot', plot: { action: 'createBoxPlot', options: { whisker: { type: 'tukey' } } }, placement: 'back' })
  .encodeColor({ target: 'layer', field: 'class', fieldType: 'nominal', scale: { palette: 'observable10' } })
  .encodeBarWidth({ target: 'layer', pixels: 40 }).encodeStroke({ target: 'layer', value: '#555555' })
  .encodeOpacity({ target: 'plot', value: 0.55 });
const adding = (p, position = 'right', context = { target: 'plot' }, placement) =>
  adjacentContext(p, context, position, { class: 'nominal' }, placement, undefined, selection);
const parallel = (p, context) => adjacentSpecs(engine, context, p).find(spec => spec.title === 'Add Parallel coordinates');
const prepare = (p, spec, values = spec.values) => prepareGuidedAction(p, { method: spec.method, args: spec.build(values) }, p, spec.setup(values));
const legends = p => editableGuides(p).filter(t => t.kind === 'legend' && !t.part);

for (const position of ['left', 'right', 'top', 'bottom']) test(`layer-owned color is inherited by an adjacent PCP on the ${position}`, () => {
  const p = source(), saved = serializeProgram(p), context = adding(p, position), spec = parallel(p, context);
  assert.equal(context.sourceSelection.color, 'class'); assert.equal(context.colorSharingCompatible, true);
  assert.equal(spec.values.palette, 'observable10');
  const args = spec.build(spec.values);
  assert.equal(args.share.color, true);
  assert.equal(args.plot.options.color.fieldType, 'nominal', 'numeric class codes retain their categorical meaning');
  assert.deepEqual(args.plot.options.dimensions, selection.fields.slice(0, 4));
  const result = prepare(p, spec), q = result.preview, guide = legends(q);
  assert.equal(guide.length, 1); assert.equal(guide[0].key, 'legend:shared-color');
  assert.deepEqual(new Set(guide[0].editTargets.map(t => t.id)), new Set(['layer', 'chart2']));
  assert.ok(guide[0].bounds.left > compositionPlotBounds(q).x + compositionPlotBounds(q).width, 'one legend outside the entire composition');
  const { children } = prepareCompositionSnapshots(q);
  const scale = (child, id) => child.resolvedScales[getPlotComposition(child, { target: id }).channels.color.scale];
  const domain = [...new Set(rows.map(row => row.class))];
  assert.deepEqual(mapScaleConsumerValues(domain, scale(children.plot, 'layer'), 'color'),
    mapScaleConsumerValues(domain, scale(children.chart2, 'chart2'), 'color'), 'every class has the same actual color');
  assert.deepEqual(children.plot.semanticSpec.layers.find(l => l.id === 'plot').encoding.color,
    p.semanticSpec.layers.find(l => l.id === 'plot').encoding.color, 'fixed gray beeswarm stays gray');
  const calls = [...result.prerequisiteCalls, result.recommendation, ...result.postActionCalls, result.guideCall].filter(Boolean);
  const replayed = calls.reduce((value, call) => value[call.method](call.args), p);
  assert.equal(legends(replayed).length, 1, 'exported public calls reproduce the shared legend');
  assert.deepEqual(deserializeProgram(serializeProgram(q)).graphicSpec, q.graphicSpec);
  assert.equal(serializeProgram(p), saved);
});

test('an explicit independent or different-palette choice remains independent', () => {
  const p = source(), spec = parallel(p, adding(p));
  for (const values of [{ ...spec.values, share_color: 'independent' }, { ...spec.values, palette: 'tableau10' }]) {
    assert.equal(spec.build(values).share.color, undefined);
    assert.equal(legends(prepare(p, spec, values).preview).length, 2);
  }
});

test('faceted layers and nested placements retain one shared legend', () => {
  for (const facet of [false, true]) {
    let p = source();
    if (facet) p = p.facet({ field: 'class', data: 'dataset', columns: 3, guides: { legend: 'shared', axes: 'outer' } });
    const first = prepare(p, parallel(p, adding(p))).preview;
    assert.equal(legends(first).length, 1);
    const context = adding(first, 'bottom', { target: 'plot', childPath: ['plot'] }, []);
    assert.equal(context.colorSharingCompatible, true);
    const second = prepare(first, parallel(first, context)).preview;
    assert.equal(legends(second).length, 1, 'outer composition collects the already shared layer legend once');
  }
});

test('the shared layer legend moves and resizes all contributing owners together', () => {
  const p = source(), q = prepare(p, parallel(p, adding(p))).preview;
  const guide = legends(q)[0], plot = compositionPlotBounds(q);
  const action = moveGuide(q, guide, plot.x + plot.width / 2, plot.y + plot.height + 90);
  const moved = prepareGuidedAction(q, action, q).preview;
  assert.equal(legends(moved).length, 1); assert.equal(legends(moved)[0].placement.position, 'bottom');
  const before = legends(moved)[0], resized = prepareGuidedAction(moved, resizeGuide(before, 1.25), moved).preview;
  assert.equal(legends(resized).length, 1);
  assert.ok(legends(resized)[0].config.labels.fontSize > before.config.labels.fontSize);
});

test('ambiguous layer meanings, palettes, and explicit domains never pick an arbitrary color owner', () => {
  for (const color of [{ field: 'Fe', fieldType: 'quantitative', scale: { id: 'other-color', palette: 'viridis' } },
    { field: 'class', fieldType: 'nominal', scale: { id: 'other-color', palette: 'tableau10' } }]) {
    const p = source().createLayerPlot({ id: 'other', source: 'plot', plot: { action: 'createScatterPlot' } }).encodeColor({ target: 'other', ...color });
    const context = adding(p);
    assert.equal(context.colorSharingCompatible, false); assert.equal(context.sourceSelection.color, '');
    assert.equal(parallel(p, context).build(parallel(p, context).values).share.color, undefined);
  }
  const p = source().createAdjacentPlot({ id: 'second', source: 'layer', share: {},
    plot: { action: 'createParallelCoordinates', options: { dimensions: ['RI', 'Na', 'Mg'], color: { field: 'class', fieldType: 'nominal', scale: { palette: 'observable10', domain: [1, 2, 3, 5, 6, 7] } } } } });
  const q = p.createAdjacentPlot({ id: 'third', source: { childPath: ['layer'], id: 'layer' }, share: {},
    plot: { action: 'createParallelCoordinates', options: { dimensions: ['RI', 'Na', 'Mg'], color: { field: 'class', fieldType: 'nominal', scale: { palette: 'observable10', domain: [7, 6, 5, 3, 2, 1] } } } } });
  assert.equal(adjacentColorContext(q, q.children[p.compositionSpec.id].children.layer, undefined).compatible, false);
});
