import { cartesianAxisOwners, axisTargetArgs, axisGraphicIds } from '../vendor/ggaction/src/selectors/axes.js';
import { legendGraphicIds } from '../vendor/ggaction/src/materialization/guides/resources.js';
import { legendBlockChannels } from '../vendor/ggaction/src/grammar/legendBlocks.js';
import { resolveEffectiveThemeFrame } from '../vendor/ggaction/src/actions/theme/state.js';
import { namespaceGraphicId } from '../vendor/ggaction/src/materialization/compositionSnapshot.js';
import { findGraphic } from '../vendor/ggaction/src/grammar/schemas/graphicTree.js';
import { resolveConcreteGraphicBounds, resolveGraphicParentOffset } from '../vendor/ggaction/src/grammar/schemas/graphicBounds.js';
import { resolveTextBounds } from '../vendor/ggaction/src/core/textMetrics.js';
import { scopedCall } from './composition-context.js';
import { prepareGuidedAction } from './prepare.js';
import { signature } from './cache.js';
import { selectedGuideTextTargets } from './guide-manipulation.js';

export const TEXT_GROUPS = [
  ['ticks', 'Axis tick labels'], ['axisTitles', 'Axis titles'], ['titles', 'Chart titles'],
  ['subtitles', 'Subtitles'], ['legendLabels', 'Legend labels'], ['legendTitles', 'Legend titles'],
  ['facetHeaders', 'Facet headers'], ['markLabels', 'Mark labels'],
].map(([id, label]) => ({ id, label }));

// A toolbar edit is an atomic sequence of existing public domain calls. These
// roles are UI selections, never synthetic ggaction action names or graphics edits.
export function chartTextTargets(program) {
  const result = [];
  function visit(p, wrap = call => call) {
    const add = (group, config, method, args, slot, source = false) => {
      if (!config) return;
      result.push({ group, config, call(style) {
        if (method === "editFacetHeaders" && style.align) style = { ...style, align: { left: "start", center: "center", right: "end" }[style.align] };
        let call = { method, args: { ...args, ...(slot ? { [slot]: style } : style) } };
        // A facet's shared guide is owned by the facet container. A scoped
        // selector with an id would instead target its generated source mark.
        if (p.compositionSpec?.facet && method === 'editLegend') delete call.args.target;
        if (source && p.compositionSpec?.facet) call = { method: 'editFacetSource', args: { action: { method, options: call.args } } };
        return wrap(call);
      } });
    };
    if (p.titleConfig) {
      if (p.graphicSpec.objects.chartTitle) add('titles', p.titleConfig.titleStyle, 'editTitle', {}, 'titleStyle');
      if (p.graphicSpec.objects.chartSubtitle) add('subtitles', p.titleConfig.subtitleStyle, 'editTitle', {}, 'subtitleStyle');
    }
    if (p.compositionSpec && !p.compositionSpec.facet) {
      for (const [id, child] of Object.entries(p.children)) visit(child, call => wrap(scopedCall(call, [{ childPath: [id] }])));
      return;
    }
    for (const owner of cartesianAxisOwners(p)) {
      const method = `edit${owner.channel.toUpperCase()}Axis`;
      add('ticks', owner.config?.labels, method, axisTargetArgs(owner.id, owner.channel), 'labels', true);
      add('axisTitles', owner.config?.title, method, axisTargetArgs(owner.id, owner.channel), 'title', true);
    }
    for (const [channel, prefix] of [['theta', 'Theta'], ['radius', 'Radial']]) {
      const axis = p.guideConfigs.axis?.[channel];
      add('ticks', axis?.labels, `edit${prefix}AxisLabels`, {}, null, true);
      add('axisTitles', axis?.title, `edit${prefix}AxisTitle`, {}, null, true);
    }
    const parallel = p.guideConfigs.axis?.parallel?.axes;
    for (const dimension of parallel?.dimensions ?? []) {
      const args = { target: parallel.target, field: dimension.field };
      add('ticks', dimension.labels, 'editParallelAxis', args, 'labels', true);
      add('axisTitles', dimension.title, 'editParallelAxis', args, 'title', true);
    }
    for (const [kind, config] of Object.entries(p.guideConfigs.legend ?? {})) {
      const args = { target: config.target, channel: legendBlockChannels(kind, config)[0] };
      add('legendLabels', config.labels, 'editLegend', args, 'labels');
      if (config.titleVisible !== false) add('legendTitles', config.titleStyle, 'editLegend', args, 'titleStyle');
    }
    const headers = p.materializationConfigs.facets?.[p.compositionSpec?.id]?.headers;
    if (headers) {
      if (headers.mode === 'roles') for (const role of ['row', 'column']) {
        add('facetHeaders', { ...headers.common, ...headers[role] }, 'editFacetHeaders', { role });
        add('facetHeaders', headers[role]?.title, 'editFacetHeaders', { role }, 'title');
      } else add('facetHeaders', headers.common, 'editFacetHeaders', {});
    }
    for (const layer of p.semanticSpec.layers) if (layer.mark?.type === 'text') {
      add('markLabels', p.markConfigs[layer.id] ?? layer.mark, 'editTextMark', { target: layer.id }, null, true);
    }
  }
  visit(program);
  return result;
}

