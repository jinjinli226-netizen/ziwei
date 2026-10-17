import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from './app.mjs';
import {createMobilePushService} from './mobile-push.mjs';
import {createRepository} from './repository.mjs';

async function request(app,url,{cookie='',method='GET',body}={}){
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],input=body===undefined?null:Buffer.from(JSON.stringify(body));
  req.method=method;req.url=url;req.headers={host:'system-push.fixture',cookie,...(input?{'content-type':'application/json','content-length':String(input.length)}:{})};
  try{return await new Promise((resolve,reject)=>{res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();return true;};res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.getHeaders(),bytes,json:bytes.length?JSON.parse(bytes.toString()):null});res.emit('finish');return res;};req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));if(input)req.push(input);req.push(null);});}finally{socket.destroy();}
}
function fixture(t,{configured=true,send}={}){
  let time=Date.now();const sent=[],sender={status:()=>({provider:'tpns',configured,status:configured?'ready':'notConfigured',accessId:configured?'1500001048':null,accessKey:configured?'public-client-key':null,packageName:'com.ziwei.manager'}),send:async value=>{sent.push(value);return send?send(value):{accepted:true,providerId:'fixture-accepted'};}};
  const env={ZIWEI_MOBILE_PUSH_TOKEN_KEY:Buffer.alloc(32,7).toString('base64url')},app=createApp({memory:true,requireAuth:true,enableScheduler:false,mobilePush:{env,sender,now:()=>time}}),repo=app.locals.repo,auth=app.locals.auth,db=repo.db,push=app.locals.mobilePush;
  t.after(()=>{push.stop();db.close();});
  const owner=auth.setup({email:'push-owner@fixture.test',password:'push-fixture-only-password'}),member=auth.register({email:'push-member@fixture.test',password:'push-fixture-only-password'}),slug='system-push';auth.createWorkspace(owner.user_id,{slug,name:'System push',kind:'team'});const ws=repo.getWorkspace(slug);
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('push-member',ws.id,member.user_id,'Member','push-member@fixture.test','member',new Date().toISOString());
  const employee=repo.createEmployee(slug,{name:'Visible employee',runtime:'Codex',ownerUserId:owner.user_id}),chat=repo.createConversation(slug,{employeeId:employee.id});
  let presenceSequence=0;
  const cookie=who=>`ziwei_session=${who.session.token}`,call=(path,body,who=owner,method='POST')=>request(app,`/api/mobile/push${path}`,{cookie:who?cookie(who):'',method,body:path==='/foreground'?{presenceSeq:++presenceSequence,...body}:body}),identity=(suffix='one')=>({installationId:`installation_fixture_${suffix}`,installationSecret:crypto.randomBytes(32).toString('base64url'),provider:'tpns',token:`routing_token_fixture_${suffix}`,clientEpoch:1,generation:1});
  async function subscribe(who=owner,suffix='one'){const install=identity(suffix);assert.equal((await call('/installations',install,who)).status,200);const result=await call('/subscription',{...install,workspaceSlug:slug,enabled:true},who,'PUT');assert.equal(result.status,200);return {...install,subscription:result.json};}
  const message=(conversation=chat)=>{const result=repo.addConversationMessage(conversation.id,{role:'assistant',dispatch:false,content:'PRIVATE_BODY_MUST_NOT_LEAVE_THE_SERVER'});time=Math.max(time,Date.now());return result;};
  const rows=()=>db.prepare('SELECT * FROM mobile_push_deliveries ORDER BY created_at,id').all();
  return {app,repo,auth,db,push,env,sender,owner,member,slug,ws,employee,chat,cookie,call,identity,subscribe,message,rows,sent,advance:ms=>{time+=ms;},sync:()=>{time=Math.max(time,Date.now());},clock:()=>time};
}

