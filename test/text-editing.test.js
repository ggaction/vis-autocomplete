import test from 'node:test';
import assert from 'node:assert/strict';
import {chart} from 'ggaction';
import {editableTextTargets,pickEditableText} from '../src/text-editing.js';
import {prepareGuideEdits} from '../src/guide-group.js';
const rows=[{x:1,y:2,g:'A'},{x:2,y:4,g:'B'},{x:3,y:7,g:'A'}];
const base=()=>chart().createCanvas({plot:{width:314,height:314},margin:170}).createData({id:'data',values:rows});
const scatter=()=>base().createScatterPlot({id:'plot',x:'x',y:'y',color:'g'}).createGuides({legend:{target:'plot',channels:['color']}}).createTitle({text:'Title',subtitle:'Subtitle'});
for(const mode of ['unit','facet','adjacent','nested'])test(`individual categorical text resolves native owners in ${mode}`,()=>{
 let p=scatter();
 if(mode==='facet'||mode==='nested')p=p.facet({field:'g',columns:2,guides:{legend:'shared'}});
 if(mode==='adjacent'||mode==='nested')p=p.createAdjacentPlot({id:'right',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{x:'x',y:'y'}},share:{color:true}});
 const targets=editableTextTargets(p);assert.ok(targets.some(t=>t.text==='A'&&t.label==='Legend item'));
 assert.ok(targets.every(t=>!/^\d/.test(t.text))); // Continuous ticks are deliberately not editable.
 for(const target of targets){
  assert.ok(target.bounds.right>target.bounds.left);
  const action=target.build('Changed\ntext');
  const next=prepareGuideEdits(p,p,[action]);
  assert.ok(JSON.stringify(next.view.graphicSpec).includes('Changed'));
  assert.equal(next.calls.some(c=>c.method==='editGraphics'),false);
 }
});
test('typed numeric categories can be edited while numeric continuous legends cannot',()=>{
 const p=base().createScatterPlot({id:'plot',x:{field:'x',fieldType:'ordinal'},y:'y',color:{field:'x',fieldType:'ordinal'}}).createGuides({legend:{target:'plot',channels:['color']}});
 assert.ok(editableTextTargets(p).some(t=>t.text==='1'&&t.label==='Category label'));
 const continuous=base().createScatterPlot({id:'plot',x:'x',y:'y',color:{field:'x',fieldType:'quantitative'}}).createGuides();
 assert.equal(editableTextTargets(continuous).some(t=>t.label==='Legend item'),false);
 assert.ok(editableTextTargets(continuous).some(t=>t.label==='Legend title'));
 for(const type of ['linear','sqrt','quantize']){
  const sized=base().createScatterPlot({id:'plot',x:'x',y:'y'}).encodeSize({target:'plot',field:'y',fieldType:'quantitative',scale:{type,...(type==='quantize'?{range:[20,60,100]}:{})}}).createGuides();
  assert.equal(editableTextTargets(sized).some(t=>t.label==='Legend item'||t.label==='Category label'),false);
 }
 const categorySize=base().createScatterPlot({id:'plot',x:'x',y:'y'}).encodeSize({target:'plot',field:'x',fieldType:'ordinal'}).createGuides();
 const first=editableTextTargets(categorySize).find(t=>t.label==='Legend item'&&t.text==='1');assert.ok(first);
 assert.ok(editableTextTargets(prepareGuideEdits(categorySize,categorySize,[first.build('First')]).view).some(t=>t.text==='First'));
});
test('mark labels and multiline category edits pick complete semantic text',()=>{
 const p=scatter().createMarkLabels({id:'labels',source:'plot',field:'g'});
 const target=editableTextTargets(p).find(t=>t.label==='Mark label'&&t.text==='B');
 const next=prepareGuideEdits(p,p,[target.build('Bee\n\n<label>')]).view;
 const edited=editableTextTargets(next).find(t=>t.text==='Bee\n\n<label>');assert.ok(edited);
 assert.equal(pickEditableText(next,(edited.bounds.left+edited.bounds.right)/2,(edited.bounds.top+edited.bounds.bottom)/2).text,edited.text);
 assert.equal(next.semanticSpec.layers.find(l=>l.id==='labels').encoding.text.field,'g');
});
test('parallel, polar and Cartesian category text are editable',()=>{
 const plots=[base().createParallelCoordinates({id:'plot',dimensions:['g','x']}),base().createRosePlot({id:'plot',category:'g',value:'y'}).createGuides(),base().createBarPlot({id:'plot',x:'g',y:{field:'y',aggregate:'sum'}}).createGuides()];
 for(const p of plots){const targets=editableTextTargets(p);assert.ok(targets.some(t=>t.label==='Category label'&&t.text==='A'));
  for(const t of targets){const next=prepareGuideEdits(p,p,[t.build('New\ntext')]);assert.ok(JSON.stringify(next.view.graphicSpec).includes('New'));}}
});
test('editing an existing multiline title retains the complete authored string',()=>{
 const p=scatter().editTitle({text:'One\n\nTwo',subtitle:'Sub\nline'});
 const titles=editableTextTargets(p).filter(t=>t.label==='Title');assert.equal(titles.length,2);
 assert.ok(titles.every(t=>t.text==='One\n\nTwo'));
 assert.ok(editableTextTargets(p).filter(t=>t.label==='Subtitle').every(t=>t.text==='Sub\nline'));
});
