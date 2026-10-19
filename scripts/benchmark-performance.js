import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createRecommendationEngine } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { selectionData } from '../web/selection-setup.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { createCalculationService } from '../web/calculation-service.js';
import { ggactionSource } from './ggaction-source.js';

const rows = JSON.parse(await readFile(new URL('../web/data/cars.json', import.meta.url)));
const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url)));
const summary = values => ({ medianMs: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)],
  minMs: Math.min(...values), maxMs: Math.max(...values), samples: values });
const timed = fn => { const t = performance.now(); const value = fn(); return { ms: performance.now() - t, value }; };
const report = { environment: 'Node using the identical worker service; excludes browser DOM/paint; no CPU profiler',
  runtime: process.version, library: ggactionSource(), states: [] };
for (const color of ['', 'Origin']) {
  const cold = [], warm = [], serviceCold = [], previewCold = [], previewWarm = [], regressionCold = [];
  let recommendationCount;
  for (let trial = 0; trial < 3; trial++) {
    const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows });
    const selected = selectionData(base, profileDataset(base, 'dataset'), rows, { x: 'Horsepower', y: 'Miles_per_Gallon', color });
    const prepared = prepareGuidedAction(selected.program, { method: 'createScatterPlot', args: { id: 'plot', data: selected.data,
      x: 'Horsepower', y: 'Miles_per_Gallon', ...(color ? { color } : {}) } });
    const engine = createRecommendationEngine(model), options = { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS };
    const first = timed(() => engine.recommend(prepared.preview, options));
    cold.push(first.ms); recommendationCount = first.value.recommendations.length;
    warm.push(timed(() => engine.recommend(prepared.preview, options)).ms);
    const service = createCalculationService(model);
    service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(prepared.authoringPreview), guideCall: prepared.guideCall });
    serviceCold.push(timed(() => service.execute({ type: 'recommend', stateId: 1, options, group: 'encoding' })).ms);
    for (let i = 0; i < 10; i++) {
      const request = { type: 'prepare', stateId: 1, action: { method: 'encodeSize', args: { target: 'plot', value: 40 + i * 20 } } };
      previewCold.push(timed(() => service.execute(request)).ms);
      previewWarm.push(timed(() => service.execute(request)).ms);
    }
    regressionCold.push(timed(() => service.execute({ type: 'prepare', stateId: 1,
      action: { method: 'createRegression', args: { target: 'plot', groupBy: false, method: 'linear', level: 0.91 } } })).ms);
  }
  report.states.push({ color, recommendationCount, recommendationCold: summary(cold), recommendationWarm: summary(warm),
    workerServiceColdIncludingFirstPage: summary(serviceCold), sizePreviewNewParameters: summary(previewCold),
    sizePreviewCached: summary(previewWarm), regressionPreview: summary(regressionCold) });
}
await writeFile(new URL('../output/performance-after.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
