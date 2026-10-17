import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from './app.mjs';
import {createManagementService} from './management.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

// Real middleware in memory: no listening socket or temporary port.
async function request(app,url,{cookie='',method='GET',body,headers={}}={}) {
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}});
  const req=new IncomingMessage(socket),res=new ServerResponse(req),bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  req.method=method;req.url=url;req.headers={host:'chat-read.fixture',cookie,...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{}),...headers};
  const chunks=[];
  try{return await new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const raw=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.getHeaders(),bytes:raw,json:()=>JSON.parse(raw.toString())});res.emit('finish');return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled request')));if(bytes)req.push(bytes);req.push(null);
  });}finally{socket.destroy();}
}
function fixture(t) {
  const app=createApp({memory:true,requireAuth:true}),repo=app.locals.repo,auth=app.locals.auth;
  t.after(()=>repo.db.close());
  const owner=auth.setup({email:'chat-owner@fixture.test',password:'read-state-fixture-password'}),slug='chat-state';
  auth.createWorkspace(owner.user_id,{slug,name:'Chat state',kind:'team'});
  const ws=repo.getWorkspace(slug),member=auth.register({email:'chat-member@fixture.test',password:'read-state-fixture-password'}),outsider=auth.register({email:'chat-outsider@fixture.test',password:'read-state-fixture-password'});
  repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('chat-member',ws.id,member.user_id,'Member','chat-member@fixture.test','member',new Date().toISOString());
  const avatar='data:image/png;base64,'+Buffer.concat([rasterFixtures.png,Buffer.alloc(1024*1024)]).toString('base64');
  const employee=repo.createEmployee(slug,{name:'Public employee',runtime:'Codex',visibility:'workspace',ownerUserId:owner.user_id,avatar});
  const privateEmployee=repo.createEmployee(slug,{name:'Private employee',runtime:'Codex',visibility:'personal',ownerUserId:owner.user_id});
  const conversation=repo.createConversation(slug,{employeeId:employee.id}),privateChat=repo.createConversation(slug,{employeeId:privateEmployee.id});
  const send=(id,role,content,userId=owner.user_id)=>repo.addConversationMessage(id,{role,content,dispatch:false,actorUserId:userId});
  const first=send(conversation.id,'assistant','First answer'),second=send(conversation.id,'assistant','Second answer');
  send(privateChat.id,'assistant','Private answer');
  const cookies={owner:`ziwei_session=${owner.session.token}`,member:`ziwei_session=${member.session.token}`,outsider:`ziwei_session=${outsider.session.token}`};
  return {app,repo,auth,owner,member,outsider,slug,ws,employee,privateEmployee,conversation,privateChat,first,second,send,cookies,list:`/api/workspaces/${slug}/chats`,read:`/api/conversations/${conversation.id}/read`};
}

test('chat list is small, private-filtered and contains only original canonical active conversations',async t=>{
  const f=fixture(t),before=f.repo.db.prepare('SELECT count(*) AS n FROM conversations').get().n;
  const archived=f.repo.createConversation(f.slug,{employeeId:f.employee.id});f.repo.archiveConversation(archived.id);
  f.repo.heartbeatDevice(f.slug,{deviceId:'chat-pc',runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}]}}});
  const bot=createManagementService(f.repo).bots.create(f.slug,{name:'Canonical Bot',targetDeviceId:'chat-pc',runtimeProfile:'default',idempotencyKey:'chat-state-bot'},{actorUserId:f.owner.user_id,actorRole:'owner'});
  const noncanonical=f.repo.createConversation(f.slug,{employeeId:bot.id});f.send(noncanonical.id,'assistant','Hidden alternate Bot chat');
  f.repo.getConversation=()=>{throw new Error('List must not hydrate conversations');};
  f.repo.getA2AAction=()=>{throw new Error('List must not hydrate execution events');};
  const a=await request(f.app,f.list,{cookie:f.cookies.owner}),b=await request(f.app,f.list,{cookie:f.cookies.member});
  assert.equal(a.status,200);assert.equal(b.status,200);assert(a.bytes.length<5000);
  assert.equal(a.json().chats.length,3);assert.equal(b.json().chats.length,2);
  const ordinary=a.json().chats.find(c=>c.employeeId===f.employee.id),canonical=a.json().chats.find(c=>c.employeeId===bot.id);
  assert.equal(ordinary.conversationId,f.conversation.id);assert.equal(ordinary.preview,'Second answer');assert.equal(ordinary.unreadCount,2);assert.equal(ordinary.messageCount,2);
  assert.match(ordinary.employee.avatar,/^\/api\/workspaces\/chat-state\/employees\/.*\/avatar\?v=[a-f0-9]{64}$/);
  assert.equal(canonical.conversationId,bot.main_conversation_id);assert(!a.bytes.includes(Buffer.from('attachment_json')));assert(!a.bytes.includes(Buffer.from('execution')));
  assert.equal(f.repo.db.prepare('SELECT count(*) AS n FROM conversations').get().n,before+3);
  assert.equal((await request(f.app,f.list)).status,401);
  assert.equal((await request(f.app,f.list,{cookie:f.cookies.outsider,headers:{'x-workspace-role':'owner'}})).status,403);
});

