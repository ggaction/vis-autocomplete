import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCodec,EVENTS} from '../../web/research/protocol.js';
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
export async function verifyResearchSecurity(db) {
 await db.exec('reset role;delete from public.profiles;delete from public.app_admins;');
 await db.query('update auth.users set is_anonymous=true where id=$1',[bob]);
 await db.exec(await readFile(new URL('../../supabase/migrations/202610270001_research_v2.sql',import.meta.url),'utf8'));
 const as=uid=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false);`);
 const encoded=createCodec({text:true}).encode({query:'mean salary',field:'Salary',method:'encodeColor'});
 const batch={protocol:2,id:crypto.randomUUID(),session:crypto.randomUUID(),consent:1,time:new Date().toISOString(),events:[{id:crypto.randomUUID(),n:1,t:1,k:EVENTS.indexOf('search'),v:encoded.tree,texts:encoded.texts}],losses:{}};
 const send=b=>db.query('select record_research_batch($1,$2) as result',[b,'test']);
 await as(alice);assert.equal((await send(batch)).rows[0].result.revoked,true);
 await db.query('select set_research_consent(true)'); // explicit v1 consent carries forward
 assert.equal((await send(batch)).rows[0].result.ok,true);await send(batch);
 assert.equal((await db.query('select * from research_batches')).rows.length,0,'ordinary clients cannot read research data');
 await assert.rejects(db.query('select * from research_participants'),/permission denied/);
 await db.exec('reset role');let rows=(await db.query('select * from research_batches')).rows;
 assert.equal(rows.length,1);assert.notEqual(rows[0].participant_id,alice);assert.equal(rows[0].is_guest,false);
 assert.deepEqual(rows[0].events[0].texts,encoded.texts);
 await as(alice);
 for(const event of [{...batch.events[0],v:{data:'sensitive'}},{...batch.events[0],v:[2,'private@email']},{...batch.events[0],v:[1.5,1]},{...batch.events[0],v:[3,[],0.5]},{...batch.events[0],v:null,k:null},{...batch.events[0],n:1.5},{...batch.events[0],texts:{bad:'x'}}]) {
  await assert.rejects(send({...batch,id:crypto.randomUUID(),events:[event]}));
 }
 await assert.rejects(send({...batch,id:crypto.randomUUID(),events:[{...batch.events[0],k:15}]}),/Statistics scope/);
 await db.query('select set_research_consent_v2(false)');assert.equal((await send(batch)).rows[0].result.revoked,true);
 await db.query('select set_research_consent_v2(true)');assert.equal((await send(batch)).rows[0].result.revoked,true);
 await as(bob);await db.query('select set_research_consent_v2(true)');
 await assert.rejects(send(batch),/Batch unavailable/);
 await send({...batch,id:crypto.randomUUID()});await db.exec('reset role');rows=(await db.query('select * from research_batches')).rows;
 assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.is_guest).length,1);
 await as(alice);await db.query('select delete_my_research()');
 await db.exec('reset role');assert.equal((await db.query('select * from research_batches')).rows.length,1);
 assert.equal((await db.query('select * from research_participants')).rows.length,1);

}
