import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { comparePrograms } from 'ggaction/inspection';
import { createRecommendationEngine, applyRecommendation, validateCandidate } from '../src/index.js';
import { makeScenarios, cars } from '../examples/scenarios.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url), 'utf8'));
const engine = createRecommendationEngine(model);

test('every scenario and alternative executes exactly one top-level action without changing the input', () => {
  for (const { program } of makeScenarios()) {
    const before = JSON.stringify([program.semanticSpec, program.graphicSpec]);
    const trace = JSON.stringify(program.trace);
    const result = engine.recommend(program, { limit: 100 });
    assert.ok(result.recommendations.length);
    assert.deepEqual(result.recommendations, engine.recommend(program, { limit: 100 }).recommendations);
    for (const recommendation of result.recommendations) {
      assert.ok(!result.state.features.includes(recommendation.feature));
      assert.equal(recommendation.validation.topLevelActions, 1);
      assert.equal(recommendation.score, recommendation.explanation.contributions
        .reduce((sum, c) => sum + c.chartCount / model.chartCount, 0) / result.state.features.length);
      for (let i = 0; i < recommendation.alternatives.length; i++) {
        const next = applyRecommendation(program, recommendation, { alternative: i });
        assert.equal(next.trace.children.length, program.trace.children.length + 1);
        assert.equal(next.trace.children.at(-1).op, recommendation.alternatives[i].method);
        assert.equal(comparePrograms(program, next).equivalence, 'different');
        if (recVersion(recommendation, i).svgSerialized) assert.ok(renderToSVG(next).startsWith('<svg'));
      }
    }
    assert.equal(JSON.stringify([program.semanticSpec, program.graphicSpec]), before);
    assert.equal(JSON.stringify(program.trace), trace);
  }
});

test('regression stays one authored call even though it delegates to nested actions', () => {
  const { program } = makeScenarios()[3];
  const recommendation = engine.recommend(program, { limit: 100 }).recommendations.find(r => r.method === 'createRegression');
  assert.ok(recommendation);
  const next = applyRecommendation(program, recommendation);
  assert.equal(next.trace.children.length - program.trace.children.length, 1);
  assert.ok(next.trace.children.at(-1).children.length > 0);
});

test('field alternatives do not flood top-K with copies of the same function', () => {
  const { program } = makeScenarios()[3];
  const result = engine.recommend(program, { limit: 100 });
  assert.equal(result.recommendations.filter(r => r.method === 'encodeColor').length, 1);
  assert.ok(result.recommendations.find(r => r.method === 'encodeColor').alternatives.length > 1);
});

test('stale, forged and tampered recommendations cannot be applied', () => {
  const { program } = makeScenarios()[3];
  const recommendation = engine.recommend(program).recommendations[0];
  const next = applyRecommendation(program, recommendation);
  assert.throws(() => applyRecommendation(next, recommendation), /different chart state/);
  assert.throws(() => applyRecommendation(program, { ...recommendation }), /different chart state/);
  assert.throws(() => { recommendation.args.target = 'other'; }, TypeError);
  assert.throws(() => applyRecommendation(program, recommendation, { alternative: 999 }), /Unknown/);
});

test('invalid fields, unsupported methods and no-ops are rejected before recommendation', () => {
  const { program } = makeScenarios()[3];
  assert.equal(validateCandidate(program, { method: 'encodeColor', args: { target: 'points', field: 'missing' },
    inspectionTarget: { kind: 'mark', id: 'points' } }).ok, false);
  assert.equal(validateCandidate(program, { method: 'constructor', args: {} }).ok, false);
  const check = validateCandidate(program, { method: 'encodeX', args: {
    target: 'points', field: 'Horsepower', fieldType: 'quantitative' } });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'no-change');
});

test('multiple datasets and marks require explicit, matching targets', () => {
  const base = chart().createCanvas().createData({ id: 'one', values: cars })
    .createData({ id: 'two', values: cars.map(c => ({ Value: c.Weight, Group: c.Origin })) });
  assert.throws(() => engine.recommend(base), /specify/);
  const p = base.createPointMark({ id: 'a', data: 'one' }).encodeX({ target: 'a', field: 'Horsepower' })
    .createPointMark({ id: 'b', data: 'two' }).encodeX({ target: 'b', field: 'Value' });
  assert.throws(() => engine.recommend(p), /Multiple marks/);
  assert.throws(() => engine.recommend(p, { target: 'a', data: 'two' }), /does not match/);
  const result = engine.recommend(p, { target: 'a', category: 'encoding' });
  for (const rec of result.recommendations) {
    assert.equal(rec.args.target, 'a');
    assert.ok(Object.hasOwn(cars[0], rec.args.field));
    const next = applyRecommendation(p, rec);
    assert.deepEqual(next.semanticSpec.layers.find(l => l.id === 'b'), p.semanticSpec.layers.find(l => l.id === 'b'));
  }
});

