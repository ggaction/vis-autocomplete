import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, hconcat } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { editableGuides, selectableGuides, moveGuide } from '../src/guide-manipulation.js';
import { guideDragTarget, manipulationCalls, prepareGuideEdits } from '../src/guide-group.js';
import { canvasGeometry } from '../src/canvas-geometry.js';
import { compositionPlotBounds } from '../vendor/ggaction/src/materialization/composition.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { replayPrepared } from './support/prepared.js';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
const base = () => chart().createCanvas({ plot: { width: 314, height: 314 }, margin: 180 })
  .createData({ id: 'd', values: Array.from({ length: 18 }, (_, i) => ({ x: i+1, y: 2*i+3, g: ['Alpha','Beta','Gamma'][i%3] })) })
  .createScatterPlot({ id: 'p', x: 'x', y: 'y', color: { field:'g', fieldType:'nominal' } })
  .createLegend({ target: 'p', channels:['color'], columns:1 })
  .createTitle({ text:'Overview', subtitle:'Details' });
const plot = p => p.compositionSpec ? compositionPlotBounds(p) : (()=>{const g=canvasGeometry(p);return {x:g.x,y:g.y,...g.plot};})();
function dock(p, target, side) {
  const b=plot(p), x=side==='left'?b.x-70:side==='right'?b.x+b.width+70:b.x+b.width/2;
  const y=side==='top'?b.y-90:side==='bottom'?b.y+b.height+90:b.y+b.height/2;
  const dx=x-(target.bounds.left+target.bounds.right)/2, dy=y-(target.bounds.top+target.bounds.bottom)/2;
  return moveGuide(p,target,x,y,{dx,dy,snapDistance:32});
}
for(const kind of ['unit','facet','concat','nested']) test(`${kind}: legend docking resets old columns, reflows, then returns to one side column`,()=>{
  let p=base();
  if(kind==='facet') p=p.facet({field:'g',columns:3,guides:{legend:'shared',axes:'outer'}});
  if(kind==='concat'||kind==='nested')p=hconcat({programs:[{id:'a',program:p},{id:'b',program:base()}],share:{color:true}});
  if(kind==='nested')p=hconcat({programs:[{id:'inner',program:p},{id:'c',program:base()}],share:{color:true}});
  for(const side of ['bottom','left','top','right']) {
    const t=editableGuides(p).find(t=>t.kind==='legend'&&!t.part), action=dock(p,t,side);
    const args=action.args;
    assert.equal(args.position,side);assert.equal(args.alongOffset,0);
    assert.equal(args.columns,side==='top'||side==='bottom'?3:1);
    const result=prepareGuidedAction(p,action,p), next=result.preview;
    assert.deepEqual(replayPrepared(result).graphicSpec,next.graphicSpec);
    assert.deepEqual(deserializeProgram(serializeProgram(next)).graphicSpec,next.graphicSpec);
    const n=editableGuides(next).find(n=>n.key===t.key);
    assert.equal(n.placement?.position??n.config.position,side);
    assert.equal(n.config.direction,['top','bottom'].includes(side)?'horizontal':'vertical');
    assert.ok((n.bounds.right-n.bounds.left > n.bounds.bottom-n.bounds.top) === ['top','bottom'].includes(side));
    p=next;
  }
});
test('a large same-edge title or legend drag resets offsets; small drags keep continuous positioning',()=>{
  let p=base().editTitle({offset:70,alongOffset:40}).editLegend({target:'p',channel:'color',offset:100,alongOffset:30});
  for(const t of editableGuides(p).filter(t=>t.key==='title'||t.key==='legend:color')) {
    const side=t.kind==='title'?'top':'right', action=dock(p,t,side);
    assert.equal(action.args.alongOffset,0);assert.ok(action.args.offset<70);
    const next=prepareGuidedAction(p,action,p).preview, n=editableGuides(next).find(n=>n.key===t.key);
    const fine=moveGuide(next,n,(n.bounds.left+n.bounds.right)/2+4,(n.bounds.top+n.bounds.bottom)/2+3,{dx:4,dy:3});
    assert.equal(fine.args.position,side);assert.notEqual(fine.args.alongOffset,0);
  }
});
test('unselected legend body/title drags resolve to the whole owner; explicit item selection stays independent',()=>{
  const guides=selectableGuides(base()), body=guides.find(t=>t.legendPart==='items'), title=guides.find(t=>t.legendPart==='title');
  for(const part of [body,title])assert.equal(guideDragTarget(guides,new Set(),part).key,part.legendKey);
  assert.equal(guideDragTarget(guides,new Set([body.key]),body),body);
});
for(const kind of ['unit','facet','concat'])test(`${kind}: selecting multiple legends does not disable docking`,()=>{
  let p=base().encodeSize({target:'p',field:'x'}).createLegend({target:'p',channels:['size']});
  if(kind==='facet')p=p.facet({field:'g',columns:3,guides:{legend:'shared',axes:'outer'}});
  if(kind==='concat')p=hconcat({programs:[{id:'a',program:p},{id:'b',program:p}],share:{color:true}});
  const targets=editableGuides(p).filter(t=>t.kind==='legend'&&!t.part), b=plot(p);
  const x=targets.reduce((s,t)=>s+(t.bounds.left+t.bounds.right)/2,0)/targets.length;
  const y=targets.reduce((s,t)=>s+(t.bounds.top+t.bounds.bottom)/2,0)/targets.length;
  const calls=manipulationCalls(p,targets,'move',{dx:b.x+b.width/2-x,dy:b.y+b.height+150-y});
  assert.ok(calls.every(c=>c.args.position==='bottom'));
  const result=prepareGuideEdits(p,p,calls);
  for(const t of editableGuides(result.view).filter(t=>t.kind==='legend'&&!t.part))assert.equal(t.placement?.position??t.config.position,'bottom');
});
test('gradient docking replaces explicit vertical orientation with horizontal and reverses on a side',()=>{
  const p=base().removeLegend({target:'p'}).encodeColor({target:'p',field:'x',fieldType:'quantitative'}).createLegend({target:'p',channels:['color'],direction:'vertical'});
  for(const side of ['bottom','top','left','right']) {
    const t=editableGuides(p).find(t=>t.kind==='legend'&&!t.part), a=dock(p,t,side);
    assert.equal(a.args.columns,undefined);
    const next=prepareGuidedAction(p,a,p).preview;
    assert.equal(next.guideConfigs.legend.gradient.gradientDirection,['top','bottom'].includes(side)?'horizontal':'vertical');
  }
});
test('the Adjust legend card uses the same packing policy after a previous one-column edit',()=>{
  const p=base(), profile=profileDataset(p,'d'), layer=p.semanticSpec.layers.find(l=>l.id==='p');
  const rec=generateCandidates(p,{layer,profile}).find(c=>c.method==='editLegend');
  const editor=recommendationParameters(rec,profile), values=valuesFor(editor.controls);
  const args=editor.build({...values,position:'bottom'});
  assert.equal(args.direction,'horizontal');assert.equal(args.columns,3);
  const next=prepareGuidedAction(p,{method:'editLegend',args},p).preview;
  assert.equal(next.guideConfigs.legend.color.columns,3);
});

