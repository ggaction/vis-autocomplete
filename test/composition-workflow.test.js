import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { prepareGuidedAction, addDefaultGuides } from '../src/prepare.js';
import { editableChartTargets } from '../src/composition-context.js';
import { createCalculationService } from '../web/calculation-service.js';
import { serializeProgram } from 'ggaction/persistence';
import { readFileSync } from 'node:fs';

const rows = [{ a: 'A', b: 10 }, { a: 'B', b: 25 }, { a: 'C', b: 18 }];
const bars = () => chart().createCanvas({ plot: { width: 240, height: 240 }, margin: { left: 80, right: 40, top: 60, bottom: 60 } })
  .createData({ id: 'data', values: rows }).createBarPlot({ id: 'plot', data: 'data', x: 'a', y: 'b' });

test('overlay is one native recommendation and scoped appearance preserves its source', () => {
  const base = bars(), result = prepareGuidedAction(base, { method: 'createOverlay', args: { id: 'line', source: 'plot', type: 'line' } });
  const marks = editableChartTargets(result.authoringPreview);
  assert.deepEqual(marks.map(m => [m.id, m.overlay]), [['plot', false], ['line', true]]);
  const edited = prepareGuidedAction(result.authoringPreview, { method: 'encodeOpacity', args: { target: 'line', value: .3 } }, result.preview);
  assert.equal(edited.authoringPreview.markConfigs.line.opacity, .3);
  assert.notEqual(edited.authoringPreview.markConfigs.plot?.opacity, .3);
});

test('adjacent chart, shared domains, individual edits and All calls round trip through native preparation', () => {
  const base = bars(), added = prepareGuidedAction(base, { method: 'createAdjacentPlot', args: { id: 'line', source: 'plot', position: 'right' } });
  assert.equal(added.preview.trace.children.at(-1).op, 'createGuides');
  assert.deepEqual(editableChartTargets(added.preview).map(t => t.childPath), [['plot'], ['line']]);
  const call = { method: 'encodeOpacity', args: { target: [{ childPath: ['plot'], id: 'plot' }, { childPath: ['line'], id: 'line' }], value: .4 } };
  const edited = prepareGuidedAction(added.authoringPreview, call, added.preview);
  assert.equal(edited.authoringPreview.children.plot.markConfigs.plot.opacity, .4);
  assert.equal(edited.authoringPreview.children.line.markConfigs.line.opacity, .4);
  assert.equal(edited.recommendation.validation.topLevelActions, 1);
  assert.deepEqual(addDefaultGuides(edited.authoringPreview, edited.guideCall).graphicSpec, edited.preview.graphicSpec);
  const nested = prepareGuidedAction(edited.authoringPreview, { method: 'createAdjacentPlot', args: {
    target: { childPath: ['line'] }, id: 'points', source: 'line', position: 'bottom', share: {},
    plot: { action: 'createScatterPlot', options: { x: { field: 'a', fieldType: 'nominal' }, y: 'b' } },
  } }, edited.preview);
  assert.deepEqual(editableChartTargets(nested.preview).map(t => t.childPath), [['plot'], ['line', 'line'], ['line', 'points']]);
});

test('worker recommendations retain local parameter editors and issue native scoped calls', () => {
  const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
  const service = createCalculationService(model);
  const added = prepareGuidedAction(bars(), { method: 'createAdjacentPlot', args: { id: 'line', source: 'plot' } });
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(added.authoringPreview), guideCall: added.guideCall });
  for (const scope of [{ childPath: ['line'], target: 'line' }, { scope: 'all', target: 'plot' }]) {
    const result = service.execute({ type: 'recommend', stateId: 1, options: { ...scope, limit: 500 }, group: 'encoding', searchQuery: 'opacity' });
    assert.ok(result.result.recommendations.length, JSON.stringify(result.result.diagnostics.rejected));
    const rec = result.result.recommendations[0];
    assert.equal(rec.method, 'encodeOpacity');
    assert.ok(rec.editingScope);
    assert.ok(rec.localRecommendation);
    const prepared = service.execute({ type: 'prepare', stateId: 1, action: result.defaults[0].action });
    assert.equal(prepared.recommendation.validation.topLevelActions, 1);
    const count = Array.isArray(rec.args.target) ? rec.args.target.length : 1;
    assert.equal(count, scope.scope === 'all' ? 2 : 1);
  }
});

