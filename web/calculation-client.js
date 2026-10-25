import { serializeProgram } from 'ggaction/persistence';
import { packProgramUpdate, unpackProgramUpdate } from './program-transfer.js';
import { rememberDisplayedGuides } from '../src/prepare.js';
import { createLRU, signature } from '../src/cache.js';
import { collectRecommendationStream } from './recommendation-stream.js';

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
    if (data.progress) {
      try { pending.onProgress?.(data.value); }
      catch (error) { requests.delete(data.id); pending.reject(error); }
      return;
    }
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
  const send = (request, onProgress) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++sequence; requests.set(id, { resolve, reject, onProgress }); worker.postMessage({ id, request });
  });
  const ready = send({ type: 'initialize', role });
  return { async send(request, onProgress) { await ready; return send(request, onProgress); }, ready };
}

export function createCalculationClient({ workerFactory = () => new Worker('/output/workers/calculation.js', { type: 'module' }) } = {}) {
  const endpoints = { recommendation: createEndpoint('recommendation', workerFactory), preview: createEndpoint('preview', workerFactory) };
  const contexts = new WeakMap(), active = {}; let nextState = 0;
  let recommendationRequest = 0;
  const recent = createLRU(8, (_, context) => { context.cache.clear(); delete context.snapshot; delete context.transition; delete context.checkpoint; });
  const contextFor = (program, view, guideCall) => {
    if (!contexts.has(program)) contexts.set(program, new WeakMap());
    const views = contexts.get(program);
    if (!views.has(view)) views.set(view, { id: ++nextState, program, view, guideCall, cache: createLRU(64), pending: new Map() });
    const context = views.get(view); recent.set(context.id, context); return context;
  };
  const ensure = async (role, context) => {
    const endpoint = endpoints[role];
    const anchor = active[role]?.context;
    if (active[role]?.id !== context.id) active[role] = { id: context.id, context, promise: (async () => {
      const { exists } = await endpoint.send({ type: 'activate', stateId: context.id });
      if (!exists) {
        const transition = context.transition;
        const reusable = transition && await endpoint.send({ type: 'activate', stateId: transition.baseStateId });
        if (reusable?.exists) {
          await endpoint.send({ type: 'advance', stateId: context.id, ...transition });
        } else if (anchor && (await endpoint.send({ type: 'activate', stateId: anchor.id })).exists) {
          await endpoint.send({ type: 'state-update', stateId: context.id, baseStateId: anchor.id,
            update: packProgramUpdate(anchor.program, context.program), guideCall: context.guideCall });
        } else {
          context.snapshot ??= serializeProgram(context.program);
          await endpoint.send({ type: 'state', stateId: context.id, snapshot: context.snapshot, guideCall: context.guideCall });
        }
      }
    })().catch(error => { if (active[role]?.id === context.id) delete active[role]; throw error; }) };
    await active[role].promise;
    return endpoint;
  };
  const prepareJob = ({ context, action, setupCalls, role = 'preview' }) => {
    const key = signature([action, setupCalls]), cached = context.cache.get(key);
    if (cached) return Promise.resolve(cached);
    // Apply can arrive while the identical hover preview is still running.
    // Share the job across roles, including its worker ownership for materialize.
    if (context.pending.has(key)) return context.pending.get(key);
    const pending = (async () => {
      const endpoint = await ensure(role, context);
      const prepared = { ...await endpoint.send({ type: 'prepare', stateId: context.id, action, setupCalls }), workerRole: role };
      context.cache.set(key, prepared); return prepared;
    })().finally(() => context.pending.delete(key));
    context.pending.set(key, pending);
    return pending;
  };
  const preview = latestQueue(prepareJob);
  const sceneJobs = latestQueue(async ({context, action, setupCalls}) => {
    const prepared=context.cache.get(signature([action,setupCalls]));
    const endpoint=await ensure(prepared?.workerRole ?? 'preview',context);
    return endpoint.send({type:'scene',stateId:context.id,action,setupCalls});
  });
  return {
    ready: Promise.all(Object.values(endpoints).map(endpoint => endpoint.ready)),
    prime(program, view, guideCall, snapshot) {
      // A validated persisted snapshot is already the lossless worker input.
      // Do not serialize its entire restored trace again on the UI thread.
      contextFor(program, view, guideCall).snapshot = snapshot;
    },
    async checkpoint(program, view, guideCall) {
      const context = contextFor(program, view, guideCall);
      context.checkpoint ??= (async () => {
        const endpoint = await ensure('recommendation', context);
        return endpoint.send({ type: 'checkpoint', stateId: context.id });
      })().catch(error => { delete context.checkpoint; throw error; });
      return context.checkpoint;
    },
    transitionScene(program,view,guideCall,action,setupCalls=[]) {
      return sceneJobs({context:contextFor(program,view,guideCall),action,setupCalls});
    },
    cancelRecommendations() {
      recommendationRequest++;
      return endpoints.recommendation.send({ type: 'cancel-recommendations' });
    },
    async recommend(program, view, guideCall, options, group, page = 0, searchQuery = '', onProgress) {
      const requestId = ++recommendationRequest;
      // Cancel on user intent, before state activation/hydration round trips.
      await endpoints.recommendation.send({ type: 'cancel-recommendations' });
      const context = contextFor(program, view, guideCall), endpoint = await ensure('recommendation', context);
      if (requestId !== recommendationRequest) return { cancelled: true };
      const collect = collectRecommendationStream();
      const receive = response => {
        if (requestId !== recommendationRequest) return;
        for (const entry of response.defaults ?? []) if (entry.prepared) {
          context.cache.set(signature([entry.action, []]), { ...entry.prepared, workerRole: 'recommendation' });
        }
        onProgress?.(collect(response));
      };
      const response = await endpoint.send({ type: 'recommend', stream: Boolean(onProgress), stateId: context.id, options, group, page, searchQuery }, receive);
      if (requestId !== recommendationRequest) return { ...response, cancelled: true };
      if (!response.cancelled) receive(response);
      return collect(response);
    },
    prepare(program, view, guideCall, action, setupCalls = [], { interactive = false } = {}) {
      const context = contextFor(program, view, guideCall), job = { context, action, setupCalls, role: interactive ? 'preview' : 'recommendation' };
      const cached = context.cache.get(signature([action, setupCalls]));
      if (cached) { if (interactive) preview.cancelPending(); return Promise.resolve(cached); }
      return interactive ? preview(job) : prepareJob(job);
    },
    async prepareResized(program, view, guideCall, resize, action, setupCalls = []) {
      const context = contextFor(program, view, guideCall);
      // Thumbnail work uses the other worker so native Current/code previews
      // never wait behind five option renders. The caller bounds the queue.
      const endpoint = await ensure('recommendation', context);
      return endpoint.send({ type: 'prepare-resized', stateId: context.id, resize, action, setupCalls });
    },
    async materialize(program, view, guideCall, action, setupCalls = []) {
      preview.cancelPending();
      const context = contextFor(program, view, guideCall);
      const key = signature([action, setupCalls]);
      await context.pending.get(key);
      const role = context.cache.get(key)?.workerRole ?? 'preview';
      const endpoint = await ensure(role, context);
      const nextId = ++nextState;
      const result = await endpoint.send({ type: 'materialize', stateId: context.id, nextStateId: nextId, action, setupCalls });
      const next = unpackProgramUpdate(program, result.update);
      const nextView = rememberDisplayedGuides(unpackProgramUpdate(next, result.viewUpdate), result.guideCall);
      const nextContext = { id: nextId, program: next, view: nextView, guideCall: result.guideCall, cache: createLRU(64), pending: new Map(),
        // The other role can install the same finished native state, rather than
        // re-executing the selected action and all of its facet/guide derivations.
        transition: { baseStateId: context.id, update: result.update, viewUpdate: result.viewUpdate, guideCall: result.guideCall } };
      contexts.set(next, new WeakMap([[nextView, nextContext]])); recent.set(nextId, nextContext);
      active[role] = { id: nextId, context: nextContext, promise: Promise.resolve() };
      return { program: next, view: nextView, guideCall: result.guideCall };
    },
    async typography(program, view, guideCall, options) {
      preview.cancelPending();
      const context = contextFor(program, view, guideCall), endpoint = await ensure('preview', context);
      const result = await endpoint.send({ type: 'typography', stateId: context.id, guideCall, options });
      const next = unpackProgramUpdate(program, result.update);
      const nextView = rememberDisplayedGuides(unpackProgramUpdate(next, result.viewUpdate), result.guideCall);
      return { program: next, view: nextView, guideCall: result.guideCall, calls: result.calls };
    },
  };
}
