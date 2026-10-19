import { createHash } from 'node:crypto';
import { describeDataset, FEATURE_NAMES, PROFILE_VERSION } from '../src/dataset-profile.js';
import { extractChartEvidence } from '../src/chart-evidence.js';
import { fitNormalization, retrieveInitialEvidence } from '../src/initial-recommender.js';
import { INITIAL_PLOT_METHODS } from '../src/plot-catalog.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export const FINGERPRINT_VERSION = 'typed-schema-missing-iso-midnight-v3';
const canonical = value => value === undefined || value === null ? null : Array.isArray(value)
  ? value.map(canonical) : typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    // Calendar dates and their ISO midnight spelling are the same civil value.
    // This changes only duplicate detection, never input data or chart arguments.
    : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?Z?)?$/.test(value)
      && Number.isFinite(Date.parse(value)) ? value.slice(0, 10) : value;

export function canonicalDataFingerprint(rows) {
  const normalized = rows.map(row => row && typeof row === 'object' && !Array.isArray(row) ? row : { value: row });
  const fields = [...new Set(normalized.flatMap(row => Object.keys(row)))].sort();
  return hash(JSON.stringify([fields, normalized.map(row => JSON.stringify(fields.map(field => canonical(row[field])))).sort()]));
}

function tablesIn(value, path = 'data') {
  if (Array.isArray(value)) return [{ path, rows: value }];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => tablesIn(child, `${path}.${key}`));
}

