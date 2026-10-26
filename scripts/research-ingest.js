import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { validTree, PROTOCOL, EVENTS } from '../web/research/protocol.js';
const unzip=promisify(gunzip), uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function validResearchBatch(batch) {
  return batch?.protocol===PROTOCOL && uuid.test(batch.id) && uuid.test(batch.session) && Number.isInteger(batch.consent) && batch.consent>0 &&
    typeof batch.time==='string' && Number.isFinite(Date.parse(batch.time)) && Array.isArray(batch.events) && batch.events.length>0 && batch.events.length<=48 &&
    batch.events.every(e=>uuid.test(e.id)&&Number.isSafeInteger(e.n)&&e.n>0&&Number.isFinite(e.t)&&e.t>=0&&Number.isInteger(e.k)&&e.k>=0&&e.k<EVENTS.length&&validTree(e.v)&&
      (!e.texts || Object.entries(e.texts).length<=2048&&Object.entries(e.texts).every(([k,v])=>uuid.test(k)&&typeof v==='string'&&v.length<=2048))) &&
    (!batch.losses || Object.values(batch.losses).every(n=>Number.isSafeInteger(n)&&n>=0));
}
export function createResearchIngest(config,{fetcher=fetch}={}) {
  let active=0;
  return async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    if(req.method!=='POST')return reply(405,{});
    try {if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)return reply(403,{});}
    catch {return reply(403,{});}
    const auth=req.headers.authorization;
    if(!/^Bearer [^\s]+$/i.test(auth??''))return reply(401,{});
    if(!config.supabaseUrl||!config.supabaseKey)return reply(503,{});
    if(active>=8)return reply(429,{});
    active++;
    try {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>256*1024)return reply(413,{});chunks.push(chunk);}
      let body=Buffer.concat(chunks);
      if(req.headers['content-encoding']==='gzip')body=await unzip(body,{maxOutputLength:1024*1024});
      else if(req.headers['content-encoding'] && req.headers['content-encoding']!=='identity')return reply(415,{});
      if(body.length>1024*1024)return reply(413,{});
      const batch=JSON.parse(body.toString());
      if(!validResearchBatch(batch))return reply(400,{});
      // Forward the user's bearer, never a service key. SQL checks identity,
      // consent epoch and scopes inside the same transaction as the insert.
      const result=await fetcher(`${config.supabaseUrl}/rest/v1/rpc/record_research_batch`,{method:'POST',headers:{apikey:config.supabaseKey,Authorization:auth,'Content-Type':'application/json'},
        body:JSON.stringify({batch,release:config.release??'development'}),signal:AbortSignal.timeout(12000)});
      if(!result.ok)return reply(result.status===401?401:503,{});
      reply(200,await result.json());
    } catch {reply(400,{});}finally{active--;}
  };
}
