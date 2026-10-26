import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodec,decode,validTree,vocabulary } from '../web/research/protocol.js';
import { createTrajectory,createResearchCollector } from '../web/research/collector.js';
import { packBatch,unpackBatch,packForTransport } from '../web/research/batch.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
test('Protocol 2 vocabulary stays immutable and SQL accepts its exact index range',()=>{
 assert.equal(createHash('sha256').update(JSON.stringify(vocabulary)).digest('hex'),'bf6c663755bcbdf91ec3d19f47bb4c39a72d667dd029e07ce4be3ec138727931');
 assert.ok(readFileSync(new URL('../supabase/migrations/202610270001_research_v2.sql',import.meta.url),'utf8').includes(`between 0 and ${vocabulary.length-1}`));
});
test('Typed projection distinguishes design from data; raw content only in named text scope',()=>{
 const codec=createCodec({text:true});
 const result=codec.encode({calls:[{method:'encodeSize',args:{target:'plot',value:948}},{method:'filterData',args:{field:'Salary',greaterThan:1234567}},
  {method:'createTitle',args:{text:'Research chart\nsecond line',titleStyle:{fontSize:23}}}],query:'show salary',field:'linear',
  rows:[{secret:'never'}],password:'never',access_token:'never',args:{domain:[987654321]},error:'sensitive-error@example.com'});
 assert.equal(validTree(result.tree),true);
 const raw=JSON.stringify(result);assert.ok(!raw.includes('sensitive-error@example.com'));assert.ok(!raw.includes('never'));assert.ok(!raw.includes('1234567'));assert.ok(!raw.includes('987654321'));
 const decoded=decode(result.tree,result.texts);
 assert.equal(decoded.calls[0].args.value,948);assert.equal(decoded.calls[0].args.target.startsWith('ref:'),true);
 assert.equal(decoded.calls[1].args.field,'Salary');assert.equal(decoded.field,'linear');assert.equal(decoded.query,'show salary');
 assert.equal(decoded.calls[2].args.text,'Research chart\nsecond line');assert.equal(decoded.calls[2].args.titleStyle.fontSize,23);
 assert.equal(result.omitted,3);
 assert.equal(createCodec().encode({field:'secret'}).texts,undefined);
});
test('Reference IDs are stable in one epoch, bounded and not hashes of low entropy data',()=>{
 const c=createCodec({text:true,aliasLimit:2});const a=c.encode({field:'Private'}),b=c.encode({field:'Private'});
 assert.deepEqual(a.tree,b.tree);assert.equal(b.texts,undefined);assert.equal(Object.values(a.texts)[0],'Private');
 c.encode({field:'Second'});assert.ok(c.encode({field:'Third'}).omitted>0);
 c.reset();assert.notDeepEqual(c.encode({field:'Private'}).tree,a.tree);
});
test('Structural patches and numeric controls keep their exact numeric meaning',()=>{
 const codec=createCodec({text:true});
 const result=codec.encode({stateRevision:3,patch:{index:1,removed:2,calls:[]},
   controls:[{key:'customNumericParameter',type:'number',before:2,after:3,samples:[{elapsed:4,value:2.5}]}],
   calls:[{method:'encodeSize',args:{value:948,domain:[1234567]}}]});
 const value=decode(result.tree,result.texts);
 assert.equal(value.stateRevision,3);assert.equal(value.patch.removed,2);
 assert.equal(value.controls[0].before,2);assert.equal(value.controls[0].samples[0].value,2.5);
 assert.equal(value.calls[0].args.value,948);assert.ok(!JSON.stringify(result).includes('1234567'));
});
test('Literal data inside ggaction calls never leaks through chart-text collection',()=>{
 const encoded=createCodec({text:true}).encode({calls:[{method:'createData',args:{id:'dataset',values:[{text:'raw-private-row',fontSize:1234567}]}}]});
 const serialized=JSON.stringify(encoded);assert.ok(!serialized.includes('raw-private-row'));assert.ok(!serialized.includes('1234567'));
 assert.equal(decode(encoded.tree,encoded.texts).calls[0].args.values,undefined);
});
test('Protocol rejects free strings, objects, invalid tags, oversized and deep trees',()=>{
 for(const tree of ['raw',{rows:[1]},[1,vocabulary.length],[2,'private'],[0,Infinity],[4,[[[0,1],[0,2]]]],[3,[], -1]]) assert.equal(validTree(tree),false);
 let deep=null;for(let i=0;i<30;i++)deep=[3,[deep],0];assert.equal(validTree(deep),false);
});
test('Trajectory exact boundaries and reversals survive a bounded 10Hz sample',()=>{
 let t=0;const trace=createTrajectory({clock:()=>t,limit:3});
 for(const n of [1,2,3,2,1,4,9,5]){trace.add(n);t+=60;}
 const result=trace.finish();assert.equal(result.sampleCount,8);assert.equal(result.samples[0].value,1);assert.equal(result.samples.at(-1).value,5);
 assert.equal(result.minValue,1);assert.equal(result.maxValue,9);assert.equal(result.reversals,3);assert.ok(result.truncated>0);assert.equal(result.samples.length,3);
});
test('Graph replacements have distinct immutable states; unseen candidates have no exposure',()=>{
 const events=[],sink={enabled:true,emit:(k,v)=>events.push([k,v]),subscribe(){}},r=createResearchCollector({sink});
 const one={};r.capture({datasetId:'d',nodeId:'n',snapshot:one,calls:[]});const a=r.stateId;
 r.slate(1,{phase:'recommendations'});const card={method:'encodeSize',controls:[{key:'value',type:'number',min:1,max:100}],values:{value:4}};
 r.candidate(card,1,1);r.capture({datasetId:'d',nodeId:'n',snapshot:{},calls:[{method:'encodeSize',args:{value:5}}]});
 assert.notEqual(r.stateId,a);assert.equal(events.filter(([k])=>k==='state').at(-1)[1].coalesced,true);
 assert.equal(events.filter(([k])=>k==='exposure').length,0);r.exposure(card,.6);r.exposure(card,0);
 assert.equal(events.filter(([k])=>k==='exposure').length,2);
 r.capture({datasetId:'d',nodeId:'n',snapshot:one,calls:[]});assert.equal(r.stateId,a);
 r.begin('move');r.finish('completed');assert.equal(events.at(-1)[1].status,'completed');
});
test('Batch packing compresses repeated metadata and is lossless',async()=>{
 const input={events:Array.from({length:48},(_,n)=>({n,v:createCodec().encode({method:'encodeSize',duration:10}).tree}))};
 const packed=await packBatch(input);assert.ok(packed.bytes<packed.rawBytes/3);assert.deepEqual(await unpackBatch(packed),input);
});

