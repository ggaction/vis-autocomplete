import test from 'node:test';import assert from 'node:assert/strict';
import {extractResearch} from '../scripts/research/extract.js';import {EVENTS,createCodec} from '../web/research/protocol.js';
test('Extraction distinguishes unseen candidates, associates operations, and preserves participant splits',()=>{
 const codec=createCodec({text:true});let n=0;
 const event=(kind,input)=>{const encoded=codec.encode(input);return{id:crypto.randomUUID(),n:++n,k:EVENTS.indexOf(kind),t:n*10,v:encoded.tree,texts:encoded.texts};};
 const batch={participant_id:'participant-a',release:'v0.0.7',session:crypto.randomUUID(),time:'2026-10-26T12:00:00Z',events:[
 event('state',{stateId:'state',checkpoint:[]}),
 event('slate',{slateId:'a',sourceState:'state'}),event('candidate',{slateId:'a',candidateId:'c',method:'encodeSize',defaults:{value:3}}),
 event('candidate',{slateId:'a',candidateId:'unseen',method:'encodeColor'}),event('exposure',{slateId:'a',candidateId:'c',status:'start'}),
 event('operation',{operationId:'o',slateId:'a',candidateId:'c',method:'encodeSize',action:'apply',status:'start',values:{value:3}}),
 event('operation',{operationId:'o',status:'completed',destinationState:'next'})]};
 const result=extractResearch([batch,batch]);assert.equal(result.quality.duplicate,7);assert.equal(result.summary.applied,1);
 assert.equal(result.decisions[0].candidates[0].label,'applied');assert.equal(result.decisions[0].candidates[1].label,'unknown');
 assert.equal(result.decisions[0].trainingEligible,true);assert.equal(result.decisions[0].candidates[0].outcomeCensored,true);
 assert.equal(result.decisions[0].candidates[0].defaultAccepted,true);
});
test('Extraction reconstructs code replacements and resolves late text definitions consistently',()=>{
 const codec=createCodec({text:true});let n=0;const event=(kind,data)=>{const e=codec.encode(data);return{id:crypto.randomUUID(),n:++n,k:EVENTS.indexOf(kind),t:n,v:e.tree,texts:e.texts};};
 const common={participant_id:'participant',release:'v0.0.7',session:crypto.randomUUID()};
 const first={...common,events:[event('state',{stateId:'before',checkpoint:[{method:'encodeSize',args:{value:3}},{method:'encodeSize',args:{value:4}}]})]};
 const second={...common,events:[event('state',{stateId:'after',sourceState:'before',patch:{index:1,removed:1,calls:[{method:'encodeSize',args:{value:5}}]}}),event('context',{text:'before'})]};
 const result=extractResearch([second,first]);assert.equal(result.states[0].stateId,'before');assert.equal(result.states[1].sourceState,'before');
 assert.deepEqual(result.states[1].calls.map(c=>c.args.value),[3,5]);assert.equal(result.quality.unresolvedReferences,0);
 const missing=extractResearch([{...second,events:[...second.events,event('slate',{slateId:'orphan',sourceState:'after'})]}]);
 assert.ok(missing.quality.unresolvedReferences>0);assert.equal(missing.decisions[0].trainingEligible,false);
});
