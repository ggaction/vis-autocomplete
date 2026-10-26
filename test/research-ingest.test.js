import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {once} from 'node:events';
import {gzipSync} from 'node:zlib';import {createResearchIngest} from '../scripts/research-ingest.js';import {createCodec} from '../web/research/protocol.js';
test('Ingest accepts bounded gzip, forwards user auth, rejects origins and malformed bodies',async()=>{
 const sent=[];const handle=createResearchIngest({supabaseUrl:'https://fake.test',supabaseKey:'public',release:'test'},
  {fetcher:async(url,init)=>{sent.push({url,init});return Response.json({ok:true});}});
 const server=http.createServer(handle);server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 const batch={protocol:2,id:crypto.randomUUID(),session:crypto.randomUUID(),consent:1,time:new Date().toISOString(),events:[{id:crypto.randomUUID(),n:1,t:1,k:0,v:createCodec().encode({method:'encodeSize'}).tree}]};
 try{
 const headers={Authorization:'Bearer fake-token','Content-Encoding':'gzip',Origin:origin};
 let response=await fetch(origin,{method:'POST',headers,body:gzipSync(JSON.stringify(batch))});assert.equal(response.status,200);assert.equal(sent.length,1);assert.equal(sent[0].init.headers.Authorization,'Bearer fake-token');
 response=await fetch(origin,{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:gzipSync('{}')});assert.equal(response.status,403);
 response=await fetch(origin,{method:'POST',headers:{...headers,Origin:'invalid-origin'},body:gzipSync('{}')});assert.equal(response.status,403);
 response=await fetch(origin,{method:'POST',headers,body:gzipSync(JSON.stringify({...batch,events:[{...batch.events[0],v:'secret'}]}))});assert.equal(response.status,400);
 response=await fetch(origin,{method:'POST',headers,body:gzipSync(' '.repeat(2*1024*1024))});assert.equal(response.status,400);
 response=await fetch(origin,{method:'POST',body:'{}'});assert.equal(response.status,401);assert.equal(sent.length,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
