import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { describeDataset, FEATURE_NAMES } from '../src/dataset-profile.js';
import { parseProgramSource } from '../src/corpus.js';
import { extractChartEvidence } from '../src/chart-evidence.js';
import { canonicalDataFingerprint, buildInitialIndex, evaluateInitialIndex } from '../scripts/initial-corpus.js';
import { retrieveInitialEvidence, createInitialChartRecommender } from '../src/initial-recommender.js';
import { profileDataset } from '../src/index.js';
import { prepareGuidedAction, addDefaultGuides } from '../web/plot-setup.js';
import { applyRecommendation } from '../src/engine.js';

const spec = (mark, encoding = {}) => ({ mark, encoding });
const record = (id, rows, source, stages = []) => ({ id, data: rows,
  dataHash: canonicalDataFingerprint(rows), source, stages });
const base = rows => chart().createCanvas({ width: 700, height: 430,
  margin: { left: 80, right: 125, top: 42, bottom: 74 } }).createData({ id: 'dataset', values: rows });

test('data-only profiles preserve data and ignore row order, field order and field names', () => {
  const rows = Array.from({ length: 36 }, (_, i) => ({ value: i % 11, measure: i * i,
    group: ['A', 'B', 'C'][i % 3], when: `2020-${String(i % 12 + 1).padStart(2, '0')}-01`, nullable: i % 4 ? i : null }));
  const snapshot = JSON.stringify(rows), a = describeDataset(rows);
  const b = describeDataset([...rows].reverse().map(row => ({ z: row.nullable, y: row.when, x: row.group, w: row.measure, v: row.value })));
  assert.equal(a.vector.length, FEATURE_NAMES.length);
  a.vector.forEach((value, i) => assert.ok(Number.isFinite(value) && Math.abs(value - b.vector[i]) < 1e-12, FEATURE_NAMES[i]));
  assert.equal(JSON.stringify(rows), snapshot);
  assert.ok(a.fields.some(f => f.type === 'temporal'));
  assert.ok(a.fields.some(f => f.missing === 0.25));
  assert.ok(describeDataset([]).vector.every(Number.isFinite));
  assert.ok(describeDataset([{ x: -1e308, y: -1e308 }, { x: 1e308, y: 1e308 }]).vector.every(Number.isFinite));
});

test('typed canonical dataset grouping preserves row multiplicity, associations and numeric strings', () => {
  const a = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  assert.equal(canonicalDataFingerprint(a), canonicalDataFingerprint([{ y: 4, x: 3 }, { y: 2, x: 1 }]));
  assert.notEqual(canonicalDataFingerprint(a), canonicalDataFingerprint([{ x: 1, y: 4 }, { x: 3, y: 2 }]));
  assert.notEqual(canonicalDataFingerprint(a), canonicalDataFingerprint([...a, a[0]]));
  assert.notEqual(canonicalDataFingerprint(a), canonicalDataFingerprint([{ x: '1', y: 2 }, a[1]]));
  assert.equal(canonicalDataFingerprint([{ x: 1 }, { x: 2, y: null }]), canonicalDataFingerprint([{ x: 1, y: null }, { x: 2, y: null }]));
  assert.equal(canonicalDataFingerprint([{ date: '2020-01-01' }]), canonicalDataFingerprint([{ date: '2020-01-01T00:00:00.000Z' }]));
  assert.notEqual(canonicalDataFingerprint([{ date: '2020-01-01' }]), canonicalDataFingerprint([{ date: '2020-01-01T01:00:00Z' }]));
});

test('source semantics distinguish a histogram from bar realizations and annotations do not add labels', () => {
  const stages = Array.from({ length: 8 }, () => parseProgramSource('chart().createBarPlot({x:"bin",y:"count"})'));
  const histogram = extractChartEvidence(stages, spec('bar', { x: { field: 'amount', bin: true }, y: { aggregate: 'count' } }));
  assert.deepEqual(histogram.methods, ['createHistogram']);
  const layered = extractChartEvidence(stages, { layer: [spec('point', { x: { field: 'x' }, y: { field: 'y' } }),
    spec('line', { x: { field: 'x' }, y: { field: 'fit' } }), spec('text', { text: { field: 'label' } })] });
  assert.deepEqual(layered.methods, ['createLinePlot', 'createScatterPlot']);
  assert.ok(!layered.methods.includes('createTextPlot'));
});

test('one chart is one vote across stages and mixed chart types share that vote', () => {
  const rows = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  const stages = Array.from({ length: 8 }, () => parseProgramSource('chart().createScatterPlot({x:"x",y:"y"})'));
  const mixed = { layer: [spec('point'), spec('line')] };
  const { model, report } = buildInitialIndex([record('a', rows, mixed, stages)]);
  assert.equal(model.groups[0].charts.length, 1);
  assert.deepEqual(model.groups[0].distribution, { createLinePlot: 0.5, createScatterPlot: 0.5 });
  assert.equal(report.chartCount, 1);
  assert.throws(() => buildInitialIndex([record('same', rows, mixed), record('same', rows, mixed)]), /Duplicate/);
});

