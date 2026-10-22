import test from 'node:test';
import assert from 'node:assert/strict';
import {parameterTransitionDuration as duration, FINE_TRANSITION_MS, CARD_TRANSITION_MS} from '../web/parameter-motion.js';
test('fine slider controls retain brief smoothing, including integer sizes',()=>{
  for(const path of ['opacity','fontSize','strokeWidth','radius','innerRadius','gap','rotation','padding','offset','bandwidth'])
    assert.equal(duration({type:'number',path,step:1}),FINE_TRANSITION_MS,path);
  assert.ok(FINE_TRANSITION_MS>0 && FINE_TRANSITION_MS<CARD_TRANSITION_MS/2);
});
test('structural counts and non-slider options retain the full transition',()=>{
  for(const path of ['columns','rows','maxBins','bins','ticks.count','degree','robustIterations','steps','levels'])
    assert.equal(duration({type:'number',path}),CARD_TRANSITION_MS,path);
  for(const type of ['select','text','color','multiselect']) assert.equal(duration({type}),CARD_TRANSITION_MS);
  assert.equal(duration({type:'number',key:'p0',label:'Facet columns'}),CARD_TRANSITION_MS);
  assert.equal(duration({type:'number',key:'p1',label:'Point size',step:10}),FINE_TRANSITION_MS);
  assert.equal(duration({type:'number',key:'future',transition:'structural'}),CARD_TRANSITION_MS);
});
