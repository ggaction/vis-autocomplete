import { selectedPlotDefinitions } from './selected-plots.js';
import { getPlotDefinitions, defaultValues, INITIAL_PLOT_METHODS, withRadarDataControls } from './plot-catalog.js';
import { withInitialScales } from './initial-scales.js';

const categorical = field => ['nominal', 'ordinal'].includes(field?.type);
const quantitative = field => field?.type === 'quantitative';
const univariate = new Set(['createHistogram', 'createDensityPlot', 'createECDFPlot', 'createRugPlot']);
const radial = new Set(['createPiePlot', 'createRosePlot', 'createRadialBarPlot']);
const multivariate = new Set(['createParallelCoordinates', 'createRadarPlot', 'createDumbbellPlot']);
const distributions = new Set(['createBoxPlot', 'createViolinPlot', 'createGradientPlot', 'createIntervalPlot',
  'createStripPlot', 'createBeeswarmPlot', 'createRaincloudPlot', 'createDotPlot', 'createLollipopPlot']);
const paths = new Set(['createLinePlot', 'createAreaPlot', 'createHorizonPlot']);
const roleKeys = new Set(['field', 'x', 'y', 'color', 'theta', 'radius', 'category', 'value', 'start', 'end',
  'text', 'groupBy', 'dimensions', 'fields', 'weight', 'lower', 'upper', 'center']);

// Follow actual public arguments, including derived-data inputs. A partial
// suggestion must not silently discard rows because of unused selected fields.
export function usedPlotFields(args, setup, names) {
  const selected = new Set(names), used = new Set();
  const visit = (node, key) => {
    if (typeof node === 'string') { if (roleKeys.has(key) && selected.has(node)) used.add(node); }
    else if (Array.isArray(node)) node.forEach(child => visit(child, key));
    else if (node && typeof node === 'object') for (const [key, child] of Object.entries(node)) visit(child, key);
  };
  visit(args); setup.forEach(call => visit(call.args));
  return names.filter(name => used.has(name));
}

function mappingPreference(method, binding, fields) {
  const x = fields.get(binding.x), y = fields.get(binding.y), color = fields.get(binding.color);
  let value = 0;
  if (paths.has(method)) value += x?.type === 'temporal' ? 1 : quantitative(x) ? .45 : -.3;
  if (method === 'createScatterPlot') value += quantitative(x) && quantitative(y) ? .6 : 0;
  if (method === 'createBarPlot' || distributions.has(method) || radial.has(method)) value += categorical(x) ? .55 : 0;
  if (method === 'createHeatmap') value += categorical(x) && categorical(y) && quantitative(color) ? .8 : 0;
  if (color) value += categorical(color) ? (color.distinct <= 12 ? .4 : -.35) : -.1;
  // High-cardinality identifiers are poor grouping/color defaults. They remain
  // available explicitly; type compatibility alone does not imply readability.
  if (categorical(x) && x.distinct > 30) value -= .4;
  return value;
}

function positionCandidates(method, fields) {
  const q = fields.filter(quantitative), c = fields.filter(categorical), ordered = fields.filter(f => quantitative(f) || f.type === 'temporal');
  if (univariate.has(method)) return { x: q, y: [], optionalY: true };
  if (radial.has(method)) return { x: c, y: q, optionalY: true };
  if (distributions.has(method)) return { x: [...c, ...q], y: [...q, ...c] };
  if (paths.has(method)) return { x: method === 'createHorizonPlot' ? ordered : fields, y: q };
  if (['createRegressionPlot', 'createPolarScatterPlot', 'createPolarLinePlot'].includes(method)) return { x: q, y: q };
  return { x: fields, y: fields, optionalY: method === 'createBarPlot' };
}

const bindingValues = selection => Object.fromEntries(Object.entries(selection).map(([key, value]) => [`mapping_${key}`, value]));
const selectedBinding = values => Object.fromEntries(['x', 'y', 'color'].map(key => [key, values[`mapping_${key}`] ?? '']));
const replaceData = (value, source, data) => {
  if (Array.isArray(value)) return value.map(item => replaceData(item, source, data));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    ['data', 'source'].includes(key) && child === source ? data : replaceData(child, source, data)]));
};