test('read cursor is per user, monotonic, and does not clear messages arriving after the visible message',async t=>{
  const f=fixture(t),post=messageId=>request(f.app,f.read,{method:'POST',cookie:f.cookies.owner,body:{messageId}});
  let r=await post(f.first.id);assert.equal(r.status,200);assert.equal(r.json().unreadCount,1);
  const later=f.send(f.conversation.id,'assistant','Arrived after view');
  r=await post(f.second.id);assert.equal(r.json().lastReadMessageId,f.second.id);assert.equal(r.json().unreadCount,1);
  r=await post(f.first.id);assert.equal(r.json().lastReadMessageId,f.second.id);assert.equal(r.json().unreadCount,1);
  assert.equal((await request(f.app,f.list,{cookie:f.cookies.member})).json().chats.find(c=>c.conversationId===f.conversation.id).unreadCount,3);
  assert.equal((await post(later.id)).json().unreadCount,0);
  f.send(f.conversation.id,'user','Own outgoing',f.owner.user_id);
  f.send(f.conversation.id,'user','Other member record',f.member.user_id);
  const rows=(await request(f.app,f.list,{cookie:f.cookies.owner})).json().chats;
  assert.equal(rows.find(c=>c.conversationId===f.conversation.id).unreadCount,1);
});

test('read requires a real visible message and cannot impersonate another user or use a foreign chat',async t=>{
  const f=fixture(t),hidden=f.repo.getConversation(f.privateChat.id).messages[0];
  assert.equal((await request(f.app,f.read,{method:'POST',cookie:f.cookies.owner,body:{messageId:hidden.id}})).status,404);
  assert.equal((await request(f.app,f.read,{method:'POST',cookie:f.cookies.owner,body:{}})).status,400);
  assert.equal((await request(f.app,`/api/conversations/${f.privateChat.id}/read`,{method:'POST',cookie:f.cookies.member,body:{messageId:hidden.id,actorUserId:f.owner.user_id},headers:{'x-workspace-role':'owner'}})).status,404);
  const accepted=await request(f.app,f.read,{method:'POST',cookie:f.cookies.member,body:{messageId:f.second.id,actorUserId:f.owner.user_id}});
  assert.equal(accepted.status,200);assert.equal(f.repo.db.prepare('SELECT user_id FROM conversation_reads').get().user_id,f.member.user_id);
  f.repo.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(f.ws.id,f.member.user_id);
  assert.equal((await request(f.app,f.read,{method:'POST',cookie:f.cookies.member,body:{messageId:f.second.id}})).status,403);
  assert.equal(f.repo.db.prepare('SELECT count(*) AS n FROM a2a_actions').get().n,0);
});

test('forward HTTP route uses the session identity, deduplicates reference records and exposes them to the same chat list',async t=>{
  const f=fixture(t),url=`/api/conversations/${f.conversation.id}/forwards`;
  const body={messageIds:[f.second.id],targetEmployeeId:f.privateEmployee.id,mode:'reference',note:'作为参考',clientRequestId:'http-forward-once'};
  assert.equal((await request(f.app,url,{method:'POST',body})).status,401);
  assert.equal((await request(f.app,url,{method:'POST',body,cookie:f.cookies.member,headers:{'x-workspace-role':'owner'}})).status,404);
  const a=await request(f.app,url,{method:'POST',body,cookie:f.cookies.owner});assert.equal(a.status,201);
  const b=await request(f.app,url,{method:'POST',body,cookie:f.cookies.owner});assert.equal(b.status,200);assert.equal(b.json().duplicate,true);
  assert.equal(a.json().message.id,b.json().message.id);assert.equal(a.json().message.sender_user_id,f.owner.user_id);assert.equal(a.json().forward.targetConversationId,f.privateChat.id);
  const conflict=await request(f.app,url,{method:'POST',body:{...body,note:'改变附言'},cookie:f.cookies.owner});assert.equal(conflict.status,409);assert.equal(conflict.json().code,'FORWARD_REQUEST_CONFLICT');
  const invalid=await request(f.app,url,{method:'POST',body:{...body,actorUserId:f.member.user_id},cookie:f.cookies.owner});assert.equal(invalid.status,400);
  const row=(await request(f.app,f.list,{cookie:f.cookies.owner})).json().chats.find(item=>item.conversationId===f.privateChat.id);
  assert.equal(row.preview,'[聊天记录]');assert.equal(row.latestMessageId,a.json().message.id);
  assert.equal(f.repo.db.prepare('SELECT count(*) AS n FROM a2a_actions').get().n,0);
});
