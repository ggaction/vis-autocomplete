import { importDataset } from '../src/data-import.js';

export function exampleDatasets() {
  return [
    ['cars', 'Cars'], ['tips', 'Tips'], ['iris', 'Iris'], ['weather', 'Seattle weather'],
    ['stocks', 'Stocks'], ['gapminder', 'Gapminder'], ['barley', 'Barley'],
    ['electricity', 'Iowa electricity'], ['sales', 'Monthly sales'],
  ].map(([id, name]) => ({ id, name }));
}
const pending = new WeakMap();
export async function loadExampleDataset(record) {
  if (record.imported) return record;
  if (pending.has(record)) return pending.get(record);
  const task = (async () => {
    let rows;
    if (record.id === 'sales') rows = Array.from({ length: 36 }, (_, i) => ({
      Month: `${2023 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`,
      Sales: Math.round(100 + i * 3 + Math.sin(i / 2) * 24),
      Cost: Math.round(55 + i * 1.5 + Math.cos(i / 3) * 10),
      Orders: 30 + i * 2, Region: ['North', 'South', 'West'][i % 3],
    }));
    else {
      const response = await fetch(`/web/data/${record.id}.json`);
      if (!response.ok) throw new Error(`The ${record.name} example dataset is missing.`);
      rows = await response.json();
    }
    record.imported = importDataset(rows, { format: 'rows', name: record.name,
      ...(record.id === 'stocks' ? { fieldOverrides: { date: { type: 'temporal', dateFormat: 'month-name' } } } : {}),
      ...(record.id === 'barley' ? { fieldOverrides: { year: { type: 'ordinal' } } } : {}),
    });
    return record;
  })();
  pending.set(record, task);
  try { return await task; } finally { pending.delete(record); }
}
