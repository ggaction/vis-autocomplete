// Run baseline and candidate in separate, otherwise idle Node processes.
// Timings cover the actual worker pipeline, not browser input/paint latency.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createCalculationService } from '../web/calculation-service.js';
import { unpackProgramUpdate } from '../web/program-transfer.js';

const trials = Number(process.env.BENCH_TRIALS ?? 3);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const measure = fn => { const start = performance.now(), value = fn(); return { value, ms: performance.now() - start }; };
const rows = Array.from({ length: 1200 }, (_, i) => ({ x: i + 1, y: 2 + Math.sin(i / 17),
  g: `Group ${i % 4}`, a: i % 13, b: i % 31, c: i % 7, d: i % 41 }));
const base = values => chart().createCanvas({ plot: { width: 360, height: 300 },
  margin: { left: 100, right: 180, top: 90, bottom: 100 } }).createData({ id: 'd', values });
const color = { field: 'g', fieldType: 'nominal' };
const plot = { id: 'p', data: 'd', x: 'x', y: 'y', color };
const factories = [
  ['scatter', () => base(rows).createScatterPlot(plot)],
  ['line', () => base(rows).createLinePlot(plot)],
  ['bar', () => base(rows).createBarPlot({ ...plot, x: { field: 'g', fieldType: 'nominal' }, y: { field: 'y', aggregate: 'sum' } })],
  ['area', () => base(rows).createAreaPlot({ ...plot, groupBy: 'g' })],
  ['box', () => base(rows).createBoxPlot({ ...plot, x: { field: 'g', fieldType: 'nominal' }, y: { field: 'y', fieldType: 'quantitative' } })],
  ['beeswarm', () => base(rows.slice(0, 200)).createBeeswarmPlot({ ...plot, x: { field: 'g', fieldType: 'nominal' }, packing: { overflow: 'overlap' } })],
  ['parallel', () => base(rows).createParallelCoordinates({ id: 'p', data: 'd', dimensions: ['x', 'a', 'b', 'c', 'd'], color })],
  ['pie', () => base(rows).createPiePlot({ id: 'p', data: 'd', category: 'g', value: 'y', aggregate: 'sum' })],
];
const call = (method, args) => ({ method, args });
const common = [
  call('encodeOpacity', { target: 'p', value: .45 }),
  call('editColorScale', { target: 'p', palette: 'set1' }),
  call('editLegend', { target: 'p', channel: 'color', position: 'bottom' }),
  call('createTitle', { text: 'An unchanged chart', subtitle: 'All records retained', titleStyle: { fontSize: 23 } }),
  call('editCanvas', { plot: { width: 420, height: 260 } }),
  call('facet', { data: 'd', field: 'g', columns: 2, guides: { axes: 'outer', legend: 'shared' } }),
];
const cartesian = [
  call('editXAxis', { labels: { fontSize: 15 } }),
  call('editGrid', { horizontal: { color: '#aabbcc', lineWidth: 2 } }),
  call('encodeStroke', { target: 'p', value: '#222222' }),
];
const results = [];
for (const [name, factory] of factories) {
  const actions = [...common.map(action => action.method === 'encodeOpacity' && name === 'pie'
    ? call('editArcMark', { target: 'p', opacity: .45 }) : action.method === 'facet' && ['parallel', 'pie'].includes(name)
    ? { ...action, args: { ...action.args, guides: { axes: 'each', legend: 'shared' } } } : action),
    ...(['parallel', 'pie'].includes(name) ? [] : cartesian)];
  if (name === 'scatter') actions.push(
    call('encodeSize', { target: 'p', value: 70 }),
    call('createRegression', { target: 'p', method: 'linear', groupBy: 'g' }),
    call('createAdjacentPlot', { id: 'q', source: 'p', position: 'right', plot: { action: 'createLinePlot', options: { data: 'd', x: 'x', y: 'y', color } }, share: { x: true, y: true, color: true }, gap: 8 }));
  if (name === 'bar') actions.push(call('createOverlay', { id: 'overlay', source: 'p', type: 'line', basis: 'visibleItems', series: 'source' }));
  if (name === 'beeswarm') actions.push(call('createLayerPlot', { id: 'box', source: 'p', plot: { action: 'createBoxPlot', options: { whisker: { type: 'tukey' } } }, placement: 'back' }));
  const samples = actions.map(action => ({ chart: name, method: action.method, prepareMs: [], applyMs: [], restoreMs: [] }));
  for (let trial = 0; trial < trials; trial++) {
    console.error(`${name}: trial ${trial + 1}/${trials}`);
    const guides = { legend: { target: 'p', channels: ['color'] } };
    const initial = factory();
    const program = initial.createGuides(Object.keys(initial.semanticSpec.guides?.legend ?? {}).length ? {} : guides)
      .fitCanvas({ align: 'center', padding: 6, minPlotWidth: 1, minPlotHeight: 1 });
    const service = createCalculationService();
    service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(program), guideCall: { method: 'createGuides', args: {} } });
    for (const [index, action] of actions.entries()) {
      const prepared = measure(() => service.execute({ type: 'prepare', stateId: 1, action }));
      const applied = measure(() => service.execute({ type: 'materialize', stateId: 1, nextStateId: 2 + index, action }));
      const restored = measure(() => {
        const next = unpackProgramUpdate(program, applied.value.update);
        return { program: next, view: unpackProgramUpdate(next, applied.value.viewUpdate) };
      });
      const result = samples[index];
      const fingerprint = hash([prepared.value, restored.value.program.semanticSpec, restored.value.program.graphicSpec,
        restored.value.program.trace, restored.value.view.graphicSpec, restored.value.view.trace]);
      if (result.fingerprint) assert.equal(fingerprint, result.fingerprint, `${name} ${action.method} repeat is deterministic`);
      result.fingerprint = fingerprint;
      result.nodes = prepared.value.scene.nodes.length;
      result.prepareMs.push(prepared.ms); result.applyMs.push(applied.ms); result.restoreMs.push(restored.ms);
    }
  }
  results.push(...samples);
}
console.log(JSON.stringify({ runtime: process.version, trials, results }, null, 2));
