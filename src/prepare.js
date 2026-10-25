import { sharedLegendEdit } from './shared-legend-editing.js';
import { chartViews, chartAtPath, scopedCall, nativeActionTargets } from './composition-context.js';
import { centerCanvasContent, compactAdjacentCanvases } from './canvas-centering.js';
import { canvasGeometry } from './canvas-geometry.js';
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
  if (program.compositionSpec && !program.compositionSpec.facet) {
    return { method: 'createGuides', args: { target: chartViews(program).map(({ childPath }) => ({ childPath })) } };
  }
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
  return rememberDisplayedGuides(next, call);
}

// Hydrated worker results already contain the final native guide call. Retain
// its replayable arguments without regenerating axes, legends and facet cells.
export function rememberDisplayedGuides(view, call) {
  displayedGuideCalls.set(view, structuredClone(call));
  return view;
}

export function prepareStartingPlot(program, action) {
  return prepareGuidedAction(program, action);
}

export function prepareGuidedAction(program, action, view = program, setupCalls = []) {
  action = sharedLegendEdit(view, action);
  recentPreparations.set(program, true);
  if (!preparations.has(program)) preparations.set(program, new WeakMap());
  const views = preparations.get(program);
  if (!views.has(view)) views.set(view, createProgramResultCache());
  const cache = views.get(view), key = signature([action, setupCalls]);
  const cached = cache.get(key);
  if (cached) return cached;
  const prepared = nativeActionTargets(action)
    ? prepareScopedAction(program, action, view, setupCalls)
    : prepareUncached(program, action, view, setupCalls);
  cache.set(key, freezeResult(prepared));
  return prepared;
}

function prepareScopedAction(program, action, view, setupCalls) {
  const targets = nativeActionTargets(action), prerequisites = [], posts = [];
  let resolvedAction = action;
  const { target: _target, ...options } = action.args;
  for (const target of targets) {
    const local = chartAtPath(program, target.childPath), displayed = chartAtPath(view, target.childPath);
    const call = { ...action, args: { ...options, ...(target.id === undefined ? {} : { target: target.id }) },
      allowUnchanged: targets.length > 1 || action.allowUnchanged };
    const localSetup = setupCalls.map(setup => {
      const { target: _target, ...args } = setup.args;
      const selectors = nativeActionTargets(setup);
      if (!selectors) return setup;
      const relative = selectors.map(selector => {
        if (!target.childPath.every((id, index) => selector.childPath[index] === id)) throw new Error('Plot setup must belong to the receiving view.');
        return { ...selector, childPath: selector.childPath.slice(target.childPath.length) };
      });
      return { ...setup, args: { ...args, target: relative.length === 1 ? relative[0] : relative } };
    });
    const prepared = prepareGuidedAction(local, call, displayed, localSetup);
    // Local fitting may revise constructor guide options. Replay that fitted
    // call at its explicit path, not the original options that already failed.
    if (targets.length === 1) resolvedAction = { ...action, args: { ...prepared.recommendation.args, target: action.args.target } };
    for (const entry of prepared.prerequisiteCalls) prerequisites.push(scopedCall(entry, [{ childPath: target.childPath }]));
    for (const entry of prepared.postActionCalls) posts.push(scopedCall(entry, [{ childPath: target.childPath }]));
  }
  const unique = calls => [...new Map(calls.map(call => [signature(call), call])).values()];
  const prerequisiteCalls = unique(prerequisites), postActionCalls = unique(posts);
  let base = program;
  for (const call of prerequisiteCalls) base = base[call.method](call.args);
  const prepared = prepareAction(base, resolvedAction);
  let authoringPreview = prepared.preview;
  for (const call of postActionCalls) authoringPreview = authoringPreview[call.method](call.args);
  const guideCall = defaultGuideCall(authoringPreview);
  return { ...prepared, actionBase: base, prerequisiteCalls, postActionCalls, authoringPreview,
    guideCall, preview: addDefaultGuides(authoringPreview, guideCall) };
}

