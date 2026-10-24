import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { renderToSVG } from 'ggaction/svg';
import { readFileSync } from 'node:fs';
import { defaultCanvasOptions, prepareGuidedAction, addDefaultGuides } from '../src/prepare.js';
import { createCalculationService } from '../web/calculation-service.js';

// Small deterministic equivalent of vl_0047's category / population scale span.
const population = [
  { sex: 'M', people: 1000 }, { sex: 'M', people: 8_000_000 }, { sex: 'M', people: 12_000_000 },
  { sex: 'F', people: 10_000 }, { sex: 'F', people: 11_000_000 }, { sex: 'F', people: 9_000_000 },
];
const box = () => prepareGuidedAction(chart().createCanvas(defaultCanvasOptions())
  .createData({ id: 'data', values: population }), { method: 'createBoxPlot', args: {
    id: 'plot', data: 'data', x: { field: 'sex', fieldType: 'nominal' },
    y: { field: 'people', fieldType: 'quantitative' },
  } });
const scatter = () => chart().createCanvas(defaultCanvasOptions())
  .createData({ id: 'data', values: [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 }] })
  .createScatterPlot({ id: 'plot', x: 'x', y: 'y' }).createGuides();
function replay(program, result) {
  let next = program;
  for (const call of [...result.prerequisiteCalls, result.recommendation, ...result.postActionCalls, result.guideCall]) {
    next = next[call.method](call.args);
  }
  assert.equal(renderToSVG(next), renderToSVG(result.preview));
  return next;
}

test('large box symlog fits axes owned only by the displayed guide suffix', () => {
  const first = box(), program = first.authoringPreview;
  const before = serializeProgram(program);
  const action = { method: 'editYScale', args: { target: 'plot', type: 'symlog' } };
  assert.equal(program.semanticSpec.guides.axis, undefined);
  assert.throws(() => addDefaultGuides(program.editYScale(action.args)), /y-axis labels overlap/);
  const result = prepareGuidedAction(program, action, first.preview);
  assert.equal(result.recommendation.validation.topLevelActions, 1);
  assert.equal(result.preview.resolvedScales.y.type, 'symlog');
  assert.ok(result.preview.semanticSpec.guides.axis.x);
  assert.ok(result.preview.semanticSpec.guides.axis.y);
  assert.deepEqual(result.preview.guideConfigs.axis.x.labels.values, first.preview.guideConfigs.axis.x.labels.values);
  assert.equal(result.preview.guideConfigs.axis.x.labels.rotation, first.preview.guideConfigs.axis.x.labels.rotation);
  assert.equal(result.prerequisiteCalls.some(call => call.method === 'removeYAxis'), false);
  assert.ok(result.postActionCalls.some(call => call.method === 'createYAxis' && call.args.ticksAndLabels.count <= 3));
  assert.deepEqual(serializeProgram(program), before);
  replay(program, result);
});

test('recreated scale guides retain authored labels and title', () => {
  const first = box();
  const program = first.preview.editYAxis({ labels: { fontFamily: 'Arial', fontSize: 12, color: '#765432' },
    title: { text: 'Population', color: '#123456', fontFamily: 'Arial', fontSize: 19 } });
  const result = prepareGuidedAction(program, { method: 'editYScale', args: { target: 'plot', type: 'symlog' } });
  const axis = result.preview.guideConfigs.axis.y;
  assert.equal(axis.labels.fontFamily, 'Arial'); assert.equal(axis.labels.fontSize, 12);
  assert.equal(axis.labels.color, '#765432'); assert.equal(axis.title.color, '#123456');
  assert.equal(axis.title.fontSize, 19); assert.equal(result.preview.semanticSpec.guides.axis.y.title, 'Population');
  replay(program, result);
});

test('axis label fitting preserves its edit target and requested typography', () => {
  const program = scatter(), before = serializeProgram(program);
  const action = { method: 'editYAxisLabels', args: { target: 'y', fontSize: 96, color: '#123456' } };
  assert.throws(() => program.editYAxisLabels(action.args), /y-axis labels overlap/);
  const result = prepareGuidedAction(program, action);
  assert.ok(result.actionBase.semanticSpec.guides.axis.y);
  assert.equal(result.prerequisiteCalls.some(call => /remove.*Axis/.test(call.method)), false);
  assert.equal(result.preview.guideConfigs.axis.y.labels.fontSize, 96);
  assert.equal(result.preview.guideConfigs.axis.y.labels.color, '#123456');
  assert.deepEqual(serializeProgram(program), before);
  replay(program, result);
});

