<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ZiAvatar, ZiButton, ZiCard, ZiEmptyState, ZiFormField, ZiIcon, ZiInput, ZiMetricCard, ZiModal, ZiProgress, ZiStatusTag, ZiSwitch, ZiTabs, ZiTextarea } from '@ziwei/ui';
import { API_BASE, api, setWorkspaceSlug, workspaceSlug } from './api.js';
import { connectWorkspaceRealtime } from './realtime.js';
import WorkspaceShell from './components/WorkspaceShell.vue';
import ZiSelect from './components/ZiSelect.vue';
import TerminalConsole from './components/terminal/TerminalConsole.vue';
import AndroidInstallPage from './components/AndroidInstallPage.vue';
import ManagementMcpPanel from './components/ManagementMcpPanel.vue';
import PhoneSkillSetup from './components/PhoneSkillSetup.vue';
import { employeeReadiness, managementPreparation, profileAfterRuntimeChange } from './management-mcp.js';
import { installPageHref } from './android-install.js';
import { Search, Plus, Inbox, Grip, SlidersHorizontal, ArrowDownUp, Kanban, List, MoreHorizontal, CircleDashed, Circle, CircleDot, CheckCircle2, CircleAlert, Zap, ChevronDown, RotateCcw, LayoutList, Tag, UserRound, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Maximize2, Mic, Paperclip, X, Folder, FolderOpen, FolderPlus, FileText, Upload, Download, RefreshCw, HardDrive, Network, Server, Monitor, Crown, Trash2, ClipboardList, Settings2 } from 'lucide-vue-next';

