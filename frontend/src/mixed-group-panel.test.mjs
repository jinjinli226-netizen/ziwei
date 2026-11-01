import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from './api.js';
import {mountPanel} from '../verification/vue-panel-harness.mjs';

const group=(id='mix_ops',extra={})=>({id,workspace:'team',title:id==='mix_ops'?'Averinyo · 全链路经营团队':'另一群',members:[{employeeId:'ceo',name:'经营负责人',runtime:'Hermes',profile:'ceo',deviceId:'pc',conversationId:'ceo-chat'},{employeeId:'writer',name:'内容负责人',runtime:'Codex',profile:'writer',deviceId:'pc',conversationId:'writer-chat'}],messages:[{id:'m1',role:'user',text:id==='mix_ops'?'请汇总经营进展':'另一群历史',status:'complete'}],runs:[],...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const fields=(panel,label)=>panel.find(node=>['input','textarea'].includes(node.type)&&node.props['aria-label']===label);
async function enter(panel,label,value){const field=fields(panel,label)[0];field.value=value;field.dispatch('input');field.props.onInput?.({target:field});await panel.settle();return field;}
async function mount(t,{props={},read,send,create,cancel,list,realtime=false}={}){
 const previousDocument=globalThis.document;globalThis.document??={hidden:false};t.after(()=>{globalThis.document=previousDocument;});
 const globals={window:globalThis.window,WebSocket:globalThis.WebSocket,EventSource:globalThis.EventSource},sockets=[];
 globalThis.WebSocket=realtime?class{constructor(url){this.url=url;this.closed=false;sockets.push(this);}close(){this.closed=true;}}:undefined;
 globalThis.EventSource=undefined;if(realtime)globalThis.window={};
 t.after(()=>Object.assign(globalThis,globals));
 const original=Object.fromEntries(['mixedGroups','mixedGroup','sendMixedGroupMessage','createMixedGroup','cancelMixedGroup'].map(key=>[key,api[key]])),calls=[],events=[];
 api.mixedGroups=async workspace=>{calls.push(['GET-list',workspace]);return list?list(workspace):{groups:[group(),group('mix_other')]};};
 api.mixedGroup=async(id,workspace)=>{calls.push(['GET',id,workspace]);return read?read(id,workspace):group(id);};
 api.sendMixedGroupMessage=async(id,body,workspace)=>{calls.push(['POST-send',id,body,workspace]);return send?send(id,body,workspace):group(id);};
 api.createMixedGroup=async(body,workspace)=>{calls.push(['POST-create',body,workspace]);return create?create(body,workspace):group('mix_created');};
 api.cancelMixedGroup=async(id,body,workspace)=>{calls.push(['POST-cancel',id,body,workspace]);return cancel?cancel(id,body,workspace):group(id);};
 const panel=await mountPanel('../src/components/MixedGroupPanel.vue',{workspace:'team',groupId:'mix_ops',embedded:true,...props},{onSelect:id=>events.push(['select',id]),onChanged:value=>events.push(['changed',value])});
 t.after(()=>{panel.dispose();Object.assign(api,original);});await panel.settle();return Object.assign(panel,{calls,events,sockets});
}

test('a workspace group opens without an employee and prioritizes its actual chat and bound results',async t=>{
 const panel=await mount(t,{read:id=>group(id,{runs:[{employeeId:'writer',runtime:'Codex',profile:'writer',conversationId:'writer-chat',actionId:'action-original',status:'succeeded',output:'已核对当日进展'}]})});
 assert.match(panel.text(),/Averinyo · 全链路经营团队/);assert.match(panel.text(),/经营负责人/);assert.match(panel.text(),/请汇总经营进展/);assert.match(panel.text(),/已完成/);assert.match(panel.text(),/已核对当日进展/);assert.match(panel.text(),/action-original/);assert.match(panel.text(),/writer-chat/);
 assert.deepEqual(panel.calls,[['GET','mix_ops','team']]);assert.equal(panel.find(node=>node.type==='aside').length,0);assert.equal(panel.find(node=>node.type==='form').length,0);assert.ok(panel.button('新建群聊'));
});

test('an empty selection never automatically opens the first unrelated group',async t=>{
 const panel=await mount(t,{props:{groupId:'',embedded:false}});
 assert.match(panel.text(),/选择.*群聊/);assert.deepEqual(panel.calls,[['GET-list','team']]);assert.equal(fields(panel,'群消息').length,0);
 const choose=panel.find(node=>node.type==='button'&&node.props['data-group-id']==='mix_other')[0];choose.props.onClick();await panel.settle();assert.deepEqual(panel.events,[['select','mix_other']]);assert.equal(fields(panel,'群消息').length,0);
 panel.props.groupId='mix_other';await panel.settle();assert.match(panel.text(),/另一群历史/);
});

test('changing group or workspace clears old history and drafts while late reads remain isolated',async t=>{
 const old=deferred();let wait=false;
 const panel=await mount(t,{read:(id,workspace)=>wait&&id==='mix_ops'&&workspace==='team'?old.promise:group(id,{workspace})});
 await enter(panel,'群消息','只属于旧群的草稿');wait=true;panel.button('刷新群聊').props.onClick();await panel.settle();
 panel.props.groupId='mix_other';await panel.settle();assert.equal(fields(panel,'群消息')[0].value,'');assert.doesNotMatch(panel.text(),/请汇总经营进展/);assert.match(panel.text(),/另一群历史/);
 old.resolve(group('mix_ops',{title:'迟到的旧群'}));await panel.settle();assert.doesNotMatch(panel.text(),/迟到的旧群/);
 await enter(panel,'群消息','另一个工作区不能看到');panel.props.workspace='other';await panel.settle();assert.equal(fields(panel,'群消息')[0].value,'');assert.deepEqual(panel.calls.at(-1),['GET','mix_other','other']);
});

test('a failed read has a GET-only retry that keeps the routed group instead of opening the first group',async t=>{
 let failing=true;const panel=await mount(t,{read:id=>{if(failing)throw Error('当前群暂时不可读取');return group(id);}});
 assert.match(panel.text(),/当前群暂时不可读取/);assert.equal(fields(panel,'群消息').length,0);failing=false;panel.button('重新读取').props.onClick();await panel.settle();
 assert.match(panel.text(),/请汇总经营进展/);assert.deepEqual(panel.calls,[['GET','mix_ops','team'],['GET','mix_ops','team']]);
});

test('the actual composer uses the shared 500ms IME guard and never repeats a pending send',async t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const pending=deferred();const panel=await mount(t,{send:()=>pending.promise}),field=await enter(panel,'群消息','核对新的经营进展');
 const key=patch=>field.props.onKeydown({key:'Enter',preventDefault(){},...patch});field.props.onCompositionstart();key();field.props.onCompositionend();now=1499;key();now=1500;key({shiftKey:true});assert.equal(panel.calls.filter(call=>call[0]==='POST-send').length,0);
 key();key();await panel.settle();assert.equal(panel.calls.filter(call=>call[0]==='POST-send').length,1);
 const [method,id,body,workspace]=panel.calls.at(-1);assert.deepEqual([method,id,body.content,body.attachments,body.attachmentSourceConversationId,workspace],['POST-send','mix_ops','核对新的经营进展',[],'ceo-chat','team']);assert.match(body.messageId,/^mixed-message:/);
 pending.resolve(group());await panel.settle();assert.equal(field.value,'');assert.ok(panel.events.some(event=>event[0]==='changed'));
});

test('uncertain sends retain the draft and a retry only reads the existing group',async t=>{
 const panel=await mount(t,{send:()=>{throw Error('网络中断');}});await enter(panel,'群消息','必须保留的消息');await panel.button('发送到群').props.onClick();await panel.settle();
 assert.equal(fields(panel,'群消息')[0].value,'必须保留的消息');assert.match(panel.text(),/网络中断/);panel.button('重新读取').props.onClick();await panel.settle();assert.equal(panel.calls.filter(call=>call[0]==='POST-send').length,1);assert.equal(panel.calls.at(-1)[0],'GET');
});

test('active runs poll only by GET, skip hidden pages, and stop after a terminal receipt',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const previous=globalThis.document;globalThis.document={hidden:false};t.after(()=>{globalThis.document=previous;});
 let status='running';const panel=await mount(t,{read:id=>group(id,{runs:[{employeeId:'ceo',runtime:'Hermes',profile:'ceo',actionId:'bound-original',status}]})});
 globalThis.document.hidden=true;t.mock.timers.tick(4000);await panel.settle();assert.equal(panel.calls.length,1);
 globalThis.document.hidden=false;t.mock.timers.tick(4000);await panel.settle();assert.equal(panel.calls.length,2);status='succeeded';t.mock.timers.tick(4000);await panel.settle();assert.equal(panel.calls.length,3);assert.match(panel.text(),/已完成/);
 t.mock.timers.tick(16000);await panel.settle();assert.equal(panel.calls.length,3);assert.ok(panel.calls.every(call=>call[0]==='GET'));
});

