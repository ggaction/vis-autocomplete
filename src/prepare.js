import { prepareAction } from './engine.js';
import { createLRU, signature, freezeResult } from './cache.js';
import { createProgramResultCache } from './program-cache.js';
import { facetSpacingCollision, fitFacetGap } from './facet-spacing.js';

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

function prepareUncached(program, action, view, setupCalls, repairs = {}) {
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
  if (['encodeX', 'encodeY', 'encodeHistogram'].includes(sourceAction.method)) {
    const layer = actionBase.semanticSpec.layers.find(l => l.id === sourceAction.args.target);
    const rows = actionBase.semanticSpec.datasets.find(d => d.id === layer?.data)?.values ?? [];
    if (layer && ['point', 'bar', 'rect', 'rule', 'tick', 'text'].includes(layer.mark.type) &&
        layer.mark.missing !== 'skip' && rows.some(row => row[sourceAction.args.field] == null)) {
      const method = `edit${layer.mark.type[0].toUpperCase()}${layer.mark.type.slice(1)}Mark`;
      const call = sourceCall(method, { target: layer.id, missing: 'skip' });
      actionBase = actionBase[call.method](call.args); prerequisiteCalls.push(call);
    }
  }
  if (['encodeX', 'encodeY'].includes(sourceAction.method)) {
    const layer = actionBase.semanticSpec.layers.find(l => l.id === sourceAction.args.target);
    const fit = actionBase.markConfigs[layer?.id]?.regression;
    if (fit && layer.derivedBindings?.regression?.mode !== 'follow' && fit.source === layer.data &&
        fit.x === layer.encoding.x?.field && fit.y === layer.encoding.y?.field) {
      // A fit of this same scatterplot follows its revised variable through the
      // native dependency contract. Keep the enabling call visible/replayable.
      const call = sourceCall('editRegression', { target: layer.id, sourceBinding: 'follow' });
      actionBase = actionBase[call.method](call.args); prerequisiteCalls.push(call);
    }
  }
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
    if (!repairs.sharedLegend && actionBase.compositionSpec?.facet &&
        /^(Shared facet legend requires|Facet child .*incompatible resolved legend scale)/.test(error.message)) {
      // A shared legend is a presentation policy, not a prerequisite for color
      // removal, independent scales, or another statistical layer. Preserve a
      // compatible explicit owner when possible; otherwise release the owner.
      const target = sourceAction.args.target ?? actionBase.semanticSpec.layers[0]?.id;
      let lastError = error;
      for (const legend of [{ target, channels: ['color'] }, false]) {
        try {
          const call = { method: 'editFacetGuides', args: { legend } };
          const base = actionBase.editFacetGuides(call.args);
          const result = prepareUncached(base, action, base, [], { ...repairs, sharedLegend: true });
          return { ...result, prerequisiteCalls: [...prerequisiteCalls, call, ...result.prerequisiteCalls] };
        } catch (failure) { lastError = failure; }
      }
      throw lastError;
    }
    if (facetSpacingCollision(error) && actionBase.compositionSpec?.spacing === 'plot') {
      // A later header/axis edit can need more room than the existing gap.
      // Keep that edit available, with an explicit native layout prerequisite
      // so preview, code, Apply and saved projects reproduce the same geometry.
      const fitted = fitFacetGap(gap => {
        const call = { method: 'editCompositionLayout', args: { gap } };
        const base = actionBase.editCompositionLayout(call.args);
        return { base, call, prepared: prepareFittedPlot(base, action, finish) };
      }, actionBase.compositionSpec.gap);
      prerequisiteCalls.push(fitted.call);
      return { ...fitted.prepared, actionBase: fitted.base, prerequisiteCalls };
    }
    const polar = error.message.match(/^(Theta|Radial) axis labels require sufficient/i)?.[1];
    if (polar) {
      if (sourceAction.method === 'editAxes' || new RegExp(`^edit${polar}Axis`).test(sourceAction.method)) {
        let lastError = error;
        for (const count of [4, 3, 2]) {
          const args = structuredClone(sourceAction.args);
          if (sourceAction.method === 'editAxes') {
            const channel = polar === 'Radial' ? 'radius' : 'theta';
            const fit = entry => ({ ...entry, ticksAndLabels: { ...entry?.ticksAndLabels, count } });
            args[channel] = Array.isArray(args[channel]) ? args[channel].map(fit) : fit(args[channel]);
          } else if (sourceAction.method.endsWith('Labels') || sourceAction.method.endsWith('TicksAndLabels')) args.count = count;
          else args.ticksAndLabels = { ...args.ticksAndLabels, count };
          const fitted = sourceCall(sourceAction.method, args);
          try { return { ...finish(prepareAction(actionBase, fitted)), actionBase, prerequisiteCalls }; }
          catch (failure) { lastError = failure; }
        }
        throw lastError;
      }
      const axis = polar === 'Radial' ? 'radius' : 'theta';
      const semantic = actionBase.semanticSpec.guides.axis?.[axis], config = actionBase.guideConfigs.axis?.[axis];
      if (!semantic || !config) throw error;
      const remove = sourceCall(`remove${polar}Axis`, {});
      actionBase = actionBase[remove.method](remove.args); prerequisiteCalls.push(remove);
      let lastError = error;
      for (const count of [4, 3, 2]) {
        try {
          prepared = prepareFittedPlot(actionBase, action, edited => {
            const args = fittedPolarAxisOptions(edited.preview, sourceAction.args.target, axis, semantic, config, count);
            const call = edited.preview.compositionSpec?.facet
              ? { method: 'editFacetSource', args: { action: { method: `create${polar}Axis`, options: args } } }
              : sourceCall(`create${polar}Axis`, args);
            return finish(edited, [call]);
          });
          break;
        } catch (failure) { lastError = failure; }
      }
      if (!prepared) throw lastError;
      return { ...prepared, actionBase, prerequisiteCalls };
    }
    const axis = error.message.match(/([xy])-axis (?:labels overlap|title (?:and.*overlap|overlaps))/i)?.[1]?.toLowerCase();
    const staleTicks = /Tick values must be inside the scale domain/.test(error.message);
    if (axis === 'x' && ['editGradientPlot', 'editViolinPlot', 'editBoxPlot'].includes(sourceAction.method)) {
      const call = sourceCall('editXAxisLabels', { rotation: { value: 90, unit: 'degrees' } });
      actionBase = actionBase[call.method](call.args);
      prerequisiteCalls.push(call);
      prepared = prepareFittedPlot(actionBase, action, finish);
      return { ...prepared, actionBase, prerequisiteCalls };
    }
    if (!axis && !staleTicks) throw error;
    const resources = Object.entries(actionBase.semanticSpec.guides.axis ?? {}).filter(([id, value]) =>
      staleTicks ? actionBase.guideConfigs.axis[id]?.ticks?.mode === 'values' : (value.channel ?? id) === axis);
    if (!resources.length) throw error;
    const configs = resources.map(([id, semantic]) => ({ id, semantic, config: actionBase.guideConfigs.axis[id] }));
    for (const { id, semantic } of configs) {
      const call = sourceCall((semantic.channel ?? id) === 'x' ? 'removeXAxis' : 'removeYAxis', { target: id });
      actionBase = actionBase[call.method](call.args); prerequisiteCalls.push(call);
    }
    const edited = prepareAction(actionBase, action);
    let lastError = error;
    for (const count of [6, 4, 3, 2]) {
      const calls = configs.map(saved => {
        const channel = saved.semantic.channel ?? saved.id;
        return sourceCall(channel === 'x' ? 'createXAxis' : 'createYAxis',
          fittedAxisOptions(edited.preview, sourceAction.args.target, channel, saved, count));
      });
      try { prepared = finish(edited, calls); break; } catch (error) { lastError = error; }
    }
    if (!prepared) throw lastError;
  }
  return { ...prepared, actionBase, prerequisiteCalls };
}

