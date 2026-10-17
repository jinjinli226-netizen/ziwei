import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from './app.mjs';
import {createManagementService} from './management.mjs';
import {markHermesLauncherFailure,consumeRuntimePrelaunchEvidence,completeRuntimeExit} from '../src/runtime-launch-evidence.mjs';
import {createMobileNotificationReadService,MOBILE_NOTIFICATION_MAX_BYTES,MOBILE_NOTIFICATION_SCAN_LIMIT} from './mobile-notifications.mjs';

const exitProof=(code=0)=>({launched:true,rootPid:123,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,rootExitCode:code,hostExitCode:code});
const identifier=prefix=>`${prefix}_${randomUUID()}`;
async function request(app,url,{cookie='',headers={}}={}){
  const socket=new Duplex({read(){},write(_data,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[];
  req.method='GET';req.url=url;req.headers={host:'mobile-notifications.fixture',cookie,...headers};
  try{return await new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,encoding));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.getHeaders(),bytes,json:bytes.length?JSON.parse(bytes.toString()):null});res.emit('finish');return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));req.push(null);
  });}finally{socket.destroy();}
}
function fixture(t,{kind='team'}={}){
  const app=createApp({memory:true,requireAuth:true,enableScheduler:false}),repo=app.locals.repo,auth=app.locals.auth,db=repo.db;
  t.after(()=>db.close());
  const owner=auth.setup({email:'notice-owner@fixture.test',password:'isolated-notice-password'}),member=auth.register({email:'notice-member@fixture.test',password:'isolated-notice-password'}),outsider=auth.register({email:'notice-outsider@fixture.test',password:'isolated-notice-password'}),slug='mobile-notices';
  auth.createWorkspace(owner.user_id,{slug,name:'Mobile notices',kind});const ws=repo.getWorkspace(slug);
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('notice-member',ws.id,member.user_id,'Member','notice-member@fixture.test','member',new Date().toISOString());
  const employee=repo.createEmployee(slug,{name:'执行员工',runtime:'Codex',ownerUserId:owner.user_id}),chat=repo.createConversation(slug,{employeeId:employee.id});
  const service=createMobileNotificationReadService(repo),context={actorUserId:owner.user_id};
  function audit(action,payload={},options={}){
    const eventId=options.eventId||identifier('audit'),noticeId=identifier('notice'),at=options.at||'2026-10-17T11:00:00.000Z';
    db.prepare('INSERT OR IGNORE INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,options.workspaceId||ws.id,'fixture',action,JSON.stringify(payload),at);
    db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at,read_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?)').run(noticeId,options.workspaceId||ws.id,eventId,'fixture',action,JSON.stringify(payload),at,options.readAt||null,options.archivedAt||null);
    return {eventId,noticeId};
  }
  function execution(options={}){
    const actionId=identifier('action'),status=options.status||'succeeded',type=options.type||'conversation.execute',payload={employeeId:employee.id,conversationId:chat.id,...options.payload},result=options.result===undefined?{processExit:exitProof(status==='failed'?1:0)}:options.result;
    db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,task_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(actionId,options.workspaceId||ws.id,'fixture',options.taskId||null,type,JSON.stringify(payload),actionId,status,'2026-10-17T10:00:00.000Z',options.ackedAt===undefined?'2026-10-17T10:00:01.000Z':options.ackedAt,'2026-10-17T11:00:00.000Z',result===null?null:JSON.stringify(result),options.error||null);
    return {actionId,...audit(options.auditAction||`a2a.action.${status}`,{actionId,type,error:options.error||null},options)};
  }
  function list(input={},who=context){return service.list(slug,input,who);}
  return {app,repo,auth,db,owner,member,outsider,slug,ws,employee,chat,service,context,audit,execution,list,cookie:who=>`ziwei_session=${who.session.token}`};
}

test('confirmed original execution yields small typed reminders and exact original target',t=>{
  const f=fixture(t),message=f.repo.addConversationMessage(f.chat.id,{content:'Original request',dispatch:false,actorUserId:f.owner.user_id});
  const a=f.execution({payload:{messageId:message.id}}),b=f.execution({status:'failed',error:'private token must never be shown'}),rows=f.list();
  assert.equal(rows.schemaVersion,1);assert.equal(rows.accountId,f.owner.user_id);assert.equal(rows.workspaceId,f.ws.id);assert.equal(rows.workspaceSlug,f.slug);assert.equal(rows.historyWindow,true);assert.equal(rows.hasMore,false);
  assert.deepEqual(rows.items.map(row=>row.id),[a.eventId,b.eventId]);assert.deepEqual(rows.items.map(row=>row.kind),['execution.completed','execution.failed']);
  assert.deepEqual(rows.items[0].target,{kind:'conversation',id:f.chat.id,employeeId:f.employee.id,actionId:a.actionId,messageId:message.id});
  assert(rows.items.every(row=>row.executionState==='confirmed'));assert(!JSON.stringify(rows).includes('private token'));
});

test('baseline skips all history and the same cursor subsequently returns new events',t=>{
  const f=fixture(t);f.execution();const baseline=f.list({baseline:true});assert.deepEqual(baseline.items,[]);assert.equal(baseline.hasMore,false);
  const a=f.execution(),b=f.execution(),first=f.list({cursor:baseline.nextCursor,limit:1});
  assert.equal(first.items[0].id,a.eventId);assert.equal(first.hasMore,true);assert(!Object.hasOwn(first,'historyWindow'));
  const second=f.list({cursor:first.nextCursor,limit:1});assert.equal(second.items[0].id,b.eventId);assert.equal(second.hasMore,false);
  assert.deepEqual(f.list({cursor:second.nextCursor}).items,[]);assert.deepEqual(f.list({cursor:baseline.nextCursor,limit:1}),first);
});

