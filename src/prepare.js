import { prepareAction } from './engine.js';
import { createLRU, signature, freezeResult } from './cache.js';
import { createProgramResultCache } from './program-cache.js';

const preparations = new WeakMap();
const recentPreparations = createLRU(12, program => preparations.delete(program));

const displayedGuideCalls = new WeakMap();

export function defaultCanvasOptions() {
  // Exact square data region; native guide layout grows only needed margins.
  // Initial outer size remains 700 × 430.
  return { plot: { width: 314, height: 314 },
    margin: { left: 170, right: 216, top: 42, bottom: 74 } };
}

// Default plot setup is explicit in the code/trace, separate from a recommendation.
function defaultGuideCall(program) {
  const args = {};
  const coveredScales = new Set();
  const collectScales = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/scale$/i.test(key) && typeof child === 'string') coveredScales.add(child);
      else if (/scales$/i.test(key) && Array.isArray(child)) child.forEach(scale => coveredScales.add(scale));
      else collectScales(child);
    }
  };
  collectScales(program.semanticSpec.guides.legend);
  const root = program.semanticSpec.layers.find(layer => layer.id === 'plot') ?? program.semanticSpec.layers[0];
  if (program.markConfigs[root?.id]?.compositionRole === 'pie') { args.axes = false; args.grid = false; }
  const channels = ['color', 'size', 'shape', 'stroke', 'strokeWidth', 'strokeDash',
    ...(['point', 'line', 'bar', 'rect'].includes(root?.mark?.type) ? ['opacity'] : [])];
  const missingChannels = root ? channels.filter(channel => root.encoding?.[channel]?.scale &&
    !coveredScales.has(root.encoding[channel].scale)) : [];
  // Select every uncovered channel explicitly. Inference alone can omit a
  // categorical point color or mistake independent channels for one legend.
  if (missingChannels.length) {
    args.legend = { target: root.id, channels: missingChannels };
    if (['size', 'opacity', 'strokeWidth'].some(channel => missingChannels.includes(channel))) args.legend.count = 3;
    const domain = program.resolvedScales[root.encoding.color?.scale]?.domain;
    if (['nominal', 'ordinal'].includes(root.encoding.color?.fieldType) && domain?.length > 12) {
      // Use native legend overflow for many categories; keep every data row.
      Object.assign(args.legend, { position: 'top-right', overflow: { maxItems: 6, summary: 'ellipsis-count' } });
    }
  }
  return { method: 'createGuides', args };
}

export function addDefaultGuides(program, call = defaultGuideCall(program)) {
  const next = program.createGuides(call.args);
  const before = program.trace.children, after = next.trace.children;
  if (after.length !== before.length + 1 || after.at(-1).op !== 'createGuides' ||
      before.some((node, index) => node.id !== after[index].id)) {
    throw new Error('Expected one default createGuides setup call.');
  }
  displayedGuideCalls.set(next, structuredClone(call));
  return next;
}

export function prepareStartingPlot(program, action) {
  return prepareGuidedAction(program, action);
}

export function prepareGuidedAction(program, action, view = program, setupCalls = []) {
  recentPreparations.set(program, true);
  if (!preparations.has(program)) preparations.set(program, new WeakMap());
  const views = preparations.get(program);
  if (!views.has(view)) views.set(view, createProgramResultCache());
  const cache = views.get(view), key = signature([action, setupCalls]);
  const cached = cache.get(key);
  if (cached) return cached;
  const prepared = prepareUncached(program, action, view, setupCalls);
  cache.set(key, freezeResult(prepared));
  return prepared;
}