function fittedPolarAxisOptions(program, target, axis, semantic, config, count) {
  const pick = (object, names) => Object.fromEntries(names.filter(name => object?.[name] !== undefined).map(name => [name, structuredClone(object[name])]));
  const layer = program.semanticSpec.layers.find(layer => layer.id === target) ??
    program.semanticSpec.layers.find(layer => layer.coordinate === semantic.coordinate);
  const scale = layer?.encoding[axis]?.scale ?? semantic.scale;
  const domain = program.resolvedScales[scale]?.domain ?? [];
  const discrete = ['nominal', 'ordinal'].includes(layer?.encoding[axis]?.fieldType);
  const title = pick(config.title, ['text', 'offset', 'position', 'color', 'fontSize', 'fontFamily', 'fontWeight']);
  if (config.title?.inferredOffset) delete title.offset;
  if (config.title?.inferredText) delete title.text;
  else if (semantic.title !== undefined) title.text = semantic.title;
  return { scale, coordinate: semantic.coordinate, ...(axis === 'radius' ? { angle: config.layout?.angle ?? 90 } : {}),
    line: config.line ? pick(config.line, ['color', 'lineWidth']) : false,
    ticksAndLabels: config.labels || config.ticks ? {
      ...(discrete ? { values: domain.filter((_, index) => index % Math.ceil(domain.length / count) === 0) } : { count }),
      ticks: config.ticks ? pick(config.ticks, ['length', 'color', 'lineWidth']) : false,
      labels: config.labels ? pick(config.labels, ['offset', 'format', 'color', 'fontSize', 'fontFamily', 'fontWeight']) : false,
    } : false, title: config.title ? title : false };
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
  labels.rotation = axis === 'x' && discrete ? { value: 90, unit: 'degrees' } : { value: config.labels?.rotation ?? 0, unit: 'radians' };
  const title = pick(config.title, ['text', 'at', 'offset', 'color', 'fontSize', 'fontFamily', 'fontWeight', 'alongOffset', 'align', 'baseline']);
  if (config.title?.inferredOffset) delete title.offset;
  if (config.title?.inferredText) delete title.text;
  else if (semantic.title !== undefined) title.text = semantic.title;
  if (!config.title?.inferredRotation) title.rotation = { value: config.title?.rotation ?? 0, unit: 'radians' };
  return { id, scale, coordinate: semantic.coordinate, position: config.line?.position ?? config.labels?.position,
    ...(config.frame?.offset !== undefined ? { offset: config.frame.offset } : {}),
    line: config.line ? pick(config.line, ['color', 'lineWidth']) : false,
    ticksAndLabels: config.labels || config.ticks ? { ...(discrete ? { values: domain.filter((_, index) => index % Math.ceil(domain.length / count) === 0) }
      : count <= 2 && domain.length === 2 ? { values: [...new Set(domain)] } : { count }),
      ticks: config.ticks ? pick(config.ticks, ['length', 'color', 'lineWidth', 'alongOffset', 'strokeDash', 'strokeDashMap']) : false,
      labels: config.labels ? labels : false } : false, title: config.title ? title : false };
}

