import test from 'node:test';
import assert from 'node:assert/strict';
import { stageGuestTransfer, pendingGuestTransfer, clearGuestTransfer } from '../web/cloud/guest-transfer.js';
const local=()=>{const values=new Map();return {getItem:key=>values.get(key),setItem:(key,v)=>values.set(key,v),removeItem:key=>values.delete(key),values};};
test('Only an explicit guest transfer can open a guest draft after sign-in',()=>{
 const storage=local(),guest={id:'guest-id',is_anonymous:true},member={id:'member-id'};
 assert.equal(pendingGuestTransfer(member,storage,100),null);
 stageGuestTransfer(member,storage,100);assert.equal(storage.values.size,0);
 stageGuestTransfer(guest,storage,100);assert.equal(pendingGuestTransfer(guest,storage,110),null);
 assert.deepEqual(pendingGuestTransfer(member,storage,110),{owner:'guest-id',time:100});
 assert.equal(pendingGuestTransfer(member,storage,100+86400000),null);
 assert.equal(pendingGuestTransfer(member,storage,50),null);
 clearGuestTransfer(storage);assert.equal(pendingGuestTransfer(member,storage,110),null);
});
test('Malformed transfer markers never select a local account draft',()=>{
 const storage=local();
 for(const value of ['broken',JSON.stringify({owner:'../private',time:100}),JSON.stringify({owner:'private',time:'100'})]){
  storage.setItem('vis-autocomplete.guest-transfer',value);assert.equal(pendingGuestTransfer({id:'member'},storage,101),null);
 }
});
