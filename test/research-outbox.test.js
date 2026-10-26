import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchOutbox } from '../web/research/outbox.js';
import { unpackBatch } from '../web/research/batch.js';
const profile={research_enabled:true,consent_version:'history-only-v1',consent_revision:1};
function setup(options={}){const map=new Map(),sent=[];const local={keys:async()=>[...map.keys()],get:async k=>map.get(k),put:async(k,v)=>{map.set(k,v);},remove:async k=>map.delete(k)};
 const box=createResearchOutbox({local,channel:false,interval:100000,send:async batch=>{sent.push(await unpackBatch(batch));return{ok:true};},...options});return{box,map,sent,local};}
test('Opt-in carries forward; opt-out and unknown consent never evaluate event input',async()=>{
 const {box,map,sent}=setup();try{let evaluated=0;const data=()=>{evaluated++;return{query:'example search'};};
 box.emit('search',data);box.configure('a',{...profile,research_enabled:false});box.emit('search',data);assert.equal(evaluated,0);
 box.configure('a',profile);box.emit('search',data);await box.flush();assert.equal(evaluated,1);assert.equal(map.size,1);
 await box.drain();assert.equal(map.size,0);assert.equal(sent.length,1);assert.ok(JSON.stringify(sent).includes('example search'));
 }finally{await box.destroy();}});
test('48 events share one durable write; capped offline queue has explicit losses',async()=>{
 const {box,map}=setup({online:()=>false});try{box.configure('a',profile);for(let n=0;n<500;n++)box.emit('parameter',{key:'opacity',value:n/1000});
 await box.flush();assert.equal(map.size,4);assert.ok(box.metrics().persisted<=160);assert.ok([...map.values()].every(b=>b.count<=48));
 const batches=await Promise.all([...map.values()].map(unpackBatch));assert.ok(batches.reduce((n,b)=>n+b.losses.dropped,0)>300);
 }finally{await box.destroy();}});
test('Withdraw while packing cannot reinsert stale events; account switch is isolated',async()=>{
 const {box,map,sent}=setup();try{box.configure('a',profile);box.emit('search',{query:'secret'});const flush=box.flush();await box.revoke();await flush;
 assert.equal(map.size,0);await box.drain();assert.equal(sent.length,0);
 box.configure('b',profile);box.emit('search',{query:'second'});await box.drain();assert.equal(sent.length,1);assert.ok(!JSON.stringify(sent).includes('secret'));
 }finally{await box.destroy();}});
test('Failed transport retains exact batch/id for retry without blocking the caller',async()=>{
 let now=10000,tries=0;const ids=[];const {box,map}=setup({now:()=>now,send:async batch=>{ids.push((await unpackBatch(batch)).id);if(++tries===1)throw Error('offline');return{ok:true};}});
 try{box.configure('a',profile);box.emit('operation',{action:'apply'});await box.drain();assert.equal(map.size,1);await box.drain();assert.equal(tries,1);
 now+=10000;await box.drain();assert.equal(map.size,0);assert.equal(ids[0],ids[1]);}finally{await box.destroy();}});
test('Server revocation stops a stale tab immediately',async()=>{
 const {box,map}=setup({send:async()=>({revoked:true})});try{box.configure('a',profile);await box.drain();assert.equal(box.enabled,false);assert.equal(map.size,0);}finally{await box.destroy();}});
