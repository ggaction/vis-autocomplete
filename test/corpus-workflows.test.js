import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { importDataset } from '../src/data-import.js';
import { profileDataset } from '../src/profile.js';
import { selectedPlotDefinitions } from '../src/selected-plots.js';
import { defaultValues } from '../src/plot-catalog.js';
import { defaultCanvasOptions, prepareGuidedAction, addDefaultGuides } from '../src/prepare.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { extendedCandidates } from '../src/extended-catalog.js';
import { recommendationParameters, valuesFor, activeControls } from '../web/parameters.js';
const corpus = id => importDataset(readFileSync(new URL(`./fixtures/corpus/${id}.json`, import.meta.url), 'utf8'), {format:'json', name:id}).rows;
const base = rows => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows });
const options = (rows, selection) => { const p = base(rows), profile = profileDataset(p, 'dataset'); return { p, profile, definitions: selectedPlotDefinitions(profile, selection, rows, [], { availableProfile: profile }) }; };
const prepare = (p, d, values = defaultValues(d)) => prepareGuidedAction(p, { method: d.method, args: d.build(values) }, p, d.setup?.(values));
const candidates = p => extendedCandidates(p, { layer: p.semanticSpec.layers.find(l => l.id === 'plot'), profile: profileDataset(p, p.semanticSpec.layers.find(l => l.id === 'plot').data) });

test('original univariate and count datasets have useful native initial plots', () => {
  for (const [id, x, methods] of [['vl_0043', 'x', ['createHistogram', 'createDensityPlot', 'createECDFPlot', 'createRugPlot']], ['vl_0012', 'Activity', ['createBarPlot', 'createPiePlot', 'createRosePlot', 'createRadialBarPlot']]]) {
    const { p, definitions } = options(corpus(id), { x });
    for (const method of methods) {
      const d = definitions.find(d => d.method === method); assert.ok(d, method);
      const result = prepare(p, d); assert.equal(result.recommendation.validation.topLevelActions, 1);
      assert.ok(renderToSVG(result.preview).startsWith('<svg'));
    }
  }
});

test('categorical count heatmap preserves row counts and supplied interval uses original bounds', () => {
  const data = [{ a: 'A', b: 'B' }, { a: 'A', b: 'B' }, { a: 'A', b: 'C' }];
  const { p, definitions } = options(data, { x: 'a', y: 'b' });
  const r = prepare(p, definitions.find(d => d.method === 'createHeatmap'));
  assert.deepEqual(r.actionBase.semanticSpec.datasets.at(-1).values.map(row => row.__count), [2, 1]);
  const fixture = options(corpus('vl_0024'), { x: 'Year', y: 'center' });
  const interval = fixture.definitions.find(d => d.method === 'createIntervalPlot');
  assert.deepEqual(interval.build(defaultValues(interval)).y, { center: 'center', lower: 'ci0', upper: 'ci1', scale: { type: 'linear' } });
  assert.equal(prepare(fixture.p, interval).preview.semanticSpec.datasets.at(-1).values.length, 4);
});

test('Likert labels fit natively and singleton CI has an honest adequacy requirement', () => {
  const { p, definitions } = options(corpus('vl_0013'), { x: 'question', y: 'percentage', color: 'type' });
  for (const d of definitions.filter(d => !d.requirement)) assert.ok(renderToSVG(prepare(p, d).preview).startsWith('<svg'), d.method);
  assert.match(definitions.find(d => d.method === 'createIntervalPlot').requirement, /only one observation/);
});

test('calendar month aggregation produces 48 weather months and remains editable after Apply', () => {
  const { p, definitions } = options(corpus('vl_0096'), { x: 'date', y: 'temp_max' });
  for (const method of ['createLinePlot', 'createBarPlot', 'createAreaPlot', 'createHorizonPlot']) {
    const d = definitions.find(d => d.method === method), r = prepare(p, d, { ...defaultValues(d), timeUnit: 'month' });
    const calendar = r.actionBase.semanticSpec.datasets.find(d => d.transform?.[0]?.type === 'timeUnit');
    assert.equal(new Set(calendar.values.map(row => row['date (calendar)'])).size, 48, method);
    assert.ok(candidates(r.authoringPreview).some(c => c.method === 'editTimeUnitData'), method);
  }
});

