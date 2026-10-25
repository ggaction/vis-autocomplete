import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/data-import.js';
import { createRecommendationEngine } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { recommendationParameters, buildRecommendationCall, valuesFor } from '../web/parameters.js';
import { addDefaultGuides, prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { replayPrepared } from './support/prepared.js';
const engine = createRecommendationEngine(JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url))));
const base = rows => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });

test('statistical axes and horizontal aggregates fit linear and symlog scales with replayable tick choices', () => {
  const glass = base(JSON.parse(readFileSync(new URL('../web/data/glass.json',import.meta.url))));
  for (const normalization of ['unit','count']) for (const type of ['linear','symlog']) {
    const prepared=prepareGuidedAction(glass,{method:'createDensityPlot',args:{id:'plot',data:'data',field:'RI',bandwidth:'auto',kernel:'gaussian',normalization,steps:100,valueScale:{type:'linear'},densityScale:{type}}});
    assert.match(renderToSVG(prepared.preview),/<svg/);
    assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
  }
  const bike=base(parseCSV(readFileSync(new URL('../web/data/bike-sharing.csv',import.meta.url),'utf8')));
  const prepared=prepareGuidedAction(bike,{method:'createBarPlot',args:{id:'plot',data:'data',missing:'skip',x:{field:'cnt',fieldType:'quantitative',aggregate:'sum',scale:{type:'symlog'}},y:{field:'weekday',fieldType:'ordinal'},color:{field:'season',fieldType:'ordinal'}}});
  assert.match(renderToSVG(prepared.preview),/<svg/);
  assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
});

test('nonlinear endpoint fitting replaces authored tick modes with exact values', () => {
  const bike=base(parseCSV(readFileSync(new URL('../web/data/bike-sharing.csv',import.meta.url),'utf8')));
  for (const ticksAndLabels of [{ count:10 }, { values:[100000,150000,180000,190000] }]) {
    const prepared=prepareGuidedAction(bike,{method:'createBarPlot',args:{id:'plot',data:'data',missing:'skip',
      x:{field:'cnt',fieldType:'quantitative',aggregate:'sum',scale:{type:'symlog'}},
      y:{field:'weekday',fieldType:'ordinal'},color:{field:'season',fieldType:'ordinal'},
      guides:{axes:{x:{ticksAndLabels}}}}});
    const fitted=prepared.recommendation.args.guides.axes.x.ticksAndLabels;
    assert.equal(Object.hasOwn(fitted,'count'),false);
    assert.equal(Object.hasOwn(fitted,'rounding'),false);
    const layer=prepared.preview.semanticSpec.layers.find(layer=>layer.id==='plot');
    assert.deepEqual(fitted.values,prepared.preview.resolvedScales[layer.encoding.x.scale].domain);
    assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
    assert.match(renderToSVG(prepared.preview),/<svg/);
  }
});

test('endpoint fitting clears a linear companion axis rounding policy when replacing its count', () => {
  const p=base([{x:1,y:1},{x:1e6,y:10}]);
  const prepared=prepareGuidedAction(p,{method:'createScatterPlot',args:{id:'plot',data:'data',
    x:{field:'x',fieldType:'quantitative',scale:{type:'symlog'}},y:{field:'y',fieldType:'quantitative'},
    guides:{axes:{y:{ticksAndLabels:{count:10,rounding:'ceiling'}}}}}});
  const ticks=prepared.recommendation.args.guides.axes.y.ticksAndLabels;
  assert.deepEqual(ticks.values,[1,10]);
  assert.equal(Object.hasOwn(ticks,'count'),false);
  assert.equal(Object.hasOwn(ticks,'rounding'),false);
  assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
});

test('edited color legend and a new stroke legend retain distinct edge lanes', () => {
  const p = base([{x:1,y:4,g:'A',h:'East'},{x:2,y:8,g:'B',h:'West'}])
    .createScatterPlot({ id:'plot', x:'x', y:'y', color:'g', guides:false })
    .createLegend({target:'plot',channels:['color']})
    .editLegend({target:'plot',channel:'color',position:'right',labels:{fontSize:13},itemGap:22});
  const prepared = prepareGuidedAction(p,{method:'encodeStroke',args:{target:'plot',field:'h',fieldType:'nominal'}});
  assert.match(renderToSVG(prepared.preview), /East/);
  assert.match(renderToSVG(prepared.preview), /West/);
  assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
});

