<script setup>
import { computed, ref, watch } from 'vue';
import { ListTodo, GitBranch, CalendarDays, BookOpenText, UsersRound, Share2, Settings, Puzzle, House, Languages, CircleHelp, ChevronUp, ChevronDown, LayoutDashboard, Check, Plus, LogOut } from 'lucide-vue-next';
import { ZiButton, ZiFormField, ZiInput, ZiModal } from '@ziwei/ui';
const props = defineProps({ page: String, account: Object, workspace: Object, workspaces: { type: Array, default: () => [] }, language: { type: String, default: 'zh-CN' } });
const emit = defineEmits(['navigate','workspace','language','create-workspace','logout']);
const sectionKeys = [
  { key:'project', items:[['issues','tasks',ListTodo],['workflow','workflow',GitBranch],['calendar','calendar',CalendarDays],['docs','docs',BookOpenText]] },
  { key:'settings', items:[['members','members',UsersRound],['skills','skills',BookOpenText]] },
  { key:'system', items:[['invite','invite',Share2],['settings','settings',Settings],['open','open',Puzzle]] }
];
const menu = ref('');
const language = ref(props.language || localStorage.getItem('ziwei.language') || 'zh-CN');
const help = ref(false);
const user = computed(() => props.account || {name:'',email:'',role:null});
const workspace = computed(() => props.workspace || {name:'',slug:'',kind:null});
const translations = {
  'zh-CN': { project:'项目', settings:'设置', system:'系统', tasks:'任务', workflow:'工作流', calendar:'日历', docs:'文档', members:'团队管理', skills:'技能管理', invite:'邀请', open:'开放平台', home:'主页', workspace:'工作区', workspaceSettings:'工作区设置', interfaceLanguage:'界面语言', helpTitle:'紫薇使用帮助', helpTask:'在「任务」中创建工作，按状态查看进展；使用筛选、分组和排序管理看板。', helpTeam:'「团队管理」中登记设备和数字员工，「技能管理」中维护可用能力。', openTask:'打开任务', owner:'工作区所有者', member:'工作区成员', logout:'退出登录' },
  'en-US': { project:'Projects', settings:'Settings', system:'System', tasks:'Tasks', workflow:'Workflows', calendar:'Calendar', docs:'Documents', members:'Team', skills:'Skills', invite:'Invite', open:'Open platform', home:'Home', workspace:'Workspace', workspaceSettings:'Workspace settings', interfaceLanguage:'Interface language', helpTitle:'Ziwei help', helpTask:'Create work in Tasks, then use filters, grouping, and sorting to manage the board.', helpTeam:'Register devices and digital employees in Team, and manage reusable capabilities in Skills.', openTask:'Open tasks', owner:'Workspace owner', member:'Workspace member', logout:'Log out' },
  'ja-JP': { project:'プロジェクト', settings:'設定', system:'システム', tasks:'タスク', workflow:'ワークフロー', calendar:'カレンダー', docs:'ドキュメント', members:'チーム管理', skills:'スキル管理', invite:'招待', open:'オープンプラットフォーム', home:'ホーム', workspace:'ワークスペース', workspaceSettings:'ワークスペース設定', interfaceLanguage:'表示言語', helpTitle:'紫薇ヘルプ', helpTask:'タスクで作業を作成し、フィルターと並べ替えで管理します。', helpTeam:'チームでデバイスとデジタル社員を管理し、スキルを再利用できます。', openTask:'タスクを開く', owner:'ワークスペース所有者', member:'ワークスペースメンバー', logout:'ログアウト' },
  'ko-KR': { project:'프로젝트', settings:'설정', system:'시스템', tasks:'작업', workflow:'워크플로', calendar:'캘린더', docs:'문서', members:'팀 관리', skills:'스킬 관리', invite:'초대', open:'오픈 플랫폼', home:'홈', workspace:'워크스페이스', workspaceSettings:'워크스페이스 설정', interfaceLanguage:'언어', helpTitle:'紫薇 도움말', helpTask:'작업에서 업무를 만들고 필터와 정렬로 보드를 관리하세요.', helpTeam:'팀에서 장치와 디지털 직원을 관리하고 스킬을 재사용하세요.', openTask:'작업 열기', owner:'워크스페이스 소유자', member:'워크스페이스 멤버', logout:'로그아웃' }
};
const t = computed(() => translations[props.language] || translations['zh-CN']);
const sections = computed(() => sectionKeys.map(section => ({ label:t.value[section.key], items:section.items.map(([key,label,icon]) => [key,t.value[label],icon]) })));
const languageOptions = [{ code:'en-US', label:'English' }, { code:'zh-CN', label:'简体中文' }, { code:'ko-KR', label:'한국어' }, { code:'ja-JP', label:'日本語' }];
const workspaceCreateOpen = ref(false);
const workspaceCreateForm = ref({ name:'', slug:'', kind:'personal' });
watch(() => props.language, value => { if (value && translations[value]) language.value=value; });
function go(page) { menu.value=''; emit('navigate',page); }
function selectWorkspace(item) { menu.value=''; if (item?.slug) emit('workspace', item.slug); }
function selectLanguage(value) { language.value=value; try { localStorage.setItem('ziwei.language', value); } catch {} menu.value=''; emit('language', value); }
function openWorkspaceCreate() { workspaceCreateForm.value={name:'',slug:'',kind:'personal'}; menu.value=''; workspaceCreateOpen.value=true; }
function submitWorkspaceCreate() { if (!workspaceCreateForm.value.name.trim()) return; const payload={name:workspaceCreateForm.value.name.trim(),slug:workspaceCreateForm.value.slug.trim(),kind:workspaceCreateForm.value.kind}; workspaceCreateOpen.value=false; emit('create-workspace',payload); }
function requestLogout() { menu.value=''; emit('logout'); }
</script>
<template>
  <div class="workspace-shell" @keydown.esc="menu='';help=false">
    <header class="workspace-topbar">
      <button class="product-brand" @click="go('home')" aria-label="紫薇主页"><img src="/ziwei-logo.png" alt=""/><strong>紫薇</strong></button>
      <div class="shell-menu-anchor">
        <button class="workspace-picker" :aria-expanded="menu==='workspace'" @click="menu=menu==='workspace'?'':'workspace'"><span class="workspace-initial">{{ workspace.name?.slice(0,1) || '紫' }}</span>{{ workspace.slug || workspace.name }}<ChevronDown :size="14"/></button>
        <div v-if="menu==='workspace'" class="shell-popup workspace-popup"><small>{{ t.workspace }}</small><button v-for="item in (props.workspaces.length ? props.workspaces : [workspace])" :key="item.slug" :class="{selected:item.slug===workspace.slug}" @click="selectWorkspace(item)"><span class="workspace-initial">{{ item.name?.slice(0,1) || '紫' }}</span>{{ item.slug || item.name }}<Check v-if="item.slug===workspace.slug" :size="15"/></button><button @click="openWorkspaceCreate"><Plus :size="17"/>新建项目</button><button @click="go('settings')"><Settings :size="17"/>{{ t.workspaceSettings }}</button></div>
      </div>
      <button class="shell-home" @click="go('home')"><LayoutDashboard :size="16"/>{{ t.home }}</button>
    </header>
    <div class="workspace-body">
      <aside class="workspace-sidebar" aria-label="工作区导航">
        <section v-for="(section,index) in sections" :key="section.label" class="sidebar-section" :class="{'project-section':index===0,'settings-section':index===1}">
          <h2>{{ section.label }}</h2>
          <nav :aria-label="section.label">
            <button v-for="[key,label,icon] in section.items" :key="key" :class="{selected:page===key || (key==='workflow' && page==='automations')}" :aria-current="(page===key || (key==='workflow' && page==='automations'))?'page':undefined" @click="go(key)"><component :is="icon" :size="19" :stroke-width="1.8"/><span>{{ label }}</span></button>
          </nav>
        </section>
        <footer class="sidebar-footer">
          <div class="shell-menu-anchor">
            <button class="sidebar-account" @click="menu=menu==='account'?'':'account'" :aria-expanded="menu==='account'"><span class="account-initial">{{ user.name?.slice(0,1) || '?' }}</span><span class="account-info"><strong>{{ user.name || '当前账号' }}</strong><small>{{ user.email || (user.role ? (user.role==='owner' ? t.owner : t.member) : '') }}</small></span><ChevronUp :size="17"/></button>
            <div v-if="menu==='account'" class="shell-popup account-popup"><strong>{{ user.name || '当前账号' }}</strong><small>{{ user.email }}</small><span>{{ user.role==='owner'?t.owner:user.role==='admin'?'管理员':t.member }}</span><button @click="go('settings')"><Settings :size="17"/>{{ t.workspaceSettings }}</button><button @click="requestLogout"><LogOut :size="17"/>{{ t.logout }}</button></div>
          </div>
          <div class="sidebar-utilities">
            <button aria-label="主页" title="主页" @click="go('home')"><House :size="19"/></button>
            <div class="shell-menu-anchor"><button aria-label="语言" :title="t.interfaceLanguage" @click="menu=menu==='language'?'':'language'" :aria-expanded="menu==='language'"><Languages :size="19"/></button><div v-if="menu==='language'" class="shell-popup language-popup"><small>{{ t.interfaceLanguage }}</small><button v-for="item in languageOptions" :key="item.code" @click="selectLanguage(item.code)">{{ item.label }}<Check v-if="language===item.code" :size="16"/></button></div></div>
            <button aria-label="帮助" title="帮助" @click="help=true"><CircleHelp :size="19"/></button>
          </div>
        </footer>
      </aside>
      <main class="workspace-panel" :class="{'issues-panel':page==='issues','docs-panel':page==='docs','members-panel':page==='members','runtime-panel':page==='runtimes'}"><slot/></main>
    </div>
    <ZiModal v-if="help" :title="t.helpTitle" @close="help=false"><div class="shell-help"><p>{{ t.helpTask }}</p><p>{{ t.helpTeam }}</p><button @click="help=false;go('issues')">{{ t.openTask }}</button></div></ZiModal>
    <ZiModal v-if="workspaceCreateOpen" title="新建工作区" @close="workspaceCreateOpen=false"><div class="form-stack"><p class="modal-copy">创建后会生成独立工作区和路由。团队工作区可邀请成员共享设备与数字员工。</p><ZiFormField label="名称" required><ZiInput v-model="workspaceCreateForm.name" autofocus placeholder="例如：内容运营团队"/></ZiFormField><ZiFormField label="标识" hint="仅使用小写字母、数字、下划线或短横线"><ZiInput v-model="workspaceCreateForm.slug" placeholder="例如：content-ops"/></ZiFormField><ZiFormField label="类型"><select v-model="workspaceCreateForm.kind" class="workspace-kind-select"><option value="personal">个人工作区</option><option value="team">团队工作区</option></select></ZiFormField><div class="form-actions"><ZiButton variant="secondary" @click="workspaceCreateOpen=false">取消</ZiButton><ZiButton :disabled="!workspaceCreateForm.name.trim()" @click="submitWorkspaceCreate">创建工作区</ZiButton></div></div></ZiModal>
  </div>
</template>
