import { findGraphic } from '../vendor/ggaction/src/grammar/schemas/graphicTree.js';
import { resolveConcreteGraphicBounds } from '../vendor/ggaction/src/grammar/schemas/graphicBounds.js';
import { axisGraphicIds, legendGraphicIds, resolveLegendAxisOffset } from '../vendor/ggaction/src/materialization/guides/resources.js';
import { cartesianAxisOwners, axisTargetArgs } from '../vendor/ggaction/src/selectors/axes.js';
import { legendBlockChannels, describeLegendBlock } from '../vendor/ggaction/src/grammar/legendBlocks.js';
import { scopedCall } from './composition-context.js';
import { prepareCompositionSnapshots, compositionPlotBounds } from '../vendor/ggaction/src/materialization/composition.js';
import { compositionLegendEdgeClearance } from '../vendor/ggaction/src/layout/compositionLegend.js';
import { compositionLegends } from '../vendor/ggaction/src/materialization/compositionLegends.js';
import { namespaceGraphicId } from '../vendor/ggaction/src/materialization/compositionSnapshot.js';
import { canvasGeometry } from './canvas-geometry.js';
import { localLegendPlacement } from '../vendor/ggaction/src/grammar/legendGroups.js';
import { restoreLegendItemsOffset } from '../vendor/ggaction/src/materialization/legendItemsOffset.js';
import { legendDockMetrics, legendDockLayout } from './legend-docking.js';
import { retainedFacetGuideIds, facetHeaderGraphicId } from '../vendor/ggaction/src/materialization/facetHeaders.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = n => Math.round(n * 4) / 4;
const annotationCall = (target, method, args = {}) => {
  const options = { ...target.args, ...args };
  return target.facet ? { method: 'editFacetSource', args: { action: { method, options } } } : { method, args: options };
};
const facetSourceCall = call => ({ method: 'editFacetSource', args: { action: { method: call.method, options: call.args } } });
export function guideMoveHistoryKey(target) {
  if (target.childPath) return `${JSON.stringify(target.childPath)}/${guideMoveHistoryKey(target.localTarget)}`;
  if (target.facetTarget) return `facet/legend:${target.config.target}:${target.family}:${target.part ?? 'legend'}`;
  if (target.kind === 'title') return 'move:title';
  if (target.kind === 'axis') return `move:axis:${target.channel}:${JSON.stringify(target.args)}`;
  if (target.kind === 'annotation') return `move:annotation:${JSON.stringify(target.args)}`;
  return `move:${target.key}${target.part ? `:${target.part}` : ''}`;
}
export function guideBounds(program, ids) {
  const bounds = ids.filter(id => findGraphic(program.graphicSpec, id)).map(id =>
    resolveConcreteGraphicBounds(program.graphicSpec, id, program.materializationConfigs?.textMetrics)).filter(Boolean);
  if (!bounds.length) return null;
  return { left: Math.min(...bounds.map(b => b.left)), right: Math.max(...bounds.map(b => b.right)),
    top: Math.min(...bounds.map(b => b.top)), bottom: Math.max(...bounds.map(b => b.bottom)) };
}

