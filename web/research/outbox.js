import { CONSENT, PROTOCOL, EVENTS, createCodec } from './protocol.js';
import { packForTransport } from './batch.js';
const MAX_PENDING=160, MAX_BATCH=48, MAX_BYTES=8*1024*1024, MAX_BATCHES=160, MAX_AGE=7*86400000;
// Research owns a separate, bounded queue and independent retry clock. No
// project upload, thumbnail generation or renderer is awaited on this path.
export function createResearchOutbox({local, send, now=()=>Date.now(), clock=()=>performance.now(), workerFactory,
  online=()=>globalThis.navigator?.onLine!==false, interval=5000, onState=()=>{}, channel=true}={}) {
  let identity=null, profile=null, codec=createCodec(), pending=[], sequence=0, session=crypto.randomUUID();
  let timer=null, flushing=null, sending=null, epoch=0, retryAt=0, failures=0, closed=false;
  let dropped=0, omitted=0, persisted=0, rawBytes=0, compressedBytes=0, storageErrors=0;
  let worker=null, workerSequence=0; const requests=new Map(), listeners=new Set();
  const transportChannel=channel && typeof BroadcastChannel==='function'?new BroadcastChannel('vis-research-consent-v2'):null;
  const enabled=()=>!closed && identity && profile?.research_enabled===true && [CONSENT,'history-only-v1'].includes(profile?.consent_version);
  const prefix=owner=>`research:${owner}:`;
  const entries=async owner=>local.entries?local.entries(prefix(owner),MAX_BATCHES+64):(await Promise.all((await local.keys()).filter(k=>k.startsWith(prefix(owner))).sort().map(async k=>[k,await local.get(k)])));
  async function purge(owner) { if(!owner)return;let queued;while((queued=await entries(owner)).length)for(const [key]of queued)await local.remove(key); }
  function change(owner,p) {
    if(identity===owner && profile?.consent_revision===p?.consent_revision && profile?.consent_version===p?.consent_version && profile?.research_enabled===p?.research_enabled)return;
    const previous=identity; epoch++; pending=[]; clearTimeout(timer); timer=null;
    identity=owner; profile=p; session=crypto.randomUUID();sequence=0;
    codec=createCodec({text:true});
    retryAt=0;failures=0;
    if(previous && (!enabled()||previous!==owner))purge(previous).catch(()=>{});
    for(const listener of listeners)listener(); onState();
    if(enabled()) emit('session',{protocol:PROTOCOL, policy:'deterministic',actor:'unknown',actorEvidence:'unknown'});
  }
  if(transportChannel) transportChannel.onmessage=({data})=>{
    if(data?.owner===identity && data.revision!==profile?.consent_revision)change(identity,null);
  };
  function emit(kind,input={}) {
    if(!enabled() || !EVENTS.includes(kind))return null;
    if(pending.length>=MAX_PENDING){dropped++;return null;}
    const data=codec.encode(typeof input==='function'?input():input); omitted+=data.omitted;
    const event={id:crypto.randomUUID(),n:++sequence,t:Math.round(clock()*10)/10,k:EVENTS.indexOf(kind),v:data.tree,
      ...(data.texts?{texts:data.texts}:{}),...(data.omitted?{omitted:data.omitted}:{})};
    pending.push(event);
    if(pending.length>=MAX_BATCH && !flushing){clearTimeout(timer);timer=null;}
    if(!timer && !flushing)timer=setTimeout(()=>{timer=null;flush().catch(()=>{});},pending.length>=MAX_BATCH?0:1000);
    return event.id;
  }
  function pack(value) {
    if(!workerFactory)return packForTransport(value);
    if(!worker) {
      worker=workerFactory();
      worker.onmessage=({data})=>{const request=requests.get(data.id);if(!request)return;requests.delete(data.id);clearTimeout(request.timer);data.error?request.reject(new Error('pack')):request.resolve(data.result);};
      worker.onerror=()=>{worker.terminate();worker=null;for(const r of requests.values()){clearTimeout(r.timer);r.reject(new Error('worker'));}requests.clear();};
    }
    return new Promise((resolve,reject)=>{const id=++workerSequence;
      const timer=setTimeout(()=>{requests.delete(id);reject(new Error('pack timeout'));},10000);
      requests.set(id,{resolve,reject,timer});worker.postMessage({id,value});
    });
  }
  async function flush() {
    if(flushing)return flushing;
    clearTimeout(timer);timer=null;
    flushing=(async()=>{
      while(enabled() && pending.length) {
        const owner=identity, version=epoch, consent=profile.consent_revision;
        const events=pending.splice(0,MAX_BATCH);
        const losses={dropped,omitted,storageErrors}; dropped=omitted=storageErrors=0;
        const value={protocol:PROTOCOL,id:crypto.randomUUID(),session,consent,time:new Date(now()).toISOString(),events,losses};
        let packed;
        try { packed=await pack(value); } catch { storageErrors++;dropped+=events.length;continue; }
        if(version!==epoch || !enabled())return;
        dropped+=packed.dropped;
        if(packed.dropped)emit('quality',{dropped:packed.dropped,reason:'overflow'});
        for(const part of packed.parts){
        const key=`${prefix(owner)}${String(now()).padStart(16,'0')}:${String(part.firstSequence).padStart(12,'0')}:${part.id}`;
        try {
          const queued=await entries(owner);let bytes=queued.reduce((n,[,v])=>n+(v.bytes??0),0),count=queued.length;
          for(const [oldKey,old]of queued) {
            if(old.consent===consent && now()-old.created<MAX_AGE && bytes+part.bytes<=MAX_BYTES && count<MAX_BATCHES)continue;
            await local.remove(oldKey);bytes-=old.bytes??0;count--;dropped+=old.count??0;
          }
          if(version!==epoch||!enabled())return;
          await local.put(key,{...part,consent,created:now()});
          // Withdrawal can interleave the IndexedDB transaction completion.
          if(version!==epoch||!enabled()){await local.remove(key);return;}
          persisted+=part.count;rawBytes+=part.rawBytes;compressedBytes+=part.bytes;
        } catch { storageErrors++;dropped+=part.count; }
        }
      }
    })().finally(()=>{flushing=null;});
    return flushing;
  }
  async function drain() {
    if(sending)return sending;
    if(!enabled()||!online()||now()<retryAt)return;
    const owner=identity, version=epoch;
    sending=(async()=>{
      await flush();
      for(const [key,batch]of await entries(owner)) {
        if(version!==epoch||!enabled())return;
        if(batch.consent!==profile.consent_revision||now()-batch.created>MAX_AGE){await local.remove(key);continue;}
        const result=await send(batch,()=>version===epoch&&enabled());
        if(result?.revoked){change(owner,null);await purge(owner);return;}
        if(result?.ok!==true)throw new Error('ingest');
        await local.remove(key);failures=0;retryAt=0;
      }
    })().catch(()=>{retryAt=now()+Math.min(60000,1000*2**Math.min(6,failures++));})
      .finally(()=>{sending=null;});
    return sending;
  }
  const tick=setInterval(()=>{drain();},interval);tick.unref?.();
  return {emit,flush,drain,configure:change, get enabled(){return Boolean(enabled());},get scopes(){return profile?.research_scopes??{};},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    async revoke(){const owner=identity;change(owner,null);transportChannel?.postMessage({owner,revision:null});await flushing;await purge(owner);},
    broadcast(){transportChannel?.postMessage({owner:identity,revision:profile?.consent_revision});},
    metrics:()=>({persisted,rawBytes,compressedBytes,dropped,omitted,storageErrors,pending:pending.length,failures}),
    async destroy(){await flush();closed=true;clearTimeout(timer);clearInterval(tick);transportChannel?.close();worker?.terminate();for(const r of requests.values()){clearTimeout(r.timer);r.reject(new Error('closed'));}requests.clear();},
  };
}
