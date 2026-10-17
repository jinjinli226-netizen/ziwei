import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../web/controller.js';
import {initialState} from '../web/model.js';

function memoryStorage() {
  const values = new Map();
  return {values, get length(){return values.size;}, key:index=>[...values.keys()][index] || null, getItem:key=>values.get(key) || null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)};
}
function fixture(overrides = {}, apiOverrides = {}, storage = memoryStorage(), render = () => {}) {
  const employee = {id:'one', name:'员工甲', runtime:'Other'};
  const state = {...initialState(), phase:'ready', user:{user_id:'user-one'}, workspace:{slug:'workspace-one',role:'owner'}, workspaces:[{slug:'workspace-one',role:'owner'},{slug:'workspace-two',role:'member'}], employees:[employee], ...overrides};
  const api = {
    employees:async()=>({employees:[employee]}), bots:async()=>({bots:[]}), tasks:async()=>({tasks:[]}), devices:async()=>({devices:[]}),
    getEmployeeConversation:async(_workspace,value)=>({id:`conversation-${value.id}`, employee_id:value.id, messages:[]}),
    conversation:async conversationId=>({id:conversationId,employee_id:conversationId.replace('conversation-',''),messages:[]}),
    bot:async()=>{throw new Error('普通员工不应读取 Bot');}, logout:async()=>({ok:true}),
    ...apiOverrides,
  };
  const controller = createController({state,api,storage,render});
  return {state,api,storage,controller};
}
const form = values => {const data = new FormData();for(const [key,value] of Object.entries(values))data.set(key,value);return data;};
const deferred = () => {let resolve;const promise = new Promise(done=>resolve=done);return {promise,resolve};};
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function promptly(promise) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('unrelated read blocked chat')),500);})]); }
  finally { clearTimeout(timer); }
}
function initializedFixture(apiOverrides = {}, render = () => {}) {
  const employee = {id:'one',name:'员工甲',runtime:'Hermes'};
  const bot = {id:'one',employee_id:'one',employee,configuration_state:'initialized',main_conversation_id:'original-main',revision:3,control_epoch:2};
  const f = fixture({employees:[{...employee,bot}],bots:[bot]}, {
    employees:async()=>({employees:[employee]}),bots:async()=>({bots:[bot]}),bot:async()=>bot,botRuns:async()=>({runs:[]}),botRoutines:async()=>({routines:[]}),
    conversation:async conversationId=>({id:conversationId,employee_id:employee.id,messages:[{id:'history',role:'assistant',content:'原主聊天历史'}]}),
    getEmployeeConversation:async()=>{throw new Error('已有 main ID 不应再次解析或创建会话');},
    ...apiOverrides,
  }, memoryStorage(), render);
  return {...f,bot};
}

test('ordinary employee chat uses its existing identity and an employee switch ignores the old response', async t => {
  const old = deferred();
  const f = fixture({employees:[{id:'one',runtime:'Other'},{id:'two',runtime:'Other'}]}, {getEmployeeConversation:async(_ws,employee)=>employee.id==='one'?old.promise:{id:'conversation-two',employee_id:'two',messages:[]}});
  t.after(()=>f.controller.dispose());
  const pending = f.controller.actions.chat({id:'one'});
  await f.controller.actions.chat({id:'two'});
  old.resolve({id:'conversation-one',employee_id:'one',messages:[]});await pending;
  assert.equal(f.state.selectedEmployee.id,'two');assert.equal(f.state.conversation.id,'conversation-two');assert.equal(f.state.busy,false);
});

test('late workspace reads cannot populate another workspace', async t => {
  const old = deferred();
  const f = fixture({}, {employees:async workspace=>workspace==='workspace-one'?old.promise:{employees:[{id:'new-employee',runtime:'Other'}]}});
  t.after(()=>f.controller.dispose());
  const pending = f.controller.refresh();
  await f.controller.actions['select-workspace']({id:'workspace-two'});
  old.resolve({employees:[{id:'old-employee'}]});await pending;
  assert.equal(f.state.workspace.slug,'workspace-two');assert.equal(f.state.employees[0].id,'new-employee');
});

