import { chart } from 'ggaction';
import { PUBLIC_ACTION_NAMES } from '../src/public-actions.js';
import { programCode } from './code-view.js';
import { captureHistorySnapshot, isHistorySnapshot } from './history.js';
import { freezeResult } from '../src/cache.js';

const publicMethods = new Set(PUBLIC_ACTION_NAMES.filter(name => name !== 'constructor'));
const metadataKeys = ['setupCalls', 'calls', 'context', 'steps', 'guideCall', 'selection', 'plotData',
  'optionGroup', 'phase', 'currentNote'];
const groups = new Set(['encoding', 'transform', 'style']);
const fieldTypes = new Set(['quantitative', 'nominal', 'ordinal', 'temporal']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validatedImports = new WeakMap();
const packedSnapshots = new WeakMap(), trustedPacked = new WeakSet(), normalizedSnapshots = new WeakMap();
export const PROJECT_FORMAT = 'visualization-autocomplete';
export const PROJECT_VERSION = 1;

// Save public authoring calls, once-per-dataset source values, and history position.
// Previews and rendered SVG caches never become persisted authoring state.
export function packSession(session) {
  if (!session) return null;
  return { index: session.index, entries: session.entries.map(snapshot => {
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
    const selection = Object.fromEntries(['x', 'y', 'color'].map(role => {
      const field = snapshot.selection[role] ?? '';
      if (typeof field !== 'string' || field && !names.has(field)) throw new TypeError(`Invalid project selection for ${role}.`);
      return [role, field];
    }));
    const context = snapshot.context ?? {};
    if (!plain(context) || Object.entries(context).some(([key, value]) => !['target', 'data'].includes(key) || typeof value !== 'string' || !value)) {
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
  return { index: session.index, entries };
}

export function validateProject(value) {
  if (value?.format !== PROJECT_FORMAT || value.version !== PROJECT_VERSION || !Array.isArray(value.datasets) || !value.datasets.length) {
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
export function restoreSession(stored, rows) {
  if (!stored) return null;
  stored = normalizeSession(stored, new Set(rows.flatMap(Object.keys)));
  const cache = new Map([['', chart()]]);
  const recorded = new Map();
  const replay = calls => {
    let program = cache.get(''), key = '';
    for (const call of calls) {
      validateCall(call);
      key += JSON.stringify(call) + '\n';
      if (cache.has(key)) { program = cache.get(key); continue; }
      const args = call.method === 'createData' && call.args.values === '__LOADED_DATA__'
        ? { ...call.args, values: rows } : call.args;
      program = program[call.method](args); cache.set(key, program);
    }
    return program;
  };
  return { index: stored.index, entries: stored.entries.map(snapshot => {
    const { axesCalls } = snapshot;
    const metadata = Object.fromEntries(metadataKeys.map(key => [key, snapshot[key]]));
    const calls = [...snapshot.setupCalls, ...snapshot.calls], program = replay(calls);
    const view = snapshot.guideCall ? replay([...calls, snapshot.guideCall]) : program;
    const selectionAxes = snapshot.phase === 'initial' ? { program: replay([...calls, ...axesCalls]), calls: axesCalls } : null;
    const shared = values => values.map(call => recorded.get(JSON.stringify(call)) ?? call);
    const snapshotCopy = captureHistorySnapshot({ ...metadata, setupCalls: shared(metadata.setupCalls),
      calls: shared(metadata.calls), program, view, selectionAxes });
    for (const call of [...snapshotCopy.setupCalls, ...snapshotCopy.calls]) recorded.set(JSON.stringify(call), call);
    return snapshotCopy;
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

export function createDraftStore(indexedDB = globalThis.indexedDB) {
  let dbPromise, pending = Promise.resolve();
  // Import records are immutable revisions in the application. Keep references,
  // not hashes of every cell, to avoid revisiting large tables on each Apply.
  const persistedImports = new Map();
  const database = () => dbPromise ??= new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('Draft storage is unavailable in this browser.')); return; }
    const request = indexedDB.open('visualization-autocomplete', 2);
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
      datasets: datasets.map(({ imported, ...record }) => record) };
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
        const { storageVersion, ...metadata } = value; value = metadata;
        for (const record of value.datasets) {
          const data = tx.objectStore('datasets').get(record.id);
          data.onsuccess = () => {
            if (!data.result) { tx.abort(); return; }
            record.imported = data.result;
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
  return { read, write };
}
