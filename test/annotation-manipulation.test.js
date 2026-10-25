import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, hconcat } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { replayPrepared } from './support/prepared.js';
import { selectableGuides, moveGuide, resizeGuide, removeGuide, guideMoveHistoryKey } from '../src/guide-manipulation.js';
import { manipulationTargets, manipulationCalls, prepareGuideEdits } from '../src/guide-group.js';
import { typographyCalls } from '../src/chart-typography.js';
import { canvasGeometry } from '../src/canvas-geometry.js';

const rows = [{ x: 10, y: 20, g: 'A' }, { x: 30, y: 60, g: 'B' }];
const base = () => chart().createCanvas({ plot: { width: 314, height: 280 }, margin: { left: 170, right: 216, top: 42, bottom: 74 } })
  .createData({ id: 'd', values: rows }).createScatterPlot({ id: 'p', x: 'x', y: 'y' });
const annotated = () => base().createAnnotation({ id: 'note', anchor: 'plot-center', data: 'd', coordinate: 'main', text: 'A note', fontSize: 14 });
const annotations = p => selectableGuides(p).filter(t => t.kind === 'annotation');
const apply = (p, action) => {
  const result = prepareGuidedAction(p, action, p), next = result.preview;
  assert.deepEqual(replayPrepared(result).graphicSpec, next.graphicSpec);
  assert.deepEqual(deserializeProgram(serializeProgram(next)).graphicSpec, next.graphicSpec);
  return next;
};

for (const kind of ['linear', 'log', 'nominal', 'reversed']) test(`Add annotation starts in the plot center with ${kind} axes`, () => {
  let p = base();
  if (kind === 'log') p = p.editXScale({ target: 'p', type: 'log' });
  if (kind === 'nominal') p = p.encodeX({ target: 'p', field: 'g', fieldType: 'nominal', scale: { id: 'category', type: 'point' } });
  if (kind === 'reversed') p = p.editYScale({ target: 'p', reverse: true });
  const layer = p.semanticSpec.layers.find(l => l.id === 'p');
  const candidate = generateCandidates(p, { layer, profile: profileDataset(p, 'd') }).find(c => c.method === 'createAnnotation');
  assert.equal(candidate.args.anchor, 'plot-center');
  assert.equal(candidate.args.coordinate, layer.coordinate);
  const next = apply(p, candidate), note = next.graphicSpec.objects[candidate.args.id].items[0].properties;
  const geometry = canvasGeometry(next);
  assert.equal(note.x, geometry.x + geometry.plot.width / 2);
  assert.equal(note.y, geometry.y + geometry.plot.height / 2);
  for (const axis of ['x', 'y']) assert.deepEqual(next.resolvedScales[layer.encoding[axis].scale].domain, p.resolvedScales[layer.encoding[axis].scale].domain);
});

test('annotations move freely, resize multiline text, and preserve text, anchor and styling', () => {
  const p = annotated().encodeText({ target: 'note', value: 'A note\nSecond line' })
    .editTextMark({ target: 'note', rotation: .2, lineHeight: 20, fill: '#227755' });
  const target = annotations(p)[0];
  const moved = apply(p, moveGuide(p, target, 0, 0, { dx: 26, dy: -18 }));
  const item = q => q.graphicSpec.objects.note.items[0].properties;
  // Automatic margin fitting may translate the plot; the annotation's offset
  // relative to its anchor must still match the pointer's logical delta.
  const a = canvasGeometry(p), b = canvasGeometry(moved);
  assert.ok(Math.abs(item(moved).x - b.x - (item(p).x - a.x) - 26) < 1e-8);
  assert.ok(Math.abs(item(moved).y - b.y - (item(p).y - a.y) + 18) < 1e-8);
  const next = apply(moved, resizeGuide(annotations(moved)[0], 1.5));
  assert.equal(next.markConfigs.note.fontSize, 21);
  assert.equal(next.markConfigs.note.lineHeight, 30);
  assert.equal(next.markConfigs.note.rotation, .2);
  assert.equal(next.markConfigs.note.fill, '#227755');
  assert.deepEqual(next.semanticSpec.layers.find(l => l.id === 'note'), p.semanticSpec.layers.find(l => l.id === 'note'));
  const removed = apply(next, removeGuide(annotations(next)[0]));
  assert.equal(annotations(removed).length, 0);
  assert.ok(removed.graphicSpec.objects.p);
});

