import { deserializeProgram, serializeProgram } from 'ggaction/persistence';
import { renderToSVG } from 'ggaction/svg';
import { createRecommendationEngine, neighboringParameters } from '../src/engine.js';
import { addDefaultGuides, prepareGuidedAction } from '../src/prepare.js';
import { createLRU, signature } from '../src/cache.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from './parameters.js';
import { filterActionRecommendations, normalizeSearchQuery } from '../src/action-search.js';

// Both worker roles use the exact public native calls and the shared preparer.
export function createCalculationService(model) {
  const states = createLRU(12);
  const engine = model ? createRecommendationEngine(model) : null;
  const artifacts = new WeakMap();
  const artifact = prepared => {
    if (artifacts.has(prepared)) return artifacts.get(prepared);
    const value = { recommendation: prepared.recommendation, guideCall: prepared.guideCall,
      prerequisiteCalls: prepared.prerequisiteCalls,
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
        return { recommendation: { ...choice, method: action.method, args: action.args, call: prepared.recommendation.call,
          parameterValues, defaultDecisions: editor.defaultDecisions,
          validation: prepared.recommendation.validation }, action, prepared: artifact(prepared) };
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
    execute({ type, stateId, snapshot, guideCall, action, setupCalls = [], options, group, page = 0, searchQuery = '' }) {
      if (type === 'activate') return { exists: Boolean(states.get(stateId)) };
      if (type === 'state') {
        const program = deserializeProgram(snapshot);
        states.set(stateId, { program, view: guideCall ? addDefaultGuides(program, guideCall) : program,
          rankings: createLRU(8), decks: createLRU(8) });
        return { exists: true };
      }
      const { program, view, rankings, decks } = stateFor(stateId);
      if (type === 'prepare' || type === 'materialize') {
        const prepared = prepareGuidedAction(program, action, view, setupCalls);
        if (type === 'materialize') return { snapshot: serializeProgram(prepared.authoringPreview), guideCall: prepared.guideCall };
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
          if (!original) original = rankings.set(rankingKey, engine.rank(view, { ...options, group }));
          const matches = filterActionRecommendations(original.recommendations, query);
          const ranked = { ...original, recommendations: matches, diagnostics: { ...original.diagnostics,
            search: { query, totalCandidates: original.recommendations.length, matchingCandidates: matches.length } } };
          deck = decks.set(key, { ranked, profile: profileDataset(view, ranked.state.data), cursor: 0,
            recommendations: [], defaults: [], diagnostics: { validatedCalls: [], rejected: [] } });
        }
        const { ranked, profile, diagnostics } = deck;
        while (deck.recommendations.length < (page + 1) * 5 && deck.cursor < ranked.recommendations.length) {
          const recommendation = ranked.recommendations[deck.cursor++];
          try {
            const next = prepareDefault(program, view, recommendation, profile, diagnostics);
            if (!next) continue;
            deck.recommendations.push(next.recommendation);
            deck.defaults.push({ action: next.action, prepared: next.prepared });
          } catch (error) {
            diagnostics.rejected.push({ method: recommendation.method, reason: 'parameters', message: error.message });
          }
        }
        const remaining = ranked.recommendations.length - deck.cursor;
        return { result: { ...ranked, recommendations: deck.recommendations.slice(0, (page + 1) * 5),
          diagnostics: { ...ranked.diagnostics, validatedCalls: [...diagnostics.validatedCalls],
            rejected: [...diagnostics.rejected], scannedCandidates: deck.cursor } }, profile,
          defaults: deck.defaults.slice(page * 5, (page + 1) * 5),
          pagination: { page, pageSize: 5, pageCount: Math.ceil((deck.recommendations.length + remaining) / 5),
            complete: remaining === 0, rankedCandidates: ranked.recommendations.length } };
      }
      throw new Error(`Unknown calculation request: ${type}`);
    },
  };
}
