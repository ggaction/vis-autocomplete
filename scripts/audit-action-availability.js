import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createCalculationService } from '../web/calculation-service.js';
import { createRecommendationEngine, profileDataset } from '../src/index.js';
import { getPlotDefinitions, defaultValues } from '../src/plot-catalog.js';
import { cars } from '../examples/scenarios.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from '../web/parameters.js';

// Independent executable probes: expected eligibility comes from public library
// calls, never from the candidate provider or a copied mark compatibility table.
const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model), states = [];
const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: cars });
for (const definition of getPlotDefinitions(profileDataset(base, 'dataset'))) {
  const prepared = prepareGuidedAction(base, { method: definition.method, args: definition.build(defaultValues(definition)) });
  const raw = prepared.authoringPreview, view = prepared.preview;
  const root = raw.semanticSpec.layers.find(l => l.id === 'plot') ?? raw.semanticSpec.layers[0];
  const target = root.id, options = { target, ...FOLLOWUP_RECOMMENDATION_OPTIONS };
  const service = createCalculationService(model);
  service.execute({type:'state',stateId:1,snapshot:serializeProgram(raw),guideCall:prepared.guideCall});
  const ranked = engine.rank(view, options), served = [], rejected = [];
  for (const group of ['encoding','transform','style']) {
    let response;
    for (let page=0; ; page++) {
      response=service.execute({type:'recommend',stateId:1,group,page,options});
      if (response.pagination.complete) break;
    }
    served.push(...response.result.recommendations); rejected.push(...response.result.diagnostics.rejected);
  }
  const result={...ranked,recommendations:served,diagnostics:{...ranked.diagnostics,rejected}};
  const probes = [
    ['encodeColor', 'color', { value: '#e45756' }], ['encodeStroke', 'stroke', { value: '#000000' }],
    ['encodeOpacity', 'opacity', { value: .43 }], ['encodeSize', 'size', { value: 81.5 }],
    ['encodeStrokeWidth', 'strokeWidth', { value: 2.5 }], ['encodeStrokeDash', 'strokeDash', { value: 'dashed' }],
    ['encodeAngle', 'angle', { value: 30 }], ['encodeShape', 'shape', { field: 'Origin', fieldType: 'nominal' }],
  ].filter(([, channel]) => !root.encoding?.[channel]);
  const expected = [], unsupported = [], missing = [], editorErrors = [];
  const positional = new Set(['encodeX', 'encodeY', 'encodeX2', 'encodeY2', 'encodeTheta', 'encodeR',
    'editBoxPlot', 'editViolinPlot', 'editGradientPlot', 'editECDFPlot', 'editEndpointPlot', 'editRegression', 'editErrorBar', 'encodeParallelCoordinates', 'editBin2DData', 'editRScale']);
  const config = raw.markConfigs[target] ?? {}, coordinate = raw.semanticSpec.coordinates.find(c => c.id === root.coordinate);
  const originals = profileDataset(base, 'dataset').fields.filter(f => f.usable);
  // Derived boundaries are implementation fields, so the public facade must
  // rebind the original variable and recompute every owned child together.
  const owner = Object.entries({ boxPlot: 'editBoxPlot', violinPlot: 'editViolinPlot', gradientPlot: 'editGradientPlot',
    ecdfPlot: 'editECDFPlot', endpointPlot: 'editEndpointPlot' }).find(([key]) => config[key]);
  const nativeOptions = new Map();
  const offer = (method, args) => nativeOptions.set(method, [...(nativeOptions.get(method) ?? []), args]);
  if (owner) {
    const [key, method] = owner, c = config[key];
    for (const field of originals.filter(f => f.type === 'quantitative')) {
      const role = key === 'ecdfPlot' ? 'field' : key === 'endpointPlot' ? c.roles.value ? 'value' : 'start' : c.orientation === 'horizontal' ? 'x' : 'y';
      offer(method, { target, [role]: role === 'field' ? field.name : { field: field.name, fieldType: 'quantitative' } });
    }
  } else if (coordinate?.type === 'parallel') {
    offer('encodeParallelCoordinates', { target, dimensions: [...root.encoding.parallel.dimensions].reverse().map(d => d.field) });
  } else {
    const derived = raw.semanticSpec.datasets.find(d => d.id === root.data)?.transform?.[0];
    if (derived?.type === 'bin2d') offer('editBin2DData', { target: root.data, bins: 14, dependents: 'recompute' });
    else if (config.intervalPlot) for (const field of originals.filter(f => f.type === 'quantitative')) {
      const id = config.intervalPlot.intervalId, interval = raw.markConfigs[id].errorBar;
      offer('editErrorBar', { target: id, [interval.orientation === 'vertical' ? 'y' : 'x']: { field: field.name } });
    }
    // Horizon's folded bands currently have no public source-variable editor.
    // Do not claim arbitrary generated Y/Y2 remapping as that capability.
    else if (derived?.type !== 'horizon') for (const [channel, method] of Object.entries({ x: 'encodeX', y: 'encodeY', x2: 'encodeX2', y2: 'encodeY2', theta: 'encodeTheta', radius: 'encodeR' })) {
      if (channel.endsWith('2') && !root.encoding[channel]) continue;
      for (const field of originals) offer(method, { target, field: field.name, fieldType: field.type });
    }
  }
  const radial = raw.semanticSpec.scales.find(s => s.id === root.encoding.radius?.scale);
  if (radial?.radialMapping) {
    offer('encodeR', { target, aggregate: 'count', mapping: 'area' });
    offer('editRScale', { target, radialMapping: radial.radialMapping === 'area' ? 'radius-length' : 'area' });
  }
  for (const [method, variants] of nativeOptions) {
    let accepted = false, reason;
    for (const args of variants) {
      try { prepareGuidedAction(raw, { method, args }, view); accepted = true; break; }
      catch (error) { reason = error.message; }
    }
    if (accepted) expected.push(method);
    else unsupported.push({ method, reason });
  }
  for (const [method, , options] of probes) {
    try { prepareGuidedAction(raw, { method, args: { target, ...options } }, view); expected.push(method); }
    catch (error) { unsupported.push({ method, reason: error.message }); }
  }
  try {
    const coordinate = raw.semanticSpec.coordinates.find(c => c.id === root.coordinate);
    prepareGuidedAction(raw, { method: 'facet', args: { data: 'dataset', field: 'Origin', columns: 3,
      guides: { axes: coordinate?.type === 'cartesian' ? 'outer' : 'each', legend: false } } }, view);
    expected.push('facet');
  } catch (error) { unsupported.push({ method: 'facet', reason: error.message }); }
  for (const method of expected) if (!result.recommendations.some(r => r.method === method)) missing.push(method);
  for (const rec of result.recommendations) {
    try {
      const editor = recommendationParameters(rec, profileDataset(view, result.state.data));
      prepareGuidedAction(raw, buildRecommendationCall({ ...editor, method: rec.method }, valuesFor(editor.controls)), view);
      if (positional.has(rec.method)) {
        const defaults = valuesFor(editor.controls);
        for (const control of editor.resolveControls(defaults).filter(c => c.type === 'select')) for (const choice of control.choices ?? []) {
          if (choice.disabled || control.when && !control.when(defaults)) continue;
          try {
            const values = editor.normalizeValues({ ...defaults, [control.key]: choice.value }, control.key);
            prepareGuidedAction(raw, buildRecommendationCall({ ...editor, method: rec.method }, values), view);
          } catch (error) {
            if (error.reason !== 'no-change') editorErrors.push({ method: rec.method, parameter: control.key, value: choice.value, reason: error.message });
          }
        }
      }
    } catch (error) { editorErrors.push({ method: rec.method, reason: error.message }); }
  }
  states.push({ plot: definition.method, mark: root.mark.type, expected, missing, editorErrors, unsupported,
    served: result.recommendations.map(r => r.method), coverage: result.diagnostics.candidateCoverage,
    rejected: result.diagnostics.rejected.map(r => ({ call: r.call, reason: r.message ?? r.reason })) });
  console.log(definition.method, 'cards', result.recommendations.length, 'missing', missing.length, 'editor errors', editorErrors.length);
}
const report = { states, totals: { plots: states.length, cards: states.reduce((n,s)=>n+s.served.length,0),
  missing: states.reduce((n,s)=>n+s.missing.length,0), editorErrors: states.reduce((n,s)=>n+s.editorErrors.length,0) } };
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
await writeFile(new URL('../output/action-availability-audit.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.totals));
if (report.totals.missing || report.totals.editorErrors) process.exitCode = 1;