export function editableGuides(program) {
  const titles = [];
  if (program.titleConfig && program.graphicSpec.objects.chartTitle) {
    const config = program.titleConfig;
    for (const target of [
      { key: 'title', label: 'Title', part: 'titleStyle', ids: ['chartTitle'] },
      ...(program.graphicSpec.objects.chartSubtitle ? [
        { key: 'subtitle', label: 'Subtitle', part: 'subtitleStyle', ids: ['chartSubtitle'] },
        { key: 'title-group', label: 'Title + subtitle', ids: ['chartTitle', 'chartSubtitle'] },
      ] : [])
    ]) titles.push({ ...target, kind: 'title', config, movable: true, bounds: guideBounds(program, target.ids) });
  }
  if (program.compositionSpec && !program.compositionSpec.facet) {
    const { children, layout } = prepareCompositionSnapshots(program);
    for (const shared of compositionLegends(program, children)) {
      const sharedId = shared.id;
      const bounds = guideBounds(program, [sharedId]), anchor = shared.anchorBounds ?? shared.bounds;
      if (program.graphicSpec.objects[sharedId]) titles.push({
        key: sharedId.endsWith('-shared-color-legend') ? 'legend:shared-color' : `legend:${sharedId}`,
        kind: 'legend', label: `${shared.config.title || 'Legend'} legend`,
        ids: [sharedId], bounds, movable: true,
        anchorBounds: { left: bounds.left + anchor.left - shared.bounds.left, right: bounds.right + anchor.right - shared.bounds.right,
          top: bounds.top + anchor.top - shared.bounds.top, bottom: bounds.bottom + anchor.bottom - shared.bounds.bottom },
        config: shared.config, placement: shared.placement, family: shared.block.kind, channels: shared.channels,
        representation: shared.block.family, editTargets: shared.targets,
        remove: { method: 'removeLegend', args: { target: shared.targets, channels: sharedId.endsWith('-shared-color-legend') ? ['color'] : shared.channels, suppress: true } },
      });
    }
    return [...titles, ...layout.children.flatMap(placement => editableGuides(children[placement.id]).map(localTarget => {
      const ids = localTarget.ids.map(id => namespaceGraphicId(`${program.compositionSpec.id}-${placement.id}`, id));
      const bounds = guideBounds(program, ids);
      return { ...localTarget, ids, bounds, key: `${placement.id}/${localTarget.key}`,
        childPath: [placement.id], localTarget, localProgram: children[placement.id],
        offset: { x: program.graphicSpec.objects[namespaceGraphicId(`${program.compositionSpec.id}-${placement.id}`, 'canvas')]?.properties.x ?? placement.x,
          y: program.graphicSpec.objects[namespaceGraphicId(`${program.compositionSpec.id}-${placement.id}`, 'canvas')]?.properties.y ?? placement.y } };
    }).filter(target => target.bounds))];
  }
  const objects = program.graphicSpec.objects, targets = [...titles];
  const add = target => { const bounds = guideBounds(program, target.ids); if (bounds) targets.push({ ...target, bounds }); };
  const findIds = ids => Object.keys(objects).filter(id => ids.some(native => id === native || id.endsWith(`_${native}`)));
  // An annotation is a single text mark with a constant anchor, not a label
  // repeated for every data row. Identify it by semantics, including restored
  // programs and older data-anchored annotations, rather than by its ID.
  for (const layer of program.semanticSpec.layers) {
    if (layer.mark.type !== 'text' || !['text', 'x', 'y'].every(channel => Object.hasOwn(layer.encoding[channel] ?? {}, 'datum'))) continue;
    const ids = program.compositionSpec?.facet ? Object.keys(program.children).map(child =>
      namespaceGraphicId(`${program.compositionSpec.id}-${child}`, layer.id)) : [layer.id];
    for (const id of ids) add({ key: `annotation:${id}`, label: 'Annotation', kind: 'annotation',
      config: program.markConfigs[layer.id], args: { target: layer.id }, ids: [id], movable: true,
      facet: Boolean(program.compositionSpec?.facet) });
  }
  for (const owner of cartesianAxisOwners(program)) {
    if (!owner.config?.title) continue;
    const ids = findIds([axisGraphicIds(owner.channel, owner.id)[3]]);
    for (const id of ids) add({ key: `axis:${id}`, label: `${owner.channel.toUpperCase()} axis title`, kind: 'axis',
      config: owner.config.title, movable: true, channel: owner.channel, args: axisTargetArgs(owner.id, owner.channel), ids: [id],
      facet: Boolean(program.compositionSpec?.facet) });
  }
  for (const [channel, label, method] of [
    ['theta', 'Angular axis title', 'editThetaAxisTitle'], ['radius', 'Radial axis title', 'editRadialAxisTitle']
  ]) {
    const config = program.guideConfigs.axis?.[channel]?.title;
    if (!config) continue;
    for (const id of findIds([axisGraphicIds(channel)[3]])) add({ key: `axis:${id}`, label, kind: 'axis',
      config, channel, method, args: {}, ids: [id], facet: Boolean(program.compositionSpec?.facet) });
  }
  const parallel = program.guideConfigs.axis?.parallel?.axes;
  if (parallel) for (const id of findIds(['parallelAxisTitles'])) {
    const dimensions = parallel.dimensions.filter(d => d.title);
    const graphic = objects[id];
    for (const [index, item] of (graphic.items ?? [graphic]).entries()) {
      const dimension = dimensions[index]; if (!dimension) continue;
      add({ key: `axis:${id}:${dimension.field}`, label: `${dimension.field} axis title`, kind: 'axis',
        config: dimension.title, method: 'editParallelAxis', args: { target: parallel.target, field: dimension.field },
        ids: [item.id ?? id], facet: Boolean(program.compositionSpec?.facet) });
    }
  }
  // Each retained cell legend is one visible object. Never union its namespaced
  // replicas into a bounding box spanning the plots between them. They still
  // edit the one authored facet source, just like repeated axis titles.
  if (program.compositionSpec?.facet) {
    for (const [childId, child] of Object.entries(program.children)) {
      const prefix = `${program.compositionSpec.id}-${childId}`;
      const canvas = objects[namespaceGraphicId(prefix, 'canvas')];
      for (const local of editableGuides(child).filter(target => target.kind === 'legend')) {
        add({ ...local, key: `${childId}/${local.key}`, ids: local.ids.map(id => namespaceGraphicId(prefix, id)),
          facetTarget: local, localProgram: child,
          offset: { x: canvas?.properties.x ?? 0, y: canvas?.properties.y ?? 0 } });
      }
    }
  }
  const configs = program.guideConfigs.legend ?? {};
  for (const [kind, config] of Object.entries(configs)) {
    const ids = legendGraphicIds(kind).filter(id => objects[id]);
    if (!ids.length) continue;
    add({ key: `legend:${kind}`, label: `${config.title || 'Legend'} legend`, kind: 'legend', family: kind,
      config, placement: localLegendPlacement(config) ?? program.guideConfigs.legendGroups?.[config.target]?.placement ?? config,
      ids, movable: true, representation: describeLegendBlock(program, kind, config).family, channels: legendBlockChannels(kind, config) });
    add({ key: `legend-title:${kind}`, label: `${config.title || 'Legend'} legend title`, kind: 'legend', family: kind,
      part: 'titleStyle', config, ids: ids.filter(id => id.endsWith('Title')), channels: legendBlockChannels(kind, config) });
  }
  return targets;
}

