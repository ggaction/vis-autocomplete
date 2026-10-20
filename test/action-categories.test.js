import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { generateCandidates } from '../src/catalog.js';
import { recommendationCategory, optionGroup } from '../src/recommendation-groups.js';
import { PUBLIC_ACTION_NAMES } from '../src/public-actions.js';
import { createRecommendationEngine } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { defaultCanvasOptions, prepareStartingPlot } from '../src/prepare.js';
import { getPlotDefinitions, defaultValues } from '../src/plot-catalog.js';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const rows = Array.from({ length: 18 }, (_, i) => ({ X: i + 1, Y: i % 7 + 1, Group: ['A', 'B', 'C'][i % 3] }));
const scatter = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows })
  .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', color: 'Group' });

test('all public scale editors and facet source wrappers belong to Encoding', () => {
  const methods = PUBLIC_ACTION_NAMES.filter(method => /^edit.*Scale$/.test(method));
  assert.ok(methods.length >= 14);
  for (const method of [...methods, 'editFacetScales', 'facet', 'facetGrid', 'repeatCharts', 'orderCategories', 'encodePathOrder']) {
    const rec = { method, args: {}, category: 'style' };
    assert.equal(recommendationCategory(rec), 'encoding', method);
    assert.equal(optionGroup(rec), 'encoding', method);
    assert.equal(optionGroup({ method: 'editFacetSource', category: 'style',
      args: { action: { method, options: {} } } }), 'encoding', `wrapped ${method}`);
  }
});

test('mixed-purpose functions follow the card intent, not the function prefix', () => {
  const cases = [
    ['encodeX', 'encoding', { field: 'X', bin: { maxBins: 10 } }, 'encoding'],
    ['encodeX', 'transform', { field: 'X', bin: { maxBins: 12 } }, 'transform'],
    ['encodeY', 'transform', { field: 'Y', aggregate: 'mean' }, 'transform'],
    ['createMarkLabels', 'guide', { source: 'plot', field: 'Group' }, 'encoding'],
    ['createMarkLabels', 'guide', { source: 'plot', content: 'value' }, 'encoding'],
    ['createMarkLabels', 'guide', { source: 'plot', value: 'Selected' }, 'style'],
    ['editMarkLabelPlacement', 'style', { target: 'labels' }, 'style'],
    ['editCompositionLayout', 'transform', { columns: 3, gap: 12 }, 'style'],
    ['editArcMark', 'style', { innerRadius: { unit: 'px', value: 60 }, stroke: false }, 'encoding'],
    ['editArcMark', 'style', { padAngle: 1 }, 'encoding'],
    ['editArcMark', 'style', { opacity: .8, stroke: false }, 'style'],
    ['editBoxPlot', 'encoding', { x: { field: 'Group' }, y: { field: 'Y' } }, 'encoding'],
    ['editBoxPlot', 'style', { whisker: { type: 'tukey', factor: 1.5 } }, 'transform'],
    ['editBoxPlot', 'style', { whisker: { strokeWidth: 2 }, box: { fill: '#000000' } }, 'style'],
    ['editErrorBar', 'encoding', { y: { field: 'Y', extent: 'ci' } }, 'encoding'],
    ['editErrorBar', 'style', { strokeWidth: 2, caps: true }, 'style'],
    ['createStatisticalReference', 'transform', { source: 'plot', axis: 'y' }, 'transform'],
    ['editSummaryData', 'transform', { target: 'summary' }, 'transform'],
    ['editSortedData', 'transform', { target: 'sorted' }, 'transform'],
    ['layoutSeries', 'transform', { target: 'plot', mode: 'fill' }, 'transform'],
    ['jitterPoints', 'transform', { target: 'plot', channel: 'both' }, 'transform'],
  ];
  for (const [method, category, args, expected] of cases) {
    const rec = { method, category, args };
    assert.equal(optionGroup(rec), expected, `${method}: ${JSON.stringify(args)}`);
    assert.equal(optionGroup({ ...rec, method: 'editFacetSource',
      args: { action: { method, options: args } } }), expected, `wrapped ${method}`);
  }
});

// Audit every emitted recipe across the initial chart families, including
// compound-chart children and corpus style variants. New methods require an
// explicit expected group here rather than silently inheriting a wrong tab.
const expected = Object.fromEntries(Object.entries({
  encoding: `editECDFPlot editEndpointPlot editFacetScales editGradientPlot editViolinPlot
    encodeAngle encodeBarWidth encodeColor encodeGroup encodeOpacity encodeParallelCoordinates
    encodeR encodeShape encodeSize encodeStroke encodeStrokeDash encodeStrokeWidth encodeText
    encodeTheta encodeX2 encodeXOffset encodeY2 facet facetGrid createMarkLabels orderCategories encodePathOrder`,
  transform: `createRegression createStatisticalReference editBin2DData editRegression filterMarks jitterPoints layoutSeries packPoints`,
  style: `createAnnotation createTitle editAxes editGrid editLegend editCompositionLayout
    editArcMark editAreaMark editBarMark editCanvas editCoordinate editErrorBand editFacetGuides editFacetHeaders
    editHorizontalGrid editLegendBlock editLegendBorder editLegendLabels editLegendLayout editLegendSymbols editLegendTitle
    editLineMark editPointMark editRectMark editRuleMark editTextMark editTickMark editVerticalGrid
    editXAxis editXAxisLabels editXAxisLine editXAxisTicks editXAxisTicksAndLabels editXAxisTitle
    editYAxis editYAxisLabels editYAxisLine editYAxisTicks editYAxisTicksAndLabels editYAxisTitle`,
}).flatMap(([group, names]) => names.trim().split(/\s+/).map(method => [method, group])));