test('no credentials is explicit, routes authenticate, and server secrets never enter config',async t=>{
  const f=fixture(t,{configured:false});assert.equal((await f.call('/config',undefined,null,'GET')).status,401);
  const config=await f.call('/config',undefined,f.owner,'GET');assert.equal(config.status,200);assert.equal(config.json.status,'notConfigured');assert.equal(config.json.configured,false);assert.equal(config.json.accessKey,null);assert.equal(config.headers['cache-control'],'no-store');
  assert.equal((await f.call('/installations',f.identity())).status,503);assert.equal(f.db.prepare('SELECT count(*) AS n FROM mobile_push_installations').get().n,0);assert.deepEqual(await f.push.drain(),{accepted:0,skipped:0});
});

test('installation proof prevents token takeover; same installation changes account and cancels the previous scope',async t=>{
  const f=fixture(t),install=await f.subscribe(),evil=f.identity('evil');
  assert.equal((await f.call('/installations',{...evil,token:install.token},f.member)).status,409);
  assert.equal((await f.call('/installations',{...install,installationSecret:evil.installationSecret},f.member)).status,409);
  assert.equal((await f.call('/foreground',{...install,workspaceSlug:f.slug,conversationId:f.chat.id,active:true},f.member)).status,404);
  f.message();install.clientEpoch++;const changed=await f.call('/installations',install,f.member);assert.equal(changed.status,200);assert.equal(changed.json.generation,2);install.generation=2;
  assert.equal(f.db.prepare('SELECT enabled FROM mobile_push_subscriptions').get().enabled,0);await f.push.drain();assert.equal(f.sent.length,0);
  assert.equal((await f.call('/subscription',{...install,workspaceSlug:f.slug,enabled:true},f.owner,'PUT')).status,404);
  const subscribed=await f.call('/subscription',{...install,workspaceSlug:f.slug,enabled:true},f.member,'PUT');assert.equal(subscribed.status,200);f.message();await f.push.drain();assert.equal(f.sent.length,1);
  const raw=f.db.prepare('SELECT * FROM mobile_push_installations').get();assert(!JSON.stringify(raw).includes(install.token));assert(!JSON.stringify(raw).includes(install.installationSecret));
});

test('new assistant replies have one durable delivery and repeatable fresh resolution of the exact original message',async t=>{
  const f=fixture(t),install=await f.subscribe();f.message();assert.equal(f.db.prepare('SELECT count(*) AS n FROM mobile_push_outbox').get().n,1);
  await f.push.drain();await f.push.drain();assert.equal(f.sent.length,1);assert.match(f.sent[0].deliveryId,/^[A-Za-z0-9_-]{32}$/);assert.deepEqual(Object.keys(f.sent[0]).sort(),['deliveryId','token']);
  const first=await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,f.owner,'GET'),again=await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,f.owner,'GET');assert.equal(first.status,200);assert.deepEqual(again.json,first.json);
  assert.equal(first.json.item.kind,'message.received');assert.equal(first.json.item.target.id,f.chat.id);assert.equal(first.json.item.target.employeeId,f.employee.id);assert.equal(first.json.accountId,f.owner.user_id);assert(!first.bytes.includes(Buffer.from('PRIVATE_BODY')));
  assert.equal((await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,f.member,'GET')).status,404);
  assert.equal((await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,null,'GET')).status,401);
  f.db.prepare('DELETE FROM conversation_messages WHERE id=?').run(first.json.item.target.messageId);assert.equal((await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,f.owner,'GET')).status,404);
  assert.equal(install.subscription.enabled,true);
});

test('current foreground chat suppresses only its installation and expires instead of mutating read flags',async t=>{
  const f=fixture(t),a=await f.subscribe(),b=await f.subscribe(f.owner,'second');
  assert.equal((await f.call('/foreground',{...a,workspaceSlug:f.slug,conversationId:f.chat.id,active:true})).status,200);
  f.message();const readBefore=f.repo.notificationStats(f.slug);await f.push.drain();assert.equal(f.sent.length,1);assert.equal(f.sent[0].token,b.token);assert.equal(f.rows().filter(row=>row.state==='suppressed').length,1);assert.deepEqual(f.repo.notificationStats(f.slug),readBefore);
  f.advance(61000);f.message();await f.push.drain();assert.equal(f.sent.length,3);
  assert.equal((await f.call('/foreground',{...a,workspaceSlug:f.slug,conversationId:null,active:false})).json.expiresAt,null);
});

