export async function packBatch(value) {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  if (typeof CompressionStream !== 'function') return { body: raw, encoding: 'identity', bytes: raw.byteLength, rawBytes: raw.byteLength };
  const body = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return { body, encoding: 'gzip', bytes: body.byteLength, rawBytes: raw.byteLength };
}
export async function unpackBatch({ body, encoding }) {
  const stream=new Blob([body]).stream();
  return JSON.parse(await new Response(encoding==='gzip'?stream.pipeThrough(new DecompressionStream('gzip')):stream).text());
}

// Count limits alone are insufficient: a single large parameter menu can be
// larger than dozens of ordinary events. Split by encoded bytes in the worker.
export async function packForTransport(batch, maxBytes=240*1024) {
  const encoder=new TextEncoder(), parts=[];let events=[],bytes=0,dropped=0;
  const flush=async()=>{
    if(!events.length)return;
    const id=parts.length?crypto.randomUUID():batch.id;
    const packed=await packBatch({...batch,id,events,losses:parts.length?{}:batch.losses});
    parts.push({...packed,id,count:events.length,firstSequence:events[0].n});events=[];bytes=0;
  };
  for(const event of batch.events){const size=encoder.encode(JSON.stringify(event)).byteLength;
    if(size>maxBytes-2048){dropped++;continue;}
    if(bytes+size>maxBytes-2048)await flush();events.push(event);bytes+=size+1;
  }
  await flush();return {parts,dropped};
}
