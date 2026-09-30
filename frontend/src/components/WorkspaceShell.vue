<script setup>
import { computed, ref } from 'vue';
import { ListTodo, GitBranch, CalendarDays, BookOpenText, UsersRound, Share2, Settings, Puzzle, House, Languages, CircleHelp, ChevronUp, ChevronDown, LayoutDashboard, Check } from 'lucide-vue-next';
import { ZiModal } from '@ziwei/ui';
const props = defineProps({ page: String, account: Object });
const emit = defineEmits(['navigate']);
const sections = [
  { label:'项目', items:[['issues','任务',ListTodo],['workflow','工作流（敬请期待）',GitBranch],['calendar','日历',CalendarDays],['docs','文档',BookOpenText]] },
  { label:'设置', items:[['members','团队管理',UsersRound],['skills','技能管理',BookOpenText]] },
  { label:'系统', items:[['invite','邀请',Share2],['settings','设置',Settings],['open','开放平台',Puzzle]] }
];
const menu = ref('');
const language = ref(localStorage.getItem('ziwei.language') || '简体中文');
const help = ref(false);
const user = computed(() => props.account || {name:'25941',email:'',role:'owner'});
function go(page) { menu.value=''; emit('navigate',page); }
</script>
<template>
  <div class="workspace-shell" @keydown.esc="menu='';help=false">
    <header class="workspace-topbar">
      <button class="product-brand" @click="go('home')" aria-label="紫薇主页"><img src="/ziwei-logo.png" alt=""/><strong>紫薇</strong></button>
      <div class="shell-menu-anchor">
        <button class="workspace-picker" :aria-expanded="menu==='workspace'" @click="menu=menu==='workspace'?'':'workspace'"><span class="workspace-initial">T</span>test-111<ChevronDown :size="14"/></button>
        <div v-if="menu==='workspace'" class="shell-popup workspace-popup"><small>工作区</small><button @click="menu=''"><span class="workspace-initial">T</span>test-111<Check :size="15"/></button><button @click="go('settings')"><Settings :size="17"/>工作区设置</button></div>
      </div>
      <button class="shell-home" @click="go('home')"><LayoutDashboard :size="16"/>主页</button>
    </header>
    <div class="workspace-body">
      <aside class="workspace-sidebar" aria-label="工作区导航">
        <section v-for="(section,index) in sections" :key="section.label" class="sidebar-section" :class="{'project-section':index===0,'settings-section':index===1}">
          <h2>{{ section.label }}</h2>
          <nav :aria-label="section.label">
            <button v-for="[key,label,icon] in section.items" :key="key" :class="{selected:page===key}" :aria-current="page===key?'page':undefined" @click="go(key)"><component :is="icon" :size="19" :stroke-width="1.8"/><span>{{ label }}</span></button>
          </nav>
        </section>
        <footer class="sidebar-footer">
          <div class="shell-menu-anchor">
            <button class="sidebar-account" @click="menu=menu==='account'?'':'account'" :aria-expanded="menu==='account'"><span class="account-initial">{{ user.name?.slice(0,1) }}</span><span class="account-info"><strong>{{ user.name }}</strong><small>{{ user.email || '工作区所有者' }}</small></span><ChevronUp :size="17"/></button>
            <div v-if="menu==='account'" class="shell-popup account-popup"><strong>{{ user.name }}</strong><small>{{ user.email }}</small><span>{{ user.role==='owner'?'工作区所有者':'工作区成员' }}</span><button @click="go('settings')"><Settings :size="17"/>个人与工作区设置</button></div>
          </div>
          <div class="sidebar-utilities">
            <button aria-label="主页" title="主页" @click="go('home')"><House :size="19"/></button>
            <div class="shell-menu-anchor"><button aria-label="语言" title="语言" @click="menu=menu==='language'?'':'language'" :aria-expanded="menu==='language'"><Languages :size="19"/></button><div v-if="menu==='language'" class="shell-popup language-popup"><small>界面语言</small><button v-for="item in ['English','简体中文','한국어','日本語']" :key="item" @click="language=item;localStorage.setItem('ziwei.language',item);menu=''">{{ item }}<Check v-if="language===item" :size="16"/></button></div></div>
            <button aria-label="帮助" title="帮助" @click="help=true"><CircleHelp :size="19"/></button>
          </div>
        </footer>
      </aside>
      <main class="workspace-panel" :class="{'issues-panel':page==='issues','docs-panel':page==='docs','members-panel':page==='members'}"><slot/></main>
    </div>
    <ZiModal v-if="help" title="紫薇使用帮助" @close="help=false"><div class="shell-help"><p>在「任务」中创建工作，按状态查看进展；使用筛选、分组和排序管理看板。</p><p>「团队管理」中登记设备和数字员工，「技能管理」中维护可用能力。</p><button @click="help=false;go('issues')">打开任务</button></div></ZiModal>
  </div>
</template>