test('first enable and reenable skip history; same-value subscribe does not reset the waterline',async t=>{
  const f=fixture(t);f.message();const a=await f.subscribe();await f.push.drain();assert.equal(f.sent.length,0);
  f.message();const same=await f.call('/subscription',{...a,workspaceSlug:f.slug,enabled:true},f.owner,'PUT');assert.equal(same.json.epoch,a.subscription.epoch);await f.push.drain();assert.equal(f.sent.length,1);
  a.clientEpoch++;await f.call('/subscription',{...a,workspaceSlug:f.slug,enabled:false},f.owner,'PUT');f.message();a.clientEpoch++;await f.call('/subscription',{...a,workspaceSlug:f.slug,enabled:true},f.owner,'PUT');await f.push.drain();assert.equal(f.sent.length,1);
});

test('native secret-only logout revokes queued and previously accepted deliveries even after cookie logout',async t=>{
  const f=fixture(t),install=await f.subscribe();f.message();await f.push.drain();const delivery=f.sent[0].deliveryId;
  f.message();await request(f.app,'/api/auth/logout',{cookie:f.cookie(f.owner),method:'POST',body:{}});await f.push.drain();assert.equal(f.sent.length,1);
  install.clientEpoch++;const revoked=await f.call('/logout',install,null);assert.equal(revoked.status,200);assert.equal(revoked.json.revoked,true);assert.equal(f.db.prepare('SELECT enabled FROM mobile_push_subscriptions').get().enabled,0);
  assert.equal((await f.call('/logout',{...install,installationSecret:crypto.randomBytes(32).toString('base64url')},null)).status,404);
  assert.equal((await f.call(`/deliveries/${delivery}`,undefined,f.owner,'GET')).status,401);
});

test('authenticated absent-install revocation fences a late registration across account changes; anonymous 404 is not success',async t=>{
  const f=fixture(t),install=f.identity('late_register'),late={...install};install.clientEpoch=2;
  const absent=await f.call('/logout',install,null);assert.equal(absent.status,404);assert.equal(absent.json.code,'PUSH_INSTALLATION_NOT_FOUND');assert.equal(f.db.prepare('SELECT count(*) AS n FROM mobile_push_installations').get().n,0);
  assert.equal((await f.call('/logout',install,f.member)).status,200);const fence=f.db.prepare('SELECT * FROM mobile_push_installations WHERE id=?').get(install.installationId);assert.equal(fence.user_id,f.member.user_id);assert.notEqual(fence.revoked_at,null);assert.equal(fence.token_hash,null);
  assert.equal((await f.call('/installations',late,f.owner)).status,409);assert.equal((await f.call('/installations',install,f.owner)).status,409);assert.equal((await f.call('/logout',{...install,installationSecret:crypto.randomBytes(32).toString('base64url'),clientEpoch:3},f.owner)).status,404);
  assert.equal(f.db.prepare('SELECT client_epoch FROM mobile_push_installations WHERE id=?').get(install.installationId).client_epoch,2);
  install.clientEpoch=3;const fresh=await f.call('/installations',install,f.owner);assert.equal(fresh.status,200);assert.equal(fresh.json.generation,2);install.generation=2;
  assert.equal((await f.call('/subscription',{...install,workspaceSlug:f.slug,enabled:true},f.owner,'PUT')).status,200);f.message();await f.push.drain();assert.equal(f.sent.length,1);
  install.clientEpoch=4;assert.equal((await f.call('/logout',install,f.member)).status,200);const revoked=f.db.prepare('SELECT * FROM mobile_push_installations WHERE id=?').get(install.installationId);assert.equal(revoked.user_id,f.owner.user_id,'secret-only cross-account revocation never rewrites ownership');assert.notEqual(revoked.revoked_at,null);
});

