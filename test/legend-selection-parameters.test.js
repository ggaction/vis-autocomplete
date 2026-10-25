import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, hconcat } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor, activeControls } from '../web/parameters.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { replayPrepared } from './support/prepared.js';

const rows = Array.from({length:12}, (_, i) => ({x:i+1,y:i*2+1,g:i%2?'A':'B'}));
function fixture(continuous = false) {
  return chart().createCanvas({plot:{width:400,height:360},margin:240})
    .createData({id:'data',values:rows}).createScatterPlot({id:'plot',x:'x',y:'y',guides:false,
      color:{field:continuous?'x':'g',fieldType:continuous?'quantitative':'nominal'},
      size:{field:'y',fieldType:'quantitative'}}).createLegend({target:'plot',channels:['color','size']});
}
function editor(program) {
  const profile=profileDataset(program,'data');
  const rec=generateCandidates(program,{layer:program.semanticSpec.layers[0],profile}).find(c=>c.method==='editLegend');
  assert.ok(rec);return recommendationParameters(rec,profile);
}
const bothValues=e=>e.normalizeValues({...valuesFor(e.controls),channel:'all'},'channel');
for (const continuous of [false,true]) test(`${continuous?'continuous':'categorical'} color and size: Both moves every legend and preserves individual styles`,()=>{
  let p=fixture(continuous).editLegend({target:'plot',channel:'size',position:'bottom',labels:{fontSize:16}});
  const e=editor(p),v=bothValues(e);
  assert.equal(e.controls[0].choices.find(c=>c.value==='all').label,'Both');
  for(const position of ['left','right','top','bottom','top-left','top-right','bottom-left','bottom-right']){
    const args=e.build({...v,position});
    assert.deepEqual(args,{target:'plot',channel:'all',position});
    const prepared=prepareGuidedAction(p,{method:'editLegend',args,allowUnchanged:true});
    assert.equal(prepared.recommendation.validation.topLevelActions,1);
    const next=prepared.authoringPreview;
    assert.equal(next.guideConfigs.legendGroups.plot.placement.position,position);
    for(const [kind,config] of Object.entries(next.guideConfigs.legend)){
      assert.deepEqual(config.labels,p.guideConfigs.legend[kind].labels);
      assert.equal(config.blockOverrides,undefined);
    }
    assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
    assert.deepEqual(deserializeProgram(serializeProgram(next)).graphicSpec,next.graphicSpec);
  }
  const next=p.editLegend(e.build({...v,position:'left',fontSize:17,itemGap:23}));
  for(const config of Object.values(next.guideConfigs.legend)) assert.equal(config.labels.fontSize,17);
  assert.equal(next.guideConfigs.legend.size.itemGap,23);
});
test('single combined color/shape block does not offer Both, three blocks offer All',()=>{
  const single=fixture().removeLegend({target:'plot'}).encodeShape({target:'plot',field:'g',fieldType:'nominal'})
    .createLegend({target:'plot',channels:['color','shape']});
  assert.ok(!editor(single).controls[0].choices.some(c=>c.value==='all'));
  const three=fixture().encodeOpacity({target:'plot',field:'x',fieldType:'quantitative'})
    .createLegend({target:'plot',channels:['opacity']});
  const e=editor(three);assert.equal(e.controls[0].choices.find(c=>c.value==='all').label,'All');
  const n=three.editLegend(e.build({...bothValues(e),position:'left'}));
  assert.equal(Object.keys(n.guideConfigs.legend).length,3);
});
test('individual legend selection stays isolated and continuous color has no invalid item gap',()=>{
  const p=fixture(true),e=editor(p);
  const v=e.normalizeValues({...valuesFor(e.controls),channel:'color'},'channel');
  assert.ok(!activeControls(e.resolveControls(v),v).some(c=>c.key==='itemGap'));
  const args=e.build({...v,position:'left'});assert.equal(args.itemGap,undefined);
  const next=p.editLegend(args);assert.deepEqual(next.guideConfigs.legend.size,p.guideConfigs.legend.size);
});
test('Both preserves mixed visibility unless its switches are changed',()=>{
  const p=fixture().editLegend({target:'plot',channel:'size',labels:{visible:false}}),e=editor(p),v=bothValues(e);
  const args=e.build({...v,position:'top'});assert.equal(args.labels,undefined);
  const n=p.editLegend(args);assert.equal(n.guideConfigs.legend.size.visibility.labels,false);
  assert.notEqual(n.guideConfigs.legend.color?.visibility?.labels,false);
  const shown=p.editLegend(e.build({...v,position:'top',labelsVisible:true}));
  for(const c of Object.values(shown.guideConfigs.legend)) assert.equal(c.visibility.labels,true);
});
test('Both routes through facet shared guides and scoped adjacent-chart targets',()=>{
  const p=fixture(),e=editor(p),args=e.build({...bothValues(e),position:'bottom'});
  const f=p.facet({field:'g',columns:2,guides:{axes:'outer',legend:'shared'}});
  const n=prepareGuidedAction(f,{method:'editLegend',args}).authoringPreview;
  assert.deepEqual(deserializeProgram(serializeProgram(n)).graphicSpec,n.graphicSpec);
  const joined=hconcat({programs:[{id:'a',program:p},{id:'b',program:p}]});
  const next=joined.editLegend({...args,target:{childPath:['a'],id:'plot'}});
  assert.equal(next.children.a.guideConfigs.legendGroups.plot.placement.position,'bottom');
  assert.deepEqual(next.children.b.graphicSpec,joined.children.b.graphicSpec);
});

test('explicit shared edits can set every legend to the displayed starting value',()=>{
  const p=fixture().editLegend({target:'plot',channel:'size',labels:{fontSize:17,visible:false}}),e=editor(p),v=bothValues(e);
  const size=e.normalizeValues({...v,fontSize:v.fontSize},'fontSize');
  const next=p.editLegend(e.build(size));
  for(const c of Object.values(next.guideConfigs.legend)) assert.equal(c.labels.fontSize,v.fontSize);
  const off=e.normalizeValues({...v,labelsVisible:false},'labelsVisible');
  const hidden=p.editLegend(e.build(off));
  for(const c of Object.values(hidden.guideConfigs.legend)) assert.equal(c.visibility.labels,false);
});
