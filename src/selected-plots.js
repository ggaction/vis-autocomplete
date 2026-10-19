import { getPlotDefinitions, defaultValues } from './plot-catalog.js';
import { xBinControl, binnedSummarySetup, binnedFieldSetup } from './plot-aggregation.js';

const categorical = field => ['nominal', 'ordinal'].includes(field.type);
const barCategory = field => categorical(field) || field.type === 'temporal';
const groupedXY = new Set(['createBoxPlot', 'createViolinPlot', 'createGradientPlot',
  'createIntervalPlot', 'createStripPlot', 'createBeeswarmPlot']);
const endpoints = new Set(['createDotPlot', 'createLollipopPlot', 'createRaincloudPlot']);
const directXY = new Set(['createScatterPlot', 'createLinePlot', 'createBarPlot', 'createAreaPlot',
  'createHeatmap', 'createRegressionPlot', 'createHorizonPlot', 'createTextPlot']);
const colorMethods = new Set(['createScatterPlot', 'createLinePlot', 'createBarPlot', 'createAreaPlot',
  'createRegressionPlot', 'createTextPlot', 'createStripPlot', 'createBeeswarmPlot', 'createIntervalPlot',
  'createViolinPlot', 'createRaincloudPlot']);
const aggregateChoices = ['mean', 'median', 'sum', 'min', 'max'];
const choice = (key, label, choices, value) => ({ key, label, type: 'select',
  choices: choices.map(item => typeof item === 'string' ? { value: item, label: item } : item), value });

// Project before any statistics, neighbor retrieval or parameter binding. Keep
// every original row and null; no unselected column can influence this query.
export function projectSelection(rows, profile, selection) {
  const fields = new Map(profile.fields.map(field => [field.name, field]));
  if (!selection?.x || !selection?.y) throw new Error('Select X and Y variables.');
  if (selection.x === selection.y) throw new Error('Choose different X and Y variables.');
  const names = [...new Set([selection.x, selection.y, selection.color].filter(Boolean))];
  for (const name of names) if (!fields.get(name)?.usable) throw new Error(`Variable ${name} has no usable values.`);
  return { rows: rows.map(row => Object.fromEntries(names.map(name => [name, row[name] ?? null]))),
    profile: { ...profile, sourceFields: profile.fields.map(field => field.name), fields: names.map(name => fields.get(name)) }, fields: names };
}

