import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import net from 'node:net';
import {prepareFrozenSources,sha} from '../scripts/verify-mobile-data-safe-fallback.mjs';

const originalListen=net.Server.prototype.listen;
net.Server.prototype.listen=function(){throw new Error('FALLBACK_FIXTURE_MUST_NOT_LISTEN');};
const frozen=prepareFrozenSources(),passed=[],connections=[];
const modules=Object.fromEntries(await Promise.all(Object.entries(frozen.roots).map(async([name,root])=>[name,await import(pathToFileURL(path.join(root,'backend/repository.mjs')))])));
const {createMobileNotificationReadService}=await import(pathToFileURL(path.join(frozen.roots.forward,'backend/mobile-notifications.mjs')));
const {createApp}=await import('./app.mjs');
const key='isolated-assignment-roundtrip-key-not-a-real-secret';
after(()=>{net.Server.prototype.listen=originalListen;frozen.cleanup();assert.equal(fs.existsSync(frozen.directory),false);if(process.env.ZIWEI_ASSIGNMENT_REPORT)fs.writeFileSync(process.env.ZIWEI_ASSIGNMENT_REPORT,JSON.stringify({identity:frozen.identity,passed,connections,listenersStarted:0,modelDispatches:0,realDatabaseAccess:false,fixturesRemoved:true},null,2)+'\n');});
function fixture(name){
  const directory=path.join(frozen.directory,name);fs.mkdirSync(directory);const filename=path.join(directory,'fixture.sqlite'),objects=path.join(directory,'objects');fs.mkdirSync(objects);
  let repo=null,phase=0;const events=[];
  return {directory,filename,events,
    open(version){assert.equal(repo,null,'Close the previous repository/SQLite connection first');repo=modules[version].createRepository({filename,objectStoreDir:objects,envEncryptionKey:key,onEvent:event=>events.push(event)});const actual=repo.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file;assert.equal(actual,filename);connections.push({fixture:name,phase:++phase,version,explicitTemporaryDatabase:true});return repo;},
    close(){if(repo){repo.db.close();repo=null;}},
    get repo(){return repo;}
  };
}
const schema=repo=>sha(JSON.stringify(repo.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()));
function seed(repo){
  const ws=repo.getWorkspace('test-111');repo.db.prepare("UPDATE workspaces SET kind='team' WHERE id=?").run(ws.id);
  for(const [id,user,role] of [['fixture_owner','fixture_owner_user','owner'],['fixture_member','fixture_member_user','member']])repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run(id,ws.id,user,id,id+'@fixture.invalid',role,new Date().toISOString());
  return {ws,owner:'fixture_owner_user',member:'fixture_member_user'};
}
const audits=(repo,taskId)=>repo.db.prepare("SELECT rowid,id,action,payload_json FROM audit_events WHERE action IN ('task.created','task.updated') AND json_extract(payload_json,'$.taskId')=? ORDER BY rowid").all(taskId);
const binding=(repo,taskId)=>audits(repo,taskId).map(row=>JSON.parse(row.payload_json)).filter(row=>Object.hasOwn(row,'assignmentBinding')).at(-1)?.assignmentBinding;
function notice(repo,taskId){repo.transitionTask(taskId,'blocked');return repo.db.prepare("SELECT id FROM audit_events WHERE action='task.state_changed' AND json_extract(payload_json,'$.taskId')=? ORDER BY rowid DESC LIMIT 1").get(taskId).id;}
function visible(repo,who,taskId,eventId,expected){
  const service=createMobileNotificationReadService(repo),context={actorUserId:who};
  assert.equal(service.list('test-111',{},context).items.some(row=>row.id===eventId),expected);
  if(expected)assert.equal(service.resolve('test-111',eventId,context).item.target.id,taskId);else assert.throws(()=>service.resolve('test-111',eventId,context),{status:404});
}
const check=(name,fn)=>test(name,async t=>{await fn(t);passed.push(name);});

