import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, hconcat } from 'ggaction';
import { selectableGuides, guideMoveHistoryKey } from '../src/guide-manipulation.js';
import { rememberDisplayedGuides } from '../src/prepare.js';
import { manipulationTargets, manipulationCalls, prepareGuideEdits } from '../src/guide-group.js';
const unit = () => chart().createCanvas({plot:{width:314,height:314},margin:180})
  .createData({id:'d',values:[{x:1,y:3,g:'A'},{x:2,y:5,g:'B'}]})
  .createScatterPlot({id:'p',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}})
  .encodeSize({target:'p',field:'x'}).createGuides()
  .createTitle({text:'Overview',subtitle:'Details'});
function edit(p, keys, operation, params) {
  const guides=selectableGuides(p), grabbed=guides.find(t=>t.key===keys[0]);
  const targets=manipulationTargets(guides,new Set(keys),grabbed,operation);
  const result=prepareGuideEdits(p,p,manipulationCalls(p,targets,operation,params));
  let replay=p;
  for(const call of result.calls) replay=replay[call.method](call.args);
  replay=replay[result.guideCall.method](result.guideCall.args);
  assert.deepEqual(replay.graphicSpec,result.view.graphicSpec);
  return result.view;
}
test('group resize uses one original ratio and preserves unselected text',()=>{
  const p=unit(), next=edit(p,['title','axis:xAxisTitle'],'resize',{factor:1.5});
  assert.equal(next.titleConfig.titleStyle.fontSize,p.titleConfig.titleStyle.fontSize*1.5);
  assert.equal(next.guideConfigs.axis.x.title.fontSize,p.guideConfigs.axis.x.title.fontSize*1.5);
  assert.deepEqual(next.titleConfig.subtitleStyle,p.titleConfig.subtitleStyle);
  assert.deepEqual(next.guideConfigs.axis.y,p.guideConfigs.axis.y);
});
test('group move shifts title and axis by the same delta',()=>{
  const p=unit(), keys=['title','axis:xAxisTitle'], next=edit(p,keys,'move',{dx:7,dy:4});
  for(const key of keys){
    const a=selectableGuides(p).find(t=>t.key===key).bounds,b=selectableGuides(next).find(t=>t.key===key).bounds;
    assert.ok(Math.abs(b.left-a.left-7)<.3,`${key}: x ${b.left-a.left}`);
    assert.ok(Math.abs(b.top-a.top-4)<.3,`${key}: y ${b.top-a.top}`);
  }
});
test('selection aliases and overlapping parents manipulate each native owner once',()=>{
  const guides=selectableGuides(unit()), pick=key=>guides.find(g=>g.key===key);
  const move=manipulationTargets(guides,new Set(['title','subtitle','legend:color:items','legend:color']),pick('legend:color:items'),'move');
  assert.equal(move.length,2);
  const resize=manipulationTargets(guides,new Set(['title','title-group','legends:all','legend-title:color']),pick('title'),'resize');
  assert.equal(resize.length,3);
  assert.ok(resize.every(t=>!t.part));
  assert.deepEqual(manipulationTargets(guides,new Set(['title']),pick('axis:xAxisTitle'),'resize'),[pick('axis:xAxisTitle')]);
});
test('facet duplicate axes and nested child owners keep their scopes',()=>{
  const p=unit().facet({field:'g',columns:2,guides:{axes:'outer',legend:'shared'}}), guides=selectableGuides(p);
  const xs=guides.filter(t=>t.kind==='axis'&&t.channel==='x');
  assert.equal(manipulationTargets(guides,new Set(xs.map(t=>t.key)),xs[0],'resize').length,1);
  const q=hconcat({programs:[{id:'a',program:unit()},{id:'b',program:unit()}],share:{color:true}});
  const next=edit(q,['a/title','b/title'],'resize',{factor:1.25});
  for(const id of ['a','b']) assert.equal(next.children[id].titleConfig.titleStyle.fontSize,q.children[id].titleConfig.titleStyle.fontSize*1.25);
});
test('two independent legend bodies move while their titles stay fixed',()=>{
  const p=unit(), keys=['legend:color:items','legend:size:items'], next=edit(p,keys,'move',{dx:8,dy:6});
  for (const key of ['legend-title:color','legend-title:size']) assert.deepEqual(selectableGuides(next).find(t=>t.key===key).bounds,selectableGuides(p).find(t=>t.key===key).bounds);
  for(const key of keys){
    const a=selectableGuides(p).find(t=>t.key===key).bounds,b=selectableGuides(next).find(t=>t.key===key).bounds;
    assert.ok(Math.abs(b.left-a.left-8)<.3,`${key}: x ${b.left-a.left}`);
    assert.ok(Math.abs(b.top-a.top-6)<.3,`${key}: y ${b.top-a.top}`);
  }
});
test('a parent selection remains active when dragging a visible descendant',()=>{
  const guides=selectableGuides(unit()), title=guides.find(g=>g.key==='title');
  const targets=manipulationTargets(guides,new Set(['title-group','axis:xAxisTitle']),title,'resize');
  assert.equal(targets.length,2); assert.ok(targets.some(t=>t.key==='title-group'));
});
test('legend item selection resizes labels without changing glyphs or unselected titles',()=>{
  const p=unit(), next=edit(p,['title','legend:color:items'],'resize',{factor:1.5});
  assert.equal(next.guideConfigs.legend.color.labels.fontSize,p.guideConfigs.legend.color.labels.fontSize*1.5);
  assert.deepEqual(next.guideConfigs.legend.color.titleStyle,p.guideConfigs.legend.color.titleStyle);
  assert.deepEqual(next.guideConfigs.legend.color.symbol,p.guideConfigs.legend.color.symbol);
});
for(const kind of ['facet','concat']) test(`${kind}: independent selected legends keep their movement and replay scopes`,()=>{
  const p=kind==='facet'?unit().facet({field:'g',columns:2,guides:{axes:'outer',legend:'shared'}})
    :unit().createAdjacentPlot({id:'other',source:'p',position:'right',plot:{action:'createScatterPlot',options:{data:'d',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}}},share:{color:true}});
  const guides=selectableGuides(p), keys=guides.filter(t=>t.legendPart==='legend').map(t=>t.key);
  assert.ok(keys.length>=2);
  const next=edit(p,keys,'move',{dx:5,dy:4});
  for(const key of keys){
    const a=guides.find(t=>t.key===key).bounds,b=selectableGuides(next).find(t=>t.key===key).bounds;
    assert.ok(Math.abs(b.left-a.left-5)<.3,`${key}: x ${b.left-a.left}`);
    assert.ok(Math.abs(b.top-a.top-4)<.3,`${key}: y ${b.top-a.top}`);
  }
});
for(const kind of ['unit','facet','per-cell','concat','nested']) test(`${kind}: item selection stays independent through moving, whole-legend movement and history keys`,()=>{
  let p=unit();
  if(kind==='facet'||kind==='per-cell')p=p.facet({field:'g',columns:2,guides:{legend:kind==='facet'?'shared':false}});
  if(kind==='concat'||kind==='nested')p=hconcat({programs:[{id:'a',program:p},{id:'b',program:p}],share:{color:kind==='concat'}});
  if(kind==='nested')p=hconcat({programs:[{id:'inner',program:p},{id:'last',program:unit()}]});
  const guides=selectableGuides(p), item=guides.find(t=>t.legendPart==='items');
  const title=guides.find(t=>t.legendPart==='title'&&t.legendKey===item.legendKey);
  const parent=guides.find(t=>t.key===item.legendKey);
  assert.notEqual(guideMoveHistoryKey(parent),guideMoveHistoryKey(item));
  assert.equal(manipulationTargets(guides,new Set([item.key,parent.key]),item,'move')[0].part,undefined);
  const next=edit(p,[item.key],'move',{dx:8,dy:6});
  assert.deepEqual(selectableGuides(next).find(t=>t.key===title.key).bounds,title.bounds);
  const twice=edit(next,[item.key],'move',{dx:4,dy:3});
  const moved=selectableGuides(twice).find(t=>t.key===item.key);
  assert.ok(Math.abs(moved.bounds.left-item.bounds.left-12)<.3);
  assert.ok(Math.abs(moved.bounds.top-item.bounds.top-9)<.3);
  const whole=edit(twice,[parent.key],'move',{dx:5,dy:4});
  for(const key of [title.key,item.key]){
    const a=selectableGuides(twice).find(t=>t.key===key), b=selectableGuides(whole).find(t=>t.key===key);
    assert.ok(Math.abs(b.bounds.left-a.bounds.left-5)<.3,`${key} x`);
    assert.ok(Math.abs(b.bounds.top-a.bounds.top-4)<.3,`${key} y`);
  }
});
test('multi-selection promotes the complete displayed facet legend suffix before editing any block',()=>{
  const p=chart().createCanvas({plot:{width:314,height:314},margin:180})
    .createData({id:'d',values:[{x:1,y:3,g:'A'},{x:2,y:5,g:'B'}]})
    .createScatterPlot({id:'plot',x:'x',y:'y',color:{field:'g',fieldType:'nominal'},guides:false})
    .encodeSize({target:'plot',field:'x'}).facet({field:'g',columns:2,guides:{legend:'shared'}});
  const call={method:'createGuides',args:{}};
  const view=rememberDisplayedGuides(p.createGuides(),call), guides=selectableGuides(view);
  const items=guides.filter(t=>t.legendPart==='items');assert.equal(items.length,2);
  const result=prepareGuideEdits(p,view,manipulationCalls(view,items,'move',{dx:10,dy:0}));
  assert.equal(result.calls[0].method,'createGuides');
  for(const t of guides.filter(t=>t.legendPart==='title')) assert.deepEqual(selectableGuides(result.view).find(n=>n.key===t.key).bounds,t.bounds);
  for(const item of items)assert.ok(Math.abs(selectableGuides(result.view).find(t=>t.key===item.key).bounds.left-item.bounds.left-10)<.3);
  let replay=p;for(const c of result.calls)replay=replay[c.method](c.args);
  replay=replay[result.guideCall.method](result.guideCall.args);assert.deepEqual(replay.graphicSpec,result.view.graphicSpec);
});
