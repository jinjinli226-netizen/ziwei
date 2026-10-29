import test from 'node:test';
import assert from 'node:assert/strict';
import {employeeConversationView} from './employee-conversation-view.js';
import {botMainChatView} from './bot-main-chat.js';
import {botWorkTasks} from './bot-main-chat.js';
import {hydrateRosterEmployee} from './bot-roster-entry.js';
import {readFile} from 'node:fs/promises';
import {ref} from 'vue';
import * as vue from 'vue';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';

const base=()=>({page:'inbox',workspace:'team',actorId:'owner',employeeId:'employee',employee:{id:'employee',runtime:'Codex'},conversation:{id:'conversation',employee_id:'employee',workspace:'team'},routeConversationId:'conversation',bindingResolved:true});

for(const runtime of ['Codex','DSH','Hermes','Claude'])test(`${runtime} uses an employee conversation without inventing a managed Bot`,()=>{
  const input=base();input.employee.runtime=runtime;
  assert.deepEqual(employeeConversationView(input),{shell:true,ready:true,pending:false,error:''});
  assert.equal(botMainChatView(input).ready,false);
});
test('ordinary inbox and unassigned legacy history retain their original surface',()=>{
  assert.equal(employeeConversationView({...base(),routeConversationId:'',routeEmployeeId:''}).shell,false);
  assert.equal(employeeConversationView({...base(),employeeId:'unassigned',conversation:{id:'conversation',employee_id:null,employee_binding:'unassigned_legacy'}}).shell,false);
  assert.equal(employeeConversationView({...base(),conversation:{id:'conversation',employee_id:null}}).shell,false);
});
test('an employee entry without a conversation is an empty state, not a fabricated chat',()=>{
  assert.deepEqual(employeeConversationView({...base(),conversation:null,routeConversationId:'',routeEmployeeId:'employee',bindingResolved:false}),{shell:true,ready:false,pending:false,error:''});
});
test('binding reads, unresolved authority, and errors cannot become a sendable generic fallback',()=>{
  for(const patch of [{bindingPending:true},{bindingResolved:false},{loading:true}])assert.deepEqual(employeeConversationView({...base(),...patch}),{shell:true,ready:false,pending:true,error:''});
  const denied=employeeConversationView({...base(),bindingError:'无法读取员工运行设置'});assert.equal(denied.ready,false);assert.equal(denied.pending,false);assert.match(denied.error,/无法读取/);
});
test('employee, workspace, actor, route and known Bot binding mismatches block the shared view',()=>{
  for(const patch of [{actorId:''},{employeeId:'other'},{employee:{id:'other'}},{routeConversationId:'other'},{conversation:{id:'conversation',employee_id:'employee',workspace:'other'}},{bot:{id:'other',workspace:'team'}},{bot:{id:'employee',workspace:'other'}}]){
    const view=employeeConversationView({...base(),...patch});assert.equal(view.ready,false);assert.ok(view.error);
  }
});
test('explicit main-chat intent still requires the original strict main-conversation contract',()=>{
  const input={...base(),intent:{workspace:'team',botId:'employee',conversationId:'conversation',pending:true},bot:{id:'employee',employee_id:'employee',workspace:'team',configuration_state:'initialized',main_conversation_id:'conversation'}};
  assert.equal(employeeConversationView(input).ready,true);assert.equal(botMainChatView(input).ready,true);
  for(const patch of [{bot:null},{bot:{...input.bot,main_conversation_id:'different'}},{intent:{...input.intent,botId:'other'}},{intent:{...input.intent,conversationId:'different'}},{intent:{...input.intent,workspace:'other'}}])assert.equal(employeeConversationView({...input,...patch}).ready,false);
});
test('an initialized Bot cannot downgrade a non-main route to a generic conversation by omitting intent',()=>{
  const input={...base(),bot:{id:'employee',employee_id:'employee',workspace:'team',configuration_state:'initialized',main_conversation_id:'conversation'}};
  assert.equal(employeeConversationView(input).ready,true);
  const nonMain=employeeConversationView({...input,bot:{...input.bot,main_conversation_id:'other'}});assert.equal(nonMain.ready,false);assert.match(nonMain.error,/主聊天/);
});

