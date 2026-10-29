import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {conversationSettingsSnapshot,mergeConversationSettingsDraft,employeeConversationPayload} from './workdir.js';
import {createConversationRequestSequence,mergeConversationDetail,mergeConversationLists} from './conversation-execution-state.mjs';
import {createConversationComposerStore} from './conversation-compose.js';

const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
function source(name){const start=app.search(new RegExp(`(?:async )?function ${name}\\(`));assert(start>=0);return app.slice(start,app.indexOf('\n}',start)+2);}
const ref=value=>({value});
function fixture(){
  const employee={id:'employee-a',name:'A',workspace_id:'ws-a',runtime:'Codex',target_device_id:'device-b',default_working_directory:'D:\\Employees\\A',default_working_directory_device_id:'device-b'};
  const saved={id:'conversation-a',workspace_id:'ws-a',employee_id:employee.id,employee,device_id:null,working_directory:null,messages:[],execution:null};
  const writes={created:[],settings:[],messages:[]},notices=[];
  const ui={selectedConversation:ref(null),conversations:ref([]),employees:ref([employee]),activeConversationEmployee:ref(employee),devices:ref([{id:'device-a',status:'online',workdir:'C:\\Users\\Other'},{id:'device-b',status:'online',workdir:'C:\\Users\\A'}]),conversationEmployeeId:ref(employee.id),conversationDeviceId:ref(''),conversationModelId:ref(''),conversationWorkingDirectory:ref(''),conversationExecution:ref(null),conversationRouteId:ref(''),page:ref('inbox'),botChatIntent:ref(null),botBindingPending:ref(false),botBindingError:ref(''),conversationBotBinding:ref(null),conversationDirectoryCheck:ref(null)};
  const composer=createConversationComposerStore();
  const bindings={...ui,conversationSettingsSnapshot,mergeConversationSettingsDraft,employeeConversationPayload,createConversationRequestSequence,mergeConversationDetail,mergeConversationLists,conversationComposer:composer,workspaceSlug:()=> 'workspace-a',routePath:(page,id)=>'/workspace-a/'+page+'/'+id,conversationComposeKey:()=>`workspace-a\0${ui.selectedConversation.value?.id||''}`,clearConversationAttachment:()=>{},loadConversationExecution:async()=>{},refreshBotChatFailureState:async()=>{},startConversationPolling:()=>{},stopConversationPolling:()=>{},executionNeedsPolling:()=>false,history:{pushState:()=>{}},notify:message=>notices.push(message),api:{
    conversation:async()=>structuredClone(saved),
    createConversation:async body=>{writes.created.push(body);return structuredClone(saved);},
    updateConversation:async(id,body)=>{assert.equal(id,saved.id);writes.settings.push(body);if(Object.hasOwn(body,'workingDirectory'))saved.working_directory=body.workingDirectory;if(Object.hasOwn(body,'deviceId'))saved.device_id=body.deviceId;if(Object.hasOwn(body,'modelId'))saved.model_id=body.modelId;return structuredClone(saved);},
    addConversationMessage:async(id,body)=>{assert.equal(id,saved.id);writes.messages.push(body);return{id:'local-message'};}
  }};
  const names=['conversationRequestScope','applyConversationDetail','openConversation','createConversation','refreshSelectedConversation','sendConversationMessage','saveConversationSettings'];
  const actions=Function(...Object.keys(bindings),`let conversationSettingsBaseline=null;let conversationOpenGeneration=0;const conversationRequests=createConversationRequestSequence();${names.map(source).join('\n')}return {${names.join(',')}};`)(...Object.values(bindings));
  return{...ui,...actions,saved,employee,writes,notices,composer,draft:()=>composer.updateDraft(`workspace-a\0${saved.id}`,'pure fixture message')};
}

test('snapshot prefers exact employee device and its checked default over the first online computer',()=>{
  const f=fixture(),value=conversationSettingsSnapshot(f.saved,f.devices.value);
  assert.equal(value.deviceId,'device-b');assert.equal(value.workingDirectory,f.employee.default_working_directory);
});

for(const [name,change] of Object.entries({
  'another employee':row=>{row.employee.id='employee-other';},
  'another workspace':row=>{row.employee.workspace_id='ws-other';},
  'another default-directory device':row=>{row.employee.default_working_directory_device_id='device-other';},
  'an inconsistent employee target':row=>{row.employee.target_device_id='device-other';},
  'a missing default-directory device':row=>{delete row.employee.default_working_directory_device_id;}
}))test(`snapshot never borrows the D directory from ${name}`,()=>{
  const f=fixture(),conversation=structuredClone(f.saved);conversation.device_id='device-b';change(conversation);
  assert.equal(conversationSettingsSnapshot(conversation,f.devices.value).workingDirectory,'C:\\Users\\A');
});

test('a saved conversation directory stays explicit when the employee default changes',()=>{
  const f=fixture();f.saved.working_directory='D:\\Existing conversation';f.employee.default_working_directory='E:\\New default';
  assert.equal(conversationSettingsSnapshot(f.saved,f.devices.value).workingDirectory,'D:\\Existing conversation');
});