test('a selected subset of legend blocks docks without moving the remaining block',()=>{
 const p=base().encodeSize({target:'p',field:'x'}).encodeOpacity({target:'p',field:'y'}).createLegend({target:'p',channels:['size','opacity']});
 const all=editableGuides(p).filter(t=>t.kind==='legend'&&!t.part), targets=all.filter(t=>t.channels[0]!=='opacity'), b=plot(p);
 const dx=b.x+b.width/2-(targets[0].bounds.left+targets[0].bounds.right)/2,dy=b.y+b.height+150-(targets[0].bounds.top+targets[0].bounds.bottom)/2;
 const calls=manipulationCalls(p,targets,'move',{dx,dy});
 const result=prepareGuideEdits(p,p,calls);
 const legends=editableGuides(result.view).filter(t=>t.kind==='legend'&&!t.part);
 for(const t of legends) assert.equal(t.placement?.position??t.config.position,t.channels[0]==='opacity'?'right':'bottom');
});
test('mixed continuous and categorical legend groups retain native orientations',()=>{
 const p=base().encodeSize({target:'p',field:'x'}).createLegend({target:'p',channels:['size']})
  .removeLegend({target:'p',channels:['color']}).encodeColor({target:'p',field:'y',fieldType:'quantitative'}).createLegend({target:'p',channels:['color'],direction:'vertical'});
 const targets=editableGuides(p).filter(t=>t.kind==='legend'&&!t.part), b=plot(p);
 const dx=b.x+b.width/2-(targets[0].bounds.left+targets[0].bounds.right)/2,dy=b.y+b.height+200-(targets[0].bounds.top+targets[0].bounds.bottom)/2;
 const next=prepareGuideEdits(p,p,manipulationCalls(p,targets,'move',{dx,dy})).view;
 assert.equal(next.guideConfigs.legend.gradient.gradientDirection,'horizontal');
 assert.equal(next.guideConfigs.legend.size.direction,'horizontal');
 assert.ok((next.guideConfigs.legend.size.columns??2)>1);
});

test('a nudge after docking preserves the new columns when coalesced against the original history state',()=>{
 const p=base(), t=editableGuides(p).find(t=>t.key==='legend:color');
 const q=prepareGuidedAction(p,dock(p,t,'bottom'),p).preview;
 const n=editableGuides(q).find(t=>t.key==='legend:color');
 const action=moveGuide(q,n,(n.bounds.left+n.bounds.right)/2+5,(n.bounds.top+n.bounds.bottom)/2+4,{dx:5,dy:4});
 const next=prepareGuidedAction(p,action,p).preview, result=editableGuides(next).find(t=>t.key===n.key);
 assert.equal(next.guideConfigs.legend.color.columns,3);assert.equal(next.guideConfigs.legend.color.direction,'horizontal');
 assert.ok(Math.abs(result.bounds.left-n.bounds.left-5)<.3);assert.ok(Math.abs(result.bounds.top-n.bounds.top-4)<.3);
});
