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
      assert.equal(prepared.authoringPreview.trace.children.at(-1).op, method);
      const next = recommend(prepared.authoringPreview);
      assert.ok(next.recommendations.some(r => r.method === method && r.previouslyApplied), 'applied channels remain available at the back');
    }
  }
  assert.ok(!result.recommendations.some(r => ['encodeSize', 'encodeShape'].includes(r.method)));
  assert.ok(result.recommendations.filter(r => ['encodeColor', 'encodeX', 'encodeY'].includes(r.method) && r.category === 'encoding')
    .every(r => r.previouslyApplied));
  assert.ok(result.recommendations.some(r => r.method === 'removeEncoding'));
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

test('facet stays in Encoding and supports real source actions, guide edits, layout and worker round trips', async () => {
  const { createCalculationService } = await import('../web/calculation-service.js');
  const { serializeProgram, deserializeProgram } = await import('ggaction/persistence');
  const { renderToSVG } = await import('ggaction/svg');
  const raw = base().createScatterPlot({id:'plot',x:'X',y:'Y',guides:false}), view=addDefaultGuides(raw);
  const result = recommend(raw);
  for(const method of ['facet','facetGrid']) {
    const rec=result.recommendations.find(r=>r.method===method);
    assert.ok(rec,method); assert.equal(rec.category,'encoding');
    const editor=recommendationParameters(rec,profileDataset(view,'data'));
    const start=prepareGuidedAction(raw,{method,args:editor.build(valuesFor(editor.controls))},view);
    assert.ok(Object.keys(start.preview.children).length>1);
    assert.equal(start.preview.trace.children.at(-1).op,'createGuides');
    const next=engine.recommend(start.preview,{target:'plot',...FOLLOWUP_RECOMMENDATION_OPTIONS,authoringProgram:start.authoringPreview});
    assert.ok(next.recommendations.some(r=>r.method==='editFacetScales'));
    for(const sourceMethod of ['encodeOpacity','createMarkLabels','editXAxisLabels','createStatisticalReference']) {
      const sourceRec=next.recommendations.find(r=>r.sourceMethod===sourceMethod);
      assert.ok(sourceRec,sourceMethod);
      assert.equal(sourceRec.method,'editFacetSource');
      const sourceEditor=recommendationParameters(sourceRec,profileDataset(start.preview,next.state.data));
      const action={method:sourceRec.method,args:sourceEditor.build(valuesFor(sourceEditor.controls))};
      const prepared=prepareGuidedAction(start.authoringPreview,action,start.preview);
      assert.equal(prepared.recommendation.validation.topLevelActions,1);
      assert.equal(prepared.authoringPreview.trace.children.at(-1).op,'editFacetSource');
      const service=createCalculationService(model);
      service.execute({type:'state',stateId:1,snapshot:serializeProgram(start.authoringPreview),guideCall:start.guideCall});
      const remote=service.execute({type:'materialize',stateId:1,action});
      assert.deepEqual(deserializeProgram(remote.snapshot).graphicSpec,prepared.authoringPreview.graphicSpec);
      assert.ok(renderToSVG(prepared.preview).startsWith('<svg'));
    }
    const titled=prepareGuidedAction(start.authoringPreview,{method:'createTitle',args:{text:'Facets'}},start.preview);
    assert.equal(titled.preview.semanticSpec.title.text,'Facets');
  }
});

