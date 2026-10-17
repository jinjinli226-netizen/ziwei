import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../web/model.js';
import {render} from '../web/view.js';

const first={id:'employee-original-one',name:'闲鱼运营大神',description:'闲鱼运营与客户维护'};
const second={id:'employee-original-two',name:'InsTrendS',description:'内容探索员'};
const state=overrides=>({...initialState(),phase:'ready',workspace:{slug:'original-workspace',name:'原工作区'},employees:[first,second],...overrides});
const threads=[
  {employee:first,conversationId:'original-main-one',preview:'已经整理好方案',updatedAt:'2026-10-16T01:00:00Z',unreadCount:0},
  {employee:second,conversationId:'original-main-two',preview:'[图片] 下一轮内容',updatedAt:'2026-10-17T02:00:00Z',unreadCount:3},
];

test('home navigation gives chat a first-class tab and keeps devices reachable from My',()=>{
  const home=render(state({tab:'chat'})),nav=home.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-tab="([^"]+)"/g)].map(match=>match[1]),['chat','employees','work','me']);
  assert.match(nav,/data-tab="chat" class="nav-item active"/);
  assert.match(render(state({tab:'me'})),/data-action="navigate" data-tab="devices"/);
  const devices=render(state({tab:'devices'}));
  assert.match(devices,/设备互联/);assert.match(devices,/data-tab="me" class="nav-item active"/);
});

test('recent chats sort by message time and open the same employee identity',()=>{
  const html=render(state({tab:'chat',chatThreads:threads,chatThreadsResource:{phase:'ready'}}));
  const list=html.match(/<div class="thread-list"[\s\S]*?<\/main>/)[0];
  assert(list.indexOf(`data-id="${second.id}"`)<list.indexOf(`data-id="${first.id}"`));
  assert.match(list,/\[图片\] 下一轮内容/);assert.match(list,/已经整理好方案/);
  assert.match(list,/data-action="chat" data-id="employee-original-one"/);
  assert.match(list,/datetime="2026-10-17T02:00:00.000Z"/);
  assert.deepEqual(threads.map(thread=>thread.employee.id),[first.id,second.id],'view sorting must not change canonical state');
});

