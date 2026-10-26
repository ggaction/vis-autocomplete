import test from 'node:test';
import assert from 'node:assert/strict';
import {chart} from 'ggaction';
import {generateCandidates} from '../src/catalog.js';
import {profileDataset} from '../src/profile.js';
import {defaultCanvasOptions,prepareGuidedAction} from '../src/prepare.js';
import {recommendationParameters,valuesFor,activeControls} from '../web/parameters.js';
const rows=Array.from({length:18},(_,i)=>({x:i+1,y:i%4+2,g:i%2?'B':'A'}));
const fixture=()=>chart().createCanvas(defaultCanvasOptions()).createData({id:'d',values:rows})
  .createScatterPlot({id:'plot',x:'x',y:'y',color:'g'}).createGuides({legend:{target:'plot',channels:['color']}});
function editor(p,method){const profile=profileDataset(p,'d'); const rec=generateCandidates(p,{layer:p.semanticSpec.layers[0],profile}).find(r=>r.method===method); assert.ok(rec,method);return recommendationParameters(rec,profile);}

test('inline guide switches keep four groups and produce one native action with retained state',()=>{
  for(const method of ['editAxes','editXAxis','editYAxis','editLegend','editGrid','editHorizontalGrid','editVerticalGrid']){
    const p=method==='editVerticalGrid'?fixture().createVerticalGrid({}):fixture();
    const e=editor(p,method), values=valuesFor(e.controls);
    assert.ok(e.controls.length<=4);assert.equal(values.guideVisible,true);
    assert.ok(activeControls(e.controls,values).some(c=>c.key==='guideVisible'));
    // Visibility switches must be beside their scope, never on an unrelated slider.
    const headings = list => list.flatMap(c => [c, ...(c.type==='group' ? headings(c.controls) : [])]);
    const owners = headings(e.resolveControls(values));
    for (const [key,label] of [['guideVisible',method==='editLegend'?'Legend':method.endsWith('Grid')?'Grid':'Axes'],
      ['labelsVisible','Labels'],['titlesVisible',method==='editLegend'?'Title':'Titles']]) {
      if (!Object.hasOwn(values,key)) continue;
      const owner = owners.filter(c=>c.toggles?.some(t=>t.key===key));
      assert.equal(owner.length,1,key);assert.equal(owner[0].label,label,key);
    }
    const call={method,args:e.build({...values,guideVisible:false})};
    const prepared=prepareGuidedAction(p,{...call,allowUnchanged:true});
    assert.equal(prepared.recommendation.validation.topLevelActions,1);
    const next=prepared.authoringPreview, again=editor(next,method);
    assert.equal(valuesFor(again.controls).guideVisible,false,method);
    const shown=prepareGuidedAction(next,{method,args:again.build({...valuesFor(again.controls),guideVisible:true}),allowUnchanged:true}).authoringPreview;
    assert.equal(valuesFor(editor(shown,method).controls).guideVisible,true,method);
  }
});

test('individual grid width changes keep visibility independent of the slider',()=>{
  for(const method of ['editHorizontalGrid','editVerticalGrid']){
    const p=method==='editVerticalGrid'?fixture().createVerticalGrid({}):fixture();
    const e=editor(p,method), initial=valuesFor(e.controls);
    const width=activeControls(e.controls,initial).find(c=>c.path==='lineWidth');
    for(const value of [0,.25,1,1.5,4]){
      const values=e.normalizeValues({...initial,[width.key]:value,guideVisible:false},width.key);
      const controls=e.resolveControls(values);
      const slider=activeControls(controls,values).find(c=>c.key===width.key);
      assert.equal(controls[0].label,'Grid');
      assert.equal(controls[0].toggles[0].key,'guideVisible');
      assert.equal(slider.toggles,undefined);
      const args=e.build(values);
      assert.equal(args.lineWidth,value);assert.equal(args.visible,false);
      assert.doesNotThrow(()=>prepareGuidedAction(p,{method,args,allowUnchanged:true}));
    }
  }
});

