import test from 'node:test';
import assert from 'node:assert/strict';
import * as vue from 'vue';
import {mountPanel} from '../verification/vue-panel-harness.mjs';
import {dshGroupRoster,dshGroupItems,dshGroupEditInput,dshGroupSendInput,dshGroupExecution} from './dsh-groups.js';
import {createDshNative} from './dsh-native.js';
import {DSH_NATIVE_OPERATIONS} from '../../src/dsh-native-contract.mjs';

const subject={workspace:'team',employeeId:'anchor',runtime:'DSH',deviceId:'pc',profile:'alpha'};
const employees=()=>[{id:'anchor',name:'研究员',runtime:'DSH',target_device_id:'pc',runtime_profile:'alpha'},{id:'writer',name:'写作者',runtime:'DSH',target_device_id:'pc',runtime_profile:'beta'},{id:'other-device',runtime:'DSH',target_device_id:'other',runtime_profile:'remote'},{id:'hermes',runtime:'Hermes',target_device_id:'pc',runtime_profile:'native-hermes'}];
const group=()=>({id:'native-group',title:'原生协作群',members:['alpha','beta'],sessions:{alpha:'group-alpha',beta:'group-beta'},messages:[{id:'old-message',role:'assistant',botName:'beta',text:'群独立历史',status:'complete'}]});
const action=(operation,{id='parent-action',status='succeeded',application='unknown',data={},groupId='native-group',actorSubject=subject}={})=>{const scope=['create','list'].includes(operation)?{kind:'bot'}:{kind:'group',groupId};return{id,status,acked_at:'2026-10-31T00:00:00Z',type:'employee.dsh.operation',payload:{dshOperation:{subject:actorSubject,scope,resource:'groups',operation}},result:{dshNative:{schemaVersion:1,source:'dsh-native',subject:actorSubject,scope,resource:'groups',operation,status:application,data}}};};

test('group forms map exact native profiles to visible employees and enforce 2–6 distinct Bots including the anchor',()=>{
 assert.deepEqual(dshGroupRoster(employees(),null),[]);
 const roster=dshGroupRoster(employees(),subject);assert.deepEqual(roster.map(row=>row.employeeId),['anchor','writer']);
 assert.deepEqual(dshGroupEditInput({title:'  协作  ',memberEmployeeIds:['anchor','writer']},{subject,roster}),{title:'协作',memberEmployeeIds:['anchor','writer']});
 assert.throws(()=>dshGroupEditInput({title:'群',memberEmployeeIds:['writer']},{subject,roster}),/2.*6/);
 assert.throws(()=>dshGroupEditInput({title:'群',memberEmployeeIds:['writer','other']},{subject,roster}),/当前员工/);
 const aliases=dshGroupRoster([...employees(),{id:'alias',name:'同 Bot',runtime:'DSH',target_device_id:'pc',runtime_profile:'beta'}],subject);assert.equal(aliases.find(row=>row.employeeId==='writer').ambiguous,true);
 assert.throws(()=>dshGroupEditInput({title:'群',memberEmployeeIds:['anchor','writer']},{subject,roster:aliases}),/不唯一/);
});

test('group snapshots preserve native rows across item reads and deletion without mixing membership sources',()=>{
 const one=group(),two={...group(),id:'second',title:'另一个群'};let rows=dshGroupItems({items:[one,two]},[]);rows=dshGroupItems({item:{...one,title:'已改名'}},rows);assert.equal(rows.length,2);assert.equal(rows[0].title,'已改名');
 rows=dshGroupItems({deletedId:'native-group'},rows);assert.deepEqual(rows.map(row=>row.id),['second']);
});

test('send leaves native @ resolution to the backend and explicit targeting uses employee IDs',()=>{
 const roster=dshGroupRoster(employees(),subject),content='  @beta 请检查\n代码  ';assert.deepEqual(dshGroupSendInput(group(),content,null,roster),{groupId:'native-group',content});
 assert.deepEqual(dshGroupSendInput(group(),'检查',['writer'],roster),{groupId:'native-group',content:'检查',targetEmployeeIds:['writer']});
 assert.throws(()=>dshGroupSendInput(group(),'检查',[],roster),/选择/);assert.throws(()=>dshGroupSendInput(group(),'检查',['other-device'],roster),/当前群/);
});