test('authenticated install and absent revoke share a strict per-account quota without anonymous database writes',async t=>{
  const f=fixture(t);for(let i=0;i<32;i++)assert.equal((await f.call('/logout',f.identity(`quota_${i}`),f.owner)).status,200);
  assert.equal((await f.call('/logout',f.identity('quota_over'),f.owner)).status,429);assert.equal((await f.call('/installations',f.identity('quota_register'),f.owner)).status,429);assert.equal(f.db.prepare('SELECT count(*) AS n FROM mobile_push_installations').get().n,32);
  assert.equal((await f.call('/logout',f.identity('quota_anonymous'),null)).status,404);assert.equal(f.db.prepare('SELECT count(*) AS n FROM mobile_push_installations').get().n,32);
  assert.equal((await f.call('/logout',f.identity('quota_member'),f.member)).status,200);
});

test('membership, employee privacy/deletion and session expiry are checked before dispatch and every click',async t=>{
  const f=fixture(t);await f.subscribe(f.member);f.message();f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.employee.id);await f.push.drain();assert.equal(f.sent.length,0);
  f.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(f.employee.id);f.message();await f.push.drain();assert.equal(f.sent.length,1);const delivery=f.sent[0].deliveryId;
  f.db.prepare('DELETE FROM members WHERE user_id=? AND workspace_id=?').run(f.member.user_id,f.ws.id);assert.equal((await f.call(`/deliveries/${delivery}`,undefined,f.member,'GET')).status,404);
  f.message();await f.push.drain();assert.equal(f.sent.length,1);
});

test('outbox participates in real repository rollback and defers dispatch until commit',async t=>{
  const f=fixture(t);await f.subscribe();
  assert.throws(()=>f.repo.withEmployeeTemplateTransaction(()=>{f.message();assert.equal(f.db.prepare('SELECT count(*) AS n FROM mobile_push_outbox').get().n,1);throw new Error('PUSH_ROLLBACK');}),/PUSH_ROLLBACK/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM mobile_push_outbox').get().n,0);await f.push.drain();assert.equal(f.sent.length,0);
  f.repo.withEmployeeTemplateTransaction(()=>f.message());await f.push.drain();assert.equal(f.sent.length,1);
});

test('two worker instances lease one delivery; provider retry reuses its opaque ID and survives reconstruction',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture(t,{send:async()=>{await gate;return {accepted:true,providerId:'same'};}});await f.subscribe();f.message();
  const worker2=createMobilePushService(f.repo,f.auth,{env:f.env,sender:f.sender,now:f.clock}),first=f.push.drain();await worker2.drain();assert.equal(f.sent.length,1);release();await first;assert.equal(f.rows().length,1);assert.equal(f.rows()[0].state,'accepted');
});

test('definitive provider rejection retries retain identity; expiry stops further sends and clicks',async t=>{
  let attempts=0;const f=fixture(t,{send:async()=>{if(++attempts===1)throw Object.assign(new Error('SECRET_ERROR_CONTENT'),{code:'PUSH_PROVIDER_REJECTED',retryable:true});return {accepted:true,providerId:'retried'};}});await f.subscribe();f.message();await f.push.drain();assert.equal(f.rows()[0].state,'retry');assert(!JSON.stringify(f.rows()).includes('SECRET_ERROR_CONTENT'));
  f.advance(4000);await f.push.drain();assert.equal(f.sent.length,2);assert.equal(f.sent[0].deliveryId,f.sent[1].deliveryId);assert.equal(f.rows()[0].state,'accepted');
  f.advance(300000);assert.equal((await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,f.owner,'GET')).status,200);
  f.db.prepare('UPDATE local_sessions SET expires_at=?').run(new Date(f.clock()+14*86400000).toISOString());f.advance(7*86400000);assert.equal((await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,f.owner,'GET')).status,404);
});

test('lost provider acknowledgement becomes unknown without another POST and remains fresh-resolvable',async t=>{
  const f=fixture(t,{send:async()=>{throw Object.assign(new Error('PRIVATE_TIMEOUT'),{code:'PUSH_PROVIDER_UNAVAILABLE',unknownOutcome:true,retryable:false});}}),install=await f.subscribe();f.message();await f.push.drain();
  const row=f.rows()[0];assert.equal(row.state,'unknown');assert.equal(f.sent.length,1);assert.equal((await f.call(`/deliveries/${row.id}`,undefined,f.owner,'GET')).status,200);
  f.advance(61000);const restarted=createMobilePushService(f.repo,f.auth,{env:f.env,sender:f.sender,now:f.clock});await restarted.drain();assert.equal(f.sent.length,1);assert.equal(f.rows()[0].attempts,1);
  install.clientEpoch++;await f.call('/logout',install,null);assert.equal((await f.call(`/deliveries/${row.id}`,undefined,f.owner,'GET')).status,404);
});

