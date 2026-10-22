import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { createRecommendationEngine, profileDataset } from '../src/index.js';
import { regressionContext } from '../src/regression-context.js';
import { generateCandidates } from '../src/catalog.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
const engine = createRecommendationEngine(JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url))));
const rows = Array.from({ length: 24 }, (_, i) => ({ x: i % 8 + 1, y: (i % 8 + 1) * (1 + Math.floor(i / 8)) + (i % 3),
  Region: ['North','South','West'][Math.floor(i / 8)], Shape: i % 2 ? 'Odd' : 'Even', Panel: i % 2 ? 'P' : 'Q' }));
const base = (data = rows, color) => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'd', values: data })
  .createScatterPlot({ id: 'plot', data: 'd', x: 'x', y: 'y', ...(color ? { color } : {}) });
const context = p => {
  const layer = p.semanticSpec.layers.find(l => l.id === 'plot'), profile = profileDataset(p, 'd');
  return { layer, profile, regressionContext: regressionContext(p, layer, profile) };
};
const facet = (p, field = 'Region') => p.facet({ field, data: 'd', columns: 3, spacing: 'plot', gap: 40, guides: { axes: 'outer', legend: p.semanticSpec.layers[0].encoding.color ? 'shared' : false } });

for (const faceted of [false, true]) test(`ranked recommendation, editor, replay and native grouping agree (facet=${faceted})`, () => {
  let p = base(rows, 'Region'); if (faceted) p = facet(p);
  const result = engine.recommend(p, { target: 'plot', group: 'transform', includeRevisions: true, validationMode: 'deferred', limit: 100 });
  const rec = result.recommendations.find(r => r.method === 'createRegression' || r.args.action?.method === 'createRegression');
  assert.ok(rec);
  const options = faceted ? rec.args.action.options : rec.args;
  assert.equal(options.groupBy, 'Region');
  const ed = recommendationParameters(rec, context(p).profile), values = valuesFor(ed.controls);
  assert.equal(values.group, 'Region');
  const prepared = prepareGuidedAction(p, { method: rec.method, args: ed.build(values) });
  assert.equal(prepared.authoringPreview.markConfigs.plot.regression.groupBy, 'Region');
  if (faceted) for (const child of Object.values(prepared.authoringPreview.children)) {
    assert.equal(child.markConfigs.plot.regression.groupBy, 'Region');
  }
  const all = ed.build({ ...values, group: '' });
  assert.equal((faceted ? all.action.options : all).groupBy, false);
  assert.ok(prepareGuidedAction(p, { method: rec.method, args: all }).preview);
});

test('default uses categorical color, then shape, then a single facet; ignores unrelated fields and continuous color', () => {
  const cases = [
    [base(), ''], [base(rows, { field: 'x', fieldType: 'quantitative' }), ''],
    [base().encodeShape({ target: 'plot', field: 'Shape', fieldType: 'nominal' }), 'Shape'],
    [base(rows, 'Region').encodeShape({ target: 'plot', field: 'Shape', fieldType: 'nominal' }), 'Region'],
    [facet(base()), 'Region'], [facet(base(rows, 'Region'), 'Panel'), 'Region'],
  ];
  for (const [p, expected] of cases) assert.equal(context(p).regressionContext.defaultGroup, expected);
});

test('explicit all-observation requests and existing regression edits do not get rebound', () => {
  const p = base(rows, 'Region'), ctx = context(p);
  const ed = recommendationParameters({ method: 'createRegression', args: { target: 'plot', groupBy: false }, regressionContext: ctx.regressionContext }, ctx.profile);
  assert.equal(valuesFor(ed.controls).group, '');
  const existing = p.createRegression({ target: 'plot', groupBy: false });
  assert.equal(context(existing).regressionContext.currentGroup, '');
  const edit = generateCandidates(existing, context(existing)).find(c => c.method === 'editRegression');
  assert.equal(edit.parameters.find(c => c.path === 'groupBy').value, false);
});

test('categorical encoding semantics take precedence over numeric storage types', () => {
  const data = rows.map((row, i) => ({ ...row, Code: Math.floor(i / 8) }));
  const p = base(data, { field: 'Code', fieldType: 'nominal' }), ctx = context(p);
  assert.equal(ctx.profile.fields.find(f => f.name === 'Code').type, 'quantitative');
  assert.equal(ctx.regressionContext.defaultGroup, 'Code');
  const rec = generateCandidates(p, ctx).find(c => c.method === 'createRegression');
  const ed = recommendationParameters({ ...rec, regressionContext: ctx.regressionContext }, ctx.profile);
  assert.equal(valuesFor(ed.controls).group, 'Code');
  assert.ok(prepareGuidedAction(p, { method: 'createRegression', args: ed.build(valuesFor(ed.controls)) }).preview);
});

test('sparse visual groups fall back; adequacy is measured inside panels rather than across all rows', () => {
  const sparse = base([{x:1,y:2,Region:'A'},{x:2,y:3,Region:'A'},{x:3,y:5,Region:'B'}], 'Region');
  assert.equal(context(sparse).regressionContext.defaultGroup, '');
  const panelSparse = facet(base([
    {x:1,y:2,Region:'A',Panel:'P'},{x:2,y:3,Region:'B',Panel:'P'},
    {x:2,y:4,Region:'A',Panel:'Q'},{x:3,y:6,Region:'B',Panel:'Q'},
  ], 'Region'), 'Panel');
  const ctx = context(panelSparse);
  assert.equal(ctx.regressionContext.groups.Region.minDistinctX, 1);
  assert.equal(ctx.regressionContext.defaultGroup, 'Panel');
  const candidate = generateCandidates(panelSparse, ctx).find(c => c.method === 'createRegression');
  assert.equal(candidate.args.interval, false, 'two points support a fit, but not a confidence interval');
  const ed = recommendationParameters({ ...candidate, regressionContext: ctx.regressionContext }, ctx.profile);
  assert.equal(ed.build(valuesFor(ed.controls)).interval, false);
  const action = { method: 'editFacetSource', args: { action: { method: 'createRegression', options: ed.build(valuesFor(ed.controls)) } } };
  assert.ok(prepareGuidedAction(panelSparse, action).preview);
});
