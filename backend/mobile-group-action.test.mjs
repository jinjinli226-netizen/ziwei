import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from './app.mjs';
import {createManagementService} from './management.mjs';
import {createMobileGroupActionView} from './mobile-group-action.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function request(app,url,{cookie='',headers={}}={}){
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[];
  req.method='GET';req.url=url;req.headers={host:'mobile-group-action.fixture',cookie,...headers};
  try{return await new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,encoding));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.getHeaders(),bytes,json:bytes.length?JSON.parse(bytes.toString()):null});res.emit('finish');return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));req.push(null);
  });}finally{socket.destroy();}
}
function fixture(t,{kind='team'}={}){
  const slug='group-mobile-view',mcpToken=randomUUID(),app=createApp({memory:true,requireAuth:true,enableScheduler:false,mcpToken,mcpWorkspace:slug,mcpRole:'owner'}),repo=app.locals.repo,db=repo.db,auth=app.locals.auth;
  t.after(()=>db.close());
  const owner=auth.setup({email:'group-owner@fixture.test',password:'isolated-group-password'}),member=auth.register({email:'group-member@fixture.test',password:'isolated-group-password'}),outsider=auth.register({email:'group-outsider@fixture.test',password:'isolated-group-password'});
  auth.createWorkspace(owner.user_id,{slug,name:'Group mobile view',kind});const ws=repo.getWorkspace(slug);
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('group-view-member',ws.id,member.user_id,'Member','group-member@fixture.test','member','2026-01-01T00:00:00Z');
  const source=repo.createEmployee(slug,{name:'Source',runtime:'Hermes',ownerUserId:owner.user_id}),target=repo.createEmployee(slug,{name:'Target',runtime:'Hermes',ownerUserId:owner.user_id}),groupId='group_fixture';
  const view=createMobileGroupActionView(repo),context={actorUserId:owner.user_id};
  function action(options={}){
    const actionId='action_'+randomUUID(),requestId='request_'+randomUUID(),resource=options.resource||'collaboration',operation=options.operation||'message';
    const input=options.input|| (resource==='collaboration'?{mode:'group',groupId,content:'Original explicit instruction',targets:[{id:target.id,name:'Target',revision:1,controlEpoch:1}]}:{groupId});
    const payload={employeeId:source.id,hermesBot:{workspace:slug,employeeId:source.id,revision:1,controlEpoch:1},nativeOperation:{schemaVersion:2,resource,operation,input,requestId},...options.payload};
    const room={room_id:groupId,name:'Synthetic group',members:[{member_id:source.id,profile:source.id},{member_id:target.id,profile:target.id}],authority_gateway_id:'fixture-authority',authority_epoch:1};
    const count=options.count??3,after=options.after??0,latest=options.latest??after+count;
    const log={events:Array.from({length:count},(_,index)=>({room_id:groupId,seq:after+index+1,event_id:`event-${after+index+1}`,kind:'message.user',payload:{text:options.text||'Synthetic history'},unknownEventProof:{preserve:true}})),cursor:after+count,latest_seq:latest,has_more:after+count<latest,authority:{gateway_id:'fixture-authority',epoch:1},unknownLogProof:{keep:'native metadata'}};
    const data=options.data||{room,events:log,decision:{status:'task',task:{payload:{prompt:'Complete native bounded prompt'}}},plan:{identity:{task_id:'original-task'},payload:{prompt:'Complete native bounded prompt'}},unknownDataProof:{keep:true}};
    const receipt={schemaVersion:2,resource:options.receiptResource||resource,operation:options.receiptOperation||operation,employeeId:source.id,revision:1,status:'succeeded',data,unknownNativeProof:{keep:true}};
    const result=options.result===undefined?{nativeOperation:receipt,processExit:{launched:true,rootPid:18,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,rootExitCode:0},botIsolation:{workspace:slug,employeeId:source.id},code:'ORIGINAL_CODE',executionState:'original-state',stopConfirmed:false,unknownResultProof:{keep:true}}:options.result;
    db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(actionId,ws.id,'fixture',options.type||'hermes.bot.native',JSON.stringify(payload),actionId,options.status||'succeeded','2026-10-17T00:00:00Z','2026-10-17T00:00:01Z',options.status==='pending'?null:'2026-10-17T00:00:02Z',result===null?null:JSON.stringify(result),options.error||null);
    return {actionId,payload,result,receipt,room,log,url:`/api/workspaces/${slug}/actions/${actionId}`};
  }
  function event(actionId,result,type='succeeded'){
    db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run('event_'+randomUUID(),actionId,type,'Original event',JSON.stringify({result,unknownEventEnvelope:{keep:true}}),'2026-10-17T00:00:03Z');
  }
  const dump=({includeSessions=false}={})=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(row=>includeSessions||row.name!=='local_sessions').map(row=>({name:row.name,rows:db.prepare(`SELECT * FROM "${row.name.replaceAll('"','""')}"`).all()}));
  const initialize=(employeeId=source.id)=>createManagementService(repo).bots.initialize(slug,employeeId,{idempotencyKey:'fixture-init-'+employeeId},context);
  return {app,repo,db,auth,slug,ws,owner,member,outsider,source,target,groupId,mcpToken,view,context,action,event,dump,initialize,cookie:who=>`ziwei_session=${who.session.token}`};
}

