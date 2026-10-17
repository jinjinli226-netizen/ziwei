import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from './app.mjs';
import {createMobileNotificationReadService} from './mobile-notifications.mjs';

// Exercise actual Cookie middleware and routes without opening a TCP listener.
function exchange(app,url,{cookie='',method='GET',body,stream=false}={}){
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[];
  const input=body===undefined?null:Buffer.from(JSON.stringify(body));
  req.method=method;req.url=url;req.headers={host:'assignment-public.fixture',cookie,...(input?{'content-type':'application/json','content-length':String(input.length)}:{})};
  const close=()=>{req.emit('close');socket.destroy();};
  return new Promise((resolve,reject)=>{
    const result=()=>({status:res.statusCode,headers:res.getHeaders(),bytes:Buffer.concat(chunks),json:()=>JSON.parse(Buffer.concat(chunks).toString())});
    res.flushHeaders=()=>{};
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();if(stream)resolve({...result(),text:()=>Buffer.concat(chunks).toString(),close});return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();resolve(result());res.emit('finish');close();return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>{close();reject(error||new Error('Unhandled fixture request'));});if(input)req.push(input);req.push(null);
  });
}
function fixture(t){
  const app=createApp({memory:true,requireAuth:true,enableScheduler:false}),repo=app.locals.repo,auth=app.locals.auth,db=repo.db;
  t.after(()=>db.close());
  const owner=auth.setup({email:'public-owner@fixture.test',password:'public-assignment-fixture-password'}),member=auth.register({email:'public-member@fixture.test',password:'public-assignment-fixture-password'}),slug='assignment-public';
  auth.createWorkspace(owner.user_id,{slug,name:'Public assignment boundaries',kind:'team'});const ws=repo.getWorkspace(slug);
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('public-member',ws.id,member.user_id,'Public member','public-member@fixture.test','member',new Date().toISOString());
  const employee=repo.createEmployee(slug,{name:'Private assignment identity',runtime:'Codex',visibility:'personal',ownerUserId:owner.user_id});
  const rawAudit=taskId=>db.prepare("SELECT * FROM audit_events WHERE action IN ('task.created','task.updated') AND json_extract(payload_json,'$.taskId')=? ORDER BY rowid DESC LIMIT 1").get(taskId);
  const cookie=`ziwei_session=${member.session.token}`,base=`/api/workspaces/${slug}`;
  return {app,repo,db,owner,member,slug,ws,employee,rawAudit,cookie,base};
}
const withoutProof=payload=>{const {assignmentBinding:_private,...visible}=payload;return visible;};

test('authoritative assignment proof stays internal while new notification rows and immediate hub events keep the old payload shape',t=>{
  const f=fixture(t),events=[],unsubscribe=f.app.locals.realtime.subscribe(f.slug,event=>events.push(event));t.after(unsubscribe);
  const task=f.repo.createTask(f.slug,{title:'Bound private work',assignee:f.employee.name}),created=f.rawAudit(task.id),proof=JSON.parse(created.payload_json).assignmentBinding;
  assert.equal(proof.kind,'employee');assert.equal(proof.entityId,f.employee.id);
  assert.deepEqual(events.at(-1).payload,{taskId:task.id});assert.equal(events.at(-1).id,created.id);
  const stored=f.db.prepare('SELECT * FROM notifications WHERE event_id=?').get(created.id);
  assert.equal(stored.payload_json,JSON.stringify({taskId:task.id}));
  assert.deepEqual({...f.repo.listAudit(f.slug).find(row=>row.id===created.id)},{...created,payload_json:stored.payload_json});
  assert.deepEqual(Object.keys(f.repo.getTask(task.id)).filter(key=>key.includes('Binding')),[]);
  f.repo.updateTask(task.id,{assignee:null});const updated=f.rawAudit(task.id);
  assert.equal(JSON.parse(updated.payload_json).assignmentBinding.kind,'unassigned');assert.deepEqual(events.at(-1).payload,{taskId:task.id});
  f.repo.updateTask(task.id,{title:'Ordinary title save'});const ordinary=f.rawAudit(task.id);
  assert.equal(ordinary.payload_json,JSON.stringify({taskId:task.id}));assert.equal(f.repo.listAudit(f.slug).find(row=>row.id===ordinary.id).payload_json,ordinary.payload_json);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM notifications WHERE event_id IN (?,?,?)').get(created.id,updated.id,ordinary.id).n,3);
});

