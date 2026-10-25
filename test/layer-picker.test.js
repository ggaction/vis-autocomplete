import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chart} from 'ggaction';
import {getPlotComposition} from 'ggaction/inspection';
import {overlayContext,overlaySpecs,adjacentContext,adjacentSpecs} from '../web/composition-controls.js';
import {createInitialChartRecommender} from '../src/initial-recommender.js';
import {prepareGuidedAction} from '../src/prepare.js';
import {editableChartTargets} from '../src/composition-context.js';
import {parseCSV} from '../src/data-import.js';
const engine=createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json',import.meta.url))));
const rows=Array.from({length:36},(_,i)=>({group:['A','B','C'][i%3],series:i%2?'I':'II',value:3+i%11,x:i+1,id:`r${i}`,a:i+2,b:i+3,c:i+4}));
const base=()=>chart().createCanvas({plot:{width:400,height:360},margin:100}).createData({id:'data',values:rows});
const cases=[
 ['beeswarm',()=>base().createBeeswarmPlot({id:'p',x:'group',y:'value',color:{field:'group',fieldType:'nominal'}})],
 ['grouped',()=>base().createBeeswarmPlot({id:'p',x:'group',y:'value',color:{field:'series',fieldType:'nominal'},packing:{overflow:'overlap'}})],
 ['box',()=>base().createBoxPlot({id:'p',x:{field:'group',fieldType:'nominal'},y:{field:'value'}})],
 ['scatter',()=>base().createScatterPlot({id:'p',x:'x',y:'value',color:{field:'group',fieldType:'nominal'}})],
 ['density',()=>base().createDensityPlot({id:'p',field:'value'})],
 ['histogram',()=>base().createHistogram({id:'p',field:'value'})],
 ['polar',()=>base().createPolarScatterPlot({id:'p',theta:'x',radius:'value',color:{field:'group',fieldType:'nominal'}})],
 ['radar',()=>base().createRadarPlot({id:'p',wide:{fields:['a','b','c']},groupBy:'id'})],
 ['rose',()=>base().createRosePlot({id:'p',category:'group',aggregate:'sum',value:'value'})],
 ['radial',()=>base().createRadialBarPlot({id:'p',category:'group',aggregate:'count'})],
 ['parallel',()=>base().createParallelCoordinates({id:'p',dimensions:['a','b','c']})],
];
for(const [name,build] of cases)test(`${name}: every offered layer default executes and source data is preserved`,()=>{
 const p=build(),adding=overlayContext(p,{target:'p'}),specs=overlaySpecs(adding,engine);
 assert.ok(specs.length>0,`${name} offers compatible layers`);
 for(const spec of specs){
   const args=spec.build(spec.values);
   let q;try {q=prepareGuidedAction(p,{method:spec.method,args},p).preview;}
   catch(e){throw new Error(`${name}: ${spec.title}: ${e.message}`,{cause:e});}
   const target=spec.original.nextContext.target;
   assert.equal(getPlotComposition(q,{target}).data,'data');
   assert.deepEqual(q.semanticSpec.datasets.find(d=>d.id==='data').values,rows);
   assert.ok(editableChartTargets(q).some(t=>t.id===target));
   assert.ok(spec.controls.length<=4);
 }
});
test('faceted layer choices remain one native call and all panels receive the layer',()=>{
 const p=cases[0][1]().facet({field:'group',columns:3,guides:{legend:'shared'}});
 const spec=overlaySpecs(overlayContext(p,{target:'p'}),engine).find(s=>/Box plot/.test(s.title));assert.ok(spec);
 assert.equal(spec.method,'editFacetSource');const q=p[spec.method](spec.build(spec.values));
 for(const child of Object.values(q.children))assert.ok(child.markConfigs.layer?.boxPlot);
});
test('derived and non-Cartesian adjacent pickers use original input variables',()=>{
 for(const [,build] of cases){
  const p=build(),adding=adjacentContext(p,{target:'p'},'right',{});
  assert.equal(adding.profile.id,'data');assert.ok(adding.selection.fields.length);
  assert.ok(adding.selection.fields.every(name=>adding.profile.fields.some(f=>f.name===name)));
  assert.ok(adjacentSpecs(engine,adding,p).length>0);
 }
});