function sourceUrls(spec) {
  if (!spec || typeof spec !== 'object') return [];
  const own = typeof spec.data?.url === 'string' ? [spec.data.url] : [];
  const children = ['layer', 'hconcat', 'vconcat', 'concat'].flatMap(key => spec[key] ?? []);
  if (spec.spec) children.push(spec.spec);
  return [...new Set([...own, ...children.flatMap(sourceUrls)])].filter(url => /^https?:\/\//.test(url)).sort();
}

export function prepareInitialRecord(record, cache = new Map()) {
  let tables = cache.get(record.dataHash);
  if (!tables) {
    tables = tablesIn(record.data).map(({ path, rows }) => ({ path,
      id: canonicalDataFingerprint(rows), profile: describeDataset(rows) }));
    cache.set(record.dataHash, tables);
  }
  return { id: record.id, dataHash: record.dataHash, tables,
    evidence: extractChartEvidence(record.stages, record.source),
    urls: sourceUrls(record.originalSource ?? record.source), stageCount: record.stages.length };
}

export function buildInitialIndex(records, provenance = {}) {
  const groups = new Map(), rawCache = new Map(), seenCharts = new Set();
  const charts = [], unresolved = [];
  for (const record of records) {
    if (seenCharts.has(record.id)) throw new Error(`Duplicate initial-training chart: ${record.id}`);
    seenCharts.add(record.id);
    const prepared = record.tables ? record : prepareInitialRecord(record, rawCache);
    const { evidence, tables, urls } = prepared;
    rawCache.set(record.dataHash, tables);
    if (!tables.length) throw new Error(`No tables for initial index: ${record.id}`);
    // Match named roles to tables; ambiguous multi-table charts remain audited
    // rather than pairing their labels with an arbitrary first table.
    const tableViews = tables.map(table => ({ table, views: evidence.views.filter(view => {
      const names = Object.values(view.roles).flat().filter(v => typeof v === 'string');
      return names.some(name => table.profile.fields.some(field => field.name === name));
    }) }));
    const assignments = tables.length === 1 ? [{ table: tables[0], views: evidence.views, methods: evidence.methods }]
      : tableViews.filter(value => value.views.length).map(value => ({ ...value, methods: [...new Set(value.views.map(view => view.method))] }));
    if (!assignments.length) throw new Error(`Cannot associate chart with its source tables: ${record.id}`);
    const chartReport = { id: record.id, methods: evidence.methods, nativeMethods: evidence.nativeMethods,
      datasets: assignments.map(a => a.table.id), sourceUrls: urls, stageCount: prepared.stageCount };
    charts.push(chartReport);
    if (evidence.methods.some(method => method.startsWith('unmapped:'))) unresolved.push(chartReport);
    for (const { table, views, methods } of assignments) {
      if (!groups.has(table.id)) groups.set(table.id, { id: table.id, profile: table.profile,
        charts: [], distribution: {}, sourceUrls: [], rawHashes: [] });
      const group = groups.get(table.id);
      group.charts.push({ id: record.id, methods, views, mass: 1 / assignments.length });
      group.sourceUrls = [...new Set([...group.sourceUrls, ...urls])].sort();
      group.rawHashes = [...new Set([...group.rawHashes, record.dataHash])].sort();
    }
  }
  const all = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
  // Exact contents and known shared source URLs define conservative evaluation
  // families. A family also gets only one nearest-neighbor position at runtime.
  const parents = new Map(all.map(group => [group.id, group.id]));
  const root = id => { while (parents.get(id) !== id) id = parents.get(id); return id; };
  const urls = new Map();
  for (const group of all) for (const url of group.sourceUrls) {
    if (!urls.has(url)) urls.set(url, group.id);
    else {
      const a = root(group.id), b = root(urls.get(url));
      if (a !== b) parents.set(a < b ? b : a, a < b ? a : b);
    }
  }
  for (const group of all) {
    group.family = root(group.id);
    const mass = group.charts.reduce((sum, chart) => sum + chart.mass, 0);
    for (const chart of group.charts) for (const method of chart.methods) {
      group.distribution[method] = (group.distribution[method] ?? 0) + chart.mass / chart.methods.length / mass;
    }
    group.charts.sort((a, b) => a.id.localeCompare(b.id));
  }
  const model = { schemaVersion: 1, profileVersion: PROFILE_VERSION, fingerprintVersion: FINGERPRINT_VERSION,
    method: 'similar-dataset-weighted-chart-frequency', featureNames: FEATURE_NAMES,
    normalization: fitNormalization(all), neighborCount: 20, weightKernel: 'inverse-square', groups: all, provenance };
  const report = { ...provenance, chartCount: records.length, rawDataFileHashes: rawCache.size,
    canonicalDatasets: all.length, sourceFamilies: new Set(all.map(group => group.family)).size,
    indexedChartIds: [...seenCharts].sort(), allChartsIndexed: charts.length === records.length,
    unresolved, charts, chartTypeCounts: {}, availablePlotTypesWithoutExamples: [],
    limitations: ['Known source URLs and canonical exact contents define families; unknown renamed/subset copies may remain separate.',
      'Source annotations and translation stages do not become extra chart-type votes.',
      'Chart fractions describe observed corpus choices, not measured visualization effectiveness.'] };
  for (const chart of charts) for (const method of chart.methods) report.chartTypeCounts[method] = (report.chartTypeCounts[method] ?? 0) + 1 / chart.methods.length;
  report.availablePlotTypesWithoutExamples = INITIAL_PLOT_METHODS.filter(method => !report.chartTypeCounts[method]);
  return { model, report };
}

function rankGlobal(groups) {
  // Equal source-family weight in the global-frequency baseline, too.
  const families = new Map();
  for (const group of groups) {
    if (!families.has(group.family)) families.set(group.family, []);
    families.get(group.family).push(group);
  }
  const scores = {};
  for (const group of groups) for (const [method, probability] of Object.entries(group.distribution)) {
    scores[method] = (scores[method] ?? 0) + probability / families.get(group.family).length / families.size;
  }
  return Object.keys(scores).sort((a, b) => scores[b] - scores[a] || a.localeCompare(b));
}

function measure(predictions) {
  const result = { cases: predictions.length, top1: 0, top3: 0, top5: 0, mrr: 0 };
  for (const { truth, ranking } of predictions) for (const [method, probability] of Object.entries(truth)) {
    const rank = ranking.indexOf(method) + 1;
    for (const k of [1, 3, 5]) if (rank > 0 && rank <= k) result[`top${k}`] += probability / predictions.length;
    if (rank > 0) result.mrr += probability / rank / predictions.length;
  }
  return result;
}

export function evaluateInitialIndex(model) {
  const families = [...new Set(model.groups.map(g => g.family))];
  if (families.length < 10) return { skipped: true, reason: 'fewer-than-ten-source-families', neighborCount: model.neighborCount };
  const fold = family => parseInt(hash(family).slice(0, 8), 16) % 5;
  const heldOut = new Set(families.filter(family => fold(family) === 0));
  const development = model.groups.filter(g => !heldOut.has(g.family));
  const validation = [];
  for (const weightKernel of ['inverse-square', 'exponential']) for (const k of [10, 20, 40]) {
    const predictions = [];
    for (let f = 1; f < 5; f++) {
      const training = development.filter(g => fold(g.family) !== f), test = development.filter(g => fold(g.family) === f);
      const temporary = { ...model, groups: training, normalization: fitNormalization(training), neighborCount: k, weightKernel };
      for (const group of test) predictions.push({ truth: group.distribution, ranking: retrieveInitialEvidence(temporary, group.profile).methods });
    }
    validation.push({ k, weightKernel, ...measure(predictions) });
  }
  validation.sort((a, b) => b.top1 - a.top1 || b.mrr - a.mrr || a.k - b.k);
  const selectedK = validation[0].k, weightKernel = validation[0].weightKernel;
  const temporary = { ...model, groups: development, normalization: fitNormalization(development), neighborCount: selectedK, weightKernel };
  const global = rankGlobal(development), predictions = [], fixed = [], baseline = [];
  const test = model.groups.filter(g => heldOut.has(g.family));
  for (const group of test) {
    predictions.push({ truth: group.distribution, ranking: retrieveInitialEvidence(temporary, group.profile).methods });
    fixed.push({ truth: group.distribution, ranking: INITIAL_PLOT_METHODS });
    baseline.push({ truth: group.distribution, ranking: global });
  }
  return { skipped: false, neighborCount: selectedK, weightKernel, tuning: validation,
    protocol: 'source-family holdout fold 0; neighbor count and kernel selected only on folds 1-4; normalization fit on training groups only',
    trainingFamilies: families.length - heldOut.size, testFamilies: heldOut.size,
    trainingDatasetIds: development.map(g => g.id), testDatasetIds: test.map(g => g.id),
    test: { retrieval: measure(predictions), fixedOrder: measure(fixed), globalFrequency: measure(baseline) },
    interpretation: 'Top-K measures observed chart-type mass recovered, averaged over distinct datasets; not human-rated chart quality.' };
}
