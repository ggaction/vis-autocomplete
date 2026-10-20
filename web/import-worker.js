import { importDataset } from '../src/data-import.js';

self.addEventListener('message', ({ data }) => {
  const { id, input, options } = data;
  try {
    self.postMessage({ id, progress: 'Interpreting all rows…' });
    self.postMessage({ id, result: importDataset(input, options) });
  } catch (error) {
    self.postMessage({ id, error: { name: error.name, message: error.message, row: error.row,
      column: error.column, schema: error.schema } });
  }
});
