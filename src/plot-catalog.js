// These are existing ggaction plot methods. The UI adds explicit default guide setup.
import { preferVisualFields } from './profile.js';
export const INITIAL_PLOT_METHODS = Object.freeze([
  'createScatterPlot', 'createLinePlot', 'createBarPlot', 'createAreaPlot',
  'createHistogram', 'createHeatmap', 'createBoxPlot', 'createViolinPlot',
  'createDensityPlot', 'createGradientPlot', 'createRegressionPlot', 'createIntervalPlot',
  'createDotPlot', 'createLollipopPlot', 'createDumbbellPlot', 'createECDFPlot',
  'createStripPlot', 'createBeeswarmPlot', 'createRaincloudPlot', 'createRugPlot',
  'createPiePlot', 'createRosePlot', 'createRadialBarPlot', 'createPolarScatterPlot',
  'createPolarLinePlot', 'createRadarPlot', 'createHorizonPlot', 'createParallelCoordinates',
  'createTextPlot',
]);

const names = {
  createScatterPlot: ['Scatter plot', 'Compare two numerical variables.'],
  createLinePlot: ['Line plot', 'Connect values across an ordered variable.'],
  createBarPlot: ['Bar plot', 'Compare a measure across categories.'],
  createAreaPlot: ['Area plot', 'Show values with a filled baseline.'],
  createHistogram: ['Histogram', 'Explore the distribution of one variable.'],
  createHeatmap: ['Heatmap', 'Count observations in a two-dimensional grid.'],
  createBoxPlot: ['Box plot', 'Compare medians and spread across groups.'],
  createViolinPlot: ['Violin plot', 'Compare the shapes of group distributions.'],
  createDensityPlot: ['Density plot', 'Show a smooth distribution.'],
  createGradientPlot: ['Gradient plot', 'Show group distributions as density strips.'],
  createRegressionPlot: ['Regression plot', 'Fit a model to a pair of variables.'],
  createIntervalPlot: ['Interval plot', 'Show a group mean and confidence interval.'],
  createDotPlot: ['Dot plot', 'Compare categories with position.'],
  createLollipopPlot: ['Lollipop plot', 'Connect category values to a baseline.'],
  createDumbbellPlot: ['Dumbbell plot', 'Compare two measures within each category.'],
  createECDFPlot: ['ECDF plot', 'Show cumulative proportions.'],
  createStripPlot: ['Strip plot', 'Show individual observations by group.'],
  createBeeswarmPlot: ['Beeswarm plot', 'Pack observations to reduce overlap.'],
  createRaincloudPlot: ['Raincloud plot', 'Combine density, summary, and observations.'],
  createRugPlot: ['Rug plot', 'Mark observations along one axis.'],
  createPiePlot: ['Pie plot', 'Compare category shares.'],
  createRosePlot: ['Rose plot', 'Show category totals with radial sectors.'],
  createRadialBarPlot: ['Radial bar plot', 'Compare totals around a circle.'],
  createPolarScatterPlot: ['Polar scatter plot', 'Encode values as angle and radius.'],
  createPolarLinePlot: ['Polar line plot', 'Connect observations in polar coordinates.'],
  createRadarPlot: ['Radar plot', 'Compare three or more dimensions.'],
  createHorizonPlot: ['Horizon plot', 'Fold values into colored bands.'],
  createParallelCoordinates: ['Parallel coordinates', 'Compare observations across several dimensions.'],
  createTextPlot: ['Text plot', 'Place text labels at data positions.'],
};

const optional = options => [{ value: '', label: 'None' }, ...options];
const choices = fields => fields.map(f => ({ value: f.name, label: f.name, missing: f.missing, fieldType: f.type }));
const select = (key, label, options, value = options[0]?.value ?? '') =>
  ({ key, label, type: 'select', choices: options, value });
const number = (key, label, value, min, max, step = 1) => ({ key, label, type: 'number', value, min, max, step });
const enums = items => items.map(value => ({ value, label: value }));

