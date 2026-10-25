import { projectFields } from './field-selection.js';
import { fieldSetPlotDefinitions, generateFieldSetPlots } from './field-set-plots.js';
import { describeDataset, FEATURE_BLOCKS, FEATURE_NAMES, PROFILE_VERSION, quantile, columnDistance } from './dataset-profile.js';
import { getPlotDefinitions, defaultValues } from './plot-catalog.js';
import { projectSelection, selectedPlotDefinitions } from './selected-plots.js';
import { applyParameterDefaults } from './control-defaults.js';

export function fitNormalization(groups) {
  return FEATURE_NAMES.map((_, index) => {
    const values = groups.map(group => group.profile.vector[index]);
    let lo = quantile(values, 0.05), hi = quantile(values, 0.95);
    if (lo === hi) { lo = Math.min(...values); hi = Math.max(...values); }
    return [lo, hi];
  });
}

export function normalizeVector(vector, ranges) {
  return vector.map((value, index) => {
    const [lo, hi] = ranges[index];
    return hi > lo ? Math.max(0, Math.min(1, (value - lo) / (hi - lo))) : 0;
  });
}

const blocks = Object.values(FEATURE_BLOCKS).map(names => names.map(name => FEATURE_NAMES.indexOf(name)));
const normalizedGroups = new WeakMap();
export function datasetDistance(a, b) {
  // Equal weight per statistical block, rather than per feature count.
  return blocks.reduce((total, indexes) => total + indexes.reduce((sum, i) => sum + Math.abs(a[i] - b[i]), 0) / indexes.length, 0) / blocks.length;
}

export function retrieveInitialEvidence(model, profile, { k = model.neighborCount, excludeFamilies = [] } = {}) {
  if (model.schemaVersion !== 1 || model.profileVersion !== PROFILE_VERSION ||
    JSON.stringify(model.featureNames) !== JSON.stringify(FEATURE_NAMES)) throw new Error('Rebuild the initial chart index for this feature schema.');
  if (!Number.isInteger(k) || k < 1) throw new TypeError('k must be a positive integer.');
  const excluded = new Set(excludeFamilies), query = normalizeVector(profile.vector, model.normalization);
  if (!normalizedGroups.has(model)) normalizedGroups.set(model, model.groups.map(group => normalizeVector(group.profile.vector, model.normalization)));
  const vectors = normalizedGroups.get(model);
  const families = new Map();
  for (const [index, group] of model.groups.entries()) {
    if (excluded.has(group.family)) continue;
    const distance = datasetDistance(query, vectors[index]);
    const previous = families.get(group.family);
    // Source-related variants cannot occupy multiple neighbor positions.
    if (!previous || distance < previous.distance || distance === previous.distance && group.id < previous.group.id) {
      families.set(group.family, { group, distance });
    }
  }
  const nearest = [...families.values()].sort((a, b) => a.distance - b.distance || a.group.id.localeCompare(b.group.id)).slice(0, k);
  const bandwidth = Math.max(0.02, quantile(nearest.map(n => n.distance), 0.5));
  const exact = nearest.filter(n => n.distance <= 1e-12);
  const inverse = model.weightKernel === 'inverse-square';
  const selected = inverse && exact.length ? exact : nearest;
  const scale = selected[0]?.distance ?? 1;
  const neighbors = selected.map(n => ({ ...n, weight: inverse
    ? exact.length ? 1 : (scale / n.distance) ** 2 : Math.exp(-n.distance / bandwidth) }));
  const weightSum = neighbors.reduce((sum, n) => sum + n.weight, 0);
  const scores = {};
  for (const { group, weight } of neighbors) for (const [method, fraction] of Object.entries(group.distribution)) {
    scores[method] = (scores[method] ?? 0) + weight * fraction / Math.max(Number.EPSILON, weightSum);
  }
  const methods = Object.keys(scores).sort((a, b) => scores[b] - scores[a] || a.localeCompare(b));
  return { scores, methods, neighbors, bandwidth, weightSum,
    effectiveNeighbors: weightSum ** 2 / Math.max(Number.EPSILON, neighbors.reduce((sum, n) => sum + n.weight ** 2, 0)) };
}

function sourceRole(view, key) {
  const aliases = { category: ['category', 'x'], value: ['value', 'y'], field: ['field', 'x', 'y'],
    group: ['group', 'color'], x: ['x', 'category'], y: ['y', 'value'] };
  for (const alias of aliases[key] ?? [key]) if (view.roles[alias]) return view.roles[alias];
}

