import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { editableChartTargets } from '../src/composition-context.js';
const bars = () => chart().createCanvas({width:600,height:400}).createData({id:'d',values:[{x:'a',y:2},{x:'b',y:4}]}).createBarPlot({id:'internal-id',data:'d',x:'x',y:'y',guides:false});
test('target names describe mark types, without exposing internal IDs',()=>{
 const p=bars().createOverlay({id:'overlay',source:'internal-id',type:'line'}).createOverlay({id:'another-id',source:'internal-id',type:'point'});
 assert.deepEqual(editableChartTargets(p).map(t=>t.label),['Bar','Line','Point']);
 assert.deepEqual(editableChartTargets(p).map(t=>t.id),['internal-id','overlay','another-id']);
});
test('repeated types are numbered across overlays and adjacent panels',()=>{
 const p=bars().createOverlay({id:'a',source:'internal-id',type:'line'}).createOverlay({id:'b',source:'internal-id',type:'line'});
 assert.deepEqual(editableChartTargets(p).map(t=>t.label),['Bar','Line 1','Line 2']);
 const adjacent=bars().createAdjacentPlot({id:'neighbor',source:'internal-id',share:{},plot:{action:'createBarPlot',options:{x:'x',y:'y',guides:false}}});
 assert.deepEqual(editableChartTargets(adjacent).map(t=>t.label),['Bar 1','Bar 2']);
});
