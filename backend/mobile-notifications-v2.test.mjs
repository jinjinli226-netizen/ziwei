import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from './app.mjs';

function request(app,url,{cookie='',method='GET',body}={}){
  const socket=new Duplex({read(){},write(_data,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],input=body===undefined?null:Buffer.from(JSON.stringify(body));req.method=method;req.url=url;req.headers={host:'selfhost.fixture',cookie,...(input?{'content-type':'application/json','content-length':String(input.length)}:{})};
  const result=new Promise((resolve,reject)=>{res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();return true;};res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.getHeaders(),bytes,json:bytes.length?JSON.parse(bytes.toString()):null});res.emit('finish');socket.destroy();return res;};req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));if(input)req.push(input);req.push(null);});
  return {req,res,result,cancel:()=>{req.emit('aborted');res.emit('close');socket.destroy();}};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{kind='team'}={}){
  let time=Date.now();const app=createApp({memory:true,requireAuth:true,enableScheduler:false,mobileNotificationsV2:{now:()=>time}}),repo=app.locals.repo,db=repo.db,auth=app.locals.auth,v2=app.locals.mobileNotificationsV2;
  t.after(()=>db.close());const owner=auth.setup({email:'selfhost-owner@fixture.test',password:'selfhost-fixture-only-password'}),member=auth.register({email:'selfhost-member@fixture.test',password:'selfhost-fixture-only-password'}),outsider=auth.register({email:'selfhost-outside@fixture.test',password:'selfhost-fixture-only-password'}),slug='selfhost';auth.createWorkspace(owner.user_id,{slug,name:'Selfhost',kind});const ws=repo.getWorkspace(slug);
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('selfhost-member',ws.id,member.user_id,'Member','selfhost-member@fixture.test','member',new Date().toISOString());
  const employee=repo.createEmployee(slug,{name:'运营员工🐳',runtime:'Codex',ownerUserId:owner.user_id}),chat=repo.createConversation(slug,{employeeId:employee.id}),cookie=who=>who?`ziwei_session=${who.session.token}`:'';
  const call=(suffix='',who=owner)=>request(app,`/api/workspaces/${slug}/mobile/notifications-v2${suffix}`,{cookie:cookie(who)}).result;
  async function baseline(who=owner){const value=await call('?baseline=1',who);assert.equal(value.status,200);return value.json.nextCursor;}
  function message(content='完成了，见 https://example.test/result\n第二行🐳',extra={}){const value=repo.addConversationMessage(chat.id,{role:'assistant',dispatch:false,content,...extra});time=Math.max(time,Date.now());const event=db.prepare("SELECT id FROM audit_events WHERE action='conversation.message.created' AND json_extract(payload_json,'$.messageId')=?").get(value.id);return {...value,eventId:event.id};}
  function wake(payload={}){app.locals.realtime.publish({workspaceSlug:slug,...payload});}
  function pending(cursor,who=owner,timeout=25){return request(app,`/api/workspaces/${slug}/mobile/notifications-v2/wait?cursor=${cursor}&timeout=${timeout}`,{cookie:cookie(who)});}
  function terminal({status='succeeded',conversationId=chat.id,taskId=null,payload={},result}={}){
    const actionId=`action_${crypto.randomUUID()}`,eventId=`audit_${crypto.randomUUID()}`,at=new Date().toISOString(),body=JSON.stringify({actionId,type:conversationId?'conversation.execute':'task.execute'}),action=`a2a.action.${status}`;
    db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,task_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(actionId,ws.id,'fixture',taskId,conversationId?'conversation.execute':'task.execute',JSON.stringify({employeeId:employee.id,conversationId,userId:owner.user_id,...payload}),actionId,status,at,at,at,JSON.stringify(result||{processExit:{launched:true,rootPid:123,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,rootExitCode:status==='succeeded'?0:1,hostExitCode:status==='succeeded'?0:1}}));
    db.prepare('INSERT INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,ws.id,'fixture',action,body,at);db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(`notice_${eventId}`,ws.id,eventId,'fixture',action,body,at);time=Math.max(time,Date.now());return {actionId,eventId};
  }
  function link(messageId,actionId){const row=db.prepare("SELECT id,payload_json FROM audit_events WHERE action='conversation.message.created' AND json_extract(payload_json,'$.messageId')=?").get(messageId);db.prepare('UPDATE audit_events SET payload_json=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.payload_json),actionId}),row.id);}
  return {app,repo,db,auth,v2,owner,member,outsider,slug,ws,employee,chat,cookie,call,baseline,message,wake,pending,terminal,link,advance:ms=>{time+=ms;},sync:()=>{time=Math.max(time,Date.now());}};
}

test('v2 is first-party only with no push schema/provider initialization; baseline and old v1 remain distinct',async t=>{
  const f=fixture(t);assert.equal(f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'mobile_push_%'").get().n,0);assert.equal(f.app.locals.mobilePush,undefined);
  const cursor=await f.baseline();const base=(await f.call('?baseline=1')).json;assert.equal(base.schemaVersion,2);assert.equal(base.cursor,base.nextCursor);assert.equal(base.historyWindow,true);assert.deepEqual(base.items,[]);
  const old=await request(f.app,`/api/workspaces/${f.slug}/mobile/notifications?baseline=1`,{cookie:f.cookie(f.owner)}).result;assert.equal(old.json.schemaVersion,1);
  assert.equal((await f.call(`?cursor=${old.json.nextCursor}`)).status,400);assert.equal((await request(f.app,`/api/workspaces/${f.slug}/mobile/notifications?cursor=${cursor}`,{cookie:f.cookie(f.owner)}).result).status,400);
});

test('actual employee name and plain message content preserve URLs/newlines/emoji and exact original target',async t=>{
  const f=fixture(t),cursor=await f.baseline(),message=f.message(),page=await f.call(`?cursor=${cursor}`);assert.equal(page.status,200);assert.equal(page.headers['cache-control'],'no-store');assert.match(page.headers.vary,/Cookie/);
  const item=page.json.items[0];assert.equal(item.kind,'message.received');assert.equal(item.title,'运营员工🐳');assert.equal(item.summary,message.content);assert.equal(item.executionState,'not_applicable');assert.deepEqual(item.target,{kind:'conversation',id:f.chat.id,employeeId:f.employee.id,messageId:message.id});
  const first=await f.call(`/items/${message.eventId}`),again=await f.call(`/items/${message.eventId}`);assert.deepEqual(again.json,first.json);assert.equal(first.json.accountId,f.owner.user_id);
  assert.deepEqual((await f.call(`?cursor=${page.json.nextCursor}`)).json.items,[]);
});

test('legal employee line controls cannot poison Native/Web titles while message body line breaks and URLs stay exact',async t=>{
  const f=fixture(t),content='正文保留换行\nhttps://example.test/result?q=🐳';
  for(const separator of ['\r','\n','\t','\u2028','\u2029']){
    f.repo.updateEmployee(f.employee.id,{name:`运营${separator}员工🐳`});const cursor=await f.baseline(),message=f.message(content),page=await f.call(`?cursor=${cursor}`);
    assert.equal(page.status,200);assert.equal(page.json.items.length,1);const item=page.json.items[0];assert.equal(item.title,'运营 员工🐳');assert.equal(item.summary,content);assert(!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(item.title));
    const fresh=await f.call(`/items/${message.eventId}`);assert.equal(fresh.status,200);assert.equal(fresh.json.item.title,item.title);assert.equal(fresh.json.item.summary,content);
  }
  f.repo.updateEmployee(f.employee.id,{name:'🐳'.repeat(100)+'\n尾'});const cursor=await f.baseline();f.message(content);const item=(await f.call(`?cursor=${cursor}`)).json.items[0];assert(Buffer.byteLength(item.title)<=160);assert(!item.title.includes('�'));
});

test('JSON byte budget and Unicode truncation bound real text without HTML or inline image bodies',async t=>{
  const f=fixture(t),cursor=await f.baseline();f.db.prepare('UPDATE employees SET name=? WHERE id=?').run('🐳'.repeat(100),f.employee.id);
  for(let i=0;i<50;i++)f.message('<b>正文</b> 1 < 2 https://example.test/x\n'+('🐳\\\n'.repeat(2000))+' data:image/png;base64,PRIVATE_IMAGE_BYTES');
  const page=await f.call(`?cursor=${cursor}&limit=50`);assert.equal(page.status,200);assert(page.bytes.length<=65536);assert(page.json.items.length>0);assert.equal(page.json.hasMore,true);assert.notEqual(page.json.nextCursor,cursor);
  for(const item of page.json.items){assert(Buffer.byteLength(item.title)<=160);assert(Buffer.byteLength(item.summary)<=1024);assert(!item.summary.includes('�'));assert(item.summary.startsWith('正文 1 < 2 https://example.test/x\n'));assert(!item.summary.includes('<b>'));assert(!item.summary.includes('PRIVATE_IMAGE_BYTES'));}
});

test('human assistant roles, read messages and same-action terminal/report duplicates are filtered without consuming click resolve',async t=>{
  const f=fixture(t),cursor=await f.baseline();f.message('Human-authored',{actorUserId:f.member.user_id});const run=f.terminal(),reply=f.message('真实员工回复');f.link(reply.id,run.actionId);
  const page=(await f.call(`?cursor=${cursor}`)).json;assert.deepEqual(page.items.map(item=>item.id),[reply.eventId]);
  f.db.prepare('INSERT INTO conversation_reads(workspace_id,conversation_id,user_id,last_message_id,last_message_rowid,last_read_at) VALUES(?,?,?,?,?,?)').run(f.ws.id,f.chat.id,f.owner.user_id,reply.id,f.db.prepare('SELECT rowid AS n FROM conversation_messages WHERE id=?').get(reply.id).n,new Date().toISOString());
  const stats=f.repo.notificationStats(f.slug);assert.deepEqual((await f.call(`?cursor=${cursor}`)).json.items,[]);assert.equal((await f.call(`/items/${reply.eventId}`)).status,200);assert.deepEqual(f.repo.notificationStats(f.slug),stats);
});

test('original terminal proof and private task binding stay authoritative in v2',async t=>{
  const f=fixture(t),cursor=await f.baseline(),task=f.repo.createTask(f.slug,{title:'原任务'}),done=f.terminal({conversationId:null,taskId:task.id}),uncertain=f.terminal({result:{code:'EXECUTION_UNCERTAIN',processExit:{launched:false}}});
  const page=(await f.call(`?cursor=${cursor}`)).json;assert.equal(page.items.find(item=>item.id===done.eventId).kind,'execution.completed');assert.equal(page.items.find(item=>item.id===uncertain.eventId).kind,'attention.required');
  const privateEmployee=f.repo.createEmployee(f.slug,{name:'Private',runtime:'Codex',visibility:'personal',ownerUserId:f.owner.user_id}),hidden=f.repo.createTask(f.slug,{title:'私有任务',assignee:privateEmployee.id}),blocked=f.terminal({conversationId:null,taskId:hidden.id,payload:{userId:f.member.user_id}});
  assert.equal((await f.call(`/items/${blocked.eventId}`,f.member)).status,404);
});

test('every page and click checks current session, membership, employee and original message association',async t=>{
  const f=fixture(t),cursor=await f.baseline(f.member),message=f.message();assert.equal((await f.call(`?cursor=${cursor}`,f.member)).json.items.length,1);assert.equal((await f.call('',null)).status,401);assert.equal((await f.call('',f.outsider)).status,403);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.employee.id);assert.equal((await f.call(`/items/${message.eventId}`,f.member)).status,404);assert.deepEqual((await f.call(`?cursor=${cursor}`,f.member)).json.items,[]);
  f.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(f.employee.id);f.db.prepare('DELETE FROM members WHERE user_id=? AND workspace_id=?').run(f.member.user_id,f.ws.id);assert.equal((await f.call(`/items/${message.eventId}`,f.member)).status,403);
  f.db.prepare('DELETE FROM conversation_messages WHERE id=?').run(message.id);assert.equal((await f.call(`/items/${message.eventId}`)).status,404);
});

test('historical, malformed and future event/notice times never replay; oversized original payloads are not hydrated',async t=>{
  const f=fixture(t),cursor=await f.baseline();for(const column of ['audit_events','notifications'])for(const at of ['2000-01-01T00:00:00Z','not-a-date','2999-01-01T00:00:00Z']){const message=f.message('do not notify');f.db.prepare(`UPDATE ${column} SET created_at=? WHERE ${column==='audit_events'?'id':'event_id'}=?`).run(at,message.eventId);}
  const current=f.message('当下正文');f.db.prepare("UPDATE audit_events SET payload_json=json_set(payload_json,'$.unused',?) WHERE id=?").run('PRIVATE_FULL_PAYLOAD'.repeat(100000),current.eventId);
  f.repo.getConversation=()=>{throw new Error('full transcript forbidden');};f.repo.getA2AAction=()=>{throw new Error('full action forbidden');};const page=(await f.call(`?cursor=${cursor}`)).json;assert.deepEqual(page.items.map(item=>item.id),[current.eventId]);assert(!JSON.stringify(page).includes('PRIVATE_FULL_PAYLOAD'));
});

test('enabling skips even recent original audits backfilled after baseline while later offline messages remain eligible',async t=>{
  const f=fixture(t),old=f.message('开启前旧消息'),notice=f.db.prepare('SELECT * FROM notifications WHERE event_id=?').get(old.eventId);notice.created_at=new Date(Date.parse(notice.created_at)-2000).toISOString();f.db.prepare('UPDATE audit_events SET created_at=? WHERE id=?').run(notice.created_at,old.eventId);f.db.prepare('DELETE FROM notifications WHERE id=?').run(notice.id);const cursor=await f.baseline();
  f.db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(notice.id,notice.workspace_id,notice.event_id,notice.actor,notice.action,notice.payload_json,notice.created_at);
  assert.deepEqual((await f.call(`?cursor=${cursor}`)).json.items,[]);const genuine=f.message('开启后新消息');f.advance(3600000);const page=await f.call(`?cursor=${cursor}`);assert.deepEqual(page.json.items.map(item=>item.id),[genuine.eventId]);
});

test('same-millisecond pre-baseline audits cannot become new alerts by late notification backfill',async t=>{
  const f=fixture(t),old=f.message('同毫秒旧消息'),notice=f.db.prepare('SELECT * FROM notifications WHERE event_id=?').get(old.eventId);f.db.prepare('DELETE FROM notifications WHERE id=?').run(notice.id);const cursor=await f.baseline(),snapshot=JSON.parse(Buffer.from(cursor,'base64url').toString());
  const at=new Date(snapshot.b).toISOString();f.db.prepare('UPDATE audit_events SET created_at=? WHERE id=?').run(at,old.eventId);f.db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(notice.id,notice.workspace_id,notice.event_id,notice.actor,notice.action,notice.payload_json,at);
  assert.deepEqual((await f.call(`?cursor=${cursor}`)).json.items,[]);assert.equal((await f.call(`/items/${old.eventId}`)).status,200,'fresh authorized clicks are independent of activation');
  const current=f.message('新audit');assert.deepEqual((await f.call(`?cursor=${cursor}`)).json.items.map(item=>item.id),[current.eventId]);
});

test('group previews authorize every logical roster member without loading logs or accepting an HTTP bypass flag',async t=>{
  const f=fixture(t),partner=f.repo.createEmployee(f.slug,{name:'群伙伴',runtime:'Codex',ownerUserId:f.owner.user_id});
  function groupReply(change=()=>{}){
    const run=f.terminal(),message=f.message('群聊真实汇报');f.link(message.id,run.actionId);
    const saved=f.db.prepare('SELECT payload_json,result_json FROM a2a_actions WHERE id=?').get(run.actionId),payload={...JSON.parse(saved.payload_json),hermesBot:{employeeId:f.employee.id,workspace:f.slug,revision:1},nativeOperation:{schemaVersion:2,resource:'groups',operation:'step',input:{groupId:'room_selfhost'}}};
    const receipt={schemaVersion:2,employeeId:f.employee.id,revision:1,resource:'groups',operation:'read',status:'succeeded',data:{room:{room_id:'room_selfhost',members:[f.employee.id,partner.id].map(id=>({member_id:id,profile:id,target:{kind:'local',profile:id}}))},events:{events:[{body:'PRIVATE_GROUP_LOG'.repeat(100000)}]}}},result={...JSON.parse(saved.result_json),nativeOperation:receipt};
    change({payload,receipt,result});f.db.prepare('UPDATE a2a_actions SET payload_json=?,result_json=? WHERE id=?').run(JSON.stringify(payload),JSON.stringify(result),run.actionId);return {...run,message};
  }
  const good=groupReply(),fullAction=f.repo.getA2AAction;f.repo.getA2AAction=()=>{throw new Error('full group log forbidden');};assert.equal((await f.call(`/items/${good.message.eventId}`)).status,200);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(partner.id);assert.equal((await f.call(`/items/${good.message.eventId}`,f.member)).status,404);f.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(partner.id);
  for(const change of [
    ({receipt})=>{delete receipt.data.room;},
    ({receipt})=>{receipt.status='failed';receipt.data={};},
    ({receipt})=>{receipt.data.room.members[1].profile='physical-runtime-profile';},
    ({receipt})=>{receipt.data.room.members[1].target={kind:'remote',profile:partner.id};},
    ({receipt})=>{receipt.data.room.members[1].metadata='x'.repeat(40000);},
    ({payload})=>{payload.nativeOperation.extra='x'.repeat(40000);},
    ({result})=>{const native=result.nativeOperation;delete result.nativeOperation;let value=result;for(let i=0;i<9;i++)value=value.result={};value.nativeOperation=native;}
  ]){const bad=groupReply(change);assert.equal((await f.call(`/items/${bad.message.eventId}`)).status,404);}
  f.repo.getA2AAction=fullAction;const spoof=groupReply(({receipt})=>{receipt.data.room.members[1].profile='physical-runtime-profile';});
  for(const query of ['', '?view=mobile','?notificationScope=true','?view=mobile&notificationScope=true']){
    const response=await request(f.app,`/api/workspaces/${f.slug}/actions/${spoof.actionId}${query}`,{cookie:f.cookie(f.owner)}).result;assert([404,409].includes(response.status));
  }
});

test('bounded scans advance across hidden and orphan rows instead of sleeping or looping on one cursor',async t=>{
  const f=fixture(t),cursor=await f.baseline();for(let i=0;i<210;i++)f.db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(`orphan_${i}`,f.ws.id,`missing_${i}`,'fixture','unrelated','{}',new Date().toISOString());
  const first=(await f.call(`?cursor=${cursor}`)).json;assert.equal(first.items.length,0);assert.equal(first.hasMore,true);assert.notEqual(first.nextCursor,cursor);const waiting=await f.pending(first.nextCursor).result;assert.equal(waiting.status,200);assert.notEqual(waiting.json.nextCursor,first.nextCursor);assert.equal(waiting.json.hasMore,false);assert.equal(f.v2.activeWaits(),0);
});

test('wait subscribes before its first query, treats hub only as wake and resolves current durable source',async t=>{
  const f=fixture(t),cursor=await f.baseline(),hub=f.app.locals.realtime,subscribe=hub.subscribe.bind(hub);let message;
  hub.subscribe=(slug,listener)=>{const unsubscribe=subscribe(slug,listener);message=f.message('subscribe/read race');return unsubscribe;};const response=await f.pending(cursor).result;assert.equal(response.status,200);assert.equal(response.json.items[0].id,message.eventId);assert.equal(f.v2.activeWaits(),0);hub.subscribe=subscribe;
  const cursor2=response.json.nextCursor,pending=f.pending(cursor2);await turn();f.wake({payload:{secret:'RAW_HUB_PAYLOAD'}});await turn();assert.equal(f.v2.activeWaits(),1);f.message('fresh wake');const wake=await pending.result;assert.equal(wake.status,200);assert(!wake.bytes.includes(Buffer.from('RAW_HUB_PAYLOAD')));assert.equal(f.v2.activeWaits(),0);
});

test('wait rechecks logout and membership on wake or timeout, and normal request close does not disconnect it',async t=>{
  const f=fixture(t),cursor=await f.baseline(f.member),pending=f.pending(cursor,f.member,1);await turn();pending.req.emit('close');assert.equal(f.v2.activeWaits(),1);
  f.db.prepare('DELETE FROM local_sessions WHERE user_id=?').run(f.member.user_id);const response=await pending.result;assert.equal(response.status,401);assert.equal(f.v2.activeWaits(),0);
  const cursor2=await f.baseline(),p2=f.pending(cursor2);await turn();f.db.prepare('DELETE FROM members WHERE user_id=? AND workspace_id=?').run(f.owner.user_id,f.ws.id);f.wake();assert.equal((await p2.result).status,403);assert.equal(f.v2.activeWaits(),0);
});

test('abort, query errors and timeout release bounded wait quota; no database transaction crosses await',async t=>{
  const f=fixture(t),cursor=await f.baseline(),connections=[f.pending(cursor),f.pending(cursor),f.pending(cursor)];await turn();assert.equal(f.v2.activeWaits(),3);assert.equal(f.db.isTransaction,false);assert.equal((await f.pending(cursor).result).status,429);
  for(const connection of connections)connection.cancel();await turn();assert.equal(f.v2.activeWaits(),0);
  assert.equal((await f.call('/wait?cursor=bad!&timeout=1')).status,400);assert.equal(f.v2.activeWaits(),0);assert.equal((await f.call('/wait?timeout=1')).status,400);assert.equal((await f.call('/wait?cursor='+cursor+'&timeout=26')).status,400);
  const timeout=await f.pending(cursor,f.owner,1).result;assert.equal(timeout.status,200);assert.equal(timeout.json.nextCursor,cursor);assert.deepEqual(timeout.json.items,[]);assert.equal(f.v2.activeWaits(),0);
});