function prepareUncached(program, action, view, setupCalls) {
  let actionBase = program;
  const prerequisiteCalls = [];
  for (const setup of setupCalls) {
    // Explicit native data preparation, replayed in the code view and on Apply.
    // The recommendation below still executes exactly one public chart method.
    if (!['createBinData', 'createComputedData', 'createSummaryData', 'createTimeUnitData', 'createCompleteData', 'filterData'].includes(setup.method)) {
      throw new Error(`Unsupported plot setup: ${setup.method}`);
    }
    const call = structuredClone(setup);
    actionBase = actionBase[call.method](call.args);
    prerequisiteCalls.push(call);
  }
  const sourceAction = action.method === 'editFacetSource' ? { method: action.args.action.method, args: action.args.action.options } : action;
  const sourceCall = (method, args) => action.method === 'editFacetSource'
    ? { method: 'editFacetSource', args: { action: { method, options: args } } } : { method, args };
  const family = /^editLegend/.test(sourceAction.method) ? 'legend' : /^edit(?:Grid|HorizontalGrid|VerticalGrid)$/.test(sourceAction.method) ? 'grid'
    : /^edit(?:Axes|[XY]Axis|ThetaAxis|RadialAxis|ParallelAxis)/.test(sourceAction.method) ? 'axis' : null;
  if (family) {
    const createMethod = { legend: 'createLegend', grid: 'createGrid', axis: 'createAxes' }[family];
    const last = view.trace.children.at(-1);
    // The displayed suffix may own a guide absent from the authoring prefix.
    // Promote the native creation call into visible setup before editing;
    // the recommendation itself still executes exactly one public edit method.
    const missing = Object.keys(view.semanticSpec.guides[family] ?? {})
      .some(key => !program.semanticSpec.guides[family]?.[key]);
    if (missing && last?.op === 'createGuides') {
      const children = nodes => nodes.flatMap(node => [node, ...children(node.children ?? [])]);
      if (children(last.children).some(node => node.op === createMethod)) {
        const suffix = displayedGuideCalls.get(view);
        const option = { axis: 'axes', grid: 'grid', legend: 'legend' }[family];
        const call = sourceCall(createMethod, structuredClone(suffix?.args[option] ?? {}));
        // Trace arguments summarize arrays as counts and cannot be replayed.
        // Keep the actual public suffix options rather than reading node.args.
        actionBase = actionBase[call.method](call.args);
        prerequisiteCalls.push(call);
      }
    }
  }
  if (sourceAction.method === 'editGrid') {
    // Automatic guides can omit a categorical direction. Keep creation explicit
    // in setup/code, then execute the recommendation as one native editGrid call.
    const missing = Object.keys(sourceAction.args).filter(direction =>
      !actionBase.semanticSpec.guides.grid?.[direction]);
    if (missing.length) {
      // createGrid otherwise defaults an omitted horizontal direction to true.
      const call = sourceCall('createGrid', { horizontal: false, vertical: false,
        ...Object.fromEntries(missing.map(direction => [direction, {}])) });
      actionBase = actionBase[call.method](call.args);
      prerequisiteCalls.push(call);
    }
  }
  const finish = (prepared, guideSetup = []) => {
    let authoringPreview = prepared.preview;
    const postActionCalls = [];
    for (const call of guideSetup) {
      authoringPreview = authoringPreview[call.method](call.args);
      postActionCalls.push(call);
    }
    // The same series can gain another visual channel. Updating the existing
    // legend is explicit native setup, so its symbols represent both mappings.
    for (const legend of Object.values(authoringPreview.guideConfigs.legend ?? {})) {
      if (legend.kind !== 'series') continue;
      const layer = authoringPreview.semanticSpec.layers.find(layer => layer.id === legend.target);
      const channels = [...new Set([...(legend.channels ?? []), ...['color', 'strokeDash'].filter(channel =>
        layer?.encoding[channel]?.field === legend.field && layer.encoding[channel].scale)])];
      if (channels.length === legend.channels?.length) continue;
      const call = { method: 'editLegend', args: { target: legend.target, channels } };
      authoringPreview = authoringPreview.editLegend(call.args);
      postActionCalls.push(call);
    }
    const call = defaultGuideCall(authoringPreview);
    return { ...prepared, authoringPreview, postActionCalls, preview: addDefaultGuides(authoringPreview, call), guideCall: call };
  };
  let prepared;
  try { prepared = prepareFittedPlot(actionBase, action, finish); } catch (error) {
    const axis = error.message.match(/([xy])-axis labels overlap/i)?.[1]?.toLowerCase();
    if (!axis || !['encodeX', 'encodeY', 'editXScale', 'editYScale'].includes(sourceAction.method)) throw error;
    const resources = Object.entries(actionBase.semanticSpec.guides.axis ?? {}).filter(([id, value]) => (value.channel ?? id) === axis);
    if (!resources.length) throw error;
    const configs = resources.map(([id, semantic]) => ({ id, semantic, config: actionBase.guideConfigs.axis[id] }));
    for (const { id } of configs) {
      const call = sourceCall(axis === 'x' ? 'removeXAxis' : 'removeYAxis', { target: id });
      actionBase = actionBase[call.method](call.args); prerequisiteCalls.push(call);
    }
    const edited = prepareAction(actionBase, action);
    let lastError = error;
    for (const count of [6, 4, 3]) {
      const calls = configs.map(saved => sourceCall(axis === 'x' ? 'createXAxis' : 'createYAxis',
        fittedAxisOptions(edited.preview, sourceAction.args.target, axis, saved, count)));
      try { prepared = finish(edited, calls); break; } catch (error) { lastError = error; }
    }
    if (!prepared) throw lastError;
  }
  return { ...prepared, actionBase, prerequisiteCalls };
}