// Classify visible native text objects by their owner, including collected
// legends and namespaced facet/concat graphics. Actual item bounds drive the
// highlight, so hidden labels and removed titles are never underlined.
export function chartTextItems(program) {
  const roles = new Map();
  function visit(p, map = id => id) {
    const add = (ids, role) => ids.forEach(id => roles.set(map(id), role));
    add(['chartTitle'], 'titles'); add(['chartSubtitle'], 'subtitles');
    if (p.compositionSpec) {
      const spec = p.compositionSpec;
      for (const [id, child] of Object.entries(p.children)) visit(child, name => map(namespaceGraphicId(`${spec.id}-${id}`, name)));
      if (spec.facet) add([`${spec.id}-headers`, `${spec.id}-row-title`, `${spec.id}-column-title`], 'facetHeaders');
    }
    for (const owner of cartesianAxisOwners(p)) {
      const ids = axisGraphicIds(owner.channel, owner.id); add([ids[2]], 'ticks'); add([ids[3]], 'axisTitles');
    }
    for (const channel of ['theta', 'radius', 'parallel']) {
      const ids = axisGraphicIds(channel); add([ids[2]], 'ticks'); add([ids[3]], 'axisTitles');
    }
    for (const kind of Object.keys(p.guideConfigs.legend ?? {})) for (const id of legendGraphicIds(kind)) {
      if (id.endsWith('Labels')) add([id], 'legendLabels');
      if (id.endsWith('Title')) add([id], 'legendTitles');
    }
    for (const layer of p.semanticSpec.layers) if (layer.mark?.type === 'text') add([layer.id], 'markLabels');
  }
  visit(program);
  const output = [];
  for (const [id, object] of Object.entries(program.graphicSpec.objects)) {
    if (object.type !== 'text' && !object.items?.some(item => item.type === 'text')) continue;
    // Collected guide copies retain their native suffix under an owner namespace.
    const role = roles.get(id) ?? (/LegendLabels$/.test(id) ? 'legendLabels' : /LegendTitle$/.test(id) ? 'legendTitles' : null);
    if (!role) continue;
    for (const item of object.items ?? [{ id, properties: object.properties }]) {
      if (object.type !== 'text' && item.type !== 'text') continue;
      if (item.properties?.text === '' || item.properties?.opacity === 0) continue;
      output.push({ ...object.properties, ...item.properties, id: item.id, group: role });
    }
  }
  return output;
}

export function textUnderlines(program, groups) {
  return chartTextItems(program).filter(item => groups.includes(item.group)).flatMap(item => {
    const bounds = findGraphic(program.graphicSpec, item.id) && resolveConcreteGraphicBounds(program.graphicSpec, item.id, program.materializationConfigs.textMetrics);
    if (!bounds) return [];
    const local = resolveTextBounds({ ...item, rotation: 0 }, program.materializationConfigs.textMetrics);
    const [ox, oy] = resolveGraphicParentOffset(program.graphicSpec, item.id);
    const rotation = item.rotation ?? 0, cosine = Math.cos(rotation), sine = Math.sin(rotation);
    const dx = local.left-item.x, dy = local.bottom-item.y+1;
    return [{ ...bounds, group: item.group, id: item.id, rotation,
      x: ox+item.x+dx*cosine-dy*sine, y: oy+item.y+dx*sine+dy*cosine, length: local.right-local.left }];
  });
}