test('group execution keeps outer success separate from native unknown and never promotes cancel to completion',()=>{
 const original=action('send',{data:{groupId:'native-group',sourceActionId:'parent-action',historyPersisted:false,members:[{employeeId:'writer',profile:'beta',conversationId:'group-thread',actionId:'member-original',status:'unknown'}]}}),evidence=dshGroupExecution(original,subject);
 assert.equal(evidence.status,'unknown');assert.equal(evidence.members[0].actionId,'member-original');assert.equal(evidence.historyPersisted,false);assert.equal(dshGroupExecution(action('cancel',{application:'observed',data:{sourceActionId:'parent-action',stopConfirmed:false}}),subject).operation,'cancel');assert.equal(dshGroupExecution(action('send',{actorSubject:{...subject,employeeId:'other'}}),subject),null);const unproven=action('send',{status:'failed'});unproven.result=null;assert.equal(dshGroupExecution(unproven,subject).status,'unknown');
});

function fixture(){
 const calls=[],state=vue.reactive({subject:{actorId:'owner',workspace:'team',employeeId:'anchor'},value:{subject:{...subject},subjectHash:'hash-one',scope:{kind:'bot'},pending:[],resources:{groups:{status:'observed',stale:false,data:{items:[group()],sourceOperation:'list'}}}},action:null,request:null,loading:false,submitting:false,unknown:false,error:'',notice:''});
 const controller={state,calls,resource:name=>state.value.resources[name],supported:()=>true,editable:name=>!state.request&&!state.loading&&!state.submitting&&state.value.resources[name]?.status==='observed',submit:async(...args)=>{calls.push(args);return null;},control:async(...args)=>{calls.push(['control',...args]);return null;},readAction:async()=>calls.push(['GET-original']),load:async()=>calls.push(['GET-state'])};
 return{controller,state,calls};
}
const mount=async(t,fixture,extra={})=>{const panel=await mountPanel('../src/components/DshGroupsPanel.vue',{controller:fixture.controller,employees:employees(),...extra});t.after(()=>panel.dispose());await panel.settle();return panel;};
const input=(panel,label)=>panel.find(node=>['input','textarea','select'].includes(node.type)&&node.props['aria-label']===label)[0];
async function enter(panel,label,value){const node=input(panel,label);node.value=value;node.dispatch('input');node.props.onInput?.({target:node});await panel.settle();}
async function check(panel,label,value){const node=input(panel,label);node.checked=value;node.dispatch('change');node.props.onChange?.({target:node});await panel.settle();}

test('the actual group form creates exact employee membership and includes its fixed anchor',async t=>{
 const f=fixture(),panel=await mount(t,f);panel.button('新建群').props.onClick();await panel.settle();await enter(panel,'群名称','新的原生群');assert.equal(input(panel,'群成员：研究员').props.disabled,true);await check(panel,'群成员：写作者',true);
 await panel.find(node=>node.type==='form'&&node.props['aria-label']==='编辑原生群')[0].props.onSubmit({preventDefault(){}});assert.deepEqual(f.calls.at(-1),['groups','create',{title:'新的原生群',memberEmployeeIds:['anchor','writer']}]);
});

test('the actual group composer sends native mentions or explicitly selected members without inventing sessions',async t=>{
 const f=fixture(),panel=await mount(t,f);await enter(panel,'群消息','@beta 请分析');panel.button('发送到群').props.onClick();await panel.settle();assert.deepEqual(f.calls.at(-1),['groups','send',{groupId:'native-group',content:'@beta 请分析'}]);
 const select=input(panel,'群发送范围');select.value='selected';select.dispatch('change');select.props.onChange?.({target:select});await panel.settle();await check(panel,'仅发送给：写作者',true);panel.button('发送到群').props.onClick();await panel.settle();assert.deepEqual(f.calls.at(-1),['groups','send',{groupId:'native-group',content:'@beta 请分析',targetEmployeeIds:['writer']}]);assert.match(panel.text(),/group-beta/);
});

