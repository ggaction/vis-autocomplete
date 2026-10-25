import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chart,hconcat} from 'ggaction';
import {serializeProgram} from 'ggaction/persistence';
import {createInitialChartRecommender} from '../src/initial-recommender.js';
import {prepareGuidedAction,defaultCanvasOptions,addDefaultGuides} from '../src/prepare.js';
import {adjacentContext,adjacentSpecs,overlayContext} from '../web/composition-controls.js';
import {scopeRecommendationCall,editableChartTargets,resolveEditingContext} from '../src/composition-context.js';
import {facetCandidates} from '../src/facet-candidates.js';
import {profileDataset} from '../src/profile.js';
import {createCalculationService} from '../web/calculation-service.js';
import {recommendationParameters,buildRecommendationCall,valuesFor} from '../web/parameters.js';
const engine=createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json',import.meta.url))));
const rows=Array.from({length:30},(_,i)=>({category:['A','B','C'][i%3],value:i+2,other:i/2+1,series:i%2?'one':'two'}));
const base=()=>chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:rows});
const bar=()=>base().createBarPlot({id:'plot',x:{field:'category',fieldType:'nominal'},y:{field:'value',aggregate:'sum'},guides:false});
function replay(p,prepared){for(const call of [...prepared.prerequisiteCalls,prepared.recommendation,...prepared.postActionCalls])p=p[call.method](call.args);return p;}

test('adjacent card offers independent axes and releases inherited sharing through a visible native prerequisite',()=>{
 const p=bar().createAdjacentPlot({id:'neighbor',source:'plot',share:{y:true}});
 const adding=adjacentContext(p,{target:'neighbor',childPath:['neighbor']},'right');
 const card=adjacentSpecs(engine,adding,p).find(c=>c.title==='Add Scatter plot'); assert.ok(card);
 assert.ok(!card.requirement,'invalid starting combinations must remain editable');
 const group=card.resolveControls(card.values).find(c=>c.label==='Shared scales');assert.equal(group.controls.length,3);
 const values={...card.values,share_y:'independent',share_color:'independent'};
 const setup=card.setup(values); assert.ok(setup.some(c=>c.method==='editCompositionScales'&&c.args.share.y===false&&!c.args.target));
 const prepared=prepareGuidedAction(p,{method:card.method,args:card.build(values)},p,setup);
 assert.equal(prepared.authoringPreview.compositionSpec.share.y,false);
 assert.ok(prepared.authoringPreview.children.neighbor.children.chart2||prepared.authoringPreview.children.neighbor.children.chart3);
 assert.deepEqual(serializeProgram(replay(p,prepared)),serializeProgram(prepared.authoringPreview));
});

test('Color=None in adjacent summary cards suppresses source inheritance explicitly',()=>{
 const p=base().createScatterPlot({id:'plot',x:{field:'category',fieldType:'nominal'},y:'value',color:'series',guides:false});
 const card=adjacentSpecs(engine,adjacentContext(p,{target:'plot'},'right'),p).find(c=>c.title==='Add Box plot');assert.ok(card);
 const values=card.normalizeValues({...card.values,mapping_color:''},'mapping_color');
 const args=card.build(values);assert.deepEqual(args.plot.inherit,{color:false});assert.equal(args.plot.options.color,undefined);
 const result=prepareGuidedAction(p,{method:card.method,args},p,card.setup(values)).authoringPreview;
 assert.ok(result.children[args.id].semanticSpec.layers.every(l=>!l.encoding.color));
});

test('mixed facet and ordinary All appearance is one public action and replayable',()=>{
 const point=()=>base().createScatterPlot({id:'plot',x:'value',y:'other',guides:false});
 const p=hconcat({programs:[{id:'facet',program:point().facet({field:'series',guides:{legend:false}})},{id:'plain',program:point()}]});
 const call=scopeRecommendationCall({method:'editFacetSource',args:{action:{method:'encodeOpacity',options:{target:'plot',value:.4}}}},
   {all:true,anchor:'plot',targets:editableChartTargets(p)});
 assert.equal(call.method,'encodeOpacity');assert.equal(call.args.target[0].facetSource,true);
 const prepared=prepareGuidedAction(p,call);
 assert.equal(prepared.authoringPreview.children.plain.markConfigs.plot.opacity,.4);
 for(const child of Object.values(prepared.authoringPreview.children.facet.children))assert.equal(child.markConfigs.plot.opacity,.4);
 assert.deepEqual(serializeProgram(replay(p,prepared)),serializeProgram(prepared.authoringPreview));
});

test('Violin offers independent layers without misleading Follow results cards',()=>{
 const p=base().createViolinPlot({id:'plot',x:{field:'category',fieldType:'nominal'},y:'value',guides:false});
 const context=overlayContext(p,{target:'plot'}); assert.ok(context);assert.equal(context.mode,'layer');assert.deepEqual(context.candidates,[]);
});

