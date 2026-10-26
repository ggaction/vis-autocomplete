import { chart } from 'ggaction';
import { PUBLIC_ACTION_NAMES } from '../src/public-actions.js';
import { programCode } from './code-view.js';
import { captureHistorySnapshot, isHistorySnapshot, prepareCapturedHistory, normalizeHistoryGraph } from './history.js';
import { createLRU, freezeResult } from '../src/cache.js';

const publicMethods = new Set(PUBLIC_ACTION_NAMES.filter(name => name !== 'constructor'));
const metadataKeys = ['setupCalls', 'calls', 'context', 'steps', 'guideCall', 'selection', 'plotData',
  'optionGroup', 'phase', 'currentNote'];
const groups = new Set(['encoding', 'transform', 'style']);
const fieldTypes = new Set(['quantitative', 'nominal', 'ordinal', 'temporal']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validatedImports = new WeakMap();
const packedSnapshots = new WeakMap(), trustedPacked = new WeakSet(), normalizedSnapshots = new WeakMap();
const deferredSnapshots = new WeakMap();
export async function prepareHistorySnapshot(snapshot) {
  const deferred = deferredSnapshots.get(snapshot);
  await deferred?.prepare();
  await prepareCapturedHistory(deferred?.result ?? snapshot);
}
export const PROJECT_FORMAT = 'visualization-autocomplete';
export const PROJECT_VERSION = 2;
const checkpointDatasets = new WeakMap();
function datasetRevision(imported) {
  if (!checkpointDatasets.has(imported)) checkpointDatasets.set(imported, crypto.randomUUID());
  return checkpointDatasets.get(imported);
}
export function checkpointRevision(project) {
  const record = project?.datasets?.find(record => record.id === project.activeId), session = record?.session;
  const entry = session?.entries[session.index];
  if (!record?.imported) return null;
  // Imports are immutable revisions. Persist their identity instead of hashing
  // every cell or delaying the authoritative draft write for a cache checksum.
  return JSON.stringify([project.activeId, datasetRevision(record.imported), session?.index,
    entry?.setupCalls, entry?.calls, entry?.guideCall]);
}

// Save public authoring calls, once-per-dataset source values, and history position.
// Previews and rendered SVG caches never become persisted authoring state.
export function packSession(session) {
  if (!session) return null;
  return { index: session.index, ...(session.graph ? { graph: session.graph } : {}), entries: session.entries.map(snapshot => {
    const deferred = deferredSnapshots.get(snapshot);
    // Autosave must not render every historical chart just to recover its
    // authoring calls. Resolved entries may include a native layout repair.
    if (deferred) {
      if (!deferred.result) return deferred.stored;
      snapshot = deferred.result;
    }
    if (packedSnapshots.has(snapshot)) return packedSnapshots.get(snapshot);
    const trusted = isHistorySnapshot(snapshot);
    const packed = { ...Object.fromEntries(metadataKeys.map(key =>
      [key, trusted ? snapshot[key] : structuredClone(snapshot[key])])),
      axesCalls: structuredClone(snapshot.selectionAxes?.calls ?? []) };
    if (trusted) { freezeResult(packed); packedSnapshots.set(snapshot, packed); trustedPacked.add(packed); }
    return packed;
  }) };
}

export function createProject(records, activeId, ggaction = null) {
  const datasets = records.map(({ id, name, imported, session }) => ({ id, name,
    imported, session: packSession(session) }));
  return validateProject({ format: PROJECT_FORMAT, version: PROJECT_VERSION,
    savedAt: new Date().toISOString(), ggaction, activeId, datasets });
}

function validateCall(call) {
  if (!plain(call) || !publicMethods.has(call.method) || !plain(call.args)) {
    throw new TypeError('The project contains an unknown ggaction call.');
  }
}

function validateImported(imported, name) {
  if (!plain(imported)) throw new TypeError(`Dataset ${name} has no usable table.`);
  const cached = validatedImports.get(imported);
  // The application treats every import as an immutable revision; do not scan
  // hundreds of thousands of source cells again on each autosave.
  if (cached && cached.rows === imported.rows && cached.hints === imported.fieldTypes) return cached.names;
  const rows = imported.rows;
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !plain(row))) throw new TypeError(`Dataset ${name} has no usable table.`);
  const names = new Set(); for (const row of rows) for (const key of Object.keys(row)) if (key) names.add(key);
  if (!names.size) throw new TypeError(`Dataset ${name} has no usable columns.`);
  if (imported.rawRows !== undefined && (!Array.isArray(imported.rawRows) || imported.rawRows.length !== rows.length || imported.rawRows.some(row => !plain(row)))) {
    throw new TypeError(`Dataset ${name} has invalid original rows.`);
  }
  if (imported.metadata !== undefined && !plain(imported.metadata) || imported.options !== undefined && !plain(imported.options)) {
    throw new TypeError(`Dataset ${name} has invalid import metadata.`);
  }
  const hints = imported.fieldTypes ?? {};
  if (!plain(hints)) throw new TypeError(`Dataset ${name} has invalid field types.`);
  for (const [field, hint] of Object.entries(hints)) {
    const type = typeof hint === 'string' ? hint : plain(hint) ? hint.type : null;
    if (!names.has(field) || !fieldTypes.has(type) || plain(hint) && hint.order !== undefined &&
        (!Array.isArray(hint.order) || hint.order.some(value => value !== null && !['number', 'string', 'boolean'].includes(typeof value)))) {
      throw new TypeError(`Dataset ${name} has an invalid field type: ${field}.`);
    }
  }
  validatedImports.set(imported, { rows, hints: imported.fieldTypes, names });
  return names;
}

