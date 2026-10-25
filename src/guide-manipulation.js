import { findGraphic } from '../vendor/ggaction/src/grammar/schemas/graphicTree.js';
import { resolveConcreteGraphicBounds } from '../vendor/ggaction/src/grammar/schemas/graphicBounds.js';
import { axisGraphicIds, legendGraphicIds } from '../vendor/ggaction/src/materialization/guides/resources.js';
import { cartesianAxisOwners, axisTargetArgs } from '../vendor/ggaction/src/selectors/axes.js';
import { legendBlockChannels, describeLegendBlock } from '../vendor/ggaction/src/grammar/legendBlocks.js';
import { scopedCall } from './composition-context.js';
import { prepareCompositionSnapshots, compositionPlotBounds } from '../vendor/ggaction/src/materialization/composition.js';
import { sharedCompositionColorLegend } from '../vendor/ggaction/src/materialization/compositionLegends.js';
import { namespaceGraphicId } from '../vendor/ggaction/src/materialization/compositionSnapshot.js';
import { canvasGeometry } from './canvas-geometry.js';
import { localLegendPlacement } from '../vendor/ggaction/src/grammar/legendGroups.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = n => Math.round(n * 4) / 4;
export function guideMoveHistoryKey(target) {
  if (target.childPath) return `${JSON.stringify(target.childPath)}/${guideMoveHistoryKey(target.localTarget)}`;
  if (target.kind === 'title') return 'move:title';
  if (target.kind === 'axis') return `move:axis:${target.channel}:${JSON.stringify(target.args)}`;
  return `move:${target.key}`;
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
    const shared = sharedCompositionColorLegend(program, children);
    const sharedId = `${program.compositionSpec.id}-shared-color-legend`;
    if (shared && program.graphicSpec.objects[sharedId]) titles.push({
      key: 'legend:shared-color', kind: 'legend', label: 'Shared color legend',
      ids: [sharedId], bounds: guideBounds(program, [sharedId]), movable: true,
      config: shared.config, placement: shared.placement, family: shared.block.kind, channels: shared.channels,
      representation: shared.block.family, editTargets: shared.targets,
      remove: { method: 'removeLegend', args: { target: shared.targets, channels: ['color'], suppress: true } },
    });
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
  const configs = program.guideConfigs.legend ?? Object.values(program.children ?? {}).find(child => child.guideConfigs.legend)?.guideConfigs.legend ?? {};
  for (const [kind, config] of Object.entries(configs)) {
    const ids = findIds(legendGraphicIds(kind));
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
    ...(target.localTarget ? { localTarget: withPart(target.localTarget, part) } : {}) });
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
        JSON.stringify(ownerPath(g)) === JSON.stringify(ownerPath(legend)) && JSON.stringify(g.editTargets) === JSON.stringify(legend.editTargets));
      if (existing) { existing.legendKey = legend.key; existing.legendPart = scope; continue; }
      const partIds = ids.filter(id => part === 'titleStyle' ? id.endsWith('Title') : !/Title$|Border$/.test(id));
      const bounds = guideBounds(program, partIds);
      if (!bounds) continue;
      guides.push({ ...withPart(legend, part), key: `${legend.key}:${scope}`, label: `${legend.label} ${label}`,
        ids: partIds, bounds, movable: part === 'labels', moveTarget: part === 'labels' ? legend : undefined,
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
    const config = target.config;
    const entry = (style, method, args, slot) => style ? [{ config: style, call: value => ({ method,
      args: { ...args, ...(slot ? { [slot]: value } : value) } }) }] : [];
    if (target.kind === 'title') return (target.part ? [target.part] : ['titleStyle', 'subtitleStyle'])
      .flatMap(part => entry(config[part], 'editTitle', {}, part));
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
  if (target.remove) return target.remove;
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
  factor = clamp(factor, .25, 4);
  const config = target.config;
  const font = style => ({ fontSize: clamp(round(style.fontSize * factor), 6, 96) });
  if (target.kind === 'legend' && target.part === 'titleStyle') return {
    method: 'editLegend', args: { target: target.editTargets ?? config.target, channel: target.channels[0], titleStyle: font(config.titleStyle) },
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
  if (target.childPath) return scopedCall(moveGuide(target.localProgram, target.localTarget, x - target.offset.x, y - target.offset.y, drag), [{ childPath: target.childPath }]);
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
  const fine = current && drag && (Math.hypot(drag.dx, drag.dy) < (drag.snapDistance ?? 48) || position === current);
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
    const b = target.bounds;
    if (position.includes('-')) {
      const top = position.startsWith('top'), left = position.endsWith('left');
      const offset = Math.max(0, round((top ? b.top-p.y : p.y+p.height-b.bottom) + (top ? drag.dy : -drag.dy)));
      const anchor = left ? p.x+offset : p.x+p.width-offset-(b.right-b.left);
      return { method: 'editLegend', args: { target: target.editTargets ?? target.config.target, channel: target.channels[0],
        position, offset, alongOffset: round(b.left+drag.dx-anchor) } };
    }
    const offset = position === 'right' ? b.left - p.x - p.width : position === 'left' ? p.x - b.right
      : position === 'top' ? p.y - b.bottom : b.top - p.y - p.height;
    const alongOffset = horizontal ? (b.left + b.right - 2*p.x - p.width)/2 : b.top - p.y;
    return { method: 'editLegend', args: { target: target.editTargets ?? target.config.target, channel: target.channels[0],
      position, align: 'center', offset: Math.max(0, round(offset + deltaOut)), alongOffset: round(alongOffset + deltaAlong),
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
  const args = { target: target.editTargets ?? target.config.target, channel: target.channels[0], position,
    align: ['left','right'].includes(position) ? 'center' : align,
    ...(target.config.titlePosition === undefined ? {} : { titlePosition: target.config.titlePosition }) };
  // Moving an inline horizontal title to a side requires native top placement.
  if (target.config.titlePosition === 'left' && ['left','right'].includes(position)) args.titlePosition = 'top';
  if (drag) args.alongOffset = 0;
  return { method: 'editLegend', args };
}