function prepareUncached(program, action, view, setupCalls, repairs = {}) {
  let actionBase = program;
  const prerequisiteCalls = [];
  for (const setup of setupCalls) {
    // Explicit native data preparation, replayed in the code view and on Apply.
    // The recommendation below still executes exactly one public chart method.
    const setupMethod = setup.method === 'editFacetSource' ? setup.args.action?.method : setup.method;
    if (!['createBinData', 'createComputedData', 'createSummaryData', 'createTimeUnitData', 'createCompleteData', 'filterData', 'editCompositionLayout'].includes(setupMethod)) {
      throw new Error(`Unsupported plot setup: ${setup.method}`);
    }
    const call = structuredClone(setup);
    actionBase = actionBase[call.method](call.args);
    prerequisiteCalls.push(call);
  }
  const sourceAction = action.method === 'editFacetSource' ? { method: action.args.action.method, args: action.args.action.options } : action;
  const sourceCall = (method, args) => action.method === 'editFacetSource'
    ? { method: 'editFacetSource', args: { action: { method, options: args } } } : { method, args };
  // Initial parallel coordinates need room for each additional axis. Derive
  // each preview from the unchanged starting canvas, never the last preview.
  // An authored canvas or an existing chart keeps its user-chosen dimensions.
  if (action.method === 'createParallelCoordinates' && !actionBase.compositionSpec &&
      !actionBase.semanticSpec.layers.length && action.args.dimensions?.length > 3) {
    const geometry = canvasGeometry(actionBase);
    if (geometry?.plot.width === defaultCanvasOptions().plot.width &&
        !actionBase.trace.children.some(node => node.op === 'editCanvas')) {
      const width = Math.round(geometry.plot.width * (1 + .2 * (action.args.dimensions.length - 3)) * 100) / 100;
      const call = { method: 'editCanvas', args: { plot: { ...geometry.plot, width }, margin: geometry.margin } };
      actionBase = actionBase.editCanvas(call.args);
      prerequisiteCalls.push(call);
    }
  }
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
  const family = /^(?:editLegend|removeLegend)/.test(sourceAction.method) ? 'legend' : /^edit(?:Grid|HorizontalGrid|VerticalGrid)$/.test(sourceAction.method) ? 'grid'
    : /^edit(?:Axes|[XY]Axis|ThetaAxis|RadialAxis|ParallelAxis)/.test(sourceAction.method) ? 'axis' : null;
  if (family) {
    const createMethod = { legend: 'createLegend', grid: 'createGrid', axis: 'createAxes' }[family];
    const last = view.trace.children.at(-1);
    // The displayed suffix may own a guide absent from the authoring prefix.
    // Promote the native creation call into visible setup before editing;
    // the recommendation itself still executes exactly one public edit method.
    const missing = Object.keys(view.semanticSpec.guides[family] ?? {})
      .some(key => !program.semanticSpec.guides[family]?.[key] &&
        !(family === 'legend' && program.compositionSpec?.facet && program.guideConfigs.legend?.[key]));
    if (missing && last?.op === 'createGuides') {
      const children = nodes => nodes.flatMap(node => [node, ...children(node.children ?? [])]);
      if (children(last.children).some(node => node.op === createMethod)) {
        const suffix = displayedGuideCalls.get(view);
        const option = { axis: 'axes', grid: 'grid', legend: 'legend' }[family];
        // A facet owns its shared legend; createLegend is unit-only.
        const call = family === 'legend' && actionBase.compositionSpec?.facet
          ? { method: 'createGuides', args: { axes: false, grid: false, legend: structuredClone(suffix?.args.legend ?? {
            ...sourceAction.args.target ? { target: sourceAction.args.target } : {},
            ...sourceAction.args.channel ? { channels: [sourceAction.args.channel] } : {}
          }) } }
          : sourceCall(createMethod, structuredClone(suffix?.args[option] ?? {}));
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
        layer?.encoding[channel]?.field === legend.field && layer.encoding[channel].scale &&
        !authoringPreview.guideConfigs.suppressedLegends?.[legend.target]?.channels.includes(channel))])];
      if (channels.length === legend.channels?.length) continue;
      const call = { method: 'editLegend', args: { target: legend.target, channels } };
      authoringPreview = authoringPreview.editLegend(call.args);
      postActionCalls.push(call);
    }
    const call = defaultGuideCall(authoringPreview);
    let preview = addDefaultGuides(authoringPreview, call);
    const centered = sourceAction.method === 'createAdjacentPlot' && ['left', 'right'].includes(sourceAction.args.position ?? 'right')
      ? compactAdjacentCanvases(authoringPreview, preview, call)
      : centerCanvasContent(authoringPreview, preview, call);
    authoringPreview = centered.program; preview = rememberDisplayedGuides(centered.view, call);
    postActionCalls.push(...centered.calls);
    return { ...prepared, authoringPreview, postActionCalls, preview, guideCall: call };
  };
  let prepared;
  try { prepared = prepareFittedPlot(actionBase, action, finish); } catch (error) {
    if (family === 'legend' && /^(In-plot legend(?: group)? does not fit|Horizontal legend block requires more plot width)/.test(error.message)) {
      // An explicit Show all or larger typography request must not silently
      // truncate entries or move the legend. Enlarge its containing plot via
      // replayable native setup, retaining the requested placement and text.
      const geometry = canvasGeometry(actionBase);
      let lastError = error;
      for (const factor of [1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32]) {
        const args = { plot: { width: Math.ceil(geometry.plot.width * factor),
          height: Math.ceil(geometry.plot.height * factor) }, margin: geometry.margin };
        const call = actionBase.compositionSpec?.facet
          ? { method: 'editFacetSource', args: { action: { method: 'editCanvas', options: args } } }
          : { method: 'editCanvas', args };
        try {
          const base = actionBase[call.method](call.args);
          const fitted = prepareFittedPlot(base, action, finish);
          return { ...fitted, actionBase: base, prerequisiteCalls: [...prerequisiteCalls, call] };
        } catch (failure) {
          if (!/^(In-plot legend(?: group)? does not fit|Horizontal legend block requires more plot width)/.test(failure.message)) throw failure;
          lastError = failure;
        }
      }
      throw lastError;
    }
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
    // The final createGuides suffix can own all the displayed axes. Scale edits
    // still need to fit those axes even when the authoring prefix has none.
    const resources = Object.entries({ ...view.semanticSpec.guides.axis,
      ...actionBase.semanticSpec.guides.axis }).filter(([id, value]) =>
      staleTicks ? (actionBase.guideConfigs.axis?.[id] ?? view.guideConfigs.axis?.[id])?.ticks?.mode === 'values'
        : (value.channel ?? id) === axis);
    if (!resources.length) throw error;
    const configs = resources.map(([id, semantic]) => ({ id, semantic,
      config: actionBase.guideConfigs.axis?.[id] ?? view.guideConfigs.axis?.[id] }));
    // createGuides treats a partial explicit axis family as authored. Promote
    // its unaffected displayed siblings too, or fitting Y would drop X.
    const retainedDisplayedAxes = Object.entries(view.semanticSpec.guides.axis ?? {})
      .filter(([id]) => !actionBase.semanticSpec.guides.axis?.[id] && !configs.some(saved => saved.id === id))
      .map(([id, semantic]) => ({ id, semantic, config: view.guideConfigs.axis[id] }));
    if (family === 'axis') {
      // An axis editor must retain its target. Removing it before applying an
      // edit turns a recoverable text collision into an unknown-target error.
      // Fit the existing guide via native edits, then apply the requested edit.
      let lastError = error;
      for (const count of [6, 4, 3, 2]) {
        let base = actionBase;
        const calls = [];
        try {
          for (const saved of configs) {
            const channel = saved.semantic.channel ?? saved.id;
            const fitted = fittedAxisOptions(base, undefined, channel, saved, count);
            const call = sourceCall(channel === 'x' ? 'editXAxis' : 'editYAxis', {
              target: saved.id,
              ...(saved.config.labels && saved.config.title ? { title: { offset: { from: 'labels', gap: 4 } } } : {}),
              ...(fitted.ticksAndLabels ? { ticksAndLabels: fitted.ticksAndLabels } : {}),
            });
            base = base[call.method](call.args); calls.push(call);
          }
          const result = prepareFittedPlot(base, action, finish);
          return { ...result, actionBase: base, prerequisiteCalls: [...prerequisiteCalls, ...calls] };
        } catch (failure) { lastError = failure; }
      }
      throw lastError;
    }
    for (const { id, semantic } of configs) {
      if (!actionBase.semanticSpec.guides.axis?.[id]) continue;
      const call = sourceCall((semantic.channel ?? id) === 'x' ? 'removeXAxis' : 'removeYAxis', { target: id });
      actionBase = actionBase[call.method](call.args); prerequisiteCalls.push(call);
    }
    const edited = prepareAction(actionBase, action);
    let lastError = error;
    for (const count of [6, 4, 3, 2]) {
      const calls = [...configs, ...retainedDisplayedAxes].map(saved => {
        const channel = saved.semantic.channel ?? saved.id;
        return sourceCall(channel === 'x' ? 'createXAxis' : 'createYAxis',
          fittedAxisOptions(edited.preview, configs.includes(saved) ? sourceAction.args.target : undefined, channel, saved,
            configs.includes(saved) ? count : undefined));
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
  const layer = program.semanticSpec.layers.find(layer => layer.id === target) ??
    program.semanticSpec.layers.find(layer => layer.encoding[axis]?.scale === semantic.scale) ??
    program.semanticSpec.layers.find(layer => layer.coordinate === semantic.coordinate);
  const scale = layer?.encoding[axis]?.scale ?? semantic.scale;
  const domain = program.resolvedScales[scale]?.domain ?? [];
  const discrete = ['nominal', 'ordinal'].includes(layer?.encoding[axis]?.fieldType);
  const labels = pick(config.labels, ['offset', 'format', 'color', 'fontSize', 'fontFamily', 'fontWeight', 'maxWidth', 'wrap', 'lineHeight', 'alongOffset', 'labelMap', 'flush', 'colorMap', 'align']);
  labels.rotation = count !== undefined && axis === 'x' && discrete ? { value: 90, unit: 'degrees' } : { value: config.labels?.rotation ?? 0, unit: 'radians' };
  const title = pick(config.title, ['text', 'at', 'offset', 'color', 'fontSize', 'fontFamily', 'fontWeight', 'alongOffset', 'align', 'baseline']);
  if (config.title?.inferredOffset) delete title.offset;
  if (config.title?.inferredText) delete title.text;
  else if (semantic.title !== undefined) title.text = semantic.title;
  if (!config.title?.inferredRotation) title.rotation = { value: config.title?.rotation ?? 0, unit: 'radians' };
  const tickSelection = count === undefined ? pick(config.ticks ?? config.labels, ['count', 'values', 'rounding'])
    : discrete ? { values: domain.filter((_, index) => index % Math.ceil(domain.length / count) === 0) }
      : count <= 2 && domain.length === 2 ? { values: [...new Set(domain)] } : { count };
  return { id, scale, coordinate: semantic.coordinate, position: config.line?.position ?? config.labels?.position,
    ...(config.frame?.offset !== undefined ? { offset: config.frame.offset } : {}),
    line: config.line ? pick(config.line, ['color', 'lineWidth']) : false,
    ticksAndLabels: config.labels || config.ticks ? { ...tickSelection,
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
  // A native layer shares this view's guides. Fit them through the existing
  // outer guide-repair path, never by adding constructor-only guides options.
  if (action.method === 'createLayerPlot' || !/^create.*(?:Plot|Histogram|Heatmap|ParallelCoordinates)$/.test(action.method)) return finish(prepareAction(program, action));
  const adjacent = action.method === 'createAdjacentPlot';
  const plotMethod = adjacent ? action.args.plot?.action ?? 'createLinePlot' : action.method;
  const plotArgs = adjacent ? action.args.plot?.options ?? {} : action.args;
  const proposed = args => adjacent ? { ...action, args: { ...action.args, plot: { action: plotMethod, options: args } } } : { ...action, args };
  let lastError;
  try { return finish(prepareAction(program, action)); } catch (error) { lastError = error; }
  if (!/label|text|overlap|Canvas space/i.test(lastError.message)) throw lastError;
  const data = program.semanticSpec.datasets.find(d => d.id === plotArgs.data) ??
    (program.semanticSpec.datasets.length === 1 ? program.semanticSpec.datasets[0] : undefined);
  const rows = data?.values ?? [];
  for (const count of [6, 4, 3]) {
    const args = structuredClone(plotArgs);
    if (args.guides === false) throw lastError;
    args.guides = { ...args.guides, axes: { ...args.guides?.axes } };
    const bindings = { x: args.x, y: args.y };
    if (plotMethod === 'createHistogram') {
      bindings.x = { field: args.field, fieldType: 'quantitative' };
      bindings.y = { field: args.field, fieldType: 'quantitative' };
    }
    if (['createDotPlot', 'createLollipopPlot', 'createDumbbellPlot', 'createRaincloudPlot'].includes(plotMethod)) {
      bindings[args.orientation === 'horizontal' ? 'y' : 'x'] = { field: args.category, fieldType: 'nominal' };
      bindings[args.orientation === 'horizontal' ? 'x' : 'y'] = { field: args.value ?? args.start, fieldType: 'quantitative' };
    }
    if (['createPolarScatterPlot', 'createPolarLinePlot', 'createRosePlot', 'createRadialBarPlot'].includes(plotMethod)) {
      bindings.theta = args.theta ?? { field: args.category, fieldType: 'nominal' };
      bindings.radius = args.radius ?? args.value ?? { field: '__count' };
    }
    for (const axis of Object.keys(bindings)) {
      const binding = bindings[axis];
      if (!binding || plotMethod === 'createHorizonPlot' && axis === 'y') continue;
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
    try { return finish(prepareAction(program, proposed(args))); } catch (error) {
      lastError = error; if (!/label|text|overlap|Canvas space/i.test(error.message)) throw error;
    }
  }
  throw lastError;
}