check('new → fallback → new uses real closed/reopened databases and rebinds A/B/A after a private alias takeover',()=>{
  const f=fixture('safe-aba');try{
    let repo=f.open('forward');const {ws,owner,member}=seed(repo),employee=repo.createEmployee(ws.slug,{name:'AliasA',runtime:'Codex',ownerUserId:owner}),task=repo.createTask(ws.slug,{title:'Private takeover work',assignee:'AliasA',state:'todo'}),eventId=notice(repo,task.id),initial=audits(repo,task.id)[0],initialSchema=schema(repo);
    assert.equal(binding(repo,task.id).entityId,employee.id);visible(repo,member,task.id,eventId,true);f.close();
    repo=f.open('fallback');repo.updateEmployee(employee.id,{name:'Renamed original public A'});const privateEmployee=repo.createEmployee(ws.slug,{name:'AliasA',runtime:'Codex',visibility:'personal',ownerUserId:owner});
    const middle=repo.updateTask(task.id,{assignee:'UnresolvedB'});assert.equal(middle.assignee,'UnresolvedB');assert.equal(binding(repo,task.id).kind,'unresolved');
    const final=repo.updateTask(task.id,{assignee:'AliasA'});assert.equal(final.assignee,'AliasA');assert.equal(binding(repo,task.id).entityId,privateEmployee.id);assert.equal(binding(repo,task.id).kind,'employee');
    assert.equal(audits(repo,task.id)[0].payload_json,initial.payload_json);f.close();
    repo=f.open('forward');assert.equal(schema(repo),initialSchema);assert.equal(binding(repo,task.id).entityId,privateEmployee.id);visible(repo,member,task.id,eventId,false);visible(repo,owner,task.id,eventId,true);
    assert.equal(audits(repo,task.id)[0].payload_json,initial.payload_json);assert.equal(audits(repo,task.id).length,3);
  }finally{f.close();}
});

check('negative control: the exact unpatched base writer really reproduces the stale A/B/A authorization gap',()=>{
  const f=fixture('old-writer-negative-control');try{
    let repo=f.open('forward');const {ws,owner,member}=seed(repo),employee=repo.createEmployee(ws.slug,{name:'AliasA',runtime:'Codex',ownerUserId:owner}),task=repo.createTask(ws.slug,{title:'Negative control',assignee:'AliasA',state:'todo'}),eventId=notice(repo,task.id),initial=audits(repo,task.id)[0];f.close();
    repo=f.open('base');repo.updateEmployee(employee.id,{name:'Renamed old A'});repo.createEmployee(ws.slug,{name:'AliasA',runtime:'Codex',visibility:'personal',ownerUserId:owner});repo.updateTask(task.id,{assignee:'UnresolvedB'});repo.updateTask(task.id,{assignee:'AliasA'});assert(audits(repo,task.id).slice(1).every(row=>!Object.hasOwn(JSON.parse(row.payload_json),'assignmentBinding')));f.close();
    repo=f.open('forward');assert.equal(binding(repo,task.id).entityId,employee.id);assert.equal(audits(repo,task.id)[0].payload_json,initial.payload_json);visible(repo,member,task.id,eventId,true);
    // This expected unsafe result proves the fixture detects the old-writer
    // failure. It is not an accepted fallback or a claim about the safe writer.
  }finally{f.close();}
});

check('fallback unknown/null/new assignments retain explicit markers through roll-forward and never revive old proof',()=>{
  const f=fixture('markers');try{
    let repo=f.open('forward');const {ws,owner,member}=seed(repo),employee=repo.createEmployee(ws.slug,{name:'Public marker owner',runtime:'Codex',ownerUserId:owner});
    const unknown=repo.createTask(ws.slug,{assignee:employee.id,state:'todo'}),unassigned=repo.createTask(ws.slug,{assignee:employee.id,state:'todo'}),unknownEvent=notice(repo,unknown.id),unassignedEvent=notice(repo,unassigned.id);const initial=audits(repo,unknown.id)[0].payload_json;f.close();
    repo=f.open('fallback');repo.updateTask(unknown.id,{assignee:'No matching owner',assignmentBinding:{kind:'employee',entityId:employee.id}});repo.updateTask(unassigned.id,{assignee:null});
    assert.equal(binding(repo,unknown.id).kind,'unresolved');assert.equal(binding(repo,unassigned.id).kind,'unassigned');const fresh=repo.createTask(ws.slug,{assignee:employee.id,state:'todo'}),freshEvent=notice(repo,fresh.id);assert.equal(binding(repo,fresh.id).entityId,employee.id);f.close();
    repo=f.open('forward');visible(repo,member,unknown.id,unknownEvent,false);visible(repo,member,unassigned.id,unassignedEvent,true);visible(repo,member,fresh.id,freshEvent,true);assert.equal(audits(repo,unknown.id)[0].payload_json,initial);
  }finally{f.close();}
});

