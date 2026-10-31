import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {createDshNativeService,assertDshNativeSubject,projectDshNativeAction,registerDshNativeResult,assertDshNativeActionVisible,projectDshNativeData,dshNativeGroupTargets} from './dsh-native-operations.mjs';
import {DSH_NATIVE_FEATURE,DSH_NATIVE_TYPE} from '../src/dsh-native-contract.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

const SLUG='test-111',BUNDLE='@deepseek-ai/dsh-experimental-cot-translation-bundle',ENTRY='loader-public-reference-012345678901234567890123456789';
function fixture(t,{feature=true}={}){
 const repo=createRepository({memory:true}),db=repo.db,ws=repo.getWorkspace(SLUG),actor={actorUserId:'native-owner',actorRole:'owner'},deviceId='native-fixture-pc';t.after(()=>db.close());
 db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('native-owner-member',ws.id,actor.actorUserId,'Owner','fixture.invalid','owner',new Date().toISOString());
 repo.heartbeatDevice(SLUG,{deviceId,runtimeDiscovery:{features:feature?[DSH_NATIVE_FEATURE]:[]},runtimes:{DSH:{status:'available',profiles:[{name:'alpha'},{name:'beta'}]}}});
 const employee=repo.createEmployee(SLUG,{name:'Native fixture',runtime:'DSH',runtimeProfile:'alpha',targetDeviceId:deviceId,ownerUserId:actor.actorUserId}),management=createManagementService(repo),service=createDshNativeService(repo,{management});
 const state=(query={})=>service.state(SLUG,employee.id,query,actor),refresh=(input={})=>service.refresh(SLUG,employee.id,input,actor),action=(input)=>service.action(SLUG,employee.id,{expectedSubjectHash:state().subjectHash,...input},actor),count=()=>db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
 function complete(actionId,data,{resource,operation,status='observed',observations,reasonCode}={}){
  const original=repo.getA2AAction(actionId),op=original.payload.dshOperation;repo.ackA2AAction(actionId,{deviceId});
  const dshNative={schemaVersion:1,subject:op.subject,scope:op.scope,resource:resource||op.resource,operation:operation||op.operation,source:'dsh-native',checkedAt:new Date().toISOString(),status,data,...(observations?{observations}:{}),...(reasonCode?{reasonCode}:{})};
  repo.resultA2AAction(actionId,{deviceId,status:'succeeded',result:{dshNative,rawDiagnostic:'PRIVATE_DIAGNOSTIC'}});return dshNative;
 }
 const settings=()=>({writable:true,hasDocument:true,namespaces:[{ns:'agent-loop',revision:7,applies:'live',autoGenerate:false,schema:{uid:1,refs:{1:{type:'object',dict:{maxParallelToolCalls:2,theme:3,privateSetting:4}},2:{type:'number',meta:{min:1,max:20}},3:{type:'string'},4:{type:'string',meta:{role:'secret',default:'PRIVATE_DIAGNOSTIC'}}}},value:{maxParallelToolCalls:3,theme:'dark',privateSetting:'PRIVATE_DIAGNOSTIC'},base:{maxParallelToolCalls:1,theme:'light'},user:{maxParallelToolCalls:3},secrets:[{path:['privateSetting'],set:true}]}]});
 const observe=()=>{const queued=refresh({resources:['plugins','settings','providers','presets']}),id=queued.action.id;complete(id,{resources:{plugins:{status:'observed',data:{bundles:[{name:BUNDLE,enabled:true,installed:true}],plugins:[{entryId:ENTRY,moduleName:BUNDLE,enabled:'conditional',fiberPhase:null,patchId:'patch-public'}]}},settings:{status:'observed',data:settings()},providers:{status:'observed',data:{credentials:{nativeRef:{configured:true,writable:true,source:'profile',value:'PRIVATE_DIAGNOSTIC'}},settings:settings(),providers:[{id:'public-provider-012345678901234567890123456789',name:'Custom'}],directory:[],modelCatalog:{models:[{id:'public-model-012345678901234567890123456789'}]}}},presets:{status:'observed',data:[{id:'native-custom',name:'Custom preset'}]}}});return id;};
 return{repo,db,ws,actor,employee,deviceId,service,state,refresh,action,count,complete,settings,observe};
}

test('plugin UI prepare projection keeps only the bound mount contract',()=>{
 const value=projectDshNativeData('plugins',{application:'applied',version:'0.1.0',bridgePackage:'@dshbot/plugin-ui-host',mountBase:'/runtime/alpha/ui/',requestId:'plugin-ui-1',privatePath:'C:\\secret\\profile',receipt:{application:'applied',packageResult:{exitCode:0},rawDiagnostic:'PRIVATE_DIAGNOSTIC'}});
 assert.deepEqual(value,{application:'applied',version:'0.1.0',bridgePackage:'@dshbot/plugin-ui-host',mountBase:'/runtime/alpha/ui/',requestId:'plugin-ui-1',receipt:{application:'applied',packageResult:{exitCode:0}}});
 const forged=projectDshNativeData('plugins',{application:'applied',bridgePackage:'@dshbot/plugin-ui-host',mountBase:'https://evil.invalid/runtime/alpha/ui/',privatePath:'PRIVATE'});
 assert.equal(forged.mountBase,undefined);assert.equal(forged.privatePath,undefined);assert.doesNotMatch(JSON.stringify(forged),/PRIVATE|evil\.invalid/);
});