// All templates use the existing native plot recipes. Candidate search is
// bounded and metadata-only; no chart is executed or rendered to rank mappings.
export function* generateFieldSetPlots(profile, rows, { roleScore = () => 0, parameterDefaults = definition => defaultValues(definition), onEligibility = () => {} } = {}) {
  const names = profile.fields.map(field => field.name), fields = new Map(profile.fields.map(field => [field.name, field]));
  const generic = getPlotDefinitions(profile), recipeCache = new Map(), dataCache = new Map();
  const recipe = (method, binding) => {
    const key = JSON.stringify([method, binding]);
    if (!recipeCache.has(key)) {
      try { recipeCache.set(key, selectedPlotDefinitions(profile, binding, rows, [], { availableProfile: profile, method, dataCache })); }
      catch { recipeCache.set(key, []); }
      if (recipeCache.size > 64) recipeCache.delete(recipeCache.keys().next().value);
    }
    return recipeCache.get(key).find(definition => definition.method === method);
  };
  const wrap = (definition, usedNames) => {
    const values = parameterDefaults(definition);
    const usage = input => usedPlotFields(definition.build(input), definition.setup?.(input) ?? [], names);
    const setup = input => {
      const used = usage(input), filters = []; let data = profile.id;
      for (const field of used) if (rows.some(row => row[field] === null || row[field] === undefined)) {
        const id = `${profile.id}-selected-${filters.length + 1}`;
        filters.push({ method: 'filterData', args: { id, source: data, field, noneOf: [null], nulls: 'exclude' } }); data = id;
      }
      return { data, calls: [...filters, ...replaceData(definition.setup?.(input) ?? [], profile.id, data)] };
    };
    return { ...definition, values, selectedFields: names, usedFields: usedNames ?? usage(values), usage,
      build: input => replaceData(definition.build(input), profile.id, setup(input).data),
      setup: input => setup(input).calls };
  };
  for (const method of INITIAL_PLOT_METHODS) {
    if (multivariate.has(method)) {
      let definition = generic.find(d => d.method === method);
      if (definition.requirement) { onEligibility({ method, eligible: false, reason: definition.requirement }); continue; }
      const numeric = profile.fields.filter(quantitative).map(f => f.name), categories = profile.fields.filter(categorical);
      const color = categories.filter(f => f.distinct <= 20).sort((a, b) => a.distinct - b.distinct)[0]?.name ?? '';
      definition = { ...definition, controls: definition.controls.map(control => ({ ...control,
        ...(control.key === 'dimensions' ? { value: numeric, ordered: true } : {}),
        ...(control.key === 'color' ? { value: color } : {}) })) };
      if (method === 'createDumbbellPlot') definition.controls = definition.controls.map(c => ['start', 'end'].includes(c.key)
        ? { ...c, distinctFrom: c.key === 'start' ? 'end' : 'start' } : c);
      const bound = withInitialScales(withRadarDataControls(definition, rows), profile, rows);
      onEligibility({ method, eligible: true });
      yield { ...wrap(bound), fieldSelection: true, mappingScore: 0 };
      continue;
    }
    const positions = positionCandidates(method, profile.fields);
    const rankFields = (items, role) => items.map((field, order) => ({ field, order, score: roleScore(method, role, field.name) }))
      .sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 5).map(item => item.field.name);
    const xs = rankFields(positions.x, 'x'), ys = rankFields(positions.y, 'y');
    const colors = radial.has(method) || ['createHorizonPlot', 'createRugPlot'].includes(method) ? [] : rankFields(profile.fields, 'color');
    const candidates = [];
    for (const x of xs) for (const y of [...ys, ...(positions.optionalY ? [''] : [])]) {
      if (x === y) continue;
      for (const color of ['', ...colors]) {
        // Enumerate distinct fields first, but allow an intentional redundant
        // category color (e.g. colored boxes) inside the card editor.
        if (color && (color === x || color === y)) continue;
        if (distributions.has(method) && !(categorical(fields.get(x)) && quantitative(fields.get(y)) || quantitative(fields.get(x)) && categorical(fields.get(y)))) continue;
        if (method === 'createBarPlot' && y && !quantitative(fields.get(x)) && !quantitative(fields.get(y))) continue;
        const binding = { x, y, color };
        const coverage = new Set([x, y, color].filter(Boolean)).size / names.length;
        const score = coverage * 2 + mappingPreference(method, binding, fields) +
          ['x', 'y', 'color'].reduce((sum, role) => sum + (binding[role] ? roleScore(method, role, binding[role]) : 0), 0);
        candidates.push({ binding, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const compatible = [];
    // Up to 36 typed assignments per method bound work for wide tables.
    // Editing uses all selected fields, not just this initial search beam.
    const search = [...new Set([...candidates.slice(0, 24), ...candidates.filter(c => !c.binding.color).slice(0, 12)])];
    for (const candidate of search) {
      const definition = recipe(method, candidate.binding);
      if (!definition) continue;
      const used = usedPlotFields(definition.build(defaultValues(definition)), definition.setup?.(defaultValues(definition)) ?? [], names);
      compatible.push({ ...candidate, definition, used, score: candidate.score + used.length / names.length });
    }
    compatible.sort((a, b) => Number(Boolean(a.definition.requirement)) - Number(Boolean(b.definition.requirement)) || b.score - a.score);
    const best = compatible[0];
    if (!best) { onEligibility({ method, eligible: false, reason: 'No supported arrangement of the selected variables.', tried: search.length }); continue; }
    onEligibility({ method, eligible: true, tried: search.length });
    const defaults = bindingValues(best.binding);
    const resolveDefinition = input => {
      const binding = selectedBinding({ ...defaults, ...input });
      const found = recipe(method, binding);
      if (!found) throw new Error('This chart cannot use that variable arrangement.');
      const mapping = [];
      const slots = method === 'createRugPlot' ? ['x'] : univariate.has(method) ? ['x', 'color'] : radial.has(method) || method === 'createHorizonPlot' ? ['x', 'y'] : ['x', 'y', 'color'];
      for (const role of slots) {
        const choices = [...(role === 'color' || role === 'y' && positions.optionalY ? [{ name: '', label: role === 'y' ? 'Count' : 'None' }] : []), ...profile.fields]
          .map(field => {
            const next = { ...binding, [role]: field.name };
            // Selecting the other axis swaps the pair atomically.
            if (role !== 'color' && field.name && field.name === binding[role === 'x' ? 'y' : 'x']) next[role === 'x' ? 'y' : 'x'] = binding[role];
            const typed = role === 'color' || !field.name || positions[role].some(f => f.name === field.name);
            const disabled = !typed || !next.x || next.x === next.y || !recipe(method, next);
            return { value: field.name, label: field.label ?? field.name, disabled,
              ...(disabled ? { reason: 'This arrangement is not supported by this chart.' } : {}) };
          });
        const label = role === 'x' && univariate.has(method) ? 'Variable' : role === 'color' ? 'Color / group'
          : role === 'x' && radial.has(method) ? 'Category' : role === 'y' && radial.has(method) ? 'Value'
            : method.startsWith('createPolar') ? role === 'x' ? 'Angle' : 'Radius' : role.toUpperCase();
        mapping.push({ key: `mapping_${role}`, label, type: 'select', section: 'mapping', value: binding[role], choices, suppressChoiceHelp: true });
      }
      if (binding.y && !radial.has(method) && recipe(method, { ...binding, x: binding.y, y: binding.x })) mapping.push({
        key: 'mapping_swap', label: 'Swap X / Y', type: 'swap', section: 'mapping' });
      const wrapped = wrap(found);
      return { ...wrapped, controls: [...mapping, ...found.controls], values: { ...wrapped.values, ...bindingValues(binding) } };
    };
    const wrapped = wrap(best.definition);
    const first = { ...wrapped, values: { ...wrapped.values, ...defaults } };
    yield { ...first, fieldSelection: true, resolveDefinition, mappingScore: best.score,
      normalizeMapping(input, changedKey) {
        const values = { ...defaults, ...input };
        if (values.mapping_x === values.mapping_y && values.mapping_x) {
          const replace = changedKey === 'mapping_y' ? 'mapping_x' : 'mapping_y';
          // The caller passes the pinned values so a swap preserves both fields.
          values[replace] = input.__previousMapping?.[changedKey] ?? best.binding[replace === 'mapping_x' ? 'y' : 'x'];
        }
        delete values.__previousMapping;
        return values;
      } };
  }
}

export const fieldSetPlotDefinitions = (...args) => [...generateFieldSetPlots(...args)];

