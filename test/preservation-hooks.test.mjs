import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPreservation,FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {createRepository} from '../backend/repository.mjs';

test('synchronous phase hooks and command receipts share the original transaction',async t=>{
 const calls=[],repo=createRepository({memory:true,preservation:{
  collectNativeEvidence:async()=>({safe:true,files:[],issues:[]}),
  beforeCommit:({db,command,row})=>{assert.equal(db.isTransaction,true);calls.push([command,row?.state||'absent']);},
  persistReceipt:({db,command,operationId,report})=>{assert.equal(db.isTransaction,true);db.prepare('INSERT INTO hook_receipts VALUES(?,?,?)').run(operationId,command,report.state);}
 }});t.after(()=>repo.db.close());repo.db.exec('CREATE TABLE hook_receipts(operation TEXT,command TEXT,state TEXT,PRIMARY KEY(operation,command))');
 repo.preservation.begin({operationId:'hook-original',versions:FROZEN_VERSIONS});await repo.preservation.seal({operationId:'hook-original'});repo.preservation.restore({operationId:'hook-original'});
 assert.deepEqual(calls,[['prepare','absent'],['seal','preparing'],['restore','sealed']]);assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM hook_receipts').get().n,3);
 repo.preservation.restore({operationId:'hook-original'});assert.equal(calls.length,3);assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM hook_receipts').get().n,3);
});
test('last transaction refusal rolls back phase and every hook write',async t=>{
 const repo=createRepository({memory:true,preservation:{collectNativeEvidence:async()=>({safe:true,files:[],issues:[]}),beforeCommit:({db,command})=>{if(command==='seal'){db.prepare('INSERT INTO hook_private VALUES(?)').run('attempt');throw Object.assign(Error('projection changed'),{code:'PRODUCTION_PROJECTION_CHANGED'});}}}});t.after(()=>repo.db.close());repo.db.exec('CREATE TABLE hook_private(value TEXT)');repo.preservation.begin({operationId:'refuse-original',versions:FROZEN_VERSIONS});
 await assert.rejects(repo.preservation.seal({operationId:'refuse-original'}),{code:'PRODUCTION_PROJECTION_CHANGED'});assert.equal(repo.preservation.inspect().state,'preparing');assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM hook_private').get().n,0);
});
test('invalid or async code hooks refuse before any preservation schema write',()=>{
 for(const hook of [async()=>{}, {},'return true']){const db=new DatabaseSync(':memory:');try{assert.throws(()=>createPreservation(db,{beforeCommit:hook}),{code:'ROLLBACK_HOOK_INVALID'});assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='version_preservation'").get().n,0);}finally{db.close();}}
});
test('a Promise returned by a synchronous hook rolls back its provisional writes',t=>{
 const repo=createRepository({memory:true,preservation:{beforeCommit:({db})=>{db.exec("INSERT INTO hook_private VALUES('attempt')");return Promise.resolve(true);}}});t.after(()=>repo.db.close());repo.db.exec('CREATE TABLE hook_private(value TEXT)');assert.throws(()=>repo.preservation.begin({operationId:'promise-original',versions:FROZEN_VERSIONS}),{code:'ROLLBACK_HOOK_INVALID'});assert.equal(repo.preservation.inspect().state,'v2');assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM hook_private').get().n,0);
});
test('remote JSON flags never skip local file checks; only the trusted code resolver can bind a record',async t=>{
 const record={path:'C:\\never-a-local-proof\\owned\\state.db',exists:true,sha256:'a'.repeat(64),remote:true},trusted=new WeakSet([record]);
 for(const resolver of [null,()=>false,({kind,record:item})=>kind==='file'&&trusted.has(item)?true:undefined]){
  const repo=createRepository({memory:true,preservation:{collectNativeEvidence:async()=>({safe:true,issues:[],files:[record]}),verifySourceRecord:resolver}});t.after(()=>repo.db.close());repo.preservation.begin({operationId:'source-original',versions:FROZEN_VERSIONS});
  if(resolver&&resolver({kind:'file',record})===true)assert.equal((await repo.preservation.seal({operationId:'source-original'})).state,'sealed');else{await assert.rejects(repo.preservation.seal({operationId:'source-original'}),{code:'ROLLBACK_EVIDENCE_CHANGED'});assert.equal(repo.preservation.inspect().state,'preparing');}
 }
});
