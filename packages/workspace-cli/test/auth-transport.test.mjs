import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
const main=await import('../src/main.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const cfg=await import('../src/config.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const origin='https://workspace.example.test';
const expiresAt=new Date(Date.now()+1800000).toISOString();
const claims={audience:'ziwei-management',workspace:'team',deviceId:'fixture-device',credentialId:'fixture-credential',expiresAt};
// Original wire format with a random fixture signature; no real issuer or signing key.
const secret=`zmcp1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${crypto.randomBytes(32).toString('base64url')}`;
const imported=()=>({managed:true,token:secret,workspace:'team',audience:'ziwei-management',deviceId:'fixture-device',apiBase:origin,expiresAt});
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-auth-'));try{await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
async function call(root,args,options={}){
  assert.equal(typeof main.runCli,'function','CLI injectable runner must exist');
  let stdout='',stderr='';const result=await main.runCli([...args,'--api',origin],{env:{ZIWEI_WORKSPACE_CONFIG_DIR:root},stdout:v=>{stdout+=v;},stderr:v=>{stderr+=v;},readStdin:async()=>'',...options});
  return{...result,stdout,stderr,json:JSON.parse(stdout)};
}
async function loginManaged(root,overrides={},args=[]){return call(root,['auth','login','--mode','managed','--purpose','employee','--managed-stdin',...args],{readStdin:async()=>JSON.stringify({...imported(),...overrides})});}
test('native login stores only the Set-Cookie session, then status actually verifies /api/auth/me',()=>fixture(async root=>{
  let loginBody;const login=await call(root,['auth','login','--email','person@example.test','--password-stdin','--workspace','team'],{readStdin:async()=>secret,fetchImpl:async(url,init)=>{
    assert.equal(new URL(url).pathname,'/api/auth/login');loginBody=JSON.parse(init.body);return new Response(JSON.stringify({user:{id:'usr-1',email:'person@example.test'},memberships:[{slug:'team',role:'member'}],session:{expires_at:new Date(Date.now()+60000).toISOString()}}),{headers:{'set-cookie':`ziwei_session=${secret}; Path=/; HttpOnly`}});
  }});
  assert.equal(login.exitCode,0);assert.equal(loginBody.password,secret);assert.ok(!login.stdout.includes(secret));
  let requests=0;const status=await call(root,['auth','status'],{fetchImpl:async(url,init)=>{requests++;assert.equal(new URL(url).pathname,'/api/auth/me');assert.equal(init.headers.cookie,`ziwei_session=${secret}`);return Response.json({user:{id:'usr-1'},memberships:[{slug:'team'}]});}});
  assert.equal(status.json.data.verification,'server');assert.equal(requests,1);assert.equal(status.json.data.identitySource,'legacy-native');
}));
test('native login cannot invent a session from response JSON or accept another workspace membership',()=>fixture(async root=>{
  const noCookie=await call(root,['auth','login','--email','person@example.test','--password-stdin','--workspace','team'],{readStdin:async()=>secret,fetchImpl:async()=>Response.json({token:secret,user:{id:'u'},memberships:[{slug:'team'}]})});
  assert.equal(noCookie.exitCode,7);assert.ok(!noCookie.stdout.includes(secret));
}));
test('managed import validates every scope boundary without automatic legacy token discovery',()=>fixture(async root=>{
  for(const patch of [{managed:false},{audience:'other-site'},{workspace:'wrong team'},{deviceId:''},{expiresAt:'2000-01-01'},{apiBase:'https://other.example.test'},{token:''}]){
    const r=await loginManaged(root,patch);assert.equal(r.exitCode,2,JSON.stringify(patch));assert.ok(!r.stdout.includes(secret));
  }
  const status=await call(root,['auth','status'],{env:{ZIWEI_WORKSPACE_CONFIG_DIR:root,ZIWEI_MCP_TOKEN:secret,ZIWEI_MCP_TOKEN_FILE:'do-not-open'}});
  assert.equal(status.exitCode,3);
}));
test('managed import accepts the original credentialId field and rejects relabelled static owner tokens',()=>fixture(async root=>{
  const original=await loginManaged(root,{credentialId:claims.credentialId});assert.equal(original.exitCode,0);
  const legacy=await loginManaged(root,{credentialId:claims.credentialId,token:'static-owner-fixture'});assert.equal(legacy.exitCode,2);
  const metadata=await loginManaged(root,{credentialId:'different-original-credential'});assert.equal(metadata.exitCode,2);
  const changed=await loginManaged(root,{expiresAt:new Date(Date.now()+7200000).toISOString()});assert.equal(changed.exitCode,2);
}));
test('managed server status calls original scoped health; local status never claims verification',()=>fixture(async root=>{
  assert.equal((await loginManaged(root)).exitCode,0);
  const local=await call(root,['auth','status','--purpose','employee','--local']);assert.equal(local.json.data.verification,'local');assert.equal(local.json.data.serverVerified,false);
  let calls=0;const server=await call(root,['auth','status','--purpose','employee'],{fetchImpl:async(url,init)=>{calls++;assert.equal(new URL(url).pathname,'/mcp/v1/workspaces/team/health');assert.equal(init.headers.authorization,`Bearer ${secret}`);return Response.json({ok:true,workspace:'team'});}});
  assert.equal(server.json.data.verification,'server');assert.equal(calls,1);assert.ok(!server.stdout.includes(secret));
}));
test('credentials are isolated by origin, profile, account and purpose; logout clears only selected slot',()=>fixture(async root=>{
  await loginManaged(root);
  for(const args of [['--profile','other'],['--account','other'],[]]){
    const purpose=args.length?['--purpose','employee']:[];
    assert.equal((await call(root,['auth','status','--local',...args,...purpose])).exitCode,3);
  }
  let stdout='';const other=await main.runCli(['auth','status','--api','https://different.example.test','--purpose','employee','--local'],{env:{ZIWEI_WORKSPACE_CONFIG_DIR:root},stdout:v=>{stdout+=v;}});assert.equal(other.exitCode,3);
  await loginManaged(root,{},['--profile','second']);
  const logout=await call(root,['auth','logout','--purpose','employee']);assert.equal(logout.json.data.localCleared,true);assert.equal(logout.json.data.remoteRevocation,'unsupported');
  assert.equal((await call(root,['auth','status','--purpose','employee','--local'])).exitCode,3);
  assert.equal((await call(root,['auth','status','--purpose','employee','--profile','second','--local'])).exitCode,0);
  assert.ok(!logout.stdout.includes(secret));
}));
test('public profile selects only the credential slot while native profile comes from business JSON',()=>fixture(async root=>{
  await loginManaged(root,{},['--profile','work']);let calls=0;
  const created=await call(root,['profiles','create','--profile','work','--purpose','employee','--input','{"profile":"new-native-profile","deviceId":"fixture-device","soul":"placeholder role"}'],{fetchImpl:async(url,init)=>{
    calls++;assert.equal(new URL(url).pathname,'/mcp/v1/workspaces/team/hermes/profiles/requests');assert.equal(init.headers.authorization,`Bearer ${secret}`);assert.equal(JSON.parse(init.body).profile,'new-native-profile');return Response.json({id:'profile-create-action',status:'pending'},{status:202});
  }});
  assert.equal(created.exitCode,0);assert.equal(calls,1);
  const stored=await call(root,['auth','status','--profile','work','--purpose','employee','--local']);assert.equal(stored.exitCode,0);assert.equal(stored.json.data.profile,'work');
  const missing=await call(root,['profiles','create','--profile','work','--purpose','employee','--input','{"deviceId":"fixture-device","soul":"placeholder role"}'],{fetchImpl:async()=>assert.fail('credential slot must never supply a native business profile')});assert.equal(missing.exitCode,2);
}));
test('unified login is explicitly pending and never calls a local issuer',()=>fixture(async root=>{
  const r=await call(root,['auth','login','--mode','unified'],{fetchImpl:async()=>assert.fail('no issuer exists')});assert.equal(r.exitCode,9);assert.equal(r.json.error.details.status,'pending');
}));
test('all native HTTP error classes preserve status/code and redact nested secrets and echoed credential strings',()=>fixture(async root=>{
  await loginManaged(root);
  for(const [status,exit]of [[400,2],[401,3],[403,4],[404,5],[409,6],[503,7],[501,9]]){
    const r=await call(root,['tasks','list','--purpose','employee'],{fetchImpl:async()=>Response.json({code:'NATIVE_TEST',error:`failed token=${secret}`,nested:{password:'never-print',array:[{apiKey:'never-print'}]}},{status})});
    assert.equal(r.exitCode,exit);assert.equal(r.json.error.httpStatus,status);assert.equal(r.json.error.nativeCode,'NATIVE_TEST');assert.ok(!r.stdout.includes(secret));assert.ok(!r.stdout.includes('never-print'));
  }
}));
test('all three business sources preserve exact long IDs and string money without conversion',()=>fixture(async root=>{
  await loginManaged(root);const input={title:'exact',employeeId:'9007199254740993123'};const file=path.join(root,'input.json');await fs.writeFile(file,JSON.stringify(input));
  for(const args of [['--input',JSON.stringify(input)],['--input-file',file],['--input-stdin']]){
    const r=await call(root,['tasks','create','--purpose','employee',...args],{readStdin:async()=>JSON.stringify(input),fetchImpl:async(_url,init)=>{assert.equal(JSON.parse(init.body).employeeId,input.employeeId);return Response.json({id:'task-1',...JSON.parse(init.body)});}});assert.equal(r.exitCode,0);
  }
  const bot=await call(root,['bots','native','--purpose','employee','--input',JSON.stringify({id:'9007199254740993123',data:{resource:'mcp',operation:'call',input:{server:'external',tool:'example',arguments:{amount:'10000000000.0123'}},expectedRevision:1,expectedControlEpoch:1,idempotencyKey:'k-1'}})],{fetchImpl:async(_url,init)=>{assert.equal(JSON.parse(init.body).input.arguments.amount,'10000000000.0123');return Response.json({action:{id:'action-1',status:'pending'}},{status:202});}});assert.equal(bot.exitCode,0);assert.equal(bot.json.data.operation.state,'accepted');
}));
test('Bot create uses original instance provisioning action instead of inventing an employee receipt',()=>fixture(async root=>{
  await loginManaged(root);
  const r=await call(root,['bots','create','--purpose','employee','--data','{"name":"example","targetDeviceId":"fixture-device","idempotencyKey":"new-bot"}'],{fetchImpl:async()=>Response.json({id:'employee-1',instance:{provisioning:{actionId:'provision-action-1',status:'pending'}}},{status:202})});
  assert.equal(r.json.data.operation.serverReceiptId,'provision-action-1');assert.match(r.json.data.operation.resultQuery.command,/provision-action-1/);assert.equal(r.json.data.operation.completed,false);
}));
test('Bot stop exposes only its correlated original stop action and Routine runs keep action and run IDs distinct',()=>fixture(async root=>{
  await loginManaged(root);
  const stopNative={id:'b',active_action_id:'running-original',stop_action:{id:'stop-original',type:'action.cancel',status:'pending',payload:{actionId:'running-original'}}};
  const stopped=await call(root,['bots','control','--purpose','employee','--id','b','--data','{"expectedRevision":1,"expectedControlEpoch":1,"operation":"stop"}'],{fetchImpl:async()=>Response.json(stopNative)});
  assert.ok(stopped.json.data.operation,'A correlated queued stop action needs an asynchronous view');assert.equal(stopped.json.data.operation.state,'accepted');assert.equal(stopped.json.data.operation.completed,false);assert.equal(stopped.json.data.operation.serverReceiptId,'stop-original');assert.match(stopped.json.data.operation.resultQuery.command,/stop-original/);
  const old=await call(root,['bots','control','--purpose','employee','--id','b','--data','{"expectedRevision":1,"expectedControlEpoch":1,"operation":"stop"}'],{fetchImpl:async()=>Response.json({...stopNative,active_action_id:null})});assert.equal(old.json.data.operation,undefined);
  const routine=await call(root,['bots','runRoutine','--purpose','employee','--id','b','--routineId','routine-original','--data','{"idempotencyKey":"routine-run"}'],{fetchImpl:async()=>Response.json({id:'autorun-original',action_id:'action-original',status:'queued'},{status:202})});
  assert.equal(routine.json.data.operation.serverReceiptId,'action-original');assert.equal(routine.json.data.operation.receiptKind,'action');assert.equal(routine.json.data.operation.nativeRunId,'autorun-original');assert.match(routine.json.data.operation.resultQuery.command,/action-original/);
}));
test('Bot native schema rejects unsupported operations before auth; secret references use original safe environment format',()=>fixture(async root=>{
  const invalid=await call(root,['bots','native','--input','{"id":"b","data":{"resource":"other-site","operation":"generate","expectedRevision":1,"expectedControlEpoch":1,"idempotencyKey":"x"}}'],{fetchImpl:async()=>assert.fail('invalid native operation must not dispatch')});assert.equal(invalid.exitCode,2);
  const rawRef=await call(root,['bots','update','--input','{"id":"b","data":{"expectedRevision":1,"config":{"gateway":{"platforms":{"example":{"tokenEnv":"raw-lowercase-secret"}}}}}}']);assert.equal(rawRef.exitCode,2);
  await loginManaged(root);
  const ref=await call(root,['bots','update','--purpose','employee','--input','{"id":"b","data":{"expectedRevision":1,"config":{"permissions":{"mode":"execute"},"mcpServers":{"external":{"command":"placeholder","env":{"EXTERNAL_API_KEY":"${EXTERNAL_API_KEY}"}}}}}}'],{fetchImpl:async(_url,init)=>{assert.equal(JSON.parse(init.body).config.mcpServers.external.env.EXTERNAL_API_KEY,'${EXTERNAL_API_KEY}');return Response.json({id:'b',revision:2});}});assert.equal(ref.exitCode,0);
}));
test('Bot mutation prerequisites and native field types fail before any credential or dispatch',()=>fixture(async root=>{
  for(const[operation,data]of[['create',{}],['control',{expectedRevision:1,operation:'activate'}],['control',{expectedRevision:'1',expectedControlEpoch:1,operation:'pause'}],['validate',{expectedRevision:1}],['update',{expectedRevision:1,connectMcpServers:['external']}],['update',{expectedRevision:1,deferUntilIdle:true,idempotencyKey:'key'}]]){
    const r=await call(root,['bots',operation,'--id','b','--data',JSON.stringify(data)],{fetchImpl:async()=>assert.fail('invalid prerequisite must not dispatch')});assert.equal(r.exitCode,2,operation+JSON.stringify(data));
  }
}));
test('native login rejection has authentication exit code while preserving original HTTP status',()=>fixture(async root=>{
  const r=await call(root,['auth','login','--email','person@example.test','--password-stdin','--workspace','team'],{readStdin:async()=>secret,fetchImpl:async()=>Response.json({error:'邮箱或密码错误'},{status:400})});assert.equal(r.exitCode,3);assert.equal(r.json.error.httpStatus,400);
}));
test('redaction handles unrecognized secrets inside serialized service error strings',()=>fixture(async root=>{
  await loginManaged(root);const r=await call(root,['tasks','list','--purpose','employee'],{fetchImpl:async()=>Response.json({error:'External service returned {"client_secret":"unrecognized-secret","apiKey":"also-private"}'},{status:502})});assert.ok(!r.stdout.includes('unrecognized-secret'));assert.ok(!r.stdout.includes('also-private'));
}));
test('service errors redact entire sensitive object and array subtrees',()=>fixture(async root=>{
  await loginManaged(root);const r=await call(root,['tasks','list','--purpose','employee'],{fetchImpl:async()=>Response.json({error:{message:'fixture rejection',password:['fixture-private-a'],token:{value:'fixture-private-b'},nested:[{client_secret:{arbitrary:['fixture-private-c']}}]}},{status:502})});
  assert.equal(r.exitCode,7);for(const value of ['fixture-private-a','fixture-private-b','fixture-private-c'])assert.ok(!r.stdout.includes(value));
}));
test('redaction preserves public OAuth authorization links while masking actual token parameters and protocol keys',()=>fixture(async root=>{
  await loginManaged(root);const authorizationUrl='https://oauth.example.test/authorize?client_id=public-client&state=public-flow-reference';
  const r=await call(root,['bots','connectMcp','--purpose','employee','--id','b','--data','{"server":"external","expectedRevision":1,"expectedControlEpoch":1,"idempotencyKey":"connect"}'],{fetchImpl:async()=>Response.json({connection:{id:'connection-original',status:'authorization_required',authorizationUrl,token:secret}},{status:202})});
  assert.equal(r.json.data.native.connection.authorizationUrl,authorizationUrl);assert.ok(!r.stdout.includes(secret));
  const denied=await call(root,['auth','login','--workspace','team','--email','person@example.test','--password-stdin'],{readStdin:async()=> 'service',fetchImpl:async()=>Response.json({error:'bad password'},{status:400})});assert.equal(denied.json.service,'workspace');assert.equal(denied.json.error.code,'UNAUTHENTICATED');
  const fixed=await call(root,['auth','login','--workspace','team','--email','person@example.test','--password-stdin'],{readStdin:async()=> 'workspace',fetchImpl:async()=>Response.json({error:'workspace password rejected'},{status:400})});assert.equal(fixed.json.service,'workspace');assert.equal(fixed.json.error.code,'UNAUTHENTICATED');
}));
test('MCP connection native statuses expose actual async progress and terminal success',()=>fixture(async root=>{
  await loginManaged(root);
  for(const[status,state,completed]of[['authorization_required','running',false],['connected','succeeded',true],['expired','failed',true]]){
    const r=await call(root,['bots','connectMcp','--purpose','employee','--id','b','--data','{"server":"external","expectedRevision":1,"expectedControlEpoch":1,"idempotencyKey":"connect"}'],{fetchImpl:async()=>Response.json({connection:{actionId:'connect-1',status}},{status:202})});assert.equal(r.json.data.operation.state,state);assert.equal(r.json.data.operation.completed,completed);
  }
}));
test('deferred configuration, task execution and uncertain failure keep native identity and state',()=>fixture(async root=>{
  await loginManaged(root);
  const deferred=await call(root,['bots','update','--purpose','employee','--id','b','--data','{"expectedRevision":1,"expectedControlEpoch":1,"idempotencyKey":"defer","deferUntilIdle":true}'],{fetchImpl:async()=>Response.json({id:'b',deferred:true,deferredConfig:{id:'bot-config-original',status:'queued'}} ,{status:202})});
  assert.equal(deferred.json.data.operation.serverReceiptId,'bot-config-original');assert.match(deferred.json.data.operation.resultQuery.command,/bots get/);assert.ok(!deferred.json.data.operation.resultQuery.command.includes('actions get'));
  const task=await call(root,['tasks','get','--purpose','employee','--id','t'],{fetchImpl:async()=>Response.json({id:'t',state:'todo',execution:{id:'original-action',status:'pending'}})});assert.equal(task.json.data.operation.state,'accepted');assert.match(task.json.data.operation.resultQuery.command,/original-action/);
  const uncertain=await call(root,['actions','get','--purpose','employee','--id','a'],{fetchImpl:async()=>Response.json({id:'a',status:'failed',result:{code:'EXECUTION_UNCERTAIN'}})});assert.equal(uncertain.json.data.operation.state,'unknown');assert.equal(uncertain.json.data.operation.completed,false);
}));
test('expired acknowledged Bot provisioning remains unknown while unacknowledged expiry is terminal',()=>fixture(async root=>{
  await loginManaged(root);
  for(const[acked,expectedState,expectedCompleted]of[[true,'unknown',false],[false,'failed',true]]){
    const native={id:'provision-original',type:'hermes.bot.provision',status:'expired',acked_at:acked?'2026-10-21T12:00:00Z':null,result:null};
    const r=await call(root,['actions','get','--purpose','employee','--id',native.id],{fetchImpl:async()=>Response.json(native)});
    assert.equal(r.json.data.operation.state,expectedState);assert.equal(r.json.data.operation.completed,expectedCompleted);assert.equal(r.json.data.operation.nativeState,'expired');
  }
  const wait=await call(root,['actions','wait','--purpose','employee','--id','provision-original','--timeout','100'],{fetchImpl:async()=>Response.json({id:'provision-original',type:'hermes.bot.provision',status:'expired',acked_at:'2026-10-21T12:00:00Z',result:null})});assert.equal(wait.exitCode,7);assert.equal(wait.json.error.details.lastKnown.operation.state,'unknown');
}));
test('uncertainty in arbitrary nested diagnostic containers and arrays is never terminal failure',()=>fixture(async root=>{
  await loginManaged(root);
  for(const result of [{diagnostic:{nested:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}}},{diagnostic:[{wrapper:{executionState:'uncertain'}}]}]){
    const r=await call(root,['actions','get','--purpose','employee','--id','nested-original'],{fetchImpl:async()=>Response.json({id:'nested-original',status:'failed',result})});assert.equal(r.json.data.operation.state,'unknown');assert.equal(r.json.data.operation.completed,false);assert.equal(r.json.data.operation.nativeState,'failed');
  }
  const wait=await call(root,['actions','wait','--purpose','employee','--id','nested-original','--timeout','100'],{fetchImpl:async()=>Response.json({id:'nested-original',status:'failed',result:{diagnostic:{nested:{code:'EXECUTION_UNCERTAIN'}}}})});assert.equal(wait.exitCode,7);
  const succeeded=await call(root,['actions','get','--purpose','employee','--id','known-success'],{fetchImpl:async()=>Response.json({id:'known-success',status:'succeeded',payload:{nativeOperation:{input:{arguments:{status:'uncertain'}}}},result:{confirmed:true}})});assert.equal(succeeded.json.data.operation.state,'succeeded');assert.equal(succeeded.json.data.operation.completed,true);
}));
test('native phone audit uncertainty follows original submitted IDs and later receipt supersession',()=>fixture(async root=>{
  await loginManaged(root);
  const issued={toolName:'ziwei_phone_action',ok:true,commandId:'command-original',status:'pending',commandExecutionState:'uncertain'};
  for(const[observedId,state,completed]of[['other-command','unknown',false],['command-original','failed',true]]){
    const result={terminalMcp:{loaded:true,runtime:'fixture-runtime',toolCalls:[issued,{toolName:'ziwei_phone_command_status',ok:true,commandId:observedId,status:'succeeded'}]}};
    const r=await call(root,['actions','get','--purpose','employee','--id','phone-audit-action'],{fetchImpl:async()=>Response.json({id:'phone-audit-action',status:'failed',result})});assert.equal(r.json.data.operation.state,state);assert.equal(r.json.data.operation.completed,completed);
  }
}));
test('phone setup summary uses original bounded native conversion and installs use real human PATCH semantics',()=>fixture(async root=>{
  await loginManaged(root);
  const setup=await call(root,['phone-mcp','setup','--purpose','employee','--view','summary'],{fetchImpl:async url=>{assert.equal(new URL(url).searchParams.has('view'),false);return Response.json({api:{status:'healthy'},phones:[{id:'phone-one',alias:'one',status:'online'},{id:'phone-one',alias:'duplicate'}],employees:[{id:'employee'}],computers:[{id:'computer'}]});}});
  assert.equal(setup.json.data.native.scope,'control_catalog');assert.equal(setup.json.data.native.counts.phones,1);
  const store=new cfg.CredentialStore(root);await store.save({origin,profile:'default',account:'default',purpose:'person'},{mode:'native',session:secret,workspace:'team',identitySource:'legacy-native'});
  const install=await call(root,['skills','install','--id','skill'],{fetchImpl:async(url,init)=>{assert.equal(new URL(url).pathname,'/api/skills/skill');assert.equal(init.method,'PATCH');assert.equal(JSON.parse(init.body).installed,true);return Response.json({id:'skill',installed:true});}});assert.equal(install.exitCode,0);
}));
test('write transport loss returns outcome unknown once with safe reconciliation; reads remain unavailable',()=>fixture(async root=>{
  await loginManaged(root);let calls=0;
  const mutation=await call(root,['tasks','create','--purpose','employee','--input','{"title":"x","idempotencyKey":"original-key"}'],{fetchImpl:async()=>{calls++;throw Error('socket lost');}});
  assert.equal(calls,1);assert.equal(mutation.exitCode,8);assert.equal(mutation.json.error.details.outcomeUnknown,true);assert.equal(mutation.json.error.details.idempotencyKey,'original-key');assert.match(mutation.json.error.details.resultQuery.command,/tasks/);
  const read=await call(root,['tasks','list','--purpose','employee'],{fetchImpl:async()=>{throw Error('offline');}});assert.equal(read.exitCode,7);
}));
test('timeout covers response body, even if injected fetch ignores AbortSignal',()=>fixture(async root=>{
  await loginManaged(root);let calls=0;const started=Date.now();
  const r=await call(root,['tasks','create','--purpose','employee','--title','x','--timeout','100'],{fetchImpl:async()=>{calls++;return{ok:true,status:201,text:async()=>new Promise(()=>{})};}});
  assert.equal(r.exitCode,8);assert.equal(calls,1);assert.ok(Date.now()-started<1500);
}));
test('SIGINT after dispatched mutation returns 130 and keeps unknown result; before dispatch stays known',()=>fixture(async root=>{
  await loginManaged(root);const controller=new AbortController();let calls=0;
  const r=await call(root,['tasks','create','--purpose','employee','--title','x'],{signal:controller.signal,fetchImpl:async()=>{calls++;queueMicrotask(()=>controller.abort());return new Promise(()=>{});}});
  assert.equal(r.exitCode,130);assert.equal(r.json.error.details.outcomeUnknown,true);assert.equal(calls,1);
  const before=new AbortController();before.abort();const b=await call(root,['tasks','create','--purpose','employee','--title','x'],{signal:before.signal,fetchImpl:async()=>assert.fail('cancelled before dispatch')});assert.equal(b.exitCode,130);assert.equal(b.json.error.details.outcomeUnknown,false);
}));
test('explicit stdin is bounded and cancellation before a request remains known',()=>fixture(async root=>{
  const controller=new AbortController();
  const cancelled=await Promise.race([call(root,['auth','login','--email','person@example.test','--workspace','team','--password-stdin'],{signal:controller.signal,readStdin:async()=>{queueMicrotask(()=>controller.abort());return new Promise(()=>{});},fetchImpl:async()=>assert.fail('input cancellation must not submit')}),new Promise(resolve=>setTimeout(()=>resolve({exitCode:'unbounded'}),500))]);
  assert.equal(cancelled.exitCode,130);assert.equal(cancelled.json.error.details.outcomeUnknown,false);
  const timeout=await Promise.race([call(root,['tasks','create','--input-stdin','--timeout','100'],{readStdin:async()=>new Promise(()=>{}),fetchImpl:async()=>assert.fail('input timeout must not submit')}),new Promise(resolve=>setTimeout(()=>resolve({exitCode:'unbounded'}),500))]);assert.equal(timeout.exitCode,2);
}));
test('SIGINT while waiting for another credential writer cancels without clearing or stealing its lock',()=>fixture(async root=>{
  await loginManaged(root);const lock=path.join(root,'credentials.lock');await fs.mkdir(lock);await fs.writeFile(path.join(lock,'owner.json'),'{"pid":123456,"startedAt":"fixture"}');
  const controller=new AbortController();const abortTimer=setTimeout(()=>controller.abort(),20);
  const r=await Promise.race([call(root,['auth','logout','--purpose','employee'],{signal:controller.signal}),new Promise(resolve=>setTimeout(()=>resolve({exitCode:'late'}),500))]);clearTimeout(abortTimer);
  assert.equal(r.exitCode,130);assert.equal(r.json.error.details.outcomeUnknown,false);await fs.access(lock);
  const local=await call(root,['auth','status','--purpose','employee','--local']);assert.equal(local.exitCode,0);
}));
test('native logout cancellation preserves local cleanup and unknown remote revocation',()=>fixture(async root=>{
  const store=new cfg.CredentialStore(root);await store.save({origin,profile:'default',account:'default',purpose:'person'},{mode:'native',session:secret,workspace:'team',identitySource:'legacy-native'});
  const controller=new AbortController();const r=await call(root,['auth','logout'],{signal:controller.signal,fetchImpl:async()=>{queueMicrotask(()=>controller.abort());return new Promise(()=>{});}});
  assert.equal(r.exitCode,130);assert.equal(r.json.error.details.localCleared,true);assert.equal(r.json.error.details.outcomeUnknown,true);assert.equal(r.json.error.details.remoteRevocation,'unknown');
}));
test('asynchronous states preserve native receipt and waiting timeout is a readonly timeout',()=>fixture(async root=>{
  await loginManaged(root);
  for(const [native,state,completed]of [['pending','accepted',false],['acked','running',false],['running','running',false],['succeeded','succeeded',true],['failed','failed',true],['uncertain','unknown',false]]){
    const r=await call(root,['actions','get','--purpose','employee','--id','action-1'],{fetchImpl:async()=>Response.json({id:'action-1',status:native,result:{value:1}})});
    assert.equal(r.json.data.native.status,native);assert.equal(r.json.data.operation.state,state);assert.equal(r.json.data.operation.completed,completed);assert.match(r.json.data.operation.resultQuery.command,/action-1/);
  }
  const waiting=await call(root,['actions','wait','--purpose','employee','--id','action-1','--timeout','100'],{fetchImpl:async()=>Response.json({id:'action-1',status:'running'})});assert.equal(waiting.exitCode,7);assert.equal(waiting.json.error.details.outcomeUnknown,false);
  const cancel=await call(root,['actions','cancel','--id','action-1']);assert.equal(cancel.exitCode,9);
}));
test('human routes are explicit and do not guess MCP paths; managed workspace switching is rejected',()=>fixture(async root=>{
  await loginManaged(root);
  const cross=await call(root,['employees','list','--purpose','employee','--workspace','different'],{fetchImpl:async()=>assert.fail('scoped import must not switch workspaces')});assert.equal(cross.exitCode,4);
  assert.equal(typeof cfg.CredentialStore,'function');
  const store=new cfg.CredentialStore(root);await store.save({origin,profile:'default',account:'default',purpose:'person'},{mode:'native',session:secret,workspace:'team',identitySource:'legacy-native',expiresAt:new Date(Date.now()+60000).toISOString(),identity:{id:'u'}});
  const task=await call(root,['tasks','get','--id','task-1'],{fetchImpl:async url=>{assert.equal(new URL(url).pathname,'/api/tasks/task-1');return Response.json({id:'task-1',state:'todo'});}});assert.equal(task.exitCode,0);
  const noRoute=await call(root,['employees','get','--id','employee-1'],{fetchImpl:async()=>assert.fail('no fabricated human get route')});assert.equal(noRoute.exitCode,9);
}));
