// Real HTTP middleware and SQLite without a network listener or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from './app.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

async function request(app,url,{cookie='',headers={}}={}){
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[];
  req.method='GET';req.url=url;req.headers={host:'conversation-thread.fixture',cookie,...headers};
  try{return await new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,encoding));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.getHeaders(),bytes,json:()=>JSON.parse(bytes.toString())});res.emit('finish');return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));req.push(null);
  });}finally{socket.destroy();}
}
const stamp='2026-10-21T00:00:00.000Z',privateHistory='OLDER_ROWS_MUST_NOT_BE_HYDRATED_'.repeat(1500);
const exit={launched:true,rootPid:99,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0};
function fixture(t,{count=96}={}){
  const mcpToken=randomUUID(),slug='conversation-thread',app=createApp({memory:true,requireAuth:true,enableScheduler:false,mcpToken,mcpWorkspace:slug,mcpRole:'owner'}),repo=app.locals.repo,db=repo.db,auth=app.locals.auth;
  const owner=auth.setup({email:'thread-owner@fixture.test',password:'isolated-fixture-password'}),member=auth.register({email:'thread-member@fixture.test',password:'isolated-fixture-password'}),outsider=auth.register({email:'thread-outsider@fixture.test',password:'isolated-fixture-password'});
  auth.createWorkspace(owner.user_id,{slug,name:'Thread fixture',kind:'team'});auth.createWorkspace(owner.user_id,{slug:'thread-other',name:'Other fixture',kind:'team'});const ws=repo.getWorkspace(slug);
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('thread-member',ws.id,member.user_id,'Member','thread-member@fixture.test','member',stamp);
  repo.heartbeatDevice(slug,{deviceId:'thread-pc',runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}]}}});
  const bytes=Buffer.concat([rasterFixtures.png,Buffer.alloc(128*1024,61)]),image={name:'original.png',mimeType:'image/png',contentEncoding:'base64',content:bytes.toString('base64')},avatar='data:image/png;base64,'+bytes.toString('base64');
  const employee=repo.createEmployee(slug,{name:'Original employee',runtime:'Hermes',runtimeProfile:'default',targetDeviceId:'thread-pc',ownerUserId:owner.user_id,avatar});
  const conversation=repo.createConversation(slug,{employeeId:employee.id}),other=repo.createConversation(slug,{employeeId:employee.id});
  const insert=db.prepare('INSERT INTO conversation_messages(id,conversation_id,role,content,attachment_json,created_at,sender_user_id,forward_json) VALUES(?,?,?,?,?,?,?,?)');
  const ids=Array.from({length:count},(_,index)=>'convmsg_thread_'+String(index).padStart(3,'0'));
  for(const [index,id] of ids.entries())insert.run(id,conversation.id,index%2?'assistant':'user',index<60?privateHistory+index:'Original message '+index,JSON.stringify(index===0||index===count-1?[image]:[]),stamp,index%2?null:owner.user_id,null);
  insert.run('convmsg_other',other.id,'user','Other conversation private content','[]',stamp,owner.user_id,null);
  const insertAction=db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  function action({id='thread-original-action',status='failed',result={code:'EXECUTION_UNCERTAIN',executionState:'uncertain',processExit:{...exit,treeConfirmed:false,activeProcesses:1},output:privateHistory},payload={},workspaceId=ws.id,createdAt='2099-01-01T00:00:00.000Z'}={}){
    insertAction.run(id,workspaceId,'ziwei_user','conversation.execute',JSON.stringify({runtime:'Hermes',employeeId:employee.id,deviceId:'thread-pc',profile:'default',conversationId:conversation.id,messageId:ids.at(-1),prompt:privateHistory,hermesBot:{schemaVersion:1,workspace:slug,employeeId:employee.id,deviceId:'thread-pc',revision:1,controlEpoch:1,sourceProfile:'default'},...payload}),id,status,createdAt,createdAt,status==='acked'?null:createdAt,JSON.stringify(result),status==='failed'?'Original error':null);
    return id;
  }
  t.after(()=>db.close());
  return{app,repo,db,slug,ws,owner,member,outsider,employee,conversation,other,ids,image,avatar,bytes,insert,action,cookie:`ziwei_session=${owner.session.token}`,memberCookie:`ziwei_session=${member.session.token}`,outsiderCookie:`ziwei_session=${outsider.session.token}`,path:'/api/conversations/'+conversation.id};
}

