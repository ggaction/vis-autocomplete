// Shared taxonomy: both corpus source and live ChartPrograms use these tokens.
// Keep field names and resource IDs out of the learned vocabulary.
export const CHANNELS = ['x', 'y', 'x2', 'y2', 'color', 'size', 'shape', 'opacity',
  'stroke', 'strokeWidth', 'strokeDash', 'theta', 'r', 'text', 'xOffset', 'yOffset', 'group', 'angle', 'pathOrder', 'parallel'];

export const MARK_ACTIONS = {
  createPointMark: 'point', createLineMark: 'line', createBarMark: 'bar',
  createAreaMark: 'area', createRectMark: 'rect', createArcMark: 'arc',
  createRuleMark: 'rule', createTextMark: 'text', createTickMark: 'tick',
};

export const PLOT_MARKS = {
  createScatterPlot: 'point', createLinePlot: 'line', createBarPlot: 'bar',
  createAreaPlot: 'area', createHistogram: 'bar', createHeatmap: 'rect',
  createViolinPlot: 'area', createBoxPlot: 'bar', createDensityPlot: 'area',
  createGradientPlot: 'rect', createRegressionPlot: 'point', createIntervalPlot: 'point',
  createDotPlot: 'point', createLollipopPlot: 'point', createDumbbellPlot: 'point',
  createECDFPlot: 'line', createStripPlot: 'point', createBeeswarmPlot: 'point',
  createRaincloudPlot: 'area', createRugPlot: 'tick', createPiePlot: 'arc',
  createRosePlot: 'arc', createRadialBarPlot: 'arc', createPolarScatterPlot: 'point',
  createPolarLinePlot: 'line', createRadarPlot: 'line', createHorizonPlot: 'area',
  createParallelCoordinates: 'line', createTextPlot: 'text',
};

export function datasetFeature(type) { return `data.${type}`; }

// Public encodeR uses r, while semantic state stores radius. Glyph radius is
// instead point size. One vocabulary must own training, state and used-action checks.
export const canonicalChannel = channel => channel === 'radius' ? 'r' : channel;
export const encodingChannel = method => ['encodeRadius', 'encodePointRadius'].includes(method) ? 'size'
  : method === 'encodeParallelCoordinates' ? 'parallel'
  : method.startsWith('encode') ? canonicalChannel(method.slice(6, 7).toLowerCase() + method.slice(7)) : undefined;
export function encodingFeature(channel) { return `encoding.${canonicalChannel(channel)}`; }

export function actionFeatures(action, options = {}) {
  if (MARK_ACTIONS[action]) return [`mark.${MARK_ACTIONS[action]}`,
    ...(options.opacity !== undefined ? [`style.${MARK_ACTIONS[action]}.opacity`] : [])];
  if (PLOT_MARKS[action]) {
    const features = [`mark.${PLOT_MARKS[action]}`];
    for (const channel of CHANNELS) {
      if (options[channel] !== undefined && options[channel] !== false) features.push(encodingFeature(channel));
    }
    if (options.radius !== undefined) features.push('encoding.r');
    if (['createPiePlot', 'createRosePlot', 'createRadialBarPlot'].includes(action)) {
      features.push('encoding.theta', 'transform.aggregate');
      if (action !== 'createPiePlot') features.push('encoding.r');
      if (options.color !== false) features.push('encoding.color');
    }
    if (action === 'createParallelCoordinates') features.push('encoding.parallel');
    if (action === 'createHistogram') features.push('transform.bin', 'encoding.x', 'encoding.y');
    if (action === 'createHeatmap') features.push('encoding.x', 'encoding.y', 'encoding.color');
    if (options.guides !== false) {
      features.push('guide.axis');
      if (options.color || options.size || options.shape) features.push('guide.legend');
    }
    for (const channel of ['x', 'y']) {
      if (options[channel]?.aggregate) features.push('transform.aggregate');
      if (options[channel]?.bin) features.push('transform.bin');
    }
    return features;
  }
  if (action.startsWith('encode')) {
    if (action === 'encodeChannels') return [...new Set(Object.entries(options).flatMap(([channel, args]) => CHANNELS.includes(canonicalChannel(channel)) ? actionFeatures(`encode${canonicalChannel(channel)[0].toUpperCase()}${canonicalChannel(channel).slice(1)}`, args ?? {}) : []))];
    const channel = encodingChannel(action);
    if (CHANNELS.includes(channel)) {
      const features = [encodingFeature(channel)];
      if (options.aggregate) features.push('transform.aggregate');
      if (options.bin) features.push('transform.bin');
      return features;
    }
  }
  if (action === 'createRegression' || action === 'createRegressionData') return ['transform.regression'];
  if (action === 'createAxes' || /^create(?:[XY]|Theta|Radial|Parallel)Axis/.test(action)) return ['guide.axis'];
  if (action === 'createLegend') return ['guide.legend'];
  if (action === 'createGrid') return ['guide.grid'];
  if (action === 'createGuides') {
    return [options.axes !== false && 'guide.axis', options.legend !== false && 'guide.legend',
      options.grid !== false && 'guide.grid'].filter(Boolean);
  }
  // Existing channel-edit programs supply evidence for the aggregate axis-edit family.
  if (/^edit(?:Axes|[XY]Axis|ThetaAxis|RadialAxis|ParallelAxis)$/.test(action)) {
    return [...new Set([`action.${action}`, 'action.editAxes'])];
  }
  if (action === 'createTitle') return ['guide.title'];
  if (action === 'editTitle') return ['guide.title', 'action.editTitle'];
  const editedMark = action.match(/^edit(Point|Bar|Line|Area|Rect|Arc|Rule|Text|Tick)Mark$/)?.[1]?.toLowerCase();
  if (editedMark && options.opacity !== undefined) return [`style.${editedMark}.opacity`];
  if (action === 'orderCategories') return ['action.orderCategories'];
  if (['createBinData', 'encodeHistogram'].includes(action)) return ['transform.bin'];
  if (action === 'createSummaryData') return ['transform.aggregate'];
  if (['filterData', 'filterMarks'].includes(action)) return ['transform.filter'];
  // Retain other design operations in the corpus instead of silently discarding them.
  if (/^(create|edit|encode|facet|jitter|pack|filter|layout|order|apply|remove|bind|revise|repeat)/.test(action) &&
      !['createCanvas', 'createData', 'createDerivedData', 'editSemantic', 'createGraphics', 'editGraphics'].includes(action)) return [`action.${action}`];
  return [];
}

