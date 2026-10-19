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
        labels: { fontFamily: 'Arial', fontSize: 9, maxWidth: 48, wrap: 'word', overlap: 'allow' } } }]));
    return Object.keys(axes).length ? { guides: { axes } } : {};
  };
  const pos = name => ({ field: name, fieldType: fields.get(name)?.type ?? 'quantitative' });
  const cat = name => ({ field: name, fieldType: fields.get(name)?.type === 'ordinal' ? 'ordinal' : 'nominal' });
  const colored = value => value ? { color: value } : {};
  const definitions = [];
  const add = (method, controls, build, requirement = null) => {
    if (controls.length > 3) throw new Error('A starting chart exposes at most three controls.');
    definitions.push({ method, title: names[method][0], description: names[method][1],
      controls, requirement,
      build: values => ({ id: 'plot', data: profile.id, ...build(values) }) });
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
  const density = v => ({ bandwidth: v.bandwidth === 'auto' ? 'auto' : Number(v.bandwidth) });
  add('createViolinPlot', [...catMeasure(), bandwidth()],
    v => ({ x: cat(v.category), y: { field: v.value, fieldType: 'quantitative' }, density: density(v) }), needGroups);
  add('createDensityPlot', [select('field', 'Variable', qc), select('group', 'Group', optional(cc), ''), bandwidth()],
    v => ({ field: v.field, ...(v.group ? { groupBy: v.group } : {}), ...density(v) }), needQ);
  add('createGradientPlot', [...catMeasure(), bandwidth()],
    v => ({ x: cat(v.category), y: { field: v.value }, density: density(v) }), needGroups);
  add('createRegressionPlot', [...xy(), select('method', 'Model', enums(['linear', 'polynomial', 'loess', 'exp']))],
    v => ({ x: v.x, y: v.y, method: v.method }), needPair);
  add('createIntervalPlot', [...catMeasure(), number('level', 'Confidence level', 0.95, 0.5, 0.99, 0.01)],
    v => ({ x: cat(v.category), y: { field: v.value, center: 'mean', extent: 'ci', level: v.level } }), needGroups);
  for (const method of ['createDotPlot', 'createLollipopPlot']) {
    add(method, [...catMeasure(), aggregate()], v => ({ category: v.category, value: v.value, summary: v.aggregate }), needGroups);
  }
  add('createDumbbellPlot', [select('category', 'Category', cc), select('start', 'Start', qc, first), select('end', 'End', qc, second)],
    v => ({ category: v.category, start: v.start, end: v.end, summary: 'mean' }), needGroups || needPair);
  add('createECDFPlot', [select('field', 'Variable', qc), select('group', 'Group', optional(cc), ''),
    number('width', 'Line width', 2, 0.5, 5, 0.5)],
    v => ({ field: v.field, ...(v.group ? { groupBy: v.group, color: v.group } : {}), line: { strokeWidth: v.width } }), needQ);
  add('createStripPlot', [...catMeasure(), number('jitter', 'Jitter width', 0.2, 0, 0.45, 0.05)],
    v => ({ x: cat(v.category), y: v.value, jitter: { maxOffset: { band: v.jitter }, seed: 7 } }), needGroups);
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
  const identities = choices(usable.filter(f => f.distinct === profile.rowCount));
  add('createRadarPlot', [dimensions(3), select('group', 'Series identity', identities), number('width', 'Line width', 1.5, 0.5, 4, 0.5)],
    v => ({ wide: { fields: v.dimensions }, groupBy: v.group,
      color: { field: v.group, fieldType: 'nominal' }, line: { strokeWidth: v.width } }),
    q.length >= 3 && identities.length ? null : 'Needs three numerical columns and a unique series identity.');
  const uniqueOrdered = ordered.filter(f => f.distinct === profile.rowCount);
  add('createHorizonPlot', [select('x', 'X axis', choices(uniqueOrdered)), select('y', 'Y axis', qc, second),
    number('bands', 'Bands', 3, 1, 6)], v => ({ x: pos(v.x), y: { field: v.y }, bands: v.bands }),
    q.length && uniqueOrdered.length ? null : 'Needs an ordered X column with one distinct value per row.');
  add('createParallelCoordinates', [dimensions(2), color(), number('opacity', 'Line opacity', 0.55, 0.1, 1, 0.05)],
    v => ({ dimensions: v.dimensions, ...colored(v.color), line: { opacity: v.opacity } }), needPair);
  add('createTextPlot', [...xy(), select('text', 'Text', ac, cc[0]?.value ?? first)],
    v => ({ x: pos(v.x), y: pos(v.y), text: { field: v.text }, style: { fontFamily: 'Arial', fontSize: 11 } }), needPair);
  return definitions;
}

export function defaultValues(definition) {
  return Object.fromEntries(definition.controls.map(control => [control.key, structuredClone(control.value)]));
}