const nav = [
  { key:'home', label:'首页', icon:'overview' }, { key:'issues', label:'问题与任务', icon:'activity' }, { key:'calendar', label:'日历', icon:'clock' },
  { key:'docs', label:'项目文档', icon:'link' }, { key:'members', label:'成员与设备', icon:'device' }, { key:'skills', label:'技能中心', icon:'business' },
  { key:'settings', label:'工作区设置', icon:'shield' }
];
function routeParts(pathname = location.pathname) { return pathname.split('/').filter(Boolean); }
function isAndroidInstallPath(pathname) { return /^\/android-install\/?$/.test(pathname); }
function routeFromPath(pathname) { if (isAndroidInstallPath(pathname)) return 'android-install'; const parts = routeParts(pathname); if (!parts.length) return 'home'; if (parts[0] === 'invite' && new URLSearchParams(location.search).has('code')) return 'invite-accept'; if ((parts[0] === 'me' && parts[1] === 'invite') || (parts[1] === 'me' && parts[2] === 'invite')) return 'invite'; if (parts.length > 1) return ({home:'home',issues:'issues',calendar:'calendar','project-docs':'docs',members:'members',skills:'skills',settings:'settings','open-platform':'open',autopilots:'automations',runtimes:'runtimes',inbox:'inbox',employee:'employee','ziwei-connect':'ziwei-connect'}[parts[1] || 'home'] || 'home'); if (parts.length === 1) return 'home'; return 'home'; }
function conversationIdFromPath(pathname = location.pathname) { const parts = routeParts(pathname); return parts[1] === 'inbox' ? (parts[2] || '') : ''; }
function conversationEmployeeFromPath() { return new URLSearchParams(location.search).get('employee') || ''; }
function employeeIdFromPath(pathname = location.pathname) { const parts = routeParts(pathname); return parts[1] === 'employee' ? (parts[2] || '') : ''; }
function routePath(key, detailId = '', workspaceOverride = '') { const activeSlug = String(workspaceOverride || workspaceSlug()).trim(); const prefix = activeSlug ? `/${encodeURIComponent(activeSlug)}` : ''; if (key === 'invite') return `${prefix}/me/invite` || '/me/invite'; const map = {home:'home',issues:'issues',calendar:'calendar',docs:'project-docs',members:'members',runtimes:'runtimes',skills:'skills',settings:'settings',open:'open-platform',automations:'autopilots',inbox:'inbox',employee:'employee','ziwei-connect':'ziwei-connect'}; const base = `${prefix}/${map[key] || key}`; return (key === 'inbox' || key === 'employee') && detailId ? `${base}/${encodeURIComponent(detailId)}` : base; }
const page = ref(routeFromPath(location.pathname));
const authState = ref({ loading:true, configured:false, setup_required:false, authenticated:false, user:null, workspaces:[] });
const inviteQuery = new URLSearchParams(location.search);
const authForm = ref({ name:'', email:'', password:'', confirmPassword:'', invitationCode:inviteQuery.get('code') || '' });
const authMode = ref(inviteQuery.get('code') ? 'register' : 'login');
// Keep the first-run workspace explicit.  A new browser may not have the
// workspace slug in localStorage yet, so the setup form must not silently
// create the account in the example workspace.
// First-run setup creates only the account. A workspace is created explicitly
// after authentication; invitation URLs may still prefill a team slug.
const authWorkspaceSlug = ref(inviteQuery.get('workspace') || '');
const authBusy = ref(false);
const authError = ref('');
const authErrorPanel = ref(null);
const inviteAcceptError = ref('');
const inviteAcceptBusy = ref(false);
async function showAuthError(message) {
  authError.value = String(message || '提交失败，请重试');
  await nextTick();
  authErrorPanel.value?.scrollIntoView({ block:'nearest' });
  authErrorPanel.value?.focus({ preventScroll:true });
}
function switchAuthMode() { authError.value=''; authMode.value=authMode.value==='login'?'register':'login'; }
async function enterWorkspace(slug) {
  if (!slug) return;
  setWorkspaceSlug(slug);
  page.value='home';
  history.replaceState({}, '', routePath('home', '', slug));
  await load();
}
const currentAccount = computed(() => {
  if (!authState.value.user) return {name:'',email:'',role:null};
  const activeSlug = summary.value.workspace?.slug || workspaceSlug();
  const membership = (authState.value.memberships || []).find(item => item?.slug === activeSlug);
  return { ...authState.value.user, role: membership?.role || authState.value.role || authState.value.user.role || null };
});
const canManageWorkspace = computed(() => ['owner', 'admin'].includes(String(currentAccount.value.role || '').toLowerCase()));
const workspaceCreateRequired = computed(() => authState.value.authenticated && !(authState.value.memberships || []).length);
const workspaceSlugValue = computed(() => summary.value.workspace?.slug || workspaceSlug());
// Do not show a made-up online state while the first API read is in flight.
// The only source of truth for this badge is the backend's fresh heartbeat.
const summary = ref({ workspace:{name:'',slug:workspaceSlug(),kind:null}, counts:{tasks:0,runtimes:0,members:0,documents:0,automations:0}, taskStates:{}, device:{name:'',status:'unknown'} });
const isTeamWorkspace = computed(() => summary.value.workspace?.kind === 'team');
const deviceSectionLabel = computed(() => isTeamWorkspace.value ? '团队设备' : '我的设备');
const tasks = ref([]); const runtimes = ref([]); const models = ref([]); const skills = ref([]); const documents = ref([]); const automations = ref([]); const members = ref([]); const devices = ref([]); const employees = ref([]); const calendar = ref([]); const settings = ref(null); const agents = ref([]);
const ziweiConnectStatus = ref({ source:null, devices:[], diagnostics:[], bindings:[] }); const ziweiConnectBindings = ref([]); const ziweiConnectLoading = ref(false); const ziweiConnectState = ref('idle'); const ziweiConnectError = ref(''); const ziweiConnectBusy = ref(''); const ziweiConnectSelection = ref({ employeeId:'', deviceId:'', accountId:'', accountLabel:'' }); const ziweiConnectRuns = ref({}); let ziweiConnectRunTimer = null;
const ownDeviceOnline = computed(() => summary.value.device?.status === 'online');
const ownDeviceLabel = computed(() => ownDeviceOnline.value ? '在线' : '离线');
const loading = ref(true); const toast = ref(''); const toastTone = ref('success'); let toastTimer = null; const search = ref('');
const workspaceName = ref('紫薇'); const workspaceTimezone = ref('Asia/Shanghai'); const workspaceLanguage = ref('zh-CN'); const workspaceTheme = ref('light'); const workspaceWeekStart = ref('monday'); const profileName = ref(''); const workspaceDescription = ref(''); const workspaceContext = ref(''); const workspaceVisibility = ref('workspace'); const workspacePrefix = ref('');
const firstWorkspaceForm = ref({ name:'', slug:'', kind:'personal' }); const firstWorkspaceBusy = ref(false);
function formatDeviceDate(value, withTime = false) {
  if (!value) return '历史设备';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未知';
  return new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'numeric', day:'numeric', ...(withTime ? { hour:'2-digit', minute:'2-digit' } : {}), timeZone: workspaceTimezone.value || undefined }).format(date);
}
function deviceLastSeenLabel(device) {
  if (device?.status === 'online') {
    const age = Number(device.heartbeat_age_ms);
    if (Number.isFinite(age) && age < 60 * 1000) return '刚刚';
    if (Number.isFinite(age) && age < 60 * 60 * 1000) return `${Math.max(1, Math.floor(age / 60000))}分钟前`;
  }
  return device?.last_seen ? formatDeviceDate(device.last_seen, true) : '从未连接';
}
const showTask = ref(false); const showMemberEditor = ref(false); const memberEditForm = ref({id:'',name:'',email:'',role:'member'}); const showTaskDetail = ref(false); const taskDetail = ref(null); const taskMessages = ref([]); const taskAttachments = ref([]); const taskAttachmentInput = ref(null); const agentComposerAttachmentInput = ref(null); const agentComposerAttachment = ref(null); const agentComposerAttachmentName = ref(''); const taskDetailForm = ref({title:'',description:'',descriptionFormat:'plain',state:'planned',priority:'medium',dueDate:'',assignee:'',labels:[]}); const taskMessageDraft = ref(''); const showSearch = ref(false); const issueFilterOpen = ref(false); const issueDisplayOpen = ref(false); const issueViewOpen = ref(false); const showDoc = ref(false); const showInvite = ref(false); const showDevice = ref(false); const showDeviceEditor = ref(false); const deviceEditForm = ref({id:'',name:'',os:''}); const deviceSetupMode = ref(false); const showEmployee = ref(false); const showAutomation = ref(false); const showAgentComposer = ref(false); const agentComposerText = ref(''); const agentComposerExpanded = ref(false);
const showApiKeys = ref(false); const apiKeys = ref([]); const apiKeyForm = ref({name:'紫薇 CLI',role:'member',expiresAt:''}); const createdApiToken = ref('');
const showSkillModal = ref(false); const showSkillVersions = ref(false); const skillVersionTarget = ref(null); const skillVersions = ref([]); const skillScope = ref('platform'); const skillForm = ref({name:'',description:'',category:'productivity',tags:''}); const showSkillImport = ref(false); const skillImportFile = ref(null); const skillImportArchiveFile = ref(null); const skillImportMode = ref('markdown'); const skillImportSources = ref([]); const skillImportForm = ref({name:'',description:'',content:'',url:'',archive:'',archiveName:'',sourceDeviceId:''});
const employeeContinuePhoneSetup = ref(false); const showPhoneSkillSetup = ref(false); const phoneSetupContext = ref({employeeId:'',phoneDeviceId:''});
function openPhoneSkillSetup(employeeId='',phoneDeviceId='') { phoneSetupContext.value={employeeId,phoneDeviceId}; showPhoneSkillSetup.value=true; }
function createEmployeeForPhone() { showPhoneSkillSetup.value=false; openEmployeeModal(); employeeContinuePhoneSetup.value=true; }
async function switchPhoneWorkspace(slug) { phoneSetupContext.value={employeeId:'',phoneDeviceId:''}; await switchWorkspace(slug); }
const deviceInstallTab = ref('windows'); const deviceCommandMode = ref('existing'); const copiedDeviceCommand = ref(''); const devicePairing = ref(null); const devicePairingBusy = ref(false); const agentComposerDeviceId = ref('');
const employeeEditId = ref(''); const employeeModalTab = ref('manual'); const employeeVisibility = ref('workspace'); const employeeModel = ref('default'); const employeeModelSearch = ref(''); const employeeDescription = ref(''); const employeeRole = ref(''); const employeeRuntimeProfile = ref(''); const employeeSkillsOpen = ref(false); const employeeRuntimeOpen = ref(false); const employeeModelOpen = ref(false); const employeeSkillIds = ref([]); const employeeAvatar = ref(''); const employeeAvatarFile = ref(null);
// The org chart card is an entry point, not the edit form itself. Keep the
// action menu state separate so a click exposes Aura's two next steps.
const employeeActionId = ref('');
const docsPath = ref('root'); const docsSearch = ref(''); const docUploadInput = ref(null); const showGitSync = ref(false); const gitSyncMode = ref('export'); const gitSyncForm = ref({name:workspaceSlug(),message:''});
const docEditor = ref(null); const documentTrash = ref([]); const documentVersions = ref([]); const showDocEditor = ref(false); const docEditorForm = ref({id:'',name:'',content:'',type:'file'});
const docsRootFolder = { id:'docs-root', parent_id:null, name:'说明文档', type:'folder', size:0, updated_at:'' };
const taskForm = ref({title:'',description:'',priority:'medium',dueDate:'',state:'planned'}); const docForm = ref({name:'',type:'file',content:''}); const inviteForm = ref({email:'',role:'member'}); const invitations = ref([]); const inviteLink = ref(''); const inviteCode = ref(new URLSearchParams(location.search).get('code') || ''); const inviteInfo = ref(null); const inviteAcceptForm = ref({name:'',email:''}); const inviteAcceptState = ref('idle'); const deviceForm = ref({name:'这台电脑',token:''}); const employeeForm = ref({name:'',runtime:'',instructions:''}); const automationForm = ref({name:'',schedule:'每天 09:00',prompt:'',webhookUrl:'',outputMode:'notification',maxRetries:3});
const issueTab = ref('all'); const calendarTab = ref('month'); const skillTab = ref('all'); const settingsTab = ref('general'); const switchValue = ref(true); const automationDefaultMode = ref('notification'); const teamView = ref('org');
const issueView = ref('board'); const issueFilter = ref('all'); const quickTrayMenu = ref(''); const collapsedDevices = ref(new Set()); const laneMenuKey = ref(''); const agentComposerEmployeeId = ref(''); const agentComposerEmployeeOpen = ref(false);
const employeeRouteId = ref(employeeIdFromPath()); const employeeProfileTab = ref('activity');
const employeeRoleEditing = ref(false); const employeeRoleDraft = ref(''); const employeeRoleSaving = ref(false);
const employeeEnvironment = ref({ variables: [], local_source: { source: 'ziwei_user', scope: 'runtime', variables: [] } });
const employeeEnvironmentDraft = ref({ key: '', value: '', sensitive: true });
const employeeEnvironmentEditing = ref('');
const employeeCustomParams = ref({ values: {}, updated_at: null });
const employeeCustomParamsDraft = ref('{}');
const employeeConfigLoading = ref(false); const employeeConfigSaving = ref(false);
const employeeMcpStatus = ref(null); const hermesProfiles = ref([]); const hermesProfileDeviceId = ref(''); const hermesProfileCreating = ref(false);
const employeePersona = ref(''); const employeeTargetDeviceId = ref(''); const employeeCreating = ref(false); const employeeCreateRequestKey = ref(''); const employeeMcpRetrying = ref(false); const employeeMcpRetryMessage = ref('');
const managementDiscovery = ref(null); const managementDiscoveryLoading = ref(false); const managementDiscoveryError = ref('');
const employeeDeviceOptions = computed(() => [{ label:'请选择目标电脑', value:'' }, ...(managementDiscovery.value?.devices || []).map(device => ({ label:`${device.name || device.id} · ${device.status === 'online' ? '在线' : '离线'}`, value:device.id }))]);
const employeeSelectedDevice = computed(() => managementDiscovery.value?.devices?.find(device => device.id === employeeTargetDeviceId.value));
const employeeRuntimeChoices = computed(() => employeeSelectedDevice.value?.runtimes?.length ? employeeSelectedDevice.value.runtimes : runtimes.value);
const employeeReady = computed(() => employeeReadiness(managementDiscovery.value, { deviceId:employeeTargetDeviceId.value, runtime:employeeForm.value.runtime, profile:employeeRuntimeProfile.value.trim() }));
const employeeMcpPreparation = computed(() => managementPreparation(employeeSelectedDevice.value?.management_mcp || employeeSelectedDevice.value?.managementMcp));
const employeeRuntimeProfiles = computed(() => employeeReady.value.runtime?.profiles || []);
const employeeRuntimeProfileOptions = computed(() => {
  const found = employeeRuntimeProfiles.value.map(profile => ({ label:typeof profile === 'string' ? profile : profile.name, value:typeof profile === 'string' ? profile : profile.name }));
  if (employeeRuntimeProfile.value && !found.some(profile => profile.value === employeeRuntimeProfile.value)) found.push({ label:`${employeeRuntimeProfile.value}（目标电脑未发现）`, value:employeeRuntimeProfile.value });
  return [{ label:'默认 CLI 配置', value:'' }, ...found];
});
watch([employeeRouteId, page, () => authState.value.authenticated], () => { if (page.value === 'employee' && authState.value.authenticated) void loadEmployeeConfig(); });
const voiceListening = ref(false); let voiceRecognition = null;
const notifications = ref([]); const notificationStats = ref({unread:0}); const conversations = ref([]); const selectedConversation = ref(null); const conversationEmployeeId = ref(conversationEmployeeFromPath()); const conversationDraft = ref(''); const conversationDeviceId = ref(''); const conversationModelId = ref(''); const conversationWorkingDirectory = ref(''); const conversationAttachmentInput = ref(null); const conversationAttachment = ref(null); const conversationAttachmentName = ref(''); const conversationExecution = ref(null); const conversationStatusLoading = ref(false); const conversationExecutionList = ref(null); const taskExecutionList = ref(null); const conversationDirectoryPickerOpen = ref(false); const conversationDirectoryLoading = ref(false); const conversationDirectoryAction = ref(null); const conversationDirectoryInspection = ref(null); const conversationDirectoryPathDraft = ref(''); let conversationPollTimer = null; let taskDetailPollTimer = null; const eventSource = ref(null);
const calendarEventForm = ref({id:'',name:'',description:'',startAt:'',endAt:'',status:'planned',assignee:'',allDay:true}); const showCalendarEvent = ref(false);
const automationRuns = ref({}); const selectedAutomation = ref(null); const showAutomationDetails = ref(false); const automationEditId = ref('');
function applyDisplayPreferences() {
  const selectedTheme = workspaceTheme.value === 'system'
    ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : workspaceTheme.value;
  document.documentElement.dataset.theme = selectedTheme || 'light';
  document.documentElement.lang = workspaceLanguage.value || 'zh-CN';
}
watch([workspaceTheme, workspaceLanguage], applyDisplayPreferences);
function scrollExecutionList(target) { nextTick(() => { const element = target.value; if (element) element.scrollTop = element.scrollHeight; }); }
watch(conversationExecution, () => scrollExecutionList(conversationExecutionList), { deep:true });
watch(taskDetail, () => scrollExecutionList(taskExecutionList), { deep:true });
const employeeModelGroups = computed(() => models.value.reduce((groups, model) => { (groups[model.provider] ||= []).push(model); return groups; }, {}));
const filteredEmployeeModels = computed(() => { const query = employeeModelSearch.value.trim().toLowerCase(); return Object.fromEntries(Object.entries(employeeModelGroups.value).map(([provider, entries]) => [provider, entries.filter(model => !query || `${model.provider} ${model.label} ${model.id}`.toLowerCase().includes(query))]).filter(([, entries]) => entries.length)); });
const selectedEmployeeModel = computed(() => models.value.find(model => model.id === employeeModel.value) || null);
const calendarView = ref('month'); const calendarCursor = ref(new Date()); const calendarShowTasks = ref(true); const calendarHumanOnly = ref(false); const calendarTaskFilter = ref('all'); const calendarProjectVisible = ref(true);
const selectedStates = ref([]); const selectedPriorities = ref([]); const issueSort = ref('manual'); const issueGroup = ref('status'); const cardProperties = ref({priority:true,assignee:true,dueDate:false});
const draggedTaskId = ref(''); const draggedCalendarEventId = ref('');
const agentComposerPanel = ref(null);
let agentComposerRestoreFocus = null;
const conversationExecutionLabel = computed(() => {
  const status = conversationExecution.value?.status;
  if (!status) return selectedConversation.value?.messages?.length ? '会话已同步' : '等待发送';
  return ({ pending:'已提交，等待 ziwei_user 接收', acked:'数字伙伴执行中', succeeded:'数字伙伴已完成', failed:'执行失败', expired:'执行已超时' }[status] || `状态：${status}`);
});
const conversationExecutionTone = computed(() => {
  const status = conversationExecution.value?.status;
  return status === 'succeeded' ? 'success' : status === 'failed' || status === 'expired' ? 'error' : status === 'pending' || status === 'acked' ? 'running' : 'idle';
});
const conversationExecutionBusy = computed(() => ['pending','acked'].includes(conversationExecution.value?.status));
const conversationLatestEvent = computed(() => {
  const events = conversationExecution.value?.events;
  return Array.isArray(events) && events.length ? events[events.length - 1] : null;
});
const taskTabs = computed(() => [{value:'all',label:'全部',count:tasks.value.length},{value:'todo',label:'待处理',count:tasks.value.filter(t=>t.state==='todo').length},{value:'in_progress',label:'进行中',count:tasks.value.filter(t=>t.state==='in_progress').length},{value:'completed',label:'已完成',count:tasks.value.filter(t=>t.state==='completed').length}]);
const taskStateOptions = [{label:'待规划',value:'planned'},{label:'待办',value:'todo'},{label:'进行中',value:'in_progress'},{label:'审核中',value:'review'},{label:'已完成',value:'completed'},{label:'已阻塞',value:'blocked'}];
const deviceOptions = computed(() => devices.value.map(device => ({ label:`${device.name} · ${device.status === 'online' ? '在线' : '离线'}`, value:device.id })));
const conversationModelOptions = computed(() => [{ label:'默认（数字员工配置）', value:'' }, ...models.value.map(model => ({ label:`${model.provider} · ${model.label}`, value:model.id }))]);
const selectedConversationDevice = computed(() => devices.value.find(device => device.id === conversationDeviceId.value) || null);
const conversationEmployeeOptions = computed(() => [
  ...employees.value.map(employee => ({ label:`${employee.name || '未命名数字员工'} · ${employee.runtime || '未配置运行时'}`, value:employee.id, employee })),
  { label:'未绑定员工（历史会话）', value:'unassigned', legacy:true }
]);
const activeConversationEmployee = computed(() => employees.value.find(employee => employee.id === conversationEmployeeId.value) || null);
const visibleTasks = computed(() => {
  const scopeOk = issueTab.value === 'all' || (issueTab.value === 'members' && !['ziwei_user','agent','digital_partner'].includes(String(task.created_by || '').toLowerCase()) && !String(task.assignee || '').toLowerCase().includes('agent')) || (issueTab.value === 'agents' && (['ziwei_user','agent','digital_partner'].includes(String(task.created_by || '').toLowerCase()) || String(task.assignee || '').toLowerCase().includes('agent')));
  const filtered = tasks.value.filter(task => scopeOk && (!search.value.trim() || `${task.title} ${task.description}`.toLowerCase().includes(search.value.toLowerCase())) && (!selectedStates.value.length || selectedStates.value.includes(task.state)) && (!selectedPriorities.value.length || selectedPriorities.value.includes(task.priority)));
  return [...filtered].sort((a,b) => issueSort.value === 'title' ? a.title.localeCompare(b.title) : issueSort.value === 'priority' ? ({high:0,medium:1,low:2}[a.priority]??3)-({high:0,medium:1,low:2}[b.priority]??3) : new Date(a.created_at||0)-new Date(b.created_at||0));
});
const lanes = computed(() => [{key:'planned',label:'待规划'},{key:'todo',label:'待办'},{key:'in_progress',label:'进行中'},{key:'review',label:'审核中'},{key:'completed',label:'已完成'},{key:'blocked',label:'已阻塞'}].map(l => ({...l, tasks:visibleTasks.value.filter(t=>t.state===l.key)})));
const assigneeLanes = computed(() => {
  const groups = new Map();
  visibleTasks.value.forEach(task => {
    const name = String(task.assignee || '').trim() || '未分配';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(task);
  });
  return [...groups.entries()].map(([name, items]) => ({ name, tasks: items }));
});
const localDateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const calendarMonthLabel = computed(() => `${calendarCursor.value.getFullYear()}年${calendarCursor.value.getMonth()+1}月`);
const calendarGrid = computed(() => { const year=calendarCursor.value.getFullYear(); const month=calendarCursor.value.getMonth(); const first=new Date(year,month,1); const start=new Date(year,month,1-first.getDay()); const cellCount=Math.max(35,Math.ceil((first.getDay()+new Date(year,month+1,0).getDate())/7)*7); return Array.from({length:cellCount},(_,i)=>{ const date=new Date(start); date.setDate(start.getDate()+i); return {date,key:localDateKey(date),outside:date.getMonth()!==month,today:date.toDateString()===new Date().toDateString()}; }); });
const calendarWeekDays = computed(() => { const current=new Date(calendarCursor.value); const start=new Date(current); start.setDate(current.getDate()-current.getDay()); return Array.from({length:7},(_,i)=>{ const date=new Date(start); date.setDate(start.getDate()+i); return {date,key:localDateKey(date)}; }); });
const calendarEvents = computed(() => { const rows = calendar.value.flatMap(item => item.events || []); return rows.filter(event => { const isTask=event.source==='task'; const statusOk=calendarTaskFilter.value==='all' || event.status===calendarTaskFilter.value; const humanOk=!calendarHumanOnly.value || !isTask || !event.assignee; const taskVisibility=!isTask || calendarShowTasks.value; return calendarProjectVisible.value && taskVisibility && statusOk && humanOk; }); });
function calendarEventsFor(key) { return calendarEvents.value.filter(event => String(event.start_date || '').slice(0,10) === key); }
function moveCalendarMonth(amount) { const date=new Date(calendarCursor.value); const day=date.getDate(); date.setDate(1); date.setMonth(date.getMonth()+amount); const max=new Date(date.getFullYear(),date.getMonth()+1,0).getDate(); date.setDate(Math.min(day,max)); calendarCursor.value=date; }
function calendarToday() { calendarCursor.value=new Date(); }
function openCalendarEvent(dateKey='') { const start=dateKey || localDateKey(calendarCursor.value); calendarEventForm.value={id:'',name:'',description:'',startAt:`${start}T09:00`,endAt:`${start}T10:00`,status:'planned',assignee:'',allDay:true}; showCalendarEvent.value=true; }
function editCalendarEvent(event) { calendarEventForm.value={id:event.id,name:event.name || event.title || '',description:event.description || '',startAt:String(event.start_at || event.start_date || '').slice(0,16),endAt:String(event.end_at || event.end_date || '').slice(0,16),status:event.status || 'planned',assignee:event.assignee || '',allDay:event.all_day !== false}; showCalendarEvent.value=true; }
async function saveCalendarEvent() { if(!calendarEventForm.value.name.trim() || !calendarEventForm.value.startAt) return notify('请填写日程名称和开始时间'); try { const body={name:calendarEventForm.value.name.trim(),description:calendarEventForm.value.description,startAt:calendarEventForm.value.startAt,endAt:calendarEventForm.value.endAt || null,status:calendarEventForm.value.status,assignee:calendarEventForm.value.assignee || null,allDay:calendarEventForm.value.allDay}; if(calendarEventForm.value.id) await api.updateCalendarEvent(calendarEventForm.value.id,body); else await api.createCalendarEvent(body); showCalendarEvent.value=false; await load(); notify(calendarEventForm.value.id?'日程已更新':'日程已创建'); } catch(error) { notify(error.message); } }
async function removeCalendarEvent() { if(!calendarEventForm.value.id) return; try { await api.deleteCalendarEvent(calendarEventForm.value.id); showCalendarEvent.value=false; await load(); notify('日程已删除'); } catch(error) { notify(error.message); } }
function startTaskDrag(task, event) { draggedTaskId.value=task?.id || ''; event?.dataTransfer?.setData('text/plain', draggedTaskId.value); if (event?.dataTransfer) event.dataTransfer.effectAllowed='move'; }
function clearTaskDrag() { draggedTaskId.value=''; }
async function dropTaskInLane(state, event) { event?.preventDefault?.(); const taskId=draggedTaskId.value || event?.dataTransfer?.getData('text/plain'); clearTaskDrag(); if (!taskId) return; const task=tasks.value.find(item=>item.id===taskId); if (!task || task.state===state) return; const moved=await moveTask(task,state); if (moved) notify(`任务已移动到${lanes.value.find(item=>item.key===state)?.label || state}`); }
function startCalendarEventDrag(item, event) { if (!item?.id || !['event','task'].includes(item.source)) { event?.preventDefault?.(); return; } draggedCalendarEventId.value=`${item.source}:${item.id}`; event?.dataTransfer?.setData('text/plain', draggedCalendarEventId.value); if (event?.dataTransfer) event.dataTransfer.effectAllowed='move'; }
function clearCalendarEventDrag() { draggedCalendarEventId.value=''; }
async function dropCalendarEvent(dateKey, event) {
  event?.preventDefault?.(); const rawId=draggedCalendarEventId.value || event?.dataTransfer?.getData('text/plain'); clearCalendarEventDrag(); if (!rawId) return;
  const [source,idValue]=String(rawId).includes(':') ? String(rawId).split(/:(.*)/s) : ['event',rawId];
  const item=calendarEvents.value.find(entry=>entry.id===idValue && entry.source===source); if (!item) return;
  if (source === 'task') { try { await api.updateTask(item.id,{dueDate:dateKey}); await load(); notify('任务日期已调整'); } catch (error) { notify(error.message); } return; }
  const sourceStart=String(item.start_at || item.start_date || ''); const time=sourceStart.match(/T(\d{2}:\d{2})/)?.[1] || '09:00';
  const sourceEnd=String(item.end_at || item.end_date || ''); const endTime=sourceEnd.match(/T(\d{2}:\d{2})/)?.[1] || null;
  try { await api.updateCalendarEvent(item.id,{name:item.name || item.title,description:item.description || '',startAt:item.all_day ? dateKey : `${dateKey}T${time}`,endAt:item.all_day ? dateKey : (endTime ? `${dateKey}T${endTime}` : null),status:item.status || 'planned',assignee:item.assignee || null,allDay:item.all_day !== false}); await load(); notify('日程已移动'); } catch (error) { notify(error.message); }
}
function openAgentComposer() { agentComposerText.value=''; agentComposerExpanded.value=false; agentComposerEmployeeId.value=employees.value[0]?.id || ''; agentComposerDeviceId.value=devices.value.find(device => device.status === 'online')?.id || devices.value[0]?.id || ''; agentComposerEmployeeOpen.value=false; showAgentComposer.value=true; }
async function openClipboardAssistant() { try { agentComposerText.value=await navigator.clipboard?.readText() || ''; } catch { agentComposerText.value=''; } agentComposerExpanded.value=false; agentComposerEmployeeId.value=employees.value[0]?.id || ''; agentComposerEmployeeOpen.value=false; showAgentComposer.value=true; }
function stopVoiceInput() { if (voiceRecognition) { voiceRecognition.stop(); voiceRecognition=null; } voiceListening.value=false; }
function toggleVoiceInput() {
  if (voiceListening.value) return stopVoiceInput();
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return notify('当前浏览器不支持语音输入，请直接输入文字');
  const recognition = new Recognition();
  voiceRecognition = recognition;
  recognition.lang = workspaceLanguage.value || 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onstart = () => { voiceListening.value=true; notify('正在聆听，再次点击麦克风结束'); };
  recognition.onresult = event => {
    const transcript = Array.from(event.results || []).slice(event.resultIndex || 0).map(result => result[0]?.transcript || '').join('');
    if (transcript.trim()) agentComposerText.value = `${agentComposerText.value.trim()}${agentComposerText.value.trim() ? ' ' : ''}${transcript.trim()}`;
  };
  recognition.onerror = event => { voiceListening.value=false; voiceRecognition=null; notify(event.error === 'not-allowed' ? '浏览器没有麦克风权限' : `语音输入失败：${event.error || '未知错误'}`); };
  recognition.onend = () => { voiceListening.value=false; voiceRecognition=null; };
  try { recognition.start(); } catch (error) { voiceListening.value=false; voiceRecognition=null; notify(error.message || '无法启动语音输入'); }
}
function closeAgentComposer() { stopVoiceInput(); showAgentComposer.value=false; agentComposerExpanded.value=false; }
function handleAgentComposerKeydown(event) {
  if (!showAgentComposer.value) return;
  if (event.key === 'Escape') { event.preventDefault(); closeAgentComposer(); return; }
  if (event.key !== 'Tab') return;
  const panel = agentComposerPanel.value;
  if (!panel) return;
  const focusable = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter(element => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
watch(showAgentComposer, async open => {
  if (open) {
    agentComposerRestoreFocus = document.activeElement;
    await nextTick();
    agentComposerPanel.value?.querySelector('textarea,button,input,select')?.focus();
  } else if (agentComposerRestoreFocus && typeof agentComposerRestoreFocus.focus === 'function') {
    agentComposerRestoreFocus.focus();
    agentComposerRestoreFocus = null;
  }
});
async function copyTeamValue(value) { try { await navigator.clipboard?.writeText(value); } catch {} notify('已添加到剪贴板'); }

const skillCategories = computed(() => [...new Set(skills.value.filter(skill => (skill.scope || skill.source || 'platform') === skillScope.value).map(skill => skill.category))].sort());
const filteredSkills = computed(() => skills.value.filter(skill => (skill.scope || skill.source || 'platform') === skillScope.value && (skillTab.value === 'all' || skill.category === skillTab.value) && (!search.value.trim() || `${skill.name} ${skill.description} ${(skill.tags || []).join(' ')}`.toLowerCase().includes(search.value.toLowerCase()))));
const docsTreeRows = computed(() => {
  const folders = documents.value.filter(doc => doc.type === 'folder' && doc.id !== docsRootFolder.id);
  const children = parentId => folders.filter(folder => (folder.parent_id || null) === parentId).sort((a,b) => a.name.localeCompare(b.name));
  const rows = [{folder:docsRootFolder,depth:0}];
  const walk = (parentId, depth) => { for (const folder of children(parentId)) { rows.push({folder,depth}); walk(folder.id,depth + 1); } };
  walk(null,1); return rows;
});
const docsEntries = computed(() => {
  const parentId = docsPath.value === 'root' || docsPath.value === docsRootFolder.id ? null : docsPath.value;
  const source = docsSearch.value.trim() ? documents.value : documents.value.filter(doc => (doc.parent_id || null) === parentId);
  const query = docsSearch.value.trim().toLowerCase();
  return query ? source.filter(item => item.name.toLowerCase().includes(query)) : source;
});
const docsUsedBytes = computed(() => documents.value.filter(doc => doc.type === 'file').reduce((total, doc) => total + Number(doc.size || 0), 0));
const docsUsedPercent = computed(() => Math.min(100, (docsUsedBytes.value / (10 * 1024 * 1024 * 1024)) * 100));
// `history.pushState()` does not make `location.pathname` reactive. Keep the
// focused conversation id in Vue state so selecting/creating a conversation
// immediately switches the inbox into the dedicated persistent-session view.
const conversationRouteId = ref(conversationIdFromPath());
const focusedConversation = computed(() => page.value === 'inbox' && Boolean(conversationRouteId.value));
const employeeProfile = computed(() => employees.value.find(item => item.id === employeeRouteId.value) || null);
const employeeProfileTasks = computed(() => { const employee = employeeProfile.value; if (!employee) return []; const assignee = String(employee.name || '').toLowerCase(); return tasks.value.filter(task => String(task.assignee || '').toLowerCase() === assignee || String(task.assignee || '').toLowerCase().includes(assignee)); });
const employeeProfileConversations = computed(() => { const employee = employeeProfile.value; if (!employee) return []; return conversations.value.filter(item => item.employee_id === employee.id); });
const pageTitle = computed(() => ({home:'首页',issues:'问题与任务',calendar:'日历',docs:'项目文档',members:'成员与设备',runtimes:'运行时',skills:'技能中心',settings:'工作区设置',invite:'邀请加入紫薇',open:'开放平台',automations:'自动化',inbox:focusedConversation.value ? '持久会话' : '收件箱',employee:employeeProfile.value?.name || '数字伙伴','ziwei-connect':'紫薇·互联'}[page.value] || '紫薇'));

function navigate(key) { if (key === 'workflow') key='automations'; if (key === 'skills') { search.value=''; skillScope.value='platform'; skillTab.value='all'; } if (key === 'inbox') { selectedConversation.value=null; conversationExecution.value=null; conversationDraft.value=''; conversationRouteId.value=''; clearConversationAttachment(); stopConversationPolling(); } if (key !== 'employee') { employeeRouteId.value=''; employeeActionId.value=''; } page.value = key; history.pushState({},'',routePath(key)); if (key === 'open') loadApiKeys(); if (key === 'ziwei-connect') void loadZiweiConnect(); }
async function switchWorkspace(slug) { const nextSlug=String(slug || '').trim(); if (!nextSlug || nextSlug === workspaceSlug()) return; setWorkspaceSlug(nextSlug); history.pushState({},'',routePath(page.value,'',nextSlug)); await load(); if (page.value === 'ziwei-connect') await loadZiweiConnect(); }
async function createWorkspace(payload) {
  try {
    const result = await api.createWorkspace(payload);
    const memberships = [...(authState.value.memberships || []), result.membership].filter((item, index, list) => item?.slug && list.findIndex(candidate => candidate.slug === item.slug) === index);
    authState.value = { ...authState.value, memberships };
    setWorkspaceSlug(result.workspace.slug);
    summary.value = { ...summary.value, workspace: result.workspace };
    history.pushState({},'',routePath(page.value));
    await load();
    notify(`项目“${result.workspace.name}”已创建`);
  } catch (error) { notify(error.message); }
}
function dismissToast() { toast.value = ''; if (toastTimer) { window.clearTimeout(toastTimer); toastTimer = null; } }
function notify(message, tone = 'success') { dismissToast(); toastTone.value = tone; toast.value = String(message || ''); toastTimer = window.setTimeout(dismissToast, 3200); }
async function refreshAuth() {
  try {
    const status = await api.authStatus();
    authState.value = { ...authState.value, ...status, configured:!status.setup_required, loading:false };
    authMode.value = status.setup_required ? 'setup' : (inviteQuery.get('code') ? 'register' : 'login');
    if (status.memberships?.length && !localStorage.getItem('ziwei.workspace')) setWorkspaceSlug(status.memberships[0].workspace_slug || status.memberships[0].slug);
  } catch {
    authState.value = { ...authState.value, loading:false, configured:false, setup_required:false, authenticated:false };
    authMode.value = inviteQuery.get('code') ? 'register' : 'login';
  }
}
async function submitAuth() {
  if (authBusy.value) return;
  authError.value='';
  if (!/^\S+@\S+\.\S+$/.test(authForm.value.email.trim())) return showAuthError('请输入有效的邮箱');
  if (!authForm.value.password) return showAuthError('请输入密码');
  const creatingAccount = authMode.value === 'setup' || authMode.value === 'register';
  if (creatingAccount && authForm.value.password.length < 8) return showAuthError('密码至少需要 8 位');
  if (creatingAccount && authForm.value.password !== authForm.value.confirmPassword) return showAuthError('两次密码不一致，请重新确认后提交');
  authBusy.value = true;
  try {
    const mode = authMode.value;
    const result = authMode.value === 'setup'
      ? await api.authSetup({ ...(authForm.value.name.trim() ? { name:authForm.value.name.trim() } : {}), email:authForm.value.email, password:authForm.value.password })
      : authMode.value === 'register'
        ? await api.authRegister({ ...(authForm.value.name.trim() ? { name:authForm.value.name.trim() } : {}), email:authForm.value.email, password:authForm.value.password, ...(authWorkspaceSlug.value.trim() ? { workspaceSlug:authWorkspaceSlug.value.trim() } : {}), ...(authForm.value.invitationCode.trim() ? { invitationCode:authForm.value.invitationCode.trim() } : {}) })
        : await api.authLogin({ email:authForm.value.email, password:authForm.value.password });
    authState.value = { ...authState.value, ...result, setup_required:false, configured:true, authenticated:true, loading:false };
    const targetSlug = result.memberships?.find(item => item.slug === authWorkspaceSlug.value.trim())?.slug || result.memberships?.[0]?.slug;
    if (targetSlug) setWorkspaceSlug(targetSlug);
    authForm.value = { name:'', email:'', password:'', confirmPassword:'', invitationCode:'' };
    if (mode === 'login' && page.value === 'invite-accept') await loadInvite();
    else if (targetSlug) await enterWorkspace(targetSlug);
  } catch (error) { await showAuthError(error.message); } finally { authBusy.value=false; }
}
async function createFirstWorkspace() {
  if (!firstWorkspaceForm.value.name.trim() || firstWorkspaceBusy.value) return notify('请填写工作区名称');
  firstWorkspaceBusy.value = true;
  try {
    await createWorkspace(firstWorkspaceForm.value);
    if (authState.value.memberships?.length) firstWorkspaceForm.value = { name:'', slug:'', kind:'personal' };
  } finally { firstWorkspaceBusy.value = false; }
}
async function logout() { try { await api.authLogout(); authState.value={...authState.value,authenticated:false,user:null}; closeRealtime(); stopConversationPolling(); } catch(error) { notify(error.message); } }
function stopConversationPolling() { if (conversationPollTimer) { clearInterval(conversationPollTimer); conversationPollTimer=null; } }
function closeRealtime() { eventSource.value?.close?.(); eventSource.value=null; }
async function changeLanguage(value) {
  if (!value || workspaceLanguage.value === value) return;
  workspaceLanguage.value = value;
  applyDisplayPreferences();
  try { await api.updatePreferences({ language:value }); } catch (error) { notify(error.message); }
}
function openRealtime() {
  closeRealtime();
  if (!authState.value.authenticated) return;
  eventSource.value = connectWorkspaceRealtime({
    wsUrl: api.websocketUrl(), sseUrl: api.streamUrl(),
    onReady: loadNotifications,
    onEvent: () => { loadNotifications(); refreshTasks(); if (selectedConversation.value) refreshSelectedConversation(); }
  });
}
onUnmounted(() => { closeRealtime(); stopConversationPolling(); stopVoiceInput(); if (ziweiConnectRunTimer) clearTimeout(ziweiConnectRunTimer); ziweiConnectRunTimer=null; dismissToast(); });
async function loadNotifications() { try { const result=await api.notifications(); notifications.value=result.notifications || []; notificationStats.value=result.stats || {}; } catch {} }
async function refreshTasks() { try { const result=await api.tasks(); tasks.value=result.tasks || []; } catch {} }
async function markAllNotificationsRead() { try { await api.markNotificationsRead(); await loadNotifications(); notify('已全部标记为已读'); } catch(error) { notify(error.message); } }
async function loadConversations({ autoSelect=true } = {}) {
  try {
    const result=await api.conversations(conversationEmployeeId.value);
    conversations.value=result.conversations || [];
    const routeId = conversationIdFromPath();
    const routedItem = routeId && conversations.value.find(item => item.id === routeId);
    if (routedItem) await openConversation(routedItem, { push:false });
    else if (autoSelect && !selectedConversation.value && conversations.value[0]) await openConversation(conversations.value[0], { push:false });
    else if (!conversations.value.some(item => item.id === selectedConversation.value?.id)) {
      selectedConversation.value=null; conversationExecution.value=null; stopConversationPolling();
    }
  } catch {}
}
async function loadConversationExecution({ silent=true } = {}) {
  const conversationId = selectedConversation.value?.id;
  if (!conversationId) { conversationExecution.value=null; return null; }
  if (!silent) conversationStatusLoading.value=true;
  try {
    // The conversation endpoint includes the latest linked A2A action and its
    // progress events. This keeps the UI session-authenticated and avoids
    // exposing the daemon-only A2A action list to the browser.
    if (selectedConversation.value?.id === conversationId && selectedConversation.value.execution !== undefined) {
      conversationExecution.value=selectedConversation.value.execution || null;
      return conversationExecution.value;
    }
    // Older API instances do not expose execution metadata yet. Keep the
    // session usable without calling the daemon-only A2A action endpoint.
    conversationExecution.value=null;
    return conversationExecution.value;
  } catch { return null; }
  finally { conversationStatusLoading.value=false; }
}
async function refreshSelectedConversation() {
  const conversationId=selectedConversation.value?.id;
  if (!conversationId) return;
  try {
    const conversation=await api.conversation(conversationId);
    if (selectedConversation.value?.id === conversationId) selectedConversation.value=conversation;
  } catch {}
  await loadConversationExecution();
}
function startConversationPolling() {
  stopConversationPolling();
  if (!selectedConversation.value) return;
  // Realtime is preferred, but polling keeps the status and reply visible when
  // the local daemon is busy or the browser's WebSocket/SSE is unavailable.
  conversationPollTimer=setInterval(async () => {
    if (!selectedConversation.value || page.value !== 'inbox') return stopConversationPolling();
    await refreshSelectedConversation();
    if (!conversationExecutionBusy.value) stopConversationPolling();
  }, 1500);
}
async function openConversation(item, { push=true } = {}) {
  const id = typeof item === 'string' ? item : item?.id;
  if (!id) return;
  clearConversationAttachment();
  try {
    selectedConversation.value=await api.conversation(id);
    conversationModelId.value=selectedConversation.value.model_id || '';
    conversationWorkingDirectory.value=selectedConversation.value.working_directory || '';
    conversationDeviceId.value=selectedConversation.value.device_id || devices.value.find(device => device.status === 'online')?.id || devices.value[0]?.id || '';
    if (!conversationWorkingDirectory.value && conversationDeviceId.value) conversationWorkingDirectory.value=devices.value.find(device => device.id === conversationDeviceId.value)?.workdir || '';
    if (selectedConversation.value.employee_id) conversationEmployeeId.value=selectedConversation.value.employee_id;
    else if (selectedConversation.value.employee_binding === 'unassigned_legacy') conversationEmployeeId.value='unassigned';
    conversationRouteId.value=id;
    if (push && page.value === 'inbox') history.pushState({},'',`${routePath('inbox', id)}?employee=${encodeURIComponent(conversationEmployeeId.value)}`);
    await loadConversationExecution({ silent:false });
    if (conversationExecutionBusy.value) startConversationPolling(); else stopConversationPolling();
  } catch(error) { notify(error.message); }
}
async function createConversation() {
  try {
    const employee=activeConversationEmployee.value;
    if (!employee?.id) return notify(conversationEmployeeId.value === 'unassigned' ? '历史未绑定会话不能新建消息，请先选择数字员工' : '请先选择数字员工');
    const defaultDevice=devices.value.find(device => device.id === conversationDeviceId.value) || devices.value.find(device => device.status === 'online') || devices.value[0];
    conversationDeviceId.value=defaultDevice?.id || '';
    const item=await api.createConversation({title:`${employee.name || '数字伙伴'} 对话`,employeeId:employee.id,modelId:employee.model_id || employee.modelId || null,deviceId:defaultDevice?.id || null,workingDirectory:defaultDevice?.workdir || null});
    conversations.value=[item,...conversations.value];
    await openConversation(item);
  } catch(error) { notify(error.message); }
}
async function openEmployeeConversation(employee) {
  if (!employee?.id) return;
  try {
    conversationEmployeeId.value=employee.id;
    history.pushState({},'',`${routePath('inbox')}?employee=${encodeURIComponent(employee.id)}`);
    selectedConversation.value=null; conversationExecution.value=null; stopConversationPolling();
    await loadConversations({ autoSelect:false });
    let item=conversations.value.find(entry => entry.employee_id === employee.id);
    if (!item) {
      const defaultDevice=devices.value.find(device => device.status === 'online') || devices.value[0];
      item=await api.createConversation({title:`${employee.name || '数字伙伴'} 对话`,employeeId:employee.id,deviceId:defaultDevice?.id || null,workingDirectory:defaultDevice?.workdir || null,modelId:employee.model_id || employee.modelId || null});
      conversations.value=[item,...conversations.value];
    }
    page.value='inbox';
    await openConversation(item);
  } catch(error) { notify(error.message); }
}
async function selectConversationEmployee(employeeId) {
  const value=String(employeeId || '').trim();
  if (!value || value === conversationEmployeeId.value) return;
  conversationEmployeeId.value=value;
  selectedConversation.value=null; conversationExecution.value=null; conversationDraft.value=''; clearConversationAttachment(); stopConversationPolling();
  history.pushState({},'',`${routePath('inbox')}?employee=${encodeURIComponent(value)}`);
  await loadConversations({ autoSelect:true });
}
async function archiveSelectedConversation() {
  if (!selectedConversation.value) return;
  try {
    await api.archiveConversation(selectedConversation.value.id);
    selectedConversation.value = null;
    conversationExecution.value = null;
    conversationRouteId.value = '';
    clearConversationAttachment();
    stopConversationPolling();
    history.pushState({},'',routePath('inbox'));
    await loadConversations({ autoSelect:false });
    notify('会话已归档');
  } catch(error) { notify(error.message); }
}
async function sendConversationMessage() {
  const content=conversationDraft.value.trim();
  if((!content && !conversationAttachment.value) || !selectedConversation.value) return;
  try {
    const employee=employees.value.find(item => item.id === selectedConversation.value.employee_id) || null;
    if (!employee) return notify('该历史会话没有明确数字员工归属，不能发送消息');
    const message=await api.addConversationMessage(selectedConversation.value.id,{role:'user',content,runtime:employee?.runtime || null,model:conversationModelId.value || employee?.model_id || employee?.modelId || null,cwd:conversationWorkingDirectory.value || null,targetDeviceId:conversationDeviceId.value || null,attachments:conversationAttachment.value ? [conversationAttachment.value] : []});
    selectedConversation.value.messages=[...(selectedConversation.value.messages||[]),message];
    conversationDraft.value='';
    conversationAttachment.value=null; conversationAttachmentName.value='';
    // The action is created by the API in the same request. Re-read the
    // conversation now so its execution field reflects the real pending state
    // before the daemon acknowledges it.
    await refreshSelectedConversation();
    startConversationPolling();
    notify('消息已发送，等待数字伙伴回复');
  } catch(error) { notify(error.status === 413 ? '附件太大，请选择 10 MB 以内的图片后重试' : error.message, 'error'); }
}
async function saveConversationSettings({ notifyUser = true } = {}) {
  if (!selectedConversation.value?.id) return false;
  try {
    selectedConversation.value=await api.updateConversation(selectedConversation.value.id,{modelId:conversationModelId.value || null,deviceId:conversationDeviceId.value || null,workingDirectory:conversationWorkingDirectory.value || null});
    if (notifyUser) notify('会话配置已保存');
    return true;
  } catch (error) { notify(error.message); return false; }
}
function selectConversationDevice(deviceId) {
  conversationDeviceId.value=String(deviceId || '');
  const device=devices.value.find(item => item.id === conversationDeviceId.value);
  if (device?.workdir) conversationWorkingDirectory.value=device.workdir;
  void saveConversationSettings();
}
function closeConversationDirectoryPicker() {
  conversationDirectoryPickerOpen.value=false;
  conversationDirectoryLoading.value=false;
  conversationDirectoryAction.value=null;
  conversationDirectoryInspection.value=null;
}
async function waitConversationDirectoryAction(action) {
  let current=action;
  for (let attempt=0; current && !['succeeded','failed','expired'].includes(current.status) && attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const response=await api.conversationDirectoryAction(selectedConversation.value.id, current.id);
    current=response?.action || response;
    conversationDirectoryAction.value=current;
  }
  if (!current || ['failed','expired'].includes(current.status)) throw new Error(current?.error || '工作目录检查失败');
  if (current.status !== 'succeeded') throw new Error('工作目录检查仍在等待目标设备响应');
  return current.result || {};
}
async function inspectConversationDirectory(directoryPath = conversationDirectoryPathDraft.value, createIfMissing = false) {
  if (!selectedConversation.value?.id || !conversationDeviceId.value) return notify('请先选择在线目标设备', 'error');
  conversationDirectoryLoading.value=true;
  try {
    const response=await api.inspectConversationDirectory(selectedConversation.value.id,{deviceId:conversationDeviceId.value,path:String(directoryPath || '').trim(),createIfMissing,idempotencyKey:`directory-${Date.now()}-${Math.random().toString(16).slice(2)}`});
    const action=response?.action || response;
    conversationDirectoryAction.value=action;
    const result=await waitConversationDirectoryAction(action);
    conversationDirectoryInspection.value=result;
    if (result.path) conversationDirectoryPathDraft.value=result.path;
    return result;
  } catch (error) { notify(error.message, 'error'); return null; }
  finally { conversationDirectoryLoading.value=false; }
}
function openConversationDirectoryPicker() {
  if (!selectedConversationDevice.value || selectedConversationDevice.value.status !== 'online') return notify('目标设备当前离线，无法读取目录', 'error');
  conversationDirectoryPickerOpen.value=true;
  conversationDirectoryPathDraft.value=conversationWorkingDirectory.value || selectedConversationDevice.value.workdir || '';
  conversationDirectoryInspection.value=null;
  void inspectConversationDirectory(conversationDirectoryPathDraft.value);
}
async function useConversationDirectory(result = conversationDirectoryInspection.value) {
  if (!result?.exists || !result.isDirectory || !result.path) return notify('请先选择一个存在的目录，或创建缺失目录', 'error');
  conversationWorkingDirectory.value=result.path;
  const saved=await saveConversationSettings({ notifyUser:false });
  if (!saved) return;
  closeConversationDirectoryPicker();
  notify(`工作目录已切换为 ${result.path}`);
}
async function createAndUseConversationDirectory() {
  const result=await inspectConversationDirectory(conversationDirectoryPathDraft.value, true);
  if (result?.exists) await useConversationDirectory(result);
}
function openConversationAttachmentPicker() { conversationAttachmentInput.value?.click(); }
function conversationAttachmentMime(attachment) { return String(attachment?.mimeType || attachment?.mime_type || '').toLowerCase(); }
function conversationAttachmentPreviewSrc(attachment) {
  const mime=conversationAttachmentMime(attachment);
  const content=String(attachment?.content || attachment?.data || '').trim();
  if (!['image/png','image/jpeg','image/gif','image/webp'].includes(mime) || !/^[A-Za-z0-9+/]*={0,2}$/.test(content) || !content) return '';
  return `data:${mime};base64,${content}`;
}
function conversationAttachmentSizeLabel(attachment) {
  const size=Number(attachment?.size || 0);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
async function handleConversationAttachment(event) {
  const file=event.target.files?.[0]; if (!file) return;
  if (file.size > 10 * 1024 * 1024) { notify('附件不能超过 10 MB', 'error'); event.target.value=''; return; }
  try {
    const bytes=new Uint8Array(await file.arrayBuffer()); let binary='';
    for (let index=0; index<bytes.length; index+=0x8000) binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));
    conversationAttachment.value={name:file.name,mimeType:file.type || 'application/octet-stream',content:btoa(binary),contentEncoding:'base64'};
    conversationAttachmentName.value=file.name;
  } catch (error) { notify(error.message, 'error'); }
  finally { event.target.value=''; }
}
function clearConversationAttachment() { conversationAttachment.value=null; conversationAttachmentName.value=''; }
function cycleIssueFilter() { issueFilter.value = issueFilter.value === 'all' ? 'high' : issueFilter.value === 'high' ? 'medium' : 'all'; notify(`任务筛选：${issueFilter.value === 'all' ? '全部' : issueFilter.value === 'high' ? '高优先级' : '普通'}`); }
function toggleIssueView() { issueView.value = issueView.value === 'board' ? 'list' : 'board'; notify(`已切换为${issueView.value === 'board' ? '看板' : '列表'}视图`); }
function resetIssueFilters() { selectedStates.value=[]; selectedPriorities.value=[]; issueFilter.value='all'; }
function applyIssueFilters() { issueFilterOpen.value=false; notify('筛选条件已应用'); }
function openQuickSearch() { showSearch.value=true; }
function addTaskInLane(state='planned') { taskForm.value={title:'',description:'',priority:'medium',dueDate:'',state}; showTask.value=true; }
function setIssueView(view) { issueView.value=view; issueViewOpen.value=false; }
function toggleQuickTray(name) { quickTrayMenu.value = quickTrayMenu.value === name ? '' : name; }
function closeQuickTray() { quickTrayMenu.value = ''; }
function quickTrayAction(name, action) {
  closeQuickTray();
  if (action === 'task') return addTaskInLane();
  if (action === 'search') return openQuickSearch();
  if (action === 'inbox') return navigate('inbox');
  if (action === 'calendar') return navigate('calendar');
  if (action === 'event') return openCalendarEvent(localDateKey(calendarCursor.value));
  if (action === 'upload') return openDocUpload();
  if (action === 'folder') return openDocForm('folder');
  if (action === 'device') return openDeviceModal(false);
  if (action === 'employee') return openEmployeeModal();
}
function employeesForRuntime(runtime) {
  const runtimeName = runtime?.name || runtime?.runtime || '';
  if (!runtimeName) return [];
  return (Array.isArray(employees.value) ? employees.value : []).filter(employee => {
    const employeeRuntime = employee?.runtime || employee?.runtime_name || '';
    return String(employeeRuntime).toLowerCase() === String(runtimeName).toLowerCase();
  });
}
function openHelp() { notify('帮助中心：请查看 README.md 与完整复刻流程文档'); }
function openProfile() { notify(`当前账号：${currentAccount.value.name || currentAccount.value.email || '当前账号'} · ${currentAccount.value.role || 'member'}`); }
async function copyInviteLink() { const link = `${location.origin}/invite?workspace=${encodeURIComponent(workspaceSlugValue.value)}`; try { await navigator.clipboard?.writeText(link); } catch {} notify('邀请链接已复制'); }
const deviceApiBase = computed(() => String(API_BASE || location.origin).replace(/\/+$/, ''));
const deviceServerCertificateUrl = computed(() => {
  try { return new URL('/server.crt', deviceApiBase.value).toString(); } catch { return `${location.origin}/server.crt`; }
});
const deviceCertificateRequired = computed(() => {
  try {
    const url = new URL(deviceApiBase.value);
    const host = url.hostname.toLowerCase();
    return url.protocol !== 'https:' || host === 'localhost' || host === '127.0.0.1' || host === '::1' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  } catch { return true; }
});
const deviceWorkspaceSlug = computed(() => String(workspaceSlugValue.value || '').trim());
function cmdLiteral(value) { return `"${String(value).replace(/"/g, '\\"')}"`; }
function shellLiteral(value) { return `'${String(value).replace(/'/g, "'\\''")}'`; }
const daemonPackageSource = 'https://github.com/jinjinli226-netizen/ziwei/archive/refs/heads/codex/hermes-independent-profile.tar.gz';
const deviceInstallCommands = computed(() => {
  const apiBase = deviceApiBase.value;
  const pairingCode = devicePairing.value?.code || '<页面生成的一次性配对码>';
  const deviceName = deviceForm.value.name.trim() || '这台电脑';
  const commands = {
    windows: `ziwei_user connect --api ${cmdLiteral(apiBase)} --code ${cmdLiteral(pairingCode)} --name ${cmdLiteral(deviceName)}\nziwei_user start`,
    macos: `ziwei_user connect --api ${shellLiteral(apiBase)} --code ${shellLiteral(pairingCode)} --name ${shellLiteral(deviceName)}\nziwei_user start`,
    linux: `ziwei_user connect --api ${shellLiteral(apiBase)} --code ${shellLiteral(pairingCode)} --name ${shellLiteral(deviceName)}\nziwei_user start`
  };
  if (deviceCommandMode.value !== 'first') return commands;
  return {
    windows: `npm install --global ${cmdLiteral(daemonPackageSource)}\n${commands.windows}`,
    macos: `npm install --global ${shellLiteral(daemonPackageSource)}\n${commands.macos}`,
    linux: `npm install --global ${shellLiteral(daemonPackageSource)}\n${commands.linux}`
  };
});
async function copyDeviceCommand() { const command = deviceInstallCommands.value[deviceInstallTab.value]; try { await navigator.clipboard?.writeText(command); } catch {} copiedDeviceCommand.value=deviceInstallTab.value; notify('安装命令已复制'); }
async function createDevicePairing() {
  if (!authState.value.authenticated || devicePairingBusy.value) return;
  devicePairingBusy.value = true;
  devicePairing.value = null;
  try {
  devicePairing.value = await api.createDevicePairing({ name: deviceForm.value.name || '这台电脑', os: navigator.platform || 'unknown', ttlMs: 10 * 60 * 1000 });
  } catch (error) {
    notify(error.message);
  } finally {
    devicePairingBusy.value = false;
  }
}
async function copyDevicePairing() { const code = devicePairing.value?.code; if (!code) return; try { await navigator.clipboard?.writeText(code); } catch {} notify('配对码已复制'); }
function openDeviceModal(setup = false) { deviceSetupMode.value = setup; showDevice.value = true; void createDevicePairing(); }
function closeDeviceModal() { showDevice.value = false; deviceSetupMode.value = false; }
function openDeviceEditor(device) {
  if (!device?.id) return;
  deviceEditForm.value = { id:device.id, name:String(device.name || '').trim(), os:String(device.os || 'Windows') };
  showDeviceEditor.value = true;
}
async function saveDeviceEditor() {
  const draft = deviceEditForm.value;
  if (!draft.id || !draft.name.trim()) return notify('请填写设备名称');
  try {
    await api.updateDevice(draft.id, { name:draft.name.trim(), os:draft.os });
    showDeviceEditor.value = false;
    await load();
    notify('设备名称已保存');
  } catch (error) { notify(error.message); }
}
function deviceSetupDismissedKey() {
  const userKey = authState.value.user?.id || authState.value.user?.email || 'anonymous';
  const workspaceKey = workspaceSlugValue.value || workspaceSlug();
  return `ziwei.deviceSetupDismissed:${encodeURIComponent(String(userKey))}:${encodeURIComponent(String(workspaceKey))}`;
}
function dismissDeviceSetup() { try { localStorage.setItem(deviceSetupDismissedKey(), '1'); } catch {} closeDeviceModal(); }
function openSkillCatalog() { skillScope.value='platform'; skillTab.value='all'; notify('已打开平台技能目录'); }
async function load() {
  loading.value = true;
  try {
    const activeWorkspace = workspaceSlug();
    // Keep stale response data from a previous workspace from rendering while
    // the URL-scoped requests are in flight.
    if (activeWorkspace && summary.value.workspace?.slug !== activeWorkspace) {
      summary.value = { ...summary.value, workspace: { ...summary.value.workspace, slug: activeWorkspace } };
    }
    const activeMembership = (authState.value.memberships || []).find(item => item?.slug === activeWorkspace) || authState.value.memberships?.[0];
    // The active workspace membership is authoritative. A user may own one
    // personal workspace while only being a member of a different team.
    const workspaceRole = activeMembership?.role || authState.value.role || '';
    const canReadWorkspaceSettings = ['owner','admin'].includes(String(workspaceRole).toLowerCase());
    const settingsRequest = canReadWorkspaceSettings
      ? api.settings()
      : Promise.resolve({ workspace: { name: summary.value.workspace?.name || activeWorkspace, timezone: summary.value.workspace?.timezone || 'Asia/Shanghai', preferences: {} } });
    const [s,t,r,mo,sk,d,a,m,dev,e,c,st,ag] = await Promise.all([api.summary(),api.tasks(),api.runtimes(),api.models(),api.skills(),api.documents(),api.automations(),api.members(),api.devices(),api.employees(),api.calendar(),settingsRequest,api.agents()]);
    const runtimeRows = Array.isArray(r?.runtimes) ? r.runtimes.filter(item => item && typeof item === 'object') : [];
    summary.value=s; tasks.value=t.tasks; runtimes.value=runtimeRows; models.value=mo.models; skills.value=sk.skills; documents.value=d.documents; automations.value=a.automations; members.value=m.members; devices.value=dev.devices; conversationDeviceId.value=devices.value.find(device => device.status === 'online')?.id || devices.value[0]?.id || ''; employees.value=Array.isArray(e?.employees) ? e.employees.filter(item => item && typeof item === 'object') : []; if (!conversationEmployeeId.value) conversationEmployeeId.value=employees.value[0]?.id || 'unassigned'; calendar.value=c.calendars; settings.value=st; workspaceName.value=st.workspace.name; workspaceTimezone.value=st.workspace.timezone; workspaceDescription.value=st.workspace.description || ''; workspaceContext.value=st.workspace.context || ''; workspaceVisibility.value=st.workspace.visibility || 'workspace'; workspacePrefix.value=st.workspace.prefix || ''; profileName.value=st.workspace.profile?.name || authState.value.user?.name || ''; workspaceLanguage.value=st.workspace.preferences?.language || 'zh-CN'; workspaceTheme.value=st.workspace.preferences?.theme || 'light'; workspaceWeekStart.value=st.workspace.preferences?.weekStart || 'monday'; switchValue.value = st.workspace.preferences?.daemonHeartbeat !== false; automationDefaultMode.value = st.workspace.preferences?.automationDefaultMode || 'notification'; agents.value=ag.agents;
    await Promise.all([loadNotifications(),loadConversations()]);
    openRealtime();
  } catch (error) { notify(error.message); } finally { loading.value=false; }
}
function connectRows(result, key) {
  if (Array.isArray(result?.[key])) return result[key].filter(item => item && typeof item === 'object');
  return Array.isArray(result) ? result.filter(item => item && typeof item === 'object') : [];
}
function connectDiagnosticRows(value) {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object');
  if (!value || typeof value !== 'object') return [];
  return [{ id:'ziwei-connect-summary', name:'控制 API', status:value.ok === false ? 'error' : 'ok', message:`在线设备 ${value.onlineDevices ?? 0} / ${value.totalDevices ?? 0}${value.sampledAt ? ` · ${value.sampledAt}` : ''}` }];
}
function connectDeviceOnline(device) { return device?.online === true || ['online','ready','connected'].includes(String(device?.status || '').toLowerCase()); }
function connectRunStatus(run) {
  return String(run?.status || run?.state || 'pending').toLowerCase();
}
function connectRunLabel(run) {
  const status = connectRunStatus(run);
  return status === 'succeeded' || status === 'success' || status === 'completed' || status === 'dry_run' ? '已完成' : status === 'acknowledged' ? '已人工核实' : status === 'cancelled' ? '已取消' : status === 'accepted' || status === 'acked' ? '已受理' : status === 'failed' || status === 'error' ? '失败' : status === 'uncertain' ? '待核验' : status === 'expired' ? '已过期' : '执行中';
}
function connectCommandId(run) { return run?.command_id || run?.commandId || ''; }
function connectRunTagStatus(run) { const status = connectRunStatus(run); return ['succeeded','success','completed','dry_run'].includes(status) ? 'online' : ['failed','error','uncertain'].includes(status) ? 'failed' : 'neutral'; }
function connectRunError(run) { return run?.error || run?.result?.error || ''; }
function connectRunVerificationError(run) { const value = run?.verificationError || run?.verification_error || run?.result?.verificationError || run?.result?.verification_error; return value ? (typeof value === 'string' ? value : JSON.stringify(value)) : ''; }
function connectRunReceipt(run) { const value = run?.receipt || run?.result?.receipt || run?.result?.acknowledgedReceipt || run?.result?.acknowledged; return value ? (typeof value === 'string' ? value : JSON.stringify(value)) : ''; }
function connectSnapshotSrc(run) {
  const snapshot = run?.snapshot || run?.result?.snapshot || run?.result?.screenshot || run?.result?.image;
  if (!snapshot) return '';
  if (typeof snapshot === 'string') return snapshot;
  const data = snapshot.data || snapshot.base64 || snapshot.content;
  if (data) return String(data).startsWith('data:') ? String(data) : `data:${snapshot.mime || snapshot.mimeType || snapshot.mime_type || 'image/png'};base64,${data}`;
  return '';
}
async function loadZiweiConnect() {
  if (!authState.value.authenticated || ziweiConnectLoading.value) return;
  ziweiConnectLoading.value = true;
  ziweiConnectState.value = 'loading'; ziweiConnectError.value = '';
  try {
    const [status, bindings, runs] = await Promise.all([api.ziweiConnectStatus(), api.ziweiConnectBindings(), api.ziweiConnectRuns()]);
    ziweiConnectStatus.value = { source:status?.source || null, devices:connectRows(status, 'devices'), diagnostics:connectDiagnosticRows(status?.diagnostics), bindings:connectRows(status, 'bindings') };
    ziweiConnectBindings.value = connectRows(bindings, 'bindings').length ? connectRows(bindings, 'bindings') : ziweiConnectStatus.value.bindings;
    const historicalRuns = connectRows(runs, 'runs');
    ziweiConnectRuns.value = Object.fromEntries(historicalRuns.map(run => [connectRunId(run), run]).filter(([id]) => id));
    const firstBinding = ziweiConnectBindings.value[0];
    const preferredDevice = ziweiConnectStatus.value.devices.find(item => ['online','ready','connected'].includes(String(item.status || '').toLowerCase())) || ziweiConnectStatus.value.devices[0];
    if (!ziweiConnectSelection.value.deviceId) ziweiConnectSelection.value.deviceId = firstBinding?.device_id || firstBinding?.deviceId || preferredDevice?.id || '';
    const selectedBinding = ziweiConnectBindings.value.find(binding => (binding.device_id || binding.deviceId) === ziweiConnectSelection.value.deviceId);
    if (!ziweiConnectSelection.value.employeeId) ziweiConnectSelection.value.employeeId = selectedBinding?.employee_id || selectedBinding?.employeeId || employees.value[0]?.id || '';
    if (selectedBinding && !ziweiConnectSelection.value.accountId) ziweiConnectSelection.value.accountId = selectedBinding.account_id || selectedBinding.accountId || '';
    if (selectedBinding && !ziweiConnectSelection.value.accountLabel) ziweiConnectSelection.value.accountLabel = selectedBinding.account_label || selectedBinding.accountLabel || '';
    ziweiConnectState.value = 'ready';
  } catch (error) { ziweiConnectState.value = 'error'; ziweiConnectError.value = error?.message || '紫薇·互联控制 API 暂时不可达'; notify(ziweiConnectError.value, 'error'); }
  finally { ziweiConnectLoading.value = false; }
}
function updateTerminalDevices(deviceRows) {
  ziweiConnectStatus.value = { ...ziweiConnectStatus.value, devices:deviceRows };
}
function selectTerminalDevice(device) {
  const deviceId = device?.id || '';
  if (deviceId === ziweiConnectSelection.value.deviceId) return;
  const binding = ziweiConnectBindings.value.find(item => (item.device_id || item.deviceId) === deviceId);
  ziweiConnectSelection.value = { employeeId:binding?.employee_id || binding?.employeeId || employees.value[0]?.id || '', deviceId, accountId:binding?.account_id || binding?.accountId || '', accountLabel:binding?.account_label || binding?.accountLabel || '' };
}
async function refreshResolvedTerminalRun({ commandId }) {
  const matching = Object.values(ziweiConnectRuns.value).filter(run => connectCommandId(run) === commandId);
  await Promise.all(matching.map(run => pollZiweiConnectRun(run)));
}
function terminalDeviceBindings(deviceId) { return ziweiConnectBindings.value.filter(item => (item.device_id || item.deviceId) === deviceId); }
function selectZiweiConnectBinding(binding) {
  ziweiConnectSelection.value = { employeeId:binding?.employee_id || binding?.employeeId || '', deviceId:binding?.device_id || binding?.deviceId || '', accountId:binding?.account_id || binding?.accountId || '', accountLabel:binding?.account_label || binding?.accountLabel || '' };
}
async function saveZiweiConnectBinding() {
  if (!canManageWorkspace.value) return;
  const employeeId = ziweiConnectSelection.value.employeeId;
  const deviceId = ziweiConnectSelection.value.deviceId;
  if (!employeeId || !deviceId) return notify('请选择数字员工和目标设备', 'error');
  ziweiConnectBusy.value = 'binding';
  try { await api.ziweiConnectBind({ employeeId, deviceId, accountId:ziweiConnectSelection.value.accountId.trim() || null, accountLabel:ziweiConnectSelection.value.accountLabel.trim() || null }); await loadZiweiConnect(); notify('绑定已保存'); }
  catch (error) { notify(error.message, 'error'); }
  finally { ziweiConnectBusy.value = ''; }
}
async function deleteZiweiConnectBinding(binding) {
  if (!canManageWorkspace.value || !binding?.id) return;
  if (typeof api.ziweiConnectDeleteBinding !== 'function') return notify('删除绑定接口尚未接入', 'error');
  ziweiConnectBusy.value = `delete:${binding.id}`;
  try { await api.ziweiConnectDeleteBinding(binding.id); await loadZiweiConnect(); notify('绑定已删除'); }
  catch (error) { notify(error?.message || '删除绑定失败', 'error'); }
  finally { ziweiConnectBusy.value = ''; }
}
function connectRunId(run) { return run?.id || run?.run_id || ''; }
async function pollZiweiConnectRun(run) {
  const id = connectRunId(run);
  if (!id) return run;
  try {
    const fresh = await api.ziweiConnectRun(id);
    const next = fresh?.run || fresh;
    ziweiConnectRuns.value = { ...ziweiConnectRuns.value, [id]: next };
    if (['pending','queued','delivered','executing','running','dispatched','acked','accepted'].includes(connectRunStatus(next))) {
      ziweiConnectRunTimer = setTimeout(() => void pollZiweiConnectRun(next), 1200);
    }
    return next;
  } catch (error) { notify(error.message, 'error'); return run; }
}
async function runZiweiConnectAction(action) {
  if (!canManageWorkspace.value) return;
  const employeeId = ziweiConnectSelection.value.employeeId;
  const deviceId = ziweiConnectSelection.value.deviceId || undefined;
  if (!employeeId) return notify('请选择数字员工', 'error');
  ziweiConnectBusy.value = action;
  try {
    const response = await api.ziweiConnectAction({ employeeId, ...(deviceId ? { deviceId } : {}), action });
    const run = response?.run || response;
    const id = connectRunId(run);
    if (id) ziweiConnectRuns.value = { ...ziweiConnectRuns.value, [id]: run };
    if (['pending','queued','delivered','executing','running','dispatched','acked','accepted'].includes(connectRunStatus(run))) void pollZiweiConnectRun(run);
    notify(`${action === 'health' ? '健康检查' : action === 'screenshot' ? '截图' : '演练'}已提交`);
  } catch (error) { notify(error.message, 'error'); }
  finally { ziweiConnectBusy.value = ''; }
}
async function createTask() { if (!taskForm.value.title.trim()) return notify('请填写任务标题'); await api.createTask({...taskForm.value, descriptionFormat:taskForm.value.descriptionFormat || 'plain'}); showTask.value=false; taskForm.value={title:'',description:'',descriptionFormat:'plain',priority:'medium',dueDate:'',state:'planned'}; await load(); notify('任务已创建'); }
async function createFromAgentComposer() {
  const description = agentComposerText.value.trim();
  if (!description) return;
  const firstLine = description.split(/\r?\n/).map(item => item.trim()).find(Boolean) || '数字伙伴任务';
  const title = firstLine.replace(/^新建任务[：:]?\s*/i, '').slice(0, 80) || '数字伙伴任务';
  try {
    const employee = employees.value.find(item => item.id === agentComposerEmployeeId.value) || null;
    // A task assigned to a local digital employee is dispatched through the
    // linked task.execute action. Keep the conversation as history only; its
    // user message is persisted below with dispatch:false so this submission
    // cannot execute the same prompt twice.
    const conversation = employee ? await api.createConversation({employeeId:employee.id,title}) : null;
    if (conversation) await api.addConversationMessage(conversation.id,{role:'user',content:description,attachments:agentComposerAttachment.value ? [agentComposerAttachment.value] : [],runtime:employee.runtime,model:employee.model_id || null,dispatch:false});
    const task = await api.createTask({ title, description, descriptionFormat:'plain', priority:'medium', state:'planned', assignee:employee?.name || null, employeeId:employee?.id || null, execute:Boolean(employee), runtime:employee?.runtime || null, model:employee?.model_id || employee?.modelId || null, targetDeviceId:agentComposerDeviceId.value || null, conversationId:conversation?.id || null });
    if (agentComposerAttachment.value && task?.id) await api.uploadTaskAttachment(task.id, agentComposerAttachment.value);
    closeAgentComposer();
    agentComposerAttachment.value=null; agentComposerAttachmentName.value='';
    await load();
    if (conversation?.id) {
      // The composer is only the entry point. A real persistent conversation
      // is opened after creation so the user can continue the same Codex-like
      // session and see the agent's replies as A2A results arrive.
      navigate('inbox');
      await openConversation({id:conversation.id});
    }
    notify(conversation?.id ? '已创建任务，已进入持久会话' : '已创建任务，等待数字伙伴执行');
  } catch (error) { notify(error.message); }
}
function openAgentComposerAttachmentPicker() { agentComposerAttachmentInput.value?.click(); }
async function handleAgentComposerAttachment(event) { const file=event.target.files?.[0]; if (!file) return; if (file.size > 10 * 1024 * 1024) { notify('附件不能超过 10 MB'); event.target.value=''; return; } try { const bytes=new Uint8Array(await file.arrayBuffer()); let binary=''; for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); agentComposerAttachment.value={name:file.name,mimeType:file.type || 'application/octet-stream',content:btoa(binary),contentEncoding:'base64'}; agentComposerAttachmentName.value=file.name; } catch (error) { notify(error.message); } finally { event.target.value=''; } }
async function loadApiKeys() { try { apiKeys.value = (await api.apiKeys()).keys || []; } catch (error) { notify(error.message); } }
function openApiKeyModal() { apiKeyForm.value={name:'紫薇 CLI',role:'member',expiresAt:''}; createdApiToken.value=''; showApiKeys.value=true; loadApiKeys(); }
async function createApiKey() {
  if (!apiKeyForm.value.name.trim()) return notify('请填写 API Key 名称');
  try {
    const result = await api.createApiKey({name:apiKeyForm.value.name.trim(),role:apiKeyForm.value.role,expiresAt:apiKeyForm.value.expiresAt || null});
    createdApiToken.value = result.token || '';
    apiKeyForm.value.name='';
    await loadApiKeys();
    notify('API Key 已创建，请立即复制密钥');
  } catch (error) { notify(error.message); }
}
async function revokeApiKey(key) { try { await api.revokeApiKey(key.id); await loadApiKeys(); notify('API Key 已撤销'); } catch (error) { notify(error.message); } }
async function rotateApiKey(key) { try { const result=await api.rotateApiKey(key.id,{name:key.name}); createdApiToken.value=result.token || ''; await loadApiKeys(); notify('API Key 已轮换，请立即复制新密钥'); } catch (error) { notify(error.message); } }
async function copyApiToken() { if (!createdApiToken.value) return; try { await navigator.clipboard?.writeText(createdApiToken.value); } catch {} notify('密钥已复制'); }
function taskDetailFrom(task) { return { title:task.title || '', description:task.description || '', descriptionFormat:task.description_format || task.descriptionFormat || 'plain', state:task.state || 'planned', priority:task.priority || 'medium', dueDate:task.due_date || task.dueDate || '', assignee:task.assignee || '', labels:Array.isArray(task.labels) ? [...task.labels] : [] }; }
function stopTaskDetailPolling() { if (taskDetailPollTimer) clearInterval(taskDetailPollTimer); taskDetailPollTimer=null; }
function startTaskDetailPolling() {
  stopTaskDetailPolling();
  if (!taskDetail.value?.id) return;
  taskDetailPollTimer=setInterval(async () => {
    if (!showTaskDetail.value || !taskDetail.value?.id) return stopTaskDetailPolling();
    try {
      const fresh=await api.task(taskDetail.value.id);
      taskDetail.value={...taskDetail.value,execution:fresh.execution,messages:fresh.messages};
      taskMessages.value=fresh.messages || [];
      if (!['pending','acked'].includes(fresh.execution?.status)) stopTaskDetailPolling();
    } catch {}
  }, 1500);
}
async function openTaskDetail(task) { try { const data=await api.task(task.id); taskDetail.value=data; taskMessages.value=data.messages || []; taskAttachments.value=data.attachments || (await api.taskAttachments(task.id)).attachments || []; taskDetailForm.value=taskDetailFrom(data); taskMessageDraft.value=''; showTaskDetail.value=true; if (['pending','acked'].includes(data.execution?.status)) startTaskDetailPolling(); } catch(error) { notify(error.message); } }
function closeTaskDetail() { stopTaskDetailPolling(); showTaskDetail.value=false; taskDetail.value=null; taskMessages.value=[]; taskAttachments.value=[]; }
async function saveTaskDetail() { if (!taskDetail.value || !taskDetailForm.value.title.trim()) return notify('请填写任务标题'); try { await api.updateTask(taskDetail.value.id,{...taskDetailForm.value,descriptionFormat:taskDetailForm.value.descriptionFormat,due_date:taskDetailForm.value.dueDate || null}); await load(); const fresh=await api.task(taskDetail.value.id); taskDetail.value=fresh; taskMessages.value=fresh.messages || []; taskAttachments.value=fresh.attachments || []; taskDetailForm.value=taskDetailFrom(fresh); notify('任务已保存'); } catch(error) { notify(error.message); } }
function insertTaskSyntax(prefix, suffix=prefix) { const el=document.querySelector('.task-detail-description'); if (!el) return; const start=el.selectionStart ?? el.value.length; const end=el.selectionEnd ?? start; const selected=el.value.slice(start,end) || '文本'; taskDetailForm.value.description=el.value.slice(0,start)+prefix+selected+suffix+el.value.slice(end); requestAnimationFrame(()=>{el.focus(); el.setSelectionRange(start+prefix.length,start+prefix.length+selected.length);}); }
async function sendTaskMessage() { if (!taskDetail.value || !taskMessageDraft.value.trim()) return; try { const data=await api.addTaskMessage(taskDetail.value.id,{role:'user',content:taskMessageDraft.value.trim()}); taskMessages.value=[...taskMessages.value,data.message || data]; taskMessageDraft.value=''; } catch(error) { notify(error.message); } }
function openTaskAttachmentPicker() { taskAttachmentInput.value?.click(); }
async function handleTaskAttachmentUpload(event) { const file=event.target.files?.[0]; if (!file || !taskDetail.value) return; try { const bytes=new Uint8Array(await file.arrayBuffer()); let binary=''; for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); const data=await api.uploadTaskAttachment(taskDetail.value.id,{name:file.name,mimeType:file.type || 'application/octet-stream',content:btoa(binary),contentEncoding:'base64'}); taskAttachments.value=[...taskAttachments.value,data.attachment || data]; notify('附件已上传'); } catch(error) { notify(error.message); } finally { event.target.value=''; } }
function downloadTaskAttachment(attachment) { const link=document.createElement('a'); link.href=api.downloadTaskAttachment(attachment.id); link.download=attachment.name; link.target='_blank'; link.rel='noopener'; document.body.appendChild(link); link.click(); link.remove(); }
async function removeTaskAttachment(attachment) { if (!taskDetail.value) return; try { await api.deleteTaskAttachment(attachment.id); taskAttachments.value=taskAttachments.value.filter(item=>item.id!==attachment.id); notify('附件已删除'); } catch(error) { notify(error.message); } }
async function moveTask(task, state) { try { await api.changeTaskState(task.id,state); await load(); return true; } catch (error) { notify(error.message); return false; } }
function openDocForm(type='file') { docForm.value={name:type === 'folder' ? '' : 'README.md',type,content:''}; showDoc.value=true; }
function openDocFolder(folder) { docsPath.value=folder.id; docsSearch.value=''; }
function openDocsRoot() { docsPath.value='root'; docsSearch.value=''; }
async function refreshDocs() { try { const result=await api.documents(); documents.value=result.documents || []; notify('文档已刷新'); } catch(error) { notify(error.message); } }
async function openDocument(item) { if(item.type==='folder') return openDocFolder(item); try { const loaded=await api.document(item.id); if (loaded.content_encoding === 'base64') { notify('二进制文件只能下载，不能在线编辑'); return; } docEditor.value=loaded; docEditorForm.value={id:item.id,name:docEditor.value.name,content:docEditor.value.content || '',type:docEditor.value.type}; documentVersions.value=(await api.documentVersions(item.id)).versions || []; showDocEditor.value=true; } catch(error) { notify(error.message); } }
async function saveDocument() { if(!docEditorForm.value.name.trim() || !docEditorForm.value.id) return; try { const result=await api.updateDocument(docEditorForm.value.id,{name:docEditorForm.value.name,content:docEditorForm.value.content}); docEditor.value=result.document || result; showDocEditor.value=false; await refreshDocs(); notify('文档已保存'); } catch(error) { notify(error.message); } }
async function trashDocument() { if(!docEditorForm.value.id) return; try { await api.deleteDocument(docEditorForm.value.id); showDocEditor.value=false; await refreshDocs(); notify('文档已移入回收站'); } catch(error) { notify(error.message); } }
async function restoreDocumentVersion(version) { try { await api.restoreDocumentVersion(docEditorForm.value.id,version.version ?? version.id); await openDocument({id:docEditorForm.value.id,type:'file'}); notify('已恢复文档版本'); } catch(error) { notify(error.message); } }
async function loadDocumentTrash() { try { documentTrash.value=(await api.documentTrash()).documents || []; } catch(error) { notify(error.message); } }
async function restoreTrashedDocument(item) { try { await api.restoreDocument(item.id); await refreshDocs(); await loadDocumentTrash(); notify('文档已恢复'); } catch(error) { notify(error.message); } }
function openDocUpload() { docUploadInput.value?.click(); }
async function handleDocUpload(event) { const file=event.target.files?.[0]; if (!file) return; try { const bytes=new Uint8Array(await file.arrayBuffer()); let binary=''; for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); await api.createDocument({name:file.name,type:'file',content:btoa(binary),contentEncoding:'base64',mimeType:file.type || 'application/octet-stream',parentId:docsPath.value === 'root' ? null : docsPath.value}); await load(); notify('文件已上传'); } catch (error) { notify(error.message); } finally { event.target.value=''; } }
function openGitSync(mode) { gitSyncMode.value=mode; gitSyncForm.value={name:workspaceSlugValue.value,message:''}; showGitSync.value=true; }
async function runGitSync() { if (!gitSyncForm.value.name.trim()) return notify('请填写同步目录名'); try { const result=gitSyncMode.value==='export' ? await api.exportDocumentsGit(gitSyncForm.value) : await api.importDocumentsGit(gitSyncForm.value); showGitSync.value=false; await load(); notify(gitSyncMode.value==='export' ? `已导出 ${result.files || 0} 个文件` : `已导入 ${result.created || 0} 个新文件，更新 ${result.updated || 0} 个文件`); } catch(error) { notify(error.message); } }
async function createDoc() { if (!docForm.value.name.trim()) return notify('请填写名称'); const type=docForm.value.type; await api.createDocument({...docForm.value,parentId:docsPath.value === 'root' ? null : docsPath.value}); showDoc.value=false; docForm.value={name:'',type:'file',content:''}; await load(); notify(type === 'folder' ? '文件夹已创建' : '文档已创建'); }
function openAutomationEditor(item = null) { automationEditId.value=item?.id || ''; automationForm.value={name:item?.name || '',schedule:item?.schedule || '每天 09:00',prompt:item?.prompt || '',webhookUrl:item?.webhook_url || item?.webhookUrl || '',outputMode:item?.output_mode || item?.outputMode || 'notification',maxRetries:item?.max_retries || item?.maxRetries || 3}; showAutomation.value=true; }
async function createAutomation() { if (!automationForm.value.name.trim()) return notify('请填写自动化名称'); try { const editing=Boolean(automationEditId.value); const body={...automationForm.value,webhookUrl:automationForm.value.webhookUrl.trim() || null}; if (editing) await api.updateAutomation(automationEditId.value,body); else await api.createAutomation(body); showAutomation.value=false; automationEditId.value=''; automationForm.value={name:'',schedule:'每天 09:00',prompt:'',webhookUrl:'',outputMode:'notification',maxRetries:3}; await load(); notify(editing?'自动化已更新':'自动化已保存'); } catch(error) { notify(error.message); } }
async function toggleAutomation(item) { try { await api.updateAutomation(item.id,{status:item.status==='active'?'paused':'active'}); await load(); if (selectedAutomation.value?.id===item.id) selectedAutomation.value=automations.value.find(entry=>entry.id===item.id) || item; notify(item.status==='active'?'自动化已暂停':'自动化已启用'); } catch (error) { notify(error.message); } }
async function runAutomationNow(item) { try { const result=await api.runAutomation(item.id,'manual'); automationRuns.value[item.id]=[result,...(automationRuns.value[item.id]||[])]; notify('自动化已排队'); } catch(error) { notify(error.message); } }
async function openAutomationDetails(item) { selectedAutomation.value=item; try { automationRuns.value[item.id]=(await api.automationRuns(item.id)).runs || []; } catch(error) { notify(error.message); } showAutomationDetails.value=true; }
async function deleteAutomation(item) { try { await api.deleteAutomation(item.id); showAutomationDetails.value=false; await load(); notify('自动化已删除'); } catch(error) { notify(error.message); } }
async function saveSettings() { await api.saveSettings({name:workspaceName.value,timezone:workspaceTimezone.value,description:workspaceDescription.value,context:workspaceContext.value,visibility:workspaceVisibility.value,prefix:workspacePrefix.value,preferences:{...(settings.value?.workspace?.preferences || {}),daemonHeartbeat:switchValue.value,automationDefaultMode:automationDefaultMode.value,language:workspaceLanguage.value,theme:workspaceTheme.value,weekStart:workspaceWeekStart.value}}); await api.updateProfile({name:profileName.value}); await api.updatePreferences({language:workspaceLanguage.value,theme:workspaceTheme.value,weekStart:workspaceWeekStart.value}); await load(); notify('设置已保存'); }
async function toggleSkill(skill) { try { await api.toggleSkill(skill.id,!skill.installed); skill.installed=!skill.installed; notify(skill.installed?'技能已安装':'技能已停用'); } catch (error) { notify(error.message); } }
async function uninstallSkill(skill) { if (!window.confirm('确定卸载技能：' + skill.name + '？')) return; try { await api.uninstallSkill(skill.id); await load(); notify('技能已卸载并解除员工绑定'); } catch (error) { notify(error.message); } }
async function openSkillVersions(skill) { skillVersionTarget.value=skill; try { skillVersions.value=(await api.skillVersions(skill.id)).versions || []; showSkillVersions.value=true; } catch (error) { notify(error.message); } }
async function rollbackSkillVersion(version) { if (!skillVersionTarget.value) return; try { await api.rollbackSkill(skillVersionTarget.value.id,version.id || version.version); showSkillVersions.value=false; await load(); notify('技能已回滚'); } catch (error) { notify(error.message); } }
function openSkillForm() { skillForm.value={name:'',description:'',category:'productivity',tags:''}; showSkillModal.value=true; }
async function openSkillImport() { skillImportForm.value={name:'',description:'',content:'',url:'',archive:'',archiveName:'',sourceDeviceId:''}; skillImportMode.value='markdown'; skillImportSources.value=[]; showSkillImport.value=true; try { const result=await api.skillSources(); skillImportSources.value=result.sources || []; } catch {} }
function openSkillImportFile() { skillImportFile.value?.click(); }
async function handleSkillImportFile(event) { const file=event.target.files?.[0]; if (!file) return; skillImportForm.value={...skillImportForm.value,name:file.name.replace(/(?:^|[\\/])SKILL\.md$/i,'').replace(/\.md$/i,''),content:await file.text()}; event.target.value=''; }
function openSkillArchiveFile() { skillImportArchiveFile.value?.click(); }
async function handleSkillArchiveFile(event) { const file=event.target.files?.[0]; if (!file) return; const bytes=new Uint8Array(await file.arrayBuffer()); let binary=''; const chunk=0x8000; for(let index=0; index<bytes.length; index+=chunk) binary+=String.fromCharCode(...bytes.subarray(index,index+chunk)); skillImportForm.value={...skillImportForm.value,archive:btoa(binary),archiveName:file.name,name:skillImportForm.value.name || file.name.replace(/\.zip$/i,'')}; event.target.value=''; }
async function copySkillFromWorkstation() { const source=skillImportSources.value.find(item => item.id===skillImportForm.value.sourceDeviceId && item.copy_supported); if (!source) return notify('请选择在线工位'); try { await api.copySkill({sourceType:'workstation',sourceDeviceId:source.id,name:skillImportForm.value.name || undefined,description:skillImportForm.value.description || undefined}); showSkillImport.value=false; await load(); skillScope.value='team'; notify('已从工位复制技能'); } catch (error) { notify(error.message); } }
async function importSkill() { const form=skillImportForm.value; let body={name:form.name || undefined,description:form.description || undefined}; if(skillImportMode.value==='url'){ if(!form.url.trim()) return notify('请输入技能 URL'); body={...body,url:form.url.trim(),sourceType:'url'}; } else if(skillImportMode.value==='zip'){ if(!form.archive) return notify('请选择技能 ZIP 压缩包'); body={...body,archive:form.archive,name:form.name || form.archiveName?.replace(/\.zip$/i,'') || undefined,sourceType:'zip',sourcePath:form.archiveName || undefined}; } else { if(!form.content.trim()) return notify('请选择或粘贴 SKILL.md 内容'); body={...body,content:form.content,sourceType:'markdown'}; } try { await api.importSkill(body); showSkillImport.value=false; await load(); skillScope.value='team'; notify('技能已导入'); } catch (error) { notify(error.message); } }
async function createSkill() { if (!skillForm.value.name.trim()) return notify('请填写技能名称'); await api.createSkill({ ...skillForm.value, scope:'team', tags:skillForm.value.tags.split(/[,，\s]+/).map(item => item.trim()).filter(Boolean) }); showSkillModal.value=false; await load(); skillScope.value='team'; skillTab.value='all'; notify('团队技能已添加'); }
async function loadInvitations() { try { invitations.value=(await api.invitations()).invitations || []; } catch (error) { notify(error.message); } }
async function invite() { if (!inviteForm.value.email.trim()) return notify('请填写成员邮箱'); try { const result=await api.createInvitation(inviteForm.value); inviteLink.value=result.link || ''; await loadInvitations(); await load(); notify(`邀请已创建：${inviteForm.value.email}`); inviteForm.value={email:'',role:'member'}; } catch(error) { notify(error.message); } }
async function createInviteLink() { try { const result=await api.createInvitation({role:'member'}); inviteLink.value=result.link || ''; await loadInvitations(); try { await navigator.clipboard?.writeText(inviteLink.value); } catch {} notify('邀请链接已创建并复制'); } catch(error) { notify(error.message); } }
async function resendInvite(item) { try { const result=await api.resendInvitation(item.id); inviteLink.value=result.link || inviteLink.value; await loadInvitations(); try { await navigator.clipboard?.writeText(inviteLink.value); } catch {} notify('邀请已重新发送并复制链接'); } catch (error) { notify(error.message); } }
async function revokeInvite(item) { try { await api.revokeInvitation(item.id); await loadInvitations(); notify('邀请已撤销'); } catch(error) { notify(error.message); } }
function openMemberEditor(member) { memberEditForm.value={id:member.id,name:member.name || '',email:member.email || '',role:member.role || 'member'}; showMemberEditor.value=true; }
async function saveMember() { if (!memberEditForm.value.id || !memberEditForm.value.name.trim() || !memberEditForm.value.email.trim()) return notify('请填写成员姓名和邮箱'); try { await api.updateMember(memberEditForm.value.id,{name:memberEditForm.value.name.trim(),email:memberEditForm.value.email.trim(),role:memberEditForm.value.role}); showMemberEditor.value=false; await load(); notify('成员信息已保存'); } catch (error) { notify(error.message); } }
async function removeMember(member) { if (!member?.id || member.role === 'owner' || !window.confirm(`确定移除成员“${member.name || member.email}”？`)) return; try { await api.deleteMember(member.id); await load(); notify('成员已移除'); } catch (error) { notify(error.message); } }
async function loadInvite() {
  inviteAcceptError.value='';
  if (!inviteCode.value) { inviteAcceptState.value='invalid'; inviteAcceptError.value='邀请链接无效，请向邀请人索取新链接'; return; }
  try {
    inviteInfo.value=await api.lookupInvitation(inviteCode.value);
    inviteAcceptForm.value={name:authState.value.user?.name || '',email:authState.value.user?.email || ''};
    inviteAcceptState.value='ready';
    if (inviteInfo.value.status==='revoked') inviteAcceptError.value='邀请已撤销，请联系邀请人重新邀请';
    if (inviteInfo.value.status==='expired') inviteAcceptError.value='邀请已过期，请联系邀请人重新发送';
    if (inviteInfo.value.email && inviteInfo.value.email.toLowerCase() !== inviteAcceptForm.value.email.toLowerCase()) inviteAcceptError.value='当前登录邮箱与邀请邮箱不匹配，请切换到受邀账号';
  } catch(error) { inviteAcceptState.value='invalid'; inviteAcceptError.value=error.message; }
}
async function acceptInvite() {
  if (inviteAcceptBusy.value) return;
  inviteAcceptBusy.value=true; inviteAcceptError.value='';
  try {
    const result=await api.acceptInvitation(inviteCode.value, {});
    await refreshAuth();
    await enterWorkspace(result.invitation.workspace);
    notify('已加入工作区');
  } catch(error) { inviteAcceptError.value=error.message; }
  finally { inviteAcceptBusy.value=false; }
}
async function addDevice() {
  await createDevicePairing();
  if (devicePairing.value?.code) notify('已生成新的设备配对码，请在目标电脑运行连接命令');
}
function toggleDeviceCollapse(deviceId) { const next=new Set(collapsedDevices.value); if (next.has(deviceId)) next.delete(deviceId); else next.add(deviceId); collapsedDevices.value=next; }
function collapseAllDevices() { collapsedDevices.value=new Set(devices.value.map(device => device.id)); }
function expandAllDevices() { collapsedDevices.value=new Set(); }
function canDeleteDevice(device) {
  const role = String(currentAccount.value.role || '').toLowerCase();
  return Boolean(device?.id && (['owner','admin'].includes(role) || device.owner_user_id === currentAccount.value.id));
}
function canManageDevice(device) { return canDeleteDevice(device); }
function employeeStatusLabel(status) {
  return status === 'active' ? '可用' : status === 'paused' ? '已暂停' : status === 'archived' ? '已归档' : '未启用';
}
function employeeRoleSummary(employee) {
  const description = String(employee.description || '').trim();
  const fallback = String(employee.instructions || '').trim().split(/[。！？!?\r\n]/, 1)[0];
  const characters = Array.from((description || fallback).replace(/\s+/g, ' ').trim());
  return characters.length > 80 ? `${characters.slice(0, 80).join('')}…` : characters.join('') || '未填写岗位摘要';
}
function taskExecutionLabel(execution) {
  const status = String(execution?.status || '').toLowerCase();
  return status === 'pending' ? '已提交，等待 ziwei_user' : status === 'acked' ? 'ziwei_user 执行中' : status === 'succeeded' ? '数字员工已完成' : status === 'failed' ? `执行失败${execution?.error ? `：${execution.error}` : ''}` : status === 'expired' ? '执行已过期' : '';
}
function executionEventLabel(event) {
  const stageLabels = { reasoning:'思考摘要', command:'运行命令', tool:'调用工具', context:'处理上下文', response:'生成结果', output:'生成结果' };
  const stage = String(event?.stage || event?.data?.stage || '').toLowerCase();
  if (stageLabels[stage]) return stageLabels[stage];
  if (event?.message && event.message !== 'CLI 输出已更新') return event.message;
  if (event?.message === 'CLI 输出已更新') return '生成结果';
  return ({
    'action.started': '已启动本机 CLI',
    'action.output': '生成结果',
    'action.progress': '数字员工正在执行',
    succeeded: '数字员工已完成',
    failed: '数字员工执行失败'
  }[String(event?.type || '')] || '执行状态已更新');
}
function executionEventDetail(event) {
  const detail = String(event?.detail || event?.data?.detail || event?.data?.progress?.detail || '').trim();
  if (detail) return detail;
  const stage = String(event?.stage || event?.data?.stage || '').toLowerCase();
  const stageDetails = { reasoning:'公开推理摘要', command:'本机命令活动', tool:'CLI 工具活动', context:'上下文窗口整理', response:'CLI 输出', output:'CLI 输出' };
  if (stageDetails[stage]) return stageDetails[stage];
  const bytes = Number(event?.bytes || event?.data?.bytes || event?.data?.progress?.bytes || 0);
  return bytes > 0 ? `已接收 ${bytes.toLocaleString()} B 输出` : '';
}
function executionEventSummary(event) {
  const summary = event?.summary || event?.data?.summary || event?.data?.progress?.summary || '';
  return String(summary).trim().slice(0, 4000);
}
function executionEventRows(events) {
  const rows = [];
  for (const event of Array.isArray(events) ? events : []) {
    const label = executionEventLabel(event);
    const detail = executionEventDetail(event);
    const summary = executionEventSummary(event);
    const stage = String(event?.stage || event?.data?.stage || event?.type || label);
    const mergeable = ['action.output', 'action.progress', 'action.stage'].includes(String(event?.type || ''));
    const previous = rows[rows.length - 1];
    const mergeKey = `${event?.type || ''}:${stage}:${label}:${mergeable ? `${detail}:${summary}` : detail}`;
    if (mergeable && previous?.mergeable && previous.mergeKey === mergeKey) {
      previous.count += 1;
      previous.bytes += Number(event?.bytes || event?.data?.bytes || 0);
      previous.created_at = event?.created_at || previous.created_at;
      if (detail) previous.detail = detail;
      if (summary) previous.summary = summary;
      continue;
    }
    rows.push({
      ...event,
      label,
      detail,
      summary,
      stage,
      mergeKey,
      mergeable,
      count: 1,
      bytes: Number(event?.bytes || event?.data?.bytes || 0)
    });
  }
  return rows;
}
function executionReasoningSummaries(events) {
  return executionEventRows(events).filter(event => executionEventSummary(event));
}
async function removeDevice(device) {
  if (!device?.id || !canDeleteDevice(device)) return;
  const name = String(device.name || device.id);
  if (!window.confirm(`确定移除设备“${name}”？移除后它将不再显示在“我的设备”中。`)) return;
  try {
    await api.deleteDevice(device.id);
    devices.value = (await api.devices()).devices || [];
    notify(`设备“${name}”已移除`);
  } catch (error) { notify(error.message); }
}
let managementDiscoveryGeneration = 0;
async function refreshManagementDiscovery() {
  const generation = ++managementDiscoveryGeneration;
  const workspace = workspaceSlug();
  managementDiscoveryLoading.value = true; managementDiscoveryError.value = ''; managementDiscovery.value = null;
  try { const result = await api.managementMcpDiscovery(workspace); if (generation === managementDiscoveryGeneration && workspaceSlug() === workspace) managementDiscovery.value = result; }
  catch (error) { if (generation === managementDiscoveryGeneration && workspaceSlug() === workspace) managementDiscoveryError.value = error.message; }
  finally { if (generation === managementDiscoveryGeneration && workspaceSlug() === workspace) managementDiscoveryLoading.value = false; }
}
async function retryEmployeeManagementMcp() {
  const deviceId = employeeTargetDeviceId.value; const workspace = workspaceSlug();
  if (!deviceId || !employeeSelectedDevice.value || employeeMcpRetrying.value) return;
  employeeMcpRetrying.value = true; employeeMcpRetryMessage.value = '';
  try {
    await api.retryManagementMcp(deviceId, workspace);
    if (workspaceSlug() === workspace && employeeTargetDeviceId.value === deviceId) { employeeMcpRetryMessage.value = '已请求自动接入刷新，等待电脑下一次心跳；未执行员工任务。'; await refreshManagementDiscovery(); }
  } catch (error) { if (workspaceSlug() === workspace && employeeTargetDeviceId.value === deviceId) employeeMcpRetryMessage.value = error.message; }
  finally { employeeMcpRetrying.value = false; }
}
function employeeRuntimeDetail(runtime) {
  if (!employeeTargetDeviceId.value) return '请选择目标电脑以检查 CLI';
  return runtime.readiness?.reason || `${runtime.version || runtime.cli_version || '版本未发现'} · ${runtime.cli_status === 'available' ? 'CLI 已发现' : 'CLI 不可用'}`;
}
async function changeEmployeeDevice() {
  hermesProfileDeviceId.value = employeeTargetDeviceId.value;
  employeeRuntimeProfile.value = ''; hermesProfiles.value = [];
  if (employeeForm.value.runtime === 'Hermes') await refreshHermesProfilesForDevice();
}
function openEmployeeModal(employee = null) {
  employeeMcpRetryMessage.value='';
  employeeContinuePhoneSetup.value=false;
  employeeActionId.value=''; employeeEditId.value=employee?.id || ''; employeeModalTab.value='manual';
  employeeCreateRequestKey.value = `employee-ui-${crypto.randomUUID()}`;
  employeeVisibility.value=employee?.visibility || 'workspace'; employeeModel.value=employee?.model_id || employee?.modelId || 'default'; employeeModelSearch.value='';
  employeeDescription.value=employee?.description || ''; employeeRole.value=employee?.instructions || ''; employeePersona.value=employee?.persona || '';
  employeeRuntimeProfile.value=employee?.runtime_profile || employee?.runtimeProfile || '';
  employeeTargetDeviceId.value=employee?.target_device_id || employee?.targetDeviceId || ''; hermesProfileDeviceId.value=employeeTargetDeviceId.value;
  employeeSkillsOpen.value=false; employeeRuntimeOpen.value=false; employeeModelOpen.value=false; employeeSkillIds.value=employee?.skills || []; employeeAvatar.value=employee?.avatar || '';
  employeeForm.value={name:employee?.name || '',runtime:employee?.runtime || 'Codex',instructions:employee?.instructions || ''};
  hermesProfiles.value=[]; showEmployee.value=true;
  void refreshManagementDiscovery();
  if (employeeForm.value.runtime === 'Hermes' && employeeTargetDeviceId.value) void refreshHermesProfilesForDevice();
}
function openEmployeeActions(employee) { employeeActionId.value = employeeActionId.value === employee?.id ? '' : (employee?.id || ''); }
async function loadEmployeeConfig(employee = employeeProfile.value) {
  if (!employee?.id) return;
  employeeConfigLoading.value = true;
  try {
    const [environment, params, mcp, profiles] = await Promise.all([
      api.employeeEnvironment(employee.id),
      api.employeeCustomParams(employee.id),
      api.employeeMcp(),
      employee.runtime === 'Hermes' ? api.hermesProfiles(hermesProfileDeviceId.value) : Promise.resolve({ profiles: [] })
    ]);
    employeeEnvironment.value = environment || { variables: [], local_source: { source: 'ziwei_user', scope: 'runtime', variables: [] } };
    employeeCustomParams.value = params || { values: {}, updated_at: null };
    employeeCustomParamsDraft.value = JSON.stringify(employeeCustomParams.value.values || {}, null, 2);
    employeeMcpStatus.value = mcp || null;
    hermesProfiles.value = profiles?.profiles || [];
  } catch (error) { notify(error.message); }
  finally { employeeConfigLoading.value = false; }
}
async function saveEmployeeEnvironment() {
  const draft = employeeEnvironmentDraft.value; const employee = employeeProfile.value;
  if (!employee?.id || !draft.key.trim()) return notify('请填写环境变量名');
  if (!draft.value) return notify('敏感值保存时必须填写新值');
  try {
    if (employeeEnvironmentEditing.value) await api.updateEmployeeEnvironment(employee.id, employeeEnvironmentEditing.value, { value: draft.value, sensitive: draft.sensitive });
    else await api.saveEmployeeEnvironment(employee.id, { key: draft.key.trim(), value: draft.value, sensitive: draft.sensitive });
    employeeEnvironmentDraft.value = { key: '', value: '', sensitive: true }; employeeEnvironmentEditing.value = '';
    await loadEmployeeConfig(employee); notify('环境变量已保存');
  } catch (error) { notify(error.message); }
}
function editEmployeeEnvironment(item) { employeeEnvironmentEditing.value = item.key; employeeEnvironmentDraft.value = { key: item.key, value: '', sensitive: item.sensitive !== false }; }
function cancelEmployeeEnvironmentEdit() { employeeEnvironmentEditing.value = ''; employeeEnvironmentDraft.value = { key: '', value: '', sensitive: true }; }
async function removeEmployeeEnvironment(item) {
  if (!employeeProfile.value?.id || !window.confirm(`确定删除环境变量“${item.key}”？`)) return;
  try { await api.deleteEmployeeEnvironment(employeeProfile.value.id, item.key); await loadEmployeeConfig(); notify('环境变量已删除'); } catch (error) { notify(error.message); }
}
async function saveEmployeeCustomParams() {
  let values;
  try { values = JSON.parse(employeeCustomParamsDraft.value || '{}'); } catch { return notify('自定义参数必须是有效 JSON'); }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return notify('自定义参数必须是 JSON 对象');
  try { employeeConfigSaving.value = true; employeeCustomParams.value = await api.saveEmployeeCustomParams(employeeProfile.value.id, values); employeeCustomParamsDraft.value = JSON.stringify(employeeCustomParams.value.values || {}, null, 2); notify('自定义参数已保存'); } catch (error) { notify(error.message); } finally { employeeConfigSaving.value = false; }
}
async function refreshEmployeeMcp() { try { employeeMcpStatus.value = await api.employeeMcp(); } catch (error) { notify(error.message); } }
function scheduleEmployeeTask(employee) {
  if (!employee?.id) return;
  employeeActionId.value='';
  agentComposerEmployeeId.value=employee.id;
  agentComposerEmployeeOpen.value=false;
  agentComposerText.value='';
  agentComposerExpanded.value=false;
  showAgentComposer.value=true;
}
function openEmployeeProfile(employee) {
  if (!employee?.id) return;
  employeeActionId.value='';
  employeeRouteId.value=employee.id;
  employeeProfileTab.value='activity';
  employeeRoleEditing.value=false;
  employeeRoleDraft.value='';
  page.value='employee';
  history.pushState({},'',routePath('employee', employee.id));
  void loadEmployeeConfig(employee);
}
function beginEmployeeRoleEdit(employee = employeeProfile.value) {
  if (!employee?.id) return;
  employeeRoleDraft.value = employee.instructions || employee.description || '';
  employeeRoleEditing.value = true;
}
function cancelEmployeeRoleEdit() {
  employeeRoleEditing.value = false;
  employeeRoleDraft.value = '';
}
async function saveEmployeeRole() {
  const employee = employeeProfile.value;
  if (!employee?.id || employeeRoleSaving.value) return;
  employeeRoleSaving.value = true;
  try {
    const updated = await api.updateEmployee(employee.id, { instructions: employeeRoleDraft.value.trim() });
    employees.value = employees.value.map(item => item.id === updated.id ? { ...item, ...updated } : item);
    cancelEmployeeRoleEdit();
    notify('岗位说明已保存');
  } catch (error) {
    notify(error.message);
  } finally {
    employeeRoleSaving.value = false;
  }
}
function openEmployeeAvatarPicker() { employeeAvatarFile.value?.click(); }
function clearEmployeeAvatar() { employeeAvatar.value=''; if (employeeAvatarFile.value) employeeAvatarFile.value.value=''; }
function handleEmployeeAvatar(event) { const file=event.target.files?.[0]; if (!file) return; if (!file.type.startsWith('image/')) { notify('请选择图片文件'); event.target.value=''; return; } if (file.size > 2 * 1024 * 1024) { notify('头像图片不能超过 2MB'); event.target.value=''; return; } const reader=new FileReader(); reader.onload=()=>{ employeeAvatar.value=String(reader.result || ''); }; reader.readAsDataURL(file); event.target.value=''; }
function selectEmployeeRuntime(name) {
  employeeRuntimeProfile.value=profileAfterRuntimeChange(employeeForm.value.runtime, name, employeeRuntimeProfile.value);
  employeeForm.value.runtime=name; employeeRuntimeOpen.value=false;
  hermesProfileDeviceId.value=employeeTargetDeviceId.value;
  if (name === 'Hermes' && employeeTargetDeviceId.value) void refreshHermesProfilesForDevice();
}
async function refreshHermesProfilesForDevice() { hermesProfiles.value=[]; if (!hermesProfileDeviceId.value) return; try { const result=await api.hermesProfiles(hermesProfileDeviceId.value); hermesProfiles.value=result.profiles || []; } catch (error) { notify(error.message, 'error'); } }
async function createHermesProfile() {
  const profile = employeeRuntimeProfile.value.trim(); const deviceId = employeeTargetDeviceId.value;
  if (!profile || profile === 'default') { notify('请填写独立 Hermes profile 名称，不能使用主 profile', 'error'); return false; }
  if (!deviceId || employeeSelectedDevice.value?.status !== 'online') { notify('目标电脑离线或未选择，请先确认该电脑 ziwei_user 心跳', 'error'); return false; }
  hermesProfileCreating.value = true;
  try {
    const requestKey = `hermes-profile-${workspaceSlug()}-${deviceId}-${profile}`;
    const response = await api.createHermesProfile({ profile, deviceId, soul: [employeeRole.value.trim(), employeePersona.value.trim()].filter(Boolean).join('\n\n') || `# ${profile}\n` }, requestKey);
    let action = response?.action || response;
    for (let attempt = 0; action && !['succeeded', 'failed', 'expired'].includes(action.status) && attempt < 30; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const polled = await api.hermesProfileAction(action.id); action = polled?.action || polled;
    }
    if (!action || action.status === 'failed' || action.status === 'expired') throw new Error(action?.error || 'Hermes profile 创建失败');
    if (action.status !== 'succeeded') { notify('创建请求已提交，等待 ziwei_user 完成', 'error'); return false; }
    const profiles = await api.hermesProfiles(deviceId); hermesProfiles.value = profiles.profiles || [];
    employeeRuntimeProfile.value = action.result?.profile || profile;
    await refreshManagementDiscovery();
    notify(`Hermes profile “${employeeRuntimeProfile.value}”已创建`); return true;
  } catch (error) { notify(error.message, 'error'); return false; }
  finally { hermesProfileCreating.value = false; }
}
function selectEmployeeModel(value) { employeeModel.value=value; employeeModelOpen.value=false; }
function toggleEmployeeSkill(id) { employeeSkillIds.value = employeeSkillIds.value.includes(id) ? employeeSkillIds.value.filter(item => item !== id) : [...employeeSkillIds.value, id]; }
async function addEmployee() {
  if (employeeCreating.value) return;
  if (!employeeForm.value.name.trim()) return notify('请填写数字员工名称', 'error');
  if (!employeeReady.value.ready) return notify(employeeReady.value.issues.join('；'), 'error');
  employeeCreating.value=true;
  try {
    const body={...employeeForm.value,name:employeeForm.value.name.trim(),model:employeeModel.value === 'default' ? null : employeeModel.value,runtimeProfile:employeeRuntimeProfile.value.trim() || null,targetDeviceId:employeeTargetDeviceId.value,managementMcpEnabled:true,description:employeeDescription.value,persona:employeePersona.value,visibility:employeeVisibility.value,skills:employeeSkillIds.value,instructions:employeeRole.value || employeeForm.value.instructions,avatar:employeeAvatar.value || null,status:'active'};
    const savedEmployee=employeeEditId.value ? await api.updateEmployee(employeeEditId.value,body) : await api.createEmployee({...body,idempotencyKey:employeeCreateRequestKey.value});
    const wasEdit=Boolean(employeeEditId.value); showEmployee.value=false; await load(); notify(wasEdit ? '数字员工已更新' : '数字员工已创建'); employeeEditId.value='';
    if(!wasEdit && employeeContinuePhoneSetup.value) openPhoneSkillSetup(savedEmployee?.id || savedEmployee?.employee?.id || '');
  } catch (error) { notify(error.message, 'error'); }
  finally { employeeCreating.value=false; }
}
async function removeEmployee(employee) { if (!employee?.id || !window.confirm(`确定删除数字员工“${employee.name || employee.id}”？`)) return; try { await api.deleteEmployee(employee.id); await load(); notify('数字员工已删除'); } catch (error) { notify(error.message); } }
window.addEventListener('popstate', () => {
  if (isAndroidInstallPath(location.pathname)) { page.value='android-install'; closeRealtime(); stopConversationPolling(); return; }
  const urlWorkspace = workspaceSlug();
  if (urlWorkspace) setWorkspaceSlug(urlWorkspace);
  page.value=routeFromPath(location.pathname); conversationRouteId.value=conversationIdFromPath(); conversationEmployeeId.value=conversationEmployeeFromPath() || conversationEmployeeId.value; employeeRouteId.value=employeeIdFromPath(); employeeActionId.value=''; inviteCode.value=new URLSearchParams(location.search).get('code') || '';
  if (page.value==='invite-accept') loadInvite();
  if (page.value==='inbox') loadConversations();
  if (page.value==='ziwei-connect') loadZiweiConnect();
  if (urlWorkspace && authState.value.authenticated && !['invite','invite-accept'].includes(page.value)) void load();
});
window.addEventListener('ziwei:auth-required', () => { authState.value={...authState.value,authenticated:false}; closeRealtime(); });
onMounted(async () => { applyDisplayPreferences(); if (page.value==='android-install') return; await refreshAuth(); if (authState.value.authenticated) { if (page.value==='invite-accept') { await loadInvite(); return; } await load(); if (page.value==='invite') await loadInvitations(); if (page.value==='open') await loadApiKeys(); if (page.value==='ziwei-connect') await loadZiweiConnect(); } });
</script>