test('lost message response preserves the request ID across an app restart without storing message bytes', async t => {
  const storage = memoryStorage(), sent = [];
  const a = fixture({}, {sendMessage:async(_id,body)=>{sent.push(body);throw new TypeError('response lost');}}, storage);
  await a.controller.actions.chat({id:'one'});
  await a.controller.submit('chat',form({draft:'测试内容，只能保留摘要哈希'}));
  assert.equal(sent.length,1);assert.equal(a.state.draft,'测试内容，只能保留摘要哈希');
  const persisted = [...storage.values.values()].find(value=>value.includes('fingerprintHash'));
  assert(persisted);assert(!persisted.includes('测试内容'));assert.match(JSON.parse(persisted).fingerprintHash,/^[a-f0-9]{64}$/);
  a.controller.dispose();
  const b = fixture({}, {sendMessage:async(_id,body)=>{sent.push(body);return {id:'saved-message'};}}, storage);
  t.after(()=>b.controller.dispose());
  await b.controller.actions.chat({id:'one'});await b.controller.submit('chat',form({draft:'测试内容，只能保留摘要哈希'}));
  assert.equal(sent[0].clientMessageId,sent[1].clientMessageId);assert.equal(b.state.draft,'');
  assert(![...storage.values.values()].some(value=>value.includes('fingerprintHash')));
});

test('new message content gets a new ID, while unavailable storage prevents dispatch', async t => {
  const sent=[];
  const f=fixture({}, {sendMessage:async(_id,body)=>{sent.push(body);throw new TypeError('response lost');}});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await f.controller.submit('chat',form({draft:'first'}));await f.controller.submit('chat',form({draft:'edited'}));
  assert.notEqual(sent[0].clientMessageId,sent[1].clientMessageId);
  const blocked=fixture({}, {sendMessage:async()=>{throw new Error('must not dispatch');}}, {getItem:()=>null,setItem:()=>{throw new Error('quota');}});t.after(()=>blocked.controller.dispose());
  await blocked.controller.actions.chat({id:'one'});await blocked.controller.submit('chat',form({draft:'keep this'}));
  assert.match(blocked.state.error,/无法保存发送标识/);assert.equal(blocked.state.draft,'keep this');
});

test('401 clears account-specific UI and member permissions cannot invoke phone commands', async t => {
  const f=fixture({}, {employees:async()=>{throw Object.assign(new Error('expired'),{status:401});}});t.after(()=>f.controller.dispose());
  await f.controller.refresh();assert.equal(f.state.phase,'login');assert.equal(f.state.user,null);assert.deepEqual(f.state.employees,[]);assert.deepEqual(f.state.messages,[]);
  let commands=0;const member=fixture({workspace:{slug:'workspace-one',role:'member'}}, {phoneCommand:async()=>{commands++;}});t.after(()=>member.controller.dispose());
  await member.controller.actions['phone-refresh']({id:'phone-one'});assert.equal(commands,0);assert.match(member.state.error,/管理员权限/);
});

test('image byte verification rejects spoofed files and limits the total attachment count', async t => {
  const f=fixture();t.after(()=>f.controller.dispose());await f.controller.actions.chat({id:'one'});
  await f.controller.change({name:'images',files:[{name:'fake.png',size:2,arrayBuffer:async()=>new Uint8Array([1,2]).buffer}],value:''});
  assert.match(f.state.error,/请选择 PNG/);assert.deepEqual(f.state.attachments,[]);
  f.state.attachments=Array.from({length:20},()=>({size:1}));
  await f.controller.change({name:'images',files:[{name:'new.png',size:1}],value:''});assert.match(f.state.error,/最多附加 20/);
});

