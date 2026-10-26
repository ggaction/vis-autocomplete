import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, hconcat } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { TEXT_GROUPS, chartTextItems, textUnderlines, typographyCalls, prepareTypography } from '../src/chart-typography.js';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from '../web/parameters.js';
import { prepareGuidedAction } from '../src/prepare.js';

const rows = Array.from({length:12},(_,i)=>({x:i+1,y:i*2+3,z:i+4,g:i%2?'A':'B'}));
const base = () => chart().createCanvas({plot:{width:314,height:314},margin:160})
  .applyTheme({theme:{base:'dark',tokens:{background:'#eeeeee',mark:'#cc44aa'}}}).createData({id:'d',values:rows});
const unit = () => base().createScatterPlot({id:'p',data:'d',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}})
  .createLegend({target:'p',channels:['color'],labels:{fontFamily:'Arial',fontSize:12}})
  .createTitle({text:'Overview',subtitle:'Regions',titleStyle:{fontFamily:'Arial',fontSize:23}});
const cases = {
  unit,
  labels: () => unit().createMarkLabels({id:'labels',source:'p',field:'x',fontSize:18}),
  facet: () => unit().facet({field:'g',columns:2,guides:{axes:'outer',legend:'shared'}}),
  concat: () => hconcat({programs:[{id:'a',program:unit()},{id:'b',program:unit()}],share:{color:true}}).createTitle({text:'Together'}),
  nested: () => hconcat({programs:[{id:'a',program:unit().facet({field:'g',columns:2,guides:{axes:'outer',legend:'shared'}})},{id:'b',program:unit()}],share:{color:true}}),
  parallel: () => base().createParallelCoordinates({id:'p',data:'d',dimensions:['x','y','z']}),
  polar: () => base().createPolarScatterPlot({id:'p',data:'d',theta:'x',radius:'y'}),
};
for (const [name, make] of Object.entries(cases)) {
  test(`${name}: font and role sizes use replayable native edits without losing chart styles`,()=>{
    const p=make(), snapshot=serializeProgram(p);
    const family=prepareTypography(p,p,{fontFamily:'Georgia'});
    const items=chartTextItems(family.view);
    assert.ok(items.length>0);
    assert.ok(items.every(t=>t.fontFamily==='Georgia'));
    assert.equal(family.program.graphicSpec.objects.canvas.properties.background,p.graphicSpec.objects.canvas.properties.background);
    assert.equal(serializeProgram(p),snapshot);
    const groups=['ticks','legendLabels','facetHeaders','markLabels'];
    const sized=prepareTypography(family.program,family.view,{groups,fontSize:16});
    for (const item of chartTextItems(sized.view)) {
      const before=items.find(t=>t.id===item.id);
      assert.equal(item.fontFamily,'Georgia');
      assert.equal(item.fontSize,groups.includes(item.group)?16:before?.fontSize);
    }
    let replay=p;
    for(const call of [...family.calls,...sized.calls]) replay=replay[call.method](call.args);
    replay=replay[sized.guideCall.method](sized.guideCall.args);
    assert.deepEqual(replay.graphicSpec,sized.view.graphicSpec);
    assert.deepEqual(deserializeProgram(serializeProgram(sized.program)).graphicSpec,sized.program.graphicSpec);
    const underlines=textUnderlines(sized.view,groups);
    assert.ok(underlines.length>0);
    assert.ok(underlines.every(b=>groups.includes(b.group)&&b.right>=b.left&&Number.isFinite(b.bottom)));
    if(name==='facet'||name==='nested')assert.ok(underlines.some(b=>b.group==='facetHeaders'));
  });
}
test('relative sizes preserve mixed roles, and consecutive edits replay against one history baseline',()=>{
  const p=unit().createMarkLabels({id:'labels',source:'p',field:'x',fontSize:18});
  const options={groups:TEXT_GROUPS.map(g=>g.id),delta:1};
  const first=prepareTypography(p,p,options);
  const second=prepareTypography(p,p,{...options,calls:typographyCalls(first.view,options)});
  const old=chartTextItems(p);
  for(const item of chartTextItems(second.view))assert.equal(item.fontSize,old.find(t=>t.id===item.id).fontSize+2);
  const restored=prepareTypography(p,p,{...options,fontSize:12,delta:undefined});
  assert.ok(chartTextItems(restored.view).every(t=>t.fontSize===12));
});
test('missing text does not reappear, and invalid input cannot partially change a chart',()=>{
  const p=unit().removeTitle().removeLegend({target:'p',channels:['color'],suppress:true}).editXAxis({title:false});
  const before=serializeProgram(p);
  const result=prepareTypography(p,p,{fontFamily:'Verdana'});
  assert.ok(!chartTextItems(result.view).some(t=>['titles','subtitles','legendLabels','legendTitles'].includes(t.group)));
  assert.equal(result.program.guideConfigs.axis.x.title,undefined);
  for(const fontSize of [NaN,0,97])assert.throws(()=>prepareTypography(p,p,{fontSize}),/Font size/);
  assert.equal(serializeProgram(p),before);
});
test('new title and legend card edits retain the selected chart font',()=>{
  const original=unit().removeTitle();
  const p=prepareTypography(original,original,{fontFamily:'Georgia'}).view;
  const profile=profileDataset(p,'d');
  const candidates=generateCandidates(p,{layer:p.semanticSpec.layers.find(l=>l.id==='p'),profile});
  for(const method of ['createTitle','editLegend']) {
    const candidate=candidates.find(c=>c.method===method);assert.ok(candidate,method);
    const editor=recommendationParameters(candidate,profile);
    const result=prepareGuidedAction(p,{method,args:editor.build(valuesFor(editor.controls)),allowUnchanged:true},p);
    assert.ok(chartTextItems(result.preview).every(item=>item.fontFamily==='Georgia'),method);
  }
});
test('a retained option card cannot restore a previously captured font',()=>{
  const p=unit(),profile=profileDataset(p,'d');
  const candidate=generateCandidates(p,{layer:p.semanticSpec.layers.find(l=>l.id==='p'),profile}).find(c=>c.method==='editTitle');
  const editor={method:'editTitle',...recommendationParameters(candidate,profile)};
  const changed=prepareTypography(p,p,{fontFamily:'Georgia'});
  const action=buildRecommendationCall(editor,{...valuesFor(editor.controls),text:'Changed title'});
  assert.equal(action.args.titleStyle.fontFamily,undefined);
  const result=prepareGuidedAction(changed.program,action,changed.view);
  assert.ok(chartTextItems(result.preview).every(item=>item.fontFamily==='Georgia'));
});
test('underlines follow rotated axis titles instead of their axis-aligned bounding box',()=>{
  const p=unit(), item=chartTextItems(p).find(t=>t.group==='axisTitles'&&t.rotation);
  const line=textUnderlines(p,['axisTitles']).find(l=>l.id===item.id);
  assert.equal(line.rotation,item.rotation);
  assert.ok(Math.abs(line.length-(line.bottom-line.top))<.01);
  assert.ok(Number.isFinite(line.x)&&Number.isFinite(line.y));
});

