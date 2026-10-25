// Start the Excel parser only for an Excel upload, off the UI thread. Keep the
// workbook there until a sheet is chosen; only that table crosses to the app.
export function createWorkbookClient({ workerFactory = () => new Worker('/output/workers/workbook.js', { type: 'module' }) } = {}) {
  let worker, sequence = 0; const pending = new Map();
  const cancel = () => {
    worker?.terminate(); worker = null;
    for (const { reject } of pending.values()) reject(new DOMException('Workbook import canceled.', 'AbortError'));
    pending.clear();
  };
  return {
    request(action, input) {
      if (!worker) {
        worker = workerFactory();
        worker.addEventListener('message', ({ data }) => {
          const request = pending.get(data.id); if (!request) return;
          pending.delete(data.id);
          if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
        });
        worker.addEventListener('error', event => {
          for (const { reject } of pending.values()) reject(new Error(event.message || 'Could not read this workbook.'));
          pending.clear(); worker?.terminate(); worker = null;
        });
      }
      return new Promise((resolve, reject) => {
        const id = ++sequence; pending.set(id, { resolve, reject });
        worker.postMessage({ id, action, input }, input instanceof ArrayBuffer ? [input] : []);
      });
    },
    cancel,
  };
}