const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
function appFunction(name){
  const line=app.split('\n').find(value=>new RegExp(`^(?:async )?function ${name}\\(`).test(value));assert.ok(line,name);
  return line.trimEnd().endsWith('}')?line:app.slice(app.indexOf(line),app.indexOf('\n}',app.indexOf(line))+2);
}
function functions(names,bindings,prefix=''){
  return new Function(...Object.keys(bindings),prefix+names.map(appFunction).join('\n')+'\nreturn {'+names.join(',')+'};')(...Object.values(bindings));
}
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

test('actual App management handlers preserve inbox routes while retaining Bot deep links',()=>{
  const page=ref('bots'),employeeManagementSection=ref('chat'),writes=[];
  const ui=functions(['selectBotRoute','selectBotSection','selectEmployeeWorkspaceRoute','selectEmployeeWorkspaceSection'],{page,employeeManagementSection,botRouteId:ref('employee'),botInitialTab:ref('chat'),botWorkspace:ref('team'),history:{pushState:(_state,_title,url)=>writes.push(url)},routePath:(_page,id,workspace)=>`/${workspace}/bots/${id}`},'let rosterEntryGeneration=0;');
  ui.selectEmployeeWorkspaceRoute('employee');assert.deepEqual(writes,['/team/bots/employee']);
  ui.selectEmployeeWorkspaceSection('routines');assert.equal(writes.at(-1),'/team/bots/employee?section=routines');
  page.value='inbox';ui.selectEmployeeWorkspaceRoute('other');ui.selectEmployeeWorkspaceSection('knowledge');
  assert.equal(page.value,'inbox');assert.equal(writes.length,2);assert.equal(employeeManagementSection.value,'knowledge');
});

for(const runtime of ['Hermes','Codex'])test(`actual ${runtime} entry preserves the employee shell while conversation detail is pending`,async()=>{
  const request=defer(),employee={id:'employee',runtime},item={id:'conversation',employee_id:'employee'},state={page:ref('bots'),conversationRouteId:ref(''),conversationEmployeeId:ref(''),selectedConversation:ref(null),conversationExecution:ref(null),employees:ref([employee]),conversations:ref([]),botChatIntent:ref(null),botBindingPending:ref(false),conversationBotId:ref('')},notices=[];
  const shell=vue.computed(()=>state.page.value==='bots'||employeeConversationView({page:state.page.value,workspace:'team',actorId:'owner',employeeId:state.conversationEmployeeId.value,employee,conversation:state.selectedConversation.value,routeConversationId:state.conversationRouteId.value,intent:state.botChatIntent.value,bindingPending:state.botBindingPending.value,bindingResolved:false}).shell);
  const ui=functions(['openBotConversation','openEmployeeConversation'],{...state,workspaceSlug:()=> 'team',navigate:page=>{state.page.value=page;state.selectedConversation.value=null;state.conversationRouteId.value='';},history:{pushState(){},replaceState(){}},routePath:(_page,id='')=>'/team/inbox/'+id,openConversation:()=>request.promise,clearConversationAttachment(){},stopConversationPolling(){},loadConversations:async()=>{state.conversations.value=[item];},botForEmployee:()=>null,api:{},devices:ref([]),notify:message=>notices.push(message)},'let conversationOpenGeneration=0;');
  const pending=runtime==='Hermes'?ui.openBotConversation({workspace:'team',employee,conversation:item,botId:employee.id}):ui.openEmployeeConversation(employee);
  await vue.nextTick();await new Promise(setImmediate);
  assert.equal(state.page.value,'inbox');assert.equal(state.conversationRouteId.value,item.id);assert.equal(shell.value,true,'the existing workbench must stay mounted before detail arrives');assert.equal(state.selectedConversation.value,null);
  request.resolve(false);await pending;assert.deepEqual(notices,[]);
});