test('existing report resumes with reads and explicit new report resets selection', async t => {
  let reads=0, selects=0;
  const f=fixture({report:{status:'active',queue:[{employeeId:'one'}],index:0}});
  const report=f.state.report;f.controller.dispose();
  const controller=createController({state:f.state,api:f.api,storage:f.storage,reporting:{refresh:async()=>{reads++;},select:(state,ids)=>{selects++;state.report={status:'selecting',queue:ids.map(employeeId=>({employeeId}))};}}});t.after(()=>controller.dispose());
  await controller.actions['report-setup']();assert.equal(f.state.report,report);assert.equal(f.state.page,'report');assert.equal(reads,1);assert.equal(selects,0);
  await controller.actions['report-new']();assert.equal(f.state.page,'report-setup');assert.equal(selects,1);
});

test('stop uses fresh revision and epoch, then refreshes only; routine retries keep an idempotency key', async t => {
  const bot={id:'one',employee_id:'one',configuration_state:'initialized',revision:9,control_epoch:4,employee:{id:'one',runtime:'Hermes'}}, controls=[], keys=[];
  let attempts=0;
  const f=fixture({employees:[{id:'one',runtime:'Hermes',bot}],selectedEmployee:{id:'one',runtime:'Hermes',bot},bot,routines:[{id:'r-one',status:'active'}],page:'detail'}, {
    bot:async()=>bot,bots:async()=>({bots:[bot]}),botRuns:async()=>({runs:[]}),botRoutines:async()=>({routines:[{id:'r-one',status:'active'}]}),
    controlBot:async(_ws,_id,body)=>{controls.push(body);return bot;},runRoutine:async(_ws,_id,_routine,body)=>{keys.push(body.idempotencyKey);if(!attempts++)throw new TypeError('lost');return {id:'run-one'};},
  });t.after(()=>f.controller.dispose());
  await f.controller.actions['stop-run']({id:'one'});assert.deepEqual(controls,[{operation:'stop',expectedRevision:9,expectedControlEpoch:4}]);
  await f.controller.actions['routine-run']({id:'r-one'});await f.controller.actions['routine-run']({id:'r-one'});assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});

test('refresh reads an existing screenshot command without sending the command again', async t => {
  let writes=0;const phone={id:'phone-one',commands:[{id:'command-one',status:'queued'}],nodes:[]};
  const f=fixture({tab:'devices',page:'phone',phone,phoneCommand:{id:'command-one',status:'queued'}}, {phones:async()=>({devices:[phone]}),phone:async()=>({device:phone}),phoneSnapshot:async()=>({snapshot:null}),phoneCommand:async()=>{writes++;return {command:{id:'unexpected'}};}});t.after(()=>f.controller.dispose());
  await f.controller.actions['phone-refresh']({id:phone.id});await f.controller.refresh();assert.equal(writes,0);
});

for (const resource of ['bot','botRuns','botRoutines']) test(`cached main history renders and input unlocks while ${resource} remains pending`, async t => {
  const slow=deferred(),drawn=[],calls=[];
  const f=initializedFixture({[resource]:()=>slow.promise,conversation:async conversationId=>{calls.push(conversationId);return {id:conversationId,employee_id:'one',messages:[{id:'history',role:'assistant',content:'原聊天内容'}]};}},state=>drawn.push({messages:[...state.messages],busy:state.busy,chatLoading:state.chatLoading}));
  t.after(()=>{slow.resolve(resource==='bot'?f.bot:resource==='botRuns'?{runs:[]}:{routines:[]});f.controller.dispose();});
  await promptly(f.controller.actions.chat({id:'one'}));
  assert.deepEqual(calls,['original-main'],'first screen must not issue a second conversation GET');
  assert.equal(f.state.conversation.id,'original-main');assert.equal(f.state.busy,false);assert.equal(f.state.chatLoading,false);
  assert(drawn.some(frame=>frame.messages.some(message=>message.id==='history')&&!frame.busy&&!frame.chatLoading),'visible history must not wait for auxiliary status');
  await f.controller.change({name:'draft',value:'仍然可以输入'});assert.equal(f.state.draft,'仍然可以输入');
});