test('initial recent window is bounded at head and does not start at ancient history',t=>{
  const f=fixture(t),old=f.execution({at:'2000-01-01T00:00:00.000Z'});
  for(let index=0;index<210;index++)f.audit('unrelated.event');
  const latest=f.execution(),result=f.list({limit:50});assert.deepEqual(result.items.map(item=>item.id),[latest.eventId]);assert(!result.items.some(item=>item.id===old.eventId));
  assert.equal(result.hasMore,false);assert.equal(result.historyWindow,true);const next=f.execution();assert.equal(f.list({cursor:result.nextCursor}).items[0].id,next.eventId);
});

test('unauthenticated, outsider and stored-role spoofing cannot bypass membership or private employee visibility',t=>{
  const f=fixture(t),privateEmployee=f.repo.createEmployee(f.slug,{name:'private secret',runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id}),chat=f.repo.createConversation(f.slug,{employeeId:privateEmployee.id});
  f.execution({payload:{employeeId:privateEmployee.id,conversationId:chat.id}});
  assert.throws(()=>f.list({},{}),{status:401});assert.throws(()=>f.list({},{actorUserId:f.outsider.user_id,actorRole:'owner'}),{status:403});
  assert.equal(f.list({},{actorUserId:f.member.user_id,actorRole:'owner'}).items.length,0);assert.equal(f.list().items.length,1);
  const baseline=f.list({baseline:true});f.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(f.ws.id,f.owner.user_id);
  assert.throws(()=>f.list({cursor:baseline.nextCursor}),{status:403});
});

test('cursor rejects account/workspace changes, malformed input, vanished anchors and old versions',t=>{
  const f=fixture(t);f.execution();const cursor=f.list().nextCursor;
  assert.throws(()=>f.list({cursor},{actorUserId:f.member.user_id}),{code:'MOBILE_NOTIFICATION_CURSOR_SCOPE'});
  const other=f.auth.createWorkspace(f.owner.user_id,{slug:'other-notices',name:'Other',kind:'team'}).workspace;
  assert.throws(()=>f.service.list(other.slug,{cursor},f.context),{code:'MOBILE_NOTIFICATION_CURSOR_SCOPE'});
  for(const bad of ['!',Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(cursor,'base64url')),v:0})).toString('base64url')])assert.throws(()=>f.list({cursor:bad}),{code:'MOBILE_NOTIFICATION_CURSOR_INVALID'});
  const anchor=JSON.parse(Buffer.from(cursor,'base64url'));f.db.prepare('DELETE FROM notifications WHERE id=?').run(anchor.i);
  assert.throws(()=>f.list({cursor}),{code:'MOBILE_NOTIFICATION_CURSOR_EXPIRED'});
});

test('limits and baseline combinations are strict and bootstrap is read-only',t=>{
  const f=fixture(t);for(const limit of [0,-1,51,1.5,'no',Infinity])assert.throws(()=>f.list({limit}),{status:400});
  assert.throws(()=>f.list({baseline:'true'}),{status:400});assert.throws(()=>f.list({baseline:true,cursor:f.list().nextCursor}),{status:400});assert.throws(()=>f.list({baseline:true,cursor:''}),{status:400});
  assert.equal(f.list({limit:'50'}).schemaVersion,1);
});

test('no original target, foreign workspace, changed employee binding or foreign user means no reminder',t=>{
  const f=fixture(t),other=f.auth.createWorkspace(f.owner.user_id,{slug:'foreign-notices',name:'Foreign',kind:'team'}).workspace;
  const employee=f.repo.createEmployee(other.slug,{name:'foreign',runtime:'Codex'}),foreignChat=f.repo.createConversation(other.slug,{employeeId:employee.id}),different=f.repo.createEmployee(f.slug,{name:'different',runtime:'Codex'}),differentChat=f.repo.createConversation(f.slug,{employeeId:different.id});
  f.execution({payload:{conversationId:null}});f.execution({payload:{conversationId:foreignChat.id}});f.execution({payload:{conversationId:differentChat.id}});f.execution({payload:{employeeId:employee.id,conversationId:foreignChat.id}});f.execution({payload:{userId:f.member.user_id}});
  assert.deepEqual(f.list().items,[]);
});

test('personal workspace device ownership is checked and team member access retains its existing policy',t=>{
  const f=fixture(t,{kind:'personal'});f.repo.heartbeatDevice(f.slug,{deviceId:'notice-pc'});f.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(f.owner.user_id,'notice-pc');
  f.db.prepare('UPDATE employees SET target_device_id=? WHERE id=?').run('notice-pc',f.employee.id);f.execution({payload:{deviceId:'notice-pc'}});
  assert.equal(f.list({},{actorUserId:f.member.user_id}).items.length,0);assert.equal(f.list().items.length,1);
  assert.equal(f.list({},{actorUserId:f.owner.user_id,deviceScope:'other-pc'}).items.length,0);
  f.db.prepare("UPDATE workspaces SET kind='team' WHERE id=?").run(f.ws.id);assert.equal(f.list({},{actorUserId:f.member.user_id}).items.length,1);
});

test('directory, validation, configuration, stop and ordinary native inspection never announce task completion',t=>{
  const f=fixture(t);for(const type of ['directory.inspect','hermes.bot.validate','hermes.bot.provision','conversation.stop','hermes.bot.stop'])f.execution({type});
  for(const nativeOperation of [{resource:'memory',operation:'read'},{resource:'goals',operation:'stop'},{resource:'mcp',operation:'call'}])f.execution({type:'hermes.bot.native',payload:{nativeOperation}});
  f.execution({status:'failed',ackedAt:null,result:{code:'BOT_CANCELLED_BEFORE_START'}});
  f.execution({status:'failed',result:{processExit:{...exitProof(130),cancelled:true},stopConfirmed:true}});
  assert.deepEqual(f.list().items,[]);
});

