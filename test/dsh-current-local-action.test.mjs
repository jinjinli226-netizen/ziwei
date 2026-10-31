import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {dshFixture} from './fixtures/dsh-protocol.mjs';
import {EventEmitter} from 'node:events';

class RelaySocket extends EventEmitter {
  static all=[];
  constructor(url){super();this.url=url;this.sent=[];this.readyState=0;this.closed=false;RelaySocket.all.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
  send(value){this.sent.push(value);}
  close(code=1000,reason=''){if(this.closed)return;this.closed=true;this.readyState=3;this.emit('close',code,reason);}
  deliver(value){this.emit('message',Buffer.from(JSON.stringify(value)));}
}

test('local DSH branch uses the real profile and local endpoint before any Hermes or Codex preparation',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-local-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let selected;
  const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshBaseUrl:'http://local-config.invalid',managementBootstrap:{prepare(){throw Error('must not prepare another runtime MCP');}},dshRuntime:async options=>{selected=options;return {status:'succeeded',output:'done',sessionId:'session-1'};}});
  t.after(()=>execute.close());
  const result=await execute({id:'dsh-local-1',type:'conversation.execute',payload:{runtime:'DSH',profile:'real-bot',employeeName:'display alias',prompt:'check',dshBaseUrl:'http://payload.invalid',runtimeSessionId:'session-existing',employeeId:'employee-one',conversationId:'conv-one',workdir:directory}});
  assert.equal(result.status,'succeeded');assert.equal(selected.botName,'real-bot');assert.equal(selected.baseUrl,'http://local-config.invalid');assert.equal(selected.sessionId,'session-existing');
  assert.deepEqual(selected.sessionAuthority,{actionId:'dsh-local-1',employeeId:'employee-one',conversationId:'conv-one'});
});

test('local DSH refuses a display name without a native Bot binding',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-missing-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshRuntime:()=>{throw Error('must not call runtime');}});t.after(()=>execute.close());
  await assert.rejects(execute({id:'dsh-missing',type:'conversation.execute',payload:{runtime:'DSH',employeeName:'alias',prompt:'check'}}),/真实 Bot|绑定/);
});

test('local DSH executor and dispatcher use the native session evidence end to end',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-end-to-end-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const f=await dshFixture(t);
  const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshBaseUrl:f.baseUrl,dshRuntime:options=>executeDshRuntime({...options,...f.transport})});t.after(()=>execute.close());
  const dispatcher=new ActionDispatcher({execute,workdir:directory});
  const result=await dispatcher.dispatch({id:'dsh-local-end-to-end',type:'conversation.execute',payload:{runtime:'DSH',runtime_profile:'real-bot',employeeId:'employee-one',conversationId:'conv-one',prompt:'check'}});
  assert.equal(result.status,'succeeded');assert.equal(result.result.output,'DSH 完成');assert.equal(result.result.sessionExit.botName,'real-bot');
  assert.equal(result.result.processExit,undefined);
});