test('thread starts with ten recent messages and SQL never hydrates older rows or inline image history',async t=>{
  const f=fixture(t),original=f.repo.getConversation(f.conversation.id),reads=[],prepare=f.db.prepare;
  f.db.prepare=function(sql,...rest){const statement=prepare.call(this,sql,...rest);if(/SELECT \* FROM conversation_messages WHERE conversation_id=/i.test(sql)){const all=statement.all;statement.all=function(...args){const rows=all.apply(this,args);reads.push({sql,rows:rows.length});return rows;};}return statement;};
  let response;try{response=await request(f.app,f.path+'?view=thread',{cookie:f.cookie});}finally{f.db.prepare=prepare;}
  assert.equal(response.status,200);const value=response.json();assert.equal(value.messages.length,10);assert.deepEqual(value.messages.map(message=>message.id),f.ids.slice(-10));assert.deepEqual(value.messagePage,{hasMore:true,beforeCursor:f.ids.at(-10),total:96});
  assert.equal(reads.length,1);assert.equal(reads[0].rows,11);assert.match(reads[0].sql,/LIMIT \?/);assert(!response.bytes.includes(Buffer.from('OLDER_ROWS_MUST_NOT_BE_HYDRATED')));assert(!response.bytes.includes(Buffer.from('data:image/')));
  assert.match(value.employee.avatar,/\/avatar\?v=[a-f0-9]{64}$/);assert.match(value.messages.at(-1).attachments[0].url,/\/messages\/convmsg_thread_095\/images\/0\?v=/);
  assert.equal(response.headers['cache-control'],'no-store');assert.match(response.headers.vary,/Cookie/);assert(response.bytes.length<original.messages.reduce((sum,message)=>sum+message.content.length,0)/100);
  assert.equal(f.repo.getConversation(f.conversation.id).messages[0].attachments[0].content,f.image.content);
  t.diagnostic(`Conversation JSON bytes: full=${Buffer.byteLength(JSON.stringify(original))}, thread=${response.bytes.length}`);
});

test('before pages use created_at and rowid ties without gaps, duplication or a moving tail',async t=>{
  const f=fixture(t,{count:35}),get=before=>request(f.app,f.path+'?view=thread'+(before?'&before='+before:''),{cookie:f.cookie});
  const first=(await get()).json();assert.deepEqual(first.messages.map(message=>message.id),f.ids.slice(25));
  f.insert.run('convmsg_new_tail',f.conversation.id,'assistant','New tail','[]',stamp,null,null);
  const pages=[first.messages];let page=first;
  while(page.messagePage.hasMore){page=(await get(page.messagePage.beforeCursor)).json();assert(page.messages.length<=10);pages.unshift(page.messages);}
  const combined=pages.flat().map(message=>message.id);assert.deepEqual(combined,f.ids);assert.equal(new Set(combined).size,35);assert(!combined.includes('convmsg_new_tail'));
  const empty=(await get(f.ids[0])).json();assert.deepEqual(empty.messages,[]);assert.deepEqual(empty.messagePage,{hasMore:false,beforeCursor:null,total:36});
});

test('limit validation and cursor scope fail explicitly without exposing another conversation',async t=>{
  const f=fixture(t,{count:96});
  for(const query of ['limit=0','limit=-1','limit=81','limit=1.5','limit=no','limit=','limit=10&limit=20','before=','before[]=convmsg_other','before=bad%20cursor'])assert.equal((await request(f.app,f.path+'?view=thread&'+query,{cookie:f.cookie})).status,400,query);
  for(const cursor of ['convmsg_other','convmsg_missing']){const response=await request(f.app,f.path+'?view=thread&before='+cursor,{cookie:f.cookie});assert.equal(response.status,404);assert.equal(response.json().code,'CONVERSATION_PAGE_CURSOR_NOT_FOUND');assert(!response.bytes.includes(Buffer.from('Other conversation private content')));}
  assert.equal((await request(f.app,f.path+'?view=thread&limit=80',{cookie:f.cookie})).json().messages.length,80);
  assert.equal((await request(f.app,f.path+'?view=thread&limit=1',{cookie:f.cookie})).json().messages.length,1);
});