test('uncertain, fixture, missing, invalid, unconfirmed or oversized proof stays attention-required',t=>{
  const f=fixture(t),variants=[null,{processExit:exitProof(),executionState:'uncertain'},{result:{processExit:exitProof(),code:'EXECUTION_UNCERTAIN'}},{processExit:{...exitProof(),treeConfirmed:false}},{processExit:exitProof(),fixture:true},{processExit:exitProof(),fixture:{}},{processExit:exitProof(),fixture:'false'},{processExit:{...exitProof(),padding:'x'.repeat(9000)}},{processExit:exitProof(),nested:{status:'uncertain'}},{processExit:exitProof(),many:Array.from({length:520},()=>0)}];
  for(const result of variants)f.execution({result});f.execution({status:'expired'});
  const malformed=f.execution();f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run('{bad json',malformed.actionId);
  const rows=f.list({limit:50}).items;assert.equal(rows.length,variants.length+2);assert(rows.every(item=>item.kind==='attention.required'&&item.executionState==='uncertain'));
});

test('an actual sealed runtime-prelaunch failed receipt stays definitive and says it could not start',t=>{
  const f=fixture(t),error=markHermesLauncherFailure(new Error('Synthetic launcher resolution failure'));
  const evidence=consumeRuntimePrelaunchEvidence(error);assert(evidence);assert.equal(consumeRuntimePrelaunchEvidence(error),null);assert(completeRuntimeExit(evidence.processExit));
  // main 383d4cbbaa2bc59a0ee3d9c6fee0b561096d64d3's sealed bot-start
  // admission proof was executed independently and has this exact same exit
  // contract. Keep the test coupled to a real runtime-created proof, rather
  // than inventing a launched:false-only object or changing dispatch rules.
  assert.deepEqual(evidence.processExit,{platform:process.platform,supervisor:'runtime-prelaunch',launched:false,rootPid:null,rootConfirmed:false,rootExitCode:null,treeConfirmed:true,activeProcesses:0,cancelled:false});
  for(const nested of [false,true]){
    const result={code:'BOT_REVISION_CONFLICT',...evidence},run=f.execution({status:'failed',result:nested?{result}:result}),item=f.service.resolve(f.slug,run.eventId,f.context).item;
    assert.equal(item.kind,'execution.failed');assert.equal(item.executionState,'confirmed');assert.match(item.summary,/启动前未能开始/);assert(!/待核实/.test(item.title+item.summary));
    assert.deepEqual(f.repo.getA2AAction(run.actionId).result,nested?{result}:result);
  }
});

test('prelaunch classification requires every definitive no-launch field and keeps uncertain/fixture/size limits',t=>{
  const f=fixture(t),evidence=consumeRuntimePrelaunchEvidence(markHermesLauncherFailure(new Error('Synthetic launcher failure'))),base=evidence.processExit;
  const variants=[{launched:false}];
  for(const [key,value] of [['supervisor','windows-job'],['launched',true],['rootPid',0],['rootExitCode',0],['rootConfirmed',true],['treeConfirmed',false],['activeProcesses',1],['cancelled',true],['failureCode','UNCONFIRMED'],['signal','SIGTERM'],['hostExitCode',1]])variants.push({...base,[key]:value});
  for(const key of ['supervisor','launched','rootPid','rootExitCode','rootConfirmed','treeConfirmed','activeProcesses','cancelled']){const value={...base};delete value[key];variants.push(value);}
  for(const processExit of variants)f.execution({status:'failed',result:{...evidence,processExit}});
  for(const extra of [{fixture:true},{code:'EXECUTION_UNCERTAIN'},{executionState:'uncertain'},{nested:{status:'uncertain'}},{many:Array.from({length:520},()=>0)}])f.execution({status:'failed',result:{...evidence,...extra}});
  f.execution({status:'failed',result:{...evidence,processExit:{...base,padding:'x'.repeat(9000)}}});
  f.execution({status:'succeeded',result:evidence});
  const items=f.list({limit:50}).items;assert.equal(items.length,variants.length+7);assert(items.every(item=>item.kind==='attention.required'&&item.executionState==='uncertain'));
});

test('large image/output/prompt strings never hydrate through repo APIs or escape the thin projection',t=>{
  const f=fixture(t),secret='NEVER_RETURN_PRIVATE_RESULT',large='A'.repeat(2*1024*1024);
  f.execution({payload:{prompt:secret+large,attachments:[{content:large}]},result:{processExit:exitProof(),output:secret+large,outputArtifacts:[{content:large}]}});
  for(const name of ['getConversation','getA2AAction','listNotifications','getEmployee'])f.repo[name]=()=>{throw new Error('Full hydration forbidden');};
  const result=f.list();assert.equal(result.items[0].kind,'execution.completed');assert(Buffer.byteLength(JSON.stringify(result))<1500);assert(!JSON.stringify(result).includes(secret));
});

test('blocked/review/todo task reminders use same-workspace real tasks and do not guess employee chats',t=>{
  const f=fixture(t),task=f.repo.createTask(f.slug,{title:'<b>审核</b> https://secret.invalid/token\n工作',state:'review'});
  f.audit('task.state_changed',{taskId:task.id,to:'review'});const result=f.list().items[0];assert.equal(result.kind,'attention.required');assert.deepEqual(result.target,{kind:'task',id:task.id});assert(!/[<>\n]|https:/.test(result.title));
  f.db.prepare("UPDATE tasks SET state='completed' WHERE id=?").run(task.id);assert.deepEqual(f.list().items,[]);
});