export function bindInitialDefaults(definition, query, retrieval) {
  const values = defaultValues(definition), fields = new Map(query.fields.map(field => [field.name, field]));
  const exemplars = [];
  for (const { group, weight } of retrieval.neighbors) for (const chart of group.charts) {
    const views = chart.views.filter(view => view.method === definition.method);
    for (const view of views) exemplars.push({ view, fields: group.profile.fields,
      weight: weight / group.charts.length / chart.methods.length / views.length, chart: chart.id, dataset: group.id });
  }
  const positional = new Set(['x', 'y', 'theta', 'radius', 'category', 'value', 'start', 'end']);
  const used = new Set(), contributions = [];
  for (const control of definition.controls) {
    const choices = control.choices?.filter(choice => fields.has(choice.value));
    if (!choices?.length) continue;
    const ranked = choices.map(choice => {
      const candidate = fields.get(choice.value);
      let score = 0, total = 0;
      for (const exemplar of exemplars) {
        const role = sourceRole(exemplar.view, control.key);
        const names = Array.isArray(role) ? role : [role];
        for (const name of names) {
          const raw = exemplar.fields.find(field => field.name === name);
          if (!raw) continue;
          const expectedType = sourceRole({ roles: exemplar.view.roleTypes ?? {} }, control.key);
          const source = expectedType ? { ...raw, type: expectedType,
            numericString: expectedType === 'quantitative' && raw.numericString } : raw;
          score += exemplar.weight * Math.exp(-columnDistance(candidate, source) * 8);
          total += exemplar.weight;
        }
      }
      return { value: choice.value, score: total ? score / total : 0, total };
    }).sort((a, b) => b.score - a.score || String(a.value).localeCompare(String(b.value)));
    const eligible = positional.has(control.key) ? ranked.filter(choice => !used.has(choice.value)) : ranked;
    const best = eligible.find(choice => choice.total > 0);
    if (best) {
      values[control.key] = control.type === 'multiselect' ? ranked.filter(choice => choice.total > 0)
        .slice(0, Math.max(control.minimum ?? 2, Math.min(3, ranked.length))).map(choice => choice.value) : best.value;
      if (positional.has(control.key)) used.add(best.value);
      contributions.push({ parameter: control.key, value: values[control.key], similarity: best.score });
    }
  }
  return { values, contributions, exemplarChartIds: [...new Set(exemplars.map(example => example.chart))] };
}

// Role similarities transfer from the retrieved chart's actual field roles.
// Missing corpus roles carry no fabricated evidence; semantic tie-breaks remain
// separately identifiable in the field-set candidate builder.
function roleMatcher(query, retrieval) {
  const fields = new Map(query.fields.map(field => [field.name, field])), cache = new Map();
  return (method, role, name) => {
    const key = JSON.stringify([method, role, name]); if (cache.has(key)) return cache.get(key);
    let sum = 0, mass = 0;
    for (const { group, weight } of retrieval.neighbors) for (const chart of group.charts) {
      const views = chart.views.filter(view => view.method === method);
      for (const view of views) {
        const aliases = role === 'x' ? ['x', 'category', 'field', 'theta'] : role === 'y' ? ['y', 'value', 'radius'] : ['color', 'group'];
        const key = aliases.find(key => view.sourceRoles?.[key]?.length || view.roles[key]);
        const sourceNames = view.sourceRoles?.[key]?.length ? view.sourceRoles[key] : [view.roles[key]].flat();
        const target = fields.get(name);
        for (const sourceName of sourceNames) {
          const raw = group.profile.fields.find(field => field.name === sourceName);
          if (!raw || !target) continue;
          const type = view.roleTypes?.[key];
          const source = type ? { ...raw, type } : raw;
          const w = weight / group.charts.length / views.length / sourceNames.length;
          sum += w * Math.exp(-columnDistance(target, source) * 8); mass += w;
        }
      }
    }
    const score = mass ? sum / mass : 0; cache.set(key, score); return score;
  };
}

