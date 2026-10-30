import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const module=await import('../src/dsh-native-install.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const subject={workspace:'test',workspaceId:'ws',employeeId:'employee',deviceId:'pc',runtime:'DSH',profile:'alpha'};
const action=(id='install-one',extra={})=>({id,type:'employee.dsh.operation',payload:{workspace:'test',workspaceId:'ws',deviceId:'pc',dshOperation:{schemaVersion:1,subject,scope:{kind:'bot'},resource:'plugins',operation:'installBundle',input:{sourceActionId:'source-inspection',enabled:true,...extra},installSource:{spec:'native-bundle@1.0.0',registry:'https://registry.invalid'}}}});
const control=(operation,sourceActionId='install-one')=>({...action(operation),payload:{...action(operation).payload,dshOperation:{...action(operation).payload.dshOperation,scope:{kind:'attempt',sourceActionId},operation,input:{sourceActionId}}}});
const receipt=(application='applied',extra={})=>({changed:true,application,stage:'enable',target:'native-bundle',bundle:'native-bundle',version:'1.0.0',enabled:true,...extra});
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-native-install-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const create=()=>{assert.equal(typeof module.createDshNativeInstallManager,'function');return module.createDshNativeInstallManager({directory});};
 const journals=()=>fs.readdirSync(directory).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')));
 return{directory,create,journals};
}
test('installation journals its native identity before submission, filters events and persists a safe final receipt',async t=>{
 const f=fixture(t),manager=f.create(),calls=[],stages=[];let handler,detached=0;
 const result=await manager.execute(action(),{subscribeEvents:async listener=>{handler=listener;return()=>{detached++;};},onStage:stage=>stages.push(stage),rpc:async(method,args)=>{
  calls.push({method,args});assert.equal(method,'pluginManager/installBundle');
  assert.equal(f.journals()[0].nativeRequestId,args.options.requestId);assert.equal(f.journals()[0].phase,'install-submitted');
  handler({type:'emit',event:'plugin-manager/install-log',args:[{requestId:'foreign',text:'foreign-output'}]});
  handler({type:'emit',event:'plugin-manager/install-log',args:[{requestId:args.options.requestId,jobId:'job',argv:['secret-arg'],cwd:'PRIVATE_PATH',stream:'stdout',text:'module @deepseek-ai/dsh-experimental-badge-skill-bundle\nAuthorization: Basic hidden\ntoken=hidden\nhttps://user:hidden@registry.invalid\n'}]});
  handler({type:'emit',event:'plugin-manager/install-state',args:[{requestId:args.options.requestId,phase:'applying'}]});
  return receipt('restart-required',{restartReason:'host-module',packageResult:{exitCode:0,output:'token=hidden',truncated:false,logPath:'PRIVATE_PATH'}});
 }});
 assert.equal(result.status,'restart-required');assert.equal(result.data.receipt.application,'restart-required');assert.equal(detached,1);
 assert.equal(result.data.nativeRequestId,'install-one');
 assert.deepEqual(calls[0].args,{spec:'native-bundle@1.0.0',options:{enabled:true,saveExact:true,requestId:'install-one',registry:'https://registry.invalid'}});
 assert.equal(f.journals()[0].phase,'settled');assert.equal(f.journals()[0].result.status,'restart-required');
 assert.doesNotMatch(JSON.stringify({result,stages,journals:f.journals()}),/foreign-output|hidden|PRIVATE_PATH|secret-arg/);
 assert.match(result.data.log,/@deepseek-ai\/dsh-experimental-badge-skill-bundle/);
});
test('a completed action returns its durable result across manager restart without another native operation',async t=>{
 const f=fixture(t);let installs=0;
 const first=await f.create().execute(action(),{rpc:async()=>{installs++;return receipt();}});
 const again=await f.create().execute(action(),{rpc:async()=>assert.fail('settled duplicate must use the journal')});
 assert.deepEqual(again,first);assert.equal(installs,1);
});
test('an ambiguous submission and null native wait remain unknown and are never reinstalled after restart',async t=>{
 const f=fixture(t),calls=[],rpc=async(method)=>{calls.push(method);if(method==='pluginManager/installBundle')throw Error('private diagnostic');assert.equal(method,'pluginManager/waitForInstall');return null;};
 const first=await f.create().execute(action(),{rpc});assert.equal(first.status,'unknown');
 const again=await f.create().execute(action(),{rpc});assert.equal(again.status,'unknown');
 assert.equal(calls.filter(method=>method==='pluginManager/installBundle').length,1);assert.equal(calls.filter(method=>method==='pluginManager/waitForInstall').length,2);
 assert.doesNotMatch(JSON.stringify(again),/private diagnostic/);
});
test('an explicit wait can obtain and durably retain a previously ambiguous active installation result',async t=>{
 const f=fixture(t);await f.create().execute(action(),{rpc:async method=>{if(method==='pluginManager/installBundle')throw Error('lost');return null;}});
 const result=await f.create().execute(control('waitForInstall'),{rpc:async(method,args)=>{assert.equal(method,'pluginManager/waitForInstall');assert.deepEqual(args,{requestId:'install-one'});return receipt();}});
 assert.equal(result.status,'applied');assert.equal(f.journals()[0].phase,'settled');
});
test('late cancellation reports only its native cancellation outcome while the original installation settles independently',async t=>{
 const f=fixture(t),manager=f.create();let finish,submitted;
 const ready=new Promise(resolve=>{submitted=resolve;});
 const running=manager.execute(action(),{rpc:async(method)=>{assert.equal(method,'pluginManager/installBundle');submitted();return new Promise(resolve=>{finish=resolve;});}});
 await ready;
 for(const status of ['too-late','cancelled','not-running']){
  const result=await manager.execute(control('cancelInstall'),{rpc:async(method,args)=>{assert.equal(method,'pluginManager/cancelInstall');assert.deepEqual(args,{requestId:'install-one'});return{status};}});
  assert.equal(result.status,'observed');assert.equal(result.data.cancelRequested,true);assert.equal(result.data.nativeCancellation.status,status);assert.equal(f.journals()[0].phase,'install-submitted');
 }
 finish(receipt());assert.equal((await running).status,'applied');
});
test('build retry requires explicit exact pending packages and a new original action identity',async t=>{
 const f=fixture(t),manager=f.create();
 const blocked=await manager.execute(action(),{rpc:async()=>receipt('failed',{pendingBuilds:['build-a','build-b'],error:{code:'operation-error'},packageResult:{exitCode:1,output:'build blocked',truncated:false,kind:'build-blocked'}})});
 assert.equal(blocked.status,'failed');assert.deepEqual(blocked.data.receipt.pendingBuilds,['build-a','build-b']);
 const retry=action('build-retry',{sourceActionId:'install-one',approvedBuilds:['build-a']});
 const invalid=action('bad-build',{sourceActionId:'install-one',approvedBuilds:['not-pending']});
 await assert.rejects(manager.execute(invalid,{rpc:async()=>assert.fail('unapproved package')}),{code:'DSH_NATIVE_BUILD_APPROVAL_INVALID'});
 const result=await manager.execute(retry,{rpc:async(method,args)=>{assert.equal(method,'pluginManager/installBundle');assert.equal(args.options.requestId,'build-retry');assert.deepEqual(args.options.approvedBuilds,['build-a']);return receipt();}});
 assert.equal(result.status,'applied');
});
test('replacement keeps successful removal as partial evidence and never repeats it on recovery',async t=>{
 const f=fixture(t),calls=[],original=action('replace-one',{replaceName:'native-bundle'});
 const run=async(method)=>{calls.push(method);if(method==='pluginManager/removeBundle')return receipt('applied',{stage:'remove'});if(method==='pluginManager/installBundle')throw Error('lost installation response');return null;};
 const first=await f.create().execute(original,{rpc:run});assert.equal(first.status,'partial');assert.equal(first.data.removalReceipt.application,'applied');assert.equal(first.data.installationStatus,'unknown');
 const again=await f.create().execute(original,{rpc:run});assert.equal(again.status,'partial');assert.equal(calls.filter(method=>method==='pluginManager/removeBundle').length,1);assert.equal(calls.filter(method=>method==='pluginManager/installBundle').length,1);
});
test('changed subject or source cannot reuse a local install journal or cancel another Bot attempt',async t=>{
 const f=fixture(t);await f.create().execute(action(),{rpc:async()=>receipt()});
 const changed=action();changed.payload.dshOperation.subject={...subject,profile:'beta'};
 await assert.rejects(f.create().execute(changed,{rpc:async()=>assert.fail('retargeted duplicate')}));
 const foreign=control('cancelInstall');foreign.payload.dshOperation.subject={...subject,profile:'beta'};
 await assert.rejects(f.create().execute(foreign,{rpc:async()=>assert.fail('foreign cancel')}));
});
test('failure to create the intent journal prevents the native install call',async t=>{
 const f=fixture(t),file=path.join(f.directory,'not-a-directory');fs.writeFileSync(file,'fixture');
 const manager=module.createDshNativeInstallManager({directory:file});let calls=0;
 await assert.rejects(manager.execute(action(),{rpc:async()=>{calls++;return receipt();}}));assert.equal(calls,0);
});
test('a settled native result is not reported as success when its durable write fails',async t=>{
 const f=fixture(t),manager=f.create();let installs=0;
 await assert.rejects(manager.execute(action(),{rpc:async method=>{
  if(method==='pluginManager/installBundle'){installs++;fs.rmSync(f.directory,{recursive:true,force:true});fs.writeFileSync(f.directory,'disk unavailable fixture');}
  return receipt();
 }}));
 assert.equal(installs,1);
});
test('a prepared journal after a subscription failure can only reconcile, never submit a late first install',async t=>{
 const f=fixture(t);let calls=0;
 const original=await f.create().execute(action(),{subscribeEvents:async()=>{throw Error('events unavailable');},rpc:async()=>{calls++;return null;}});
 assert.equal(original.status,'unknown');assert.equal(f.journals()[0].phase,'prepared');assert.equal(calls,0);
 const recovered=await f.create().execute(action(),{rpc:async method=>{calls++;assert.equal(method,'pluginManager/waitForInstall');return null;}});
 assert.equal(recovered.status,'unknown');assert.equal(calls,1);
});
test('build retry inherits an already completed replacement removal without removing the bundle twice',async t=>{
 const f=fixture(t),manager=f.create(),original=action('replace-build',{replaceName:'native-bundle'}),calls=[];
 await manager.execute(original,{rpc:async method=>{calls.push(method);return method==='pluginManager/removeBundle'?receipt('applied',{stage:'remove'}):receipt('failed',{pendingBuilds:['build-a'],packageResult:{exitCode:1,output:'blocked',truncated:false,kind:'build-blocked'}});}});
 const retry=action('approve-replace-build',{sourceActionId:'replace-build',replaceName:'native-bundle',approvedBuilds:['build-a']});
 const result=await manager.execute(retry,{rpc:async(method,args)=>{calls.push(method);assert.equal(method,'pluginManager/installBundle');assert.equal(args.options.requestId,'approve-replace-build');return receipt();}});
 assert.equal(result.status,'applied');assert.equal(calls.filter(method=>method==='pluginManager/removeBundle').length,1);assert.equal(result.data.removalReceipt.application,'applied');
});
test('a recovered active wait keeps its event subscription until the native outcome settles',async t=>{
 const f=fixture(t);await f.create().execute(action(),{rpc:async method=>{if(method==='pluginManager/installBundle')throw Error('lost');return null;}});
 let handler,detached=false,finish,waiting;const ready=new Promise(resolve=>{waiting=resolve;});
 const pending=f.create().execute(control('waitForInstall'),{subscribeEvents:async listener=>{handler=listener;return()=>{detached=true;};},rpc:async method=>{assert.equal(method,'pluginManager/waitForInstall');waiting();return new Promise(resolve=>{finish=resolve;});}});
 await ready;assert.equal(detached,false);
 handler({type:'emit',event:'plugin-manager/install-log',args:[{requestId:'install-one',stream:'stdout',text:'recovered active log'}]});
 finish(receipt());const result=await pending;assert.equal(result.status,'applied');assert.equal(detached,true);assert.match(result.data.log,/recovered active log/);
});