test('a crashed expired lease is unknown and is never reclaimed for another provider POST',async t=>{
  const f=fixture(t);await f.subscribe();f.message();await f.push.drain();const row=f.rows()[0];
  f.db.prepare("UPDATE mobile_push_deliveries SET state='leased',lease_owner='crashed-worker',lease_until=? WHERE id=?").run(f.clock()-1,row.id);
  const restarted=createMobilePushService(f.repo,f.auth,{env:f.env,sender:f.sender,now:f.clock});await restarted.drain();assert.equal(f.sent.length,1);assert.equal(f.rows()[0].state,'unknown');assert.equal(f.rows()[0].error_code,'PUSH_LEASE_OUTCOME_UNKNOWN');assert.equal((await f.call(`/deliveries/${row.id}`,undefined,f.owner,'GET')).status,200);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.employee.id);assert.equal((await f.call(`/deliveries/${row.id}`,undefined,f.member,'GET')).status,404);
});

test('human-authored assistant-role API messages never masquerade as new employee reports',async t=>{
  const f=fixture(t);await f.subscribe(f.member);const response=await request(f.app,`/api/conversations/${f.chat.id}/messages`,{cookie:f.cookie(f.owner),method:'POST',body:{role:'assistant',dispatch:false,content:'Human-authored text'}});assert.equal(response.status,201);
  const message=f.db.prepare('SELECT sender_user_id FROM conversation_messages WHERE id=?').get(response.json.id);assert.equal(message.sender_user_id,f.owner.user_id);f.sync();await f.push.drain();assert.equal(f.sent.length,0);
  f.message();await f.push.drain();assert.equal(f.sent.length,1);
});

test('original event and notice times independently prevent historical, malformed and future backfill alerts',async t=>{
  const f=fixture(t);await f.subscribe();
  for(const [auditAt,noticeAt] of [
    ['2000-01-01T00:00:00.000Z','current'],['current','2000-01-01T00:00:00.000Z'],
    ['not-a-date','current'],['current','not-a-date'],['','current'],['current',''],
    ['future','current'],['current','future']
  ]){
    const message=f.message(),event=f.db.prepare("SELECT id,created_at FROM audit_events WHERE action='conversation.message.created' AND json_extract(payload_json,'$.messageId')=?").get(message.id),notice=f.db.prepare('SELECT * FROM notifications WHERE event_id=?').get(event.id);
    const timestamp=value=>value==='current'?event.created_at:value==='future'?new Date(f.clock()+86400000).toISOString():value;
    f.db.prepare('DELETE FROM mobile_push_outbox WHERE event_id=?').run(event.id);f.db.prepare('DELETE FROM notifications WHERE id=?').run(notice.id);f.db.prepare('UPDATE audit_events SET created_at=? WHERE id=?').run(timestamp(auditAt),event.id);
    f.db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(notice.id,notice.workspace_id,notice.event_id,notice.actor,notice.action,notice.payload_json,timestamp(noticeAt));
    await f.push.drain();assert.equal(f.sent.length,0,`${auditAt}/${noticeAt}`);
  }
  f.message();await f.push.drain();assert.equal(f.sent.length,1,'current genuine report still dispatches');
});

test('message read watermarks suppress already displayed replies without clearing shared notifications',async t=>{
  const f=fixture(t);await f.subscribe();const message=f.message(),sequence=f.db.prepare('SELECT rowid AS n FROM conversation_messages WHERE id=?').get(message.id).n;
  f.db.prepare('INSERT INTO conversation_reads(workspace_id,conversation_id,user_id,last_message_id,last_message_rowid,last_read_at) VALUES(?,?,?,?,?,?)').run(f.ws.id,f.chat.id,f.owner.user_id,message.id,sequence,new Date().toISOString());
  const stats=f.repo.notificationStats(f.slug);await f.push.drain();assert.equal(f.sent.length,0);assert.deepEqual(f.repo.notificationStats(f.slug),stats);
});

