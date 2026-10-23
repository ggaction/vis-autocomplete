import test from 'node:test';
import assert from 'node:assert/strict';
import { guideResizeFactor } from '../web/guide-editor.js';
const box = (width, height) => ({left:0,top:0,right:width,bottom:height});
test('short-axis corner drags remain effective for wide and tall legends', () => {
  assert.equal(guideResizeFactor(box(500,40), 0,20), 1.5);
  assert.equal(guideResizeFactor(box(40,500), 20,0), 1.5);
  assert.equal(guideResizeFactor(box(500,40), 0,-20), .5);
});
test('each legend edge responds only to motion normal to that edge', () => {
  for (const [edge,dx,dy] of [['s',100,20],['n',100,-20],['e',250,100],['w',-250,100]]) {
    assert.equal(guideResizeFactor(box(500,40),dx,dy,edge),1.5);
    assert.equal(guideResizeFactor(box(500,40),-dx,-dy,edge),.5);
  }
  for (const [edge,dx,dy] of [['ne',0,-20],['nw',0,-20],['sw',0,20]]) {
    assert.equal(guideResizeFactor(box(500,40),dx,dy,edge),1.5);
  }
});
