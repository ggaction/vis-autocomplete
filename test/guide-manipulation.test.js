import { replayPrepared } from './support/prepared.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { editableGuides, resizeGuide, moveGuide, guideBounds } from '../src/guide-manipulation.js';
import { prepareGuidedAction, addDefaultGuides } from '../src/prepare.js';
import { canvasGeometry } from '../src/canvas-geometry.js';
const rows=Array.from({length:12},(_,i)=>({x:i+1,y:i*2+3,g:['A','B','C'][i%3]}));
const base=()=>chart().createCanvas({plot:{width:314,height:314},margin:170}).createData({id:'dataset',values:rows})
 .createScatterPlot({id:'plot',x:'x',y:'y'}).encodeColor({target:'plot',field:'g',fieldType:'nominal'})
 .createGuides({legend:{target:'plot',channels:['color']}}).createTitle({text:'Sales overview',subtitle:'Three regions',titleStyle:{fontSize:23},subtitleStyle:{fontSize:15}});
for(const faceted of [false,true])test(`native guide resizing and movement${faceted?' with facets':''}`,()=>{
 let p=base();if(faceted)p=p.facet({field:'g',columns:3,guides:{legend:'shared',axes:'outer'}});
 const targets=editableGuides(p),before=JSON.stringify(p.graphicSpec);
 assert.ok(targets.some(t=>t.kind==='legend'));assert.ok(targets.some(t=>t.kind==='axis'));assert.ok(targets.some(t=>t.key==='title-group'));
 for(const target of targets)for(const factor of [.8,1.4]){
  const action=resizeGuide(target,factor),next=prepareGuidedAction(p,action,p).preview;
  const b=guideBounds(next,target.ids);assert.ok(b&&b.right>b.left);
  if(target.key==='title')assert.equal(next.titleConfig.subtitleStyle.fontSize,15);
  if(target.key==='subtitle')assert.equal(next.titleConfig.titleStyle.fontSize,23);
 }
 const g=canvasGeometry(p),r=g.plotBounds??{x:g.x,y:g.y,...g.plot};
 for(const target of targets.filter(t=>t.movable))for(const [position,x,y] of [
  ['top',r.x+r.width/2,r.y-80],['bottom',r.x+r.width/2,r.y+r.height+80],
  ['left',r.x-80,r.y+r.height/2],['right',r.x+r.width+80,r.y+r.height/2]]){
  const action=moveGuide(p,target,x,y);assert.equal(action.args.position,position);
  assert.ok(prepareGuidedAction(p,action,p).preview);
 }
 assert.equal(JSON.stringify(p.graphicSpec),before);
});
for(const family of ['color','size','opacity','stroke','shape'])test(`${family} legend size edits preserve native encodings`,()=>{
 let p=base();if(family!=='color')p=p[`encode${family[0].toUpperCase()+family.slice(1)}`]({target:'plot',field:['shape','stroke'].includes(family)?'g':'x'})
  .createGuides({legend:{target:'plot',channels:[family]}});
 const before=p.semanticSpec.layers.find(l=>l.id==='plot').encoding;
 for(const target of editableGuides(p).filter(t=>t.kind==='legend')){
  const next=prepareGuidedAction(p,resizeGuide(target,1.3),p).preview;
  assert.deepEqual(next.semanticSpec.layers.find(l=>l.id==='plot').encoding,before);
 }
});

test('a displayed-only facet legend is promoted through the composition owner before editing',()=>{
 const program=chart().createCanvas({plot:{width:314,height:314},margin:100})
  .createData({id:'dataset',values:rows}).createScatterPlot({id:'plot',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}})
  .facet({field:'g',columns:3,guides:{legend:'shared',axes:'outer'}});
 const view=addDefaultGuides(program,{method:'createGuides',args:{legend:{target:'plot',channels:['color']}}});
 const legend=editableGuides(view).find(t=>t.kind==='legend');
 for(const action of [resizeGuide(legend,1.4),{method:'editLegend',args:{target:'plot',channel:'color',position:'bottom'}}]){
  const result=prepareGuidedAction(program,action,view);
  assert.ok(result.prerequisiteCalls.some(c=>c.method==='createGuides' && c.args.legend));
  const replay = replayPrepared(result);
  assert.deepEqual(replay.graphicSpec,result.preview.graphicSpec);
  assert.ok(result.preview.guideConfigs.legend.color);
  assert.equal(result.recommendation.method,'editLegend');
 }
});

test('moving an already edited facet legend preserves its owned typography',()=>{
 const program=chart().createCanvas({plot:{width:314,height:314},margin:100})
  .createData({id:'dataset',values:rows}).createScatterPlot({id:'plot',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}})
  .createTitle({text:'Overview'}).facet({field:'g',columns:3,guides:{legend:'shared'}});
 const view=addDefaultGuides(program);
 const resized=prepareGuidedAction(program,resizeGuide(editableGuides(view).find(t=>t.kind==='legend'),1.4),view);
 const titled=prepareGuidedAction(resized.authoringPreview,{method:'editTitle',args:{position:'bottom'}},resized.preview);
 const moved=prepareGuidedAction(titled.authoringPreview,{method:'editLegend',args:{target:'plot',channel:'color',position:'bottom'}},titled.preview);
 assert.equal(moved.preview.guideConfigs.legend.color.labels.fontSize,resized.preview.guideConfigs.legend.color.labels.fontSize);
 assert.equal(moved.prerequisiteCalls.some(c=>c.method==='editFacetGuides'),false);
});

