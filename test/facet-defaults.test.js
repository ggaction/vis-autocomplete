import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { createRecommendationEngine } from '../src/engine.js';
import { facetCandidates } from '../src/facet-candidates.js';
import { profileDataset } from '../src/profile.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';

const expected = new Map([[2, 2], [3, 3], [4, 4], [5, 5], [6, 3], [7, 7], [8, 4], [9, 3], [10, 5], [11, 11], [12, 4]]);
const rows = Array.from({ length: 24 }, (_, i) => ({ X: i, Y: i * 2,
  ...Object.fromEntries([...expected.keys()].map(count => [`Group${count}`, `G${i % count}`])) }));
const raw = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows })
  .createScatterPlot({ id: 'plot', x: 'X', y: 'Y' });
const profile = profileDataset(raw, 'data');
const candidates = facetCandidates(raw, { layer: raw.semanticSpec.layers[0], profile }).filter(c => c.method === 'facet');
const evidence = { settings: {
  columns: { charts: 100, values: [{ value: 2, charts: 100, weight: 100 }] },
  gap: { charts: 100, values: [{ value: 16, charts: 100, weight: 100 }] },
} };
const recommendation = field => ({ ...candidates.find(c => c.args.field === field),
  alternatives: candidates, defaultEvidence: evidence });

test('facet recommendations and editors use the requested exact group-count layouts over corpus column counts', () => {
  for (const [count, columns] of expected) {
    const rec = recommendation(`Group${count}`);
    assert.equal(rec.args.columns, columns, `candidate with ${count} panels`);
    const editor = recommendationParameters(rec, profile);
    const values = valuesFor(editor.controls);
    assert.equal(values.columns, columns, `editor with ${count} panels`);
    assert.equal(editor.build(values).columns, columns);
    assert.equal(values.gap, 16, 'other parameters still use corpus defaults');
    assert.ok(editor.controls.find(c => c.key === 'columns').max >= columns);
    assert.ok(!editor.defaultDecisions.some(d => d.control === 'columns'));
  }
});

test('changing a facet field previews its own default while explicit column choices remain adjustable', () => {
  const editor = recommendationParameters(recommendation('Group7'), profile);
  let values = valuesFor(editor.controls);
  values = editor.normalizeValues({ ...values, columns: 5 }, 'columns');
  assert.equal(editor.build(values).columns, 5);
  values = editor.normalizeValues({ ...values, gap: 20 }, 'gap');
  assert.equal(editor.build(values).columns, 5, 'unrelated changes preserve a user choice');
  for (const [count, columns] of expected) {
    values = editor.normalizeValues({ ...values, field: `Group${count}` }, 'field');
    assert.equal(values.columns, columns);
    assert.equal(editor.build(values).field, `Group${count}`);
    assert.equal(editor.build(values).columns, columns);
    assert.ok(editor.resolveControls(values).find(c => c.key === 'columns').max >= columns);
  }
  const restored = recommendationParameters({ ...recommendation('Group7'),
    parameterValues: { field: 'Group7', columns: 2, gap: 12 } }, profile);
  assert.equal(restored.build(valuesFor(restored.controls)).columns, 2);
});

test('ranked facets carry source group counts even when the editor profile omits partition fields', () => {
  const engine = createRecommendationEngine(JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url))));
  const rec = engine.rank(raw, { target: 'plot', group: 'encoding', limit: 1000 }).recommendations.find(r => r.method === 'facet');
  assert.equal(rec.facetFieldCounts.Group7, 7);
  const editor = recommendationParameters(rec, { ...profile, fields: profile.fields.filter(f => ['X', 'Y'].includes(f.name)) });
  const values = editor.normalizeValues({ ...valuesFor(editor.controls), field: 'Group7' }, 'field');
  assert.equal(editor.build(values).columns, 7);
});

test('seven- and eight-panel native facets render full rows and layout edits can retain seven columns', () => {
  for (const [count, columns] of [[7, 7], [8, 4]]) {
    const editor = recommendationParameters(recommendation(`Group${count}`), profile);
    const result = prepareGuidedAction(raw, { method: 'facet', args: editor.build(valuesFor(editor.controls)) });
    assert.equal(result.preview.compositionSpec.columns, columns);
    assert.equal(Object.keys(result.preview.children).length, count);
    const layout = facetCandidates(result.authoringPreview, { layer: raw.semanticSpec.layers[0], profile })
      .find(c => c.method === 'editCompositionLayout');
    assert.ok(layout.parameters.find(p => p.path === 'columns').max >= count);
  }
});
