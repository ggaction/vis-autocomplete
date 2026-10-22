import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { profileDataset } from '../src/profile.js';
import { positionCandidates, ownedPositionCandidates, positionOwner } from '../src/position-candidates.js';
import { primaryChartLayer } from '../src/chart-owner.js';
import { selectedPlotDefinitions } from '../src/selected-plots.js';
import { recommendationParameters, initialParameters, valuesFor, activeControls } from '../web/parameters.js';
import { defaultCanvasOptions } from '../src/prepare.js';
import { generateCandidates } from '../src/catalog.js';
import { selectionData } from '../web/selection-setup.js';
const rows=['A','B'].flatMap((g,j)=>Array.from({length:8},(_,i)=>({g,h:i%2?'Odd':'Even',x:i+1,y:(i+1)*(j+1)+2,z:i+4,w:1,id:`${g}${i}`})));
const base=()=>chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:rows});
const ctx=p=>{const layer=primaryChartLayer(p);return {layer,profile:profileDataset(p,layer.data)}};
const candidates=p=>ownedPositionCandidates(p,ctx(p));
const edit=(p,method,category='encoding')=>{const rec=candidates(p).find(c=>c.method===method&&c.category===category);assert.ok(rec,method);return recommendationParameters({...rec,skipParameterDefaults:true},ctx(p).profile)};
const change=(editor,values,label,value)=>({...values,[editor.controls.find(c=>c.label===label).key]:value});

test('Raincloud source variable edit updates the whole owning chart and keeps owner focus',()=>{
 const p=base().createRaincloudPlot({id:'plot',category:'g',value:'y',color:'g',guides:false});
 for (const id of ['plotCloud','plotSummary','plotPoints']) assert.equal(primaryChartLayer(p,id).id,'plotCloud');
 const editor=edit(p,'editRaincloudPlot');const values=change(editor,valuesFor(editor.controls),'Measure','z');
 const next=p.editRaincloudPlot(editor.build(values));
 assert.equal(next.markConfigs.plotCloud.raincloudPlot.value.field,'z');
 assert.equal(next.markConfigs.plotCloud.violinPlot.value,'z');
 assert.equal(next.markConfigs.plotSummary.boxPlot.measure,'z');
 assert.equal(next.semanticSpec.layers.find(l=>l.id==='plotPoints').encoding.y.field,'z');
 assert.match(renderToSVG(next),/<svg/);
 const grouped=change(editor,values,'Category','h');
 assert.equal(editor.build(grouped).color.field,'h');
 assert.match(renderToSVG(p.editRaincloudPlot(editor.build(grouped))),/<svg/);
});

test('Split violin cannot rebind category to its split field',()=>{
 const p=base().createViolinPlot({id:'plot',x:{field:'g',fieldType:'nominal'},y:'y',split:{field:'h'},color:'h',guides:false});
 const editor=edit(p,'editViolinPlot');assert.ok(!editor.controls.find(c=>c.label==='Category').choices.some(c=>c.value==='h'));
});

test('Density owners have executable bandwidth, kernel, normalization and side controls',()=>{
 for(const [method,args,editorMethod] of [['createDensityPlot',{field:'y',groupBy:'g'},'editDensity'],['createViolinPlot',{x:{field:'g',fieldType:'nominal'},y:'y'},'editViolinPlot'],['createRaincloudPlot',{category:'g',value:'y'},'editRaincloudPlot']]){
  const p=base()[method]({id:'plot',...args,guides:false}),editor=edit(p,editorMethod,'transform');let values=valuesFor(editor.controls);
  for(const control of editor.controls){const probes=control.type==='number'?[control.min,control.max]:control.choices.map(c=>c.value);for(const value of probes)assert.doesNotThrow(()=>renderToSVG(p[editorMethod](editor.build({...values,[control.key]:value}))),`${method}/${control.label}/${value}`)}
 }
});