test('explicit mobile action removes only the full group history and preserves complete proof, planner and unknown fields',t=>{
  const f=fixture(t),a=f.action(),original=freeze(f.repo.getA2AAction(a.actionId)),before=hash(f.dump({includeSessions:true})),projected=f.view.project(f.slug,original,f.context);
  const receipt=projected.result.nativeOperation;
  assert(!Object.hasOwn(receipt.data,'events'));assert.deepEqual(receipt.data.historyPointer,{cursor:3,latest_seq:3,has_more:false,authority:a.log.authority,unknownLogProof:a.log.unknownLogProof,room_id:f.groupId,omitted:true,eventCount:3});
  const {nativeOperation,...originalProof}=original.result,{nativeOperation:_native,...actualProof}=projected.result;assert.deepEqual(actualProof,originalProof);
  const {events,...kept}=nativeOperation.data,{historyPointer,...actualData}=receipt.data;assert.deepEqual(actualData,kept);
  assert.equal(receipt.data.plan,original.result.nativeOperation.data.plan);assert.equal(receipt.data.decision,original.result.nativeOperation.data.decision);
  assert.equal(hash(f.dump({includeSessions:true})),before);assert.equal(original.result.nativeOperation.data.events.events.length,3);
});

test('nested result wrappers and terminal/last event results are projected without changing any event or exit state',t=>{
  const f=fixture(t),a=f.action();f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify({result:a.result,wrapperProof:{keep:true}}),a.actionId);
  f.event(a.actionId,a.result);f.event(a.actionId,{result:a.result,wrapperProof:{keep:true}},'progress');
  const before=f.repo.getA2AAction(a.actionId),view=f.view.project(f.slug,before,f.context);
  assert(view.result.result.nativeOperation.data.historyPointer);assert(view.events.every(event=>(event.data.result.nativeOperation||event.data.result.result.nativeOperation).data.historyPointer));
  assert.deepEqual(view.events.map(({data,...event})=>event),before.events.map(({data,...event})=>event));assert.deepEqual(view.events.map(event=>event.data.unknownEventEnvelope),before.events.map(event=>event.data.unknownEventEnvelope));assert.equal(view.status,before.status);assert.equal(view.acked_at,before.acked_at);assert.equal(view.error,before.error);
});

test('validated paged read stays byte-identical and keeps only the originally requested page',async t=>{
  const f=fixture(t),sample=f.action({resource:'groups',operation:'read',input:{groupId:f.groupId,limit:30,afterSeq:0},count:2,latest:4}),data={...sample.receipt.data,pagedRead:true,decision:null,plan:null,pagination:{limit:30,afterSeq:0,nextAfterSeq:2,hasMore:true}};
  const a=f.action({resource:'groups',operation:'read',input:{groupId:f.groupId,limit:30,afterSeq:0},data});
  const full=await request(f.app,a.url,{cookie:f.cookie(f.owner)}),mobile=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(mobile.status,200);assert(mobile.bytes.equals(full.bytes));assert.equal(mobile.json.result.nativeOperation.data.events.events.length,2);
});