// Selection scopes describe visible owners; they are never new ggaction actions.
// Keep descendant scopes tied to the same native owner, even for collected
// legends and legends inside nested compositions.
const selectableGuideCache = new WeakMap();
export function selectableGuides(program) {
  if (selectableGuideCache.has(program)) return selectableGuideCache.get(program);
  const guides = editableGuides(program), legends = guides.filter(g => g.kind === 'legend' && !g.part);
  const withPart = (target, part) => ({ ...target, part,
    ...(target.localTarget ? { localTarget: withPart(target.localTarget, part) } : {}),
    ...(target.facetTarget ? { facetTarget: withPart(target.facetTarget, part) } : {}) });
  const ownerPath = target => target.childPath ? [...target.childPath, ...ownerPath(target.localTarget)] : [];
  const descendants = id => {
    const object = findGraphic(program.graphicSpec, id)?.object;
    return object?.children?.length ? object.children.flatMap(descendants) : [id];
  };
  for (const legend of legends) {
    legend.legendKey = legend.key; legend.legendPart = 'legend';
    const ids = legend.ids.flatMap(descendants);
    for (const [part, label, scope] of [['titleStyle', 'title', 'title'], ['labels', 'items', 'items']]) {
      const existing = guides.find(g => g.kind === 'legend' && g.part === part && g.family === legend.family &&
        g.ids.every(id => legend.ids.includes(id)) &&
        JSON.stringify(ownerPath(g)) === JSON.stringify(ownerPath(legend)) && JSON.stringify(g.editTargets) === JSON.stringify(legend.editTargets));
      if (existing) { existing.legendKey = legend.key; existing.legendPart = scope; continue; }
      const partIds = ids.filter(id => part === 'titleStyle' ? id.endsWith('Title') : !/(Title|Border|Background)$/.test(id));
      const bounds = guideBounds(program, partIds);
      if (!bounds) continue;
      guides.push({ ...withPart(legend, part), key: `${legend.key}:${scope}`, label: `${legend.label} ${label}`,
        ids: partIds, bounds, movable: part === 'labels',
        resizable: part !== 'labels', deletable: part !== 'labels',
        remove: undefined, legendKey: legend.key, legendPart: scope });
    }
  }
  if (legends.length) {
    const ids = legends.flatMap(g => g.ids);
    guides.push({ key: 'legends:all', label: 'All legends', kind: 'legendGroup', legendPart: 'all',
      members: legends, ids, bounds: guideBounds(program, ids), movable: false, resizable: false, deletable: false, hitTest: false });
  }
  selectableGuideCache.set(program, guides);
  return guides;
}