test('legacy unassigned conversation snapshot does not borrow an employee or throw',()=>{
  assert.deepEqual(conversationSettingsSnapshot({id:'legacy',workspace_id:'ws-a'},[{id:'pc',status:'online',workdir:'C:/legacy'}]),{deviceId:'pc',modelId:'',workingDirectory:'C:/legacy'});
});

test('actual new/open/refresh/send uses employee D through inheritance without persisting a fallback',async()=>{
  const f=fixture();await f.createConversation();assert.equal(f.writes.created.length,1);assert.equal(f.writes.created[0].deviceId,'device-b');assert.equal(Object.hasOwn(f.writes.created[0],'workingDirectory'),false);
  assert.equal(f.conversationDeviceId.value,'device-b');assert.equal(f.conversationWorkingDirectory.value,f.employee.default_working_directory);
  await f.refreshSelectedConversation();assert.equal(f.conversationWorkingDirectory.value,f.employee.default_working_directory);
  f.draft();await f.sendConversationMessage();assert.equal(f.writes.messages.length,1);assert.equal(Object.hasOwn(f.writes.messages[0],'cwd'),false);
  const effective=f.writes.messages[0].cwd||f.saved.working_directory||f.employee.default_working_directory;
  assert.equal(effective,'D:\\Employees\\A');assert.equal(f.saved.working_directory,null);assert.deepEqual(f.writes.settings,[]);assert.deepEqual(f.notices,['消息已发送，等待数字伙伴回复']);
});

for(const defaultDirectory of ['D:\\Employees\\A',null])test(`model save does not turn ${defaultDirectory?'employee':'device'} fallback into a saved override`,async()=>{
  const f=fixture();f.employee.default_working_directory=defaultDirectory;await f.openConversation(f.saved);f.conversationModelId.value='selected-model';await f.saveConversationSettings({notifyUser:false});
  assert.equal(f.writes.settings.length,1);assert.equal(f.writes.settings[0].modelId,'selected-model');assert.equal(Object.hasOwn(f.writes.settings[0],'workingDirectory'),false);assert.equal(f.saved.working_directory,null);
});

test('a deliberate temporary directory survives refresh and is sent explicitly',async()=>{
  const f=fixture();await f.openConversation(f.saved);f.conversationWorkingDirectory.value='E:\\Temporary';await f.refreshSelectedConversation();assert.equal(f.conversationWorkingDirectory.value,'E:\\Temporary');
  f.draft();await f.sendConversationMessage();assert.equal(f.writes.messages[0].cwd,'E:\\Temporary');assert.equal(f.saved.working_directory,null);
});

test('an explicit directory choice can pin the same path as the inherited default',async()=>{
  const f=fixture();await f.openConversation(f.saved);await f.saveConversationSettings({notifyUser:false,directorySelected:true});assert.equal(f.writes.settings[0].workingDirectory,'D:\\Employees\\A');assert.equal(f.saved.working_directory,'D:\\Employees\\A');
});

test('a server device change cannot carry a temporary directory from the old computer',()=>{
  const prior={deviceId:'pc-a',modelId:'',workingDirectory:'D:/old'},draft={...prior,workingDirectory:'E:/temporary-on-a'},next={deviceId:'pc-b',modelId:'',workingDirectory:'F:/b-default'};
  assert.equal(mergeConversationSettingsDraft(prior,draft,next).workingDirectory,'F:/b-default');
  assert.equal(mergeConversationSettingsDraft(prior,{...draft,deviceId:'pc-b'},prior).workingDirectory,'E:/temporary-on-a','an explicit pending device choice still waits for its existing validation guard');
});


test('a newer employee list cannot turn an unchanged displayed inherited directory into an explicit message override',async()=>{
  const f=fixture();await f.openConversation(f.saved);f.employee.default_working_directory='E:\\New employee default';
  f.draft();await f.sendConversationMessage();assert.equal(Object.hasOwn(f.writes.messages[0],'cwd'),false);assert.equal(f.saved.working_directory,null);
  await f.refreshSelectedConversation();assert.equal(f.conversationWorkingDirectory.value,'E:\\New employee default');
});

test('a new device heartbeat directory never turns the previous displayed fallback into a saved override',async()=>{
  const f=fixture();f.employee.default_working_directory=null;await f.openConversation(f.saved);
  assert.equal(f.conversationWorkingDirectory.value,'C:\\Users\\A');f.devices.value[1].workdir='E:\\New device fallback';
  f.conversationModelId.value='updated-model';await f.saveConversationSettings({notifyUser:false});
  assert.equal(Object.hasOwn(f.writes.settings[0],'workingDirectory'),false);assert.equal(f.saved.working_directory,null);
  assert.equal(f.conversationWorkingDirectory.value,'E:\\New device fallback');f.draft();await f.sendConversationMessage();assert.equal(Object.hasOwn(f.writes.messages[0],'cwd'),false);
});
