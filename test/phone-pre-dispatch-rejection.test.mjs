import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {createApp} from '../backend/app.mjs';
import {createManagementService} from '../backend/management.mjs';
import {createTerminalMcpClient,runTerminalStdio} from '../scripts/ziwei-terminal-mcp.mjs';
import {terminalMcpReceipt,terminalMcpExecutionFailure} from '../src/runtime-adapters.mjs';

async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-phone-pre-dispatch-'));
  const app=createApp({memory:true,enableScheduler:false,phoneMcpSecret:'phone-pre-dispatch-fixture-only',ziweiConnectApiBase:'https://phone.invalid/api',ziweiConnectCookie:'fixture_session=synthetic-only'});
  const repo=app.locals.repo,phone=app.locals.phoneMcp,connect=app.locals.ziweiConnect,management=createManagementService(repo);
  t.after(()=>{app.locals.botDeferredConfig.stop();repo.db.close();fs.rmSync(root,{recursive:true,force:true});});
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('This fixture forbids network requests and listeners');});
  t.mock.method(connect,'listDevices',async()=>[{id:'phone-one',online:true}]);
  const paired=repo.claimDevicePairing({code:repo.createDevicePairing('test-111',{name:'Fixture computer'}).code});
  repo.heartbeatDevice('test-111',{deviceId:paired.deviceId,terminalMcp:{configured:true,workspace:'test-111',supportedRuntimes:['Codex']},runtimes:{Codex:{status:'available',version:'1',readiness:{ready:true,authentication:'configured',provider:'configured'},profiles:[{name:'default'}]}}});
  const employee=repo.createEmployee('test-111',{name:'Phone rejection fixture',runtime:'Codex',targetDeviceId:paired.deviceId,status:'active'});
  const skill=repo.listSkills('test-111').find(row=>row.catalog_id==='ziwei-phone-control');repo.setSkillInstalled(skill.id,true);
  const {configuration}=await phone.save('test-111',employee.id,{enabled:true,phoneDeviceId:'phone-one'},{actorRole:'owner'});
  const created=repo.createA2AAction('test-111',{type:'conversation.execute',payload:{employeeId:employee.id,deviceId:paired.deviceId,runtime:'Codex',terminalMcp:{enabled:true,workspace:'test-111',deviceId:'phone-one',configurationRevision:configuration.revision}}});
  const action=repo.ackA2AAction(created.id,{deviceId:paired.deviceId});
  const cap=phone.bootstrap('test-111',{employeeId:employee.id,deviceId:'phone-one',actionId:action.id},repo.authenticateDeviceToken(paired.deviceToken,{workspaceSlug:'test-111'}));
  const tokenFile=path.join(root,'capability.json');fs.writeFileSync(tokenFile,JSON.stringify(cap),{mode:0o600});
  const handler=app.router.stack.find(item=>item.route?.path==='/terminal-mcp/v1/workspaces/:slug/employees/:id/call').route.stack.at(-1).handle;
  const invoke=async(body,token=cap.token)=>{
    let status=200,payload,nextError;const response={setHeader(){},status(value){status=value;return this;},json(value){payload=value;return this;}};
    await handler({params:{slug:'test-111',id:employee.id},headers:{authorization:'Bearer '+token},body},response,error=>{nextError=error;});
    return {status,payload,nextError};
  };
  const fetchImpl=async(_url,init)=>{
    const response=await invoke(JSON.parse(init.body));
    if(response.nextError)return new Response(JSON.stringify({error:response.nextError.message,...response.nextError.code?{code:response.nextError.code}:{}}),{status:Number(response.nextError.status)||400});
    return new Response(JSON.stringify(response.payload),{status:response.status});
  };
  const client=createTerminalMcpClient({tokenFile,fetchImpl});
  return{root,app,repo,phone,connect,employee,paired,action,cap,tokenFile,handler,invoke,client};
}