test('incremental scanner advances over 200 invisible/irrelevant rows without unbounded hydration',t=>{
  const f=fixture(t),baseline=f.list({baseline:true});for(let index=0;index<205;index++)f.audit('irrelevant');const expected=f.execution();
  const scans=[],audited={...f.repo,db:{prepare(sql){const statement=f.db.prepare(sql);return new Proxy(statement,{get(target,key){if(key==='all')return(...args)=>{const rows=target.all(...args);if(sql.includes('FROM notifications n'))scans.push(rows.length);return rows;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});},exec:sql=>f.db.exec(sql)}};
  const reader=createMobileNotificationReadService(audited),first=reader.list(f.slug,{cursor:baseline.nextCursor},f.context);assert.deepEqual(first.items,[]);assert.equal(first.hasMore,true);assert.notEqual(first.nextCursor,baseline.nextCursor);
  const second=reader.list(f.slug,{cursor:first.nextCursor},f.context);assert.equal(second.items[0].id,expected.eventId);assert.equal(second.hasMore,false);assert(scans.every(n=>n<=MOBILE_NOTIFICATION_SCAN_LIMIT));assert.deepEqual(scans,[200,6]);
});

test('stable event identities deduplicate stream/list identity and archived notifications stay hidden',t=>{
  const f=fixture(t),a=f.execution();f.audit('a2a.action.succeeded',{actionId:a.actionId},{eventId:a.eventId});f.execution({archivedAt:'2026-10-17T11:01:00.000Z'});
  const result=f.list();assert.equal(result.items.length,1);assert.equal(result.items[0].id,a.eventId);assert.notEqual(result.items[0].id,a.noticeId);
});

test('real authenticated middleware accepts only its principal and keeps the original notifications API unchanged',async t=>{
  const f=fixture(t);f.execution();const path=`/api/workspaces/${f.slug}/mobile/notifications`,raw=await request(f.app,`/api/workspaces/${f.slug}/notifications`,{cookie:f.cookie(f.owner)});
  assert.equal((await request(f.app,path)).status,401);assert.equal((await request(f.app,path,{cookie:f.cookie(f.outsider),headers:{'x-workspace-role':'owner'}})).status,403);
  const accepted=await request(f.app,path,{cookie:f.cookie(f.member),headers:{'x-user-id':f.owner.user_id}});assert.equal(accepted.status,200);assert.equal(accepted.json.accountId,f.member.user_id);
  const after=await request(f.app,`/api/workspaces/${f.slug}/notifications`,{cookie:f.cookie(f.owner)});assert.deepEqual(after,raw);
});

test('fifty UTF-8 reminders fit the wire budget; entire database rows and schema stay unchanged',t=>{
  const f=fixture(t);f.db.prepare('UPDATE employees SET name=? WHERE id=?').run('😀\u202e<em>超长姓名</em>'.repeat(100),f.employee.id);for(let index=0;index<55;index++)f.execution();
  const snapshot=()=>JSON.stringify({schema:f.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(),notifications:f.db.prepare('SELECT * FROM notifications ORDER BY rowid').all(),actions:f.db.prepare('SELECT * FROM a2a_actions ORDER BY rowid').all(),messages:f.db.prepare('SELECT * FROM conversation_messages ORDER BY rowid').all(),tasks:f.db.prepare('SELECT * FROM tasks ORDER BY rowid').all()});
  const before=snapshot(),result=f.list({limit:50});assert.equal(result.items.length,50);assert(Buffer.byteLength(JSON.stringify(result))<=MOBILE_NOTIFICATION_MAX_BYTES);assert(result.items.every(item=>Buffer.byteLength(item.title)<=120&&Buffer.byteLength(item.summary)<=240&&!/[<>\u202e]/.test(item.title)));assert.equal(snapshot(),before);
});

test('resolve rechecks original target, employee visibility, deletion, membership and workspace on every click',t=>{
  const f=fixture(t),a=f.execution(),resolved=f.service.resolve(f.slug,a.eventId,{actorUserId:f.member.user_id});
  assert.deepEqual(resolved,{schemaVersion:1,accountId:f.member.user_id,workspaceId:f.ws.id,workspaceSlug:f.slug,item:f.list({},{actorUserId:f.member.user_id}).items[0]});
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.employee.id);
  assert.throws(()=>f.service.resolve(f.slug,a.eventId,{actorUserId:f.member.user_id,actorRole:'owner'}),{status:404,code:'MOBILE_NOTIFICATION_NOT_FOUND'});
  assert.equal(f.service.resolve(f.slug,a.eventId,f.context).item.target.id,f.chat.id);
  const other=f.auth.createWorkspace(f.owner.user_id,{slug:'resolve-other',name:'Other',kind:'team'}).workspace;
  assert.throws(()=>f.service.resolve(other.slug,a.eventId,f.context),{status:404});
  f.db.prepare("UPDATE employees SET status='deleted' WHERE id=?").run(f.employee.id);assert.throws(()=>f.service.resolve(f.slug,a.eventId,f.context),{status:404});
  f.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(f.ws.id,f.owner.user_id);assert.throws(()=>f.service.resolve(f.slug,a.eventId,f.context),{status:403});
});

test('resolve rejects removed personal-workspace device rights and no longer correlated message IDs',t=>{
  const f=fixture(t,{kind:'personal'});f.repo.heartbeatDevice(f.slug,{deviceId:'resolve-pc'});f.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(f.member.user_id,'resolve-pc');
  f.db.prepare('UPDATE employees SET target_device_id=? WHERE id=?').run('resolve-pc',f.employee.id);
  const a=f.execution({payload:{deviceId:'resolve-pc',messageId:'not-a-message'}}),member={actorUserId:f.member.user_id};
  assert(!Object.hasOwn(f.service.resolve(f.slug,a.eventId,member).item.target,'messageId'));
  f.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(f.owner.user_id,'resolve-pc');assert.throws(()=>f.service.resolve(f.slug,a.eventId,member),{status:404});
});

test('personal notification reading never changes another account feed or workspace-wide read flags',t=>{
  const f=fixture(t),a=f.execution(),member={actorUserId:f.member.user_id};
  const before=f.list({},member),shared=f.repo.listNotifications(f.slug);
  f.service.resolve(f.slug,a.eventId,f.context);f.list({baseline:true});f.list();
  assert.deepEqual(f.list({},member),before);assert.deepEqual(f.repo.listNotifications(f.slug),shared);
});

test('empty-workspace baseline yields a valid reusable cursor; new action appears once it is inserted',t=>{
  const f=fixture(t);f.db.prepare('DELETE FROM notifications WHERE workspace_id=?').run(f.ws.id);
  const base=f.list({baseline:true});assert.deepEqual(base.items,[]);assert(base.nextCursor);assert.deepEqual(f.list({cursor:base.nextCursor}).items,[]);
  const a=f.execution();assert.equal(f.list({cursor:base.nextCursor}).items[0].id,a.eventId);
});

test('task target without a chat resolves only the original task and private assignees remain hidden',t=>{
  const f=fixture(t),work=f.repo.createTask(f.slug,{title:'任务原记录',state:'blocked',assignee:f.employee.id}),a=f.execution({type:'task.execute',taskId:work.id,payload:{conversationId:null}});
  assert.deepEqual(f.service.resolve(f.slug,a.eventId,f.context).item.target,{kind:'task',id:work.id,employeeId:f.employee.id,actionId:a.actionId});
  f.audit('task.state_changed',{taskId:work.id,to:'blocked'});f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.employee.id);
  assert.deepEqual(f.list({},{actorUserId:f.member.user_id}).items,[]);
});

