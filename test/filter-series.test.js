import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { extendedCandidates } from '../src/extended-catalog.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { neighboringParameters } from '../src/engine.js';
const rows = ['A', 'B', 'C', 'D'].flatMap((series, i) => [1, 2, 3].map(x => ({ series, x, y: x + i })));
const recipe = p => {
  const layer = p.semanticSpec.layers[0];
  return extendedCandidates(p, { layer, profile: profileDataset(p, layer.data) }).find(r => r.label === 'Filter series');
};
for (const method of ['createLinePlot', 'createAreaPlot']) test(`${method}: series filter keeps multiple selections and restores all original series`, () => {
  const original = chart().createCanvas({ plot: { width: 250, height: 250 }, margin: 100 }).createData({ id: 'd', values: rows })
    [method]({ id: 'plot', data: 'd', x: 'x', y: 'y', color: 'series', ...(method === 'createAreaPlot' ? { groupBy: ['series'] } : {}) });
  const rec = recipe(original), profile = profileDataset(original, 'd');
  const editor = recommendationParameters({ ...rec, alternatives: [rec] }, profile);
  const control = editor.controls.find(c => c.type === 'multiselect');
  assert.equal(control.selectAll, true);
  const parameters = { ...valuesFor(editor.controls), [control.key]: ['A', 'C'] };
  const args = editor.build(parameters);
  assert.deepEqual(args.values, ['A', 'C']); assert.equal(args.op, 'oneOf');
  const filtered = original.filterMarks(args);
  assert.deepEqual([...new Set(filtered.semanticSpec.datasets.find(d => d.id === filtered.semanticSpec.layers[0].data).values.map(r => r.series))], ['A', 'C']);
  const next = recipe(filtered);
  assert.deepEqual(next.parameters[0].choices.map(c => c.value), ['A', 'B', 'C', 'D']);
  assert.deepEqual(next.args.values, ['A', 'C']);
  assert.ok(neighboringParameters(next).every(r => Array.isArray(r.args.values) && r.args.values.length >= 1));
  const restored = filtered.filterMarks({ ...next.args, values: next.parameters[0].choices.map(c => c.value) });
  assert.equal(restored.semanticSpec.datasets.find(d => d.id === restored.semanticSpec.layers[0].data).values.length, rows.length);
});