export function typographyCalls(program, { groups = TEXT_GROUPS.map(g => g.id), elements, fontSize, delta, deltas, fontFamily, align }) {
  if (fontSize !== undefined && (!Number.isFinite(fontSize) || fontSize < 6 || fontSize > 96)) throw new Error('Font size must be between 6 and 96.');
  if (delta !== undefined && ![-1, 1].includes(delta)) throw new Error('Font size step must be −1 or +1.');
  if (deltas !== undefined && (!Array.isArray(deltas) || !deltas.every(n => [-1, 1].includes(n)))) throw new Error('Invalid font size steps.');
  if (fontFamily !== undefined && (typeof fontFamily !== 'string' || !fontFamily.trim())) throw new Error('Choose a font family.');
  if (align !== undefined && !['left','center','right'].includes(align)) throw new Error('Choose left, center or right alignment.');
  const calls = [];
  if (fontFamily && !elements) {
    function themes(p, wrap = call => call) {
      // Preserve every existing color token, and override only font defaults.
      const theme = resolveEffectiveThemeFrame(p.materializationConfigs.theme);
      const tokens = { ...theme?.tokens, fontFamily, axisLabelFontFamily: fontFamily, axisTitleFontFamily: fontFamily };
      calls.push(wrap({ method: 'applyTheme', args: { theme: { base: theme?.name ?? 'light', tokens }, ...(p.compositionSpec && !p.compositionSpec.facet ? { scope: 'self' } : {}) } }));
      if (p.compositionSpec && !p.compositionSpec.facet) for (const [id, child] of Object.entries(p.children)) themes(child, call => wrap(scopedCall(call, [{ childPath: [id] }])));
    }
    themes(program);
  }
  for (const target of elements ? selectedGuideTextTargets(program, elements) : chartTextTargets(program)) {
    if (!elements && !fontFamily && !groups.includes(target.group)) continue;
    const adjusted = () => (deltas ?? [delta]).reduce((size, step) => Math.max(6, Math.min(96, size + step)), target.config.fontSize ?? 12);
    const style = align ? { align } : fontFamily ? { fontFamily } : { fontSize: fontSize ?? adjusted() };
    calls.push(target.call(style));
  }
  // One owner can expose several selected roles (axis labels + title, legend
  // labels + title). Edit that native owner once, fitting its layout once.
  const merged = new Map();
  const identity = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
      if (['fontSize', 'fontFamily', 'align'].includes(key)) return [];
      const next = identity(child);
      return next && typeof next === 'object' && !Array.isArray(next) && !Object.keys(next).length ? [] : [[key, next]];
    }));
  };
  const merge = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(key =>
    [key, a[key] && b[key] && typeof a[key] === 'object' && typeof b[key] === 'object' && !Array.isArray(b[key])
      ? merge(a[key], b[key]) : b[key] ?? a[key]]));
  for (const call of calls) {
    const key = signature(call.method === 'applyTheme' ? call : identity(call));
    merged.set(key, merged.has(key) ? merge(merged.get(key), call) : call);
  }
  return [...merged.values()];
}

export function prepareTypography(program, view, options) {
  const calls = []; let guideCall;
  for (const action of options.calls ?? typographyCalls(view, options)) {
    // Applying the theme already updates inherited fonts. Only emit explicit
    // domain edits for remaining overrides; shared legend contributors likewise
    // need one edit, even when several panels reference the collected block.
    if (action.method !== 'applyTheme') {
      const style = {};
      const identity = value => {
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(identity);
        return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
          if (['fontSize', 'fontFamily', 'align'].includes(key)) { style[key] = child; return []; }
          return [[key, identity(child)]];
        }));
      };
      const key = signature(identity(action));
      const targets = chartTextTargets(view).filter(target => signature(target.call({})) === key);
      if (targets.length && targets.every(target => Object.entries(style).every(([property, value]) => target.config[property] === value))) continue;
    }
    try {
      const prepared = prepareGuidedAction(program, { ...action, allowUnchanged: true }, view);
      calls.push(...prepared.prerequisiteCalls, { method: prepared.recommendation.method, args: prepared.recommendation.args }, ...prepared.postActionCalls);
      program = prepared.authoringPreview; view = prepared.preview; guideCall = prepared.guideCall;
    } catch (error) { if (error.reason !== 'no-change') throw error; }
  }
  return { program, view, guideCall, calls };
}
