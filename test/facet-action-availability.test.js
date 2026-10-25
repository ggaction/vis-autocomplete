import { replayPrepared, assertPreparedTrace } from './support/prepared.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { describeAction } from 'ggaction/inspection';
import { createRecommendationEngine, profileDataset } from '../src/index.js';
import { recommendationParameters, valuesFor, activeControls } from '../web/parameters.js';
import { prepareGuidedAction, addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const rows = Array.from({ length: 36 }, (_, i) => ({ X: i % 6 + 1, Y: i % 9 + 1, Value: i + 1,
  Category: ['B', 'A', 'C'][i % 3], Series: ['First', 'Second'][Math.floor(i / 3) % 2] }));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
const recommend = raw => engine.recommend(addDefaultGuides(raw), { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS, authoringProgram: raw });

test('facet stays in Encoding and supports real source actions, guide edits, layout and worker round trips', async () => {
  const { createCalculationService } = await import('../web/calculation-service.js');
  const { serializeProgram, deserializeProgram } = await import('ggaction/persistence');
  const { renderToSVG } = await import('ggaction/svg');
  const raw = base().createScatterPlot({id:'plot',x:'X',y:'Y',guides:false}), view=addDefaultGuides(raw);
  const result = recommend(raw);
  for(const method of ['facet','facetGrid']) {
    const rec=result.recommendations.find(r=>r.method===method);
    assert.ok(rec,method); assert.equal(rec.category,'encoding');
    const editor=recommendationParameters(rec,profileDataset(view,'data'));
    const start=prepareGuidedAction(raw,{method,args:editor.build(valuesFor(editor.controls))},view);
    assert.ok(Object.keys(start.preview.children).length>1);
    assert.equal(start.preview.trace.children.at(-1).op,'createGuides');
    // Audit every callable action, including details represented by a parent
    // in the normal hierarchy deck (and directly accessible through search).
    const next=engine.recommend(start.preview,{target:'plot',...FOLLOWUP_RECOMMENDATION_OPTIONS,hierarchy:false,authoringProgram:start.authoringPreview});
    assert.ok(next.recommendations.some(r=>r.method==='editFacetScales'));
    for(const sourceMethod of ['encodeOpacity','createMarkLabels','editXAxisLabels','createStatisticalReference']) {
      const sourceRec=next.recommendations.find(r=>r.sourceMethod===sourceMethod);
      assert.ok(sourceRec,sourceMethod);
      assert.equal(sourceRec.method,'editFacetSource');
      const sourceEditor=recommendationParameters(sourceRec,profileDataset(start.preview,next.state.data));
      const action={method:sourceRec.method,args:sourceEditor.build(valuesFor(sourceEditor.controls))};
      const prepared=prepareGuidedAction(start.authoringPreview,action,start.preview);
      assert.equal(prepared.recommendation.validation.topLevelActions,1);
      assert.equal(prepared.authoringPreview.trace.children.at(-1).op,'editFacetSource');
      const service=createCalculationService(model);
      service.execute({type:'state',stateId:1,snapshot:serializeProgram(start.authoringPreview),guideCall:start.guideCall});
      const remote=service.execute({type:'materialize',stateId:1,action});
      assert.deepEqual(deserializeProgram(remote.snapshot).graphicSpec,prepared.authoringPreview.graphicSpec);
      assert.ok(renderToSVG(prepared.preview).startsWith('<svg'));
    }
    const titled=prepareGuidedAction(start.authoringPreview,{method:'createTitle',args:{text:'Facets'}},start.preview);
    assert.equal(titled.preview.semanticSpec.title.text,'Facets');
  }
});

test('binned heatmaps retain facet candidates with semantically coherent shared or independent color guides', async () => {
  const { createCalculationService } = await import('../web/calculation-service.js');
  const { serializeProgram } = await import('ggaction/persistence');
  const cars = JSON.parse(readFileSync(new URL('../web/data/cars.json',import.meta.url))).filter(r=>r.Horsepower!=null&&r.Miles_per_Gallon!=null);
  const raw=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:cars})
    .createHeatmap({id:'plot',x:{field:'Horsepower',fieldType:'quantitative'},y:{field:'Miles_per_Gallon',fieldType:'quantitative'},bin:{bins:8},color:{palette:'blues'},guides:false});
  const service=createCalculationService(model);
  service.execute({type:'state',stateId:1,snapshot:serializeProgram(raw),guideCall:{method:'createGuides',args:{}}});
  let response;
  for(let page=0;page<3;page++) {
    response=service.execute({type:'recommend',stateId:1,group:'encoding',page,options:{target:'plot',...FOLLOWUP_RECOMMENDATION_OPTIONS}});
    if(response.pagination.complete)break;
  }
  const rec=response.result.recommendations.find(r=>r.method==='facet');
  assert.ok(rec,'valid per-panel guides must rescue a facet card');
  assert.equal(rec.args.field,'Origin');
  assert.equal(rec.args.data,'data');
  const faceted = prepareGuidedAction(raw, { method: rec.method, args: rec.args }).preview;
  if (rec.args.scales?.color === 'independent') assert.equal(rec.args.guides.legend, false);
  else {
    assert.equal(rec.args.guides.legend, 'shared');
    const domains = Object.values(faceted.children).map(child => {
      const layer = child.semanticSpec.layers.find(layer => layer.encoding?.color?.scale);
      return child.resolvedScales[layer.encoding.color.scale].domain;
    });
    assert.ok(domains.length > 1);
    assert.ok(domains.every(domain => JSON.stringify(domain) === JSON.stringify(domains[0])), 'a shared color legend uses the same domain in every panel');
  }
  assert.ok(renderToSVG(faceted).startsWith('<svg'));
  assert.ok(response.result.recommendations.some(r=>r.method==='encodeStrokeWidth'));
  assert.ok(response.result.recommendations.some(r=>r.method==='encodeOpacity'));
});