test('statistical-reference scale choices update the existing shared axis without orphaning guides', () => {
  const p = base([{x:1,y:2,g:'A'},{x:3,y:7,g:'A'},{x:9,y:12,g:'B'}])
    .createScatterPlot({id:'plot',x:'x',y:'y',color:'g'})
    .createStatisticalReference({id:'stat',source:'plot',axis:'x',groupBy:'g'});
  const layer=p.semanticSpec.layers.find(l=>l.id==='stat'), before=serializeProgram(p);
  const ranked=engine.rank(addDefaultGuides(p),{target:'stat',group:'encoding',hierarchy:false,includeRevisions:true,limit:100});
  const rec=ranked.recommendations.find(r=>r.method==='encodeX');
  assert.ok(rec);
  const editor=recommendationParameters(rec,profileDataset(p,layer.data));
  for(const scale of ['linear','log','sqrt','symlog']) {
    const action=buildRecommendationCall({...editor,method:rec.method},{...valuesFor(editor.controls),field:layer.encoding.x.field,scale});
    assert.equal(action.args.scale.id,layer.encoding.x.scale);
    const prepared=prepareGuidedAction(p,{...action,allowUnchanged:true});
    assert.equal(prepared.preview.resolvedScales[layer.encoding.x.scale].type,scale);
    assert.equal(prepared.preview.semanticSpec.layers.find(l=>l.id==='plot').encoding.x.scale,layer.encoding.x.scale);
    assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
    assert.match(renderToSVG(prepared.preview),/<svg/);
  }
  assert.equal(serializeProgram(p),before);
});

test('large categorical Radar legends do not pass categorical overflow into new continuous guides', () => {
  const p=base(Array.from({length:20},(_,i)=>({id:`row${i}`,a:i+1,b:i+2,c:i+3})))
    .createRadarPlot({id:'plot',data:'data',wide:{fields:['a','b','c']},groupBy:'id',color:{field:'id',fieldType:'nominal'}});
  for(const [method,field] of [['encodeOpacity','a'],['encodeStrokeWidth','b']]) {
    const prepared=prepareGuidedAction(p,{method,args:{target:'plot',field,fieldType:'quantitative',scale:{range:[.3,1]}}});
    assert.match(renderToSVG(prepared.preview),/<svg/);
    assert.deepEqual(replayPrepared(prepared).graphicSpec,prepared.preview.graphicSpec);
  }
});

test('exact plot fitting reclaims automatic legend reservations across persistence, preserving authored margins', () => {
  const source=chart().createCanvas({plot:{width:314,height:314},margin:20})
    .createData({values:Array.from({length:60},(_,i)=>({x:i,y:i,id:`Item ${i}`,group:i%3?'B':'A'}))})
    .createScatterPlot({id:'plot',x:'x',y:'y',color:'id',guides:false}).createLegend({target:'plot',channels:['color']});
  const before=serializeProgram(source), fitted=source.fitCanvas({align:'center',padding:6});
  const restored=deserializeProgram(serializeProgram(fitted));
  const small=restored.encodeColor({target:'plot',field:'group',fieldType:'nominal'}).fitCanvas({align:'center',padding:6});
  assert.ok(small.graphicSpec.objects.canvas.properties.height < source.graphicSpec.objects.canvas.properties.height / 2);
  assert.deepEqual(small.materializationConfigs.canvas.plot,{width:314,height:314});
  assert.deepEqual(small.materializationConfigs.canvas.requestedMargin,{top:20,right:20,bottom:20,left:20});
  assert.deepEqual(small.fitCanvas({align:'center',padding:6}).graphicSpec,small.graphicSpec);
  const authored=small.editCanvas({margin:{bottom:200}}).fitCanvas();
  assert.ok(authored.materializationConfigs.canvas.margin.bottom>=200);
  assert.equal(serializeProgram(source),before);
});