for(const [name,build] of cases.filter(([name])=>['beeswarm','scatter','polar','rose','histogram'].includes(name)))test(`${name}: enabled enum and slider boundary parameters render`,()=>{
 const p=build();
 for(const spec of overlaySpecs(overlayContext(p,{target:'p'}),engine))for(const control of spec.resolveControls(spec.values)){
  const choices=control.type==='number'?[control.min,control.max]:(control.choices??[]).filter(c=>!c.disabled).map(c=>c.value);
  for(const value of choices){
   const values={...spec.values,[control.key]:value};
   try{prepareGuidedAction(p,{method:spec.method,args:spec.build(values)},p);}
   catch(e){throw new Error(`${name}: ${spec.title}: ${control.key}=${value}: ${e.message}`,{cause:e});}
  }
 }
});

test('a Raincloud facade reserves its public ID so another layer can be added',()=>{
 const p=cases[0][1]().createLayerPlot({id:'layer',source:'p',plot:{action:'createRaincloudPlot'}});
 const specs=overlaySpecs(overlayContext(p,{target:'layerCloud'}),engine);
 assert.ok(specs.length>0);const box=specs.find(s=>/Box plot/.test(s.title));assert.ok(box);
 const args=box.build(box.values);assert.equal(args.id,'layer2');
 assert.ok(prepareGuidedAction(p,{method:box.method,args},p).preview);
});

test('singleton series cannot produce a default Area layer',()=>{
 const p=base().createBeeswarmPlot({id:'p',x:'group',y:'value',color:{field:'id',fieldType:'nominal'},packing:{overflow:'overlap'}});
 const specs=overlaySpecs(overlayContext(p,{target:'p'}),engine);
 assert.ok(specs.some(spec=>/Box plot/.test(spec.title)));
 assert.ok(!specs.some(spec=>/Area plot/.test(spec.title)));
});

test('layer statistical parameters follow the source measure axis in both orientations',()=>{
 for(const horizontal of [false,true]) {
  const p=base().createBeeswarmPlot({id:'p',x:horizontal?'value':'group',y:horizontal?'group':'value'});
  const specs=overlaySpecs(overlayContext(p,{target:'p'}),engine),measure=horizontal?'x':'y';
  const interval=specs.find(spec=>/Interval plot/.test(spec.title));assert.ok(interval);
  const args=interval.build({...interval.values,level:.8});
  assert.equal(args.plot.options[measure].level,.8);
  assert.ok(prepareGuidedAction(p,{method:interval.method,args},p).preview);
  const bar=specs.find(spec=>/Bar plot/.test(spec.title));assert.ok(bar);
  const barArgs=bar.build({...bar.values,aggregate:'median'});
  assert.equal(barArgs.plot.options[measure].aggregate,'median');
  assert.ok(prepareGuidedAction(p,{method:bar.method,args:barArgs},p).preview);
  const dumbbell=specs.find(spec=>/Dumbbell plot/.test(spec.title));assert.ok(dumbbell);
  assert.ok(dumbbell.controls.some(control=>control.key==='start'));
  assert.ok(prepareGuidedAction(p,{method:dumbbell.method,args:dumbbell.build(dumbbell.values)},p).preview);
 }
});

test('numeric-year Area offers a Line layer at the same aggregate grain without adding bins',()=>{
 const values=parseCSV(readFileSync(new URL('../web/data/global-temp.csv',import.meta.url),'utf8'));
 const p=chart().createCanvas({plot:{width:400,height:360},margin:100}).createData({id:'data',values})
   .createSummaryData({id:'summary',source:'data',groupBy:['year'],aggregates:[{op:'mean',field:'temp',as:'temp'}]})
   .createAreaPlot({id:'p',data:'summary',x:{field:'year',fieldType:'quantitative'},y:'temp'});
 const line=overlaySpecs(overlayContext(p,{target:'p'}),engine).find(spec=>/Line plot/.test(spec.title));
 assert.ok(line,'a compatible Line layer is offered');
 const args=line.build(line.values),prepared=prepareGuidedAction(p,{method:line.method,args},p);
 const info=getPlotComposition(prepared.preview,{target:line.original.nextContext.target});
 assert.equal(info.channels.x.field,'year');
 assert.equal(info.channels.x.bin,undefined);
 assert.equal(info.channels.y.field,'temp');
 assert.deepEqual(info.channels.y.measurement.operations,['mean']);
});