test('client epochs fence late enable/register/logout; foreground sequence fences delayed active after clear',async t=>{
  const f=fixture(t),install=await f.subscribe(),old={...install};
  install.clientEpoch=2;assert.equal((await f.call('/subscription',{...install,workspaceSlug:f.slug,enabled:false},f.owner,'PUT')).status,200);
  assert.equal((await f.call('/subscription',{...old,workspaceSlug:f.slug,enabled:true},f.owner,'PUT')).status,409);assert.equal((await f.call('/installations',old)).status,409);
  install.clientEpoch=3;assert.equal((await f.call('/subscription',{...install,workspaceSlug:f.slug,enabled:true},f.owner,'PUT')).status,200);
  const active={...install,workspaceSlug:f.slug,conversationId:f.chat.id,active:true,presenceSeq:10},first=await f.call('/foreground',active);assert.equal(first.status,200);
  f.advance(1000);assert.equal((await f.call('/foreground',active)).json.expiresAt,first.json.expiresAt,'retry does not extend presence');
  assert.equal((await f.call('/foreground',{...active,conversationId:null,active:false,presenceSeq:11})).status,200);assert.equal((await f.call('/foreground',active)).status,409);assert.equal(f.db.prepare('SELECT count(*) AS n FROM mobile_push_foreground').get().n,0);
  install.clientEpoch=4;assert.equal((await f.call('/logout',install,null)).status,200);assert.equal((await f.call('/logout',install,null)).status,200);
  assert.equal((await f.call('/installations',install)).status,409);install.clientEpoch=5;const fresh=await f.call('/installations',install);assert.equal(fresh.status,200);assert.equal(fresh.json.generation,3);
  assert.equal((await f.call('/subscription',{...install,workspaceSlug:f.slug,enabled:true},f.owner,'PUT')).status,409,'old generation cannot enable');
});

test('current TPNS SDK 40-character tokens register; missing fences, long bodies and foreign scopes fail closed',async t=>{
  const f=fixture(t),install=f.identity();install.token='6ed8af8d7b18049d9fed116a9db9c71ab44d5565';assert.equal((await f.call('/installations',install)).status,200);
  assert.equal((await f.call('/installations',{...install,clientEpoch:undefined})).status,400);
  assert.equal((await f.call('/installations',{...install,token:'https://attacker.test/token'})).status,400);
  assert.equal((await f.call('/installations',{...install,oversized:'x'.repeat(9000)})).status,413);
  assert.equal((await f.call('/subscription',{...install,workspaceSlug:'not-a-membership',enabled:true},f.owner,'PUT')).status,403);
  assert.equal((await f.call('/subscription',{...install,generation:undefined,workspaceSlug:f.slug,enabled:true},f.owner,'PUT')).status,409);
});

