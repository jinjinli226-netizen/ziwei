import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createRepository} from '../backend/repository.mjs';
import {BOT_INTERNAL} from '../backend/bots.mjs';
import {createManagementService} from '../backend/management.mjs';
import {digest,FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {nativeActionDigest,scanOwnedNativeDatabases} from '../backend/preservation-native-databases.mjs';

const tree={launched:true,rootPid:17,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0};
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t,{mutation,afterCollect}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-native-seal-'));let home=path.join(root,'owned');fs.mkdirSync(home);
 let file=path.join(home,'state.db'),writer=new DatabaseSync(file);
 writer.exec('CREATE TABLE state_meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(30);CREATE TABLE sessions(id TEXT PRIMARY KEY,source TEXT,started_at REAL);CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,timestamp REAL);PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0');
 let scope,connectId,replyId;
 const repo=createRepository({memory:true,preservation:{collectNativeEvidence:async(db,{operationId})=>{
  const actions=db.prepare('SELECT * FROM a2a_actions').all(),freeze=db.prepare('SELECT * FROM version_preservation').get(),connect=actions.find(row=>row.id===connectId);
  const exit={...scope,sourceActionId:connectId,connectActionDigest:nativeActionDigest(connect),connectedPid:17,processAlive:false,lifecycleDigest:digest('original lifecycle fixture'),platform:'fixture',revision:1,controlEpoch:1,workerNonce:'original-worker',processExit:tree};
  const native=scanOwnedNativeDatabases({homes:[scope],actions,gatewayInbox:db.prepare('SELECT * FROM bot_gateway_inbox').all(),gatewayExits:[exit],operationId});
  assert.equal(native.safe,true,JSON.stringify(native.issues));
  Object.assign(native,{operationId,intentDigest:digest(freeze.intent_json),versionsDigest:digest(freeze.versions_json),actionBindings:actions.map(row=>({id:row.id,digest:nativeActionDigest(row)}))});
  if(mutation==='none')native.gatewayInboxProofs=[];
  if(mutation==='operation')native.gatewayInboxProofs[0].operationId='another-operation';
  if(mutation==='row')native.gatewayInboxProofs[0].inboxRowDigest=digest('different');
  if(mutation==='home')native.gatewayInboxProofs[0].home=root;
  if(mutation==='ownership')native.gatewayInboxProofs[0].ownershipId='another-owner';
  if(mutation==='kind')delete native.gatewayInboxProofs[0].kind;
  if(mutation==='envelope')delete native.nativeDatabases;
  if(mutation==='duplicate')native.gatewayInboxProofs.push({...native.gatewayInboxProofs[0]});
  if(afterCollect)await afterCollect({repo,writer,file,native});
  return native;
 }}});
 t.after(()=>{writer.close();repo.db.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
 repo.heartbeatDevice('test-111',{deviceId:'seal-pc',runtimes:{Hermes:{status:'available',profiles:[{name:'default'}],models:[{id:'fixture'}]}}});
 const bot=createManagementService(repo).bots.create('test-111',{name:'Native seal Bot',targetDeviceId:'seal-pc',runtimeProfile:'default',model:'fixture',idempotencyKey:'native-seal'});
 writer.close();fs.mkdirSync(path.join(root,'profiles'));fs.renameSync(home,path.join(root,'profiles',bot.instance.profile));home=path.join(root,'profiles',bot.instance.profile);file=path.join(home,'state.db');writer=new DatabaseSync(file);writer.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0');
 const context={employeeId:bot.id,workspace:'test-111',revision:1,controlEpoch:1};
 const provision=repo.getA2AAction(bot.instance.provisioning.actionId);
 repo.ackA2AAction(provision.id,{deviceId:'seal-pc'});repo.resultA2AAction(provision.id,{deviceId:'seal-pc',status:'succeeded',result:{processExit:tree,botProvision:{schemaVersion:1,mode:'owned_profile',workspace:'test-111',employeeId:bot.id,deviceId:'seal-pc',profile:bot.instance.profile,ownershipId:bot.instance.ownershipId,templateProfile:'default',provisionActionId:provision.id,home,profileHome:home,authMode:'source-native-store',authentication:'configured',nativeVersion:'0.21.3'}}});
 repo.db.prepare("UPDATE employees SET status='active' WHERE id=?").run(bot.id);repo.db.prepare("UPDATE hermes_bots SET control_state='active',validated_revision=revision WHERE employee_id=?").run(bot.id);
 const connect=repo.createA2AAction('test-111',{type:'hermes.bot.native',botInternal:BOT_INTERNAL,payload:{employeeId:bot.id,deviceId:'seal-pc',hermesBot:context,nativeOperation:{resource:'gateway',operation:'connect',requestId:'connect-original',input:{platform:'fixture'}}}});connectId=connect.id;
 repo.ackA2AAction(connect.id,{deviceId:'seal-pc'});repo.resultA2AAction(connect.id,{deviceId:'seal-pc',status:'succeeded',result:{nativeOperation:{schemaVersion:2,resource:'gateway',operation:'connect',employeeId:bot.id,revision:1,nativeVersion:'0.21.3',data:{connected:true,pid:17}}}});
 const reply=repo.createA2AAction('test-111',{type:'conversation.execute',payload:{employeeId:bot.id,deviceId:'seal-pc',hermesBot:context,prompt:'synthetic incoming',gateway:{connectionActionId:connectId,platform:'fixture',chatId:'chat',messageId:'message'}}});replyId=reply.id;
 repo.ackA2AAction(reply.id,{deviceId:'seal-pc'});repo.resultA2AAction(reply.id,{deviceId:'seal-pc',status:'succeeded',result:{processExit:tree,output:'synthetic original output'}});
 const workspaceId=repo.db.prepare('SELECT id FROM workspaces WHERE slug=?').get('test-111').id;
 repo.db.prepare('INSERT INTO bot_gateway_inbox(id,workspace_id,employee_id,platform,chat_id,message_id,source_action_id,content,revision,control_epoch,action_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('inbox-original',workspaceId,bot.id,'fixture','chat','message',connectId,'synthetic incoming',1,1,replyId,'dispatched',new Date().toISOString());
 scope={home,employeeId:bot.id,workspace:'test-111',workspaceId,deviceId:'seal-pc',ownershipId:bot.instance.ownershipId,nativeVersion:'0.21.3'};
 const key='ziwei.gateway.inbound:'+createHash('sha256').update('["fixture", "chat", "message"]').digest('hex');
 writer.prepare('INSERT INTO state_meta VALUES(?,?)').run(key,JSON.stringify({platform:'fixture',sourceActionId:connectId,chatId:'chat',messageId:'message',content:'synthetic incoming',revision:1,controlEpoch:1,state:'delivered'}));
 repo.preservation.begin({operationId:'native-seal-original',versions:FROZEN_VERSIONS});
 return{repo,writer,file,bot,seal:()=>repo.preservation.seal({operationId:'native-seal-original'})};
}

test('exact native dispatched proof seals once and reports persisted proof while retaining Inbox',async t=>{
 const f=fixture(t),report=await f.seal();assert.equal(report.state,'sealed');assert.equal(report.issues.length,0);assert.equal(report.provenGatewayInbox.length,1);
 assert.equal(f.repo.db.prepare('SELECT status FROM bot_gateway_inbox').get().status,'dispatched');
 const epoch=f.repo.db.prepare('SELECT control_epoch FROM hermes_bots').get().control_epoch;assert.equal(epoch,2);assert.equal((await f.seal()).state,'sealed');assert.equal(f.repo.db.prepare('SELECT control_epoch FROM hermes_bots').get().control_epoch,epoch);
});
test('missing, foreign or incomplete dispatched proof never commits seal',async t=>{
 for(const mutation of ['none','operation','row','home','ownership','kind','envelope','duplicate']){const f=fixture(t,{mutation});await assert.rejects(f.seal(),{code:'ROLLBACK_NOT_DRAINED'},mutation);assert.equal(f.repo.preservation.inspect().state,'preparing');assert.equal(f.repo.db.prepare('SELECT control_epoch FROM hermes_bots').get().control_epoch,1);}
});
test('final seal binds every original action even when Gateway rows still match',async t=>{
 const f=fixture(t,{afterCollect:({repo})=>{
  for(const {name} of repo.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='a2a_actions'").all())repo.db.exec('DROP TRIGGER '+name);
  repo.db.prepare('UPDATE a2a_actions SET completed_at=? WHERE type=?').run('2026-10-14T00:00:00Z','hermes.bot.provision');
 }});await assert.rejects(f.seal(),{code:'ROLLBACK_EVIDENCE_CHANGED'});assert.equal(f.repo.preservation.inspect().state,'preparing');assert.equal(f.repo.db.prepare('SELECT control_epoch FROM hermes_bots').get().control_epoch,1);
});
test('WAL-only claim written after collection blocks final seal and retains original bytes',async t=>{
 let originalMain,originalWal,newWal;const f=fixture(t,{afterCollect:({writer,file})=>{originalMain=hash(file);originalWal=hash(file+'-wal');writer.prepare('INSERT INTO state_meta VALUES(?,?)').run('ziwei.driver.pending:late:goals',JSON.stringify({sessionId:'late',run:true}));assert.equal(hash(file),originalMain);newWal=hash(file+'-wal');assert.notEqual(newWal,originalWal);}});
 await assert.rejects(f.seal(),{code:'ROLLBACK_EVIDENCE_CHANGED'});assert.equal(f.repo.preservation.inspect().state,'preparing');assert.equal(hash(f.file),originalMain);assert.equal(hash(f.file+'-wal'),newWal);assert.equal(f.repo.db.prepare('SELECT control_epoch FROM hermes_bots').get().control_epoch,1);
});
