import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorInstancePayload} from './creator-market.js';
import {readFile} from 'node:fs/promises';

const ready={ready:true,authentication:'configured',provider:'configured'};
const discovery={workspace:'qa',devices:[{id:'pc-a',status:'online',management_mcp:{workspace:'qa',state:'pending'},runtimes:[{name:'Codex',cli_status:'available',available:true,readiness:ready}]}]};
const receipt={workspace:'qa',deviceId:'pc-a',path:'D:\\中文资料\\数字员工',actionId:'inspect-a'};
test('Creator forwards a checked employee directory to its first conversation configuration',()=>{
  const body=creatorInstancePayload(discovery,{deviceId:'pc-a',runtime:'Codex',defaultWorkingDirectory:receipt.path,defaultWorkingDirectoryCheck:receipt});
  assert.equal(body.defaultWorkingDirectory,receipt.path);
  assert.equal(body.defaultWorkingDirectoryActionId,'inspect-a');
});

let workdir;
try {workdir=await import('./workdir.js');} catch(cause) {if(cause.code!=='ERR_MODULE_NOT_FOUND')throw cause;}
function implementation(name){assert.equal(typeof workdir?.[name],'function',`${name} behavior has not been implemented`);return workdir[name];}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
test('directory checks ignore a late result from a previous employee, device or closed editor',async()=>{
  const create=implementation('createDirectoryController');
  for(const change of [s=>s.entityId='employee-b',s=>s.deviceId='pc-b',s=>s.editorId++,s=>s.workspace='other']){
    const scope={workspace:'qa',entityId:'employee-a',deviceId:'pc-a',editorId:1};const response=deferred();
    const controller=create({scope:()=>scope,inspect:()=>response.promise,poll:async()=>assert.fail('stale scope must stop polling')});
    controller.setPath(receipt.path);const check=controller.inspect();change(scope);
    response.resolve({action:{id:'inspect-a',status:'succeeded',result:{path:receipt.path,exists:true,isDirectory:true}}});await check;
    assert.equal(controller.state.check,null);assert.equal(controller.state.result,null);
  }
});
test('editing a path invalidates its checked receipt before a new directory can be saved',async()=>{
  const controller=implementation('createDirectoryController')({scope:()=>({workspace:'qa',entityId:'a',deviceId:'pc-a',editorId:1}),inspect:async()=>({action:{id:'inspect-a',status:'succeeded',result:{path:receipt.path,exists:true,isDirectory:true}}})});
  controller.setPath(receipt.path);await controller.inspect();assert.equal(controller.state.check.actionId,'inspect-a');
  controller.setPath('D:\\another');assert.equal(controller.state.check,null);assert.equal(controller.state.result,null);
});
test('pending directory polling freezes the original conversation scope and stops on navigation',async()=>{
  const scope={workspace:'qa',entityId:'conversation-a',deviceId:'pc-a',editorId:1};const delay=deferred(),polls=[];
  const controller=implementation('createDirectoryController')({scope:()=>scope,inspect:async()=>({action:{id:'inspect-a',status:'pending'}}),pause:()=>delay.promise,poll:async(actionId,frozen)=>{polls.push({actionId,frozen});return {action:{id:actionId,status:'succeeded',result:{path:'D:\\a',exists:true,isDirectory:true}}};}});
  controller.setPath('D:\\a');const check=controller.inspect();await Promise.resolve();scope.entityId='conversation-b';delay.resolve();await check;
  assert.deepEqual(polls,[]);assert.equal(controller.state.check,null);
});
test('employee default omission preserves an unchanged binding, explicit clearing clears it, switching device requires new evidence',()=>{
  const payload=implementation('defaultWorkdirPayload');
  assert.deepEqual(payload({path:receipt.path,originalPath:receipt.path,deviceId:'pc-a',originalDeviceId:'pc-a',workspace:'qa'}),{});
  assert.deepEqual(payload({path:'',originalPath:receipt.path,deviceId:'pc-b',originalDeviceId:'pc-a',workspace:'qa'}),{defaultWorkingDirectory:null});
  assert.throws(()=>payload({path:receipt.path,originalPath:receipt.path,deviceId:'pc-b',originalDeviceId:'pc-a',workspace:'qa',check:receipt}),/检查/);
  assert.deepEqual(payload({path:receipt.path,deviceId:'pc-a',workspace:'qa',check:receipt}),{defaultWorkingDirectory:receipt.path,defaultWorkingDirectoryActionId:'inspect-a'});
});
test('new conversations prefer their employee device and omit directory so backend inheritance remains authoritative',()=>{
  const body=implementation('employeeConversationPayload')({id:'a',name:'员工',target_device_id:'pc-b'},[{id:'pc-a',status:'online',workdir:'C:\\legacy'},{id:'pc-b',status:'online',workdir:'D:\\device'}]);
  assert.equal(body.deviceId,'pc-b');assert.equal('workingDirectory' in body,false);assert.equal('cwd' in body,false);
});
test('same conversation refresh updates clean settings from its snapshot and preserves a dirty temporary override',()=>{
  const merge=implementation('mergeConversationSettingsDraft');
  const prior={deviceId:'pc-a',workingDirectory:'D:\\old',modelId:'one'};const next={deviceId:'pc-a',workingDirectory:'D:\\saved',modelId:'two'};
  assert.deepEqual(merge(prior,prior,next),next);
  assert.deepEqual(merge(prior,{...prior,workingDirectory:'D:\\temporary'},next),{...next,workingDirectory:'D:\\temporary'});
});

