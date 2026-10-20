import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { serializeProgram } from 'ggaction/persistence';
import { comparePrograms } from 'ggaction/inspection';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { createRecommendationEngine, validateCandidate, applyRecommendation } from '../src/engine.js';
import { createLRU, signature } from '../src/cache.js';
import { latestQueue, createCalculationClient } from '../web/calculation-client.js';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { optionGroup } from '../src/recommendation-groups.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';

const renderSVG = program => renderToSVG(program, { resourceNamespace: 'worker-preview' });

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
  Array.from({ length: 18 }, (_, i) => ({ X: i + 1, Y: 2 * i + i % 3, Group: i % 2 ? 'A' : 'B' })) });
const scatter = () => base().createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'Group' });

test('cache keys preserve exact options and bounded eviction', () => {
  assert.notEqual(signature({ value: -0 }), signature({ value: 0 }));
  assert.notEqual(signature({ value: undefined }), signature({ value: null }));
  assert.notEqual(signature([,]), signature([undefined]));
  assert.equal(signature({ b: 2, a: 1 }), signature({ a: 1, b: 2 }));
  const cache = createLRU(2); cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  assert.equal(cache.get('b'), undefined); assert.equal(cache.size, 2);
});

test('shared preparation reuses exact states while retaining one authored action and final guides', () => {
  const raw = scatter(), view = raw.createGuides(), action = { method: 'encodeSize', args: { target: 'plot', field: 'X' } };
  const first = prepareGuidedAction(raw, action, view);
  assert.equal(prepareGuidedAction(raw, structuredClone(action), view), first);
  assert.equal(validateCandidate(raw, action), validateCandidate(raw, structuredClone(action)));
  assert.ok(Object.isFrozen(first));
  assert.equal(first.authoringPreview.trace.children.length, raw.trace.children.length + 1);
  assert.equal(first.preview.trace.children.at(-1).op, 'createGuides');
  const applied = applyRecommendation(first.actionBase, first.recommendation);
  assert.equal(comparePrograms(applied, first.authoringPreview).equivalence, 'equal');
  const other = prepareGuidedAction(raw, { method: 'encodeSize', args: { target: 'plot', value: 100 } }, view);
  assert.notEqual(other, first);
  assert.notEqual(prepareGuidedAction(raw.createTitle({ text: 'Changed' }), action), first);
});

test('latest preview queue keeps one running request and only the newest pending parameters', async () => {
  const calls = [], releases = [];
  const schedule = latestQueue(value => new Promise(resolve => { calls.push(value); releases.push(() => resolve(value)); }));
  const first = schedule(1), second = schedule(2), third = schedule(3);
  assert.equal(await second, null);
  assert.deepEqual(calls, [1]); releases.shift()(); assert.equal(await first, 1);
  assert.deepEqual(calls, [1, 3]); releases.shift()(); assert.equal(await third, 3);
});

test('Apply shares an in-flight hover preparation and materializes on its owning worker', async t => {
  const threads = [], requests = [];
  const client = createCalculationClient({ workerFactory: role => {
    const worker = new Worker(new URL('./fixtures/calculation-thread.mjs', import.meta.url)); threads.push(worker);
    return { addEventListener: (type, callback) => worker.on(type, type === 'message' ? data => callback({ data }) : callback),
      postMessage: data => { requests.push({ role, ...data.request }); worker.postMessage(data); } };
  } });
  t.after(() => Promise.all(threads.map(worker => worker.terminate())));
  await client.ready;
  const raw = scatter(), view = raw.createGuides(), guides = { method: 'createGuides', args: {} };
  const action = { method: 'encodeSize', args: { target: 'plot', value: 948 } };
  const hover = client.prepare(raw, view, guides, action, [], { interactive: true });
  const apply = client.prepare(raw, view, guides, structuredClone(action));
  const [preview, confirmed] = await Promise.all([hover, apply]);
  assert.equal(preview, confirmed);
  assert.equal(preview.workerRole, 'preview');
  const next = await client.materialize(raw, view, guides, action);
  assert.deepEqual(next.view.graphicSpec, prepareGuidedAction(raw, action, view).preview.graphicSpec);
  assert.deepEqual(requests.filter(r => r.type === 'prepare').map(r => r.role), ['preview']);
  assert.deepEqual(requests.filter(r => r.type === 'materialize').map(r => r.role), ['preview']);

  const distinct = { ...action, args: { ...action.args, value: 120 } };
  await client.prepare(raw, view, guides, distinct);
  assert.equal(requests.filter(r => r.type === 'prepare').length, 2, 'different parameters must not share results');
  const invalid = { method: 'encodeSize', args: { target: 'plot', value: -10 } };
  await assert.rejects(client.prepare(raw, view, guides, invalid));
  await assert.rejects(client.prepare(raw, view, guides, invalid));
  assert.equal(requests.filter(r => r.type === 'prepare').length, 4, 'failed preparations must remain retryable');
});

