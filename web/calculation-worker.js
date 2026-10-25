import { loadModel } from './model-loader.js';
import { createCalculationService } from './calculation-service.js';
import { createRecommendationStream } from './recommendation-stream.js';

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
      const stream = createRecommendationStream();
      let value, sentCards = 0;
      do {
        if (generation !== recommendationGeneration) {
          self.postMessage({ id, value: { ...value, cancelled: true } }); return;
        }
        value = service.execute({ ...request, batchSize: 1 });
        if (!value.pagination.pending) break;
        if (value.result.recommendations.length > sentCards) {
          self.postMessage({ id, value: stream(value), progress: true });
          sentCards = value.result.recommendations.length;
        }
        // Let newer group/search/Apply requests run between native candidates.
        await new Promise(resolve => setTimeout(resolve, 0));
      } while (true);
      self.postMessage({ id, value: stream(value) }); return;
    }
    const value = service.execute(request);
    self.postMessage({ id, value });
  } catch (error) { self.postMessage({ id, error: error.message, reason: error.reason }); }
});
