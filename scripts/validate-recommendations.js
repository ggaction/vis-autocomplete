import { readFile, writeFile } from 'node:fs/promises';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { isDeepStrictEqual } from 'node:util';
import { createRecommendationEngine, profileDataset } from '../src/index.js';
import { selectedPlotDefinitions } from '../src/selected-plots.js';
import { selectionData } from '../web/selection-setup.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../web/plot-setup.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from '../web/parameters.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS, groupRecommendations } from '../web/option-groups.js';
import { createCalculationService } from '../web/calculation-service.js';

export async function validateRecommendations() {
  const rows = JSON.parse(await readFile(new URL('../web/data/cars.json', import.meta.url)));
  const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url)));
  const engine = createRecommendationEngine(model), states = [];
  for (const color of ['', 'Origin']) {
    const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows });
    const source = profileDataset(base, 'dataset'), selection = { x: 'Horsepower', y: 'Miles_per_Gallon', color };
    const setup = selectionData(base, source, rows, selection), profile = { ...source, id: setup.data };
    for (const spec of selectedPlotDefinitions(profile, selection, rows).filter(spec => !spec.requirement)) {
      const start = prepareGuidedAction(setup.program, { method: spec.method, args: spec.build(spec.values) }, setup.program, spec.setup?.(spec.values));
      const target = start.authoringPreview.semanticSpec.layers.find(l => l.id === 'plot')?.id ?? start.authoringPreview.semanticSpec.layers[0].id;
      const result = engine.recommend(start.preview, { target, ...FOLLOWUP_RECOMMENDATION_OPTIONS, authoringProgram: start.authoringPreview });
      const errors = [];
      let verified = 0;
      for (const rec of result.recommendations) {
        try {
          const editor = recommendationParameters(rec, profileDataset(start.preview, result.state.data));
          const defaults = valuesFor(editor.controls);
          const action = buildRecommendationCall({ ...editor, method: rec.method }, defaults);
          const prepared = prepareGuidedAction(start.authoringPreview, action, start.preview);
          if (prepared.authoringPreview.trace.children.at(-1).op !== action.method) throw new Error('Not one native action');
          if (!renderToSVG(prepared.preview).startsWith('<svg')) throw new Error('Invalid SVG');
          verified++;
        } catch (error) { errors.push({ method: rec.method, message: error.message }); }
      }
      const groups = groupRecommendations(result.recommendations, 1000);
      const service = createCalculationService(model);
      service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(start.authoringPreview), guideCall: start.guideCall });
      const ranking = recs => recs.map(rec => [rec.id, rec.score, rec.method]);
      for (const [group, recommendations] of Object.entries(groups)) {
        const request = { type: 'recommend', stateId: 1, options: { target, ...FOLLOWUP_RECOMMENDATION_OPTIONS }, group };
        let remote = service.execute(request);
        for (let page = 1; page < remote.pagination.pageCount; page++) remote = service.execute({ ...request, page });
        if (!isDeepStrictEqual(ranking(recommendations), ranking(remote.result.recommendations))) errors.push({
          method: 'worker-ranking', message: `${group}: paginated Worker ranking differs from the native engine.` });
      }
      let workerRoundTrips = 0;
      for (const rec of Object.values(groups).map(recs => recs[0]).filter(Boolean)) {
        try {
          const editor = recommendationParameters(rec, profileDataset(start.preview, result.state.data));
          const action = buildRecommendationCall({ ...editor, method: rec.method }, valuesFor(editor.controls));
          const reference = prepareGuidedAction(start.authoringPreview, action, start.preview);
          const actual = service.execute({ type: 'materialize', stateId: 1, action });
          const raw = deserializeProgram(actual.snapshot);
          if (!isDeepStrictEqual(raw.semanticSpec, reference.authoringPreview.semanticSpec) ||
            !isDeepStrictEqual(raw.graphicSpec, reference.authoringPreview.graphicSpec)) throw new Error('Worker snapshot changed chart output.');
          workerRoundTrips++;
        } catch (error) { errors.push({ method: rec.method, message: error.message }); }
      }
      states.push({ plot: spec.method, color, groups: Object.fromEntries(Object.entries(groups).map(([id, recs]) => [id, recs.length])),
        verified, workerRoundTrips, errors, rejected: result.diagnostics.rejected.map(r => ({ call: r.call, reason: r.message ?? r.findings?.[0]?.message ?? r.reason })) });
    }
  }
  const report = { chartsInCorpus: model.chartCount, programsInCorpus: model.provenance.programCount,
    observedActions: model.actionEvidence.methods.length, policy: 'all-ranked-options-paginated-within-each-group', states };
  await writeFile(new URL('../output/recommendation-coverage.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  const failures = states.flatMap(s => s.errors.map(e => `${s.plot}/${s.color}: ${e.method}: ${e.message}`));
  console.log(JSON.stringify({ states: states.length, cardsVerified: states.reduce((n, s) => n + s.verified, 0),
    workerRoundTrips: states.reduce((n, s) => n + s.workerRoundTrips, 0), failures }, null, 2));
  if (failures.length) throw new Error('Some recommended cards cannot be previewed. See output/recommendation-coverage.json.');
  return report;
}

if (process.argv[1]?.endsWith('/validate-recommendations.js')) await validateRecommendations();
