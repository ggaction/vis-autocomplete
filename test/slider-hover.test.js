import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliderHover } from '../web/slider-hover.js';

function session() {
  let now = 0, id = 0, valid = true;
  const timers = new Map(), values = [];
  const hover = createSliderHover({ valid: () => valid,
    schedule: (fn, delay) => { timers.set(++id, { fn, time: now + delay }); return id; },
    cancel: id => timers.delete(id) });
  const follow = event => values.push(event.clientX);
  return { hover, values, timers, follow,
    move: (target, clientX) => hover.move(target, { clientX, pointerType: 'mouse' }, follow),
    invalidate: () => { valid = false; },
    advance(ms) { now += ms; for (const [id, task] of timers) if (task.time <= now) { timers.delete(id); task.fn(); } } };
}

test('passing through a slider cannot change its value, including after leaving', () => {
  const s = session(); s.move('size', 10); s.advance(80); s.move('size', 90);
  s.advance(80); s.move(null, 100); s.advance(500);
  assert.deepEqual(s.values, []); assert.equal(s.timers.size, 0);
});
test('dwell uses the latest position, then follows immediately without rearming on each move', () => {
  const s = session(); s.move('size', 10); s.advance(100); s.move('size', 30);
  s.advance(99); assert.deepEqual(s.values, []);
  s.advance(1); assert.deepEqual(s.values, [30]);
  s.move('size', 40); s.move('size', 50); assert.deepEqual(s.values, [30, 40, 50]);
});
test('new sliders and reentry require their own dwell; reset cancels work', () => {
  const s = session(); s.move('size', 10); s.advance(200);
  s.move('opacity', 20); s.advance(100); s.move('size', 30); s.advance(100);
  assert.deepEqual(s.values, [10]); s.hover.reset(); s.advance(500);
  assert.deepEqual(s.values, [10]);
});
test('disconnected, moved-away or inactive controls cannot update from an old timer', () => {
  const s = session(); s.move('size', 10); s.invalidate(); s.advance(200);
  assert.deepEqual(s.values, []); assert.equal(s.timers.size, 0);
});
test('explicit activation bypasses dwell and touch never arms hover', () => {
  const s = session(); s.move('size', 10);
  s.hover.activate('size', { clientX: 20 }, s.follow); s.move('size', 30); s.advance(300);
  assert.deepEqual(s.values, [20, 30]);
  s.hover.move('opacity', { clientX: 40, pointerType: 'touch' }, s.follow); s.advance(300);
  assert.deepEqual(s.values, [20, 30]);
});