test('old host full-log reply for an explicitly paged read returns a short typed upgrade error without forging action state',async t=>{
  const f=fixture(t),a=f.action({resource:'groups',operation:'read',input:{groupId:f.groupId,limit:30,afterSeq:0},count:500,text:'large private history '.repeat(100)}),before=hash(f.dump());
  const response=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(response.status,409);assert.equal(response.json.code,'GROUP_HOST_UPGRADE_REQUIRED');assert(response.bytes.length<500);assert(!response.bytes.includes(Buffer.from('large private history')));assert.equal(hash(f.dump()),before);assert.equal(f.repo.getA2AAction(a.actionId).status,'succeeded');
});

test('corrupt or cross-room receipts fail closed without returning their logs',async t=>{
  const f=fixture(t),variants=[data=>{data.room.room_id='other-room';},data=>{data.events.events[1].seq=1;},data=>{data.events.events[0].room_id='other-room';},data=>{data.events.cursor=99;},data=>{data.events.authority.epoch=2;},data=>{data.events.has_more=true;},data=>{data.events.events='bad shape';}];
  for(const change of variants){const a=f.action();change(a.receipt.data);f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(a.result),a.actionId);const response=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(response.status,409);assert.equal(response.json.code,'GROUP_MOBILE_RECEIPT_INVALID');assert(response.bytes.length<500);}
});

test('receipt schema/employee/revision/source workspace mismatches cannot masquerade as the requested group',async t=>{
  const f=fixture(t),variants=[a=>{a.receipt.schemaVersion=1;},a=>{a.receipt.employeeId=f.target.id;},a=>{a.receipt.revision=2;},a=>{a.receipt.operation='configure';},a=>{a.payload.hermesBot.workspace='another-scope';}];
  for(const change of variants){const a=f.action();change(a);f.db.prepare('UPDATE a2a_actions SET payload_json=?,result_json=? WHERE id=?').run(JSON.stringify(a.payload),JSON.stringify(a.result),a.actionId);const response=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(response.status,409);assert.equal(response.json.code,'GROUP_MOBILE_RECEIPT_INVALID');}
});

test('pending reads and non-group executions retain their real status, errors and receipts',async t=>{
  const f=fixture(t),pending=f.action({resource:'groups',operation:'read',input:{groupId:f.groupId,limit:30,afterSeq:0},status:'pending',result:null}),ordinary=f.action({type:'conversation.execute'}),dm=f.action({input:{mode:'message',content:'Direct message',targets:[{id:f.target.id}]}});
  for(const a of [pending,ordinary,dm]){const original=await request(f.app,a.url,{cookie:f.cookie(f.owner)}),mobile=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(mobile.status,200);assert(mobile.bytes.equals(original.bytes));}
});

test('real auth, workspace membership and original action authorization precede mobile projection',async t=>{
  const f=fixture(t),a=f.action(),url=a.url+'?view=mobile';assert.equal((await request(f.app,url)).status,401);assert.equal((await request(f.app,url,{cookie:f.cookie(f.outsider),headers:{'x-workspace-role':'owner'}})).status,403);
  const other=f.auth.createWorkspace(f.owner.user_id,{slug:'group-other',name:'Other',kind:'team'}).workspace;assert.notEqual((await request(f.app,url.replace(f.slug,other.slug),{cookie:f.cookie(f.owner)})).status,200);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.source.id);assert.equal((await request(f.app,url,{cookie:f.cookie(f.member),headers:{'x-workspace-role':'owner'}})).status,404);
  assert.equal((await request(f.app,url,{cookie:f.cookie(f.owner)})).status,200);
});