test('historical task proofs of every JSON type are stripped from both views and archive/restore without rewriting stored evidence',t=>{
  const f=fixture(t),rows=[];
  for(const action of ['task.created','task.updated'])for(const proof of [null,42,'invalid-proof',[],{kind:'employee',entityId:f.employee.id}]){
    const eventId=`audit_${randomUUID()}`,noticeId=`notice_${randomUUID()}`,payload={taskId:'historical-task',assignmentBinding:proof,count:7,nested:{assignmentBinding:'unchanged-nested-value'}},raw=JSON.stringify(payload,null,2);
    f.db.prepare('INSERT INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,f.ws.id,'user',action,raw,'2026-10-17T12:00:00.000Z');
    f.db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at,read_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?)').run(noticeId,f.ws.id,eventId,'user',action,raw,'2026-10-17T12:00:00.000Z',proof===null?'2026-10-17T12:01:00.000Z':null,null);
    rows.push({eventId,noticeId,raw,visible:withoutProof(payload)});
  }
  const beforeStats=f.repo.notificationStats(f.slug);
  for(const row of rows){
    const audit=f.repo.listAudit(f.slug,100).find(value=>value.id===row.eventId),notice=f.repo.listNotifications(f.slug,100).find(value=>value.id===row.noticeId);
    assert.deepEqual(JSON.parse(audit.payload_json),row.visible);assert.deepEqual(JSON.parse(notice.payload_json),row.visible);assert.deepEqual(notice.payload,row.visible);
    for(const archived of [true,false]){
      const result=f.repo.archiveNotification(row.noticeId,archived);assert.deepEqual(result.payload,row.visible);assert.deepEqual(JSON.parse(result.payload_json),row.visible);assert.equal(Boolean(result.archived_at),archived);
      assert(f.repo.listNotifications(f.slug,100,{archived}).some(value=>value.id===row.noticeId));
    }
    assert.equal(f.db.prepare('SELECT payload_json FROM audit_events WHERE id=?').get(row.eventId).payload_json,row.raw);
    assert.equal(f.db.prepare('SELECT payload_json FROM notifications WHERE id=?').get(row.noticeId).payload_json,row.raw);
  }
  assert.deepEqual(f.repo.notificationStats(f.slug),beforeStats);
});

