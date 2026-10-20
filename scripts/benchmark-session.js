import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { createCalculationService } from '../web/calculation-service.js';
import { unpackProgramUpdate } from '../web/program-transfer.js';
import { defaultCanvasOptions, addDefaultGuides } from '../src/prepare.js';
import { ggactionSource } from './ggaction-source.js';

const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url)));
const rows = JSON.parse(await readFile(new URL('../web/data/cars.json', import.meta.url)))
  .filter(row => row.Horsepower != null && row.Miles_per_Gallon != null);
const timed = fn => { const start = performance.now(), value = fn(); return { ms: performance.now() - start, value }; };
function run(incremental) {
  const service = createCalculationService(model), samples = [];
  let view;
  let program = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows })
    .createScatterPlot({ id: 'plot', x: 'Horsepower', y: 'Miles_per_Gallon', color: 'Origin' })
    .facet({ field: 'Origin', data: 'dataset', columns: 3, spacing: 'plot', gap: 120,
      guides: { axes: 'outer', legend: 'shared' } });
  if (incremental) service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(program), guideCall: { method: 'createGuides', args: {} } });
  for (let step = 0; step <= 40; step++) {
    const action = { method: 'editFacetSource', args: { action: {
      method: 'encodeOpacity', options: { target: 'plot', value: step % 2 ? .5 : .7 } } } };
    let hydration = 0;
    if (!incremental) {
      const encoded = timed(() => serializeProgram(program));
      const hydrate = timed(() => service.execute({ type: 'state', stateId: step + 1, snapshot: encoded.value, guideCall: { method: 'createGuides', args: {} } }));
      hydration = encoded.ms + hydrate.ms;
    }
    const prepared = timed(() => service.execute({ type: 'prepare', stateId: step + 1, action }));
    const result = timed(() => service.execute({ type: 'materialize', stateId: step + 1,
      ...(incremental ? { nextStateId: step + 2 } : {}), action }));
    const restore = timed(() => incremental ? unpackProgramUpdate(program, result.value.update) : deserializeProgram(result.value.snapshot));
    const guide = timed(() => incremental
      ? unpackProgramUpdate(restore.value, result.value.viewUpdate)
      : addDefaultGuides(restore.value, result.value.guideCall));
    view = guide.value;
    if (step % 5 === 0) {
      const recommend = timed(() => service.execute({ type: 'recommend', stateId: step + 1,
        options: { target: 'plot', includeRevisions: true, deprioritizeAppliedActions: true, hierarchy: true }, group: 'style' }));
      samples.push({ step, transferBytes: incremental ? Buffer.byteLength(JSON.stringify(result.value)) : Buffer.byteLength(result.value.snapshot),
        hydrateMs: hydration, prepareMs: prepared.ms, transferMs: result.ms, restoreMs: restore.ms, guidesMs: guide.ms,
        recommendMs: recommend.ms, totalMs: hydration + prepared.ms + result.ms + restore.ms + guide.ms + recommend.ms });
    }
    program = restore.value;
  }
  return { program, view, samples };
}
const legacy = run(false), current = run(true);
assert.deepEqual(current.program.semanticSpec, legacy.program.semanticSpec);
assert.deepEqual(current.program.graphicSpec, legacy.program.graphicSpec);
assert.deepEqual(current.program.trace, legacy.program.trace);
assert.deepEqual(current.view.graphicSpec, legacy.view.graphicSpec);
assert.deepEqual(current.view.trace, legacy.view.trace);
const report = { runtime: process.version, library: ggactionSource(),
  scope: '41 native facet edits, identical source rows and unchanged mark count. Legacy full snapshots and guide replay versus retained states and lossless authoring/view updates. Excludes browser IPC, DOM, paint and fixed UI animations; first hydration of the incremental path is outside its samples.',
  outputEquivalent: true, legacy: legacy.samples, current: current.samples };
await mkdir(new URL('../output/progressive-latency/', import.meta.url), { recursive: true });
await writeFile(new URL('../output/progressive-latency/session-benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ outputEquivalent: true, at40: { legacy: legacy.samples.at(-1), current: current.samples.at(-1) } }, null, 2));
