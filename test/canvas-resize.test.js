import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { canvasGeometry, resizeCanvasAction, fitCanvasViewport } from '../web/canvas-geometry.js';
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
