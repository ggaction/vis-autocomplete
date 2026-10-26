import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideNudge, guideNudgeDelta } from '../web/guide-nudge.js';
import { chart } from 'ggaction';
import { selectableGuides } from '../src/guide-manipulation.js';
import { manipulationTargets, manipulationCalls, prepareGuideEdits } from '../src/guide-group.js';

function harness({ end, begin } = {}) {
  const timers = new Set(), calls = [], handles = [];
  const controller = createGuideNudge({
    begin() { const handle = begin ? begin() : {}; if (handle) handles.push(handle); return handle; },
    update(handle, dx, dy) { calls.push({ handle, dx, dy }); },
    end(handle) { calls.push({ end: handle }); return end?.(handle); },
    cancel(handle) { calls.push({ cancel: handle }); },
  }, { schedule: fn => { timers.add(fn); return fn; }, unschedule: fn => timers.delete(fn) });
  const tick = async () => { for (const fn of [...timers]) { timers.delete(fn); fn(); } await Promise.resolve(); await Promise.resolve(); };
  const down = (key, extra = {}) => controller.down({ key, ...extra });
  return { controller, calls, handles, timers, tick, down };
}

test('arrows nudge one logical pixel, Shift nudges ten, and shortcut/IME keys are untouched', () => {
  assert.deepEqual(guideNudgeDelta({ key: 'ArrowLeft' }), [-1, 0]);
  assert.deepEqual(guideNudgeDelta({ key: 'ArrowDown', shiftKey: true }), [0, 10]);
  for (const flag of ['defaultPrevented', 'isComposing', 'altKey', 'ctrlKey', 'metaKey'])
    assert.equal(guideNudgeDelta({ key: 'ArrowRight', [flag]: true }), null);
  assert.equal(guideNudgeDelta({ key: 'Enter' }), null);
});

test('taps accumulate and native key repeat stays in one transaction until every arrow is released', async () => {
  const h = harness();
  for (let i = 0; i < 4; i++) { h.down('ArrowRight'); h.controller.up('ArrowRight'); }
  h.down('ArrowDown');
  for (let i = 0; i < 60; i++) h.down('ArrowDown', { repeat: true });
  await h.tick();
  assert.equal(h.calls.filter(c => c.end).length, 0, 'Holding a key must not commit between repeats');
  h.down('ArrowLeft', { shiftKey: true }); h.controller.up('ArrowDown');
  await h.tick(); assert.equal(h.calls.filter(c => c.end).length, 0);
  h.controller.up('ArrowLeft'); await h.tick();
  assert.equal(h.handles.length, 1);
  assert.equal(h.calls.filter(c => c.end).length, 1);
  assert.deepEqual(h.calls.at(-2), { handle: h.handles[0], dx: -6, dy: 61 });
});

test('fast taps during an asynchronous commit are queued and applied without losing displacement', async () => {
  let release;
  const h = harness({ end: () => new Promise(resolve => { release = resolve; }) });
  h.down('ArrowRight'); h.controller.up('ArrowRight'); await h.tick();
  for (let i = 0; i < 8; i++) { h.down('ArrowRight'); h.controller.up('ArrowRight'); }
  h.down('ArrowDown', { shiftKey: true }); h.controller.up('ArrowDown');
  assert.equal(h.handles.length, 1);
  release(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.handles.length, 2);
  assert.deepEqual(h.calls.at(-1), { handle: h.handles[1], dx: 8, dy: 10 });
  await h.tick(); release(); await Promise.resolve();
  assert.equal(h.calls.filter(c => c.end).length, 2);
});

test('Escape/blur cancellation drops held and queued keys and leaves no delayed commit', async () => {
  const h = harness();
  h.down('ArrowRight'); h.controller.up('ArrowRight'); h.controller.cancel(); await h.tick();
  assert.equal(h.calls.filter(c => c.cancel).length, 1);
  assert.equal(h.calls.filter(c => c.end).length, 0);
  h.down('ArrowUp'); h.controller.up('ArrowUp'); await h.tick();
  assert.deepEqual(h.calls.at(-2), { handle: h.handles[1], dx: 0, dy: -1 });
  assert.equal(h.calls.filter(c => c.end).length, 1);
});

test('unavailable selections do not capture arrows; leaving focus flushes a held gesture', async () => {
  const blocked = harness({ begin: () => null });
  assert.equal(blocked.down('ArrowRight'), false); assert.equal(blocked.timers.size, 0);
  const h = harness(); h.down('ArrowRight');
  await h.controller.flush();
  assert.equal(h.calls.filter(c => c.end).length, 1);
  assert.equal(h.timers.size, 0);
});

test('cancelling during a pending commit never starts queued work on a stale selection', async () => {
  let release;
  const h = harness({ end: () => new Promise(resolve => { release = resolve; }) });
  h.down('ArrowRight'); h.controller.up('ArrowRight'); await h.tick();
  h.down('ArrowRight'); h.controller.cancel(); release();
  await Promise.resolve(); await h.tick();
  assert.equal(h.handles.length, 1);
  assert.equal(h.calls.filter(c => c.cancel).length, 1);
});

test('fine keyboard movement uses native offsets and never docks even past the pointer snap threshold', () => {
  const p = chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 180 })
    .createData({ values: [{ x: 1, y: 3, g: 'A' }, { x: 2, y: 4, g: 'B' }] })
    .createScatterPlot({ id: 'plot', x: 'x', y: 'y', color: { field: 'g', fieldType: 'nominal' } })
    .createGuides({ legend: { target: 'plot', channels: ['color'] } })
    .createTitle({ text: 'Title', subtitle: 'Subtitle' });
  const guides = selectableGuides(p);
  for (const keys of [['title'], ['axis:xAxisTitle'], ['legend:color'], ['title', 'subtitle', 'axis:xAxisTitle']]) {
    const grabbed = guides.find(t => t.key === keys[0]);
    const members = manipulationTargets(guides, new Set(keys), grabbed, 'move');
    const legend = grabbed.kind === 'legend';
    const calls = manipulationCalls(p, members, 'move', { dx: legend ? 1 : 70, dy: legend ? 70 : 1, snapDistance: Infinity });
    for (const call of calls) assert.ok(!call.dockKey);
    const next = prepareGuideEdits(p, p, calls);
    const after = selectableGuides(next.view);
    for (const target of members) {
      const moved = after.find(t => t.key === target.key);
      assert.equal(moved.config.position, target.config.position);
      if (target.kind === 'legend') {
        const anchor = guides.find(t => t.key === 'axis:xAxisTitle');
        const movedAnchor = after.find(t => t.key === anchor.key);
        assert.ok(Math.abs((moved.bounds.top - movedAnchor.bounds.top) - (target.bounds.top - anchor.bounds.top) - 70) < .01);
      } else assert.equal(moved.config.alongOffset - (target.config.alongOffset ?? 0), 70);
    }
  }
});
