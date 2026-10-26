import { resolveMarkItems } from '../vendor/ggaction/src/materialization/selection/policies/index.js';
import { resolveMarkLabelValues } from '../vendor/ggaction/src/grammar/markLabels.js';
import { sourceValue } from '../vendor/ggaction/src/materialization/text.js';
import { validateSourceMarkLabelPlacement } from '../vendor/ggaction/src/materialization/text.js';

// Ignore only rounding differences at machine precision. Pick portable native
// format strings; do not replace the underlying values.
export function valueLabelFormat(values, maxCharacters = 8) {
  const numbers = [...new Set(values.filter(Number.isFinite).map(value => {
    const rounded = Number(value.toPrecision(12));
    return Math.abs(value - rounded) <= Number.EPSILON * Math.abs(value) * 2 ? rounded : value;
  }))];
  if (!numbers.length) return 'auto';
  const fractional = numbers.some(value => !Number.isInteger(value));
  const evaluate = (notation, decimals) => {
    const seen = new Set(); let width = 0;
    for (const value of numbers) {
      const text = notation === 'f' ? value.toFixed(decimals) : value.toExponential(decimals);
      if (value !== 0 && Math.abs(Number(text) - value) / Math.abs(value) > .005 || seen.has(text)) return;
      seen.add(text); width = Math.max(width, text.length);
    }
    return { format: `.${decimals}${notation}`, notation, decimals, width };
  };
  const first = (notation, start) => {
    for (let decimals = start; decimals <= 12; decimals++) {
      const result = evaluate(notation, decimals); if (result) return result;
    }
  };
  const fixed = first('f', fractional ? 2 : 0);
  if (fixed?.width <= maxCharacters) return fixed.format;
  // Scientific notation protects tiny nonzero values and keeps very large values
  // compact. Close values may need more room: readability must not merge them.
  const compact = [fixed, fractional ? first('f', 0) : undefined, first('e', 2)].filter(Boolean)
    .sort((a, b) => a.width - b.width || (a.notation === b.notation ? 0 : a.notation === 'f' ? -1 : 1) || a.decimals - b.decimals)[0];
  return compact?.format ?? '.12e';
}

const cache = new WeakMap();
function labelBindings(program, source, profile) {
  let sources = cache.get(program);
  if (!sources) cache.set(program, sources = new Map());
  if (sources.has(source.id)) return sources.get(source.id);
  const views = program.compositionSpec?.facet ? Object.values(program.children) : [program];
  const populations = views.map(view => ({ program: view,
    source: view.semanticSpec.layers.find(layer => layer.id === source.id), items: resolveMarkItems(view, source.id) }));
  const bindings = [];
  const add = (key, label, args, values, numeric) => {
    if (!values.some(value => value !== undefined && value !== null)) return;
    bindings.push({ key, label, args, numeric, automatic: numeric ? valueLabelFormat(values) : 'auto' });
  };
  if (['bar', 'arc'].includes(source.mark.type)) {
    for (const content of ['value', 'category', 'share']) {
      try { add(`content:${content}`, { value: 'Value', category: 'Category', share: 'Share of total' }[content],
        { content }, populations.flatMap(({ source, items }) => resolveMarkLabelValues(source, items, { content })), content !== 'category'); }
      catch { /* Only offer semantic content supported by this actual source. */ }
    }
  } else for (const field of profile.fields.filter(field => field.usable)) {
    add(`field:${field.name}`, field.name, { field: field.name }, populations.flatMap(({ source, items }) => items.map(item => sourceValue(item, source, field.name))), field.type === 'quantitative');
  }
  const anchors = ['center', 'insideStart', 'insideEnd', 'outsideStart', 'outsideEnd'].filter(anchor => {
    try { for (const view of views) validateSourceMarkLabelPlacement(view, source.id, { anchor }); return true; }
    catch { return false; }
  });
  // Keep automatic displacement bounded on dense marks. Numeric shortening
  // still applies to every label; never hide values to meet a layout budget.
  const count = Math.max(0, ...populations.map(population => population.items.length));
  const layout = count > 1000 ? false : { ...defaultLabelLayout,
    maxDisplacement: count > 500 ? 2 : count > 250 ? 6 : 12 };
  const result = { bindings, anchors, layout };
  sources.set(source.id, result);
  return result;
}

export const defaultLabelLayout = Object.freeze({ bounds: 'canvas', padding: 2, maxDisplacement: 12,
  leader: Object.freeze({ stroke: '#94a3b8', strokeWidth: .75 }) });

export function valueLabelCandidates(program, source, profile) {
  if (!['point', 'bar', 'rect', 'arc', 'rule', 'line'].includes(source.mark.type)) return [];
  let context;
  try { context = labelBindings(program, source, profile); }
  catch { return []; } // Incomplete marks have no label values yet.
  if (!context.bindings.length) return [];
  const labels = program.semanticSpec.layers.filter(layer => layer.source === source.id && program.markConfigs[layer.id]?.labelAuthoring);
  if (labels.length) return labels.map(layer => {
    const { field, content, datum, normalizeBy, format = 'auto' } = layer.encoding.text;
    let binding = context.bindings.find(binding => field !== undefined ? binding.args.field === field : binding.args.content === content);
    if (!binding) binding = { key: 'current', label: 'Current text', args: field !== undefined ? { field } : content ? { content } : { value: datum }, numeric: typeof datum === 'number', automatic: valueLabelFormat([datum]) };
    const decimals = format.match(/^,?\.(\d+)([f%e])$/);
    const proposed = binding.numeric ? binding.automatic !== format ? binding.automatic
      : `.${Math.min(12, (Number(decimals?.[1]) || 0) + 1)}${decimals?.[2] ?? 'f'}` : format;
    return { method: 'encodeText', args: { target: layer.id, ...binding.args, ...(normalizeBy ? { normalizeBy } : {}), format: proposed },
      allowUnchanged: true,
      category: 'encoding', feature: 'encoding.text', label: 'Edit value labels',
      labelContext: { ...context, bindings: context.bindings.includes(binding) ? context.bindings : [binding, ...context.bindings], creating: false, initial: binding.key } };
  });
  const field = ['y', 'x', 'color'].map(channel => source.encoding[channel]?.field)
    .find(field => context.bindings.some(binding => binding.args.field === field && binding.numeric));
  const binding = context.bindings.find(binding => binding.args.content === 'value') ??
    context.bindings.find(binding => binding.args.field === field) ?? context.bindings[0];
  const anchor = context.anchors.includes('outsideEnd') ? 'outsideEnd' : 'center';
  return [{ method: 'createMarkLabels', args: { source: source.id, ...binding.args, format: binding.automatic,
    fontSize: 11, ...(context.anchors.length ? { placement: { anchor, gap: 4 } } : {}), layout: structuredClone(context.layout) },
    category: 'encoding', feature: 'action.createMarkLabels', label: 'Add value labels',
    labelContext: { ...context, creating: true, initial: binding.key } }];
}
