import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointerMotion } from '../web/pointer-motion.js';

function session() {
  let id = 0;
  const frames = new Map(), rendered = [];
  const motion = createPointerMotion({ render: event => rendered.push(event),
    requestFrame: callback => { frames.set(++id, callback); return id; },
    cancelFrame: key => frames.delete(key) });
  return { motion, rendered, frames,
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); } };
}
const move = (screenX, screenY, target, clientX = screenX, clientY = screenY) =>
  ({ pointerType: 'mouse', screenX, screenY, clientX, clientY, target });

test('fractional client-coordinate changes at the same screen position cannot change hover ownership', () => {
  const s = session();
  s.motion.move(move(1200, 700, 'color', 1080.125, 610.25)); s.frame();
  // Monitor scaling, moving viewport and animated hit targets leave the actual
  // pointer still. The old client-coordinate guard accepted these events.
  s.motion.move(move(1200, 700, 'gap', 1080.375, 610.5));
  s.motion.move(move(1200, 700, 'size', 1081, 611)); s.frame();
  assert.deepEqual(s.rendered.map(event => event.target), ['color']);
});

test('leaving and returning to the gallery at the same client coordinates are real physical moves', () => {
  const s = session();
  s.motion.move(move(800, 700, 'card', 400, 500)); s.frame();
  s.motion.move(move(800, 400, 'outside', 400, 200)); s.frame();
  s.motion.move(move(800, 700, 'card', 400, 500)); s.frame();
  assert.deepEqual(s.rendered.map(event => event.target), ['card', 'outside', 'card']);
});

test('a high-frequency monitor renders the final pointer intent once per frame', () => {
  const s = session();
  for (let x = 100; x < 130; x++) s.motion.move(move(x, 500, x < 129 ? 'gap' : 'choice'));
  assert.equal(s.frames.size, 1);
  s.frame();
  assert.deepEqual(s.rendered.map(event => event.target), ['choice']);
});

test('a stationary synthetic event cannot replace a queued physical move', () => {
  const s = session();
  s.motion.move(move(-350, 600, 'slider'));
  s.motion.move(move(-350, 600, 'outside', 100.5)); s.frame();
  assert.deepEqual(s.rendered.map(event => event.target), ['slider']);
});

test('pointerdown flushes the latest position before Apply; dataset changes cancel old work', () => {
  const s = session();
  s.motion.move(move(100, 200, 'apply')); s.motion.flush();
  assert.equal(s.frames.size, 0);
  assert.equal(s.rendered.at(-1).target, 'apply');
  s.motion.move(move(105, 200, 'old card')); s.motion.reset(); s.frame();
  assert.equal(s.rendered.length, 1);
  s.motion.move(move(105, 200, 'new card')); s.frame();
  assert.equal(s.rendered.at(-1).target, 'new card');
});

test('touch never starts mouse-hover slider or card previews', () => {
  const s = session();
  s.motion.move({ ...move(100, 200, 'slider'), pointerType: 'touch' }); s.frame();
  assert.equal(s.rendered.length, 0);
});
