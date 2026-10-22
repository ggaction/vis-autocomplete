import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { createTransitionScene } from 'ggaction/scene';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { renderToSVG } from 'ggaction/svg';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { facetCandidates } from '../src/facet-candidates.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { createCalculationService } from '../web/calculation-service.js';

const rows = Array.from({ length: 24 }, (_, i) => ({ X: i + 1, Y: i * 2 + 1,
  Amount: i + 2, Alpha: (i % 8) + 1, Group: ['A', 'B', 'C'][i % 3], Panel: ['One', 'Two'][i % 2] }));
function source(extra = false) {
  let p = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows })
    .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: { field: 'Group', fieldType: 'nominal' } });
  if (extra) p = p.encodeSize({ target: 'plot', field: 'Amount' })
    .encodeOpacity({ target: 'plot', field: 'Alpha' })
    .encodeShape({ target: 'plot', field: 'Group', fieldType: 'nominal' });
  return p;
}
function editorFor(p, method) {
  const profile = profileDataset(p, 'data');
  const alternatives = facetCandidates(p, { layer: p.semanticSpec.layers[0], profile }).filter(c => c.method === method);
  const recommendation = { ...alternatives[0], alternatives };
  return { recommendation, editor: recommendationParameters(recommendation, profile) };
}
function assertOneOwner(p, titles) {
  assert.equal(p.compositionSpec.facet.guides.legend, 'shared');
  const objects = p.graphicSpec.objects;
  assert.ok(objects[`${p.compositionSpec.id}-shared-legend`]);
  // Check concrete graphics, not just semantic configs (children retain recipes).
  const legendTitles = Object.keys(objects).filter(id => /(?:Legend|Gradient)Title$/.test(id));
  assert.deepEqual(legendTitles.sort(), titles.toSorted());
  const scene = createTransitionScene(p, { format: 'canvas' });
  const svg = renderToSVG(p);
  for (const id of titles) {
    const label = objects[id].properties.text;
    assert.equal(scene.nodes.filter(n => n.type === 'text' && n.properties.text === label).length, 1, label);
    assert.equal(svg.split(`>${label}</text>`).length - 1, 1, label);
  }
}

test('changing facet field preserves shared ownership for color and multiple appearance legends', () => {
  for (const extra of [false, true]) {
    const p = source(extra), { recommendation, editor } = editorFor(p, 'facet');
    const original = structuredClone(recommendation.args);
    for (const field of ['Group', 'Panel']) {
      const args = editor.build({ ...valuesFor(editor.controls), field, columns: 3 });
      assert.deepEqual(args.guides, original.guides);
      assert.deepEqual(args.scales, original.scales);
      assert.equal(args.data, 'data');
      const prepared = prepareGuidedAction(p, { method: 'facet', args });
      const titles = extra ? ['seriesLegendTitle', 'sizeLegendTitle', 'opacityLegendTitle'] : ['colorLegendTitle'];
      assertOneOwner(prepared.preview, titles);
      const restored = deserializeProgram(serializeProgram(prepared.preview));
      assertOneOwner(restored, titles);
      const edited = prepareGuidedAction(prepared.authoringPreview,
        { method: 'editFacetHeaders', args: { fontSize: 14 } }, prepared.preview);
      assertOneOwner(edited.preview, titles);
    }
    assert.deepEqual(recommendation.args, original);
  }
});

test('changing either grid dimension preserves shared scales and survives worker replay', () => {
  const p = source(true), { recommendation, editor } = editorFor(p, 'facetGrid');
  const values = valuesFor(editor.controls);
  const paths = recommendation.parameters.map(p => p.path);
  for (const [row, column] of [['Panel', 'Group'], ['Group', 'Panel']]) {
    const args = editor.build({ ...values, [`p${paths.indexOf('rows.field')}`]: row,
      [`p${paths.indexOf('columns.field')}`]: column });
    assert.deepEqual(args.guides, recommendation.args.guides);
    assert.deepEqual(args.scales, recommendation.args.scales);
    const prepared = prepareGuidedAction(p, { method: 'facetGrid', args });
    assertOneOwner(prepared.preview, ['seriesLegendTitle', 'sizeLegendTitle', 'opacityLegendTitle']);
    const service = createCalculationService();
    service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(p) });
    const remote = service.execute({ type: 'materialize', stateId: 1, action: { method: 'facetGrid', args } });
    const restored = deserializeProgram(remote.snapshot).createGuides(remote.guideCall.args);
    assertOneOwner(restored, ['seriesLegendTitle', 'sizeLegendTitle', 'opacityLegendTitle']);
  }
});

test('partition controls retain explicit independent policies and label child legends accurately', () => {
  const p = source(), { recommendation } = editorFor(p, 'facet');
  const fallback = recommendation.alternatives.find(a => a.args.guides.legend === false);
  const editor = recommendationParameters({ ...fallback, alternatives: recommendation.alternatives }, profileDataset(p, 'data'));
  const args = editor.build({ ...valuesFor(editor.controls), field: 'Group', columns: 3 });
  assert.equal(args.guides.legend, false);
  assert.deepEqual(args.scales, { color: 'independent' });
  const faceted = p.facet(args);
  const guides = facetCandidates(faceted, { layer: faceted.semanticSpec.layers[0], profile: profileDataset(faceted, 'data') })
    .find(c => c.method === 'editFacetGuides');
  assert.equal(guides.parameters.find(p => p.path === 'legend').choices.find(c => c.value === false).label, 'Per facet');
});
