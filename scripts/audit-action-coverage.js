import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { chart } from 'ggaction';
import { profileDataset } from '../src/profile.js';
import { getPlotDefinitions } from '../src/plot-catalog.js';
import { importDataset } from '../src/data-import.js';

// Keep exhaustive validation bounded: each dataset/plot runs in its own process
// so rendering/inspection caches cannot accumulate over the entire matrix.
const execute = promisify(execFile), directory = 'output/action-coverage';
const datasets = process.argv.slice(2).length ? process.argv.slice(2) : ['cars', 'iris', 'barley', 'gapminder'];
await mkdir(directory, { recursive: true });
const cases = [];
for (const dataset of datasets) {
  const values = importDataset(await readFile(`web/data/${dataset}.json`, 'utf8'), { format: 'json' }).rows;
  const program = chart().createData({ id: 'dataset', values });
  for (const { method } of getPlotDefinitions(profileDataset(program, 'dataset'))) cases.push({ dataset, method });
}
const reports = [];
async function run() {
  while (cases.length) {
    const { dataset, method } = cases.shift(), output = `${directory}/${dataset}-${method}.json`;
    await rm(output, { force: true });
    let failure;
    try { await execute(process.execPath, ['scripts/audit-action-availability.js', '--dataset', dataset, '--plot', method, '--output', output], { maxBuffer: 1024 * 1024 }); }
    catch (error) { failure = error.stderr || error.message; }
    let report;
    try { report = JSON.parse(await readFile(output, 'utf8')); }
    catch { report = { dataset, method, failure }; }
    reports.push({ ...report, method });
    console.log(`${dataset}/${method}: ${report.totals ? `${report.totals.cards} cards, ${report.totals.missing} missing, ${report.totals.editorErrors} parameter errors` : failure}`);
  }
}
await Promise.all([run(), run()]);
reports.sort((a, b) => `${a.dataset}/${a.method ?? a.states[0].plot}`.localeCompare(`${b.dataset}/${b.method ?? b.states[0].plot}`));
const totals = reports.reduce((sum, r) => ({ cases: sum.cases + 1, skipped: sum.skipped + (r.skipped?.length ?? 0), cards: sum.cards + (r.totals?.cards ?? 0),
  missing: sum.missing + (r.totals?.missing ?? 0), editorErrors: sum.editorErrors + (r.totals?.editorErrors ?? 0), failures: sum.failures + Number(Boolean(r.failure)) }),
{ cases: 0, skipped: 0, cards: 0, missing: 0, editorErrors: 0, failures: 0 });
await writeFile(`${directory}/report.json`, JSON.stringify({ totals, reports }, null, 2) + '\n');
console.log(JSON.stringify(totals));
if (totals.missing || totals.editorErrors || totals.failures) process.exitCode = 1;
