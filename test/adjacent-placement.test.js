import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { createTransitionScene } from 'ggaction/scene';
import { validateCanvasScene } from '../vendor/transition/src/canvas-player.js';
import { adjacentContext, adjacentSpecs } from '../web/composition-controls.js';
import { adjacentPlacements, adjacentPlacementBounds } from '../src/adjacent-placement.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { chartAtPath, editableChartTargets } from '../src/composition-context.js';
import { compositionPlotBounds } from '../vendor/ggaction/src/materialization/composition.js';

const engine = createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url))));
const rows = Array.from({ length: 12 }, (_, i) => ({ x: i % 3 + 1, y: i + 2, g: i % 2 ? 'A' : 'B' }));
const unit = () => chart().createCanvas({ plot: { width: 220, height: 220 }, margin: 90 })
  .createData({ id: 'data', values: rows }).createBarPlot({ id: 'bar', x: 'x', y: 'y', color: 'g' });
const pair = () => unit().createAdjacentPlot({ id: 'line', source: 'bar', position: 'right' });

test('placement enumerates real panels and groups in visual order, without duplicating overlays or facet cells', () => {
  const p = pair().createOverlay({ target: { childPath: ['bar'] }, id: 'points', source: 'bar', type: 'point' });
  assert.deepEqual(adjacentPlacements(p).map(p => p.childPath), [['bar'], ['line'], []]);
  const adding = adjacentContext(p, { childPath: ['bar'], target: 'points' }, 'bottom', undefined, []);
  assert.equal(adding.id, 'bar', 'an overlay keeps its own panel as the initial data source');
  const nested = p.createAdjacentPlot({ target: { childPath: ['line'] }, source: 'line', id: 'third', position: 'bottom' });
  assert.deepEqual(adjacentPlacements(nested).map(p => p.childPath), [['bar'], ['line', 'line'], ['line', 'third'], ['line'], []]);
  const faceted = unit().facet({ field: 'g', columns: 2 });
  assert.equal(adjacentPlacements(faceted).length, 1);
  assert.equal(adjacentPlacements(faceted).at(0).sources.length, 1);
});

for (const position of ['left', 'right', 'top', 'bottom']) {
  for (const receivingPath of [['bar'], ['line'], []]) test(`${position} insertion at ${JSON.stringify(receivingPath)} prepares, replays and produces valid Canvas scenes`, () => {
    const p = pair(), adding = adjacentContext(p, { target: 'line', childPath: ['line'] }, position, undefined, receivingPath);
    const spec = adjacentSpecs(engine, adding, p).find(spec => spec.build(spec.values).plot.action === 'createLinePlot');
    assert.ok(spec);
    const args = spec.build(spec.values), action = { method: spec.method, args };
    assert.deepEqual(args.target?.childPath ?? [], receivingPath);
    assert.deepEqual(args.source, receivingPath.length ? receivingPath[0] : { childPath: ['line'], id: 'line' });
    const prepared = prepareGuidedAction(p, action, p, spec.setup(spec.values));
    assert.equal(prepared.recommendation.validation.topLevelActions, 1);
    let replay = p;
    for (const call of [...prepared.prerequisiteCalls, prepared.recommendation, ...prepared.postActionCalls]) replay = replay[call.method](call.args);
    assert.deepEqual(replay.graphicSpec, prepared.authoringPreview.graphicSpec);
    const restored = deserializeProgram(serializeProgram(prepared.preview));
    assert.deepEqual(restored.graphicSpec, prepared.preview.graphicSpec);
    assert.equal(editableChartTargets(restored).filter(t => !t.overlay).length, 3);
    const added = chartAtPath(restored, spec.original.nextContext.childPath);
    assert.ok(added.semanticSpec.layers.find(layer => layer.id === spec.original.nextContext.target));
    const before = createTransitionScene(p, { format: 'canvas' }), after = createTransitionScene(restored, { format: 'canvas' });
    assert.ok(validateCanvasScene(before)); assert.ok(validateCanvasScene(after));
    const bounds = adjacentPlacementBounds(restored);
    assert.ok([...bounds.values()].every(box => Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0));
    if (!receivingPath.length) {
      const old = compositionPlotBounds(p), addedBounds = compositionPlotBounds(added);
      const horizontal = ['left', 'right'].includes(position);
      assert.equal(horizontal ? addedBounds.height : addedBounds.width, horizontal ? old.height : old.width);
    }
  });
}

test('nested group setup retains its source path and a different explicit source is selectable', () => {
  let p = pair().createAdjacentPlot({ target: { childPath: ['line'] }, id: 'third', source: 'line', position: 'bottom' });
  const context = { target: 'third', childPath: ['line', 'third'] };
  let adding = adjacentContext(p, context, 'right', undefined, ['line']);
  assert.deepEqual(adding.childPath, ['line', 'third']);
  adding = adjacentContext(p, context, 'right', undefined, ['line'], { childPath: ['line', 'line'], id: 'line' });
  assert.deepEqual(adding.childPath, ['line', 'line']);
  const spec = adjacentSpecs(engine, adding, p).find(spec => spec.build(spec.values).plot.action === 'createLinePlot');
  const args = spec.build(spec.values);
  assert.deepEqual(args.source, { childPath: ['line'], id: 'line' });
  // A real dataset prerequisite belongs to the source child, not the receiving concat.
  const setup = [{ method: 'createSummaryData', args: { target: { childPath: adding.childPath }, id: 'summary',
    source: 'data', groupBy: ['x', 'g'], aggregates: [{ op: 'sum', field: 'y', as: 'y' }] } }];
  args.plot.options.data = 'summary';
  const prepared = prepareGuidedAction(p, { method: spec.method, args }, p, setup);
  assert.deepEqual(prepared.prerequisiteCalls[0].args.target.childPath, adding.childPath);
  const added = chartAtPath(prepared.authoringPreview, spec.original.nextContext.childPath);
  assert.ok(added.semanticSpec.datasets.some(data => data.id === 'summary'));
  assert.equal(editableChartTargets(prepared.preview).length, 4);
});