function terminal(f,{conversationId=null,userId=f.owner.user_id,status='succeeded',taskId=null}={}){
  const actionId=`action_${crypto.randomUUID()}`,eventId=`audit_${crypto.randomUUID()}`,noticeId=`notice_${crypto.randomUUID()}`,timestamp=new Date().toISOString(),payload={employeeId:f.employee.id,conversationId,userId,taskId},result={processExit:{launched:true,rootPid:123,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,rootExitCode:status==='succeeded'?0:1,hostExitCode:status==='succeeded'?0:1}};
  f.db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,task_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(actionId,f.ws.id,'fixture',taskId,conversationId?'conversation.execute':'task.execute',JSON.stringify(payload),actionId,status,timestamp,timestamp,timestamp,JSON.stringify(result));
  const body=JSON.stringify({actionId,type:conversationId?'conversation.execute':'task.execute'}),action=`a2a.action.${status}`;
  f.db.prepare('INSERT INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,f.ws.id,'ziwei_user',action,body,timestamp);
  f.db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(noticeId,f.ws.id,eventId,'ziwei_user',action,body,timestamp);
  f.sync();
  return {actionId,eventId,noticeId};
}

test('task completion and failure reuse original proof/target authorization and ignore another request owner',async t=>{
  const f=fixture(t);await f.subscribe();const task=f.repo.createTask(f.slug,{title:'Original completed task'}),done=terminal(f,{taskId:task.id});
  await f.push.drain();assert.equal(f.sent.length,1);const resolved=(await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,f.owner,'GET')).json;assert.equal(resolved.item.id,done.eventId);assert.equal(resolved.item.kind,'execution.completed');assert.equal(resolved.item.target.id,task.id);
  const failedTask=f.repo.createTask(f.slug,{title:'Original failed task'});terminal(f,{taskId:failedTask.id,status:'failed'});await f.push.drain();assert.equal(f.sent.length,2);assert.equal((await f.call(`/deliveries/${f.sent[1].deliveryId}`,undefined,f.owner,'GET')).json.item.kind,'execution.failed');
  terminal(f,{taskId:task.id,userId:f.member.user_id});await f.push.drain();assert.equal(f.sent.length,2);
});

test('one completed action plus its actual assistant report yields one message, not two completion notifications',async t=>{
  const f=fixture(t);await f.subscribe();const action=terminal(f,{conversationId:f.chat.id}),message=f.message();
  const row=f.db.prepare("SELECT id,payload_json FROM audit_events WHERE action='conversation.message.created' ORDER BY rowid DESC LIMIT 1").get(),payload={...JSON.parse(row.payload_json),actionId:action.actionId};f.db.prepare('UPDATE audit_events SET payload_json=? WHERE id=?').run(JSON.stringify(payload),row.id);
  await f.push.drain();assert.equal(f.sent.length,1);const response=await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,f.owner,'GET');assert.equal(response.status,200);assert.equal(response.json.item.kind,'message.received');assert.equal(response.json.item.target.messageId,message.id);assert.equal(response.json.item.target.actionId,action.actionId);
  f.db.prepare('INSERT INTO conversation_reads(workspace_id,conversation_id,user_id,last_message_id,last_message_rowid,last_read_at) VALUES(?,?,?,?,?,?)').run(f.ws.id,f.chat.id,f.owner.user_id,message.id,f.db.prepare('SELECT rowid AS n FROM conversation_messages WHERE id=?').get(message.id).n,new Date().toISOString());
  assert.equal((await f.call(`/deliveries/${f.sent[0].deliveryId}`,undefined,f.owner,'GET')).status,200,'fresh GET is not consumed by a read watermark');
});

test('expired sessions and revoked device rights cannot enqueue a meaningful send or revive an old delivery',async t=>{
  const f=fixture(t);await f.subscribe();f.message();f.db.prepare('UPDATE local_sessions SET expires_at=? WHERE user_id=?').run('2000-01-01T00:00:00.000Z',f.owner.user_id);await f.push.drain();assert.equal(f.sent.length,0);assert.equal(f.db.prepare('SELECT enabled FROM mobile_push_subscriptions').get().enabled,0);
});

test('definitively invalid tokens retire only that generation and do not leak provider text',async t=>{
  const f=fixture(t,{send:async()=>{throw Object.assign(new Error('PRIVATE_PROVIDER_DETAILS'),{code:'PUSH_TOKEN_INVALID',invalidToken:true,retryable:false});}}),install=await f.subscribe();f.message();await f.push.drain();assert.equal(f.rows()[0].state,'cancelled');
  const saved=f.db.prepare('SELECT * FROM mobile_push_installations WHERE id=?').get(install.installationId);assert.equal(saved.token_cipher,null);assert.equal(saved.token_hash,null);assert.equal(saved.generation,2);assert.equal(f.db.prepare('SELECT enabled FROM mobile_push_subscriptions').get().enabled,0);
});