test('unknown parent keeps its draft, original member evidence and independently addressed cancellation',async t=>{
 const f=fixture(),original=action('send',{data:{sourceActionId:'parent-action',groupId:'native-group',historyPersisted:false,members:[{employeeId:'writer',profile:'beta',conversationId:'dedicated-group-thread',actionId:'member-original',status:'unknown',error:'DSH_NATIVE_GROUP_MEMBER_OUTCOME_UNKNOWN'}]}}),panel=await mount(t,f,{sourceAction:original});await enter(panel,'群消息','原草稿');
 f.state.request={resource:'groups',operation:'send',actionId:'parent-action',body:{input:{groupId:'native-group',content:'原草稿'},idempotencyKey:'same-original-key'}};f.state.unknown=true;await panel.settle();assert.equal(panel.button('发送到群').props.disabled,true);assert.match(panel.text(),/member-original/);assert.match(panel.text(),/dedicated-group-thread/);assert.match(panel.text(),/未确认/);
 await panel.button('请求停止本次群执行').props.onClick();assert.deepEqual(f.calls.at(-1),['control','cancelGroup',{sourceActionId:'parent-action'}]);assert.equal(f.state.request.body.idempotencyKey,'same-original-key');
 f.state.action=action('cancel',{id:'cancel-action',application:'observed',data:{sourceActionId:'parent-action',groupId:'native-group',cancelRequested:true,stopConfirmed:false,members:[{actionId:'member-original',cancelActionId:'cancel-member'}]}});await panel.settle();assert.match(panel.text(),/取消请求已返回/);assert.doesNotMatch(panel.text(),/全群已停止/);assert.equal(input(panel,'群消息').props.value,'原草稿');
});

test('only the original successful current-scope create closes its form, and changed subjects clear old drafts',async t=>{
 const f=fixture(),panel=await mount(t,f);panel.button('新建群').props.onClick();await panel.settle();await enter(panel,'群名称','本地草稿');f.state.action=action('create',{application:'applied',data:{item:{...group(),id:'new-group'},sourceOperation:'create'}});await panel.settle();assert.equal(panel.find(node=>node.type==='form'&&node.props['aria-label']==='编辑原生群').length,1);
 f.state.subject={...f.state.subject,employeeId:'other'};f.state.value={...f.state.value,subject:{...subject,employeeId:'other',profile:'other'},subjectHash:'hash-other',resources:{groups:{status:'unknown',data:null}}};await panel.settle();assert.doesNotMatch(panel.text(),/本地草稿|群独立历史/);
});

test('the real group form closes only after its own verified create and retains unknown creation drafts',async t=>{
 const f=fixture();let response=action('create',{id:'own-create',application:'unknown',data:{groupId:'new-group'}});f.controller.submit=async(...args)=>{f.calls.push(args);f.state.action=response;return{action:response};};
 const panel=await mount(t,f);panel.button('新建群').props.onClick();await panel.settle();await enter(panel,'群名称','创建草稿');await check(panel,'群成员：写作者',true);await panel.find(node=>node.type==='form'&&node.props['aria-label']==='编辑原生群')[0].props.onSubmit({preventDefault(){}});await panel.settle();assert.equal(input(panel,'群名称').props.value,'创建草稿');
 f.state.action=action('create',{id:'unrelated-create',application:'applied',data:{item:{...group(),id:'unrelated-group'}}});await panel.settle();assert.equal(input(panel,'群名称').props.value,'创建草稿');
 f.state.action=action('create',{id:'own-create',application:'applied',data:{item:{...group(),id:'new-group',title:'创建草稿'}}});await panel.settle();assert.equal(panel.find(node=>node.type==='form'&&node.props['aria-label']==='编辑原生群').length,0);assert.match(panel.text(),/new-group/);
});

test('editing cannot silently drop a native member whose employee mapping is ambiguous',async t=>{
 const f=fixture(),visible=[...employees(),{id:'alias',runtime:'DSH',target_device_id:'pc',runtime_profile:'beta'},{id:'third',name:'第三位',runtime:'DSH',target_device_id:'pc',runtime_profile:'gamma'}];f.state.value.resources.groups.data.items[0].members.push('gamma');
 const panel=await mount(t,f,{employees:visible});panel.button('编辑群').props.onClick();await panel.settle();assert.equal(panel.find(node=>node.type==='form'&&node.props['aria-label']==='编辑原生群').length,0);assert.match(panel.text(),/成员映射尚未核实/);assert.equal(f.calls.length,0);
});

test('switching groups preserves separate unsent messages and never carries one into another group',async t=>{
 const f=fixture();f.state.value.resources.groups.data.items.push({...group(),id:'group-b',title:'群 B'});const panel=await mount(t,f);
 const choose=title=>panel.find(node=>node.type==='button'&&node.children.some(child=>child.type==='strong'&&child.text===title))[0].props.onClick();
 await enter(panel,'群消息','只给 A 的草稿');await choose('群 B');await panel.settle();assert.equal(input(panel,'群消息').props.value,'');assert.equal(panel.button('发送到群').props.disabled,true);
 await enter(panel,'群消息','只给 B 的草稿');await choose('原生协作群');await panel.settle();assert.equal(input(panel,'群消息').props.value,'只给 A 的草稿');await choose('群 B');await panel.settle();assert.equal(input(panel,'群消息').props.value,'只给 B 的草稿');
});