test('capability/state reads are side-effect free and distinguish implementation from device support',t=>{
 const f=fixture(t),before=f.count(),cap=f.service.capabilities(SLUG,f.employee.id,f.actor);assert.equal(cap.clientReported,true);assert.equal(cap.operations.find(item=>item.resource==='settings'&&item.operation==='mutate').implemented,true);assert.ok(cap.operations.filter(item=>!item.implemented).every(item=>item.status==='unsupported'&&item.supported===false));assert.equal(f.state().resources.settings.status,'unknown');assert.equal(f.count(),before);
 const old=fixture(t,{feature:false}),view=old.refresh();assert.equal(view.action,null);assert.equal(view.reasonCode,'CLIENT_NOT_REPORTED');assert.equal(old.count(),0);
});

test('refresh queues the bound Bot and reads only authenticated native resource snapshots',t=>{
 const f=fixture(t),id=f.observe(),action=f.repo.getA2AAction(id);assert.equal(action.type,DSH_NATIVE_TYPE);assert.equal(action.payload.employeeId,undefined);assert.equal(action.payload.runtime,undefined);assert.deepEqual(action.payload.dshOperation.scope,{kind:'bot'});assert.equal(action.payload.dshOperation.subject.profile,'alpha');
 const view=f.state();assert.equal(view.resources.settings.status,'observed');const ns=view.resources.settings.data.namespaces[0];assert.equal(ns.value.maxParallelToolCalls,3);assert.equal(ns.base.theme,'light');assert.equal(ns.user.maxParallelToolCalls,3);assert.deepEqual(ns.secrets,[{path:['privateSetting'],set:true}]);assert.equal(ns.revision,7);assert.equal(ns.value.privateSetting,undefined);assert.equal(JSON.stringify(view).includes('PRIVATE_DIAGNOSTIC'),false);
 assert.equal(view.resources.plugins.data.bundles[0].name,BUNDLE);assert.equal(view.resources.plugins.data.plugins[0].entryId,ENTRY);assert.equal(view.resources.plugins.data.plugins[0].enabled,'conditional');assert.equal(view.resources.plugins.data.plugins[0].fiberPhase,null);assert.equal(view.resources.providers.data.providers[0].id,'public-provider-012345678901234567890123456789');assert.deepEqual(view.resources.providers.data.settings.namespaces[0].secrets,[{path:['privateSetting'],set:true}]);assert.deepEqual(view.resources.providers.data.credentials.nativeRef,{configured:true,writable:true,source:'profile'});
 const projected=projectDshNativeAction(f.repo.getA2AAction(id));assert.equal(JSON.stringify(projected).includes('PRIVATE_DIAGNOSTIC'),false);assert.equal(projected.result.dshNative.data.resources.settings.data.namespaces[0].value.maxParallelToolCalls,3);
});

test('settings writes require a current observed descriptor and reject plain sensitive paths before enqueue',t=>{
 const f=fixture(t),mutation={resource:'settings',operation:'mutate',input:{ns:'agent-loop',expectedRevision:7,ops:[{op:'set',path:['maxParallelToolCalls'],value:8}]},idempotencyKey:'settings-write'};
 assert.throws(()=>f.action(mutation),{code:'DSH_NATIVE_REFRESH_REQUIRED'});f.observe();const before=f.count();
 for(const input of [
  {...mutation.input,ops:[{op:'set',path:['privateSetting'],value:'not-an-api-pattern'}]},
  {...mutation.input,ops:[{op:'unset',path:['privateSetting']}]},
  {...mutation.input,ops:[{op:'set',path:[],value:{privateSetting:'not-an-api-pattern'}}]},
 ])assert.throws(()=>f.action({...mutation,input}),{code:'DSH_SECURE_INPUT_REQUIRED'});
 assert.equal(f.count(),before);assert.throws(()=>f.action({...mutation,input:{...mutation.input,ops:[{op:'set',path:['unknownField'],value:3}]}}),{code:'DSH_NATIVE_SETTINGS_PATH_INVALID'});
 const queued=f.action(mutation);assert.equal(queued.action.type,DSH_NATIVE_TYPE);assert.equal(f.repo.getA2AAction(queued.action.id).payload.dshOperation.input.ops[0].value,8);
});

test('nested provider models cannot smuggle credentials into ordinary action payloads',t=>{
 const f=fixture(t);f.observe();const before=f.count(),input={provider:'custom',expectedRevision:7,api:'openai-completions',baseURL:'https://provider.fixture/v1',models:[{id:'native-model',headers:{Authorization:'not-an-api-pattern'}}]};
 assert.throws(()=>f.action({resource:'providers',operation:'upsert',input,idempotencyKey:'provider-secret'}),{code:'DSH_SECURE_INPUT_REQUIRED'});assert.equal(f.count(),before);
});

