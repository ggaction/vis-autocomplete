import { bucketTime } from '../vendor/ggaction/src/grammar/timeUnit.js';
import { normalizeTemporalValue } from '../vendor/ggaction/src/grammar/scales/fields.js';
import { rolePlotDefinitions } from './role-plots.js';
import { withInitialScales } from './initial-scales.js';
import { getPlotDefinitions, defaultValues } from './plot-catalog.js';
import { xBinControl, binnedSummarySetup, binnedFieldSetup, continuousFieldSetup, isContinuousField } from './plot-aggregation.js';

const categorical = field => ['nominal', 'ordinal'].includes(field.type);
const barCategory = field => categorical(field) || field.type === 'temporal';
const groupedXY = new Set(['createBoxPlot', 'createViolinPlot', 'createGradientPlot',
  'createIntervalPlot', 'createStripPlot', 'createBeeswarmPlot']);
const endpoints = new Set(['createDotPlot', 'createLollipopPlot', 'createRaincloudPlot']);
const directXY = new Set(['createScatterPlot', 'createLinePlot', 'createBarPlot', 'createAreaPlot',
  'createHeatmap', 'createRegressionPlot', 'createHorizonPlot', 'createTextPlot']);
const colorMethods = new Set(['createScatterPlot', 'createLinePlot', 'createBarPlot', 'createAreaPlot',
  'createRegressionPlot', 'createTextPlot', 'createStripPlot', 'createBeeswarmPlot', 'createIntervalPlot',
  'createViolinPlot', 'createRaincloudPlot', 'createBoxPlot', 'createGradientPlot']);
const aggregateChoices = ['mean', 'median', 'sum', 'min', 'max'];
const choice = (key, label, choices, value) => ({ key, label, type: 'select',
  choices: choices.map(item => typeof item === 'string' ? { value: item, label: item } : item), value });

// Project before any statistics, neighbor retrieval or parameter binding. Keep
// every original row and null; no unselected column can influence this query.
export function projectSelection(rows, profile, selection) {
  const fields = new Map(profile.fields.map(field => [field.name, field]));
  if (!selection?.x) throw new Error('Select an X variable.');
  if (selection.x === selection.y) throw new Error('Choose different X and Y variables.');
  const names = [...new Set([selection.x, selection.y, selection.color].filter(Boolean))];
  for (const name of names) if (!fields.get(name)?.usable) throw new Error(`Variable ${name} has no usable values.`);
  return { rows: rows.map(row => Object.fromEntries(names.map(name => [name, row[name] ?? null]))),
    profile: { ...profile, sourceFields: profile.fields.map(field => field.name), fields: names.map(name => fields.get(name)) }, fields: names };
}

// The chosen roles are constraints, not corpus-generated defaults. Plots that
// cannot represent these roles (e.g. a univariate histogram, or a count heatmap
// with an unrelated color variable) are omitted rather than silently rebound.
function selectedData(profile, selection, rows, cache) {
  const selectedFields = [...new Set([selection.x, selection.y, selection.color].filter(Boolean))].sort();
  const key = JSON.stringify(selectedFields), cached = cache?.get(key);
  if (cached?.sourceRows === rows && cached.sourceProfile === profile) return cached;
  const complete = rows.filter(row => selectedFields.every(field => row[field] !== null && row[field] !== undefined));
  // Plot domains/tick samples must match the explicit complete-case data view.
  // Neighbor statistics above still include every original row and missing value.
  const completeProfile = { ...profile, rowCount: complete.length, fields: profile.fields.map(field => {
    const domain = [...new Set(complete.map(row => row[field.name]))];
    return { ...field, distinct: domain.length, missing: 0, complete: true,
      guideValues: categorical(field) && domain.length > 12
        ? domain.filter((_, i) => i % Math.ceil(domain.length / 6) === 0) : undefined };
  }) };
  const result = { sourceRows: rows, sourceProfile: profile, complete, profile: completeProfile, numericFields: new Map(), statistics: new Map() };
  if (cache) {
    cache.set(key, result);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
  }
  return result;
}

