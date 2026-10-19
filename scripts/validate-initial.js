import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { createInitialChartRecommender, profileDataset, applyRecommendation } from '../src/index.js';
import { prepareGuidedAction, addDefaultGuides } from '../web/plot-setup.js';
import { ROOT, CORPUS_ROOT } from './train-corpus.js';

const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const model = await readJSON(join(ROOT, 'data/initial-model.json'));
const engine = createInitialChartRecommender(model);
const audit = await readJSON(join(ROOT, 'data/initial-corpus-report.json'));
const ids = (await readdir(join(CORPUS_ROOT, 'charts'), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
assert.deepEqual(ids, audit.indexedChartIds);
const report = { chartCount: ids.length, allCurrentChartsIndexed: true, maxRowsPerTable: 128,
  description: 'Every chart data file is read. Runtime checks use the first 128 rows per table and execute the highest-ranked compatible plot plus final guide setup. This is not a reconstruction of the original visualization.',
  dataFilesRead: 0, tables: 0, callsExecuted: 0, withoutCompatiblePlot: [], failures: [], charts: [] };
const tables = value => Array.isArray(value) ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(tables) : [];
for (const [index, id] of ids.entries()) {
  const data = await readJSON(join(CORPUS_ROOT, 'charts', id, 'data.json')); report.dataFilesRead++;
  for (const original of tables(data)) {
    const rows = original.slice(0, report.maxRowsPerTable);
    try {
      const p = chart().createCanvas({ width: 700, height: 430, margin: { left: 80, right: 125, top: 42, bottom: 74 } })
        .createData({ id: 'dataset', values: rows });
      const result = engine.recommend(rows, profileDataset(p, 'dataset'));
      const rejected = []; let accepted;
      for (const rec of result.recommendations.filter(rec => !rec.requirement)) {
        for (const [parameterSource, values] of [['neighbor-roles', rec.values], ['compatible-default', rec.fallbackValues]]) {
          let prepared;
          try { prepared = prepareGuidedAction(p, { method: rec.method, args: rec.build(values) }); }
          catch (error) { rejected.push({ method: rec.method, parameterSource, reason: error.message }); continue; }
          const q = applyRecommendation(prepared.actionBase, prepared.recommendation);
          assert.equal(q.trace.children.length, p.trace.children.length + 1);
          assert.equal(q.trace.children.at(-1).op, rec.method);
          const view = addDefaultGuides(q, prepared.guideCall);
          assert.equal(view.trace.children.at(-1).op, 'createGuides');
          assert.deepEqual(view.semanticSpec, prepared.preview.semanticSpec);
          accepted = { method: rec.method, score: rec.score, parameterSource, rejected }; report.callsExecuted++; break;
        }
        if (accepted) break;
      }
      report.tables++;
      if (!accepted) report.withoutCompatiblePlot.push({ id, rows: rows.length, rejected });
      report.charts.push({ id, totalRows: original.length, testedRows: rows.length, accepted: accepted ?? null });
    } catch (error) { report.failures.push({ id, reason: error.message }); }
  }
  if ((index + 1) % 200 === 0) console.log(`Initial plot smoke: ${index + 1}/${ids.length}; failures ${report.failures.length}`);
}
await mkdir(join(ROOT, 'output'), { recursive: true });
await writeFile(join(ROOT, 'output/initial-validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ dataFilesRead: report.dataFilesRead, tables: report.tables, callsExecuted: report.callsExecuted,
  withoutCompatiblePlot: report.withoutCompatiblePlot.length, failures: report.failures.length }, null, 2));
if (report.failures.length) process.exitCode = 1;
