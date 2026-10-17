import { escapeHtml, employeeName, avatarUrl, presence, messageText, formatTime, executionUncertain, botStopPresentation } from './model.js';
import { renderBotSettings } from './bot-settings.js';
import { renderDeviceSettings } from './device-settings.js';
import { isForwardableMessage, orderedForwardMessages, FORWARD_MESSAGE_LIMIT, FORWARD_NOTE_LIMIT } from './forwarding.js';
import { searchChatMessages } from './chat-search.js';
import { renderMobileGroups } from './mobile-groups-view.js';
import { renderMobileTaskForm, renderMobileTaskFilters } from './mobile-tasks-view.js';
import { filterMobileTasks } from './mobile-tasks.js';
import { renderMobileNotifications } from './mobile-notifications-view.js';

const e = value => escapeHtml(String(value ?? ''));
const rows = value => Array.isArray(value) ? value : [];
const icons = {
  employees:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  work:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 3 3 5-6M9 3v2h6V3"/>',
  devices:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  me:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  back:'<path d="m15 18-6-6 6-6"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  up:'<path d="m6 15 6-6 6 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  pin:'<path d="m16 3 5 5-4 1-4 5-1 4-6-6 4-1 5-4 1-4ZM3 21l6-6"/>',
  chat:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 11h.01M12 11h.01M17 11h.01"/>',
  report:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h5M8 16h3M19 15l3 2-3 2"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5M4 13a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  attach:'<path d="m8 12 6.5-6.5a3.5 3.5 0 0 1 5 5L10 20a5 5 0 0 1-7-7l10-10"/>',
  send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  computer:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  link:'<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  alert:'<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/>',
  settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 4l3 1 2-3h6l2 3 3-1 2 5-2 3 2 3-2 5-3-1-2 3H9l-2-3-3 1-2-5 2-3-2-3Z"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  shield:'<path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
  expand:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  play:'<path d="m8 4 13 8-13 8V4Z"/>',
  edit:'<path d="m16 3 5 5-13 13H3v-5L16 3Zm-2 2 5 5"/>',
};
function icon(name, className='') { return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`; }
function safeImage(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const text = value.trim();
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(text)) return text;
  try { const url = new URL(text, globalThis.location?.href || 'https://qzelynth.top/'); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function nameOf(employee) { return employeeName(employee) || employee?.name || employee?.employee?.name || '数字员工'; }
function avatar(employee, size='', decoration=false) {
  const name=nameOf(employee), src=safeImage(avatarUrl(employee));
  return `<span class="avatar ${size}" aria-hidden="true">${src ? `<img src="${e(src)}" alt="" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">` : `<span>${e(Array.from(name)[0] || '✦')}</span>`}${decoration ? '<i class="avatar-spark">✦</i>' : ''}</span>`;
}
function botFor(state, employee) { return rows(state.bots).find(b=>b.id===employee?.id || b.employee_id===employee?.id || b.employee?.id===employee?.id) || employee?.bot || employee; }
function statusOf(item) {
  const actual=presence(item);
  return actual && typeof actual==='object' ? actual : { label: typeof actual==='string' ? actual : '状态待确认', tone:'muted' };
}
function badge(status, className='') { const tone=['running','success','warning','error','muted'].includes(status.tone) ? status.tone : 'muted'; return `<span class="badge ${tone} ${className}"><i></i>${e(status.label)}</span>`; }
function disabled(state) { return state.busy || state.sending || state.attachmentReading || state.employeeSaving || state.phoneLoading || state.stopBusy ? ' disabled' : ''; }
function empty(iconName, title, text='', action='') { return `<div class="empty-state"><span class="empty-icon">${icon(iconName)}</span><h3>${e(title)}</h3>${text ? `<p>${e(text)}</p>` : ''}${action}</div>`; }
function sectionTitle(title, trailing='') { return `<div class="section-title"><h2>${e(title)}</h2>${trailing}</div>`; }
function shortTime(value) { return value ? e(formatTime(value)) : '暂无记录'; }
function subtitle(employee) { return employee?.description || employee?.employee?.description || employee?.role || '数字工作伙伴'; }
function actionButton(action, label, iconName='', className='secondary', attrs='') { return `<button type="button" class="button ${className}" data-action="${action}" ${attrs}>${iconName ? icon(iconName) : ''}<span>${e(label)}</span></button>`; }
function alerts(state) { return `${state.error ? `<div class="banner error" role="alert">${icon('alert')}<span>${e(state.error)}</span><button class="icon-button" data-action="refresh" aria-label="重新连接">${icon('refresh')}</button></div>` : ''}${state.notice ? `<div class="banner notice" role="status">${icon('check')}<span>${e(state.notice)}</span></div>` : ''}`; }
function resourceNotice(state, name, label) {
  const resource=state.resources?.[name];
  if(resource?.phase==='error') return `<div class="banner error" role="alert">${icon('alert')}<span>${e(label)}读取失败：${e(resource.error)}</span><button class="icon-button" data-action="refresh" aria-label="重试读取${e(label)}">${icon('refresh')}</button></div>`;
  if(resource?.phase==='loading'&&!resource.lastUpdated) return `<div class="banner notice" role="status"><span class="spinner small"></span><span>正在读取${e(label)}…</span></div>`;
  return '';
}
function resourceEmpty(state, name, iconName, label, title, text, action='') {
  const phase=state.resources?.[name]?.phase;
  if(phase==='error') return empty(iconName,`${label}尚未加载`, '请刷新重试；原有数据会在连接恢复后同步',actionButton('refresh','刷新重试','refresh','soft'));
  if(phase!=='ready') return empty(iconName,`正在读取${label}`, '稍等，正在同步当前工作区');
  return empty(iconName,title,text,action);
}
function employeeReadNotices(state, includeConversation=false) {
  const labels={conversation:'聊天记录同步',bot:'员工运行状态',runs:'运行记录',routines:'例行工作'};
  return Object.entries(labels).filter(([name])=>includeConversation||name!=='conversation').map(([name,label])=>{
    const resource=state.employeeResources?.[name];
    if(!resource?.error)return '';
    return `<div class="banner error" role="alert" data-read-resource="${name}">${icon('alert')}<span>${e(label)}${name==='conversation'?'失败':'更新失败'}：${e(resource.error)}</span><button class="icon-button" data-action="refresh" aria-label="重试${e(label)}">${icon('refresh')}</button></div>`;
  }).join('');
}

function appHeader(state, title, subtitleText='', headingAction='') {
  const workspace=state.workspace?.name || state.workspace?.slug || '我的工作区';
  return `<header class="home-header"><div class="workspace-line"><button class="workspace-picker" data-action="switch-workspace" aria-label="切换工作区"><img class="workspace-dot" src="./ziwei-logo.png" alt="" width="32" height="32">${e(workspace)}${icon('down')}</button><button class="icon-button light" data-action="refresh" aria-label="刷新页面"${disabled(state)}>${icon('refresh',state.busy?'rotating':'')}</button></div><div class="page-heading"><div><h1>${e(title)}</h1>${subtitleText ? `<p>${e(subtitleText)}</p>` : ''}</div>${headingAction}</div></header>`;
}
function pageHeader(state, title, sub='', extra='', employee=null) {
  return `<header class="detail-header"><button class="icon-button" data-action="back" aria-label="返回">${icon('back')}</button><div class="detail-header-title">${employee ? avatar(employee,'small') : ''}<div><h1>${e(title)}</h1>${sub ? `<p>${e(sub)}</p>` : ''}</div></div>${extra || '<span class="header-spacer"></span>'}</header>`;
}
function bottomNav(state) {
  const current=['devices','phones'].includes(state.tab)?'me':state.tab==='tasks'?'work':state.tab;
  const unread=rows(state.chatThreads).reduce((total,thread)=>total+unreadCount(thread?.unreadCount),0);
  return `<nav class="bottom-nav" aria-label="主导航">${[['chat','聊天'],['employees','员工'],['work','工作'],['me','我的']].map(([tab,label])=>`<button data-action="navigate" data-tab="${tab}" class="nav-item ${current===tab?'active':''}" ${current===tab?'aria-current="page"':''}${tab==='chat'&&unread?` aria-label="聊天，${unread} 条未读"`:''}><span class="nav-icon">${icon(tab)}${tab==='chat'&&unread?`<b class="nav-unread" aria-hidden="true">${unread>99?'99+':unread}</b>`:''}</span><span>${label}</span>${current===tab?'<i></i>':''}</button>`).join('')}</nav>`;
}
function unreadCount(value) { return typeof value==='number'&&Number.isFinite(value)&&value>0?Math.floor(value):0; }
function threadEmployee(state, thread) {
  return thread?.employee || rows(state.employees).find(employee=>employee.id===(thread?.employeeId || thread?.employee_id)) || {};
}
function threadTimestamp(thread) {
  const value=thread?.updatedAt || thread?.updated_at;
  const timestamp=value?new Date(value).getTime():NaN;
  return Number.isFinite(timestamp)?timestamp:0;
}
function threadTime(thread) {
  const timestamp=threadTimestamp(thread);
  if(!timestamp)return '';
  const date=new Date(timestamp),today=new Date();
  const sameDay=date.toDateString()===today.toDateString();
  const label=sameDay?date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):date.toLocaleDateString('zh-CN',{...(date.getFullYear()!==today.getFullYear()?{year:'numeric'}:{}),month:'numeric',day:'numeric'});
  return `<time class="thread-time" datetime="${e(date.toISOString())}" title="${e(formatTime(timestamp))}">${e(label)}</time>`;
}
function threadRow(state, thread) {
  const employee=threadEmployee(state,thread),unread=unreadCount(thread.unreadCount);
  const preview=typeof thread.preview==='string'?thread.preview.trim():'';
  const drafts=state.chatDraftPreviews||{},draft=Object.hasOwn(drafts,employee.id)?drafts[employee.id]:'',pinned=rows(state.pinnedChatIds).includes(thread.conversationId);
  return `<div class="thread-item ${pinned?'is-pinned':''}"><button class="thread-row ${unread?'has-unread':''}" data-action="chat" data-id="${e(employee.id)}"${employee.id?'':' disabled'} aria-label="和${e(nameOf(employee))}聊天${unread?`，${unread} 条未读`:''}"><span class="thread-avatar">${avatar(employee,'chat-avatar')}${unread?`<b class="thread-unread" aria-hidden="true">${unread>99?'99+':unread}</b>`:''}</span><span class="thread-copy"><span class="thread-heading"><strong>${e(nameOf(employee))}</strong>${threadTime(thread)}</span><span class="thread-preview ${draft?'has-draft':''}">${draft?`<em>[草稿]</em> ${e(String(draft).slice(0,180))}`:e(preview || '暂无消息')}</span></span></button>${thread.conversationId?`<button class="thread-pin icon-button" type="button" data-action="chat-pin" data-id="${e(thread.conversationId)}" aria-label="${pinned?'取消置顶':'置顶'}${e(nameOf(employee))}" aria-pressed="${pinned}">${icon('pin')}</button>`:''}</div>`;
}
function chatsPage(state) {
  const resource=state.chatThreadsResource || {},search=String(state.chatSearch || '').trim().toLowerCase();
  const pins=new Set(rows(state.pinnedChatIds));
  const all=rows(state.chatThreads).filter(thread=>thread&&typeof thread==='object').slice().sort((a,b)=>Number(pins.has(b.conversationId))-Number(pins.has(a.conversationId))||threadTimestamp(b)-threadTimestamp(a));
  const threads=all.filter(thread=>`${nameOf(threadEmployee(state,thread))} ${typeof thread.preview==='string'?thread.preview:''}`.toLowerCase().includes(search));
  const start=actionButton('navigate','发起聊天','plus','soft','data-tab="employees"');
  const notice=resource.phase==='error'?`<div class="banner error" role="alert">${icon('alert')}<span>最近聊天同步失败：${e(resource.error || '请刷新重试')}</span><button class="icon-button" data-action="refresh" aria-label="重试同步最近聊天">${icon('refresh')}</button></div>`:resource.phase==='loading'&&!resource.lastUpdated?'<div class="banner notice" role="status"><span class="spinner small"></span><span>正在同步最近聊天…</span></div>':'';
  const noRows=all.length?empty('search','没有找到相关聊天','试试员工名称或最近消息中的文字'):resource.phase==='error'?empty('chat','最近聊天暂未加载','恢复连接后会继续同步原聊天记录',actionButton('refresh','刷新重试','refresh','soft')):resource.phase==='loading'||resource.phase==='idle'?empty('chat','正在同步最近聊天','原有聊天记录会在这里显示'):empty('chat','最近聊天会显示在这里','选一位员工，继续原来的聊天',start);
  return `${appHeader(state,'聊天','接着上次的话题，继续一起工作',`<button class="icon-button new-chat-button" data-action="navigate" data-tab="employees" aria-label="发起聊天">${icon('plus')}</button>`)}<main class="page-content chats-home">${alerts(state)}${notice}${chatPreferencesNotice(state)}<div class="mobile-shortcuts"><button data-action="report-setup">${icon('report')}<span><strong>汇报</strong><small>逐个听员工汇报，继续追问</small></span>${icon('chevron')}</button><button data-action="groups-open">${icon('employees')}<span><strong>员工群组</strong><small>和多位员工一起协作</small></span>${icon('chevron')}</button><button data-action="notifications-open">${icon('clock')}<span><strong>最近提醒</strong><small>查看执行结果与待处理事项</small></span>${icon('chevron')}</button></div><label class="search-box">${icon('search')}<input type="search" name="chatSearch" value="${e(state.chatSearch || '')}" placeholder="搜索最近聊天" aria-label="搜索最近聊天" autocomplete="off"></label><div class="thread-list" aria-label="最近聊天">${threads.length?threads.map(thread=>threadRow(state,thread)).join(''):noRows}</div></main>`;
}
function chatPreferencesNotice(state) {
  return state.chatPreferencesError?`<div class="banner error" role="alert">${icon('alert')}<span>本机草稿与置顶：${e(state.chatPreferencesError)}</span></div>`:'';
}
function searchExcerpt(result) {
  const text=String(result.excerpt||'');let end=0,html='';
  for(const range of rows(result.ranges)) {
    if(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<end||range.end>text.length||range.end<=range.start)continue;
    html+=e(text.slice(end,range.start))+`<mark>${e(text.slice(range.start,range.end))}</mark>`;end=range.end;
  }
  return `${result.leadingEllipsis?'…':''}${html}${e(text.slice(end))}${result.trailingEllipsis?'…':''}`;
}
function chatFindPanel(state) {
  if(!state.chatFind)return '';
  const found=searchChatMessages(state.messages,state.chatFind.query);
  const message=found.queryTooLong?'最多输入200个字':!found.query?'输入文字查找这段聊天':found.total?`${found.total} 条相关消息${found.hasMore?'，先显示前100条':''}`:'没有找到相关消息';
  return `<section class="chat-find-panel" aria-label="聊天内查找"><div class="chat-find-input"><label>${icon('search')}<input type="search" name="chatFind" value="${e(state.chatFind.query)}" maxlength="400" placeholder="查找消息文字" aria-label="查找消息文字" autocomplete="off"></label><button type="button" class="icon-button" data-action="chat-find-close" aria-label="关闭聊天查找">${icon('close')}</button></div><p class="chat-find-summary" role="status">${e(message)} · 当前聊天已加载记录</p>${found.results.length?`<div class="chat-find-results">${found.results.map(item=>`<button type="button" data-action="chat-find-result" data-id="${e(item.messageId)}"><small>${item.source==='forward'?'转发的聊天记录':item.role==='user'?'我的消息':'员工消息'}</small><span>${searchExcerpt(item)}</span></button>`).join('')}</div>`:''}</section>`;
}
function employeesPage(state) {
  const all=rows(state.employees), filter=state.filter || 'all', search=String(state.search || '').toLowerCase();
  const employees=all.filter(employee=>{
    const s=statusOf(botFor(state,employee));
    return (filter==='all' || (filter==='running' ? s.tone==='running' : ['warning','error'].includes(s.tone))) && `${nameOf(employee)} ${subtitle(employee)}`.toLowerCase().includes(search);
  });
  const noRows=all.length ? empty('employees',search?'没有找到这位员工':'这里暂时没有员工',search?'试试其他名称':'有新的状态会自动同步') : resourceEmpty(state,'employees','employees','员工列表','还没有数字员工','在电脑端添加员工后，这里会同步显示',actionButton('settings','管理与设置','settings','text-button'));
  return `${appHeader(state,'我的员工',all.length ? `${all.length} 位伙伴，随时交给他们` : '你的工作伙伴都在这里')}<main class="page-content employee-home">${alerts(state)}${resourceNotice(state,'employees','员工列表')}${all.length?resourceNotice(state,'bots','员工运行状态'):''}<button class="report-entry" data-action="report-setup"><span class="report-entry-icon">${icon('report')}</span><span class="report-entry-copy"><strong>听汇报</strong><small>召集员工，一个一个聊</small></span><span class="report-entry-arrow">${icon('arrow')}</span><span class="report-orbit" aria-hidden="true"></span></button><label class="search-box">${icon('search')}<input type="search" name="search" value="${e(state.search || '')}" placeholder="搜索员工" aria-label="搜索员工" autocomplete="off"></label><div class="segmented" role="group" aria-label="员工筛选">${[['all','全部'],['running','工作中'],['attention','待处理']].map(([key,label])=>`<button data-action="filter" data-filter="${key}" class="${filter===key?'active':''}" aria-pressed="${filter===key}">${label}${key==='all'?`<span>${all.length}</span>`:''}</button>`).join('')}</div><div class="employee-list">${employees.length ? employees.map(employee=>employeeCard(state,employee)).join('') : noRows}</div><p class="page-footnote">${icon('link')}与电脑端共用同一工作区</p></main>`;
}
function employeeCard(state, employee) {
  const status=statusOf(botFor(state,employee));
  return `<article class="employee-card contact-card"><button class="employee-identity" data-action="chat" data-id="${e(employee.id)}" aria-label="打开聊天：${e(nameOf(employee))}">${avatar(employee,'contact-avatar')}<span class="employee-card-copy"><span class="employee-title-line"><strong>${e(nameOf(employee))}</strong>${badge(status)}</span><span class="employee-description">${e(subtitle(employee))}</span></span></button><button class="icon-button contact-detail" data-action="employee-detail" data-id="${e(employee.id)}" aria-label="查看${e(nameOf(employee))}的详情">${icon('chevron')}</button></article>`;
}

const statusLabels={planned:'已计划',review:'待审核',pending:'等待执行',queued:'等待执行',acked:'执行中',running:'执行中',executing:'执行中',succeeded:'已完成',completed:'已完成',done:'已完成',failed:'执行失败',expired:'已过期',uncertain:'待核实',cancelled:'已取消',stopped:'已停止',blocked:'有阻碍',in_progress:'进行中',todo:'待开始',active:'已启用',paused:'已暂停',delivered:'已送达',acknowledged:'已确认'};
function workStatus(status) { return {label:statusLabels[status] || status || '状态待确认',tone:['pending','queued','acked','running','executing','in_progress','delivered'].includes(status)?'running':['succeeded','completed','done'].includes(status)?'success':['failed','expired'].includes(status)?'error':['blocked','uncertain'].includes(status)?'warning':'muted'}; }
function taskCard(task, state) {
  const employee=rows(state.employees).find(item=>item.id===(task.employee_id || task.employeeId || task.assignee_id || task.assignee) || item.name===task.assignee);
  return `<button class="task-card" data-action="task" data-id="${e(task.id)}"><span class="task-status-icon ${workStatus(task.state || task.status).tone}">${icon(['completed','succeeded','done'].includes(task.state || task.status)?'check':(task.state || task.status)==='blocked'?'alert':'work')}</span><span class="task-card-copy"><span class="task-title-line"><strong>${e(task.title || task.name || '工作任务')}</strong>${badge(workStatus(task.state || task.status))}</span>${task.description ? `<span class="task-description">${e(task.description)}</span>`:''}<span class="task-meta">${employee?`${e(nameOf(employee))}<span>·</span>`:''}${shortTime(task.updated_at || task.updatedAt || task.created_at || task.createdAt)}</span></span>${icon('chevron')}</button>`;
}
function workPage(state) {
  const all=rows(state.tasks), tasks=filterMobileTasks(all,state.taskFilter), running=all.filter(task=>['running','in_progress','pending','queued','acked'].includes(task.state || task.status)).length, done=all.filter(task=>['succeeded','completed','done'].includes(task.state || task.status)).length;
  return `${appHeader(state,'工作进度','每一件事，都有回音',actionButton('mobile-task-new','记待办','plus','soft'))}<main class="page-content">${alerts(state)}${resourceNotice(state,'tasks','工作任务')}<div class="stats-row"><div><span class="stat-dot violet"></span><strong>${running}</strong><span>进行中</span></div><div><span class="stat-dot green"></span><strong>${done}</strong><span>已完成</span></div><div><span class="stat-dot gray"></span><strong>${all.length}</strong><span>全部工作</span></div></div>${renderMobileTaskFilters(state)}${sectionTitle('工作任务',`<span class="section-count">${tasks.length} 项</span>`)}<div class="task-list">${tasks.length ? tasks.map(task=>taskCard(task,state)).join('') : all.length?empty('work','这个分类还没有工作','可以切换分类查看其他工作'):resourceEmpty(state,'tasks','work','工作任务','暂无工作任务','员工的任务与执行结果会同步到这里')}</div></main>`;
}
function taskPage(state) {
  const task=state.task || rows(state.tasks).find(row=>row.id===state.selectedTaskId);
  if (!task) return `${pageHeader(state,'工作详情')}<main class="page-content">${alerts(state)}${empty('work','暂未加载工作详情','返回后刷新工作列表')}</main>`;
  const currentState=task.state || task.status || 'planned';
  const transitions={planned:['todo','blocked','cancelled'],todo:['in_progress','blocked','cancelled'],in_progress:['review','blocked','cancelled'],review:['completed','in_progress','blocked','cancelled'],completed:[],blocked:['todo','in_progress','cancelled'],cancelled:[]};
  const statuses=[currentState,...(transitions[currentState] || [])];
  return `${pageHeader(state,'工作详情')}<main class="page-content">${alerts(state)}<div class="task-detail-heading">${badge(workStatus(task.state || task.status))}<h2>${e(task.title || task.name || '工作任务')}</h2><p>${shortTime(task.updated_at || task.updatedAt || task.created_at)}</p></div><form class="panel form-panel" data-form="task"><label class="field-label">工作名称<input name="title" value="${e(task.title || task.name || '')}" maxlength="200" required></label><label class="field-label">工作说明<textarea name="description" rows="6">${e(task.description || '')}</textarea></label><label class="field-label">当前状态<select name="status">${statuses.map(status=>`<option value="${e(status)}" ${status===(task.state || task.status)?'selected':''}>${e(statusLabels[status] || status)}</option>`).join('')}</select></label><button class="button primary full" type="submit"${disabled(state)}>${icon('check')}保存修改</button></form>${task.result ? `<section class="panel result-panel"><h3>最近结果</h3><div class="prose">${e(typeof task.result==='string'?task.result:task.result.summary || task.result.message || '')}</div></section>`:''}</main>`;
}

function activeRun(state) {
  const running=run=>run && (['pending','queued','acked','running','executing'].includes(run.status) || executionUncertain(run));
  return (running(state.conversation?.execution) ? state.conversation.execution : null) || rows(state.runs).find(running) || (running(state.bot?.latest_run) ? state.bot.latest_run : null);
}
function runPanel(state) {
  const run=activeRun(state);
  if (!run) return '';
  const employee=state.selectedEmployee, bot=state.bot || employee?.bot || rows(state.bots).find(item=>item.id===employee?.id);
  const events=rows(run.events), event=events[events.length-1], uncertain=executionUncertain(run);
  const stopping=bot?.stop_action?.payload?.actionId===run.id, stop=stopping ? botStopPresentation(bot,run) : null;
  const description=stop?.label || event?.message || event?.data?.message || run.summary || (uncertain?'原执行结果需要核实':workStatus(run.status).label);
  return `<div class="run-panel ${uncertain?'uncertain':''}" role="status"><span class="activity-pulse"></span><div><strong>${e(uncertain?'执行待核实':workStatus(run.status).label)}</strong><span class="${stopping?'stop-detail':''}">${e(description)}</span></div>${bot?.configuration_state==='initialized'&&employee?.id?`<button class="button danger-quiet" data-action="stop-run" data-id="${e(employee.id)}" ${stopping?'disabled':disabled(state)}>${icon('stop')}${state.stopBusy?'提交中':'停止'}</button>`:''}</div>`;
}
function imageAttachment(attachment) {
  const item=typeof attachment==='string'?{url:attachment}:attachment || {};
  let source=safeImage(item.url || item.dataUrl || item.data_url || item.src || item.preview || item.previewUrl || item.download_url || item.downloadUrl);
  if(!source && item.data && item.mime) source=safeImage(`data:${item.mime};base64,${item.data}`);
  if(!source && item.content && item.mimeType && item.contentEncoding==='base64') source=safeImage(`data:${item.mimeType};base64,${item.content}`);
  return source ? `<button class="message-image" data-action="image" data-src="${e(source)}" aria-label="放大图片"><img src="${e(source)}" alt="${e(item.name || item.filename || '聊天图片')}" loading="lazy"></button>` : `<span class="attachment-file">${icon('image')}${e(item.name || item.filename || '图片附件')}</span>`;
}
function forwardRecord(message) {
  const record=message?.forward;
  return record?.schemaVersion===1&&Array.isArray(record.messages)?record:null;
}
function forwardPreview(message) {
  const text=messageText(message).trim();
  return text?text.slice(0,180):rows(message.attachments).length?'[图片]':'[消息]';
}
function forwardRecordCard(message) {
  const record=forwardRecord(message);
  if(!record)return '';
  return `${record.note?`<div class="prose forward-note">${e(record.note)}</div>`:''}<button type="button" class="forward-record-card" data-action="forward-detail" data-id="${e(message.id)}" aria-label="查看转发的聊天记录"><strong>${e(record.source?.employeeName || '员工')}的聊天记录</strong><span class="forward-record-preview">${rows(record.messages).slice(0,3).map(item=>`<span>${e(item.senderName || '消息')}：${e(forwardPreview(item))}</span>`).join('')}</span><span class="forward-record-footer">${icon('chat')}聊天记录 · ${record.messages.length} 条<span>${icon('chevron')}</span></span></button>`;
}
function messageCard(message, employee, state=null, allowForward=false) {
  const outgoing=['user','human'].includes(message.role || message.sender_role || message.senderRole) || message.type==='user';
  const system=['system','tool'].includes(message.role);
  const stableId=typeof message.id==='string'?message.id.trim():'';
  const record=forwardRecord(message),content=record?'':messageText(message) || '', attachments=record?[]:rows(message.attachments || message.images || message.metadata?.attachments);
  if(system) return `<div class="system-message"${message.role==='system'&&stableId?` data-message-id="${e(stableId)}"`:''}>${e(content)}</div>`;
  const forwardable=allowForward&&isForwardableMessage(message),selecting=state?.forward?.phase==='select';
  const selected=selecting&&rows(state.forward.selectedIds).includes(String(message.id || '').trim());
  const messageClasses=['message',outgoing?'outgoing':'incoming',forwardable&&selecting?'forward-selectable':'',selected?'forward-selected':'',state?.chatJump?.messageId===stableId?'search-match':''].filter(Boolean).join(' ');
  return `<article class="${messageClasses}"${stableId?` data-message-id="${e(stableId)}"`:''}>${forwardable&&selecting?`<button type="button" class="message-select" data-action="forward-toggle" data-id="${e(stableId)}" aria-label="${selected?'取消选择':'选择'}这条消息" aria-pressed="${selected}">${selected?icon('check'):''}</button>`:''}${outgoing?'':avatar(employee,'message-avatar')}<div class="message-body"><div class="message-bubble"${forwardable?` data-forwardable-message="${e(stableId)}"`:''}>${content ? `<div class="prose">${e(content)}</div>`:''}${forwardRecordCard(message)}${attachments.length?`<div class="message-images ${attachments.length>1?'multiple':''}">${attachments.map(imageAttachment).join('')}</div>`:''}${!content&&!attachments.length&&!record?'<span class="muted">消息内容为空</span>':''}</div><div class="message-meta"><span class="message-time">${shortTime(message.created_at || message.createdAt || message.timestamp)}${message.status==='failed'?' · 未发送':message.status==='sending'?' · 发送中':''}</span>${forwardable&&!selecting?`<button type="button" class="message-menu-button" data-action="message-menu" data-id="${e(stableId)}" aria-label="消息操作">${icon('more')}<span>消息操作</span></button>`:''}</div></div></article>`;
}
function composer(state, report=false) {
  const entry=rows(state.report?.queue)[state.report?.index || 0];
  const waiting=report ? !['completed','no_records','skipped','failed'].includes(entry?.status) : Boolean(activeRun(state));
  const sendUnavailable=waiting || !report && !state.conversation?.id;
  return `<div class="composer-area">${runPanel(state)}${rows(state.attachments).length?`<div class="draft-attachments">${state.attachments.map((attachment,index)=>`<div class="draft-attachment">${imageAttachment(attachment)}<button data-action="remove-attachment" data-id="${index}" class="remove-image" aria-label="移除第${index+1}张图片">${icon('close')}</button></div>`).join('')}</div>`:''}<form class="composer" data-form="chat"><label class="attach-button" aria-label="添加图片">${icon('attach')}<input type="file" name="images" accept="image/png,image/jpeg,image/webp,image/gif" multiple${disabled(state)}></label><textarea name="draft" rows="1" placeholder="${waiting?(report?'等待汇报结束，可先写下追问…':'工作进行中，可先写下下一条…'):report?'追问这位员工…':'继续交给他…'}" aria-label="聊天消息" maxlength="50000">${e(state.draft || '')}</textarea><button class="send-button" type="submit" aria-label="发送消息"${sendUnavailable?' disabled':disabled(state)}>${state.sending?'<span class="spinner small"></span>':icon('send')}</button></form></div>`;
}
function chatPage(state) {
  const employee=state.selectedEmployee || state.bot?.employee || state.bot || {}, status=statusOf(state.bot || {...employee,execution:state.conversation?.execution});
  const extra=`<div class="chat-header-actions"><button type="button" class="icon-button" data-action="chat-find-open" aria-label="查找聊天记录"${state.conversation?.id?'':' disabled'}>${icon('search')}</button><button class="icon-button" data-action="employee-detail" data-id="${e(employee.id || state.bot?.id)}" aria-label="员工详情">${icon('more')}</button></div>`;
  const history=rows(state.messages).length ? `<div class="conversation-start">${icon('link')}长期聊天 · 与电脑端同步</div>${state.messages.map(message=>messageCard(message,employee,state,true)).join('')}` : state.chatLoading ? '<div class="empty-state" role="status"><span class="spinner"></span><h3>正在读取原聊天记录</h3><p>稍等，正在与电脑端同步</p></div>' : !state.conversation?.id ? empty('alert','聊天记录暂未加载','请重新读取原聊天记录',actionButton('refresh','重新加载','refresh','soft')) : empty('chat',`和${nameOf(employee)}聊聊`,'交代一件事，或发送图片一起看');
  return `${pageHeader(state,nameOf(employee),status.label,extra,employee)}<main class="chat-main">${alerts(state)}${employeeReadNotices(state,true)}${chatPreferencesNotice(state)}${chatFindPanel(state)}<div class="chat-history chat-timeline" data-chat-scroll>${history}<div data-chat-end></div></div></main>${state.forward?.phase==='select'?forwardSelectionBar(state):composer(state)}`;
}
function forwardSelectionBar(state) {
  const selected=orderedForwardMessages(state.messages,state.forward?.selectedIds);
  return `<div class="forward-selection-bar">${state.forward?.error?`<p class="forward-error" role="alert">${e(state.forward.error)}</p>`:''}<div><button type="button" class="text-button" data-action="forward-cancel">取消</button><span>已选 <strong>${selected.length}</strong> / ${FORWARD_MESSAGE_LIMIT} 条</span><button type="button" class="button primary" data-action="forward-next"${selected.length?'':' disabled'}>转发${icon('arrow')}</button></div></div>`;
}
function selectedForwardPreview(state) {
  const selected=orderedForwardMessages(state.messages,state.forward?.selectedIds);
  return `<div class="forward-selection-preview"><strong>${rows(state.forward?.selectedIds).length} 条聊天记录</strong>${selected.slice(0,2).map(message=>`<p>${e(forwardPreview(message))}</p>`).join('')}${selected.length>2?`<small>另有 ${selected.length-2} 条</small>`:''}</div>`;
}
function forwardingOverlay(state) {
  const data=state.forward;
  if(state.page!=='chat'||!data||data.phase==='select')return '';
  const phase=data.phase,target=rows(state.employees).find(employee=>employee.id===data.targetEmployeeId),submitting=phase==='submitting';
  const titles={menu:'消息操作',target:'转发给',confirm:'转发聊天记录',submitting:'正在转发',uncertain:'转发回执待确认',complete:'转发已送达'};
  let body='';
  if(phase==='menu')body=`${selectedForwardPreview(state)}<div class="forward-menu-actions"><button type="button" data-action="forward-single">${icon('arrow')}<span>转发</span>${icon('chevron')}</button><button type="button" data-action="forward-select">${icon('check')}<span>多选消息</span>${icon('chevron')}</button></div>`;
  else if(phase==='target') {
    const targets=rows(state.employees).filter(employee=>employee.id&&employee.id!==data.sourceEmployeeId);
    body=`${selectedForwardPreview(state)}<p class="forward-hint">选择同一工作区里的另一位员工</p><div class="forward-target-list">${targets.length?targets.map(employee=>`<button type="button" data-action="forward-target" data-id="${e(employee.id)}">${avatar(employee,'medium')}<span><strong>${e(nameOf(employee))}</strong><small>${e(subtitle(employee))}</small></span>${icon('chevron')}</button>`).join(''):empty('employees','暂无其他员工','当前工作区至少需要两位员工才能转发')}</div>`;
  } else if(phase==='complete')body=`<div class="forward-complete"><span>${icon('check')}</span><h3>已转发给${e(nameOf(target))}</h3><p>${data.mode==='execute'?'聊天记录已送达，并已提交处理请求':'聊天记录已保存，未发起执行'}</p></div><div class="forward-complete-actions">${actionButton('forward-open-target','查看目标聊天','chat','primary full')}${actionButton('forward-cancel','继续当前聊天','','secondary full')}</div>`;
  else if(['confirm','submitting','uncertain'].includes(phase)) {
    body=`<div class="forward-recipient">${avatar(target || {},'medium')}<span><small>转发给</small><strong>${e(nameOf(target))}</strong></span>${submitting||phase==='uncertain'?'':`<button type="button" class="text-button" data-action="forward-back">更换</button>`}</div>${selectedForwardPreview(state)}${phase==='uncertain'?`<div class="forward-uncertain" role="status">${icon('clock')}<p>还未确认是否送达。重试会沿用同一次转发标识，核对这次请求的结果。</p></div><div class="forward-complete-actions">${actionButton('forward-retry','重试同一请求','refresh','primary full')}${actionButton('forward-cancel','关闭','','secondary full')}</div>`:`<form data-form="forward" class="forward-form" data-state-fields><input type="hidden" name="targetEmployeeId" value="${e(data.targetEmployeeId)}"><label class="field-label">附言<textarea name="forward-note" rows="3" maxlength="${FORWARD_NOTE_LIMIT}" placeholder="可以补充背景，或交代希望他处理什么"${submitting?' disabled':''}>${e(data.note || '')}</textarea></label><fieldset class="forward-mode-list"${submitting?' disabled':''}><legend>转发方式</legend><label class="forward-mode ${data.mode!=='execute'?'selected':''}"><input type="radio" name="forward-mode" value="reference" ${data.mode!=='execute'?'checked':''}><span><strong>仅转发记录</strong><small>保存到对方聊天，不启动员工执行</small></span></label><label class="forward-mode ${data.mode==='execute'?'selected':''}"><input type="radio" name="forward-mode" value="execute" ${data.mode==='execute'?'checked':''}><span><strong>转发并请他处理</strong><small>将记录和附言交给员工继续处理</small></span></label></fieldset><button type="submit" class="button primary full large"${submitting?' disabled':''}>${submitting?'<span class="spinner small"></span>正在转发…':data.mode==='execute'?'转发并请他处理':'仅转发记录'}</button></form>`}`;
  }
  if(!body)return '';
  return `<div class="forward-overlay"><button type="button" class="forward-backdrop" data-action="forward-cancel" aria-label="关闭转发面板"${submitting?' disabled':''}></button><section class="forward-sheet" role="dialog" aria-modal="true" aria-labelledby="forward-sheet-title"><header><h2 id="forward-sheet-title">${e(titles[phase] || '转发聊天记录')}</h2><button type="button" class="icon-button" data-action="forward-cancel" aria-label="关闭转发面板"${submitting?' disabled':''}>${icon('close')}</button></header><div class="forward-sheet-body">${data.error?`<p class="forward-error" role="alert">${e(data.error)}</p>`:''}${body}</div></section></div>`;
}
function forwardDetailOverlay(state) {
  const messageId=state.forwardDetail?.messageId;
  if(!messageId)return '';
  const message=rows(state.messages).find(item=>item.id===messageId),record=forwardRecord(message);
  return `<div class="forward-overlay forward-detail-overlay"><button type="button" class="forward-backdrop" data-action="forward-detail-close" aria-label="关闭聊天记录"></button><section class="forward-sheet forward-record-detail" role="dialog" aria-modal="true" aria-labelledby="forward-detail-title"><header><div><h2 id="forward-detail-title">聊天记录</h2>${record?.source?.employeeName?`<p>来自${e(record.source.employeeName)}</p>`:''}</div><button type="button" class="icon-button" data-action="forward-detail-close" aria-label="关闭聊天记录">${icon('close')}</button></header><div class="forward-detail-messages">${record?record.messages.map((item,index)=>`<article class="forward-snapshot-message${state.chatJump?.messageId===messageId&&state.chatJump?.quoteIndex===index?' search-match':''}" data-search-quote-index="${index}"><div><strong>${e(item.senderName || '消息')}</strong><span>${shortTime(item.createdAt)}</span></div>${item.content?`<div class="prose">${e(item.content)}</div>`:''}${rows(item.attachments).length?`<div class="message-images ${item.attachments.length>1?'multiple':''}">${item.attachments.map(imageAttachment).join('')}</div>`:''}</article>`).join(''):empty('chat','这段记录暂未加载','关闭后刷新当前聊天重试')}</div></section></div>`;
}

function detailPage(state) {
  const employee=state.selectedEmployee || state.bot?.employee || state.bot || {}, bot=state.bot || botFor(state,employee), status=statusOf(bot), run=bot?.latest_run;
  return `${pageHeader(state,'员工详情','',`<button class="icon-button" data-action="refresh" aria-label="刷新员工状态"${disabled(state)}>${icon('refresh')}</button>`)}<main class="page-content detail-content">${alerts(state)}${employeeReadNotices(state)}<section class="employee-profile">${avatar(state.employeeAvatar===undefined?employee:{...employee,avatar:state.employeeAvatar,employee:employee.employee?{...employee.employee,avatar:state.employeeAvatar}:undefined},'profile',true)}<h2>${e(nameOf(employee))}</h2><p>${e(subtitle(employee))}</p>${badge(status)}<div class="profile-action">${actionButton('chat','打开长期聊天','chat','primary full',`data-id="${e(employee.id || bot.id)}"`)}</div></section>${runPanel(state)}<details class="panel edit-panel"><summary>${icon('edit')}<span>编辑员工资料</span>${icon('down')}</summary><form data-form="employee" class="form-panel"><label class="field-label">名称<input name="name" value="${e(nameOf(employee))}" maxlength="100" required></label><label class="field-label">岗位 / 简介<textarea name="description" rows="2" maxlength="1000">${e(employee.description || employee.employee?.description || '')}</textarea></label><label class="avatar-upload"><span>${icon('image')}${state.attachmentReading?'正在读取头像…':state.employeeAvatar!==undefined?'头像已选择 · 待保存':'更换头像'}</span><input type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif"></label><button class="button primary full" type="submit"${disabled(state)}>保存资料</button></form></details>${sectionTitle('例行工作',`<span class="section-count">${rows(state.routines).length} 项</span>`)}<div class="routine-list">${rows(state.routines).length?state.routines.map(routine=>routineCard(routine,state)).join(''):empty('clock','还没有例行工作','设定后，结果会回到长期聊天')}<details class="panel new-routine"><summary>${icon('plus')}<span>添加例行工作</span></summary><form class="form-panel" data-form="routine"><label class="field-label">工作名称<input name="name" required maxlength="100" placeholder="例如：每天整理行业动态"></label><label class="field-label">执行计划<input name="schedule" required placeholder="每天 09:00 / 五段 Cron"></label><label class="field-label">时区<input name="timezone" value="Asia/Shanghai" required></label><label class="field-label">工作内容<textarea name="prompt" rows="4" placeholder="希望他定期完成什么？" required></textarea></label><button type="submit" class="button primary full"${disabled(state)}>保存例行工作</button></form></details></div>${sectionTitle('最近执行')}<div class="panel run-history">${rows(state.runs).length?state.runs.slice(0,5).map(item=>`<details class="run-row"><summary><span>${badge(workStatus(item.status))}<small>${shortTime(item.created_at || item.createdAt)}</small></span>${icon('down')}</summary><div class="run-content">${e(item.result?.summary || item.result?.message || item.error || item.prompt || '暂无详细结果')}<small>执行编号 ${e(item.id)}</small></div></details>`).join(''):empty('work','暂无执行记录')}${run&&!rows(state.runs).some(item=>item.id===run.id)?`<p class="run-note">最近状态：${e(workStatus(run.status).label)}</p>`:''}</div><button class="settings-link" data-action="bot-settings" data-id="${e(employee.id || bot.id)}">${icon('settings')}<span>模型与能力</span>${icon('chevron')}</button></main>`;
}
function routineCard(routine,state) {
  const active=routine.status==='active';
  return `<article class="panel routine-card"><div class="routine-heading"><span class="routine-icon">${icon('clock')}</span><div><h3>${e(routine.name || '例行工作')}</h3><span>${e(routine.schedule || '计划待返回')}</span></div>${badge({label:active?'已启用':'已暂停',tone:active?'success':'muted'})}</div>${routine.prompt?`<p>${e(routine.prompt)}</p>`:''}<div class="routine-next">下次运行 <span>${shortTime(routine.next_run || routine.nextRun)}</span></div><div class="routine-actions">${actionButton('routine-toggle',active?'暂停计划':'恢复计划',active?'pause':'play','text-button',`data-id="${e(routine.id)}"${disabled(state)}`)}${actionButton('routine-run','立即运行','play','soft',`data-id="${e(routine.id)}"${disabled(state)}`)}</div></article>`;
}