test('stable request keys reject changed content before changed subject without retargeting a native action',t=>{
 const f=fixture(t),input={resource:'plugins',operation:'setBundleEnabled',input:{name:BUNDLE,enabled:false},idempotencyKey:'original-toggle'};f.observe();const first=f.action(input),old=f.repo.getA2AAction(first.action.id);assert.equal(f.action(input).action.id,first.action.id);
 f.db.prepare("UPDATE employees SET runtime_profile='beta' WHERE id=?").run(f.employee.id);const count=f.count();
 assert.throws(()=>f.action({...input,input:{name:BUNDLE,enabled:true}}),{code:'IDEMPOTENCY_CONFLICT'});assert.throws(()=>f.action(input),{code:'DSH_NATIVE_SUBJECT_CHANGED'});assert.equal(f.count(),count);assert.equal(old.payload.dshOperation.subject.profile,'alpha');
});

test('subject and scope validation fence current authority, negotiated feature and server-owned session mapping',t=>{
 const f=fixture(t),queued=f.refresh(),action=f.repo.getA2AAction(queued.action.id),payload=action.payload;assert.equal(assertDshNativeSubject(f.db,f.ws.id,payload).employeeId,f.employee.id);
 f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.employee.id);assert.throws(()=>assertDshNativeSubject(f.db,f.ws.id,payload),{code:'DSH_NATIVE_SUBJECT_CHANGED'});
 f.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(f.employee.id);f.repo.heartbeatDevice(SLUG,{deviceId:f.deviceId,runtimeDiscovery:{features:[]}});assert.throws(()=>assertDshNativeSubject(f.db,f.ws.id,payload),{code:'DSH_NATIVE_CLIENT_NOT_REPORTED'});
 const g=fixture(t),conversation=g.repo.createConversation(SLUG,{employeeId:g.employee.id});g.db.prepare('INSERT INTO conversation_dsh_sessions VALUES(?,?,?,?,?,?,?)').run(conversation.id,g.ws.id,g.employee.id,g.deviceId,'alpha','native-session-1',new Date().toISOString());const scoped=g.state({conversationId:conversation.id});assert.deepEqual(scoped.scope,{kind:'conversation',conversationId:conversation.id,nativeSessionId:'native-session-1'});
 assert.throws(()=>g.refresh({resources:['settings'],sessionId:'browser-native'}),{code:'DSH_NATIVE_INPUT_INVALID'});assert.throws(()=>g.action({resource:'arbitrary-rpc',operation:'execute',input:{},idempotencyKey:'not-implemented'}),{code:'DSH_NATIVE_OPERATION_UNSUPPORTED'});
});

test('older observations cannot become current after a newer late native mutation receipt',t=>{
 const f=fixture(t),oldId=f.observe(),write=f.action({resource:'settings',operation:'mutate',input:{ns:'agent-loop',expectedRevision:7,ops:[{op:'set',path:['maxParallelToolCalls'],value:8}]},idempotencyKey:'late-settings'});
 const updated=f.settings();updated.namespaces[0].revision=8;updated.namespaces[0].value.maxParallelToolCalls=8;f.complete(write.action.id,updated,{status:'applied',observations:{settings:{status:'observed',data:updated}}});f.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),write.action.id);
 const state=f.state(),settings=state.resources.settings;assert.equal(settings.status,'unknown');assert.equal(settings.reasonCode,'LATE_RECEIPT');assert.equal(settings.data,null);assert.equal(settings.snapshot.actionId,oldId);assert.equal(settings.snapshot.stale,true);assert.equal(settings.snapshot.data.namespaces[0].value.maxParallelToolCalls,3);
});


test('auxiliary RPC results never replace a canonical resource observation',t=>{
 const f=fixture(t),id=f.observe(),registries=f.action({resource:'plugins',operation:'registries',input:{},idempotencyKey:'registries'});f.complete(registries.action.id,['https://registry.fixture']);const view=f.state();assert.equal(view.resources.plugins.status,'observed');assert.equal(view.resources.plugins.snapshot.actionId,id);assert.equal(view.resources.plugins.data.bundles[0].name,BUNDLE);
});

test('obvious nested credential aliases require the secure input channel',t=>{
 const f=fixture(t),before=f.count();for(const key of ['credentials','credential','secrets','clientSecret','client_secret','auth']){
  const input={provider:'custom',expectedRevision:7,api:'openai-completions',baseURL:'https://provider.fixture/v1',models:[{id:'model',[key]:'not-an-api-key-pattern'}]};assert.throws(()=>f.action({resource:'providers',operation:'upsert',input,idempotencyKey:'secret-'+key}),{code:'DSH_SECURE_INPUT_REQUIRED'});
 }assert.equal(f.count(),before);
});