test('target visibility, foreign roster and personal device rights are rechecked and cached owner output never authorizes another user',async t=>{
  const f=fixture(t,{kind:'personal'}),a=f.action(),url=a.url+'?view=mobile',owner=await request(f.app,url,{cookie:f.cookie(f.owner)});assert.equal(owner.status,200);assert.equal(owner.headers['cache-control'],'no-store');assert.match(owner.headers.vary,/Cookie/);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.target.id);
  let denied=await request(f.app,url,{cookie:f.cookie(f.member),headers:{'if-none-match':owner.headers.etag,'x-workspace-role':'owner'}});assert.equal(denied.status,404);assert(denied.bytes.length<500);
  f.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(f.target.id);f.repo.heartbeatDevice(f.slug,{deviceId:'group-view-pc'});f.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(f.owner.user_id,'group-view-pc');f.db.prepare('UPDATE employees SET target_device_id=? WHERE id=?').run('group-view-pc',f.target.id);
  assert.equal((await request(f.app,url,{cookie:f.cookie(f.member)})).status,404);
  f.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(f.ws.id,f.owner.user_id);assert.equal((await request(f.app,url,{cookie:f.cookie(f.owner),headers:{'if-none-match':owner.headers.etag}})).status,403);
});

test('large full history shrinks on the actual mobile route while default, phone and MCP responses and stored business rows remain unchanged',async t=>{
  const f=fixture(t),a=f.action({count:1100,text:'Original historical event '.repeat(90)});f.event(a.actionId,a.result);f.event(a.actionId,{result:a.result},'progress');
  const paths=[a.url,`/api/workspaces/${f.slug}/phone-mcp/actions/${a.actionId}`,`/mcp/v1/workspaces/${f.slug}/actions/${a.actionId}`],before=[];
  for(const path of paths)before.push(await request(f.app,path,{cookie:f.cookie(f.owner),headers:{'x-ziwei-mcp-token':f.mcpToken}}));
  const originalBusiness=hash(f.dump()),schema=hash(f.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all());
  const mobile=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(mobile.status,200);assert(before[0].bytes.length>7*1024*1024);assert(mobile.bytes.length<12000);assert(mobile.bytes.length<before[0].bytes.length/100);
  for(let index=0;index<paths.length;index++){const after=await request(f.app,paths[index]+(index===2?'?view=mobile':''),{cookie:f.cookie(f.owner),headers:{'x-ziwei-mcp-token':f.mcpToken}});assert.equal(after.status,200);assert(after.bytes.equals(before[index].bytes));}
  assert.equal(hash(f.dump()),originalBusiness);assert.equal(hash(f.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()),schema);
  t.diagnostic(`synthetic full/mobile body bytes: ${before[0].bytes.length}/${mobile.bytes.length}; existing authentication session last_seen is excluded from business-row hash`);
});

test('full groups read/step and native publication compatible receipts project only history',async t=>{
  const f=fixture(t);
  for(const options of [{resource:'groups',operation:'read'},{resource:'groups',operation:'step',receiptOperation:'read'},{resource:'groups',operation:'step',receiptResource:'collaboration',receiptOperation:'publish'},{resource:'collaboration',operation:'publish',input:{groupId:f.groupId}}]){
    const a=f.action(options),result=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(result.status,200);assert.equal(result.json.result.nativeOperation.data.historyPointer.room_id,f.groupId);assert.equal(result.json.status,'succeeded');
  }
});

test('uncertain exit evidence, stopped originals and actual failed read errors retain their original meaning',async t=>{
  const f=fixture(t),uncertain=f.action({status:'failed',error:'Original execution uncertain'});uncertain.result.code='EXECUTION_UNCERTAIN';uncertain.result.executionState='uncertain';uncertain.result.processExit.treeConfirmed=false;uncertain.result.stopConfirmed=false;
  f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(uncertain.result),uncertain.actionId);
  const view=await request(f.app,uncertain.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(view.status,200);assert.equal(view.json.status,'failed');assert.equal(view.json.error,'Original execution uncertain');for(const key of ['code','executionState','processExit','stopConfirmed','botIsolation','unknownResultProof'])assert.deepEqual(view.json.result[key],uncertain.result[key]);
  const stopped=f.action({status:'cancelled'});stopped.result.stopConfirmed=true;stopped.result.processExit.cancelled=true;f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(stopped.result),stopped.actionId);
  const stopView=await request(f.app,stopped.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(stopView.json.status,'cancelled');assert.equal(stopView.json.result.stopConfirmed,true);assert.equal(stopView.json.result.processExit.cancelled,true);
  const failed=f.action({resource:'groups',operation:'read',input:{groupId:f.groupId,limit:30,afterSeq:0},status:'failed',error:'Original read error',data:{reason:'Original dependency rejected'}});failed.receipt.status='failed';f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(failed.result),failed.actionId);
  const original=await request(f.app,failed.url,{cookie:f.cookie(f.owner)}),mobile=await request(f.app,failed.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(mobile.status,200);assert(mobile.bytes.equals(original.bytes));
});

