import { decode,EVENTS } from '../../web/research/protocol.js';
import { createHash } from 'node:crypto';
// Observations and labels are separate. No hover is interpreted as dislike,
// and computed-but-unseen candidates never become negative examples.
export function extractResearch(batches,{excludeActors=['ai','test'],cutoff=null,deletions=[]}={}) {
 const deleted=new Set(deletions.map(d=>typeof d==='string'?d:d.participant_id));
 batches=batches.filter(b=>!deleted.has(b.participant_id));
 const texts=new Map(),seen=new Set(),events=[],quality={duplicate:0,gaps:0,dropped:0,omitted:0,invalid:0,unresolvedReferences:0};
 // A string can first be used as an opaque reference, then appear as a field
 // or chart label later. Resolve the session dictionary before decoding any
 // event so identity joins do not change halfway through the export.
 for(const batch of batches){const key=(batch.participant_id??'unknown')+':'+(batch.session_id??batch.session);
   if(!texts.has(key))texts.set(key,{});for(const e of batch.events??[])Object.assign(texts.get(key),e.texts??{});}
 const seq=new Map();
 for(const batch of [...batches].sort((a,b)=>(a.participant_id??'').localeCompare(b.participant_id??'')||(a.session_id??a.session).localeCompare(b.session_id??b.session)||(a.first_sequence??a.events[0]?.n??0)-(b.first_sequence??b.events[0]?.n??0))) {
  const participant=batch.participant_id??'unknown',session=batch.session_id??batch.session,key=participant+':'+session;
  if(!texts.has(key))texts.set(key,{});const dictionary=texts.get(key);
  quality.dropped+=batch.losses?.dropped??0;quality.omitted+=batch.losses?.omitted??0;
  for(const e of batch.events??[])Object.assign(dictionary,e.texts??{});
  for(const e of batch.events??[]) {
   if(seen.has(e.id)){quality.duplicate++;continue;}seen.add(e.id);
   const previous=seq.get(key)??0;if(e.n>previous+1)quality.gaps+=e.n-previous-1;seq.set(key,Math.max(previous,e.n));
   try {events.push({id:e.id,participant,session,sequence:e.n,time:e.t,received:batch.received_at??batch.time,release:batch.release,
      kind:EVENTS[e.k],data:decode(e.v,dictionary)});}catch{quality.invalid++;}
  }
 }
 const slates=new Map(),operations=new Map(),states=new Map(),parameterTrials=[],searches=[],histories=[],actors=new Map();
 for(const event of events){const {data:d,kind}=event,key=event.participant+':'+event.session;
  if(kind==='actor')actors.set(key,d.actor);
  if(kind==='slate'){
    if(!slates.has(d.slateId))slates.set(d.slateId,{id:d.slateId,participant:event.participant,session:event.session,sourceState:d.sourceState,
      context:d,received:event.received,release:event.release,candidates:new Map(),queries:[]});
    else Object.assign(slates.get(d.slateId).context,d);
  }
  if(kind==='candidate'){
    const slate=slates.get(d.slateId);if(slate)slate.candidates.set(d.candidateId,{...d,seen:false,exposures:0,visibleDuration:0,explored:false,applied:false,defaultAccepted:null});
  }
  if(kind==='exposure') {const c=slates.get(d.slateId)?.candidates.get(d.candidateId);if(c){c.seen=true;if(d.status==='start')c.exposures++;else c.visibleDuration+=d.duration??0;}}
  if(kind==='preview'||kind==='parameter') {const c=slates.get(d.slateId)?.candidates.get(d.candidateId);if(c)c.explored=true;}
  if(kind==='controls'){const c=slates.get(d.slateId)?.candidates.get(d.candidateId);if(c)c.controls=d.controls;}
  if(kind==='preview'&&d.defaults){const c=slates.get(d.slateId)?.candidates.get(d.candidateId);if(c)c.defaults=d.defaults;}
  if(kind==='parameter')parameterTrials.push({...event,...d});
  if(kind==='search')searches.push({...event,...d});
  if(kind==='state') {
    let calls=d.checkpoint;
    const base=states.get(d.sourceState);
    if(!calls && base && !base.incomplete && Number.isInteger(d.patch?.index) && Number.isInteger(d.patch?.removed) && Array.isArray(d.patch?.calls)){
      calls=[...base.calls];calls.splice(d.patch.index,d.patch.removed,...d.patch.calls);}
    if(!calls)quality.unresolvedReferences++;
    states.set(d.stateId,{...d,calls:calls??[],incomplete:!calls,participant:event.participant});
  }
  if(kind==='operation'){
    const op=operations.get(d.operationId)??{participant:event.participant,session:event.session};Object.assign(op,d);operations.set(d.operationId,op);
    if(d.status==='completed' && op.action==='apply'){
      const c=slates.get(op.slateId)?.candidates.get(op.candidateId);if(c){c.applied=true;c.resultState=op.destinationState;
        c.defaultAccepted=JSON.stringify(c.defaults)===JSON.stringify(op.values);}
    }
  }
  if(kind==='history')histories.push({...event,...d});
 }
 const decisions=[];
 for(const slate of slates.values()){
  slate.queries=searches.filter(q=>q.queryId===slate.context.queryId);
  const source=states.get(slate.sourceState),complete=Boolean(source&&!source.incomplete);
  if(!complete && slate.candidates.size)quality.unresolvedReferences++;
  const actor=actors.get(slate.participant+':'+slate.session)??'unknown';
  const hash=createHash('sha256').update(slate.participant).digest().readUInt32BE(0)%100;
  const split=hash<80?'train':hash<90?'validation':'test';
  const temporalSplit=cutoff?(new Date(slate.received)>=new Date(cutoff)?'test':'train'):null;
  decisions.push({...slate,candidates:[...slate.candidates.values()].map(c=>({...c,label:c.applied?'applied':c.seen?'observed-unselected':'unknown',
    laterUndone:histories.some(h=>h.reason==='undo'&&h.sourceState===c.resultState),outcomeCensored:true})),actor,
    trainingEligible:complete&&!excludeActors.includes(actor)&&slate.participant!=='unknown'&&Boolean(slate.release)&&!['test','development'].includes(slate.release),split,temporalSplit});
 }
 return {schemaVersion:2,events,decisions,parameterTrials,searches,histories,operations:[...operations.values()],states:[...states.values()],quality,
  summary:{sessions:seq.size,events:events.length,slates:decisions.length,candidates:decisions.reduce((n,s)=>n+s.candidates.length,0),
    seen:decisions.reduce((n,s)=>n+s.candidates.filter(c=>c.seen).length,0),applied:decisions.reduce((n,s)=>n+s.candidates.filter(c=>c.applied).length,0)}};
}