export function selectedGuideTextTargets(program, keys) {
  function visit(target) {
    if (target.members) return target.members.flatMap(visit);
    if (target.childPath) return visit(target.localTarget).map(item => ({ ...item,
      call: style => scopedCall(item.call(style), [{ childPath: target.childPath }]) }));
    if (target.facetTarget) return visit({ ...target.facetTarget, part: target.part }).map(item => ({ ...item,
      call: style => facetSourceCall(item.call(style)) }));
    const config = target.config;
    const entry = (style, method, args, slot) => style ? [{ config: style, call: value => ({ method,
      args: { ...args, ...(slot ? { [slot]: value } : value) } }) }] : [];
    if (target.kind === 'title') return (target.part ? [target.part] : ['titleStyle', 'subtitleStyle'])
      .flatMap(part => entry(config[part], 'editTitle', {}, part));
    if (target.kind === 'annotation') return [{ config, call: style => annotationCall(target, 'editTextMark', style) }];
    if (target.kind === 'legend') return (target.part ? [target.part] : ['titleStyle', 'labels'])
      .filter(part => part !== 'titleStyle' || config.titleVisible !== false)
      .flatMap(part => entry(config[part], 'editLegend', { target: target.editTargets ?? config.target, channel: target.channels[0] }, part));
    if (target.kind === 'axis') {
      const method = target.method ?? `edit${target.channel.toUpperCase()}AxisTitle`;
      const items = entry(config, method, target.args, method === 'editParallelAxis' ? 'title' : null);
      return target.facet ? items.map(item => ({ ...item, call(style) { const call = item.call(style);
        return { method: 'editFacetSource', args: { action: { method: call.method, options: call.args } } }; } })) : items;
    }
    return [];
  }
  const selected = new Set(keys);
  return selectableGuides(program).filter(g => selected.has(g.key)).flatMap(visit);
}

export function removeGuide(target) {
  if (target.childPath) return scopedCall(removeGuide(target.localTarget), [{ childPath: target.childPath }]);
  if (target.facetTarget) return facetSourceCall(removeGuide({ ...target.facetTarget, part: target.part }));
  if (target.remove) return target.remove;
  if (target.kind === 'annotation') return annotationCall(target, 'removeMark');
  if (target.kind === 'title') return target.part === 'subtitleStyle'
    ? { method: 'editTitle', args: { subtitle: false } } : { method: 'removeTitle', args: {} };
  if (target.kind === 'axis') {
    const method = target.method?.replace(/Title$/, '') ?? `edit${target.channel.toUpperCase()}Axis`;
    const args = { ...target.args, title: false };
    return target.facet ? { method: 'editFacetSource', args: { action: { method, options: args } } } : { method, args };
  }
  if (target.kind === 'legend' && target.part === 'titleStyle') return {
    method: 'editLegend', args: { target: target.editTargets ?? target.config.target, channel: target.channels[0], title: false },
  };
  if (target.kind === 'legend') return {
    method: 'removeLegend', args: { target: target.config.target, channels: target.channels, suppress: true },
  };
  throw new Error('This guide has no supported removal action.');
}

