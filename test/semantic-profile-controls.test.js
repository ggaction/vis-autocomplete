import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { profileDataset } from '../src/profile.js';
import { fieldSetPlotDefinitions } from '../src/field-set-plots.js';
import { selectedPlotDefinitions } from '../src/selected-plots.js';
import { defaultValues } from '../src/plot-catalog.js';
import { ownedChartCandidates } from '../src/owned-chart-candidates.js';
import { chartOwner } from '../src/chart-owner.js';
import { initialParameters, activeControls } from '../web/parameters.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { replayPrepared } from './support/prepared.js';
const base=rows=>chart().createCanvas({plot:{width:1600,height:350},margin:120}).createData({id:'dataset',values:rows});
const execute=(p,d,values)=> (d.setup?.(values)??[]).reduce((p,call)=>p[call.method](call.args),p)[d.method](d.build(values));
const fixture=name=>JSON.parse(readFileSync(new URL(`../web/data/${name}.json`,import.meta.url)));

test('Glass Radar separates ID from color, supports summaries, and preserves nominal hints and visible dimension order',()=>{
 const rows=fixture('glass'), p=base(rows), hints={Id_number:{type:'nominal'},class:{type:'nominal'}};
 const profile=profileDataset(p,'dataset',hints);
 const d=fieldSetPlotDefinitions(profile,rows).find(d=>d.method==='createRadarPlot'), defaults=defaultValues(d);
 assert.equal(defaults.color,'class');assert.equal(defaults.group,'class');assert.equal(defaults.summary,'mean');
 assert.equal(defaults.normalize,false);
 const initial=initialParameters(d), changed={...defaults,group:''};
 assert.equal(initial.normalizeValues(changed,'group').color,'');
 const raw={...defaults,group:'Id_number',summary:false};
 assert.equal(initial.normalizeValues(raw,'group').color,'class');
 assert.ok(activeControls(initial.resolveControls(defaults),defaults).find(c=>c.key==='color').choices.find(c=>c.value==='Id_number').disabled);
 const next=execute(p,d,defaults), layer=next.semanticSpec.layers[0];
 assert.equal(next.graphicSpec.objects.plot.items.length,6);
 assert.equal(layer.encoding.color.field,'class');
 const derived={...profileDataset(next,layer.data,{class:{type:'nominal'}}),sourceFieldTypes:hints};
 const editor=ownedChartCandidates(next,{layer,profile:derived,owner:chartOwner(next,layer)}).find(c=>c.method==='editRadarPlot');
 const dims=editor.parameters.find(c=>c.path==='wide.fields');
 assert.deepEqual(dims.value,defaults.dimensions);assert.equal(dims.ordered,true);
 assert.ok(!dims.choices.some(c=>['Id_number','class'].includes(c.value)));
 assert.deepEqual(next.editRadarPlot(editor.args).graphicSpec.objects.plot,next.graphicSpec.objects.plot);
 assert.match(renderToSVG(next),/<svg/);
});
test('PCP Color=None removes native encoding, while palette decoration never recreates a fieldless color',()=>{
 const rows=fixture('wine'),p=base(rows),profile=profileDataset(p,'dataset',{class:{type:'nominal'}});
 const d=fieldSetPlotDefinitions(profile,rows).find(d=>d.method==='createParallelCoordinates');
 const values={...defaultValues(d),color:''};assert.equal(d.build(values).color,undefined);
 const next=execute(p,d,values);assert.equal(next.semanticSpec.layers[0].encoding.color,undefined);
 assert.match(renderToSVG(next),/<svg/);
});
test('Glass individual Radar can add an independent class dash legend after its ID color legend',()=>{
 const rows=fixture('glass'),p=base(rows).createRadarPlot({id:'plot',data:'dataset',
  wide:{fields:['RI','Na','Mg','Al']},groupBy:'Id_number',color:{field:'Id_number',fieldType:'nominal'}});
 const prepared=prepareGuidedAction(p,{method:'encodeStrokeDash',args:{target:'plot',field:'class',fieldType:'nominal'}});
 assert.equal(prepared.preview.guideConfigs.legend.color.field,'Id_number');
 assert.equal(prepared.preview.guideConfigs.legend.series.field,'class');
 assert.equal(prepared.preview.graphicSpec.objects.plot.items.length,214);
 assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
 assert.match(renderToSVG(prepared.preview),/<svg/);
});
test('ECDF mapping Color overrides stale Group values, and None is a valid single uncolored distribution',()=>{
 const rows=fixture('iris'),p=base(rows),profile=profileDataset(p,'dataset');
 profile.fields=profile.fields.filter(f=>['Sepal.Length','Species'].includes(f.name));
 const d=fieldSetPlotDefinitions(profile,rows).find(d=>d.method==='createECDFPlot');
 const e=initialParameters(d), values={...d.values,mapping_x:'Sepal.Length',mapping_color:'Species',group:''};
 const args=e.build(values);assert.equal(args.groupBy,'Species');assert.equal(args.color.field,'Species');
 const next=execute(p,e,values);assert.equal(next.graphicSpec.objects.plot.items.length,3);
 const clear={...values,mapping_color:'',group:''};assert.equal(e.build(clear).color,undefined);
 assert.equal(execute(p,e,clear).graphicSpec.objects.plot.items.length,1);
});
test('Income weighting uses an explicit public summary and percent labels; unweighted rate defaults never sum proportions',()=>{
 const rows=fixture('income'),p=base(rows),profile=profileDataset(p,'dataset',{id:{type:'nominal'},group:{type:'ordinal'}});
 for(const method of ['createBarPlot','createLinePlot','createAreaPlot']) {
  const d=selectedPlotDefinitions(profile,{x:'group',y:'pct',color:'region'},rows,[],{method}).find(d=>d.method===method);
  const defaults=defaultValues(d);assert.equal(defaults.aggregate,'mean');assert.equal(defaults.valueFormat,'.0%');
  const values={...defaults,aggregate:'weightedMean',weightField:'total'};
  const calls=d.setup(values), summary=calls.find(c=>c.method==='createSummaryData');
  assert.deepEqual(summary.args.weight,{field:'total',kind:'reliability'});
  const next=execute(p,d,values), summaryRows=next.semanticSpec.datasets.find(d=>d.id===summary.args.id).values;
  for(const row of summaryRows) {
   const source=rows.filter(r=>r.group===row.group&&r.region===row.region);
   const oracle=source.reduce((s,r)=>s+r.pct*r.total,0)/source.reduce((s,r)=>s+r.total,0);
   assert.ok(Math.abs(row.pct-oracle)<1e-12);
  }
  assert.equal(next.guideConfigs.axis.y.labels.format,'.0%');assert.match(renderToSVG(next),/%/);
 }
});
test('Weighted summaries disclose bins without freezing interval labels across native edits',()=>{
 const rows=Array.from({length:20},(_,i)=>({year:1880+i*7,value:i+1,weight:20-i,g:i%2?'A':'B'})),p=base(rows),profile=profileDataset(p,'dataset');
 for(const [method,selection] of [['createBarPlot',{x:'value',y:'g'}],...['createLinePlot','createBarPlot','createAreaPlot','createHorizonPlot'].map(method=>[method,{x:'year',y:'value',...(method==='createHorizonPlot'?{}:{color:'g'})}])]){
  const d=selectedPlotDefinitions(profile,selection,rows,[],{method}).find(d=>d.method===method),values={...defaultValues(d),aggregate:'weightedMean',weightField:'weight'};
  const next=execute(p,d,values);assert.match(renderToSVG(next),/<svg/);
  if(selection.x==='year'){
   const labels=next.guideConfigs.axis.x.labels;assert.equal(labels.labelMap,undefined);
   assert.equal(d.build(values).guides.axes.x.title.text,
     ['createBarPlot','createLinePlot'].includes(method)?'year (binned)':'year (bin centers)');
   if(method==='createBarPlot'||method==='createLinePlot') {
    assert.equal(labels.inferredValues,true);
    const changed=next.encodeX({target:'plot',field:next.semanticSpec.layers[0].encoding.x.field,
      fieldType:'quantitative',bin:{maxBins:3}});
    assert.notDeepEqual(changed.guideConfigs.axis.x.labels.values,labels.values);
    assert.equal(changed.guideConfigs.axis.x.labels.labelMap,undefined);
    assert.match(renderToSVG(changed),/<svg/);
   }
  }
 }
});

