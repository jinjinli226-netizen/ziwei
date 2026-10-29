import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagerHarness,managerFixture} from '../verification/bot-management-harness.mjs';

async function harness(t,options){const h=await createManagerHarness(options);t.after(()=>h.dispose());return h;}

test('actual management navigation preserves all nine section keys and lazy records',async t=>{
  const h=await harness(t);
  assert.equal(h.byClass('bot-tabs')[0].children.filter(item=>item.type==='button').length,5);
  assert.equal(h.calls.filter(call=>call[0]==='runs').length,0);
  for(const [key,label]of [['settings','基础配置'],['capabilities','能力配置'],['routines','例行工作'],['activity','运行记录'],['chat','概览']]){
    h.button(label).props.onClick();await h.settle();assert.deepEqual(h.events.at(-1),['section',key]);
  }
  assert.ok(h.calls.some(call=>call[0]==='runs'));
  const select=h.findAll(item=>item.props['aria-label']==='更多 Bot 管理')[0];
  select.props.onClick();await h.settle();
  for(const [key,label]of [['knowledge','资料与工具'],['collaboration','伙伴协作'],['channels','消息与音频'],['proactive','主动工作']]){
    const option=h.findAll(item=>item.props.role==='option'&&h.text(item).trim()===label,h.body)[0];
    assert.ok(option,label);option.props.onClick();await h.settle();assert.deepEqual(h.events.at(-1),['section',key]);
    const trigger=h.findAll(item=>item.props['aria-label']==='更多 Bot 管理')[0];trigger.props.onClick();await h.settle();
  }
});

test('header opens only the stored main conversation and configuration stays local across section changes',async t=>{
  const h=await harness(t);
  const header=h.byClass('bot-detail-heading')[0];
  assert.equal(h.findAll(item=>String(item.props.class||'').split(' ').includes('primary'),header).length,1);
  h.button('打开长期聊天').props.onClick();
  assert.deepEqual(h.events.at(-1),['chat',{workspace:'preview',employee:h.fixture.bot.employee,conversation:{id:'conversation_hermes'},botId:'employee_hermes'}]);
  h.button('基础配置').props.onClick();await h.settle();
  const draft=h.state.s.draft;draft.employee.instructions='保留未保存职责';
  h.button('能力配置').props.onClick();await h.settle();h.button('基础配置').props.onClick();await h.settle();
  assert.equal(h.state.s.draft,draft);assert.equal(h.state.s.draft.employee.instructions,'保留未保存职责');
  assert.equal(h.calls.filter(call=>call[0]==='save').length,0);
  h.button('保存配置').props.onClick();await h.settle();
  const save=h.calls.find(call=>call[0]==='save');assert.ok(save);assert.equal(save[2].expectedRevision,3);assert.equal(save[3],'preview');
});

test('instance details and employee management stay accessible in settings without crowding overview',async t=>{
  const h=await harness(t);
  assert.equal(h.byClass('bot-instance').length,0);assert.equal(h.button('删除员工'),undefined);
  h.button('基础配置').props.onClick();await h.settle();assert.equal(h.byClass('bot-instance').length,1);
  assert.ok(h.button('删除员工'));assert.ok(h.button('手机互联'));
  h.button('在团队管理查看').props.onClick();assert.deepEqual(h.events.at(-1),['employee',h.fixture.bot.employee]);
});

test('a missing main conversation cannot be replaced by a guessed employee or route identifier',async t=>{
  const fixture=managerFixture();fixture.bot.main_conversation_id=null;
  const h=await harness(t,{fixture}),open=h.button('打开长期聊天');assert.equal(open.props.disabled,true);
  open.props.onClick();assert.equal(h.events.filter(event=>event[0]==='chat').length,0);
});

test('compact roster can open, close with Escape, and respects unsaved-draft selection decisions',async t=>{
  const h=await harness(t),toggle=()=>h.byClass('bot-mobile-roster-heading')[0];
  assert.equal(toggle().props['aria-expanded'],false);toggle().props.onClick();await h.settle();
  assert.equal(toggle().props['aria-expanded'],true);h.byClass('bot-roster')[0].props.onKeydown({key:'Escape'});await h.settle();assert.equal(toggle().props['aria-expanded'],false);
  toggle().props.onClick();await h.settle();h.state.s.draft.employee.instructions='未保存职责';
  window.confirm=()=>false;h.byClass('bot-roster-row')[1].props.onClick();await h.settle();
  assert.equal(toggle().props['aria-expanded'],true);assert.equal(h.state.s.bot.id,'employee_hermes');assert.equal(h.state.s.draft.employee.instructions,'未保存职责');
  window.confirm=()=>true;h.byClass('bot-roster-row')[1].props.onClick();await h.settle();assert.equal(toggle().props['aria-expanded'],false);assert.ok(h.button('打开原有聊天'));
});

test('the roster and additional-management selectors expose distinct labelled listboxes',async t=>{
  const h=await harness(t);
  for(const id of ['bot-roster-runtime','bot-management-sections']){
    const trigger=h.findAll(item=>item.props.id===id)[0];assert.ok(trigger,id);
    trigger.props.onClick();await h.settle();assert.equal(trigger.props['aria-controls'],id+'-listbox');assert.ok(h.findAll(item=>item.props.id===id+'-listbox'&&item.props.role==='listbox',h.body).length);
    trigger.props.onClick();await h.settle();
  }
});

