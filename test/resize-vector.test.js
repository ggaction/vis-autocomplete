import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeVectorProjection, presentResizeVector } from '../web/resize-vector.js';

const source = { width: 700, height: 430, x:170, y:42, plot:{width:314,height:314} };
test('pending resize preserves image aspect and centers it with the matching plot outline', () => {
  for (const width of [360,700,1400]) for (const height of [150,430,1000]) {
    const target={...source,width,height};
    const p=resizeVectorProjection(source,target);
    assert.equal(p.sx,p.sy, 'Text and symbols must never stretch while native work is pending');
    assert.ok(source.width*p.sx<=target.width+1e-9);
    assert.ok(source.height*p.sy<=target.height+1e-9);
    assert.equal(p.x+source.width*p.sx/2,target.width/2);
    assert.equal(p.y+source.height*p.sy/2,target.height/2);
    const corners=[[source.x,source.y],[source.x+source.plot.width,source.y+source.plot.height]]
      .map(([x,y])=>[x*p.sx+p.x,y*p.sy+p.y]);
    assert.deepEqual(corners[0],[p.plot.x,p.plot.y]);
    assert.ok(Math.abs(corners[1][0]-(p.plot.x+p.plot.width))<1e-9);
    assert.ok(Math.abs(corners[1][1]-(p.plot.y+p.plot.height))<1e-9);
  }
});
test('current and thumbnail CSS transforms retain uniform scale at every intermediate render', () => {
  for(const viewport of [{scale:.4},{scale:.15,left:12,top:4}]) {
    for(const height of [80,180,430,1000]) {
      const canvas={localName:'canvas',style:{}};
      presentResizeVector(canvas,source,{...source,height},false,viewport);
      const matrix=canvas.style.transform.slice(7,-1).split(',').map(Number);
      assert.equal(matrix[0],matrix[3]);
      assert.equal(matrix[1],0);assert.equal(matrix[2],0);
    }
  }
});
test('canvas-only resizing translates the axis rectangle without scaling plot lengths', () => {
  const target={...source,width:780,height:510,x:210,y:82};
  const p=resizeVectorProjection(source,target,true);
  assert.deepEqual(p.plot,{x:210,y:82,width:314,height:314});
  assert.equal(p.sx,1);assert.equal(p.sy,1);
});
