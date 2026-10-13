import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createBotGatewayManager} from '../src/hermes-gateway-runtime.mjs';

async function fixture(t,platform='mattermost'){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'gateway-health-')),child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:1234});
  const writes=[];child.stdin.on('data',data=>writes.push(JSON.parse(String(data))));let finish;
  const completionEvidence=new Promise(resolve=>{finish=(extra={})=>resolve({rootConfirmed:true,treeConfirmed:true,activeProcesses:0,...extra});});
  const manager=createBotGatewayManager({apiBase:'http://fixture.invalid',workspace:'test',deviceToken:'fixture'},{nativeSpawn:()=>({prepared:{home},cleanup(){}}),spawnSupervisedRuntime:()=>({child,completionEvidence,stop:()=>{finish();return completionEvidence;}})});
  t.after(async()=>{await manager.close();fs.rmSync(home,{recursive:true,force:true});});
  const context={employeeId:'source',revision:1,controlEpoch:1},options={context,operation:{resource:'gateway',operation:'connect',input:{platform}}};
  const emit=event=>child.stdout.write('ZIWEI_GATEWAY_EVENT:'+JSON.stringify(event)+'\n');
  const connecting=manager.operate({id:'connection'},options);await new Promise(resolve=>setImmediate(resolve));emit({event:'connected',status:'connected',pid:1234});assert.equal((await connecting).connected,true);
  return{manager,context,options,emit,writes,finish};
}
test('alive worker reports failed channel, rejects ingress and outbound, retains exit proof',async t=>{
  const f=await fixture(t),original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw new Error('must not dispatch');};t.after(()=>{globalThis.fetch=original;});
  f.emit({event:'failed',status:'failed',code:'mattermost_auth_error'});
  assert.equal(f.manager.status(f.context)[0].status,'failed');assert.equal(f.manager.status(f.context)[0].processAlive,true);
  f.emit({event:'inbound',chatId:'chat',messageId:'late',content:'late'});
  await assert.rejects(f.manager.operate({id:'send'},{...f.options,operation:{operation:'outbound',input:{platform:'mattermost',chatId:'chat',content:'late'}}}),/Gateway/);
  assert.equal(requests,0);f.finish();await new Promise(resolve=>setImmediate(resolve));
  const status=f.manager.status(f.context)[0];assert.equal(status.status,'failed');assert.equal(status.processAlive,false);assert.equal(status.processExit.treeConfirmed,true);
});
test('channel failure while reading original inbound result does not send or replay',async t=>{
  const f=await fixture(t),original=globalThis.fetch;let reads=0,ingress=0;globalThis.fetch=async(url)=>({ok:true,json:async()=>{if(url.endsWith('bot-gateway-ingress')){ingress++;return{delivery:{status:'dispatched',action:{id:'original'}}};}reads++;f.emit({event:'status',status:'retrying',code:'GATEWAY_RECEIVE_PATH_UNCONFIRMED'});return{status:'succeeded',result:{output:'original reply'}};}});t.after(()=>{globalThis.fetch=original;});
  f.emit({event:'inbound',chatId:'chat',messageId:'one',content:'one'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ingress,1);assert.equal(reads,1);assert.equal(f.writes.filter(item=>item.operation==='send').length,0);assert.equal(f.manager.status(f.context)[0].status,'retrying');
});
for(const operation of ['disconnect','close'])test(`buffered connected events cannot reopen admission during ${operation}`,async t=>{
  const f=await fixture(t),original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw new Error('late ingress');};t.after(()=>{globalThis.fetch=original;});
  const stopping=operation==='close'?f.manager.close():f.manager.operate({id:'stop'},{...f.options,operation:{operation:'disconnect',input:{platform:'mattermost'}}});
  await new Promise(resolve=>setImmediate(resolve));f.emit({event:'heartbeat',status:'connected'});f.emit({event:'inbound',chatId:'chat',messageId:'buffered',content:'late'});
  assert.notEqual(f.manager.status(f.context)[0].status,'connected');assert.equal(requests,0);f.finish();await stopping;
});
test('closed worker with unknown tree keeps stop uncertain and blocks a new connection',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);f.finish({treeConfirmed:false,activeProcesses:null});await new Promise(resolve=>setImmediate(resolve));
  const result=await f.manager.operate({id:'stop'},{...f.options,operation:{operation:'disconnect',input:{platform:'mattermost'}}});
  assert.equal(result.stopConfirmed,false);assert.equal(result.code,'EXECUTION_UNCERTAIN');
  assert.equal(f.manager.status(f.context)[0].processAlive,null);
  assert.equal((await f.manager.operate({id:'new-connection'},f.options)).code,'EXECUTION_UNCERTAIN');
});
test('recovery buffered with send rejection resumes original message after old observer exits',async t=>{
  const f=await fixture(t),original=globalThis.fetch;let ingress=0;globalThis.fetch=async(url)=>({ok:true,json:async()=>url.endsWith('bot-gateway-ingress')?(ingress++,{delivery:{status:'dispatched',action:{id:'original'}}}):url.endsWith('bot-gateway-lease')?{allowed:true}:{status:'succeeded',result:{output:'original reply'}}});t.after(()=>{globalThis.fetch=original;});
  const incoming={event:'inbound',chatId:'chat',messageId:'one',content:'one'};f.emit(incoming);await new Promise(resolve=>setImmediate(resolve));const first=f.writes.find(item=>item.operation==='send');assert.ok(first);
  f.emit({event:'status',status:'retrying'});f.emit({event:'command_result',commandId:first.commandId,success:false,code:'GATEWAY_NOT_CONNECTED'});f.emit({event:'connected',status:'connected'});f.emit(incoming);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(ingress,2);const attempts=f.writes.filter(item=>item.operation==='send');assert.equal(attempts.length,2);f.emit({event:'command_result',commandId:attempts[1].commandId,success:true});
});
test('unconfirmed Slack receive probe propagates and closes both admission gates',async t=>{
  const f=await fixture(t,'slack'),original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw new Error('must not dispatch');};t.after(()=>{globalThis.fetch=original;});
  f.emit({event:'heartbeat',status:'unconfirmed',code:'GATEWAY_HEALTH_PROBE_UNAVAILABLE'});
  assert.equal(f.manager.status(f.context)[0].status,'unconfirmed');
  f.emit({event:'inbound',chatId:'chat',messageId:'unknown',content:'fixture'});
  await assert.rejects(f.manager.operate({id:'send'},{...f.options,operation:{operation:'outbound',input:{platform:'slack',chatId:'chat',content:'fixture'}}}),/Gateway/);
  assert.equal(requests,0);f.emit({event:'connected',status:'connected'});assert.equal(f.manager.status(f.context)[0].status,'connected');
});

test('maintenance sees resident workers and retains exact exit identity',async t=>{
  const f=await fixture(t);
  assert.equal(typeof f.manager.maintenanceStatus,'function');
  assert.equal(f.manager.maintenanceStatus().safe,false);
  f.finish({launched:true,rootExitCode:0});await new Promise(resolve=>setImmediate(resolve));
  const status=f.manager.maintenanceStatus();assert.equal(status.safe,true);
  assert.equal(status.workers[0].sourceActionId,'connection');assert.ok(status.workers[0].workerNonce);
});