test('binned heatmaps retain facet candidates with semantically coherent shared or independent color guides', async () => {
  const { createCalculationService } = await import('../web/calculation-service.js');
  const { serializeProgram } = await import('ggaction/persistence');
  const cars = JSON.parse(readFileSync(new URL('../web/data/cars.json',import.meta.url))).filter(r=>r.Horsepower!=null&&r.Miles_per_Gallon!=null);
  const raw=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:cars})
    .createHeatmap({id:'plot',x:{field:'Horsepower',fieldType:'quantitative'},y:{field:'Miles_per_Gallon',fieldType:'quantitative'},bin:{bins:8},color:{palette:'blues'},guides:false});
  const service=createCalculationService(model);
  service.execute({type:'state',stateId:1,snapshot:serializeProgram(raw),guideCall:{method:'createGuides',args:{}}});
  let response;
  for(let page=0;page<3;page++) {
    response=service.execute({type:'recommend',stateId:1,group:'encoding',page,options:{target:'plot',...FOLLOWUP_RECOMMENDATION_OPTIONS}});
    if(response.pagination.complete)break;
  }
  const rec=response.result.recommendations.find(r=>r.method==='facet');
  assert.ok(rec,'valid per-panel guides must rescue a facet card');
  assert.equal(rec.args.field,'Origin');
  assert.equal(rec.args.data,'data');
  const faceted = prepareGuidedAction(raw, { method: rec.method, args: rec.args }).preview;
  if (rec.args.scales?.color === 'independent') assert.equal(rec.args.guides.legend, false);
  else {
    assert.equal(rec.args.guides.legend, 'shared');
    const domains = Object.values(faceted.children).map(child => {
      const layer = child.semanticSpec.layers.find(layer => layer.encoding?.color?.scale);
      return child.resolvedScales[layer.encoding.color.scale].domain;
    });
    assert.ok(domains.length > 1);
    assert.ok(domains.every(domain => JSON.stringify(domain) === JSON.stringify(domains[0])), 'a shared color legend uses the same domain in every panel');
  }
  assert.ok(renderToSVG(faceted).startsWith('<svg'));
  assert.ok(response.result.recommendations.some(r=>r.method==='encodeStrokeWidth'));
  assert.ok(response.result.recommendations.some(r=>r.method==='encodeOpacity'));
});

test('facet fields resolve to valid upstream owners when a folded chart repeats their names', async () => {
 const {cars}=await import('../examples/scenarios.js');
 const {getPlotDefinitions,defaultValues}=await import('../src/plot-catalog.js');
 const {facetCandidates}=await import('../src/facet-candidates.js');
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:cars});
 const spec=getPlotDefinitions(profileDataset(p,'data')).find(d=>d.method==='createRadarPlot');
 const start=prepareGuidedAction(p,{method:spec.method,args:spec.build(defaultValues(spec))});
 const layer=start.preview.semanticSpec.layers.find(l=>l.id==='plot');
 const candidates=facetCandidates(start.preview,{layer,profile:profileDataset(start.preview,layer.data)});
 const rec=candidates.find(r=>r.method==='facet'&&r.args.field==='Origin');
 assert.ok(rec); assert.equal(rec.args.data,'data');
 assert.equal(prepareGuidedAction(start.authoringPreview,rec,start.preview).recommendation.validation.topLevelActions,1);
});

test('neighboring source parameters stay inside the one public facet-source call',async()=>{
 const {neighboringParameters}=await import('../src/engine.js');
 const variants=neighboringParameters({method:'editFacetSource',args:{action:{method:'editXAxisLabels',options:{fontSize:11}}},
  parameters:[{path:'fontSize',type:'number',value:11,step:1,min:8,max:18}]});
 assert.deepEqual(variants.map(v=>v.args.action.options.fontSize),[12,10]);
 assert.ok(variants.every(v=>Object.keys(v.args).length===1&&v.method==='editFacetSource'));
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
  assert.equal(rec.args.value,method==='encodeColor'?'#e45756':3);
  assert.equal(prepareGuidedAction(start.authoringPreview,rec,start.preview).recommendation.validation.topLevelActions,1);
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

test('facet source edits keep their original design primitive in paper-model features',()=>{
 const raw=base().createScatterPlot({id:'plot',x:'X',y:'Y',guides:false});
 const start=prepareGuidedAction(raw,{method:'facet',args:{field:'Series',columns:2,guides:{axes:'outer',legend:false}}},addDefaultGuides(raw));
 const next=prepareGuidedAction(start.authoringPreview,{method:'editFacetSource',args:{action:{method:'editXAxisLabels',options:{fontSize:10}}}},start.preview);
 const features=engine.rank(next.preview,{target:'plot',group:'style'}).state.features;
 assert.ok(features.includes('action.editXAxisLabels'));
 assert.ok(!features.includes('action.editFacetSource'));
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