test('Large individual events are byte-split without reordering or duplicating event IDs',async()=>{
 const events=Array.from({length:48},(_,n)=>({id:crypto.randomUUID(),n:n+1,v:'x'.repeat(20000)}));
 const result=await packForTransport({id:crypto.randomUUID(),events,losses:{}});
 assert.ok(result.parts.length>1);const unpacked=await Promise.all(result.parts.map(unpackBatch));
 assert.deepEqual(unpacked.flatMap(p=>p.events).map(e=>e.id),events.map(e=>e.id));
 assert.ok(result.parts.every(p=>p.rawBytes<240*1024 && p.bytes<256*1024));assert.equal(result.dropped,0);
 assert.equal(new Set(unpacked.map(p=>p.id)).size,result.parts.length);
});

test('Telemetry never executes control predicates or blocks authoring on a collector error',()=>{
 let invoked=0;const events=[],sink={enabled:true,emit:(kind,data)=>events.push([kind,data]),subscribe(){}};
 const collector=createResearchCollector({sink});collector.slate(1,{});
 collector.proposals([{method:'layoutSeries',controls:[{key:'mode',when:()=>{invoked++;throw Error('do not execute');}}]}],1);
 assert.equal(invoked,0);assert.ok(events.some(([kind])=>kind==='candidate'));
 sink.emit=()=>{throw Error('offline');};assert.doesNotThrow(()=>collector.begin('apply'));assert.doesNotThrow(()=>collector.proposals([{method:'x'}],1));
});
