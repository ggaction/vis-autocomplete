import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createCalculationService } from '../web/calculation-service.js';
import { createRecommendationEngine, profileDataset } from '../src/index.js';
import { getPlotDefinitions, defaultValues } from '../src/plot-catalog.js';
import { cars } from '../examples/scenarios.js';
import { importDataset } from '../src/data-import.js';
import { chartOwner } from '../src/chart-owner.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from '../web/parameters.js';

// Independent executable probes: expected eligibility comes from public library
// calls, never from the candidate provider or a copied mark compatibility table.
const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model), states = [], skipped = [];
const argument = flag => process.argv[process.argv.indexOf(flag) + 1];
const dataset = process.argv.includes('--dataset') ? argument('--dataset') : 'cars';
const values = dataset === 'cars' ? cars : importDataset(await readFile(new URL(`../web/data/${dataset}.json`, import.meta.url), 'utf8'), { format: 'json' }).rows;
const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values });
for (const definition of getPlotDefinitions(profileDataset(base, 'dataset'))) {
  if (process.argv.includes('--plot') && definition.method !== argument('--plot')) continue;
  if (definition.requirement) { skipped.push({ plot: definition.method, reason: definition.requirement }); continue; }
  const prepared = prepareGuidedAction(base, { method: definition.method, args: definition.build(defaultValues(definition)) });
  const raw = prepared.authoringPreview, view = prepared.preview;
  const root = raw.semanticSpec.layers.find(l => l.id === 'plot') ?? raw.semanticSpec.layers[0];
  // Audit detailed actions too: hierarchy deliberately keeps those searchable
  // behind their parent cards in the ordinary deck.
  const target = root.id, options = { target, ...FOLLOWUP_RECOMMENDATION_OPTIONS, hierarchy: false };
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
  const originals = profileDataset(base, 'dataset').fields.filter(f => f.usable);
  const category = originals.filter(f => ['nominal', 'ordinal'].includes(f.type) && f.distinct > 1)
    .sort((a, b) => a.distinct - b.distinct)[0];
  const probes = [
    ['encodeColor', 'color', { value: '#e45756' }], ['encodeStroke', 'stroke', { value: '#000000' }],
    ['encodeOpacity', 'opacity', { value: .43 }], ['encodeSize', 'size', { value: 81.5 }],
    ['encodeStrokeWidth', 'strokeWidth', { value: 2.5 }], ['encodeStrokeDash', 'strokeDash', { value: 'dashed' }],
    ['encodeAngle', 'angle', { value: 30 }],
    ['encodeShape', 'shape', category ? { field: category.name, fieldType: category.type } : { value: 'circle' }],
  ].filter(([, channel]) => !root.encoding?.[channel]);
  const expected = [], unsupported = [], missing = [], editorErrors = [];
  const positional = new Set(['encodeX', 'encodeY', 'encodeX2', 'encodeY2', 'encodeTheta', 'encodeR',
    'editBoxPlot', 'editViolinPlot', 'editGradientPlot', 'editECDFPlot', 'editEndpointPlot', 'editRegression', 'editErrorBar', 'encodeParallelCoordinates', 'editBin2DData', 'editRScale']);
  const config = raw.markConfigs[target] ?? {}, coordinate = raw.semanticSpec.coordinates.find(c => c.id === root.coordinate);
  // Derived boundaries are implementation fields, so the public facade must
  // rebind the original variable and recompute every owned child together.
  const semanticOwner = chartOwner(raw, root);
  const owner = Object.entries({ boxPlot: 'editBoxPlot', violinPlot: 'editViolinPlot', gradientPlot: 'editGradientPlot',
    ecdfPlot: 'editECDFPlot', endpointPlot: 'editEndpointPlot' }).find(([key]) => config[key]);
  const nativeOptions = new Map();
  const offer = (method, args) => nativeOptions.set(method, [...(nativeOptions.get(method) ?? []), args]);
  offer('createAnnotation', { id: 'audit-note', anchor: 'plot-center', data: root.data, text: 'Audit note' });
  offer('createTitle', { text: 'Audit title' });
  offer('editCanvas', { background: '#fff9db' });
  offer('createMarkLabels', { source: target, value: 'Value' });
  for (const direction of ['horizontal', 'vertical', 'radial', 'theta']) {
    if (!view.semanticSpec.guides.grid?.[direction]) continue;
    offer(`edit${direction[0].toUpperCase()}${direction.slice(1)}Grid`, { lineWidth: 2.25 });
  }
  for (const field of profileDataset(view, root.data).fields.filter(field => field.usable)) {
    const rows = view.semanticSpec.datasets.find(d => d.id === root.data)?.values ?? [];
    const distinct = [...new Set(rows.map(row => row[field.name]).filter(v => v != null))];
    if (distinct.length > 1) offer('filterMarks', { target, field: field.name, op: 'eq', value: distinct[0], mode: 'replace' });
  }
  if (semanticOwner?.radar) {
    offer('editRadarPlot', { target, wide: { fields: [...semanticOwner.config.wide.fields].reverse() } });
  } else if (semanticOwner?.method === 'editRaincloudPlot') {
    offer('editRaincloudPlot', { target: semanticOwner.target, point: { radius: 4 } });
  } else if (owner) {
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
    if (!category) throw new Error('This dataset has no categorical facet variable.');
    prepareGuidedAction(raw, { method: 'facet', args: { data: 'dataset', field: category.name, columns: Math.min(3, category.distinct),
      guides: { axes: coordinate?.type === 'cartesian' ? 'outer' : 'each', legend: false } } }, view);
    expected.push('facet');
  } catch (error) { unsupported.push({ method: 'facet', reason: error.message }); }
  for (const method of expected) if (!result.recommendations.some(r => r.method === method)) missing.push(method);
  for (const rec of result.recommendations) {
    try {
      const editor = recommendationParameters(rec, profileDataset(view, result.state.data));
      prepareGuidedAction(raw, { ...buildRecommendationCall({ ...editor, method: rec.method }, valuesFor(editor.controls)), allowUnchanged: true }, view);
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
const report = { dataset, states, skipped, totals: { plots: states.length, cards: states.reduce((n,s)=>n+s.served.length,0),
  missing: states.reduce((n,s)=>n+s.missing.length,0), editorErrors: states.reduce((n,s)=>n+s.editorErrors.length,0) } };
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
await writeFile(process.argv.includes('--output') ? argument('--output') : new URL('../output/action-availability-audit.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.totals));
if (report.totals.missing || report.totals.editorErrors) process.exitCode = 1;