// Recreate an automatically fitted axis through public options only. Authored
// style/title is retained; inferred titles follow the new field. Explicit setup
// calls are returned so code, Apply, and persistence replay the same ordering.
function fittedAxisOptions(program, target, axis, { id, semantic, config }, count) {
  const pick = (object, names) => Object.fromEntries(names.filter(name => object?.[name] !== undefined).map(name => [name, structuredClone(object[name])]));
  const layer = program.semanticSpec.layers.find(layer => layer.id === target) ?? program.semanticSpec.layers.find(layer => layer.coordinate === semantic.coordinate);
  const scale = layer?.encoding[axis]?.scale ?? semantic.scale;
  const domain = program.resolvedScales[scale]?.domain ?? [];
  const discrete = ['nominal', 'ordinal'].includes(layer?.encoding[axis]?.fieldType);
  const labels = pick(config.labels, ['offset', 'format', 'color', 'fontSize', 'fontFamily', 'fontWeight', 'maxWidth', 'wrap', 'lineHeight', 'alongOffset', 'labelMap', 'flush', 'colorMap', 'align']);
  labels.rotation = axis === 'x' ? { value: 90, unit: 'degrees' } : { value: config.labels?.rotation ?? 0, unit: 'radians' };
  const title = pick(config.title, ['text', 'at', 'offset', 'color', 'fontSize', 'fontFamily', 'fontWeight', 'alongOffset', 'align', 'baseline']);
  if (config.title?.inferredText) delete title.text;
  else if (semantic.title !== undefined) title.text = semantic.title;
  if (!config.title?.inferredRotation) title.rotation = { value: config.title?.rotation ?? 0, unit: 'radians' };
  return { id, scale, coordinate: semantic.coordinate, position: config.line?.position ?? config.labels?.position,
    ...(config.frame?.offset !== undefined ? { offset: config.frame.offset } : {}),
    line: config.line ? pick(config.line, ['color', 'lineWidth']) : false,
    ticksAndLabels: config.labels || config.ticks ? { ...(discrete ? { values: domain.filter((_, index) => index % Math.ceil(domain.length / count) === 0) } : { count }),
      ticks: config.ticks ? pick(config.ticks, ['length', 'color', 'lineWidth', 'alongOffset', 'strokeDash', 'strokeDashMap']) : false,
      labels: config.labels ? labels : false } : false, title: config.title ? title : false };
}