test('an empty new conversation has an explicit unbound native scope and cannot borrow another conversation session',t=>{
 const f=fixture(t),conversation=f.repo.createConversation(SLUG,{employeeId:f.employee.id}),view=f.state({conversationId:conversation.id});assert.deepEqual(view.scope,{kind:'conversation',conversationId:conversation.id,nativeSessionId:null});
 const other=f.repo.createEmployee(SLUG,{name:'Other native employee',runtime:'DSH',runtimeProfile:'beta',targetDeviceId:f.deviceId,ownerUserId:f.actor.actorUserId}),foreign=f.repo.createConversation(SLUG,{employeeId:other.id});assert.throws(()=>f.state({conversationId:foreign.id}),{code:'DSH_NATIVE_CONVERSATION_NOT_FOUND'});
});

test('native session-created registration is restricted to the original empty conversation and authenticated device',t=>{
 const f=fixture(t),conversation=f.repo.createConversation(SLUG,{employeeId:f.employee.id}),view=f.state({conversationId:conversation.id}),queued=f.service.action(SLUG,f.employee.id,{resource:'sessions',operation:'create',conversationId:conversation.id,input:{agentPreset:'native-custom'},expectedSubjectHash:view.subjectHash,idempotencyKey:'new-native-session'},f.actor),action=f.repo.getA2AAction(queued.action.id),op=action.payload.dshOperation;assert.deepEqual(op.runtimeContext,{cwd:null});
 f.repo.ackA2AAction(action.id,{deviceId:f.deviceId});const row=f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(action.id),dshNative={schemaVersion:1,source:'dsh-native',subject:op.subject,scope:op.scope,resource:'sessions',operation:'create',checkedAt:new Date().toISOString(),status:'applied',data:{sessionId:'created-native-session'}};
 assert.throws(()=>registerDshNativeResult(f.db,row,{deviceId:'wrong-device',status:'succeeded',result:{dshNative}}),{code:'DSH_NATIVE_DEVICE_MISMATCH'});assert.equal(f.db.prepare('SELECT count(*) n FROM conversation_dsh_sessions').get().n,0);
 assert.equal(registerDshNativeResult(f.db,row,{deviceId:f.deviceId,status:'succeeded',result:{dshNative}}).registered,true);assert.equal(f.state({conversationId:conversation.id}).scope.nativeSessionId,'created-native-session');
 assert.equal(registerDshNativeResult(f.db,row,{deviceId:f.deviceId,status:'succeeded',result:{dshNative}}).registered,true);
 assert.throws(()=>registerDshNativeResult(f.db,row,{deviceId:f.deviceId,status:'succeeded',result:{dshNative:{...dshNative,data:{sessionId:'other-native-session'}}}}),{code:'DSH_NATIVE_SESSION_BINDING_CONFLICT'});
 assert.equal(registerDshNativeResult(f.db,row,{deviceId:f.deviceId,status:'failed',result:{dshNative}}),null);assert.throws(()=>assertDshNativeSubject(f.db,f.ws.id,action.payload),{code:'DSH_NATIVE_SCOPE_CHANGED'});
 f.repo.resultA2AAction(action.id,{deviceId:f.deviceId,status:'succeeded',result:{dshNative:{...dshNative,observations:{sessions:{status:'observed',data:dshNative.data}}}}});const completed=f.repo.getA2AAction(action.id);assert.equal(assertDshNativeActionVisible(f.db,f.ws.id,completed).employeeId,f.employee.id);assert.equal(f.state({conversationId:conversation.id}).resources.sessions.data.sessionId,'created-native-session');f.db.prepare('DELETE FROM conversations WHERE id=?').run(conversation.id);assert.doesNotThrow(()=>f.state());
});

test('a DSH routine history result is echoed to the employee main chat with images once',t=>{
 const f=fixture(t),conversation=f.repo.createConversation(SLUG,{employeeId:f.employee.id,title:'主聊天'}),png=rasterFixtures.png.toString('base64');
 const queued=f.action({resource:'sessions',operation:'history',input:{sessionId:'routine-session',routineId:'routine-one',maxMessages:100},idempotencyKey:'routine-history-1'}),action=f.repo.getA2AAction(queued.action.id);
 f.complete(action.id,{snapshot:{type:'snapshot',records:[{type:'event',seq:7,event:{type:'assistant/message',data:{message:{content:[{type:'text',text:'例行结果已完成'}, {type:'image',mimeType:'image/png',data:png}]}}}}]}});
 let history=f.repo.getConversation(conversation.id);assert.equal(history.messages.length,1);assert.equal(history.messages[0].content,'例行结果已完成');assert.equal(history.messages[0].attachments[0].content,png);assert.equal(history.messages[0].attachments[0].mimeType,'image/png');
 const retry=f.action({resource:'sessions',operation:'history',input:{sessionId:'routine-session',routineId:'routine-one',maxMessages:100},idempotencyKey:'routine-history-2'});f.complete(retry.action.id,{snapshot:{type:'snapshot',records:[{type:'event',seq:7,event:{type:'assistant/message',data:{message:{content:[{type:'text',text:'例行结果已完成'}, {type:'image',mimeType:'image/png',data:png}]}}}}]}});
 history=f.repo.getConversation(conversation.id);assert.equal(history.messages.length,1);assert.equal(f.db.prepare("SELECT count(*) n FROM management_requests WHERE kind='dsh-routine-result-v1'").get().n,1);
});

