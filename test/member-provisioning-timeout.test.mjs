import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {FORMAL_ISSUER,digest} from '../backend/member-provisioning/contract.mjs';
import {createNativeEnrollment,MEMBER_PROVISION_UNKNOWN_TTL_MS} from '../backend/member-provisioning/service.mjs';

function context(memberId='member-1',generation='generation-1'){
 const base={schemaVersion:1,memberId,generation,issuer:FORMAL_ISSUER,subject:'subject-1',site:'collaboration',role:'member',display:{email:'member@example.test',realName:'Member'},nativeId:undefined};
 return {...base,operationId:`member-${memberId}-${generation}-collaboration-grant`,requestDigest:digest({...base,action:'grant'})};
}
function fixture(t){
 const db=new DatabaseSync(':memory:'),identityDb=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,graph_revision INTEGER,graph_mutation_id TEXT);INSERT INTO workspaces VALUES('team',0,NULL);CREATE TABLE members(id TEXT PRIMARY KEY,workspace_id TEXT,user_id TEXT,email TEXT,role TEXT,active INTEGER,revision INTEGER,payload TEXT,mutation_id TEXT);CREATE TABLE activity(id TEXT,workspace_id TEXT,actor_id TEXT,payload TEXT,created_at TEXT);");
 identityDb.exec("CREATE TABLE identity_bindings(issuer TEXT,subject TEXT,workspace_id TEXT,member_id TEXT,native_user_id TEXT,verified_by TEXT,evidence_ref TEXT,enabled INTEGER,revision INTEGER,created_at TEXT);CREATE TABLE identity_employee_clients(issuer TEXT,subject TEXT);");
 t.after(()=>{db.close();identityDb.close();});
 return{db,identityDb};
}

test('unknown collaboration enrollment auto-archives after TTL and releases the durable phase',async t=>{
 const f=fixture(t);let failAfterCommit=true;const service=createNativeEnrollment({db:f.db,identityDb:f.identityDb,config:{enabled:true,site:'collaboration',issuer:FORMAL_ISSUER,workspaceId:'team'},fault:stage=>{if(stage==='after_identity_commit'&&failAfterCommit)throw Error('fixture boundary loss');}});
 const c=context();assert.deepEqual(await service.grant(c),{phase:'unknown',operationId:c.operationId,requestDigest:c.requestDigest});
 const op=f.db.prepare('SELECT phase FROM member_enrollment_operations WHERE operation_id=?').get(c.operationId);assert.equal(op.phase,'unknown');
 f.db.prepare('UPDATE member_enrollment_operations SET updated_at=? WHERE operation_id=?').run(new Date(Date.now()-MEMBER_PROVISION_UNKNOWN_TTL_MS-1_000).toISOString(),c.operationId);
 const archived=await service.status(c);assert.equal(archived.phase,'expired_unknown');assert.equal(archived.evidenceRetained,true);
 assert.equal(f.db.prepare('SELECT phase FROM member_enrollment_operations WHERE operation_id=?').get(c.operationId).phase,'expired_unknown');
 assert.equal(f.db.prepare('SELECT phase FROM member_enrollment_members WHERE member_id=?').get(c.memberId).phase,'archived_unknown');
 failAfterCommit=false;
});
