import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createCalculationService } from '../web/calculation-service.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { actionTitle } from '../src/action-labels.js';
import { profileDataset } from '../src/profile.js';
import { adjacentContext, adjacentSpecs } from '../web/composition-controls.js';
import { compositionRecommendations } from '../src/composition-recommendations.js';
import { inheritedCompositionShares } from '../src/composition-context.js';
import { overlayCandidates } from '../src/overlay-candidates.js';
import { initialParameters, recommendationParameters, activeControls, valuesFor } from '../web/parameters.js';
import { selectedPlotDefinitions } from '../src/selected-plots.js';
import { defaultValues } from '../src/plot-catalog.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
const model=JSON.parse(readFileSync(new URL('../data/model.json',import.meta.url)));
const initial=createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json',import.meta.url))));
const rows=Array.from({length:12},(_,i)=>({category:['A','B','C'][i%3],value:10+i,other:30+i,group:['one','two'][i%2]}));
const base=()=>chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:rows});
const bars=(scale='linear')=>base().createBarPlot({id:'plot',data:'data',x:{field:'category',fieldType:'nominal'},y:{field:'value',aggregate:'mean',scale:{type:scale}},color:{field:'group',layout:'stack'},guides:false});
function request(p,search,target='plot',childPath=[]) {
 const service=createCalculationService(model);service.execute({type:'state',stateId:1,snapshot:serializeProgram(p)});
 const recommendations=[]; let response;
 for(let page=0;page<20;page++){ response=service.execute({type:'recommend',stateId:1,group:'encoding',page,searchQuery:search,options:{...FOLLOWUP_RECOMMENDATION_OPTIONS,target,childPath,limit:500}}); recommendations.push(...response.result.recommendations); if(response.pagination.complete)break; }
 return {...response,result:{...response.result,recommendations}};
}
test('prepared overlay alternatives focus the new overlay, including a nested source',()=>{
 for(const nested of [false,true]) {
  const p=nested?bars().createAdjacentPlot({id:'neighbor',source:'plot',share:{}}):bars();
  const response=request(p,'overlay',nested?'neighbor':'plot',nested?['neighbor']:[]);
  const rec=response.result.recommendations.find(r=>r.method==='createOverlay');assert.ok(rec);
  assert.equal(rec.nextContext.target,rec.args.id);
  for(const alt of rec.alternatives)assert.equal(alt.nextContext.target,alt.args.id);
 }
});
test('shared adjacent scales inherit mapping and make incompatible choices explicit',()=>{
 for(const scale of ['sqrt','symlog']) {
  const p=bars(scale).editYScale({target:'plot',reverse:true,domain:[0,50]});
  const adding=adjacentContext(p,{target:'plot'},'right');
  const rec=adjacentSpecs(initial,adding,p).find(r=>r.build(r.values).plot.action==='createLinePlot');assert.ok(rec);
  assert.equal(rec.values.yScale,scale);
  const control=activeControls(rec.resolveControls(rec.values),rec.values).find(c=>c.key==='yScale');
  assert.ok(control.choices.find(c=>c.value==='linear').disabled);assert.match(control.choices.find(c=>c.value==='linear').reason,/Shared Y/);
  const args=rec.build(rec.values);assert.equal(args.plot.options.y.scale.type,scale);assert.equal(args.plot.options.y.scale.reverse,true);assert.deepEqual(args.plot.options.y.scale.domain,[0,50]);
  const next=prepareGuidedAction(p,{method:'createAdjacentPlot',args},p,rec.setup?.(rec.values)??[]).preview;
  assert.ok(next.children[args.id]);
 }
});
test('total overlays can switch back to source before changing source layout',()=>{
 const p=bars().createOverlay({id:'overlay',source:'plot',type:'line',series:'total'});
 const rec=overlayCandidates(p,p.semanticSpec.layers.find(l=>l.id==='overlay'))[0];
 const follow=rec.parameters.find(c=>c.path==='series');assert.deepEqual(follow.choices.map(c=>c.value),['source','total']);
 const editor=recommendationParameters({...rec,alternatives:[rec]},profileDataset(p,'data'));
 const values=valuesFor(editor.controls),key=editor.controls.find(c=>c.label==='Follow').key;
 const changed=p.editOverlay(editor.build({...values,[key]:'source'})).layoutSeries({target:'plot',mode:'group'});
 assert.equal(changed.semanticSpec.layers.find(l=>l.id==='overlay').derivedBindings.overlay.series,'source');
 const grouped=overlayCandidates(changed,changed.semanticSpec.layers.find(l=>l.id==='overlay'))[0];
 assert.equal(grouped.parameters.find(c=>c.path==='series').choices.find(c=>c.value==='total').disabled,true);
});
test('position editor retains current field while changing aggregation and scale',()=>{
 const p=bars();const response=request(p,'encodeY');const rec=response.result.recommendations.find(r=>r.method==='encodeY');assert.ok(rec);
 const editor=recommendationParameters(rec,profileDataset(p,'data'));
 const field=editor.controls.find(c=>c.key==='field');assert.ok(field.choices.some(c=>c.value==='value'));
 const values={...valuesFor(editor.controls),field:'value',aggregate:'sum',scale:'sqrt'};
 const args=editor.build(values);assert.equal(args.field,'value');assert.equal(args.aggregate,'sum');assert.equal(args.scale.type,'sqrt');
 const next=p.encodeY(args);assert.equal(next.semanticSpec.layers[0].encoding.y.field,'value');
});
test('nested policies disclose ancestors and each composition can be edited with its native target',()=>{
 const outer=bars().createAdjacentPlot({id:'neighbor',source:'plot',share:{y:true}});
 const nested=outer.createAdjacentPlot({target:{childPath:['neighbor']},id:'third',source:'neighbor',position:'top',share:{}});
 assert.deepEqual(inheritedCompositionShares(nested,['neighbor','third']).map(x=>[x.label,x.channels]),[['All charts',['y']]]);
 const recs=compositionRecommendations(nested,model,'encoding');assert.equal(recs.length,2);
 assert.ok(recs.some(r=>actionTitle(r).endsWith('All charts')));assert.ok(recs.some(r=>r.args.target?.childPath.join('/')==='neighbor'));
 const parent=recs.find(r=>!r.args.target);const released=nested.editCompositionScales(parent.args);
 assert.equal(Boolean(released.compositionSpec.share.y),false);assert.equal(released.children.neighbor.compositionSpec.share.y,undefined);
 const child=recs.find(r=>r.args.target);assert.doesNotThrow(()=>released.editCompositionScales(child.args));
 const adding=adjacentContext(nested,{target:'third',childPath:['neighbor','third']},'right');adding.share='none';
 assert.equal(adding.inheritedSharing[0].label,'All charts');assert.deepEqual(adding.inheritedSharing[0].channels,['y']);
});
test('rug edge and scale edit one changing physical axis, preserving scale values',()=>{
 const p=base(),profile=profileDataset(p,'data');const rec=selectedPlotDefinitions(profile,{x:'value'},rows,[],{availableProfile:profile}).find(r=>r.method==='createRugPlot');
 const editor=initialParameters(rec);
 for(const edge of ['bottom','top','left','right'])for(const scale of ['linear','log']) {
  const v={...defaultValues(rec),edge,xScale:scale};const args=editor.build(v),axis=['left','right'].includes(edge)?'y':'x';
  assert.equal(args[axis].field,'value');assert.equal(args[axis].scale.type,scale);assert.equal(args[axis==='x'?'y':'x'],undefined);
  assert.equal(activeControls(editor.resolveControls(v),v).find(c=>c.key==='xScale').label,`${axis.toUpperCase()} scale`);
  assert.doesNotThrow(()=>p.createRugPlot(args));
 }
});
test('Horizon calendar parameters explain and avoid intervals that collapse all dates to one point',()=>{
 const data=Array.from({length:12},(_,i)=>({date:`2019-${String(i+1).padStart(2,'0')}-01`,value:i-4}));
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:data}),profile=profileDataset(p,'data');
 const rec=selectedPlotDefinitions(profile,{x:'date',y:'value'},data,[],{availableProfile:profile}).find(r=>r.method==='createHorizonPlot'),editor=initialParameters(rec);
 const calendar=activeControls(editor.resolveControls(defaultValues(rec)),defaultValues(rec)).find(c=>c.key==='timeUnit');
 assert.equal(calendar.choices.find(c=>c.value==='year').disabled,true);assert.match(calendar.choices.find(c=>c.value==='year').reason,/at least two dates/);
 assert.ok(!calendar.choices.find(c=>c.value==='quarter').disabled);
 const v={...defaultValues(rec),timeUnit:'year'},normalized=editor.normalizeValues(v);assert.equal(normalized.timeUnit,'raw');
 assert.doesNotThrow(()=>prepareGuidedAction(p,{method:rec.method,args:editor.build(v)},p,editor.setup(v)));
});
