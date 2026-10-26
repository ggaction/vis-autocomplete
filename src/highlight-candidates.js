import { getMarkItems } from 'ggaction/inspection';

const cache = new WeakMap();
const scalar = value => value === null || ['string', 'boolean'].includes(typeof value) || Number.isFinite(value);

// Derive selectors from final item grain. A chart-name allowlist loses valid
// polar/composite/derived marks and offers invalid raw-row predicates on paths.
export function highlightContext(program, layer) {
  if (!layer) return null;
  let targets = cache.get(program);
  if (!targets) cache.set(program, targets = new Map());
  if (targets.has(layer.id)) return targets.get(layer.id);
  const grains = [];
  for (const grain of ['item', 'stack']) {
    let items;
    try {
      const views = program.compositionSpec?.facet ? Object.values(program.children) : [program];
      items = views.flatMap(view => getMarkItems(view, { target: layer.id, grain }))
        .filter(item => item.target === layer.id);
    } catch { continue; }
    if (!items.length) continue;
    const sources = [];
    for (const [source, bag] of [['field', 'fields'], ['channel', 'channels'], ['property', 'properties']]) {
      const keys = Object.keys(items[0][bag]);
      for (const name of keys) {
        if (!items.every(item => Object.hasOwn(item[bag], name) && scalar(item[bag][name]))) continue;
        const values = [...new Set(items.map(item => item[bag][name]))];
        const numeric = values.every(Number.isFinite);
        if (numeric) values.sort((a, b) => a - b);
        sources.push({ key: `${source}:${name}`, source, name, numeric, values,
          label: `${name}${source === 'channel' ? ' (channel)' : source === 'property' ? ' (geometry)' : ''}` });
      }
    }
    if (sources.length) grains.push({ grain, count: items.length, sources });
  }
  const result = grains.length ? { mark: layer.mark.type, grains } : null;
  targets.set(layer.id, result);
  return result;
}

export function highlightCandidates(program, layer) {
  const context = highlightContext(program, layer);
  if (!context) return [];
  const grain = context.grains[0];
  const source = grain.sources.find(s => s.source === 'field' && !s.numeric && s.values.length > 1)
    ?? grain.sources.find(s => s.numeric && s.values.length > 1) ?? grain.sources[0];
  const previous = program.materializationConfigs.selections?.[`${layer.id}Highlight`];
  const select = previous?.selector ?? { grain: grain.grain, [source.source]: source.name,
    ...(source.numeric ? { op: 'max', count: 1 } : { op: 'oneOf', values: [source.values[0]] }) };
  const out = [{ method: 'highlightMarks', args: { id: `${layer.id}Highlight`, target: layer.id, select, color: program.materializationConfigs.highlights?.[`${layer.id}Highlight`]?.style?.fill === '#dc2626' || program.materializationConfigs.highlights?.[`${layer.id}Highlight`]?.style?.stroke === '#dc2626' ? '#2563eb' : '#dc2626', dimOthers: { opacity: .2 } },
    label: 'Highlight marks', category: 'style', feature: 'action.highlightMarks', highlightContext: context }];
  for (const [selection, highlight] of Object.entries(program.materializationConfigs.highlights ?? {})) {
    if (highlight.target !== layer.id) continue;
    out.push({ method: 'removeMarkHighlight', args: { selection }, label: 'Remove highlight', category: 'style',
      feature: 'action.removeMarkHighlight', parameterMode: 'presets' });
  }
  return out;
}
