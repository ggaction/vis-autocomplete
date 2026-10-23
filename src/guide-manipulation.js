import { findGraphic } from '../vendor/ggaction/src/grammar/schemas/graphicTree.js';
import { resolveConcreteGraphicBounds } from '../vendor/ggaction/src/grammar/schemas/graphicBounds.js';
import { axisGraphicIds, legendGraphicIds } from '../vendor/ggaction/src/materialization/guides/resources.js';
import { cartesianAxisOwners, axisTargetArgs } from '../vendor/ggaction/src/selectors/axes.js';
import { legendBlockChannels } from '../vendor/ggaction/src/grammar/legendBlocks.js';
import { canvasGeometry } from './canvas-geometry.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = n => Math.round(n * 4) / 4;
export function guideBounds(program, ids) {
  const bounds = ids.filter(id => findGraphic(program.graphicSpec, id)).map(id =>
    resolveConcreteGraphicBounds(program.graphicSpec, id, program.materializationConfigs?.textMetrics)).filter(Boolean);
  if (!bounds.length) return null;
  return { left: Math.min(...bounds.map(b => b.left)), right: Math.max(...bounds.map(b => b.right)),
    top: Math.min(...bounds.map(b => b.top)), bottom: Math.max(...bounds.map(b => b.bottom)) };
}

export function editableGuides(program) {
  const objects = program.graphicSpec.objects, targets = [];
  const add = target => { const bounds = guideBounds(program, target.ids); if (bounds) targets.push({ ...target, bounds }); };
  if (program.titleConfig && objects.chartTitle) {
    const config = program.titleConfig;
    add({ key: 'title', label: 'Title', kind: 'title', part: 'titleStyle', config, ids: ['chartTitle'], movable: true });
    if (objects.chartSubtitle) {
      add({ key: 'subtitle', label: 'Subtitle', kind: 'title', part: 'subtitleStyle', config, ids: ['chartSubtitle'], movable: true });
      add({ key: 'title-group', label: 'Title + subtitle', kind: 'title', config, ids: ['chartTitle', 'chartSubtitle'], movable: true });
    }
  }
  const findIds = ids => Object.keys(objects).filter(id => ids.some(native => id === native || id.endsWith(`_${native}`)));
  for (const owner of cartesianAxisOwners(program)) {
    if (!owner.config?.title) continue;
    const ids = findIds([axisGraphicIds(owner.channel, owner.id)[3]]);
    for (const id of ids) add({ key: `axis:${id}`, label: `${owner.channel.toUpperCase()} axis title`, kind: 'axis',
      config: owner.config.title, channel: owner.channel, args: axisTargetArgs(owner.id, owner.channel), ids: [id],
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
      add({ key: `axis:${item.id ?? id}`, label: `${dimension.field} axis title`, kind: 'axis',
        config: dimension.title, method: 'editParallelAxis', args: { target: parallel.target, field: dimension.field },
        ids: [item.id ?? id], facet: Boolean(program.compositionSpec?.facet) });
    }
  }
  const configs = program.guideConfigs.legend ?? Object.values(program.children ?? {}).find(child => child.guideConfigs.legend)?.guideConfigs.legend ?? {};
  for (const [kind, config] of Object.entries(configs)) {
    const ids = findIds(legendGraphicIds(kind));
    if (!ids.length) continue;
    add({ key: `legend:${kind}`, label: `${config.title || 'Legend'} legend`, kind: 'legend', family: kind,
      config, ids, movable: true, channels: legendBlockChannels(kind, config) });
  }
  return targets;
}

// Every manipulation is one native domain edit. The regular preparer owns
// margin fitting, collisions, guide refresh and facet source replay.
export function resizeGuide(target, factor) {
  factor = clamp(factor, .25, 4);
  const config = target.config;
  const font = style => ({ fontSize: clamp(round(style.fontSize * factor), 6, 96) });
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
  const args = { target: config.target, channel: target.channels[0], labels: font(config.labels), titleStyle: font(config.titleStyle) };
  if (Number.isFinite(config.itemGap)) args.itemGap = round(config.itemGap * factor);
  if (config.labels.offset !== undefined) args.labels.offset = round(config.labels.offset * factor);
  const scaleDimensions = value => {
    const result = structuredClone(value);
    for (const key of ['width','height','length','radius','size','strokeWidth','lineWidth','thickness'])
      if (Number.isFinite(result[key])) result[key] = Math.max(.1, round(result[key] * factor));
    return result;
  };
  if (config.symbol?.layers && !config.sizeAreas) args.symbol = { layers: config.symbol.layers.map(scaleDimensions) };
  else if (config.symbol && !['size','strokeWidth','colorSize'].includes(target.family)) args.symbol = scaleDimensions(config.symbol);
  if (config.gradient) args.gradient = scaleDimensions(config.gradient);
  if (config.border && typeof config.border === 'object') args.border = { ...config.border, padding: round(config.border.padding * factor) };
  return { method: 'editLegend', args };
}

export function moveGuide(program, target, x, y) {
  const geometry = canvasGeometry(program);
  const p = geometry.plotBounds ?? { x: geometry.x, y: geometry.y, ...geometry.plot };
  const nx = (x - p.x - p.width / 2) / Math.max(1, p.width / 2);
  const ny = (y - p.y - p.height / 2) / Math.max(1, p.height / 2);
  const position = Math.abs(nx) > Math.abs(ny) ? nx < 0 ? 'left' : 'right' : ny < 0 ? 'top' : 'bottom';
  const along = ['top','bottom'].includes(position) ? (x-p.x)/p.width : (y-p.y)/p.height;
  const align = along < .33 ? 'left' : along > .67 ? 'right' : 'center';
  if (target.kind === 'title') return { method: 'editTitle', args: { position, align, offset: 0, alongOffset: 0 } };
  const args = { target: target.config.target, channel: target.channels[0], position,
    align: ['left','right'].includes(position) ? 'center' : align };
  // Moving an inline horizontal title to a side requires native top placement.
  if (target.config.titlePosition === 'left' && ['left','right'].includes(position)) args.titlePosition = 'top';
  return { method: 'editLegend', args };
}