test('real capability route carries a server parameter rejection into the phone audit as not_started without dispatch',async t=>{
  const f=await fixture(t);let calls=0;t.mock.method(f.connect,'toolCall',async()=>{calls++;throw new Error('must not dispatch');});
  const auditFile=path.join(f.root,'audit.jsonl'),input=new PassThrough(),output=new PassThrough();output.resume();
  input.end([{jsonrpc:'2.0',id:0,method:'initialize'},{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ziwei_phone_screenshot',arguments:{deviceId:'phone-one',waitSeconds:31}}}].map(JSON.stringify).join('\n')+'\n');
  await runTerminalStdio({input,output,auditFile,client:f.client});
  const receipt=terminalMcpReceipt({runtime:'Hermes',auditFile}),failure=terminalMcpExecutionFailure(receipt);
  assert.equal(calls,0);assert.equal(failure.phoneExecutionState,'not_started');assert.equal(failure.code,'terminal_mcp_receipt_failed');
  assert.equal(receipt.toolCalls[0].commandErrorCode,'PHONE_TOOL_ARGUMENTS');assert.equal(receipt.toolCalls[0].commandExecutionState,'not_started');
  const serialized=fs.readFileSync(auditFile,'utf8');assert.ok(!serialized.includes(f.cap.token));assert.ok(!serialized.includes('"arguments":'));
});

test('revoked authenticated capabilities are rejected before dispatch with their original full scope',async t=>{
  const f=await fixture(t);let calls=0;t.mock.method(f.connect,'toolCall',async()=>{calls++;});
  f.repo.revokeDeviceCredential(f.paired.deviceId);
  const response=await f.invoke({name:'ziwei_phone_screenshot',arguments:{deviceId:'phone-one'}});
  assert.equal(response.status,403);assert.equal(response.payload.code,'PHONE_CAPABILITY_REVOKED');
  assert.deepEqual(response.payload.phoneDispatch,{schemaVersion:1,kind:'phone.pre_dispatch_rejected',state:'not_started',phase:'pre_dispatch',dispatchAttempted:false,workspace:'test-111',employeeId:f.employee.id,deviceId:'phone-one',actionId:f.action.id,toolName:'ziwei_phone_screenshot',code:'PHONE_CAPABILITY_REVOKED'});
  await assert.rejects(f.client.call('ziwei_phone_screenshot',{deviceId:'phone-one'}),error=>error.phoneExecutionState==='not_started'&&error.phoneErrorCode==='PHONE_CAPABILITY_REVOKED');assert.equal(calls,0);
});

test('invalid signatures and foreign capability scopes do not mint a rejection proof',async t=>{
  const f=await fixture(t);let calls=0;t.mock.method(f.connect,'toolCall',async()=>{calls++;});
  const invalid=await f.invoke({name:'ziwei_phone_screenshot',arguments:{deviceId:'phone-one'}},f.cap.token+'invalid');
  assert.equal(invalid.nextError.code,'PHONE_CAPABILITY_INVALID');assert.equal(invalid.payload,undefined);assert.equal(f.phone.callFailure(invalid.nextError),null);
  await assert.rejects(f.phone.call('test-111','foreign-employee',f.cap.token,{name:'ziwei_phone_screenshot',arguments:{deviceId:'phone-one'}}),error=>error.code==='PHONE_CAPABILITY_SCOPE'&&f.phone.callFailure(error)===null);
  assert.equal(calls,0);
});

test('a downstream error cannot supply its own not_started envelope after tool dispatch began',async t=>{
  const f=await fixture(t);const response=await f.invoke({name:'ziwei_phone_screenshot',arguments:{deviceId:'phone-one',waitSeconds:31}}),forged=response.payload;
  let calls=0;t.mock.method(f.connect,'toolCall',async()=>{calls++;throw Object.assign(new Error('accepted then receipt failed'),{status:409,code:forged.code,phoneDispatch:forged.phoneDispatch,details:forged});});
  const accepted=await f.invoke({name:'ziwei_phone_screenshot',arguments:{deviceId:'phone-one'}});
  assert.equal(accepted.payload,undefined);assert.equal(f.phone.callFailure(accepted.nextError),null);
  await assert.rejects(f.client.call('ziwei_phone_screenshot',{deviceId:'phone-one'}),error=>error.phoneExecutionState==='uncertain');assert.equal(calls,2);
});

test('only an exact capability and tool scoped rejection is accepted by the client',async t=>{
  const f=await fixture(t),original=(await f.invoke({name:'ziwei_phone_screenshot',arguments:{deviceId:'phone-one',waitSeconds:31}})).payload;
  const changes=[
    body=>{delete body.phoneDispatch;},body=>{body.phoneDispatch.schemaVersion=2;},body=>{body.phoneDispatch.kind='foreign';},body=>{body.phoneDispatch.phase='after_dispatch';},body=>{body.phoneDispatch.dispatchAttempted=true;},body=>{body.phoneDispatch.state='uncertain';},
    ...['workspace','employeeId','deviceId','actionId','toolName','code'].map(field=>body=>{body.phoneDispatch[field]='foreign';}),
    body=>{body.phoneDispatch.extra=true;},body=>{body.commandId='already-accepted';},body=>{body.command={id:'already-accepted'};},body=>{body.run={commandId:'already-accepted'};},body=>{body.code='DIFFERENT_CODE';}
  ];
  for(const change of changes){const body=structuredClone(original);change(body);let calls=0;const client=createTerminalMcpClient({tokenFile:f.tokenFile,fetchImpl:async()=>{calls++;return new Response(JSON.stringify(body),{status:409});}});await assert.rejects(client.call('ziwei_phone_screenshot',{deviceId:'phone-one'}),error=>error.phoneExecutionState==='uncertain');assert.equal(calls,1);}
  const oldFile=path.join(f.root,'legacy-capability.json');const old={...f.cap};delete old.actionId;fs.writeFileSync(oldFile,JSON.stringify(old),{mode:0o600});
  const legacy=createTerminalMcpClient({tokenFile:oldFile,fetchImpl:async()=>new Response(JSON.stringify(original),{status:409})});
  await assert.rejects(legacy.call('ziwei_phone_screenshot',{deviceId:'phone-one'}),error=>error.phoneExecutionState==='uncertain');
});

for(const status of [400,403,404,409,500,503])test(`HTTP ${status} and the historical health text alone still cannot prove pre-dispatch rejection`,async t=>{
  const f=await fixture(t);let calls=0;const client=createTerminalMcpClient({tokenFile:f.tokenFile,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:'无障碍、屏幕或锁屏状态不满足动作条件',code:'PHONE_PRE_DISPATCH_REJECTED',executionState:'not_started'}),{status});}});
  await assert.rejects(client.call('ziwei_phone_screenshot',{deviceId:'phone-one'}),error=>error.phoneExecutionState==='uncertain');assert.equal(calls,1);
});