test('actual history controls use existing list/open/create flows and ignore abandoned reads',async()=>{
  const request=defer(),conversationQueueScope=ref('scope-one'),conversationHistoryOpen=ref(false),conversationListReading=ref(false),conversationListError=ref(''),calls=[];
  const ui=functions(['openEmployeeConversationHistory','selectEmployeeConversationHistory','createEmployeeConversation'],{conversationQueueScope,conversationHistoryOpen,conversationListReading,conversationListError,loadConversations:async options=>{calls.push(['list',options]);return request.promise;},openConversation:item=>calls.push(['open',item]),createConversation:()=>calls.push(['create'])});
  const reading=ui.openEmployeeConversationHistory();assert.equal(conversationHistoryOpen.value,true);assert.equal(conversationListReading.value,true);assert.deepEqual(calls[0],['list',{autoSelect:false}]);
  request.resolve(false);await reading;assert.equal(conversationListReading.value,false);assert.match(conversationListError.value,/读取失败/);
  ui.selectEmployeeConversationHistory({id:'original'});assert.equal(conversationHistoryOpen.value,false);assert.deepEqual(calls.at(-1),['open',{id:'original'}]);
  conversationHistoryOpen.value=true;ui.createEmployeeConversation();assert.equal(conversationHistoryOpen.value,false);assert.deepEqual(calls.at(-1),['create']);
  const late=defer();const stale=functions(['openEmployeeConversationHistory'],{conversationQueueScope,conversationHistoryOpen,conversationListReading,conversationListError,loadConversations:()=>late.promise});
  const pending=stale.openEmployeeConversationHistory();conversationQueueScope.value='scope-two';conversationListError.value='current employee';late.resolve(false);await pending;assert.equal(conversationListError.value,'current employee');
});

for(const kind of ['employee','creator'])test(`forward navigation opens a new uninitialized Hermes ${kind} without inventing main-chat intent`,async()=>{
  const employee={id:'target',runtime:'Hermes'},conversation={id:'target-conversation',employee_id:employee.id,employee,workspace:'team'},state={conversationForward:{result:{forward:{sourceConversationId:'source',targetConversationId:conversation.id,targetEmployeeId:employee.id}}},authState:ref({user:{id:'owner'}}),selectedConversation:ref({id:'source'}),conversationEmployeeId:ref('source-employee'),conversations:ref([]),conversationRouteId:ref(''),botChatIntent:ref(null)},paths=[];
  const ui=functions(['openForwardTargetConversation'],{...state,workspaceSlug:()=> 'team',navigate(){state.selectedConversation.value=null;state.botChatIntent.value=null;},history:{replaceState:(_state,_title,path)=>paths.push(path)},routePath:(_page,id)=>'/team/inbox/'+id,openConversation:async()=>{state.selectedConversation.value=conversation;return true;},loadConversations:async()=>{}});
  assert.equal(await ui.openForwardTargetConversation(),true);assert.equal(state.botChatIntent.value,null);assert.deepEqual(paths,['/team/inbox/target-conversation?employee=target']);
  assert.equal(employeeConversationView({page:'inbox',workspace:'team',actorId:'owner',employeeId:employee.id,employee,conversation,routeConversationId:state.conversationRouteId.value,intent:state.botChatIntent.value,bot:null,bindingResolved:true}).ready,true);
});

test('actual employee creation refreshes the persistent roster without remounting the workspace',async()=>{
  const source=appFunction('addEmployee'),refs=Object.fromEntries([...source.matchAll(/(\w+)\.value/g)].map(match=>[match[1],ref('')])),requests=[];
  Object.assign(refs,{employeeCreating:ref(false),employeeForm:ref({name:'新员工',runtime:'DSH',instructions:''}),employeeReady:ref({ready:true}),employeeEditId:ref(''),showEmployee:ref(true),employeeModel:ref('default'),employeeRuntimeProfile:ref('native-bot'),employeeTargetDeviceId:ref('pc'),employeeSkillIds:ref([]),employeeRosterRefreshKey:ref(0)});
  const ui=functions(['addEmployee'],{...refs,workspaceSlug:()=> 'team',employeeDefaultWorkdirPayload:()=>({}),api:{createEmployee:async(body,workspace)=>{requests.push({body,workspace});return{id:'new-employee'};}},load:async()=>{},notify(){},openPhoneSkillSetup(){}},'let employeeEditorGeneration=1;');
  await ui.addEmployee();assert.equal(requests.length,1);assert.equal(requests[0].workspace,'team');assert.equal(requests[0].body.runtimeProfile,'native-bot');assert.equal(refs.employeeRosterRefreshKey.value,1);assert.equal(refs.showEmployee.value,false);
});

