import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { createTransitionScene } from 'ggaction/scene';
import { validateCanvasScene } from '../vendor/transition/src/canvas-player.js';
import { adjacentContext, adjacentSpecs } from '../web/composition-controls.js';
import { adjacentPlacements, adjacentPlacementBounds, adjacentHandlePositions } from '../src/adjacent-placement.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { chartAtPath, editableChartTargets } from '../src/composition-context.js';
import { compositionPlotBounds } from '../vendor/ggaction/src/materialization/composition.js';
import { canvasGeometry, fitCanvasViewport } from '../src/canvas-geometry.js';

const engine = createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url))));
const rows = Array.from({ length: 12 }, (_, i) => ({ x: i % 3 + 1, y: i + 2, g: i % 2 ? 'A' : 'B' }));
const unit = () => chart().createCanvas({ plot: { width: 220, height: 220 }, margin: 90 })
  .createData({ id: 'data', values: rows }).createBarPlot({ id: 'bar', x: 'x', y: 'y', color: 'g' });
const pair = () => unit().createAdjacentPlot({ id: 'line', source: 'bar', position: 'right' });

test('equivalent outer insertion edges have one button, while distinct spans remain available', () => {
  for (const position of ['bottom', 'right']) {
    const program = unit().createAdjacentPlot({ id: 'line', source: 'bar', position });
    const geometry = canvasGeometry(program), bounds = adjacentPlacementBounds(program);
    const handles = adjacentHandlePositions(adjacentPlacements(program), bounds, fitCanvasViewport(geometry, 700, 500), { width: 700, height: 500 });
    for (const edge of position === 'bottom' ? ['top', 'bottom'] : ['left', 'right']) {
      const outer = handles.filter(h => h.position === edge && h.choice.childPath.length === 0);
      assert.equal(outer.length, 1);
      const root = bounds.get('[]'), horizontal = ['left', 'right'].includes(edge), before = ['top', 'left'].includes(edge);
      const coordinate = box => horizontal ? box.x + (before ? 0 : box.width) : box.y + (before ? 0 : box.height);
      assert.equal(handles.filter(h => h.position === edge && Math.abs(coordinate(bounds.get(JSON.stringify(h.choice.childPath))) - coordinate(root)) < .01).length, 1);
    }
    const broadEdge = position === 'bottom' ? 'right' : 'bottom';
    assert.equal(handles.filter(h => h.position === broadEdge).length, 3, 'two panels plus their wider/taller enclosing group');
    assert.equal(geometry.controlInset, 44, 'control space never grows with nesting');
  }
});

test('fitted add controls clear canvas resize edges, including shared guides and nested groups', () => {
  const nested = pair().createAdjacentPlot({ id: 'third', source: { childPath: ['bar'], id: 'bar' }, position: 'bottom' });
  for (const program of [unit(), pair(), nested, unit().facet({ field: 'g', columns: 2 })]) {
    const geometry = canvasGeometry(program), bounds = adjacentPlacementBounds(program);
    for (const [width, height] of [[510, 245], [510, 640], [600, 340], [900, 700]]) {
      const view = fitCanvasViewport(geometry, width, height);
      const handles = adjacentHandlePositions(adjacentPlacements(program), bounds, view, { width, height });
      const right = view.left + geometry.width * view.scale, bottom = view.top + geometry.height * view.scale;
      for (const h of handles) {
        assert.ok(h.x >= 13 && h.x <= width - 13 && h.y >= 13 && h.y <= height - 13, 'button remains visible');
        // Canvas resize hit strips extend 6px outside the line. Keep at least
        // another 5px between the strips and a button's 13px half-width.
        if (h.y > view.top - 13 && h.y < bottom + 13) assert.ok(Math.abs(h.x - right) >= 24, `${h.position} clears right handle`);
        if (h.x > view.left - 13 && h.x < right + 13) assert.ok(Math.abs(h.y - bottom) >= 24, `${h.position} clears bottom handle`);
      }
      for (let i = 0; i < handles.length; i++) for (let j = i + 1; j < handles.length; j++) {
        assert.ok(Math.hypot(handles[i].x - handles[j].x, handles[i].y - handles[j].y) >= 16, JSON.stringify({ width, height, first: handles[i], second: handles[j] }));
      }
      assert.equal(view.left + geometry.width * view.scale / 2, width / 2);
      assert.equal(view.top + geometry.height * view.scale / 2, height / 2);
    }
  }
});

test('spatial handles distinguish left, whole-row and right placement, including tight viewports', () => {
  const program = pair(), placements = adjacentPlacements(program), bounds = adjacentPlacementBounds(program);
  for (const scale of [.35, .7, 1]) {
    const handles = adjacentHandlePositions(placements, bounds, { left: 0, top: 0, scale }, { width: 900 * scale, height: 400 * scale });
    const bottom = handles.filter(h => h.position === 'bottom');
    assert.equal(bottom.length, 3);
    assert.ok(bottom[0].x < bottom[2].x && bottom[2].x < bottom[1].x);
    assert.ok(bottom[2].y >= Math.max(bottom[0].y, bottom[1].y) + 3);
    const top = handles.filter(h => h.position === 'top');
    assert.ok(top[2].y <= Math.min(top[0].y, top[1].y) - 3);
    assert.ok(handles.every(h => h.x >= 13 && h.y >= 13 && h.x <= 900 * scale - 13 && h.y <= 400 * scale - 13));
  }
});

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
    const spec = adjacentSpecs(engine, adding, p).find(spec => /^Add Scatter/i.test(spec.title));
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
  const spec = adjacentSpecs(engine, adding, p).find(spec => /^Add Scatter/i.test(spec.title));
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
