import { createClient } from '@supabase/supabase-js';
import { createCloudLocal } from './local.js';
import { changesBetween, contentHash, projectRecords, reportContext } from './documents.js';
import { CONSENT_VERSION, researchPayload } from './privacy.js';

const fail = result => { if (result.error) throw result.error; return result.data; };
export async function createAccount({ changed = () => {}, status = () => {}, config: suppliedConfig, client: suppliedClient, local: suppliedLocal } = {}) {
  const config = suppliedConfig ?? await fetch('/api/config').then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const local = suppliedLocal ?? createCloudLocal();
  if (!config.supabaseUrl || !config.supabaseKey) return { configured: false, local };
  const client = suppliedClient ?? createClient(config.supabaseUrl, config.supabaseKey, { auth: { flowType: 'pkce', detectSessionInUrl: true,
    persistSession: true, autoRefreshToken: true } });
  let user = null, profile = null, sequence = 0, session = crypto.randomUUID(), current = null;
  let draining = null, recording = Promise.resolve(), packing = Promise.resolve(), switching = true, lastJobTime = 0;
  let loaded = false, initialized = false, authQueue = Promise.resolve(), recovery = false;
  const queuedSnapshots = new Map();
  const importedCache = new WeakMap(), uploaded = new Set();
  const release = config.release ?? 'development';
  const redirectTo = location.origin + '/';
  const activeKey = id => `active:${id}`;
  const notify = extra => changed({ user, profile, current, configured: true, ...extra });
  async function authenticate(event, authSession) {
    let identity = authSession?.user ?? null;
    // A persisted session is only a candidate. Verify it before allowing the
    // editor to restore private drafts, including on a fresh page load.
    if (identity && (!loaded || identity.id !== user?.id)) {
      const verified = await client.auth.getUser(authSession.access_token);
      if (verified.error && ![401, 403].includes(verified.error.status)) throw verified.error;
      identity = verified.error ? null : verified.data.user;
    }
    const identityChanged = !loaded || identity?.id !== user?.id;
    if (identityChanged) {
      switching = true;
      await packing.catch(() => {}); user = identity; profile = null; current = null; uploaded.clear();
      session = crypto.randomUUID(); sequence = 0;
      if (user) current = await local.get(activeKey(user.id));
    }
    if (user) {
      const result = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!result.error) profile = result.data;
    }
    loaded = true;
    if (initialized) await notify({ identityChanged, recovery: event === 'PASSWORD_RECOVERY' });
    switching = false;
    if (profile?.research_enabled !== true) await discardEvents(user?.id);
    if (initialized) drain();
  }
  // Serialize identity transitions, outside Supabase's auth callback lock.
  const subscription = client.auth.onAuthStateChange((event, authSession) => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    if (!initialized) return;
    setTimeout(() => { authQueue = authQueue.catch(() => {}).then(() => authenticate(event, authSession))
      .catch(() => status('Account connection interrupted. Please try signing in again.', true)); }, 0);
  });
  const initial = fail(await client.auth.getSession());
  await authenticate('INITIAL_SESSION', initial.session);
  initialized = true;
  async function discardEvents(owner) {
    if (!owner) return;
    for (const key of await local.keys()) if (key.startsWith(`event:${owner}:`)) await local.remove(key);
  }
  async function consent(enabled) {
    const owner = user?.id;
    if (!owner) throw new Error('Sign in first.');
    // Stop immediately on withdrawal, including events already waiting locally.
    if (!enabled) { profile = { ...profile, research_enabled: false }; await recording; await discardEvents(owner); notify(); }
    profile = fail(await client.rpc('set_research_consent', { enabled }));
    await discardEvents(owner); notify(); return profile;
  }
  async function pack(project) {
    const records = [];
    for (const record of projectRecords(project)) {
      let ref = importedCache.get(record.imported);
      if (!ref) {
        const body = JSON.stringify(record.imported), hash = await contentHash(body);
        await local.put(`data:${hash}`, body); ref = { hash }; importedCache.set(record.imported, ref);
      }
      const { imported, ...metadata } = record;
      records.push({ ...metadata, importRef: ref });
    }
    return { ...project, datasets: records };
  }
  async function hydrate(snapshot, remote = true) {
    const datasets = [];
    for (const d of snapshot.datasets) {
      let body = await local.get(`data:${d.importRef.hash}`);
      if (!body && remote) { body = await fail(await client.storage.from('workspace').download(d.importRef.path)).text(); await local.put(`data:${d.importRef.hash}`, body); }
      if (!body) throw new Error('This dataset is not available offline.');
      const { importRef, ...rest } = d; datasets.push({ ...rest, imported: JSON.parse(body) });
    }
    return { ...snapshot, datasets };
  }
  async function ensureData(snapshot, owner) {
    const records = [];
    for (const d of snapshot.datasets) {
      const path = `${owner}/datasets/${d.importRef.hash}.json`;
      if (!uploaded.has(path)) {
        const existing = fail(await client.from('datasets').select('id').eq('hash', d.importRef.hash).maybeSingle());
        if (!existing) {
          const body = await local.get(`data:${d.importRef.hash}`);
          const upload = await client.storage.from('workspace').upload(path, new Blob([body], { type: 'application/json' }), { upsert: false });
          if (upload.error && !['409', 'Duplicate'].includes(String(upload.error.statusCode ?? upload.error.error))) {
            // A retry after upload but before metadata commit sees the existing object.
            const probe = await client.storage.from('workspace').download(path); if (probe.error) throw upload.error;
          }
          const added = await client.from('datasets').insert({ owner_id: owner, name: d.name.slice(0, 200), hash: d.importRef.hash, path });
          if (added.error && added.error.code !== '23505') throw added.error;
        }
        uploaded.add(path);
      }
      records.push({ ...d, importRef: { ...d.importRef, path } });
    }
    return { ...snapshot, datasets: records };
  }
  function save(project, thumbnail) {
    if (!user || switching) return Promise.resolve();
    const owner = user.id, target = current ?? { id: crypto.randomUUID(), title: 'Untitled visualization', revision: 0, snapshot: null };
    current = target;
    // Serialize before project switches; jobs keep their own immutable identity.
    const run = async () => {
      const snapshot = await pack(project);
      // An inline rename queued before this autosave owns the latest title.
      const latest = current?.id === target.id ? current : await local.get(`head:${owner}:${target.id}`) ?? target;
      await queueSnapshot(owner, { ...target, title: latest.title }, snapshot, thumbnail);
    };
    packing = packing.catch(() => {}).then(run); return packing;
  }
  async function queueSnapshot(owner, target, snapshot, thumbnail) {
    const signature = JSON.stringify({ ...snapshot, savedAt: undefined, projectTitle: target.title });
    if (queuedSnapshots.get(target.id) === signature) return;
    const operation = crypto.randomUUID();
    const job = { owner, id: target.id, operation, title: target.title, snapshot, thumbnail, time: lastJobTime = Math.max(Date.now(), lastJobTime + 1) };
    await local.put(`job:${owner}:${String(job.time).padStart(16, '0')}:${operation}`, job);
    await local.put(`head:${owner}:${target.id}`, { ...target, localSnapshot: snapshot, thumbnail, updated_at: new Date().toISOString() });
    if (user?.id === owner && current?.id === target.id) await local.put(activeKey(owner), current);
    queuedSnapshots.set(target.id, signature);
    status('Saved locally · syncing…'); notify(); drain();
  }
  async function drainJobs(owner) {
    for (const key of (await local.keys()).filter(k => k.startsWith(`job:${owner}:`)).sort()) {
      if (user?.id !== owner) return;
      const job = await local.get(key);
      const headKey = `remote:${owner}:${job.id}`;
      let head = await local.get(headKey) ?? { revision: 0, snapshot: null };
      const snapshot = await ensureData(job.snapshot, owner);
      const request = { project: job.id, name: job.title, document: snapshot, expected: head.revision,
        operation: job.operation, changes: changesBetween(head.snapshot, snapshot), thumbnail: job.thumbnail ?? null };
      const result = await client.rpc('save_project', request);
      if (result.error?.code === '40001') {
        // Preserve this device's edit as a separate project instead of overwriting
        // changes another tab/device saved. Remaining queued jobs follow the fork.
        const id = crypto.randomUUID(), title = `${job.title.slice(0, 125)} (recovered copy)`;
        for (const pendingKey of (await local.keys()).filter(k => k.startsWith(`job:${owner}:`))) {
          const pending = await local.get(pendingKey);
          if (pending.id === job.id) await local.put(pendingKey, { ...pending, id, title });
        }
        if (current?.id === job.id) { current = { id, title, revision: 0 }; await local.put(activeKey(owner), current); }
        status('Other edits were saved. Your changes are kept in a recovered copy.');
        return drainJobs(owner);
      }
      const revision = fail(result);
      head = { revision, snapshot };
      await local.put(headKey, head); await local.remove(key);
      if (current?.id === job.id && user?.id === owner) { current = { ...current, revision }; await local.put(activeKey(owner), current); }
    }
    if (current?.revision) status('Saved'); notify();
  }
  async function drainEvents(owner) {
    const consentRevision = profile?.consent_revision;
    if (profile?.research_enabled !== true) return;
    const keys = (await local.keys()).filter(k => k.startsWith(`event:${owner}:`)).sort().slice(0, 200);
    if (!keys.length) return;
    const entries = await Promise.all(keys.map(k => local.get(k)));
    const events = entries.filter(e => e.consent === consentRevision).map(({ consent, ...e }) => e);
    if (events.length) fail(await client.rpc('record_interactions', { events, consent: consentRevision, release }));
    for (const key of keys) await local.remove(key);
  }
  function drain() {
    if (!user || !navigator.onLine || draining) return draining;
    const owner = user.id;
    draining = (async () => { await drainJobs(owner); if (user?.id === owner) await drainEvents(owner); })()
      .catch(() => status('Saved locally · sync will retry', true)).finally(() => { draining = null; });
    return draining;
  }
  function record(type, input) {
    const payload = researchPayload(type, input);
    if (!payload || !user || profile?.research_enabled !== true || profile.consent_version !== CONSENT_VERSION) return;
    const owner = user.id, consent = profile.consent_revision;
    const event = { id: crypto.randomUUID(), session, sequence: ++sequence, time: new Date().toISOString(), consent, payload };
    recording = recording.then(async () => {
      if (user?.id !== owner || profile?.research_enabled !== true || profile.consent_revision !== consent) return;
      await local.put(`event:${owner}:${event.session}:${String(event.sequence).padStart(12, '0')}`, event);
    }).catch(() => {});
  }
  async function open(id) {
    await packing; await drain();
    const pending = await local.get(`head:${user.id}:${id}`);
    const pendingJobs = await Promise.all((await local.keys()).filter(k => k.startsWith(`job:${user.id}:`)).map(k => local.get(k)));
    const hasPending = pendingJobs.some(job => job.id === id);
    if (pending?.localSnapshot && hasPending) {
      const project = await hydrate(pending.localSnapshot);
      current = { id, title: pending.title, revision: pending.revision };
      await local.put(activeKey(user.id), current); notify(); return project;
    }
    const row = fail(await client.from('projects').select('*').eq('id', id).single());
    const project = await hydrate(row.snapshot);
    current = { id: row.id, title: row.title, revision: row.revision };
    await local.put(`remote:${user.id}:${id}`, { revision: row.revision, snapshot: row.snapshot });
    await local.put(activeKey(user.id), current); notify(); return project;
  }
  async function newProject(title = 'Untitled visualization') {
    await packing; current = { id: crypto.randomUUID(), title, revision: 0 };
    if (user) await local.put(activeKey(user.id), current); notify();
  }
  function rename(title, id = current?.id) {
    const owner = user?.id, name = title.trim().slice(0, 160);
    if (!owner || !id) return Promise.reject(new Error('Create a visualization first.'));
    if (!name) return Promise.reject(new Error('Enter a project name.'));
    const run = async () => {
      if (user?.id !== owner) throw new Error('Account changed.');
      let head = await local.get(`head:${owner}:${id}`);
      if (!head?.localSnapshot) {
        // Rename unopened projects without changing the active workspace or
        // hydrating their datasets. Use the same revision-checked outbox.
        const row = fail(await client.from('projects').select('*').eq('id', id).single());
        if (!row?.snapshot) throw new Error('Project unavailable.');
        head = { ...row, localSnapshot: row.snapshot };
        await local.put(`remote:${owner}:${id}`, { revision: row.revision, snapshot: row.snapshot });
      }
      if (user?.id !== owner) throw new Error('Account changed.');
      if (current?.id === id) current = { ...current, title: name };
      await queueSnapshot(owner, { id, title: name, revision: head.revision }, head.localSnapshot, head.thumbnail);
      return name;
    };
    packing = packing.catch(() => {}).then(run); return packing;
  }
  async function list() {
    await packing; await drain();
    const owner = user.id, cacheKey = `projects:${owner}`;
    const result = await client.from('projects').select('id,title,revision,thumbnail,updated_at').order('updated_at', { ascending: false });
    let rows = result.error ? (await local.get(cacheKey) ?? []) : result.data;
    if (!result.error) await local.put(cacheKey, rows);
    const records = new Map(rows.map(row => [row.id, row]));
    // Offline and newly created projects stay discoverable before first sync.
    for (const key of (await local.keys()).filter(k => k.startsWith(`head:${owner}:`))) {
      const row = await local.get(key);
      if (!records.has(row.id) || row.updated_at > records.get(row.id).updated_at) {
        const {localSnapshot, ...meta} = row; records.set(row.id, meta);
      }
    }
    return [...records.values()].sort((a,b) => b.updated_at.localeCompare(a.updated_at));
  }
  const interval = setInterval(drain, 5000); window.addEventListener('online', drain);
  const hidden = () => { if (document.hidden) drain(); };
  document.addEventListener('visibilitychange', hidden);
  return { configured: true, client, local, release, recovery, get user() { return user; }, get profile() { return profile; },
    get current() { return current; }, get loaded() { return loaded; }, record, save, consent, drain, open, newProject, rename,
    list,
    datasets: async () => fail(await client.from('datasets').select('id,name,path,hash,created_at').order('created_at', { ascending: false })),
    loadDataset: async row => JSON.parse(await fail(await client.storage.from('workspace').download(row.path)).text()),
    remove: async id => { await packing; await drain(); fail(await client.from('projects').delete().eq('id', id));
      for (const key of await local.keys()) if (key.startsWith(`job:${user.id}:`) && (await local.get(key)).id === id) await local.remove(key);
      await local.remove(`head:${user.id}:${id}`); await local.remove(`remote:${user.id}:${id}`);
      const cached = await local.get(`projects:${user.id}`); if (cached) await local.put(`projects:${user.id}`, cached.filter(row => row.id !== id));
      if (current?.id === id) await newProject(); },
    async report({ kind, title, description, project, shareData }) {
      let context = project ? await ensureData(await pack(project), user.id) : null;
      if (context && !shareData) context = reportContext(context);
      return fail(await client.from('bug_reports').insert({ owner_id: user.id, kind, title, description, context,
        share_data: Boolean(shareData), release }).select('id').single());
    },
    async saveViewPreferences(patch, owner) {
      const { session: authSession } = fail(await client.auth.getSession());
      if (!owner || user?.id !== owner || authSession?.user?.id !== owner) throw new Error('Account changed.');
      // Capture this owner's bearer token before the request so a cross-tab
      // account switch can never send the old preferences to the new account.
      const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
        method: 'PUT', headers: { apikey: config.supabaseKey, Authorization: `Bearer ${authSession.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: patch }), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('View settings will sync when the connection returns.');
      if (user?.id === owner) user = { ...user, user_metadata: { ...user.user_metadata, ...patch } };
    },
    async signOut() { await packing; await drain(); await this.flushViewPreferences?.(); fail(await client.auth.signOut()); },
    google: async () => fail(await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })),
    signIn: async (email, password) => fail(await client.auth.signInWithPassword({ email, password })),
    signUp: async (email, password) => fail(await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })),
    recover: async email => fail(await client.auth.resetPasswordForEmail(email, { redirectTo })),
    password: async password => fail(await client.auth.updateUser({ password })),
    destroy() { clearInterval(interval); subscription.data.subscription.unsubscribe(); window.removeEventListener('online', drain); document.removeEventListener('visibilitychange', hidden); }
  };
}