test('legacy employee-name task assignees and duplicate private names cannot leak through list or resolve',async t=>{
  const f=fixture(t),privateEmployee=f.repo.createEmployee(f.slug,{name:'Private legacy assignee',runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id});
  f.repo.createEmployee(f.slug,{name:privateEmployee.name,runtime:'Codex',visibility:'workspace',ownerUserId:f.owner.user_id});
  const management=createManagementService(f.repo),member={actorUserId:f.member.user_id,actorRole:'member',enforceEmployeeVisibility:true};
  const records=[privateEmployee.id,privateEmployee.name].map(assignee=>{
    const task=f.repo.createTask(f.slug,{title:'Private task title',state:'blocked',assignee});
    return {task,...f.audit('task.state_changed',{taskId:task.id,to:'blocked'})};
  });
  for(const {task,eventId} of records){
    assert(!management.tasks(f.slug,{},member).some(row=>row.id===task.id));
    assert.throws(()=>f.service.resolve(f.slug,eventId,member),{status:404,code:'MOBILE_NOTIFICATION_NOT_FOUND'});
    if(task.assignee===privateEmployee.id)assert.equal(f.service.resolve(f.slug,eventId,f.context).item.target.id,task.id);
    else assert.throws(()=>f.service.resolve(f.slug,eventId,f.context),{status:404});
    const response=await request(f.app,`/api/workspaces/${f.slug}/mobile/notifications/${eventId}`,{cookie:f.cookie(f.member)});
    assert.equal(response.status,404);assert(!response.bytes.includes(Buffer.from('Private task title')));
  }
  assert.deepEqual(f.list({},member).items,[]);
  const route=await request(f.app,`/api/workspaces/${f.slug}/mobile/notifications`,{cookie:f.cookie(f.member)});assert.equal(route.status,200);assert.deepEqual(route.json.items,[]);
  f.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(privateEmployee.id);
  assert.equal(f.list({},member).items.length,1);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(privateEmployee.id);
  assert.deepEqual(f.list({},member).items,[]);
  f.db.prepare("UPDATE employees SET status='deleted' WHERE id=?").run(privateEmployee.id);
  assert.deepEqual(f.list({},member).items,[]);assert.deepEqual(f.list().items,[]);
  for(const {eventId} of records)assert.throws(()=>f.service.resolve(f.slug,eventId,f.context),{status:404});
});

test('task reminders recheck the latest execution user, conversation employee and personal device binding',t=>{
  const f=fixture(t,{kind:'personal'}),task=f.repo.createTask(f.slug,{title:'Restricted linked execution',state:'review'}),member={actorUserId:f.member.user_id,actorRole:'member',enforceEmployeeVisibility:true};
  const management=createManagementService(f.repo),notice=f.audit('task.state_changed',{taskId:task.id,to:'review'}),run=f.execution({type:'task.execute',taskId:task.id,payload:{conversationId:null,userId:f.owner.user_id}});
  const assertHidden=()=>{
    assert(!management.tasks(f.slug,{},member).some(row=>row.id===task.id));
    assert(!f.list({},member).items.some(row=>row.id===notice.eventId));
    assert.throws(()=>f.service.resolve(f.slug,notice.eventId,member),{status:404});
  };
  assertHidden();assert.equal(f.service.resolve(f.slug,notice.eventId,f.context).item.target.id,task.id);
  const secret=f.repo.createEmployee(f.slug,{name:'Private linked employee',runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id}),chat=f.repo.createConversation(f.slug,{employeeId:secret.id});
  f.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify({conversationId:chat.id}),run.actionId);assertHidden();
  f.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(secret.id);
  assert.equal(f.service.resolve(f.slug,notice.eventId,member).item.target.id,task.id);
  f.repo.heartbeatDevice(f.slug,{deviceId:'private-task-pc'});f.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(f.owner.user_id,'private-task-pc');
  f.db.prepare('UPDATE employees SET target_device_id=? WHERE id=?').run('private-task-pc',secret.id);assertHidden();
  f.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(f.member.user_id,'private-task-pc');
  assert.equal(f.service.resolve(f.slug,notice.eventId,member).item.target.id,task.id);
});