test('slow polls do not overlap and unmount clears the next poll',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const pending=deferred();let reading=0;const running=group('mix_ops',{runs:[{employeeId:'ceo',profile:'ceo',runtime:'Hermes',actionId:'bound-original',status:'running'}]});
 const panel=await mount(t,{read:()=>++reading===1?running:pending.promise});t.mock.timers.tick(4000);await panel.settle();t.mock.timers.tick(12000);await panel.settle();assert.equal(reading,2);
 pending.resolve(running);await panel.settle();panel.dispose();t.mock.timers.tick(8000);await panel.settle();assert.equal(reading,2);
});

test('creating an optional group emits its ID without replacing a controlled selection',async t=>{
 const employees=group().members.map(member=>({id:member.employeeId,name:member.name,runtime:member.runtime,runtime_profile:member.profile,target_device_id:member.deviceId,main_conversation_id:member.conversationId}));
 const panel=await mount(t,{props:{employees}});panel.button('新建群聊').props.onClick();await panel.settle();await enter(panel,'新群聊名称','新经营协作');
 for(const employee of employees){const checkbox=fields(panel,'群成员：'+employee.name)[0];checkbox.checked=true;checkbox.dispatch('change');checkbox.props.onChange?.({target:checkbox});}await panel.settle();
 await panel.find(node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});await panel.settle();
 const created=panel.calls.find(call=>call[0]==='POST-create');assert.equal(created[1].title,'新经营协作');assert.equal(created[1].members.length,2);assert.deepEqual(panel.events.find(event=>event[0]==='select'),['select','mix_created']);assert.match(panel.text(),/请汇总经营进展/);assert.ok(panel.events.some(event=>event[0]==='changed'));
});