check('base task DTO/schema and legacy no-op SQLite echoes remain compatible without backfilling proof',()=>{
  const f=fixture('legacy-dto');try{
    let repo=f.open('base');const {ws}=seed(repo),task=repo.createTask(ws.slug,{title:'Legacy task',description:'Description',assignee:123,createdBy:'fixture-user',labels:['one'],dueDate:'2026-11-01'}),initialSchema=schema(repo),keys=Object.keys(task).sort(),old=audits(repo,task.id)[0].payload_json,persisted=repo.db.prepare('SELECT assignee FROM tasks WHERE id=?').get(task.id).assignee;assert.equal(task.assignee,123);f.close();
    repo=f.open('fallback');let dto=repo.updateTask(task.id,{...repo.getTask(task.id),assignee:123,title:'Legacy task'});assert.equal(dto.assignee,123);assert.deepEqual(Object.keys(dto).sort(),[...keys,'labels_json'].sort());
    repo.updateTask(task.id,{dueDate:'2026-11-02'});assert.equal(binding(repo,task.id),undefined);assert.equal(audits(repo,task.id)[0].payload_json,old);assert.equal(schema(repo),initialSchema);f.close();
    repo=f.open('forward');repo.updateTask(task.id,{title:'A harmless title',assignee:persisted,assignmentBinding:{kind:'member',entityId:'forged'}});assert.equal(binding(repo,task.id),undefined);assert.equal(schema(repo),initialSchema);
  }finally{f.close();}
});