<template>
  <AndroidInstallPage v-if="page==='android-install'"/>
  <section v-else-if="authState.loading" class="auth-screen"><div class="auth-card"><img src="/ziwei-logo.png" alt="紫薇"/><p>正在连接紫薇工作区…</p></div></section>
  <section v-else-if="!authState.authenticated" class="auth-screen">
    <div class="auth-card">
      <img src="/ziwei-logo.png" alt="紫薇"/>
      <h1>{{ authMode==='login' ? '登录紫薇' : authMode==='setup' ? '创建紫薇账号' : '注册紫薇账号' }}</h1>
      <p>{{ authMode==='login' ? (inviteCode ? '登录受邀账号后，确认接受此邀请。' : '使用账号进入工作区。') : authMode==='setup' ? '首次使用先创建账号，登录后再建立你的第一个工作区。' : '使用有效邀请加入指定工作区；没有邀请时可留空创建个人工作区。' }}</p>
      <form class="form-stack" novalidate @submit.prevent="submitAuth">
        <ZiFormField v-if="authMode!=='login'" label="姓名"><ZiInput v-model="authForm.name" name="name" autocomplete="name" placeholder="你的姓名"/></ZiFormField>
        <ZiFormField v-if="authMode==='register'" label="工作区标识" hint="邀请链接会自动填写，请保持与邀请一致"><ZiInput v-model="authWorkspaceSlug" name="workspace" autocomplete="off" placeholder="可留空，或填写受邀工作区"/></ZiFormField>
        <ZiFormField v-if="authMode==='register'" label="邀请码" hint="使用邀请链接中的 code；无邀请时可留空"><ZiInput v-model="authForm.invitationCode" name="invitationCode" autocomplete="off" placeholder="可留空，加入工作区时填写"/></ZiFormField>
        <ZiFormField label="邮箱"><ZiInput v-model="authForm.email" name="email" autocomplete="username" type="email" placeholder="name@example.com"/></ZiFormField>
        <ZiFormField label="密码"><ZiInput v-model="authForm.password" name="password" :autocomplete="authMode==='login'?'current-password':'new-password'" type="password" placeholder="至少 8 位"/></ZiFormField>
        <ZiFormField v-if="authMode!=='login'" label="确认密码"><ZiInput v-model="authForm.confirmPassword" name="confirmPassword" autocomplete="new-password" type="password"/></ZiFormField>
        <div v-if="authError" ref="authErrorPanel" class="auth-error" data-auth-error role="alert" aria-live="assertive" tabindex="-1">{{ authError }}</div>
        <button type="submit" class="ziwei-button ziwei-button--primary ziwei-button--md" :disabled="authBusy" :aria-busy="authBusy">{{ authBusy ? '处理中…' : authMode==='login' ? '登录' : '创建账号并登录' }}</button>
      </form>
      <button type="button" class="link-button" @click="switchAuthMode">{{ authMode==='login' ? '注册新账号' : '已有账号，登录' }}</button>
    </div>
  </section>
  <section v-else-if="page==='invite-accept'" class="auth-screen">
    <div class="auth-card invite-recipient-card">
      <img src="/ziwei-logo.png" alt="紫薇"/>
      <h1>加入紫薇工作区</h1>
      <p v-if="inviteInfo">你正在接受 {{ inviteInfo.workspace }} 的邀请。</p>
      <p>当前登录账号：{{ authState.user?.email }}</p>
      <p v-if="inviteAcceptState==='idle'">正在读取邀请…</p>
      <div v-if="inviteAcceptError" class="auth-error" role="alert">{{ inviteAcceptError }}</div>
      <button v-if="inviteAcceptState==='ready'" type="button" class="ziwei-button ziwei-button--primary ziwei-button--md" :disabled="inviteAcceptBusy" @click="acceptInvite">{{ inviteAcceptBusy ? '正在加入…' : '接受邀请' }}</button>
      <button type="button" class="link-button" @click="logout">切换账号</button>
    </div>
  </section>
  <section v-else-if="workspaceCreateRequired" class="auth-screen"><div class="auth-card workspace-first-card"><img src="/ziwei-logo.png" alt="紫薇"/><h1>创建你的第一个工作区</h1><p>账号已创建。先建立一个个人或团队工作区，之后才能开始使用任务、设备和数字员工。</p><div class="form-stack"><ZiFormField label="工作区名称" required><ZiInput v-model="firstWorkspaceForm.name" autofocus placeholder="例如：我的工作区"/></ZiFormField><ZiFormField label="工作区标识" hint="可留空自动生成"><ZiInput v-model="firstWorkspaceForm.slug" placeholder="例如：my-workspace"/></ZiFormField><ZiFormField label="类型"><ZiSelect v-model="firstWorkspaceForm.kind" class="workspace-kind-select" :options="[{label:'个人工作区',value:'personal'},{label:'团队工作区',value:'team'}]"/></ZiFormField><ZiButton :disabled="firstWorkspaceBusy || !firstWorkspaceForm.name.trim()" @click="createFirstWorkspace">{{ firstWorkspaceBusy ? '创建中…' : '创建工作区' }}</ZiButton></div><button class="link-button" @click="logout">退出登录</button></div></section>
  <WorkspaceShell v-else :page="page" :account="currentAccount" :workspace="summary.workspace" :workspaces="authState.memberships" :language="workspaceLanguage" @navigate="navigate" @workspace="switchWorkspace" @create-workspace="createWorkspace" @language="changeLanguage" @logout="logout">
    <section class="content">
        <Transition name="toast">
          <div v-if="toast" class="notice toast-notice" :data-tone="toastTone" role="status" aria-live="polite">
            <span class="notice-icon" aria-hidden="true"><CheckCircle2 v-if="toastTone==='success'" :size="17"/><CircleAlert v-else :size="17"/></span>
            <span class="notice-copy">{{ toast }}</span>
            <button class="notice-dismiss" type="button" aria-label="关闭提示" @click="dismissToast"><X :size="15"/></button>
          </div>
        </Transition>
        <div v-if="page==='home'">
          <div class="home-header"><div><span class="eyebrow">紫薇工作区 · {{ workspaceSlugValue }}</span><h1>今天想让 Agent 帮你做什么？</h1><p>选择一个数字伙伴，开始一段可追踪的工作。</p></div><button class="home-help" @click="openHelp">需要帮助？</button></div>
          <ZiCard class="agent-launcher"><div class="agent-launcher-main"><div class="agent-orb">✦</div><div><strong>选择数字伙伴</strong><p>{{ employees.length ? `已配置 ${employees.length} 个数字伙伴` : '还没有可用的数字伙伴' }}</p><button class="link-button" @click="navigate('members')">{{ employees.length ? '管理数字伙伴 →' : '前往团队管理添加设备和 Agent →' }}</button></div></div><ZiButton :disabled="!employees.length" @click="openAgentComposer">开始对话</ZiButton></ZiCard>
          <div class="quick-grid home-quick"><button class="quick" @click="addTaskInLane()"><span class="quick-icon">＋</span><b>新建任务</b><span>把下一步行动交给紫薇</span></button><button class="quick" @click="navigate('issues')"><span class="quick-icon">▤</span><b>汇总项目进展</b><span>查看最近的执行状态</span></button><button class="quick" @click="navigate('calendar')"><span class="quick-icon">◷</span><b>查看近期安排</b><span>浏览任务和自动化日程</span></button></div>
          <div class="home-section-title"><h2>工作区概览</h2><button class="link-button" @click="navigate('settings')">管理工作区 →</button></div>
          <div class="grid-4"><ZiMetricCard label="待处理任务" :value="summary.taskStates.todo || 0" note="需要你的关注" tone="default"/><ZiMetricCard label="在线运行时" :value="summary.counts.runtimes" note="A2A 可调度" tone="positive"/><ZiMetricCard label="项目文档" :value="summary.counts.documents" note="持续沉淀中" tone="default"/><ZiMetricCard label="自动化" :value="summary.counts.automations" note="已配置流程" tone="positive"/></div>
          <div class="grid-2" style="margin-top:16px"><ZiCard><div class="card-heading"><h3>本机连接</h3><ZiStatusTag :status="ownDeviceOnline?'online':'neutral'" :label="ownDeviceLabel" dot/></div><div class="runtime-row"><ZiAvatar name="ziwei_user" size="sm" :status="ownDeviceOnline?'online':'neutral'"/><div class="row-main"><strong>{{ summary.device?.name || 'ziwei_user' }}</strong><small>ziwei_user · {{ summary.device?.bridge_version ? `v${summary.device.bridge_version}` : '等待心跳' }} · {{ summary.device?.bridge_host || '127.0.0.1' }}</small></div><span class="row-end">{{ ownDeviceOnline ? '刚刚' : '—' }}</span></div><ZiProgress :value="ownDeviceOnline ? 100 : 0" label="ziwei_user 心跳健康度" :tone="ownDeviceOnline?'positive':'neutral'"/></ZiCard><ZiCard><div class="card-heading"><h3>运行时</h3><button class="icon-button" @click="navigate('members')">全部 →</button></div><div v-for="runtime in runtimes.slice(0,3)" :key="runtime.id" class="runtime-row"><ZiAvatar :name="runtime.name" size="sm"/><div class="row-main"><strong>{{ runtime.name }}</strong><small>{{ runtime.provider }} · {{ runtime.cli_version || '等待 ziwei_user 心跳' }}</small></div><ZiStatusTag :status="runtime.cli_status==='available'?'online':'neutral'" :label="runtime.cli_status==='available'?'在线':'离线'" dot/></div></ZiCard></div>
        </div>

        <div v-else-if="page==='ziwei-connect'" class="ziwei-connect-page">
          <div class="page-header"><div><span class="eyebrow">DEVICE CONTROL</span><h1>紫薇·互联</h1><p>审批手机入网、管理双端和操控画面，并为每台手机绑定工作区内的数字员工。</p></div><div class="header-actions"><a class="ziwei-connect-install-link" :href="installPageHref(workspaceSlugValue)"><Download :size="16"/>安装手机端</a><ZiButton variant="secondary" :disabled="ziweiConnectLoading" @click="loadZiweiConnect"><RefreshCw :size="15"/>刷新员工绑定</ZiButton></div></div>
          <div v-if="ziweiConnectState==='error'" class="ziwei-connect-error-banner" role="alert"><CircleAlert :size="17"/><div><strong>员工绑定与执行记录读取失败</strong><p>{{ ziweiConnectError }}</p></div><button type="button" class="pill" @click="loadZiweiConnect">重试</button></div>
          <TerminalConsole :key="workspaceSlugValue" :can-manage="canManageWorkspace" :selected-device-id="ziweiConnectSelection.deviceId" @devices-change="updateTerminalDevices" @select-device="selectTerminalDevice" @command-resolved="refreshResolvedTerminalRun">
            <template #device-binding="{ device }">
              <section class="terminal-employee-binding" data-testid="terminal-employee-binding"><button v-if="canManageWorkspace" type="button" class="pill" @click="openPhoneSkillSetup(ziweiConnectSelection.employeeId,device.id)">配置手机技能</button>
                <div class="card-heading"><div><h3>绑定数字员工</h3><p class="modal-copy">{{ device.alias }} 使用已有数字员工；账号映射随这台手机保存。</p></div><span class="work-count">{{ terminalDeviceBindings(device.id).length }} 条</span></div>
                <div v-if="canManageWorkspace" class="terminal-binding-form">
                  <label class="ziwei-connect-field"><span>数字员工</span><ZiSelect v-model="ziweiConnectSelection.employeeId" :options="employees.map(item => ({label:item.name || item.id,value:item.id}))" aria-label="选择手机数字员工"/></label>
                  <label class="ziwei-connect-field"><span>外部账号 ID（可选）</span><ZiInput v-model="ziweiConnectSelection.accountId" placeholder="例如 douyin-main"/></label>
                  <label class="ziwei-connect-field"><span>账号显示名（可选）</span><ZiInput v-model="ziweiConnectSelection.accountLabel" placeholder="例如 抖音主号"/></label>
                  <div class="form-actions"><ZiButton :disabled="ziweiConnectBusy==='binding' || !ziweiConnectSelection.employeeId" @click="saveZiweiConnectBinding">{{ ziweiConnectBusy==='binding' ? '保存中…' : '保存绑定' }}</ZiButton></div>
                  <p v-if="!employees.length" class="terminal-binding-empty">工作区还没有数字员工。<button type="button" class="link-button" @click="navigate('members')">前往成员与设备</button></p>
                </div>
                <div v-if="terminalDeviceBindings(device.id).length" class="ziwei-connect-binding-list"><div v-for="binding in terminalDeviceBindings(device.id)" :key="binding.id" class="runtime-row"><button type="button" class="terminal-binding-select row-main" @click="selectZiweiConnectBinding(binding)"><strong>{{ employees.find(item => item.id === (binding.employee_id || binding.employeeId))?.name || binding.employee_name || binding.employeeName || binding.employee_id || binding.employeeId }}</strong><small>{{ binding.accountLabel || binding.account_label || binding.accountId || binding.account_id || '未映射外部账号' }}</small></button><button v-if="canManageWorkspace" type="button" class="pill" :disabled="ziweiConnectBusy===`delete:${binding.id}`" @click="deleteZiweiConnectBinding(binding)">{{ ziweiConnectBusy===`delete:${binding.id}` ? '删除中…' : '删除绑定' }}</button></div></div>
                <p v-else class="terminal-binding-empty">这台手机尚未绑定数字员工。</p>
              </section>
            </template>
          </TerminalConsole>
          <details class="terminal-employee-actions"><summary>数字员工动作与执行记录</summary>
          <ZiCard class="ziwei-connect-actions-card"><div class="card-heading"><div><h3>数字员工动作</h3><p class="modal-copy">动作会排队到目标设备，结果返回后会自动刷新。</p></div><span class="soft-tag">{{ ziweiConnectSelection.deviceId || '未选设备' }}</span></div><div class="ziwei-connect-action-buttons"><ZiButton variant="secondary" :disabled="!canManageWorkspace || !ziweiConnectSelection.deviceId || !ziweiConnectSelection.employeeId || Boolean(ziweiConnectBusy)" @click="runZiweiConnectAction('health')">{{ ziweiConnectBusy==='health' ? '提交中…' : '健康检查' }}</ZiButton><ZiButton variant="secondary" :disabled="!canManageWorkspace || !ziweiConnectSelection.deviceId || !ziweiConnectSelection.employeeId || Boolean(ziweiConnectBusy)" @click="runZiweiConnectAction('screenshot')">{{ ziweiConnectBusy==='screenshot' ? '提交中…' : '获取截图' }}</ZiButton><ZiButton :disabled="!canManageWorkspace || !ziweiConnectSelection.deviceId || !ziweiConnectSelection.employeeId || Boolean(ziweiConnectBusy)" @click="runZiweiConnectAction('dry-run')">{{ ziweiConnectBusy==='dry-run' ? '提交中…' : '演练动作' }}</ZiButton></div><div v-if="Object.keys(ziweiConnectRuns).length" class="ziwei-connect-runs"><article v-for="run in Object.values(ziweiConnectRuns).slice().reverse()" :key="connectRunId(run)" class="ziwei-connect-run" :data-status="connectRunStatus(run)"><div class="card-heading"><strong>{{ run.action || run.command || '连接动作' }}</strong><ZiStatusTag :status="connectRunTagStatus(run)" :label="connectRunLabel(run)" dot/></div><p v-if="connectCommandId(run)" class="ziwei-connect-command">command_id: <code>{{ connectCommandId(run) }}</code></p><p v-else-if="connectRunStatus(run)==='dry_run'" class="ziwei-connect-command">演练记录：未创建 command_id</p><p v-if="run.taskId || run.task_id || run.conversationId || run.conversation_id" class="ziwei-connect-command">关联：{{ run.taskId || run.task_id ? `任务 ${run.taskId || run.task_id}` : '' }}{{ run.conversationId || run.conversation_id ? ` 会话 ${run.conversationId || run.conversation_id}` : '' }}</p><p v-if="connectRunVerificationError(run)" class="ziwei-connect-error">回执校验：{{ connectRunVerificationError(run) }}</p><p v-if="connectRunError(run)" class="ziwei-connect-error">{{ connectRunError(run) }}</p><p v-if="connectRunReceipt(run)" class="ziwei-connect-receipt">回执：{{ connectRunReceipt(run) }}</p><img v-if="connectSnapshotSrc(run)" class="ziwei-connect-screenshot" :src="connectSnapshotSrc(run)" alt="设备截图"/><pre v-if="run.result && !connectSnapshotSrc(run)">{{ JSON.stringify(run.result, null, 2) }}</pre></article></div></ZiCard>
          </details>
          <ZiCard v-if="ziweiConnectStatus.diagnostics.length" class="ziwei-connect-diagnostics"><div class="card-heading"><h3>诊断信息</h3></div><div v-for="item in ziweiConnectStatus.diagnostics" :key="item.id || item.key || item.name" class="runtime-row"><div class="row-main"><strong>{{ item.name || item.key || '诊断' }}</strong><small>{{ item.message || item.detail || item.status || '' }}</small></div><ZiStatusTag :status="['ok','healthy','online','passed'].includes(String(item.status || '').toLowerCase()) ? 'online' : ['error','failed'].includes(String(item.status || '').toLowerCase()) ? 'failed' : 'neutral'" :label="item.status || 'info'"/></div></ZiCard>
        </div>

        <div v-else-if="page==='issues'" class="tasks-page">
          <div class="task-page-header">
            <div class="task-page-title"><ZiIcon name="activity" :size="19"/><h1>任务</h1></div>
            <ZiButton class="automation-button" variant="secondary" @click="openAutomationEditor()"><Zap :size="16"/>自动化</ZiButton>
          </div>
          <div class="task-board-toolbar">
            <div class="task-scope-tabs" role="tablist" aria-label="任务范围">
              <button type="button" role="tab" :aria-selected="issueTab==='all'" class="scope-tab" :class="{active:issueTab==='all'}" @click="issueTab='all'">全部</button>
              <button type="button" role="tab" :aria-selected="issueTab==='members'" class="scope-tab" :class="{active:issueTab==='members'}" @click="issueTab='members'">成员</button>
              <button type="button" role="tab" :aria-selected="issueTab==='agents'" class="scope-tab" :class="{active:issueTab==='agents'}" @click="issueTab='agents'">数字伙伴</button>
            </div>
            <div class="task-toolbar-actions">
              <span class="work-count">{{ visibleTasks.filter(t=>t.state==='in_progress').length }} 工作中</span>
              <div class="task-menu-anchor">
                <button class="task-control" :class="{active:issueFilterOpen}" @click="issueFilterOpen=!issueFilterOpen;issueDisplayOpen=false;issueViewOpen=false"><SlidersHorizontal :size="15"/>筛选</button>
                <div v-if="issueFilterOpen" class="task-popover filter-popover">
                  <div class="popover-heading"><strong>筛选任务</strong><button class="popover-close" @click="issueFilterOpen=false"><X :size="15"/></button></div>
                  <div class="filter-block"><small>状态</small><label v-for="state in [{key:'planned',label:'待规划'},{key:'todo',label:'待办'},{key:'in_progress',label:'进行中'},{key:'review',label:'审核中'},{key:'completed',label:'已完成'},{key:'blocked',label:'已阻塞'}]" :key="state.key"><input v-model="selectedStates" type="checkbox" :value="state.key"/> <span>{{ state.label }}</span></label></div>
                  <div class="filter-block"><small>优先级</small><label v-for="priority in [{key:'high',label:'高'},{key:'medium',label:'普通'},{key:'low',label:'低'}]" :key="priority.key"><input v-model="selectedPriorities" type="checkbox" :value="priority.key"/> <span>{{ priority.label }}</span></label></div>
                  <div class="popover-actions"><button class="text-action" @click="resetIssueFilters">重置</button><button class="solid-action" @click="applyIssueFilters">应用筛选</button></div>
                </div>
              </div>
              <div class="task-menu-anchor">
                <button class="task-control" :class="{active:issueDisplayOpen}" @click="issueDisplayOpen=!issueDisplayOpen;issueFilterOpen=false;issueViewOpen=false"><ArrowDownUp :size="15"/>手动</button>
                <div v-if="issueDisplayOpen" class="task-popover display-popover">
                  <div class="popover-heading"><strong>显示方式</strong><button class="popover-close" @click="issueDisplayOpen=false"><X :size="15"/></button></div>
                  <div class="popover-label">分组</div><div class="segmented"><button :class="{selected:issueGroup==='status'}" @click="issueGroup='status'">状态</button><button :class="{selected:issueGroup==='assignee'}" @click="issueGroup='assignee'">负责人</button></div>
                  <div class="popover-label">排序</div><button v-for="sort in [{key:'manual',label:'手动'},{key:'priority',label:'优先级'},{key:'title',label:'标题'},{key:'created',label:'创建时间'}]" :key="sort.key" class="select-row" :class="{selected:issueSort===sort.key}" @click="issueSort=sort.key"><span>{{ sort.label }}</span><CheckCircle2 v-if="issueSort===sort.key" :size="15"/></button>
                  <div class="popover-label">卡片字段</div><label class="switch-row"><input v-model="cardProperties.priority" type="checkbox"/>优先级</label><label class="switch-row"><input v-model="cardProperties.assignee" type="checkbox"/>负责人</label><label class="switch-row"><input v-model="cardProperties.dueDate" type="checkbox"/>截止日期</label>
                </div>
              </div>
              <div class="task-menu-anchor">
                <button class="task-control" :class="{active:issueViewOpen}" @click="issueViewOpen=!issueViewOpen;issueFilterOpen=false;issueDisplayOpen=false"><Kanban :size="15"/>看板</button>
                <div v-if="issueViewOpen" class="task-popover view-popover"><button :class="{selected:issueView==='board'}" @click="setIssueView('board')"><Kanban :size="16"/>看板<CheckCircle2 v-if="issueView==='board'" :size="15"/></button><button :class="{selected:issueView==='list'}" @click="setIssueView('list')"><List :size="16"/>列表<CheckCircle2 v-if="issueView==='list'" :size="15"/></button><button :class="{selected:issueView==='swimlane'}" @click="setIssueView('swimlane')"><LayoutList :size="16"/>泳道<CheckCircle2 v-if="issueView==='swimlane'" :size="15"/></button></div>
              </div>
            </div>
          </div>
          <div class="issue-quick-tray" aria-label="任务快捷操作"><button aria-label="快捷菜单" @click="toggleQuickTray('issues')"><Grip :size="18"/></button><button aria-label="搜索任务" @click="openQuickSearch"><Search :size="20"/></button><button class="quick-primary" aria-label="通过数字伙伴创建" title="通过数字伙伴创建" @click="openAgentComposer"><Plus :size="23"/></button><button aria-label="收件箱" @click="navigate('inbox')"><Inbox :size="19"/></button><div v-if="quickTrayMenu==='issues'" class="quick-tray-menu"><button @click="quickTrayAction('issues','task')"><Plus :size="14"/>新建任务</button><button @click="quickTrayAction('issues','search')"><Search :size="14"/>搜索任务</button><button @click="quickTrayAction('issues','inbox')"><Inbox :size="14"/>打开收件箱</button></div></div>
          <div v-if="loading" class="empty-wrap"><ZiEmptyState icon="◌" title="正在加载" description="正在读取工作区任务"/></div>
          <div v-else-if="issueView==='board'" class="task-board faithful-board">
            <section v-for="lane in lanes" :key="lane.key" class="task-lane" :data-state="lane.key">
              <header class="task-lane-header"><div class="lane-heading"><CircleDashed v-if="lane.key==='planned'" :size="16"/><Circle v-else-if="lane.key==='todo'" :size="16"/><CircleDot v-else-if="lane.key==='in_progress'" :size="16"/><CheckCircle2 v-else-if="lane.key==='review'" :size="16"/><CheckCircle2 v-else-if="lane.key==='completed'" :size="16"/><CircleAlert v-else :size="16"/><strong>{{ lane.label }}</strong><span>{{ lane.tasks.length }}</span></div><div class="lane-actions"><button aria-label="更多操作" @click="laneMenuKey=laneMenuKey===lane.key ? '' : lane.key"><MoreHorizontal :size="17"/></button><div v-if="laneMenuKey===lane.key" class="task-popover lane-popover"><button @click="addTaskInLane(lane.key);laneMenuKey=''">在此列新建任务</button><button @click="issueSort='priority';laneMenuKey=''">按优先级排序</button><button @click="selectedStates=[lane.key];issueView='list';laneMenuKey=''">只查看此列任务</button></div><button aria-label="添加任务" @click="addTaskInLane(lane.key)"><Plus :size="17"/></button></div></header>
              <div class="task-lane-body" @dragover.prevent @drop="dropTaskInLane(lane.key,$event)"><article v-for="task in lane.tasks" :key="task.id" class="task-card" draggable="true" tabindex="0" @dragstart="startTaskDrag(task,$event)" @dragend="clearTaskDrag" @dblclick="openTaskDetail(task)" @keydown.enter="openTaskDetail(task)"><div class="task-card-title"><button class="task-card-title-link" @click="openTaskDetail(task)"><strong>{{ task.title }}</strong></button><button aria-label="任务菜单" @click.stop="openTaskDetail(task)"><MoreHorizontal :size="15"/></button></div><p v-if="task.description">{{ task.description }}</p><div v-if="task.execution" class="task-execution" :data-status="task.execution.status">{{ taskExecutionLabel(task.execution) }}</div><div class="task-meta" v-if="cardProperties.priority"><span class="priority-chip" :data-priority="task.priority">{{ task.priority==='high'?'高优先级':task.priority==='low'?'低优先级':'普通' }}</span><ZiSelect class="task-state-select" :model-value="task.state" :options="taskStateOptions" aria-label="更改任务状态" @update:model-value="moveTask(task,$event)"/></div></article><div v-if="!lane.tasks.length" class="lane-empty">将任务拖到这里</div></div>
            </section>
          </div>
          <div v-else-if="issueView==='swimlane'" class="task-swimlanes">
            <section v-for="swimlane in assigneeLanes" :key="swimlane.name" class="task-swimlane task-lane">
              <header class="task-lane-header"><div class="lane-heading"><UserRound :size="16"/><strong>{{ swimlane.name }}</strong><span>{{ swimlane.tasks.length }}</span></div><div class="lane-actions"><button aria-label="为负责人添加任务" @click="addTaskInLane()"><Plus :size="17"/></button></div></header>
              <div class="task-lane-body task-swimlane-items"><button v-for="task in swimlane.tasks" :key="task.id" class="task-swimlane-item" @click="openTaskDetail(task)"><span><strong>{{ task.title }}</strong><small>{{ task.description || '暂无描述' }}</small></span><ZiStatusTag :status="task.state==='completed'?'online':'neutral'" :label="task.state"/></button><div v-if="!swimlane.tasks.length" class="lane-empty">无任务</div></div>
            </section>
            <div v-if="!assigneeLanes.length" class="empty-wrap compact"><ZiEmptyState icon="⌕" title="还没有任务" description="创建一个任务，把下一步行动交给紫薇。" action="创建任务" @action="addTaskInLane()"/></div>
          </div>
          <div v-else-if="!visibleTasks.length" class="empty-wrap compact"><ZiEmptyState icon="⌕" title="还没有任务" description="创建一个任务，把下一步行动交给紫薇。" action="创建任务" @action="addTaskInLane()"/></div>
          <ZiCard v-else><div class="doc-row" v-for="task in visibleTasks" :key="task.id" @dblclick="openTaskDetail(task)" tabindex="0"><button class="task-card-title-link" @click="openTaskDetail(task)" style="font-size:20px">▣</button><div class="row-main"><strong>{{ task.title }}</strong><small>{{ task.description || '暂无描述' }}</small></div><ZiStatusTag :status="task.state==='completed'?'online':'neutral'" :label="task.state"/><ZiSelect class="task-state-select" :model-value="task.state" :options="taskStateOptions" aria-label="更改任务状态" @update:model-value="moveTask(task,$event)"/></div></ZiCard>
        </div>
        <div v-else-if="page==='automations'" class="automations-page">
          <div class="page-header"><div><span class="eyebrow">AUTOMATION</span><h1>自动化</h1><p>用时间表或 Webhook 让紫薇重复执行工作。</p></div><ZiButton @click="openAutomationEditor()"><Plus :size="16"/>新建自动化</ZiButton></div>
          <div v-if="!automations.length" class="empty-wrap"><ZiEmptyState icon="↻" title="还没有自动化" description="创建一个模板或空白自动化，让紫薇按计划执行任务。" action="新建自动化" @action="openAutomationEditor()"/></div>
          <div v-else class="grid-3 automation-grid"><ZiCard v-for="automation in automations" :key="automation.id" class="automation-card"><div class="card-heading"><h3>{{ automation.name }}</h3><ZiStatusTag :status="automation.status==='active'?'online':'neutral'" :label="automation.status==='active'?'运行中':'已暂停'" dot/></div><p>{{ automation.prompt || '暂无运行说明' }}</p><div class="automation-meta"><span>{{ automation.schedule || '手动运行' }}</span><span>{{ automation.next_run ? `下次 ${automation.next_run}` : '尚未运行' }}</span></div><div class="skill-footer"><button class="pill" @click="openAutomationDetails(automation)">查看详情</button><button class="pill" @click="openAutomationEditor(automation)">编辑</button><button class="pill" @click="toggleAutomation(automation)">{{ automation.status==='active'?'暂停':'启用' }}</button><button class="pill" @click="runAutomationNow(automation)">立即运行</button></div></ZiCard></div>
        </div>
        <div v-else-if="page==='calendar'" class="calendar-page">
          <div class="calendar-page-header">
            <div class="calendar-title"><CalendarDays :size="19"/><h1>日历</h1></div>
            <div class="calendar-view-switch"><button :class="{active:calendarView==='month'}" @click="calendarView='month'">月</button><button :class="{active:calendarView==='week'}" @click="calendarView='week'">周</button><button :class="{active:calendarView==='day'}" @click="calendarView='day'">日</button></div>
          </div>
          <div class="calendar-layout">
            <aside class="calendar-settings-panel">
              <h2>日历设置</h2>
              <button class="calendar-setting-row" :aria-pressed="calendarShowTasks === true" @click="calendarShowTasks=!calendarShowTasks"><span>显示任务</span><span class="calendar-switch" :class="{on:calendarShowTasks === true}"><i/></span></button>
              <button class="calendar-setting-row" :aria-pressed="calendarHumanOnly === true" @click="calendarHumanOnly=!calendarHumanOnly"><span>仅显示人类任务</span><span class="calendar-switch" :class="{on:calendarHumanOnly === true}"><i/></span></button>
              <label class="calendar-field"><span>任务筛选</span><ZiSelect v-model="calendarTaskFilter" :options="[{label:'全部',value:'all'},...taskStateOptions]"/></label>
              <div class="calendar-projects"><h3>项目显示</h3><label><input v-model="calendarProjectVisible" type="checkbox"/> <span>{{ workspaceSlugValue }}</span></label></div>
            </aside>
            <section class="calendar-main">
              <div class="calendar-toolbar"><button class="calendar-nav-button" aria-label="上个月" @click="moveCalendarMonth(-1)"><ChevronLeft :size="17"/></button><strong>{{ calendarMonthLabel }}</strong><button class="calendar-nav-button" aria-label="下个月" @click="moveCalendarMonth(1)"><ChevronRight :size="17"/></button><button class="calendar-today" @click="calendarToday">今天</button></div>
              <div v-if="calendarView==='month'" class="month-calendar"><div v-for="weekday in ['周日','周一','周二','周三','周四','周五','周六']" :key="weekday" class="weekday">{{ weekday }}</div><div v-for="cell in calendarGrid" :key="cell.key" class="calendar-cell" :class="{outside:cell.outside,today:cell.today}" @dragover.prevent @drop="dropCalendarEvent(cell.key,$event)"><div class="calendar-cell-head"><span class="calendar-day-number" :class="{today:cell.today}">{{ cell.date.getDate() }}</span><button class="calendar-cell-add" aria-label="创建活动" title="创建活动" @click.stop="openCalendarEvent(cell.key)"><Plus :size="12"/></button></div><button v-for="event in calendarEventsFor(cell.key)" :key="event.id" class="calendar-event" :data-status="event.status" :draggable="['event','task'].includes(event.source)" @dragstart="startCalendarEventDrag(event,$event)" @dragend="clearCalendarEventDrag" @click.stop="editCalendarEvent(event)">{{ event.name }}</button></div></div>
              <div v-else-if="calendarView==='week'" class="week-calendar"><div v-for="cell in calendarWeekDays" :key="cell.key" class="week-column" @dragover.prevent @drop="dropCalendarEvent(cell.key,$event)"><header>{{ ['周日','周一','周二','周三','周四','周五','周六'][cell.date.getDay()] }}<strong>{{ cell.date.getDate() }}</strong><button class="calendar-cell-add" aria-label="创建活动" @click="openCalendarEvent(cell.key)"><Plus :size="12"/></button></header><div class="week-events"><button v-for="event in calendarEventsFor(cell.key)" :key="event.id" class="calendar-event" :data-status="event.status" :draggable="['event','task'].includes(event.source)" @dragstart="startCalendarEventDrag(event,$event)" @dragend="clearCalendarEventDrag" @click="editCalendarEvent(event)">{{ event.name }}</button></div></div></div>
              <div v-else class="day-calendar" @dragover.prevent @drop="dropCalendarEvent(localDateKey(calendarCursor),$event)"><div class="day-heading"><span>{{ calendarCursor.getFullYear() }}年{{ calendarCursor.getMonth()+1 }}月{{ calendarCursor.getDate() }}日</span><button class="pill" @click="openCalendarEvent(localDateKey(calendarCursor))"><Plus :size="14"/>新建</button></div><button v-for="event in calendarEventsFor(localDateKey(calendarCursor))" :key="event.id" class="day-event" :draggable="['event','task'].includes(event.source)" @dragstart="startCalendarEventDrag(event,$event)" @dragend="clearCalendarEventDrag" @click="editCalendarEvent(event)"><CalendarClock :size="17"/><span>{{ event.name }}</span></button><div v-if="!calendarEventsFor(localDateKey(calendarCursor)).length" class="day-empty">拖入日程或当天暂无安排</div></div>
            </section>
          </div>
          <div class="calendar-quick-tray" aria-label="日历快捷操作"><button aria-label="快捷菜单" @click="toggleQuickTray('calendar')"><Grip :size="18"/></button><button aria-label="搜索日历" @click="openQuickSearch"><Search :size="20"/></button><button class="quick-primary" aria-label="通过数字伙伴创建" title="通过数字伙伴创建" @click="openAgentComposer"><Plus :size="20"/></button><button aria-label="收件箱" @click="navigate('inbox')"><Inbox :size="19"/></button><div v-if="quickTrayMenu==='calendar'" class="quick-tray-menu"><button @click="quickTrayAction('calendar','event')"><Plus :size="14"/>新建日程</button><button @click="quickTrayAction('calendar','task')"><Zap :size="14"/>新建任务</button><button @click="quickTrayAction('calendar','inbox')"><Inbox :size="14"/>打开收件箱</button></div></div>
          <button class="floating-assistant calendar-cut" @click="openClipboardAssistant">✂</button><button class="floating-assistant calendar-spark" @click="openAgentComposer">◒</button><button class="chat-fab" @click="openAgentComposer">◯</button>
        </div>
        <div v-else-if="page==='docs'" class="docs-page">
          <header class="docs-page-header">
            <div class="docs-title"><Folder :size="19"/><h1>文档</h1></div>
            <div class="docs-actions">
              <button class="docs-action-icon" aria-label="刷新文档" title="刷新" @click="refreshDocs"><RefreshCw :size="17"/></button>
              <button class="docs-action-button" @click="openDocUpload"><Upload :size="16"/>上传</button>
              <button class="docs-action-button" @click="openGitSync('export')">导出 Git</button>
              <button class="docs-action-button" @click="openGitSync('import')">导入 Git</button>
              <button class="docs-action-button" @click="openDocForm('file')"><FileText :size="16"/>新建 Markdown</button>
              <button class="docs-action-button" @click="openDocForm('folder')"><FolderPlus :size="16"/>新建文件夹</button>
              <input ref="docUploadInput" class="docs-upload-input" type="file" @change="handleDocUpload"/>
            </div>
          </header>
          <div class="docs-search-row"><label class="docs-search"><Search :size="18"/><input v-model="docsSearch" placeholder="搜索文档..." aria-label="搜索文档"/></label></div>
          <div class="docs-quota"><div class="docs-quota-label"><HardDrive :size="16"/><span>已用 {{ docsUsedBytes }} B / 10.0 GiB</span></div><div class="docs-quota-track"><span :style="{width:`${docsUsedPercent}%`}"></span></div></div>
          <div class="docs-browser">
            <aside class="docs-tree" aria-label="文档目录"><button v-for="row in docsTreeRows" :key="row.folder.id" class="docs-tree-row" :class="{selected:(row.folder.id === docsRootFolder.id ? docsPath === 'root' : docsPath === row.folder.id)}" :style="{paddingLeft:(12 + row.depth * 16) + 'px'}" @click="row.folder.id === docsRootFolder.id ? openDocsRoot() : openDocFolder(row.folder)"><ChevronRight :size="14" :class="{'docs-tree-chevron-open':row.folder.id === docsRootFolder.id ? docsPath === 'root' : docsPath === row.folder.id}"/><component :is="(row.folder.id === docsRootFolder.id ? docsPath === 'root' : docsPath === row.folder.id) ? FolderOpen : Folder" :size="19"/><span>{{ row.folder.name }}</span></button></aside><section class="docs-files" aria-live="polite"><div v-if="docsPath !== 'root' && docsPath !== docsRootFolder.id" class="docs-breadcrumb"><button class="link-button" @click="openDocsRoot">说明文档</button><ChevronRight :size="14"/><span>{{ documents.find(item => item.id === docsPath)?.name || '当前文件夹' }}</span></div>
              <div v-if="docsEntries.length" class="docs-entry-grid">
              <div v-for="entry in docsEntries" :key="entry.id" class="docs-entry-wrap"><button class="docs-entry-card" :class="{folder:entry.type==='folder'}" @dblclick="entry.type==='folder' && openDocFolder(entry)" @click="entry.type==='folder' ? openDocFolder(entry) : openDocument(entry)"><Folder v-if="entry.type==='folder'" :size="37" stroke-width="1.7"/><FileText v-else :size="34" stroke-width="1.7"/><span>{{ entry.name }}</span></button><div class="docs-entry-actions"><a v-if="entry.type!=='folder'" class="docs-entry-download" :href="api.downloadDocument(entry.id)" :download="entry.name" target="_blank" rel="noopener">下载</a><button v-if="entry.type!=='folder'" class="docs-entry-download" @click="openDocument(entry)">编辑</button></div></div>
              </div>
              <div v-else class="docs-empty-state"><Folder :size="48" stroke-width="1.4"/><div class="docs-empty-copy"><h2>暂无文件</h2><p>上传文件或创建文件夹来管理项目文档。</p></div><div class="docs-empty-actions"><button class="docs-empty-primary" @click="openDocUpload"><Upload :size="16"/>上传</button><button class="docs-empty-secondary" @click="openDocForm('folder')"><FolderPlus :size="16"/>新建文件夹</button></div></div>
            </section>
          </div>
          <div class="docs-quick-tray" aria-label="文档快捷操作"><button aria-label="快捷菜单" @click="toggleQuickTray('docs')"><Grip :size="18"/></button><button aria-label="搜索文档" @click="document.querySelector('.docs-search input')?.focus()"><Search :size="20"/></button><button class="quick-primary" aria-label="通过数字伙伴创建" title="通过数字伙伴创建" @click="openAgentComposer"><Plus :size="20"/></button><button aria-label="收件箱" @click="navigate('inbox')"><Inbox :size="19"/></button><div v-if="quickTrayMenu==='docs'" class="quick-tray-menu"><button @click="quickTrayAction('docs','upload')"><Upload :size="14"/>上传文档</button><button @click="quickTrayAction('docs','folder')"><FolderPlus :size="14"/>新建文件夹</button><button @click="quickTrayAction('docs','inbox')"><Inbox :size="14"/>打开收件箱</button></div></div>
          <button class="floating-assistant docs-cut" @click="openClipboardAssistant">✂</button><button class="floating-assistant docs-spark" @click="openAgentComposer">◒</button><button class="chat-fab" @click="openAgentComposer">◯</button>
        </div>

        <div v-else-if="page==='runtimes'" class="team-page"><header class="team-header"><div class="team-title"><Server :size="18"/><h1>运行时</h1><span>{{ runtimes.length }}</span></div><div class="header-actions"><ZiButton variant="secondary" @click="load"><RefreshCw :size="15"/>刷新</ZiButton><ZiButton @click="openDeviceModal(false)"><Server :size="15"/>添加设备</ZiButton></div></header><div class="environment-card"><div class="environment-toolbar"><span>Agent 环境</span><span>{{ devices.length }} 台设备 · {{ runtimes.length }} 个运行时</span></div><div v-if="!runtimes.length" class="empty-wrap compact"><ZiEmptyState icon="▣" title="暂无运行时" description="启动 ziwei_user 后会在这里显示桥接器和 CLI 版本。"/></div><div v-for="runtime in runtimes" :key="runtime.id" class="runtime-tree-row"><span class="online-dot" :class="{offline:runtime.cli_status!=='available'}"></span><ZiAvatar :name="runtime.name" size="sm"/><div class="entity-main"><strong>{{ runtime.name }}</strong><small>{{ runtime.name }} (ziwei_user)</small></div><div class="entity-tags"><button>版本 {{ runtime.cli_version || '等待 ziwei_user 心跳' }}</button><button>启动头 {{ runtime.name==='Claude'?'claude (stream-json)':runtime.name==='Codex'?'codex app-server':runtime.name==='Gemini'?'gemini (stream-json)':'hermes acp' }}</button></div><ZiStatusTag :status="runtime.cli_status==='available'?'online':'neutral'" :label="runtime.cli_status==='available'?'可用':'离线'" dot/></div></div></div>
        <div v-else-if="page==='members'" class="team-page">
          <header class="team-header">
            <div class="team-title"><Network :size="18"/><h1>团队管理</h1><span>{{ members.length + runtimes.length }}</span></div>
            <div class="header-actions"><ZiButton variant="secondary" @click="navigate('runtimes')"><Monitor :size="15"/>管理工位</ZiButton><ZiButton variant="secondary" @click="openDeviceModal(false)"><Server :size="15"/>添加设备</ZiButton><ZiButton v-if="canManageWorkspace" variant="secondary" @click="showInvite=true"><UserRound :size="15"/>邀请伙伴</ZiButton><ZiButton @click="openEmployeeModal"><Plus :size="15"/>添加数字员工</ZiButton></div>
          </header>
          <div class="team-quick-tray" aria-label="团队快捷操作"><button aria-label="快捷菜单" title="打开快捷操作" @click="toggleQuickTray('team')"><Grip :size="18"/></button><button aria-label="搜索团队" title="搜索团队" @click="openQuickSearch"><Search :size="20"/></button><button class="quick-primary" aria-label="通过数字伙伴创建" title="通过数字伙伴创建" @click="openAgentComposer"><Plus :size="20"/></button><button aria-label="审批" title="审批" @click="navigate('inbox')"><Inbox :size="19"/></button><div v-if="quickTrayMenu==='team'" class="quick-tray-menu"><button @click="quickTrayAction('team','device')"><Server :size="14"/>添加设备</button><button @click="quickTrayAction('team','employee')"><Plus :size="14"/>添加数字员工</button><button @click="quickTrayAction('team','inbox')"><Inbox :size="14"/>打开收件箱</button></div></div>
          <div class="team-view-tabs" role="tablist" aria-label="团队视图"><button type="button" role="tab" :aria-selected="teamView==='org'" :class="{active:teamView==='org'}" @click="teamView='org'"><Network :size="14"/>组织架构图</button><button type="button" role="tab" :aria-selected="teamView==='tree'" :class="{active:teamView==='tree'}" @click="teamView='tree'"><LayoutList :size="14"/>目录树</button></div>
          <div class="team-scroll">
            <section v-if="teamView==='org'" class="org-chart" :class="{'has-employees':employees.length}" aria-label="组织架构图">
              <div class="org-workspace-card"><Network :size="24"/><strong>{{ workspaceSlugValue }}</strong><span>工作区</span></div>
              <div class="org-connector org-connector-main"></div>
              <div class="org-owner-card"><div class="org-avatar">{{ (currentAccount.name || currentAccount.email || '当前账号').slice(0,1).toUpperCase() }}</div><div class="org-owner-name"><strong>{{ currentAccount.name || currentAccount.email || '当前账号' }}</strong><span>你</span></div><div class="org-owner-role"><Crown :size="14"/>{{ currentAccount.role || '成员' }}</div></div>
              <div class="org-connector org-connector-owner"></div>
              <button class="org-add-employee" @click="openEmployeeModal"><Plus :size="14"/>添加数字员工</button>
              <div v-if="employees.length" class="org-connector org-connector-employees"></div>
              <div v-if="employees.length" class="org-employee-list" aria-label="数字员工">
                <div v-for="employee in employees" :key="employee.id" class="org-employee-item">
                  <button type="button" class="org-employee-card" :aria-expanded="employeeActionId===employee.id" @click="openEmployeeActions(employee)">
                    <ZiAvatar :name="employee.name" size="sm"/>
                    <span class="org-employee-copy"><strong :title="employee.name">{{ employee.name }}</strong><small>{{ employee.runtime }} · {{ employee.runtime_profile ? `profile: ${employee.runtime_profile}` : '主 profile' }} · ziwei_user</small><em>{{ employeeRoleSummary(employee) }}</em></span>
                    <ZiStatusTag :status="employee.status==='active'?'online':'neutral'" :label="employeeStatusLabel(employee.status)" dot/>
                  </button>
                  <div v-if="employeeActionId===employee.id" class="org-employee-actions" role="menu" :aria-label="`${employee.name} 操作`">
                    <button type="button" role="menuitem" @click="scheduleEmployeeTask(employee)"><ClipboardList :size="17"/>安排任务</button>
                    <button type="button" role="menuitem" @click="openEmployeeProfile(employee)"><Settings2 :size="17"/>配置伙伴</button>
                  </div>
                </div>
              </div>
            </section>
            <section v-else class="directory-tree" aria-label="目录树">
              <div class="directory-card">
                <div class="directory-workspace"><div class="directory-icon"><Network :size="17"/></div><div><div class="directory-name"><strong>{{ workspaceSlugValue }}</strong><span>工作区</span></div></div></div>
                <div class="directory-member-group">
                  <div class="directory-row directory-member-summary"><div class="directory-icon"><UserRound :size="17"/></div><div class="directory-row-copy"><strong>成员</strong><span>{{ members.length }} 位真人伙伴，{{ employees.length }} 个数字员工</span></div></div>
                  <div class="directory-row directory-owner-row"><div class="directory-avatar">{{ (currentAccount.name || currentAccount.email || '当前账号').slice(0,1).toUpperCase() }}</div><div class="directory-row-copy"><strong>{{ currentAccount.name || currentAccount.email || '当前账号' }} <small>你</small></strong><span><Crown :size="13"/> {{ currentAccount.role || '成员' }}</span></div></div>
                  <div v-for="member in members.filter(item => item.role !== 'owner')" :key="member.id" class="directory-row directory-owner-row"><div class="directory-avatar">{{ (member.name || member.email || '成员').slice(0,1).toUpperCase() }}</div><div class="directory-row-copy"><strong>{{ member.name || member.email }}</strong><span>{{ member.role === 'admin' ? '管理员' : '成员' }} · {{ member.email }}</span></div><button v-if="canManageWorkspace" type="button" class="device-edit-action" @click="openMemberEditor(member)">编辑</button><button v-if="canManageWorkspace" type="button" class="device-remove-action" @click="removeMember(member)">移除</button></div>
                </div>
                <div class="directory-agent-group">
                  <div class="directory-row directory-agent-heading"><div class="directory-icon"><Server :size="17"/></div><div class="directory-row-copy"><strong>Agent环境</strong><span>{{ devices.length }}台设备</span></div><strong class="directory-count">{{ deviceSectionLabel }} {{ devices.length }}</strong></div>
                  <div v-for="device in devices" :key="device.id" class="directory-device"><button class="directory-device-toggle" aria-label="展开设备" @click.stop="toggleDeviceCollapse(device.id)"><ChevronDown :size="14" :class="{open:!collapsedDevices.has(device.id)}"/></button><span class="online-dot" :class="{offline:device.status!=='online'}"></span><Monitor :size="16"/><div><strong>{{ device.name }}</strong><span class="soft-tag">ziwei_user</span><small>daemon {{ device.id.slice(0,10) }}… · {{ device.status==='online'?'心跳正常':'等待心跳' }}</small></div><strong class="directory-count">{{ runtimes.length }}/{{ runtimes.length }}</strong><button v-if="canManageDevice(device)" type="button" class="device-edit-action" @click="openDeviceEditor(device)">编辑</button><button v-if="canDeleteDevice(device)" type="button" class="device-remove-action" @click="removeDevice(device)"><Trash2 :size="13"/>移除</button></div>
                </div>
              </div>
            </section>
            <section v-if="teamView==='org'" class="team-environment-section">
              <div class="team-section-title"><div><Server :size="17"/><strong>Agent环境</strong><span>{{ devices.length }}台设备</span></div></div>
              <div class="environment-card">
                <div class="environment-toolbar"><div class="environment-toolbar-left"><span>设备清单</span><span><UserRound :size="14"/>{{ deviceSectionLabel }} {{ devices.length }}</span></div><span class="environment-summary"><button class="text-action" @click="collapseAllDevices">⌁ 一键折叠</button><button class="text-action" @click="expandAllDevices">全部展开</button>　{{ devices.length }}台设备，{{ runtimes.length }}个Agent环境，{{ employees.length }}个数字员工</span></div>
                <div v-if="!devices.length" class="empty-wrap compact"><ZiEmptyState icon="▣" title="还没有设备" description="登记本机设备后，ziwei_user 会在这里显示心跳。" action="添加设备" @action="openDeviceModal(false)"/></div>
                <div v-for="device in devices" :key="device.id" class="device-tree">
                  <div class="device-row"><span class="tree-chevron">⌄</span><span class="online-dot" :class="{offline:device.status!=='online'}"></span><Monitor :size="18"/><div class="entity-main"><div><strong>{{ device.name }}</strong><span class="soft-tag">ziwei_user</span></div><small>bridge {{ device.bridge_name || 'ziwei_user' }} · {{ device.id.slice(0,10) }}… · {{ device.status==='online'?'心跳正常':'已离线' }}</small></div><div class="entity-tags"><button @click="copyTeamValue(`设备 ${device.name} · ${device.os}`)">设备 {{ device.name }} · {{ device.os }}</button><button @click="copyTeamValue(`${device.bridge_name || 'ziwei_user'} ${device.bridge_version || 'unknown'}`)">{{ device.bridge_name || 'ziwei_user' }} CLI {{ device.bridge_version || '版本未知' }}</button><button @click="copyTeamValue(device.id)">Daemon {{ device.id.slice(0,10) }}…</button><button>最后在线 {{ deviceLastSeenLabel(device) }}</button><button>创建时间 {{ formatDeviceDate(device.created_at) }}</button></div><strong class="entity-count">{{ runtimes.length }}个Agent环境　{{ runtimes.length }}/{{ runtimes.length }}</strong><button v-if="canManageDevice(device)" type="button" class="device-edit-action" @click="openDeviceEditor(device)">编辑</button><button v-if="canDeleteDevice(device)" type="button" class="device-remove-action" @click="removeDevice(device)"><Trash2 :size="13"/>移除</button></div>
                   <template v-if="!collapsedDevices.has(device.id)"><template v-for="runtime in runtimes" :key="runtime.id"><div class="runtime-tree-row"><span class="tree-branch"></span><span class="online-dot" :class="{offline:runtime.cli_status!=='available'}"></span><ZiAvatar :name="runtime.name" size="sm"/><div class="entity-main"><div><strong>{{ runtime.name }}</strong><ZiStatusTag :status="runtime.cli_status==='available'?'online':'neutral'" :label="runtime.cli_status==='available'?'可用':'离线（等待 ziwei_user 心跳）'" dot/></div><small>{{ runtime.name }} ({{ device.name }})</small></div><div class="entity-tags"><button>版本 {{ runtime.cli_version || '等待 ziwei_user 心跳' }}</button><button>启动头 {{ runtime.name==='Claude'?'claude (stream-json)':runtime.name==='Codex'?'codex app-server':runtime.name==='Gemini'?'gemini (stream-json)':'hermes acp' }}</button><button>类型 内置</button><button>可见范围 仅创建者可用</button><button>最后在线 {{ runtime.cli_status==='available'?'刚刚':'—' }}</button></div><span class="employee-count">{{ employeesForRuntime(runtime).length ? `${employeesForRuntime(runtime).length} 个数字员工` : '暂无数字员工' }}</span></div><div v-for="employee in employeesForRuntime(runtime)" :key="employee.id" class="employee-tree-row"><span class="tree-branch"></span><span class="online-dot" :class="{offline:employee.status!=='active'}"></span><img v-if="employee.avatar" :src="employee.avatar" alt="" class="employee-tree-avatar"/><ZiAvatar v-else :name="employee.name" size="sm"/><div class="entity-main"><strong>{{ employee.name }}</strong><small>{{ employee.runtime }} · {{ employee.visibility === 'personal' ? '个人' : '工作区' }} · {{ employeeStatusLabel(employee.status) }}</small><small v-if="employee.instructions || employee.description" class="employee-role-summary">岗位摘要：{{ employeeRoleSummary(employee) }}</small></div><button type="button" class="device-edit-action" @click="openEmployeeModal(employee)">编辑</button><button type="button" class="device-remove-action" @click="removeEmployee(employee)">删除</button></div></template></template>
                </div>
              </div>
              <div class="team-bottom-actions"><ZiButton variant="secondary" @click="openDeviceModal(false)"><Server :size="15"/>添加设备</ZiButton><ZiButton v-if="canManageWorkspace" variant="secondary" @click="showInvite=true"><UserRound :size="15"/>邀请伙伴</ZiButton></div>
            </section>
          </div>
          <button class="floating-assistant cut" @click="openClipboardAssistant">✂</button><button class="floating-assistant spark" @click="openAgentComposer">◒</button><button class="chat-fab" @click="openAgentComposer">◯</button>
        </div>

        <div v-else-if="page==='employee'" class="employee-profile-page">
          <header class="page-header employee-profile-header">
            <div class="employee-profile-breadcrumb"><button type="button" @click="navigate('members')">团队管理</button><span>›</span><span>数字伙伴</span><strong>{{ employeeProfile?.name || '数字伙伴' }}</strong><ZiStatusTag v-if="employeeProfile" :status="employeeProfile.status==='active'?'online':'neutral'" :label="employeeStatusLabel(employeeProfile.status)" dot/></div>
            <div class="header-actions"><ZiButton variant="secondary" @click="navigate('members')">返回团队</ZiButton><ZiButton v-if="employeeProfile" @click="openEmployeeModal(employeeProfile)">编辑伙伴</ZiButton></div>
          </header>
          <div v-if="employeeProfile" class="employee-profile-layout">
            <aside class="employee-profile-sidebar">
              <ZiCard class="employee-profile-card"><ZiAvatar :name="employeeProfile.name" size="lg"/><h2>{{ employeeProfile.name }}</h2><p>{{ employeeProfile.description || employeeProfile.instructions || '数字伙伴' }}</p><ZiStatusTag :status="employeeProfile.status==='active'?'online':'neutral'" :label="employeeStatusLabel(employeeProfile.status)" dot/><button type="button" class="employee-profile-task-button" @click="scheduleEmployeeTask(employeeProfile)"><ClipboardList :size="16"/>安排任务</button><button type="button" class="employee-profile-chat-button" @click="openEmployeeConversation(employeeProfile)"><Inbox :size="16"/>打开持久会话</button><dl><div><dt>运行工位</dt><dd>{{ employeeProfile.runtime }} (ziwei_user)</dd></div><div v-if="employeeProfile.runtime==='Hermes'"><dt>Hermes Profile</dt><dd>{{ employeeProfile.runtime_profile || '主 profile' }}</dd></div><div><dt>模型</dt><dd>{{ employeeProfile.model_id || employeeProfile.modelId || '默认（提供方）' }}</dd></div><div><dt>可见性</dt><dd>{{ employeeProfile.visibility === 'personal' ? '个人' : '工作区' }}</dd></div><div><dt>并发</dt><dd>{{ employeeProfile.concurrency || 1 }}</dd></div></dl></ZiCard>
            </aside>
            <main class="employee-profile-main">
              <nav class="employee-profile-tabs" role="tablist" aria-label="数字伙伴配置"><button type="button" role="tab" :aria-selected="employeeProfileTab==='activity'" :class="{active:employeeProfileTab==='activity'}" @click="employeeProfileTab='activity'">⌁ 动态</button><button type="button" role="tab" :aria-selected="employeeProfileTab==='tasks'" :class="{active:employeeProfileTab==='tasks'}" @click="employeeProfileTab='tasks'">☷ Tasks</button><button type="button" role="tab" :aria-selected="employeeProfileTab==='role'" :class="{active:employeeProfileTab==='role'}" @click="employeeProfileTab='role'">▤ 岗位说明</button><button type="button" role="tab" :aria-selected="employeeProfileTab==='skills'" :class="{active:employeeProfileTab==='skills'}" @click="employeeProfileTab='skills'">▥ 技能</button><button type="button" role="tab" :aria-selected="employeeProfileTab==='variables'" :class="{active:employeeProfileTab==='variables'}" @click="employeeProfileTab='variables'">⌘ 环境变量</button><button type="button" role="tab" :aria-selected="employeeProfileTab==='params'" :class="{active:employeeProfileTab==='params'}" @click="employeeProfileTab='params'">›_ 自定义参数</button><button type="button" role="tab" :aria-selected="employeeProfileTab==='mcp'" :class="{active:employeeProfileTab==='mcp'}" @click="employeeProfileTab='mcp'">♧ MCP</button><button type="button" role="tab" :aria-selected="employeeProfileTab==='external'" :class="{active:employeeProfileTab==='external'}" @click="employeeProfileTab='external'">⌘ 外部接入</button></nav><p v-if="employeeConfigLoading" class="employee-profile-copy employee-config-loading" role="status">正在读取数字员工配置…</p>
              <div v-if="employeeProfileTab==='activity'" class="employee-profile-panels"><ZiCard><h3>当前 <span>无进行中的工作</span></h3><p>这个数字伙伴当前没有在跑任何 task。</p></ZiCard><ZiCard><h3>近 30 天 <span>表现</span></h3><p>近 30 天没有完成记录。</p></ZiCard><ZiCard><h3>最近工作 <span>{{ employeeProfileConversations.length ? employeeProfileConversations.length + ' 条会话' : '还没有完成的 task' }}</span></h3><p>{{ employeeProfileConversations.length ? '从收件箱继续打开持久会话。' : '这个数字伙伴还没有完成过任何 task。' }}</p><button v-if="employeeProfileConversations.length" type="button" class="pill" @click="navigate('inbox')">打开收件箱</button></ZiCard></div>
              <div v-else-if="employeeProfileTab==='tasks'" class="employee-profile-section"><h3>Tasks <span>{{ employeeProfileTasks.length }}</span></h3><div v-if="employeeProfileTasks.length" class="employee-profile-task-list"><button v-for="task in employeeProfileTasks" :key="task.id" type="button" class="employee-profile-task-row" @click="openTaskDetail(task)"><strong>{{ task.title }}</strong><span>{{ task.state }}</span></button></div><p v-else class="task-detail-empty">这个数字伙伴还没有被安排任务。</p></div>
              <div v-else-if="employeeProfileTab==='role'" class="employee-profile-section"><h3>岗位说明</h3><div v-if="employeeRoleEditing" class="employee-profile-role-editor"><div class="employee-role-editor"><FileText :size="17"/><textarea v-model="employeeRoleDraft" rows="8" maxlength="2000" aria-label="岗位说明" placeholder="写清楚它负责什么、什么时候运行，以及怎样算完成。"></textarea></div><div class="employee-profile-role-actions"><button type="button" class="pill" :disabled="employeeRoleSaving" @click="cancelEmployeeRoleEdit">取消</button><button type="button" class="pill employee-profile-role-save" :disabled="employeeRoleSaving" @click="saveEmployeeRole">{{ employeeRoleSaving ? '保存中…' : '保存岗位说明' }}</button></div></div><template v-else><p class="employee-profile-copy">{{ employeeProfile.instructions || employeeProfile.description || '暂未填写岗位说明。' }}</p><h4>人格与协作方式</h4><p class="employee-profile-copy">{{ employeeProfile.persona || '暂未配置人格。' }}</p><button type="button" class="pill" @click="beginEmployeeRoleEdit(employeeProfile)">编辑岗位说明</button></template></div>
              <div v-else-if="employeeProfileTab==='skills'" class="employee-profile-section"><h3>技能 <span>{{ employeeProfile.skills?.length || 0 }}</span></h3><p class="employee-profile-copy">{{ employeeProfile.skills?.length ? '已配置 ' + employeeProfile.skills.length + ' 个工作区技能。' : '暂未配置技能。' }}</p><div v-for="skill in skills.filter(item=>employeeProfile.skills?.includes(item.id))" :key="skill.id" class="runtime-row"><div class="row-main"><strong>{{ skill.name }}</strong><small>版本 {{ skill.version || '未标注' }} · {{ skill.installed ? '目录已安装' : '目录未安装' }}</small></div><button type="button" class="pill" @click="openSkillVersions(skill)">版本</button></div><div class="form-actions"><button type="button" class="pill" @click="navigate('skills')">打开技能中心</button><button type="button" class="pill" @click="openPhoneSkillSetup(employeeProfile.id)">配置手机技能</button></div><p class="employee-profile-copy">技能绑定与实际加载分别验证；手机技能的加载和实机结果可在配置向导查看。</p></div>
              <div v-else-if="employeeProfileTab==='variables'" class="employee-profile-section employee-config-section"><div class="card-heading"><div><h3>环境变量</h3><p class="employee-profile-copy">员工级变量由紫薇加密保存；敏感值只显示掩码。运行时变量由本机 ziwei_user 注入，页面不会读取其值。</p></div><ZiStatusTag status="neutral" label="安全存储"/></div><div class="employee-runtime-source"><strong>本机 ziwei_user 提供</strong><span v-for="name in employeeEnvironment.local_source?.variables || []" :key="name" class="tag">{{ name }}</span></div><div v-if="employeeEnvironment.variables?.length" class="employee-config-list"><div v-for="item in employeeEnvironment.variables" :key="item.id" class="employee-config-row"><div><strong>{{ item.key }}</strong><small>{{ item.sensitive ? '敏感值 · 仅显示掩码' : '普通值' }} · 最近更新 {{ item.updated_at }}</small></div><span class="employee-config-value">{{ item.sensitive ? item.masked_value : item.value }}</span><div class="employee-config-actions"><button type="button" class="pill" @click="editEmployeeEnvironment(item)">更新</button><button type="button" class="pill" @click="removeEmployeeEnvironment(item)">删除</button></div></div></div><p v-else class="task-detail-empty">还没有员工级环境变量。</p><div class="employee-config-editor"><h4>{{ employeeEnvironmentEditing ? `更新 ${employeeEnvironmentEditing}` : '新增员工级变量' }}</h4><div class="grid-2"><label>变量名<input v-model="employeeEnvironmentDraft.key" :disabled="Boolean(employeeEnvironmentEditing)" placeholder="例如 API_TOKEN" maxlength="128"/></label><label>新值<input v-model="employeeEnvironmentDraft.value" type="password" placeholder="只在提交时发送" maxlength="16384"/></label></div><label class="employee-checkbox"><input v-model="employeeEnvironmentDraft.sensitive" type="checkbox"/>敏感值（默认开启，仅显示掩码）</label><div class="form-actions"><button v-if="employeeEnvironmentEditing" type="button" class="pill" @click="cancelEmployeeEnvironmentEdit">取消</button><button type="button" class="pill employee-profile-role-save" @click="saveEmployeeEnvironment">保存变量</button></div></div></div>
              <div v-else-if="employeeProfileTab==='params'" class="employee-profile-section employee-config-section"><div class="card-heading"><div><h3>自定义参数</h3><p class="employee-profile-copy">参数按 JSON 对象校验并持久化到员工配置；不会混入运行时环境变量。</p></div><ZiStatusTag status="neutral" :label="employeeCustomParams.updated_at ? '已保存' : '未配置'"/></div><textarea v-model="employeeCustomParamsDraft" class="employee-params-editor" rows="14" spellcheck="false" aria-label="自定义参数 JSON"></textarea><div class="form-actions"><button type="button" class="pill employee-profile-role-save" :disabled="employeeConfigSaving" @click="saveEmployeeCustomParams">{{ employeeConfigSaving ? '保存中…' : '校验并保存' }}</button></div></div>
              <div v-else-if="employeeProfileTab==='mcp'"><div class="employee-profile-section employee-phone-skill-entry"><h3>手机 MCP</h3><p class="employee-profile-copy">配置手机技能、精确设备绑定与实际加载检测，分别核对保存、API 和实机回执。</p><button type="button" class="pill" @click="openPhoneSkillSetup(employeeProfile.id)">配置手机技能</button></div><ManagementMcpPanel :workspace="workspaceSlugValue" :employee="employeeProfile" :can-manage="canManageWorkspace"/></div>
              <div v-else class="employee-profile-section"><h3>外部接入</h3><p class="employee-profile-copy">可在开放平台中查看 A2A 与 Webhook 接入方式。</p><button type="button" class="pill" @click="navigate('open')">打开开放平台</button></div>
            </main>
          </div>
          <ZiEmptyState v-else icon="!" title="数字伙伴不存在" description="返回团队管理重新选择数字伙伴。" action="返回团队" @action="navigate('members')"/>
        </div>

        <div v-else-if="page==='skills'" class="skills-page"><div class="page-header"><div><h1>技能中心</h1><p>浏览平台能力，或维护当前工作区的团队技能。</p></div><div class="header-actions"><ZiButton variant="secondary" @click="openSkillCatalog">平台目录</ZiButton><ZiButton variant="secondary" @click="openSkillImport">导入 SKILL.md</ZiButton><ZiButton @click="openSkillForm">添加团队技能</ZiButton></div></div><div class="skill-scope-tabs" role="tablist" aria-label="技能范围"><button type="button" role="tab" :aria-selected="skillScope==='platform'" :class="{active:skillScope==='platform'}" @click="skillScope='platform';skillTab='all'">平台技能 <span>{{ skills.filter(skill => (skill.scope || skill.source || 'platform') === 'platform').length }}</span></button><button type="button" role="tab" :aria-selected="skillScope==='team'" :class="{active:skillScope==='team'}" @click="skillScope='team';skillTab='all'">团队技能 <span>{{ skills.filter(skill => (skill.scope || skill.source) === 'team').length }}</span></button></div><div class="toolbar skill-toolbar"><div class="skill-category-tabs" role="tablist" aria-label="技能分类"><button type="button" role="tab" :aria-selected="skillTab==='all'" :class="{active:skillTab==='all'}" @click="skillTab='all'">全部</button><button v-for="category in skillCategories" :key="category" type="button" role="tab" :aria-selected="skillTab===category" :class="{active:skillTab===category}" @click="skillTab=category">{{ category }}</button></div><input v-model="search" class="search" placeholder="搜索技能名称、描述或标签"/></div><div v-if="!filteredSkills.length" class="empty-wrap compact"><ZiEmptyState icon="✦" :title="skillScope==='team' ? '还没有团队技能' : '没有匹配的技能'" :description="skillScope==='team' ? '添加一个团队技能，让成员可以重复使用。' : '尝试调整分类或搜索关键词。'" :action="skillScope==='team' ? '添加团队技能' : ''" @action="openSkillForm"/></div><div v-else class="grid-3 skill-grid"><ZiCard v-for="skill in filteredSkills" :key="skill.id" class="skill-card" :data-testid="skill.integration?.kind === 'phone_mcp' ? 'phone-platform-skill' : undefined"><div class="skill-card-icon">{{ skill.icon || '✦' }}</div><div class="card-heading"><h3>{{ skill.name }}</h3><ZiStatusTag :status="skill.installed?'online':'neutral'" :label="skill.installed?'已安装':'可安装'" dot/></div><p>{{ skill.description }}</p><div class="skill-meta"><span class="tag">{{ skill.category }}</span><span v-if="skill.recommended" class="skill-recommended">推荐</span><span v-if="skill.version">版本 {{ skill.version }}</span><span>{{ skill.install_count || 0 }} 次安装</span></div><div class="skill-footer"><span class="skill-author">{{ skill.author || '紫薇团队' }}</span><ZiButton size="sm" variant="secondary" @click="openSkillVersions(skill)">版本</ZiButton><ZiButton v-if="skill.installed" size="sm" variant="secondary" @click="uninstallSkill(skill)">卸载</ZiButton><ZiButton v-if="skill.integration?.kind === 'phone_mcp'" size="sm" @click="openPhoneSkillSetup()">{{ skill.installed ? '配置手机技能' : '安装并配置' }}</ZiButton><ZiButton v-else size="sm" :variant="skill.installed?'secondary':'primary'" @click="toggleSkill(skill)">{{ skill.installed?'停用':'安装' }}</ZiButton></div></ZiCard></div></div>

        <div v-else-if="page==='settings'"><div class="page-header"><div><h1>工作区设置</h1><p>配置紫薇的基础信息、访问权限和自动化策略。</p></div><ZiButton @click="saveSettings">保存更改</ZiButton></div><div class="settings-layout"><div class="settings-menu" role="tablist" aria-label="工作区设置"><button v-for="tab in [{key:'general',label:'基本信息'},{key:'security',label:'安全与访问'},{key:'automations',label:'自动化默认值'},{key:'billing',label:'用量与计费'}]" :key="tab.key" type="button" role="tab" :aria-selected="settingsTab===tab.key" :class="{active:settingsTab===tab.key}" @click="settingsTab=tab.key">{{ tab.label }}</button></div><ZiCard><div v-if="settingsTab==='general'" class="form-stack"><div class="card-heading"><h3>基本信息</h3><ZiStatusTag status="online" label="工作区正常" dot/></div><ZiFormField label="工作区名称" for-id="workspace-name"><ZiInput id="workspace-name" v-model="workspaceName"/></ZiFormField><ZiFormField label="工作区标识" hint="用于 API 和 A2A 路由"><ZiInput :model-value="workspaceSlugValue" readonly/></ZiFormField><ZiFormField label="工作区简介" for-id="workspace-description"><ZiTextarea id="workspace-description" v-model="workspaceDescription" placeholder="介绍这个工作区的用途" :rows="3"/></ZiFormField><ZiFormField label="工作区上下文" hint="供 A2A 和自动化理解当前工作区" for-id="workspace-context"><ZiTextarea id="workspace-context" v-model="workspaceContext" placeholder="例如：团队负责内容运营与客户支持" :rows="4"/></ZiFormField><ZiFormField label="可见性"><ZiSelect v-model="workspaceVisibility" :options="[{label:'工作区（所有成员可见）',value:'workspace'},{label:'个人（仅管理员可见）',value:'personal'}]"/></ZiFormField><ZiFormField label="路由前缀" hint="可选，用于 API 路由"><ZiInput v-model="workspacePrefix" placeholder="例如：/ziwei"/></ZiFormField><ZiFormField label="个人显示名称"><ZiInput v-model="profileName" placeholder="个人显示名称"/></ZiFormField><ZiFormField label="界面语言"><ZiSelect v-model="workspaceLanguage" :options="[{label:'简体中文',value:'zh-CN'},{label:'English',value:'en-US'},{label:'日本語',value:'ja-JP'},{label:'한국어',value:'ko-KR'}]"/></ZiFormField><ZiFormField label="主题"><ZiSelect v-model="workspaceTheme" :options="[{label:'浅色',value:'light'},{label:'跟随系统',value:'system'},{label:'深色',value:'dark'}]"/></ZiFormField><ZiFormField label="每周起始日"><ZiSelect v-model="workspaceWeekStart" :options="[{label:'周一',value:'monday'},{label:'周日',value:'sunday'}]"/></ZiFormField><ZiFormField label="默认时区"><ZiSelect v-model="workspaceTimezone" :options="[{label:'Asia/Shanghai',value:'Asia/Shanghai'},{label:'UTC',value:'UTC'}]"/></ZiFormField></div><div v-else-if="settingsTab==='security'" class="form-stack"><div class="card-heading"><h3>安全与访问</h3><ZiSwitch v-model="switchValue" label="启用本机 ziwei_user 心跳"/></div><p class="modal-copy">访问密钥只在创建时显示一次。前端只展示脱敏后的值，真实凭据不写入日志。</p><div class="runtime-row"><span>默认工作区密钥</span><span class="row-end">zwi_•••••••••••• · active</span></div><div class="runtime-row"><span>A2A agent</span><span class="row-end">ziwei_user</span></div><div class="form-actions"><ZiButton variant="secondary" @click="navigate('open')">管理 API Key</ZiButton></div></div><div v-else-if="settingsTab==='automations'" class="form-stack"><div class="card-heading"><h3>自动化默认值</h3><ZiStatusTag status="online" label="已接入 ziwei_user" dot/></div><ZiFormField label="默认输出方式"><ZiSelect v-model="automationDefaultMode" :options="[{label:'收件箱通知',value:'notification'},{label:'仅 Webhook',value:'webhook'},{label:'通知和 Webhook',value:'both'}]"/></ZiFormField><p class="modal-copy">新建自动化会使用这里的默认输出方式，单个自动化仍可单独设置 Webhook。</p><div class="form-actions"><ZiButton variant="secondary" @click="navigate('automations')">管理自动化</ZiButton></div></div><div v-else class="form-stack"><div class="card-heading"><h3>用量与计费</h3><ZiStatusTag status="neutral" label="本地工作区"/></div><div class="grid-2"><ZiMetricCard label="任务" :value="summary.counts.tasks" note="当前工作区"/><ZiMetricCard label="文档" :value="summary.counts.documents" note="当前工作区"/><ZiMetricCard label="自动化" :value="summary.counts.automations" note="当前工作区"/><ZiMetricCard label="在线运行时" :value="summary.counts.runtimes" note="ziwei_user 心跳"/></div><p class="modal-copy">紫薇当前使用本机工作区数据，不产生云端计费。</p></div></ZiCard></div></div>

        <div v-else-if="page==='invite'"><div class="page-header"><div><h1>邀请加入紫薇</h1><p>把团队成员加入当前工作区。</p></div></div><div class="grid-2"><ZiCard><div class="form-stack"><h3>邀请成员</h3><ZiFormField label="成员邮箱" required><ZiInput v-model="inviteForm.email" type="email" placeholder="name@example.com"/></ZiFormField><ZiFormField label="角色"><ZiSelect v-model="inviteForm.role" :options="[{label:'成员',value:'member'},{label:'管理员',value:'admin'}]"/></ZiFormField><div class="form-actions"><ZiButton @click="invite">发送邀请</ZiButton></div></div></ZiCard><ZiCard><div class="card-heading"><h3>邀请链接</h3><ZiStatusTag :status="inviteLink?'online':'neutral'" :label="inviteLink?'已生成':'未生成'"/></div><p class="modal-copy">邀请链接会绑定当前工作区和角色，方便在团队内部快速加入。</p><div v-if="inviteLink" class="invite-link-box">{{ inviteLink }}</div><ZiButton variant="secondary" @click="createInviteLink">生成并复制链接</ZiButton></ZiCard></div><ZiCard v-if="invitations.length" style="margin-top:16px"><div class="card-heading"><h3>邀请记录</h3><button class="pill" @click="loadInvitations">刷新</button></div><div v-for="item in invitations" :key="item.id" class="runtime-row"><div class="row-main"><strong>{{ item.email || '链接邀请' }}</strong><small>{{ item.role }} · {{ item.status }} · {{ item.expires_at }}</small></div><button v-if="item.status==='pending'" class="pill" @click="resendInvite(item)">重发</button><button v-if="item.status==='pending'" class="pill" @click="revokeInvite(item)">撤销</button></div></ZiCard></div>



        <div v-else-if="page==='open'"><div class="page-header"><div><h1>开放平台</h1><p>面向数字员工和开发者的 MCP、API、A2A 与 Webhook 能力。</p></div><ZiButton @click="openApiKeyModal">创建 API Key</ZiButton></div><ManagementMcpPanel :workspace="workspaceSlugValue" :can-manage="canManageWorkspace"/><div class="grid-3"><ZiCard><div class="card-heading"><h3>REST API</h3><ZiStatusTag status="online" label="可用" dot/></div><p class="modal-copy">工作区数据、任务、文档、技能和自动化的统一 HTTP 接口。</p><button class="pill" @click="copyTeamValue(API_BASE + '/api')">复制接口地址 →</button></ZiCard><ZiCard><div class="card-heading"><h3>A2A v1</h3><ZiStatusTag status="online" label="已启用" dot/></div><p class="modal-copy">Agent Card、Task、Message、状态查询和本机 ziwei_user 心跳。</p><button class="pill" @click="copyTeamValue(agents[0]?.id || 'ziwei_user')">{{ agents[0]?.id || 'ziwei_user' }} ↗</button></ZiCard><ZiCard><div class="card-heading"><h3>Webhook</h3><ZiStatusTag status="online" label="已启用" dot/></div><p class="modal-copy">自动化完成后向你的 HTTPS 地址发送带签名的事件，并记录投递和重试状态。</p><button class="pill" @click="page='automations';history.pushState({},'',routePath('automations'))">配置自动化回调 →</button></ZiCard></div><ZiCard style="margin-top:16px"><div class="card-heading"><div><h3>API Keys</h3><p class="modal-copy">REST API / A2A 专用密钥，只在创建或轮换时显示一次；不能用于管理 MCP。服务端只保存哈希。</p></div><button class="pill" @click="openApiKeyModal">管理密钥</button></div><div v-if="!apiKeys.length" class="empty-wrap compact"><ZiEmptyState icon="⌁" title="还没有 API Key" description="创建一个密钥连接紫薇 REST API 或 A2A。"/></div><div v-else v-for="key in apiKeys" :key="key.id" class="runtime-row"><div class="row-main"><strong>{{ key.name }}</strong><small>{{ key.prefix }}•••• · {{ key.role }} · {{ key.status }}</small></div><span class="row-end">{{ key.last_used_at ? `最近使用 ${key.last_used_at}` : '尚未使用' }}</span><button v-if="key.status==='active'" class="pill" @click="rotateApiKey(key)">轮换</button><button v-if="key.status==='active'" class="pill" @click="revokeApiKey(key)">撤销</button></div></ZiCard></div>

  <div v-else-if="page==='inbox'"><div class="page-header"><div><span v-if="focusedConversation" class="eyebrow">持久会话</span><h1>{{ focusedConversation ? (selectedConversation?.title || '持久会话') : '收件箱' }}</h1><p>{{ focusedConversation ? '与数字伙伴持续协作，消息和执行结果会保存在同一条会话中。' : '每个数字员工拥有独立的会话列表与执行记录。' }}</p></div><div class="header-actions"><ZiButton v-if="focusedConversation" variant="secondary" @click="navigate('inbox')">返回收件箱</ZiButton><ZiButton v-if="!focusedConversation" variant="secondary" @click="markAllNotificationsRead">全部已读</ZiButton></div></div><div class="inbox-layout" :class="{'conversation-focus-layout':focusedConversation}"><ZiCard v-if="!focusedConversation"><div class="card-heading"><h3>通知</h3><span class="work-count">{{ notificationStats.unread || 0 }} 未读</span></div><div v-if="!notifications.length" class="empty-wrap compact"><ZiEmptyState icon="✉" title="收件箱是空的" description="新的任务指派、运行时消息和自动化结果会出现在这里。"/></div><div v-else class="notification-list"><button v-for="item in notifications" :key="item.id" class="notification-row" :class="{unread:!item.read_at}" @click="api.markNotificationsRead([item.id]).then(loadNotifications)"><span class="notification-dot"/><span><strong>{{ item.action }}</strong><p>{{ item.actor }} · {{ item.created_at }}</p></span></button></div></ZiCard><ZiCard><div class="card-heading"><div><h3>对话</h3><p class="conversation-scope-caption">当前员工：{{ activeConversationEmployee?.name || (conversationEmployeeId === 'unassigned' ? '未绑定员工（历史会话）' : '未选择') }}</p></div><button class="pill" :disabled="conversationEmployeeId === 'unassigned'" @click="createConversation">新建</button></div><label class="conversation-employee-picker"><span>数字员工工作区</span><ZiSelect :model-value="conversationEmployeeId" :options="conversationEmployeeOptions" aria-label="选择数字员工" @update:model-value="selectConversationEmployee"/></label><div class="conversation-list"><button v-for="item in conversations" :key="item.id" class="conversation-row" :class="{selected:selectedConversation?.id===item.id}" @click="openConversation(item)"><div class="conversation-row-agent"><img v-if="item.employee?.avatar" :src="item.employee.avatar" class="conversation-row-agent-avatar" alt=""/><span v-else class="conversation-row-agent-fallback">{{ item.employee?.name?.slice(0,1) || '?' }}</span><strong>{{ item.title }}</strong></div><small>{{ item.employee?.name || '未绑定员工（历史记录）' }} · {{ item.employee?.runtime || '归属未知' }} · {{ item.message_count || 0 }} 条消息</small><span class="conversation-row-status" :data-status="item.execution?.status" v-if="item.execution?.status">{{ item.execution.status==='succeeded'?'已完成':item.execution.status==='failed'?'失败':item.execution.status==='acked'?'执行中':'等待执行' }}</span></button><p v-if="!conversations.length" class="task-detail-empty">还没有对话</p></div></ZiCard><ZiCard class="inbox-thread"><div v-if="selectedConversation" class="conversation-thread"><div class="card-heading conversation-thread-heading"><div><div class="conversation-agent-heading"><img v-if="selectedConversation.employee?.avatar" :src="selectedConversation.employee.avatar" class="conversation-agent-avatar" alt=""/><span v-else class="conversation-agent-fallback">{{ selectedConversation.employee?.name?.slice(0,1) || '?' }}</span><div><h3>{{ selectedConversation.title }}</h3><p>{{ selectedConversation.employee?.name || '未绑定员工（历史记录）' }} · {{ selectedConversation.employee?.runtime || '归属未知' }}</p></div></div><div class="conversation-status" :data-status="conversationExecutionTone" aria-live="polite"><span class="conversation-status-dot"/><strong>{{ conversationExecutionLabel }}</strong><small v-if="conversationStatusLoading">正在同步…</small><small v-else-if="conversationExecution?.completed_at">{{ conversationExecution.completed_at }}</small></div></div><button class="pill" @click="archiveSelectedConversation">归档</button></div><div v-if="conversationExecutionBusy" class="conversation-progress" aria-live="polite"><span class="conversation-progress-spinner"/>{{ (conversationLatestEvent ? executionEventLabel(conversationLatestEvent) : '') || '正在等待 ziwei_user 返回结果，页面会自动更新…' }}<small v-if="conversationLatestEvent">{{ executionEventDetail(conversationLatestEvent) }}</small></div><div v-else-if="conversationLatestEvent?.message" class="conversation-progress conversation-progress-terminal" :data-status="conversationExecutionTone">{{ conversationLatestEvent.message }}</div><details v-if="conversationExecution?.events?.length" class="execution-activity" open><summary><strong>执行活动</strong><span>{{ executionEventRows(conversationExecution.events).length }} 个阶段</span></summary><div ref="conversationExecutionList" class="execution-event-list" aria-label="执行进度"><div v-for="event in executionEventRows(conversationExecution.events)" :key="event.id" class="execution-event"><span class="execution-event-main"><i class="execution-event-dot" :data-stage="event.stage"></i><span class="execution-event-copy"><strong>{{ event.label }}</strong><small v-if="event.detail">{{ event.detail }}</small></span><b v-if="event.count > 1">×{{ event.count }}</b></span><time>{{ event.created_at }}</time></div></div></details><details v-if="executionReasoningSummaries(conversationExecution?.events).length" class="execution-reasoning-drawer conversation-reasoning-drawer"><summary><strong>思考摘要</strong><span>{{ executionReasoningSummaries(conversationExecution?.events).length }} 条可展开摘要</span></summary><article v-for="event in executionReasoningSummaries(conversationExecution?.events)" :key="`conversation-reasoning-${event.id}`" class="execution-reasoning-card"><div><strong>{{ event.label }}</strong><time>{{ event.created_at }}</time></div><p>{{ executionEventSummary(event) }}</p></article></details><div class="conversation-messages" aria-live="polite"><div v-for="message in selectedConversation.messages" :key="message.id" class="conversation-message" :class="message.role"><small>{{ message.role === 'user' ? '你' : message.role === 'assistant' ? '数字伙伴' : '系统' }}</small><p v-if="message.content">{{ message.content }}</p><div v-if="message.attachments?.length" class="conversation-message-attachments"><div v-for="attachment in message.attachments" :key="`${message.id}-${attachment.name}`" class="conversation-message-attachment"><img v-if="conversationAttachmentPreviewSrc(attachment)" :src="conversationAttachmentPreviewSrc(attachment)" :alt="attachment.name || '会话附件'"/><div class="conversation-message-attachment-meta"><strong>{{ attachment.name || '会话附件' }}</strong><small>{{ conversationAttachmentSizeLabel(attachment) || '已附加' }}</small></div></div></div></div><p v-if="!selectedConversation.messages?.length" class="task-detail-empty">发送第一条消息给 ziwei_user</p></div><div class="conversation-compose"><div class="conversation-compose-settings"><label v-if="devices.length" class="conversation-device"><span>目标设备</span><ZiSelect v-model="conversationDeviceId" :options="deviceOptions" aria-label="选择会话目标设备" @update:model-value="selectConversationDevice"/></label><label class="conversation-device"><span>模型</span><ZiSelect v-model="conversationModelId" :options="conversationModelOptions" aria-label="选择会话模型" @update:model-value="saveConversationSettings"/></label><label class="conversation-device conversation-directory"><span>工作目录</span><div class="conversation-directory-control"><ZiInput v-model="conversationWorkingDirectory" placeholder="目标设备当前目录" @blur="saveConversationSettings"/><button type="button" class="pill" @click="openConversationDirectoryPicker">选择目录</button><button type="button" class="pill" @click="conversationWorkingDirectory=selectedConversationDevice?.workdir || '';saveConversationSettings()">使用当前目录</button></div></label></div><div class="conversation-compose-editor"><textarea v-model="conversationDraft" rows="3" placeholder="告诉数字伙伴要做什么..." @keydown.enter.exact.prevent="sendConversationMessage"/><div class="conversation-compose-actions"><button type="button" class="pill" @click="openConversationAttachmentPicker"><Paperclip :size="14"/>添加附件</button><input ref="conversationAttachmentInput" type="file" hidden @change="handleConversationAttachment"/><span v-if="conversationAttachmentName" class="conversation-attachment-chip">{{ conversationAttachmentName }} <button type="button" @click="clearConversationAttachment" aria-label="移除附件">×</button></span><ZiButton size="sm" :disabled="conversationStatusLoading" @click="sendConversationMessage">发送</ZiButton></div></div></div></div><ZiEmptyState v-else icon="⌁" title="选择一个对话" description="从左侧选择对话，或新建一个。"/></ZiCard></div></div>
      </section>
  </WorkspaceShell>

  <PhoneSkillSetup v-if="showPhoneSkillSetup" :workspace="workspaceSlugValue" :workspaces="authState.memberships || []" :employee-id="phoneSetupContext.employeeId" :phone-device-id="phoneSetupContext.phoneDeviceId" :can-manage="canManageWorkspace" @close="showPhoneSkillSetup=false" @changed="load" @workspace="switchPhoneWorkspace" @create-employee="createEmployeeForPhone"/>

  <div v-if="showAgentComposer" class="agent-composer-backdrop" @click.self="closeAgentComposer">
    <section ref="agentComposerPanel" class="agent-composer" :class="{expanded:agentComposerExpanded}" role="dialog" aria-modal="true" aria-label="通过数字伙伴创建" tabindex="-1" @keydown="handleAgentComposerKeydown">
      <header class="agent-composer-header">
        <div class="agent-composer-breadcrumb"><span>{{ workspaceSlugValue }}</span><ChevronRight :size="13"/><strong>通过数字伙伴创建</strong></div>
        <div class="agent-composer-header-actions"><button aria-label="展开" title="展开" @click="agentComposerExpanded=!agentComposerExpanded"><Maximize2 :size="16"/></button><button aria-label="关闭" title="关闭" @click="closeAgentComposer"><X :size="16"/></button></div>
      </header>
      <div class="agent-composer-creator"><button type="button" :class="{'selected':agentComposerEmployeeId}" :aria-expanded="agentComposerEmployeeOpen" aria-haspopup="listbox" @click="agentComposerEmployeeOpen=!agentComposerEmployeeOpen"><span>创建者</span><span>{{ employees.find(item => item.id === agentComposerEmployeeId)?.name || '选一个数字伙伴...' }}</span><ChevronDown :size="15"/></button><div v-if="agentComposerEmployeeOpen" class="agent-composer-employee-menu" role="listbox" aria-label="选择创建者"><button v-for="employee in employees" :key="employee.id" type="button" role="option" :aria-selected="agentComposerEmployeeId===employee.id" :class="{'selected':agentComposerEmployeeId===employee.id}" @click="agentComposerEmployeeId=employee.id;agentComposerEmployeeOpen=false"><ZiAvatar :name="employee.name" size="sm"/><span><strong>{{ employee.name }}</strong><small>{{ employee.runtime }} · {{ employeeStatusLabel(employee.status) }}</small></span><CheckCircle2 v-if="agentComposerEmployeeId===employee.id" :size="15"/></button><p v-if="!employees.length">请先创建数字伙伴</p></div><label v-if="devices.length" class="agent-composer-device"><span>目标设备</span><ZiSelect v-model="agentComposerDeviceId" :options="deviceOptions" aria-label="选择目标设备"/></label></div>
      <div class="agent-composer-editor"><textarea v-model="agentComposerText" placeholder="告诉数字伙伴要做什么，例如：&quot;新建任务：让李明跟进 API 文档更新，让王芳跟进支付流程测试。请确认分工后直接执行。&quot;"></textarea><div class="agent-composer-voice"><button :class="{active:voiceListening}" :aria-label="voiceListening ? '停止语音输入' : '开始语音输入'" :title="voiceListening ? '停止语音输入' : '开始语音输入'" @click="toggleVoiceInput"><Mic :size="14"/></button></div></div>
      <footer class="agent-composer-footer"><button class="agent-composer-attach" aria-label="添加附件" title="添加附件" @click="openAgentComposerAttachmentPicker"><Paperclip :size="14"/></button><input ref="agentComposerAttachmentInput" type="file" hidden @change="handleAgentComposerAttachment"/><span v-if="agentComposerAttachmentName" class="agent-composer-attachment-name">{{ agentComposerAttachmentName }}</span><button v-if="agentComposerAttachmentName" class="agent-composer-attachment-remove" aria-label="移除附件" @click="agentComposerAttachment=null;agentComposerAttachmentName=''">×</button><button class="agent-composer-create" :disabled="!agentComposerText.trim()" @click="createFromAgentComposer">创建</button></footer>
    </section>
  </div>

  <ZiModal v-if="conversationDirectoryPickerOpen" title="选择工作目录" wide @close="closeConversationDirectoryPicker"><div class="conversation-directory-picker"><p class="modal-copy">目录来自目标设备 <strong>{{ selectedConversationDevice?.name || '未命名设备' }}</strong>。先检查真实路径；只有点击“创建并使用”才会在目标电脑创建缺失目录。</p><div class="conversation-directory-picker-input"><ZiInput v-model="conversationDirectoryPathDraft" placeholder="例如 C:/Users/25941/projects" @keydown.enter="inspectConversationDirectory()"/><button type="button" class="pill" :disabled="conversationDirectoryLoading" @click="inspectConversationDirectory()">检查目录</button></div><div v-if="conversationDirectoryLoading" class="conversation-directory-loading"><span class="conversation-progress-spinner"/>正在目标设备检查目录…</div><template v-else-if="conversationDirectoryInspection"><div class="conversation-directory-result" :data-missing="!conversationDirectoryInspection.exists"><div><strong>{{ conversationDirectoryInspection.exists ? '目录存在，可以使用' : '目录不存在' }}</strong><small>{{ conversationDirectoryInspection.path }}</small></div><span v-if="conversationDirectoryInspection.created" class="conversation-row-status">已创建</span></div><div class="conversation-directory-browser"><section><div class="card-heading"><h4>设备盘符</h4><small>{{ conversationDirectoryInspection.roots?.length || 0 }} 个</small></div><div class="conversation-directory-root-list"><button v-for="root in conversationDirectoryInspection.roots || []" :key="root" type="button" class="conversation-directory-option" @click="conversationDirectoryPathDraft=root;inspectConversationDirectory(root)"><HardDrive :size="14"/><span>{{ root }}</span></button><p v-if="!(conversationDirectoryInspection.roots || []).length" class="task-detail-empty">目标设备没有返回可用盘符。</p></div></section><section><div class="card-heading"><h4>当前目录的子目录</h4><small>{{ conversationDirectoryInspection.entries?.length || 0 }} 个</small></div><div class="conversation-directory-entry-list"><button v-for="entry in conversationDirectoryInspection.entries || []" :key="entry.path" type="button" class="conversation-directory-option" @click="conversationDirectoryPathDraft=entry.path;inspectConversationDirectory(entry.path)"><Folder :size="14"/><span>{{ entry.name }}</span></button><p v-if="!(conversationDirectoryInspection.entries || []).length" class="task-detail-empty">没有可进入的子目录。</p></div></section></div></template><div class="form-actions"><ZiButton variant="secondary" @click="closeConversationDirectoryPicker">取消</ZiButton><ZiButton v-if="conversationDirectoryInspection?.exists" @click="useConversationDirectory()">选择此目录</ZiButton><ZiButton v-else :disabled="conversationDirectoryLoading || !conversationDirectoryPathDraft.trim()" @click="createAndUseConversationDirectory">创建并使用</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showSearch" title="搜索任务" @close="showSearch=false"><div class="search-modal-content"><ZiInput v-model="search" autofocus placeholder="输入关键词搜索任务、描述或快捷命令"/><div class="search-command"><span>快捷操作</span><button @click="showSearch=false;addTaskInLane()"><Plus :size="15"/>新建任务</button><button @click="showSearch=false;navigate('inbox')"><Inbox :size="15"/>打开收件箱</button></div></div></ZiModal>
  <ZiModal v-if="showTask" title="快速创建任务" wide @close="showTask=false"><div class="form-stack"><ZiFormField label="标题" required><ZiInput v-model="taskForm.title" placeholder="例如：整理本周运营数据"/></ZiFormField><ZiFormField label="描述"><ZiTextarea v-model="taskForm.description" placeholder="补充任务背景、验收标准或上下文"/></ZiFormField><ZiFormField label="状态"><ZiSelect v-model="taskForm.state" :options="[{label:'待规划',value:'planned'},{label:'待办',value:'todo'},{label:'进行中',value:'in_progress'},{label:'审核中',value:'review'},{label:'已完成',value:'completed'},{label:'已阻塞',value:'blocked'}]"/></ZiFormField><ZiFormField label="优先级"><ZiSelect v-model="taskForm.priority" :options="[{label:'普通',value:'medium'},{label:'高',value:'high'},{label:'低',value:'low'}]"/></ZiFormField><ZiFormField label="截止日期"><ZiInput v-model="taskForm.dueDate" type="date"/></ZiFormField><div class="form-actions"><ZiButton variant="secondary" @click="showTask=false">取消</ZiButton><ZiButton @click="createTask">创建任务</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showTaskDetail" title="任务详情" wide @close="closeTaskDetail"><div v-if="taskDetail" class="task-detail-modal"><div class="task-detail-header"><div><span class="eyebrow">TASK</span><h2>{{ taskDetailForm.title }}</h2><p v-if="taskDetail.execution" class="task-execution" :data-status="taskDetail.execution.status">{{ taskExecutionLabel(taskDetail.execution) }}</p><details v-if="taskDetail.execution?.events?.length" class="execution-activity" open><summary><strong>执行活动</strong><span>{{ executionEventRows(taskDetail.execution.events).length }} 个阶段</span></summary><div ref="taskExecutionList" class="execution-event-list" aria-label="执行进度"><div v-for="event in executionEventRows(taskDetail.execution.events)" :key="event.id" class="execution-event"><span class="execution-event-main"><i class="execution-event-dot" :data-stage="event.stage"></i><span class="execution-event-copy"><strong>{{ event.label }}</strong><small v-if="event.detail">{{ event.detail }}</small></span><b v-if="event.count > 1">×{{ event.count }}</b></span><time>{{ event.created_at }}</time></div></div></details><details v-if="executionReasoningSummaries(taskDetail.execution?.events).length" class="execution-reasoning-drawer task-reasoning-drawer"><summary><strong>思考摘要</strong><span>{{ executionReasoningSummaries(taskDetail.execution?.events).length }} 条可展开摘要</span></summary><article v-for="event in executionReasoningSummaries(taskDetail.execution?.events)" :key="`task-reasoning-${event.id}`" class="execution-reasoning-card"><div><strong>{{ event.label }}</strong><time>{{ event.created_at }}</time></div><p>{{ executionEventSummary(event) }}</p></article></details></div><ZiStatusTag :status="taskDetailForm.state==='completed'?'online':'neutral'" :label="taskDetailForm.state"/></div><div class="task-detail-grid"><section class="task-detail-main"><ZiFormField label="标题" required><ZiInput v-model="taskDetailForm.title"/></ZiFormField><div class="task-detail-editor"><label>描述</label><div class="task-editor-toolbar"><button type="button" @click="insertTaskSyntax('**','**')"><b>B</b></button><button type="button" @click="insertTaskSyntax('`','`')">代码</button><button type="button" @click="insertTaskSyntax('- ','')">列表</button><ZiSelect v-model="taskDetailForm.descriptionFormat" :options="[{label:'纯文本',value:'plain'},{label:'Markdown',value:'markdown'},{label:'HTML',value:'html'}]" aria-label="描述格式"/></div><textarea v-model="taskDetailForm.description" class="task-detail-description" rows="9" placeholder="补充任务背景、验收标准或上下文"></textarea></div><div class="task-detail-fields"><ZiFormField label="状态"><ZiSelect v-model="taskDetailForm.state" :options="[{label:'待规划',value:'planned'},{label:'待办',value:'todo'},{label:'进行中',value:'in_progress'},{label:'审核中',value:'review'},{label:'已完成',value:'completed'},{label:'已阻塞',value:'blocked'}]"/></ZiFormField><ZiFormField label="优先级"><ZiSelect v-model="taskDetailForm.priority" :options="[{label:'普通',value:'medium'},{label:'高',value:'high'},{label:'低',value:'low'}]"/></ZiFormField><ZiFormField label="截止日期"><ZiInput v-model="taskDetailForm.dueDate" type="date"/></ZiFormField><ZiFormField label="负责人"><ZiInput v-model="taskDetailForm.assignee" placeholder="成员或数字员工"/></ZiFormField></div><div class="task-detail-actions"><ZiButton variant="secondary" @click="closeTaskDetail">取消</ZiButton><ZiButton @click="saveTaskDetail">保存修改</ZiButton></div></section><aside class="task-detail-side"><div class="task-detail-section"><div class="card-heading"><h3>附件</h3><button class="pill" type="button" @click="openTaskAttachmentPicker"><Paperclip :size="14"/>添加</button><input ref="taskAttachmentInput" type="file" hidden @change="handleTaskAttachmentUpload"/></div><div v-if="!taskAttachments.length" class="task-detail-empty">暂无附件</div><div v-for="attachment in taskAttachments" :key="attachment.id" class="task-attachment-row"><FileText :size="16"/><span class="row-main"><strong>{{ attachment.name }}</strong><small>{{ Math.ceil(Number(attachment.size||0)/1024) }} KB</small></span><button title="下载附件" @click="downloadTaskAttachment(attachment)"><Upload :size="14"/></button><button title="删除附件" @click="removeTaskAttachment(attachment)"><X :size="14"/></button></div></div><div class="task-detail-section task-detail-activity"><div class="task-detail-section-heading"><h3>活动记录</h3><span>{{ taskMessages.length }} 条</span></div><div class="task-message-list" aria-live="polite"><div v-if="!taskMessages.length" class="task-detail-empty">暂无消息</div><div v-for="message in taskMessages" :key="message.id" class="task-message" :class="message.role"><div class="task-message-meta"><span class="task-message-role">{{ message.role==='assistant'?'数字员工':message.role==='user'?'你':'系统' }}</span><time>{{ message.created_at }}</time></div><p class="task-message-content" :title="message.content">{{ message.content }}</p></div></div><div class="task-message-compose"><textarea v-model="taskMessageDraft" rows="3" placeholder="添加一条更新..."></textarea><ZiButton size="sm" @click="sendTaskMessage">发送</ZiButton></div></div></aside></div></div></ZiModal>
  <ZiModal v-if="showSkillModal" title="添加团队技能" @close="showSkillModal=false"><div class="form-stack"><p class="modal-copy">团队技能只在当前工作区可见，可随时安装或停用。</p><ZiFormField label="名称" required><ZiInput v-model="skillForm.name" placeholder="例如：周报整理"/></ZiFormField><ZiFormField label="描述"><ZiTextarea v-model="skillForm.description" rows="4" placeholder="说明这个技能解决什么问题"/></ZiFormField><ZiFormField label="分类"><ZiSelect v-model="skillForm.category" :options="[{label:'自动化',value:'automation'},{label:'工程',value:'engineering'},{label:'生产力',value:'productivity'},{label:'研究',value:'research'},{label:'协调',value:'orchestration'}]"/></ZiFormField><ZiFormField label="标签"><ZiInput v-model="skillForm.tags" placeholder="用逗号分隔，例如：日报,团队"/></ZiFormField><div class="form-actions"><ZiButton variant="secondary" @click="showSkillModal=false">取消</ZiButton><ZiButton @click="createSkill">添加技能</ZiButton></div></div></ZiModal>