// Every manipulation is one native domain edit. The regular preparer owns
// margin fitting, collisions, guide refresh and facet source replay.
export function resizeGuide(target, factor) {
  if (target.childPath) return scopedCall(resizeGuide(target.localTarget, factor), [{ childPath: target.childPath }]);
  if (target.facetTarget) return facetSourceCall(resizeGuide({ ...target.facetTarget, part: target.part }, factor));
  factor = clamp(factor, .25, 4);
  const config = target.config;
  const font = style => ({ fontSize: clamp(round(style.fontSize * factor), 6, 96) });
  if (target.kind === 'annotation') return annotationCall(target, 'editTextMark', {
    ...font(config), ...(config.lineHeight === undefined ? {} : { lineHeight: Math.max(1, round(config.lineHeight * factor)) }),
  });
  if (target.kind === 'legend' && target.part === 'titleStyle') return {
    method: 'editLegend', args: { target: target.editTargets ?? config.target, channel: target.channels[0], titleStyle: font(config.titleStyle) },
  };
  if (target.kind === 'legend' && target.part === 'labels') return {
    method: 'editLegend', args: { target: target.editTargets ?? config.target, channel: target.channels[0], labels: font(config.labels) },
  };
  if (target.kind === 'title') {
    const args = target.part ? { [target.part]: font(config[target.part]) }
      : { titleStyle: font(config.titleStyle), subtitleStyle: font(config.subtitleStyle), gap: round(config.gap * factor) };
    if (config.lineHeight) args.lineHeight = Math.max(config.lineHeight * factor, args.titleStyle?.fontSize ?? config.titleStyle.fontSize, args.subtitleStyle?.fontSize ?? config.subtitleStyle.fontSize);
    return { method: 'editTitle', args };
  }
  if (target.kind === 'axis') {
    const method = target.method ?? `edit${target.channel.toUpperCase()}AxisTitle`;
    const args = { ...target.args, ...(method === 'editParallelAxis' ? { title: font(config) } : font(config)) };
    return target.facet ? { method: 'editFacetSource', args: { action: { method, options: args } } } : { method, args };
  }
  const args = { target: target.editTargets ?? config.target, channel: target.channels[0], labels: font(config.labels), titleStyle: font(config.titleStyle) };
  // Normalized gradient configs retain itemGap for layout bookkeeping, but
  // the public edit contract only accepts it for legends made of discrete items.
  if (target.representation !== 'gradient' && Number.isFinite(config.itemGap)) args.itemGap = round(config.itemGap * factor);
  if (config.labels.offset !== undefined) args.labels.offset = round(config.labels.offset * factor);
  const scaleDimensions = value => {
    const result = structuredClone(value);
    for (const key of ['width','height','length','radius','size','strokeWidth','lineWidth','thickness'])
      if (Number.isFinite(result[key])) result[key] = Math.max(.1, round(result[key] * factor));
    return result;
  };
  if (target.representation === 'gradient') {
    args.gradient = scaleDimensions(config.gradient);
  } else if (config.symbol?.layers && !config.sizeAreas) args.symbol = { layers: config.symbol.layers.map(scaleDimensions) };
  else if (config.symbol && !['size','strokeWidth','colorSize'].includes(target.family)) args.symbol = scaleDimensions(config.symbol);
  if (config.border && typeof config.border === 'object') args.border = { ...config.border, padding: round(config.border.padding * factor) };
  return { method: 'editLegend', args };
}