test('Bar and Area retain post-Apply native bin and aggregation editors', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i % 7 + 1, color: i % 2 ? 'a' : 'b' }));
  const { p, definitions } = options(rows, { x: 'x', y: 'y', color: 'color' });
  for (const method of ['createBarPlot', 'createAreaPlot']) {
    const d = definitions.find(d => d.method === method), r = prepare(p, d), all = candidates(r.authoringPreview);
    assert.ok(all.some(c => ['encodeY', 'editSummaryData'].includes(c.method)), method);
    const c = all.find(c => c.feature === 'transform.bin'); assert.ok(c, method);
    const editor = recommendationParameters(c, profileDataset(r.authoringPreview, 'dataset'));
    const v = valuesFor(editor.controls); v[c.binRecipe ? 'bins' : 'p0'] = 4;
    const next = prepareGuidedAction(r.authoringPreview, { method: c.method, args: editor.build(v) }, r.preview);
    assert.notEqual(renderToSVG(next.preview), renderToSVG(r.preview));
    assert.equal(next.recommendation.validation.topLevelActions, 1);
    assert.equal(next.authoringPreview.semanticSpec.layers.find(l => l.id === 'plot').encoding.color.field, 'color');
  }
});

test('conditional regression, facet, filter and size editors keep valid dependent values', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ x: i + 1, y: 1000 + i * 100, a: i % 2 ? 'A' : 'B', b: i % 3 ? 'C' : 'D' }));
  const p = base(rows).createScatterPlot({ id: 'plot', x: 'x', y: 'y' }), profile = profileDataset(p, 'dataset');
  const ed = recommendationParameters({ method: 'createRegression', args: { target: 'plot', method: 'linear', level: .95 } }, profile);
  for (const method of ['linear', 'polynomial', 'loess', 'exp']) {
    const v = { ...valuesFor(ed.controls), method }, args = ed.build(v);
    assert.equal(activeControls(ed.resolveControls(v), v).some(c => c.key === 'level'), ['linear', 'polynomial'].includes(method));
    assert.ok(prepareGuidedAction(p, { method: 'createRegression', args }).preview);
  }
  const filters = candidates(p).filter(c => c.method === 'filterMarks' && c.args.channel);
  const f = recommendationParameters({ ...filters[0], alternatives: filters }, profile);
  const v = f.normalizeValues({ ...valuesFor(f.controls), p0: 'y' }, 'p0');
  assert.ok(v.p2 >= 1000); assert.ok(f.resolveControls(v)[2].min >= 1000);
  const scale = candidates(p.encodeSize({ target: 'plot', field: 'x' })).find(c => c.method === 'editSizeScale');
  const se = recommendationParameters(scale, profile), sv = valuesFor(se.controls);
  assert.ok(sv.p1 >= se.controls[1].min); assert.equal(se.normalizeValues({ ...sv, p0: 500 }, 'p0').p1, 500);
});

test('current positive position can become log without zero options and statistics default to visible marks', () => {
  const p = base([{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 100, y: 9 }]).createScatterPlot({ id: 'plot', x: 'x', y: 'y' });
  const all = candidates(p), c = all.find(c => c.method === 'editXScale');
  assert.ok(c.parameters[0].choices.some(c => c.value === 'log'));
  const editor = recommendationParameters(c, profileDataset(p, 'dataset'));
  const log = prepareGuidedAction(p, { method: c.method, args: editor.build({ ...valuesFor(editor.controls), p0: 'log' }) });
  const layer = log.preview.semanticSpec.layers.find(l => l.id === 'plot');
  assert.equal(log.preview.semanticSpec.scales.find(s => s.id === layer.encoding.x.scale).type, 'log');
  assert.ok(all.filter(c => c.method === 'createStatisticalReference').every(c => c.args.population === 'visibleItems'));
});

test('statistical population follows filtered visible marks without changing the bound dataset', () => {
  const p = base([{x:1,y:1},{x:2,y:3},{x:100,y:9}]).createScatterPlot({id:'plot',x:'x',y:'y'}).filterMarks({target:'plot',channel:'x',op:'lte',value:2,mode:'replace'});
  const c = candidates(p).find(c=>c.method==='createStatisticalReference'&&c.args.axis==='x');
  const editor = recommendationParameters(c, profileDataset(p,'dataset'));
  const values=valuesFor(editor.controls);
  const visible=prepareGuidedAction(p,{method:c.method,args:editor.build(values)});
  assert.equal(visible.preview.semanticSpec.datasets.at(-1).values[0].value,1.5);
  const bound=prepareGuidedAction(p,{method:c.method,args:editor.build({...values,population:'boundData'})});
  assert.equal(bound.preview.semanticSpec.datasets.at(-1).values[0].value,103/3);
});