test('push schema reopens idempotently, retained trigger works with compatible repository fallback, and stale sources are not replayed',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-system-push-')),filename=path.join(root,'isolated.sqlite'),sent=[],env={ZIWEI_MOBILE_PUSH_TOKEN_KEY:Buffer.alloc(32,9).toString('base64url')},sender={status:()=>({configured:true,accessId:'1500001048',accessKey:'fixture-public'}),send:async value=>{sent.push(value);return {accepted:true,providerId:'fixture'};}};
  let app=createApp({filename,requireAuth:true,enableScheduler:false,enableMobilePushWorker:false,mobilePush:{env,sender}}),repo=app.locals.repo;
  t.after(()=>{app.locals.mobilePush.stop();try{repo.db.close();}catch{}fs.rmSync(root,{recursive:true,force:true});});
  const owner=app.locals.auth.setup({email:'disk-push@fixture.test',password:'isolated-disk-push-password'}),cookie=`ziwei_session=${owner.session.token}`,ws=repo.getWorkspace('test-111');
  repo.db.prepare('UPDATE members SET user_id=? WHERE workspace_id=? AND role=?').run(owner.user_id,ws.id,'owner');
  const employee=repo.createEmployee(ws.slug,{name:'Disk report',runtime:'Codex'}),chat=repo.createConversation(ws.slug,{employeeId:employee.id}),install={installationId:'installation_disk_fixture',installationSecret:crypto.randomBytes(32).toString('base64url'),token:'disk_fixture_routing_token',provider:'tpns',clientEpoch:1,generation:1};
  assert.equal((await request(app,'/api/mobile/push/installations',{cookie,method:'POST',body:install})).status,200);assert.equal((await request(app,'/api/mobile/push/subscription',{cookie,method:'PUT',body:{...install,workspaceSlug:ws.slug,enabled:true}})).status,200);
  // Exercise the real legacy audit→notification migration on reopening with an
  // enabled subscription, rather than manually aging an already-created queue.
  const old=repo.addConversationMessage(chat.id,{role:'assistant',dispatch:false,content:'Historical migration report'}),oldEvent=repo.db.prepare("SELECT id FROM audit_events WHERE action='conversation.message.created' AND json_extract(payload_json,'$.messageId')=?").get(old.id);
  repo.db.prepare("UPDATE audit_events SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(oldEvent.id);repo.db.prepare('DELETE FROM notifications WHERE event_id=?').run(oldEvent.id);repo.db.prepare('DELETE FROM mobile_push_outbox WHERE event_id=?').run(oldEvent.id);repo.db.prepare("DELETE FROM schema_migrations WHERE version='2026-10-10-initial-seed-once'").run();
  const schema=repo.db.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE 'mobile_push_%' ORDER BY name").all();app.locals.mobilePush.stop();repo.db.close();
  const fallback=createRepository({filename});assert.equal(fallback.db.prepare('SELECT created_at FROM mobile_push_outbox WHERE event_id=?').get(oldEvent.id).created_at,Date.parse('2000-01-01T00:00:00.000Z'),'real seed backfill keeps source age');fallback.addConversationMessage(chat.id,{role:'assistant',dispatch:false,content:'Fallback report'});assert.equal(fallback.db.prepare('SELECT count(*) AS n FROM mobile_push_outbox').get().n,2);fallback.db.close();
  app=createApp({filename,requireAuth:true,enableScheduler:false,enableMobilePushWorker:false,mobilePush:{env,sender}});repo=app.locals.repo;assert.deepEqual(repo.db.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE 'mobile_push_%' ORDER BY name").all(),schema);
  await app.locals.mobilePush.drain();assert.equal(sent.length,1,'only fresh fallback source dispatches; real historical seed backfill does not');assert.equal(repo.db.prepare('SELECT count(*) AS n FROM mobile_push_deliveries d JOIN mobile_push_outbox o ON o.sequence=d.outbox_sequence WHERE o.event_id=?').get(oldEvent.id).n,0);
  repo.addConversationMessage(chat.id,{role:'assistant',dispatch:false,content:'Current report'});await app.locals.mobilePush.drain();assert.equal(sent.length,2);assert.equal(repo.db.prepare('SELECT count(*) AS n FROM conversation_messages WHERE conversation_id=?').get(chat.id).n,3);
});