test('an explicit unavailable observation invalidates current data and retains the older canonical snapshot as history',t=>{
 const f=fixture(t),old=f.observe(),next=f.action({resource:'settings',operation:'describe',input:{},idempotencyKey:'settings-offline'});f.complete(next.action.id,null,{status:'unknown',observations:{settings:{status:'unavailable',reasonCode:'DSH_NATIVE_NOT_READY',data:null}}});const section=f.state().resources.settings;assert.equal(section.status,'unknown');assert.equal(section.reasonCode,'DSH_NATIVE_NOT_READY');assert.equal(section.data,null);assert.equal(section.snapshot.actionId,old);assert.equal(section.snapshot.stale,true);
});





test('install operations derive their source only from a successful accepted inspection on the same current subject',t=>{
 const f=fixture(t),inspected=f.action({resource:'plugins',operation:'inspectSource',input:{spec:'@fixture/native-package@1.0.0',registry:'https://registry.fixture'},idempotencyKey:'inspect-install-source'});f.complete(inspected.action.id,{status:'accepted',bundle:true,name:'display-name-must-not-be-used'});
 const input={resource:'plugins',operation:'installBundle',input:{sourceActionId:inspected.action.id,enabled:true},idempotencyKey:'install-from-inspection'},installed=f.action(input),saved=f.repo.getA2AAction(installed.action.id);
 assert.deepEqual(saved.payload.dshOperation.installSource,{spec:'@fixture/native-package@1.0.0',registry:'https://registry.fixture'});assert.deepEqual(saved.payload.dshOperation.scope,{kind:'bot'});
 const altered=structuredClone(saved.payload);altered.dshOperation.installSource.spec='@fixture/unapproved';assert.throws(()=>assertDshNativeSubject(f.db,f.ws.id,altered),{code:'DSH_NATIVE_INSTALL_SOURCE_CHANGED'});
 const refused=f.action({resource:'plugins',operation:'inspectSource',input:{spec:'@fixture/refused'},idempotencyKey:'inspect-refused'});f.complete(refused.action.id,{status:'refused',bundle:false});assert.throws(()=>f.action({...input,input:{sourceActionId:refused.action.id,enabled:true},idempotencyKey:'refused-install'}),{code:'DSH_NATIVE_INSTALL_SOURCE_INVALID'});
});

test('install attempt controls and build approvals retain the original source and cannot replay an unknown installation',t=>{
 const f=fixture(t),inspect=f.action({resource:'plugins',operation:'inspectSource',input:{spec:'@fixture/native-package@1.0.0'},idempotencyKey:'build-source'});f.complete(inspect.action.id,{status:'accepted',bundle:true});
 const install=f.action({resource:'plugins',operation:'installBundle',input:{sourceActionId:inspect.action.id,enabled:true},idempotencyKey:'unapproved-build'}),original=f.repo.getA2AAction(install.action.id);
 const cancel=f.action({resource:'plugins',operation:'cancelInstall',input:{sourceActionId:install.action.id},idempotencyKey:'cancel-original'});assert.deepEqual(f.repo.getA2AAction(cancel.action.id).payload.dshOperation.scope,{kind:'attempt',sourceActionId:install.action.id});
 assert.throws(()=>f.action({resource:'plugins',operation:'cancelInstall',input:{sourceActionId:inspect.action.id},idempotencyKey:'cancel-inspect'}),{code:'DSH_NATIVE_INSTALL_SOURCE_INVALID'});
 f.complete(install.action.id,{receipt:{pendingBuilds:['native-build-a','native-build-b']}},{status:'failed'});
 const approved=f.action({resource:'plugins',operation:'installBundle',input:{sourceActionId:install.action.id,enabled:true,approvedBuilds:['native-build-a']},idempotencyKey:'approve-exact-package'});assert.deepEqual(f.repo.getA2AAction(approved.action.id).payload.dshOperation.installSource,original.payload.dshOperation.installSource);
 assert.throws(()=>f.action({resource:'plugins',operation:'installBundle',input:{sourceActionId:install.action.id,enabled:true,approvedBuilds:['unobserved-package']},idempotencyKey:'approve-invented'}),{code:'DSH_NATIVE_BUILD_APPROVAL_INVALID'});
 const unknown=f.action({resource:'plugins',operation:'installBundle',input:{sourceActionId:inspect.action.id,enabled:true},idempotencyKey:'unknown-install'});f.complete(unknown.action.id,{receipt:{pendingBuilds:['native-build-a']}},{status:'unknown'});assert.throws(()=>f.action({resource:'plugins',operation:'installBundle',input:{sourceActionId:unknown.action.id,enabled:true,approvedBuilds:['native-build-a']},idempotencyKey:'no-unknown-replay'}),{code:'DSH_NATIVE_INSTALL_OUTCOME_UNKNOWN'});
});

