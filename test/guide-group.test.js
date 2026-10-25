import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, hconcat } from 'ggaction';
import { selectableGuides } from '../src/guide-manipulation.js';
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
test('two independent legend items move their whole owners together',()=>{
  const p=unit(), keys=['legend:color:items','legend:size:items'], next=edit(p,keys,'move',{dx:8,dy:6});
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