test('local DSH sends image attachments as native image blocks instead of prompt paths',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-image-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const f=await dshFixture(t),data=Buffer.from('isolated-image-content').toString('base64');
 const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshBaseUrl:f.baseUrl,dshRuntime:options=>executeDshRuntime({...options,...f.transport})});t.after(()=>execute.close());
 const result=await execute({id:'dsh-image',type:'conversation.execute',payload:{runtime:'DSH',profile:'real-bot',prompt:'看这张图',attachments:[{name:'example.png',mimeType:'image/png',contentBase64:data}]}});
 assert.equal(result.status,'succeeded');
 assert.deepEqual(f.calls.find(call=>call.method==='session/prompt').payload.args.request.content,[{type:'text',text:'看这张图'},{type:'image',mediaType:'image/png',data,name:'example.png'}]);
});
test('local DSH sends UTF-8 text and JSON attachments as native text blocks and rejects unsupported office media',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-text-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const f=await dshFixture(t),execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshBaseUrl:f.baseUrl,dshRuntime:options=>executeDshRuntime({...options,...f.transport})});t.after(()=>execute.close());
 const utf8=Buffer.from('标题\n内容：跨端同步').toString('base64'),json=Buffer.from(JSON.stringify({ok:true,source:'native'})).toString('base64');
 const result=await execute({id:'dsh-text',type:'conversation.execute',payload:{runtime:'DSH',profile:'real-bot',prompt:'读取文本',attachments:[{name:'notes.txt',mimeType:'text/plain',contentBase64:utf8},{name:'data.json',mimeType:'application/json',contentBase64:json}]}});
 assert.equal(result.status,'succeeded');
 assert.deepEqual(f.calls.find(call=>call.method==='session/prompt').payload.args.request.content,[{type:'text',text:'读取文本'},{type:'text',text:'[附件 notes.txt]\n标题\n内容：跨端同步'},{type:'text',text:'[附件 data.json]\n{"ok":true,"source":"native"}'}]);
 const rejected=await execute({id:'dsh-pdf',type:'conversation.execute',payload:{runtime:'DSH',profile:'real-bot',prompt:'读取文档',attachments:[{name:'guide.pdf',mimeType:'application/pdf',contentBase64:Buffer.from('pdf').toString('base64')}]}}).catch(error=>error);
 assert.match(rejected.message,/仅支持PNG|文本/);
});
test('local DSH prepares the native plugin UI host and validates its bound mount receipt',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-plugin-ui-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const subject={schemaVersion:1,workspace:'fixture-workspace',workspaceId:'fixture-workspace-id',employeeId:'employee-one',ownerUserId:'owner-one',deviceId:'device-one',profile:'real-bot',runtime:'DSH'};
 const payload={workspace:'fixture-workspace',workspaceId:'fixture-workspace-id',deviceId:'device-one',dshOperation:{schemaVersion:1,subject,scope:{kind:'bot'},resource:'plugins',operation:'prepareUiHost',input:{},requestedBy:{userId:'owner-one',role:'owner',deviceScope:'device-one'}}};
 const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
 let mode='good';
 const fetchImpl=async(url,options)=>{assert.equal(url,'http://native.fixture/api/bots/real-bot/plugin-ui/prepare');assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{});return mode==='good'?response({ok:true,application:'applied',version:'0.1.0',bridgePackage:'@dshbot/plugin-ui-host',mountBase:'/runtime/real-bot/ui/',receipt:{application:'applied',bundle:'@dshbot/plugin-ui-host'}}):response({ok:true,application:'applied',version:'0.1.0',bridgePackage:'@dshbot/plugin-ui-host',mountBase:'/runtime/other-bot/ui/'})};
 const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,workspace:'fixture-workspace',deviceId:'device-one',admissionHandledByDispatcher:true,dshBaseUrl:'http://native.fixture',dshPluginFetch:fetchImpl});t.after(()=>execute.close());
 const good=await execute({id:'dsh-plugin-ui-good',type:'employee.dsh.operation',payload});assert.equal(good.status,'succeeded',JSON.stringify(good));assert.equal(good.result.dshNative.status,'applied');assert.equal(good.result.dshNative.data.mountBase,'/runtime/real-bot/ui/');
 mode='forged-mount';const forged=await execute({id:'dsh-plugin-ui-forged',type:'employee.dsh.operation',payload});assert.equal(forged.status,'failed',JSON.stringify(forged));assert.equal(forged.error,'DSH_NATIVE_OPERATION_UNCONFIRMED');
});
test('local executor keeps the bound DSH UI relay action alive until the server closes it',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-relay-action-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));RelaySocket.all=[];
 const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,workspace:'fixture-workspace',apiBase:'http://server.fixture',deviceId:'device-one',deviceToken:'device-secret',dshBaseUrl:'http://native.fixture',dshPluginUiWebSocket:RelaySocket,dshPluginFetch:async()=>{throw Error('no local request expected');},admissionHandledByDispatcher:true});t.after(()=>execute.close());
 const action={id:'relay-action-1',workspace:'fixture-workspace',type:'employee.dsh.ui.relay.open',payload:{workspace:'fixture-workspace',employeeId:'employee-one',deviceId:'device-one',profile:'real-bot',viewKey:'v'.repeat(16),relayId:'relay-one',expiresAt:new Date(Date.now()+60_000).toISOString()}};
 const running=execute(action);await new Promise(resolve=>setImmediate(resolve));const socket=RelaySocket.all[0];assert.match(JSON.parse(socket.sent[0]).protocol,/dsh-plugin-ui-relay-v1/);assert.equal(JSON.parse(socket.sent[0]).deviceId,'device-one');assert.equal(JSON.parse(socket.sent[0]).workspace,'fixture-workspace');socket.deliver({type:'ready',relayId:'relay-one',accepted:true});socket.deliver({type:'close',relayId:'relay-one',reason:'browser_closed'});const result=await running;assert.equal(result.status,'succeeded');assert.equal(result.result.closedReason,'browser_closed');
});
test('a group member without an employee directory uses its own native Bot work directory',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-group-cwd-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const memberDirectory=path.join(directory,'member-work');fs.mkdirSync(memberDirectory);let selected;
 const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshPluginFetch:async url=>{assert.equal(url,'http://127.0.0.1:7878/api/state');return Response.json({bots:[{name:'member-b',workdir:memberDirectory}]});},dshRuntime:async options=>{selected=options;return{status:'succeeded'};}});t.after(()=>execute.close());
 await execute({id:'child-group',type:'conversation.execute',payload:{runtime:'DSH',profile:'member-b',employeeId:'eb',conversationId:'group-conv',prompt:'group discussion',dshGroup:{schemaVersion:1,sourceActionId:'group-parent',groupId:'g',memberProfile:'member-b'}}});
 assert.equal(selected.cwd,memberDirectory);assert.equal(selected.botName,'member-b');
});
