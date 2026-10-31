import test from 'node:test';
import assert from 'node:assert/strict';
import {renderChatActivity} from '../web/chat-activity.js';

const action = events => ({id:'run-current',type:'conversation.execute',status:'acked',workspace_id:'workspace-id',payload:{employeeId:'employee-one',conversationId:'conversation-one'},events});
const state = overrides => ({workspace:{slug:'workspace-one',workspace_id:'workspace-id'},selectedEmployee:{id:'employee-one'},conversation:{id:'conversation-one',employee_id:'employee-one',execution:{id:'run-current',status:'acked'}},runs:[],...overrides});
const event = (id,stage,fields={}) => ({id,action_id:'run-current',type:'action.stage',created_at:'2026-10-31T01:00:00Z',data:{stage,...fields}});

test('renders actual ordered runtime events and only explicitly public summaries',()=>{
  const html=renderChatActivity(state({chatActivity:{actionId:'run-current',phase:'ready',action:action([
    {id:'start',type:'action.started'},
    event('tool','tool',{detail:'工具：read_file · 执行中',arguments:{secret:'tool-arguments'}}),
    event('summary','reasoning',{summary:'先核对公开状态',detail:'hidden detail',thinking:'private-chain',content:'private-content'}),
    {id:'progress',type:'action.progress',data:{progress:{stage:'progress',detail:'已处理 3 项'}}},
  ])}}));
  assert(html.indexOf('运行电脑已接收')<html.indexOf('工具：read_file'));
  assert.match(html,/公开思考摘要/);assert.match(html,/先核对公开状态/);assert.match(html,/已处理 3 项/);
  assert.doesNotMatch(html,/private-chain|private-content|hidden detail|tool-arguments/);
});

test('does not manufacture tool or reasoning activity when receipts contain no events',()=>{
  const waiting=renderChatActivity(state());
  assert.match(waiting,/等待运行电脑回传/);assert.doesNotMatch(waiting,/<li|activity-public-summary/);
  const ended=renderChatActivity(state({conversation:{id:'conversation-one',employee_id:'employee-one',execution:{id:'run-current',status:'succeeded'}}}));
  assert.match(ended,/尚未提供详细活动记录/);assert.doesNotMatch(ended,/<details[^>]* open/);
});

test('activity belongs to the current action, employee, workspace and conversation',()=>{
  const wrongAction=action([event('other','tool',{detail:'Wrong thread activity'})]);
  wrongAction.payload.conversationId='conversation-two';
  const html=renderChatActivity(state({chatActivity:{actionId:'run-current',phase:'ready',action:wrongAction},runs:[{...action([event('other','tool',{detail:'Wrong employee'})]),payload:{employeeId:'employee-two',conversationId:'conversation-one'}},{...action([event('other','tool',{detail:'Wrong workspace'})]),workspace_id:'workspace-two'}]}));
  assert.doesNotMatch(html,/Wrong thread|Wrong employee|Wrong workspace/);
  assert.match(html,/等待运行电脑/);
  assert.equal(renderChatActivity(state({conversation:{id:'conversation-two',employee_id:'employee-two',execution:{id:'run-current'}}})), '');
});

test('full current activity takes precedence over compact runs and preserves errors separately',()=>{
  const full=action([event('tool','tool',{detail:'读取原文件'}),{type:'succeeded'}]);full.status='succeeded';
  const html=renderChatActivity(state({runs:[action([event('compact','tool',{detail:'旧精简事件'})])],chatActivity:{actionId:'run-current',phase:'error',error:'连接失败',action:full}}));
  assert.match(html,/读取原文件/);assert.match(html,/活动同步失败：连接失败/);assert.match(html,/执行已完成/);assert.doesNotMatch(html,/旧精简事件/);
});

test('compact records and loading states stay explicit and all response text is escaped',()=>{
  const run=action([event('tool','tool',{detail:'<img onerror=alert(1)>',summary:'<script>public</script>'})]);run.event_count=8;
  const html=renderChatActivity(state({runs:[run]}));
  assert.match(html,/精简活动记录/);assert.match(html,/&lt;img onerror/);assert.match(html,/&lt;script&gt;public&lt;\/script&gt;/);assert.doesNotMatch(html,/<img|<script>/);
  assert.match(renderChatActivity(state({chatActivity:{actionId:'run-current',phase:'loading'}})),/正在读取本次执行活动/);
});

test('unknown raw events and events for another action do not appear',()=>{
  const run=action([{type:'thinking',message:'private message',data:{content:'private text'}},{...event('foreign','tool',{detail:'foreign action'}),action_id:'run-other'}]);
  assert.doesNotMatch(renderChatActivity(state({chatActivity:{actionId:'run-current',phase:'ready',action:run}})),/private message|private text|foreign action/);
});