test('foreign or unbound room members and successful actions with only an event receipt fail closed',async t=>{
  const f=fixture(t),other=f.auth.createWorkspace(f.owner.user_id,{slug:'group-foreign-roster',name:'Foreign roster',kind:'team'}).workspace,foreign=f.repo.createEmployee(other.slug,{name:'Private foreign member',runtime:'Hermes'}),a=f.action();
  a.receipt.data.room.members.push({member_id:foreign.id});f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(a.result),a.actionId);
  const forbidden=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(forbidden.status,404);assert.equal(forbidden.json.code,'GROUP_MOBILE_SCOPE_REQUIRED');assert(!forbidden.bytes.includes(Buffer.from('Private foreign member')));
  const missing=f.action({result:null}),sample=f.action();f.event(missing.actionId,sample.result);
  const absent=await request(f.app,missing.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(absent.status,409);assert.equal(absent.json.code,'GROUP_MOBILE_RECEIPT_INVALID');assert.equal(f.repo.getA2AAction(missing.actionId).status,'succeeded');
  const noLog=f.action();delete noLog.receipt.data.events;f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(noLog.result),noLog.actionId);assert.equal((await request(f.app,noLog.url+'?view=mobile',{cookie:f.cookie(f.owner)})).status,409);
});

test('mobile bot list/detail/runs project 300 large group events, retaining native, terminal, Stop and unknown evidence',async t=>{
  const f=fixture(t);f.initialize();const a=f.action({count:300,text:'x'.repeat(4096)});f.event(a.actionId,a.result);
  const base=`/api/workspaces/${f.slug}`,paths=[`${base}/bots`,`${base}/bots/${f.source.id}`,`${base}/bots/${f.source.id}/runs`],before=[];
  for(const path of paths)before.push(await request(f.app,path,{cookie:f.cookie(f.owner)}));
  const saved=hash(f.dump());
  const proof=value=>{const {nativeOperation,...rest}=value;return rest;};
  for(let index=0;index<paths.length;index++){
    const response=await request(f.app,paths[index]+'?view=mobile',{cookie:f.cookie(f.owner)});
    assert.equal(response.status,200);assert(before[index].bytes.length>2*1024*1024);assert(response.bytes.length<20000);assert.equal(response.headers['cache-control'],'no-store');assert.match(response.headers.vary,/Cookie/);
    const bot=index===0?response.json.bots.find(item=>item.id===f.source.id):index===1?response.json:null,run=bot?.latest_run||response.json.runs?.[0];
    assert.equal(run.status,'succeeded');assert.equal(run.result.nativeOperation.data.historyPointer.eventCount,300);assert.deepEqual(proof(run.result),proof(a.result));assert.deepEqual(run.result.nativeOperation.data.plan,a.receipt.data.plan);assert.deepEqual(run.events[0].data.result.processExit,a.result.processExit);assert(run.events[0].data.result.nativeOperation.data.historyPointer);
    if(bot){assert.equal(bot.nativeResources.collaboration.actionId,a.actionId);assert.equal(bot.nativeResources.collaboration.data.historyPointer.eventCount,300);assert.deepEqual(bot.nativeResources.collaboration.unknownNativeProof,a.receipt.unknownNativeProof);}
    const after=await request(f.app,paths[index],{cookie:f.cookie(f.owner)});assert(after.bytes.equals(before[index].bytes));
    t.diagnostic(`${index===0?'bots':index===1?'bot':'runs'} full/mobile bytes: ${before[index].bytes.length}/${response.bytes.length}`);
  }
  const employees=await request(f.app,`${base}/employees?view=mobile`,{cookie:f.cookie(f.owner)});assert.equal(employees.status,200);assert(employees.bytes.length<10000);assert(!employees.bytes.includes(Buffer.from('x'.repeat(64))));
  assert.equal(hash(f.dump()),saved);assert.equal(f.repo.getA2AAction(a.actionId).result.nativeOperation.data.events.events.length,300);
});

