import { latestQueue } from '../calculation-client.js';

// Only derived thumbnails can be superseded. Every authored project revision
// still enters the durable outbox; the last revision always gets its own image.
export function createThumbnailClient({ workerFactory = () => new Worker('/output/workers/thumbnail.js', { type: 'module' }) } = {}) {
  let worker, sequence = 0, active;
  const queue = latestQueue(graphicSpec => new Promise((resolve, reject) => {
    if (!worker) {
      worker = workerFactory();
      worker.addEventListener('message', ({ data }) => {
        if (data.id !== active?.id) return;
        const job = active; active = null;
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.image);
      });
      worker.addEventListener('error', error => { active?.reject(new Error(error.message)); active = null; worker.terminate(); worker = null; });
    }
    active = { id: ++sequence, resolve, reject };
    worker.postMessage({ id: sequence, graphicSpec });
  }));
  return { create: program => queue(program.graphicSpec) };
}
