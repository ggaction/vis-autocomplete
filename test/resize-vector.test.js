import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeVectorProjection } from '../web/resize-vector.js';

const source = { width: 700, height: 430, x:170, y:42, plot:{width:314,height:314} };
test('resize image and plot outline share one affine transform for compression and expansion', () => {
  for (const width of [360,700,1400]) for (const height of [150,430,1000]) {
    const target={...source,width,height};
    const p=resizeVectorProjection(source,target);
    const corners=[[source.x,source.y],[source.x+source.plot.width,source.y+source.plot.height]]
      .map(([x,y])=>[x*p.sx+p.x,y*p.sy+p.y]);
    assert.deepEqual(corners[0],[p.plot.x,p.plot.y]);
    assert.ok(Math.abs(corners[1][0]-(p.plot.x+p.plot.width))<1e-9);
    assert.ok(Math.abs(corners[1][1]-(p.plot.y+p.plot.height))<1e-9);
  }
});
test('canvas-only resizing translates the axis rectangle without scaling plot lengths', () => {
  const target={...source,width:780,height:510,x:210,y:82};
  const p=resizeVectorProjection(source,target,true);
  assert.deepEqual(p.plot,{x:210,y:82,width:314,height:314});
  assert.equal(p.sx,1);assert.equal(p.sy,1);
});