test('membership, private employee and device identity checks precede cursor reads',async t=>{
  const f=fixture(t);assert.equal((await request(f.app,f.path+'?view=thread')).status,401);assert.equal((await request(f.app,f.path+'?view=thread&before=convmsg_other',{cookie:f.outsiderCookie})).status,403);
  assert.equal((await request(f.app,f.path+'?view=thread',{cookie:f.memberCookie})).status,200);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.employee.id);
  assert.equal((await request(f.app,f.path+'?view=thread&before=convmsg_other',{cookie:f.memberCookie,headers:{'x-workspace-role':'owner'}})).status,404);
  assert.equal((await request(f.app,f.path+'?view=thread',{cookie:f.cookie})).status,200);
  f.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(f.ws.id,f.owner.user_id);assert.equal((await request(f.app,f.path+'?view=thread',{cookie:f.cookie})).status,403);
});

test('current execution keeps exact unknown and terminal/last recovery evidence without reloading action history',async t=>{
  const f=fixture(t),id=f.action(),event=f.db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)');
  for(let index=0;index<60;index++)event.run('thread-event-'+String(index).padStart(3,'0'),id,index===20?'failed':'progress','Original stage '+index,JSON.stringify(index===20?{result:{processExit:exit,stopConfirmed:true,unknown:{retain:true}}}:{stage:'stage-'+index,detail:index===59?'last progress':privateHistory}),stamp);
  const before=f.repo.getA2AAction(id),read=f.repo.getA2AAction;let fullReads=0;f.repo.getA2AAction=function(...args){fullReads++;return read.apply(this,args);};
  const response=await request(f.app,f.path+'?view=thread',{cookie:f.cookie}),execution=response.json().execution;f.repo.getA2AAction=read;
  assert.equal(response.status,200);assert.equal(fullReads,0);assert.equal(execution.id,id);assert.equal(execution.status,'failed');assert.equal(execution.error,'Original error');assert.equal(execution.result.code,'EXECUTION_UNCERTAIN');assert.equal(execution.result.executionState,'uncertain');assert.deepEqual(execution.result.processExit,before.result.processExit);
  assert.deepEqual(execution.events.map(item=>item.id),['thread-event-020','thread-event-059']);assert.equal(execution.event_count,60);assert.deepEqual(execution.events[0].data,before.events[20].data);assert.equal(execution.events[1].data.stage,'stage-59');assert.equal(execution.payload.messageId,f.ids.at(-1));assert.equal(execution.payload.prompt,undefined);assert.equal(execution.result.output,undefined);
  assert.deepEqual(f.repo.getA2AAction(id),before);assert(!response.bytes.includes(Buffer.from('OLDER_ROWS_MUST_NOT_BE_HYDRATED')));
});

test('thread current action is bound to actual workspace and top-level conversation id',async t=>{
  const f=fixture(t);f.action({id:'real-current',status:'acked',result:{stage:'real running'}});
  f.action({id:'text-only-match',payload:{conversationId:f.other.id,prompt:'mentions '+f.conversation.id},createdAt:'2100-01-01T00:00:00Z'});
  f.action({id:'foreign-workspace-match',workspaceId:f.repo.getWorkspace('thread-other').id,createdAt:'2101-01-01T00:00:00Z'});
  const value=(await request(f.app,f.path+'?view=thread',{cookie:f.cookie})).json();assert.equal(value.execution.id,'real-current');assert.equal(value.execution.status,'acked');assert.equal(value.execution.completed_at,null);
});

