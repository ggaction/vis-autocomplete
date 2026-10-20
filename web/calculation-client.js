import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { addDefaultGuides } from '../src/prepare.js';
import { createLRU, signature } from '../src/cache.js';

export function latestQueue(run) {
  let active = false, pending = null;
  const next = async () => {
    if (!pending) { active = false; return; }
    active = true;
    const job = pending; pending = null;
    try { job.resolve(await run(job.value)); } catch (error) { job.reject(error); }
    next();
  };
  const enqueue = value => new Promise((resolve, reject) => {
    if (pending) pending.resolve(null);
    pending = { value, resolve, reject };
    if (!active) next();
  });
  enqueue.cancelPending = () => { if (pending) pending.resolve(null); pending = null; };
  return enqueue;
}

function createEndpoint(role, workerFactory) {
  const worker = workerFactory(role), requests = new Map(); let sequence = 0, failure = null;
  worker.addEventListener('message', ({ data }) => {
    const pending = requests.get(data.id); if (!pending) return;
    requests.delete(data.id);
    if (data.error) {
      const error = new Error(data.error); error.reason = data.reason; pending.reject(error);
    } else pending.resolve(data.value);
  });
  const fail = error => {
    failure = new Error(error.message || 'Calculation worker failed.');
    for (const pending of requests.values()) pending.reject(failure);
    requests.clear();
  };
  worker.addEventListener('error', fail);
  worker.addEventListener('messageerror', fail);
  const send = request => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++sequence; requests.set(id, { resolve, reject }); worker.postMessage({ id, request });
  });
  const ready = send({ type: 'initialize', role });
  return { async send(request) { await ready; return send(request); }, ready };
}

export function createCalculationClient({ workerFactory = () => new Worker('/output/workers/calculation.js', { type: 'module' }) } = {}) {
  const endpoints = { recommendation: createEndpoint('recommendation', workerFactory), preview: createEndpoint('preview', workerFactory) };
  const contexts = new WeakMap(), active = {}; let nextState = 0;
  const recent = createLRU(8, (_, context) => { context.cache.clear(); delete context.snapshot; });
  const contextFor = (program, view, guideCall) => {
    if (!contexts.has(program)) contexts.set(program, new WeakMap());
    const views = contexts.get(program);
    if (!views.has(view)) views.set(view, { id: ++nextState, program, view, guideCall, cache: createLRU(64), initialized: {} });
    const context = views.get(view); recent.set(context.id, context); return context;
  };
  const ensure = async (role, context) => {
    const endpoint = endpoints[role];
    if (active[role]?.id !== context.id) active[role] = { id: context.id, promise: (async () => {
      const { exists } = await endpoint.send({ type: 'activate', stateId: context.id });
      if (!exists) {
        context.snapshot ??= serializeProgram(context.program);
        await endpoint.send({ type: 'state', stateId: context.id, snapshot: context.snapshot, guideCall: context.guideCall });
      }
    })().catch(error => { if (active[role]?.id === context.id) delete active[role]; throw error; }) };
    await active[role].promise;
    return endpoint;
  };
  const prepareJob = async ({ context, action, setupCalls, role = 'preview' }) => {
    const key = signature([action, setupCalls]), cached = context.cache.get(key);
    if (cached) return cached;
    const endpoint = await ensure(role, context);
    const prepared = { ...await endpoint.send({ type: 'prepare', stateId: context.id, action, setupCalls }), workerRole: role };
    context.cache.set(key, prepared); return prepared;
  };
  const preview = latestQueue(prepareJob);
  return {
    ready: Promise.all(Object.values(endpoints).map(endpoint => endpoint.ready)),
    async recommend(program, view, guideCall, options, group, page = 0, searchQuery = '') {
      const context = contextFor(program, view, guideCall), endpoint = await ensure('recommendation', context);
      const response = await endpoint.send({ type: 'recommend', stateId: context.id, options, group, page, searchQuery });
      for (const entry of response.defaults) context.cache.set(signature([entry.action, []]), { ...entry.prepared, workerRole: 'recommendation' });
      return response;
    },
    prepare(program, view, guideCall, action, setupCalls = [], { interactive = false } = {}) {
      const context = contextFor(program, view, guideCall), job = { context, action, setupCalls, role: interactive ? 'preview' : 'recommendation' };
      const cached = context.cache.get(signature([action, setupCalls]));
      if (cached) { if (interactive) preview.cancelPending(); return Promise.resolve(cached); }
      return interactive ? preview(job) : prepareJob(job);
    },
    async materialize(program, view, guideCall, action, setupCalls = []) {
      preview.cancelPending();
      const context = contextFor(program, view, guideCall);
      const role = context.cache.get(signature([action, setupCalls]))?.workerRole ?? 'preview';
      const endpoint = await ensure(role, context);
      const result = await endpoint.send({ type: 'materialize', stateId: context.id, action, setupCalls });
      const next = deserializeProgram(result.snapshot);
      return { program: next, view: addDefaultGuides(next, result.guideCall), guideCall: result.guideCall };
    },
  };
}