test('task-only execution targets obey current ID/name assignees and latest execution visibility',t=>{
  const f=fixture(t),privateEmployee=f.repo.createEmployee(f.slug,{name:'Hidden task owner',runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id}),member={actorUserId:f.member.user_id};
  for(const assignee of [privateEmployee.id,privateEmployee.name]){
    const task=f.repo.createTask(f.slug,{title:'Private execution target',state:'completed',assignee}),run=f.execution({type:'task.execute',taskId:task.id,payload:{conversationId:null}});
    assert(!f.list({},member).items.some(row=>row.id===run.eventId));
    assert.throws(()=>f.service.resolve(f.slug,run.eventId,member),{status:404});
    if(assignee===privateEmployee.id)assert.equal(f.service.resolve(f.slug,run.eventId,f.context).item.target.id,task.id);
    else assert.throws(()=>f.service.resolve(f.slug,run.eventId,f.context),{status:404});
  }
  const task=f.repo.createTask(f.slug,{title:'Task reassigned after original run',state:'completed'}),original=f.execution({type:'task.execute',taskId:task.id,payload:{conversationId:null}});
  assert.equal(f.service.resolve(f.slug,original.eventId,member).item.target.id,task.id);
  const latest=f.execution({type:'task.execute',taskId:task.id,payload:{employeeId:privateEmployee.id,conversationId:null}});
  f.db.prepare('UPDATE a2a_actions SET created_at=? WHERE id=?').run('2026-10-17T12:00:00Z',latest.actionId);
  assert.throws(()=>f.service.resolve(f.slug,original.eventId,member),{status:404});
});

test('task visibility uses thin scalar reads and keeps unrelated same-name workspace employees isolated',t=>{
  const f=fixture(t),other=f.auth.createWorkspace(f.owner.user_id,{slug:'task-assignee-other',name:'Other',kind:'team'}).workspace;
  const human=f.repo.createMember(f.slug,{name:'Same name elsewhere',email:'same-name-human@fixture.test'});
  f.repo.createEmployee(other.slug,{name:human.id,runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id});
  const task=f.repo.createTask(f.slug,{title:'Visible task',state:'blocked',assignee:human.id}),notice=f.audit('task.state_changed',{taskId:task.id,to:'blocked'});
  f.execution({type:'task.execute',taskId:task.id,payload:{conversationId:null,prompt:'private content '.repeat(100000)},result:{processExit:exitProof(),output:'private result '.repeat(100000)}});
  for(const name of ['listTasks','listEmployees','getTask','getA2AAction','getConversation','listNotifications'])f.repo[name]=()=>{throw new Error('Full task/action hydration forbidden');};
  const member={actorUserId:f.member.user_id};
  assert.equal(f.service.resolve(f.slug,notice.eventId,member).item.target.id,task.id);
  const feed=f.list({},member);assert(feed.items.some(row=>row.id===notice.eventId));assert(Buffer.byteLength(JSON.stringify(feed))<4000);
});

test('real employee hard deletion cannot reopen private unexecuted ID/name tasks, even after an alias is reused',async t=>{
  const f=fixture(t),privateEmployee=f.repo.createEmployee(f.slug,{name:'Deleted Legacy Employee',runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id});
  f.repo.createMember(f.slug,{name:privateEmployee.name,email:'same-alias-human@fixture.test'});
  const records=[privateEmployee.id,privateEmployee.name,privateEmployee.name.toLowerCase()].map(assignee=>{
    const task=f.repo.createTask(f.slug,{title:'Private unexecuted task',state:'planned',assignee});
    f.repo.transitionTask(task.id,'blocked');
    const eventId=f.db.prepare("SELECT id FROM audit_events WHERE workspace_id=? AND action='task.state_changed' AND json_extract(payload_json,'$.taskId')=?").get(f.ws.id,task.id).id;
    return {task,eventId};
  });
  const member={actorUserId:f.member.user_id},path=`/api/workspaces/${f.slug}/mobile/notifications`;
  assert.deepEqual(f.list({},member).items,[]);assert.equal(f.list().items.length,1);
  const deleted=f.repo.deleteEmployee(privateEmployee.id);assert.equal(deleted.deleted,true);assert.equal(f.db.prepare('SELECT id FROM employees WHERE id=?').get(privateEmployee.id),undefined);
  const audit=f.db.prepare("SELECT payload_json FROM audit_events WHERE workspace_id=? AND action='employee.deleted'").get(f.ws.id);assert.deepEqual(JSON.parse(audit.payload_json),{employeeId:privateEmployee.id,name:privateEmployee.name});
  const assertHidden=async()=>{
    assert.deepEqual(f.list({},member).items,[]);assert.deepEqual(f.list().items,[]);
    for(const {eventId} of records){
      assert.throws(()=>f.service.resolve(f.slug,eventId,member),{status:404,code:'MOBILE_NOTIFICATION_NOT_FOUND'});
      const response=await request(f.app,`${path}/${eventId}`,{cookie:f.cookie(f.member)});assert.equal(response.status,404);assert(!response.bytes.includes(Buffer.from('Private unexecuted task')));
    }
    const list=await request(f.app,path,{cookie:f.cookie(f.member)});assert.equal(list.status,200);assert.deepEqual(list.json.items,[]);
  };
  await assertHidden();
  f.repo.createEmployee(f.slug,{name:privateEmployee.name,runtime:'Codex',visibility:'workspace',ownerUserId:f.owner.user_id});await assertHidden();
  assert.deepEqual(records.map(({task})=>({...f.db.prepare('SELECT title,assignee,state FROM tasks WHERE id=?').get(task.id)})),records.map(({task})=>({title:task.title,assignee:task.assignee,state:'blocked'})));
});

