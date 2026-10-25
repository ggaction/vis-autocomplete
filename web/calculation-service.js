import { compositionRecommendations, compositionTitleRecommendations } from '../src/composition-recommendations.js';
import { chartAtPath, resolveEditingContext } from '../src/composition-context.js';
import { createTransitionScene } from 'ggaction/scene';
import { canvasGeometry } from './canvas-geometry.js';
import { deserializeProgram, serializeProgram } from 'ggaction/persistence';
import { packProgramUpdate, unpackProgramUpdate } from './program-transfer.js';
import { getDatasetSchema } from 'ggaction/inspection';
import { createRecommendationEngine, neighboringParameters } from '../src/engine.js';
import { addDefaultGuides, prepareGuidedAction, rememberDisplayedGuides } from '../src/prepare.js';
import { createLRU, signature } from '../src/cache.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from './parameters.js';
import { filterActionRecommendations, normalizeSearchQuery } from '../src/action-search.js';
import { createHierarchyProjection } from '../src/action-hierarchy.js';
import { prepareGuideEdits } from '../src/guide-group.js';
import { prepareTypography } from '../src/chart-typography.js';

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
      preview: { canvasGeometry: canvasGeometry(prepared.preview), graphicSpec: prepared.preview.graphicSpec,
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
    let unchanged = null;
    const attempt = (choice, allowNeighbors = true) => {
      const editor = recommendationParameters(choice, profile);
      const parameterValues = valuesFor(editor.controls);
      let action;
      try { action = buildRecommendationCall({ ...editor, method: choice.method }, parameterValues); }
      catch (error) { diagnostics.rejected.push({ method: choice.method, reason: 'scope', message: error.message }); return null; }
      const key = signature(action);
      if (attempted.has(key)) return null;
      attempted.add(key);
      diagnostics.validatedCalls.push({ method: action.method, args: action.args });
      try {
        const prepared = prepareGuidedAction(program, action, view);
        const fittedAction = { method: prepared.recommendation.method, args: prepared.recommendation.args };
        return { recommendation: { ...choice, ...fittedAction,
          ...(choice.editingScope ? { localRecommendation: { ...choice, editingScope: undefined } } : {}), call: prepared.recommendation.call,
          parameterValues, defaultDecisions: editor.defaultDecisions,
          validation: prepared.recommendation.validation }, action: fittedAction, prepared: artifact(prepared) };
      } catch (error) {
        if (error.reason === 'no-change' && recommendation.previouslyApplied && !unchanged) {
          // A valid native call that matches the current chart is still an
          // available editor. Retain it if no differing default exists; Apply
          // continues to validate normally and does not create duplicate history.
          unchanged = {
            recommendation: { ...choice, ...action,
              call: `program.${action.method}(${JSON.stringify(action.args)})`,
              parameterValues, defaultDecisions: editor.defaultDecisions,
              validation: { status: 'unchanged', preflight: 'supported', executed: true,
                topLevelActions: 1, changed: false, svgSerialized: false } },
            action, prepared: null,
          };
        }
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
    return unchanged;
  };
  return {
    execute({ type, stateId, nextStateId, baseStateId, snapshot, update, viewUpdate, guideCall, action, resize, setupCalls = [], options, group, page = 0, searchQuery = '', batchSize = Infinity }) {
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
        if (update && viewUpdate) {
          const program = unpackProgramUpdate(base.program, update);
          const view = rememberDisplayedGuides(unpackProgramUpdate(program, viewUpdate), guideCall);
          retain(stateId, program, view);
          return { exists: true };
        }
        const prepared = prepareGuidedAction(base.program, action, base.view, setupCalls);
        retain(stateId, prepared.authoringPreview, prepared.preview);
        return { exists: true };
      }
      const { program, view, rankings, decks } = stateFor(stateId);
      if (type === 'typography' || type === 'guide-edits') {
        const result = type === 'guide-edits' ? prepareGuideEdits(program, view, options.calls) : prepareTypography(program, view, options);
        if (nextStateId !== undefined) retain(nextStateId, result.program, result.view);
        return { update: packProgramUpdate(program, result.program), viewUpdate: packProgramUpdate(result.program, result.view),
          guideCall: result.guideCall ?? guideCall, calls: result.calls };
      }
      if (type === 'checkpoint') return { snapshot: serializeProgram(program), viewUpdate: packProgramUpdate(program, view) };
      if (type === 'scene') return createTransitionScene(action ? prepareGuidedAction(program, action, view, setupCalls).preview : view, { format: 'canvas' });
      if (type === 'prepare-resized') {
        const resized = prepareGuidedAction(program, resize, view, resize.setupCalls ?? []);
        try {
          return artifact(prepareGuidedAction(resized.authoringPreview, action, resized.preview, setupCalls));
        } catch (error) {
          if (error.reason === 'no-change') return artifact(resized);
          throw error;
        }
      }
      if (type === 'prepare' || type === 'materialize') {
        const prepared = prepareGuidedAction(program, action, view, setupCalls);
        if (type === 'materialize') {
          if (nextStateId !== undefined) {
            const update = packProgramUpdate(program, prepared.authoringPreview);
            const viewUpdate = packProgramUpdate(prepared.authoringPreview, prepared.preview);
            retain(nextStateId, prepared.authoringPreview, prepared.preview);
            return { update, viewUpdate, guideCall: prepared.guideCall };
          }
          return { snapshot: serializeProgram(prepared.authoringPreview), guideCall: prepared.guideCall };
        }
        return artifact(prepared);
      }
      if (type === 'recommend') {
        if (!['encoding', 'transform', 'style'].includes(group)) throw new TypeError('Unknown recommendation group.');
        if (!Number.isInteger(page) || page < 0) throw new TypeError('page must be a nonnegative integer.');
        const editing = resolveEditingContext(view, options);
        const localView = editing.program, localOptions = editing.options;
        const localProgram = chartAtPath(program, editing.selected?.childPath ?? []);
        const query = normalizeSearchQuery(searchQuery), rankingKey = signature([options, group]);
        const key = signature([options, group, query]);
        let deck = decks.get(key);
        if (!deck) {
          let original = rankings.get(rankingKey);
          if (!original) {
            // Import hints describe source columns. Aggregation and projection can
            // remove columns or replace them with native derived fields.
            const target = localOptions?.target
              ? localView.semanticSpec.layers.find(layer => layer.id === localOptions.target)
              : localView.semanticSpec.layers.length === 1 ? localView.semanticSpec.layers[0] : undefined;
            const data = target?.data ?? localOptions?.data;
            const names = new Set(getDatasetSchema(localView, { ...(data ? { data } : {}) }).schema.fields.map(field => field.name));
            const fieldTypes = Object.fromEntries(Object.entries(options?.fieldTypes ?? {}).filter(([name]) => names.has(name)));
            const ranked = engine.rank(localView, { ...localOptions, fieldTypes, sourceFieldTypes: options?.fieldTypes, group, hierarchy: false });
            original = rankings.set(rankingKey, { ...ranked, recommendations: [...compositionTitleRecommendations(ranked.recommendations, program, model, editing.scope?.all), ...compositionRecommendations(program, model, group)]
              .sort((a, b) => Number(a.previouslyApplied) - Number(b.previouslyApplied) || (a.previouslyApplied ? a.appliedOrder - b.appliedOrder : 0) || b.score - a.score || a.id.localeCompare(b.id, 'en')) });
          }
          const matches = filterActionRecommendations(original.recommendations, query);
          const ranked = { ...original, recommendations: matches, diagnostics: { ...original.diagnostics,
            search: { query, totalCandidates: original.recommendations.length, matchingCandidates: matches.length } } };
          const available = new Set(getDatasetSchema(localView, { data: ranked.state.data }).schema.fields.map(f => f.name));
          const fieldTypes = Object.fromEntries(Object.entries(options?.fieldTypes ?? {}).filter(([name]) => available.has(name)));
          deck = decks.set(key, { ranked, profile: profileDataset(localView, ranked.state.data, fieldTypes), cursor: 0,
            // Searching is an explicit request for the fine-grained action;
            // it bypasses promotion and still uses the same cached raw ranking.
            hierarchy: options?.hierarchy && !query ? createHierarchyProjection(matches, localProgram) : null,
            emitted: new Set(), unavailable: new Set(),
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
          // Applied actions already follow unused ones in the ranked queue.
          // Pack that single queue into pages without breaking at the boundary.
          deck.cursor++;
          for (const candidate of deck.hierarchy?.choices(source) ?? [source]) {
            // A valid displayed ancestor covers later descendants too. An
            // invalid ancestor does not: try the next ancestor or the leaf.
            if (deck.unavailable.has(candidate.id)) continue;
            if (deck.emitted.has(candidate.id)) break;
            const localRecommendation = deck.hierarchy?.promote(candidate, source, rank) ?? candidate;
            const recommendation = !localRecommendation.executionRoot && editing.scope && (editing.scope.all || editing.scope.targets[0].childPath.length)
              ? { ...localRecommendation, editingScope: editing.scope } : localRecommendation;
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
        const partialPageSize = deck.recommendations.length - deck.pageStart;
        const pageCount = deck.pages.length + Math.ceil((partialPageSize + remaining.length) / 5);
        const pending = deck.pages.length <= page && !complete;
        const range = deck.pages[page] ?? { start: deck.pageStart, end: deck.recommendations.length };
        return { result: { ...ranked, recommendations: deck.recommendations.slice(0, range.end),
          diagnostics: { ...ranked.diagnostics, hierarchy: Boolean(deck.hierarchy), eligibleGroups: projected.length, validatedCalls: [...diagnostics.validatedCalls],
            rejected: [...diagnostics.rejected], scannedCandidates: deck.cursor } }, profile,
          defaults: deck.defaults.slice(range.start, range.end),
          pagination: { page, pageSize: 5, pageCount, pageRanges: deck.pages.slice(0, page + 1), pending,
            complete: complete || remaining.length === 0, rankedCandidates: projected.length,
            newActionsExhausted: Boolean(options?.deprioritizeAppliedActions && !query && deck.recommendations.length) &&
              deck.recommendations.every(rec => rec.previouslyApplied) } };
      }
      throw new Error(`Unknown calculation request: ${type}`);
    },
  };
}
