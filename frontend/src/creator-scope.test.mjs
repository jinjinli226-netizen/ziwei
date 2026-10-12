import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createConversationRequestSequence,mergeConversationDetail,mergeConversationLists} from './conversation-execution-state.mjs';
import {conversationSettingsSnapshot,mergeConversationSettingsDraft} from './workdir.js';
const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
function source(name){const start=app.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0);return app.slice(start,app.indexOf('\n}',start)+2);}
function implementation(name,bindings){
  const dependencies=name==='openConversation'?['conversationRequestScope','applyConversationDetail']:[];
  const stateBindings=dependencies.length?{createConversationRequestSequence,mergeConversationDetail,mergeConversationLists,conversationSettingsSnapshot,mergeConversationSettingsDraft}:{};
  const allBindings={refreshEmployeeBots:async()=>{},...stateBindings,...bindings};
  return new Function(...Object.keys(allBindings),`let workspaceLoadGeneration=0,conversationOpenGeneration=0,conversationListGeneration=0;${dependencies.length?'const conversationRequests=createConversationRequestSequence();':''}${dependencies.map(source).join('\n')}\nreturn (${source(name)});`)(...Object.values(allBindings));
}

test('actual App load never commits a delayed previous workspace snapshot',async()=>{
  let slug='a',releaseA;const delayed=new Promise(resolve=>releaseA=resolve);
  const refs=Object.fromEntries([...source('load').matchAll(/(\w+)\.value/g)].map(match=>[match[1],{value:[]}]));
  refs.authState.value={memberships:[{slug:'a',role:'member'},{slug:'b',role:'member'}],user:{name:'QA'}};refs.summary.value={workspace:{slug:'a'}};refs.selectedConversation.value=null;
  const blank={tasks:[],runtimes:[],models:[],skills:[],documents:[],automations:[],members:[],devices:[],employees:[],calendars:[],agents:[]};
  const api=Object.fromEntries(['tasks','runtimes','models','skills','documents','automations','members','devices','employees','calendar','agents'].map(name=>[name,()=>Promise.resolve({...blank,devices:[{id:slug}],employees:[{id:slug}],workspace:{slug,name:slug,preferences:{}}})]));
  api.summary=()=>{const requestSlug=slug;return requestSlug==='a'?delayed:Promise.resolve({workspace:{slug:requestSlug,name:requestSlug}});};
  let realtime=0;const load=implementation('load',{...refs,api,workspaceSlug:()=>slug,loadNotifications:async()=>{},loadConversations:async()=>{},openRealtime:()=>realtime++,notify:()=>{}});
  const old=load();slug='b';await load();assert.equal(refs.summary.value.workspace.slug,'b');releaseA({workspace:{slug:'a',name:'a'}});await old;
  assert.equal(refs.summary.value.workspace.slug,'b');assert.equal(refs.devices.value[0].id,'b');assert.equal(refs.employees.value[0].id,'b');assert.equal(realtime,1);
});
test('actual conversation open preserves the latest same-workspace selection',async()=>{
  let resolveOld;const old=new Promise(resolve=>resolveOld=resolve);const refs=Object.fromEntries([...['openConversation','conversationRequestScope','applyConversationDetail'].map(source).join('\n').matchAll(/(\w+)\.value/g)].map(match=>[match[1],{value:[]}]));
  refs.devices.value=[];refs.page.value='inbox';refs.conversationExecutionBusy.value=false;
  refs.selectedConversation.value=null;refs.conversationEmployeeId.value='creator';refs.conversations.value=[{id:'old',execution:null},{id:'creator',execution:null}];
  const latestExecution={id:'creator-action',status:'pending',created_at:'2026-10-12T01:00:02.000Z'};
  const open=implementation('openConversation',{...refs,api:{conversation:id=>id==='old'?old:Promise.resolve({id,employee_id:'creator',messages:[],execution:latestExecution})},workspaceSlug:()=> 'qa',clearConversationAttachment:()=>{},loadConversationExecution:async()=>{},startConversationPolling:()=>{},stopConversationPolling:()=>{},notify:()=>{}});
  const first=open({id:'old'},{push:false});assert.equal(await open({id:'creator'},{push:false}),true);resolveOld({id:'old',employee_id:'old-worker',messages:[],execution:{id:'old-action',status:'succeeded',created_at:'2026-10-12T01:00:01.000Z'}});assert.equal(await first,false);
  assert.equal(refs.selectedConversation.value.id,'creator');assert.equal(refs.conversationRouteId.value,'creator');
  assert.equal(refs.conversationEmployeeId.value,'creator');assert.equal(refs.conversationExecution.value.id,'creator-action');assert.equal(refs.conversations.value.find(item=>item.id==='creator').execution.id,'creator-action');
});
test('same-workspace load preserves the selected conversation second device throughout delayed list refresh',async()=>{
  for(const persistedDevice of ['second',null]){
    const refs=Object.fromEntries([...source('load').matchAll(/(\w+)\.value/g)].map(match=>[match[1],{value:[]}]));
    refs.authState.value={memberships:[{slug:'qa',role:'member'}],user:{name:'QA'}};refs.summary.value={workspace:{slug:'qa'}};
    refs.selectedConversation={value:{id:'creator-conversation',device_id:persistedDevice,employee_id:'creator'}};refs.conversationDeviceId.value=persistedDevice?'first':'second';
    const blank={tasks:[],runtimes:[],models:[],skills:[],documents:[],automations:[],members:[],devices:[{id:'first',status:'online'},{id:'second',status:'online'}],employees:[{id:'creator'}],calendars:[],agents:[]};
    const api=Object.fromEntries(['tasks','runtimes','models','skills','documents','automations','members','devices','employees','calendar','agents'].map(name=>[name,()=>Promise.resolve(blank)]));api.summary=()=>Promise.resolve({workspace:{slug:'qa',name:'QA'}});
    let finishList,listStarted;const delayedList=new Promise(resolve=>finishList=resolve),started=new Promise(resolve=>listStarted=resolve);
    const load=implementation('load',{...refs,api,workspaceSlug:()=> 'qa',loadNotifications:async()=>{},loadConversations:()=>{listStarted();return delayedList;},openRealtime:()=>{},notify:()=>{}});
    const loading=load();await started;assert.equal(refs.conversationDeviceId.value,'second','the pending list window must retain the existing conversation binding');finishList();await loading;assert.equal(refs.conversationDeviceId.value,'second');
  }
});
test('workspace switching immediately removes the old send target, draft and attachment while loading',async()=>{
  const switchSource=source('switchWorkspace'),sendSource=source('sendConversationMessage');
  const refs=Object.fromEntries([...`${switchSource}${sendSource}`.matchAll(/(\w+)\.value/g)].map(match=>[match[1],{value:[]} ]));
  refs.conversationAttachment={value:null};
  refs.page.value='inbox';refs.selectedConversation.value={id:'old-a',employee_id:'worker-a'};refs.conversationDraft.value='old draft';refs.conversationAttachment.value={name:'old.png'};refs.employees.value=[{id:'worker-a'}];
  let slug='a',finishLoad,writes=0,stopped=0;const delayed=new Promise(resolve=>finishLoad=resolve);
  const change=implementation('switchWorkspace',{...refs,workspaceSlug:()=>slug,setWorkspaceSlug:value=>slug=value,history:{pushState(){}},routePath:()=>'',clearConversationAttachment:()=>refs.conversationAttachment.value=null,stopConversationPolling:()=>stopped++,closeRealtime:()=>{},load:()=>delayed,loadZiweiConnect:async()=>{}});
  const send=implementation('sendConversationMessage',{...refs,api:{addConversationMessage:()=>writes++},notify:()=>{},refreshSelectedConversation:async()=>{},startConversationPolling:()=>{}});
  const changing=change('b');assert.equal(slug,'b');assert.equal(refs.selectedConversation.value,null);assert.equal(refs.conversationDraft.value,'');assert.equal(refs.conversationAttachment.value,null);assert.equal(refs.conversationRouteId.value,'');assert.equal(stopped,1);
  refs.conversationDraft.value='attempt while switching';await send();assert.equal(writes,0);finishLoad();await changing;
});
test('Creator reports success only when its persistent conversation actually opens',async()=>{
  const refs={employees:{value:[]},conversations:{value:[]},showEmployee:{value:true}};const notifications=[];
  const open=implementation('openCreatorConversation',{...refs,workspaceSlug:()=> 'qa',navigate:()=>{},openConversation:async()=>false,notify:message=>notifications.push(message)});
  await open({employee:{id:'creator'},conversation:{id:'conversation'},workspace:'qa',duplicate:false});assert.deepEqual(notifications,[]);
});
