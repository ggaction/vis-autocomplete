// An import can be terminated without blocking the chart or replacing its data.
export function createImportClient({ workerFactory = () => new Worker(new URL('./import-worker.js', import.meta.url), { type: 'module' }) } = {}) {
  let worker, current, sequence = 0;
  const cancel = () => {
    worker?.terminate(); worker = null;
    if (current) { current.reject(new DOMException('Import canceled.', 'AbortError')); current = null; }
  };
  return {
    import(input, options = {}, onProgress) {
      cancel(); worker = workerFactory();
      return new Promise((resolve, reject) => {
        const id = ++sequence; current = { id, resolve, reject };
        worker.addEventListener('message', ({ data }) => {
          if (current?.id !== data.id) return;
          if (data.progress) { onProgress?.(data.progress); return; }
          current = null; worker.terminate(); worker = null;
          if (data.error) reject(Object.assign(new Error(data.error.message), data.error)); else resolve(data.result);
        });
        worker.addEventListener('error', event => {
          if (current?.id !== id) return;
          current = null; worker?.terminate(); worker = null; reject(new Error(event.message || 'Import worker failed.'));
        });
        worker.postMessage({ id, input, options });
      });
    },
    cancel,
  };
}