test('weighted-mean controls validate every displayed group and recompute eligibility after bins change',()=>{
 const rows=[{g:'A',v:1,w:0},{g:'A',v:3,w:0},{g:'B',v:2,w:1},{g:'B',v:4,w:2}],p=base(rows);
 const d=selectedPlotDefinitions(profileDataset(p,'dataset'),{x:'g',y:'v'},rows,[],{method:'createBarPlot'})[0];
 const values={...defaultValues(d),aggregate:'weightedMean',weightField:'w'}, controls=d.resolveControls(values);
 assert.equal(controls.find(c=>c.key==='aggregate').choices.find(c=>c.value==='weightedMean').disabled,true);
 assert.match(controls.find(c=>c.key==='weightField').choices.find(c=>c.value==='w').reason,/Each displayed group/);
 const editor=initialParameters(d), safe=editor.normalizeValues(values,'aggregate');
 assert.notEqual(safe.aggregate,'weightedMean');assert.match(renderToSVG(execute(p,editor,safe)),/<svg/);
 const binnedRows=[{x:0,v:1,w:0},{x:2,v:3,w:1},{x:8,v:2,w:0},{x:10,v:4,w:1}], b=base(binnedRows);
 for(const method of ['createBarPlot','createLinePlot','createAreaPlot','createHorizonPlot']){
  const spec=selectedPlotDefinitions(profileDataset(b,'dataset'),{x:'x',y:'v'},binnedRows,[],{method})[0];
  const v={...defaultValues(spec),aggregate:'weightedMean',weightField:'w',bins:2};
  const weight=values=>spec.resolveControls(values).find(c=>c.key==='weightField').choices.find(c=>c.value==='w');
  assert.equal(weight(v).disabled,undefined,method);assert.match(renderToSVG(execute(b,spec,v)),/<svg/);
  assert.equal(weight({...v,bins:24}).disabled,true,method);
  assert.equal(weight(v).disabled,undefined,`${method} restores valid grouping`);
 }
 const alternativeRows=rows.map(row=>({...row,positive:1})), a=base(alternativeRows);
 const alternative=selectedPlotDefinitions(profileDataset(a,'dataset'),{x:'g',y:'v'},alternativeRows,[],{method:'createBarPlot'})[0];
 const e=initialParameters(alternative), fixed=e.normalizeValues({...defaultValues(alternative),aggregate:'weightedMean',weightField:'w'},'weightField');
 assert.equal(fixed.aggregate,'weightedMean');assert.equal(fixed.weightField,'positive');
 assert.match(renderToSVG(execute(a,e,fixed)),/<svg/);
});
