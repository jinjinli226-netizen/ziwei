import test from 'node:test';
import assert from 'node:assert/strict';
import * as vue from 'vue';
import {mountPanel} from '../verification/vue-panel-harness.mjs';

function controller(resources,scope={kind:'bot'}){
 const calls=[],state=vue.reactive({subject:{actorId:'owner',workspace:'team',employeeId:'employee'},value:{resources,scope,pending:[]},loading:false,submitting:false,request:null,error:'',notice:''});
 return{calls,state,resource:name=>state.value.resources[name],supported:()=>true,editable:name=>state.value.resources[name]?.status==='observed',submit:async(...args)=>calls.push(args),refresh:async(...args)=>calls.push(['refresh',...args]),load:async()=>calls.push(['load']),readAction:async()=>calls.push(['readAction'])};
}
const observed=data=>({status:'observed',data});
test('real DSH routine controls retain native task identity and never submit a duplicate platform schedule',async t=>{
 const ctl=controller({routines:observed({items:[{id:'routine-native',title:'日报',prompt:'撰写日报',intervalMinutes:1440,enabled:true,lastStatus:'submitted'}]})});
 const panel=await mountPanel('../src/components/DshWorkspacePanel.vue',{controller:ctl,section:'routines'});t.after(()=>panel.dispose());
 assert.match(panel.text(),/已提交，等待执行结果/);
 await panel.button('暂停').props.onClick();assert.deepEqual(ctl.calls.at(-1),['routines','update',{id:'routine-native',enabled:false}]);
 await panel.button('运行一次').props.onClick();assert.deepEqual(ctl.calls.at(-1),['routines','run',{id:'routine-native'}]);
 assert.equal(ctl.calls.some(call=>call[0]==='automations'),false);
});
test('real file panel uses the native isDir field and exact relative paths',async t=>{
 const ctl=controller({files:observed({path:'',sourceOperation:'list',files:[{name:'reports',path:'reports',isDir:true,size:0},{name:'notes.md',path:'notes.md',isDir:false,size:12}]})});
 const panel=await mountPanel('../src/components/DshWorkspacePanel.vue',{controller:ctl,section:'files'});t.after(()=>panel.dispose());
 const buttons=panel.find(element=>element.props.class==='file');await buttons[0].props.onClick();assert.deepEqual(ctl.calls.at(-1),['files','list',{path:'reports'}]);
 await buttons[1].props.onClick();assert.deepEqual(ctl.calls.at(-1),['files','preview',{path:'notes.md'}]);
});
test('session controls keep nonempty preset changes in an explicitly new conversation',async t=>{
 const ctl=controller({sessions:observed({projections:{values:{agentPreset:'standard',sessionListMetadata:{blank:false}}}}),plan:observed({available:true,effectiveActive:false}),interactions:observed({requests:[]})},{kind:'conversation',nativeSessionId:'native-session'}),bot=controller({presets:observed({presets:[{id:'standard',name:'标准'},{id:'ptc',name:'PTC'}]})}),created=[];
 const panel=await mountPanel('../src/components/DshSessionControls.vue',{controller:ctl,botController:bot,messageCount:2},{onNewConversation:value=>created.push(value)});t.after(()=>panel.dispose());
 const select=panel.find(element=>element.type==='select')[0];select.props['onUpdate:modelValue']('ptc');await panel.settle();await panel.button('新建此模式聊天').props.onClick();
 assert.deepEqual(created,[{agentPreset:'ptc'}]);assert.equal(ctl.calls.length,0);
 await panel.button('开启 Plan').props.onClick();assert.deepEqual(ctl.calls.at(-1),['plan','set',{active:true}]);
});
test('live tool approval and plan review submit exactly the native one-time decisions',async t=>{
 const ctl=controller({sessions:observed({projections:{values:{}}}),interactions:observed({requests:[{interactionId:'approval-live',kind:'approval',toolName:'shell',reason:'Run requested command'},{interactionId:'plan-live',kind:'question',questions:[{id:'plan-question',question:'执行计划？',detail:'完整计划',intent:{kind:'plan-review',approve:'native-approve-value'}}]}]})},{kind:'conversation',nativeSessionId:'native-session'}),bot=controller({presets:observed({presets:[]})});
 const panel=await mountPanel('../src/components/DshSessionControls.vue',{controller:ctl,botController:bot});t.after(()=>panel.dispose());
 await panel.button('仅本次允许').props.onClick();assert.deepEqual(ctl.calls.at(-1),['interactions','approve',{interactionId:'approval-live',decision:'allowed-once'}]);
 const form=panel.find(element=>element.type==='form')[0];await form.props.onSubmit({preventDefault(){},stopPropagation(){}});
 assert.deepEqual(ctl.calls.at(-1),['interactions','answer',{interactionId:'plan-live',answers:[{id:'plan-question',selected:['native-approve-value']}]}]);
 assert.match(panel.text(),/完整计划/);
});
test('a running conversation reads approvals through the dedicated control operation',async t=>{
 const ctl=controller({interactions:observed({requests:[]})},{kind:'conversation',nativeSessionId:'live-session'}),bot=controller({presets:observed({presets:[]})});
 const panel=await mountPanel('../src/components/DshSessionControls.vue',{controller:ctl,botController:bot,executionBusy:true});t.after(()=>panel.dispose());
 await panel.button('读取待处理事项').props.onClick();assert.deepEqual(ctl.calls,[['load'],['interactions','list',{}]]);
 assert.equal(panel.button('开启 Plan').props.disabled,true);
});
test('reopened file panels immediately restore cached previews and nested navigation',async t=>{
 const ctl=controller({files:observed({sourceOperation:'preview',path:'reports/notes.md',content:'real cached preview',size:19})});
 const panel=await mountPanel('../src/components/DshWorkspacePanel.vue',{controller:ctl,section:'files'});t.after(()=>panel.dispose());
 assert.match(panel.text(),/real cached preview/);assert.equal(panel.button('上一级').props.disabled,false);
 await panel.button('上一级').props.onClick();assert.deepEqual(ctl.calls.at(-1),['files','list',{path:''}]);
});
test('confirmed native routine creation closes its form instead of allowing a second create',async t=>{
 const ctl=controller({routines:observed({items:[]})});
 ctl.submit=async(...args)=>{ctl.calls.push(args);ctl.state.action={id:'created-action',status:'succeeded',payload:{dshOperation:{resource:'routines',operation:'create'}},result:{dshNative:{status:'applied',data:{item:{id:'created-native-routine'}}}}};};
 const panel=await mountPanel('../src/components/DshWorkspacePanel.vue',{controller:ctl,section:'routines'});t.after(()=>panel.dispose());
 await panel.button('新建例行工作').props.onClick();await panel.settle();
 const input=panel.find(element=>element.type==='input'&&element.props.type!=='checkbox')[0],textarea=panel.find(element=>element.type==='textarea')[0];
 input.value='每天日报';input.dispatch('input');textarea.value='读取今天的任务并汇报';textarea.dispatch('input');await panel.settle();
 await panel.find(element=>element.type==='form')[0].props.onSubmit({preventDefault(){},stopPropagation(){}});await panel.settle();
 assert.equal(panel.find(element=>element.type==='form').length,0);assert.equal(ctl.calls.length,1);
 assert.deepEqual(ctl.calls[0],['routines','create',{title:'每天日报',prompt:'读取今天的任务并汇报',intervalMinutes:1440,enabled:true}]);
});
test('native multiple-choice and custom answers follow real Vue input events',async t=>{
 const ctl=controller({interactions:observed({requests:[{interactionId:'question',kind:'question',questions:[{id:'destinations',question:'选择平台',multiSelect:true,options:[{label:'TikTok'},{label:'YouTube'}]}]}]})},{kind:'conversation',nativeSessionId:'session'}),bot=controller({presets:observed({presets:[]})});
 const panel=await mountPanel('../src/components/DshSessionControls.vue',{controller:ctl,botController:bot});t.after(()=>panel.dispose());
 const input=panel.find(element=>element.type==='input')[0],textarea=panel.find(element=>element.type==='textarea')[0];
 input.checked=true;input.dispatch('change');textarea.value='另加Instagram';textarea.dispatch('input');await panel.settle();
 await panel.find(element=>element.type==='form')[0].props.onSubmit({preventDefault(){},stopPropagation(){}});
 assert.deepEqual(ctl.calls.at(-1),['interactions','answer',{interactionId:'question',answers:[{id:'destinations',selected:['TikTok'],custom:'另加Instagram'}]}]);
});
