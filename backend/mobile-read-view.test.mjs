import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createHash,randomUUID} from 'node:crypto';
import {createApp} from './app.mjs';
import {createManagementService} from './management.mjs';
import {createMobileReadView,mobileRunView} from './mobile-read-view.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

// Exercise the real middleware and binary response without opening a listener.
async function request(app,url,{cookie='',headers={}}={}) {
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}});
  const req=new IncomingMessage(socket),res=new ServerResponse(req);
  req.method='GET';req.url=url;req.headers={host:'mobile-read.fixture',cookie,...headers};
  const chunks=[];
  try {
    return await new Promise((resolve,reject)=>{
      res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));done?.();return true;};
      res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.getHeaders(),bytes,json:()=>JSON.parse(bytes.toString())});res.emit('finish');return res;};
      req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));req.push(null);
    });
  }finally{socket.destroy();}
}

function fixture(t) {
  const mcpToken=randomUUID(),app=createApp({memory:true,requireAuth:true,mcpToken,mcpWorkspace:'mobile-read-view',mcpRole:'owner'}),repo=app.locals.repo,auth=app.locals.auth;
  t.after(()=>repo.db.close());
  const owner=auth.setup({email:'mobile-owner@fixture.test',password:'isolated-fixture-password'});
  const slug='mobile-read-view';auth.createWorkspace(owner.user_id,{slug,name:'Mobile read fixture',kind:'team'});
  auth.createWorkspace(owner.user_id,{slug:'other-mobile-read-view',name:'Other owner workspace',kind:'team'});
  const ws=repo.getWorkspace(slug),ownerCookie=`ziwei_session=${owner.session.token}`;
  const member=auth.register({email:'mobile-member@fixture.test',password:'isolated-fixture-password'});
  repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('mobile-read-member',ws.id,member.user_id,'Fixture member','mobile-member@fixture.test','member','2026-01-01T00:00:00.000Z');
  const outsider=auth.register({email:'mobile-outsider@fixture.test',password:'isolated-fixture-password'});
  const bytes=Buffer.concat([rasterFixtures.png,Buffer.alloc(2*1024*1024,61)]),avatar=`data:image/png;base64,${bytes.toString('base64')}`;
  repo.heartbeatDevice(slug,{deviceId:'mobile-read-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}]}}});
  const management=createManagementService(repo),context={actorUserId:owner.user_id,actorRole:'owner'};
  const bot=management.bots.create(slug,{name:'Original Hermes Bot',targetDeviceId:'mobile-read-pc',runtimeProfile:'default',avatar,visibility:'workspace',idempotencyKey:'mobile-read-bot'},context);
  const ordinary=repo.createEmployee(slug,{name:'Ordinary employee',runtime:'Codex',avatar,visibility:'workspace',ownerUserId:owner.user_id});
  const privateEmployee=repo.createEmployee(slug,{name:'Private employee',runtime:'Codex',avatar,visibility:'personal',ownerUserId:owner.user_id});
  const idle=repo.createEmployee(slug,{name:'No conversation',runtime:'Codex',ownerUserId:owner.user_id});
  const conversation=repo.createConversation(slug,{employeeId:ordinary.id});
  const archived=repo.createConversation(slug,{employeeId:ordinary.id});repo.archiveConversation(archived.id);
  repo.addConversationMessage(bot.main_conversation_id,{role:'user',content:'Original user text',dispatch:false});
  repo.addConversationMessage(bot.main_conversation_id,{role:'assistant',content:'Original assistant text',attachments:[{name:'original.png',mimeType:'image/png',contentEncoding:'base64',content:rasterFixtures.png.toString('base64')}],dispatch:false});
  const payload={employeeId:bot.id,conversationId:bot.main_conversation_id,hermesBot:{employeeId:bot.id,revision:bot.revision},unknown:{keep:true}},result={output:'Original execution receipt',unknown:{keep:true}};
  repo.db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,completed_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run('mobile-read-receipt',ws.id,'ziwei_user','conversation.execute',JSON.stringify(payload),'mobile-read-receipt','succeeded','2027-01-01T00:00:00.000Z','2027-01-01T00:00:01.000Z',JSON.stringify(result));
  return {app,repo,auth,mcpToken,slug,ws,owner,ownerCookie,memberCookie:`ziwei_session=${member.session.token}`,outsiderCookie:`ziwei_session=${outsider.session.token}`,bytes,avatar,bot,ordinary,privateEmployee,idle,conversation,archived};
}

test('mobile employee JSON removes inline image bytes and reuses only original main conversations',async t=>{
  const f=fixture(t),url=`/api/workspaces/${f.slug}/employees`;
  const original=await request(f.app,url,{cookie:f.ownerCookie}),mobile=await request(f.app,url+'?view=mobile',{cookie:f.ownerCookie});
  assert.equal(original.status,200);assert.equal(mobile.status,200);
  const rows=original.json().employees,projected=mobile.json().employees;
  assert(original.bytes.length>6*1024*1024);assert(mobile.bytes.length<12000);assert(mobile.bytes.length<original.bytes.length/100);
  t.diagnostic(`employee JSON bytes: default=${original.bytes.length}, mobile=${mobile.bytes.length}`);
  for(const value of rows) {
    const actual=projected.find(item=>item.id===value.id),{main_conversation_id,...withoutMain}=actual;
    assert.deepEqual({...withoutMain,avatar:value.avatar},value);
    if(value.avatar)assert.match(actual.avatar,new RegExp(`^/api/workspaces/${f.slug}/employees/${value.id}/avatar\\?v=[a-f0-9]{64}$`));
  }
  assert.equal(projected.find(item=>item.id===f.bot.id).main_conversation_id,f.bot.main_conversation_id);
  assert.equal(projected.find(item=>item.id===f.ordinary.id).main_conversation_id,f.conversation.id);
  assert.equal(projected.find(item=>item.id===f.idle.id).main_conversation_id,null);
  assert.equal(f.repo.getEmployee(f.bot.id).avatar,f.avatar);
  assert.deepEqual((await request(f.app,url+'?view=desktop',{cookie:f.ownerCookie})).bytes,original.bytes);
});

test('mobile Bot list/detail and conversation change only the employee avatar, preserving messages and execution receipts',async t=>{
  const f=fixture(t),paths=[`/api/workspaces/${f.slug}/bots`,`/api/workspaces/${f.slug}/bots/${f.bot.id}`,`/api/conversations/${f.bot.main_conversation_id}`];
  const before=f.repo.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
  for(const path of paths) {
    const original=await request(f.app,path,{cookie:f.ownerCookie}),mobile=await request(f.app,path+'?view=mobile',{cookie:f.ownerCookie});
    assert.equal(original.status,200);assert.equal(mobile.status,200);assert(mobile.bytes.length<original.bytes.length/20);
    const initial=original.json(),actual=mobile.json(),a=initial.bots||[initial],b=actual.bots||[actual];
    for(let index=0;index<a.length;index++) {
      assert.match(b[index].employee.avatar,/\/avatar\?v=[a-f0-9]{64}$/);
      assert.deepEqual({...b[index],employee:{...b[index].employee,avatar:a[index].employee.avatar}},a[index]);
    }
  }
  const chat=(await request(f.app,paths[2]+'?view=mobile',{cookie:f.ownerCookie})).json();
  assert.equal(chat.messages.length,2);assert.equal(chat.messages[1].attachments[0].content,rasterFixtures.png.toString('base64'));assert.equal(chat.execution.id,'mobile-read-receipt');
  assert.deepEqual(f.repo.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(),before);
  assert.equal(f.repo.db.prepare('SELECT count(*) AS count FROM conversation_messages WHERE conversation_id=?').get(f.bot.main_conversation_id).count,2);
});

test('mobile phone-MCP setup replaces only employee avatars while preserving original phone configuration and catalog',async t=>{
  const f=fixture(t),phone={id:'original-phone-id',alias:'Original phone',control:{role:'agent',epoch:7},unknown:{keep:true}};
  f.app.locals.ziweiConnect.listDevices=async()=>[structuredClone(phone)];
  const path=`/api/workspaces/${f.slug}/phone-mcp/setup`,original=await request(f.app,path,{cookie:f.memberCookie}),mobile=await request(f.app,path+'?view=mobile',{cookie:f.memberCookie});
  assert.equal(original.status,200);assert.equal(mobile.status,200);assert(mobile.bytes.length<original.bytes.length/50);
  const initial=original.json(),actual=mobile.json();
  assert.deepEqual(actual.phones,[phone]);assert(!actual.employees.some(item=>item.id===f.privateEmployee.id));
  const computers=actual.computers.map(value=>{
    const previous=initial.computers.find(item=>item.id===value.id);
    assert(value.heartbeat_age_ms>=previous.heartbeat_age_ms);
    return {...value,heartbeat_age_ms:previous.heartbeat_age_ms};
  });
  assert.deepEqual({...actual,computers,employees:actual.employees.map((value,index)=>({...value,avatar:initial.employees[index].avatar}))},initial);
  assert.match(actual.employees.find(item=>item.id===f.bot.id).avatar,/\/avatar\?v=[a-f0-9]{64}$/);
});

test('avatar image bytes, MIME, private validators and version invalidation preserve the original image',async t=>{
  const f=fixture(t),list=(await request(f.app,`/api/workspaces/${f.slug}/employees?view=mobile`,{cookie:f.ownerCookie})).json();
  const url=list.employees.find(item=>item.id===f.bot.id).avatar,version=createHash('sha256').update(f.avatar).digest('hex');
  const image=await request(f.app,url,{cookie:f.memberCookie});
  assert.equal(image.status,200);assert.deepEqual(image.bytes,f.bytes);assert.equal(image.headers['content-type'],'image/png');assert.equal(image.headers.etag,`"${version}"`);assert.match(image.headers['cache-control'],/^private, max-age=60, must-revalidate$/);assert.match(image.headers.vary,/Cookie/);assert.equal(image.headers['x-content-type-options'],'nosniff');
  const cached=await request(f.app,url,{cookie:f.memberCookie,headers:{'if-none-match':image.headers.etag}});assert.equal(cached.status,304);assert.equal(cached.bytes.length,0);
  createManagementService(f.repo).bots.update(f.slug,f.bot.id,{expectedRevision:f.bot.revision,employee:{avatar:`data:image/gif;base64,${rasterFixtures.gif.toString('base64')}`}},{actorUserId:f.owner.user_id,actorRole:'owner'});
  assert.equal((await request(f.app,url,{cookie:f.memberCookie,headers:{'if-none-match':image.headers.etag}})).status,404);
  const fresh=(await request(f.app,`/api/workspaces/${f.slug}/employees?view=mobile`,{cookie:f.memberCookie})).json().employees.find(item=>item.id===f.bot.id).avatar;
  const next=await request(f.app,fresh,{cookie:f.memberCookie});assert.equal(next.status,200);assert.equal(next.headers['content-type'],'image/gif');assert.deepEqual(next.bytes,rasterFixtures.gif);assert.notEqual(next.headers.etag,image.headers.etag);
});

test('avatar authorization happens before cache validation and never exposes another workspace or private employee',async t=>{
  const f=fixture(t),path=id=>`/api/workspaces/${f.slug}/employees/${id}/avatar`,image=await request(f.app,path(f.privateEmployee.id),{cookie:f.ownerCookie});
  assert.equal(image.status,200);
  const validator={'if-none-match':image.headers.etag};
  assert.equal((await request(f.app,path(f.privateEmployee.id),{headers:validator})).status,401);
  assert.equal((await request(f.app,path(f.privateEmployee.id),{cookie:f.memberCookie,headers:validator})).status,404);
  assert.equal((await request(f.app,path(f.privateEmployee.id),{cookie:f.outsiderCookie,headers:validator})).status,403);
  assert.equal((await request(f.app,`/api/workspaces/other-mobile-read-view/employees/${f.bot.id}/avatar`,{cookie:f.ownerCookie,headers:validator})).status,404);
  assert.equal((await request(f.app,path('missing-employee'),{cookie:f.ownerCookie})).status,404);
  assert.equal((await request(f.app,path(f.idle.id),{cookie:f.ownerCookie})).status,404);
  const visible=(await request(f.app,`/api/workspaces/${f.slug}/employees?view=mobile`,{cookie:f.memberCookie})).json().employees;
  assert(!visible.some(item=>item.id===f.privateEmployee.id));
  assert.equal((await request(f.app,`/api/conversations/${f.bot.main_conversation_id}?view=mobile`,{cookie:f.outsiderCookie})).status,403);
});

test('projection is shallow and immutable, and an avatar endpoint cannot fetch caller URLs or stored remote URLs',async t=>{
  const f=fixture(t),view=createMobileReadView(f.repo),employee=f.repo.getEmployee(f.bot.id),messages=[{content:'keep',attachments:[{content:'keep original bytes'}]}],execution={unknown:{keep:true}};
  const input=Object.freeze({workspace_id:f.ws.id,employee:Object.freeze(employee),messages,execution}),projected=view.conversation(input);
  assert.notEqual(projected,input);assert.equal(projected.messages,messages);assert.equal(projected.execution,execution);assert.equal(input.employee.avatar,f.avatar);
  f.repo.updateEmployee(f.idle.id,{avatar:'https://caller-selected.invalid/private'});
  assert.equal((await request(f.app,`/api/workspaces/${f.slug}/employees/${f.idle.id}/avatar?url=https://caller-selected.invalid/private`,{cookie:f.ownerCookie})).status,404);
  assert.equal(view.employee(f.slug,f.repo.getEmployee(f.idle.id)).avatar,'https://caller-selected.invalid/private');
});

test('mobile run events preserve original order, the final event, and every earlier complete terminal proof without mutation',()=>{
  const proof={processExit:{rootConfirmed:true,treeConfirmed:true,activeProcesses:0},result:{stopConfirmed:true},unknown:{keep:true}};
  const events=Object.freeze([
    Object.freeze({id:'early-progress',type:'progress',message:'Original progress',data:{message:'unchanged'}}),
    Object.freeze({id:'early-proof',type:'succeeded',message:'Original terminal message',data:{result:proof}}),
    Object.freeze({id:'failed-proof',type:'failed',data:{result:proof}}),
    Object.freeze({id:'cancelled-proof',type:'cancelled',data:{result:proof}}),
    Object.freeze({id:'expired-proof',type:'expired',data:{result:proof}}),
    Object.freeze({id:'middle-progress',type:'progress',data:{result:proof}}),
    Object.freeze({id:'last-progress',type:'progress',message:'Original final message',data:{message:'keep last'}}),
  ]),payload=Object.freeze({context:'retain original payload'}),result=Object.freeze({summary:'Original summary',processExit:proof.processExit});
  const original=Object.freeze({id:'original-run',status:'failed',error:'Original error',created_at:'2026-10-17T00:00:00Z',payload,result,events}),projected=mobileRunView(original);
  assert.equal(projected.event_count,7);assert.deepEqual(projected.events.map(event=>event.id),['early-proof','failed-proof','cancelled-proof','expired-proof','last-progress']);
  assert.equal(projected.payload,payload);assert.equal(projected.result,result);assert.equal(projected.events[0],events[1]);assert.equal(projected.events.at(-1),events.at(-1));
  assert.deepEqual({...projected,events:original.events,event_count:undefined},{...original,event_count:undefined});
  assert.equal(original.events.length,7);assert.deepEqual(mobileRunView({id:'empty',events:[]}),{id:'empty',events:[],event_count:0});
  assert.deepEqual(mobileRunView({events:[events[1]]}).events,[events[1]]);
});

test('only API mobile runs select five and summarize events; default and MCP retain every original action and event byte',async t=>{
  const f=fixture(t),db=f.repo.db;
  const action=db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,completed_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const event=db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)');
  const proof={code:'EXECUTION_UNCERTAIN',processExit:{rootConfirmed:true,treeConfirmed:true,activeProcesses:0},unknown:{keep:true}},types=['progress','succeeded','failed','cancelled','expired'];
  for(let index=0;index<8;index++) {
    const id=`mobile-event-run-${index}`,stamp='2028-01-01T00:00:00.000Z';
    action.run(id,f.ws.id,'ziwei_user','conversation.execute',JSON.stringify({hermesBot:{employeeId:f.bot.id},context:'original-context '.repeat(256)}),id,'failed',stamp,stamp,JSON.stringify({summary:'Original summary',outputArtifacts:[{name:'original-image',content:'retain-all-original-content'}],processExit:proof.processExit}));
    for(let number=0;number<180;number++)event.run(`${id}-event-${String(number).padStart(3,'0')}`,id,types[number]||'progress',`Original message ${number}: `+'x'.repeat(512),JSON.stringify({message:'original event data '.repeat(32),result:proof}),stamp);
  }
  const base=`/api/workspaces/${f.slug}/bots/${f.bot.id}/runs`,raw=await request(f.app,base,{cookie:f.ownerCookie}),mobile=await request(f.app,base+'?view=mobile',{cookie:f.ownerCookie});
  assert.equal(raw.status,200);assert.equal(mobile.status,200);
  const original=raw.json().runs,actual=mobile.json().runs;
  assert.equal(original.length,10);assert.equal(actual.length,5);assert(mobile.bytes.length<raw.bytes.length/15);
  for(let index=0;index<actual.length;index++) {
    assert.deepEqual(actual[index],mobileRunView(original[index]));
    assert.equal(actual[index].event_count,180);assert.equal(actual[index].events.length,5);
    assert.deepEqual(actual[index].result,original[index].result);assert.deepEqual(actual[index].payload,original[index].payload);
    assert.deepEqual(actual[index].events[0].data.result,proof);assert.equal(actual[index].events.at(-1).id,original[index].events.at(-1).id);
  }
  const unchanged=await request(f.app,base,{cookie:f.ownerCookie}),mcp=await request(f.app,`/mcp/v1/workspaces/${f.slug}/bots/${f.bot.id}/runs?view=mobile`,{headers:{authorization:`Bearer ${f.mcpToken}`}});
  assert.equal(mcp.status,200);assert.deepEqual(unchanged.bytes,raw.bytes);assert.deepEqual(mcp.bytes,raw.bytes);
  t.diagnostic(`run JSON bytes: default=${raw.bytes.length}, mobile=${mobile.bytes.length}`);
});