test('chat previews are escaped and unread indicators need an actual positive count',()=>{
  const html=render(state({tab:'chat',chatThreads:[{employee:{id:'employee-<original>',name:'<script>员工</script>'},preview:'<img src=x onerror=alert(1)>',updatedAt:'invalid',unreadCount:true}],chatThreadsResource:{phase:'ready'}}));
  assert.match(html,/&lt;script&gt;员工&lt;\/script&gt;/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html,/<script>|onerror="|class="thread-unread"|class="nav-unread"|datetime="invalid"/);
  const counted=render(state({tab:'chat',chatThreads:[{...threads[0],unreadCount:100},{...threads[1],unreadCount:2}]}));
  assert.match(counted,/aria-label="聊天，102 条未读"/);assert.match(counted,/class="thread-unread" aria-hidden="true">99\+/);
});

test('chat search checks names and previews while preserving a distinct no-match state',()=>{
  const byName=render(state({tab:'chat',chatThreads:threads,chatSearch:'闲鱼'}));
  const list=byName.match(/<div class="thread-list"[\s\S]*?<\/main>/)[0];
  assert.match(list,/闲鱼运营大神/);assert.doesNotMatch(list,/InsTrendS/);
  assert.match(render(state({tab:'chat',chatThreads:threads,chatSearch:'下一轮'})),/data-id="employee-original-two"/);
  assert.match(render(state({tab:'chat',chatThreads:threads,chatSearch:'没有这个词'})),/没有找到相关聊天/);
});

test('recent chat failures retain rows and do not claim original histories are empty',()=>{
  const pending=render(state({tab:'chat',chatThreads:[],chatThreadsResource:{phase:'loading'}}));
  assert.match(pending,/正在同步最近聊天/);assert.doesNotMatch(pending,/暂无消息|还没有聊天/);
  const failed=render(state({tab:'chat',chatThreads:threads,chatThreadsResource:{phase:'error',error:'连接暂时失败'}}));
  assert.match(failed,/最近聊天同步失败：连接暂时失败/);assert.match(failed,/已经整理好方案/);
  assert.match(render(state({tab:'chat',chatThreadsResource:{phase:'ready'}})),/data-action="navigate" data-tab="employees"/);
});

test('contacts and chat keep original detail, report, read-error and timeline contracts',()=>{
  const contacts=render(state({tab:'employees'}));
  assert.match(contacts,/data-action="report-setup"/);assert.match(contacts,/name="search"/);
  assert.match(contacts,/data-action="employee-detail" data-id="employee-original-one"/);
  assert.match(contacts,/data-action="chat" data-id="employee-original-one"/);
  const chat=render(state({tab:'chat',page:'chat',selectedEmployee:first,conversation:{id:'original-main-one'},messages:[{id:'old-one',role:'assistant',content:'原历史消息'}],employeeResources:{conversation:{phase:'error',error:'暂时不可读'}}}));
  assert.match(chat,/class="chat-history chat-timeline" data-chat-scroll/);assert.match(chat,/data-chat-end/);
  assert.match(chat,/原历史消息/);assert.match(chat,/聊天记录同步失败：暂时不可读/);assert.match(chat,/name="draft"/);
});

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const history=[
  {id:'persisted-user',role:'user',content:'请整理这份方案',createdAt:'2026-10-17T01:00:00Z'},
  {id:'persisted-assistant',role:'assistant',content:'原文消息 <记录>',attachments:[{url:png,name:'原图片.png'}],createdAt:'2026-10-17T01:01:00Z'},
  {id:'tool-row',role:'tool',content:'工具结果'},
  {role:'assistant',content:'没有持久化 ID'},
  {id:'unsent',role:'user',content:'尚未发送',status:'failed'},
];
const forwardState=overrides=>({phase:'confirm',sourceConversationId:'original-main-one',sourceEmployeeId:first.id,selectedIds:['persisted-assistant','persisted-user'],targetEmployeeId:second.id,note:'请参考这段记录',mode:'reference',error:'',...overrides});
const chatState=overrides=>state({tab:'chat',page:'chat',selectedEmployee:first,conversation:{id:'original-main-one',employee_id:first.id},messages:history,draft:'尚未发送的原草稿',...overrides});

test('only persisted ordinary chat messages expose forward operations and selection controls',()=>{
  const html=render(chatState());
  assert.equal([...html.matchAll(/data-forwardable-message=/g)].length,2);
  assert.equal([...html.matchAll(/data-action="message-menu"/g)].length,2);
  assert.match(html,/data-message-id="persisted-assistant"/);
  assert.doesNotMatch(html,/data-forwardable-message="unsent"|data-forwardable-message="tool-row"/);
  const original=chatState({forward:forwardState({phase:'select'})}),selection=render(original);
  assert.match(selection,/data-action="forward-toggle" data-id="persisted-assistant"/);
  assert.match(selection,/aria-pressed="true"/);assert.match(selection,/已选 <strong>2<\/strong> \/ 20 条/);
  assert.doesNotMatch(selection,/data-action="message-menu"|data-form="chat"/);
  assert.equal(original.draft,'尚未发送的原草稿');
  const report=render(chatState({page:'report',forward:forwardState({phase:'menu'}),report:{queue:[{employeeId:first.id,name:first.name,status:'completed'}],index:0}}));
  assert.doesNotMatch(report,/data-forwardable-message|data-action="message-menu"|class="forward-overlay"/);
});

test('forward recipient picker excludes the source and confirmation defaults to record-only',()=>{
  const target=render(chatState({forward:forwardState({phase:'target'})}));
  assert.match(target,/data-action="forward-target" data-id="employee-original-two"/);
  assert.doesNotMatch(target,/data-action="forward-target" data-id="employee-original-one"/);
  const confirm=render(chatState({forward:forwardState({note:'<附言>'})}));
  assert.match(confirm,/name="forward-note" rows="3" maxlength="4000"/);assert.match(confirm,/&lt;附言&gt;/);
  assert.match(confirm,/name="forward-mode" value="reference" checked/);
  assert.match(confirm,/保存到对方聊天，不启动员工执行/);assert.match(confirm,/转发并请他处理/);
  assert.match(confirm,/name="draft"[\s\S]*尚未发送的原草稿/);
});

test('uncertain and submitting states cannot silently alter or duplicate the forwarding intent',()=>{
  const uncertain=render(chatState({forward:forwardState({phase:'uncertain',error:'结果待确认'})}));
  assert.match(uncertain,/data-action="forward-retry"/);assert.match(uncertain,/重试同一请求/);
  assert.doesNotMatch(uncertain,/name="forward-note"|name="forward-mode"|data-action="forward-open-target"|data-action="forward-back"|撤回/);
  const submitting=render(chatState({forward:forwardState({phase:'submitting'})}));
  assert.match(submitting,/name="forward-note"[^>]* disabled/);
  assert.match(submitting,/<fieldset class="forward-mode-list" disabled/);
  assert.match(submitting,/class="button primary full large" disabled/);
  const complete=render(chatState({forward:forwardState({phase:'complete'})}));
  assert.match(complete,/data-action="forward-open-target"/);assert.match(complete,/聊天记录已保存，未发起执行/);
  assert.doesNotMatch(complete,/data-form="forward"/);
});

test('forward cards use the server snapshot without duplicating legacy fallback text or images',()=>{
  const forwarded={id:'outer-forward-original',role:'user',content:'LEGACY-FALLBACK-BODY',attachments:[{url:'https://example.test/legacy-fallback.png'}],forward:{schemaVersion:1,id:'forward-original',source:{conversationId:'original-source',employeeId:first.id,employeeName:'来源员工 <原名>'},messages:[{sourceMessageId:'original-message',role:'assistant',senderName:'原发送人',createdAt:'2026-10-17T01:01:00Z',content:'完整快照原文 <保留>',attachments:[{url:png,name:'原图片.png'}]}],mode:'reference',note:'这是附言'}};
  const card=render(chatState({messages:[forwarded]}));
  assert.match(card,/data-action="forward-detail" data-id="outer-forward-original"/);
  assert.match(card,/来源员工 &lt;原名&gt;的聊天记录/);assert.match(card,/这是附言/);
  assert.doesNotMatch(card,/LEGACY-FALLBACK-BODY|legacy-fallback.png|data-forwardable-message/);
  const detail=render(chatState({messages:[forwarded],forwardDetail:{messageId:forwarded.id}}));
  assert.match(detail,/class="forward-detail-messages"/);assert.match(detail,/原发送人/);assert.match(detail,/完整快照原文 &lt;保留&gt;/);
  assert.match(detail,/data-action="image"/);assert.match(detail,/data:image\/png;base64/);
  assert.doesNotMatch(detail,/<a |LEGACY-FALLBACK-BODY|data-content=/);
  const missing=render(chatState({messages:[forwarded],forwardDetail:{messageId:'another-employee-message'}}));
  assert.match(missing,/这段记录暂未加载/);
});

test('chat home keeps a direct report entry alongside groups and notifications',()=>{
  const home=render(state({tab:'chat',chatThreads:threads}));
  assert.match(home,/data-action="report-setup"[^>]*>[\s\S]*?<strong>汇报<\/strong>/);
  assert.match(home,/逐个听员工汇报/);assert.match(home,/data-action="notifications-open"/);assert.match(home,/data-action="groups-open"/);
});