function recVersion(recommendation, i) { return recommendation.alternatives[i].validation; }

test('missing, mixed and nonfinite fields do not produce invalid suggestions', () => {
  const p = chart().createCanvas().createData({ id: 'mixed', values: [
    { x: 1, missing: 1, mixed: 2, bad: Infinity },
    { x: 2, missing: null, mixed: 'two', bad: 3 },
  ] }).createPointMark({ id: 'p' });
  const result = engine.recommend(p, { limit: 100 });
  assert.ok(result.recommendations.length);
  for (const rec of result.recommendations) for (const variant of rec.alternatives) assert.equal(variant.args.field, 'x');
});

test('paper additions are default; explicit revisions can reuse a function with new arguments', () => {
  const { program } = makeScenarios()[4];
  assert.ok(!engine.recommend(program, { limit: 100 }).recommendations.some(r => r.method === 'encodeColor'));
  const revision = engine.recommend(program, { limit: 100, includeRevisions: true }).recommendations.find(r => r.method === 'encodeColor');
  assert.ok(revision);
  assert.equal(revision.kind, 'revision');
  assert.ok(!revision.explanation.contributions.some(c => c.feature === 'encoding.color'));
  assert.notEqual(revision.args.field, 'Origin');
  assert.equal(applyRecommendation(program, revision).trace.children.at(-1).op, 'encodeColor');
});

test('field selection, temporal hints, empty datasets and bad options are explicit', () => {
  const p = chart().createCanvas().createData({ id: 'time', values: [
    { year: 2020, value: 1 }, { year: 2021, value: 2 },
  ] });
  assert.equal(engine.recommend(p, { fieldTypes: { year: 'temporal' } }).state.datasetType, 'time-series');
  assert.throws(() => engine.recommend(p, { fieldTypes: { absent: 'nominal' } }), /Invalid field/);
  assert.throws(() => engine.recommend(p, { fields: ['absent'] }), /fields/);
  assert.throws(() => engine.recommend(p, { limit: 0 }), /positive/);
  assert.throws(() => engine.recommend(p, { category: 'unknown' }), /category/);
  const empty = chart().createCanvas().createData({ values: [] });
  assert.equal(engine.recommend(empty).recommendations.length, 0);
});

test('numeric strings get an explicit single conversion action, not silent coercion', () => {
  const p = chart().createCanvas().createData({ id: 'raw', values: [
    { group: 'A', amount: '12', code: '001' }, { group: 'B', amount: '14', code: '002' },
  ] });
  const result = engine.recommend(p, { limit: 100 });
  const conversion = result.recommendations.find(r => r.method === 'createComputedData');
  assert.ok(conversion);
  assert.equal(conversion.alternatives.length, 1); // preserve leading-zero identifiers
  assert.equal(conversion.args.expression.operand.field, 'amount');
  const next = applyRecommendation(p, conversion);
  assert.equal(next.trace.children.length, p.trace.children.length + 1);
  assert.equal(p.semanticSpec.datasets[0].values[0].amount, '12');
  const derived = next.semanticSpec.datasets.find(d => d.id === conversion.args.id);
  assert.equal(derived.values[0][conversion.args.as], 12);
  const followup = engine.recommend(next, conversion.nextContext);
  assert.ok(followup.state.features.includes('action.createComputedData'));
  assert.ok(followup.recommendations.some(r => r.method === 'createBarMark'));
});

test('categorical-only data can start with one group-count action', () => {
  const p = chart().createCanvas().createData({ id: 'raw', values: [
    { group: 'A' }, { group: 'A' }, { group: 'B' },
  ] });
  const summary = engine.recommend(p).recommendations.find(r => r.method === 'createSummaryData');
  assert.ok(summary);
  const next = applyRecommendation(p, summary);
  assert.equal(next.trace.children.length, p.trace.children.length + 1);
  const rows = next.semanticSpec.datasets.find(d => d.id === summary.args.id).values;
  assert.deepEqual(rows.map(r => r.count), [2, 1]);
  assert.ok(engine.recommend(next, summary.nextContext).state.features.includes('transform.aggregate'));
});
