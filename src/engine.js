import { regressionContext } from './regression-context.js';
import { positionScaleContext } from './mark-grain.js';
import { describeAction, comparePrograms, inspectProgram } from 'ggaction/inspection';
import { renderToSVG } from 'ggaction/svg';
import { ACTION_METHODS, generateCandidates } from './catalog.js';
import { CHANNELS, extractFeatures } from './semantics.js';
import { profileDataset } from './profile.js';
import { scoreCandidate } from './model.js';
import { INITIAL_PLOT_METHODS } from './plot-catalog.js';
import { corpusActionPolicy } from './action-capabilities.js';
import { createLRU, signature, freezeResult } from './cache.js';
import { createProgramResultCache } from './program-cache.js';
import { prepareGuidedAction } from './prepare.js';
import { optionGroup } from './recommendation-groups.js';
import { variantPreference } from './parameter-defaults.js';
import { createHierarchyProjection } from './action-hierarchy.js';

const validations = new WeakMap();
const recentValidations = createLRU(12, program => validations.delete(program));

const allowed = new Set([...ACTION_METHODS, ...INITIAL_PLOT_METHODS]);
const issued = new WeakMap();
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const callText = ({ method, args }) => `program.${method}(${JSON.stringify(args)})`;

function derivedFieldLabels(program, data) {
  const names = { q1: 'lower quartile', q3: 'upper quartile', median: 'median', count: 'observation count',
    lowerWhisker: 'lower whisker', upperWhisker: 'upper whisker', lowerFence: 'lower fence', upperFence: 'upper fence' };
  return Object.fromEntries((program.semanticSpec.datasets.find(d => d.id === data)?.transform ?? [])
    .filter(transform => transform.type === 'boxSummary').flatMap(transform => Object.entries(transform.as)
      .map(([statistic, field]) => [field, `${transform.field}: ${names[statistic] ?? statistic}`])));
}

export function neighboringParameters(candidate) {
  if (candidate.method === 'editFacetSource' && candidate.args.action) {
    const source = candidate.args.action;
    return neighboringParameters({ ...candidate, method: source.method, args: source.options ?? {} })
      .map(variant => ({ ...candidate, args: { action: { method: source.method, options: variant.args } } }));
  }
  return (candidate.parameters ?? []).flatMap(parameter => {
    const keys = parameter.path.split('.'), key = keys.pop();
    const parent = keys.reduce((node, part) => node?.[part], candidate.args);
    const current = parent?.[key] ?? parameter.value;
    const values = parameter.choices?.map(choice => choice.value) ?? (parameter.type === 'number'
      ? [current + parameter.step, current - parameter.step].filter(v => v >= parameter.min && v <= parameter.max) : []);
    return values.filter(value => value !== current).map(value => {
      const args = structuredClone(candidate.args);
      let node = args;
      for (const part of keys) node = node[part] ??= {};
      node[key] = value;
      return { ...candidate, args };
    });
  });
}

function invokeSingle(program, call) {
  if (!allowed.has(call.method)) throw new TypeError(`Action is not in the tested catalog: ${call.method}`);
  // The sole authoring call. Inspection, comparison and SVG serialization are read-only.
  const next = program[call.method](call.args);
  const oldTrace = program.trace.children;
  const newTrace = next.trace.children;
  if (newTrace.length !== oldTrace.length + 1 || newTrace.at(-1).op !== call.method ||
      oldTrace.some((node, i) => node.id !== newTrace[i].id)) {
    throw new Error('Expected exactly one new top-level ggaction action.');
  }
  return next;
}

export function validateCandidate(program, candidate) {
  recentValidations.set(program, true);
  if (!validations.has(program)) validations.set(program, createProgramResultCache());
  const cache = validations.get(program), key = signature([candidate.method, candidate.args, candidate.inspectionTarget]);
  const cached = cache.get(key);
  if (cached) return cached;
  return cache.set(key, freezeResult(validateUncached(program, candidate)));
}