test('facets without a legend explain disabled shared legend choices while keeping axis edits',()=>{
 const p=bar().facet({field:'series',guides:{legend:false}}),layer=p.semanticSpec.layers[0];
 const card=facetCandidates(p,{layer,profile:profileDataset(p,'data')}).find(c=>c.method==='editFacetGuides');assert.ok(card);
 const legend=card.parameters.find(c=>c.path==='legend');assert.ok(legend.choices.filter(c=>c.value!==false).every(c=>c.disabled&&c.reason));
 assert.doesNotThrow(()=>p.editFacetGuides(card.args));
});

test('All also routes target-free source guide actions through the facet source',()=>{
 const point=()=>base().createScatterPlot({id:'plot',x:'value',y:'other'});
 const p=hconcat({programs:[{id:'facet',program:point().facet({field:'series',guides:{legend:false}})},{id:'plain',program:point()}]});
 const call=scopeRecommendationCall({method:'editGrid',args:{horizontal:{color:'#ff0000'}}},{all:true,anchor:'plot',targets:editableChartTargets(p)});
 assert.equal(call.args.target[0].facetSource,true);
 const prepared=prepareGuidedAction(p,call);
 assert.equal(prepared.authoringPreview.children.plain.guideConfigs.grid.horizontal.color,'#ff0000');
 for(const child of Object.values(prepared.authoringPreview.children.facet.children))assert.equal(child.guideConfigs.grid.horizontal.color,'#ff0000');
});


test('adjacent creation preserves a displayed-only categorical legend with explicit replayable guide setup',()=>{
 const p=base().createScatterPlot({id:'plot',x:'value',y:'other',color:{field:'series',fieldType:'nominal',scale:{palette:'tableau10'}}});
 assert.equal(p.guideConfigs.legend?.color,undefined);
 const view=addDefaultGuides(p); assert.ok(view.guideConfigs.legend.color);
 const card=adjacentSpecs(engine,adjacentContext(p,{target:'plot'},'right'),p).find(c=>c.title==='Add Scatter plot');
 const action={method:card.method,args:card.build(card.values)};
 const result=prepareGuidedAction(p,action,view,card.setup(card.values));
 assert.ok(result.prerequisiteCalls.some(call=>call.method==='createGuides'&&call.args.legend.channels.includes('color')));
 assert.ok(result.authoringPreview.children.plot.guideConfigs.legend.color);
 assert.ok(result.authoringPreview.children[action.args.id].guideConfigs.legend.color);
 assert.equal(Object.keys(result.preview.graphicSpec.objects).filter(id=>id.endsWith('-shared-color-legend')).length,1);
 assert.deepEqual(serializeProgram(replay(p,result)),serializeProgram(result.authoringPreview));
 const released=result.authoringPreview.editCompositionScales({share:{color:false}});
 assert.ok(released.children.plot.guideConfigs.legend.color);
 assert.ok(released.children[action.args.id].guideConfigs.legend.color);
});


test('explicit shared color rejects a mismatched mapping and remains recoverable through Independent',()=>{
 const p=base().createScatterPlot({id:'plot',x:'value',y:'other',color:{field:'series',fieldType:'nominal',scale:{palette:'tableau10'}}});
 const card=adjacentSpecs(engine,adjacentContext(p,{target:'plot'},'right'),p).find(c=>c.title==='Add Scatter plot');
 const none=card.normalizeValues({...card.values,mapping_color:'',share_color:'shared'},'mapping_color');
 assert.throws(()=>card.build(none),/Shared color requires every layer to use the same field and palette/);
 assert.equal(card.build({...none,share_color:'independent'}).share.color,undefined);
 assert.equal(card.build({...card.values,share_color:'shared'}).share.color,true);
});


test('mixed facet All cards preserve the native parameter builder through worker-to-UI hydration',()=>{
 const point=()=>base().createScatterPlot({id:'plot',x:'value',y:'other'});
 const p=hconcat({programs:[{id:'facet',program:point().facet({field:'series',guides:{legend:false}})},{id:'plain',program:point()}]});
 const model=JSON.parse(readFileSync(new URL('../data/model.json',import.meta.url)));
 const service=createCalculationService(model);
 service.execute({type:'state',stateId:1,snapshot:serializeProgram(p),guideCall:{method:'createGuides',args:{target:[{childPath:['facet']},{childPath:['plain']}]}}});
 const response=service.execute({type:'recommend',stateId:1,options:{scope:'all',target:'plot',limit:500},group:'encoding',searchQuery:'opacity'});
 const rec=response.result.recommendations.find(r=>r.method==='encodeOpacity');
 assert.ok(rec,JSON.stringify(response.result.diagnostics));
 assert.equal(rec.localRecommendation.method,'editFacetSource');
 const editor={...recommendationParameters(rec,profileDataset(p.children.facet,'data')),method:rec.method};
 const call=buildRecommendationCall(editor,valuesFor(editor.controls));
 assert.equal(call.method,'encodeOpacity');assert.equal(call.args.action,undefined);
 assert.equal(call.args.target[0].facetSource,true);
 const result=service.execute({type:'prepare',stateId:1,action:call});
 assert.equal(result.recommendation.validation.topLevelActions,1);
});

