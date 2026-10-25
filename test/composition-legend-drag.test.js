import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from '../vendor/ggaction/src/persistence.js';
import { editableGuides, moveGuide, resizeGuide } from '../src/guide-manipulation.js';
import { compositionPlotBounds } from '../vendor/ggaction/src/materialization/composition.js';
import { prepareGuidedAction } from '../src/prepare.js';
const rows = Array.from({ length: 24 }, (_, i) => ({ x: i + 1, y: i * 3 + 2, n: i % 5 + 3, g: ['A', 'B', 'C'][i % 3] }));
const source = () => chart().createCanvas({ plot: { width: 220, height: 314 }, margin: 170 })
  .createData({ id: 'd', values: rows }).createScatterPlot({ id: 'plot', x: 'x', y: 'y', color: { field: 'g' } })
  .encodeShape({ target: 'plot', field: 'g' }).encodeSize({ target: 'plot', field: 'n' })
  .createGuides({ legend: { target: 'plot', channels: ['color', 'size', 'shape'] } })
  .editLegend({ target: 'plot', channel: 'size', position: 'right', offset: 28.5, alongOffset: 108.25 })
  .createAdjacentPlot({ id: 'bars', source: 'plot', position: 'right', share: { color: true }, gap: 8,
    plot: { action: 'createBarPlot', options: { x: { field: 'x', bin: { maxBins: 10 } }, y: { field: 'y', aggregate: 'sum' } } } });
const size = p => editableGuides(p).find(t => t.kind === 'legend' && !t.part && t.channels.includes('size'));
for (const position of ['left', 'right', 'top', 'bottom']) test(`drag independent size legend to composition ${position}, with old explicit offset`, () => {
  const p = source(), original = serializeProgram(p), target = size(p), plot = compositionPlotBounds(p);
  assert.equal(target.childPath, undefined);
  assert.deepEqual(target.editTargets, [{ childPath: ['plot'], id: 'plot' }]);
  assert.ok(target.bounds.left > plot.x + plot.width);
  const [x, y] = position === 'left' ? [plot.x - 70, plot.y + plot.height / 2]
    : position === 'right' ? [plot.x + plot.width + 100, plot.y + plot.height / 2]
    : [plot.x + plot.width / 2, position === 'top' ? plot.y - 70 : plot.y + plot.height + 70];
  const dx = x - (target.bounds.left + target.bounds.right) / 2, dy = y - (target.bounds.top + target.bounds.bottom) / 2;
  const action = moveGuide(p, target, x, y, { dx, dy });
  assert.equal(action.args.position, position);
  const prepared = prepareGuidedAction(p, action, p), q = prepared.preview, after = size(q), area = compositionPlotBounds(q);
  assert.equal(after.key, target.key);
  assert.ok(position === 'left' ? after.bounds.right < area.x : position === 'right' ? after.bounds.left > area.x + area.width
    : position === 'top' ? after.bounds.bottom < area.y : after.bounds.top > area.y + area.height);
  assert.deepEqual(deserializeProgram(serializeProgram(q)).graphicSpec, q.graphicSpec);
  assert.equal(serializeProgram(p), original);
  const nudge = moveGuide(q, after, (after.bounds.left + after.bounds.right) / 2 + 5, (after.bounds.top + after.bounds.bottom) / 2 + 5, { dx: 5, dy: 5 });
  assert.ok(prepareGuidedAction(q, nudge, q).preview);
});

test('collected size legend resize and title/item selections still route to the original owner', () => {
  const p = source(), t = size(p), q = prepareGuidedAction(p, resizeGuide(t, 1.25), p).preview;
  assert.equal(size(q).key, t.key);
  assert.ok(size(q).bounds.bottom - size(q).bounds.top > t.bounds.bottom - t.bounds.top);
  assert.deepEqual(q.children.plot.semanticSpec.layers.find(l => l.id === 'plot').encoding,
    p.children.plot.semanticSpec.layers.find(l => l.id === 'plot').encoding);
});