<ZiModal v-if="showSkillVersions" title="技能版本" @close="showSkillVersions=false"><div class="form-stack"><h3>{{ skillVersionTarget?.name }}</h3><p v-if="!skillVersions.length" class="task-detail-empty">暂无已安装版本</p><div v-for="version in skillVersions" :key="version.id" class="runtime-row"><div class="row-main"><strong>{{ version.version || '未标注版本' }}</strong><small>{{ version.created_at }}</small></div><button class="pill" @click="rollbackSkillVersion(version)">恢复此版本</button></div></div></ZiModal>
  <ZiModal v-if="showSkillImport" title="导入技能" wide @close="showSkillImport=false"><div class="form-stack"><p class="modal-copy">支持本地 SKILL.md、URL、ZIP 压缩包，也可以从在线 ziwei_user 工位复制。</p><div class="skill-import-tabs"><button type="button" :class="{active:skillImportMode==='markdown'}" @click="skillImportMode='markdown'">SKILL.md</button><button type="button" :class="{active:skillImportMode==='url'}" @click="skillImportMode='url'">URL</button><button type="button" :class="{active:skillImportMode==='zip'}" @click="skillImportMode='zip'">ZIP</button><button type="button" :class="{active:skillImportMode==='workstation'}" @click="skillImportMode='workstation'">工位复制</button></div><template v-if="skillImportMode==='markdown'"><input ref="skillImportFile" type="file" accept=".md,.markdown,text/markdown" hidden @change="handleSkillImportFile"/><div class="form-actions"><ZiButton variant="secondary" @click="openSkillImportFile">选择 SKILL.md 文件</ZiButton></div><ZiFormField label="SKILL.md 内容" required><ZiTextarea v-model="skillImportForm.content" rows="12" placeholder="---\nname: my-skill\nversion: 1.0.0\n---\n\n# 用法"/></ZiFormField></template><template v-else-if="skillImportMode==='url'"><ZiFormField label="技能 URL" required><ZiInput v-model="skillImportForm.url" placeholder="https://example.com/SKILL.md"/></ZiFormField></template><template v-else-if="skillImportMode==='zip'"><input ref="skillImportArchiveFile" type="file" accept=".zip,application/zip" hidden @change="handleSkillArchiveFile"/><div class="form-actions"><ZiButton variant="secondary" @click="openSkillArchiveFile">选择 ZIP 压缩包</ZiButton><span class="modal-copy">{{ skillImportForm.archiveName || '压缩包内需要包含 SKILL.md' }}</span></div></template><template v-else><ZiFormField label="在线工位" required><ZiSelect v-model="skillImportForm.sourceDeviceId" :options="skillImportSources.filter(source => source.copy_supported).map(source => ({label:`${source.name} · 在线`,value:source.id}))"/></ZiFormField><p v-if="!skillImportSources.some(source => source.copy_supported)" class="task-detail-empty">没有可复制技能的在线 ziwei_user 工位。</p></template><ZiFormField v-if="skillImportMode!=='workstation'" label="名称"><ZiInput v-model="skillImportForm.name" placeholder="可从 frontmatter 自动读取"/></ZiFormField><ZiFormField v-if="skillImportMode!=='workstation'" label="描述"><ZiInput v-model="skillImportForm.description" placeholder="可从 frontmatter 自动读取"/></ZiFormField><div class="form-actions"><ZiButton variant="secondary" @click="showSkillImport=false">取消</ZiButton><ZiButton v-if="skillImportMode==='workstation'" :disabled="!skillImportForm.sourceDeviceId" @click="copySkillFromWorkstation">复制技能</ZiButton><ZiButton v-else @click="importSkill">导入</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showDoc" title="新建项目文档" @close="showDoc=false"><div class="form-stack"><ZiFormField label="名称" required><ZiInput v-model="docForm.name" placeholder="README.md 或 资料文件夹"/></ZiFormField><ZiFormField label="类型"><ZiSelect v-model="docForm.type" :options="[{label:'Markdown 文件',value:'file'},{label:'文件夹',value:'folder'}]"/></ZiFormField><ZiFormField v-if="docForm.type==='file'" label="内容"><ZiTextarea v-model="docForm.content" rows="6" placeholder="# 项目笔记"/></ZiFormField><div class="form-actions"><ZiButton variant="secondary" @click="showDoc=false">取消</ZiButton><ZiButton @click="createDoc">保存</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showGitSync" :title="gitSyncMode==='export' ? '导出文档到 Git' : '从 Git 导入文档'" @close="showGitSync=false"><div class="form-stack"><p class="modal-copy">{{ gitSyncMode==='export' ? '将当前工作区文档导出到本机受控 Git 目录并提交。' : '读取本机受控 Git 目录中的文档并更新当前工作区。' }}</p><ZiFormField label="同步目录名" required><ZiInput v-model="gitSyncForm.name" :placeholder="`例如：${workspaceSlugValue}`"/></ZiFormField><ZiFormField v-if="gitSyncMode==='export'" label="提交说明"><ZiInput v-model="gitSyncForm.message" placeholder="本次文档同步"/></ZiFormField><div class="form-actions"><ZiButton variant="secondary" @click="showGitSync=false">取消</ZiButton><ZiButton @click="runGitSync">{{ gitSyncMode==='export' ? '导出并提交' : '导入文档' }}</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showApiKeys" title="管理 API Key" wide @close="showApiKeys=false"><div class="form-stack"><p class="modal-copy">创建、轮换或撤销访问紫薇 REST API 的密钥。真实密钥只在创建和轮换后显示一次。</p><div v-if="createdApiToken" class="api-token-box"><strong>请立即复制新密钥</strong><code>{{ createdApiToken }}</code><ZiButton size="sm" @click="copyApiToken">复制密钥</ZiButton></div><ZiFormField label="名称" required><ZiInput v-model="apiKeyForm.name" placeholder="例如：本机 CLI"/></ZiFormField><ZiFormField label="角色"><ZiSelect v-model="apiKeyForm.role" :options="[{label:'成员',value:'member'},{label:'管理员',value:'admin'},{label:'所有者',value:'owner'}]"/></ZiFormField><ZiFormField label="过期时间"><ZiInput v-model="apiKeyForm.expiresAt" type="date"/></ZiFormField><div class="form-actions"><ZiButton @click="createApiKey">创建密钥</ZiButton></div><div class="api-key-list"><div v-for="key in apiKeys" :key="key.id" class="runtime-row"><div class="row-main"><strong>{{ key.name }}</strong><small>{{ key.prefix }}•••• · {{ key.role }} · {{ key.status }}</small></div><div class="api-key-actions"><button class="pill" :disabled="key.status!=='active'" @click="rotateApiKey(key)">轮换</button><button class="pill" :disabled="key.status!=='active'" @click="revokeApiKey(key)">撤销</button></div></div><p v-if="!apiKeys.length" class="task-detail-empty">暂无密钥</p></div></div></ZiModal>
  <ZiModal v-if="showInvite" title="邀请成员" @close="showInvite=false"><div class="form-stack"><ZiFormField label="邮箱"><ZiInput v-model="inviteForm.email" type="email" placeholder="name@example.com"/></ZiFormField><ZiFormField label="角色"><ZiSelect v-model="inviteForm.role" :options="[{label:'成员',value:'member'},{label:'管理员',value:'admin'}]"/></ZiFormField><div class="form-actions"><ZiButton @click="invite">发送邀请</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showDevice" :title="deviceSetupMode ? '连接 ziwei_user' : '添加设备'" wide @close="closeDeviceModal"><div class="device-install-modal"><p class="modal-copy">连接设备是可选的。只有要在某台电脑上运行数字员工时，才在那台电脑安装通用 ziwei_user daemon；创建工作区和管理项目不需要先连接设备。</p><div class="device-connection-details"><div><strong>服务器 API 地址</strong><code>{{ deviceApiBase }}</code></div><div><strong>工作区标识</strong><code>{{ deviceWorkspaceSlug }}</code></div><div v-if="deviceCertificateRequired"><strong>连接证书</strong><span><a :href="deviceServerCertificateUrl" download="ziwei-server.crt" target="_blank" rel="noopener">下载服务器证书</a><small>当前地址需要额外证书校验；下载后在目标电脑用 ziwei_user setup --tls-ca-file 指定路径。</small></span></div><div v-else><strong>连接证书</strong><span><small>当前正式 HTTPS 地址已验证，无需下载额外证书。</small></span></div></div><div class="device-pairing-code"><div><strong>一次性配对码</strong><button type="button" class="pill" :disabled="devicePairingBusy || !devicePairing?.code" @click="copyDevicePairing">复制配对码</button></div><code v-if="devicePairing?.code">{{ devicePairing.code }}</code><span v-else>{{ devicePairingBusy ? '正在生成配对码…' : '暂时无法生成配对码' }}</span><small v-if="devicePairing?.expires_at">10 分钟内有效，连接成功后立即失效。</small><button v-if="!devicePairingBusy" type="button" class="text-action" @click="createDevicePairing">重新生成</button></div><div class="device-command-mode" role="tablist" aria-label="安装方式"><button type="button" role="tab" :aria-selected="deviceCommandMode==='existing'" :class="{active:deviceCommandMode==='existing'}" @click="deviceCommandMode='existing'">电脑已安装 ziwei_user</button><button type="button" role="tab" :aria-selected="deviceCommandMode==='first'" :class="{active:deviceCommandMode==='first'}" @click="deviceCommandMode='first'">这台电脑第一次安装</button></div><p class="device-command-help">同一台电脑再次连接新的工作区时，只运行 connect 和 start，不需要重复安装。首次安装才需要 npm install。</p><div class="device-install-tabs" role="tablist" aria-label="操作系统"><button v-for="tab in [{key:'windows',label:'Windows'},{key:'macos',label:'macOS'},{key:'linux',label:'Linux'}]" :key="tab.key" type="button" role="tab" :aria-selected="deviceInstallTab===tab.key" :class="{active:deviceInstallTab===tab.key}" @click="deviceInstallTab=tab.key">{{ tab.label }}</button></div><div class="device-install-command"><div class="device-install-command-head"><strong>{{ deviceCommandMode==='first'?'首次安装并连接 ziwei_user':'连接已安装的 ziwei_user' }}</strong><button type="button" class="pill" @click="copyDeviceCommand">{{ copiedDeviceCommand===deviceInstallTab?'已复制':'复制命令' }}</button></div><pre>{{ deviceInstallCommands[deviceInstallTab] }}</pre><small><code>--name</code> 只是网页设备目录中的显示名称，可以改成“办公室电脑”等；它不会改变电脑、账号或 Agent 的真实身份。配对码只会发放一次，不会写入网页或日志。</small></div><div class="device-install-status"><span class="online-dot" :class="{offline:!ownDeviceOnline}"></span><div><strong>{{ ownDeviceOnline?'ziwei_user 已在线':'等待 ziwei_user 上线' }}</strong><small>{{ ownDeviceOnline?`最近心跳 ${summary.device?.heartbeat_age_ms || 0}ms 前`:'连接并启动后点击刷新，页面会重新读取真实心跳。' }}</small></div><button type="button" class="pill" @click="load">刷新状态</button></div><div class="form-stack" v-if="!deviceSetupMode"><ZiFormField label="设备显示名称"><ZiInput v-model="deviceForm.name"/><small>这个名称只用于网页展示；修改后点击“重新生成”，会写入新的设备记录。</small></ZiFormField><div class="form-actions"><ZiButton variant="secondary" @click="closeDeviceModal">关闭</ZiButton><ZiButton @click="addDevice">重新生成配对码</ZiButton></div></div><div class="form-actions" v-else><ZiButton variant="secondary" @click="dismissDeviceSetup">稍后</ZiButton><ZiButton :disabled="!ownDeviceOnline" @click="closeDeviceModal">已连接，继续使用</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showDeviceEditor" title="编辑设备" @close="showDeviceEditor=false"><div class="form-stack"><p class="modal-copy">设备名称只影响工作区中的显示，不会改变本机 ziwei_user、设备 ID 或已发现的 Agent。</p><ZiFormField label="设备名称" required><ZiInput v-model="deviceEditForm.name" autofocus placeholder="例如：办公室电脑"/></ZiFormField><ZiFormField label="操作系统"><ZiInput v-model="deviceEditForm.os" placeholder="Windows"/></ZiFormField><div class="form-actions"><ZiButton variant="secondary" @click="showDeviceEditor=false">取消</ZiButton><ZiButton @click="saveDeviceEditor">保存</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showMemberEditor" title="编辑成员" @close="showMemberEditor=false"><div class="form-stack"><ZiFormField label="姓名" required><ZiInput v-model="memberEditForm.name"/></ZiFormField><ZiFormField label="邮箱" required><ZiInput v-model="memberEditForm.email" type="email"/></ZiFormField><ZiFormField label="角色"><ZiSelect v-model="memberEditForm.role" :options="[{label:'成员',value:'member'},{label:'管理员',value:'admin'}]"/></ZiFormField><div class="form-actions"><ZiButton variant="secondary" @click="showMemberEditor=false">取消</ZiButton><ZiButton @click="saveMember">保存</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showEmployee" :title="employeeEditId ? '编辑数字伙伴' : '创建数字伙伴'" wide @close="showEmployee=false">
    <div class="employee-create-modal">
      <header class="employee-create-modal__header">
        <div><h2>{{ employeeEditId ? '编辑数字伙伴' : '创建数字伙伴' }}</h2><p>{{ employeeEditId ? '更新数字伙伴的配置与协作方式。' : '为工作区创建一个新的 AI 数字伙伴。' }}</p></div>
        <button type="button" class="employee-create-close" aria-label="关闭" @click="showEmployee=false"><X :size="18"/></button>
      </header>
      <nav class="employee-create-tabs" role="tablist" aria-label="创建方式">
        <button type="button" role="tab" :aria-selected="employeeModalTab==='manual'" :class="{active:employeeModalTab==='manual'}" @click="employeeModalTab='manual'"><span>手动创建</span></button>
        <button type="button" role="tab" :aria-selected="employeeModalTab==='market'" :class="{active:employeeModalTab==='market'}" @click="employeeModalTab='market'"><FolderOpen :size="15"/><span>从伙伴市场创建</span></button>
      </nav>
      <div v-if="employeeModalTab==='market'" class="employee-market-empty">
        <div class="employee-market-icon">✦</div><h3>伙伴市场</h3><p>从工作区技能中心选择可复用的数字伙伴模板。</p>
        <button type="button" class="employee-secondary-button" @click="navigate('skills');showEmployee=false">浏览技能中心</button>
      </div>
      <div v-else class="employee-create-modal__body">
        <section class="employee-basic-grid">
          <div class="employee-avatar-picker"><button type="button" class="employee-avatar-preview" aria-label="选择头像" @click="openEmployeeAvatarPicker"><img v-if="employeeAvatar" :src="employeeAvatar" alt=""/><span v-else class="employee-avatar-placeholder">✦</span></button><input ref="employeeAvatarFile" type="file" accept="image/*" hidden @change="handleEmployeeAvatar"/><button type="button" aria-label="移除头像" :disabled="!employeeAvatar" @click="clearEmployeeAvatar"><X :size="12"/></button></div>
          <div class="employee-field employee-field-name"><label for="employee-name">名称</label><input id="employee-name" v-model="employeeForm.name" autofocus placeholder="例如：深度研究数字伙伴" /></div>
          <div class="employee-field employee-field-description"><label for="employee-description">描述</label><input id="employee-description" v-model="employeeDescription" maxlength="255" placeholder="这个数字伙伴做什么？" /><span class="employee-counter">{{ employeeDescription.length }} / 255</span></div>
        </section>

        <section class="employee-field employee-visibility-field"><label>可见性</label><div class="employee-choice-grid">
          <button type="button" class="employee-choice-card" :class="{selected:employeeVisibility==='workspace'}" @click="employeeVisibility='workspace'"><span class="employee-choice-icon">◎</span><span><strong>工作区</strong><small>所有成员均可分配</small></span></button>
          <button type="button" class="employee-choice-card" :class="{selected:employeeVisibility==='personal'}" @click="employeeVisibility='personal'"><span class="employee-choice-icon">▣</span><span><strong>个人</strong><small>仅你和工作区管理员可分配</small></span></button>
        </div></section>

        <section class="employee-field"><label for="employee-target-device">目标电脑</label><ZiSelect id="employee-target-device" v-model="employeeTargetDeviceId" :options="employeeDeviceOptions" aria-label="目标电脑" @update:model-value="changeEmployeeDevice"/><p class="employee-field-hint">来自当前工作区设备心跳。运行时是 CLI，模型是其提供方模型，profile 是目标电脑上的独立配置。</p><button type="button" class="pill" :disabled="managementDiscoveryLoading" @click="refreshManagementDiscovery">{{ managementDiscoveryLoading ? '发现中…' : '刷新电脑与 CLI' }}</button><p v-if="managementDiscoveryError" role="alert" class="employee-readiness-error">{{ managementDiscoveryError }}</p></section>
        <section class="employee-field"><label for="employee-runtime">运行时 / CLI <span class="employee-info-mark">i</span></label><div class="employee-select-wrap"><button id="employee-runtime" type="button" class="employee-select-card" :aria-expanded="employeeRuntimeOpen" aria-haspopup="listbox" @click="employeeRuntimeOpen=!employeeRuntimeOpen;employeeModelOpen=false"><ZiAvatar :name="employeeForm.runtime" size="sm"/><div class="employee-select-copy"><strong>{{ employeeForm.runtime }} (ziwei_user)</strong><small>{{ employeeRuntimeDetail(employeeReady.runtime || {}) }}</small></div><ChevronDown :size="17" :class="{open:employeeRuntimeOpen}"/></button><div v-if="employeeRuntimeOpen" class="employee-dropdown-menu" role="listbox" aria-label="运行时 / CLI"><button v-for="runtime in employeeRuntimeChoices" :key="runtime.id || runtime.name" type="button" role="option" :aria-selected="employeeForm.runtime===runtime.name" :class="{selected:employeeForm.runtime===runtime.name}" @click="selectEmployeeRuntime(runtime.name)"><ZiAvatar :name="runtime.name" size="sm"/><span><strong>{{ runtime.name }} (ziwei_user)</strong><small>{{ employeeRuntimeDetail(runtime) }}</small></span><span v-if="employeeForm.runtime===runtime.name" class="employee-dropdown-check">✓</span></button><p v-if="!employeeRuntimeChoices.length" class="employee-dropdown-empty">暂无 CLI 发现记录</p></div></div></section>

        <section v-if="employeeForm.runtime!=='Hermes' && (employeeRuntimeProfiles.length || employeeRuntimeProfile)" class="employee-field"><label for="employee-runtime-profile">运行配置 Profile</label><ZiSelect id="employee-runtime-profile" v-model="employeeRuntimeProfile" :options="employeeRuntimeProfileOptions" aria-label="运行配置 Profile"/><p class="employee-field-hint">只使用目标电脑发现的 {{ employeeForm.runtime }} profile。明确选择的配置会保留；切换运行时后重新选择该 CLI 的配置。</p></section>
        <section v-if="employeeForm.runtime==='Hermes'" class="employee-field"><label for="employee-hermes-profile">Hermes Profile</label><p class="employee-field-hint">执行使用所选 profile 的原生临时配置 overlay，保留原配置与认证。请选择目标电脑实际发现且已就绪的 profile。</p><div><input id="employee-hermes-profile" v-model="employeeRuntimeProfile" list="hermes-profile-options" maxlength="64" placeholder="选择或填写 profile 名称" autocomplete="off" /></div><datalist id="hermes-profile-options"><option v-for="profile in hermesProfiles" :key="profile.name" :value="profile.name">{{ profile.readiness?.ready ? '已就绪' : profile.hasSoul ? '已配置人格，待 provider 校验' : '目录已发现' }}</option></datalist><div class="form-actions"><button type="button" class="pill" :disabled="hermesProfileCreating || !employeeRuntimeProfile.trim() || employeeRuntimeProfile.trim()==='default' || employeeSelectedDevice?.status !== 'online'" @click="createHermesProfile">{{ hermesProfileCreating ? '创建中…' : '在此设备创建 Profile' }}</button></div><small v-if="!hermesProfiles.length" class="employee-field-hint">请明确选择真实 profile；新建时填写独立名称，点击创建并等待设备回执，然后刷新就绪状态。</small></section>

        <section class="employee-field"><label for="employee-model">模型</label><div class="employee-select-wrap"><button id="employee-model" type="button" class="employee-select-card" :aria-expanded="employeeModelOpen" aria-haspopup="listbox" @click="employeeModelOpen=!employeeModelOpen;employeeRuntimeOpen=false;employeeModelSearch=''" ><span class="employee-card-icon">▣</span><div class="employee-select-copy"><strong>{{ selectedEmployeeModel ? `${selectedEmployeeModel.provider} · ${selectedEmployeeModel.label}` : (employeeModel !== 'default' ? employeeModel : '默认（提供方）') }}</strong><small>{{ selectedEmployeeModel?.id || (employeeModel !== 'default' ? employeeModel : '从运行工位提供方获取') }}</small></div><ChevronDown :size="17" :class="{open:employeeModelOpen}"/></button><div v-if="employeeModelOpen" class="employee-dropdown-menu employee-model-menu" role="listbox" aria-label="模型"><label class="employee-model-search"><Search :size="17"/><input v-model="employeeModelSearch" autofocus placeholder="搜索或输入模型 ID" aria-label="搜索或输入模型 ID" @click.stop @keydown.enter.prevent="selectEmployeeModel(employeeModelSearch.trim())" /></label><button v-if="employeeModelSearch.trim()" type="button" class="employee-manual-model-option" role="option" @click="selectEmployeeModel(employeeModelSearch.trim())"><span><strong>使用模型 ID</strong><small>{{ employeeModelSearch.trim() }}</small></span><span>↵</span></button><div v-for="(entries, provider) in filteredEmployeeModels" :key="provider" class="employee-provider-group"><h4>{{ provider.toUpperCase() }}</h4><button v-for="model in entries" :key="model.id" type="button" role="option" :aria-selected="employeeModel===model.id" :class="{selected:employeeModel===model.id}" @click="selectEmployeeModel(model.id)"><span><strong>{{ model.provider }} · {{ model.label }}</strong><small>{{ model.id }}</small></span><span v-if="employeeModel===model.id" class="employee-dropdown-check">✓</span></button></div><p v-if="!Object.keys(filteredEmployeeModels).length && !employeeModelSearch.trim()" class="employee-dropdown-empty">没有匹配的模型</p></div></div></section>

        <section class="employee-field employee-role-field"><label for="employee-role">岗位说明</label><p class="employee-field-hint">写清楚它负责什么、什么时候运行，以及怎样算完成。</p><div class="employee-role-editor"><FileText :size="17"/><textarea id="employee-role" v-model="employeeRole" rows="3" maxlength="2000" placeholder="例如：负责整理项目资料；每天上午检查新任务；完成后给出结论和下一步建议。"></textarea></div></section>

        <section class="employee-field employee-role-field"><label for="employee-persona">人格与协作方式</label><p class="employee-field-hint">描述表达方式、判断原则与协作习惯；不要填写令牌或密码。</p><textarea id="employee-persona" v-model="employeePersona" rows="3" maxlength="8000" placeholder="例如：表达清楚，先核对事实；遇到配置缺失明确报告原因；完成后附可核实的证据。"></textarea></section>
        <section class="employee-field employee-skills-field"><label>SKILLS</label><button type="button" class="employee-select-card employee-skills-select" @click="employeeSkillsOpen=!employeeSkillsOpen"><Plus :size="17"/><span>{{ employeeSkillIds.length ? `已选择 ${employeeSkillIds.length} 个 skill` : '从工作区添加 skill' }}</span><ChevronDown :size="17"/></button><div v-if="employeeSkillsOpen" class="employee-skills-list"><label v-for="skill in skills.slice(0,8)" :key="skill.id" class="employee-checkbox"><input type="checkbox" :checked="employeeSkillIds.includes(skill.id)" @change="toggleEmployeeSkill(skill.id)"/><span>{{ skill.name }}</span></label><p v-if="!skills.length">暂无可用 skill</p></div></section>
        <section class="employee-field" data-testid="employee-management-default"><label>紫薇管理 MCP · 默认自动接入</label><p class="employee-field-hint">新旧员工均通过所选电脑已连接的当前工作区身份自动接入，无需单独授权。员工运行时自动准备并加载，实际结果以执行回执为准。</p><p class="employee-field-hint" role="status">{{ employeeSelectedDevice ? employeeMcpPreparation.label : '等待选择当前工作区电脑' }}<span v-if="employeeMcpPreparation.reason"> · {{ employeeMcpPreparation.reason }}</span></p><button v-if="employeeSelectedDevice && employeeMcpPreparation.retryable" type="button" class="pill" :disabled="employeeMcpRetrying" @click="retryEmployeeManagementMcp">{{ employeeMcpRetrying ? '请求中…' : '重试自动接入' }}</button><details v-if="employeeMcpPreparation.updateRequired" class="employee-field-hint"><summary>更新 ziwei_user</summary><p>请在所选电脑沿原安装方式更新 ziwei_user，使用原生启动入口刷新客户端并保留已有工作区连接，然后点击“刷新电脑与 CLI”。</p><a :href="routePath('members')">查看设备与安装入口</a></details><p v-if="employeeMcpRetryMessage" class="employee-field-hint" role="status">{{ employeeMcpRetryMessage }}</p><div v-if="!managementDiscoveryLoading && !employeeReady.ready" class="employee-readiness-error" role="status"><strong>当前配置尚未就绪</strong><ul><li v-for="issue in employeeReady.issues" :key="issue">{{ issue }}</li></ul></div><p v-else-if="employeeReady.ready" class="employee-field-hint" data-testid="employee-ready">设备、CLI 与 profile 已通过发现检查，可以保存；管理 MCP 自动接入及实际加载分别以状态和运行回执为准。</p></section>
        <section v-if="!employeeEditId" class="employee-field"><label class="employee-checkbox"><input v-model="employeeContinuePhoneSetup" type="checkbox"/><span>保存后配置手机技能</span></label><p class="employee-field-hint">创建成功后继续选择精确手机、保存安全配置，并核对实际 MCP 回执。</p></section>
      </div>
      <footer class="employee-create-modal__footer"><button type="button" class="employee-cancel-button" @click="showEmployee=false">取消</button><button type="button" class="employee-create-button" :disabled="!employeeForm.name.trim() || employeeCreating || managementDiscoveryLoading || !employeeReady.ready" @click="addEmployee">{{ employeeCreating ? '提交中…' : employeeEditId ? '保存' : '创建' }}</button></footer>
    </div>
  </ZiModal>
  <ZiModal v-if="showAutomation" :title="automationEditId ? '编辑自动化' : '新建自动化'" @close="showAutomation=false;automationEditId='' "><div class="form-stack"><ZiFormField label="名称" required><ZiInput v-model="automationForm.name" placeholder="例如：每日工作区摘要"/></ZiFormField><ZiFormField label="计划"><ZiInput v-model="automationForm.schedule" placeholder="每天 09:00，留空表示手动运行"/></ZiFormField><ZiFormField label="指令"><ZiTextarea v-model="automationForm.prompt" rows="5" placeholder="让 agent 做什么？"/></ZiFormField><ZiFormField label="Webhook 回调地址"><ZiInput v-model="automationForm.webhookUrl" type="url" placeholder="可选，https://example.com/ziwei-hook"/></ZiFormField><ZiFormField label="输出方式"><ZiSelect v-model="automationForm.outputMode" :options="[{label:'收件箱通知',value:'notification'},{label:'仅 Webhook',value:'webhook'},{label:'通知和 Webhook',value:'both'}]"/></ZiFormField><div class="form-actions"><ZiButton @click="createAutomation">{{ automationEditId ? '保存修改' : '保存自动化' }}</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showCalendarEvent" :title="calendarEventForm.id ? '编辑日程' : '新建日程'" @close="showCalendarEvent=false"><div class="form-stack"><ZiFormField label="名称" required><ZiInput v-model="calendarEventForm.name" placeholder="例如：评审 API 方案"/></ZiFormField><ZiFormField label="描述"><ZiTextarea v-model="calendarEventForm.description" rows="3"/></ZiFormField><div class="grid-2"><ZiFormField label="开始时间" required><ZiInput v-model="calendarEventForm.startAt" type="datetime-local"/></ZiFormField><ZiFormField label="结束时间"><ZiInput v-model="calendarEventForm.endAt" type="datetime-local"/></ZiFormField></div><ZiFormField label="状态"><ZiSelect v-model="calendarEventForm.status" :options="[{label:'待规划',value:'planned'},{label:'待办',value:'todo'},{label:'进行中',value:'in_progress'},{label:'已完成',value:'completed'}]"/></ZiFormField><ZiFormField label="负责人"><ZiInput v-model="calendarEventForm.assignee" placeholder="可选：成员或数字员工"/></ZiFormField><div class="form-actions"><ZiButton v-if="calendarEventForm.id" variant="secondary" @click="removeCalendarEvent">删除</ZiButton><ZiButton variant="secondary" @click="showCalendarEvent=false">取消</ZiButton><ZiButton @click="saveCalendarEvent">保存</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showDocEditor" title="编辑文档" wide @close="showDocEditor=false"><div class="form-stack"><ZiFormField label="名称" required><ZiInput v-model="docEditorForm.name"/></ZiFormField><ZiFormField label="内容"><ZiTextarea v-model="docEditorForm.content" rows="18"/></ZiFormField><div v-if="documentVersions.length" class="document-version-list"><h4>历史版本</h4><div v-for="version in documentVersions" :key="version.id" class="runtime-row"><span>v{{ version.version }} · {{ version.created_at }}</span><button class="pill" @click="restoreDocumentVersion(version)">恢复</button></div></div><div class="form-actions"><ZiButton variant="secondary" @click="trashDocument">移入回收站</ZiButton><ZiButton variant="secondary" @click="showDocEditor=false">取消</ZiButton><ZiButton @click="saveDocument">保存</ZiButton></div></div></ZiModal>
  <ZiModal v-if="showAutomationDetails" title="自动化详情" @close="showAutomationDetails=false"><div v-if="selectedAutomation" class="form-stack"><div class="card-heading"><h3>{{ selectedAutomation.name }}</h3><ZiStatusTag :status="selectedAutomation.status==='active'?'online':'neutral'" :label="selectedAutomation.status"/></div><p class="modal-copy">{{ selectedAutomation.prompt }}</p><div class="document-version-list"><h4>运行记录</h4><div v-if="!(automationRuns[selectedAutomation.id]||[]).length" class="task-detail-empty">暂无运行记录</div><div v-for="run in automationRuns[selectedAutomation.id]" :key="run.id" class="runtime-row"><span>{{ run.created_at }} · {{ run.status }}</span><small>{{ run.error || run.message || '' }}</small></div></div><div class="form-actions"><ZiButton variant="secondary" @click="openAutomationEditor(selectedAutomation);showAutomationDetails=false">编辑</ZiButton><ZiButton variant="secondary" @click="toggleAutomation(selectedAutomation)">{{ selectedAutomation.status==='active'?'暂停':'启用' }}</ZiButton><ZiButton variant="secondary" @click="deleteAutomation(selectedAutomation)">删除自动化</ZiButton><ZiButton @click="runAutomationNow(selectedAutomation)">立即运行</ZiButton></div></div></ZiModal>
</template>
