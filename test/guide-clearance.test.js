import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { unionConcreteGraphicBounds } from '../vendor/ggaction/src/grammar/schemas/graphicBounds.js';
import { resolveGuideCollisionBlocks } from '../vendor/ggaction/src/materialization/guides/resources.js';
import { importDataset } from '../src/data-import.js';
const rows = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
const dimensions = ['Horsepower', 'Acceleration', 'Displacement', 'Weight_in_lbs', 'Miles_per_Gallon'];

test('Cars parallel title and top legend remain clear through prepared actions, centering and exported-call replay', () => {
  let program = chart().createCanvas(defaultCanvasOptions())
    .applyTheme({ theme: { base: 'light', tokens: { fontFamily: 'Arial', axisLabelFontFamily: 'Arial', axisTitleFontFamily: 'Arial' } } })
    .createData({ id: 'dataset', values: rows })
    .filterData({ id: 'dataset-selected-1', source: 'dataset', field: 'Horsepower', noneOf: [null], nulls: 'exclude' })
    .filterData({ id: 'dataset-selected-2', source: 'dataset-selected-1', field: 'Miles_per_Gallon', noneOf: [null], nulls: 'exclude' })
    .createParallelCoordinates({ id: 'plot', data: 'dataset-selected-2', dimensions, line: { opacity: .25 } })
    .encodeColor({ target: 'plot', field: 'Origin', fieldType: 'nominal', scale: { palette: 'observable10' } })
    .editCanvas({ plot: { width: 524, height: 314 }, margin: { top: 70.315286, right: 133.2178, bottom: 45.684714, left: 80.7822 } })
    .encodeOpacity({ target: 'plot', value: .15 }).encodeStrokeWidth({ target: 'plot', value: 1 });
  let view = program.createGuides();
  for (const action of [
    { method: 'createTitle', args: { text: 'dataset-selected-2', titleStyle: { fontFamily: 'Arial', fontSize: 23, fontWeight: 'bold' }, position: 'top', subtitleStyle: { fontFamily: 'Arial', fontSize: 10 } } },
    { method: 'editLegend', args: { target: 'plot', position: 'top' } },
    { method: 'editTitle', args: { subtitle: 'Cars: five dimensions', titleStyle: { fontSize: 30 } } },
    { method: 'editParallelAxis', args: { field: 'Displacement', title: { fontSize: 20, offset: 35 } } },
    { method: 'editLegend', args: { target: 'plot', position: 'right' } }
  ]) {
    const result = prepareGuidedAction(program, action, view);
    for (const call of [...result.prerequisiteCalls, result.recommendation, ...result.postActionCalls]) program = program[call.method](call.args);
    view = program[result.guideCall.method](result.guideCall.args);
    assert.equal(renderToSVG(view), renderToSVG(result.preview));
    const title = unionConcreteGraphicBounds(view.graphicSpec, ['chartTitle', 'chartSubtitle'].filter(id => view.graphicSpec.objects[id]), view.materializationConfigs.textMetrics);
    const occupied = resolveGuideCollisionBlocks(view.graphicSpec, view.guideConfigs, undefined, view.materializationConfigs.textMetrics).filter(b => b.position === 'top');
    assert.ok(Math.abs(Math.min(...occupied.map(b => b.bounds.top)) - title.bottom - 16) < 1e-6);
    assert.equal(view.materializationConfigs.canvas.plot.width, 524);
    assert.equal(view.materializationConfigs.canvas.plot.height, 314);
  }
});

test('facet parallel titles stay close to headers through preview, centering and exported replay', () => {
  const bikes = importDataset(readFileSync(new URL('../web/data/bike-sharing.csv', import.meta.url), 'utf8'), { format: 'csv' }).rows;
  let program = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: bikes })
    .createParallelCoordinates({ id: 'plot', data: 'dataset', dimensions: ['temp', 'hum', 'atemp', 'windspeed', 'casual'] })
    .facet({ field: 'yr', data: 'dataset', columns: 2, spacing: 'plot', gap: 33,
      guides: { axes: 'each', legend: false } });
  let view = program.createGuides();
  for (const action of [
    { method: 'createTitle', args: { text: 'Daily bike sharing', titleStyle: { fontSize: 23 } } },
    { method: 'editTitle', args: { subtitle: 'Five dimensions', subtitleStyle: { fontSize: 17 } } },
    { method: 'editTitle', args: { titleStyle: { fontSize: 30 } } }
  ]) {
    const prepared = prepareGuidedAction(program, action, view);
    for (const call of [...prepared.prerequisiteCalls, prepared.recommendation, ...prepared.postActionCalls]) program = program[call.method](call.args);
    view = program.createGuides(prepared.guideCall.args);
    assert.equal(renderToSVG(view), renderToSVG(prepared.preview));
    const title = unionConcreteGraphicBounds(view.graphicSpec, ['chartTitle', 'chartSubtitle'].filter(id => view.graphicSpec.objects[id]));
    const headers = unionConcreteGraphicBounds(view.graphicSpec, ['facet-headers']);
    assert.ok(Math.abs(headers.top - title.bottom - 16) < 1e-8);
  }
});