test('labels can stay hidden independently of whole-guide toggles',()=>{
  for(const method of ['editXAxis','editLegend']){
    const p=fixture(),e=editor(p,method),v=valuesFor(e.controls);
    const next=prepareGuidedAction(p,{method,args:e.build({...v,labelsVisible:false}),allowUnchanged:true}).authoringPreview;
    const values=valuesFor(editor(next,method).controls);
    assert.equal(values.labelsVisible,false); assert.equal(values.guideVisible,true);
  }
});

test('every guide visibility switch has one scope heading and no numeric-property owner',()=>{
  const base=()=>chart().createCanvas(defaultCanvasOptions()).createData({id:'d',values:rows});
  const programs=[fixture(),
    base().createBarPlot({id:'plot',x:'g',y:{field:'y',aggregate:'mean'},color:'g'}),
    base().createPolarScatterPlot({id:'plot',theta:'x',radius:'y',color:'g'}),
    base().createParallelCoordinates({id:'plot',dimensions:['x','y'],color:'g'})];
  const nodes=list=>list.flatMap(c=>[c,...(c.controls?nodes(c.controls):[])]);
  const covered=new Set();
  for(const source of programs){
    const p=source.createGuides(),profile=profileDataset(p,'d');
    for(const rec of generateCandidates(p,{layer:p.semanticSpec.layers[0],profile})){
      const e=recommendationParameters(rec,profile),initial=valuesFor(e.controls);
      for(const values of [initial,e.normalizeValues(initial)]){
        const controls=nodes(e.resolveControls(values));
        const switches=controls.flatMap(c=>(c.toggles??[]).map(t=>({owner:c,...t})));
        assert.equal(new Set(switches.map(t=>t.key)).size,switches.length,rec.method);
        for(const t of switches){
          covered.add(rec.method);
          assert.notEqual(t.owner.type,'number',`${rec.method}/${t.owner.label}`);
          assert.equal(t.owner.label,t.label,`${rec.method}/${t.key}`);
          assert.notEqual(t.key,'lineVisible',rec.method);
        }
        // The same editor is used when an axis/guide edit targets a facet source.
        if(switches.length && rec.method!=='editFacetSource'){
          const wrapped=recommendationParameters({...rec,method:'editFacetSource',
            args:{action:{method:rec.method,options:rec.args}}},profile);
          assert.deepEqual(wrapped.build(values),{action:{method:rec.method,options:e.build(values)}});
        }
      }
    }
  }
  for(const method of ['editAxes','editXAxis','editYAxis','editThetaAxis','editRadialAxis','editParallelAxis',
    'editLegend','editGrid','editHorizontalGrid']) assert.ok(covered.has(method),method);
});

test('axis width stays numeric while whole axes and ticks preserve independent visibility',()=>{
  const p=fixture().editXAxis({line:{lineWidth:2,visible:false},labels:{visible:false}});
  const e=editor(p,'editXAxis'),initial=valuesFor(e.controls);
  assert.equal(Object.hasOwn(initial,'lineVisible'),false);
  const width=activeControls(e.controls,initial).find(c=>c.label==='Axis width');
  const ticks=activeControls(e.controls,initial).find(c=>c.label==='Count');
  assert.ok(width);assert.ok(ticks);
  for(const value of [0,1,3]){
    const values=e.normalizeValues({...initial,[width.key]:value,guideVisible:false,ticksVisible:false},width.key);
    const hidden=prepareGuidedAction(p,{method:'editXAxis',args:e.build(values),allowUnchanged:true}).authoringPreview;
    assert.equal(hidden.guideConfigs.axis.x.line.lineWidth,value);
    assert.equal(hidden.guideConfigs.axis.x.visibility.all,false);
    const next=editor(hidden,'editXAxis');
    const shown=prepareGuidedAction(hidden,{method:'editXAxis',
      args:next.build({...valuesFor(next.controls),guideVisible:true}),allowUnchanged:true}).authoringPreview;
    assert.equal(shown.guideConfigs.axis.x.visibility.all,true);
    assert.equal(shown.guideConfigs.axis.x.visibility.line,false,'Existing API-authored line visibility is preserved');
    assert.equal(shown.guideConfigs.axis.x.visibility.labels,false);
    assert.equal(shown.guideConfigs.axis.x.visibility.ticks,false);
  }
});