function normalizeSession(session, names) {
  if (session === null || session === undefined) return null;
  if (!plain(session) || !Array.isArray(session.entries) || !session.entries.length || session.entries.length > 10000 ||
      !Number.isInteger(session.index) || session.index < 0 || session.index >= session.entries.length) throw new TypeError('Invalid project history position.');
  const entries = session.entries.map(snapshot => {
    const cached = normalizedSnapshots.get(snapshot)?.get(names);
    if (cached) return cached;
    if (!plain(snapshot) || !['initial', 'recommendations'].includes(snapshot.phase) || !Number.isInteger(snapshot.steps) || snapshot.steps < 0 ||
        !plain(snapshot.selection) || !Array.isArray(snapshot.setupCalls) || !Array.isArray(snapshot.calls)) throw new TypeError('Invalid project history entry.');
    const axesCalls = snapshot.axesCalls ?? [];
    if (![snapshot.setupCalls, snapshot.calls, axesCalls].every(calls => Array.isArray(calls) && calls.length <= 10000)) throw new TypeError('Invalid project history calls.');
    for (const call of [...snapshot.setupCalls, ...snapshot.calls, ...axesCalls,
      ...(snapshot.guideCall ? [snapshot.guideCall] : [])]) validateCall(call);
    if (snapshot.guideCall != null && snapshot.guideCall.method !== 'createGuides') throw new TypeError('Invalid final guide call.');
    const optionGroup = snapshot.optionGroup ?? 'encoding';
    if (!groups.has(optionGroup)) throw new TypeError('Invalid project option group.');
    if (snapshot.selection.fields !== undefined && (!Array.isArray(snapshot.selection.fields) ||
        snapshot.selection.fields.some(field => typeof field !== 'string' || !names.has(field)))) {
      throw new TypeError('Invalid project selected fields.');
    }
    const selection = Array.isArray(snapshot.selection.fields) ? { fields: [...new Set(snapshot.selection.fields)] }
      : Object.fromEntries(['x', 'y', 'color'].map(role => {
      const field = snapshot.selection[role] ?? '';
      if (typeof field !== 'string' || field && !names.has(field)) throw new TypeError(`Invalid project selection for ${role}.`);
      return [role, field];
    }));
    const context = snapshot.context ?? {};
    if (!plain(context) || Object.entries(context).some(([key, value]) => key === 'childPath'
      ? !Array.isArray(value) || value.some(id => typeof id !== 'string' || !id)
      : key === 'scope' ? value !== 'all' : !['target', 'data'].includes(key) || typeof value !== 'string' || !value)) {
      throw new TypeError('Invalid project chart context.');
    }
    const dataIds = snapshot.setupCalls.filter(call => /Data$/.test(call.method) && typeof call.args.id === 'string').map(call => call.args.id);
    const plotData = snapshot.plotData ?? dataIds.at(-1) ?? 'dataset';
    if (typeof plotData !== 'string' || !plotData) throw new TypeError('Invalid project dataset reference.');
    const currentNote = snapshot.currentNote ?? '';
    if (typeof currentNote !== 'string') throw new TypeError('Invalid project action label.');
    // Imported snapshots never get to write arbitrary application state keys.
    // Keep only the same authoring metadata that packSession emits.
    const normalized = { setupCalls: snapshot.setupCalls, calls: snapshot.calls, axesCalls,
      context: { ...context }, steps: snapshot.steps, guideCall: snapshot.guideCall ?? null,
      selection, plotData, optionGroup, phase: snapshot.phase, currentNote };
    if (trustedPacked.has(snapshot)) {
      if (!normalizedSnapshots.has(snapshot)) normalizedSnapshots.set(snapshot, new WeakMap());
      normalizedSnapshots.get(snapshot).set(names, freezeResult(normalized));
    }
    return normalized;
  });
  const graph = normalizeHistoryGraph(session.graph, entries.length, session.index);
  return { index: session.index, entries, ...(graph ? { graph } : {}) };
}