test('Horizon uses owned bands, baseline, and palettes instead of derived coordinate fields',()=>{
 const p=base().createHorizonPlot({id:'plot',x:'x',y:'y',groupBy:'g',guides:false});
 assert.equal(positionOwner(p,ctx(p).layer).method,'editHorizon');assert.deepEqual(positionCandidates(p,ctx(p)),[]);
 for(const group of ['transform','encoding']){const editor=edit(p,'editHorizon',group);assert.ok(editor.controls.length>=2);assert.match(renderToSVG(p.editHorizon(editor.build(valuesFor(editor.controls)))),/<svg/)}
 const editor=edit(p,'editHorizon','transform'),extent=editor.controls.find(c=>c.path==='extent');
 assert.equal(editor.controls.length,4);
 for(const choice of extent.choices)assert.match(renderToSVG(p.editHorizon(editor.build({...valuesFor(editor.controls),[extent.key]:choice.value}))),/<svg/);
});

test('Regression reveals model-specific native controls and at most four groups',()=>{
 const p=base().createRegressionPlot({id:'plot',x:'x',y:'y',color:'g',groupBy:'g',guides:false});
 const editor=edit(p,'editRegression','transform');let values=valuesFor(editor.controls);
 for(const model of ['linear','polynomial','loess','exp']){
  const v=change(editor,values,'Model',model);assert.ok(activeControls(editor.controls,v).length<=4);
  const args=editor.build(v);if(model==='loess'){assert.ok(args.span);assert.equal(args.degree,undefined);assert.equal(args.interval,undefined)}
  assert.match(renderToSVG(p.editRegression(args)),/<svg/);
 }
});

test('Endpoint summary and lollipop baseline use owning editEndpointPlot',()=>{
 for(const [method,args] of [['createDumbbellPlot',{start:'y',end:'z'}],['createLollipopPlot',{value:'y'}]]){
  const p=base()[method]({id:'plot',category:'g',...args,summary:'mean',guides:false}),editor=edit(p,'editEndpointPlot','transform');
  const values=change(editor,valuesFor(editor.controls),'Aggregation','max');
  if(method==='createLollipopPlot')assert.ok(editor.controls.some(c=>c.label==='Baseline'));
  assert.match(renderToSVG(p.editEndpointPlot(editor.build(values))),/<svg/);
 }
});

test('ECDF source grouping and weights remain available and update together',()=>{
 const p=base().createECDFPlot({id:'plot',field:'y',groupBy:'g',color:'g',guides:false}),editor=edit(p,'editECDFPlot');
 let values=valuesFor(editor.controls);values=change(editor,values,'Group by','h');values=change(editor,values,'Weight','w');
 const args=editor.build(values),next=p.editECDFPlot(args);assert.equal(args.groupBy,'h');assert.equal(args.weight,'w');assert.equal(args.color.field,'h');assert.match(renderToSVG(next),/<svg/);
 values=change(editor,values,'Group by',false);assert.equal(editor.build(values).color,false);assert.match(renderToSVG(p.editECDFPlot(editor.build(values))),/<svg/);
 values=change(editor,values,'Variable','w');
 values=editor.normalizeValues(values,editor.controls.find(c=>c.label==='Variable').key);
 assert.equal(editor.build(values).weight,false);
 assert.ok(editor.resolveControls(values).find(c=>c.label==='Weight').choices.find(c=>c.value==='w').disabled);
});

test('Initial controls cover aggregation, zero jitter, radar color/names, ECDF group/weight and interval roles',()=>{
 const profile=profileDataset(base(),'data');
 const defs=selection=>selectedPlotDefinitions(profile,selection,rows,[],{availableProfile:profile});
 const strip=defs({x:'g',y:'y'}).find(d=>d.method==='createStripPlot');assert.equal(strip.build({jitter:0}).jitter,false);
 const radar=defs({x:'x',y:'y',color:'g'}).find(d=>d.method==='createRadarPlot');assert.ok(radar);const radarArgs=radar.build(valuesFor(radar.controls));assert.equal(radarArgs.color.field,'g');assert.match(renderToSVG(base().createRadarPlot(radarArgs)),/<svg/);
 const ecdf=defs({x:'y'}).find(d=>d.method==='createECDFPlot');assert.ok(ecdf.controls.some(c=>c.key==='group'));assert.ok(ecdf.controls.some(c=>c.key==='weight'));assert.ok(!ecdf.controls.find(c=>c.key==='weight').choices.some(c=>c.value==='y'));
 const reg=initialParameters(defs({x:'x',y:'y',color:'g'}).find(d=>d.method==='createRegressionPlot'));
 for(const method of ['linear','polynomial','loess']){const v={...valuesFor(reg.controls),method};assert.ok(activeControls(reg.controls,v).filter(c=>c.section!=='scales').length<=4);assert.match(renderToSVG(base().createRegressionPlot(reg.build(v))),/<svg/)}
});