test('default and mobile histories, message metadata and original model-history inputs remain unchanged',async t=>{
  const f=fixture(t),before=f.repo.getConversation(f.conversation.id),stored=f.db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? ORDER BY created_at,rowid').all(f.conversation.id);
  const thread=await request(f.app,f.path+'?view=thread',{cookie:f.cookie}),full=await request(f.app,f.path,{cookie:f.cookie}),mobile=await request(f.app,f.path+'?view=mobile',{cookie:f.cookie});
  assert.equal(thread.json().messages.length,10);assert.equal(full.json().messages.length,96);assert.equal(mobile.json().messages.length,96);assert.equal(full.json().messagePage,undefined);assert.equal(mobile.json().messagePage,undefined);
  assert.deepEqual(full.json(),before);assert.deepEqual(f.repo.getConversation(f.conversation.id),before);assert.deepEqual(f.db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? ORDER BY created_at,rowid').all(f.conversation.id),stored);
  assert.equal(full.json().messages.at(-1).attachments[0].content,f.image.content);assert.match(mobile.json().messages.at(-1).attachments[0].url,/\/images\/0\?v=/);
  assert.deepEqual((await request(f.app,f.path+'?view=thread&view=desktop&limit=1',{cookie:f.cookie})).json(),before);
  const added=f.repo.addConversationMessage(f.conversation.id,{content:'Retain recent canonical history',clientMessageId:'original-model-history'}),action=f.repo.getA2AAction(added.execution.id);
  assert.match(action.payload.prompt,/Original message 95/);assert.match(action.payload.prompt,/Retain recent canonical history/);assert(!action.payload.prompt.includes('messagePage'));
});

test('thread projects saved forwarded images and preserves original message metadata and authorized bytes',async t=>{
  const f=fixture(t,{count:2}),snapshot={schemaVersion:1,source:{conversationId:f.other.id,employeeName:'Original sender'},messages:[{sourceMessageId:'quoted-message',role:'assistant',sender:'Original sender',content:'Saved quote',attachments:[f.image],createdAt:stamp}]};
  f.db.prepare('UPDATE conversation_messages SET forward_json=? WHERE id=?').run(JSON.stringify(snapshot),f.ids.at(-1));
  const response=await request(f.app,f.path+'?view=thread',{cookie:f.cookie}),message=response.json().messages.at(-1),url=message.forward.messages[0].attachments[0].url;
  assert.match(url,/\/forwards\/0\/images\/0\?v=/);assert.equal(message.forward.messages[0].content,'Saved quote');assert.equal(message.role,'assistant');assert.equal(message.created_at,stamp);assert.equal(message.forward.messages[0].attachments[0].content,undefined);
  const image=await request(f.app,url,{cookie:f.cookie});assert.equal(image.status,200);assert.deepEqual(image.bytes,f.bytes);assert.equal(image.headers['content-type'],'image/png');
  assert.deepEqual(f.repo.getConversation(f.conversation.id).messages.at(-1).forward,snapshot);
});

test('group execution uses original member bindings and existing group authorization before thread projection',async t=>{
  const f=fixture(t,{count:2}),target=f.repo.createEmployee(f.slug,{name:'Group target',runtime:'Hermes',runtimeProfile:'default',targetDeviceId:'thread-pc',ownerUserId:f.owner.user_id}),groupId='thread-group';
  const room={room_id:groupId,members:[{member_id:f.employee.id,profile:f.employee.id},{member_id:target.id,profile:target.id}],authority_gateway_id:'authority',authority_epoch:1};
  const events={events:[{room_id:groupId,seq:1,event_id:'group-event-1',kind:'message.user',payload:{text:'Group content'}}],cursor:1,latest_seq:1,has_more:false,authority:{gateway_id:'authority',epoch:1}};
  f.action({id:'thread-group-action',status:'succeeded',payload:{nativeOperation:{schemaVersion:2,resource:'groups',operation:'read',input:{groupId},requestId:'group-read'}},result:{processExit:exit,nativeOperation:{schemaVersion:2,resource:'groups',operation:'read',employeeId:f.employee.id,revision:1,status:'succeeded',data:{room,events}}}});
  const good=await request(f.app,f.path+'?view=thread',{cookie:f.memberCookie});assert.equal(good.status,200);assert.equal(good.json().execution.result.nativeOperation.data.historyPointer.eventCount,1);assert.equal(good.json().execution.result.nativeOperation.data.events,undefined);assert.deepEqual(good.json().execution.result.nativeOperation.data.room,room);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(target.id);
  const denied=await request(f.app,f.path+'?view=thread',{cookie:f.memberCookie});assert.equal(denied.status,404);assert.equal(denied.json().code,'GROUP_MOBILE_SCOPE_REQUIRED');assert(!denied.bytes.includes(Buffer.from('Group content')));
});