function validateUncached(program, candidate) {
  try {
    const preflight = describeAction(program, { action: candidate.method,
      options: candidate.args, ...(candidate.inspectionTarget ? { target: candidate.inspectionTarget } : {}) });
    if (preflight.applicability !== 'supported') {
      return { ok: false, reason: 'preflight', findings: preflight.findings };
    }
    const next = invokeSingle(program, candidate);
    const comparison = comparePrograms(program, next);
    if (comparison.equivalence === 'equal') return { ok: false, reason: 'no-change' };
    if (comparison.equivalence !== 'different') return { ok: false, reason: 'comparison-unknown' };
    const inspection = inspectProgram(next);
    if (inspection.findings.some(f => f.severity === 'error') ||
        inspection.checks.some(c => c.status === 'failed') ||
        inspection.views.some(v => v.checks.some(c => c.status === 'failed'))) {
      return { ok: false, reason: 'inspection', findings: inspection.findings };
    }
    // Incomplete positional authoring is valid: a newly created mark, or x-only
    // mark, cannot be serialized yet. Never repair it with hidden extra calls.
    const pending = next.semanticSpec.layers.some(layer =>
      ['point', 'line', 'bar', 'area'].includes(layer.mark?.type) &&
      !['polar', 'parallel'].includes(next.semanticSpec.coordinates.find(c => c.id === layer.coordinate)?.type) &&
      (!layer.encoding?.x || !layer.encoding?.y));
    if (!pending) {
      // Serialization is not a claim about raster pixels or the author's message.
      const svg = renderToSVG(next);
      if (!svg.startsWith('<svg') || /(?:NaN|Infinity)/.test(svg.replace(/<text\b[^>]*>.*?<\/text>/gs, ''))) {
        return { ok: false, reason: 'svg' };
      }
    }
    return { ok: true, next, comparison, inspection,
      validation: { preflight: 'supported', executed: true, topLevelActions: 1,
        changed: true, svgSerialized: !pending,
        renderStatus: pending ? 'pending-position-encoding' : 'svg-serialized',
        pixelVisibilityChecked: false } };
  } catch (error) {
    return { ok: false, reason: 'execution', message: error.message };
  }
}

function resolveContext(program, options) {
  // inspectProgram also verifies the input is a closed, real ggaction ChartProgram.
  inspectProgram(program);
  if (Object.keys(program.children).length && !program.compositionSpec?.facet) {
    throw new Error('Composition inputs are not supported yet. Pass an individual child ChartProgram.');
  }
  let layer;
  if (options.target !== undefined) {
    layer = program.semanticSpec.layers.find(l => l.id === options.target);
    if (!layer) throw new Error(`Unknown mark target: ${options.target}`);
  } else if (program.semanticSpec.layers.length === 1) {
    layer = program.semanticSpec.layers[0];
  } else if (program.semanticSpec.layers.length > 1) {
    throw new Error('Multiple marks: specify { target: "mark-id" }.');
  }
  if (layer && options.data && layer.data !== options.data) {
    throw new Error('The requested dataset does not match the target mark.');
  }
  const data = layer?.data ?? options.data ??
    (program.semanticSpec.datasets.length === 1 ? program.semanticSpec.datasets[0].id : undefined);
  if (!data) throw new Error('Provide one dataset, or specify { data: "dataset-id" }.');
  const profile = profileDataset(program, data, options.fieldTypes);
  if (options.fields !== undefined) {
    if (!Array.isArray(options.fields) || options.fields.some(name =>
      !profile.fields.some(field => field.name === name))) throw new TypeError('fields must list existing field names.');
    const selected = new Set(options.fields);
    profile.fields = profile.fields.filter(field => selected.has(field.name));
  }
  return { layer, profile, positionScaleContext: positionScaleContext(program, layer, profile), regressionContext: regressionContext(program, layer, profile) };
}

const encodingChannel = method => method === 'encodePointRadius' ? 'size'
  : method.startsWith('encode') ? method.slice(6, 7).toLowerCase() + method.slice(7) : undefined;

function establishedEncodingChannels(program, layer) {
  if (!layer) return [];
  const channels = new Set();
  // Fixed appearance calls remove the semantic field mapping and store their
  // value in the mark config. Count explicit authoring, not native defaults.
  for (const { op, args } of program.trace.children) {
    const action = op === 'editFacetSource' ? args.action : { method: op, options: args };
    if (action?.options?.target !== layer.id) continue;
    const channel = encodingChannel(action.method);
    if (channel) channels.add(channel);
    if (action.method === 'removeEncoding') channels.delete(action.options.channel);
  }
  for (const channel of Object.keys(layer.encoding ?? {})) channels.add(channel);
  return [...channels].sort();
}

function appliedActionMethods(program, layer) {
  const methods = new Set();
  for (const { op, args } of program.trace.children) {
    const action = op === 'editFacetSource' ? args.action : { method: op, options: args };
    if (!action) continue;
    const target = action.options?.target;
    if (target && layer && target !== layer.id && program.semanticSpec.layers.some(mark => mark.id === target)) continue;
    methods.add(action.method === 'encodePointRadius' ? 'encodeSize' : action.method);
  }
  return methods;
}