test('real force removal followed by purge and direct purge keep retained assignment aliases unavailable',t=>{
  const f=fixture(t),member={actorUserId:f.member.user_id};
  for(const forceFirst of [false,true]){
    const employee=f.repo.createEmployee(f.slug,{name:`Purged private employee ${forceFirst}`,runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id});
    const notices=[employee.id,employee.name].map(assignee=>{const task=f.repo.createTask(f.slug,{title:'Purged private task',state:'blocked',assignee});return f.audit('task.state_changed',{taskId:task.id,to:'blocked'});});
    if(forceFirst){f.repo.deleteEmployee(employee.id,{force:true});assert.equal(f.db.prepare('SELECT status FROM employees WHERE id=?').get(employee.id).status,'deleted');}
    f.repo.deleteEmployee(employee.id,{force:true,purge:true});assert.equal(f.db.prepare('SELECT id FROM employees WHERE id=?').get(employee.id),undefined);
    const audit=f.db.prepare("SELECT payload_json FROM audit_events WHERE workspace_id=? AND action='employee.purged' AND json_extract(payload_json,'$.employeeId')=?").get(f.ws.id,employee.id);assert.equal(JSON.parse(audit.payload_json).name,employee.name);
    for(const {eventId} of notices)assert.throws(()=>f.service.resolve(f.slug,eventId,member),{status:404});
  }
  assert.deepEqual(f.list({},member).items,[]);
});

test('unassigned tasks and actual workspace human members remain visible; unresolvable owner text stays private',t=>{
  const f=fixture(t),human=f.repo.createMember(f.slug,{name:'Workspace human',email:'workspace-human@fixture.test'}),actor={actorUserId:f.member.user_id};
  const visible=[null,'notice-member',f.member.user_id,human.id,f.employee.id];
  const add=assignee=>{const task=f.repo.createTask(f.slug,{title:'Human or unassigned task',state:'blocked',assignee});return {task,...f.audit('task.state_changed',{taskId:task.id,to:'blocked'})};};
  const known=visible.map(add),unknown=['employee_missing_historical','Unmapped historical owner','Member','NOTICE-MEMBER@FIXTURE.TEST',human.name,human.email].map(add);
  assert.equal(f.list({limit:50},actor).items.length,known.length);
  for(const {task,eventId} of known)assert.equal(f.service.resolve(f.slug,eventId,actor).item.target.id,task.id);
  for(const {eventId} of unknown){assert.throws(()=>f.service.resolve(f.slug,eventId,actor),{status:404});assert.throws(()=>f.service.resolve(f.slug,eventId,f.context),{status:404});}
  f.repo.updateTask(unknown[0].task.id,{assignee:human.id});assert.equal(f.service.resolve(f.slug,unknown[0].eventId,actor).item.target.id,unknown[0].task.id);
  f.repo.updateTask(unknown[1].task.id,{assignee:null});assert.equal(f.service.resolve(f.slug,unknown[1].eventId,actor).item.target.id,unknown[1].task.id);
  f.repo.deleteMember(human.id);assert.throws(()=>f.service.resolve(f.slug,unknown[0].eventId,actor),{status:404});
});

test('deleted employee alias veto is workspace-scoped and does not hide a real human in another workspace',t=>{
  const f=fixture(t),other=f.auth.createWorkspace(f.owner.user_id,{slug:'deleted-assignee-other',name:'Other',kind:'team'}).workspace;
  const human=f.repo.createMember(f.slug,{name:'Local human name',email:'local-human@fixture.test'}),employee=f.repo.createEmployee(other.slug,{name:human.id,runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id});f.repo.deleteEmployee(employee.id);
  const task=f.repo.createTask(f.slug,{title:'Local human work',state:'blocked',assignee:human.id}),notice=f.audit('task.state_changed',{taskId:task.id,to:'blocked'});
  assert.equal(f.service.resolve(f.slug,notice.eventId,{actorUserId:f.member.user_id}).item.target.id,task.id);
});

test('real private employee rename and hard deletion cannot authorize legacy names through current member names, emails or new employees',async t=>{
  const f=fixture(t),human=f.repo.createMember(f.slug,{name:'Initial private alias',email:'initial-private-alias@fixture.test'}),actor={actorUserId:f.member.user_id},path=`/api/workspaces/${f.slug}/mobile/notifications`;
  for(const [index,alias] of [human.name,human.email,'Reused employee display name'].entries()){
    const employee=f.repo.createEmployee(f.slug,{name:alias,runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id}),task=f.repo.createTask(f.slug,{title:'PRIVATE_RENAMED_TITLE',state:'planned',assignee:alias});
    f.repo.transitionTask(task.id,'blocked');
    const eventId=f.db.prepare("SELECT id FROM audit_events WHERE workspace_id=? AND action='task.state_changed' AND json_extract(payload_json,'$.taskId')=?").get(f.ws.id,task.id).id;
    const hidden=async()=>{
      assert(!f.list({},actor).items.some(item=>item.id===eventId));assert.throws(()=>f.service.resolve(f.slug,eventId,actor),{status:404});
      const response=await request(f.app,`${path}/${eventId}`,{cookie:f.cookie(f.member)});assert.equal(response.status,404);assert(!response.bytes.includes(Buffer.from(task.title)));
    };
    await hidden();f.repo.updateEmployee(employee.id,{name:`Renamed private employee ${index}`});await hidden();f.repo.deleteEmployee(employee.id);await hidden();
    if(index===2){f.repo.createMember(f.slug,{name:alias,email:'reused-display-name@fixture.test'});f.repo.createEmployee(f.slug,{name:alias,runtime:'Codex',visibility:'workspace',ownerUserId:f.owner.user_id});await hidden();}
    assert.equal(f.db.prepare('SELECT assignee FROM tasks WHERE id=?').get(task.id).assignee,alias);
  }
  const response=await request(f.app,path,{cookie:f.cookie(f.member)});assert.equal(response.status,200);assert.deepEqual(response.json.items,[]);
});

