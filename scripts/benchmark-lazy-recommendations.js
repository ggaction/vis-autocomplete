import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createRecommendationEngine } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { selectionData } from '../web/selection-setup.js';
import { addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { createCalculationService } from '../web/calculation-service.js';
import { ggactionSource } from './ggaction-source.js';

const rows = JSON.parse(await readFile(new URL('../web/data/cars.json', import.meta.url)));
const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url)));
const timed = fn => { const start = performance.now(), value = fn(); return { ms: performance.now() - start, value }; };
const summary = values => ({ medianMs: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)], samples: values });
const options = { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS };
const states = [];
for (const name of ['scatter', 'scatter-opacity', 'scatter-color-size']) {
  const eager = [], first = [], repeated = [], next = [], styles = [], transforms = [], hydration = [];
  let checks;
  for (let trial = 0; trial < 3; trial++) {
    const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows });
    const selected = selectionData(base, profileDataset(base, 'dataset'), rows,
      { x: 'Horsepower', y: 'Miles_per_Gallon', color: '' });
    let raw = selected.program.createScatterPlot({ id: 'plot', data: selected.data, x: 'Horsepower', y: 'Miles_per_Gallon', point: { radius: 3, opacity: 0.8 } });
    if (name === 'scatter-opacity') raw = raw.encodeOpacity({ target: 'plot', value: .7 });
    if (name === 'scatter-color-size') raw = raw.encodeColor({ target: 'plot', field: 'Origin' }).encodeSize({ target: 'plot', field: 'Weight_in_lbs' });
    const view = addDefaultGuides(raw), engine = createRecommendationEngine(model);
    eager.push(timed(() => engine.recommend(view, { ...options, authoringProgram: raw })).ms);
    const service = createCalculationService(model), snapshot = serializeProgram(raw);
    hydration.push(timed(() => service.execute({ type: 'state', stateId: 1, snapshot, guideCall: { method: 'createGuides', args: {} } })).ms);
    const request = { type: 'recommend', stateId: 1, options, group: 'encoding' };
    const response = timed(() => service.execute(request)); first.push(response.ms);
    checks = { validatedCalls: response.value.result.diagnostics.validatedCalls.length,
      firstPageMethods: response.value.result.recommendations.map(r => r.method), rankedGroupCandidates: response.value.pagination.rankedCandidates };
    repeated.push(timed(() => service.execute(request)).ms);
    next.push(timed(() => service.execute({ ...request, page: 1 })).ms);
    styles.push(timed(() => service.execute({ ...request, group: 'style' })).ms);
    transforms.push(timed(() => service.execute({ ...request, group: 'transform' })).ms);
  }
  states.push({ name, eagerAllGroups: summary(eager), lazyFirstFive: summary(first), repeatedPage: summary(repeated),
    nextEncodingPage: summary(next), firstStylePage: summary(styles), firstTransformPage: summary(transforms), stateHydration: summary(hydration), checks });
}
const report = { runtime: process.version, library: ggactionSource(),
  scope: 'Actual Node worker service/native authoring path, 3 fresh states per case; excludes browser DOM/paint/IPC and serialization of input snapshot. Hydration measured separately.', states };
await writeFile(new URL('../output/performance-lazy.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
