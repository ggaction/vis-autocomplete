import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { valueLabelFormat, valueLabelCandidates } from '../src/value-labels.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { createRecommendationEngine } from '../src/engine.js';
import { scopedCall } from '../src/composition-context.js';

const rows = [{ g: 'A', x: 1, y: 12.3456 }, { g: 'B', x: 2, y: 23.4567 }, { g: 'C', x: 3, y: 34.5678 }];
const base = (values = rows) => chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 170 }).createData({ id: 'data', values });
const labels = p => Object.entries(p.graphicSpec.objects).filter(([, object]) => object.type === 'text' && object.items)
  .flatMap(([, object]) => object.items.map(item => item.properties.text));
const candidate = p => valueLabelCandidates(p, p.semanticSpec.layers.find(layer => layer.id === 'plot'), profileDataset(p, 'data'))[0];
const editor = (p, rec = candidate(p)) => {
  const ed = recommendationParameters(rec, profileDataset(p, 'data'));
  return { rec, ed, values: valuesFor(ed.controls) };
};

test('automatic precision balances compact labels, meaningful differences and floating point noise', () => {
  assert.equal(valueLabelFormat([1, 23, 100]), '.0f');
  assert.equal(valueLabelFormat([12.3456, 23.4567]), '.2f');
  assert.equal(valueLabelFormat([-12.345, -.004321]), '.4f');
  assert.equal(valueLabelFormat([1.0001, 1.0002]), '.4f');
  assert.equal(valueLabelFormat([.1 + .2, .3]), '.2f');
  assert.equal(valueLabelFormat([1e12, 2e12]), '.2e');
  assert.equal(valueLabelFormat([1e14 + 1, 1e14 + 2]), '.0f');
  assert.equal(valueLabelFormat([1e12 + .1, 1e12 + .2]), '.1f');
  assert.equal(valueLabelFormat([1e-15, 2e-15]), '.2e');
  assert.equal(valueLabelFormat([0, null, NaN]), '.0f');
  assert.equal(valueLabelFormat([null, undefined, 'category']), 'auto');
  assert.equal(valueLabelFormat([123.456, 456.789], 5), '.0f');
});

for (const kind of ['bar', 'pie', 'point', 'line']) test(`${kind}: number controls execute native formats and category changes`, () => {
  const p = kind === 'pie' ? base().createPiePlot({ id: 'plot', category: 'g', value: 'y' }) :
    kind === 'bar' ? base().createBarPlot({ id: 'plot', x: 'g', y: { field: 'y', aggregate: 'sum' } }) :
    kind === 'line' ? base().createLinePlot({ id: 'plot', x: 'x', y: 'y' }) : base().createScatterPlot({ id: 'plot', x: 'x', y: 'y', color: 'g' });
  const { rec, ed, values } = editor(p);
  assert.equal(rec.args.format, '.2f');
  assert.equal(ed.controls.length, 4);
  for (const format of ['f', '%', 'e']) for (const decimals of [0, 2, 6, 12]) {
    const args = ed.build({ ...values, format, decimals });
    const next = p[rec.method](args);
    assert.equal(next.semanticSpec.layers.at(-1).encoding.text.format, `.${decimals}${format}`);
    assert.ok(labels(next).some(text => text.includes(format === '%' ? '%' : format === 'e' ? 'e+' : decimals ? '.' : '')));
    assert.deepEqual(deserializeProgram(serializeProgram(next)).graphicSpec, next.graphicSpec);
  }
  const categorical = rec.labelContext.bindings.find(binding => !binding.numeric);
  const v = { ...values, label: categorical.key, format: 'f', decimals: 5 };
  const args = ed.build(v); assert.equal(args.format, 'auto');
  assert.equal(Object.hasOwn(args, 'field') && Object.hasOwn(args, 'content'), false);
  assert.ok(p[rec.method](args));
  assert.equal(ed.controls.find(control => control.key === 'numberFormat').when(v), false);
});

test('automatic precision uses aggregated marks and existing labels can be reformatted without losing overrides', () => {
  const p = base([{ g: 'A', y: .123456 }, { g: 'A', y: .234567 }, { g: 'B', y: 5 }])
    .createBarPlot({ id: 'plot', x: 'g', y: { field: 'y', aggregate: 'sum' } });
  const rec = candidate(p), q = p[rec.method](rec.args);
  assert.ok(labels(q).includes('0.358'));
  const layer = q.semanticSpec.layers.at(-1);
  const customized = q.editTextMark({ target: layer.id, textOverrides: [{ match: { fields: { g: 'B' } }, occurrence: 0, text: 'Special' }] });
  const { rec: edit, ed, values } = editor(customized);
  assert.equal(edit.method, 'encodeText');
  const next = customized.encodeText(ed.build({ ...values, format: 'f', decimals: 4 }));
  assert.ok(labels(next).includes('0.3580')); assert.ok(labels(next).includes('Special'));
  assert.deepEqual(next.materializationConfigs.labelLayouts[layer.id].maxDisplacement, 12);
});

test('numeric categories stay literal and large scenes retain every value without costly automatic movement', () => {
  const p = base(Array.from({ length: 1001 }, (_, i) => ({ g: i % 2, x: i, y: i / 3 })))
    .createScatterPlot({ id: 'plot', x: 'x', y: 'y' });
  const rec = candidate(p); assert.equal(rec.args.layout, false);
  const next = p[rec.method](rec.args); assert.equal(next.graphicSpec.objects['plot-labels'].items.length, 1001);
  const bar = base([{ g: 1, y: .12 }, { g: 2, y: .23 }]).createBarPlot({ id: 'plot', x: { field: 'g', fieldType: 'ordinal' }, y: 'y' });
  const { ed, values } = editor(bar);
  assert.equal(ed.build({ ...values, label: 'content:category', format: 'f', decimals: 3 }).format, 'auto');
});

test('ranked label cards preserve their number editor through facet and adjacent scopes', () => {
  const engine = createRecommendationEngine(JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url))));
  let p = base().createBarPlot({ id: 'plot', x: 'g', y: { field: 'y', aggregate: 'sum' } });
  for (const scope of ['unit', 'facet', 'adjacent']) {
    if (scope === 'facet') p = p.facet({ field: 'g', columns: 3 });
    if (scope === 'adjacent') p = p.createAdjacentPlot({ id: 'right', source: 'plot', position: 'right', plot: { action: 'createScatterPlot', options: { x: 'x', y: 'y' } } });
    const local = scope === 'adjacent' ? p.children.plot : p;
    const result = engine.recommend(local, { target: 'plot', group: 'encoding', includeRevisions: true, validationMode: 'deferred', limit: 1000 });
    const rec = result.recommendations.find(rec => rec.method === 'createMarkLabels' || rec.args.action?.method === 'createMarkLabels');
    assert.ok(rec, scope);
    const ed = recommendationParameters(rec, profileDataset(local, 'data')), values = valuesFor(ed.controls);
    assert.ok(ed.controls.some(control => control.key === 'numberFormat'), scope);
    let action = { method: rec.method, args: ed.build({ ...values, format: 'f', decimals: 3 }) };
    if (scope === 'adjacent') action = scopedCall(action, [{ childPath: ['plot'] }]);
    const prepared = prepareGuidedAction(p, action);
    assert.ok(labels(prepared.preview).some(text => /^12\.346$/.test(text)), scope);
  }
});
