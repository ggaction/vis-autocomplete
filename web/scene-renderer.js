import { renderTransitionScene } from 'ggaction/scene';

// Only finalized app-owned scenes are registered. Mutable animation frames are
// always rendered normally. Pixel/entry bounds prevent long sessions from
// retaining a bitmap for every historical chart or slider position.
export function createSceneRenderer({ render = renderTransitionScene, maxPixels = 8_000_000, maxEntries = 6 } = {}) {
  const endpoints = new WeakSet(), cache = new Map();
  let pixels = 0;
  const release = scene => {
    const entry = cache.get(scene);
    if (!entry) return;
    pixels -= entry.image.width * entry.image.height;
    entry.image.width = entry.image.height = 1;
    cache.delete(scene);
  };
  return {
    remember(scene) { if (scene) endpoints.add(scene); return scene; },
    render(scene, context, options) {
      const ratio = options.pixelRatio;
      const hit = cache.get(scene);
      if (hit?.ratio === ratio) {
        cache.delete(scene); cache.set(scene, hit);
        context.canvas.width = hit.image.width;
        context.canvas.height = hit.image.height;
        context.drawImage(hit.image, 0, 0);
        Object.assign(context.canvas.style, { width: `${scene.width}px`, height: `${scene.height}px` });
        return;
      }
      render(scene, context, options);
      if (!endpoints.has(scene)) return;
      release(scene);
      const cost = context.canvas.width * context.canvas.height;
      if (cost > maxPixels || maxEntries < 1) return;
      while (cache.size && (pixels + cost > maxPixels || cache.size >= maxEntries)) release(cache.keys().next().value);
      const image = context.canvas.ownerDocument.createElement('canvas');
      image.width = context.canvas.width; image.height = context.canvas.height;
      image.getContext('2d').drawImage(context.canvas, 0, 0);
      cache.set(scene, { image, ratio }); pixels += cost;
    },
    clear() { for (const scene of cache.keys()) release(scene); },
    get retainedPixels() { return pixels; },
    get retainedEntries() { return cache.size; },
  };
}
