import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { createWeightedLRU } from '../src/cache.js';
import { createCompositionCacheBudget, createProgramResultCache, compositionResultWeight } from '../src/program-cache.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';

test('weighted LRU uses recency and releases evicted entries, including oversized replacements', () => {
  const evicted = [], cache = createWeightedLRU(10, key => evicted.push(key));
  cache.set('a', 1, 4); cache.set('b', 2, 4); cache.get('a'); cache.set('c', 3, 4);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.weight, 8);
  cache.set('a', 10, 2);
  assert.equal(cache.weight, 6);
  cache.set('large', 9, 100);
  assert.equal(cache.size, 1);
  assert.equal(cache.weight, 10);
  assert.equal(cache.get('large'), 9);
  assert.deepEqual(evicted, ['b', 'c', 'a']);
  cache.clear(); assert.equal(cache.weight, 0); assert.equal(cache.size, 0);
  assert.equal(evicted.at(-1), 'large');
  assert.throws(() => cache.set('invalid', 1, NaN), /positive/);
});

test('composition cache budgets span validation/preparation owners without evicting plain chart entries', () => {
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
    [{ x: 1, y: 2, group: 'A' }, { x: 2, y: 4, group: 'B' }] })
    .createScatterPlot({ id: 'plot', data: 'data', x: 'x', y: 'y' });
  const facet = gap => base.facet({ data: 'data', field: 'group', columns: 2, gap });
  const budget = createCompositionCacheBudget(9);
  const validations = createProgramResultCache({ compositionBudget: budget });
  const preparations = createProgramResultCache({ compositionBudget: budget });
  const previousView = createProgramResultCache({ compositionBudget: budget });
  const plain = { next: base };
  for (let i = 0; i < 128; i++) preparations.set(`plain-${i}`, plain);
  const a = facet(0), aView = a.createGuides();
  const validationA = { next: a }, preparationA = { authoringPreview: a, preview: aView };
  assert.equal(compositionResultWeight(validationA), 3);
  assert.equal(compositionResultWeight(preparationA), 6);
  assert.equal(compositionResultWeight({ authoringPreview: a, preview: a }), 3, 'shared trees counted once');
  validations.set('a', validationA); preparations.set('a', preparationA);
  assert.equal(budget.weight, 9);
  assert.equal(preparations.get('a'), preparationA);
  const b = facet(12), preparationB = { authoringPreview: b, preview: b.createGuides() };
  validations.set('b', { next: b }); previousView.set('b', preparationB);
  assert.equal(validations.get('a'), undefined);
  assert.equal(preparations.get('a'), undefined);
  assert.equal(previousView.get('b'), preparationB);
  assert.equal(validations.get('b').next, b);
  assert.equal(budget.weight, 9, 'independent owners share the same total budget');
  assert.equal(preparations.get('plain-0'), plain);
  assert.equal(preparations.get('plain-127'), plain);
  assert.equal(preparations.size, 128);
  assert.equal(renderToSVG(facet(0).createGuides()), renderToSVG(aView), 'evicted native action replays identically');
  previousView.clear(); assert.equal(budget.weight, 3);
  validations.clear(); assert.equal(budget.weight, 0);
});

test('an oversized composition is cached alone and replacement cannot reveal a stale ordinary result', () => {
  const budget = createCompositionCacheBudget(2), cache = createProgramResultCache({ compositionBudget: budget });
  const child = { semanticSpec: {}, children: {} };
  const value = { next: { semanticSpec: {}, children: { a: child, b: { ...child } } } };
  const ordinary = { next: child };
  cache.set('same', ordinary); cache.set('same', value);
  assert.equal(cache.get('same'), value); assert.equal(cache.size, 1); assert.equal(budget.weight, 2);
  cache.set('other', value);
  assert.equal(cache.get('same'), undefined);
  assert.equal(cache.get('other'), value);
  cache.set('other', ordinary);
  assert.equal(budget.weight, 0); assert.equal(cache.get('other'), ordinary);
});

test('public facet preparation still reuses an exact preview and appends only its authored action and guides', () => {
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
    [{ x: 1, y: 2, group: 'A' }, { x: 2, y: 4, group: 'B' }] })
    .createScatterPlot({ id: 'plot', data: 'data', x: 'x', y: 'y' });
  const view = base.createGuides();
  const action = { method: 'facet', args: { data: 'data', field: 'group', columns: 2 } };
  const result = prepareGuidedAction(base, action, view);
  assert.equal(prepareGuidedAction(base, structuredClone(action), view), result);
  assert.equal(result.authoringPreview.trace.children.length, base.trace.children.length + 1);
  assert.equal(result.authoringPreview.trace.children.at(-1).op, 'facet');
  assert.equal(result.preview.trace.children.at(-1).op, 'createGuides');
  assert.equal(Object.keys(result.preview.children).length, 2);
  assert.equal(renderToSVG(result.preview), renderToSVG(base.facet(action.args).createGuides()));
});
