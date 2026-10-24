import { getPlotComposition } from 'ggaction/inspection';
import { chartOwner, primaryChartLayer } from './chart-owner.js';

// Facets retain one editable source. Generated facet cells never become targets.
export function chartViews(program, childPath = []) {
  if (program.compositionSpec && !program.compositionSpec.facet) {
    return Object.entries(program.children).flatMap(([id, child]) => chartViews(child, [...childPath, id]));
  }
  return [{ program, childPath }];
}
// Composition policies apply to every descendant; a nested local 'independent'
// policy does not cancel a shared axis owned by an ancestor.
export function compositionContainers(program, childPath = []) {
  if (!program.compositionSpec || program.compositionSpec.facet) return [];
  return [{ program, childPath, label: childPath.length ? `Group: ${childPath.join(' / ')}` : 'All charts' },
    ...Object.entries(program.children).flatMap(([id, child]) => compositionContainers(child, [...childPath, id]))];
}
export function inheritedCompositionShares(program, childPath = []) {
  return compositionContainers(program).filter(container => container.childPath.length < childPath.length &&
    container.childPath.every((id, index) => childPath[index] === id))
    .map(container => ({ childPath: container.childPath, label: container.label,
      channels: ['x', 'y', 'color'].filter(channel => container.program.compositionSpec.share?.[channel]) }))
    .filter(container => container.channels.length);
}

export function chartAtPath(program, path = []) {
  for (const id of path) {
    if (program.compositionSpec?.facet || !program.children[id]) throw new Error('The selected chart no longer exists.');
    program = program.children[id];
  }
  return program;
}
export const targetKey = target => JSON.stringify([target.childPath ?? [], target.id ?? null]);
function chartTypeLabel(view, layer, owner) {
  const role = view.markConfigs[layer.id]?.compositionRole;
  const compound = { editRaincloudPlot: 'Raincloud', editBoxPlot: 'Box', editViolinPlot: 'Violin',
    editGradientPlot: 'Gradient', editEndpointPlot: 'Endpoint', editECDFPlot: 'ECDF',
    editRadarPlot: 'Radar', editErrorBar: 'Error bar', editBin2DData: 'Heatmap',
    editHorizon: 'Horizon', editDensity: 'Density' }[owner?.method];
  const type = compound ?? role ?? layer.mark.type;
  return type.charAt(0).toUpperCase() + type.slice(1);
}
export function editableChartTargets(program) {
  const targets = chartViews(program).flatMap(({ program: view, childPath }) => {
    const owners = new Set();
    return view.semanticSpec.layers.flatMap(layer => {
      const owner = chartOwner(view, layer);
      let primary = primaryChartLayer(view, owner?.target ?? layer.id);
      if(!layer.derivedBindings?.overlay) {
        try { const descriptor=getPlotComposition(view,{target:layer.id});primary=view.semanticSpec.layers.find(l=>l.id===descriptor.owner)??primary; } catch {}
      }
      const id = primary.id;
      if (owners.has(id) || layer.source && !owner || layer.derivedBindings?.statisticalReference) return [];
      owners.add(id);
      return [{ childPath, id, overlay: Boolean(layer.derivedBindings?.overlay),
        label: chartTypeLabel(view, primary, chartOwner(view,primary)??owner) }];
    });
  });
  // Names describe the visible chart, while stable IDs still route edits.
  // Number only repeated types so multiple lines/panels remain distinguishable.
  const totals = new Map(), counts = new Map();
  for (const { label } of targets) totals.set(label, (totals.get(label) ?? 0) + 1);
  return targets.map(target => {
    const number = (counts.get(target.label) ?? 0) + 1; counts.set(target.label, number);
    return { ...target, label: totals.get(target.label) > 1 ? `${target.label} ${number}` : target.label };
  });
}
// One visual panel per group; overlays retain their own selectable targets.
// Follow composition layout order, including nested left/top additions.
export function editableChartTargetGroups(program) {
  const targets = editableChartTargets(program);
  const visit = (view, childPath = []) => {
    if (view.compositionSpec && !view.compositionSpec.facet) {
      return view.compositionSpec.children.flatMap(id => visit(view.children[id], [...childPath, id]));
    }
    const key = JSON.stringify(childPath);
    const members = targets.filter(target => JSON.stringify(target.childPath) === key);
    return members.length ? [{ key, childPath, targets: members }] : [];
  };
  return visit(program);
}
export function resolveEditingContext(program, options = {}) {
  const targets = editableChartTargets(program);
  const requested = options.childPath ? { childPath: options.childPath, id: options.target } : null;
  const selected = targets.find(t => requested && targetKey(t) === targetKey(requested)) ??
    targets.find(t => !options.childPath && t.id === options.target) ?? targets[0];
  if (!selected) return { program, options, scope: null, targets };
  const local = chartAtPath(program, selected.childPath);
  const owner = primaryChartLayer(local, selected.id);
  const { childPath: _path, scope: _scope, ...rest } = options;
  return { program: local, options: { ...rest, target: owner.id, data: undefined }, targets,
    selected, scope: options.scope === 'all' ? { all: true, anchor: selected.id, targets } : { anchor: selected.id, targets: [selected] } };
}
export function scopedCall(call, targets) {
  const { target, ...args } = call.args;
  if (target && typeof target === 'object') {
    const nested = Array.isArray(target) ? target : [target];
    const selectors = targets.flatMap(entry => nested.map(child => typeof child === 'string'
      ? { childPath: entry.childPath ?? [], id: child }
      : { ...child, childPath: [...(entry.childPath ?? []), ...child.childPath] }));
    return { ...call, args: { ...args, target: selectors.length === 1 ? selectors[0] : selectors } };
  }
  const selectors = targets.map(entry => ({ childPath: entry.childPath ?? [],
    ...(typeof target === 'string' ? { id: entry.id ?? target } : {}) }));
  const unique = [...new Map(selectors.map(t => [targetKey(t), t])).values()];
  if (unique.length === 1 && !unique[0].childPath.length) {
    return { ...call, args: { ...args, ...(unique[0].id === undefined ? {} : { target: unique[0].id }) } };
  }
  return { ...call, args: { ...args, target: unique.length === 1 ? unique[0] : unique } };
}
export function scopeRecommendationCall(call, scope) {
  if (!scope) return call;
  const targets = scope.all && /^(encode[XYR]|edit[XYR]Scale|layoutSeries|jitter|pack|filterMarks|encodeGroup|encodePathOrder)/.test(call.method)
    ? scope.targets.filter(target => !target.overlay) : scope.targets;
  if (scope.all && typeof call.args.target !== 'string' &&
      (call.args.source || call.args.data || call.method === 'editFacetSource')) {
    throw new Error('This action edits one chart source. Select a chart or overlay first.');
  }
  return scopedCall(call, targets.map(target => ({ ...target, id: call.args.target === scope.anchor ? target.id : undefined })));
}
export function nativeActionTargets(action) {
  const value = action.args?.target;
  if (!Array.isArray(value) && (!value || typeof value !== 'object')) return null;
  return (Array.isArray(value) ? value : [value]).map(t => typeof t === 'string' ? { childPath: [], id: t } : t);
}
