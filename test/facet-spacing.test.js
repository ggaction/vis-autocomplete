import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { facetCandidates } from '../src/facet-candidates.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { createCalculationService } from '../web/calculation-service.js';

const rows = Array.from({ length: 18 }, (_, i) => ({ X: i, Y: i * 2, Group: ['A', 'B', 'C'][i % 3], Series: ['One', 'Two'][i % 2] }));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows })
  .createScatterPlot({ id: 'plot', x: 'X', y: 'Y' });
const action = (args = {}) => ({ method: 'facet', args: { field: 'Group', columns: 3,
  spacing: 'plot', gap: 0, guides: { axes: 'outer', legend: false }, ...args } });
function origins(program) {
  return program.graphicSpec.objects.canvas.children.filter(id => id.endsWith('_canvas'))
    .map(id => program.graphicSpec.objects[id].properties);
}

test('facet gap separates data regions rather than repeating the source canvas margins', () => {
  const raw = base(), before = JSON.stringify(raw.graphicSpec);
  const legacy = raw.facet({ ...action().args, spacing: 'canvas' });
  assert.equal(origins(legacy)[1].x - origins(legacy)[0].x - 314, 386);
  for (const gap of [0, 5, 12, 40]) {
    const result = prepareGuidedAction(raw, action({ gap }));
    const cells = origins(result.preview);
    assert.equal(cells[1].x - cells[0].x - 314, gap);
    assert.equal(cells[2].x - cells[1].x - 314, gap);
    assert.equal(result.recommendation.validation.topLevelActions, 1);
    assert.equal(result.recommendation.args.gap, gap);
    assert.equal(result.preview.compositionSpec.spacing, 'plot');
    assert.equal(result.preview.trace.children.at(-1).op, 'createGuides');
  }
  assert.equal(JSON.stringify(raw.graphicSpec), before);
});

test('wrapping and grid facets reserve only the minimum space required by native headers and labels', () => {
  const raw = base();
  const actions = [action({ columns: 2 }), action({ columns: 1 }),
    { method: 'facetGrid', args: { data: 'data', rows: { field: 'Group' }, columns: { field: 'Series' },
      spacing: 'plot', gap: 0, guides: { axes: 'outer', legend: false } } }];
  for (const requested of actions) {
    const result = prepareGuidedAction(raw, requested), gap = result.recommendation.args.gap;
    assert.ok(gap >= 0 && gap < 80, `${requested.method}: ${gap}`);
    if (gap > 0) assert.throws(() => raw[requested.method]({ ...result.recommendation.args, gap: gap - 1 }), /Plot spacing gap is too small/);
    assert.deepEqual(raw[requested.method](result.recommendation.args).graphicSpec, result.authoringPreview.graphicSpec);
    assert.ok(renderToSVG(result.preview).startsWith('<svg'));
  }
});

test('candidate parameter editors use plot gaps for new facets and legacy facet layout edits', () => {
  const raw = base(), profile = profileDataset(raw, 'data');
  for (const candidate of facetCandidates(raw, { layer: raw.semanticSpec.layers[0], profile })) {
    assert.equal(candidate.args.spacing, 'plot');
    const editor = recommendationParameters({ ...candidate, alternatives: [candidate] }, profile);
    const args = editor.build(valuesFor(editor.controls));
    assert.equal(args.spacing, 'plot');
    assert.ok(prepareGuidedAction(raw, { method: candidate.method, args }).preview.compositionSpec);
  }
  const legacy = raw.facet({ ...action().args, spacing: 'canvas' });
  const rec = facetCandidates(legacy, { layer: legacy.semanticSpec.layers[0], profile }).find(c => c.method === 'editCompositionLayout');
  const editor = recommendationParameters({ ...rec, alternatives: [rec] }, profile);
  const args = editor.build(valuesFor(editor.controls));
  const result = prepareGuidedAction(legacy, { method: rec.method, args });
  assert.equal(result.preview.compositionSpec.spacing, 'plot');
  assert.ok(result.preview.graphicSpec.objects.canvas.properties.height < 1200);
});

test('later facet header and guide edits fit explicitly and survive worker/persistence replay', () => {
  const start = prepareGuidedAction(base(), action({ columns: 2 }));
  const before = JSON.stringify(start.authoringPreview.graphicSpec);
  for (const edit of [{ method: 'editFacetHeaders', args: { fontSize: 22, offset: 10 } },
    { method: 'editFacetGuides', args: { axes: 'each' } }]) {
    const result = prepareGuidedAction(start.authoringPreview, edit, start.preview);
    assert.equal(result.prerequisiteCalls.length, 1);
    assert.equal(result.prerequisiteCalls[0].method, 'editCompositionLayout');
    const gap = result.prerequisiteCalls[0].args.gap;
    assert.ok(gap > start.preview.compositionSpec.gap && gap < 100);
    assert.equal(result.recommendation.method, edit.method);
    assert.equal(result.recommendation.validation.topLevelActions, 1);
    let replay = start.authoringPreview;
    for (const call of [...result.prerequisiteCalls, result.recommendation, result.guideCall]) replay = replay[call.method](call.args);
    assert.deepEqual(replay.graphicSpec, result.preview.graphicSpec);
    const service = createCalculationService();
    service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(start.authoringPreview), guideCall: start.guideCall });
    const remote = service.execute({ type: 'materialize', stateId: 1, action: edit });
    assert.deepEqual(deserializeProgram(remote.snapshot).graphicSpec, result.authoringPreview.graphicSpec);
  }
  assert.equal(JSON.stringify(start.authoringPreview.graphicSpec), before);
  assert.throws(() => prepareGuidedAction(base(), action({ field: 'missing' })), /missing/);
});