test('an uninitialized employee is not presented as an already configured Bot instance',async t=>{
  const fixture=managerFixture();fixture.bot.configuration_state='uninitialized';fixture.bot.control_state='draft';fixture.bot.validation={status:'not_checked'};delete fixture.bot.instance;
  const h=await harness(t,{fixture});
  const instance=h.findAll(item=>item.type==='article'&&h.text(item).startsWith('Bot 实例'))[0];
  assert.ok(instance);assert.match(h.text(instance),/尚未初始化/);assert.doesNotMatch(h.text(instance),/已创建|已就绪|来源 Profile/);
  assert.ok(h.button('初始化此员工的 Bot 能力'));
});

for(const [type,label]of [['hermes.bot.validate','配置检查'],['conversation.execute','会话任务'],['hermes.bot.routine','其他动作']])test(`the latest ${type} receipt retains its actual action category`,async t=>{
  const fixture=managerFixture();fixture.bot.latest_run={id:'latest-action',type,status:'succeeded',result:{},created_at:'2026-10-29T00:00:00Z',completed_at:'2026-10-29T00:01:00Z'};
  const h=await harness(t,{fixture});
  const recent=h.findAll(item=>item.type==='article'&&h.text(item).startsWith('最近动作'))[0];assert.ok(recent);assert.match(h.text(recent),new RegExp(label+' · '));
  if(type==='hermes.bot.validate')assert.doesNotMatch(h.text(recent),/会话任务/);
});

for(const runtime of ['DSH','Codex'])test(`actual ${runtime} roster selection uses the existing employee routes without Hermes instance claims`,async t=>{
  const h=await harness(t),employee=h.fixture.roster.find(row=>row.employee.runtime===runtime);
  const reads=h.calls.filter(call=>call[0]==='bot').length;
  h.byClass('bot-roster-row').find(row=>h.text(row).includes(employee.employee.name)).props.onClick();await h.settle();
  assert.equal(h.calls.filter(call=>call[0]==='bot').length,reads);assert.equal(h.byClass('bot-instance').length,0);assert.equal(h.byClass('bot-tabs').length,0);
  h.button('员工设置').props.onClick();assert.deepEqual(h.events.at(-1),['employee-settings',{workspace:'preview',employee:employee.employee,conversationId:employee.main_conversation_id}]);
  h.button('打开原有聊天').props.onClick();assert.equal(h.events.at(-1)[0],'employee-chat');assert.equal(h.events.at(-1)[1].employee.id,employee.id);
  assert.ok(h.findAll(item=>item.props['data-fixture-component']==='EmployeeCapabilityInventory').length);
});

test('offline, unverified configuration and unknown execution remain separate factual states',async t=>{
  const fixture=managerFixture();fixture.discovery.devices[0].status='offline';fixture.bot.validation={status:'not_checked'};
  fixture.bot.latest_run={id:'uncertain-run',type:'hermes.chat',status:'failed',result:{executionState:'uncertain'},created_at:'2026-10-29T00:00:00Z'};
  const h=await harness(t,{fixture});
  const facts=h.byClass('bot-status-overview')[0]||h.byClass('bot-health-grid')[0]||h.byClass('bot-facts')[0];
  assert.ok(facts,'the overview must expose the four source facts');
  assert.match(h.text(facts),/离线/);assert.match(h.text(facts),/尚未检查/);assert.match(h.text(facts),/待核实|待确认|未知|失败/);
  assert.doesNotMatch(h.text(facts),/全部可用|模型已就绪|模型调用成功/);
});

test('unknown writes retain recovery actions and block configuration resubmission',async t=>{
  const h=await harness(t);h.state.s.writeUnknown=true;h.state.s.pendingOperation={kind:'routine_run'};await h.settle();
  assert.match(h.text(),/操作结果未确认/);assert.ok(h.button('按原请求标识查询 / 恢复'));
  h.button('基础配置').props.onClick();await h.settle();assert.equal(h.button('保存配置').props.disabled,true);assert.equal(h.button('删除员工').props.disabled,true);
});

test('a past configuration check cannot claim the saved revision has passed',async t=>{
  const fixture=managerFixture();fixture.bot.validation={status:'succeeded',revision:2};
  const h=await harness(t,{fixture});assert.match(h.text(),/配置已变更，需重新检查/);assert.equal(h.state.checkedCurrent.value,false);
});

for(const source of ['unhealthy','read-failed'])test(`${source} device discovery cannot report current online availability`,async t=>{
  const fixture=managerFixture();
  if(source==='unhealthy')fixture.discovery.devices[0].healthy=false;
  else fixture.discoveryError=Error('fixture connection failed');
  const h=await harness(t,{fixture}),facts=h.byClass('bot-health-grid')[0]||h.byClass('bot-facts')[0]||h.byClass('bot-status-overview')[0];
  assert.ok(facts);assert.doesNotMatch(h.text(facts),/设备在线|电脑在线|连接正常/);
});
