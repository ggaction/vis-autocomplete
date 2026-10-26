import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { getMarkItems } from 'ggaction/inspection';
import { renderToSVG } from 'ggaction/svg';
import { createTransitionScene } from 'ggaction/scene';
import { profileDataset, createRecommendationEngine } from '../src/index.js';
import { getPlotDefinitions, defaultValues } from '../src/plot-catalog.js';
import { highlightCandidates } from '../src/highlight-candidates.js';
import { recommendationParameters } from '../web/parameters.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { actionFeatures, extractFeatures } from '../src/semantics.js';
import { selectableMarks, markSelectionCall } from '../src/mark-picking.js';
import { replayPrepared } from './support/prepared.js';

const rows = Array.from({length:24},(_,i)=>({X:i+1,Y:i%7+2,Z:i*2+1,Group:['A','B','C'][i%3]}));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:rows});
const definitions = getPlotDefinitions(profileDataset(base(),'data'));
for (const def of definitions) test(`highlight is available and editable for ${def.method}`, () => {
  assert.equal(def.requirement,null);
  const p=base()[def.method](def.build(defaultValues(def)));
  const layer=p.semanticSpec.layers.find(l=>l.id==='plot')??p.semanticSpec.layers[0];
  const rec=highlightCandidates(p,layer)[0]; assert.ok(rec, 'Every complete native mark must expose a highlight candidate');
  const editor=recommendationParameters(rec,profileDataset(p,layer.data));
  const h=p.highlightMarks(editor.build(editor.values));
  assert.match(renderToSVG(h),/#dc2626/); assert.ok(createTransitionScene(h,{format:'canvas'}));
  const byRow=p.highlightMarks({id:'rowCheck',target:layer.id,select:{rows:{data:'data',indices:[0]}},color:'#ff00ff'});
  assert.match(renderToSVG(byRow),/#ff00ff/, 'Source row provenance must reach every chart family');
  const painted=getMarkItems(byRow,{target:layer.id}).filter(i=>i.target===layer.id&&i.geometry.some(g=>g.properties.fill==='#ff00ff'||g.properties.stroke==='#ff00ff'));
  assert.ok(painted.length);assert.ok(painted.every(i=>i.rows.some(r=>r.data==='data'&&r.index===0)), 'Paint and source-row identity must remain aligned after bring-to-front');
  assert.ok(extractFeatures(h).includes('action.highlightMarks'));
  assert.deepEqual(h.removeMarkHighlight({selection:rec.args.id}).graphicSpec,p.graphicSpec,'Removing a highlight must restore the complete native baseline');
  for(const g of rec.highlightContext.grains)for(const source of g.sources){
    const v=editor.normalizeValues({...editor.values,grain:g.grain,source:source.key},'source');
    for(const op of source.numeric?['max','min','range','gte','lte','eq','neq','oneOf']:['oneOf','eq','neq']) {
      const args=editor.build({...v,op});assert.doesNotThrow(()=>p.highlightMarks(args),`${source.key} / ${op}`);
    }
  }
});

test('native highlight evidence survives training and becomes an issued recommendation',()=>{
  const model=JSON.parse(readFileSync(new URL('../data/model.json',import.meta.url)));
  assert.deepEqual(actionFeatures('highlightMarks'),['action.highlightMarks']);
  assert.equal(model.featureCounts['action.highlightMarks'],10);
  assert.ok(Object.keys(model.pairCounts).some(k=>k.includes('action.highlightMarks')));
  const p=base().createScatterPlot({id:'plot',x:'X',y:'Y'});
  const result=createRecommendationEngine(model).recommend(p,{target:'plot',includeRevisions:true,limit:1000});
  const rec=result.recommendations.find(r=>r.method==='highlightMarks');assert.ok(rec);assert.ok(rec.score>0);
  const e=recommendationParameters(rec,profileDataset(p,'data'));
  const prepared=prepareGuidedAction(p,{method:rec.method,args:e.build(e.values)},p);
  assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
});

for(const kind of ['unit','facet','concat']) test(`direct row selection uses native replayable scopes in ${kind}`,()=>{
  let p=base().createScatterPlot({id:'plot',x:'X',y:'Y'});
  if(kind==='facet')p=p.facet({field:'Group',data:'data',columns:3});
  if(kind==='concat')p=p.createAdjacentPlot({id:'right',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{x:'X',y:'Z'}}});
  const groups=selectableMarks(p);assert.ok(groups.length);
  for(const group of groups){
    assert.ok(group.items.every(i=>Number.isFinite(i.bounds.left)));
    const indices=group.items[0].rows.filter(r=>r.data===group.data).map(r=>r.index);
    const prepared=prepareGuidedAction(p,markSelectionCall(group,indices),p);
    assert.match(renderToSVG(prepared.preview),/#dc2626/);
    assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
  }
});

test('revising highlight never creates a duplicate selection and remove restores paint',()=>{
  const p=base().createScatterPlot({id:'plot',x:'X',y:'Y'});
  const rec=highlightCandidates(p,p.semanticSpec.layers[0])[0];let h=p;
  for(const color of ['red','blue','green'])h=h.highlightMarks({...rec.args,color});
  assert.equal(Object.keys(h.materializationConfigs.highlights).length,1);
  assert.deepEqual(h.removeMarkHighlight({selection:rec.args.id}).graphicSpec,p.graphicSpec);
  assert.equal(getMarkItems(h,{target:'plot'}).length,rows.length);
});


test('facet recommendations use all cell item capabilities and highlights keep click positions stable',()=>{
  const model=JSON.parse(readFileSync(new URL('../data/model.json',import.meta.url)));
  const p=base().createScatterPlot({id:'plot',x:'X',y:'Y',color:'Group'}).facet({field:'Group',data:'data',columns:3});
  const rec=createRecommendationEngine(model).recommend(p,{target:'plot',includeRevisions:true,group:'style',limit:1000}).recommendations.find(r=>r.sourceMethod==='highlightMarks');
  assert.ok(rec);assert.deepEqual(rec.highlightContext.grains[0].sources.find(s=>s.key==='field:Group').values,['A','B','C']);
  const prepared=prepareGuidedAction(p,{method:rec.method,args:rec.args},p);
  assert.ok(!prepared.postActionCalls.some(c=>c.method==='editCanvas'||c.method==='editFacetSource'));
});