test('actual drawer edit and advanced settings both hydrate the current employee and retain their separate original forms',async()=>{
  const full={id:'employee',runtime:'Codex',instructions:'完整职责',default_working_directory:'D:/Work'},calls=[];
  const ui=functions(['openRosterEmployeeSettings'],{page:ref('inbox'),employees:ref([]),workspaceSlug:()=> 'team',hydrateRosterEmployee,api:{employees:async()=>({employees:[full]})},openEmployeeModal:employee=>calls.push(['edit',employee]),openEmployeeProfile:employee=>calls.push(['advanced',employee]),notify(){}},'let rosterEntryGeneration=0,workspaceLoadGeneration=1;');
  await ui.openRosterEmployeeSettings({workspace:'team',employee:{id:'employee'}},{editor:true});await ui.openRosterEmployeeSettings({workspace:'team',employee:{id:'employee'}});
  assert.deepEqual(calls,[['edit',full],['advanced',full]]);
});

test('actual generic work panel reads only common tasks and the current execution, never Hermes APIs',async()=>{
  const calls=[],state={employeeChatView:ref({ready:true}),botChatView:ref({ready:false}),conversationBotBinding:ref(null),selectedConversation:ref({id:'conversation',employee_id:'employee'}),authState:ref({user:{id:'owner'}}),conversationExecution:ref({id:'action',status:'succeeded'}),botChatWork:ref({}),botChatWorkLoading:ref(false),botChatWorkError:ref('')};
  const api={botRuns:async()=>{calls.push('bot-runs');return{runs:[]};},botRoutines:async()=>{calls.push('bot-routines');return{routines:[]};},tasks:async()=>{calls.push('tasks');return{tasks:[{id:'mine',employee_id:'employee'},{id:'other',employee_id:'other'}]};}};
  const ui=functions(['loadBotChatWork'],{...state,api,workspaceSlug:()=> 'team',botWorkTasks},'let botChatWorkGeneration=0;');
  await ui.loadBotChatWork();assert.deepEqual(calls,['tasks']);assert.deepEqual(state.botChatWork.value.runs,[state.conversationExecution.value]);assert.deepEqual(state.botChatWork.value.routines,[]);assert.equal(state.botChatWork.value.tasks[0].id,'mine');assert.equal(state.botChatWork.value.tasks.length,1);
  state.botChatView.value={ready:true};state.conversationBotBinding.value={id:'employee'};await ui.loadBotChatWork();assert.deepEqual(calls.slice(1),['bot-runs','bot-routines','tasks']);
});