test('late send completion cannot clear another group draft or switch its visible history',async t=>{
 const pending=deferred(),panel=await mount(t,{send:()=>pending.promise});await enter(panel,'群消息','原群消息');panel.button('发送到群').props.onClick();await panel.settle();
 panel.props.groupId='mix_other';await panel.settle();await enter(panel,'群消息','新群草稿');pending.resolve(group());await panel.settle();
 assert.equal(fields(panel,'群消息')[0].value,'新群草稿');assert.match(panel.text(),/另一群历史/);assert.doesNotMatch(panel.text(),/请汇总经营进展/);assert.equal(panel.events.filter(event=>event[0]==='changed').length,0);
});

test('cancellation keeps original member receipts and does not claim stopped before terminal evidence',async t=>{
 const panel=await mount(t,{read:id=>group(id,{runs:[{employeeId:'ceo',runtime:'Hermes',profile:'ceo',conversationId:'ceo-chat',actionId:'original-run',status:'running'}]})});
 await panel.button('请求取消当前回合').props.onClick();await panel.settle();assert.deepEqual(panel.calls.find(call=>call[0]==='POST-cancel'),['POST-cancel','mix_ops',{},'team']);
 assert.match(panel.text(),/取消请求已提交，成员是否停止以回执为准/);assert.match(panel.text(),/original-run/);assert.match(panel.text(),/执行中/);assert.doesNotMatch(panel.text(),/已取消/);assert.ok(panel.events.some(event=>event[0]==='changed'));
});

test('local missing member bindings are explained before any create request is made',async t=>{
 const employees=[{id:'ceo',name:'负责人',runtime:'Hermes'},{id:'writer',name:'写作者',runtime:'Codex'}],panel=await mount(t,{props:{employees}});panel.button('新建群聊').props.onClick();await panel.settle();
 for(const employee of employees){const checkbox=fields(panel,'群成员：'+employee.name)[0];checkbox.checked=true;checkbox.dispatch('change');checkbox.props.onChange?.({target:checkbox});}await panel.settle();await panel.find(node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});await panel.settle();
 assert.match(panel.text(),/缺少 Profile、设备或专属会话绑定/);assert.doesNotMatch(panel.text(),/请求结果未确认/);assert.equal(panel.calls.some(call=>call[0]==='POST-create'),false);
});

