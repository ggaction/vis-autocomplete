import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, hconcat } from 'ggaction';
import { editableGuides, moveGuide, guideMoveHistoryKey } from '../src/guide-manipulation.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { replayPrepared } from './support/prepared.js';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';

const close = (a, b) => assert.ok(Math.abs(a-b)<.26, `${a} != ${b}`);
function unit() {
  return chart().createCanvas({plot:{width:314,height:314},margin:180})
    .createData({id:'d',values:Array.from({length:12},(_,i)=>({x:i+1,y:i*2+3,g:i%2?'A':'B'}))})
    .createScatterPlot({id:'p',x:'x',y:'y',color:{field:'g',fieldType:'nominal'}})
    .createLegend({target:'p',channels:['color']})
    .createTitle({text:'Overview',subtitle:'Two regions'});
}
const cases = {
  unit,
  multiple: () => unit().removeLegend({target:'p'}).encodeSize({target:'p',field:'x',fieldType:'quantitative'}).createLegend({target:'p',channels:['color','size']}),
  multipleFacet: () => unit().removeLegend({target:'p'}).encodeSize({target:'p',field:'x',fieldType:'quantitative'}).createLegend({target:'p',channels:['color','size']}).facet({field:'g',columns:2,guides:{axes:'outer',legend:'shared'}}),
  facet: () => unit().facet({field:'g',columns:2,guides:{axes:'outer',legend:'shared'}}),
  concat: () => hconcat({programs:[{id:'a',program:unit()},{id:'b',program:unit()}],share:{color:true}}).createTitle({text:'Together'}),
};
test('move history follows native owners, not repeated facet graphics or unrelated panel titles',()=>{
  const facet=editableGuides(cases.facet());
  const x=facet.filter(t=>t.kind==='axis'&&t.channel==='x');
  assert.ok(x.length>1); assert.equal(new Set(x.map(guideMoveHistoryKey)).size,1);
  const joined=editableGuides(cases.concat());
  const title=joined.find(t=>t.key==='a/title'), subtitle=joined.find(t=>t.key==='a/subtitle');
  assert.equal(guideMoveHistoryKey(title),guideMoveHistoryKey(subtitle));
  assert.notEqual(guideMoveHistoryKey(title),guideMoveHistoryKey(joined.find(t=>t.key==='b/title')));
});
for (const [kind, make] of Object.entries(cases)) {
  test(`${kind}: small drags preserve their edge and move concrete guide bounds by the requested distance`, () => {
    const p = make();
    for (const t of editableGuides(p).filter(t=>t.movable)) {
      for (const [dx,dy] of [[6,4],[-5,-3]]) {
        const action = moveGuide(p,t,(t.bounds.left+t.bounds.right)/2+dx,(t.bounds.top+t.bounds.bottom)/2+dy,{dx,dy});
        const prepared = prepareGuidedAction(p,action,p);
        const n = editableGuides(prepared.preview).find(n=>n.key===t.key);
        close(n.bounds.left-t.bounds.left,dx); close(n.bounds.top-t.bounds.top,dy);
        assert.equal(n.config.position,t.config.position);
        assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
        assert.deepEqual(deserializeProgram(serializeProgram(prepared.preview)).graphicSpec,prepared.preview.graphicSpec);
      }
    }
  });
}
for (const position of ['top','bottom','left','right']) {
  test(`legend docked at ${position} can be nudged again and consecutive moves rebase to one edit`, () => {
    const baseline=unit(), target=editableGuides(baseline).find(t=>t.kind==='legend');
    const p=prepareGuidedAction(baseline,{method:'editLegend',args:{target:'p',channel:'color',position,alongOffset:0}},baseline).preview;
    const before=editableGuides(p).find(t=>t.key===target.key);
    const a=moveGuide(p,before,(before.bounds.left+before.bounds.right)/2+7,(before.bounds.top+before.bounds.bottom)/2+5,{dx:7,dy:5});
    // The history run replays one complete edit against its original program.
    const q=prepareGuidedAction(baseline,a,baseline).preview;
    const after=editableGuides(q).find(t=>t.key===target.key);
    close(after.bounds.left-before.bounds.left,7); close(after.bounds.top-before.bounds.top,5);
  });
}
test('large drags dock a legend to another edge and axis titles retain their valid axis sides',()=>{
  const p=unit(), target=editableGuides(p).find(t=>t.kind==='legend');
  const action=moveGuide(p,target,337,600,{dx:-200,dy:350});
  assert.equal(action.args.position,'bottom'); assert.equal(action.args.alongOffset,0);
  const axes=editableGuides(p).filter(t=>t.kind==='axis');
  for (const t of axes) {
    const a=moveGuide(p,t,t.channel==='x'?337:600,t.channel==='x'?100:337,{dx:200,dy:-300});
    assert.equal(a.args.position,t.channel==='x'?'top':'right');
    assert.ok(prepareGuidedAction(p,a,p).preview);
  }
});