test('known current and deleted employee-name conflicts veto even a canonical member ID match',t=>{
  const f=fixture(t),human=f.repo.createMember(f.slug,{name:'Human ID owner',email:'human-id-owner@fixture.test'}),employee=f.repo.createEmployee(f.slug,{name:human.id,runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id}),task=f.repo.createTask(f.slug,{title:'Known ambiguous assignment',state:'blocked',assignee:human.id}),notice=f.audit('task.state_changed',{taskId:task.id,to:'blocked'}),actor={actorUserId:f.member.user_id};
  assert.throws(()=>f.service.resolve(f.slug,notice.eventId,actor),{status:404});
  f.repo.deleteEmployee(employee.id);assert.throws(()=>f.service.resolve(f.slug,notice.eventId,actor),{status:404});
  assert(!f.list({},actor).items.some(item=>item.id===notice.eventId));
});

test('superseded action audit and malformed/mismatched original event do not resolve',t=>{
  const f=fixture(t),a=f.execution();f.db.prepare("UPDATE a2a_actions SET status='failed' WHERE id=?").run(a.actionId);assert.throws(()=>f.service.resolve(f.slug,a.eventId,f.context),{status:404});
  const good=f.execution(),event=f.audit('a2a.action.failed',{actionId:good.actionId});assert.throws(()=>f.service.resolve(f.slug,event.eventId,f.context),{status:404});
  f.db.prepare("UPDATE audit_events SET payload_json='{broken' WHERE id=?").run(good.eventId);assert.throws(()=>f.service.resolve(f.slug,good.eventId,f.context),{status:404});
});

test('actual mobile route parses baseline booleans and bounded incremental queries without historic alert replay',async t=>{
  const f=fixture(t);f.execution();const path=`/api/workspaces/${f.slug}/mobile/notifications`,cookie=f.cookie(f.owner);
  for(const baseline of ['1','true']){const response=await request(f.app,`${path}?baseline=${baseline}`,{cookie});assert.equal(response.status,200);assert.deepEqual(response.json.items,[]);assert(response.json.nextCursor);assert.equal(response.json.accountId,f.owner.user_id);assert.equal(response.headers['cache-control'],'no-store');assert.match(response.headers.vary,/Cookie/);}
  for(const baseline of ['0','false']){const response=await request(f.app,`${path}?baseline=${baseline}`,{cookie});assert.equal(response.status,200);assert.equal(response.json.items.length,1);}
  const base=(await request(f.app,path+'?baseline=true',{cookie})).json,a=f.execution(),b=f.execution();
  const first=await request(f.app,`${path}?cursor=${encodeURIComponent(base.nextCursor)}&limit=1`,{cookie});assert.equal(first.status,200);assert.equal(first.json.items[0].id,a.eventId);assert.equal(first.json.hasMore,true);
  const second=await request(f.app,`${path}?cursor=${encodeURIComponent(first.json.nextCursor)}&limit=1`,{cookie});assert.equal(second.json.items[0].id,b.eventId);assert.equal(second.json.hasMore,false);
  for(const query of ['baseline=yes','baseline=true&cursor=','limit=51','limit=0','limit=1.5','baseline=true&baseline=false','actorUserId=spoof','cursor=one&cursor=two']){const invalid=await request(f.app,path+'?'+query,{cookie});assert.equal(invalid.status,400,query);assert(invalid.json.code.startsWith('MOBILE_NOTIFICATION_'));}
});

test('actual resolve route reauthorizes private targets and rejects stale owner caches after account/permission changes',async t=>{
  const f=fixture(t),a=f.execution(),path=`/api/workspaces/${f.slug}/mobile/notifications`,url=`${path}/${a.eventId}`;
  const owner=await request(f.app,path,{cookie:f.cookie(f.owner)});assert.equal(owner.status,200);
  const resolved=await request(f.app,url,{cookie:f.cookie(f.member),headers:{'x-user-id':f.owner.user_id}});assert.equal(resolved.status,200);assert.equal(resolved.json.accountId,f.member.user_id);assert.equal(resolved.json.item.target.id,f.chat.id);assert.equal(resolved.headers['cache-control'],'no-store');
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.employee.id);
  const hidden=await request(f.app,path,{cookie:f.cookie(f.member),headers:{'if-none-match':owner.headers.etag,'x-workspace-role':'owner'}});assert.equal(hidden.status,200);assert.deepEqual(hidden.json.items,[]);assert.equal(hidden.json.accountId,f.member.user_id);assert.notEqual(hidden.json.nextCursor,owner.json.nextCursor);
  assert.equal((await request(f.app,url,{cookie:f.cookie(f.member),headers:{'if-none-match':resolved.headers.etag}})).status,404);
  assert.equal((await request(f.app,url)).status,401);assert.equal((await request(f.app,url,{cookie:f.cookie(f.outsider)})).status,403);
  f.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(f.ws.id,f.owner.user_id);assert.equal((await request(f.app,url,{cookie:f.cookie(f.owner),headers:{'if-none-match':resolved.headers.etag}})).status,403);
});

test('actual route rejects a cursor from another member/workspace and resolve cannot cross workspaces',async t=>{
  const f=fixture(t),a=f.execution(),path=`/api/workspaces/${f.slug}/mobile/notifications`,owner=await request(f.app,path,{cookie:f.cookie(f.owner)});
  const switched=await request(f.app,`${path}?cursor=${encodeURIComponent(owner.json.nextCursor)}`,{cookie:f.cookie(f.member)});assert.equal(switched.status,409);assert.equal(switched.json.code,'MOBILE_NOTIFICATION_CURSOR_SCOPE');
  const other=f.auth.createWorkspace(f.owner.user_id,{slug:'notice-route-other',name:'Other',kind:'team'}).workspace;
  const crossed=await request(f.app,`/api/workspaces/${other.slug}/mobile/notifications?cursor=${encodeURIComponent(owner.json.nextCursor)}`,{cookie:f.cookie(f.owner)});assert.equal(crossed.status,409);
  assert.equal((await request(f.app,`/api/workspaces/${other.slug}/mobile/notifications/${a.eventId}`,{cookie:f.cookie(f.owner)})).status,404);
});
