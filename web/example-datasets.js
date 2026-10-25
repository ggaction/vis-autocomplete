import { importDataset } from '../src/data-import.js';

export function exampleDatasets() {
  return [
    ['cars', 'Cars'], ['tips', 'Tips'], ['iris', 'Iris'], ['weather', 'Seattle weather'],
    ['stocks', 'Stocks', { fieldOverrides: { date: { type: 'temporal', dateFormat: 'month-name' } } }],
    ['gapminder', 'Gapminder'], ['barley', 'Barley', { fieldOverrides: { year: { type: 'ordinal' } } }],
    ['electricity', 'Iowa electricity'], ['sales', 'Monthly sales'],
    ['fashion_mnist_tsne', 'Fashion-MNIST t-SNE', { format: 'csv', fieldOverrides: { label: { type: 'nominal' } } }],
    ['penguins', 'Palmer penguins'],
    ['wine', 'Wine chemistry', { fieldOverrides: { class: { type: 'nominal' } } }],
    ['glass', 'Glass identification', { fieldOverrides: { Id_number: { type: 'nominal' }, class: { type: 'nominal' } } }],
    ['bike-sharing', 'Daily bike sharing', { format: 'csv', fieldOverrides: {
      instant: { type: 'nominal' }, season: { type: 'nominal' }, yr: { type: 'nominal' },
      mnth: { type: 'ordinal' }, weekday: { type: 'ordinal' }, holiday: { type: 'nominal' },
      workingday: { type: 'nominal' }, weathersit: { type: 'ordinal' },
    } }],
    ['us-employment', 'US employment', { format: 'csv' }],
    ['unemployment', 'Unemployment by industry', { fieldOverrides: { month: { type: 'ordinal' } } }],
    ['budgets', 'US budget forecasts'],
    ['income', 'US household income', { fieldOverrides: { id: { type: 'nominal' }, group: {
      type: 'ordinal', order: ['<10000', '10000 to 14999', '15000 to 24999', '25000 to 34999',
        '35000 to 49999', '50000 to 74999', '75000 to 99999', '100000 to 149999', '150000 to 199999', '200000+'],
    } } }],
    ['global-temp', 'Global temperature', { format: 'csv' }],
  ].map(([id, name, options = {}]) => ({ id, name, ...options }));
}
const pending = new WeakMap();
export async function loadExampleDataset(record) {
  if (record.imported) return record;
  if (pending.has(record)) return pending.get(record);
  const task = (async () => {
    let rows;
    const format = record.format ?? 'rows';
    if (record.id === 'sales') rows = Array.from({ length: 36 }, (_, i) => ({
      Month: `${2023 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`,
      Sales: Math.round(100 + i * 3 + Math.sin(i / 2) * 24),
      Cost: Math.round(55 + i * 1.5 + Math.cos(i / 3) * 10),
      Orders: 30 + i * 2, Region: ['North', 'South', 'West'][i % 3],
    }));
    else {
      const response = await fetch(`/web/data/${record.id}.${format === 'csv' ? 'csv' : 'json'}`);
      if (!response.ok) throw new Error(`The ${record.name} example dataset is missing.`);
      rows = format === 'csv' ? await response.text() : await response.json();
    }
    record.imported = importDataset(rows, { format, name: record.name, fieldOverrides: record.fieldOverrides ?? {} });
    return record;
  })();
  pending.set(record, task);
  try { return await task; } finally { pending.delete(record); }
}
