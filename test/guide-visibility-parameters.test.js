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
  for(const method of ['editAxes','editXAxis','editYAxis','editLegend','editGrid']){
    const p=fixture(), e=editor(p,method), values=valuesFor(e.controls);
    assert.ok(e.controls.length<=4);assert.equal(values.guideVisible,true);
    assert.ok(activeControls(e.controls,values).some(c=>c.key==='guideVisible'));
    const call={method,args:e.build({...values,guideVisible:false})};
    const prepared=prepareGuidedAction(p,{...call,allowUnchanged:true});
    assert.equal(prepared.recommendation.validation.topLevelActions,1);
    const next=prepared.authoringPreview, again=editor(next,method);
    assert.equal(valuesFor(again.controls).guideVisible,false,method);
    const shown=prepareGuidedAction(next,{method,args:again.build({...valuesFor(again.controls),guideVisible:true}),allowUnchanged:true}).authoringPreview;
    assert.equal(valuesFor(editor(shown,method).controls).guideVisible,true,method);
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