test('auxiliary old-host full group logs become validated pointers plus upgrade metadata; exact action remains 409',async t=>{
  const f=fixture(t);f.initialize();const a=f.action({resource:'groups',operation:'read',input:{groupId:f.groupId,limit:30,afterSeq:0},count:300,text:'old-host history '.repeat(256)});f.event(a.actionId,a.result);
  const saved=hash(f.dump()),base=`/api/workspaces/${f.slug}/bots`,detail=await request(f.app,`${base}/${f.source.id}?view=mobile`,{cookie:f.cookie(f.owner)});
  assert.equal(detail.status,200);assert(detail.bytes.length<20000);const run=detail.json.latest_run;
  assert.equal(run.status,'succeeded');assert.equal(run.mobileReadError.code,'GROUP_HOST_UPGRADE_REQUIRED');assert.equal(run.result.nativeOperation.data.historyPointer.eventCount,300);assert.equal(detail.json.nativeResources.groups.mobileReadError.code,'GROUP_HOST_UPGRADE_REQUIRED');assert.deepEqual(run.result.processExit,a.result.processExit);assert.equal(run.result.stopConfirmed,false);assert(run.events[0].data.result.nativeOperation.data.historyPointer);
  const list=await request(f.app,base+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(list.status,200);assert.equal(list.json.bots.find(item=>item.id===f.source.id).latest_run.mobileReadError.code,'GROUP_HOST_UPGRADE_REQUIRED');
  const runs=await request(f.app,`${base}/${f.source.id}/runs?view=mobile`,{cookie:f.cookie(f.owner)});assert.equal(runs.status,200);assert.equal(runs.json.runs[0].mobileReadError.code,'GROUP_HOST_UPGRADE_REQUIRED');
  const exact=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(exact.status,409);assert.equal(exact.json.code,'GROUP_HOST_UPGRADE_REQUIRED');assert.equal(hash(f.dump()),saved);
  // An old host claiming only a suffix of the log is not a valid complete
  // history. Auxiliary reads cannot silently accept it as a page.
  a.receipt.data.events.events[0].seq=7;f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(a.result),a.actionId);
  const corrupt=await request(f.app,`${base}/${f.source.id}?view=mobile`,{cookie:f.cookie(f.owner)});assert.equal(corrupt.status,409);assert.equal(corrupt.json.code,'GROUP_MOBILE_RECEIPT_INVALID');assert(corrupt.bytes.length<500);
});

test('private group target makes only that bot list item unavailable; detail/runs and later revoked membership fail closed',async t=>{
  const f=fixture(t);f.initialize();const a=f.action({count:300,text:'private group material '.repeat(220)}),base=`/api/workspaces/${f.slug}/bots`,cookie=f.cookie(f.member);
  const owner=await request(f.app,base+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(owner.status,200);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.target.id);
  const saved=hash(f.dump()),list=await request(f.app,base+'?view=mobile',{cookie,headers:{'if-none-match':owner.headers.etag,'x-workspace-role':'owner'}});assert.equal(list.status,200);
  const hidden=list.json.bots.find(item=>item.id===f.source.id);assert.deepEqual(Object.keys(hidden).sort(),['employee','employee_id','id','readError','resourceState','workspace']);assert.equal(hidden.resourceState,'unavailable');assert.equal(hidden.readError.code,'GROUP_MOBILE_SCOPE_REQUIRED');assert(!list.bytes.includes(Buffer.from('private group material')));assert(!Object.hasOwn(hidden,'latest_run'));assert(!Object.hasOwn(hidden,'status'));
  for(const suffix of [`/${f.source.id}`,`/${f.source.id}/runs`]){const result=await request(f.app,base+suffix+'?view=mobile',{cookie});assert.equal(result.status,404);assert.equal(result.json.code,'GROUP_MOBILE_SCOPE_REQUIRED');assert(result.bytes.length<500);}
  assert.equal(hash(f.dump()),saved);assert.equal(f.repo.getA2AAction(a.actionId).status,'succeeded');
  f.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(f.target.id);
  const other=f.repo.createEmployee(f.slug,{name:'Another visible employee',runtime:'Hermes',ownerUserId:f.owner.user_id});
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.target.id);
  const partial=await request(f.app,base+'?view=mobile',{cookie});assert.equal(partial.status,200);assert(partial.json.bots.find(item=>item.id===other.id)?.configuration_state==='uninitialized');
  f.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(f.ws.id,f.owner.user_id);
  for(const suffix of ['',`/${f.source.id}`,`/${f.source.id}/runs`])assert.equal((await request(f.app,base+suffix+'?view=mobile',{cookie:f.cookie(f.owner),headers:{'if-none-match':owner.headers.etag}})).status,403);
  assert.equal((await request(f.app,base+'?view=mobile')).status,401);
});

