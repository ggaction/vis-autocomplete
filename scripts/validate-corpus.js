import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { createRecommendationEngine, applyRecommendation, trainCooccurrenceModel, profileDataset } from '../src/index.js';
import { ROOT, CORPUS_ROOT } from './train-corpus.js';

const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const model = await readJSON(join(ROOT, 'data/model.json'));
const observations = await readJSON(join(ROOT, 'data/observations.json'));
const rebuilt = trainCooccurrenceModel(observations, model.provenance);
assert.deepEqual(rebuilt.featureCounts, model.featureCounts);
assert.deepEqual(rebuilt.pairCounts, model.pairCounts);
assert.equal(rebuilt.chartCount, model.chartCount);
const directories = (await readdir(join(CORPUS_ROOT, 'charts'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
assert.deepEqual(observations.map(chart => chart.id), directories, 'Every current chart must participate in training.');
const engine = createRecommendationEngine(model);
const report = {
  corpusCommit: model.provenance.commit, modelCharts: model.chartCount,
  allCurrentChartIdsInModel: true, allCooccurrenceCountsRecomputed: true,
  maxRowsPerTable: 128, originalTranslationProgramsReplayed: false,
  description: 'Each chart data file is read in full; runtime smoke states use the first 128 rows of each table, up to six usable fields. This is not a reconstruction or visual-equivalence test of the original chart.',
  dataFilesRead: 0, dataTablesTested: 0, singleCallsExecuted: 0,
  tablesWithRecommendations: 0, tablesWithoutRecommendations: 0,
  charts: [], failures: [],
};

function tablesIn(value, path = 'data') {
  if (Array.isArray(value)) return [{ path, rows: value }];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => tablesIn(child, `${path}.${key}`));
}

for (const [index, id] of directories.entries()) {
  const data = await readJSON(join(CORPUS_ROOT, 'charts', id, 'data.json'));
  report.dataFilesRead++;
  const tableResults = [];
  for (const table of tablesIn(data)) {
    try {
      const rows = table.rows.slice(0, report.maxRowsPerTable).map(row =>
        row && typeof row === 'object' && !Array.isArray(row) ? row : { value: row });
      const base = chart().createCanvas({ width: 700, height: 440,
        margin: { left: 90, right: 180, top: 40, bottom: 80 } }).createData({ id: 'observations', values: rows });
      const profile = profileDataset(base, 'observations');
      const usable = profile.fields.filter(f => f.usable);
      // Balance available roles; the selection is deterministic and never affects training.
      const numeric = usable.filter(f => f.type === 'quantitative').slice(0, 3);
      const categories = usable.filter(f => f.type === 'nominal').slice(0, 2);
      const temporal = usable.filter(f => f.type === 'temporal').slice(0, 1);
      const fields = [...numeric, ...categories, ...temporal].map(f => f.name);
      let state = base;
      let stateKind = 'data-only';
      if (numeric.length >= 2) {
        state = base.createPointMark({ id: 'points', missing: 'skip' })
          .encodeX({ target: 'points', field: numeric[0].name })
          .encodeY({ target: 'points', field: numeric[1].name });
        stateKind = 'scatter';
      } else if (numeric.length && categories.length) {
        state = base.createBarMark({ id: 'bars', missing: 'skip' })
          .encodeX({ target: 'bars', field: categories[0].name, fieldType: 'nominal' })
          .encodeY({ target: 'bars', field: numeric[0].name, aggregate: 'mean' });
        stateKind = 'bar';
      }
      const result = engine.recommend(state, { fields, limit: 3 });
      for (const recommendation of result.recommendations) {
        const next = applyRecommendation(state, recommendation);
        assert.equal(next.trace.children.length, state.trace.children.length + 1);
        assert.equal(next.trace.children.at(-1).op, recommendation.method);
        report.singleCallsExecuted++;
      }
      report.dataTablesTested++;
      if (result.recommendations.length) report.tablesWithRecommendations++;
      else report.tablesWithoutRecommendations++;
      tableResults.push({ table: table.path, totalRows: table.rows.length, testedRows: rows.length,
        stateKind, recommendations: result.recommendations.map(r => r.method),
        eligibleGroups: result.diagnostics.eligibleGroups, rejectedCandidates: result.diagnostics.rejected.length,
        emptyReason: result.diagnostics.emptyReason });
    } catch (error) {
      report.failures.push({ chart: id, table: table.path, error: error.message });
    }
  }
  report.charts.push({ id, tables: tableResults });
  if ((index + 1) % 100 === 0) console.log(`Engine smoke states: ${index + 1}/${directories.length}; failures ${report.failures.length}`);
}
await mkdir(join(ROOT, 'output'), { recursive: true });
await writeFile(join(ROOT, 'output/corpus-validation.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ dataFilesRead: report.dataFilesRead, dataTablesTested: report.dataTablesTested,
  singleCallsExecuted: report.singleCallsExecuted, tablesWithRecommendations: report.tablesWithRecommendations,
  tablesWithoutRecommendations: report.tablesWithoutRecommendations, failures: report.failures.length }, null, 2));
if (report.failures.length) {
  console.error(report.failures.slice(0, 10));
  process.exitCode = 1;
}
