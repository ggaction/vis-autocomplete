import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, hconcat } from 'ggaction';
import { editableGuides, resizeGuide, moveGuide } from '../src/guide-manipulation.js';
import { prepareGuidedAction } from '../src/prepare.js';
import { compositionPlotBounds } from '../vendor/ggaction/src/materialization/composition.js';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
const rows = Array.from({length:18}, (_,i)=>({x:i+1,y:i*2+1,g:['A','B','C'][i%3]}));
function unit(shape=false) {
 let p=chart().createCanvas({plot:{width:220,height:220},margin:170}).createData({id:'d',values:rows})
  .createScatterPlot({id:'p',x:'x',y:'y'}).encodeColor({target:'p',field:'g',fieldType:'nominal'});
 if(shape)p=p.encodeShape({target:'p',field:'g',fieldType:'nominal'});
 return p.createLegend({target:'p',channels:shape?['color','shape']:['color']});
}
const shared=p=>editableGuides(p).find(t=>t.key==='legend:shared-color');
for(const combined of [false,true])test(`shared legend drag and card editing reach all contributors (combined=${combined})`,()=>{
 let p=hconcat({programs:[{id:'a',program:unit()},{id:'b',program:unit(combined)}],share:{color:true}});
 const target=shared(p);assert.ok(target.movable);assert.notEqual(target.resizable,false);
 const sized=prepareGuidedAction(p,resizeGuide(target,1.4),p);p=sized.preview;
 assert.ok(shared(p).bounds.bottom-shared(p).bounds.top>target.bounds.bottom-target.bounds.top);
 const bounds=compositionPlotBounds(p), moved=prepareGuidedAction(p,moveGuide(p,shared(p),bounds.x+bounds.width/2,bounds.y+bounds.height+100),p);
 p=moved.preview;assert.ok(shared(p).bounds.top>compositionPlotBounds(p).y+compositionPlotBounds(p).height);
 // A normal option card scoped to the second chart edits the visible block too.
 const edit=prepareGuidedAction(p,{method:'editLegend',args:{target:{childPath:['b'],id:'p'},channel:'color',position:'top',labels:{fontSize:21}}},p);
 assert.equal(edit.recommendation.args.target.length,2);
 assert.equal(shared(edit.preview).config.labels.fontSize,21);
 assert.ok(shared(edit.preview).bounds.bottom<compositionPlotBounds(edit.preview).y);
 assert.deepEqual(deserializeProgram(serializeProgram(edit.preview)).graphicSpec,edit.preview.graphicSpec);
});

test('a nested shared legend remains editable through its outer contributors',()=>{
 const pair=hconcat({programs:[{id:'a',program:unit()},{id:'b',program:unit()}],share:{color:true}});
 const p=hconcat({programs:[{id:'pair',program:pair},{id:'c',program:unit()}],share:{color:true}});
 const resized=prepareGuidedAction(p,resizeGuide(shared(p),1.25),p).preview;
 assert.ok(shared(resized).config.labels.fontSize>shared(p).config.labels.fontSize);
 const edited=prepareGuidedAction(p,{method:'editLegend',args:{target:{childPath:['pair','b'],id:'p'},channel:'color',position:'bottom'}},p).preview;
 assert.ok(shared(edited).bounds.top>compositionPlotBounds(edited).y+compositionPlotBounds(edited).height);
});

test('focused legend cards edit the visible block from a non-representative child',()=>{
 let p=hconcat({programs:[{id:'a',program:unit()},{id:'b',program:unit()}],share:{color:true}});
 for(const [method,patch,check] of [
  ['editLegendLabels',{fontSize:22},g=>g.config.labels.fontSize===22],
  ['editLegendTitle',{title:'Shared series',fontSize:24},g=>g.config.title==='Shared series'&&g.config.titleStyle.fontSize===24],
  ['editLegendLayout',{position:'bottom'},g=>g.bounds.top>compositionPlotBounds(p).y+compositionPlotBounds(p).height],
 ]){
  const result=prepareGuidedAction(p,{method,args:{target:{childPath:['b'],id:'p'},channel:'color',...patch}},p);
  p=result.preview;assert.equal(result.recommendation.method,method);
  assert.equal(result.recommendation.args.target.length,2);assert.ok(check(shared(p)),method);
 }
});

test('combined shape legend edits do not target color-only contributors',()=>{
 const p=hconcat({programs:[{id:'a',program:unit()},{id:'b',program:unit(true)},{id:'c',program:unit(true)}],share:{color:true}});
 const result=prepareGuidedAction(p,{method:'editLegendLabels',args:{target:{childPath:['c'],id:'p'},channel:'shape',fontSize:24}},p);
 assert.equal(result.recommendation.args.target.length,2);
 assert.equal(shared(result.preview).config.labels.fontSize,24);
});

for(const kind of ['gradient','facet'])test(`${kind} shared legends retain direct editing`,()=>{
 const child=kind==='gradient'
  ? unit().encodeColor({target:'p',field:'x',fieldType:'quantitative'}).createGuides()
  : unit().facet({field:'g',columns:3,guides:{legend:'shared',axes:'outer'}});
 const p=hconcat({programs:[{id:'a',program:child},{id:'b',program:child}],share:{color:true}});
 const before=shared(p);assert.ok(before);
 const resized=prepareGuidedAction(p,resizeGuide(before,1.25),p).preview;
 assert.ok(shared(resized).config.labels.fontSize>before.config.labels.fontSize);
 const plot=compositionPlotBounds(resized);
 const moved=prepareGuidedAction(resized,moveGuide(resized,shared(resized),plot.x+plot.width/2,plot.y-100),resized).preview;
 assert.ok(shared(moved).bounds.bottom<compositionPlotBounds(moved).y);
 assert.deepEqual(deserializeProgram(serializeProgram(moved)).graphicSpec,moved.graphicSpec);
});
