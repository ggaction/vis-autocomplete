const prefix = 'vis-autocomplete.';
const fields = {
  'view-mode': 'vis_view_mode',
  'history-view': 'vis_history_view',
  'workspace-layout': 'vis_workspace_layout',
  'workspace-sizes': 'vis_workspace_sizes',
  'panel-layout': 'vis_panel_layout',
  'code-font-size': 'vis_code_font_size',
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function cleanViewPreference(name, value) {
  if (name === 'history-view') return ['linear', 'graph'].includes(value) ? value : undefined;
  if (name === 'view-mode') return ['preview', 'transition'].includes(value) ? value : undefined;
  if (name === 'code-font-size') return Number.isInteger(value) && value >= 8 && value <= 20 ? value : undefined;
  if (!object(value)) return undefined;
  const result = {};
  if (name === 'workspace-layout') {
    for (const mode of ['preview', 'transition']) if (['horizontal', 'vertical'].includes(value[mode])) result[mode] = value[mode];
  } else if (name === 'panel-layout') {
    for (const panel of ['history', 'code']) if (typeof value[panel] === 'boolean') result[panel] = value[panel];
  } else if (name === 'workspace-sizes') {
    for (const mode of ['preview', 'transition']) for (const layout of ['horizontal', 'vertical']) {
      const key = `${mode}:${layout}`, dimensions = {};
      for (const name of ['code', 'primary', 'history', 'views']) {
        const ratio = value[key]?.[name];
        if (Number.isFinite(ratio)) dimensions[name] = Math.max(.05, Math.min(.95, ratio));
      }
      if (Object.keys(dimensions).length) result[key] = dimensions;
    }
  } else return undefined;
  return result;
}
const encode = (name, value) => ['view-mode', 'history-view'].includes(name) ? value : JSON.stringify(value);
function decode(name, value) {
  try { return cleanViewPreference(name, ['view-mode', 'history-view'].includes(name) ? value : JSON.parse(value)); } catch { return undefined; }
}
const read = (storage, key) => { try { return storage?.getItem(key); } catch { return null; } };
const write = (storage, key, value) => { try { storage?.setItem(key, value); } catch { /* In-memory preferences remain usable. */ } };

// Only presentation settings enter Auth metadata. Never use user-editable
// metadata for authorization or research consent. Top-level keys let the server
// merge individual setting updates without replacing unrelated account metadata.
export function createViewPreferences({ user, storage, save, isOwner = () => true, delay = 700 }) {
  const owner = user.id, cacheKey = `${prefix}account-view:${owner}`;
  let values = {}, pending = {}, timer, inFlight, stopped = false;
  let state = 'saved';
  const load = () => {
    let record;
    try { record = JSON.parse(read(storage, cacheKey)); } catch { /* Optional cache. */ }
    return record?.version === 1 ? record : {};
  };
  const cleanMap = source => Object.fromEntries(Object.keys(fields).flatMap(name => {
    const value = cleanViewPreference(name, source?.[name]);
    return value === undefined ? [] : [[name, value]];
  }));
  const cached = load();
  pending = cleanMap(cached.pending);
  for (const [name, metadata] of Object.entries(fields)) {
    const value = cleanViewPreference(name, user.user_metadata?.[metadata]);
    if (value !== undefined) values[name] = value;
  }
  // Adopt pre-account local preferences once, for the first verified account.
  // A second account on this browser starts from its own settings/defaults.
  const legacyOwnerKey = `${prefix}view-preferences-legacy-owner`;
  if (!read(storage, legacyOwnerKey)) {
    write(storage, legacyOwnerKey, owner);
    for (const name of Object.keys(fields)) {
      const value = decode(name, read(storage, prefix + name));
      if (!(name in values) && !(name in pending) && value !== undefined) pending[name] = value;
    }
  }
  values = { ...values, ...pending };
  const persist = () => write(storage, cacheKey, JSON.stringify({ version: 1, values, pending }));
  const schedule = () => { clearTimeout(timer); if (!stopped && isOwner()) timer = setTimeout(() => void flush(), delay); };
  const refreshPending = () => {
    // Another tab may have queued newer settings. Never erase its unsent edits.
    const latest = cleanMap(load().pending);
    pending = { ...pending, ...latest }; values = { ...values, ...latest };
  };
  function flush() {
    clearTimeout(timer);
    if (inFlight) return inFlight;
    if (stopped || !isOwner()) return Promise.resolve(false);
    refreshPending();
    if (!Object.keys(pending).length) return Promise.resolve(true);
    const batch = structuredClone(pending);
    const patch = Object.fromEntries(Object.entries(batch).map(([name, value]) => [fields[name], value]));
    state = 'saving';
    inFlight = (async () => {
      try {
        await save(patch, owner);
        refreshPending();
        for (const name of Object.keys(batch)) if (JSON.stringify(pending[name]) === JSON.stringify(batch[name])) delete pending[name];
        persist(); state = Object.keys(pending).length ? 'pending' : 'saved';
        return true;
      } catch { state = 'pending'; persist(); return false; }
      finally { inFlight = null; if (Object.keys(pending).length && state !== 'pending') schedule(); }
    })();
    // Flush edits made during a successful request; failures wait for online,
    // the bounded retry interval, or the next change instead of a tight loop.
    inFlight.then(ok => { if (ok && Object.keys(pending).length) schedule(); });
    return inFlight;
  }
  persist();
  if (Object.keys(pending).length) { state = 'pending'; schedule(); }
  return {
    get status() { return state; },
    getItem(key) { const name = key.replace(prefix, ''); return values[name] === undefined ? null : encode(name, values[name]); },
    setItem(key, raw) {
      if (stopped || !isOwner()) return;
      const name = key.replace(prefix, ''), value = decode(name, raw);
      if (value === undefined || JSON.stringify(value) === JSON.stringify(values[name])) return;
      refreshPending(); values[name] = value; pending[name] = value;
      state = 'pending'; persist(); schedule();
    },
    flush,
    stop() { stopped = true; clearTimeout(timer); },
  };
}

let active;
export function readViewPreference(key) { return active ? active.getItem(key) : read(globalThis.localStorage, key); }
export function writeViewPreference(key, value) { if (active) active.setItem(key, value); else write(globalThis.localStorage, key, value); }
export function initializeAccountViewPreferences(account) {
  active?.stop();
  const owner = account.user.id;
  let storage; try { storage = globalThis.localStorage; } catch { /* Optional cache. */ }
  const prefs = active = createViewPreferences({ user: account.user, storage,
    save: (patch, id) => account.saveViewPreferences(patch, id), isOwner: () => account.user?.id === owner });
  const mode = prefs.getItem(prefix + 'view-mode') === 'preview' ? 'preview' : 'transition';
  const layouts = JSON.parse(prefs.getItem(prefix + 'workspace-layout') ?? '{}');
  document.documentElement.dataset.viewMode = mode;
  document.documentElement.dataset.workspaceLayout = layouts[mode] ?? (mode === 'transition' ? 'vertical' : 'horizontal');
  const flush = () => void prefs.flush();
  window.addEventListener('online', flush);
  window.addEventListener('pagehide', flush);
  const hidden = () => { if (document.hidden) flush(); };
  document.addEventListener('visibilitychange', hidden);
  const interval = setInterval(flush, 15_000);
  account.flushViewPreferences = () => prefs.flush();
  return () => { prefs.stop(); clearInterval(interval); window.removeEventListener('online', flush);
    window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden); };
}