export function createInitialChartRecommender(model) {
  if (!model?.groups?.length) throw new Error('The initial chart corpus index is empty.');
  const fieldModel = model.viewGroups?.length ? { ...model, groups: model.viewGroups, normalization: model.viewNormalization } : model;
  const defaultsFor = definition => {
    const controls = structuredClone(definition.controls);
    applyParameterDefaults(controls, values => definition.build({ ...defaultValues(definition), ...values }),
      { method: definition.method, defaultEvidence: model.parameterDefaults?.methods?.[definition.method] });
    const values = Object.fromEntries(controls.map(control => [control.key, control.value]));
    return { ...values, ...definition.semanticDefaults };
  };
  const queryFor = (rows, authoringProfile, options) => {
      const availableProfile = authoringProfile, availableRows = rows;
      const free = Array.isArray(options.selection?.fields);
      const selected = free ? projectFields(rows, authoringProfile, options.selection.fields)
        : options.selection ? projectSelection(rows, authoringProfile, options.selection) : null;
      if (selected) { rows = selected.rows; authoringProfile = selected.profile; }
      const profile = describeDataset(rows, Object.fromEntries(authoringProfile.fields.map(f => [f.name, { type: f.type, ...(f.order ? { order: f.order } : {}) }])));
      const retrieval = retrieveInitialEvidence(free ? fieldModel : model, profile, options);
      return { availableProfile, availableRows, rows, authoringProfile, free, selected, profile, retrieval };
  };
  const rank = ({ availableProfile, availableRows, rows, authoringProfile, free, selected, profile, retrieval }, options) => {
      const chartEligibility = options.fieldEligibility ?? [];
      const definitions = free ? (options.fieldDefinitions ?? (profile.fields.length ? fieldSetPlotDefinitions(authoringProfile, rows, { roleScore: roleMatcher(profile, retrieval), parameterDefaults: defaultsFor, onEligibility: item => chartEligibility.push(item) }) : [])) : selected ? selectedPlotDefinitions(authoringProfile, options.selection, availableRows, chartEligibility, { availableProfile }) : getPlotDefinitions(authoringProfile);
      const recommendations = definitions.map(definition => {
        const bound = free ? { values: definition.values, selection: { fields: selected.fields }, exemplarChartIds: retrieval.neighbors.flatMap(n => n.group.charts.filter(c => c.methods.includes(definition.method)).map(c => c.id)) } : selected ? { values: defaultValues(definition), selection: { ...options.selection }, exemplarChartIds: [] }
          : bindInitialDefaults(definition, profile, retrieval);
        const method = definition.method;
        const controls = definition.controls.map(control => ({ ...structuredClone(control), value: structuredClone(bound.values[control.key]) }));
        let defaultDecisions = free ? [] : applyParameterDefaults(controls, values => definition.build({ ...bound.values, ...values }),
          { method, defaultEvidence: model.parameterDefaults?.methods?.[method] });
        for (const [key, value] of Object.entries(definition.semanticDefaults ?? {})) {
          const control = controls.find(control => control.key === key);
          if (control) { control.value = value; defaultDecisions = defaultDecisions.filter(decision => decision.control !== key);
            defaultDecisions.push({ control: key, value, source: 'data-semantics', reason: 'Each observation contributes one event.' }); }
        }
        for (const control of controls) bound.values[control.key] = structuredClone(control.value);
        const evidence = retrieval.neighbors.filter(n => n.group.distribution[method]).map(n => ({
          dataset: n.group.id, family: n.group.family, distance: n.distance, weight: n.weight,
          chartFraction: n.group.distribution[method],
          contribution: n.weight * n.group.distribution[method] / retrieval.weightSum,
          chartIds: n.group.charts.filter(chart => chart.methods.includes(method)).map(chart => chart.id),
        }));
        return { ...definition, values: bound.values, fallbackValues: defaultValues(definition),
          controls, defaultDecisions,
          score: retrieval.scores[method] ?? 0, scoreKind: 'similar-dataset-chart-frequency',
          evidence, parameterEvidence: bound,
          evidenceStatus: evidence.length ? 'observed-in-neighbors' : 'no-neighbor-evidence' };
      }).sort((a, b) => Number(Boolean(a.requirement)) - Number(Boolean(b.requirement)) ||
        (free ? (b.usedFields?.length ?? 0) / selected.fields.length - (a.usedFields?.length ?? 0) / selected.fields.length : 0) ||
        b.score - a.score || (free ? (b.mappingScore ?? 0) - (a.mappingScore ?? 0) : 0) || a.method.localeCompare(b.method));
      return { recommendations, query: profile, selectedFields: selected?.fields, diagnostics: { chartEligibility, ...(free ? { selectionMode: 'fields', corpusProfiles: fieldModel === model ? 'datasets' : 'chart-field-subsets' } : {}) },
        model: { method: model.method, provenance: model.provenance },
        neighbors: retrieval.neighbors.map(n => ({ dataset: n.group.id, family: n.group.family,
          distance: n.distance, weight: n.weight, chartIds: n.group.charts.map(c => c.id) })),
        effectiveNeighbors: retrieval.effectiveNeighbors,
        explanation: 'Similarity-weighted chart fractions; each distinct source family supplies at most one dataset neighbor.' };
  };
  const recommend = (rows, authoringProfile, options = {}) => rank(queryFor(rows, authoringProfile, options), options);
  return Object.freeze({ recommend,
    async recommendAsync(rows, authoringProfile, options = {}) {
      if (!Array.isArray(options.selection?.fields)) return recommend(rows, authoringProfile, options);
      // Reuse this exact profile and neighbor search after generating the plots.
      // Large uploaded tables used to be projected and statistically profiled twice.
      const query = queryFor(rows, authoringProfile, options);
      const { selected, profile, retrieval } = query;
      const definitions = [], fieldEligibility = [], cancelled = options.cancelled ?? (() => false);
      const yieldFrame = options.yieldFrame ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
      let start = performance.now();
      if (selected.fields.length) for (const definition of generateFieldSetPlots(selected.profile, selected.rows,
        { roleScore: roleMatcher(profile, retrieval), parameterDefaults: defaultsFor, onEligibility: item => fieldEligibility.push(item) })) {
        if (cancelled()) return { cancelled: true };
        definitions.push(definition);
        if (performance.now() - start >= 8) { await yieldFrame(); start = performance.now(); }
      }
      if (cancelled()) return { cancelled: true };
      return rank(query, { ...options, fieldDefinitions: definitions, fieldEligibility });
    },
  });
}