export function getPlotDefinitions(profile) {
  const usable = profile.fields.filter(f => f.usable);
  const q = preferVisualFields(usable.filter(f => f.type === 'quantitative'));
  const categories = preferVisualFields(usable.filter(f => ['nominal', 'ordinal'].includes(f.type)), 'color');
  const ordered = [...usable.filter(f => f.type === 'temporal'), ...q];
  const qc = choices(q), cc = choices(categories), oc = choices(ordered), ac = choices(usable);
  const pointChoices = choices([...q, ...usable.filter(f => f.type === 'temporal'), ...categories]);
  const first = qc[0]?.value, second = qc[1]?.value ?? first;
  const fields = new Map(usable.map(f => [f.name, f]));
  const pointGuides = v => {
    const axes = Object.fromEntries(['x', 'y'].filter(axis => fields.get(v[axis])?.guideValues).map(axis => [axis,
      { ticksAndLabels: { values: fields.get(v[axis]).guideValues,
        labels: { fontSize: 9, maxWidth: 48, wrap: 'word', overlap: 'allow' } } }]));
    return Object.keys(axes).length ? { guides: { axes } } : {};
  };
  const pos = name => ({ field: name, fieldType: fields.get(name)?.type ?? 'quantitative', ...(fields.get(name)?.order?.length ? { scale: { domain: fields.get(name).order } } : {}) });
  const cat = name => ({ field: name, fieldType: fields.get(name)?.type === 'ordinal' ? 'ordinal' : 'nominal', ...(fields.get(name)?.order?.length ? { scale: { domain: fields.get(name).order } } : {}) });
  const colored = value => value ? { color: value } : {};
  const definitions = [];
  const add = (method, controls, build, requirement = null) => {
    if (controls.length > 4 && method !== 'createRadarPlot') throw new Error('A starting chart exposes at most four controls.');
    definitions.push({ method, title: names[method][0], description: names[method][1],
      controls, requirement,
      build: values => ({ id: 'plot', data: profile.id,
        ...(['createStripPlot', 'createBeeswarmPlot', 'createRaincloudPlot', 'createDotPlot', 'createLollipopPlot', 'createDumbbellPlot'].includes(method) ? { missing: 'skip' } : {}), ...build(values) }) });
  };
  const xy = () => [select('x', 'X axis', qc, first), select('y', 'Y axis', qc, second)];
  const orderedXY = () => [select('x', 'X axis', oc), select('y', 'Y axis', qc, second)];
  const catMeasure = () => [select('category', 'Category', cc), select('value', 'Value', qc, second)];
  const needQ = q.length ? null : 'Needs a numerical column.';
  const needPair = q.length >= 2 ? null : 'Needs two numerical columns.';
  const needGroups = q.length && categories.length ? null : 'Needs a categorical and a numerical column.';
  const color = () => select('color', 'Color', optional(cc), '');
  const aggregate = () => select('aggregate', 'Aggregation', enums(['mean', 'median', 'sum', 'min', 'max']), 'mean');

  add('createScatterPlot', [select('x', 'X axis', pointChoices, first), select('y', 'Y axis', pointChoices, second),
    select('color', 'Color', optional(choices(preferVisualFields(usable, 'color'))), '')],
    v => ({ x: pos(v.x), y: pos(v.y), missing: 'skip', ...pointGuides(v),
      ...(v.color ? { color: { field: v.color, fieldType: fields.get(v.color).type } } : {}) }),
    usable.length >= 2 ? null : 'Needs two typed data columns.');
  add('createLinePlot', [...orderedXY(), color()], v => ({ x: pos(v.x),
    y: { ...pos(v.y), ...(fields.get(v.x)?.distinct < profile.rowCount ? { aggregate: 'mean' } : {}) },
    ...colored(v.color) }), needQ);
  add('createBarPlot', [...catMeasure(), aggregate()], v => ({ x: cat(v.category), missing: 'skip',
    y: { field: v.value, aggregate: v.aggregate } }), needGroups);
  add('createAreaPlot', [...orderedXY(), color()], v => ({ x: pos(v.x), y: v.y, ...colored(v.color) }), needQ);
  add('createHistogram', [select('field', 'Variable', qc), number('bins', 'Maximum bins', 10, 2, 40), color()],
    v => ({ field: v.field, maxBins: v.bins, ...colored(v.color) }), needQ);
  add('createHeatmap', [...xy(), number('bins', 'Bins per axis', 8, 2, 24)],
    v => ({ x: v.x, y: v.y, bin: { bins: v.bins }, color: { palette: 'blues' } }), needPair);
  add('createBoxPlot', [...catMeasure(), select('whisker', 'Whiskers', enums(['tukey', 'minmax']))],
    v => ({ x: cat(v.category), y: { field: v.value }, whisker: { type: v.whisker } }), needGroups);
  const bandwidth = () => select('bandwidth', 'Bandwidth', enums(['auto', '1', '5', '10', '20']), 'auto');
  const density = v => ({ bandwidth: v.bandwidth === 'auto' ? 'auto' : Number(v.bandwidth),
    ...(v.kernel ? { kernel: v.kernel } : {}), ...(v.normalization ? { normalization: v.normalization } : {}),
    ...(v.densitySide ? { side: v.densitySide } : {}) });
  add('createViolinPlot', [...catMeasure(), bandwidth()],
    v => ({ x: cat(v.category), y: { field: v.value, fieldType: 'quantitative' }, density: density(v) }), needGroups);
  add('createDensityPlot', [select('field', 'Variable', qc), select('group', 'Group', optional(cc), ''), bandwidth()],
    v => ({ field: v.field, ...(v.group ? { groupBy: v.group } : {}), ...density(v) }), needQ);
  add('createGradientPlot', [...catMeasure(), bandwidth()],
    v => ({ x: cat(v.category), y: { field: v.value }, density: density(v) }), needGroups);
  add('createRegressionPlot', [...xy(), select('method', 'Model', enums(['linear', 'polynomial', 'loess', 'exp']))],
    v => ({ x: v.x, y: v.y, method: v.method,
      ...(v.method === 'polynomial' && v.degree !== undefined ? { degree: v.degree } : {}),
      ...(v.method === 'loess' ? { span: v.span ?? .5, robustIterations: v.robustIterations ?? 0 } : {}),
      ...(['linear', 'polynomial'].includes(v.method) && v.interval !== undefined ? { interval: v.interval } : {}) }), needPair);
  add('createIntervalPlot', [...catMeasure(), number('level', 'Confidence level', 0.95, 0.5, 0.99, 0.01)],
    v => ({ x: cat(v.category), y: { field: v.value, center: 'mean', extent: 'ci', level: v.level } }), needGroups);
  for (const method of ['createDotPlot', 'createLollipopPlot']) {
    add(method, [...catMeasure(), aggregate()], v => ({ category: v.category, value: v.value, summary: v.aggregate,
      ...(method === 'createLollipopPlot' && v.baseline !== undefined ? { baseline: v.baseline } : {}) }), needGroups);
  }
  add('createDumbbellPlot', [select('category', 'Category', cc), select('start', 'Start', qc, first), select('end', 'End', qc, second)],
    v => ({ category: v.category, start: v.start, end: v.end, summary: 'mean' }), needGroups || needPair);
  add('createECDFPlot', [select('field', 'Variable', qc), select('group', 'Group', optional(cc), ''),
    select('weight', 'Weight', optional(qc), '')],
    v => ({ field: v.field, ...(v.group ? { groupBy: v.group, color: v.group } : {}), ...(v.weight ? { weight: v.weight } : {}) }), needQ);
  add('createStripPlot', [...catMeasure(), number('jitter', 'Jitter width', 0.2, 0, 0.45, 0.05)],
    v => ({ x: cat(v.category), y: v.value, jitter: v.jitter === 0 ? false : { maxOffset: { band: v.jitter }, seed: 7 } }), needGroups);
  add('createBeeswarmPlot', [...catMeasure(), number('radius', 'Point radius', 3, 1, 6, 0.5)],
    v => ({ x: cat(v.category), y: v.value, point: { radius: v.radius }, packing: { overflow: 'overlap' } }), needGroups);
  add('createRaincloudPlot', [...catMeasure(), select('side', 'Density side', enums(['before', 'after']))],
    v => ({ category: v.category, value: v.value, side: v.side,
      points: { type: 'strip', jitter: { maxOffset: { band: 0.15 }, seed: 7 }, point: { radius: 2, opacity: 0.5 } } }), needGroups);
  add('createRugPlot', [select('field', 'Variable', qc), select('edge', 'Edge', enums(['bottom', 'top', 'left', 'right'])),
    number('opacity', 'Opacity', 0.7, 0.1, 1, 0.1)], v => ({
      ...(['left', 'right'].includes(v.edge) ? { y: v.field } : { x: v.field }), edge: v.edge, tick: { opacity: v.opacity },
    }), needQ);
  for (const method of ['createPiePlot', 'createRosePlot', 'createRadialBarPlot']) {
    add(method, [select('category', 'Category', cc), select('value', 'Value', optional(qc), second ?? ''),
      select('aggregate', 'Aggregation', enums(['sum', 'count']), q.length ? 'sum' : 'count')],
      v => ({ category: v.category, aggregate: v.aggregate, ...(v.aggregate === 'sum' ? { value: v.value } : {}),
        ...(method === 'createRosePlot' ? { guides: { axes: { radius: { ticksAndLabels: { count: 3 } } } } } : {}) }),
      categories.length ? null : 'Needs a complete categorical column.');
  }
  for (const method of ['createPolarScatterPlot', 'createPolarLinePlot']) {
    add(method, [select('theta', 'Angle', qc, first), select('radius', 'Radius', qc, second), color()],
      v => ({ theta: v.theta, radius: v.radius, ...colored(v.color) }), needPair);
  }
  const dimensions = minimum => ({ key: 'dimensions', label: `Dimensions (at least ${minimum})`, type: 'multiselect',
    choices: qc, value: qc.slice(0, Math.max(minimum, 3)).map(c => c.value), minimum });
  // Observation identity and color are independent roles. A category can also
  // define one explicit summary profile; high-cardinality IDs never imply color.
  const radarGroups = usable.filter(f => ['nominal', 'ordinal'].includes(f.type) || f.distinct === profile.rowCount);
  const defaultGroup = categories.find(f => f.distinct > 1 && f.distinct <= 20) ?? radarGroups.find(f => f.distinct === profile.rowCount);
  const defaultColor = categories.find(f => f.distinct > 1 && f.distinct <= 20)?.name ?? '';
  const summaryChoices = [{ value: 'mean', label: 'Mean by group' }, { value: 'median', label: 'Median by group' },
    { value: false, label: 'Individual observations' }];
  add('createRadarPlot', [{ ...dimensions(3), ordered: true },
    select('group', 'Series / group', [{ value: '', label: 'All observations' }, ...choices(radarGroups)], defaultGroup?.name ?? ''),
    select('color', 'Color', optional(cc), defaultColor),
    { ...select('summary', 'Profile', summaryChoices, defaultGroup?.distinct === profile.rowCount ? false : 'mean'), defaultPolicy: 'context' },
    { ...select('normalize', 'Dimension scale', [{ value: false, label: 'Original values (shared units)' },
      { value: 'minmax', label: 'Normalize each dimension (0–1)' }], false), defaultPolicy: 'context' }],
    v => ({ wide: { fields: v.dimensions, summary: v.summary ?? false, normalize: v.normalize ?? false },
      ...(v.group ? { groupBy: v.group } : {}), ...(v.color ? { color: cat(v.color) } : {}), line: { strokeWidth: 1.5 },
      guides: { axes: { theta: { title: false }, radius: { title: false } } } }),
    q.length >= 3 ? null : 'Needs three numerical columns.');
  definitions.at(-1).resolveControls = values => [{ key: 'summary', choices: summaryChoices.map(choice => ({ ...choice,
    ...(choice.value === false && profile.rowCount > 1 && fields.get(values.group)?.distinct !== profile.rowCount ? {
      disabled: true, reason: 'Individual observations need a unique series identity. Choose a summary or a unique ID.' } : {}) })) }];
  const uniqueOrdered = ordered.filter(f => f.distinct === profile.rowCount);
  add('createHorizonPlot', [select('x', 'X axis', choices(uniqueOrdered)), select('y', 'Y axis', qc, second),
    number('bands', 'Bands', 3, 1, 6)], v => ({ x: pos(v.x), y: { field: v.y }, bands: v.bands }),
    q.length && uniqueOrdered.length ? null : 'Needs an ordered X column with one distinct value per row.');
  add('createParallelCoordinates', [dimensions(2), color(), number('opacity', 'Line opacity', 0.55, 0.1, 1, 0.05)],
    v => ({ dimensions: v.dimensions, ...colored(v.color), line: { opacity: v.opacity } }), needPair);
  add('createTextPlot', [...xy(), select('text', 'Text', ac, cc[0]?.value ?? first)],
    v => ({ x: pos(v.x), y: pos(v.y), text: { field: v.text }, style: { fontSize: 11 } }), needPair);
  return definitions;
}

