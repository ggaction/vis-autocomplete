import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { overlayContext, overlaySpecs } from '../web/composition-controls.js';
import { valuesFor, buildRecommendationCall } from '../web/parameters.js';
const bars = () => chart().createCanvas({width:600,height:400}).createData({id:'data',values:[{x:'a',y:2},{x:'b',y:4}]}).createBarPlot({id:'plot',data:'data',x:'x',y:'y'});
test('overlay chooser offers native line and point actions and focuses each new target', () => {
 for (const nested of [false,true]) {
  const p = nested ? bars().createAdjacentPlot({id:'neighbor',source:'plot',share:{}}) : bars();
  const context = nested ? {target:'neighbor',childPath:['neighbor']} : {target:'plot'};
  const adding=overlayContext(p,context), specs=overlaySpecs({...adding,mode:'follow'});
  assert.deepEqual(specs.map(s=>s.title),['Line overlay','Point overlay']);
  for (const spec of specs) {
   assert.ok(!spec.controls.some(c=>c.label==='Overlay'));
   const call=buildRecommendationCall(spec,valuesFor(spec.controls));
   const next=p[call.method](call.args);
   const local=nested?next.children.neighbor:next;
   assert.ok(local.semanticSpec.layers.some(l=>l.id===spec.original.nextContext.target));
   assert.deepEqual(spec.original.nextContext.childPath,context.childPath??[]);
   const again=overlaySpecs({...overlayContext(next,spec.original.nextContext),mode:'follow'});
   assert.notEqual(again[0].build(valuesFor(again[0].controls)).id,call.args.id);
  }
 }
});
test('overlay chooser resolves All to a source and does not offer incompatible polar overlays',()=>{
 assert.ok(overlayContext(bars(),{scope:'all'}));
 const p=chart().createCanvas({width:600,height:400}).createData({id:'data',values:[{x:'a',y:2},{x:'b',y:4}]}).createPiePlot({id:'pie',data:'data',category:'x',value:'y',guides:false});
 assert.equal(overlayContext(p,{target:'pie'}),null);
});
test('faceted overlays edit the facet source through one native call',()=>{
 const p=bars().facet({field:'x',data:'data',columns:2});
 for(const spec of overlaySpecs({...overlayContext(p,{target:'plot'}),mode:'follow'})) {
  const call=buildRecommendationCall(spec,valuesFor(spec.controls));
  assert.equal(call.method,'editFacetSource');
  const next=p[call.method](call.args);
  assert.ok(next.semanticSpec.layers.some(l=>l.id===spec.original.nextContext.target));
  for(const cell of Object.values(next.children))assert.ok(cell.semanticSpec.layers.some(l=>l.derivedBindings?.overlay));
 }
});