test('worker transfers completed facet guides exactly, including replayable legend options', async t => {
  const threads = [];
  const client = createCalculationClient({ workerFactory: () => {
    const worker = new Worker(new URL('./fixtures/calculation-thread.mjs', import.meta.url)); threads.push(worker);
    return { addEventListener: (type, callback) => worker.on(type, type === 'message' ? data => callback({ data }) : callback),
      postMessage: data => worker.postMessage(data) };
  } });
  t.after(() => Promise.all(threads.map(worker => worker.terminate())));
  const raw = scatter().encodeShape({ target: 'plot', field: 'Group', fieldType: 'nominal' })
    .facet({ field: 'Group', columns: 2, spacing: 'plot', gap: 12, guides: { axes: 'outer', legend: 'shared' } });
  const guides = { method: 'createGuides', args: { legend: { target: 'plot', channels: ['color', 'shape'] } } };
  const { addDefaultGuides } = await import('../src/prepare.js');
  const view = addDefaultGuides(raw, guides);
  const action = { method: 'editFacetSource', args: { action: { method: 'encodeOpacity', options: { target: 'plot', value: .25 } } } };
  await client.prepare(raw, view, guides, action);
  const next = await client.materialize(raw, view, guides, action);
  const reference = prepareGuidedAction(raw, action, view);
  assert.equal(serializeProgram(next.program), serializeProgram(reference.authoringPreview));
  assert.equal(serializeProgram(next.view), serializeProgram(reference.preview));
  const legend = { method: 'editFacetSource', args: { action: { method: 'editLegendLabels', options: { fontSize: 14 } } } };
  const hydrated = prepareGuidedAction(next.program, legend, next.view);
  const original = prepareGuidedAction(reference.authoringPreview, legend, reference.preview);
  assert.equal(serializeProgram(hydrated.preview), serializeProgram(original.preview),
    'guide editing after transfer must promote the same exact native legend call');
  const handedOff = await client.prepare(next.program, next.view, next.guideCall, legend, [], { interactive: true });
  assert.equal(handedOff.preview.svg, renderSVG(original.preview), 'the second worker receives the same completed guide state');
});