function reportSetupPage(state) {
  const queue=rows(state.report?.queue), selected=queue.map(entry=>String(entry.employeeId));
  return `${pageHeader(state,'听汇报','把伙伴们叫到一起')}<main class="page-content report-setup">${alerts(state)}<div class="report-intro"><span class="report-intro-icon">${icon('report')}</span><h2>今天，进展如何？</h2><p>选好员工，按顺序听他们汇报</p></div>${sectionTitle('选择员工',`<span class="section-count">已选 ${queue.length} 位</span>`)}<div class="panel employee-select-list">${rows(state.employees).length?state.employees.map(employee=>`<button class="employee-select-row ${selected.includes(String(employee.id))?'selected':''}" data-action="report-toggle" data-id="${e(employee.id)}" aria-pressed="${selected.includes(String(employee.id))}"><span class="select-check">${selected.includes(String(employee.id))?icon('check'):''}</span>${avatar(employee,'medium')}<span><strong>${e(nameOf(employee))}</strong><small>${e(subtitle(employee))}</small></span>${selected.includes(String(employee.id))?`<b class="selection-number">${selected.indexOf(String(employee.id))+1}</b>`:''}</button>`).join(''):empty('employees','还没有可汇报的员工','请先在工作区添加数字员工')}</div>${queue.length?`${sectionTitle('汇报顺序','<span class="section-hint">可调整</span>')}<ol class="report-order">${queue.map((entry,index)=>`<li><span class="queue-number">${index+1}</span><strong>${e(entry.name || nameOf(rows(state.employees).find(item=>item.id===entry.employeeId)))}</strong><div class="order-controls"><button class="icon-button" data-action="report-up" data-id="${e(entry.employeeId)}" aria-label="向前移动${e(entry.name)}" ${index===0?'disabled':''}>${icon('up')}</button><button class="icon-button" data-action="report-down" data-id="${e(entry.employeeId)}" aria-label="向后移动${e(entry.name)}" ${index===queue.length-1?'disabled':''}>${icon('down')}</button></div></li>`).join('')}</ol>`:''}<div class="report-truth-note">${icon('shield')}根据实际任务与执行记录汇报</div></main><div class="sticky-action"><button class="button primary full large" data-action="report-start" ${queue.length&&!state.busy?'':'disabled'}>${icon('play')}开始汇报${queue.length?` · ${queue.length} 位员工`:''}</button></div>`;
}
function reportQueue(report) {
  return `<details class="report-queue"><summary><span>${icon('employees')}汇报队列 <b>${Number(report.index || 0)+1} / ${rows(report.queue).length}</b></span>${icon('down')}</summary><ol>${rows(report.queue).map((entry,index)=>`<li class="${index===report.index?'current':''}"><span class="queue-number">${['done','completed','reported'].includes(entry.status)?icon('check'):index+1}</span><span>${e(entry.name || '数字员工')}</span><small>${index===report.index?'正在汇报':['done','completed','reported'].includes(entry.status)?'已汇报':entry.status==='skipped'?'稍后再听':'待汇报'}</small></li>`).join('')}</ol></details>`;
}
function reportSources(sources) {
  if(!rows(sources).length) return '';
  return `<details class="report-sources"><summary>${icon('link')}汇报依据 · ${sources.length} 条${icon('down')}</summary><ul>${sources.map(source=>`<li><span>${e(source.title || source.name || source.kind || '执行记录')}</span>${source.status?`<small>${e(statusLabels[source.status] || source.status)}</small>`:''}</li>`).join('')}</ul></details>`;
}
function reportPage(state) {
  const report=state.report || {}, entry=rows(report.queue)[report.index || 0];
  if(!entry) return `${pageHeader(state,'听汇报')}<main class="page-content">${alerts(state)}${empty('report','暂未选择汇报员工','返回后选择需要召集的员工')}</main>`;
  const employee=rows(state.employees).find(item=>item.id===entry.employeeId) || state.selectedEmployee || {name:entry.name}, messages=rows(state.messages), last=(report.index || 0)>=rows(report.queue).length-1;
  const reportStatus={loading:['正在整理汇报','running'],pending:['等待汇报','muted'],sending:['正在发起汇报','running'],waiting:['等待员工回执','running'],completed:['汇报已收到','success'],no_records:['暂无记录','muted'],failed:['汇报遇到问题','error'],uncertain:['执行待核实','warning'],delivery_unknown:['请求回执待确认','warning'],skipped:['稍后再听','muted']}[entry.status] || ['状态待确认','muted'];
  const terminal=['completed','no_records','skipped','failed'].includes(entry.status);
  return `${pageHeader(state,'听汇报',`第 ${(report.index || 0)+1} 位 · 共 ${rows(report.queue).length} 位`, `<button class="text-button compact" data-action="report-finish"${disabled(state)}>结束</button>`)}<main class="chat-main report-main">${alerts(state)}${reportQueue(report)}<div class="report-speaker">${avatar(employee,'large')}<div><h2>${e(entry.name || nameOf(employee))}</h2><p>${e(subtitle(employee))}</p>${badge({label:reportStatus[0],tone:reportStatus[1]})}</div></div><div class="chat-history chat-timeline report-chat" data-chat-scroll>${messages.length?messages.map(message=>messageCard(message,employee)).join(''):entry.reportText?`<article class="message incoming"><div class="message-body"><div class="message-bubble"><div class="prose">${e(entry.reportText)}</div></div></div></article>`:empty('report',state.busy?'正在整理真实进展':'等待员工汇报',state.busy?'稍等，正在读取任务和执行记录':'暂无可展示的汇报内容')}${entry.error?`<div class="report-entry-error">${icon('alert')}<span>${e(entry.error)}</span></div>`:''}${reportSources(entry.sources)}<div data-chat-end></div></div></main><div class="report-next-bar"><button class="text-button" data-action="report-skip"${disabled(state)}>稍后再听</button><button class="button soft" data-action="report-next"${!terminal?' disabled':disabled(state)}>${last?'查看汇总':'下一位'}${icon('arrow')}</button></div>${composer(state,true)}`;
}
function summaryPage(state) {
  const report=state.report || {}, summary=report.summary || {}, items=rows(summary.items).length?summary.items:rows(report.queue).map(item=>({employeeId:item.employeeId,name:item.name,text:item.reportText,status:item.status,sources:item.sources})), todos=rows(summary.todos);
  return `${pageHeader(state,'本次汇报','',`<button class="text-button compact" data-action="report-home">完成</button>`)}<main class="page-content summary-content">${alerts(state)}<div class="summary-hero"><span>${icon('check')}</span><h2>汇报已整理</h2><p>${items.length} 位员工 · ${shortTime(report.finishedAt || report.startedAt)}</p></div>${sectionTitle('逐位回顾')}<div class="summary-list">${items.length?items.map(item=>`<article class="panel summary-card"><div class="summary-card-head">${avatar(rows(state.employees).find(employee=>employee.id===item.employeeId) || {name:item.name},'small')}<h3>${e(item.name || '数字员工')}</h3>${item.status==='skipped'?'<span class="badge muted">稍后再听</span>':''}</div><div class="prose">${e(item.text || (item.status==='skipped'?'本次暂未听取汇报':'暂无可核实的汇报记录'))}</div>${reportSources(item.sources)}</article>`).join(''):empty('report','本次暂无汇报记录')}</div>${sectionTitle('待办事项',`<span class="section-count">${todos.length} 项</span>`)}<div class="panel summary-todos">${todos.length?todos.map((todo,index)=>`<div class="summary-todo"><span class="todo-square"></span><div><p>${e(typeof todo==='string'?todo:todo.text || todo.title || '')}</p>${todo.employeeId?`<small>${e(nameOf(rows(state.employees).find(employee=>employee.id===todo.employeeId)))}</small>`:''}</div><button class="todo-create" data-action="report-todo" data-id="${index}" ${todo.taskId || todo.status==='created'?'disabled':''}>${todo.taskId || todo.status==='created'?'已加入':'加入工作'}</button></div>`).join(''):'<p class="empty-inline">本次没有提取到明确待办</p>'}</div><p class="page-footnote">${icon('shield')}汇报与追问保留在员工长期聊天中</p></main><div class="sticky-action">${actionButton('report-new','再听一轮','report','secondary full')}${actionButton('report-home','返回员工首页','employees','primary full large')}</div>`;
}