test('invalid native resource is isolated, fetched from its real bound action and never falls back to cached receipt data',async t=>{
  const f=fixture(t);f.initialize();const bad=f.action({resource:'groups',operation:'read'});bad.receipt.data.events.authority.epoch=2;f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(bad.result),bad.actionId);
  const good=f.action(),base=`/api/workspaces/${f.slug}/bots/${f.source.id}`,result=await request(f.app,base+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(result.status,200);assert.equal(result.json.latest_run.id,good.actionId);assert(result.json.nativeResources.collaboration.data.historyPointer);
  assert.deepEqual(result.json.nativeResources.groups,{actionId:bad.actionId,resourceState:'unavailable',readError:{code:'GROUP_MOBILE_RECEIPT_INVALID',message:'群组原生回执无法核对，请保留原请求并刷新查看'}});
  const original=createManagementService(f.repo).bots.get(f.slug,f.source.id,f.context,{view:'mobile'}),counterfeit={...original,nativeResources:{...original.nativeResources,groups:{...good.receipt,actionId:good.actionId,data:{cacheSecret:'must not be trusted'}}}};
  const projected=f.view.bot(f.slug,counterfeit,f.context);assert.equal(projected.nativeResources.groups.resourceState,'unavailable');assert(!JSON.stringify(projected.nativeResources).includes('cacheSecret'));
  const other=f.auth.createWorkspace(f.owner.user_id,{slug:'foreign-native-resource',name:'Other',kind:'team'}).workspace;
  f.db.prepare('UPDATE a2a_actions SET workspace_id=? WHERE id=?').run(f.repo.getWorkspace(other.slug).id,bad.actionId);
  const foreign=f.view.bot(f.slug,original,f.context);assert.equal(foreign.nativeResources.groups.readError.code,'ACTION_NOT_FOUND');assert.equal(foreign.latest_run.id,good.actionId);
  const malformed=f.action();malformed.receipt.data.events.cursor=99;f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(malformed.result),malformed.actionId);
  const detail=await request(f.app,base+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(detail.status,409);assert.equal(detail.json.code,'GROUP_MOBILE_RECEIPT_INVALID');assert(detail.bytes.length<500);
});

test('mobile conversation execution validates its original group request, retains proof and rejects inaccessible/unbound receipts',async t=>{
  const f=fixture(t),bot=f.initialize(),conversationId=bot.main_conversation_id,a=f.action({type:'conversation.execute',count:300,text:'conversation-group '.repeat(240),payload:{conversationId}});f.event(a.actionId,a.result);
  const path=`/api/conversations/${conversationId}`,before=await request(f.app,path,{cookie:f.cookie(f.owner)}),saved=hash(f.dump()),mobile=await request(f.app,path+'?view=mobile',{cookie:f.cookie(f.owner)});
  assert.equal(mobile.status,200);assert(before.bytes.length>2*1024*1024);assert(mobile.bytes.length<12000);assert(mobile.json.execution.result.nativeOperation.data.historyPointer);assert(mobile.json.execution.events[0].data.result.nativeOperation.data.historyPointer);assert.deepEqual(mobile.json.execution.result.processExit,a.result.processExit);assert.equal(mobile.json.execution.status,'succeeded');assert.equal(hash(f.dump()),saved);assert((await request(f.app,path,{cookie:f.cookie(f.owner)})).bytes.equals(before.bytes));
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.target.id);const denied=await request(f.app,path+'?view=mobile',{cookie:f.cookie(f.member),headers:{'if-none-match':mobile.headers.etag}});assert.equal(denied.status,404);assert.equal(denied.json.code,'GROUP_MOBILE_SCOPE_REQUIRED');assert(denied.bytes.length<500);
  f.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(f.target.id);delete a.payload.nativeOperation;f.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify(a.payload),a.actionId);const unbound=await request(f.app,path+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(unbound.status,409);assert.equal(unbound.json.code,'GROUP_MOBILE_RECEIPT_INVALID');assert(unbound.bytes.length<500);
  t.diagnostic(`conversation full/mobile bytes: ${before.bytes.length}/${mobile.bytes.length}`);
});