test('shared-scale option is ranked by the unchanged paper model and remains a root call', () => {
  const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
  const service = createCalculationService(model);
  const p = prepareGuidedAction(bars(), {method:'createAdjacentPlot',args:{id:'line',source:'plot'}});
  service.execute({type:'state',stateId:1,snapshot:serializeProgram(p.authoringPreview),guideCall:p.guideCall});
  const response=service.execute({type:'recommend',stateId:1,options:{childPath:['line'],target:'line',limit:500},group:'encoding',searchQuery:'shared scales'});
  const entry=response.result.recommendations.find(r=>r.method==='editCompositionScales');
  assert.ok(entry,JSON.stringify(response.result.diagnostics.rejected));assert.equal(entry.editingScope,undefined);
  assert.equal(entry.score,0,'unseen native actions never get invented corpus counts');
  const result=service.execute({type:'materialize',stateId:1,action:{method:entry.method,args:entry.args}});
  assert.ok(result.snapshot);
});

test('adjacent guide hit boxes edit their exact nested panel instead of the first chart', async () => {
  const { editableGuides, resizeGuide, moveGuide } = await import('../src/guide-manipulation.js');
  const base = bars().createTitle({ text: 'Original' });
  const a = prepareGuidedAction(base, {method:'createAdjacentPlot',args:{id:'next',source:'plot'}});
  const b = prepareGuidedAction(a.authoringPreview, {method:'createTitle',args:{target:{childPath:['next']},text:'Neighbor'}},a.preview);
  const target = editableGuides(b.preview).find(t => t.key === 'next/title');
  assert.ok(target); assert.ok(target.bounds.left > editableGuides(b.preview).find(t => t.key === 'plot/title').bounds.right);
  const action = resizeGuide(target, 1.5);
  assert.deepEqual(action.args.target,{childPath:['next']});
  const resized = prepareGuidedAction(b.authoringPreview,action,b.preview);
  assert.deepEqual(resized.authoringPreview.children.plot.titleConfig,b.authoringPreview.children.plot.titleConfig);
  assert.equal(resized.authoringPreview.children.next.titleConfig.titleStyle.fontSize,target.config.titleStyle.fontSize*1.5);
  const moved = moveGuide(b.preview,target,target.bounds.left,(target.offset.y+target.localProgram.graphicSpec.objects.canvas.properties.height));
  assert.deepEqual(moved.args.target,{childPath:['next']}); assert.equal(moved.args.position,'bottom');
});

test('adjacent fitting repairs nested constructor guides without inventing wrapper options', () => {
  const rows=JSON.parse(readFileSync(new URL('../web/data/barley.json',import.meta.url)));
  const base=chart().createCanvas({plot:{width:314,height:314},margin:{left:170,right:216,top:42,bottom:74}})
    .createData({id:'dataset',values:rows});
  const p=prepareGuidedAction(base,{method:'createBarPlot',args:{id:'plot',data:'dataset',x:{field:'variety',fieldType:'nominal'},y:{field:'yield',aggregate:'sum'},color:'site'}});
  const action={method:'createAdjacentPlot',args:{id:'line',source:'plot',position:'left',share:{y:true},plot:{action:'createLinePlot',options:{data:'dataset',x:{field:'variety',fieldType:'nominal'},y:{field:'yield',aggregate:'sum'},color:'site'}}}};
  const result=prepareGuidedAction(p.authoringPreview,action,p.preview);
  assert.equal(result.recommendation.validation.topLevelActions,1);
  assert.equal(result.recommendation.args.guides,undefined);
  assert.ok(result.preview.children.line);
  const third = prepareGuidedAction(result.authoringPreview, { ...action, args: { ...action.args,
    target: { childPath: ['line'] }, source: 'line', id: 'third', position: 'right' } }, result.preview);
  assert.ok(third.preview.children.line.children.third);
  assert.equal(third.recommendation.args.plot.options.guides.axes.x.ticksAndLabels.labels.rotation.value, 90);
  let replay = result.authoringPreview;
  for (const call of third.prerequisiteCalls) replay = replay[call.method](call.args);
  replay = replay[third.recommendation.method](third.recommendation.args);
  for (const call of third.postActionCalls) replay = replay[call.method](call.args);
  assert.deepEqual(addDefaultGuides(replay, third.guideCall).graphicSpec, third.preview.graphicSpec);
});


