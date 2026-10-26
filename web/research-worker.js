import { packForTransport } from './research/batch.js';
self.onmessage=async({data})=>{
  try { const result=await packForTransport(data.value); self.postMessage({id:data.id,result},result.parts.map(part=>part.body.buffer)); }
  catch { self.postMessage({id:data.id,error:true}); }
};
