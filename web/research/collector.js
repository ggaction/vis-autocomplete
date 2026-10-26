// Exact semantic boundaries; dense input trajectories use a bounded 10 Hz
// sample plus exact endpoints/extrema/reversals. Sampling is explicit in data.
export function createTrajectory({clock=()=>performance.now(),period=100,limit=256}={}) {
  let start=null,last=null,lastSample=-Infinity,min=Infinity,max=-Infinity,reversals=0,direction=0,count=0,samples=[],dropped=0;
  return {
    add(value,point) {
      const t=clock();if(start===null)start=t;
      if(last && typeof value==='number' && typeof last.value==='number') {
        const next=Math.sign(value-last.value);if(next && direction && next!==direction)reversals++;if(next)direction=next;
      }
      if(typeof value==='number'){min=Math.min(min,value);max=Math.max(max,value);}
      last={elapsed:Math.round(t-start),value,...point};count++;
      if(t-lastSample>=period){if(samples.length<limit)samples.push(last);else dropped++;lastSample=t;}
    },
    finish() {
      if(!last)return null;
      if(samples.at(-1)!==last){if(samples.length===limit){samples[samples.length-1]=last;dropped++;}else samples.push(last);}
      return {duration:Math.round(clock()-start),samplePeriod:period,sampleCount:count,samples,
        minValue:Number.isFinite(min)?min:null,maxValue:Number.isFinite(max)?max:null,reversals,truncated:dropped,status:'sampled'};
    }
  };
}
export function createResearchCollector({sink,clock=()=>performance.now()}={}) {
  let scope=null,stateId=null,lastCalls=[],states=new WeakMap(),nodeStates=new Map(),revision=0;
  let slate=null,active=null,parameter=null,operation=null,searchId=null,selectedActor='unknown';
  const slots=new Map(),slates=new Map(),candidates=new WeakMap(),controlSignatures=new WeakMap(),exposures=new Map();
  const enabled=()=>sink?.enabled===true;
  const emit=(kind,data)=>enabled()?sink.emit(kind,typeof data==='function'?data():data):null;
  const id=()=>crypto.randomUUID();
  const refs=card=>candidates.get(card)??{};
  function reset() { scope=null;stateId=null;lastCalls=[];states=new WeakMap();nodeStates.clear();revision=0;slate=null;active=null;parameter=null;operation=null;searchId=null;slates.clear();slots.clear();exposures.clear(); }
  sink?.subscribe(reset);
  function capture({projectId,datasetId,nodeId,snapshot,calls=[],setupCalls=[],selection,context,phase,profile,mode,layout,versions}={}) {
    if(!enabled()||!snapshot)return null;
    const nextScope=String(projectId??'local')+':'+String(datasetId);
    if(scope!==nextScope){reset();scope=nextScope;emit('context',{projectId,datasetId,phase,mode,layout,versions,
      fields:profile?.fields?.map(f=>({field:f.name,fieldType:f.fieldType??f.type})),rowCount:profile?.rowCount,
      actor:selectedActor,actorEvidence:selectedActor==='unknown'?'unknown':'selfDeclared'});}
    const existing=states.get(snapshot);
    if(existing){stateId=existing;lastCalls=calls;return existing;}
    const previous=stateId, next=id(), sameNode=nodeStates.get(nodeId), checkpoint=revision++%20===0;
    let common=0;while(common<lastCalls.length&&common<calls.length&&lastCalls[common]===calls[common])common++;
    emit('state',{stateId:next,sourceState:previous,historyNode:nodeId,previousNode:sameNode,stateRevision:revision,
      coalesced:Boolean(sameNode),phase,selection,context,mode,layout,
      ...(checkpoint?{checkpoint:calls,setupCalls}:{patch:{index:common,removed:lastCalls.length-common,calls:calls.slice(common)}})});
    stateId=next;states.set(snapshot,next);nodeStates.set(nodeId,next);lastCalls=calls;
    if(nodeStates.size>4000)nodeStates.delete(nodeStates.keys().next().value);
    return next;
  }
  function finishParameter(reason='end') {
    if(!parameter)return;
    emit('parameter',{...parameter.refs,interactionId:parameter.id,key:parameter.key,type:parameter.type,reason,
      before:parameter.before,after:parameter.after,...parameter.trajectory?.finish(),status:'end'});parameter=null;
  }
  function endPreview(reason='leave') {
    finishParameter(reason);
    if(active)emit('preview',{...active.refs,interactionId:active.id,status:'end',reason,duration:clock()-active.start});
    active=null;
  }
  const api = {
    emit,capture,reset,refs,get stateId(){return stateId;},get slateId(){return slate;},
    slate(generation,context) {
      if(!enabled())return;
      endPreview('superseded');for(const [card]of exposures)this.exposure(card,0);
      slate=id();slates.set(generation,slate);if(slates.size>12)slates.delete(slates.keys().next().value);
      emit('slate',{slateId:slate,sourceState:stateId,queryId:searchId,status:'requested',policy:'deterministic',probability:null,...context});return slate;
    },
    proposals(specs,generation){if(!enabled())return;for(const [index,spec]of specs.entries())this.candidate(spec,index,generation);},
    slateResult(generation,data){emit('slate',{slateId:slates.get(generation),sourceState:stateId,...data});},
    candidate(card,index,generation) {
      if(!enabled())return;
      const slateId=slates.get(generation)??slate,slot=slateId+':'+index+':'+card.method;
      if(slots.has(slot)){card.researchRef=slots.get(slot);candidates.set(card,card.researchRef);if(card.values)this.controls(card);return card.researchRef;}
      if(card.researchRef?.slateId===slateId){candidates.set(card,card.researchRef);if(card.values)this.controls(card);return card.researchRef;}
      const metadata={slateId,candidateId:id(),method:card.method,rank:index+1};card.researchRef=metadata;slots.set(slot,metadata);if(slots.size>2000)slots.delete(slots.keys().next().value);
      candidates.set(card,metadata);
      emit('candidate',{...metadata,sourceState:stateId,score:card.score,scoreKind:card.scoreKind,category:card.category,
        defaultSource:card.defaultSource,defaultDecisions:card.defaultDecisions??card.original?.defaultDecisions,
        evidence:card.evidence,parameterEvidence:card.parameterEvidence,requirement:card.requirement,status:card.disabled?'excluded':'eligible',
        args:card.original?.args,defaults:card.values});
      if(card.values)this.controls(card);return metadata;
    },
    controls(card) {
      if(!enabled())return;
      const visibility=new Map((card.controlElements??[]).map(entry=>[entry.definition.key,!entry.element.hidden]));
      const project=list=>(list??[]).map(c=>({key:c.key,path:c.path,type:c.type,value:c.value,
        minimum:c.min,maximum:c.max,step:c.step,minimumCount:c.minimum,count:c.choices?.length,
        choices:c.choices?.slice(0,512).map(v=>({value:v.value,disabled:v.disabled,fieldType:v.fieldType})),
        visible:visibility.has(c.key)?visibility.get(c.key):c.when?null:true,controls:c.controls?project(c.controls):undefined}));
      const controls=project(card.controls),signature=JSON.stringify([refs(card).slateId,controls]);
      if(controlSignatures.get(card)===signature)return;
      controlSignatures.set(card,signature);emit('controls',{...refs(card),controls});
    },
    exposure(card,fraction,rect={}) {
      if(!enabled())return;
      if(fraction<=0) {
        const previous=exposures.get(card);if(!previous)return;
        emit('exposure',{...previous.refs,status:'end',duration:clock()-previous.start,fraction:previous.fraction});exposures.delete(card);
      } else if(!exposures.has(card)) {
        const data={refs:refs(card),start:clock(),fraction};exposures.set(card,data);
        emit('exposure',{...data.refs,status:'start',fraction,rect});
      }
    },
    preview(card,inputKind='pointer') {
      if(!enabled())return;
      if(active?.card===card)return;
      endPreview('superseded');active={card,refs:refs(card),id:id(),start:clock()};
      emit('preview',{...active.refs,interactionId:active.id,status:'start',inputKind});
    },
    previewResult(card,status,data={}) {emit('preview',{...refs(card),interactionId:active?.card===card?active.id:null,status,...data});},
    endPreview,
    parameter(card,key,before,after,definition={},inputKind='pointer',status='selected') {
      if(!enabled())return;
      if(parameter?.card!==card||parameter?.key!==key){finishParameter();parameter={card,key,type:definition.type,id:id(),refs:refs(card),before,after};
        if(definition.type==='number') {parameter.trajectory=createTrajectory({clock});parameter.trajectory.add(before);}
        emit('parameter',{...parameter.refs,interactionId:parameter.id,key,type:definition.type,status:'start',before,inputKind});}
      parameter.after=after;
      if(parameter.trajectory)parameter.trajectory.add(after);
      else emit('parameter',{...parameter.refs,interactionId:parameter.id,key,status,before,after,inputKind});
    },
    parameterBoundary(card,key,status) {finishParameter(status);emit('parameter',{...refs(card),key,status});},
    search(query,group) { const previousQueryId=searchId;searchId=id();emit('search',{queryId:searchId,previousQueryId,slateId:slate,sourceState:stateId,query,queryLength:query.length,queryTokens:query.trim()?query.trim().split(/\s+/).length:0,status:query?'search':'clear',group});},
    begin(kind,detail={}) {
      if(!enabled())return null;
      finishParameter('apply');if(operation)this.finish('interrupted');
      operation={id:id(),kind,start:clock(),sourceState:stateId,trajectory:createTrajectory({clock})};
      emit('operation',{operationId:operation.id,sourceState:stateId,action:kind,status:'start',...detail});return operation.id;
    },
    motion(value,point) {if(enabled())operation?.trajectory.add(value,point);},
    finish(status,detail={}) {
      if(!operation)return;
      emit('operation',{operationId:operation.id,sourceState:operation.sourceState,destinationState:stateId,action:operation.kind,
        duration:clock()-operation.start,...operation.trajectory.finish(),status,...detail});operation=null;
    },
    history(from,to,reason,data={}) {emit('history',{sourceState:nodeStates.get(from),destinationState:stateId,previousNode:from,historyNode:to,reason,...data});},
    pause(reason='hidden') {endPreview(reason);finishParameter(reason);if(operation)this.finish('interrupted',{reason});for(const[card]of exposures)this.exposure(card,0);emit('navigation',{reason});},
  };
  for(const key of Object.keys(api))if(typeof api[key]==='function'){
    const original=api[key];api[key]=function(...args){try{return original.apply(api,args);}catch{
      // An observer must never block authoring or surface an unrelated chart error.
      try{emit('quality',{reasonCode:'invalid',action:key,count:1});}catch{/* Storage unavailable. */}
      return null;
    }};
  }
  return api;
}