function phoneState(phone) {
  const nodes=rows(phone.nodes), active=nodes.find(node=>node.role===(phone.control?.role || 'agent')), online=nodes.some(node=>node.status==='online') || phone.status==='online';
  return {online, actionable:Boolean(active?.status==='online' && active.health?.accessibility===true && active.health?.screenOn===true && active.health?.locked===false && phone.control?.role && !phone.control?.draining)};
}
function snapshotSource(phone) { const shot=phone?.snapshot || phone?.screenshot; return safeImage(phone?.snapshotUrl || shot?.url || shot?.dataUrl || (shot?.data && shot?.mime?`data:${shot.mime};base64,${shot.data}`:'')); }
function phoneCard(phone,state) {
  const status=phoneState(phone), source=snapshotSource(phone), shot=phone.snapshot || phone.screenshot;
  return `<article class="panel phone-card"><button class="phone-card-heading" data-action="phone" data-id="${e(phone.id)}"><span class="phone-device-icon">${icon('devices')}</span><span><strong>${e(phone.alias || phone.name || '手机')}</strong><small class="${status.online?'online':'muted'}"><i></i>${status.online?'在线':'离线'}</small></span>${status.actionable?'<span class="badge success">可操作</span>':''}${icon('chevron')}</button>${source?`<button class="phone-preview" data-action="phone" data-id="${e(phone.id)}" aria-label="查看${e(phone.alias || '手机')}画面"><img src="${e(source)}" alt="${e(phone.alias || '手机')}最近回传的截图" loading="lazy"><span class="snapshot-time">${icon('clock')}${shot?.capturedAt?`拍摄于 ${shortTime(shot.capturedAt)}`:'截图时间未返回'}</span></button>`:`<button class="phone-no-preview" data-action="phone" data-id="${e(phone.id)}">${icon('image')}<span>尚未收到截图</span><small>进入设备查看真实画面</small></button>`}<div class="phone-card-actions">${actionButton('phone','查看屏幕','expand','primary',`data-id="${e(phone.id)}"`)}${actionButton('phone-refresh','获取截图','image','soft',`data-id="${e(phone.id)}"${disabled(state)}`)}</div></article>`;
}
function devicesPage(state) {
  return `${appHeader(state,'设备互联','工作发生在哪里，都看得见')}<main class="page-content">${alerts(state)}${resourceNotice(state,'phones','手机列表')}${sectionTitle('手机',`<span class="section-count">${rows(state.phones).length} 台</span>`)}<div class="phone-list">${rows(state.phones).length?state.phones.map(phone=>phoneCard(phone,state)).join(''):resourceEmpty(state,'phones','devices','手机列表','暂无已连接的手机','完成手机绑定后，这里会同步显示')}</div>${resourceNotice(state,'devices','运行电脑')}${sectionTitle('运行电脑',`<span class="section-count">${rows(state.devices).length} 台</span>`)}<div class="computer-list">${rows(state.devices).length?state.devices.map(device=>`<article class="panel computer-row"><span class="computer-icon">${icon('computer')}</span><div><strong>${e(device.name || device.alias || device.hostname || '运行电脑')}</strong><small>${e(device.platform || device.os || '')}${device.last_seen || device.lastSeen?` · ${shortTime(device.last_seen || device.lastSeen)}`:''}</small></div>${badge({label:device.status==='online'?'在线':device.status==='offline'?'离线':'状态待确认',tone:device.status==='online'?'success':'muted'})}</article>`).join(''):resourceEmpty(state,'devices','computer','运行电脑','暂无运行电脑','员工会在已绑定的常开电脑上执行工作')}</div><button class="settings-link" data-action="device-settings">${icon('settings')}<span>设备绑定与授权</span>${icon('chevron')}</button></main>`;
}
function phonePage(state) {
  const phone=state.phone;
  if(!phone) return `${pageHeader(state,'手机画面')}<main class="page-content">${alerts(state)}${empty('devices','暂未加载手机信息','返回后刷新设备列表')}</main>`;
  const status=phoneState(phone), source=snapshotSource(phone), shot=phone.snapshot || phone.screenshot, terminal=rows(state.devices).find(device=>device.id===phone.terminalId);
  const pending=rows(phone.commands).filter(command=>['queued','delivered','executing'].includes(command.status));
  return `${pageHeader(state,phone.alias || phone.name || '手机画面',status.online?'在线':'离线',`<button class="icon-button" data-action="phone-refresh" data-id="${e(phone.id)}" aria-label="获取新截图"${disabled(state)}>${icon('refresh')}</button>`)}<main class="page-content phone-detail">${alerts(state)}${resourceNotice(state,'phones','手机信息')}<div class="phone-live-heading">${badge({label:status.online?'已连接':'当前离线',tone:status.online?'success':'muted'})}${badge({label:status.actionable?'可操作':'控制状态待确认',tone:status.actionable?'success':'muted'})}</div><div class="screen-frame">${source?`<button class="device-screen" data-action="image" data-src="${e(source)}" aria-label="放大手机截图"><img src="${e(source)}" alt="${e(phone.alias || '手机')}最近一次真实截图"><span class="screen-expand">${icon('expand')}</span></button>`:empty('image','尚未收到画面','点击下方按钮获取截图')}</div><p class="capture-caption">${icon('clock')}${shot?.capturedAt?`截图时间 ${shortTime(shot.capturedAt)}`:'暂无截图时间'}${shot?.width&&shot?.height?` · ${Number(shot.width)} × ${Number(shot.height)}`:''}</p><button class="button primary full large" data-action="phone-refresh" data-id="${e(phone.id)}"${disabled(state)}>${icon('image')}${pending.some(command=>command.action==='screenshot')?'正在获取截图…':'获取新截图'}</button><div class="panel device-info"><div><span>运行电脑</span><strong>${e(terminal?.name || terminal?.alias || phone.terminalId || '暂未返回')}</strong></div><div><span>控制端</span><strong>${e(phone.control?.role==='agent'?'紫薇互联':phone.control?.role==='updater'?'更新伙伴':'暂无控制端')}</strong></div>${rows(phone.nodes).map(node=>`<div><span>${e(node.role==='agent'?'紫薇互联':'更新伙伴')}</span><strong class="${node.status==='online'?'online':'muted'}">${e(node.status==='online'?'在线':'离线')}${node.versionName?` · ${e(node.versionName)}`:''}</strong></div>`).join('')}</div>${rows(phone.commands).length?`<details class="panel command-history"><summary>${icon('work')}<span>最近手机操作</span>${icon('down')}</summary><div>${phone.commands.slice(0,5).map(command=>`<div class="command-row"><span><strong>${e({screenshot:'获取截图',tap:'点按屏幕',swipe:'滑动屏幕',text:'输入文字',health:'状态检查',launch:'打开应用',global:'系统操作'}[command.action] || command.action)}</strong><small>${shortTime(command.createdAt)}</small>${command.error?`<p>${e(command.error)}</p>`:''}</span>${badge(workStatus(command.status))}</div>`).join('')}</div></details>`:''}<p class="page-footnote">${icon('chat')}需要操作手机时，可直接交给绑定的员工</p></main>`;
}
function mePage(state) {
  const user=state.user?.user || state.user || {}, username=user.name || user.display_name || user.username || user.email || '我的账号';
  return `${appHeader(state,'我的')}<main class="page-content">${alerts(state)}<section class="account-card"><span class="account-avatar">${e(Array.from(username)[0])}</span><h2>${e(username)}</h2><p>${e(user.email || user.username || '')}</p></section><div class="panel account-menu"><button data-action="switch-workspace"><span class="menu-icon">${icon('employees')}</span><span><strong>当前工作区</strong><small>${e(state.workspace?.name || state.workspace?.slug || '未选择')}</small></span>${icon('chevron')}</button><button data-action="navigate" data-tab="devices"><span class="menu-icon">${icon('devices')}</span><span><strong>设备互联</strong><small>查看手机画面与运行电脑</small></span>${icon('chevron')}</button><button data-action="settings"><span class="menu-icon">${icon('settings')}</span><span><strong>管理与设置</strong><small>模型、能力与设备绑定</small></span>${icon('chevron')}</button></div><div class="app-about"><div class="about-brand"><img src="./ziwei-logo.png" alt="" width="40" height="40">紫薇</div><p>和数字员工，一起把事情做好。</p><small>Android 0.4.0 · 内部测试版</small></div><button class="button logout-button full" data-action="logout"${disabled(state)}>${icon('logout')}退出登录</button></main>`;
}
function settingsPage(state) {
  const employees=rows(state.employees);
  return `${pageHeader(state,'管理与设置')}<main class="page-content settings-content">${alerts(state)}${sectionTitle('员工模型与能力')}<div class="panel account-menu">${employees.length?employees.map(employee=>`<button data-action="bot-settings" data-id="${e(employee.id)}">${avatar(employee,'medium')}<span><strong>${e(nameOf(employee))}</strong><small>${e(employee.runtime || '运行时待确认')}${employee.model_id?` · ${e(employee.model_id)}`:''}</small></span>${icon('chevron')}</button>`).join(''):empty('employees','暂无可配置的员工','员工加入当前工作区后会同步到这里')}</div>${sectionTitle('设备与连接')}<div class="panel account-menu"><button data-action="device-settings"><span class="menu-icon">${icon('devices')}</span><span><strong>设备绑定与授权</strong><small>电脑配对、手机入网与员工关联</small></span>${icon('chevron')}</button><button data-action="switch-workspace"><span class="menu-icon">${icon('employees')}</span><span><strong>切换工作区</strong><small>${e(state.workspace?.name || state.workspace?.slug || '')}</small></span>${icon('chevron')}</button></div></main>`;
}
function loginPage(state) {
  return `<main class="auth-screen"><div class="auth-decoration" aria-hidden="true"><span></span><span></span></div><div class="auth-top"><img class="brand-mark" src="./ziwei-logo.png" alt="" width="64" height="64"><span>紫薇</span></div><div class="auth-content"><p class="eyebrow">YOUR DIGITAL TEAM</p><h1>你的员工，<br>随时在身边。</h1><p class="auth-description">登录原有账号，继续一起工作</p>${alerts(state)}<form class="login-form" data-form="login"><label class="field-label">邮箱<input name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="原账号邮箱" required value="${e(state.loginUsername || '')}"></label><label class="field-label">密码<input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required></label><button type="submit" class="button primary full large"${disabled(state)}>${state.busy?'<span class="spinner small"></span>':'登录'}${state.busy?'正在登录…':icon('arrow')}</button></form><div class="auth-sync">${icon('link')}同一账号 · 同一工作区 · 同一份数据</div></div><p class="auth-footer">紫薇 · 数字员工管理</p></main>`;
}
function workspacePage(state) {
  return `<main class="workspace-screen"><div class="auth-top"><img class="brand-mark" src="./ziwei-logo.png" alt="" width="64" height="64"><span>紫薇</span></div><div class="workspace-welcome"><p class="eyebrow">LET’S GET TO WORK</p><h1>进入你的工作区</h1><p>员工、聊天和工作，都在这里。</p></div>${alerts(state)}<div class="workspace-list">${rows(state.workspaces).length?state.workspaces.map(workspace=>`<button class="workspace-card" data-action="select-workspace" data-id="${e(workspace.slug || workspace.id)}"${disabled(state)}><span class="workspace-avatar">${e(Array.from(workspace.name || workspace.slug || '紫')[0])}</span><span><strong>${e(workspace.name || workspace.slug || '工作区')}</strong>${workspace.description?`<small>${e(workspace.description)}</small>`:''}</span>${icon('arrow')}</button>`).join(''):empty('employees','暂无可用工作区','请在电脑端建立工作区，或联系工作区管理员',actionButton('refresh','重新加载','refresh','soft'))}</div><button class="text-button workspace-logout" data-action="logout">${icon('logout')}切换账号</button></main>`;
}
function imageOverlay(state) {
  const source=safeImage(typeof state.imagePreview==='string'?state.imagePreview:state.imagePreview?.src);
  return source?`<div class="image-overlay" role="dialog" aria-modal="true" aria-label="图片预览"><button class="image-overlay-close" data-action="close-image" aria-label="关闭图片">${icon('close')}</button><img src="${e(source)}" alt="放大预览"><span>双指缩放可查看细节</span></div>`:'';
}

