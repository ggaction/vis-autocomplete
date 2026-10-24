import { loadModel } from './model-loader.js';
import { createCalculationService } from './calculation-service.js';

let service, recommendationGeneration = 0;
self.addEventListener('message', async ({ data: { id, request } }) => {
  try {
    if (request.type === 'initialize') {
      let model = null;
      if (request.role === 'recommendation') {
        model = await loadModel('model.json');
      }
      service = createCalculationService(model);
      self.postMessage({ id, value: { ready: true, generation: model?.provenance.generation } }); return;
    }
    if (request.type === 'materialize' || request.type === 'cancel-recommendations') recommendationGeneration++;
    if (request.type === 'recommend' && request.stream) {
      const generation = ++recommendationGeneration;
      let value;
      do {
        if (generation !== recommendationGeneration) {
          self.postMessage({ id, value: { ...value, cancelled: true } }); return;
        }
        value = service.execute({ ...request, batchSize: 1 });
        if (!value.pagination.pending) break;
        self.postMessage({ id, value, progress: true });
        // Let newer group/search/Apply requests run between native candidates.
        await new Promise(resolve => setTimeout(resolve, 0));
      } while (true);
      self.postMessage({ id, value }); return;
    }
    const value = service.execute(request);
    self.postMessage({ id, value });
  } catch (error) { self.postMessage({ id, error: error.message, reason: error.reason }); }
});
