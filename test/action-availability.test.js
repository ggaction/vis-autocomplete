import { replayPrepared, assertPreparedTrace } from './support/prepared.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { describeAction } from 'ggaction/inspection';
import { createRecommendationEngine, profileDataset } from '../src/index.js';
import { recommendationParameters, valuesFor, activeControls } from '../web/parameters.js';
import { prepareGuidedAction, addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const rows = Array.from({ length: 36 }, (_, i) => ({ X: i % 6 + 1, Y: i % 9 + 1, Value: i + 1,
  Category: ['B', 'A', 'C'][i % 3], Series: ['First', 'Second'][Math.floor(i / 3) % 2] }));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
const recommend = raw => engine.recommend(addDefaultGuides(raw), { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS, authoringProgram: raw });

test('heatmap offers every supported unused appearance channel with real Fixed/Variable calls', () => {
  const raw = base().createHeatmap({ id: 'plot', x: 'Category', y: 'Series', color: 'Value', guides: false });
  const view = addDefaultGuides(raw), result = recommend(raw);
  for (const method of ['encodeStroke', 'encodeOpacity', 'encodeStrokeWidth']) {
    const rec = result.recommendations.find(r => r.method === method);
    assert.ok(rec, method);
    assert.ok(rec.alternatives.some(a => a.args.field), `${method} must have field mapping`);
    assert.ok(rec.alternatives.some(a => 'value' in a.args), `${method} must have fixed mode`);
    const editor = recommendationParameters(rec, profileDataset(view, 'data'));
    for (const mode of ['fixed', 'variable']) {
      const values = { ...valuesFor(editor.controls), mode, field: 'Value' };
      assert.ok(editor.controls.filter(control => !control.when || control.when(values)).length <= 3);
      const args = editor.build(values);
      const prepared = prepareGuidedAction(raw, { method, args }, view);
      assert.equal(prepared.recommendation.validation.topLevelActions, 1);
      assertPreparedTrace(prepared);
      const next = recommend(prepared.authoringPreview);
      assert.ok(next.recommendations.some(r => r.method === method && r.previouslyApplied), 'applied channels remain available at the back');
    }
  }
  assert.ok(!result.recommendations.some(r => ['encodeSize', 'encodeShape'].includes(r.method)));
  assert.ok(result.recommendations.filter(r => ['encodeColor', 'encodeX', 'encodeY'].includes(r.method) && r.category === 'encoding')
    .every(r => r.previouslyApplied));
  assert.ok(!result.recommendations.some(r => r.method === 'removeEncoding'), 'encoding removal belongs to history, not option cards');
});

test('sorting reaches both heatmap axes and polar categories through the actual parameter editor', () => {
  const raw = base().createHeatmap({ id: 'plot', x: 'Category', y: 'Series', color: 'Value', guides: false });
  const rec = recommend(raw).recommendations.find(r => r.method === 'orderCategories');
  assert.deepEqual(new Set(rec.alternatives.map(a => a.args.channel)), new Set(['x', 'y']));
  const editor = recommendationParameters(rec, profileDataset(raw, 'data'));
  for (const channel of ['x', 'y']) {
    const args = editor.build({ ...valuesFor(editor.controls), by: JSON.stringify([channel, 'category']), direction: 'descending' });
    const prepared = prepareGuidedAction(raw, { method: 'orderCategories', args }, addDefaultGuides(raw));
    assert.equal(prepared.authoringPreview.semanticSpec.layers.find(l => l.id === 'plot').encoding[channel].categoryOrder.direction, 'descending');
  }
  const pie = base().createPiePlot({ id: 'plot', category: 'Category', value: 'Value', guides: false });
  assert.ok(recommend(pie).recommendations.some(r => r.method === 'orderCategories' && r.alternatives.some(a => a.args.channel === 'theta')));
});

test('categorical point and bar positions expose native offsets, and bars expose independent series grouping', () => {
  for (const method of ['createScatterPlot', 'createBarPlot']) {
    const raw = base()[method]({ id: 'plot', x: { field: 'Category', fieldType: 'nominal' },
      y: { field: 'Value', ...(method === 'createBarPlot' ? { aggregate: 'mean' } : {}) }, guides: false });
    const result = recommend(raw), rec = result.recommendations.find(r => r.method === 'encodeXOffset');
    assert.ok(rec, method);
    const args = rec.alternatives.find(a => a.args.field === 'Series').args;
    assert.equal(prepareGuidedAction(raw, { method: rec.method, args }).recommendation.validation.topLevelActions, 1);
    if (method === 'createBarPlot') assert.ok(result.recommendations.some(r => r.method === 'encodeGroup' && r.alternatives.some(a => a.args.field === 'Series')));
  }
});

test('appearance inspection and generation agree for nonbasic marks without returning incompatible channels', () => {
  const starts = [
    base().createHeatmap({ id: 'plot', x: 'Category', y: 'Series', color: 'Value', guides: false }),
    base().createTextPlot({ id: 'plot', x: 'X', y: 'Y', text: 'Category', guides: false }),
    base().createRugPlot({ id: 'plot', x: 'X', edge: 'bottom', guides: false }),
  ];
  for (const raw of starts) {
    const result = recommend(raw);
    for (const rec of result.recommendations.filter(r => r.category === 'encoding' && /^encode/.test(r.method))) {
      assert.equal(describeAction(raw, { action: rec.method, target: { kind: 'mark', id: 'plot' } }).applicability, 'supported', rec.method);
    }
  }
});

test('a no-op fixed default never removes a supported color or stroke-width action',async()=>{
 const {cars}=await import('../examples/scenarios.js');
 const {getPlotDefinitions,defaultValues}=await import('../src/plot-catalog.js');
 const {createCalculationService}=await import('../web/calculation-service.js');
 const {serializeProgram}=await import('ggaction/persistence');
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:cars});
 for(const [plot,method]of [['createAreaPlot','encodeColor'],['createDensityPlot','encodeColor'],['createECDFPlot','encodeStrokeWidth']]){
  const spec=getPlotDefinitions(profileDataset(p,'data')).find(d=>d.method===plot);
  const start=prepareGuidedAction(p,{method:plot,args:spec.build(defaultValues(spec))});
  const service=createCalculationService(model);
  service.execute({type:'state',stateId:1,snapshot:serializeProgram(start.authoringPreview),guideCall:start.guideCall});
  let result;
  for(let page=0;;page++){
   const response=service.execute({type:'recommend',stateId:1,group:'encoding',page,options:{target:'plot',...FOLLOWUP_RECOMMENDATION_OPTIONS}});
   result=response.result;
   if(response.pagination.complete)break;
  }
  const rec=result.recommendations.find(r=>r.method===method);
  assert.ok(rec,`${plot}: ${method}`);
  if (method === 'encodeColor') assert.equal(rec.args.value, '#e45756');
  else assert.ok([2, 3].includes(rec.args.value));
  const prepared = prepareGuidedAction(start.authoringPreview,rec,start.preview);
  assert.equal(prepared.recommendation.validation.topLevelActions,1);
 }
});