export function render(state) {
  if(!state || state.phase==='boot') return '<main class="boot-screen" aria-live="polite"><img class="brand-mark" src="./ziwei-logo.png" alt="" width="64" height="64"><h1>紫薇</h1><p>正在连接工作区</p><span class="spinner"></span></main>';
  if(state.phase==='login') return loginPage(state);
  if(state.phase==='workspace') return workspacePage(state);
  const page=state.page || 'home', isChat=page==='chat'||page==='report';
  let content;
  if(page==='chat') content=chatPage(state);
  else if(page==='settings') content=settingsPage(state);
  else if(page==='bot-settings') content=renderBotSettings(state,{e,icon,pageHeader,alerts,disabled,sectionTitle,empty,actionButton,nameOf,avatar,badge,workStatus});
  else if(page==='device-settings') content=renderDeviceSettings(state,{e,icon,pageHeader,alerts,disabled,sectionTitle,empty,actionButton,nameOf,avatar,badge,workStatus});
  else if(page==='detail') content=detailPage(state);
  else if(page==='report-setup') content=reportSetupPage(state);
  else if(page==='report') content=reportPage(state);
  else if(page==='report-summary') content=summaryPage(state);
  else if(page==='phone') content=phonePage(state);
  else if(page==='task') content=taskPage(state);
  else if(page==='mobile-task-new') content=renderMobileTaskForm(state);
  else if(page==='groups'||page==='group') content=renderMobileGroups(state,{e,icon,pageHeader});
  else if(page==='notifications') content=renderMobileNotifications(state,{icon,pageHeader});
  else content=state.tab==='chat'?chatsPage(state):['work','tasks'].includes(state.tab)?workPage(state):['devices','phones'].includes(state.tab)?devicesPage(state):state.tab==='me'?mePage(state):employeesPage(state);
  return `<div class="app-shell ${isChat?'chat-shell':''} ${page==='home'?'has-bottom-nav':''}" data-page="${e(page)}" data-view-key="${e([state.workspace?.slug,state.tab,page,state.selectedEmployee?.id,state.report?.index,state.forward?.phase,state.forwardDetail?.messageId].join(':'))}" aria-busy="${Boolean(state.busy)}">${content}${page==='home'?bottomNav(state):''}${forwardingOverlay(state)}${forwardDetailOverlay(state)}${imageOverlay(state)}</div>`;
}