test('a confirmed send clears only its own group draft while another group is being edited',async t=>{
 const f=fixture();f.state.value.resources.groups.data.items.push({...group(),id:'group-b',title:'群 B'});f.controller.submit=async(resource,operation,input)=>{f.calls.push([resource,operation,input]);return operation==='send'?{action:action('send',{id:'own-send',application:'unknown',data:{sourceActionId:'own-send',groupId:'native-group'}})}:null;};const panel=await mount(t,f);
 const choose=title=>panel.find(node=>node.type==='button'&&node.children.some(child=>child.type==='strong'&&child.text===title))[0].props.onClick();await enter(panel,'群消息','相同文字');await panel.button('发送到群').props.onClick();await choose('群 B');await panel.settle();await enter(panel,'群消息','相同文字');
 f.state.action=action('send',{id:'own-send',application:'applied',data:{sourceActionId:'own-send',groupId:'native-group',historyPersisted:true,members:[{employeeId:'writer',profile:'beta',conversationId:'group-thread',actionId:'member-original',status:'succeeded',output:'native output'}]}});await panel.settle();assert.equal(input(panel,'群消息').props.value,'相同文字');await choose('原生协作群');await panel.settle();assert.equal(input(panel,'群消息').props.value,'');
});

test('real native controller keeps a pending group parent while its asynchronous cancellation is queried independently',async t=>{
 const posts=[],value={schemaVersion:1,workspace:'team',employeeId:'anchor',subject:{...subject},scope:{kind:'bot'},subjectHash:'hash-one',resources:{groups:{status:'observed',stale:false,data:{items:[group()]}}},pending:[]};
 const pending=(operation,id)=>{const a=action(operation,{id,status:'acked'});a.result=null;return a;};let sequence=0;
 const api={dshNativeState:async()=>value,dshNativeCapabilities:async()=>({schemaVersion:1,workspace:'team',employeeId:'anchor',operations:DSH_NATIVE_OPERATIONS.map(entry=>({...entry,supported:entry.implemented}))}),submitDshNative:async(id,body)=>{posts.push(body);return{...value,action:pending(body.operation,body.operation==='send'?'original-send':'cancel-control')};},dshNativeAction:async id=>id==='original-send'?action('send',{id,application:'unknown',data:{sourceActionId:id,groupId:'native-group',members:[{employeeId:'writer',profile:'beta',conversationId:'dedicated-group-thread',actionId:'member-original',status:'unknown'}]}}):action('cancel',{id,application:'observed',data:{sourceActionId:'original-send',groupId:'native-group',cancelRequested:true,stopConfirmed:false,members:[{actionId:'member-original',cancelActionId:'cancel-member',cancellationRequested:true}]}})};
 const controller=createDshNative({api,wrap:vue.reactive,storage:null,keyFactory:()=> 'group-key-'+(++sequence),setTimer:()=>0,clearTimer(){}});t.after(()=>controller.dispose());await controller.select({actorId:'owner',workspace:'team',employeeId:'anchor'},{active:true});const panel=await mount(t,{controller});
 await enter(panel,'群消息','@beta 真实群执行');await panel.button('发送到群').props.onClick();await panel.settle();assert.equal(controller.state.groupRequest.actionId,'original-send');assert.equal(controller.state.request.scope.kind,'group');const original=JSON.stringify(controller.state.request);
 await panel.button('请求停止本次群执行').props.onClick();await panel.settle();assert.equal(posts[1].operation,'cancel');assert.deepEqual(posts[1].input,{sourceActionId:'original-send'});assert.notEqual(posts[0].idempotencyKey,posts[1].idempotencyKey);assert.equal(JSON.stringify(controller.state.request),original);
 await controller.readAction();await panel.settle();assert.equal(controller.state.request.actionId,'original-send');assert.match(panel.text(),/取消请求已返回/);assert.match(panel.text(),/cancel-member/);assert.match(panel.text(),/member-original/);assert.equal(input(panel,'群消息').props.value,'@beta 真实群执行');assert.equal(posts.length,2);assert.equal(panel.button('请求停止本次群执行').props.disabled,true);
 controller.state.groupAction=action('send',{id:'next-send',application:'unknown',data:{groupId:'native-group',sourceActionId:'next-send'}});await panel.settle();assert.match(panel.text(),/next-send/);assert.doesNotMatch(panel.text(),/取消请求已返回/);
});