export function selectedPlotDefinitions(profile, selection, rows, eligibility = [], options = {}) {
  // All candidate methods for the same selected columns have the same complete
  // rows and domains. The optional cache belongs to one immutable query, never
  // a global dataset name; changing data/types cannot reuse an old summary.
  const prepared = selectedData(profile, selection, rows, options.dataCache);
  const { complete, numericFields } = prepared;
  if (!complete.length) return [];
  profile = prepared.profile;
  const statistic = (key, calculate) => {
    if (!prepared.statistics.has(key)) prepared.statistics.set(key, calculate());
    return prepared.statistics.get(key);
  };
  const fields = new Map(profile.fields.map(field => [field.name, field]));
  const x = fields.get(selection.x), y = fields.get(selection.y), color = fields.get(selection.color);
  const ySelected = fields.get(selection.y);
  if (!ySelected) return rolePlotDefinitions(profile, selection, complete, options)
    .filter(definition => !options.method || definition.method === options.method)
    .map(definition => withInitialScales(definition, profile, complete, numericFields));
  const grouped = categorical(x) && y.type === 'quantitative' || categorical(y) && x.type === 'quantitative';
  const aggregateBar = barCategory(x) && y.type === 'quantitative' || barCategory(y) && x.type === 'quantitative';
  const category = categorical(x) ? x : y, measure = categorical(x) ? y : x;
  const pos = field => ({ field: field.name, fieldType: field.type, ...(field.order?.length ? { scale: { domain: field.order } } : {}) });
  const extraDefinitions = rolePlotDefinitions(profile, selection, complete, options)
    .filter(definition => !options.method || definition.method === options.method);
  const definitions = [];
  if (!y) return extraDefinitions;
  for (const definition of getPlotDefinitions(profile)) {
    const method = definition.method;
    if (options.method && method !== options.method) continue;
    const omit = reason => eligibility.push({ method, eligible: false, reason });
    if (!directXY.has(method) && !groupedXY.has(method) && !endpoints.has(method)) { omit('does-not-represent-selected-xy'); continue; }
    if ((groupedXY.has(method) || endpoints.has(method)) && !grouped) { omit('requires-categorical-and-numerical-positions'); continue; }
    if (color && !colorMethods.has(method) && method !== 'createHeatmap') { omit('does-not-support-selected-color'); continue; }
    if (method === 'createViolinPlot' && color && color.name !== category.name &&
        (!categorical(color) || color.distinct !== 2)) { omit('violin-split-requires-two-categories'); continue; }
    if (method === 'createRaincloudPlot' && color && color.name !== category.name) { omit('raincloud-color-must-match-position-category'); continue; }
    if (['createBoxPlot', 'createGradientPlot'].includes(method) && color && color.name !== category.name) { omit('distribution-color-must-match-position-category'); continue; }
    if (method === 'createIntervalPlot' && color && color.name !== category.name && !categorical(color) && !isContinuousField(color)) {
      omit('color-cannot-identify-interval-groups'); continue;
    }
    // Color is adapted to the mark's required grain, not rejected by source
    // type. Path/group colors need intervals; heatmap values need aggregation.
    const binnedColor = isContinuousField(color) &&
      (['createLinePlot', 'createAreaPlot', 'createIntervalPlot'].includes(method) ||
        method === 'createBarPlot' && (!aggregateBar || color.type === 'temporal'));
    const binnedHeatmap = method === 'createHeatmap' && isContinuousField(color) &&
      x.type === 'quantitative' && y.type === 'quantitative';
    const aggregatedHeatmap = method === 'createHeatmap' && isContinuousField(color);
    if (['createAreaPlot', 'createLinePlot'].includes(method) &&
        (y.type !== 'quantitative' || color && !categorical(color) && !binnedColor)) { omit('path-requires-numerical-y-and-series-color'); continue; }
    if (['createLinePlot', 'createAreaPlot'].includes(method) && color?.name === x.name && !binnedColor) {
      omit('color-groups-have-one-x-position'); continue;
    }
    let groupedFitSupported = true, regressionOptions;
    if (['createLinePlot', 'createAreaPlot', 'createRegressionPlot'].includes(method)) {
      const series = new Map(), counts = new Map();
      for (const row of complete) {
        const key = color && categorical(color) ? row[color.name] : '';
        if (!series.has(key)) series.set(key, new Set());
        series.get(key).add(row[x.name]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const groups = [...series.values()];
      groupedFitSupported = groups.every(values => values.size >= 2);
      if (method === 'createRegressionPlot') regressionOptions = {
        all: { minDistinctX: new Set(complete.map(row => row[x.name])).size, minRows: complete.length },
        group: { minDistinctX: Math.min(...groups.map(values => values.size)), minRows: Math.min(...counts.values()) },
        positiveY: complete.every(row => row[y.name] > 0),
      };
      // One sparse series does not invalidate every other path. Regression can
      // also fit all observations when a per-series fit is underdetermined.
      if (method !== 'createRegressionPlot' && groups.every(values => values.size < 2)) {
        omit('no-series-has-two-distinct-x-values'); continue;
      }
    }
    if (method === 'createBarPlot' && !aggregateBar && !(x.type === 'quantitative' && y.type === 'quantitative')) {
      omit('bar-requires-a-numerical-measure'); continue;
    }
    if (method === 'createRegressionPlot' && (!(x.type === 'quantitative' && y.type === 'quantitative') || x.distinct < 2)) {
      omit('regression-requires-numerical-xy-and-distinct-x'); continue;
    }
    if (method === 'createHorizonPlot' && (y.type !== 'quantitative' || categorical(x) || x.distinct < 2)) {
      omit('horizon-requires-ordered-x-and-numerical-y'); continue;
    }
    if (method === 'createHeatmap' && !(color
      ? (categorical(x) && categorical(y) || binnedHeatmap) && isContinuousField(color)
      : x.type === 'quantitative' && y.type === 'quantitative')) { omit('heatmap-requires-binnable-xy-or-categorical-grid-with-continuous-color'); continue; }

    const groupFields = [category.name, ...(color && color.name !== category.name && categorical(color) ? [color.name] : [])];
    const groupCounts = grouped ? statistic(JSON.stringify(['groups', ...groupFields]), () => {
      const counts = new Map();
      for (const row of complete) {
        const key = JSON.stringify(groupFields.map(field => row[field]));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    }) : new Map();
    const singletonGroups = grouped && [...groupCounts.values()].every(count => count < 2);
    const densityMethods = ['createViolinPlot', 'createGradientPlot', 'createRaincloudPlot'];
    const denseSteps = Math.min(100, Math.floor(10000 / Math.max(1, groupCounts.size)));
    let requirement = null;
    if (singletonGroups && (method === 'createIntervalPlot' || densityMethods.includes(method))) requirement = 'Each group has only one observation. Choose a dot/bar chart or supply measured interval bounds; group distributions and confidence intervals require repeated observations.';
    if (densityMethods.includes(method) && denseSteps < 2) requirement = 'Too many groups for a density estimate. Choose a bar/dot chart or fewer grouping categories.';
    if (complete.length > 50000 && ['createScatterPlot', 'createRegressionPlot', 'createStripPlot', 'createBeeswarmPlot', 'createRaincloudPlot', 'createTextPlot'].includes(method)) requirement = `This chart would create ${complete.length.toLocaleString('en-US')} observation marks (limit 50,000). Use an aggregated bar, line, area, histogram, or heatmap.`;
    const summarizedText = method === 'createTextPlot' && grouped;
    const textGroups = [...new Set([category.name, color && categorical(color) ? color.name : undefined].filter(Boolean))];
    const textCount = summarizedText ? new Set(complete.map(row => JSON.stringify(textGroups.map(field => row[field])))).size : complete.length;
    if (method === 'createTextPlot' && textCount > 60) requirement = `This selection would place ${textCount} text labels in one chart. Use a scatter plot with selected value labels, or fewer categories, for readable labels.`;
    const eventCounts = statistic(JSON.stringify(['events', y.name]), () => complete.every(row => row[y.name] === 1));
    const defaults = { ...defaultValues(definition), x: x.name, y: y.name, category: category.name,
      value: measure.name, color: color?.name ?? '', text: color?.name ?? y.name,
      aggregate: eventCounts ? 'sum' : 'mean', radius: 3, width: 2, opacity: method === 'createAreaPlot' ? .65 : method === 'createBarPlot' ? .85 : .8 };
    // Only construction decisions belong here; X/Y/Color remain fixed by the table.
    const controls = definition.controls.filter(control => !['x', 'y', 'category', 'value', 'color', 'text'].includes(control.key) &&
      !(method === 'createHeatmap' && color && !binnedHeatmap && control.key === 'bins'));
    if (summarizedText) controls.push(choice('aggregate', `${measure.name} aggregation`, aggregateChoices, 'mean'));
    if (['createLinePlot', 'createAreaPlot', 'createHorizonPlot'].includes(method)) {
      controls.unshift(choice('aggregate', 'Y aggregation', aggregateChoices, eventCounts ? 'sum' : 'mean'));
    }
    const binsX = ['createLinePlot', 'createAreaPlot', 'createBarPlot', 'createHorizonPlot'].includes(method) &&
      x.type === 'quantitative' && y.type === 'quantitative';
    if (binsX) controls.unshift(xBinControl());
    const calendar = ['createLinePlot', 'createAreaPlot', 'createBarPlot', 'createHorizonPlot'].includes(method) && x.type === 'temporal' && y.type === 'quantitative';
    if (calendar) {
      const calendarChoices = ['year', 'quarter', 'month', 'week', 'day'].map(value => {
        // Only Horizon needs this extra feasibility check. Stop once a second
        // bucket exists instead of reprocessing the dataset for every chart.
        const buckets = new Set();
        if (method === 'createHorizonPlot') for (const row of complete) {
          buckets.add(bucketTime(normalizeTemporalValue(row[x.name], x.name), { unit: value, timeZone: 'UTC', weekStartsOn: 1 }));
          if (buckets.size >= 2) break;
        }
        const insufficient = method === 'createHorizonPlot' && buckets.size < 2;
        return { value, label: value, ...(insufficient ? { disabled: true,
          reason: `This interval leaves ${buckets.size} date. A horizon plot needs at least two dates; choose a finer interval.` } : {}) };
      });
      controls.unshift(choice('timeUnit', 'Calendar interval (UTC)', [{ value: 'raw', label: 'Original dates' }, ...calendarChoices], 'raw'));
    }
    if (binnedColor) controls.push({ key: 'colorBins', label: `${color.name} color bins (maximum)`,
      type: 'number', value: 3, min: 2, max: 6, step: 1 });
    if (aggregatedHeatmap) controls.push(choice('aggregate', 'Color aggregation',
      color.type === 'temporal' ? ['mean', 'median', 'min', 'max'] : aggregateChoices, 'mean'));
    if (method === 'createBarPlot' && binsX && color && categorical(color)) {
      controls.push(choice('layout', 'Layout', ['overlay', 'stack', 'fill', 'group'].map(value => ({ value,
        label: { overlay: 'Overlay', stack: 'Stack', fill: 'Normalize', group: 'Dodge' }[value] })), 'overlay'));
    }
    if (method === 'createRegressionPlot' && color && categorical(color)) {
      controls.push(choice('fit', 'Fit', [{ value: 'group', label: `By ${color.name}`, disabled: !groupedFitSupported },
        { value: 'all', label: 'All observations' }], groupedFitSupported ? 'group' : 'all'));
    }
    if (method === 'createRegressionPlot') {
      controls.push(
        { key: 'degree', label: 'Degree', type: 'number', value: 2, min: 1, max: Math.min(6, x.distinct - 1), step: 1, whenPath: { path: 'method', values: ['polynomial'] } },
        { key: 'span', label: 'Span', type: 'number', value: .5, min: .1, max: 1, step: .05, whenPath: { path: 'method', values: ['loess'] } },
        { key: 'robustIterations', label: 'Robust iterations', type: 'number', value: 0, min: 0, max: 5, step: 1, whenPath: { path: 'method', values: ['loess'] } },
        { ...choice('interval', 'Interval', [{ value: false, label: 'None' }, { value: 'mean', label: 'Mean confidence' }, { value: 'prediction', label: 'Prediction' }], false),
          whenPath: { path: 'method', values: ['linear', 'polynomial'] } },
      );
    }
    if (['createViolinPlot', 'createGradientPlot'].includes(method)) {
      controls.push(choice('kernel', 'Kernel', ['gaussian', 'epanechnikov', 'uniform', 'triangular'], 'gaussian'),
        choice('normalization', 'Density', [{value:'unit',label:'Normalized density'},{value:'count',label:'Count weighted density'}], 'unit'));
      if (method === 'createViolinPlot' && (!color || color.name === category.name)) controls.push(choice('densitySide', 'Density side', categorical(x) ? ['both','left','right'] : ['both','top','bottom'], 'both'));
    }
    if (method === 'createLollipopPlot') {
      const values = complete.map(row => row[measure.name]), low = Math.min(0, ...values), high = Math.max(1, ...values);
      controls.push({ key: 'baseline', label: 'Baseline', type: 'number', value: 0, min: low, max: high, step: Number(((high-low)/100).toPrecision(3)) });
    }
    // Use native encoding aggregation whenever supported. Numeric-X line/bar use
    // X bins and a Y aggregate directly; area/horizon need a summary dataset.
    // Keep preparation separate from the single recommended plot call.
    const summarizes = ['createAreaPlot', 'createHorizonPlot'].includes(method);
    const summaryId = `${profile.id}-plot-summary`;
    let binField = `${x.name} (bin)`;
    const reserved = profile.sourceFields ?? profile.fields.map(field => field.name);
    while (reserved.includes(binField)) binField += ' (bin)';
    const unusedField = name => { while (reserved.includes(name) || name === binField) name += ' (bin)'; return name; };
    const colorBinField = unusedField(`${color?.name} (color bin)`), yBinField = unusedField(`${y.name} (bin)`);
    const colorPlan = binnedColor ? binnedFieldSetup({ source: profile.id, rows: complete,
      field: color.name, as: colorBinField, role: 'color', type: color.type, reserved }) : null;
    const colorSource = binnedColor ? `${profile.id}-color-binned-rows` : profile.id;
    const summaryColor = binnedColor ? colorBinField : color && categorical(color) ? color.name : undefined;
    const calendarField = unusedField(`${x.name} (calendar)`);
    const calendarData = `${colorSource}-calendar`;
    const calendarCalls = values => calendar && values.timeUnit && values.timeUnit !== 'raw' ? [{ method: 'createTimeUnitData', args: { id: calendarData, source: colorSource, field: x.name, as: calendarField, unit: values.timeUnit, timeZone: 'UTC', ...(values.timeUnit === 'week' ? { weekStartsOn: 1 } : {}) } }] : [];
    const calendarSource = values => calendarCalls(values).length ? calendarData : colorSource;
    const summaryX = values => calendarCalls(values).length ? calendarField : x.name;
    const summarySetup = summarizes && binsX ? binnedSummarySetup({ source: colorSource, rows: complete,
      x: x.name, binField, y: y.name, color: summaryColor, output: summaryId })
      : summarizes ? (values = {}) => [{ method: 'createSummaryData', args: {
      id: summaryId, source: calendarSource(values),
      groupBy: [...new Set([summaryX(values), summaryColor].filter(Boolean))],
      aggregates: [{ op: values.aggregate ?? 'mean', field: y.name, as: y.name }], missing: 'drop',
    } }] : () => [];
    const heatColor = aggregatedHeatmap ? continuousFieldSetup({ source: profile.id, field: color.name,
      type: color.type, role: 'heat-color', reserved }) : null;
    const heatX = binnedHeatmap ? binnedFieldSetup({ source: heatColor.data, rows: complete,
      field: x.name, as: binField, role: 'heat-x' }) : null;
    const heatY = binnedHeatmap ? binnedFieldSetup({ source: `${heatColor.data}-heat-x-binned-rows`, rows: complete,
      field: y.name, as: yBinField, role: 'heat-y' }) : null;
    const textColor = summarizedText && color?.type === 'temporal' ? continuousFieldSetup({ source: profile.id, field: color.name, type: color.type, role: 'text-color', reserved }) : null;
    const setup = (values = {}) => summarizedText ? [...(textColor?.calls ?? []), { method: 'createSummaryData', args: { id: summaryId, source: textColor?.data ?? profile.id, groupBy: textGroups, aggregates: [...new Set([measure.name, color && !categorical(color) ? color.name : undefined].filter(Boolean))].map(field => ({ field: field === color?.name && textColor ? textColor.field : field, as: field, op: values.aggregate ?? 'mean' })), missing: 'drop' } }] : aggregatedHeatmap ? [...heatColor.calls,
      ...(binnedHeatmap ? [...heatX(values.bins ?? 8).calls, ...heatY(values.bins ?? 8).calls] : []),
      { method: 'createSummaryData', args: { id: summaryId,
        source: binnedHeatmap ? `${heatColor.data}-heat-x-binned-rows-heat-y-binned-rows` : heatColor.data,
        groupBy: binnedHeatmap ? [binField, yBinField] : [x.name, y.name],
        aggregates: [{ op: values.aggregate ?? 'mean', field: heatColor.field, as: color.name }], missing: 'drop' } }]
      : [...(colorPlan ? colorPlan(values.colorBins ?? 3).calls : []), ...calendarCalls(values), ...summarySetup(values),
        ...(method === 'createAreaPlot' && summaryColor ? [{ method: 'createCompleteData', args: { id: `${summaryId}-aligned`, source: summaryId, key: binsX ? binField : summaryX(values), groupBy: [summaryColor],
          ...(['sum', 'count'].includes(values.aggregate) ? { fill: { [y.name]: 0 } } : {}) } }] : [])];
    const build = (values = {}) => {
      const v = { ...defaults, ...Object.fromEntries(controls.map(control => [control.key, values[control.key] ?? control.value])) };
      let args;
      if (method === 'createScatterPlot') args = { id: 'plot', data: profile.id,
        x: pos(x), y: pos(y), missing: 'skip', point: { radius: v.radius, opacity: v.opacity } };
      else if (method === 'createLinePlot') args = { id: 'plot', data: profile.id,
        x: { ...pos(x), ...(x.type === 'quantitative' ? { bin: { maxBins: v.bins } } : {}) },
        y: { ...pos(y), aggregate: v.aggregate },
        line: { strokeWidth: v.width } };
      else if (method === 'createBarPlot') args = { id: 'plot', data: profile.id, missing: 'skip',
        x: { ...pos(x), ...(binsX ? { bin: { maxBins: v.bins } } : {}),
          ...(aggregateBar && !barCategory(x) ? { aggregate: v.aggregate } : {}) },
        y: { ...pos(y), ...(!barCategory(y) ? { aggregate: v.aggregate } : {}) },
        ...(!aggregateBar ? { bar: { opacity: v.opacity } } : {}) };
      else if (method === 'createAreaPlot') args = { id: 'plot', data: profile.id, x: pos(x), y: { field: y.name },
        missing: 'break', area: { opacity: v.opacity } };
      else if (method === 'createHeatmap') args = { id: 'plot', data: profile.id, x: pos(x), y: pos(y),
        ...(color ? { color: { ...pos(color), scale: { palette: 'blues' } } }
          : { bin: { bins: v.bins }, color: { palette: 'blues' } }) };
      else {
        args = definition.build(v);
        if (groupedXY.has(method) && !categorical(x)) [args.x, args.y] = [args.y, args.x];
        if (endpoints.has(method)) args.orientation = categorical(x) ? 'vertical' : 'horizontal';
        if (method === 'createTextPlot') {
          args.style.missing = 'skip';
          if (summarizedText) { args.data = summaryId; args.text = { field: color && categorical(color) ? color.name : measure.name, ...(!color || !categorical(color) ? { format: '.2f' } : {}) }; }
        }
        if (densityMethods.includes(method)) args.density = { ...args.density, steps: Math.max(2, denseSteps) };
      }
      if (summarizes || aggregatedHeatmap) args.data = summaryId;
      if (calendarCalls(v).length) {
        if (!summarizes) args.data = calendarData;
        args.x = { ...args.x, field: calendarField, fieldType: 'temporal', temporalUnit: 'timestamp' };
      }
      if (method === 'createAreaPlot' && summaryColor) args.data = `${summaryId}-aligned`;
      if (summarizes && binsX) args.x = { ...args.x, field: binField };
      if (binnedColor && !summarizes && !calendarCalls(v).length) args.data = colorSource;
      if (binnedHeatmap) {
        args.data = summaryId;
        args.x = { field: binField, fieldType: 'ordinal', scale: { domain: heatX(v.bins).domain } };
        args.y = { field: yBinField, fieldType: 'ordinal', scale: { domain: heatY(v.bins).domain } };
        const axis = (field, domain) => ({ title: { text: field.name }, ticksAndLabels: {
          values: domain.filter((_, i) => i % Math.ceil(domain.length / 4) === 0),
          labels: { fontSize: 9, maxWidth: 48, wrap: 'word' } } });
        args.guides = { axes: { x: axis(x, heatX(v.bins).domain), y: axis(y, heatY(v.bins).domain) } };
      }
      if (aggregatedHeatmap && color.type === 'temporal') args.color.temporalUnit = 'timestamp';
      if (method === 'createRegressionPlot') args.groupBy = v.fit === 'all' || !color || !categorical(color) ? false : color.name;
      if (color && colorMethods.has(method)) {
        args.color = binnedColor ? { field: colorBinField, fieldType: 'ordinal',
          scale: { domain: colorPlan(v.colorBins).domain, palette: 'blues' } } : pos(color);
        if (summarizedText && color.type === 'temporal') args.color.temporalUnit = 'timestamp';
        if (method === 'createBarPlot' && binsX) args.color.layout = v.layout ?? 'overlay';
        if (method === 'createBarPlot' && aggregateBar && color.type === 'quantitative') args.color.aggregate = 'mean';
        if (['createLinePlot', 'createAreaPlot'].includes(method) && categorical(color)) args.groupBy = [color.name];
        if (['createLinePlot', 'createAreaPlot'].includes(method) && binnedColor) args.groupBy = [colorBinField];
        if (method === 'createIntervalPlot' && color.name !== category.name) args.groupBy = binnedColor ? colorBinField : color.name;
        if (method === 'createViolinPlot' && color.name !== category.name) args.split = { field: color.name };
      }
      const axes = Object.fromEntries([['x', x], ['y', y]].filter(([, field]) => field.guideValues)
        .map(([channel, field]) => [channel, { ticksAndLabels: { values: field.guideValues,
          labels: { fontSize: 9, maxWidth: 48, wrap: 'word', overlap: 'allow' } } }]));
      if (Object.keys(axes).length) args.guides = { ...args.guides, axes: { ...args.guides?.axes, ...axes } };
      if (binsX) args.guides = { ...args.guides, axes: { ...args.guides?.axes,
        x: { ...args.guides?.axes?.x, ticksAndLabels: { count: 6 } } } };
      if (binnedColor) args.guides = { ...args.guides, legend: { title: `${color.name} (binned)` } };
      if (summarizes && binsX) args.guides = { ...args.guides,
        axes: { ...args.guides?.axes, x: { ...args.guides?.axes?.x, title: { text: x.name } } } };
      return args;
    };
    eligibility.push({ method, eligible: true, colorType: color?.type,
      colorStrategy: binnedColor ? 'ordered-intervals' : aggregatedHeatmap ? 'cell-aggregate' : 'native' });
    definitions.push({ ...definition, controls, build, setup, binField: summarizes && binsX || binnedHeatmap ? binField : undefined,
      yBinField: binnedHeatmap ? yBinField : undefined, colorBinField: binnedColor ? colorBinField : undefined,
      requirement, regressionOptions,
      semanticDefaults: eventCounts && ['createLinePlot', 'createAreaPlot', 'createBarPlot', 'createHorizonPlot'].includes(method) ? { aggregate: 'sum' } : undefined, selection: { ...selection } });
  }
  for (const definition of extraDefinitions) {
    const existing = eligibility.find(item => item.method === definition.method);
    if (existing) Object.assign(existing, { eligible: true, reason: undefined });
    else eligibility.push({ method: definition.method, eligible: true });
  }
  return [...definitions.filter(d => !extraDefinitions.some(e => e.method === d.method)), ...extraDefinitions]
    .map(definition => withInitialScales(definition, profile, complete, numericFields));
}
