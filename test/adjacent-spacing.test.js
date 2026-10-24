import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { canvasGeometry } from '../src/canvas-geometry.js';
const base = color => chart().createCanvas(defaultCanvasOptions()).createData({id:'d',values:[
 {x:'First',y:2,g:'A'},{x:'Second',y:4,g:'A'},{x:'First',y:3,g:'B'},{x:'Second',y:5,g:'B'}]}).createBarPlot({id:'plot',data:'d',x:'x',y:'y',guides:false,...(color?{color:'g'}:{})});
for(const position of ['left','right'])for(const color of [false,true])test(`adjacent ${position} removes blank margins while retaining guides (color=${color})`,()=>{
 const p=base(color), action={method:'createAdjacentPlot',args:{id:'neighbor',source:'plot',position,gap:8,share:{y:true}}};
 const raw=p.createAdjacentPlot(action.args), result=prepareGuidedAction(p,action);
 assert.ok(result.preview.graphicSpec.objects.canvas.properties.width < raw.graphicSpec.objects.canvas.properties.width-150);
 assert.ok(result.postActionCalls.length>=2);
 for(const child of Object.values(result.preview.children)) {
  const g=canvasGeometry(child);assert.equal(g.plot.width,314);assert.equal(g.plot.height,314);
  assert.ok(g.content.left>=-0.5);assert.ok(g.content.right<=g.width+0.5);
 }
 let replay=p;for(const c of result.prerequisiteCalls)replay=replay[c.method](c.args);
 replay=replay[action.method](action.args);for(const c of result.postActionCalls)replay=replay[c.method](c.args);
 replay=replay.createGuides(result.guideCall.args);
 assert.deepEqual(replay.graphicSpec,result.preview.graphicSpec);
});
test('vertical insertion retains its existing margins',()=>{
 const p=base(false),result=prepareGuidedAction(p,{method:'createAdjacentPlot',args:{id:'neighbor',source:'plot',position:'bottom',share:{}}});
 assert.ok(!result.postActionCalls.some(c=>c.method==='editCanvas'));
});
