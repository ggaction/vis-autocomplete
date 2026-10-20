import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createCalculationService } from '../web/calculation-service.js';
import { defaultCanvasOptions } from '../src/prepare.js';

test('worker recommendations retain valid category hints and discard source-only hints after aggregation', () => {
  const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
  const raw = chart().createCanvas(defaultCanvasOptions()).createData({id:'data',values:[
    {Category:1,Y:4,Removed:'A'}, {Category:1,Y:6,Removed:'B'}, {Category:2,Y:12,Removed:'A'}
  ]}).createSummaryData({id:'summary',source:'data',groupBy:['Category'],
    aggregates:[{op:'mean',field:'Y',as:'Value'}]})
    .createBarPlot({id:'plot',data:'summary',x:{field:'Category',fieldType:'ordinal'},y:'Value'});
  const service = createCalculationService(model);
  service.execute({type:'state',stateId:1,snapshot:serializeProgram(raw),guideCall:{method:'createGuides',args:{}}});
  const response = service.execute({type:'recommend',stateId:1,group:'encoding',
    options:{target:'plot',fieldTypes:{Category:{type:'ordinal',order:[2,1]},Y:'quantitative',Removed:'nominal'}}});
  assert.equal(response.profile.id,'summary');
  assert.equal(response.profile.fields.find(f=>f.name==='Category').type,'ordinal');
  assert.deepEqual(response.profile.fields.find(f=>f.name==='Category').order,[2,1]);
  assert.ok(response.result.recommendations.length>0);
  assert.ok(response.result.recommendations.every(r=>r.validation.executed));
});