test('explicit ordinal order reaches native plot scales, and event counts override a meaningless mean default', () => {
  const rows=[{stage:'third',value:1},{stage:'first',value:1},{stage:'third',value:1},{stage:'second',value:1}];
  const p=base(rows), profile=profileDataset(p,'dataset',{stage:{type:'ordinal',order:['first','second','third']}});
  const engine=createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json',import.meta.url))));
  const result=engine.recommend(rows,profile,{selection:{x:'stage',y:'value'}});
  const rec=result.recommendations.find(d=>d.method==='createBarPlot');
  assert.equal(rec.values.aggregate,'sum');
  const r=prepare(p,rec,rec.values), layer=r.preview.semanticSpec.layers.find(l=>l.id==='plot');
  assert.deepEqual(r.preview.resolvedScales[layer.encoding.x.scale].domain,['first','second','third']);
});

test('aggregate appearance choices match the final bar cells and log cannot misrepresent a zero baseline', async () => {
  const { appearanceCandidates } = await import('../src/appearance-candidates.js');
  const { generateCandidates } = await import('../src/catalog.js');
  const { p, definitions } = options(corpus('vl_1486'), { x: 'day', y: 'tip', color: 'sex' });
  const r = prepare(p, definitions.find(d => d.method === 'createBarPlot'));
  const program = r.authoringPreview, layer = program.semanticSpec.layers.find(l => l.id === 'plot');
  const profile = profileDataset(program, layer.data), appearance = appearanceCandidates(program, { layer, profile });
  for (const method of ['encodeStroke', 'encodeOpacity']) {
    const variants = appearance.filter(c => c.method === method);
    assert.ok(variants[0].unavailableFields.some(f => f.value === 'size' && f.disabled && f.reason));
    assert.ok(!variants.some(c => c.args.field === 'size'));
    for (const c of variants) assert.ok(prepareGuidedAction(program, c).preview);
  }
  const all = generateCandidates(program, { layer, profile });
  const encodedY = all.find(c => c.method === 'encodeY' && c.category === 'encoding');
  const editor = recommendationParameters({ ...encodedY, scaleIds: program.semanticSpec.scales.map(s => s.id) }, profile);
  const args = editor.build({ ...valuesFor(editor.controls), scale: 'symlog' });
  assert.notEqual(args.scale.id, layer.encoding.y.scale);
  assert.ok(prepareGuidedAction(program, { method: 'encodeY', args }).preview);
  const scale = all.find(c => c.method === 'editYScale');
  assert.ok(scale.parameters[0].choices.find(c => c.value === 'log').disabled);
  assert.match(scale.parameters[0].choices.find(c => c.value === 'log').reason, /zero baseline/);
  const filter = all.find(c => c.method === 'filterMarks' && c.args.channel === 'y');
  assert.ok(filter.parameters.find(p => p.path === 'value').max < 4, 'mean tips, not raw individual tips');
});

test('Box position editing uses the compound owner and Text groups repeated categorical observations', async () => {
  const { generateCandidates } = await import('../src/catalog.js');
  const rows = corpus('vl_1278'), { p, definitions } = options(rows, { x: 'Species', y: 'Petal.Length' });
  const box = prepare(p, definitions.find(d => d.method === 'createBoxPlot'));
  const program = box.authoringPreview, layer = program.semanticSpec.layers.find(l => l.id === 'plot');
  const all = generateCandidates(program, { layer, profile: profileDataset(program, layer.data) });
  assert.ok(!all.some(c => ['encodeX', 'encodeY'].includes(c.method)), 'body-only positional edits are replaced with the compound editor');
  const edit = all.find(c => c.method === 'editBoxPlot' && c.category === 'encoding');
  const result = prepareGuidedAction(program, edit);
  assert.equal(result.authoringPreview.markConfigs.plot.boxPlot.measure, 'Sepal.Length');
  assert.equal(result.authoringPreview.semanticSpec.layers.find(l => l.id === 'plotOutliers').encoding.y.field, 'Sepal.Length');
  const minmax = result.authoringPreview.editBoxPlot({target:'plot',whisker:{type:'minmax'}});
  const filter = candidates(minmax).find(c => c.method === 'filterMarks');
  assert.equal(filter.args.channel,'x');
  const filtered = prepareGuidedAction(minmax,filter);
  assert.equal(filtered.preview.semanticSpec.guides.axis.y.title,'Sepal.Length');
  assert.equal(filtered.recommendation.validation.topLevelActions,1);

  const text = definitions.find(d => d.method === 'createTextPlot');
  assert.ok(!text.requirement);
  const summary = prepare(p, text);
  assert.equal(summary.actionBase.semanticSpec.datasets.at(-1).values.length, 3);
  assert.equal(summary.recommendation.validation.topLevelActions, 1);
  const q = options(rows, { x: 'Sepal.Length', y: 'Petal.Length' }).definitions.find(d => d.method === 'createTextPlot');
  assert.match(q.requirement, /150 text labels/);
});