test('auxiliary summaries preserve uncertain and cancelled proof without inventing state; generic mobile reads stay unchanged',async t=>{
  const f=fixture(t);f.initialize();const a=f.action({status:'failed',error:'Original uncertain error'});a.result.code='EXECUTION_UNCERTAIN';a.result.executionState='uncertain';a.result.processExit.treeConfirmed=false;f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(a.result),a.actionId);
  const path=`/api/workspaces/${f.slug}/bots/${f.source.id}`,response=await request(f.app,path+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(response.status,200);const run=response.json.latest_run;assert.equal(run.status,'failed');assert.equal(run.error,'Original uncertain error');for(const key of ['code','executionState','processExit','stopConfirmed','botIsolation','unknownResultProof'])assert.deepEqual(run.result[key],a.result[key]);
  a.result.stopConfirmed=true;a.result.processExit.cancelled=true;f.db.prepare("UPDATE a2a_actions SET status='cancelled',result_json=? WHERE id=?").run(JSON.stringify(a.result),a.actionId);const stop=await request(f.app,path+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(stop.json.latest_run.status,'cancelled');assert.equal(stop.json.latest_run.result.stopConfirmed,true);assert.equal(stop.json.latest_run.result.processExit.cancelled,true);
  const generic=f.action({type:'conversation.execute',payload:{nativeOperation:undefined},result:{output:'Existing generic full text',unknownResultProof:{keep:true}}}),full=f.repo.getA2AAction(generic.actionId);assert.equal(f.view.run(f.slug,full,{}),full);
});

test('event IDs follow actual native hosted_rooms canonical 128-character contract, rather than wider API idempotency keys',async t=>{
  const f=fixture(t),a=f.action();for(let index=0;index<a.log.events.length;index++)a.log.events[index].event_id=['native.request:_-','n'.repeat(128),'dterminal:deadbeef'][index];f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(a.result),a.actionId);
  const response=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(response.status,200);assert.equal(response.json.result.nativeOperation.data.historyPointer.eventCount,3);
  for(const invalid of ['.native-request','_native-request',':native-request','n'.repeat(129),'native/id']){a.log.events[0].event_id=invalid;f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(a.result),a.actionId);const rejected=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(rejected.status,409);assert.equal(rejected.json.code,'GROUP_MOBILE_RECEIPT_INVALID');}
});

test('native groups.list room/member shape remains available and rechecks the entire visible roster',async t=>{
  const f=fixture(t);f.initialize();const sample=f.action(),room={...sample.room,revision:1,created_at:1710000000,updated_at:1710000001,idempotent:false,latest_seq:3};
  for(const member of room.members)Object.assign(member,{handle:member.member_id,display_name:member.member_id,target:{kind:'local',profile:member.profile}});
  const a=f.action({resource:'groups',operation:'list',input:{},data:{items:[room]}}),full=await request(f.app,a.url,{cookie:f.cookie(f.owner)}),mobile=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.owner)});assert.equal(mobile.status,200);assert(mobile.bytes.equals(full.bytes));assert.equal(mobile.json.result.nativeOperation.data.items[0].members.length,2);
  const bot=await request(f.app,`/api/workspaces/${f.slug}/bots/${f.source.id}?view=mobile`,{cookie:f.cookie(f.owner)});assert.equal(bot.status,200);assert.deepEqual(bot.json.nativeResources.groups.data.items,[room]);
  f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.target.id);const hidden=await request(f.app,a.url+'?view=mobile',{cookie:f.cookie(f.member)});assert.equal(hidden.status,404);assert.equal(hidden.json.code,'GROUP_MOBILE_SCOPE_REQUIRED');assert(hidden.bytes.length<500);
});