// The chosen roles are constraints, not corpus-generated defaults. Plots that
// cannot represent these roles (e.g. a univariate histogram, or a count heatmap
// with an unrelated color variable) are omitted rather than silently rebound.
export function selectedPlotDefinitions(profile, selection, rows) {
  const selectedFields = [...new Set([selection.x, selection.y, selection.color].filter(Boolean))];
  const complete = rows.filter(row => selectedFields.every(field => row[field] !== null && row[field] !== undefined));
  if (!complete.length) return [];
  // Plot domains/tick samples must match the explicit complete-case data view.
  // Neighbor statistics above still include every original row and missing value.
  profile = { ...profile, rowCount: complete.length, fields: profile.fields.map(field => {
    const domain = [...new Set(complete.map(row => row[field.name]))];
    return { ...field, distinct: domain.length, missing: 0, complete: true,
      guideValues: categorical(field) && domain.length > 12
        ? domain.filter((_, i) => i % Math.ceil(domain.length / 6) === 0) : undefined };
  }) };
  const fields = new Map(profile.fields.map(field => [field.name, field]));
  const x = fields.get(selection.x), y = fields.get(selection.y), color = fields.get(selection.color);
  const grouped = categorical(x) && y.type === 'quantitative' || categorical(y) && x.type === 'quantitative';
  const aggregateBar = barCategory(x) && y.type === 'quantitative' || barCategory(y) && x.type === 'quantitative';
  const category = categorical(x) ? x : y, measure = categorical(x) ? y : x;
  const pos = field => ({ field: field.name, fieldType: field.type });
  const definitions = [];
  for (const definition of getPlotDefinitions(profile)) {
    const method = definition.method;
    if (!directXY.has(method) && !groupedXY.has(method) && !endpoints.has(method)) continue;
    if ((groupedXY.has(method) || endpoints.has(method)) && !grouped) continue;
    if (color && !colorMethods.has(method) && method !== 'createHeatmap') continue;
    if (method === 'createViolinPlot' && color && color.name !== category.name &&
        (!categorical(color) || color.distinct !== 2)) continue;
    if (method === 'createRaincloudPlot' && color && color.name !== category.name) continue;
    if (method === 'createIntervalPlot' && color && color.name !== category.name && !categorical(color)) continue;
    const binnedColor = color?.type === 'quantitative' &&
      (['createLinePlot', 'createAreaPlot'].includes(method) || method === 'createBarPlot' && !aggregateBar);
    const binnedHeatmap = method === 'createHeatmap' && color?.type === 'quantitative' &&
      x.type === 'quantitative' && y.type === 'quantitative';
    if (['createAreaPlot', 'createLinePlot'].includes(method) &&
        (y.type !== 'quantitative' || color && !categorical(color) && !binnedColor)) continue;
    if (['createLinePlot', 'createAreaPlot'].includes(method) && color?.name === x.name && !binnedColor) continue;
    if (['createLinePlot', 'createAreaPlot', 'createRegressionPlot'].includes(method)) {
      const series = new Map();
      for (const row of complete) {
        const key = color && categorical(color) ? row[color.name] : '';
        if (!series.has(key)) series.set(key, new Set());
        series.get(key).add(row[x.name]);
      }
      if ([...series.values()].some(values => values.size < 2)) continue;
    }
    if (method === 'createBarPlot' && !aggregateBar && !(x.type === 'quantitative' && y.type === 'quantitative')) continue;
    if (method === 'createBarPlot' && color?.type === 'temporal') continue;
    if (method === 'createRegressionPlot' && !(x.type === 'quantitative' && y.type === 'quantitative')) continue;
    if (method === 'createHorizonPlot' && (y.type !== 'quantitative' || categorical(x) || x.distinct < 2)) continue;
    if (method === 'createHeatmap' && !(color
      ? (categorical(x) && categorical(y) || binnedHeatmap) && color.type === 'quantitative'
      : x.type === 'quantitative' && y.type === 'quantitative')) continue;

    const defaults = { ...defaultValues(definition), x: x.name, y: y.name, category: category.name,
      value: measure.name, color: color?.name ?? '', text: color?.name ?? y.name,
      aggregate: 'mean', radius: 3, width: 2, opacity: method === 'createAreaPlot' ? .65 : method === 'createBarPlot' ? .85 : .8 };
    // Only construction decisions belong here; X/Y/Color remain fixed by the table.
    const controls = definition.controls.filter(control => !['x', 'y', 'category', 'value', 'color', 'text'].includes(control.key) &&
      !(method === 'createHeatmap' && color && !binnedHeatmap && control.key === 'bins'));
    if (['createLinePlot', 'createAreaPlot', 'createHorizonPlot'].includes(method)) {
      controls.unshift(choice('aggregate', 'Aggregation', aggregateChoices, 'mean'));
    }
    const binsX = ['createLinePlot', 'createAreaPlot', 'createBarPlot', 'createHorizonPlot'].includes(method) &&
      x.type === 'quantitative' && y.type === 'quantitative';
    if (binsX) controls.unshift(xBinControl());
    if (binnedColor) controls.push({ key: 'colorBins', label: `${color.name} color bins (maximum)`,
      type: 'number', value: 3, min: 2, max: 6, step: 1 });
    if (binnedHeatmap) controls.push(choice('aggregate', 'Color aggregation', aggregateChoices, 'mean'));
    if (method === 'createBarPlot' && binsX && color && categorical(color)) {
      controls.push(choice('layout', 'Layout', ['overlay', 'stack', 'fill', 'group'].map(value => ({ value,
        label: { overlay: 'Overlay', stack: 'Stack', fill: 'Normalize', group: 'Dodge' }[value] })), 'overlay'));
    }
    if (method === 'createRegressionPlot' && color && categorical(color)) {
      controls.push(choice('fit', 'Fit', [{ value: 'group', label: `By ${color.name}` },
        { value: 'all', label: 'All observations' }], 'group'));
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
      field: color.name, as: colorBinField, role: 'color' }) : null;
    const colorSource = binnedColor ? `${profile.id}-color-binned-rows` : profile.id;
    const summaryColor = binnedColor ? colorBinField : color && categorical(color) ? color.name : undefined;
    const summarySetup = summarizes && binsX ? binnedSummarySetup({ source: colorSource, rows: complete,
      x: x.name, binField, y: y.name, color: summaryColor, output: summaryId })
      : summarizes ? (values = {}) => [{ method: 'createSummaryData', args: {
      id: summaryId, source: colorSource,
      groupBy: [...new Set([x.name, summaryColor].filter(Boolean))],
      aggregates: [{ op: values.aggregate ?? 'mean', field: y.name, as: y.name }], missing: 'drop',
    } }] : () => [];
    const heatX = binnedHeatmap ? binnedFieldSetup({ source: profile.id, rows: complete,
      field: x.name, as: binField, role: 'heat-x' }) : null;
    const heatY = binnedHeatmap ? binnedFieldSetup({ source: `${profile.id}-heat-x-binned-rows`, rows: complete,
      field: y.name, as: yBinField, role: 'heat-y' }) : null;
    const setup = (values = {}) => binnedHeatmap ? [...heatX(values.bins ?? 8).calls, ...heatY(values.bins ?? 8).calls,
      { method: 'createSummaryData', args: { id: summaryId, source: `${profile.id}-heat-x-binned-rows-heat-y-binned-rows`,
        groupBy: [binField, yBinField], aggregates: [{ op: values.aggregate ?? 'mean', field: color.name, as: color.name }], missing: 'drop' } }]
      : [...(colorPlan ? colorPlan(values.colorBins ?? 3).calls : []), ...summarySetup(values)];
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
        if (method === 'createTextPlot') args.style.missing = 'skip';
      }
      if (summarizes) args.data = summaryId;
      if (summarizes && binsX) args.x = { ...args.x, field: binField };
      if (binnedColor && !summarizes) args.data = colorSource;
      if (binnedHeatmap) {
        args.data = summaryId;
        args.x = { field: binField, fieldType: 'ordinal', scale: { domain: heatX(v.bins).domain } };
        args.y = { field: yBinField, fieldType: 'ordinal', scale: { domain: heatY(v.bins).domain } };
        const axis = (field, domain) => ({ title: { text: field.name }, ticksAndLabels: {
          values: domain.filter((_, i) => i % Math.ceil(domain.length / 4) === 0),
          labels: { fontFamily: 'Arial', fontSize: 9, maxWidth: 48, wrap: 'word' } } });
        args.guides = { axes: { x: axis(x, heatX(v.bins).domain), y: axis(y, heatY(v.bins).domain) } };
      }
      if (method === 'createRegressionPlot') args.groupBy = v.fit === 'all' || !color || !categorical(color) ? false : color.name;
      if (color && colorMethods.has(method)) {
        args.color = binnedColor ? { field: colorBinField, fieldType: 'ordinal',
          scale: { domain: colorPlan(v.colorBins).domain, palette: 'blues' } } : pos(color);
        if (method === 'createBarPlot' && binsX) args.color.layout = v.layout ?? 'overlay';
        if (method === 'createBarPlot' && aggregateBar && color.type === 'quantitative') args.color.aggregate = 'mean';
        if (['createLinePlot', 'createAreaPlot'].includes(method) && categorical(color)) args.groupBy = [color.name];
        if (['createLinePlot', 'createAreaPlot'].includes(method) && binnedColor) args.groupBy = [colorBinField];
        if (method === 'createIntervalPlot' && categorical(color) && color.name !== category.name) args.groupBy = color.name;
        if (method === 'createViolinPlot' && color.name !== category.name) args.split = { field: color.name };
      }
      const axes = Object.fromEntries([['x', x], ['y', y]].filter(([, field]) => field.guideValues)
        .map(([channel, field]) => [channel, { ticksAndLabels: { values: field.guideValues,
          labels: { fontFamily: 'Arial', fontSize: 9, maxWidth: 48, wrap: 'word', overlap: 'allow' } } }]));
      if (Object.keys(axes).length) args.guides = { ...args.guides, axes: { ...args.guides?.axes, ...axes } };
      if (binsX) args.guides = { ...args.guides, axes: { ...args.guides?.axes,
        x: { ...args.guides?.axes?.x, ticksAndLabels: { count: 6 } } } };
      if (binnedColor) args.guides = { ...args.guides, legend: { title: `${color.name} (binned)` } };
      if (summarizes && binsX) args.guides = { ...args.guides,
        axes: { ...args.guides?.axes, x: { ...args.guides?.axes?.x, title: { text: x.name } } } };
      return args;
    };
    definitions.push({ ...definition, controls, build, setup, binField: summarizes && binsX || binnedHeatmap ? binField : undefined,
      yBinField: binnedHeatmap ? yBinField : undefined, colorBinField: binnedColor ? colorBinField : undefined,
      requirement: null, selection: { ...selection } });
  }
  return definitions;
}