// Let native text measurement validate the actual labels first. Only a failed
// initial plot is retried, with explicit guide options recorded in its one call.
// No render sweep, hidden guide mutation, label removal, or overlap allowance.
function prepareFittedPlot(program, action, finish = value => value) {
  if (['facet', 'facetGrid', 'repeatCharts', 'editCompositionLayout'].includes(action.method) &&
      (action.args.spacing ?? program.compositionSpec?.spacing) === 'plot') {
    return fitFacetGap(gap => finish(prepareAction(program, { ...action, args: { ...action.args, gap } })),
      action.args.gap ?? program.compositionSpec?.gap ?? 16);
  }
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
  if (!/^create.*(?:Plot|Histogram|Heatmap|ParallelCoordinates)$/.test(action.method)) return finish(prepareAction(program, action));
  let lastError;
  try { return finish(prepareAction(program, action)); } catch (error) { lastError = error; }
  if (!/label|text|overlap|Canvas space/i.test(lastError.message)) throw lastError;
  const data = program.semanticSpec.datasets.find(d => d.id === action.args.data) ??
    (program.semanticSpec.datasets.length === 1 ? program.semanticSpec.datasets[0] : undefined);
  const rows = data?.values ?? [];
  for (const count of [6, 4, 3]) {
    const args = structuredClone(action.args);
    if (args.guides === false) throw lastError;
    args.guides = { ...args.guides, axes: { ...args.guides?.axes } };
    const bindings = { x: args.x, y: args.y };
    if (action.method === 'createHistogram') {
      bindings.x = { field: args.field, fieldType: 'quantitative' };
      bindings.y = { field: args.field, fieldType: 'quantitative' };
    }
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
