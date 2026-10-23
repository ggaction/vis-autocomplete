import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { labelPlacementCandidates } from '../src/label-placement-candidates.js';
import { createRecommendationEngine } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
const rows = [{g:'A',v:12,x:1},{g:'B',v:18,x:2},{g:'C',v:9,x:3}];
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({id:'d',values:rows});
const plots = {
 rose: () => base().createRosePlot({id:'plot',category:'g',value:'v'}),
 pie: () => base().createPiePlot({id:'plot',category:'g',value:'v'}),
 bar: () => base().createBarPlot({id:'plot',x:'g',y:'v'}),
 point: () => base().createScatterPlot({id:'plot',x:'x',y:'v'}),
};
const labeled = kind => plots[kind]().createMarkLabels({id:'labels',source:'plot',...(kind==='point'?{field:'v'}:{content:'value'}),
 placement:{anchor:kind==='point'?'center':'outsideEnd',gap:9,overflow:'allow',leader:{stroke:'#123456',strokeWidth:2}}});
for (const kind of Object.keys(plots)) test(`${kind}: named controls execute every supported placement/overflow/leader combination`, () => {
 const p=labeled(kind), rec=labelPlacementCandidates(p,p.semanticSpec.layers.find(l=>l.id==='plot'))[0];
 assert.equal(rec.label,'Edit label placement');assert.equal(rec.parameterMode,undefined);
 const ed=recommendationParameters(rec,profileDataset(p,'d')),initial=valuesFor(ed.controls);
 assert.deepEqual(ed.controls.map(c=>c.label),['Position','Gap','Overflow','Leader line']);
 assert.equal(initial.p1,9);assert.equal(ed.build(initial).placement.leader.stroke,'#123456');
 if(kind==='point') assert.deepEqual(ed.controls[0].choices.map(c=>c.value),['center']);
 else assert.equal(ed.controls[0].choices.length,5);
 for(const anchor of ed.controls[0].choices) for(const overflow of ed.controls[2].choices) for(const leader of ed.controls[3].choices) {
  const args=ed.build({...initial,p0:anchor.value,p1:12,p2:overflow.value,p3:leader.value});
  const next=p.editMarkLabelPlacement(args);
  assert.equal(next.trace.children.length,p.trace.children.length+1);
  assert.equal(next.markConfigs.labels.labelAuthoring.placement.anchor,anchor.value);
  assert.equal(next.markConfigs.labels.labelAuthoring.placement.gap,12);
  assert.equal(next.markConfigs.labels.labelAuthoring.placement.overflow,overflow.value);
 }
});

test('ranked corpus-backed rose card uses the live editor, also after faceting', () => {
 const engine=createRecommendationEngine(JSON.parse(readFileSync(new URL('../data/model.json',import.meta.url))));
 let p=labeled('rose');
 for(const facet of [false,true]) {
  if(facet) p=prepareGuidedAction(p,{method:'facet',args:{field:'g',columns:3,guides:{axes:'each',legend:'shared'}}}).authoringPreview;
  const result=engine.recommend(p,{target:'plot',group:'style',includeRevisions:true,validationMode:'deferred',limit:1000});
  const rec=result.recommendations.find(r=>r.method==='editMarkLabelPlacement'||r.args.action?.method==='editMarkLabelPlacement');
  assert.ok(rec);assert.equal(rec.parameterMode,undefined);assert.equal(rec.parameters.length,4);
  const ed=recommendationParameters(rec,profileDataset(p,'d'));
  assert.ok(prepareGuidedAction(p,{method:rec.method,args:ed.build(valuesFor(ed.controls))}).preview);
 }
});

test('collision-layout leader ownership disables a conflicting placement leader', () => {
 const p=plots.point().createMarkLabels({id:'labels',source:'plot',field:'v'})
   .layoutLabels({target:'labels',leader:{stroke:'#000000'}});
 const rec=labelPlacementCandidates(p,p.semanticSpec.layers.find(l=>l.id==='plot'))[0];
 assert.equal(rec.parameters[3].choices[1].disabled,true);
 assert.equal(rec.parameters[3].choices[0].disabled,undefined);
});
