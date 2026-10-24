import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { editableGuides, removeGuide } from '../src/guide-manipulation.js';
import { removableChartPanels } from '../src/chart-removal.js';
import { addDefaultGuides, prepareGuidedAction } from '../src/prepare.js';
import { replayPrepared } from './support/prepared.js';
import { historyShortcut } from '../web/history-shortcuts.js';

const base = () => chart().createCanvas({plot:{width:260,height:260},margin:100})
  .createData({id:'dataset',values:[{x:1,y:2,g:'A'},{x:2,y:3,g:'B'}]})
  .createScatterPlot({id:'plot',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}})
  .createTitle({text:'Overview',subtitle:'Regions'});
const adjacent = p => p.createAdjacentPlot({id:'chart2',source:'plot',position:'right',
  plot:{action:'createScatterPlot',options:{x:'x',y:'y'}}});

for (const mode of ['unit','facet','concat']) test(`direct guide deletion uses replayable native calls in ${mode}`, () => {
  let p=base();
  if(mode==='facet')p=p.facet({field:'g',columns:2,guides:{axes:'outer',legend:'shared'}});
  if(mode==='concat')p=adjacent(p).createTitle({text:'Shared heading'});
  const view=addDefaultGuides(p), original=JSON.stringify(view.graphicSpec);
  for(const target of editableGuides(view).filter(t=>t.kind!=='legend'||t.part)) {
    const action=removeGuide(target), result=prepareGuidedAction(p,action,view);
    assert.deepEqual(replayPrepared(result).graphicSpec,result.preview.graphicSpec);
    const remaining=editableGuides(result.preview).map(t=>t.key);
    assert.ok(!remaining.includes(target.key), `${target.key} is removed, including after createGuides`);
    assert.equal(JSON.stringify(view.graphicSpec),original);
    if(target.key.endsWith('subtitle'))assert.ok(remaining.some(key=>key.endsWith('title')));
  }
});

test('concat panels shrink without deleting the other chart or leaving a blank cell',()=>{
  const p=adjacent(base()), view=addDefaultGuides(p), panels=removableChartPanels(view);
  assert.equal(panels.length,2);
  for(const panel of panels){
    const result=prepareGuidedAction(p,panel.remove,view);
    assert.equal(result.preview.compositionSpec.children.length,1);
    assert.equal(removableChartPanels(result.preview).length,0);
    assert.ok(result.preview.graphicSpec.objects.canvas.properties.width<view.graphicSpec.objects.canvas.properties.width);
    assert.deepEqual(replayPrepared(result).graphicSpec,result.preview.graphicSpec);
  }
});

test('nested final-child removal deletes its one-child container, preserving siblings',()=>{
  let p=adjacent(base());
  p=p.createAdjacentPlot({id:'chart3',source:{childPath:['plot'],id:'plot'},position:'bottom',plot:{action:'createScatterPlot',options:{x:'x',y:'y'}}});
  for(const panel of removableChartPanels(p)){
    const result=prepareGuidedAction(p,panel.remove,addDefaultGuides(p));
    assert.deepEqual(replayPrepared(result).graphicSpec,result.preview.graphicSpec);
  }
});

test('history shortcuts cover both platforms and preserve text editing',()=>{
  const event=(key,extras={})=>({key,ctrlKey:true,...extras});
  assert.equal(historyShortcut(event('z')),'undo');
  assert.equal(historyShortcut(event('Z',{shiftKey:true})),'redo');
  assert.equal(historyShortcut(event('y')),'redo');
  assert.equal(historyShortcut(event('z',{ctrlKey:false,metaKey:true})),'undo');
  assert.equal(historyShortcut(event('ㅋ',{code:'KeyZ'})),'undo');
  for(const extras of [{ctrlKey:false},{altKey:true},{isComposing:true},{defaultPrevented:true},
    {target:{isContentEditable:true}}, {target:{closest:selector=>selector==='input'?{type:'text'}:null}}]) {
    assert.equal(historyShortcut(event('z',extras)),null);
  }
  assert.equal(historyShortcut(event('z',{target:{closest:selector=>selector==='input'?{type:'range'}:null}})),'undo');
});

test('polar and parallel axis title removal preserves their other axis components',()=>{
  const source=chart().createCanvas({plot:{width:260,height:260},margin:140})
    .createData({id:'dataset',values:[{x:1,y:2,g:'A'},{x:2,y:3,g:'B'}]});
  for(const p of [source.createRosePlot({id:'plot',category:'g',value:'y'}),
    source.createParallelCoordinates({id:'plot',dimensions:['x','y']})]) {
    const view=addDefaultGuides(p);
    for(const target of editableGuides(view).filter(t=>t.kind==='axis')) {
      const result=prepareGuidedAction(p,removeGuide(target),view);
      assert.ok(!editableGuides(result.preview).some(t=>t.key===target.key));
      assert.deepEqual(replayPrepared(result).graphicSpec,result.preview.graphicSpec);
    }
  }
});