test('Parallel dimension changes update native scale choices and domain independently',()=>{
 const data=rows.map((r,i)=>({...r,negative:r.y-12}));
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:data})
  .createParallelCoordinates({id:'plot',dimensions:['x','y','negative'],color:'g'});
 const variants=candidates(p).filter(c=>c.method==='editParallelScale');
 const editor=recommendationParameters({...variants[0],alternatives:variants,skipParameterDefaults:true},ctx(p).profile);
 let values=change(editor,valuesFor(editor.controls),'Dimension','y');
 values=editor.normalizeValues(values,editor.controls.find(c=>c.label==='Dimension').key);
 values=change(editor,values,'Scale','log');
 const next=p.editParallelScale(editor.build(values));
 const dimensions=next.semanticSpec.layers.find(l=>l.id==='plot').encoding.parallel.dimensions;
 assert.equal(next.semanticSpec.scales.find(s=>s.id===dimensions.find(d=>d.field==='y').scale).type,'log');
 assert.equal(next.semanticSpec.scales.find(s=>s.id===dimensions.find(d=>d.field==='x').scale).type,'linear');
 assert.match(renderToSVG(next),/<svg/);
 values=change(editor,values,'Dimension','negative');
 values=editor.normalizeValues(values,editor.controls.find(c=>c.label==='Dimension').key);
 assert.equal(editor.build(values).type,'linear');
 assert.ok(editor.resolveControls(values).find(c=>c.label==='Scale').choices.find(c=>c.value==='log').disabled);
 assert.match(renderToSVG(p.editParallelScale(editor.build(values))),/<svg/);
});

test('Radar dimensions use the approved owner editor and keep categorical color',()=>{
 const p=base().createRadarPlot({id:'plot',wide:{fields:['x','y','z']},groupBy:'id',color:'g'});
 const editor=edit(p,'editRadarPlot'),values=valuesFor(editor.controls);
 assert.deepEqual(positionCandidates(p,ctx(p)),[]);
 values[editor.controls[0].key]=['z','y'];
 const next=p.editRadarPlot(editor.build(values));
 assert.deepEqual(next.semanticSpec.datasets.find(d=>d.id===next.semanticSpec.layers.find(l=>l.id==='plot').data).transform[0].fields,['z','y']);
 assert.equal(next.semanticSpec.layers.find(l=>l.id==='plot').encoding.color.field,'g');
 assert.match(renderToSVG(next),/<svg/);
});

test('Initial Box and Gradient constructors retain the selected category color',()=>{
 const profile=profileDataset(base(),'data');
 for(const method of ['createBoxPlot','createGradientPlot']){
  const definition=selectedPlotDefinitions(profile,{x:'g',y:'y',color:'g'},rows,[],{availableProfile:profile}).find(d=>d.method===method);
  assert.ok(definition,method);
  const args=definition.build(valuesFor(definition.controls));assert.equal(args.color.field,'g');
  const next=base()[method](args);assert.equal(next.semanticSpec.layers.find(l=>l.id==='plot').encoding.color.field,'g');
  assert.match(renderToSVG(next),/<svg/);
 }
});

test('Initial interval bounds exclude the center and normalize overlapping bound choices',()=>{
 const data=[{title:'A',pointEstimate:3,lower:1,upper:4},{title:'B',pointEstimate:4,lower:2,upper:5}];
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:data}),profile=profileDataset(p,'data');
 const editor=initialParameters(selectedPlotDefinitions(profile,{x:'title',y:'pointEstimate'},data,[],{availableProfile:profile}).find(d=>d.method==='createIntervalPlot'));
 assert.ok(activeControls(editor.controls,valuesFor(editor.controls)).filter(c=>['lower','upper'].includes(c.key)).every(c=>!c.choices.some(choice=>choice.value==='pointEstimate')));
 const values=editor.normalizeValues({...valuesFor(editor.controls),lower:'upper'},'lower');
 assert.notEqual(values.lower,values.upper);
 assert.ok(editor.resolveControls(values).find(c=>c.key==='upper').choices.find(c=>c.value===values.lower).disabled);
 // The reciprocal role can be selected, but the impossible same-field pair
 // can never reach the native constructor.
 assert.notEqual(editor.build(values).y.lower,editor.build(values).y.upper);
});