test('facet fields resolve to valid upstream owners when a folded chart repeats their names', async () => {
 const {cars}=await import('../examples/scenarios.js');
 const {getPlotDefinitions,defaultValues}=await import('../src/plot-catalog.js');
 const {facetCandidates}=await import('../src/facet-candidates.js');
 const p=chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:cars});
 const spec=getPlotDefinitions(profileDataset(p,'data')).find(d=>d.method==='createRadarPlot');
 const start=prepareGuidedAction(p,{method:spec.method,args:spec.build(defaultValues(spec))});
 const layer=start.preview.semanticSpec.layers.find(l=>l.id==='plot');
 const candidates=facetCandidates(start.preview,{layer,profile:profileDataset(start.preview,layer.data)});
 const rec=candidates.find(r=>r.method==='facet'&&r.args.field==='Origin');
 assert.ok(rec); assert.ok(start.preview.semanticSpec.datasets.find(d => d.id === rec.args.data).values.every(row => Object.hasOwn(row, 'Origin')));
 assert.equal(prepareGuidedAction(start.authoringPreview,rec,start.preview).recommendation.validation.topLevelActions,1);
});

test('neighboring source parameters stay inside the one public facet-source call',async()=>{
 const {neighboringParameters}=await import('../src/engine.js');
 const variants=neighboringParameters({method:'editFacetSource',args:{action:{method:'editXAxisLabels',options:{fontSize:11}}},
  parameters:[{path:'fontSize',type:'number',value:11,step:1,min:8,max:18}]});
 assert.deepEqual(variants.map(v=>v.args.action.options.fontSize),[12,10]);
 assert.ok(variants.every(v=>Object.keys(v.args).length===1&&v.method==='editFacetSource'));
});

test('facet source edits keep their original design primitive in paper-model features',()=>{
 const raw=base().createScatterPlot({id:'plot',x:'X',y:'Y',guides:false});
 const start=prepareGuidedAction(raw,{method:'facet',args:{field:'Series',columns:2,guides:{axes:'outer',legend:false}}},addDefaultGuides(raw));
 const next=prepareGuidedAction(start.authoringPreview,{method:'editFacetSource',args:{action:{method:'editXAxisLabels',options:{fontSize:10}}}},start.preview);
 const features=engine.rank(next.preview,{target:'plot',group:'style'}).state.features;
 assert.ok(features.includes('action.editXAxisLabels'));
 assert.ok(!features.includes('action.editFacetSource'));
});
