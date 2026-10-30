import test from 'node:test';
import assert from 'node:assert/strict';
import {DSH_NATIVE_OPERATIONS} from '../../src/dsh-native-contract.mjs';
const module=await import('./dsh-native.js').catch(()=>({}));
const subject=(patch={})=>({actorId:'owner',workspace:'team',employeeId:'employee',...patch});
function view(scope=subject(),patch={}){return{schemaVersion:1,workspace:scope.workspace,employeeId:scope.employeeId,subject:{workspace:scope.workspace,employeeId:scope.employeeId,deviceId:'pc',profile:'alpha',runtime:'DSH'},scope:scope.conversationId?{kind:'conversation',conversationId:scope.conversationId,nativeSessionId:'session'}:{kind:'bot'},subjectHash:scope.subjectHash||'hash-one',resources:{plugins:{status:'observed',stale:false,data:{bundles:[]}},providers:{status:'observed',stale:false,data:{}},settings:{status:'observed',stale:false,data:{}}},pending:[],...patch};}
function action(scope=subject(),status='applied',operation='setBundleEnabled'){const value=view(scope);return{id:'original-action',type:'employee.dsh.operation',status:'succeeded',payload:{workspace:scope.workspace,dshOperation:{subject:value.subject,scope:value.scope,resource:'plugins',operation}},result:{dshNative:{schemaVersion:1,source:'dsh-native',subject:value.subject,scope:value.scope,resource:'plugins',operation,status,data:{}}}};}
function setup(t,overrides={},options={}){
  const calls=[],timers=new Set(),api={dshNativeCapabilities:async(id,workspace)=>({schemaVersion:1,workspace,employeeId:id,operations:DSH_NATIVE_OPERATIONS.map(entry=>({...entry,supported:entry.implemented}))}),dshNativeState:async(id,query,workspace)=>{calls.push(['state',id,query,workspace]);return view(subject({workspace,employeeId:id,...query}));},refreshDshNative:async(id,body,workspace)=>{calls.push(['refresh',id,body,workspace]);return{...view(),action:{id:'refresh-action',status:'pending'}};},submitDshNative:async(id,body,workspace)=>{calls.push(['submit',id,body,workspace]);return{...view(),action:{id:'original-action',status:'pending'}};},dshNativeAction:async(id,workspace)=>{calls.push(['action',id,workspace]);return action();},...overrides};
  const ui=module.createDshNative({api,keyFactory:()=> 'original-key',storage:null,setTimer:fn=>{timers.add(fn);return fn;},clearTimer:fn=>timers.delete(fn),...options});t.after(()=>ui.dispose());
  return{ui,calls,timers,tick:async()=>{const fn=timers.values().next().value;assert.ok(fn);timers.delete(fn);await fn();}};
}
test('native controller reads real resource states and capabilities without auto-posting',async t=>{
  assert.equal(typeof module.createDshNative,'function');const{ui,calls}=setup(t);await ui.select(subject(),{active:true});assert.equal(ui.editable('plugins'),true);assert.equal(ui.supported('plugins','setBundleEnabled'),true);assert.equal(ui.supported('groups','arbitrary-rpc'),false);assert.deepEqual(calls.map(row=>row[0]),['state']);
});
test('unknown mutation keeps original input/key and readback never resubmits it',async t=>{
  const{ui,calls}=setup(t,{submitDshNative:async(id,body)=>{calls.push(['submit',id,body]);throw Error('response lost');}});await ui.select(subject(),{active:true});await ui.submit('plugins','setBundleEnabled',{name:'bundle',enabled:false});
  const original=structuredClone(ui.state.request);await ui.load();await ui.submit('plugins','setBundleEnabled',{name:'other',enabled:true});assert.deepEqual(ui.state.request,original);assert.equal(original.body.idempotencyKey,'original-key');assert.equal(original.body.expectedSubjectHash,'hash-one');assert.equal(calls.filter(row=>row[0]==='submit').length,1);assert.equal(ui.editable('plugins'),false);
});
test('pending recovery queries its original action even when state contains a newer action',async t=>{
  let read=0;const{ui,calls}=setup(t,{dshNativeState:async()=>view(subject(),{pending:++read>1?[{actionId:'newer-action',status:'pending'}]:[]})});await ui.select(subject(),{active:true});await ui.submit('plugins','setBundleEnabled',{name:'bundle',enabled:false});await ui.load();assert.ok(calls.some(row=>row[0]==='action'&&row[1]==='original-action'));assert.equal(ui.state.request,null);assert.match(ui.state.notice,/已应用/);
});
test('A2A success with unknown native application cannot report applied or release the original mutation',async t=>{
  const{ui}=setup(t,{dshNativeAction:async()=>action(subject(),'unknown')});await ui.select(subject(),{active:true});await ui.submit('plugins','setBundleEnabled',{name:'bundle',enabled:false});await ui.readAction();assert.ok(ui.state.request);assert.equal(ui.state.unknown,true);assert.doesNotMatch(ui.state.notice,/已应用|已保存/);
});
test('a terminal unknown action returned directly from submit keeps its unknown notice',async t=>{
  const{ui}=setup(t,{submitDshNative:async()=>({...view(),action:action(subject(),'unknown')})});await ui.select(subject(),{active:true});await ui.submit('plugins','setBundleEnabled',{name:'bundle',enabled:false});assert.equal(ui.state.unknown,true);assert.match(ui.state.notice,/未知/);assert.doesNotMatch(ui.state.notice,/已受理/);
});
test('late responses cannot cross actor, workspace, employee or conversation selections',async t=>{
  for(const patch of [{actorId:'other'},{workspace:'other'},{employeeId:'other'},{conversationId:'other'}]){
    let resolve,first=true;const wait=new Promise(done=>resolve=done),{ui}=setup(t,{dshNativeState:async(id,query,workspace)=>first?(first=false,wait):view(subject({...patch,workspace,employeeId:id,...query}))});
    const pending=ui.select(subject(),{active:true});await ui.select(subject(patch),{active:true});resolve(view());await pending;assert.equal(ui.state.subject.actorId,subject(patch).actorId);assert.equal(ui.state.value.employeeId,subject(patch).employeeId);assert.equal(ui.state.value.scope.conversationId,patch.conversationId);
  }
});
test('only current observed resources may mutate, and secret values never enter ordinary actions',async t=>{
  const{ui,calls}=setup(t,{dshNativeState:async()=>view(subject(),{resources:{plugins:{status:'unknown',stale:true,data:{}}}})});await ui.select(subject(),{active:true});await ui.submit('plugins','setBundleEnabled',{name:'bundle',enabled:false});assert.equal(calls.filter(row=>row[0]==='submit').length,0);
  const fresh=setup(t);await fresh.ui.select(subject(),{active:true});await fresh.ui.submit('providers','upsert',{apiKey:'must-not-store'},{observedResource:'providers'});assert.equal(fresh.ui.state.request,null);assert.equal(fresh.calls.filter(row=>row[0]==='submit').length,0);assert.doesNotMatch(JSON.stringify(fresh.ui.state),/must-not-store/);
});
test('GET polling is finite and pauses while hidden',async t=>{
  const{ui,timers,tick}=setup(t,{dshNativeState:async()=>view(subject(),{pending:[{actionId:'pending-action',status:'pending'}]})},{pollLimit:2});await ui.select(subject(),{active:true});await tick();await tick();assert.equal(timers.size,0);assert.match(ui.state.notice,/等待上限/);await ui.select(subject(),{active:false});assert.equal(timers.size,0);
});
test('state refresh retains its actual readonly request shape and resolves its own receipt',async t=>{
  const value=view(),done={...action(),id:'refresh-action'};done.payload.dshOperation.resource=done.result.dshNative.resource='state';done.payload.dshOperation.operation=done.result.dshNative.operation='refresh';done.result.dshNative.status='observed';
  const{ui,calls}=setup(t,{dshNativeAction:async()=>done});await ui.select(subject(),{active:true});await ui.refresh(['providers','settings']);
  assert.deepEqual(calls.find(row=>row[0]==='refresh')[2],{resources:['providers','settings'],idempotencyKey:'original-key'});assert.equal(ui.state.error,'');await ui.readAction();assert.equal(ui.state.request,null);assert.equal(ui.state.action.id,'refresh-action');assert.equal(ui.state.error,'');
});
test('unknown requests restore under the same actor but never authorize a different subject hash',async t=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const first=setup(t,{submitDshNative:async()=>{throw Error('lost');}},{storage});await first.ui.select(subject(),{active:true});await first.ui.submit('plugins','setBundleEnabled',{name:'bundle',enabled:false});first.ui.dispose();
  const restored=setup(t,{dshNativeState:async()=>view(subject({subjectHash:'changed'}))},{storage});await restored.ui.select(subject(),{active:true});assert.equal(restored.ui.state.request.body.idempotencyKey,'original-key');assert.equal(restored.ui.editable('plugins'),false);assert.match(restored.ui.state.error,/绑定/);
  const other=setup(t,{}, {storage});await other.ui.select(subject({actorId:'other'}),{active:true});assert.equal(other.ui.state.request,null);
});
test('an explicit settings revision conflict releases admission and preserves its safe conflict metadata',async t=>{
  const{ui}=setup(t,{submitDshNative:async()=>{throw Object.assign(Error('conflict'),{status:409,code:'settings/conflict',expectedRevision:2,actualRevision:3});}});await ui.select(subject(),{active:true});await ui.submit('settings','mutate',{ns:'test',expectedRevision:2,ops:[]});
  assert.equal(ui.state.request,null);assert.equal(ui.state.unknown,false);assert.equal(ui.state.errorCode,'settings/conflict');assert.equal(ui.state.conflict.actualRevision,3);await ui.load();assert.equal(ui.editable('settings'),true);
});
test('either-scope refresh carries its conversation and a proven create receipt upgrades only that session mapping',async t=>{
  const scoped=subject({conversationId:'conversation',subjectHash:'before'}),before=view(scoped),after=view({...scoped,subjectHash:'after'});before.scope.nativeSessionId=null;after.scope.nativeSessionId='new-native-session';before.resources.sessions={status:'unknown',stale:false,data:null};after.resources.sessions={status:'observed',stale:false,data:{}};
  const done=action(scoped,'applied','create');done.payload.dshOperation.resource=done.result.dshNative.resource='sessions';done.payload.dshOperation.scope.nativeSessionId=null;done.result.dshNative.scope.nativeSessionId=null;done.result.dshNative.data={sessionId:'new-native-session'};
  let created=false;const{ui}=setup(t,{dshNativeState:async()=>created?after:before,submitDshNative:async()=>{created=true;return{...before,action:{id:'original-action',status:'pending'}};},dshNativeAction:async()=>done});await ui.select(scoped,{active:true});assert.equal(ui.supported('state','refresh'),true);await ui.submit('sessions','create',{});await ui.load();assert.equal(ui.state.request,null);assert.equal(ui.state.value.scope.nativeSessionId,'new-native-session');assert.equal(ui.state.subject.subjectHash,'after');assert.equal(ui.state.error,'');
});
test('restricted install cancellation keeps the original pending installation and never replays installation',async t=>{
  const posts=[],original=view(),receipt=action(subject(),'observed','cancelInstall');receipt.id='cancel-action';receipt.payload.dshOperation.scope=receipt.result.dshNative.scope={kind:'attempt',sourceActionId:'original-action'};receipt.result.dshNative.data={installActionId:'original-action',cancelRequested:true,nativeCancellation:{status:'cancelled'}};
  const{ui}=setup(t,{submitDshNative:async(id,body)=>{posts.push(body);return{...original,action:body.operation==='installBundle'?{id:'original-action',status:'pending'}:receipt};}});await ui.select(subject(),{active:true});await ui.submit('plugins','installBundle',{sourceActionId:'inspection',enabled:true});const request=structuredClone(ui.state.request);await ui.control('cancelInstall',{sourceActionId:'original-action'});
  assert.deepEqual(ui.state.request,request);assert.equal(ui.state.controlAction.id,'cancel-action');assert.equal(posts[1].input.sourceActionId,'original-action');assert.equal(posts[1].expectedSubjectHash,'hash-one');assert.match(ui.state.controlNotice,/终态/);assert.equal(posts.filter(body=>body.operation==='installBundle').length,1);
  await ui.control('removeBundle',{sourceActionId:'original-action'});await ui.control('cancelInstall',{sourceActionId:'foreign'});assert.equal(posts.length,2);
});
test('wait and cancel use separate controls while an unresolved control is queried rather than re-posted',async t=>{
  const posts=[],{ui}=setup(t,{submitDshNative:async(id,body)=>{posts.push(body);return{...view(),action:{id:body.operation==='installBundle'?'original-action':body.operation+'-action',status:'pending'}};},dshNativeAction:async id=>{const value=action(subject(),'unknown',id==='original-action'?'installBundle':id.replace('-action',''));value.id=id;value.status='acked';if(id!=='original-action')value.payload.dshOperation.scope={kind:'attempt',sourceActionId:'original-action'};return value;}});await ui.select(subject(),{active:true});await ui.submit('plugins','installBundle',{sourceActionId:'inspection',enabled:true});await ui.control('waitForInstall');await ui.control('cancelInstall');await ui.control('cancelInstall');assert.equal(posts.length,3);assert.equal(ui.state.controls.length,2);assert.equal(ui.state.request.operation,'installBundle');
});
test('derived group scopes are accepted only for the original observed group and preserve its member binding',async t=>{
  const nativeGroup={id:'native-group',members:['alpha','beta']},value=view();value.resources.groups={status:'observed',stale:false,data:{items:[nativeGroup]}};
  const result=action(subject(),'observed','get');result.payload.dshOperation.resource=result.result.dshNative.resource='groups';result.payload.dshOperation.scope=result.result.dshNative.scope={kind:'group',groupId:nativeGroup.id};
  const{ui,calls}=setup(t,{dshNativeState:async()=>value,submitDshNative:async(id,body)=>{calls.push(['submit',id,body]);return{...value,action:result};}});await ui.select(subject(),{active:true});assert.equal(ui.supported('groups','get'),true);await ui.submit('groups','get',{groupId:nativeGroup.id});assert.equal(ui.state.error,'');assert.equal(ui.state.request,null);assert.equal(ui.state.action.id,result.id);
  result.id='wrong-group-action';result.payload.dshOperation.scope=result.result.dshNative.scope={kind:'group',groupId:'another-group'};await ui.submit('groups','get',{groupId:nativeGroup.id});assert.equal(ui.state.request.scope.groupId,nativeGroup.id);assert.deepEqual(ui.state.request.groupBinding.members,['alpha','beta']);assert.equal(ui.state.unknown,true);assert.notEqual(ui.state.action?.id,result.id);
  const absent=setup(t,{dshNativeState:async()=>value});await absent.ui.select(subject(),{active:true});await absent.ui.submit('groups','get',{groupId:'unobserved'});assert.equal(absent.calls.some(row=>row[0]==='submit'),false);
});