test('consecutive drags can be rebased as one history edit without losing accumulated movement', () => {
  const p = annotated(), a = annotations(p)[0];
  const first = apply(p, moveGuide(p, a, 0, 0, { dx: 20, dy: 12 }));
  const b = annotations(first)[0];
  assert.equal(guideMoveHistoryKey(a), guideMoveHistoryKey(b));
  const next = apply(p, moveGuide(first, b, 0, 0, { dx: 7, dy: -4 }));
  assert.equal(next.markConfigs.note.dx, 27);
  assert.equal(next.markConfigs.note.dy, 8);
});

test('annotation selection supports typography and mixed title group resizing', () => {
  const p = annotated().createTitle({ text: 'Title' });
  const guides = selectableGuides(p), note = annotations(p)[0];
  const calls = typographyCalls(p, { elements: [note.key], delta: 1 });
  assert.deepEqual(calls, [{ method: 'editTextMark', args: { target: 'note', fontSize: 15 } }]);
  const targets = manipulationTargets(guides, new Set([note.key, 'title']), note, 'resize');
  const next = prepareGuideEdits(p, p, manipulationCalls(p, targets, 'resize', { factor: 2 })).view;
  assert.equal(next.markConfigs.note.fontSize, 28);
  assert.equal(next.titleConfig.titleStyle.fontSize, p.titleConfig.titleStyle.fontSize * 2);
});

test('facet copies have separate hit boxes but one replayable source edit', () => {
  const p = annotated().facet({ field: 'g', columns: 2 }), notes = annotations(p);
  assert.equal(notes.length, 2);
  assert.ok(notes[0].bounds.right < notes[1].bounds.left);
  const targets = manipulationTargets(selectableGuides(p), new Set(notes.map(t => t.key)), notes[0], 'resize');
  assert.equal(targets.length, 1);
  for (const action of [resizeGuide(notes[0], 1.5), moveGuide(p, notes[1], 0, 0, { dx: 12, dy: 8 }),
    ...typographyCalls(p, { elements: notes.map(t => t.key), delta: 1 }), removeGuide(notes[0])]) {
    assert.equal(action.method, 'editFacetSource');
    const next = apply(p, action);
    for (const child of Object.values(next.children)) {
      if (action.args.action.method === 'removeMark') assert.equal(child.markConfigs.note, undefined);
      else for (const [key, value] of Object.entries(action.args.action.options)) if (key !== 'target') assert.equal(child.markConfigs.note[key], value);
    }
  }
});

test('nested adjacent charts scope annotation edits to the selected panel', () => {
  const inner = hconcat({ programs: [{ id: 'a', program: annotated() }, { id: 'b', program: annotated() }] });
  const p = hconcat({ programs: [{ id: 'pair', program: inner }, { id: 'c', program: annotated() }] });
  const target = annotations(p).find(t => t.key === 'pair/b/annotation:note');
  assert.ok(target);
  const next = apply(p, moveGuide(p, target, 0, 0, { dx: -15, dy: 9 }));
  assert.equal(next.children.pair.children.b.markConfigs.note.dx, -15);
  assert.equal(next.children.pair.children.b.markConfigs.note.dy, 9);
  assert.equal(next.children.pair.children.a.markConfigs.note.dx, 0);
  assert.equal(next.children.c.markConfigs.note.dx, 0);
  assert.equal(apply(next, resizeGuide(annotations(next).find(t => t.key === target.key), 2)).children.pair.children.b.markConfigs.note.fontSize, 28);
});

test('legacy data annotations remain editable and data-bound labels are excluded', () => {
  const p = base().createAnnotation({ id: 'custom-label', source: 'p', x: 20, y: 40, text: 'Old note' })
    .createMarkLabels({ source: 'p', field: 'y' });
  const notes = annotations(p);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].args.target, 'custom-label');
  assert.equal(apply(p, resizeGuide(notes[0], 2)).markConfigs['custom-label'].fontSize, p.markConfigs['custom-label'].fontSize * 2);
});

test('annotation IDs with the same suffix keep distinct owners, including inside facets', () => {
  const unit = annotated().createAnnotation({ id: 'another_note', anchor: 'plot-center', text: 'Another note', dx: 40 });
  for (const p of [unit, unit.facet({ field: 'g', columns: 2 })]) {
    const notes = annotations(p);
    assert.equal(notes.length, p.compositionSpec ? 4 : 2);
    assert.equal(new Set(notes.map(t => t.key)).size, notes.length);
    for (const note of notes) {
      const next = apply(p, resizeGuide(note, 2));
      const other = note.args.target === 'note' ? 'another_note' : 'note';
      assert.equal(next.markConfigs[other].fontSize, p.markConfigs[other].fontSize);
    }
  }
});