test('Initial polynomial degree is constrained by the selected regression fit',()=>{
 const data=[{g:'A',x:1,y:2},{g:'A',x:2,y:3},{g:'B',x:3,y:4},{g:'B',x:4,y:5}];
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:data}),profile=profileDataset(p,'data');
 const editor=initialParameters(selectedPlotDefinitions(profile,{x:'x',y:'y',color:'g'},data,[],{availableProfile:profile}).find(d=>d.method==='createRegressionPlot'));
 const input={...valuesFor(editor.controls),method:'polynomial',fit:'group',degree:6};
 const values=editor.normalizeValues(input);assert.equal(values.degree,1);
 assert.match(renderToSVG(p.createRegressionPlot(editor.build(values))),/<svg/);
 assert.equal(editor.resolveControls({...values,fit:'all'}).find(c=>c.key==='degree').max,3);
 const exponential=editor.build({...input,method:'exp',interval:'prediction'});
 assert.equal(exponential.interval,undefined);
 assert.match(renderToSVG(p.createRegressionPlot(exponential)),/<svg/);
});

test('Source filter threshold ranges preserve each regression fit and switch with comparison direction',()=>{
 const p=base().filterData({id:'selected',source:'data',field:'x',noneOf:[null],nulls:'exclude'})
  .createRegressionPlot({id:'plot',data:'selected',x:'x',y:'y',groupBy:'g',method:'polynomial',degree:3,guides:false});
 const context=ctx(p),rec=generateCandidates(p,context).find(c=>c.method==='editFilteredData');
 assert.ok(rec);
 const editor=recommendationParameters({...rec,skipParameterDefaults:true},context.profile);
 for(const op of ['gte','lte']){
  let values=change(editor,valuesFor(editor.controls),'Keep values',op);
  values=editor.normalizeValues(values,editor.controls.find(c=>c.label==='Keep values').key);
  const threshold=editor.resolveControls(values).find(c=>c.path==='predicate.value');
  assert.deepEqual([threshold.min,threshold.max],op==='gte'?[1,4]:[5,8]);
  for(const value of [threshold.min,threshold.max]){
   const args=editor.build({...values,[threshold.key]:value});
   assert.match(renderToSVG(p.editFilteredData(args)),/<svg/);
  }
 }
});

test('Aggregated line X alternatives retain at least two positions per existing series',()=>{
 const p=base().createLinePlot({id:'plot',x:{field:'x',fieldType:'ordinal'},y:{field:'y',aggregate:'mean'},color:'g',guides:false});
 const alternatives=positionCandidates(p,ctx(p)).filter(c=>c.method==='encodeX');
 assert.ok(!alternatives.some(c=>c.args.field==='g'));
 assert.ok(alternatives.some(c=>c.args.field==='h'));
});

test('Upstream interval filter controls exclude rows removed by downstream missing-bound filters',()=>{
 const data=[{title:'A',center:10,lower:8,upper:12},{title:'B',center:20,lower:18,upper:22},
  {title:'C',center:100,lower:null,upper:null},{title:'D',center:null,lower:28,upper:32}];
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:data}),profile=profileDataset(p,'data'),selection={x:'title',y:'center'};
 const selected=selectionData(p,profile,data,selection);
 const def=selectedPlotDefinitions({...profile,id:selected.data},selection,data,[],{availableProfile:profile}).find(d=>d.method==='createIntervalPlot');
 const values=valuesFor(def.controls);let prepared=selected.program;
 for(const call of def.setup(values))prepared=prepared[call.method](call.args);
 prepared=prepared.createIntervalPlot({...def.build(values),guides:false});
 const context=ctx(prepared),rec=generateCandidates(prepared,context).find(c=>c.method==='editFilteredData'&&c.args.field==='center');
 const editor=recommendationParameters({...rec,skipParameterDefaults:true},context.profile),limit=editor.controls.find(c=>c.path==='predicate.value');
 assert.equal(limit.max,20);
 const filtered=prepared.editFilteredData(editor.build({...valuesFor(editor.controls),[limit.key]:limit.max}));
 assert.match(renderToSVG(filtered),/<svg/);
});