test('legacy payload bytes and non-task fields remain unchanged through all public repository views',t=>{
  const f=fixture(t);
  for(const [action,raw] of [['task.created','{ "taskId" : "old-task", "count" : 2 }\n'],['task.updated','null'],['task.updated','[1,2]'],['task.updated','invalid old JSON'],['unrelated.event','{ "assignmentBinding" : {"existing":"field"}, "count":2 }']]){
    const eventId=`audit_${randomUUID()}`,noticeId=`notice_${randomUUID()}`;
    f.db.prepare('INSERT INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,f.ws.id,'user',action,raw,'2026-10-17T12:00:00.000Z');
    f.db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(noticeId,f.ws.id,eventId,'user',action,raw,'2026-10-17T12:00:00.000Z');
    assert.equal(f.repo.listAudit(f.slug,100).find(row=>row.id===eventId).payload_json,raw);assert.equal(f.repo.listNotifications(f.slug,100).find(row=>row.id===noticeId).payload_json,raw);
    assert.equal(f.repo.archiveNotification(noticeId,true).payload_json,raw);assert.equal(f.repo.archiveNotification(noticeId,false).payload_json,raw);
  }
});

test('real member Cookie reads and archive responses hide historical proof while internal proof still governs private mobile reminders',async t=>{
  const f=fixture(t),task=f.repo.createTask(f.slug,{title:'Private mobile reminder',assignee:f.employee.name,state:'todo'}),created=f.rawAudit(task.id),raw=created.payload_json;
  const notice=f.db.prepare('SELECT id FROM notifications WHERE event_id=?').get(created.id);
  f.db.prepare('UPDATE notifications SET payload_json=? WHERE id=?').run(raw,notice.id); // Copy produced by the prior candidate.
  for(const path of [`${f.base}/audit`,`${f.base}/notifications`,`${f.base}/notifications?unread=1`]){
    const result=await exchange(f.app,path,{cookie:f.cookie});assert.equal(result.status,200);assert(!result.bytes.includes(Buffer.from('assignmentBinding')));assert(!result.bytes.includes(Buffer.from(JSON.parse(raw).assignmentBinding.assigneeHash)));
  }
  for(const archived of [true,false]){
    const result=await exchange(f.app,`/api/notifications/${notice.id}/archive`,{method:'POST',cookie:f.cookie,body:{archived}});assert.equal(result.status,200);assert.deepEqual(result.json().payload,{taskId:task.id});assert(!result.bytes.includes(Buffer.from('assignmentBinding')));
    const listed=await exchange(f.app,`${f.base}/notifications?archived=${archived?1:0}`,{cookie:f.cookie});assert.equal(listed.status,200);assert(listed.json().notifications.some(row=>row.id===notice.id));assert(!listed.bytes.includes(Buffer.from('assignmentBinding')));
  }
  const read=await exchange(f.app,`${f.base}/notifications/read`,{method:'POST',cookie:f.cookie,body:{ids:[notice.id]}});assert.deepEqual(Object.keys(read.json()).sort(),['ok','stats']);
  f.repo.transitionTask(task.id,'blocked');const stateEvent=f.db.prepare("SELECT id FROM audit_events WHERE action='task.state_changed' ORDER BY rowid DESC LIMIT 1").get();
  const service=createMobileNotificationReadService(f.repo);assert(service.list(f.slug,{}, {actorUserId:f.owner.user_id}).items.some(row=>row.id===stateEvent.id));assert.deepEqual(service.list(f.slug,{}, {actorUserId:f.member.user_id}).items,[]);
  assert.throws(()=>service.resolve(f.slug,stateEvent.id,{actorUserId:f.member.user_id}),{status:404});assert.equal(f.rawAudit(task.id).payload_json,raw);assert.equal(f.db.prepare('SELECT payload_json FROM notifications WHERE id=?').get(notice.id).payload_json,raw);
  const taskResponse=await exchange(f.app,`/api/tasks/${task.id}`,{cookie:f.cookie});assert.equal(taskResponse.status,200);assert.equal(taskResponse.json().id,task.id);assert(!taskResponse.bytes.includes(Buffer.from('assignmentBinding')));
});

test('actual authenticated SSE and the WS-shared hub publish only public task payloads after immediate and template-deferred commits',async t=>{
  const f=fixture(t),stream=await exchange(f.app,`${f.base}/notifications/stream`,{cookie:f.cookie,stream:true});t.after(stream.close);
  assert.equal(stream.status,200);assert.equal(stream.headers['content-type'],'text/event-stream');
  const hub=[],unsubscribe=f.app.locals.realtime.subscribe(f.slug,event=>hub.push(event));t.after(unsubscribe);
  const immediate=f.repo.createTask(f.slug,{title:'Immediate',assignee:f.employee.id});f.repo.updateTask(immediate.id,{assignee:null});
  const before=stream.text();let deferred;
  f.repo.withEmployeeTemplateTransaction(()=>{deferred=f.repo.createTask(f.slug,{title:'Deferred',assignee:f.employee.id});f.repo.updateTask(deferred.id,{assignee:null});assert.equal(stream.text(),before);});
  const committed=stream.text();assert.throws(()=>f.repo.withEmployeeTemplateTransaction(()=>{f.repo.createTask(f.slug,{title:'Rolled back',assignee:f.employee.id});throw new Error('ROLLBACK_PUBLIC_FIXTURE');}),/ROLLBACK_PUBLIC_FIXTURE/);assert.equal(stream.text(),committed);
  const events=stream.text().split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))).filter(row=>row.action);
  assert.equal(events.length,4);assert.deepEqual(events.map(row=>row.action),['task.created','task.updated','task.created','task.updated']);assert(events.every(row=>Object.keys(row.payload).join(',')==='taskId'));
  assert.deepEqual(hub,events);assert(!JSON.stringify(hub.map(event=>({type:'notification',event}))).includes('assignmentBinding'));assert(!stream.text().includes('assignmentBinding'));
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action IN ('task.created','task.updated') AND json_type(payload_json,'$.assignmentBinding')='object'").get().n,4);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM notifications WHERE action IN ('task.created','task.updated') AND json_type(payload_json,'$.assignmentBinding') IS NOT NULL").get().n,0);
});
