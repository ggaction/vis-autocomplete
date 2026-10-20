import { MAX_WORK_ITEMS } from '../vendor/ggaction/src/core/validation.js';

// Mirror the public regression work/adequacy policy using counts only. This
// never fits candidate models or samples rows before a card is requested.
export function regressionContext(program, layer, profile) {
  if (layer?.mark?.type !== 'point' && !program.markConfigs[layer?.id]?.regression) return undefined;
  const { x, y } = layer?.encoding ?? {};
  if (x?.fieldType !== 'quantitative' || y?.fieldType !== 'quantitative') return undefined;
  const rows = (program.semanticSpec.datasets.find(d => d.id === layer.data)?.values ?? [])
    .filter(row => Number.isFinite(row[x.field]) && Number.isFinite(row[y.field]));
  const fields = ['', ...profile.fields.filter(f => f.usable && ['nominal', 'ordinal'].includes(f.type)).map(f => f.name)];
  return { workLimit: MAX_WORK_ITEMS, currentGroup: program.markConfigs[layer.id]?.regression?.groupBy ?? '', groups: Object.fromEntries(fields.map(field => {
    const groups = new Map();
    for (const row of rows) {
      const key = field ? row[field] : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    let minDistinctX = Infinity, minRows = Infinity, loessWork = 0;
    for (const group of groups.values()) {
      const distinct = new Set(group.map(row => row[x.field])).size;
      minDistinctX = Math.min(minDistinctX, distinct);
      minRows = Math.min(minRows, group.length);
      loessWork += group.length * distinct * Math.ceil(Math.log2(group.length + 1));
    }
    return [field, { minDistinctX, minRows, loessWork, positiveY: rows.length > 0 && rows.every(row => row[y.field] > 0) }];
  })) };
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
