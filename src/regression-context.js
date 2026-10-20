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
    let minDistinctX = Infinity, loessWork = 0;
    for (const group of groups.values()) {
      const distinct = new Set(group.map(row => row[x.field])).size;
      minDistinctX = Math.min(minDistinctX, distinct);
      loessWork += group.length * distinct * Math.ceil(Math.log2(group.length + 1));
    }
    return [field, { minDistinctX, loessWork, positiveY: rows.length > 0 && rows.every(row => row[y.field] > 0) }];
  })) };
}
