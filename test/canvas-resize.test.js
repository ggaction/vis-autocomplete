import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { canvasGeometry, resizeCanvasAction, fitCanvasViewport, projectCanvasGeometry } from '../web/canvas-geometry.js';
import { prepareGuidedAction, addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';

const base = () => chart().createCanvas(defaultCanvasOptions()).createData({id:'d', values:[
  {x:1,y:2,c:'A'}, {x:2,y:3,c:'B'}, {x:3,y:4,c:'A'},
]}).createScatterPlot({id:'plot',data:'d',x:{field:'x'},y:{field:'y'},color:{field:'c',fieldType:'nominal'}});

test('canvas resizing preserves plot lengths, plot bottom moves Y and preserves X', () => {
  const p = base(), view = addDefaultGuides(p), g = canvasGeometry(view);
  const canvas = resizeCanvasAction(g, 'canvas-se', 60, 40);
  const next = canvasGeometry(prepareGuidedAction(p, canvas, view).preview);
  assert.equal(next.width, g.width + 120); assert.equal(next.height, g.height + 80);
  assert.deepEqual(next.plot, g.plot);
  const plot = resizeCanvasAction(g, 'plot-s', 0, 30);
  const resized = canvasGeometry(prepareGuidedAction(p, plot, view).preview);
  assert.equal(resized.plot.height, g.plot.height + 60);
  assert.equal(resized.plot.width, g.plot.width);
  assert.ok(resized.height >= g.height); // Native guide layout can reserve a little more label space.
});

test('left axis expands X, extreme deltas preserve valid native dimensions', () => {
  const p = base(), g = canvasGeometry(p);
  const left = resizeCanvasAction(g, 'plot-w', -40, 0);
  assert.equal(left.args.plot.width, g.plot.width + 80);
  assert.equal(left.args.margin.left, g.margin.left);
  for (const handle of ['plot-w','plot-s','plot-e','plot-se','canvas-se']) {
    for (const delta of [-10000,10000]) {
      const action = resizeCanvasAction(g,handle,delta,delta);
      const next = action.args;
      assert.ok(next.plot.width >= 32 && next.plot.height >= 32);
      assert.ok(Object.values(next.margin).every(value => value >= 12));
      assert.ok(next.plot.width <= 4096 && next.plot.height <= 4096);
    }
  }
});

test('facet plot resize edits every panel; canvas resize edits outer padding only', () => {
  const p = base().facet({field:'c',data:'d',columns:2,spacing:'plot',gap:12,guides:{axes:'outer',legend:'shared'}});
  const view = addDefaultGuides(p), g = canvasGeometry(view);
  const action = resizeCanvasAction(g,'plot-s',0,36);
  assert.equal(action.method,'editFacetSource');
  const next = prepareGuidedAction(p,action,view).preview;
  for(const child of Object.values(next.children)) assert.equal(canvasGeometry(child).plot.height,g.plot.height+72);
  const canvas = resizeCanvasAction(g,'canvas-se',50,30);
  assert.equal(canvas.method,'editCompositionLayout');
  const outer = canvasGeometry(prepareGuidedAction(p,canvas,view).preview);
  assert.equal(outer.width,g.width+100); assert.equal(outer.height,g.height+60);
  assert.deepEqual(outer.plot,g.plot);
});

test('fractional guide margins survive a zero-delta resize and rounding is in native pixels', () => {
  const g = { ...canvasGeometry(base()), margin: { top:42,left:170,right:216.5,bottom:49.5 } };
  const start = resizeCanvasAction(g,'plot-s',0,0);
  assert.deepEqual(start.args.margin,g.margin);
  const next = resizeCanvasAction(g,'plot-s',0,4.3);
  assert.equal(next.args.plot.height,g.plot.height+8);
  assert.equal(next.args.margin.bottom,49.5);
  assert.deepEqual(resizeCanvasAction(g,'canvas-se',0,0).args.margin,g.margin);
});


test('opposite edges resize equally, preserving guide asymmetry and plot center offset', () => {
  const g = canvasGeometry(addDefaultGuides(base()));
  for (const delta of [-10000, -20, 0, 40, 10000]) {
    const { margin, plot } = resizeCanvasAction(g, 'canvas-se', delta, delta).args;
    assert.equal(margin.left - g.margin.left, margin.right - g.margin.right);
    assert.equal(margin.top - g.margin.top, margin.bottom - g.margin.bottom);
    assert.deepEqual(plot, g.plot);
    const resized = resizeCanvasAction(g, 'plot-se', delta, delta).args;
    assert.deepEqual(resized.margin, g.margin);
    assert.equal((resized.margin.left - resized.margin.right) / 2, (g.margin.left - g.margin.right) / 2);
  }
  assert.deepEqual(resizeCanvasAction(g,'plot-w',-40,0),resizeCanvasAction(g,'plot-e',40,0));
});

test('uniform fit centers every canvas, shrinks oversized content and enlarges small content', () => {
  for (const [width,height] of [[900,400],[400,900],[1200,800]]) {
    for (const g of [{width:700,height:450},{width:100,height:100},{width:20000,height:9000}]) {
      const v = fitCanvasViewport(g,width,height);
      assert.ok(v.scale > 0);
      assert.ok(g.width*v.scale <= width-24+1e-9);
      assert.ok(g.height*v.scale <= height-24+1e-9);
      assert.equal(v.left+g.width*v.scale/2,width/2);
      assert.equal(v.top+g.height*v.scale/2,height/2);
      assert.ok(Math.min(Math.abs(g.width*v.scale-width+24),Math.abs(g.height*v.scale-height+24))<1e-9);
      assert.ok(fitCanvasViewport({width:g.width/2,height:g.height/2},width,height).scale > v.scale);
    }
  }
});


test('gesture projection retains immutable native inputs and accounts for facet rows and columns', () => {
  for (const facet of [false,true]) {
    const p = facet ? base().facet({field:'c',data:'d',columns:2}) : base();
    const g = canvasGeometry(addDefaultGuides(p));
    const before = structuredClone(g);
    const action = resizeCanvasAction(g,'plot-se',20,30);
    const projected = projectCanvasGeometry(g,action);
    assert.equal(projected.width,g.width+40);
    assert.equal(projected.height,g.height+60);
    assert.equal(projected.plot.width,g.plot.width+40/g.columns);
    assert.equal(projected.plot.height,g.plot.height+60/g.rows);
    const canvas = projectCanvasGeometry(g,resizeCanvasAction(g,'canvas-se',20,30));
    assert.equal(canvas.width,g.width+40);
    assert.equal(canvas.height,g.height+60);
    assert.deepEqual(canvas.plot,g.plot);
    assert.deepEqual(g,before);
  }
});

test('facet handles enclose all native panels and distribute drag distance across the grid', () => {
  const values = Array.from({length:24},(_,i)=>({x:i,y:i*2,c:String(i%6),r:String(i%3)}));
  const source = chart().createCanvas(defaultCanvasOptions()).createData({id:'d',values})
    .createScatterPlot({id:'plot',data:'d',x:'x',y:'y',color:'c'});
  for (const spacing of ['plot','canvas']) for (const columns of [1,2,3,6]) {
    const prepared = prepareGuidedAction(source,{method:'facet',args:{field:'c',data:'d',columns,spacing,gap:24,
      guides:{axes:'outer',legend:'shared'}}});
    const p=prepared.authoringPreview,v=prepared.preview,g=canvasGeometry(v);
    const roots=v.graphicSpec.objects.canvas.children.filter(id=>v.graphicSpec.objects[id].type==='canvas').slice(0,6);
    for (const [i,id] of roots.entries()) {
      const child=canvasGeometry(v.children[v.compositionSpec.children[i]]),placed=v.graphicSpec.objects[id].properties;
      assert.ok(placed.x+child.x>=g.plotBounds.x);
      assert.ok(placed.x+child.x+child.plot.width<=g.plotBounds.x+g.plotBounds.width);
      assert.ok(placed.y+child.y+child.plot.height<=g.plotBounds.y+g.plotBounds.height);
    }
    for (const [handle,dx,dy] of [['plot-e',30,0],['plot-w',-30,0],['plot-s',0,30],['plot-se',30,-30]]) {
      const action=resizeCanvasAction(g,handle,dx,dy);
      const next=canvasGeometry(prepareGuidedAction(p,action,v).preview);
      const estimated=projectCanvasGeometry(g,action);
      assert.deepEqual(estimated.plotBounds,next.plotBounds,`${spacing} ${columns} ${handle}`);
      // At fixed display scale, the whole-grid edge follows the pointer;
      // the opposite edge moves equally. Allow one native pixel per cell.
      const xDelta=(next.plotBounds.width-g.plotBounds.width)/2;
      const yDelta=(next.plotBounds.height-g.plotBounds.height)/2;
      assert.ok(Math.abs(xDelta-Math.abs(dx))<=columns/2);
      assert.ok(Math.abs(yDelta-dy)<=g.rows/2);
    }
    const padded=canvasGeometry(prepareGuidedAction(p,resizeCanvasAction(g,'canvas-se',20,30),v).preview);
    assert.equal(padded.plotBounds.width,g.plotBounds.width);
    assert.equal(padded.plotBounds.height,g.plotBounds.height);
    assert.equal(padded.plotBounds.x-g.plotBounds.x,20);
    assert.equal(padded.plotBounds.y-g.plotBounds.y,30);
  }
});

test('sparse facetGrid uses domain rows, not occupied cell count, when resizing', () => {
  const values=[{x:1,y:2,r:'A',c:'a'},{x:2,y:3,r:'B',c:'b'},{x:3,y:4,r:'C',c:'c'}];
  const source=chart().createCanvas(defaultCanvasOptions()).createData({id:'d',values})
    .createScatterPlot({id:'plot',data:'d',x:'x',y:'y'});
  const prepared=prepareGuidedAction(source,{method:'facetGrid',args:{data:'d',rows:{field:'r'},columns:{field:'c'},
    combinations:'observed',spacing:'plot',gap:30,guides:{axes:'outer',legend:false}}});
  const g=canvasGeometry(prepared.preview);
  assert.equal(g.columns,3);assert.equal(g.rows,3);
  for (const handle of ['plot-s','plot-e','plot-se']) {
    const action=resizeCanvasAction(g,handle,30,30);
    const next=canvasGeometry(prepareGuidedAction(prepared.authoringPreview,action,prepared.preview).preview);
    const estimated=projectCanvasGeometry(g,action);
    assert.equal(estimated.width,next.width);assert.equal(estimated.height,next.height);
    assert.deepEqual(estimated.plotBounds,next.plotBounds);
  }
});
