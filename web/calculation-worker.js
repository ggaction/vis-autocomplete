import { createCalculationService } from './calculation-service.js';

let service;
self.addEventListener('message', async ({ data: { id, request } }) => {
  try {
    if (request.type === 'initialize') {
      let model = null;
      if (request.role === 'recommendation') {
        const response = await fetch('/data/model.json');
        if (!response.ok) throw new Error('The recommendation model is missing. Run npm run corpus:update.');
        model = await response.json();
      }
      service = createCalculationService(model);
      self.postMessage({ id, value: { ready: true } }); return;
    }
    const value = service.execute(request);
    self.postMessage({ id, value });
  } catch (error) { self.postMessage({ id, error: error.message }); }
});
