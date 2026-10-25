import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount } from '../web/cloud/client.js';
import { reportContext } from '../web/cloud/documents.js';
const pause=()=>new Promise(r=>setTimeout(r,20));
function mock() {
  const map=new Map(),local={get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v)),remove:async k=>map.delete(k),keys:async()=>[...map.keys()]};
  const calls=[],rows=[],remote=new Map();let profile=null,listener;const owner={id:'test-user',email:'a@example.org'};
  let conflict=false,failSave=false;
  let verifiedUser=owner;
  const client={auth:{getSession:async()=>({data:{session:{user:owner}}}),getUser:async()=>({data:{user:verifiedUser}}),onAuthStateChange:fn=>{listener=fn;return {data:{subscription:{unsubscribe(){}}}};},
    signOut:async()=>{listener('SIGNED_OUT',null);return {data:{}}}},
    from(table){let eq={},value; const query={select(){return query},eq(k,v){eq[k]=v;return query},insert(v){value=v;return query},
      single:async()=>({data:table==='projects'?remote.get(eq.id):value}),maybeSingle:async()=>({data:table==='profiles'?profile:rows.find(r=>r.hash===eq.hash)??null}),
      then(resolve){if(table==='datasets'&&value)rows.push(value);return Promise.resolve({data:value}).then(resolve)}};return query;},
    storage:{from(){return {upload:async()=>({data:{}}),download:async()=>({data:new Blob(['{}'])})}}},
    async rpc(name,args){calls.push([name,structuredClone(args)]);
      if(name==='set_research_consent'){profile={research_enabled:args.enabled,consent_revision:(profile?.consent_revision??0)+1,consent_version:'history-only-v1'};return {data:profile};}
      if(name==='save_project') {
        if(failSave)return {error:{code:'network'}};
        if(conflict){conflict=false;return {error:{code:'40001'}};}
        remote.set(args.project,{id:args.project,title:args.name,snapshot:args.document,revision:args.expected+1,thumbnail:args.thumbnail});
        return {data:args.expected+1};
      }return {data:args.events?.length??0};
    }};
  return {client,local,map,calls,remote,rows,listener:(...args)=>{verifiedUser=args[1]?.user;listener(...args)},setConflict:()=>conflict=true,setFail:v=>failSave=v};
}
const imported={rows:[{secret:123}],fieldTypes:{secret:'quantitative'}};
const project=n=>({format:'visualization-autocomplete',activeId:'a',savedAt:`${n}`,datasets:[{id:'a',name:'Private data',imported,session:{entries:[{calls:[n]}]}},{id:'unused',name:'Unopened example',imported:{rows:[]}}]});
function environment(){globalThis.window=new EventTarget();globalThis.document=new EventTarget();globalThis.location={origin:'http://localhost'};Object.defineProperty(globalThis.navigator,'onLine',{value:false,configurable:true});}
function online(value){Object.defineProperty(globalThis.navigator,'onLine',{value,configurable:true});}
const config={supabaseUrl:'https://example.supabase.co',supabaseKey:'test'};
test('Durable jobs keep every committed revision, exclude unused examples, upload datasets once, isolate account switches',async()=>{
 environment();const m=mock();const identities=[];const a=await createAccount({...m,config,changed:s=>{if(s.identityChanged)identities.push(s.user?.id)}});
 try{
  await a.save(project(1));await a.save(project(2));await a.save({...project(2),savedAt:'later'});
  const jobs=[...m.map].filter(([k])=>k.startsWith('job:'));assert.equal(jobs.length,2);
  assert.equal(jobs[0][1].snapshot.datasets.length,1);assert.equal(jobs[0][1].snapshot.datasets[0].imported,undefined);
  assert.equal([...m.map.keys()].filter(k=>k.startsWith('data:')).length,1);
  online(true);await a.drain();assert.equal(m.calls.filter(([n])=>n==='save_project').length,2);assert.equal(m.rows.length,1);
  assert.equal([...m.map.keys()].filter(k=>k.startsWith('job:')).length,0);
  await a.rename('New name');await a.save(project(2));await a.drain();assert.equal(m.calls.filter(([n])=>n==='save_project').at(-1)[1].name,'New name');
  m.listener('SIGNED_IN',{user:{id:'second'}});await pause();await a.save(project(3));await a.drain();
  assert.ok(m.calls.filter(([n])=>n==='save_project').at(-1)[1].document.datasets[0].importRef.path.startsWith('second/'));
  assert.deepEqual(identities,['second']);
 }finally{a.destroy();}
});
test('No collection before choice, pending events purged on withdrawal, old epochs never replay',async()=>{
 environment();const m=mock(),a=await createAccount({...m,config});
 try{
  a.record('apply',{method:'encodeColor',field:'private'});await pause();assert.equal([...m.map.keys()].filter(k=>k.startsWith('event:')).length,0);
  await a.consent(true);a.record('apply',{method:'encodeColor',field:'private'});await pause();
  assert.equal([...m.map.keys()].filter(k=>k.startsWith('event:')).length,1);
  await a.consent(false);assert.equal([...m.map.keys()].filter(k=>k.startsWith('event:')).length,0);
  await a.consent(true);a.record('apply',{method:'encodeSize',args:imported});await pause();online(true);await a.drain();
  const events=m.calls.filter(([n])=>n==='record_interactions');assert.equal(events.length,1);assert.equal(events[0][1].consent,3);
  assert.deepEqual(events[0][1].events[0].payload,{type:'apply',method:'encodeSize'});
 }finally{a.destroy();}
});
test('inline renaming is durable offline, preserves project content, and never activates another project',async()=>{
 environment();const m=mock(),a=await createAccount({...m,config});
 try{
  await a.newProject('First');await a.save(project(1),'first-thumbnail');const first=a.current.id;
  online(true);await a.drain();const original=structuredClone(m.remote.get(first));
  await a.newProject('Second');await a.save(project(2),'second-thumbnail');await a.drain();const second=a.current.id;
  online(false);await a.rename('Renamed first',first);
  assert.equal(a.current.id,second);assert.equal(a.current.title,'Second');
  assert.equal((await m.local.get('active:test-user')).id,second);
  assert.equal((await m.local.get(`head:test-user:${first}`)).title,'Renamed first');
  online(true);await a.drain();
  assert.equal(m.remote.get(first).title,'Renamed first');
  assert.deepEqual(m.remote.get(first).snapshot,original.snapshot);assert.equal(m.remote.get(first).thumbnail,'first-thumbnail');
  // A project available only from the server can also be renamed unopened.
  await m.local.remove(`head:test-user:${first}`);await m.local.remove(`remote:test-user:${first}`);
  await a.rename('Remote project',first);await a.drain();assert.equal(m.remote.get(first).title,'Remote project');
  assert.equal(a.current.id,second);
  // A save queued immediately after rename must not restore its old name.
  const renamed=a.rename('Latest second'),saved=a.save(project(3),'new-thumbnail');
  await Promise.all([renamed,saved]);await a.drain();
  assert.equal(m.remote.get(second).title,'Latest second');
  assert.deepEqual(m.remote.get(second).snapshot.datasets[0].session.entries[0].calls,[3]);
  await assert.rejects(a.rename('   ',second),/Enter a project name/);
 }finally{a.destroy();}
});
test('Save conflicts create a recovered project and offline opening uses latest pending work',async()=>{
 environment();const m=mock(),a=await createAccount({...m,config});
 try{
  await a.save(project(1));const old=a.current.id;m.setConflict();online(true);await a.drain();
  assert.notEqual(a.current.id,old);assert.match(a.current.title,/recovered copy/);
  m.setFail(true);await a.save(project(2));await a.drain();
  const opened=await a.open(a.current.id);assert.deepEqual(opened.datasets[0].imported,imported);assert.deepEqual(opened.datasets[0].session.entries[0].calls,[2]);
 }finally{a.destroy();}
});
test('Report without dataset permission strips inline data and storage paths as well',()=>{
 const context=reportContext({datasets:[{importRef:{path:'private',hash:'abc'},metadata:{sourceTable:[['secret']]},session:{calls:[{method:'createData',args:{values:[{secret:1}]}}]}}]});
 assert.ok(!JSON.stringify(context).includes('private'));assert.ok(!JSON.stringify(context).includes('secret'));assert.ok(JSON.stringify(context).includes('createData'));
});
test('A rejected persisted session cannot restore an account or private draft',async()=>{
 environment();const m=mock();m.client.auth.getUser=async()=>({data:{user:null},error:{status:401,message:'Invalid token'}});
 const a=await createAccount({...m,config});
 try { assert.equal(a.user,null);assert.equal(a.current,null);await a.save(project(1));assert.equal(m.map.size,0); }
 finally { a.destroy(); }
});
test('view preference writes bind to the original bearer token across an account switch',async()=>{
 environment();const m=mock();
 m.client.auth.getSession=async()=>({data:{session:{user:{id:'test-user'},access_token:'owner-a-token'}}});
 const a=await createAccount({...m,config}),previousFetch=globalThis.fetch;let finish,request;
 try{
  globalThis.fetch=async(url,options)=>{request={url,options};return new Promise(resolve=>{finish=()=>resolve({ok:true})})};
  const saving=a.saveViewPreferences({vis_view_mode:'transition'},'test-user');await pause();
  assert.equal(request.options.headers.Authorization,'Bearer owner-a-token');
  assert.deepEqual(JSON.parse(request.options.body),{data:{vis_view_mode:'transition'}});
  m.listener('SIGNED_IN',{user:{id:'second'}});await pause();finish();await saving;
  assert.equal(a.user.id,'second');assert.equal(a.user.user_metadata,undefined);
  await assert.rejects(a.saveViewPreferences({vis_view_mode:'preview'},'test-user'),/Account changed/);
 }finally{globalThis.fetch=previousFetch;a.destroy();}
});