export function validateProject(value) {
  if (value?.format !== PROJECT_FORMAT || ![1, PROJECT_VERSION].includes(value.version) || !Array.isArray(value.datasets) || !value.datasets.length) {
    throw new TypeError('Choose a supported Visualization Autocomplete project file.');
  }
  const ids = new Set();
  const datasets = value.datasets.map(record => {
    if (!plain(record) || typeof record.id !== 'string' || !record.id || ids.has(record.id) || typeof record.name !== 'string') throw new TypeError('Invalid dataset identity in project.');
    ids.add(record.id);
    const names = validateImported(record.imported, record.name);
    return { id: record.id, name: record.name, imported: record.imported, session: normalizeSession(record.session, names) };
  });
  if (!ids.has(value.activeId)) throw new TypeError('The active dataset is missing from the project.');
  return { format: value.format, version: value.version, savedAt: value.savedAt, ggaction: value.ggaction,
    activeId: value.activeId, datasets };
}

export function parseProject(source) {
  return validateProject(JSON.parse(source));
}

// Replay only registered public native methods; never evaluate imported source.
// Prefix sharing keeps a long append-only history from replaying every old call.
export function restoreSession(stored, rows, { lazy = false, current = null } = {}) {
  if (!stored) return null;
  stored = normalizeSession(stored, new Set(rows.flatMap(Object.keys)));
  const base = chart(), cache = createLRU(16);
  const recorded = new Map();
  function* replaySteps(calls) {
    const keys = [''];
    for (const call of calls) { validateCall(call); keys.push(keys.at(-1) + JSON.stringify(call) + '\n'); }
    let program = base, start = 0;
    // Find the longest retained prefix before executing anything. Walking from
    // zero would rebuild evicted prefixes and displace the useful recent ones.
    for (let i = calls.length; i > 0; i--) {
      const cached = cache.get(keys[i]);
      if (cached) { program = cached; start = i; break; }
    }
    for (let i = start; i < calls.length; i++) {
      const call = calls[i];
      const args = call.method === 'createData' && call.args.values === '__LOADED_DATA__'
        ? { ...call.args, values: rows } : call.args;
      program = program[call.method](args); cache.set(keys[i + 1], program); yield;
    }
    return program;
  }
  const replay = calls => {
    const work = replaySteps(calls); let step;
    do { step = work.next(); } while (!step.done);
    return step.value;
  };
  const materialize = snapshot => {
    const { axesCalls } = snapshot;
    const metadata = Object.fromEntries(metadataKeys.map(key => [key, snapshot[key]]));
    const calls = [...snapshot.setupCalls, ...snapshot.calls];
    // Restore exactly the authored layout. Fitting/centering belongs to action
    // preparation and is already recorded as native calls, never to loading.
    const program = replay(calls), view = snapshot.guideCall ? replay([...calls, snapshot.guideCall]) : program;
    const selectionAxes = snapshot.phase === 'initial' ? { program: replay([...calls, ...axesCalls]), calls: axesCalls } : null;
    const shared = values => values.map(call => recorded.get(JSON.stringify(call)) ?? call);
    const snapshotCopy = captureHistorySnapshot({ ...metadata, rows, setupCalls: shared(metadata.setupCalls),
      calls: shared(metadata.calls), program, view, selectionAxes });
    for (const call of [...snapshotCopy.setupCalls, ...snapshotCopy.calls]) recorded.set(JSON.stringify(call), call);
    return snapshotCopy;
  };
  const deferredCalls = new Map();
  const share = calls => calls.map(call => {
    const key = JSON.stringify(call);
    if (!deferredCalls.has(key)) deferredCalls.set(key, freezeResult(structuredClone(call)));
    return deferredCalls.get(key);
  });
  return { index: stored.index, ...(stored.graph ? { graph: stored.graph } : {}), entries: stored.entries.map((snapshot, index) => {
    if (index === stored.index && current) {
      return captureHistorySnapshot({ ...snapshot, ...current, rows, selectionAxes: null });
    }
    if (!lazy) return materialize(snapshot);
    const { setupCalls, calls, axesCalls, ...metadata } = snapshot;
    const saved = freezeResult({ ...structuredClone(metadata), setupCalls: share(setupCalls),
      calls: share(calls), axesCalls: share(axesCalls) });
    trustedPacked.add(saved);
    const deferred = { stored: saved, result: null };
    const resolve = () => deferred.result ??= materialize(saved);
    deferred.prepare = async () => {
      if (deferred.result) return;
      const calls = [...saved.setupCalls, ...saved.calls];
      for (const _ of replaySteps(calls)) {
        // A distant history thumbnail may need a missing prefix after reload.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      resolve();
    };
    const entry = Object.freeze({ ...Object.fromEntries(metadataKeys.map(key => [key, saved[key]])),
      get calls() { return deferred.result?.calls ?? saved.calls; },
      get program() { return resolve().program; },
      get view() { return resolve().view; },
      get selectionAxes() { return resolve().selectionAxes; } });
    deferredSnapshots.set(entry, deferred);
    return entry;
  }) };
}

export function runnableCode(snapshot, record, ggaction = null) {
  const calls = [...snapshot.setupCalls, ...snapshot.calls,
    ...(snapshot.phase === 'initial' ? snapshot.selectionAxes?.calls ?? snapshot.axesCalls ?? [] : []),
    ...(snapshot.guideCall ? [snapshot.guideCall] : [])];
  const source = programCode(calls, record.name, record.imported.rows.length);
  const data = `const data = ${JSON.stringify(record.imported.rows)};\n`;
  const provenance = `// Dataset: ${JSON.stringify(record.name)}\n// ggaction source: ${JSON.stringify(ggaction)}\n`;
  return `${provenance}// Run with Node.js in a project that has this ggaction version installed.\n` +
    source.replace('import { chart } from "ggaction";',
      'import { chart } from "ggaction";\nimport { renderToSVG } from "ggaction/svg";\nimport { writeFile } from "node:fs/promises";\n\n' + data) +
    '\n\nawait writeFile("chart.svg", renderToSVG(program), "utf8");\n';
}

export function createDraftStore(indexedDB = globalThis.indexedDB, name = 'visualization-autocomplete') {
  let dbPromise, pending = Promise.resolve();
  // Import records are immutable revisions in the application. Keep references,
  // not hashes of every cell, to avoid revisiting large tables on each Apply.
  const persistedImports = new Map();
  const database = () => dbPromise ??= new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('Draft storage is unavailable in this browser.')); return; }
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
      if (!db.objectStoreNames.contains('datasets')) db.createObjectStore('datasets');
      // Keep a v1 monolithic draft intact until its first successful atomic save.
    };
    request.onsuccess = () => {
      const db = request.result; db.onversionchange = () => { db.close(); dbPromise = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close older Visualization Autocomplete tabs, then reload to upgrade draft storage.'));
  });
  const persist = async project => {
    const db = await database();
    const { datasets, ...metadata } = project;
    const changed = datasets.filter(record => persistedImports.get(record.id) !== record.imported);
    const manifest = { ...metadata, storageVersion: 2,
      checkpointRevision: checkpointRevision(project),
      datasets: datasets.map(({ imported, ...record }) => ({ ...record, dataRevision: datasetRevision(imported) })) };
    await new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(['projects', 'datasets'], 'readwrite', { durability: 'strict' }); }
      catch (error) { if (!(error instanceof TypeError)) throw error; tx = db.transaction(['projects', 'datasets'], 'readwrite'); }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Draft save was interrupted.'));
      try {
        // One transaction makes a new dataset and the history pointing to it
        // visible together. Ordinary history saves only clone the small manifest.
        const store = tx.objectStore('datasets');
        for (const record of changed) store.put(record.imported, record.id);
        tx.objectStore('projects').put(manifest, 'draft');
      } catch (error) { tx.abort(); reject(error); }
    });
    for (const record of changed) persistedImports.set(record.id, record.imported);
  };
  const write = project => {
    const next = pending.catch(() => {}).then(() => persist(project)); pending = next; return next;
  };
  const read = async () => {
    await pending.catch(() => {});
    const db = await database();
    let needsMigration = false;
    const project = await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'datasets'], 'readonly');
      const request = tx.objectStore('projects').get('draft');
      let value;
      request.onsuccess = () => {
        value = request.result;
        if (value?.storageVersion !== 2) { needsMigration = Boolean(value); return; }
        const { storageVersion, checkpointRevision, ...metadata } = value; value = metadata;
        for (const record of value.datasets) {
          const data = tx.objectStore('datasets').get(record.id);
          data.onsuccess = () => {
            if (!data.result) { tx.abort(); return; }
            record.imported = data.result;
            if (typeof record.dataRevision === 'string') checkpointDatasets.set(record.imported, record.dataRevision);
            delete record.dataRevision;
          };
        }
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('The saved draft is missing a dataset.'));
    });
    if (!project) return project;
    // A legacy draft is returned even if migration fails (quota, interruption);
    // the original projects/draft entry remains recoverable in that case.
    if (needsMigration) {
      try { await write(project); } catch { return project; }
    }
    for (const record of project.datasets ?? []) persistedImports.set(record.id, record.imported);
    return project;
  };
  // Optional acceleration cache, separate from the portable public-call draft.
  // A late worker completion must never attach an old chart to a newer draft.
  const writeCheckpoint = async checkpoint => {
    const db = await database();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects'], 'readwrite'), store = tx.objectStore('projects');
      const request = store.get('draft');
      request.onsuccess = () => {
        try {
          if (request.result?.checkpointRevision === checkpoint.revision) store.put(checkpoint, 'checkpoint');
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  };
  const readCheckpoint = async (revision, source) => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['projects'], 'readonly'), request = tx.objectStore('projects').get('checkpoint');
      request.onsuccess = () => {
        const value = request.result;
        resolve(value?.version === 1 && value.revision === revision && JSON.stringify(value.source) === JSON.stringify(source) ? value : null);
      };
      request.onerror = () => reject(request.error);
    });
  };
  const clear = async () => {
    await pending.catch(() => {});
    const db = await database();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'datasets'], 'readwrite');
      tx.objectStore('projects').clear(); tx.objectStore('datasets').clear();
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    persistedImports.clear();
  };
  return { read, write, clear, readCheckpoint, writeCheckpoint };
}
