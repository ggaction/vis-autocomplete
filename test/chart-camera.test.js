import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomCamera } from '../web/chart-camera.js';
const size={width:800,height:600};
test('zoom preserves the logical point beneath the pointer',()=>{
 const from={zoom:1.5,x:30,y:-25},anchor={x:120,y:-80};
 const to=zoomCamera(from,2,anchor,size);
 for(const axis of ['x','y'])assert.ok(Math.abs((anchor[axis]-from[axis])/from.zoom-(anchor[axis]-to[axis])/to.zoom)<1e-9);
 assert.deepEqual(from,{zoom:1.5,x:30,y:-25});
});
test('fit and zoom out recenter; extremes and panning remain bounded',()=>{
 const from={zoom:2,x:150,y:100};
 assert.deepEqual(zoomCamera(from,1,{x:0,y:0},size),{zoom:1,x:0,y:0});
 assert.deepEqual(zoomCamera(from,.01,{x:0,y:0},size),{zoom:.5,x:0,y:0});
 const high=zoomCamera(from,500,{x:0,y:0},size);assert.equal(high.zoom,4);
 const pan=zoomCamera({zoom:2,x:5000,y:-5000},2,{x:0,y:0},size);
 assert.deepEqual(pan,{zoom:2,x:400,y:-300});
});
