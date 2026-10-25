import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { overlayContext, overlaySpecs } from '../web/composition-controls.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { prepareGuidedAction } from '../src/prepare.js';

const engine=createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json',import.meta.url))));
test('numeric-color Iris offers a valid Line layer and editable, validated Color and Group by choices',()=>{
  const values=JSON.parse(readFileSync(new URL('../web/data/iris.json',import.meta.url)));
  const p=chart().createCanvas({plot:{width:314,height:314},margin:100}).createData({id:'data',values})
    .createScatterPlot({id:'p',x:'Sepal.Length',y:'Petal.Length',color:{field:'Sepal.Width',fieldType:'quantitative',scale:{palette:'blues'}}});
  const before=serializeProgram(p);
  const line=overlaySpecs(overlayContext(p,{target:'p'}),engine).find(spec=>spec.title==='Line plot layer');
  assert.ok(line);
  assert.equal(line.method,'createLayerPlot');
  const prepare=values=>prepareGuidedAction(p,{method:line.method,args:line.build(values)},p).preview;
  const q=prepare(line.values);
  assert.equal(q.semanticSpec.layers.find(layer=>layer.id==='layer').encoding.color,undefined);
  assert.equal(q.graphicSpec.objects.layer.items.length,1);
  const choices=line.resolveControls(line.values).find(control=>control.key==='layer_color').choices;
  const invalid=choices.find(choice=>choice.value==='field:Sepal.Width');
  assert.equal(invalid.disabled,true);
  assert.match(invalid.reason,/one value within each series/);
  assert.ok(!choices.find(choice=>choice.value==='field:Species').disabled);
  const grouped=prepare({...line.values,layer_color:'field:Species',layer_group:'field:Species'});
  assert.equal(grouped.semanticSpec.layers.find(layer=>layer.id==='layer').encoding.color.field,'Species');
  assert.equal(grouped.graphicSpec.objects.layer.items.length,3);
  const plain=prepare({...line.values,layer_color:'none',layer_group:'field:Species'});
  assert.equal(plain.semanticSpec.layers.find(layer=>layer.id==='layer').encoding.color,undefined);
  assert.equal(plain.graphicSpec.objects.layer.items.length,3);
  assert.equal(serializeProgram(p),before);
});
