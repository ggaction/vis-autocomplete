import { deserializeProgram, serializeProgram } from 'ggaction/persistence';
import { packProgramUpdate, unpackProgramUpdate } from './program-transfer.js';
import { getDatasetSchema } from 'ggaction/inspection';
import { renderToSVG } from 'ggaction/svg';
import { createRecommendationEngine, neighboringParameters } from '../src/engine.js';
import { addDefaultGuides, prepareGuidedAction } from '../src/prepare.js';
import { createLRU, signature } from '../src/cache.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from './parameters.js';
import { filterActionRecommendations, normalizeSearchQuery } from '../src/action-search.js';
import { createHierarchyProjection } from '../src/action-hierarchy.js';

// Both worker roles use the exact public native calls and the shared preparer.
export function createCalculationService(model) {
  const states = createLRU(12);
  const retain = (id, program, view) => states.set(id, { program, view, rankings: createLRU(8), decks: createLRU(8) });
  const engine = model ? createRecommendationEngine(model) : null;
  const artifacts = new WeakMap();
  const artifact = prepared => {
    if (artifacts.has(prepared)) return artifacts.get(prepared);
    const value = { recommendation: prepared.recommendation, guideCall: prepared.guideCall,
      prerequisiteCalls: prepared.prerequisiteCalls, postActionCalls: prepared.postActionCalls,
      preview: { svg: renderToSVG(prepared.preview, { resourceNamespace: 'worker-preview' }),
        semanticSpec: { layers: prepared.preview.semanticSpec.layers, coordinates: prepared.preview.semanticSpec.coordinates } } };
    artifacts.set(prepared, value); return value;
  };
  const stateFor = id => {
    const state = states.get(id);
    if (!state) throw new Error('Calculation state expired.');
    return state;
  };
  const prepareDefault = (program, view, recommendation, profile, diagnostics) => {
    const attempted = new Set();
    const attempt = (choice, allowNeighbors = true) => {
      const editor = recommendationParameters(choice, profile);
      const parameterValues = valuesFor(editor.controls);
      const action = buildRecommendationCall({ ...editor, method: choice.method }, parameterValues);
      const key = signature(action);
      if (attempted.has(key)) return null;
      attempted.add(key);
      diagnostics.validatedCalls.push({ method: action.method, args: action.args });
      try {
        const prepared = prepareGuidedAction(program, action, view);
        const fittedAction = { method: prepared.recommendation.method, args: prepared.recommendation.args };
        return { recommendation: { ...choice, ...fittedAction, call: prepared.recommendation.call,
          parameterValues, defaultDecisions: editor.defaultDecisions,
          validation: prepared.recommendation.validation }, action: fittedAction, prepared: artifact(prepared) };
      } catch (error) {
        if (error.reason === 'no-change' && allowNeighbors) {
          for (const neighbor of neighboringParameters({ ...choice, args: action.args })) {
            const next = attempt({ ...neighbor, skipParameterDefaults: true }, false);
            if (next) return next;
          }
        }
        diagnostics.rejected.push({ method: action.method, reason: error.reason ?? 'execution', message: error.message });
        return null;
      }
    };
    // Keep all editor choices, but validate just one usable default per card.
    // Other values pass through the same native preparer on hover/selection.
    for (const alternative of recommendation.alternatives) {
      const alternatives = [alternative, ...recommendation.alternatives.filter(value => value !== alternative)];
      const prepared = attempt({ ...recommendation, ...alternative, alternatives });
      if (prepared) return prepared;
      // A learned value can be incompatible/no-op in this particular chart.
      // Retry the valid recipe rather than erasing the public action.
      const fallback = attempt({ ...recommendation, ...alternative, alternatives, skipParameterDefaults: true });
      if (fallback) return fallback;
    }
    return null;
  };
  return {
    execute({ type, stateId, nextStateId, baseStateId, snapshot, update, guideCall, action, setupCalls = [], options, group, page = 0, searchQuery = '', batchSize = Infinity }) {
      if (type === 'cancel-recommendations') return {};
      if (type === 'activate') return { exists: Boolean(states.get(stateId)) };
      if (type === 'state') {
        const program = deserializeProgram(snapshot);
        retain(stateId, program, guideCall ? addDefaultGuides(program, guideCall) : program);
        return { exists: true };
      }
      if (type === 'state-update') {
        const program = unpackProgramUpdate(stateFor(baseStateId).program, update);
        retain(stateId, program, guideCall ? addDefaultGuides(program, guideCall) : program);
        return { exists: true };
      }
      if (type === 'advance') {
        const base = stateFor(baseStateId);
        const prepared = prepareGuidedAction(base.program, action, base.view, setupCalls);
        retain(stateId, prepared.authoringPreview, prepared.preview);
        return { exists: true };
      }
      const { program, view, rankings, decks } = stateFor(stateId);
      if (type === 'prepare' || type === 'materialize') {
        const prepared = prepareGuidedAction(program, action, view, setupCalls);
        if (type === 'materialize') {
          if (nextStateId !== undefined) {
            const update = packProgramUpdate(program, prepared.authoringPreview);
            retain(nextStateId, prepared.authoringPreview, prepared.preview);
            return { update, guideCall: prepared.guideCall };
          }
          return { snapshot: serializeProgram(prepared.authoringPreview), guideCall: prepared.guideCall };
        }
        return artifact(prepared);
      }
      if (type === 'recommend') {
        if (!['encoding', 'transform', 'style'].includes(group)) throw new TypeError('Unknown recommendation group.');
        if (!Number.isInteger(page) || page < 0) throw new TypeError('page must be a nonnegative integer.');
        const query = normalizeSearchQuery(searchQuery), rankingKey = signature([options, group]);
        const key = signature([options, group, query]);
        let deck = decks.get(key);
        if (!deck) {
          let original = rankings.get(rankingKey);
          if (!original) {
            // Import hints describe source columns. Aggregation and projection can
            // remove columns or replace them with native derived fields.
            const target = options?.target
              ? view.semanticSpec.layers.find(layer => layer.id === options.target)
              : view.semanticSpec.layers.length === 1 ? view.semanticSpec.layers[0] : undefined;
            const data = target?.data ?? options?.data;
            const names = new Set(getDatasetSchema(view, { ...(data ? { data } : {}) }).schema.fields.map(field => field.name));
            const fieldTypes = Object.fromEntries(Object.entries(options?.fieldTypes ?? {}).filter(([name]) => names.has(name)));
            original = rankings.set(rankingKey, engine.rank(view, { ...options, fieldTypes, group, hierarchy: false }));
          }
          const matches = filterActionRecommendations(original.recommendations, query);
          const ranked = { ...original, recommendations: matches, diagnostics: { ...original.diagnostics,
            search: { query, totalCandidates: original.recommendations.length, matchingCandidates: matches.length } } };
          const available = new Set(getDatasetSchema(view, { data: ranked.state.data }).schema.fields.map(f => f.name));
          const fieldTypes = Object.fromEntries(Object.entries(options?.fieldTypes ?? {}).filter(([name]) => available.has(name)));
          deck = decks.set(key, { ranked, profile: profileDataset(view, ranked.state.data, fieldTypes), cursor: 0,
            // Searching is an explicit request for the fine-grained action;
            // it bypasses promotion and still uses the same cached raw ranking.
            hierarchy: options?.hierarchy && !query ? createHierarchyProjection(matches, program) : null,
            emitted: new Set(), unavailable: new Set(),
            separateApplied: options?.deprioritizeAppliedActions && !query, reachedApplied: false,
            pages: [], pageStart: 0,
            recommendations: [], defaults: [], diagnostics: { validatedCalls: [], rejected: [] } });
        }
        const { ranked, profile, diagnostics } = deck;
        const finishPage = () => {
          deck.pages.push({ start: deck.pageStart, end: deck.recommendations.length });
          deck.pageStart = deck.recommendations.length;
        };
        let processed = 0;
        while (deck.pages.length <= page && deck.cursor < ranked.recommendations.length && processed++ < batchSize) {
          const rank = deck.cursor, source = ranked.recommendations[rank];
          // Demotion must survive pagination: never backfill a short new-action
          // page with used actions. Do not validate those until their page opens.
          if (deck.separateApplied && source.previouslyApplied && !deck.reachedApplied) {
            deck.reachedApplied = true;
            if (deck.recommendations.length > deck.pageStart) finishPage();
            if (deck.pages.length > page) break;
          }
          deck.cursor++;
          for (const candidate of deck.hierarchy?.choices(source) ?? [source]) {
            // A valid displayed ancestor covers later descendants too. An
            // invalid ancestor does not: try the next ancestor or the leaf.
            if (deck.unavailable.has(candidate.id)) continue;
            if (deck.emitted.has(candidate.id)) break;
            const recommendation = deck.hierarchy?.promote(candidate, source, rank) ?? candidate;
            try {
              const next = prepareDefault(program, view, recommendation, profile, diagnostics);
              if (!next) { deck.unavailable.add(candidate.id); continue; }
              deck.emitted.add(candidate.id);
              deck.recommendations.push(next.recommendation);
              deck.defaults.push({ action: next.action, prepared: next.prepared });
              break;
            } catch (error) {
              deck.unavailable.add(candidate.id);
              diagnostics.rejected.push({ method: recommendation.method, reason: 'parameters', message: error.message });
            }
          }
          if (deck.recommendations.length - deck.pageStart === 5) finishPage();
        }
        if (deck.cursor === ranked.recommendations.length && deck.recommendations.length > deck.pageStart) finishPage();
        const projected = deck.hierarchy?.project(deck.unavailable) ?? ranked.recommendations;
        const complete = deck.cursor === ranked.recommendations.length;
        const remaining = complete ? [] : projected.filter(rec => !deck.emitted.has(rec.id) && !deck.unavailable.has(rec.id));
        const remainingApplied = deck.separateApplied ? remaining.filter(rec => rec.previouslyApplied).length : 0;
        const pageCount = deck.pages.length + Math.ceil((remaining.length - remainingApplied) / 5) + Math.ceil(remainingApplied / 5);
        const pending = deck.pages.length <= page && !complete;
        const range = deck.pages[page] ?? { start: deck.pageStart, end: deck.recommendations.length };
        return { result: { ...ranked, recommendations: deck.recommendations.slice(0, range.end),
          diagnostics: { ...ranked.diagnostics, hierarchy: Boolean(deck.hierarchy), eligibleGroups: projected.length, validatedCalls: [...diagnostics.validatedCalls],
            rejected: [...diagnostics.rejected], scannedCandidates: deck.cursor } }, profile,
          defaults: deck.defaults.slice(range.start, range.end),
          pagination: { page, pageSize: 5, pageCount, pageRanges: deck.pages.slice(0, page + 1), pending,
            complete: complete || remaining.length === 0, rankedCandidates: projected.length,
            newActionsExhausted: deck.separateApplied && deck.reachedApplied &&
              deck.recommendations.every(rec => rec.previouslyApplied) } };
      }
      throw new Error(`Unknown calculation request: ${type}`);
    },
  };
}