// Let native text measurement validate the actual labels first. Only a failed
// initial plot is retried, with explicit guide options recorded in its one call.
// No render sweep, hidden guide mutation, label removal, or overlap allowance.
function prepareFittedPlot(program, action, finish = value => value) {
  if (['editAxes', 'editXAxis', 'editXAxisTicksAndLabels', 'editXAxisLabels'].includes(action.method)) {
    try { return finish(prepareAction(program, action)); } catch (error) {
      if (!/x-axis labels overlap/i.test(error.message)) throw error;
      const args = structuredClone(action.args);
      const rotate = entry => ({ ...entry, ...(entry.ticksAndLabels ? { ticksAndLabels: { ...entry.ticksAndLabels, labels: { ...entry.ticksAndLabels.labels, rotation: { value: 90, unit: 'degrees' } } } } : { labels: { ...entry.labels, rotation: { value: 90, unit: 'degrees' } } }) });
      if (action.method === 'editAxes') args.x = Array.isArray(args.x) ? args.x.map(rotate) : rotate(args.x);
      else if (action.method === 'editXAxisLabels') args.rotation = { value: 90, unit: 'degrees' };
      else Object.assign(args, rotate(args));
      return finish(prepareAction(program, { ...action, args }));
    }
  }
  if (!/^create.*(?:Plot|Heatmap|ParallelCoordinates)$/.test(action.method)) return finish(prepareAction(program, action));
  let lastError;
  try { return finish(prepareAction(program, action)); } catch (error) { lastError = error; }
  if (!/label|text|overlap|Canvas space/i.test(lastError.message)) throw lastError;
  const rows = program.semanticSpec.datasets.find(d => d.id === action.args.data)?.values ?? [];
  for (const count of [6, 4, 3]) {
    const args = structuredClone(action.args);
    if (args.guides === false) throw lastError;
    args.guides = { ...args.guides, axes: { ...args.guides?.axes } };
    const bindings = { x: args.x, y: args.y };
    if (['createDotPlot', 'createLollipopPlot', 'createDumbbellPlot', 'createRaincloudPlot'].includes(action.method)) {
      bindings[args.orientation === 'horizontal' ? 'y' : 'x'] = { field: args.category, fieldType: 'nominal' };
      bindings[args.orientation === 'horizontal' ? 'x' : 'y'] = { field: args.value ?? args.start, fieldType: 'quantitative' };
    }
    if (['createPolarScatterPlot', 'createPolarLinePlot', 'createRosePlot', 'createRadialBarPlot'].includes(action.method)) {
      bindings.theta = args.theta ?? { field: args.category, fieldType: 'nominal' };
      bindings.radius = args.radius ?? args.value ?? { field: '__count' };
    }
    for (const axis of Object.keys(bindings)) {
      const binding = bindings[axis];
      if (!binding || action.method === 'createHorizonPlot' && axis === 'y') continue;
      const field = typeof binding === 'string' ? binding : binding.field;
      const domain = [...new Set(rows.map(row => row[field]).filter(value => value != null))];
      const discrete = ['nominal', 'ordinal'].includes(binding.fieldType);
      const previous = args.guides.axes[axis] ?? {};
      const ticks = previous.ticksAndLabels ?? {};
      const values = discrete ? domain.filter((_, i) => i % Math.ceil(domain.length / count) === 0) : undefined;
      args.guides.axes[axis] = { ...previous, ticksAndLabels: { ...ticks,
        ...(discrete ? { values } : { count }),
        labels: { ...ticks.labels, fontFamily: 'Arial', fontSize: 9,
          ...(['theta', 'radius'].includes(axis) ? {} : discrete && axis === 'x' ? { rotation: { value: 90, unit: 'degrees' }, maxWidth: 120, wrap: 'word' } : { maxWidth: 120, wrap: 'word' }) } } };
    }
    try { return finish(prepareAction(program, { ...action, args })); } catch (error) {
      lastError = error; if (!/label|text|overlap|Canvas space/i.test(error.message)) throw error;
    }
  }
  throw lastError;
}