export function createRecommendationEngine(model) {
  // Fail immediately on an unusable model, before running chart work.
  scoreCandidate(model, ['data.tabular'], 'mark.point');
  return Object.freeze({
    rank(program, options = {}) {
      return this.recommend(program, { ...options, validationMode: 'deferred' });
    },
    recommend(program, options = {}) {
      const { limit = 5, category, includeRevisions = false, excludeMappedChannels = [], excludeAppliedEncodings = false } = options;
      const { group, validationMode = 'full', deprioritizeAppliedActions = false, hierarchy = false } = options;
      if (group !== undefined && !['encoding', 'transform', 'style'].includes(group)) throw new TypeError('Unknown recommendation group.');
      if (!['full', 'deferred'].includes(validationMode)) throw new TypeError('Unknown validation mode.');
      const deferred = validationMode === 'deferred';
      if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer.');
      if (typeof includeRevisions !== 'boolean') throw new TypeError('includeRevisions must be boolean.');
      if (typeof excludeAppliedEncodings !== 'boolean') throw new TypeError('excludeAppliedEncodings must be boolean.');
      if (typeof deprioritizeAppliedActions !== 'boolean') throw new TypeError('deprioritizeAppliedActions must be boolean.');
      if (typeof hierarchy !== 'boolean') throw new TypeError('hierarchy must be boolean.');
      if (!Array.isArray(excludeMappedChannels) || excludeMappedChannels.some(channel => !CHANNELS.includes(channel))) {
        throw new TypeError('excludeMappedChannels must list known encoding channels.');
      }
      if (options.datasetType && !['tabular', 'time-series', 'geospatial', 'network', 'hierarchical'].includes(options.datasetType)) {
        throw new TypeError('Unknown datasetType.');
      }
      if (category && !['mark', 'encoding', 'transform', 'guide', 'style'].includes(category)) {
        throw new TypeError(`Unknown category: ${category}`);
      }
      const context = { ...resolveContext(program, options), actionEvidence: model.actionEvidence };
      const establishedChannels = excludeMappedChannels.filter(channel => context.layer?.encoding?.[channel]?.field);
      const appliedChannels = excludeAppliedEncodings ? establishedEncodingChannels(program, context.layer) : [];
      const existingChannels = deprioritizeAppliedActions ? establishedEncodingChannels(program, context.layer) : [];
      const appliedMethods = deprioritizeAppliedActions ? appliedActionMethods(program, context.layer) : new Set();
      const features = extractFeatures(program, { target: context.layer?.id, data: context.profile.id,
        datasetType: options.datasetType ?? context.profile.datasetType });
      const groups = new Map();
      const rejected = [];
      const unchanged = [];
      const candidateCoverage = new Map();
      const coverageFor = method => {
        if (!candidateCoverage.has(method)) candidateCoverage.set(method, { method, generated: 0, eligible: 0, excluded: {} });
        return candidateCoverage.get(method);
      };
      const checks = new Map();
      const validate = candidate => {
        if (!options.authoringProgram) return validateCandidate(program, candidate);
        try {
          const prepared = prepareGuidedAction(options.authoringProgram, { method: candidate.method, args: candidate.args }, program);
          return { ok: true, next: prepared.authoringPreview, prepared, validation: prepared.recommendation.validation };
        } catch (error) { return { ok: false, reason: error.reason ?? 'execution', message: error.message }; }
      };
      for (let candidate of generateCandidates(program, context)) {
        const coverage = coverageFor(candidate.method); coverage.generated++;
        const exclude = reason => { coverage.excluded[reason] = (coverage.excluded[reason] ?? 0) + 1; };
        if (category && candidate.category !== category) { exclude('other-category'); continue; }
        if (group && optionGroup(candidate) !== group) { exclude('other-group'); continue; }
        // Title creation already offers its editing controls. Keep later title
        // edits discoverable through search without filling the normal deck.
        const searchOnly = candidate.method === 'editTitle';
        if (searchOnly && !deferred) { exclude('search-only'); continue; }
        // Established variable choices do not compete with new encodings. The
        // same native X/Y functions can still supply bin/aggregate transforms.
        if (candidate.category === 'encoding' && establishedChannels.some(channel => candidate.feature === `encoding.${channel}`)) { exclude('established-channel'); continue; }
        if (candidate.category === 'encoding' && appliedChannels.includes(encodingChannel(candidate.method))) { exclude('applied-channel'); continue; }
        const previouslyApplied = appliedMethods.has(candidate.method) ||
          (candidate.category === 'encoding' && existingChannels.includes(encodingChannel(candidate.method)));
        if (program.compositionSpec?.facet && !candidate.compositionAction &&
            !['createTitle', 'editTitle'].includes(candidate.method) && !/^editLegend/.test(candidate.method)) {
          candidate = { ...candidate, sourceMethod: candidate.method, sourceTarget: candidate.args.target,
            method: 'editFacetSource', args: { action: { method: candidate.method, options: candidate.args } }, inspectionTarget: undefined };
        }
        const revision = features.includes(candidate.feature);
        // Faithful paper default: recommend primitives t not already in T_V.
        if (revision && !includeRevisions) { exclude('revision-disabled'); continue; }
        const signature = callText(candidate);
        if (!checks.has(signature)) checks.set(signature, deferred
          ? { ok: true, validation: { status: 'pending' } } : validate(candidate));
        let check = checks.get(signature);
        // A matching default is not an unavailable action. Try another value
        // from its actual parameter editor before dropping the whole method.
        if (check.reason === 'no-change') for (const variant of neighboringParameters(candidate)) {
          const key = callText(variant);
          if (!checks.has(key)) checks.set(key, validate(variant));
          if (checks.get(key).ok) { candidate = variant; check = checks.get(key); break; }
        }
        if (!check.ok) {
          exclude(check.reason);
          if (check.reason === 'no-change') { unchanged.push(callText(candidate)); continue; }
          rejected.push({ call: callText(candidate), ...check });
          continue;
        }
        coverage.eligible++;
          const key = JSON.stringify([candidate.method, candidate.sourceMethod ?? '', candidate.groupTarget ?? candidate.args.target ?? candidate.args.id ?? '', candidate.feature]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ candidate, check, revision, previouslyApplied });
      }
      const ranked = [];
      for (const [id, variants] of groups) {
        const method = variants[0].candidate.sourceMethod ?? variants[0].candidate.method;
        const defaultEvidence = model.parameterDefaults?.methods?.[method];
        const preference = ({ candidate: c }) => variantPreference(method,
          c.method === 'editFacetSource' ? c.args.action.options : c.args, defaultEvidence);
        variants.sort((a, b) => preference(b) - preference(a));
        const { candidate, check, revision, previouslyApplied } = variants[0];
        // Optional revision extension: remove the replaced primitive before applying
        // the unchanged paper formula. It is OFF by default and clearly labeled.
        const anchors = revision ? features.filter(f => f !== candidate.feature) : features;
        const explanation = scoreCandidate(model, anchors, candidate.feature);
        const recommendation = freeze({
          id, method: candidate.method, args: structuredClone(candidate.args),
          call: callText(candidate), label: candidate.label, category: candidate.category,
          feature: candidate.feature, kind: revision ? 'revision' : 'addition',
          previouslyApplied,
          searchOnly: candidate.method === 'editTitle',
          defaultEvidence,
          // An eager issued token already passed native validation. Its editor
          // must preserve those arguments; the paged worker learns additional
          // control values before validating its final call.
          skipParameterDefaults: !deferred,
          score: explanation.score, explanation,
          axisFields: candidate.method === 'createAxes' ? {
            x: context.layer?.encoding?.x?.field, y: context.layer?.encoding?.y?.field,
          } : undefined,
          parameters: candidate.parameters ? structuredClone(candidate.parameters) : undefined,
          compositionContext: { facet: Boolean(program.compositionSpec?.facet) },
          notice: candidate.method === 'encodeAngle' && context.layer?.mark?.type === 'point' && !context.layer.encoding?.shape && (program.markConfigs[context.layer.id]?.shape ?? 'circle') === 'circle'
            ? 'Rotation is not visible on circles. Choose a different point shape to see the angle.' : undefined,
          unavailableFields: candidate.unavailableFields,
          fieldLabels: derivedFieldLabels(program, context.profile.id),
          scaleIds: program.semanticSpec.scales.map(scale => scale.id),
          positionScaleContext: context.positionScaleContext,
          regressionContext: context.regressionContext,
          parameterMode: candidate.parameterMode,
          binRecipe: candidate.binRecipe ? structuredClone(candidate.binRecipe) : undefined,
          sourceMethod: candidate.sourceMethod,
          facetFields: candidate.facetFields,
          guideContext: candidate.guideContext ? structuredClone(candidate.guideContext) : undefined,
          nextContext: candidate.groupTarget ? { data: candidate.args.id }
            : context.layer ? { target: context.layer.id } : { data: context.profile.id },
          validation: check.validation,
          alternatives: variants.map(({ candidate: c, check: v }) => ({
            method: c.method, args: structuredClone(c.args), call: callText(c),
            label: c.label, validation: v.validation,
            parameters: c.parameters ? structuredClone(c.parameters) : undefined,
            guideContext: c.guideContext ? structuredClone(c.guideContext) : undefined,
            nextContext: c.groupTarget ? { data: c.args.id }
              : context.layer ? { target: context.layer.id } : { data: context.profile.id },
          })),
        });
        // Ranked candidates are proposals, never executable issued tokens.
        if (!deferred) issued.set(recommendation, { program, variants });
        ranked.push(recommendation);
      }
      // Keep used actions discoverable after unused actions without altering the
      // paper score. This is presentation order, shared by eager and paged UI.
      ranked.sort((a, b) => Number(a.searchOnly) - Number(b.searchOnly) ||
        Number(a.previouslyApplied) - Number(b.previouslyApplied) ||
        b.score - a.score || a.id.localeCompare(b.id, 'en'));
      const displayed = hierarchy ? createHierarchyProjection(ranked, options.authoringProgram ?? program).project() : ranked;
      if (hierarchy && !deferred) for (const recommendation of displayed) {
        const original = ranked.find(value => value.id === recommendation.id);
        issued.set(recommendation, issued.get(original));
      }
      return freeze({
        state: { target: context.layer?.id ?? null, data: context.profile.id,
          datasetType: options.datasetType ?? context.profile.datasetType,
          rowCount: context.profile.rowCount, fields: structuredClone(context.profile.fields), features },
        model: { method: model.method, chartCount: model.chartCount, provenance: structuredClone(model.provenance) },
        recommendations: displayed.slice(0, limit),
        diagnostics: { eligibleGroups: displayed.length, rawRankedGroups: ranked.length, hierarchy, rejected, unchanged, establishedChannels, appliedChannels, validationMode,
          candidateCoverage: [...candidateCoverage.values()].sort((a, b) => a.method.localeCompare(b.method)),
          corpusActions: model.actionEvidence?.methods.map(record => ({ method: record.method, charts: record.charts,
            ...corpusActionPolicy(record.method), candidates: ranked.filter(r => r.method === record.method ||
              r.alternatives.some(alternative => alternative.method === record.method)).length })),
          excludedFields: context.profile.fields.filter(field => !field.usable).map(field => ({
            name: field.name, type: field.type, missing: field.missing,
          })),
          emptyReason: ranked.length ? null : context.profile.fields.some(field => field.usable)
            ? 'no-applicable-catalog-action' : 'no-supported-fields',
        },
      });
    },
  });
}

