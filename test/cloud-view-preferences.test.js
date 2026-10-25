import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewPreferences, cleanViewPreference } from '../web/view-preferences.js';

const key = name => `vis-autocomplete.${name}`;
function fixture() {
  const map = new Map(), calls = [];
  const storage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const make = (id = 'a', metadata = {}, extra = {}) => createViewPreferences({
    user: { id, user_metadata: metadata }, storage, delay: 60_000,
    save: async (patch, owner) => calls.push({ patch: structuredClone(patch), owner }), ...extra,
  });
  return { map, calls, storage, make };
}
test('account settings restore mode, layout, folds, ratios and font before rendering', () => {
  const { make } = fixture();
  const p = make('a', { vis_view_mode: 'transition', vis_workspace_layout: { transition: 'horizontal' },
    vis_panel_layout: { code: true, history: false }, vis_workspace_sizes: { 'transition:horizontal': { code: .7 } }, vis_code_font_size: 14 });
  assert.equal(p.getItem(key('view-mode')), 'transition');
  assert.deepEqual(JSON.parse(p.getItem(key('panel-layout'))), { history: false, code: true });
  assert.equal(JSON.parse(p.getItem(key('workspace-sizes')))['transition:horizontal'].code, .7);
  assert.equal(p.getItem(key('code-font-size')), '14'); p.stop();
});
test('repeated changes coalesce and send only changed presentation keys', async () => {
  const { make, calls } = fixture(); const p = make();
  for (const size of [12, 13, 14]) p.setItem(key('code-font-size'), String(size));
  p.setItem(key('panel-layout'), JSON.stringify({ history: true }));
  await p.flush();
  assert.deepEqual(calls, [{ owner: 'a', patch: { vis_code_font_size: 14, vis_panel_layout: { history: true } } }]);
  assert.equal(p.status, 'saved'); await p.flush(); assert.equal(calls.length, 1); p.stop();
});
test('reload retains unsent changes and retries after a network failure', async () => {
  const f = fixture(); const p = f.make('a', {}, { save: async () => { throw Error('offline'); } });
  p.setItem(key('view-mode'), 'transition'); assert.equal(await p.flush(), false); p.stop();
  const reloaded = f.make('a', { vis_view_mode: 'preview' });
  assert.equal(reloaded.getItem(key('view-mode')), 'transition');
  await reloaded.flush(); assert.equal(f.calls[0].patch.vis_view_mode, 'transition'); reloaded.stop();
});
test('a clean reload uses server settings changed on another device', async () => {
  const f = fixture(); const p = f.make('a', { vis_view_mode: 'transition' });
  p.setItem(key('view-mode'), 'preview'); await p.flush(); p.stop();
  const reloaded = f.make('a', { vis_view_mode: 'transition' });
  assert.equal(reloaded.getItem(key('view-mode')), 'transition'); reloaded.stop();
});
test('new edits made during a save survive its acknowledgement', async () => {
  const f = fixture(); let done;
  const p = f.make('a', {}, { save: () => new Promise(resolve => { done = resolve; }) });
  p.setItem(key('code-font-size'), '12'); const saving = p.flush();
  p.setItem(key('code-font-size'), '15'); done(); await saving; p.stop();
  const reloaded = f.make('a', { vis_code_font_size: 12 });
  assert.equal(reloaded.getItem(key('code-font-size')), '15');
  await reloaded.flush(); assert.equal(f.calls[0].patch.vis_code_font_size, 15); reloaded.stop();
});
test('account switch isolates caches, pending writes, and legacy migration', async () => {
  const f = fixture(); f.storage.setItem(key('panel-layout'), '{"code":true}'); let owner = 'a';
  const a = f.make('a', {}, { isOwner: () => owner === 'a' });
  assert.equal(JSON.parse(a.getItem(key('panel-layout'))).code, true);
  a.setItem(key('code-font-size'), '15'); owner = 'b';
  assert.equal(await a.flush(), false); assert.equal(f.calls.length, 0);
  const b = f.make('b'); assert.equal(b.getItem(key('panel-layout')), null); assert.equal(b.getItem(key('code-font-size')), null);
  b.setItem(key('view-mode'), 'preview'); await b.flush(); assert.equal(f.calls[0].owner, 'b');
  a.stop(); b.stop();
});
test('invalid metadata is ignored and ratios remain within usable bounds', async () => {
  const f = fixture(); const p = f.make('a', { vis_view_mode: '<script>', vis_code_font_size: 100, vis_panel_layout: { code: 'true' } });
  assert.equal(p.getItem(key('view-mode')), null); assert.equal(p.getItem(key('code-font-size')), null);
  p.setItem(key('research_enabled'), 'true'); p.setItem(key('code-font-size'), 'null');
  await p.flush(); assert.equal(f.calls.length, 0);
  assert.deepEqual(cleanViewPreference('workspace-sizes', { 'preview:horizontal': { code: 5, history: -.2, unknown: 20 } }), { 'preview:horizontal': { code: .95, history: .05 } });
  p.stop();
});
test('resetting a layout persists empty sizes instead of reviving old geometry', async () => {
  const f = fixture(); const p = f.make('a', { vis_workspace_sizes: { 'preview:horizontal': { code: .7 } } });
  p.setItem(key('workspace-sizes'), '{}'); await p.flush(); assert.deepEqual(f.calls[0].patch.vis_workspace_sizes, {}); p.stop();
});
test('blocked browser storage still syncs preferences without breaking controls', async () => {
  const f = fixture(); const p = f.make('a', {}, { storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } });
  p.setItem(key('view-mode'), 'transition'); await p.flush(); assert.equal(f.calls[0].patch.vis_view_mode, 'transition'); p.stop();
});