test('history refresh draws independently of workspace lists, Bot state, runs and routines', async t => {
  const slow=deferred(),drawn=[];let calls=0,hold=false;
  const f=initializedFixture({
    employees:async()=>hold?slow.promise:{employees:[{id:'one',runtime:'Hermes'}]},
    bot:async()=>hold?slow.promise:f.bot,botRuns:async()=>hold?slow.promise:{runs:[]},botRoutines:async()=>hold?slow.promise:{routines:[]},
    conversation:async conversationId=>({id:conversationId,employee_id:'one',messages:[{id:`history-${++calls}`,role:'assistant',content:`历史第${calls}次读取`}]}),
  },state=>drawn.push(state.messages.map(message=>message.id)));
  t.after(()=>{f.controller.dispose();slow.resolve({});});
  await f.controller.actions.chat({id:'one'});await tick();hold=true;
  const pending=f.controller.refresh();await tick();
  assert.equal(f.state.messages[0].id,'history-2');assert(drawn.some(ids=>ids.includes('history-2')));
  assert.equal(f.state.busy,false);assert.equal(f.state.chatLoading,false);
  await f.controller.actions.back();slow.resolve({});await pending;
});

test('failed initial main read clears loading and refresh retries that original main without creating a replacement', async t => {
  let attempts=0;
  const f=initializedFixture({conversation:async conversationId=>{assert.equal(conversationId,'original-main');if(!attempts++)throw new Error('聊天读取暂时失败');return {id:conversationId,employee_id:'one',messages:[{id:'recovered',role:'assistant',content:'历史已恢复'}]};}});
  t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});assert.equal(f.state.conversation,null);assert.equal(f.state.chatLoading,false);assert.equal(f.state.busy,false);assert.match(f.state.error,/读取暂时失败/);
  await f.controller.refresh();assert.equal(attempts,2);assert.equal(f.state.conversation.id,'original-main');assert.equal(f.state.messages[0].id,'recovered');assert.equal(f.state.error,'');
});

test('pending primary and auxiliary results cannot write after leaving the employee chat', async t => {
  const primary=deferred(),aux=deferred();
  const f=initializedFixture({conversation:()=>primary.promise,bot:()=>aux.promise,botRuns:()=>aux.promise,botRoutines:()=>aux.promise});t.after(()=>f.controller.dispose());
  const opening=f.controller.actions.chat({id:'one'});assert.equal(f.state.chatLoading,true);
  await f.controller.actions.back();
  primary.resolve({id:'original-main',employee_id:'one',messages:[{id:'too-late'}]});aux.resolve({...f.bot,runs:[{id:'late-run'}],routines:[{id:'late-routine'}]});
  await opening;await tick();
  assert.equal(f.state.page,'home');assert.equal(f.state.selectedEmployee,null);assert.equal(f.state.bot,null);assert.equal(f.state.conversation,null);assert.deepEqual(f.state.messages,[]);assert.deepEqual(f.state.runs,[]);assert.deepEqual(f.state.routines,[]);assert.equal(f.state.chatLoading,false);
});

test('late history refresh and status errors cannot replace a newly selected employee', async t => {
  const old=deferred(),oldRuns=deferred();let readingOld=false;
  const f=initializedFixture({conversation:async conversationId=>readingOld&&conversationId==='original-main'?old.promise:{id:conversationId,employee_id:conversationId==='original-main'?'one':'two',messages:[{id:conversationId}]},botRuns:async()=>readingOld?oldRuns.promise:{runs:[]},getEmployeeConversation:async(_workspace,employee)=>({id:'second-chat',employee_id:employee.id,messages:[{id:'second-history'}]})});
  f.state.employees.push({id:'two',runtime:'Other'});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await tick();readingOld=true;
  const pending=f.controller.refresh();await tick();
  // The workspace list was refreshed while the old read is in flight.
  f.state.employees.push({id:'two',runtime:'Other'});await f.controller.actions.chat({id:'two'});
  old.resolve({id:'original-main',employee_id:'one',messages:[{id:'late-old-history'}]});oldRuns.resolve({runs:[{id:'late-old-run'}]});await pending;
  assert.equal(f.state.selectedEmployee.id,'two');assert.equal(f.state.conversation.id,'second-chat');assert.equal(f.state.messages[0].id,'second-history');assert.deepEqual(f.state.runs,[]);
});