test('automatic adjacent color sharing considers every independent measure inside a faceted layered view',()=>{
 const p=base().createScatterPlot({id:'plot',x:'value',y:'other',color:'series',guides:false})
  .createLayerPlot({id:'density',source:'plot',plot:{action:'createHeatmap'}})
  .facet({field:'category',guides:{legend:false}});
 const adding=adjacentContext(p,{target:'plot'},'right');
 assert.equal(adding.colorSharingCompatible,false);
 const card=adjacentSpecs(engine,adding,p).find(c=>c.title==='Add Scatter plot');assert.ok(card);
 const args=card.build(card.values);assert.equal(args.share.color,undefined);
 assert.doesNotThrow(()=>prepareGuidedAction(p,{method:card.method,args},p,card.setup(card.values)));
 assert.throws(()=>card.build({...card.values,share_color:'shared'}),/every layer.*same field/);
});

test('quantitative adjacent Auto color matches simple named palettes without conflating variants or summary populations',()=>{
 const make=(palette,summary=false)=>{
  let p=base();
  if(summary)p=p.createSummaryData({id:'summary',source:'data',groupBy:['category','series'],aggregates:[{field:'value',op:'sum',as:'value'},{field:'other',op:'mean',as:'other'}]});
  return p.createScatterPlot({id:'plot',data:summary?'summary':'data',x:'value',y:'other',color:{field:'value',fieldType:'quantitative',scale:{palette}},guides:false});
 };
 const editor=p=>adjacentSpecs(engine,adjacentContext(p,{target:'plot'},'right'),p).find(c=>c.title==='Add Scatter plot');
 const p=make('viridis'),card=editor(p);
 assert.equal(card.values.palette,'viridis');
 assert.equal(card.build(card.values).share.color,true);
 assert.equal(card.build({...card.values,palette:'magma'}).share.color,undefined);
 assert.throws(()=>card.build({...card.values,palette:'magma',share_color:'shared'}),/same field and palette/);
 assert.doesNotThrow(()=>prepareGuidedAction(p,{method:card.method,args:card.build(card.values)},p,card.setup(card.values)));
 const reversed=editor(make({name:'viridis',extent:[1,0]}));
 assert.equal(reversed.build({...reversed.values,palette:'viridis'}).share.color,undefined);
 const summarized=editor(make('viridis',true));
 assert.equal(summarized.values.palette,'viridis');
 assert.equal(summarized.build({...summarized.values,share_x:'independent',share_y:'independent'}).share.color,undefined,
  'raw color observations do not inherit an aggregate population automatically');
});

test('All field controls use the common bound data of every owner and keep fixed appearance available',()=>{
 const point=()=>base().createScatterPlot({id:'plot',x:'value',y:'other',guides:false});
 const facet=point().createLayerPlot({id:'heatmap',source:'plot',plot:{action:'createHeatmap'}}).facet({field:'category',guides:{legend:false}});
 const p=hconcat({programs:[{id:'facet',program:facet},{id:'plain',program:point()}]});
 const service=createCalculationService(JSON.parse(readFileSync(new URL('../data/model.json',import.meta.url))));
 service.execute({type:'state',stateId:1,snapshot:serializeProgram(p)});
 const response=service.execute({type:'recommend',stateId:1,options:{scope:'all',target:'plot',limit:500},group:'encoding',searchQuery:'opacity'});
 const rec=response.result.recommendations.find(r=>r.method==='encodeOpacity');assert.ok(rec,JSON.stringify(response.result.diagnostics));
 const editor=recommendationParameters(rec,profileDataset(facet,'data'));
 const controls=editor.resolveControls(editor.values);
 const variable=controls.find(c=>c.key==='mode').choices.find(c=>c.value==='variable');
 assert.equal(variable.disabled,true);assert.match(variable.reason,/every target/);
 assert.ok(controls.find(c=>c.key==='field').choices.every(c=>c.disabled));
 const values=editor.normalizeValues({...editor.values,mode:'variable',field:'value'});
 assert.equal(values.mode,'fixed');
 const call=buildRecommendationCall(editor,{...values,value:.45});
 const result=service.execute({type:'prepare',stateId:1,action:call});assert.equal(result.recommendation.validation.topLevelActions,1);
});


test('All bound-field eligibility retains shared nullable columns for native missing policies',()=>{
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:[{x:1,y:2},{x:null,y:3},{x:4,y:5}]})
  .createScatterPlot({id:'plot',x:'x',y:'y',missing:'skip',guides:false});
 const pair=hconcat({programs:[{id:'a',program:p},{id:'b',program:p}]});
 const scope=resolveEditingContext(pair,{scope:'all',target:'plot'}).scope;
 assert.ok(scope.fields.includes('x'));assert.ok(scope.fields.includes('y'));
});
