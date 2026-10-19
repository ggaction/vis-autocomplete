import { readFile, writeFile } from 'node:fs/promises';
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
    } catch (error) { editorErrors.push({ method: rec.method, reason: error.message }); }
  }
  states.push({ plot: definition.method, mark: root.mark.type, expected, missing, editorErrors, unsupported,
    served: result.recommendations.map(r => r.method), coverage: result.diagnostics.candidateCoverage,
    rejected: result.diagnostics.rejected.map(r => ({ call: r.call, reason: r.message ?? r.reason })) });
  console.log(definition.method, 'cards', result.recommendations.length, 'missing', missing.length, 'editor errors', editorErrors.length);
}
const report = { states, totals: { plots: states.length, cards: states.reduce((n,s)=>n+s.served.length,0),
  missing: states.reduce((n,s)=>n+s.missing.length,0), editorErrors: states.reduce((n,s)=>n+s.editorErrors.length,0) } };
await writeFile(new URL('../output/action-availability-audit.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.totals));
if (report.totals.missing || report.totals.editorErrors) process.exitCode = 1;