test('rapid size steps preserve clamping and merge selected roles into one native owner edit',()=>{
  const p=unit().editCanvas({plot:{width:1000,height:1000},margin:500})
    .editXAxis({ticksAndLabels:{count:2}}).editXAxis({labels:{fontSize:95},title:{fontSize:94}});
  const options={groups:['ticks','axisTitles'],deltas:[1,1,1,-1]};
  const calls=typographyCalls(p,options);
  assert.equal(calls.filter(c=>c.method==='editXAxis').length,1);
  assert.deepEqual(calls.find(c=>c.method==='editXAxis').args,{labels:{fontSize:95},title:{fontSize:95}});
  const result=prepareTypography(p,p,options);
  assert.equal(result.view.guideConfigs.axis.x.labels.fontSize,95);
  assert.equal(result.view.guideConfigs.axis.x.title.fontSize,95);
  let replay=p;for(const c of result.calls)replay=replay[c.method](c.args);
  assert.deepEqual(replay.createGuides(result.guideCall.args).graphicSpec,result.view.graphicSpec);
  assert.equal(p.guideConfigs.axis.x.labels.fontSize,95);
});

for(const [name,make] of Object.entries(cases))test(`${name}: alignment uses selected native text owners and survives history replay`,()=>{
 const p=make(),before=serializeProgram(p);
 for(const align of ['left','center','right']){
  const result=prepareTypography(p,p,{align,groups:TEXT_GROUPS.map(g=>g.id)});
  assert.ok(result.calls.length);
  let replay=p;for(const c of result.calls)replay=replay[c.method](c.args);
  replay=replay[result.guideCall.method](result.guideCall.args);
  assert.deepEqual(replay.graphicSpec,result.view.graphicSpec);
  assert.deepEqual(deserializeProgram(serializeProgram(result.program)).graphicSpec,result.program.graphicSpec);
 }
 assert.equal(serializeProgram(p),before);
});