test('worker recommendation and materialization preserve rankings, parameters, SVG and native output', async t => {
  const threads = [];
  const client = createCalculationClient({ workerFactory: () => {
    const worker = new Worker(new URL('./fixtures/calculation-thread.mjs', import.meta.url)); threads.push(worker);
    return { addEventListener: (type, callback) => worker.on(type, type === 'message' ? data => callback({ data }) : callback),
      postMessage: data => worker.postMessage(data) };
  } });
  t.after(() => Promise.all(threads.map(worker => worker.terminate())));
  await client.ready;
  const raw = scatter(), view = raw.createGuides(), options = { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS };
  const expected = createRecommendationEngine(model).recommend(view, options);
  const response = await client.recommend(raw, view, { method: 'createGuides', args: {} }, options, 'encoding');
  assert.deepEqual(response.result.recommendations.map(r => [r.method, r.feature, r.score]),
    expected.recommendations.filter(r => optionGroup(r) === 'encoding').slice(0, 5).map(r => [r.method, r.feature, r.score]));
  const rec = response.result.recommendations.find(r => r.method === 'encodeSize');
  const editor = recommendationParameters(rec, response.profile), action = { method: rec.method, args: editor.build(valuesFor(editor.controls)) };
  const preview = await client.prepare(raw, view, { method: 'createGuides', args: {} }, action);
  assert.equal(await client.prepare(raw, view, { method: 'createGuides', args: {} }, action), preview);
  assert.ok(preview.preview.svg.startsWith('<svg'));
  const committed = await client.materialize(raw, view, { method: 'createGuides', args: {} }, action);
  const reference = prepareGuidedAction(raw, action, view);
  assert.deepEqual(committed.program.semanticSpec, reference.authoringPreview.semanticSpec);
  assert.deepEqual(committed.view.graphicSpec, reference.preview.graphicSpec);
  assert.equal(committed.program.trace.children.at(-1).op, action.method);
  assert.equal(committed.view.trace.children.filter(node => node.op === 'createGuides').length, 1);
  const followup = await client.recommend(committed.program, committed.view, committed.guideCall, options, 'encoding');
  assert.ok(!followup.result.recommendations.some(r => r.method === action.method), 'applied Size must not return from a cached worker result');
  const undone = await client.recommend(raw, view, { method: 'createGuides', args: {} }, options, 'encoding');
  assert.ok(undone.result.recommendations.some(r => r.method === action.method), 'Undo restores the unused channel');
  // Old Undo states are rehydrated after both client and worker caches evict them.
  for (let i = 0; i < 13; i++) {
    const other = raw.createTitle({ text: `State ${i}` }), otherView = other.createGuides();
    await client.prepare(other, otherView, { method: 'createGuides', args: {} }, action);
  }
  const restored = await client.prepare(raw, view, { method: 'createGuides', args: {} }, action);
  assert.equal(restored.preview.svg, preview.preview.svg);
});

test('service state eviction never changes committed graphs and rejects unknown state references', () => {
  const service = createCalculationService(model), raw = scatter(), snapshot = serializeProgram(raw);
  for (let stateId = 1; stateId <= 13; stateId++) service.execute({ type: 'state', stateId, snapshot });
  assert.equal(service.execute({ type: 'activate', stateId: 1 }).exists, false);
  assert.throws(() => service.execute({ type: 'prepare', stateId: 1, action: { method: 'encodeSize', args: { value: 10 } } }), /expired/);
});

test('failed workers reject current and future requests instead of leaving Apply waiting', async () => {
  const client = createCalculationClient({ workerFactory: () => {
    const listeners = new Map();
    return { addEventListener: (type, callback) => listeners.set(type, callback),
      postMessage: ({ id, request }) => queueMicrotask(() => request.type === 'initialize'
        ? listeners.get('message')({ data: { id, value: { ready: true } } })
        : listeners.get('error')({ message: 'Calculation stopped' })) };
  } });
  await client.ready;
  const raw = scatter(), view = raw.createGuides(), action = { method: 'encodeSize', args: { target: 'plot', value: 50 } };
  await assert.rejects(client.prepare(raw, view, null, action), /Calculation stopped/);
  await assert.rejects(client.prepare(raw, view, null, action), /Calculation stopped/);
});

test('unchanged recommendation defaults never poison the preview cache or block later parameter edits', async t => {
  const threads = [];
  const client = createCalculationClient({ workerFactory: () => {
    const worker = new Worker(new URL('./fixtures/calculation-thread.mjs', import.meta.url)); threads.push(worker);
    return { addEventListener: (type, callback) => worker.on(type, type === 'message' ? data => callback({ data }) : callback),
      postMessage: data => worker.postMessage(data) };
  } });
  t.after(() => Promise.all(threads.map(worker => worker.terminate())));
  const raw = scatter().encodeShape({ target: 'plot', field: 'Group', fieldType: 'nominal' });
  const guideCall = { method: 'createGuides', args: { legend: { target: 'plot', channels: ['color', 'shape'] } } };
  const view = raw.createGuides(guideCall.args);
  const response = await client.recommend(raw, view, guideCall,
    { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS }, 'encoding', 0, 'encodeShape');
  assert.equal(response.result.recommendations[0].validation.status, 'unchanged');
  assert.equal(response.defaults[0].prepared, null);
  const action = response.defaults[0].action;
  await assert.rejects(client.prepare(raw, view, guideCall, action), error => error.reason === 'no-change');
  await assert.rejects(client.materialize(raw, view, guideCall, action), error => error.reason === 'no-change');
  const next = { method: 'encodeShape', args: { target: 'plot', field: 'Group',
    fieldType: 'nominal', scale: { range: ['square', 'diamond'] } } };
  const prepared = await client.prepare(raw, view, guideCall, next);
  assert.ok(prepared.preview.svg.startsWith('<svg'));
  const applied = await client.materialize(raw, view, guideCall, next);
  assert.equal(applied.program.trace.children.length, raw.trace.children.length + 1);
  assert.deepEqual(applied.program.semanticSpec, raw.encodeShape(next.args).semanticSpec);
  assert.equal(applied.program.trace.children.at(-1).op, 'encodeShape');
});