check('fallback task/audit/notification failures roll back together, preserving proof and preventing callback escape',()=>{
  const f=fixture('atomicity');try{
    const repo=f.open('fallback'),{ws}=seed(repo),task=repo.createTask(ws.slug,{title:'Original',assignee:'Unknown original'});const dump=()=>JSON.stringify(['tasks','audit_events','notifications'].map(table=>repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
    for(const table of ['audit_events','notifications'])for(const operation of ['create','update']){
      const before=dump(),events=f.events.length,action=operation==='create'?'task.created':'task.updated';repo.db.exec(`CREATE TEMP TRIGGER reject_assignment_write BEFORE INSERT ON ${table} WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'FIXTURE_WRITE_REJECTED'); END`);
      assert.throws(()=>operation==='create'?repo.createTask(ws.slug,{title:'Rejected',assignee:null}):repo.updateTask(task.id,{title:'Rejected',assignee:null}),/FIXTURE_WRITE_REJECTED/);assert.equal(dump(),before);assert.equal(f.events.length,events);repo.db.exec('DROP TRIGGER reject_assignment_write');
    }
  }finally{f.close();}
});

function exchange(app,url,{cookie='',method='GET',body,stream=false}={}){
  const socket=new Duplex({read(){},write(_c,_e,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],input=body===undefined?null:Buffer.from(JSON.stringify(body));req.method=method;req.url=url;req.headers={host:'fallback.fixture',cookie,...(input?{'content-type':'application/json','content-length':String(input.length)}:{})};
  const close=()=>{req.emit('close');socket.destroy();};return new Promise((resolve,reject)=>{const result=()=>({status:res.statusCode,text:()=>Buffer.concat(chunks).toString(),json:()=>JSON.parse(Buffer.concat(chunks).toString()),close});res.flushHeaders=()=>{};res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();if(stream)resolve(result());return true;};res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();resolve(result());res.emit('finish');close();return res;};req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>{close();reject(error||Error('Unhandled fixture route'));});if(input)req.push(input);req.push(null);});
}

check('old authenticated public HTTP/SSE views hide new/historical proof, preserve raw evidence, and defer only public events',async()=>{
  const directory=path.join(frozen.directory,'public-http');fs.mkdirSync(directory);const objects=path.join(directory,'objects');fs.mkdirSync(objects);
  const app=createApp({filename:path.join(directory,'fixture.sqlite'),objectStoreDir:objects,envEncryptionKey:key,requireAuth:true,enableScheduler:false}),repo=app.locals.repo,db=repo.db,auth=app.locals.auth;let stream,unsubscribe;
  try{
    const owner=auth.setup({email:'fallback-owner@fixture.invalid',password:'fixture-password-only'}),member=auth.register({email:'fallback-member@fixture.invalid',password:'fixture-password-only'}),slug='fallback-public';auth.createWorkspace(owner.user_id,{slug,name:'Fallback public',kind:'team'});const ws=repo.getWorkspace(slug);db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('public_member',ws.id,member.user_id,'Member','fallback-member@fixture.invalid','member',new Date().toISOString());
    const employee=repo.createEmployee(slug,{name:'Private alias',runtime:'Codex',visibility:'personal',ownerUserId:owner.user_id}),cookie='ziwei_session='+member.session.token,base='/api/workspaces/'+slug;
    stream=await exchange(app,base+'/notifications/stream',{cookie,stream:true});assert.equal(stream.status,200);const hub=[];unsubscribe=app.locals.realtime.subscribe(slug,event=>hub.push(event));
    const task=repo.createTask(slug,{assignee:employee.name,state:'todo'}),original=audits(repo,task.id)[0],noticeRow=db.prepare('SELECT id FROM notifications WHERE event_id=?').get(original.id);assert.deepEqual(JSON.parse(db.prepare('SELECT payload_json FROM notifications WHERE id=?').get(noticeRow.id).payload_json),{taskId:task.id});
    db.prepare('UPDATE notifications SET payload_json=? WHERE id=?').run(original.payload_json,noticeRow.id); // Historical prior-writer copy.
    for(const route of ['/audit','/notifications','/notifications?unread=1']){const response=await exchange(app,base+route,{cookie});assert.equal(response.status,200);assert(!response.text().includes('assignmentBinding'));}
    for(const archived of [true,false]){const response=await exchange(app,'/api/notifications/'+noticeRow.id+'/archive',{cookie,method:'POST',body:{archived}});assert.equal(response.status,200);assert.deepEqual(response.json().payload,{taskId:task.id});assert.deepEqual(JSON.parse(response.json().payload_json),{taskId:task.id});assert(!response.text().includes(employee.id));}
    const before=stream.text();repo.withEmployeeTemplateTransaction(()=>{const value=repo.createTask(slug,{assignee:employee.name});repo.updateTask(value.id,{assignee:null});assert.equal(stream.text(),before);});const committed=stream.text();assert.throws(()=>repo.withEmployeeTemplateTransaction(()=>{repo.createTask(slug,{assignee:employee.name});throw Error('FIXTURE_OUTER_ROLLBACK');}),/FIXTURE_OUTER_ROLLBACK/);assert.equal(stream.text(),committed);
    const live=committed.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))).filter(event=>event.action);assert.deepEqual(hub,live);assert.equal(live.length,3);assert(live.every(event=>Object.keys(event.payload).join(',')==='taskId'));assert(!JSON.stringify(hub.map(event=>({type:'notification',event}))).includes('assignmentBinding'));assert(!committed.includes(employee.id));
    assert.equal(audits(repo,task.id)[0].payload_json,original.payload_json);assert.equal(db.prepare('SELECT payload_json FROM notifications WHERE id=?').get(noticeRow.id).payload_json,original.payload_json);
    // Public projection is exact only for the two task audit types. Existing
    // non-proof bytes and unrelated same-named fields must retain their bytes.
    for(const [action,raw] of [['task.created','{ "taskId" : "old-task", "n": 2 }\n'],['task.updated','null'],['unrelated.event','{ "assignmentBinding" : {"existing":true} }']]){
      const id='audit_raw_'+sha(action+raw).slice(0,12),nid='notice_'+id;db.prepare('INSERT INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(id,ws.id,'fixture',action,raw,new Date().toISOString());db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(nid,ws.id,id,'fixture',action,raw,new Date().toISOString());assert.equal(repo.listAudit(slug,100).find(row=>row.id===id).payload_json,raw);assert.equal(repo.listNotifications(slug,100).find(row=>row.id===nid).payload_json,raw);assert.equal(repo.archiveNotification(nid,true).payload_json,raw);assert.equal(repo.archiveNotification(nid,false).payload_json,raw);
    }
  }finally{unsubscribe?.();stream?.close();db.close();}
});
