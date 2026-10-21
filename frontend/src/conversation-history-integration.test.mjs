import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prependConversationHistory} from './conversation-history.mjs';
import {createConversationRequestSequence,mergeConversationDetail} from './conversation-execution-state.mjs';
import {loadBotPageOptions} from './bot-page-load.js';

const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
function source(name){const start=app.search(new RegExp(`(?:async )?function ${name}\\(`));assert(start>=0);return app.slice(start,app.indexOf('\n}',start)+2);}
const ref=value=>({value}),deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(){
  const state={selectedConversation:ref({id:'chat-a',messages:[{id:'m20'}],messagePage:{hasMore:true,beforeCursor:'m20',total:30},execution:{id:'current'}}),authState:ref({user:{id:'owner'}}),conversationHistoryLoading:ref(false),conversationHistoryError:ref('')};
  const gate=deferred(),calls=[];
  const bindings={...state,document:{querySelector:()=>null},nextTick:()=>Promise.resolve(),conversationRequests:createConversationRequestSequence(),conversationRequestScope:()=>({workspace:'ws-a',employee:'employee-a',generation:1}),prependConversationHistory,api:{conversation:(...args)=>{calls.push(args);return gate.promise;}}};
  const methods=Function(...Object.keys(bindings),`let conversationHistoryGeneration=0;${source('loadEarlierConversationMessages')}return {load:loadEarlierConversationMessages,advance:()=>conversationHistoryGeneration++};`)(...Object.values(bindings));
  return{...state,...methods,gate,calls};
}

test('actual API requests ten messages and uses an encoded same-conversation before cursor',async()=>{
  const code=await readFile(new URL('./api.js',import.meta.url),'utf8');
  const start=code.indexOf('  conversation: (id, options = {}) => '),end=code.indexOf('\n  forwardConversation:',start);
  const expression=code.slice(start,end).trim().replace(/^conversation:\s*/,'').replace(/,$/,'');
  const calls=[],read=Function('boundedRequest',`return (${expression})`)((...args)=>{calls.push(args);});
  read('chat/a',{before:'m?old',timeoutMs:100});
  assert.equal(calls[0][0],'/api/conversations/chat%2Fa?view=thread&limit=10&before=m%3Fold');
  assert.deepEqual(calls[0][1],{timeoutMs:100});
});

test('a duplicate older-history click sends one read and preserves newer execution metadata',async()=>{
  const f=fixture(),first=f.load();await f.load();assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],['chat-a',{before:'m20'}]);
  f.selectedConversation.value={...f.selectedConversation.value,working_directory:'D:/new',execution:{id:'new-execution'}};
  f.gate.resolve({id:'chat-a',working_directory:'C:/stale',execution:{id:'old-execution'},messages:[{id:'m10'}],messagePage:{hasMore:true,beforeCursor:'m10',total:30}});
  await first;assert.equal(f.selectedConversation.value.execution.id,'new-execution');assert.equal(f.selectedConversation.value.working_directory,'D:/new');
  assert.deepEqual(f.selectedConversation.value.messages.map(m=>m.id),['m10','m20']);assert.equal(f.conversationHistoryLoading.value,false);
});

for(const change of ['conversation','account','generation'])test(`a delayed history read cannot cross a changed ${change}`,async()=>{
  const f=fixture(),pending=f.load();
  if(change==='conversation')f.selectedConversation.value={id:'chat-b',messages:[{id:'b'}]};
  if(change==='account')f.authState.value={user:{id:'other'}};
  if(change==='generation')f.advance();
  const current=f.selectedConversation.value;f.conversationHistoryLoading.value=false;
  f.gate.resolve({id:'chat-a',messages:[{id:'stale'}],messagePage:{hasMore:false,beforeCursor:'stale',total:30}});await pending;
  assert.equal(f.selectedConversation.value,current);assert.equal(f.conversationHistoryError.value,'');
});

test('a failed history read retains messages and cursor for explicit retry',async()=>{
  const f=fixture(),current=f.selectedConversation.value,pending=f.load();f.gate.reject(Error('Read interrupted'));await pending;
  assert.equal(f.selectedConversation.value,current);assert.equal(f.conversationHistoryLoading.value,false);assert.equal(f.conversationHistoryError.value,'Read interrupted');
});

test('a current-page refresh keeps loaded old pages without rolling terminal execution back',()=>{
  const previous={id:'chat-a',messages:[{id:'old'},{id:'current'}],messagePage:{hasMore:true,beforeCursor:'old',total:30},execution:{id:'action',status:'succeeded'}};
  const latest=mergeConversationDetail(previous,{id:'chat-a',messages:[{id:'current',content:'updated'},{id:'new'}],messagePage:{hasMore:true,beforeCursor:'current',total:31},execution:{id:'action',status:'succeeded'}});
  assert.deepEqual(latest.messages.map(m=>m.id),['old','current','new']);assert.equal(latest.messagePage.beforeCursor,'old');assert.equal(latest.messagePage.total,31);
  assert.equal(mergeConversationDetail(latest,{...latest,execution:{id:'action',status:'pending'}}).execution.status,'succeeded');
});

test('opening a focused chat loads its options and selected thread without workspace or conversation histories',async()=>{
  const calls=[],state={authState:ref({authenticated:true,user:{id:'owner'},memberships:[{slug:'ws',role:'owner'}]}),loading:ref(false),summary:ref({workspace:{slug:'ws'}}),focusedConversation:ref(true),conversationRouteId:ref('chat-a'),page:ref('inbox'),models:ref([]),skills:ref([]),devices:ref([]),settings:ref(null),loadedBotOptionsWorkspace:ref(''),workspaceName:ref(''),workspaceTimezone:ref(''),workspaceLanguage:ref(''),workspaceTheme:ref(''),selectedConversation:ref(null),employees:ref([])};
  const api=new Proxy({}, {get(_target,key){return async()=>{calls.push(key);assert(['summary','models','skills','devices','settings'].includes(key),`unexpected heavy request ${key}`);return key==='settings'?{workspace:{name:'WS',timezone:'Asia/Shanghai'}}:{[key]:[]};};}});
  const bindings={...state,api,loadBotPageOptions,workspaceSlug:()=> 'ws',loadNotifications:async()=>{},openRealtime:()=>{},openConversation:async id=>{calls.push('thread:'+id);state.selectedConversation.value={id,employee:{id:'employee-a'}};return true;},notify:message=>assert.fail(message)};
  const load=Function(...Object.keys(bindings),`let workspaceLoadGeneration=0;${source('load')}return load;`)(...Object.values(bindings));
  await load();assert.deepEqual(calls.sort(),['devices','models','settings','skills','summary','thread:chat-a']);assert.equal(state.employees.value[0].id,'employee-a');assert.equal(state.loading.value,false);
});
