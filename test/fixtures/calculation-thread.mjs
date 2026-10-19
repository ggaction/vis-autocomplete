import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createCalculationService } from '../../web/calculation-service.js';
let service;
parentPort.on('message', ({ id, request }) => {
  try {
    if (request.type === 'initialize') {
      service = createCalculationService(request.role === 'recommendation'
        ? JSON.parse(readFileSync(new URL('../../data/model.json', import.meta.url))) : null);
      parentPort.postMessage({ id, value: { ready: true } }); return;
    }
    parentPort.postMessage({ id, value: service.execute(request) });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
