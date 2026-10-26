import { latestQueue } from '../calculation-client.js';

// Only derived thumbnails can be superseded. Every authored project revision
// still enters the durable outbox; the last revision always gets its own image.
export function createThumbnailClient({ workerFactory = () => new Worker('/output/workers/thumbnail.js', { type: 'module' }) } = {}) {
  let worker, sequence = 0, active, closed = false;
  const queue = latestQueue(payload => new Promise((resolve, reject) => {
    if (closed) { resolve(null); return; }
    if (!worker) {
      const owned = workerFactory(); worker = owned;
      owned.addEventListener('message', ({ data }) => {
        if (worker !== owned || data.id !== active?.id) return;
        const job = active; active = null;
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.image);
      });
      const fail = error => {
        if (worker !== owned) return;
        active?.reject(new Error(error.message || 'Thumbnail worker failed.')); active = null; owned.terminate(); worker = null;
      };
      owned.addEventListener('error', fail); owned.addEventListener('messageerror', fail);
    }
    active = { id: ++sequence, resolve, reject };
    try { worker.postMessage({ id: sequence, ...payload }); }
    catch (error) { active = null; reject(error); }
  }));
  return {
    create: program => queue({ graphicSpec: program.graphicSpec }),
    restore: (snapshot, rows) => queue({ snapshot, rows }),
    destroy() { closed = true; queue.cancelPending(); active?.resolve(null); active = null; worker?.terminate(); worker = null; },
  };
}
