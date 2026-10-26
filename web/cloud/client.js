import { createResearchOutbox } from '../research/outbox.js';
import { unpackBatch } from '../research/batch.js';
import { createClient } from '@supabase/supabase-js';
import { createCloudLocal } from './local.js';
import { changesBetween, sameDocument, contentHash, projectRecords, reportContext } from './documents.js';
import { CONSENT_VERSION, researchPayload } from './privacy.js';

const fail = result => { if (result.error) throw result.error; return result.data; };
export async function createAccount({ changed = () => {}, status = () => {}, config: suppliedConfig, client: suppliedClient, local: suppliedLocal } = {}) {
  const config = suppliedConfig ?? await fetch('/api/config').then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const local = suppliedLocal ?? createCloudLocal();
  // IndexedDB limits the key scan before transferring anything to this thread.
  // The filter preserves compatibility with older/test storage adapters.
  const keysWithPrefix = async prefix => (await local.keys(prefix)).filter(key => key.startsWith(prefix));
  const updateLocal = local.update ? (key, transform) => local.update(key, transform) : async (key, transform) => {
    const value = transform(await local.get(key)); if (value !== undefined) await local.put(key, value); return value;
  };
  const hasPendingProject = async (owner, id, head) => {
    if (head?.pendingJobKey) {
      // A conflict recovery can move the same durable job key to a new project
      // after another tab has read the old head. Verify its current identity.
      const pointed = await local.get(head.pendingJobKey);
      if (pointed?.id === id) return true;
    }
    // An older tab may have queued work after this head was written. A stale
    // or already drained pointer is not proof that all project jobs are gone.
    for (const key of await keysWithPrefix(`job:${owner}:`)) if (key !== head?.pendingJobKey && (await local.get(key))?.id === id) return true;
    return false;
  };
  if (!config.supabaseUrl || !config.supabaseKey) return { configured: false, local };
  const client = suppliedClient ?? createClient(config.supabaseUrl, config.supabaseKey, { auth: { flowType: 'pkce', detectSessionInUrl: true,
    persistSession: true, autoRefreshToken: true } });
  let user = null, profile = null, sequence = 0, session = crypto.randomUUID(), current = null;
  let draining = null, drainAgain = false, recording = Promise.resolve(), packing = Promise.resolve(), switching = true, lastJobTime = 0;
  let consentRetry = null;
  let loaded = false, initialized = false, authQueue = Promise.resolve(), recovery = false;
  const queuedSnapshots = new Map();
  const removingProjects = new Map();
  const removalKey = (owner, id) => `${owner}:${id}`;
  const pendingThumbnails = new Set();
  const importedCache = new WeakMap(), uploaded = new Set();
  const release = config.release ?? 'development';
  const redirectTo = location.origin + '/';
  const research = createResearchOutbox({ local,
    workerFactory: typeof Worker === 'function' ? () => new Worker('/output/workers/research.js', { type: 'module' }) : undefined,
    async send(batch, valid) {
      if (suppliedClient) {
        const result=fail(await client.rpc('record_research_batch',{batch:await unpackBatch(batch),release}));
        return result;
      }
      const { session: auth } = fail(await client.auth.getSession());
      if (!valid() || !auth?.access_token) return { revoked:true };
      const response=await fetch('/api/research',{method:'POST',headers:{Authorization:`Bearer ${auth.access_token}`,
        'Content-Type':'application/json','Content-Encoding':batch.encoding},body:batch.body,signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('Research sync interrupted');
      return response.json();
    }
  });
  const activeKey = id => `active:${id}`;
  const guest = () => user?.is_anonymous === true;
  const requireMember = () => { if (!user || guest()) throw new Error('Sign in to save and manage projects.'); };
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
    const identityChanged = !loaded || identity?.id !== user?.id || identity?.is_anonymous !== user?.is_anonymous;
    if (identityChanged) {
      switching = true;
      await packing.catch(() => {}); user = identity; profile = null; current = null; uploaded.clear(); queuedSnapshots.clear();
      session = crypto.randomUUID(); sequence = 0;
      if (user && !guest()) current = await local.get(activeKey(user.id));
    }
    if (user) {
      const result = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!result.error) profile = result.data;
    }
    if (user) {
      try {if(await local.get(`research-optout:${user.id}`))profile={...profile,research_enabled:false};}
      catch {profile={...profile,research_enabled:false};} // Fail closed; telemetry storage cannot lock the editor.
    }
    research.configure(user?.id,profile);
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
    for (const key of await keysWithPrefix(`event:${owner}:`)) await local.remove(key);
  }
  async function consent(enabled) {
    const owner = user?.id;
    if (!owner) throw new Error('Sign in first.');
    // Stop immediately on withdrawal, including events already waiting locally.
    if (!enabled) { const revoked=research.revoke(); profile = { ...profile, research_enabled: false }; notify(); await local.put(`research-optout:${owner}`,'consent'); await revoked; await recording; await discardEvents(owner); }
    const updated = fail(await client.rpc('set_research_consent_v2', { enabled }));
    await local.remove(`research-optout:${owner}`);
    if(user?.id!==owner)return updated;
    profile=updated;
    research.configure(owner,profile); research.broadcast();
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
    if (!user || guest() || switching) return Promise.resolve();
    const owner = user.id, target = current ?? { id: crypto.randomUUID(), title: 'Untitled visualization', revision: 0, snapshot: null };
    current = target;
    // Serialize before project switches; jobs keep their own immutable identity.
    const run = async () => {
      if (removingProjects.get(removalKey(owner, target.id))?.completed) return;
      const snapshot = await pack(project);
      // An inline rename queued before this autosave owns the latest title.
      const latest = current?.id === target.id ? current : await local.get(`head:${owner}:${target.id}`) ?? target;
      await queueSnapshot(owner, { ...target, title: latest.title }, snapshot, thumbnail);
    };
    packing = packing.catch(() => {}).then(run); return packing;
  }
  async function queueSnapshot(owner, target, snapshot, thumbnail) {
    if (removingProjects.get(removalKey(owner, target.id))?.completed) return;
    const comparable = { ...snapshot, savedAt: undefined, projectTitle: target.title };
    if (sameDocument(queuedSnapshots.get(target.id), comparable)) return;
    // Preserve a caller's value at submission time without expanding shared
    // historical calls into a quadratic JSON string. Keep only a small working
    // set of projects, and release it when the account changes.
    const signature = structuredClone(comparable);
    const operation = crypto.randomUUID();
    const deferred = typeof thumbnail?.then === 'function';
    const job = { owner, id: target.id, operation, title: target.title, snapshot, thumbnail: deferred ? null : thumbnail, time: lastJobTime = Math.max(Date.now(), lastJobTime + 1) };
    const key = `job:${owner}:${String(job.time).padStart(16, '0')}:${operation}`, headKey = `head:${owner}:${target.id}`;
    if (deferred) pendingThumbnails.add(key);
    try {
      await local.put(key, job);
      await local.put(headKey, { ...target, localSnapshot: snapshot, thumbnail: job.thumbnail,
        thumbnailOperation: operation, pendingJobKey: key, updated_at: new Date().toISOString() });
    } catch (error) { pendingThumbnails.delete(key); throw error; }
    if (user?.id === owner && current?.id === target.id) await local.put(activeKey(owner), current);
    queuedSnapshots.delete(target.id); queuedSnapshots.set(target.id, signature);
    if (queuedSnapshots.size > 8) queuedSnapshots.delete(queuedSnapshots.keys().next().value);
    status('Saved locally · syncing…'); notify();
    if (deferred) {
      // Persist every revision before waiting for derived pixels. After a tab
      // closes, the already durable job can sync without its optional image.
      Promise.resolve(thumbnail).catch(() => null).then(async image => {
        await updateLocal(key, pending => pending ? { ...pending, thumbnail: image } : undefined);
        // Check and write in one transaction: a late PNG must not overwrite a
        // newer project's pending-key metadata or full authoring snapshot.
        await updateLocal(headKey, head => head?.thumbnailOperation === operation ? { ...head, thumbnail: image } : undefined);
      }).catch(() => {}).finally(() => { pendingThumbnails.delete(key); drain(); });
    }
    drain();
  }
  async function drainJobs(owner) {
    if (guest()) return;
    for (const key of (await keysWithPrefix(`job:${owner}:`)).sort()) {
      if (user?.id !== owner) return;
      const job = await local.get(key);
      if (!job) continue; // Another tab may already have drained this key.
      if (removingProjects.has(removalKey(owner, job.id))) continue;
      if (pendingThumbnails.has(key)) return;
      const headKey = `remote:${owner}:${job.id}`;
      let head = await local.get(headKey) ?? { revision: 0, snapshot: null };
      const snapshot = await ensureData(job.snapshot, owner);
      if (removingProjects.has(removalKey(owner, job.id))) continue;
      const request = { project: job.id, name: job.title, document: snapshot, expected: head.revision,
        operation: job.operation, changes: changesBetween(head.snapshot, snapshot), thumbnail: job.thumbnail ?? null };
      const result = await client.rpc('save_project', request);
      if (result.error?.code === '40001') {
        if (removingProjects.has(removalKey(owner, job.id))) continue;
        // Preserve this device's edit as a separate project instead of overwriting
        // changes another tab/device saved. Remaining queued jobs follow the fork.
        const id = crypto.randomUUID(), title = `${job.title.slice(0, 125)} (recovered copy)`;
        for (const pendingKey of await keysWithPrefix(`job:${owner}:`)) {
          await updateLocal(pendingKey, pending => pending?.id === job.id ? { ...pending, id, title } : undefined);
        }
        // Those durable keys now belong to the recovered copy. The old head
        // must not claim it has pending work through its previous fast lookup.
        await updateLocal(`head:${owner}:${job.id}`, head => head ? { ...head, pendingJobKey: null } : undefined);
        queuedSnapshots.delete(job.id);
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
    const keys = (await keysWithPrefix(`event:${owner}:`)).sort().slice(0, 200);
    if (!keys.length) return;
    const entries = await Promise.all(keys.map(k => local.get(k)));
    const events = entries.filter(e => e.consent === consentRevision).map(({ consent, ...e }) => e);
    if (events.length) fail(await client.rpc('record_interactions', { events, consent: consentRevision, release }));
    for (const key of keys) await local.remove(key);
  }
  function retryConsent() {
    if(consentRetry||!user||!navigator.onLine)return consentRetry;
    const owner=user.id;
    consentRetry=(async()=>{
      const pending=await local.get(`research-optout:${owner}`);if(!pending||user?.id!==owner)return;
      const updated=fail(await client.rpc(pending==='delete'?'delete_my_research':'set_research_consent_v2',pending==='delete'?{}:{enabled:false,scopes:{}}));
      await local.remove(`research-optout:${owner}`);
      if(user?.id===owner){profile=updated;research.configure(owner,profile);research.broadcast();notify();}
    })().catch(()=>{}).finally(()=>{consentRetry=null;});return consentRetry;
  }
  function drain() {
    retryConsent();research.drain();
    if (!user || !navigator.onLine) return draining;
    if (draining) { drainAgain = true; return draining; }
    const owner = user.id;
    draining = (async () => {
      do {
        drainAgain = false;
        await drainJobs(owner); await recording;
        if (user?.id === owner) await drainEvents(owner);
      } while (drainAgain && user?.id === owner && navigator.onLine);
    })()
      .catch(() => status(guest() ? 'History sync will retry' : 'Saved locally · sync will retry', true)).finally(() => { draining = null; });
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
    requireMember();
    await packing; await drain();
    const pending = await local.get(`head:${user.id}:${id}`);
    const hasPending = await hasPendingProject(user.id, id, pending);
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
    if (guest()) { current = null; return; }
    await packing; current = { id: crypto.randomUUID(), title, revision: 0 };
    if (user) await local.put(activeKey(user.id), current); notify();
  }
  async function remove(id) {
    requireMember();
    const owner = user.id, identity = removalKey(owner, id);
    if (removingProjects.has(identity)) return removingProjects.get(identity).promise;
    // Fence sync immediately, including thumbnail completions, then serialize
    // deletion with packing. An already-running RPC finishes before DELETE;
    // later autosaves captured for this project cannot resurrect it afterward.
    const removal = { completed: false };
    removingProjects.set(identity, removal);
    const operation = packing.catch(() => {}).then(async () => {
      if (user?.id !== owner) throw new Error('Account changed.');
      await drain();
      if (user?.id !== owner) throw new Error('Account changed.');
      fail(await client.from('projects').delete().eq('id', id));
      removal.completed = true;
      for (const key of await keysWithPrefix(`job:${owner}:`)) if ((await local.get(key))?.id === id) await local.remove(key);
      await local.remove(`head:${owner}:${id}`); await local.remove(`remote:${owner}:${id}`);
      await local.remove(`thumbnail:${owner}:${id}`);
      queuedSnapshots.delete(id);
      const cached = await local.get(`projects:${owner}`);
      if (cached) await local.put(`projects:${owner}`, cached.filter(row => row.id !== id));
      if (user?.id === owner && current?.id === id) {
        current = { id: crypto.randomUUID(), title: 'Untitled visualization', revision: 0 };
        await local.put(activeKey(owner), current); notify();
      }
    });
    // The caller receives the deletion error. Other workspace operations only
    // await its ordering barrier and must remain usable after a failed DELETE.
    packing = operation.catch(() => {});
    removal.promise = operation.finally(() => {
      // Keep the fence until work captured before the active identity changed
      // has been processed. Release it on failure so all edits remain retryable.
      const captured = packing;
      captured.catch(() => {}).then(() => {
        if (removingProjects.get(identity) === removal) removingProjects.delete(identity);
        drain();
      });
    });
    return removal.promise;
  }
  // Thumbnail repair reads only the selected dataset. It must never activate a
  // project, replay its history, or create an autosave/research revision.
  async function preview(row) {
    requireMember();
    const owner = user?.id;
    const checkOwner = () => { if (!owner || switching || user?.id !== owner) throw new Error('Account changed.'); };
    checkOwner(); await packing; checkOwner();
    const head = await local.get(`head:${owner}:${row.id}`), cached = await local.get(`remote:${owner}:${row.id}`);
    const hasPending = await hasPendingProject(owner, row.id, head);
    checkOwner();
    let snapshot;
    if (head?.localSnapshot && hasPending) snapshot = head.localSnapshot;
    else if (cached && cached.revision === row.revision) snapshot = cached.snapshot;
    else if (navigator.onLine) snapshot = fail(await client.from('projects').select('snapshot').eq('id', row.id).single())?.snapshot;
    else snapshot = cached?.snapshot ?? head?.localSnapshot;
    checkOwner();
    const active = snapshot?.datasets.find(dataset => dataset.id === snapshot.activeId);
    if (!active) throw new Error('Project preview unavailable.');
    const project = await hydrate({ ...snapshot, datasets: [active] }, navigator.onLine);
    checkOwner(); return project.datasets[0];
  }
  function rename(title, id = current?.id) {
    requireMember();
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
  function duplicate(id) {
    requireMember();
    const owner = user?.id;
    if (!owner || !id) return Promise.reject(new Error('Select a visualization first.'));
    const run = async () => {
      const checkOwner = () => { if (user?.id !== owner || switching) throw new Error('Account changed.'); };
      checkOwner();
      let head = await local.get(`head:${owner}:${id}`);
      const hasPending = await hasPendingProject(owner, id, head);
      // Copy pending work when offline/unsynced; otherwise use the server's
      // latest revision, including changes made on another device.
      if (!head?.localSnapshot || (navigator.onLine && !hasPending)) {
        const row = fail(await client.from('projects').select('*').eq('id', id).single());
        if (!row?.snapshot) throw new Error('Project unavailable.');
        head = { ...row, localSnapshot: row.snapshot };
      }
      checkOwner();
      const copy = { id: crypto.randomUUID(), title: `${head.title.slice(0, 153)} (copy)`, revision: 0 };
      // Reuse immutable dataset references and the normal durable outbox. Do
      // not open either project or change this device's active workspace.
      await queueSnapshot(owner, copy, head.localSnapshot, head.thumbnail);
      return local.get(`head:${owner}:${copy.id}`);
    };
    packing = packing.catch(() => {}).then(run); return packing;
  }
  async function list() {
    requireMember();
    await packing; await drain();
    const owner = user.id, cacheKey = `projects:${owner}`;
    const result = await client.from('projects').select('id,title,revision,thumbnail,updated_at').order('updated_at', { ascending: false });
    let rows = result.error ? (await local.get(cacheKey) ?? []) : result.data;
    if (!result.error) await local.put(cacheKey, rows);
    const records = new Map(rows.map(row => [row.id, row]));
    // Offline and newly created projects stay discoverable before first sync.
    for (const key of await keysWithPrefix(`head:${owner}:`)) {
      const row = await local.get(key);
      if (!records.has(row.id) || row.updated_at > records.get(row.id).updated_at) {
        const {localSnapshot, ...meta} = row; records.set(row.id, meta);
      }
    }
    return [...records.values()].sort((a,b) => b.updated_at.localeCompare(a.updated_at));
  }
  const interval = setInterval(drain, 5000); window.addEventListener('online', drain);
  const hidden = () => { if (document.hidden) { research.emit('navigation', {reason:'hidden'}); research.flush().then(()=>research.drain()); drain(); } };
  document.addEventListener('visibilitychange', hidden);
  return { configured: true, client, local, release, recovery, get user() { return user; }, get guest() { return guest(); }, get profile() { return profile; },
    get current() { return current; }, get loaded() { return loaded; }, research, record, save, consent, drain, open, newProject, rename,
    list, preview, duplicate, remove,
    datasets: async () => { requireMember(); return fail(await client.from('datasets').select('id,name,path,hash,created_at').order('created_at', { ascending: false })); },
    loadDataset: async row => { requireMember(); return JSON.parse(await fail(await client.storage.from('workspace').download(row.path)).text()); },
    async report({ kind, title, description, project, shareData, isAiAgent = false }) {
      if (shareData) requireMember();
      let context = project ? shareData ? await ensureData(await pack(project), user.id) : reportContext(await pack(project)) : null;
      // Per-report self-identification, separate from data-sharing or research consent.
      context = { ...context, reporter: { isAiAgent: isAiAgent === true } };
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
    tryWithoutAccount: async () => user ?? fail(await client.auth.signInAnonymously()).user,
    google: async () => fail(await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })),
    signIn: async (email, password) => fail(await client.auth.signInWithPassword({ email, password })),
    signUp: async (email, password) => fail(await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })),
    recover: async email => fail(await client.auth.resetPasswordForEmail(email, { redirectTo })),
    password: async password => fail(await client.auth.updateUser({ password })),
    async deleteResearch() { const owner=user?.id;if(!owner)return;const revoked=research.revoke();profile={...profile,research_enabled:false};notify();await local.put(`research-optout:${owner}`,'delete');await revoked;const updated=fail(await client.rpc('delete_my_research'));await local.remove(`research-optout:${owner}`);if(user?.id!==owner)return;profile=updated;research.configure(owner,profile);research.broadcast();notify(); },
    destroy() { research.destroy(); clearInterval(interval); subscription.data.subscription.unsubscribe(); window.removeEventListener('online', drain); document.removeEventListener('visibilitychange', hidden); }
  };
}
