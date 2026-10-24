import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { editableChartTargets, editableChartTargetGroups, scopeRecommendationCall } from '../src/composition-context.js';
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

test('target groups distinguish adjacent panels from overlays and follow visual order', () => {
 const original=bars().createOverlay({id:'overlay',source:'internal-id',type:'line'});
 const adjacent=original.createAdjacentPlot({id:'area',source:'internal-id',position:'left',share:{},
  plot:{action:'createAreaPlot',options:{x:{field:'x',fieldType:'nominal'},y:'y',guides:false}}});
 const groups=editableChartTargetGroups(adjacent);
 assert.deepEqual(groups.map(g=>g.targets.map(t=>t.label)),[['Area'],['Bar','Line']]);
 assert.deepEqual(groups.map(g=>g.childPath),[['area'],['internal-id']]);
 assert.deepEqual(groups[1].targets.map(t=>t.overlay),[false,true]);
 const line=groups[1].targets[1];
 const call=scopeRecommendationCall({method:'encodeOpacity',args:{target:line.id,value:.3}}, {anchor:line.id,targets:[line]});
 const edited=adjacent[call.method](call.args);
 assert.equal(edited.children['internal-id'].markConfigs.overlay.opacity,.3);
 assert.deepEqual(edited.children['internal-id'].markConfigs['internal-id'],adjacent.children['internal-id'].markConfigs['internal-id']);
 assert.deepEqual(edited.children.area.markConfigs,adjacent.children.area.markConfigs);
 const nested=adjacent.createAdjacentPlot({target:{childPath:['area']},id:'points',source:'area',position:'top',share:{},
  plot:{action:'createScatterPlot',options:{x:{field:'x',fieldType:'nominal'},y:'y',guides:false}}});
 assert.deepEqual(editableChartTargetGroups(nested).map(g=>g.targets.map(t=>t.label)),[['Point'],['Area'],['Bar','Line']]);
});
test('a facet remains one selectable chart group with its source overlays',()=>{
 const faceted=bars().createOverlay({id:'overlay',source:'internal-id',type:'line'}).facet({field:'x',columns:2});
 const groups=editableChartTargetGroups(faceted);
 assert.equal(groups.length,1);
 assert.deepEqual(groups[0].childPath,[]);
 assert.deepEqual(groups[0].targets.map(t=>t.label),['Bar','Line']);
});