test('all generated chart-family recipes have an audited semantic category', () => {
  const cars = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: cars });
  const programs = getPlotDefinitions(profileDataset(base, 'dataset')).filter(d => !d.requirement)
    .map(def => prepareStartingPlot(base, { method: def.method, args: def.build(defaultValues(def)) }).preview);
  programs.push(scatter().facet({ field: 'Group' }));
  const seen = new Set();
  for (const program of programs) for (const layer of program.semanticSpec.layers.filter(l => !l.source)) {
    for (const rec of generateCandidates(program, { layer, profile: profileDataset(program, layer.data), actionEvidence: model.actionEvidence })) {
      seen.add(rec.method);
      const group = optionGroup(rec);
      assert.equal(rec.category === 'guide' ? 'style' : rec.category, group);
      if (/^edit.*Scale$/.test(rec.method)) assert.equal(group, 'encoding', rec.method);
      else if (['encodeX', 'encodeY'].includes(rec.method)) {
        assert.equal(group, rec.feature.startsWith('transform.') ? 'transform' : 'encoding');
      } else if (['editBoxPlot', 'editErrorBar'].includes(rec.method)) {
        assert.equal(group, rec.args.x || rec.args.y ? 'encoding'
          : rec.args.whisker?.type || rec.args.whisker?.factor !== undefined ? 'transform' : 'style');
      } else if (rec.method === 'editArcMark') {
        assert.equal(group, rec.args.innerRadius !== undefined || rec.args.padAngle !== undefined ? 'encoding' : 'style');
      } else assert.equal(group, expected[rec.method], rec.method);
    }
  }
  assert.ok(seen.size >= 85, `audited ${seen.size} native functions`);
});

test('group/category filtering preserves co-occurrence scores and keeps mappings available after X/Y/Color selection', () => {
  const p = scatter().createGuides(), engine = createRecommendationEngine(model);
  const options = { target: 'plot', limit: 1000, includeRevisions: true, validationMode: 'deferred' };
  const all = engine.recommend(p, options).recommendations;
  for (const group of ['encoding', 'transform', 'style']) {
    const selected = engine.recommend(p, { ...options, group }).recommendations;
    assert.deepEqual(selected, all.filter(rec => optionGroup(rec) === group));
  }
  const category = engine.recommend(p, { ...options, category: 'encoding', excludeMappedChannels: ['x', 'y', 'color'] }).recommendations;
  for (const method of ['editXScale', 'editYScale', 'editColorScale']) assert.ok(category.some(rec => rec.method === method), method);
});

test('one native function can retain separate variable, statistic and appearance cards without mixing alternatives', () => {
  const p = chart().createCanvas(defaultCanvasOptions()).createData({ values: rows })
    .createBoxPlot({ id: 'plot', x: { field: 'Group', fieldType: 'nominal' }, y: { field: 'Y' } }).createGuides();
  const engine = createRecommendationEngine(model);
  const options = { target: 'plot', limit: 1000, includeRevisions: true, validationMode: 'deferred' };
  const cards = engine.recommend(p, options).recommendations.filter(rec => rec.method === 'editBoxPlot');
  assert.deepEqual(cards.map(optionGroup).sort(), ['encoding', 'style', 'transform']);
  assert.equal(new Set(cards.map(rec => rec.id)).size, 3);
  for (const rec of cards) {
    const perGroup = engine.recommend(p, { ...options, group: optionGroup(rec) }).recommendations;
    assert.deepEqual(perGroup.find(other => other.id === rec.id), rec);
    if (optionGroup(rec) !== 'encoding') {
      const statistical = args => args.whisker?.type !== undefined || args.whisker?.factor !== undefined;
      assert.ok(rec.alternatives.every(alt => statistical(alt.args) === (optionGroup(rec) === 'transform')));
    }
  }
});

test('worker search serves scale cards only in Encoding, including facet wrappers', () => {
  for (const raw of [scatter(), scatter().facet({ field: 'Group' })]) {
    const service = createCalculationService(model);
    service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(raw) });
    const request = (group, searchQuery) => service.execute({ type: 'recommend', stateId: 1, group, searchQuery,
      options: { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS } });
    for (const method of ['editXScale', 'editYScale', 'editColorScale']) {
      const encoding = request('encoding', method).result.recommendations;
      assert.ok(encoding.some(rec => (rec.sourceMethod ?? rec.method) === method), method);
      assert.deepEqual(request('style', method).result.recommendations, []);
      assert.deepEqual(request('transform', method).result.recommendations, []);
      assert.ok(encoding.every(rec => rec.category === 'encoding' && rec.validation.topLevelActions === 1));
    }
    const axes = request('style', 'editAxes').result.recommendations;
    assert.ok(axes.some(rec => (rec.sourceMethod ?? rec.method) === 'editAxes'));
  }
});