export function defaultValues(definition) {
  return Object.fromEntries(definition.controls.map(control => [control.key, structuredClone(control.value)]));
}

// One color must identify an entire Radar series, never vary within its closed
// path. Validate the actual dependency rather than equating color with identity.
export function withRadarDataControls(definition, rows) {
  const colors = definition.controls.find(c => c.key === 'color')?.choices;
  if (definition.method !== 'createRadarPlot' || !colors) return definition;
  const cache = new Map();
  return { ...definition, resolveControls(values) {
    const key = JSON.stringify([values.group, values.dimensions]);
    if (!cache.has(key)) cache.set(key, colors.map(choice => {
      if (!choice.value) return choice;
      const seen = new Map(); let conflict = false;
      for (const row of rows) {
        if ((values.dimensions ?? []).some(field => row[field] == null) || row[choice.value] == null || values.group && row[values.group] == null) continue;
        const group = values.group ? row[values.group] : '';
        if (seen.has(group) && seen.get(group) !== row[choice.value]) { conflict = true; break; }
        seen.set(group, row[choice.value]);
      }
      return { ...choice, disabled: conflict, ...(conflict ? { reason: 'A profile needs one color. Choose a color constant within each series / group.' } : {}) };
    }));
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    const validRows = rows.filter(row => (values.dimensions ?? []).every(field => row[field] != null));
    const profiles = new Set(validRows.map(row => values.group ? row[values.group] : '')).size;
    return [...(definition.resolveControls?.(values) ?? []), { key: 'color', choices: cache.get(key) },
      { key: 'normalize', choices: definition.controls.find(c => c.key === 'normalize').choices.map(choice => ({ ...choice,
        ...(choice.value && profiles < 2 ? { disabled: true, reason: 'Per-dimension normalization needs at least two profiles to compare.' } : {}) })) }];
  } };
}