test('successive Apply reuses worker states, cross-role advance and exact immutable inputs', async t => {
  const threads = [], requests = [];
  const client = createCalculationClient({ workerFactory: role => {
    const worker = new Worker(new URL('./fixtures/calculation-thread.mjs', import.meta.url)); threads.push(worker);
    return { addEventListener: (type, callback) => worker.on(type, type === 'message' ? data => callback({ data }) : callback),
      postMessage: data => { requests.push({ role, ...data.request }); worker.postMessage(data); } };
  } });
  t.after(() => Promise.all(threads.map(worker => worker.terminate())));
  await client.ready;
  const original = scatter(), originalView = original.createGuides(), guideCall = { method: 'createGuides', args: {} };
  await client.prepare(original, originalView, guideCall, { method: 'encodeSize', args: { target: 'plot', value: 80 } }, [], { interactive: true });
  let program = original, view = originalView;
  for (let i = 0; i < 20; i++) {
    const action = { method: 'encodeOpacity', args: { target: 'plot', value: i % 2 ? .4 : .8 } };
    await client.prepare(program, view, guideCall, action);
    const next = await client.materialize(program, view, guideCall, action);
    const expected = program.encodeOpacity(action.args);
    assert.deepEqual(next.program.semanticSpec, expected.semanticSpec);
    assert.deepEqual(next.program.trace, expected.trace);
    if (i === 0) {
      action.args.value = .1;
      const preview = await client.prepare(next.program, next.view, next.guideCall,
        { method: 'encodeSize', args: { target: 'plot', value: 90 } }, [], { interactive: true });
      assert.equal(preview.preview.svg, renderSVG(prepareGuidedAction(next.program, { method: 'encodeSize', args: { target: 'plot', value: 90 } }, next.view).preview));
    }
    program = next.program; view = next.view;
  }
  assert.equal(requests.filter(r => r.type === 'state' && r.role === 'recommendation').length, 1,
    'Apply cannot resend or rehydrate a growing complete history');
  assert.equal(requests.filter(r => r.type === 'advance').length, 1, 'the other worker advances its existing native baseline');
  const advance = requests.find(r => r.type === 'advance');
  assert.ok(advance.update && advance.viewUpdate, 'cross-worker handoff transfers both completed native states');
  assert.equal(advance.action, undefined, 'the other worker must not repeat an already completed action');
  const late = await client.prepare(program, view, guideCall,
    { method: 'encodeSize', args: { target: 'plot', value: 100 } }, [], { interactive: true });
  assert.equal(late.preview.svg, renderSVG(prepareGuidedAction(program, { method: 'encodeSize', args: { target: 'plot', value: 100 } }, view).preview));
  assert.ok(requests.some(r => r.type === 'state-update' && r.role === 'preview'), 'an idle worker catches up without all intervening actions or a full historical snapshot');
  const restored = await client.prepare(original, originalView, guideCall,
    { method: 'encodeSize', args: { target: 'plot', value: 120 } });
  assert.equal(restored.preview.svg, renderSVG(prepareGuidedAction(original, { method: 'encodeSize', args: { target: 'plot', value: 120 } }, originalView).preview));
  assert.equal(requests.filter(r => r.type === 'state').length, 2, 'expired Undo states also transfer against a known baseline');
});