test('a dataset with 100 published charts does not outweigh a neighboring dataset with one', () => {
  const rowsA = [{ x: 1, y: 2 }, { x: 3, y: 4 }], rowsB = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
  const records = Array.from({ length: 100 }, (_, i) => record(`a-${i}`, rowsA, spec('point')));
  records.push(record('b', rowsB, spec('line')));
  const { model } = buildInitialIndex(records);
  const result = retrieveInitialEvidence(model, describeDataset(rowsA));
  assert.equal(result.neighbors.length, 2);
  assert.ok(Math.abs(result.scores.createScatterPlot - 0.5) < 1e-12);
  assert.ok(Math.abs(result.scores.createLinePlot - 0.5) < 1e-12);
});

test('known source variants share an evaluation family and only one nearest-neighbor position', () => {
  const records = [record('a', [{ x: 1 }, { x: 2 }], { ...spec('bar'), data: { url: 'https://example.org/data.csv' } }),
    record('b', [{ x: 4 }, { x: 5 }, { x: 6 }], { ...spec('line'), data: { url: 'https://example.org/data.csv' } }),
    record('c', [{ x: 10 }, { x: 20 }], spec('point'))];
  const { model, report } = buildInitialIndex(records);
  assert.equal(report.canonicalDatasets, 3);
  assert.equal(report.sourceFamilies, 2);
  const r = retrieveInitialEvidence(model, describeDataset([{ x: 1 }, { x: 2 }]));
  assert.equal(new Set(r.neighbors.map(n => n.group.family)).size, r.neighbors.length);
  assert.ok(r.neighbors.length <= 2);
  const excluded = retrieveInitialEvidence(model, describeDataset([{ x: 1 }]), { excludeFamilies: [model.groups[0].family] });
  assert.ok(excluded.neighbors.every(n => n.group.family !== model.groups[0].family));
});

test('unmapped chart types stay in the audit and do not acquire invented supported-type counts', () => {
  const { model, report } = buildInitialIndex([record('a', [{ x: 1 }], spec('unrecognized'))]);
  assert.equal(report.allChartsIndexed, true);
  assert.equal(report.unresolved.length, 1);
  assert.deepEqual(model.groups[0].distribution, { 'unmapped:unrecognized': 1 });
});

test('the entire shipped corpus is indexed once, votes conserve mass and evaluation source families are disjoint', () => {
  const report = JSON.parse(readFileSync(new URL('../data/initial-corpus-report.json', import.meta.url)));
  const model = JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url)));
  const evaluation = JSON.parse(readFileSync(new URL('../data/initial-evaluation.json', import.meta.url)));
  const old = JSON.parse(readFileSync(new URL('../data/corpus-report.json', import.meta.url)));
  assert.equal(report.chartCount, old.chartCount);
  assert.deepEqual(report.indexedChartIds, old.charts.map(c => c.id));
  const mass = new Map();
  for (const group of model.groups) {
    assert.ok(Math.abs(Object.values(group.distribution).reduce((a, b) => a + b, 0) - 1) < 1e-12);
    for (const c of group.charts) mass.set(c.id, (mass.get(c.id) ?? 0) + c.mass);
  }
  assert.equal(mass.size, old.chartCount);
  for (const value of mass.values()) assert.ok(Math.abs(value - 1) < 1e-12);
  const family = new Map(model.groups.map(g => [g.id, g.family]));
  const train = new Set(evaluation.trainingDatasetIds.map(id => family.get(id)));
  assert.ok(evaluation.testDatasetIds.every(id => !train.has(family.get(id))));
  assert.equal(evaluation.neighborCount, model.neighborCount);
});

test('rankings and field defaults depend on input data, preserve evidence scores and use native single calls', () => {
  const model = JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url)));
  const engine = createInitialChartRecommender(model);
  const cars = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
  const time = Array.from({ length: 36 }, (_, i) => ({ Date: `2020-${String(i % 12 + 1).padStart(2, '0')}-01`,
    Sales: i * 3 + 20, Region: ['North', 'South'][i % 2] }));
  const rankings = [];
  for (const rows of [cars, time]) {
    const p = base(rows), result = engine.recommend(rows, profileDataset(p, 'dataset'));
    assert.equal(result.recommendations.length, 29);
    rankings.push(result.recommendations.slice(0, 5).map(r => r.method));
    const eligible = result.recommendations.filter(r => !r.requirement);
    assert.ok(eligible.every((r, i) => !i || eligible[i - 1].score >= r.score));
    for (const rec of eligible.slice(0, 5)) {
      assert.ok(Math.abs(rec.score - rec.evidence.reduce((sum, e) => sum + e.contribution, 0)) < 1e-12);
      let prepared;
      try { prepared = prepareGuidedAction(p, { method: rec.method, args: rec.build(rec.values) }); }
      catch { prepared = prepareGuidedAction(p, { method: rec.method, args: rec.build(rec.fallbackValues) }); }
      const applied = applyRecommendation(prepared.actionBase, prepared.recommendation);
      assert.equal(applied.trace.children.length, p.trace.children.length + 1);
      assert.equal(applied.trace.children.at(-1).op, rec.method);
      assert.deepEqual(addDefaultGuides(applied, prepared.guideCall).graphicSpec, prepared.preview.graphicSpec);
    }
  }
  assert.notDeepEqual(rankings[0], rankings[1]);
});