test('an uncertain mutation without readback stays unknown and preserves safe native revision conflict details',t=>{
 const f=fixture(t);f.observe();const write=f.action({resource:'plugins',operation:'setBundleEnabled',input:{name:BUNDLE,enabled:false},idempotencyKey:'unknown-toggle'});f.complete(write.action.id,{error:{code:'settings/conflict',details:{ns:'agent-loop',expected:7,actual:8,password:'PRIVATE_DIAGNOSTIC'},message:'PRIVATE_DIAGNOSTIC'}},{status:'unknown',reasonCode:'DSH_NATIVE_MUTATION_OUTCOME_UNKNOWN'});
 const publicAction=projectDshNativeAction(f.repo.getA2AAction(write.action.id));assert.deepEqual(publicAction.result.dshNative.data.error,{code:'settings/conflict',details:{ns:'agent-loop',expected:7,actual:8}});assert.equal(JSON.stringify(publicAction).includes('PRIVATE_DIAGNOSTIC'),false);const current=f.state().resources.plugins;assert.equal(current.status,'unknown');assert.equal(current.reasonCode,'DSH_NATIVE_MUTATION_OUTCOME_UNKNOWN');
});

test('preset selection cannot change a conversation with platform messages, even if its native session exists',t=>{
 const f=fixture(t),conversation=f.repo.createConversation(SLUG,{employeeId:f.employee.id});f.db.prepare('INSERT INTO conversation_dsh_sessions VALUES(?,?,?,?,?,?,?)').run(conversation.id,f.ws.id,f.employee.id,f.deviceId,'alpha','preset-native-session',new Date().toISOString());f.repo.addConversationMessage(conversation.id,{content:'Preserve this pending draft',role:'user',dispatch:false});const before=f.count(),scope=f.state({conversationId:conversation.id});assert.throws(()=>f.service.action(SLUG,f.employee.id,{resource:'presets',operation:'select',conversationId:conversation.id,input:{agentPreset:'different-native-preset'},expectedSubjectHash:scope.subjectHash,idempotencyKey:'preset-with-history'},f.actor),{code:'DSH_PRESET_REQUIRES_NEW_CONVERSATION'});assert.equal(f.count(),before);
});


test('conversation refresh is read-only for an unbound session and default refresh covers only the declared resources',t=>{
 const f=fixture(t),conversation=f.repo.createConversation(SLUG,{employeeId:f.employee.id}),queued=f.refresh({conversationId:conversation.id,resources:['sessions','plan','interactions'],idempotencyKey:'refresh-empty-conversation'}),payload=f.repo.getA2AAction(queued.action.id).payload;
 assert.deepEqual(payload.dshOperation.scope,{kind:'conversation',conversationId:conversation.id,nativeSessionId:null});assert.equal(f.db.prepare('SELECT count(*) n FROM conversation_dsh_sessions').get().n,0);assert.equal(assertDshNativeSubject(f.db,f.ws.id,payload).employeeId,f.employee.id);
 f.complete(queued.action.id,{resources:{sessions:{status:'unavailable',reasonCode:'DSH_NATIVE_SESSION_NOT_BOUND',data:null},plan:{status:'unavailable',reasonCode:'DSH_NATIVE_SESSION_NOT_BOUND',data:null},interactions:{status:'unavailable',reasonCode:'DSH_NATIVE_SESSION_NOT_BOUND',data:null}}});assert.equal(f.state({conversationId:conversation.id}).resources.plan.reasonCode,'DSH_NATIVE_SESSION_NOT_BOUND');assert.equal(f.db.prepare('SELECT count(*) n FROM conversation_dsh_sessions').get().n,0);
 const standard=f.refresh({idempotencyKey:'default-refresh'}),requested=f.repo.getA2AAction(standard.action.id).payload.dshOperation.input.resources;assert.deepEqual(requested,['plugins','settings','providers','presets','bot']);f.complete(standard.action.id,{resources:{plugins:{status:'observed',data:{bundles:[],plugins:[],inventory:{entries:[]}}}}});assert.equal(f.state().resources.files.reasonCode,'NOT_REPORTED');
});

test('an installation source or attempt cannot be reused by another employee or Bot on the same computer',t=>{
 const f=fixture(t),inspection=f.action({resource:'plugins',operation:'inspectSource',input:{spec:'@fixture/native-isolated'},idempotencyKey:'isolated-source'});f.complete(inspection.action.id,{status:'accepted',bundle:true});const installed=f.action({resource:'plugins',operation:'installBundle',input:{sourceActionId:inspection.action.id,enabled:true},idempotencyKey:'isolated-install'}),other=f.repo.createEmployee(SLUG,{name:'Other isolated Bot',runtime:'DSH',runtimeProfile:'beta',targetDeviceId:f.deviceId,ownerUserId:f.actor.actorUserId}),hash=f.service.state(SLUG,other.id,{},f.actor).subjectHash,before=f.count();
 for(const [operation,sourceActionId]of [['installBundle',inspection.action.id],['cancelInstall',installed.action.id]])assert.throws(()=>f.service.action(SLUG,other.id,{resource:'plugins',operation,input:{sourceActionId,...(operation==='installBundle'?{enabled:true}:{})},expectedSubjectHash:hash,idempotencyKey:'cross-bot-'+operation},f.actor),{code:'DSH_NATIVE_INSTALL_SOURCE_INVALID'});assert.equal(f.count(),before);
});