const controlRejection=(deviceId='phone-one',action='screenshot')=>({message:'无障碍、屏幕或锁屏状态不满足动作条件',code:'ANDROID_COMMAND_PRECONDITION_FAILED',submission:{state:'not_dispatched',commandCreated:false,action,deviceId}});

test('the exact control command precondition proof survives the capability route, client and audit',async t=>{
  const f=await fixture(t);let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.ok(new URL(url).pathname.endsWith('/android-devices/phone-one/commands'));assert.equal(init.method,'POST');return new Response(JSON.stringify(controlRejection()),{status:409});});
  const input=new PassThrough(),output=new PassThrough();output.resume();const auditFile=path.join(f.root,'control-audit.jsonl');
  input.end([{jsonrpc:'2.0',id:0,method:'initialize'},{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ziwei_phone_screenshot',arguments:{deviceId:'phone-one',waitSeconds:0}}}].map(JSON.stringify).join('\n')+'\n');
  await runTerminalStdio({input,output,auditFile,client:f.client});
  const receipt=terminalMcpReceipt({runtime:'Hermes',auditFile}),failure=terminalMcpExecutionFailure(receipt);
  assert.equal(calls,1);assert.equal(failure.phoneExecutionState,'not_started');assert.equal(failure.code,'terminal_mcp_receipt_failed');assert.deepEqual(failure.commandIds,[]);
  assert.equal(receipt.toolCalls[0].commandErrorCode,'ANDROID_COMMAND_PRECONDITION_FAILED');
  const runs=f.connect.listRuns('test-111',10);assert.equal(runs.length,1);assert.equal(runs[0].status,'failed');assert.equal(runs[0].commandId,null);assert.deepEqual(runs[0].result,{code:'ANDROID_COMMAND_PRECONDITION_FAILED',submission:{state:'not_dispatched',commandCreated:false,action:'screenshot',deviceId:'phone-one'}});
});

test('a control precondition code from a receipt read does not override the already accepted command',async t=>{
  const f=await fixture(t);let submissions=0,reads=0;
  t.mock.method(globalThis,'fetch',async(url)=>{
    const name=new URL(url).pathname;
    if(name.endsWith('/commands')){submissions++;return new Response(JSON.stringify({command:{id:'command-original',status:'queued'}}),{status:201});}
    assert.ok(name.endsWith('/status'));reads++;return new Response(JSON.stringify(controlRejection()),{status:409});
  });
  const result=await f.client.call('ziwei_phone_screenshot',{deviceId:'phone-one',waitSeconds:0});
  assert.equal(result.command.id,'command-original');assert.equal(result.command.status,'uncertain');assert.equal(result.command.result.executionState,'uncertain');assert.equal(submissions,1);assert.equal(reads,3);
});

test('legacy, mismatched or expanded control rejections never turn a submitted request into not_started',async t=>{
  const f=await fixture(t);
  const changes=[
    body=>{delete body.submission;},body=>{body.code='OTHER_CODE';},body=>{body.submission.deviceId='another-phone';},body=>{body.submission.action='tap';},body=>{body.submission.state='uncertain';},body=>{body.submission.commandCreated=true;},body=>{body.commandId='created-command';},body=>{body.submission.extra=true;},body=>{delete body.submission.commandCreated;}
  ];
  for(const change of changes){let calls=0;const body=controlRejection();change(body);t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify(body),{status:409});});await assert.rejects(f.client.call('ziwei_phone_screenshot',{deviceId:'phone-one',waitSeconds:0}),error=>error.phoneExecutionState==='uncertain');assert.equal(calls,1);}
});