const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
function source(name){const start=app.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0);return app.slice(start,app.indexOf('\n}',start)+2);}
function appFunction(name,bindings){return new Function(...Object.keys(bindings),`let conversationOpenGeneration=0,employeeEditorGeneration=0;return (${source(name)});`)(...Object.values(bindings));}
test('actual new conversation handler does not overwrite employee inheritance with a leftover device cwd',async()=>{
  const employee={id:'a',name:'A',target_device_id:'pc-b'},writes=[];
  const create=appFunction('createConversation',{workspaceSlug:()=> 'qa',conversationEmployeeId:{value:'a'},activeConversationEmployee:{value:employee},conversationDeviceId:{value:'pc-a'},devices:{value:[{id:'pc-a',status:'online',workdir:'C:\\legacy'},{id:'pc-b',status:'online',workdir:'D:\\device'}]},api:{createConversation:async body=>{writes.push(body);return {id:'new'};}},employeeConversationPayload:workdir?.employeeConversationPayload,conversations:{value:[]},openConversation:async()=>{},notify:message=>assert.fail(message)});
  await create();assert.equal(writes[0].deviceId,'pc-b');assert.equal('workingDirectory' in writes[0],false);
});
test('actual device switch preserves the current directory and does not save before revalidation',()=>{
  const cwd={value:'D:\\chosen'},device={value:'pc-a'};let writes=0,opened=0;
  const change=appFunction('selectConversationDevice',{conversationDeviceId:device,conversationWorkingDirectory:cwd,devices:{value:[{id:'pc-b',workdir:'C:\\fallback'}]},saveConversationSettings:()=>writes++,conversationDirectoryCheck:{value:receipt},openConversationDirectoryPicker:()=>opened++});
  change('pc-b');assert.equal(cwd.value,'D:\\chosen');assert.equal(writes,0);assert.equal(opened,1);
});
test('a delayed employee save cannot close a newly opened employee editor',async()=>{
  const refs=Object.fromEntries([...source('addEmployee').matchAll(/(\w+)\.value/g)].map(match=>[match[1],{value:''}]));
  Object.assign(refs,{employeeForm:{value:{name:'A',runtime:'Codex'}},employeeReady:{value:{ready:true}},employeeCreating:{value:false},employeeEditId:{value:'a'},showEmployee:{value:true},employeeModel:{value:'default'},employeeRuntimeProfile:{value:''},employeeTargetDeviceId:{value:'pc-a'},employeeSkillIds:{value:[]}});
  const response=deferred();let loads=0;const save=appFunction('addEmployee',{...refs,api:{updateEmployee:()=>response.promise},workspaceSlug:()=> 'qa',employeeDefaultWorkdirPayload:()=>({}),load:async()=>loads++,notify:()=>{},openPhoneSkillSetup:()=>{}});
  const pending=save();refs.employeeEditId.value='b';response.resolve({id:'a'});await pending;
  assert.equal(refs.showEmployee.value,true);assert.equal(refs.employeeEditId.value,'b');assert.equal(loads,0);
});
test('a late conversation directory save preserves a newer directory picker draft',async()=>{
  const response=deferred(),draft={value:receipt.path},check={value:null};let closed=0;
  const use=appFunction('useConversationDirectory',{workspaceSlug:()=> 'qa',conversationDeviceId:{value:'pc-a'},conversationDirectoryPathDraft:draft,conversationDirectoryCheck:check,conversationDirectoryEditorVersion:{value:1},conversationComposeKey:()=> 'qa\0a',conversationWorkingDirectory:{value:'D:\\old'},saveConversationSettings:()=>response.promise,closeConversationDirectoryPicker:()=>closed++,notify:()=>{}});
  const pending=use(receipt);draft.value='D:\\newer draft';check.value=null;response.resolve(true);await pending;assert.equal(closed,0);
});