test('the actual group message viewport follows within 40px and offers a jump only beyond 120px',async t=>{
 const panel=await mount(t),timeline=panel.find(node=>node.props['aria-label']==='群聊消息')[0];let top=700;
 Object.assign(timeline,{scrollHeight:1000,clientHeight:300});Object.defineProperty(timeline,'scrollTop',{get:()=>top,set:value=>{top=Math.max(0,Math.min(value,timeline.scrollHeight-timeline.clientHeight));}});
 const scrolled=()=>timeline.props.onScroll({currentTarget:timeline});
 timeline.props.onWheelPassive({deltaY:1});top=660;scrolled();timeline.scrollHeight=1100;await panel.button('刷新群聊').props.onClick();await panel.settle();assert.equal(top,800);
 timeline.props.onWheelPassive({deltaY:-1});top=759;scrolled();timeline.scrollHeight=1200;await panel.button('刷新群聊').props.onClick();await panel.settle();assert.equal(top,759);assert.ok(panel.button('跳至最新'));
 timeline.props.onWheelPassive({deltaY:1});top=780;scrolled();await panel.settle();assert.equal(panel.button('跳至最新'),undefined);top=779;scrolled();await panel.settle();assert.ok(panel.button('跳至最新'));
 panel.button('跳至最新').props.onClick();await panel.settle();assert.equal(top,900);assert.equal(panel.button('跳至最新'),undefined);
 timeline.scrollHeight=1300;await panel.button('刷新群聊').props.onClick();await panel.settle();assert.equal(top,1000);
});

test('group snapshots grow member bodies in the history and terminal replies replace previews',async t=>{
 let current=group('mix_ops',{runs:[{employeeId:'writer',actionId:'stream-action',runtime:'Codex',status:'running',stream:{channel:'assistant',messageId:'stream:writer',sequence:1,text:'正在核对数据'}}]});
 const panel=await mount(t,{read:()=>current}),preview=()=>panel.find(node=>node.type==='article'&&node.props['data-streaming']==='true');
 assert.equal(preview().length,1);assert.match(panel.text(),/正在核对数据/);const first=preview()[0];
 current={...current,runs:current.runs.map(run=>({...run,stream:{...run.stream,sequence:2,text:'已核对全部数据'}}))};
 await panel.button('刷新群聊').props.onClick();await panel.settle();assert.equal(preview()[0],first);assert.match(panel.text(),/已核对全部数据/);
 current={...current,messages:[...current.messages,{id:'final-writer',role:'assistant',employeeId:'writer',actionId:'stream-action',text:'正式核对结果',status:'succeeded'}],runs:current.runs.map(run=>({...run,status:'succeeded',output:'正式核对结果'}))};
 await panel.button('刷新群聊').props.onClick();await panel.settle();assert.equal(preview().length,0);assert.doesNotMatch(panel.text(),/已核对全部数据/);
 assert.equal(panel.text().split('正式核对结果').length-1,1,'the same final body is not repeated in the receipt card');
});

test('group realtime compensates by scoped GET, coalesces bursts and closes on workspace changes',async t=>{
 const pending=deferred();let reads=0;
 const running=group('mix_ops',{runs:[{employeeId:'writer',actionId:'stream-action',runtime:'Codex',status:'running'}]});
 const panel=await mount(t,{realtime:true,read:(_id,workspace)=>++reads===2?pending.promise:{...running,workspace}});
 assert.equal(panel.sockets.length,1);let socket=panel.sockets[0];assert.match(socket.url,/workspaces\/team\/notifications\/ws$/);
 socket.onopen();const emit=actionId=>socket.onmessage({data:JSON.stringify({type:'notification',event:{action:'a2a.action.event',data:{actionId}}})});
 emit('unrelated-action');await panel.settle();assert.equal(reads,1);
 for(let index=0;index<20;index++)emit('stream-action');await panel.settle();assert.equal(reads,2);
 pending.resolve(running);await panel.settle();assert.equal(reads,3);
 panel.props.workspace='other';await panel.settle();assert.equal(socket.closed,true);assert.match(panel.sockets.at(-1).url,/workspaces\/other\/notifications\/ws$/);
 socket=panel.sockets.at(-1);panel.dispose();assert.equal(socket.closed,true);
});