test('auxiliary failures remain visible and an auxiliary 401 still clears the loaded chat', async t => {
  const failure=deferred();
  const f=initializedFixture({botRuns:()=>failure.promise});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});failure.resolve(Promise.reject(new Error('真实运行记录读取失败')));await tick();
  assert.equal(f.state.messages[0].id,'history');assert.match(f.state.error,/运行记录读取失败/);assert.equal(f.state.busy,false);
  const expired=initializedFixture({botRoutines:async()=>{throw Object.assign(new Error('expired'),{status:401});}});t.after(()=>expired.controller.dispose());
  await expired.controller.actions.chat({id:'one'});await tick();assert.equal(expired.state.phase,'login');assert.equal(expired.state.user,null);assert.deepEqual(expired.state.messages,[]);assert.equal(expired.state.chatLoading,false);
});

for (const lateFailure of [false,true]) test(`a pre-send history ${lateFailure?'error':'snapshot'} cannot replace the accepted message or its running execution`, async t => {
  const old=deferred();let reads=0;
  const before={id:'original-main',employee_id:'one',messages:[{id:'before',role:'assistant',content:'原消息'}]};
  const after={...before,messages:[...before.messages,{id:'sent',role:'user',content:'新消息'}],execution:{id:'new-execution',status:'acked'}};
  const drawn=[];
  const f=initializedFixture({conversation:async()=>++reads===1?structuredClone(before):reads===2?old.promise:structuredClone(after),sendMessage:async()=>({id:'sent',execution:after.execution})},state=>drawn.push({ids:state.messages.map(message=>message.id),execution:state.conversation?.execution?.id}));
  t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await tick();
  const pending=f.controller.refresh();await tick();assert.equal(reads,2);
  await f.controller.submit('chat',form({draft:'新消息'}));
  assert.deepEqual(f.state.messages.map(message=>message.id),['before','sent']);assert.equal(f.state.conversation.execution.id,'new-execution');assert.equal(f.state.conversation.execution.status,'acked');
  const acceptedDraws=drawn.length;
  old.resolve(lateFailure?Promise.reject(new Error('旧请求超时')):structuredClone(before));await pending;
  assert.deepEqual(f.state.messages.map(message=>message.id),['before','sent']);assert.equal(f.state.conversation.execution.id,'new-execution');assert.equal(f.state.error,'');
  assert(drawn.slice(acceptedDraws).every(frame=>frame.ids.includes('sent')&&frame.execution==='new-execution'));
});

test('polling skips conversation reads during a pending send and resumes after a failed send', async t => {
  const post=deferred(),posted=deferred();let reads=0;
  const f=initializedFixture({conversation:async()=>({id:'original-main',employee_id:'one',messages:[{id:`history-${++reads}`,role:'assistant',content:'已有历史'}]}),sendMessage:()=>{posted.resolve();return post.promise;}});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await tick();
  const sending=f.controller.submit('chat',form({draft:'保留待发送消息'}));assert.equal(f.state.sending,true);await posted.promise;
  await f.controller.refresh();assert.equal(reads,1,'a polling GET during send must not capture a pre-send snapshot');
  post.resolve(Promise.reject(new Error('发送未获得确认')));await sending;
  assert.equal(f.state.sending,false);assert.equal(f.state.messages[0].id,'history-1');assert.equal(f.state.draft,'保留待发送消息');assert.match(f.state.error,/发送未获得确认/);
  await f.controller.refresh();assert.equal(reads,2);assert.equal(f.state.messages[0].id,'history-2');
});
