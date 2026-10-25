import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneRenderer } from '../web/scene-renderer.js';

function canvas() {
  const value = { width: 1, height: 1, style: {}, ownerDocument: { createElement: canvas } };
  const context = { canvas: value, copies: 0, drawImage() { this.copies++; } };
  value.getContext = () => context;
  return value;
}
test('finished scenes reuse exact-density pixels, mutable frames bypass, retention stays bounded', () => {
  let draws = 0;
  const renderer = createSceneRenderer({ maxPixels: 500, maxEntries: 2,
    render(scene, context, { pixelRatio }) {
      draws++; context.canvas.width = Math.round(scene.width * pixelRatio);
      context.canvas.height = Math.round(scene.height * pixelRatio);
    } });
  const context = canvas().getContext('2d');
  const a = renderer.remember({ width: 10, height: 10 }), b = renderer.remember({ width: 10, height: 10 });
  renderer.render(a, context, { pixelRatio: 1 });
  renderer.render(a, context, { pixelRatio: 1 });
  assert.equal(draws, 1); assert.equal(context.copies, 1);
  renderer.render(a, context, { pixelRatio: 2 });
  assert.equal(draws, 2); assert.equal(renderer.retainedPixels, 400);
  renderer.render(b, context, { pixelRatio: 2 });
  assert.equal(renderer.retainedEntries, 1); assert.equal(renderer.retainedPixels, 400);
  renderer.render(a, context, { pixelRatio: 1 });
  assert.equal(draws, 4);
  renderer.render({ ...a }, context, { pixelRatio: 1 });
  renderer.render({ ...a }, context, { pixelRatio: 1 });
  assert.equal(draws, 6, 'unregistered animation frames are never cached');
  renderer.render(renderer.remember({ width: 100, height: 100 }), context, { pixelRatio: 1 });
  assert.ok(renderer.retainedPixels <= 500);
  renderer.clear(); assert.equal(renderer.retainedPixels, 0); assert.equal(renderer.retainedEntries, 0);
  renderer.render(a, context, { pixelRatio: 1 }); assert.equal(draws, 8);
});