test('shared series legend updates are explicit native post-action setup and replay identically', () => {
  const p = base([{x:1,y:1,g:'A'},{x:2,y:3,g:'A'},{x:1,y:3,g:'B'},{x:2,y:4,g:'B'}])
    .createLinePlot({id:'plot',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}});
  const r = prepareGuidedAction(p,{method:'encodeStrokeDash',args:{target:'plot',field:'g',fieldType:'nominal'}});
  assert.equal(r.recommendation.validation.topLevelActions,1);
  assert.deepEqual(r.postActionCalls.filter(call => call.method !== 'editCanvas'),[{method:'editLegend',args:{target:'plot',channels:['color','strokeDash']}}]);
  // Native centering may follow the legend update; replay both calls below.
  let replay=p[r.recommendation.method](r.recommendation.args);
  for(const call of r.postActionCalls)replay=replay[call.method](call.args);
  replay=replay[r.guideCall.method](r.guideCall.args);
  assert.equal(renderToSVG(replay),renderToSVG(r.preview));
  assert.deepEqual(r.authoringPreview.semanticSpec.guides.legend.series.channels,['color','strokeDash']);
});

test('position changes fit guides with explicit replayable setup while retaining authored styles and titles', () => {
  const rows = Array.from({length:40},(_,i)=>({x:i+1,y:i%7,country:`Long country name number ${i}`}));
  const p = base(rows).createScatterPlot({id:'plot',x:'x',y:'y'})
    .editXAxisLabels({fontSize:14,fontFamily:'Arial',color:'#112233'})
    .editXAxisTitle({text:'Custom X'});
  const r = prepareGuidedAction(p,{method:'encodeX',args:{target:'plot',field:'country',fieldType:'nominal',scale:{id:'country-x',type:'band'}}});
  assert.equal(r.recommendation.validation.topLevelActions,1);
  assert.ok(r.prerequisiteCalls.some(c=>c.method==='removeXAxis'));
  const create = r.postActionCalls.find(c=>c.method==='createXAxis');
  assert.equal(create.args.ticksAndLabels.labels.color,'#112233');
  assert.equal(create.args.ticksAndLabels.labels.fontSize,14);
  assert.equal(create.args.title.text,'Custom X');
  let replay=p;
  for(const call of [...r.prerequisiteCalls,r.recommendation,...r.postActionCalls,r.guideCall])replay=replay[call.method](call.args);
  assert.equal(renderToSVG(replay),renderToSVG(r.preview));
});

test('regression controls explain data constraints and grouped LOESS stays available within its native budget', async () => {
  const {regressionContext}=await import('../src/regression-context.js');
  const rows=Array.from({length:1200},(_,i)=>({x:i+1,y:i%11-1,g:i%2?'A':'B'}));
  const p=base(rows),profile=profileDataset(p,'dataset');
  const layer={id:'plot',mark:{type:'point'},data:'dataset',encoding:{x:{field:'x',fieldType:'quantitative'},y:{field:'y',fieldType:'quantitative'}}};
  const editor=recommendationParameters({method:'createRegression',args:{target:'plot',method:'linear'},regressionContext:regressionContext(p,layer,profile)},profile);
  const values=valuesFor(editor.controls);
  const model=editor.resolveControls(values).find(c=>c.key==='method');
  assert.ok(model.choices.find(c=>c.value==='loess').disabled);
  assert.match(model.choices.find(c=>c.value==='loess').reason,/budget/);
  assert.ok(model.choices.find(c=>c.value==='exp').disabled);
  assert.equal(editor.resolveControls({...values,group:'g'}).find(c=>c.key==='method').choices.find(c=>c.value==='loess').disabled,false);
});