test('line dash can establish series while area color respects its native path grain',async()=>{
 const {cars}=await import('../examples/scenarios.js');
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:cars.map((r,i)=>({...r,Segment:i%2?'S':'T'}))});
 const line=p.createLinePlot({id:'plot',x:'Horsepower',y:'Miles_per_Gallon',guides:false});
 const result=recommend(line), dash=result.recommendations.find(r=>r.method==='encodeStrokeDash');
 assert.ok(dash.alternatives.some(a=>a.args.field==='Origin'));
 const args=dash.alternatives.find(a=>a.args.field==='Origin').args;
 assert.equal(prepareGuidedAction(line,{method:dash.method,args}).recommendation.validation.topLevelActions,1);
 const colored=line.encodeColor({target:'plot',field:'Origin',fieldType:'nominal'});
 const next=recommend(colored).recommendations.find(r=>r.method==='encodeStrokeDash');
 assert.ok(next.alternatives.filter(a=>a.args.field).every(a=>a.args.field==='Origin'));
 const area=p.createAreaPlot({id:'plot',x:'Horsepower',y:'Miles_per_Gallon',guides:false});
 const color=recommend(area).recommendations.find(r=>r.method==='encodeColor');
 assert.ok(color); assert.ok(color.alternatives.every(a=>!a.args.field));
});

test('fixed encodings enter the paper primitive set and removing a later field encoding clears them',()=>{
 const raw=base().createScatterPlot({id:'plot',x:'X',y:'Y',guides:false});
 const fixed=raw.encodeOpacity({target:'plot',value:.43});
 const addition=engine.rank(fixed,{target:'plot',group:'encoding',limit:1000});
 assert.ok(addition.state.features.includes('encoding.opacity'));
 assert.ok(!addition.recommendations.some(r=>r.method==='encodeOpacity'));
 assert.ok(engine.rank(fixed,{target:'plot',group:'encoding',includeRevisions:true,limit:1000}).recommendations.some(r=>r.method==='encodeOpacity'&&r.kind==='revision'));
 const removed=fixed.encodeOpacity({target:'plot',field:'Value'}).removeEncoding({target:'plot',channel:'opacity'});
 const next=engine.rank(removed,{target:'plot',group:'encoding',limit:1000});
 assert.ok(!next.state.features.includes('encoding.opacity'));
 assert.ok(next.recommendations.some(r=>r.method==='encodeOpacity'));
});
