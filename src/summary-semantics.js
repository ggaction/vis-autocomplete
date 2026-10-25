import { numericBinGuide, binnedSummarySetup } from './plot-aggregation.js';
import { chart } from 'ggaction';

const summaryMethods = new Set(['createBarPlot', 'createLinePlot', 'createAreaPlot', 'createHorizonPlot']);
const categorical = field => ['nominal', 'ordinal', 'temporal'].includes(field?.type);
const select = (key, label, choices, value) => ({ key, label, type: 'select', value, choices });
const nativeValues = values => ({ ...values, ...(values.aggregate === 'weightedMean' ? { aggregate: 'mean' } : {}) });

// Weighting is explicit and uses the existing public createSummaryData action.
// It is available only for selected, valid nonnegative weights; no hidden input
// or dataset-specific recipe changes the statistical question.
export function withSummarySemantics(definition, { profile, rows, x, y, color, binsX }) {
  if (!summaryMethods.has(definition.method)) return definition;
  const horizontal = definition.method === 'createBarPlot' && categorical(y) && !categorical(x);
  const axis = horizontal ? 'x' : 'y', measure = horizontal ? x : y, category = horizontal ? y : x;
  const weights = profile.fields.filter(f => f.type === 'quantitative' && f.name !== measure.name &&
    f.name !== category.name && f.name !== color?.name && rows.every(row => Number.isFinite(row[f.name]) && row[f.name] >= 0) &&
    rows.some(row => row[f.name] > 0));
  const supportsWeight = weights.length > 0 && (!color || ['nominal', 'ordinal'].includes(color.type));
  const rate = /^(pct|percent(?:age)?|proportion|share|rate)$/i.test(measure.name) && rows.every(row =>
    Number.isFinite(row[measure.name]) && row[measure.name] >= 0 && row[measure.name] <= 1);
  const controls = definition.controls.map(c => c.key === 'aggregate' ? { ...c,
    ...(rate ? { value: 'mean', defaultPolicy: 'context' } : {}), choices: [...c.choices,
      ...(supportsWeight ? [{ value: 'weightedMean', label: 'Weighted mean' }] : [])] } : c);
  if (supportsWeight) controls.push({ ...select('weightField', 'Weight', weights.map(f => ({ value: f.name, label: f.name })),
    weights.find(f => /^(total|count|weight|population|n)$/i.test(f.name))?.name ?? weights[0].name),
    whenPath: { path: 'aggregate', values: ['weightedMean'] } });
  if (definition.method !== 'createHorizonPlot') controls.push({ ...select('valueFormat', `${axis.toUpperCase()} labels`,
    [{ value: 'auto', label: 'Number' }, { value: '.0%', label: 'Percent' }, { value: '.1%', label: 'Percent (1 decimal)' }], rate ? '.0%' : 'auto'), section: 'scales', defaultPolicy: 'context' });
  const cache = new Map();
  const binGuide = values => {
    const bins = values.bins ?? controls.find(c => c.key === 'bins')?.value ?? 10;
    if (!cache.has(bins)) cache.set(bins, numericBinGuide({ rows, field: x.name, bins }));
    return cache.get(bins);
  };
  const planners = new Map();
  const weightedPlan = input => {
    const values = nativeValues(input), args = definition.build(values), calls = definition.setup?.(values) ?? [];
    if (input.aggregate !== 'weightedMean') return { args, calls };
    const weightField = input.weightField ?? controls.find(c => c.key === 'weightField')?.value;
    if (!weights.some(f => f.name === weightField)) throw new Error('Choose a valid nonnegative weight column.');
    const weight = { field: weightField, kind: 'reliability' };
    if (calls.some(call => call.method === 'createSummaryData')) return { args, calls: calls.map(call =>
      call.method === 'createSummaryData' ? { ...call, args: { ...call.args, weight } } : call) };
    const source = args.data, output = `${source}-weighted-summary`;
    if (binsX) {
      let binField = `${x.name} (weighted bin)`;
      while (profile.sourceFields?.includes(binField) || profile.fields.some(f => f.name === binField)) binField += ' (bin)';
      const key = JSON.stringify([source, binField]);
      if (!planners.has(key)) planners.set(key, binnedSummarySetup({ source, rows, x: x.name, binField, y: y.name,
        color: color?.name, output }));
      const plan = planners.get(key);
      const prepared = plan(values).map(call => call.method === 'createSummaryData'
        ? { ...call, args: { ...call.args, weight } } : call);
      args.x = { ...args.x, field: binField, bin: { boundaries: binGuide(values).boundaries } };
      args.data = output;
      return { args, calls: [...calls, ...prepared] };
    }
    const grouping = [...new Set([args[horizontal ? 'y' : 'x']?.field ?? category.name,
      args.color?.field ?? (typeof args.color === 'string' ? args.color : undefined)].filter(Boolean))];
    args.data = output;
    return { args, calls: [...calls, { method: 'createSummaryData', args: { id: output, source,
      groupBy: grouping, aggregates: [{ op: 'mean', field: measure.name, as: measure.name }], weight, missing: 'drop' } }] };
  };
  // A weight can be valid globally yet all zero in one displayed group. Ask the
  // same public summary/bin plan that Apply executes; do not duplicate its grain
  // or bin membership rules. Positive-only weights need no additional work.
  const weightChecks = new Map();
  const positiveWeights = new Set(weights.filter(field => rows.every(row => row[field.name] > 0)).map(field => field.name));
  let validationSource;
  const weightChoices = values => controls.find(c => c.key === 'weightField')?.choices.map(choice => {
    if (positiveWeights.has(choice.value)) return choice;
    const calls = weightedPlan({ ...values, aggregate: 'weightedMean', weightField: choice.value }).calls;
    const key = JSON.stringify(calls);
    if (!weightChecks.has(key)) {
      validationSource ??= chart().createData({ id: profile.id, values: rows });
      let reason;
      try { calls.reduce((program, call) => program[call.method](call.args), validationSource); }
      catch (error) {
        if (!/positive total weight/.test(error.message)) throw error;
        reason = 'Each displayed group needs positive total weight. Choose another weight or aggregation.';
      }
      weightChecks.set(key, reason);
      if (weightChecks.size > 64) weightChecks.delete(weightChecks.keys().next().value);
    }
    const reason = weightChecks.get(key);
    return reason ? { ...choice, disabled: true, reason } : choice;
  }) ?? [];
  return { ...definition, controls,
    ...(rate ? { semanticDefaults: { ...definition.semanticDefaults, aggregate: 'mean' } } : {}),
    resolveControls(values) {
      const choices = weightChoices(values), valid = choices.some(choice => !choice.disabled);
      return [...(definition.resolveControls?.(values) ?? []), ...(supportsWeight ? [
        { key: 'weightField', choices },
        { key: 'aggregate', choices: controls.find(c => c.key === 'aggregate').choices.map(choice =>
          choice.value === 'weightedMean' && !valid ? { ...choice, disabled: true,
            reason: 'No weight column has positive total weight in every displayed group.' } : choice) },
      ] : [])];
    },
    setup: values => weightedPlan(values ?? {}).calls,
    build(values = {}) {
      const args = weightedPlan(values).args;
      const axes = { ...args.guides?.axes };
      if (binsX) axes.x = { ...axes.x, ...binGuide(values).axis,
        ...(args.x?.bin ? {} : { title: { text: `${x.name} (bin centers)` } }) };
      const format = values.valueFormat ?? (rate ? '.0%' : 'auto');
      if (definition.method !== 'createHorizonPlot') axes[axis] = { ...axes[axis], ticksAndLabels: {
        ...axes[axis]?.ticksAndLabels, labels: { ...axes[axis]?.ticksAndLabels?.labels, format } } };
      args.guides = { ...args.guides, axes };
      return args;
    } };
}
