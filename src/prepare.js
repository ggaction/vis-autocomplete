import { prepareAction } from './engine.js';
import { createLRU, signature, freezeResult } from './cache.js';

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
  if (!views.has(view)) views.set(view, createLRU(128));
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
    if (!['createBinData', 'createComputedData', 'createSummaryData'].includes(setup.method)) {
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
  const prepared = prepareAction(actionBase, action);
  const call = defaultGuideCall(prepared.preview);
  return { ...prepared, actionBase, prerequisiteCalls, authoringPreview: prepared.preview,
    preview: addDefaultGuides(prepared.preview, call), guideCall: call };
}