const filename=new URL('./App.vue',import.meta.url).pathname,{descriptor,errors}=parse(app,{filename});assert.deepEqual(errors,[]);
const script=compileScript(descriptor,{id:'employee-wiring'}),start=descriptor.template.content.indexOf('<BotWorkbench '),end=descriptor.template.content.indexOf('</BotWorkbench>',start)+15;
const compiled=compileTemplate({source:descriptor.template.content.slice(start,end),filename,id:'employee-wiring',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(compiled.errors,[]);
const imports=compiled.code.match(/^import \{(.*?)\} from "vue"/m)[1].split(',').map(token=>token.trim().split(/\s+as\s+/));
const render=new Function(...imports.map(([,alias])=>alias),compiled.code.replace(/^import .* from "vue"\n/m,'').replace('export function render','return function render'))(...imports.map(([name])=>vue[name]));
function wiring(overrides={}){
  const calls=[],workbench={name:'WorkbenchSeam'},chat={name:'ChatSeam'},select={name:'SelectSeam'};
  const setup=new Proxy({employeeWorkspaceShell:true,authState:{user:{id:'owner'}},employeeWorkspaceSlug:'team',page:'inbox',conversationEmployeeId:'employee',employeeManagementSection:'chat',loadedBotOptionsWorkspace:'team',models:[],skills:[],employeeChatView:{ready:true,pending:false,error:''},botChatView:{ready:false},employeeChatEmployee:{id:'employee',runtime:'Codex'},selectedConversation:{id:'conversation',employee_id:'employee'},conversationExecution:null,conversationBotBinding:null,conversationExecutionBusy:false,conversationForward:{messageIds:[]},conversationUsesNativeDsh:false,conversationStatusLoading:false,botBindingPending:false,botBindingError:'',BotWorkbench:workbench,BotMainChat:chat,ZiSelect:select,...overrides},{get:(target,key)=>key in target?target[key]:(...args)=>calls.push([key,...args])});
  const outer=render({},[],null,setup);return{setup,calls,outer,chat,select,openSection:section=>calls.push(['section',section])};
}
test('compiled App uses one persistent workbench and only renders the selected employee chat',()=>{
  const ui=wiring(),slot=ui.outer.children.chat({employeeId:'employee',openSection:ui.openSection}),chat=slot.find(value=>value.type===ui.chat);
  assert.equal(ui.outer.key,'owner:team');assert.equal(ui.outer.props['chat-mode'],'');assert.equal(chat.props.employee,ui.setup.employeeChatEmployee);assert.equal(chat.props.managed,false);assert.equal(chat.props.bot,null);assert.equal(chat.props['can-stop'],false);
  chat.props.onSettings('capabilities');assert.deepEqual(ui.calls.at(-1),['section','capabilities']);chat.props.onSend();assert.deepEqual(ui.calls.at(-1),['sendConversationMessage']);chat.props.onHistory();assert.deepEqual(ui.calls.at(-1),['openEmployeeConversationHistory']);
  assert.equal(ui.outer.children.chat({employeeId:'other',openSection:ui.openSection}).some(value=>value.type===ui.chat),false);
  const pending=wiring({employeeChatView:{ready:false,pending:true,error:''}});assert.equal(pending.outer.children.chat({employeeId:'employee',openSection:pending.openSection}).some(value=>value.type===pending.chat),false);
});
test('compiled App retains strict Bot controls and actual DSH model/device settings policy',()=>{
  const bot={id:'employee',employee:{model_id:'configured'}},managed=wiring({botChatView:{ready:true},conversationBotBinding:bot,conversationExecutionBusy:true});
  const strict=managed.outer.children.chat({employeeId:'employee',openSection:managed.openSection}).find(value=>value.type===managed.chat);assert.equal(strict.props.bot,bot);assert.equal(strict.props.managed,true);assert.equal(strict.props['can-stop'],true);
  const native=wiring({conversationUsesNativeDsh:true}),chat=native.outer.children.chat({employeeId:'employee',openSection:native.openSection}).find(value=>value.type===native.chat),model=chat.children['conversation-settings']({kind:'model'})[0].children.find(value=>value.type===native.select),device=chat.children['conversation-settings']({kind:'device'})[0].children.find(value=>value.type===native.select);
  assert.equal(model.props.disabled,true);assert.equal(model.props['aria-label'],'选择会话模型');device.props['onUpdate:modelValue']('selected-computer');assert.deepEqual(native.calls.at(-1),['selectConversationDevice','selected-computer']);
});

test('the real App setup initializes ordinary, management and employee routes without early state access or requests',async()=>{
  const bindings={};let code=script.content;const calls=[];
  for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
    const [statement,specifier,spec]=match;let value;
    if(spec==='vue')value={...vue,onMounted(){},onUnmounted(){},defineAsyncComponent:()=>({})};
    else if(spec==='./api.js')value={API_BASE:'https://fixture.invalid',workspaceSlug:()=> 'team',setWorkspaceSlug(){},api:new Proxy({},{get:(_target,name)=>(()=>{calls.push(name);throw Error('Unexpected setup request');})})};
    else if(spec.endsWith('.vue'))value={default:{}};
    else if(spec==='@ziwei/ui'||spec==='lucide-vue-next')value=new Proxy({},{get:()=>({})});
    else value=await import(new URL(spec,new URL('./App.vue',import.meta.url)));
    if(specifier.startsWith('{'))for(const token of specifier.slice(1,-1).split(',')){const [key,alias]=token.trim().split(/\s+as\s+/);bindings[alias||key]=value[key];}
    else bindings[specifier]=value.default;
    code=code.replace(statement,'');
  }
  const make=new Function(...Object.keys(bindings),'window','document','location','localStorage','sessionStorage',code.replaceAll('import.meta.env','({VITE_ZIWEI_PREVIEW:"true"})').replace('export default','return'));
  for(const path of ['/team/home','/team/bots/employee','/team/inbox/conversation?employee=employee']){
    const scope=vue.effectScope(),location=new URL(path,'https://fixture.invalid'),storage={getItem(){return null;},setItem(){},removeItem(){}};
    try{
      const component=make(...Object.values(bindings),{addEventListener(){},removeEventListener(){}},{documentElement:{dataset:{}},addEventListener(){},removeEventListener(){}},location,storage,storage);
      const state=scope.run(()=>component.setup({}, {expose(){}}));assert.equal(state.page.value,path.includes('/bots/')?'bots':path.includes('/inbox/')?'inbox':'home');assert.equal(state.employeeWorkspaceShell.value,!path.endsWith('/home'));
    }finally{scope.stop();}
  }
  assert.deepEqual(calls,[]);
});
