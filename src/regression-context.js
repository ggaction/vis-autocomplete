import { MAX_WORK_ITEMS } from '../vendor/ggaction/src/core/validation.js';

// Mirror the public regression work/adequacy policy using counts only. This
// never fits candidate models or samples rows before a card is requested.
export function regressionContext(program, layer, profile) {
  if (layer?.mark?.type !== 'point' && !program.markConfigs[layer?.id]?.regression) return undefined;
  const { x, y } = layer?.encoding ?? {};
  if (x?.fieldType !== 'quantitative' || y?.fieldType !== 'quantitative') return undefined;
  const rows = (program.semanticSpec.datasets.find(d => d.id === layer.data)?.values ?? [])
    .filter(row => Number.isFinite(row[x.field]) && Number.isFinite(row[y.field]));
  const facet = program.compositionSpec?.facet;
  const facetFields = [facet?.field, facet?.grid?.rows?.field, facet?.grid?.columns?.field].filter(Boolean);
  const visualGroups = [layer.encoding.color, layer.encoding.shape]
    .filter(encoding => ['nominal', 'ordinal'].includes(encoding?.fieldType)).map(encoding => encoding.field);
  const currentGroup = program.markConfigs[layer.id]?.regression?.groupBy ?? '';
  const fields = ['', ...new Set([...profile.fields.filter(f => f.usable && ['nominal', 'ordinal'].includes(f.type)).map(f => f.name),
    ...visualGroups, ...facetFields, ...(currentGroup ? [currentGroup] : [])])];
  const groups = Object.fromEntries(fields.map(field => {
    const groups = new Map(), sourceGroups = new Map();
    const partitionFields = [...new Set([...facetFields, ...(field ? [field] : [])])];
    for (const row of rows) {
      // A facet fits each panel separately, even when Group is All observations.
      const key = JSON.stringify(partitionFields.map(name => row[name]));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
      if (facetFields.length) {
        const sourceKey = field ? row[field] : '';
        if (!sourceGroups.has(sourceKey)) sourceGroups.set(sourceKey, { count: 0, x: new Set() });
        const source = sourceGroups.get(sourceKey); source.count++; source.x.add(row[x.field]);
      }
    }
    let minDistinctX = Infinity, minRows = Infinity, loessWork = 0;
    for (const group of groups.values()) {
      const distinct = new Set(group.map(row => row[x.field])).size;
      minDistinctX = Math.min(minDistinctX, distinct);
      minRows = Math.min(minRows, group.length);
      loessWork += group.length * distinct * Math.ceil(Math.log2(group.length + 1));
    }
    // editFacetSource also fits the complete source before deriving panels.
    // Keep its work bound while using panel minima for statistical adequacy.
    loessWork = Math.max(loessWork, [...sourceGroups.values()].reduce((work, group) =>
      work + group.count * group.x.size * Math.ceil(Math.log2(group.count + 1)), 0));
    return [field, { minDistinctX: groups.size ? minDistinctX : 0, minRows: groups.size ? minRows : 0,
      loessWork, positiveY: rows.length > 0 && rows.every(row => row[y.field] > 0) }];
  }));
  // Bind to this chart, never to corpus field names or an arbitrary categorical
  // column. Color wins a color/shape conflict; one facet field is a fallback.
  const defaultGroup = [...new Set([...visualGroups, ...(facetFields.length === 1 ? facetFields : [])])]
    .find(field => groups[field]?.minDistinctX >= 2) ?? '';
  return { workLimit: MAX_WORK_ITEMS, currentGroup, defaultGroup, groups };
}

// A source-filter slider must leave enough distinct X observations for every
// existing fit. Bounds differ by comparison direction; no candidate model is
// fitted during ranking or parameter construction.
export function regressionFilterLimits(program, layer, field, inputRows) {
  const owner = program.markConfigs[layer?.id]?.regression;
  if (!owner) return undefined;
  const rows = (inputRows ?? program.semanticSpec.datasets.find(d => d.id === owner.source)?.values ?? [])
    .filter(row => Number.isFinite(row[owner.x]) && Number.isFinite(row[owner.y]) && Number.isFinite(row[field]));
  const required = owner.parameters?.method === 'polynomial' ? (owner.parameters.degree ?? 2) + 1 : 2;
  const requiredRows = ['linear', 'polynomial'].includes(owner.parameters?.method ?? 'linear') &&
    owner.parameters?.interval !== false ? required + 1 : required;
  const grouped = new Map(), fields = Array.isArray(owner.groupBy) ? owner.groupBy : owner.groupBy ? [owner.groupBy] : [];
  for (const row of rows) {
    const key = JSON.stringify(fields.map(field => row[field]));
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  if (!rows.length) return undefined;
  const critical = (group, direction) => {
    const sorted = [...group].sort((a, b) => direction * (a[field] - b[field])), seen = new Set();
    for (const [index, row] of sorted.entries()) {
      seen.add(row[owner.x]);
      if (seen.size >= required && index + 1 >= requiredRows) return row[field];
    }
    return undefined;
  };
  const low = Math.min(...rows.map(row => row[field])), high = Math.max(...rows.map(row => row[field]));
  const gte = [...grouped.values()].map(group => critical(group, -1));
  const lte = [...grouped.values()].map(group => critical(group, 1));
  if ([...gte, ...lte].some(value => value === undefined)) return undefined;
  return { gte: { min: low, max: Math.min(...gte) }, lte: { min: Math.max(...lte), max: high } };
}
