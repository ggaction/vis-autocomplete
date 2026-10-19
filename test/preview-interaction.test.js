import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewInteraction } from '../web/preview-interaction.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';

function session(initial) {
  let pinned = structuredClone(initial), sequence = 0;
  const frames = new Map(), rendered = [];
  const interaction = createPreviewInteraction({
    readPinned: () => pinned, render: values => rendered.push(structuredClone(values)),
    requestFrame: callback => { frames.set(++sequence, callback); return sequence; },
    cancelFrame: id => frames.delete(id),
  });
  return { interaction, rendered, frames,
    pin(values) { pinned = values; interaction.reset(); },
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    get pinned() { return pinned; },
  };
}

test('moving between choices renders only the final hover, without a pinned-value flash', () => {
  const s = session({ field: 'Origin' });
  s.interaction.hover('weight', { field: 'Weight_in_lbs' }); s.frame();
  s.rendered.length = 0;
  s.interaction.unhover('weight');
  s.interaction.hover('horsepower', { field: 'Horsepower' });
  assert.equal(s.frames.size, 1);
  s.frame();
  assert.deepEqual(s.rendered, [{ field: 'Horsepower' }]);
  assert.deepEqual(s.pinned, { field: 'Origin' });
});

test('pointer and keyboard focus cannot reset each other or clear a newer choice', () => {
  const s = session({ value: '#555555' });
  s.interaction.focus('blue', { value: '#4c78a8' });
  s.interaction.hover('red', { value: '#e45756' });
  s.interaction.blur('blue'); s.frame();
  assert.deepEqual(s.rendered.at(-1), { value: '#e45756' });
  s.interaction.hover('green', { value: '#54a24b' });
  s.interaction.unhover('red'); s.frame();
  assert.deepEqual(s.rendered.at(-1), { value: '#54a24b' });
  s.interaction.unhover('green'); s.frame();
  assert.deepEqual(s.rendered.at(-1), { value: '#555555' });
});

test('keyboard focus takes over when the pointer leaves, and rapid tabbing has one final preview', () => {
  const s = session({ field: 'Origin' });
  s.interaction.focus('weight', { field: 'Weight_in_lbs' });
  s.interaction.hover('horsepower', { field: 'Horsepower' }); s.frame();
  s.interaction.leavePointer(); s.frame();
  assert.equal(s.rendered.at(-1).field, 'Weight_in_lbs');
  s.rendered.length = 0;
  s.interaction.blur('weight');
  s.interaction.focus('horsepower', { field: 'Horsepower' });
  s.interaction.blur('weight'); s.frame();
  assert.deepEqual(s.rendered, [{ field: 'Horsepower' }]);
});

test('a mode preview changes native arguments without changing pinned control structure or scroll targets', () => {
  const profile = { fields: [{ name: 'Origin', type: 'nominal', usable: true }] };
  const editor = recommendationParameters({ method: 'encodeColor', args: { field: 'Origin' } }, profile);
  const s = session(valuesFor(editor.controls));
  const visible = () => editor.controls.filter(c => !c.when || c.when(s.pinned)).map(c => c.key);
  const before = visible();
  s.interaction.hover('fixed', { ...s.pinned, mode: 'fixed' }); s.frame();
  assert.deepEqual(editor.build(s.rendered.at(-1)), { value: '#4c78a8' });
  assert.deepEqual(visible(), before);
  s.pin(s.rendered.at(-1)); s.frame();
  assert.deepEqual(visible(), ['mode', 'value']);
});

test('clicking a multi-choice preview pins it once without toggling it again on the next frame', () => {
  const s = session({ fields: ['x', 'y'] });
  const proposed = { fields: ['x', 'y', 'z'] };
  s.interaction.hover('z', proposed);
  s.interaction.focus('z', proposed);
  s.pin(proposed); s.frame();
  assert.deepEqual(s.rendered, [proposed]);
  s.interaction.unhover('z'); s.interaction.blur('z'); s.frame();
  assert.deepEqual(s.pinned, proposed);
});

test('Apply flushes pinned settings and cancels stale preview work before cards are replaced', () => {
  const s = session({ field: 'Origin' });
  s.interaction.hover('weight', { field: 'Weight_in_lbs' });
  s.interaction.reset(); s.interaction.flush();
  assert.deepEqual(s.rendered, [{ field: 'Origin' }]);
  assert.equal(s.frames.size, 0);
  s.frame();
  assert.equal(s.rendered.length, 1);
});

test('continuous updates share one frame and render the latest value with no intermediate resets', () => {
  const s = session({ value: 64 });
  for (let value = 65; value <= 120; value++) s.pin({ value });
  assert.equal(s.frames.size, 1);
  s.frame();
  assert.deepEqual(s.rendered, [{ value: 120 }]);
});


test('an intentional keyboard focus overrides a stationary pointer until it actually moves', () => {
  const s = session({ mode: 'variable' });
  s.interaction.hover('variable', { mode: 'variable' });
  s.interaction.focus('fixed', { mode: 'fixed' }); s.frame();
  assert.deepEqual(s.rendered.at(-1), { mode: 'fixed' });
  s.interaction.movePointer(); s.frame();
  assert.deepEqual(s.rendered.at(-1), { mode: 'variable' });
  s.interaction.blur('fixed'); s.frame();
  assert.deepEqual(s.rendered.at(-1), { mode: 'variable' });
});