test('horizontal bars default to category order and diverging stacks expose totals', async () => {
  const { overlayCandidates } = await import('../src/overlay-candidates.js');
  const horizontal = chart().createCanvas().createData({values:rows})
    .createBarPlot({id:'plot',x:'b',y:{field:'a',fieldType:'nominal'},guides:false});
  const choice = overlayCandidates(horizontal,horizontal.semanticSpec.layers[0])[0];
  assert.equal(choice.args.orderBy,'y');
  assert.equal(choice.parameters.find(p=>p.path==='orderBy').value,'y');
  const grouped = chart().createCanvas().createData({values:[{a:'A',b:2,g:'one'},{a:'A',b:-3,g:'two'}]})
    .createBarPlot({id:'plot',x:'a',y:'b',color:{field:'g',layout:'diverging'},guides:false});
  assert.ok(overlayCandidates(grouped,grouped.semanticSpec.layers[0])[0].parameters.some(p=>p.path==='series'));
});


test('All recommends one root title while individual charts retain separate titles', () => {
  const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
  const service = createCalculationService(model);
  let added = prepareGuidedAction(bars(), { method: 'createAdjacentPlot', args: { id: 'line', source: 'plot' } });
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(added.authoringPreview), guideCall: added.guideCall });
  const request = { type: 'recommend', stateId: 1, options: { scope: 'all', target: 'plot', hierarchy: true, limit: 500 }, group: 'style', searchQuery: 'title' };
  let response = service.execute(request);
  const index = response.result.recommendations.findIndex(r => r.method === 'createTitle');
  assert.ok(index >= 0, JSON.stringify(response.result.diagnostics.rejected));
  const action = response.defaults[index].action;
  assert.equal(action.args.target, undefined);
  const titled = prepareGuidedAction(added.authoringPreview, action, added.preview);
  assert.ok(titled.preview.graphicSpec.objects.chartTitle);
  assert.ok(Object.values(titled.preview.children).every(child => !child.semanticSpec.title.text));
  service.execute({ type: 'state', stateId: 2, snapshot: serializeProgram(titled.authoringPreview), guideCall: titled.guideCall });
  response = service.execute({ ...request, stateId: 2 });
  const edit = response.result.recommendations.find(r => r.method === 'editTitle');
  assert.ok(edit, JSON.stringify(response.result.diagnostics.rejected));
  assert.equal(edit.args.target, undefined);
  assert.equal(edit.previouslyApplied, true);
  response = service.execute({ ...request, stateId: 2, options: { childPath: ['line'], target: 'line', limit: 500 } });
  const local = response.result.recommendations.find(r => r.method === 'createTitle');
  assert.deepEqual(local.args.target, { childPath: ['line'] });
});


test('overall title wraps across the combined plot width instead of clipping at the first child', () => {
  const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
  const service = createCalculationService(model);
  const base = prepareGuidedAction(bars(), { method: 'createAdjacentPlot', args: { id: 'line', source: 'plot' } });
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(base.authoringPreview), guideCall: base.guideCall });
  const response = service.execute({ type: 'recommend', stateId: 1, options: { scope: 'all', target: 'plot', limit: 500 }, group: 'style', searchQuery: 'add title' });
  const rec = response.result.recommendations.find(r => r.method === 'createTitle');
  assert.ok(rec.args.maxWidth > 240 * 2);
  const title = 'A long overall title that spans both adjacent charts and continues into a second line without clipping';
  const p = prepareGuidedAction(base.authoringPreview, { method: rec.method, args: { ...rec.args, text: title } }, base.preview).preview;
  assert.ok(p.graphicSpec.objects.chartTitle.items.length >= 2);
  assert.ok(Object.values(p.children).every(child => !child.graphicSpec.objects.chartTitle));
});
