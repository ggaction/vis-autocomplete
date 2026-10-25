// Reproducible worker-side timings; run separately from tests/CPU profiling.
// Browser input/animation timings are deliberately not inferred from these.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { importDataset } from '../src/data-import.js';
import { exampleDatasets } from '../web/example-datasets.js';
import { createCalculationService } from '../web/calculation-service.js';

const bike = exampleDatasets().find(d => d.id === 'bike-sharing');
const rows = importDataset(readFileSync(new URL('../web/data/bike-sharing.csv', import.meta.url), 'utf8'), bike).rows;
const base = data => chart().createCanvas({ plot: { width: 439.6, height: 314 },
  margin: { left: 170, right: 216, top: 42, bottom: 74 } }).createData({ id: 'dataset', values: data });
const parallel = base(rows).createParallelCoordinates({ id: 'plot', data: 'dataset',
  dimensions: ['temp', 'hum', 'atemp', 'windspeed', 'casual'], line: { opacity: .55 } })
  .fitCanvas({ align: 'center', padding: 6, minPlotWidth: 1, minPlotHeight: 1 })
  .facet({ field: 'yr', data: 'dataset', columns: 2, spacing: 'plot', gap: 33,
    guides: { axes: 'each', legend: false } })
  .editFacetSource({ action: { method: 'editCanvas', options: { plot: { width: 439.6, height: 314 },
    margin: { top: 55.25, right: 189.1606, bottom: 60.75, left: 196.8394 } } } });
const denseRows = Array.from({ length: 5000 }, (_, i) => ({ x: i % 200,
  y: Math.sin(i / 40) + Math.cos(i / 19), g: `Group ${i % 5}` }));
const scatter = base(denseRows).createScatterPlot({ id: 'plot', data: 'dataset', x: 'x', y: 'y' });
const line = base(denseRows).createLinePlot({ id: 'plot', data: 'dataset', x: 'x', y: 'y',
  color: { field: 'g', fieldType: 'nominal' } });
const timed = fn => { const start = performance.now(); const value = fn(); return { value, ms: +(performance.now() - start).toFixed(2) }; };
const results = [];
for (const [name, program, actions] of [
  ['Bike sharing: 731 parallel paths, 2 facets', parallel, ['season', 'temp', 'hum'].map(field => ({
    method: 'editFacetSource', args: { action: { method: 'encodeColor', options: {
      target: 'plot', field, fieldType: field === 'season' ? 'nominal' : 'quantitative',
      scale: { palette: field === 'season' ? 'tableau10' : 'viridis' } } } } }))],
  ...[['5000 points', scatter], ['5000 line vertices', line]].map(([name, program]) => [name, program,
    [.3, .5, .8].map(value => ({ method: 'encodeOpacity', args: { target: 'plot', value } }))]),
]) {
  const service = createCalculationService();
  service.execute({ type: 'state', stateId: name, snapshot: serializeProgram(program), guideCall: { method: 'createGuides', args: {} } });
  for (const action of actions) {
    const request = { type: 'prepare', stateId: name, action };
    const cold = timed(() => service.execute(request));
    const clone = timed(() => structuredClone(cold.value));
    const cached = timed(() => service.execute(request));
    assert.equal(cached.value, cold.value);
    assert.ok(clone.value.scene.nodes.length);
    assert.ok(cold.value.scene.nodes.every(node => !('svg' in node)));
    results.push({ chart: name, action: action.args.action?.options.field ?? action.args.value,
      artifactHash: createHash('sha256').update(JSON.stringify(cold.value)).digest('hex'),
      prepareAndSceneMs: cold.ms, transferCloneMs: clone.ms, cachedMs: cached.ms });
  }
}
console.log(JSON.stringify({ runtime: process.version, results }, null, 2));