let savedFocus=null, savedView=null;
export function captureDraft(root,state) {
  savedView={key:root.querySelector('.app-shell')?.dataset.viewKey,details:[...root.querySelectorAll('details')].map(item=>item.open),scrolls:[...root.querySelectorAll('.page-content,.report-queue ol,.draft-attachments,.forward-sheet-body,.forward-detail-messages')].map(item=>({top:item.scrollTop,left:item.scrollLeft}))};
  const field=root.querySelector('textarea[name="draft"]');
  if(field) state.draft=field.value;
  const active=globalThis.document?.activeElement;
  savedFocus=active&&root.contains(active)&&['draft','search','chatSearch'].includes(active.name) ? {name:active.name,start:active.selectionStart,end:active.selectionEnd,scrollTop:active.scrollTop} : null;
}
export function restoreFocus() {
  if(savedView?.key && globalThis.document?.querySelector('.app-shell')?.dataset.viewKey===savedView.key) {
    [...document.querySelectorAll('details')].forEach((item,index)=>{if(savedView.details[index]!==undefined)item.open=savedView.details[index];});
    [...document.querySelectorAll('.page-content,.report-queue ol,.draft-attachments,.forward-sheet-body,.forward-detail-messages')].forEach((item,index)=>{if(savedView.scrolls[index]){item.scrollTop=savedView.scrolls[index].top;item.scrollLeft=savedView.scrolls[index].left;}});
  }
  savedView=null;
  if(!savedFocus) return;
  const field=globalThis.document?.querySelector(`[name="${savedFocus.name}"]`);
  if(field) { field.focus({preventScroll:true}); try { field.setSelectionRange(savedFocus.start,savedFocus.end); } catch {} field.scrollTop=savedFocus.scrollTop; }
  savedFocus=null;
}