test('group metadata captures current authorized device peers and does not expand an original roster after enqueue',t=>{
 const f=fixture(t),peer=f.repo.createEmployee(SLUG,{name:'Group beta',runtime:'DSH',runtimeProfile:'beta',targetDeviceId:f.deviceId,ownerUserId:'peer-owner'}),listed=f.action({resource:'groups',operation:'list',input:{},idempotencyKey:'group-roster'}),action=f.repo.getA2AAction(listed.action.id),members=action.payload.dshOperation.groupMembers;
 assert.ok(members.some(item=>item.employeeId===f.employee.id&&item.profile==='alpha'));assert.ok(members.some(item=>item.employeeId===peer.id&&item.profile==='beta'));
 f.repo.createEmployee(SLUG,{name:'Later unrelated employee',runtime:'DSH',runtimeProfile:'beta',targetDeviceId:f.deviceId,ownerUserId:'unrelated-owner'});assert.equal(assertDshNativeSubject(f.db,f.ws.id,action.payload).employeeId,f.employee.id);
 f.db.prepare("UPDATE members SET role='member' WHERE id='native-owner-member'").run();f.actor.actorRole='member';f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(peer.id);assert.throws(()=>assertDshNativeSubject(f.db,f.ws.id,action.payload));
});

test('group CRUD requires observed authorized membership and hides old messages after a captured peer is revoked',t=>{
 const f=fixture(t),peer=f.repo.createEmployee(SLUG,{name:'Group beta',runtime:'DSH',runtimeProfile:'beta',targetDeviceId:f.deviceId,ownerUserId:'peer-owner'}),listed=f.action({resource:'groups',operation:'list',input:{},idempotencyKey:'group-list'}),group={id:'native-group',title:'Native group',members:['alpha','beta'],sessions:{},messages:[{id:'native-message',role:'assistant',botName:'beta',text:'PRIVATE_GROUP_MESSAGE'}]};f.complete(listed.action.id,{items:[group],sourceOperation:'list'},{observations:{groups:{status:'observed',data:{items:[group],sourceOperation:'list'}}}});
 const updated=f.action({resource:'groups',operation:'update',input:{groupId:group.id,title:'Updated native title'},idempotencyKey:'group-update'}),op=f.repo.getA2AAction(updated.action.id).payload.dshOperation;assert.deepEqual(op.scope,{kind:'group',groupId:group.id});assert.deepEqual(op.groupBinding,{groupId:group.id,members:['alpha','beta']});
 for(const memberEmployeeIds of [[f.employee.id],[peer.id,peer.id],[peer.id]])assert.throws(()=>f.action({resource:'groups',operation:'create',input:{title:'Invalid group',memberEmployeeIds},idempotencyKey:'invalid-group-'+memberEmployeeIds.length}),{code:'DSH_NATIVE_GROUP_MEMBERS_INVALID'});
 assert.throws(()=>f.action({resource:'groups',operation:'get',input:{groupId:'unobserved-group'},idempotencyKey:'unknown-group'}),{code:'DSH_NATIVE_GROUP_NOT_OBSERVED'});
 f.db.prepare("UPDATE members SET role='member' WHERE id='native-owner-member'").run();f.actor.actorRole='member';f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(peer.id);const view=f.state();assert.equal(view.resources.groups.status,'unknown');assert.equal(view.resources.groups.snapshot,null);assert.equal(JSON.stringify(view).includes('PRIVATE_GROUP_MESSAGE'),false);
});

test('backend settings projection uses native schema and own-only secret paths without executable callbacks',()=>{
 const descriptor={writable:true,namespaces:[
  {ns:'prototype',schema:{type:'object',dict:{}},secrets:[{path:['__proto__','toString'],set:true}],value:{}},
  {ns:'root',schema:{type:'string'},secrets:[{path:[],set:true}],value:'ROOT_PRIVATE'},
  {ns:'schema',schema:{type:'object',meta:{default:{secret:'DEFAULT_PRIVATE',public:'public'}},dict:{secret:{type:'string',meta:{role:'secret',default:'LEAF_PRIVATE',extra:{note:'EXTRA_PRIVATE'},description:'DESCRIPTION_PRIVATE'}},public:{type:'transform',inner:{type:'string'},callback:'CALLBACK_PRIVATE'}}},secrets:[],value:{secret:'VALUE_PRIVATE',public:'public'},base:{secret:'BASE_PRIVATE',public:'public'},user:{secret:'USER_PRIVATE'}}
 ]},original=Object.prototype.toString,projected=projectDshNativeData('settings',descriptor),serialized=JSON.stringify(projected);
 assert.equal(Object.prototype.toString,original);assert.equal(projected.namespaces[1].value,undefined);assert.deepEqual(projected.namespaces[2].value,{public:'public'});assert.deepEqual(projected.namespaces[2].schema.meta.default,{public:'public'});assert.equal(serialized.includes('_PRIVATE'),false);assert.equal(projected.namespaces[2].schema.dict.public.type,'transform');assert.equal(projected.namespaces[2].schema.dict.public.inner.type,'string');assert.equal(descriptor.namespaces[2].value.secret,'VALUE_PRIVATE');assert.equal(projectDshNativeData('settings',{namespaces:[{schema:null}]}),null);
});

