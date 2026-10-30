import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagerHarness} from '../verification/bot-management-harness.mjs';

async function workspace(t){const h=await createManagerHarness({initial:{chatMode:true}});t.after(()=>h.dispose());return h;}

test('the roster retains a unified employee creator and the template market',async t=>{
  const h=await workspace(t);
  h.button('新建员工').props.onClick();assert.deepEqual(h.events.at(-1),['create-employee',undefined]);
  h.button('伙伴市场 Creator').props.onClick();assert.deepEqual(h.events.at(-1),['creator',undefined]);
  assert.equal(h.button('创建专属 Hermes Bot'),undefined);
});

test('the shared workspace keeps its management draft when the drawer closes',async t=>{
  const h=await workspace(t),drawer=h.byClass('bot-management-drawer')[0];
  assert.equal(h.byClass('employee-chat-stage').length,1);
  assert.equal(drawer.style.display,'none');
  h.button('管理员工').props.onClick();await h.settle();
  assert.notEqual(drawer.style.display,'none');
  h.button('基础配置').props.onClick();await h.settle();
  const draft=h.state.s.draft;draft.employee.instructions='当前员工的未保存职责';
  h.findAll(node=>node.props['aria-label']==='关闭员工管理')[0].props.onClick();await h.settle();
  assert.equal(drawer.style.display,'none');assert.equal(h.state.s.draft,draft);
  h.button('管理员工').props.onClick();await h.settle();
  assert.equal(h.state.s.draft.employee.instructions,'当前员工的未保存职责');
  assert.equal(h.calls.filter(call=>call[0]==='save').length,0);
});

for(const runtime of ['DSH','Codex'])test(`${runtime} uses the same workspace and opens its own employee conversation`,async t=>{
  const h=await workspace(t),employee=h.fixture.roster.find(row=>row.employee.runtime===runtime);
  const reads=h.calls.filter(call=>call[0]==='bot').length;
  h.byClass('bot-roster-row').find(row=>h.text(row).includes(employee.employee.name)).props.onClick();await h.settle();
  assert.equal(h.byClass('employee-chat-stage').length,1);assert.equal(h.byClass('bot-management-drawer').length,1);
  assert.equal(h.calls.filter(call=>call[0]==='bot').length,reads);
  assert.equal(h.events.at(-1)[0],'employee-chat');assert.equal(h.events.at(-1)[1].employee.id,employee.id);
  assert.equal(h.events.filter(event=>event[0]==='chat').length,0);
  h.button('管理员工').props.onClick();await h.settle();
  assert.ok(h.findAll(node=>node.props['aria-label']==='员工详情').length);
  h.button('基础配置').props.onClick();await h.settle();
  assert.ok(h.button('编辑基础资料'));assert.equal(h.byClass('bot-instance').length,0);
  h.button('高级配置').props.onClick();assert.equal(h.events.at(-1)[0],'employee-settings');
});

test('selecting the current Hermes employee opens only its existing main conversation',async t=>{
  const h=await workspace(t);h.byClass('bot-roster-row')[0].props.onClick();await h.settle();
  assert.deepEqual(h.events.at(-1),['chat',{workspace:'preview',employee:h.fixture.bot.employee,conversation:{id:h.fixture.bot.main_conversation_id},botId:h.fixture.bot.id}]);
});

test('unknown configuration writes remain recoverable after reopening management',async t=>{
  const h=await workspace(t);h.state.s.writeUnknown=true;h.state.s.pendingOperation={kind:'routine_run'};
  h.button('管理员工').props.onClick();await h.settle();
  assert.ok(h.button('按原请求标识查询 / 恢复'));
  h.findAll(node=>node.props['aria-label']==='关闭员工管理')[0].props.onClick();await h.settle();
  h.button('管理员工').props.onClick();await h.settle();assert.equal(h.state.s.writeUnknown,true);
  h.button('基础配置').props.onClick();await h.settle();assert.equal(h.button('保存配置').props.disabled,true);
});

test('a created employee refreshes the live roster without replacing the current draft',async t=>{
  const h=await workspace(t),draft=h.state.s.draft;draft.employee.instructions='保持当前未保存职责';
  const created=structuredClone(h.fixture.roster[1]);created.id=created.employee.id='new-employee';created.employee.name='新建的员工';
  h.fixture.roster.push(created);h.props.rosterRefreshKey=1;await h.settle();
  assert.ok(h.byClass('bot-roster-row').some(row=>h.text(row).includes('新建的员工')));
  assert.equal(h.state.s.draft,draft);assert.equal(draft.employee.instructions,'保持当前未保存职责');
});