test('polar and parallel axis titles use native per-axis editors',()=>{
 const source=chart().createCanvas({plot:{width:314,height:314},margin:160}).createData({id:'dataset',values:rows});
 for(const program of [source.createRosePlot({id:'plot',category:'g',value:'y'}).createGuides(),
  source.createParallelCoordinates({id:'plot',dimensions:['x','y']}).createGuides()]){
  const titles=editableGuides(program).filter(t=>t.kind==='axis');
  assert.equal(titles.length,2);
  for(const target of titles){
   const action=resizeGuide(target,1.3), result=prepareGuidedAction(program,action,program).preview;
   assert.ok(guideBounds(result,target.ids));
   assert.notDeepEqual(guideBounds(result,target.ids),target.bounds);
  }
 }
});

for (const channel of ['color', 'stroke']) for (const faceted of [false, true]) {
 test(`${channel} gradient resizing changes the strip and typography${faceted ? ' in facets' : ''}`, () => {
  let program = chart().createCanvas({plot:{width:314,height:314},margin:170})
   .createData({id:'dataset',values:rows}).createScatterPlot({id:'plot',x:'x',y:'y'})
   [`encode${channel[0].toUpperCase()+channel.slice(1)}`]({target:'plot',field:'x',fieldType:'quantitative'});
  if (faceted) program = program.facet({field:'g',columns:3,guides:{legend:'shared'}});
  const view = addDefaultGuides(program), target = editableGuides(view).find(t=>t.kind==='legend');
  assert.equal(target.representation, 'gradient');
  for (const factor of [.7, 1.5]) {
   const action = resizeGuide(target,factor);
   assert.equal('itemGap' in action.args,false);
   const result = prepareGuidedAction(program,action,view), config = result.preview.guideConfigs.legend[target.family];
   assert.equal(config.gradient.length,target.config.gradient.length*factor);
   assert.equal(config.gradient.thickness,Math.round(target.config.gradient.thickness*factor*4)/4);
   assert.ok(factor<1 ? config.labels.fontSize<target.config.labels.fontSize : config.labels.fontSize>target.config.labels.fontSize);
   const bounds=guideBounds(result.preview,target.ids);
   assert.ok(factor<1 ? bounds.bottom-bounds.top<target.bounds.bottom-target.bounds.top : bounds.bottom-bounds.top>target.bounds.bottom-target.bounds.top);
   assert.deepEqual(result.authoringPreview.semanticSpec.layers.find(l=>l.id==='plot').encoding,program.semanticSpec.layers.find(l=>l.id==='plot').encoding);
  }
 });
}

test('symbol representation of a continuous color legend resizes its symbols instead of a gradient',()=>{
 const program=chart().createCanvas({plot:{width:314,height:314},margin:170})
  .createData({id:'dataset',values:rows}).createScatterPlot({id:'plot',x:'x',y:'y',color:{field:'x',fieldType:'quantitative'}})
  .createGuides().editLegend({target:'plot',channel:'color',representation:'symbols'});
 const target=editableGuides(program).find(t=>t.kind==='legend');
 assert.equal(target.representation,'sampled');
 const action=resizeGuide(target,1.5), next=prepareGuidedAction(program,action,program).preview;
 assert.ok(!('gradient' in action.args));
 assert.ok(next.guideConfigs.legend.gradient.itemGap>target.config.itemGap);
 assert.ok(next.guideConfigs.legend.gradient.labels.fontSize>target.config.labels.fontSize);
});

test('a move rebased to its run baseline retains the current legend title placement',()=>{
 const baseline=base().editLegend({target:'plot',channel:'color',position:'bottom',titlePosition:'left'});
 const before=editableGuides(baseline).find(t=>t.kind==='legend');
 const geom=canvasGeometry(baseline), p={x:geom.x,y:geom.y,...geom.plot};
 const side=prepareGuidedAction(baseline,moveGuide(baseline,before,p.x+p.width+100,p.y+p.height/2),baseline).preview;
 assert.equal(side.guideConfigs.legend.color.titlePosition,'top');
 const target=editableGuides(side).find(t=>t.kind==='legend');
 const g=canvasGeometry(side), r={x:g.x,y:g.y,...g.plot};
 const action=moveGuide(side,target,r.x+r.width/2,r.y-100);
 const result=prepareGuidedAction(baseline,action,baseline).preview;
 assert.equal(result.guideConfigs.legend.color.blockOverrides['["color"]'].position,'top');
 assert.equal(result.guideConfigs.legend.color.titlePosition,'top');
});