test('axis title spacing recovery applies to the retained native axis', () => {
  const program = scatter();
  for (const offset of [30, { from: 'labels', gap: 30 }]) {
    const result = prepareGuidedAction(program, { method: 'editXAxisTitle', args: { target: 'x', offset } });
    assert.ok(result.preview.semanticSpec.guides.axis.x);
    assert.deepEqual(result.preview.guideConfigs.axis.x.title.offset, offset);
    assert.equal(result.prerequisiteCalls.some(call => /remove.*Axis/.test(call.method)), false);
    replay(program, result);
  }
});

test('stale explicit ticks are refitted after a narrowed domain without losing the other axis', () => {
  const program = scatter().editXAxisTicksAndLabels({ values: [1, 2, 3] });
  const action = { method: 'editXScale', args: { target: 'plot', domain: [2, 3] } };
  assert.throws(() => program.editXScale(action.args), /Tick values must be inside the scale domain/);
  const result = prepareGuidedAction(program, action);
  assert.deepEqual(result.preview.resolvedScales.x.domain, [2, 3]);
  assert.ok(result.preview.semanticSpec.guides.axis.y);
  assert.deepEqual(result.preview.guideConfigs.axis.y, program.guideConfigs.axis.y);
  replay(program, result);
});

test('worker Box scale preview and materialized Apply replay the same fitted guide', () => {
  const first = box(), service = createCalculationService();
  service.execute({ type: 'state', stateId: 'population', snapshot: serializeProgram(first.authoringPreview), guideCall: first.guideCall });
  const request = { stateId: 'population', action: { method: 'editYScale', args: { target: 'plot', type: 'symlog' } } };
  const result = service.execute({ ...request, type: 'prepare' });
  assert.ok(result.postActionCalls.some(call => call.method === 'createYAxis'));
  const materialized = service.execute({ ...request, type: 'materialize' });
  const restored = deserializeProgram(materialized.snapshot).createGuides(materialized.guideCall.args);
  assert.deepEqual(result.preview.graphicSpec, restored.graphicSpec);
  let replayed = first.authoringPreview;
  for (const call of [...result.prerequisiteCalls, result.recommendation, ...result.postActionCalls, result.guideCall]) replayed = replayed[call.method](call.args);
  assert.equal(renderToSVG(restored), renderToSVG(replayed));
});

test('axis title gap and font boundary matrix replays across four chart states (72 combinations)', () => {
  const dataset = name => JSON.parse(readFileSync(new URL(`../web/data/${name}.json`, import.meta.url)));
  const start = (values, method, args) => prepareGuidedAction(chart().createCanvas(defaultCanvasOptions())
    .createData({ id: 'data', values }), { method, args: { id: 'plot', data: 'data', ...args } });
  const largeBox = box();
  const states = [
    ['Iris scatter', start(dataset('iris'), 'createScatterPlot', {
      x: 'Sepal.Width', y: 'Petal.Width', color: 'Species',
    })],
    ['Cars binned bar', start(dataset('cars'), 'createBarPlot', {
      x: { field: 'Miles_per_Gallon', fieldType: 'quantitative', bin: { maxBins: 12 } },
      y: { field: 'Horsepower', fieldType: 'quantitative', aggregate: 'mean' },
      color: { field: 'Origin', fieldType: 'nominal', layout: 'stack' }, missing: 'skip',
    })],
    ['Stocks temporal line', start(dataset('stocks').map(row => ({ ...row,
      date: new Date(row.date).toISOString(), price: Number(row.price) })), 'createLinePlot', {
      x: { field: 'date', fieldType: 'temporal' }, y: { field: 'price', aggregate: 'mean' }, color: 'symbol',
    })],
    ['Large Box symlog', prepareGuidedAction(largeBox.authoringPreview,
      { method: 'editYScale', args: { target: 'plot', type: 'symlog' } }, largeBox.preview)],
  ];
  const failures = [];
  let completed = 0;
  for (const [name, state] of states) for (const axis of ['x', 'y'])
    for (const gap of [0, 15, 30]) for (const fontSize of [8, 16, 24]) {
      try {
        const result = prepareGuidedAction(state.authoringPreview, {
          method: axis === 'x' ? 'editXAxisTitle' : 'editYAxisTitle',
          args: { target: axis, fontSize, offset: { from: 'labels', gap } },
        }, state.preview);
        assert.equal(result.preview.guideConfigs.axis[axis].title.fontSize, fontSize);
        assert.deepEqual(result.preview.guideConfigs.axis[axis].title.offset, { from: 'labels', gap });
        assert.equal(result.recommendation.validation.topLevelActions, 1);
        assert.ok(result.preview.semanticSpec.guides.axis.x);
        assert.ok(result.preview.semanticSpec.guides.axis.y);
        replay(state.authoringPreview, result);
        completed += 1;
      } catch (error) { failures.push(`${name}; ${axis.toUpperCase()}; gap=${gap}; font=${fontSize}: ${error.message}`); }
    }
  assert.deepEqual(failures, []);
  assert.equal(completed, 72);
});