test('group mentions follow the native tokenizer and explicit authorized employee IDs take precedence',()=>{
 const subject={employeeId:'employee-alpha',profile:'alpha'},members=[{employeeId:'employee-alpha',profile:'alpha'},{employeeId:'employee-beta',profile:'beta'}],binding={groupId:'native',members:['alpha','beta']},targets=(content,extra={})=>dshNativeGroupTargets(subject,members,binding,{content,...extra});
 assert.deepEqual(targets('@BETA，@beta：please respond.'),['employee-beta']);assert.deepEqual(targets('person@beta.invalid plus code+@unknown should not target'),['employee-alpha','employee-beta']);assert.deepEqual(targets('@everyone Please respond'),['employee-alpha','employee-beta']);assert.deepEqual(targets('@beta @all'),['employee-alpha','employee-beta']);assert.throws(()=>targets('@all @unknown'),{code:'DSH_NATIVE_GROUP_TARGET_UNKNOWN'});assert.throws(()=>targets('@未授权成员，please respond'),{code:'DSH_NATIVE_GROUP_TARGET_UNKNOWN'});assert.deepEqual(targets('@unknown',{targetEmployeeIds:['employee-beta']}),['employee-beta']);
});

test('a current team viewer cannot read another member private group through an owner observation or pending action',t=>{
 const f=fixture(t),peer=f.repo.createEmployee(SLUG,{name:'Private beta',runtime:'DSH',runtimeProfile:'beta',targetDeviceId:f.deviceId,ownerUserId:'private-peer-owner',visibility:'personal'}),viewer={actorUserId:'limited-viewer',actorRole:'member'};
 f.db.prepare("UPDATE workspaces SET kind='team' WHERE id=?").run(f.ws.id);f.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('limited-viewer-member',f.ws.id,viewer.actorUserId,'Viewer','viewer@fixture.invalid','member',new Date().toISOString());
 const listed=f.action({resource:'groups',operation:'list',input:{},idempotencyKey:'owner-private-groups'}),group={id:'private-native-group',title:'PRIVATE_GROUP_TITLE',members:['alpha','beta'],sessions:{},messages:[{role:'assistant',botName:'beta',text:'PRIVATE_GROUP_CONTENT'}]};f.complete(listed.action.id,{items:[group]},{observations:{groups:{status:'observed',data:{items:[group]}}}});
 const pending=f.action({resource:'groups',operation:'update',input:{groupId:group.id,title:'PRIVATE_PENDING_TITLE'},idempotencyKey:'owner-private-pending'}),view=f.service.state(SLUG,f.employee.id,{},viewer);
 const management=createManagementService(f.repo);assert.equal(management.employee(SLUG,f.employee.id,viewer).id,f.employee.id);assert.throws(()=>management.employee(SLUG,peer.id,viewer));assert.equal(view.resources.groups.data,null);assert.equal(view.resources.groups.snapshot,null);assert.equal(view.pending.some(item=>item.actionId===pending.action.id),false);assert.equal(JSON.stringify(view).includes('PRIVATE_GROUP'),false);
 const completed=f.repo.getA2AAction(listed.action.id);assert.throws(()=>assertDshNativeActionVisible(f.db,f.ws.id,completed,{userId:viewer.actorUserId,role:'member'}));assert.equal(assertDshNativeActionVisible(f.db,f.ws.id,completed,{userId:f.actor.actorUserId,role:'owner'}).employeeId,f.employee.id);
 assert.throws(()=>f.service.action(SLUG,f.employee.id,{resource:'groups',operation:'list',input:{},idempotencyKey:'owner-private-groups',expectedSubjectHash:view.subjectHash},viewer),{code:'EMPLOYEE_CAPABILITIES_AUTHORITY_REVOKED'});
});

test('group attachment admission rejects an empty message, paths, URLs and individual or combined oversized content before enqueue',t=>{
 const f=fixture(t),before=f.count(),send=input=>f.action({resource:'groups',operation:'send',input:{groupId:'not-yet-observed',content:'',...input},idempotencyKey:'invalid-group-attachment'});
 assert.throws(()=>send({}),{code:'DSH_NATIVE_INPUT_INVALID',status:400});
 for(const extra of [{path:'D:\\private\\local.png'},{url:'https://external.fixture/image.png'}])assert.throws(()=>send({attachments:[{name:'local.png',mimeType:'image/png',...extra}]}),{code:'DSH_NATIVE_INPUT_INVALID',status:400});
 const attachment=bytes=>({name:'large.txt',mimeType:'text/plain',contentBase64:Buffer.alloc(bytes,65).toString('base64')});
 assert.throws(()=>send({attachments:[attachment(2*1024*1024+1)]}),{code:'DSH_NATIVE_GROUP_ATTACHMENT_INVALID',status:400});
 assert.throws(()=>send({attachments:Array.from({length:6},()=>attachment(1800*1024))}),{code:'DSH_NATIVE_GROUP_ATTACHMENT_INVALID',status:400});assert.equal(f.count(),before);
});
