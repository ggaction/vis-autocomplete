import { optionGroup } from './recommendation-groups.js';

// Public semantic containment, not the implementation call graph. In particular,
// setup, plot creation and generic editSemantic/editDerivedData are not parents
// of every action they happen to execute. An ancestor must have an actual,
// applicable recommendation (arguments and editor) in the same option group.
export const ACTION_HIERARCHY = Object.freeze(Object.fromEntries(Object.entries({
  editAxes: ['editXAxis', 'editYAxis', 'editThetaAxis', 'editRadialAxis', 'editParallelAxis'],
  ...Object.fromEntries(['X', 'Y', 'Theta', 'Radial'].map(axis => [`edit${axis}Axis`,
    ['Line', 'Ticks', 'Labels', 'Title', ...(['X', 'Y'].includes(axis) ? ['TicksAndLabels'] : [])]
      .map(part => `edit${axis}Axis${part}`)])),
  editXAxisTicksAndLabels: ['editXAxisTicks', 'editXAxisLabels'],
  editYAxisTicksAndLabels: ['editYAxisTicks', 'editYAxisLabels'],
  editLegend: ['editLegendLayout', 'editLegendLabels', 'editLegendTitle', 'editLegendSymbols', 'editLegendBorder', 'editLegendBlock'],
  editGrid: ['editHorizontalGrid', 'editVerticalGrid', 'editThetaGrid', 'editRadialGrid'],
  encodeChannels: ['encodeX', 'encodeY', 'encodeX2', 'encodeY2', 'encodeTheta', 'encodeR',
    'encodeXOffset', 'encodeYOffset', 'encodeGroup', 'encodePathOrder', 'encodeColor',
    'encodeStroke', 'encodeSize', 'encodeShape', 'encodeOpacity', 'encodeStrokeWidth',
    'encodeStrokeDash', 'encodeAngle', 'encodeText'],
  encodeXRange: ['encodeX', 'encodeX2'],
  encodeYRange: ['encodeY', 'encodeY2'],
  encodeHistogram: ['encodeX', 'encodeY'],
  createRegression: ['createRegressionData', 'createRegressionLine', 'createRegressionBand'],
  editRegression: ['editRegressionData', 'editRegressionStatisticsData', 'editRegressionLine', 'editRegressionBand'],
  createStatisticalReference: ['createReferenceLine', 'createReferenceBand'],
}).map(([parent, children]) => [parent, Object.freeze(children)])));

export function hierarchyAction(value) {
  return value.method === 'editFacetSource' && value.args?.action
    ? { method: value.args.action.method, args: value.args.action.options ?? {}, wrapped: true }
    : { method: value.sourceMethod ?? value.method, args: value.args ?? {}, wrapped: false };
}

const parents = new Map();
for (const [parent, children] of Object.entries(ACTION_HIERARCHY)) for (const child of children) {
  if (!parents.has(child)) parents.set(child, []);
  parents.get(child).push(parent);
}
function ancestorMethods(method, visiting = new Set()) {
  if (visiting.has(method)) throw new Error(`Cyclic action hierarchy: ${method}`);
  const next = new Set(visiting).add(method);
  return [...new Set((parents.get(method) ?? []).flatMap(parent => [...ancestorMethods(parent, next), parent]))];
}
const ancestors = new Map([...parents.keys()].map(method => [method, ancestorMethods(method)]));

function axisTargets(action, program) {
  const { method, args } = action;
  if (method === 'editAxes') return Object.entries(args).flatMap(([channel, values]) =>
    (Array.isArray(values) ? values : [values]).map(value => value.target ?? channel));
  const axis = method.match(/^edit(X|Y|Theta|Radial|Parallel)Axis/);
  return axis ? [args.target ?? ({ X: 'x', Y: 'y', Theta: 'theta', Radial: 'radius', Parallel: 'parallel' })[axis[1]]] : [];
}
function axisCoordinates(action, program) {
  return axisTargets(action, program).map(id => program.semanticSpec.guides.axis?.[id]?.coordinate ??
    program.semanticSpec.layers.find(layer => layer.id === id)?.coordinate ?? `axis:${id}`);
}
function matchingOwner(parent, child, program) {
  if (parent.wrapped !== child.wrapped) return false;
  if (parent.method === 'editAxes') {
    const coordinates = axisCoordinates(parent, program);
    return axisCoordinates(child, program).some(id => coordinates.includes(id));
  }
  if (/^edit(?:X|Y|Theta|Radial|Parallel)Axis/.test(parent.method)) {
    return axisTargets(parent, program).some(id => axisTargets(child, program).includes(id));
  }
  const a = parent.args, b = child.args;
  // Legend channels share a card's alternatives, but choosing color must not
  // unlock a different mark's size legend. Missing channel means all blocks.
  if (/^editLegend/.test(parent.method) && a.channel && b.channel && a.channel !== b.channel) return false;
  const targetA = a.target ?? a.source ?? a.id, targetB = b.target ?? b.source ?? b.id;
  if (targetA === targetB) return true;
  if (/^(create|edit)Regression$/.test(parent.method) && targetA && targetB) {
    const config = program.markConfigs?.[targetA]?.regression;
    return config && [config.data, config.line, config.band, config.dataId, config.lineId, config.bandId].includes(targetB);
  }
  return false;
}

function appliedTo(candidate, program) {
  const action = hierarchyAction(candidate);
  // Only top-level authored actions count. A createGuides/createPlot action's
  // internal axis creation must not advance the user's editing hierarchy.
  return program.trace.children.some(node => {
    const applied = hierarchyAction({ method: node.op, args: node.args });
    return applied.method === action.method && matchingOwner(applied, action, program);
  });
}

// This stage runs AFTER co-occurrence ranking. Never score the ancestors again,
// sum descendant scores, or reorder an already-ranked list by hierarchy depth.
export function createHierarchyProjection(recommendations, program) {
  const byMethod = new Map();
  for (const rec of recommendations) {
    const method = hierarchyAction(rec).method;
    if (!byMethod.has(method)) byMethod.set(method, []);
    byMethod.get(method).push(rec);
  }
  const applied = new Map();
  const wasApplied = rec => {
    if (!applied.has(rec.id)) applied.set(rec.id, appliedTo(rec, program));
    return applied.get(rec.id);
  };
  const choices = source => {
    if (source.previouslyApplied || wasApplied(source)) return [source];
    const action = hierarchyAction(source), found = [];
    for (const method of ancestors.get(action.method) ?? []) for (const candidate of byMethod.get(method) ?? []) {
      if (optionGroup(candidate) !== optionGroup(source) || wasApplied(candidate)) continue;
      if (matchingOwner(hierarchyAction(candidate), action, program)) found.push(candidate);
    }
    return [...found, source];
  };
  const promote = (candidate, source, rank) => ({ ...candidate,
    score: source.score, explanation: source.explanation,
    // The inherited priority includes the existing used-action demotion.
    previouslyApplied: source.previouslyApplied,
    hierarchy: { promoted: candidate.id !== source.id, sourceId: source.id,
      sourceMethod: hierarchyAction(source).method, sourceFeature: source.feature,
      sourceRank: rank + 1, sourceScore: source.score, displayedFeature: candidate.feature },
  });
  return { choices, promote,
    project(unavailable = new Set()) {
      const displayed = new Map();
      recommendations.forEach((source, rank) => {
        const candidate = choices(source).find(value => !unavailable.has(value.id));
        if (candidate && !displayed.has(candidate.id)) displayed.set(candidate.id, promote(candidate, source, rank));
      });
      return [...displayed.values()];
    },
  };
}