export function moveGuide(program, target, x, y, drag) {
  if (target.childPath || target.facetTarget) {
    const local = moveGuide(target.localProgram, target.localTarget ?? target.facetTarget, x - target.offset.x, y - target.offset.y, drag);
    const call = target.childPath ? scopedCall(local, [{ childPath: target.childPath }]) : facetSourceCall(local);
    return local.dockKey ? { ...call, dockKey: target.key } : call;
  }
  if (target.kind === 'legend' && target.part === 'labels') return { method: 'editLegend', args: {
    target: target.editTargets ?? target.config.target, channel: target.channels[0], itemsOffset: {
      x: round((target.config.itemsOffset?.x ?? 0) + (drag?.dx ?? x - (target.bounds.left + target.bounds.right) / 2)),
      y: round((target.config.itemsOffset?.y ?? 0) + (drag?.dy ?? y - (target.bounds.top + target.bounds.bottom) / 2)),
    },
  } };
  if (target.kind === 'annotation') return annotationCall(target, 'editTextMark', {
    dx: round((target.config.dx ?? 0) + (drag?.dx ?? x - (target.bounds.left + target.bounds.right) / 2)),
    dy: round((target.config.dy ?? 0) + (drag?.dy ?? y - (target.bounds.top + target.bounds.bottom) / 2)),
  });
  const geometry = canvasGeometry(program);
  const p = program.compositionSpec && !program.compositionSpec.facet ? compositionPlotBounds(program)
    : geometry.plotBounds ?? { x: geometry.x, y: geometry.y, ...geometry.plot };
  const nx = (x - p.x - p.width / 2) / Math.max(1, p.width / 2);
  const ny = (y - p.y - p.height / 2) / Math.max(1, p.height / 2);
  let position = Math.abs(nx) > Math.abs(ny) ? nx < 0 ? 'left' : 'right' : ny < 0 ? 'top' : 'bottom';
  const current = target.placement?.position ?? target.config.position;
  if (target.kind === 'axis') position = target.channel === 'x' ? ny < 0 ? 'top' : 'bottom' : nx < 0 ? 'left' : 'right';
  // Pointer movement is relative to the grabbed guide, not its nearest edge.
  // A generous screen-space threshold prevents tiny drags from redocking it.
  const fine = current && drag && Math.hypot(drag.dx, drag.dy) < (drag.snapDistance ?? 48);
  if (fine) {
    position = current;
    const horizontal = ['top', 'bottom'].includes(position), near = ['top', 'left'].includes(position);
    const deltaAlong = horizontal ? drag.dx : drag.dy;
    const deltaOut = (near ? -1 : 1) * (horizontal ? drag.dy : drag.dx);
    if (target.kind === 'title') return { method: 'editTitle', args: { position, align: target.config.align,
      offset: round(target.config.offset + (program.compositionSpec ? -deltaOut : deltaOut)),
      alongOffset: round((target.config.alongOffset ?? 0) + deltaAlong) } };
    if (target.kind === 'axis') {
      const value = target.config.offset;
      const offset = typeof value === 'object' ? { ...value, gap: Math.max(0, round(value.gap + deltaOut)) } : round(value + deltaOut);
      const action = { method: `edit${target.channel.toUpperCase()}AxisTitle`, args: { ...target.args, position, offset,
        alongOffset: round((target.config.alongOffset ?? 0) + deltaAlong) } };
      return target.facet ? { method: 'editFacetSource', args: { action: { method: action.method, options: action.args } } } : action;
    }
    const b = target.anchorBounds ?? guideBounds(restoreLegendItemsOffset(program), target.ids) ?? target.bounds;
    // Consecutive moves replace one history call against the run's original
    // program. Carry the current layout so a small nudge cannot restore the
    // original side's columns or gradient orientation.
    const layout = target.representation === 'gradient'
      ? (target.config.gradientDirection ? { direction: target.config.gradientDirection } : {})
      : target.family === 'opacity' ? {} : Object.fromEntries(['layout','direction','columns']
        .filter(key => target.config[key] !== undefined).map(key => [key, target.config[key]]));
    if (position.includes('-')) {
      const top = position.startsWith('top'), left = position.endsWith('left');
      const offset = Math.max(0, round((top ? b.top-p.y : p.y+p.height-b.bottom) + (top ? drag.dy : -drag.dy)));
      const anchor = left ? p.x+offset : p.x+p.width-offset-(b.right-b.left);
      return { method: 'editLegend', args: { target: target.editTargets ?? target.config.target, channel: target.channels[0],
        position, ...layout, offset, alongOffset: round(b.left+drag.dx-anchor) } };
    }
    const offset = position === 'right' ? b.left - p.x - p.width : position === 'left' ? p.x - b.right
      : position === 'top' ? p.y - b.bottom : b.top - p.y - p.height;
    const alongOffset = horizontal ? (b.left + b.right - 2*p.x - p.width)/2 : b.top - p.y;
    return { method: 'editLegend', args: { target: target.editTargets ?? target.config.target, channel: target.channels[0],
      position, ...layout, align: 'center', offset: Math.max(0, round(offset + deltaOut)), alongOffset: round(alongOffset + deltaAlong),
      ...(target.config.titlePosition === undefined ? {} : { titlePosition: target.config.titlePosition }) } };
  }
  const along = ['top','bottom'].includes(position) ? (x-p.x)/p.width : (y-p.y)/p.height;
  const align = along < .33 ? 'left' : along > .67 ? 'right' : 'center';
  if (target.kind === 'axis') {
    const action = { method: `edit${target.channel.toUpperCase()}AxisTitle`, args: { ...target.args, position,
      offset: typeof target.config.offset === 'object' ? target.config.offset : Math.abs(target.config.offset), alongOffset: 0 } };
    return target.facet ? { method: 'editFacetSource', args: { action: { method: action.method, options: action.args } } } : action;
  }
  if (target.kind === 'title') return { method: 'editTitle', args: { position, align, offset: 0, alongOffset: 0 } };
  return dockLegend(program, target, position, align);
}

