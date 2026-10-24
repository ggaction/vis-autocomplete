import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { adjacentContext, adjacentSpecs } from '../web/composition-controls.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { readFileSync } from 'node:fs';
import { prepareGuidedAction } from '../src/prepare.js';
import { editableChartTargets } from '../src/composition-context.js';
const engine=createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json',import.meta.url))));
test('third and fourth charts can use summarized child data with original import type hints',()=>{
 let p=chart().createCanvas({plot:{width:314,height:314},margin:{left:170,right:216,top:42,bottom:74}})
 .createData({id:'d',values:[{x:'a',y:2,name:'first'},{x:'b',y:5,name:'second'}]})
 .createBarPlot({id:'plot',data:'d',x:'x',y:'y'})
 .createSummaryData({id:'summary',source:'d',groupBy:['x'],aggregates:[{op:'mean',field:'y',as:'y'}]})
 .createAdjacentPlot({id:'second',source:'plot',plot:{action:'createLinePlot',options:{data:'summary',x:'x',y:'y'}}});
 let context={target:'second',childPath:['second']};
 for(let count=3;count<=4;count++) {
  const adding=adjacentContext(p,context,'right',{x:'nominal',y:'quantitative',name:'nominal'});
  assert.deepEqual(adding.profile.fields.map(f=>f.name).sort(),['x','y']);
  const spec=adjacentSpecs(engine,adding,p).find(s=>s.build(s.values).plot.action==='createLinePlot');assert.ok(spec);
  p=prepareGuidedAction(p,{method:spec.method,args:spec.build(spec.values)},p,spec.setup?.(spec.values)??[]).authoringPreview;
  context=spec.original.nextContext;assert.equal(editableChartTargets(p).length,count);
 }
});

test('matching inherited color palettes share one native legend, explicit palette changes stay independent', () => {
 const p=chart().createCanvas({plot:{width:314,height:314},margin:{left:170,right:216,top:42,bottom:74}})
  .createData({id:'d',values:[{x:'a',y:2,g:'one'},{x:'b',y:3,g:'one'},{x:'a',y:4,g:'two'},{x:'b',y:5,g:'two'}]})
  .createBarPlot({id:'plot',data:'d',x:'x',y:'y',color:'g',guides:false}).editColorScale({target:'plot',palette:'set1'});
 const adding=adjacentContext(p,{target:'plot'},'right');
 const spec=adjacentSpecs(engine,adding,p).find(s=>s.build(s.values).plot.action==='createLinePlot');
 assert.equal(spec.values.palette,'set1');
 const args=spec.build(spec.values);assert.equal(args.share.color,true);
 const result=prepareGuidedAction(p,{method:spec.method,args},p,spec.setup?.(spec.values)??[]).preview;
 assert.ok(result.graphicSpec.objects['composition-shared-color-legend']);
 const independent=spec.build({...spec.values,palette:'tableau10'});assert.equal(independent.share.color,undefined);
});
