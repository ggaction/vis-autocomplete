import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { addDefaultGuides, prepareGuidedAction } from '../src/prepare.js';
import { canvasGeometry, projectCanvasGeometry, resizeCanvasAction } from '../src/canvas-geometry.js';

const rows=Array.from({length:60},(_,i)=>({x:i+10,y:i*3+50,c:['USA','Japan','Europe'][i%3]}));
function source() {
  return chart().createCanvas({plot:{width:113,height:280},margin:{left:90,right:140,top:12,bottom:190}})
    .createData({id:'d',values:rows})
    .createScatterPlot({id:'plot',data:'d',x:'x',y:'y',color:'c'})
    .encodeShape({target:'plot',field:'c',fieldType:'nominal'}).encodeSize({target:'plot',field:'x'});
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1,`${a} != ${b}`);
const centered=g=>{
  close(g.content.left,g.width-g.content.right);
  close(g.content.top,g.height-g.content.bottom);
  assert.ok(g.content.left>=0 && g.content.top>=0 && g.content.right<=g.width && g.content.bottom<=g.height);
};
for (const facet of [false,true]) for (const padded of facet?[false,true]:[false]) {
  test(`centered shrink consumes actual whitespace: facet=${facet}, outer padding=${padded}`,()=>{
    let p=source();
    if(facet) p=p.facet({field:'c',data:'d',columns:3,spacing:'plot',gap:28,guides:{axes:'outer',legend:'shared'}});
    if(padded) p=p.editCompositionLayout({padding:{left:10,right:80,top:0,bottom:100}});
    const view=addDefaultGuides(p),g=canvasGeometry(view),before=JSON.stringify(p.graphicSpec);
    assert.ok(g.height-g.content.bottom-g.content.top>100,'Reproduce excessive bottom whitespace');
    for(const dy of [-30,-80,-1000,30]) {
      const action=resizeCanvasAction(g,'canvas-s',0,dy);
      const prepared=prepareGuidedAction(p,action,view,action.setupCalls??[]),next=canvasGeometry(prepared.preview);
      centered(next);
      close(next.plot.width,g.plot.width);close(next.plot.height,g.plot.height);
      close(next.width,g.width);
      if(dy<0) assert.ok(next.height<g.height-55,'Top margin must not block shrinking bottom whitespace');
      const projected=projectCanvasGeometry(g,action);close(next.height,projected.height);
      close(next.plotBounds?.y??next.y,projected.plotBounds?.y??projected.y);
      let replay=p;
      for(const call of [...prepared.prerequisiteCalls,prepared.recommendation,...prepared.postActionCalls,prepared.guideCall]) replay=replay[call.method](call.args);
      assert.deepEqual(replay.graphicSpec,prepared.preview.graphicSpec,'Code/export replay retains native centering');
      assert.equal(JSON.stringify(p.graphicSpec),before,'Previous history is immutable');
    }
  });
}
test('newly prepared plots and later edits redistribute whitespace without changing outer dimensions',()=>{
  const p=source(),view=addDefaultGuides(p),g=canvasGeometry(view);
  const result=prepareGuidedAction(p,{method:'encodeOpacity',args:{target:'plot',value:.4}},view);
  const next=canvasGeometry(result.preview);centered(next);close(next.width,g.width);close(next.height,g.height);
  assert.equal(result.preview.trace.children.at(-1).op,'createGuides');
  assert.ok(result.postActionCalls.some(c=>c.method==='editCanvas'));
  const again=prepareGuidedAction(result.authoringPreview,{method:'encodeOpacity',args:{target:'plot',value:.6}},result.preview);
  assert.equal(again.postActionCalls.length,0,'Already centered charts do not accrue redundant layout calls');
});