export function dockLegend(program, target, position, align = 'center', excludeKeys = new Set([target.key])) {
  if (target.childPath || target.facetTarget) {
    const local = dockLegend(target.localProgram, target.localTarget ?? target.facetTarget, position, align);
    return { ...(target.childPath ? scopedCall(local, [{ childPath: target.childPath }]) : facetSourceCall(local)), dockKey: target.key };
  }
  const geometry = canvasGeometry(program);
  const p = program.compositionSpec ? compositionPlotBounds(program)
    : { x: geometry.x, y: geometry.y, ...geometry.plot };
  const args = { target: target.editTargets ?? target.config.target, channel: target.channels[0], position,
    align: ['left','right'].includes(position) ? 'center' : align,
    ...legendDockLayout(legendDockMetrics(program, target, p.width), position) };
  // Snap to the occupied axis lane, not to the cursor's distance or an offset
  // accumulated on another edge. Keep independently authored item offsets.
  args.offset = target.editTargets ? 8 + compositionLegendEdgeClearance(p, prepareCompositionSnapshots(program).retainedBounds, position)
    : resolveLegendAxisOffset(program, { ...target.config, position, layout: 'edge', inferredOffset: true, offset: 8 }, p);
  if (program.compositionSpec?.facet) {
    const ids = program.compositionSpec.children.flatMap(child => retainedFacetGuideIds(program, child)
      .map(id => namespaceGraphicId(`${program.compositionSpec.id}-${child}`, id)));
    ids.push(facetHeaderGraphicId(program.compositionSpec.id));
    const retained = ids.map(id => guideBounds(program, [id])).filter(Boolean);
    args.offset = 8 + compositionLegendEdgeClearance(p, retained, position);
  }
  const occupied = selectableGuides(program).filter(guide => guide.kind === 'legend' && !guide.part &&
    !excludeKeys.has(guide.key) && (guide.placement?.position ?? guide.config.position) === position).map(guide => guide.bounds);
  if (occupied.length) args.offset = Math.max(args.offset, 24 + compositionLegendEdgeClearance(p, occupied, position));
  args.alongOffset = 0;
  return { method: 'editLegend', args, dockKey: target.key };
}