function walkValues(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') walkValues(child, visit);
}

export function extractFeatures(program, { target, data, datasetType = 'tabular' } = {}) {
  const features = new Set([datasetFeature(datasetType)]);
  const fixedEncodings = new Map();
  for (const entry of program.trace.children) {
    // Facet source edits preserve the same learned design primitive as their
    // unit action; the public source wrapper must not change paper-model input.
    const node = entry.op === 'editFacetSource' && entry.args.action
      ? { op: entry.args.action.method, args: entry.args.action.options ?? {} } : entry;
    const otherMark = target && node.args.target && program.semanticSpec.layers.some(l => l.id === node.args.target) && node.args.target !== target;
    const channel = encodingChannel(node.op);
    const owner = node.args.target ?? target ?? '*';
    if (channel && CHANNELS.includes(channel)) {
      if (!otherMark) {
        const key = `${owner}:${channel}`;
        if (Object.hasOwn(node.args, 'value') || Object.hasOwn(node.args, 'valueCount')) fixedEncodings.set(key, channel);
        else fixedEncodings.delete(key);
      }
      continue;
    }
    if (node.op === 'removeEncoding' && !otherMark) fixedEncodings.delete(`${owner}:${canonicalChannel(node.args.channel)}`);
    if (/^(edit|encode|filterMarks|order|layout|jitter|pack|apply|remove|bind|revise|repeat)/.test(node.op) &&
      !(target && node.args.target && program.semanticSpec.layers.some(l => l.id === node.args.target) && node.args.target !== target)) {
        for (const feature of actionFeatures(node.op, node.args)) features.add(feature);
      }
  }
  for (const channel of fixedEncodings.values()) features.add(encodingFeature(channel));
  const configs = program.materializationConfigs.marks;
  const layers = program.semanticSpec.layers.filter(layer => !target || layer.id === target);
  const datasets = new Map(program.semanticSpec.datasets.map(dataset => [dataset.id, dataset]));
  const dataIds = new Set(data ? [data] : layers.map(layer => layer.data).filter(Boolean));
  for (const id of dataIds) {
    let dataset = datasets.get(id);
    const visited = new Set();
    while (dataset && !visited.has(dataset.id)) {
      visited.add(dataset.id);
      for (const transform of dataset.transform ?? []) {
        if (transform.type === 'computed') features.add('action.createComputedData');
        if (['summary', 'aggregate'].includes(transform.type)) features.add('transform.aggregate');
        if (transform.type === 'bin') features.add('transform.bin');
        if (transform.type === 'filter') features.add('transform.filter');
        if (transform.type === 'regression') features.add('transform.regression');
      }
      dataset = datasets.get(dataset.source);
    }
  }
  for (const layer of layers) {
    if (layer.mark?.type) features.add(`mark.${layer.mark.type}`);
    for (const [channel, encoding] of Object.entries(layer.encoding ?? {})) {
      features.add(encodingFeature(channel));
      if (encoding.aggregate) features.add('transform.aggregate');
      if (encoding.bin) features.add('transform.bin');
      if (encoding.categoryOrder) features.add('action.orderCategories');
    }
    const config = configs[layer.id];
    if (config?.regression) features.add('transform.regression');
    if (Object.values(configs).some(child => child.statisticalReference?.source === layer.id)) features.add('action.createStatisticalReference');
    const opacity = config?.opacity ?? config?.barAppearance?.opacity;
    if (layer.mark?.type && opacity !== undefined) features.add(`style.${layer.mark.type}.opacity`);
    if (program.semanticSpec.layers.some(child => child.source === layer.id && child.mark?.type === 'text' &&
      configs[child.id]?.labelAuthoring)) features.add('action.createMarkLabels');
  }
  const layerCoordinates = new Set(layers.map(l => l.coordinate).filter(Boolean));
  const layerScales = new Set(layers.flatMap(l => Object.values(l.encoding ?? {}).map(e => e.scale)));
  walkValues(program.semanticSpec.guides.axis, axis => {
    if (axis.scale && (!target || layerCoordinates.has(axis.coordinate))) features.add('guide.axis');
  });
  walkValues(program.semanticSpec.guides.legend, legend => {
    const scales = [legend.scale, ...(Array.isArray(legend.scales) ? legend.scales : [])].filter(Boolean);
    if (scales.some(scale => !target || layerScales.has(scale))) features.add('guide.legend');
  });
  if (program.semanticSpec.title.text) features.add('guide.title');
  if (program.semanticSpec.guides.grid) features.add('guide.grid');
  return [...features].sort();
}