export function applyRecommendation(program, recommendation, { alternative = 0 } = {}) {
  const record = issued.get(recommendation);
  if (!record || record.program !== program) {
    throw new Error('Recommendation belongs to a different chart state. Recompute recommendations.');
  }
  if (!Number.isInteger(alternative) || !record.variants[alternative]) {
    throw new RangeError('Unknown recommendation alternative.');
  }
  // Apply the same validated method/args, with no hidden selection or repair actions.
  return invokeSingle(program, record.variants[alternative].candidate);
}

// The gallery and card parameter editor use the same preflight/execution checks.
// No new ggaction actions are defined or registered here.
export function prepareAction(program, { method, args }) {
  if (!allowed.has(method)) throw new TypeError(`Not a supported public ggaction method: ${method}`);
  const candidate = { method, args: structuredClone(args),
    ...(args.target && program.semanticSpec.layers.some(l => l.id === args.target) && !/^edit(?:[XY]|Theta|Radial|Parallel)Axis/.test(method)
      ? { inspectionTarget: { kind: 'mark', id: args.target } } : {}) };
  const check = validateCandidate(program, candidate);
  if (!check.ok) throw Object.assign(new Error(check.message ?? check.findings?.[0]?.message ?? `Cannot apply action: ${check.reason}`), { reason: check.reason });
  const recommendation = freeze({ method, args: structuredClone(args), call: callText(candidate), validation: check.validation });
  issued.set(recommendation, { program, variants: [{ candidate, check }] });
  return { recommendation, preview: check.next };
}

export function configureRecommendation(program, original, args) {
  const record = issued.get(original);
  if (!record || record.program !== program) throw new Error('Recompute recommendations for the current chart state.');
  return prepareAction(program, { method: original.method, args });
}
