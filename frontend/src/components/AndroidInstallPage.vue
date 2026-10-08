<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, Download, Monitor, RefreshCw, ShieldCheck, Smartphone, Wrench } from 'lucide-vue-next';
import { CONTROL_URL, INSTALL_URL, detectInstallPlatform, formatPackageSize, loadLatestAndroidRelease, managementHref } from '../android-install.js';

const release = ref(null);
const state = ref('loading');
const error = ref('');
const copied = ref(false);
const copyError = ref(false);
const addressInput = ref(null);
const platform = detectInstallPlatform(navigator.userAgent);
const unsupported = ['ios', 'unsupported'].includes(platform);
const managementUrl = managementHref(new URLSearchParams(location.search).get('workspace'));
const previousTitle = document.title;
const apps = [
  { role: 'agent', name: '紫薇 Agent', short: '手机操作', icon: Smartphone, description: '在手机上执行操作、获取画面，连接专属数字员工。' },
  { role: 'updater', name: '紫薇 Updater', short: '更新与维护', icon: Wrench, description: '配合 Agent 完成后续更新与维护，首次使用也要安装。' },
];
const hasPackages = computed(() => apps.some(app => release.value?.packages?.[app.role]));
let controller;
let copyTimer;
async function loadRelease() {
  controller?.abort();
  controller = new AbortController();
  const request = controller;
  const timer = window.setTimeout(() => request.abort(), 12000);
  state.value = 'loading';
  release.value = null;
  error.value = '';
  try {
    const result = await loadLatestAndroidRelease({ signal: request.signal });
    if (request !== controller) return;
    release.value = result;
    state.value = result && apps.some(app => result.packages?.[app.role]) ? 'ready' : 'empty';
  } catch (cause) {
    if (request !== controller) return;
    error.value = request.signal.aborted ? '读取发布信息超时，请检查网络后重试。' : (cause.message || '暂时无法读取安装包，请稍后重试。');
    state.value = 'error';
  } finally { window.clearTimeout(timer); }
}
async function copyAddress() {
  copied.value = false;
  copyError.value = false;
  window.clearTimeout(copyTimer);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(CONTROL_URL);
    copied.value = true;
    copyTimer = window.setTimeout(() => { copied.value = false; }, 4000);
  } catch {
    copyError.value = true;
    addressInput.value?.focus();
    addressInput.value?.select();
  }
}
onMounted(() => { document.title = '安装手机端 · 紫薇·互联'; void loadRelease(); });
onUnmounted(() => { controller?.abort(); controller = null; window.clearTimeout(copyTimer); document.title = previousTitle; });
</script>

<template>
  <div class="android-install-page" data-testid="android-install-page">
    <header class="install-topbar">
      <a :href="managementUrl" class="install-brand" aria-label="紫薇·互联，返回手机管理"><img src="/ziwei-logo.png" alt=""/><span>紫薇<span class="install-brand-dot">·</span>互联</span></a>
      <a :href="managementUrl" class="install-return"><ArrowLeft :size="15"/><span>返回手机管理</span></a>
    </header>

    <main class="install-main">
      <section class="install-hero" aria-labelledby="install-title">
        <span class="install-eyebrow"><span aria-hidden="true"></span>ANDROID · 手机端安装</span>
        <h1 id="install-title">连接你的手机，<br class="install-mobile-break"/>开始协同工作。</h1>
        <p>首次使用，安装这两个应用。之后的更新，在紫薇·互联中统一管理。</p>
        <div class="install-requirements"><span><ShieldCheck :size="15"/>本站提供安装包</span><span>Android 11 及以上</span><span>无需登录即可下载</span></div>
      </section>

      <ol class="install-overview" aria-label="接入流程">
        <li><span>01</span>安装双应用</li><li><span>02</span>允许必要权限</li><li><span>03</span>申请入网</li><li><span>04</span>批准并绑定</li>
      </ol>

      <div v-if="unsupported" class="install-platform-note" role="status" data-testid="platform-not-supported"><Smartphone :size="22"/><div><strong>{{ platform==='ios' ? '当前设备是 iPhone / iPad' : '当前设备不支持 Android 安装包' }}</strong><p>这两个应用仅支持 Android。请用安卓手机扫描下方二维码，或在安卓浏览器打开此页。</p></div></div>

      <div class="install-download-layout">
        <section class="install-downloads" aria-labelledby="download-heading" :aria-busy="state==='loading'">
          <div class="install-section-heading"><div><span class="install-section-index">01</span><h2 id="download-heading">下载并安装</h2></div><span v-if="state==='ready' && release" class="install-release">v{{ release.versionName.replace(/^v/i, '') }} · build {{ release.versionCode }}</span></div>
          <p class="install-section-copy">两个应用安装在同一台手机上，各自完成连接配置。</p>

          <div v-if="state==='loading'" class="install-load-state" role="status" data-testid="release-loading"><RefreshCw class="install-spinner" :size="22"/><div><strong>正在读取最新安装包…</strong><p>版本与包大小以本站当前发布为准。</p></div></div>
          <div v-else-if="state==='error'" class="install-load-state install-load-error" role="alert" data-testid="release-error"><div><strong>安装包暂时无法读取</strong><p>{{ error }}</p></div><button type="button" @click="loadRelease"><RefreshCw :size="15"/>重新加载</button></div>
          <div v-else-if="state==='empty' || !hasPackages" class="install-load-state" role="status" data-testid="release-empty"><div><strong>暂未发布可下载的安装包</strong><p>发布完成后，两个下载入口会显示在这里。</p></div><button type="button" @click="loadRelease"><RefreshCw :size="15"/>刷新发布</button></div>

          <div v-else class="install-app-grid">
            <article v-for="app in apps" :key="app.role" class="install-app-card" :data-testid="`app-${app.role}`">
              <div class="install-app-heading"><span class="install-app-icon" :class="app.role"><component :is="app.icon" :size="24" :stroke-width="1.6"/></span><div><span class="install-app-purpose">{{ app.short }}</span><h3>{{ app.name }}</h3></div><span class="install-required">必装</span></div>
              <p class="install-app-description">{{ app.description }}</p>
              <div v-if="release.packages[app.role]" class="install-app-meta"><span>v{{ release.versionName.replace(/^v/i, '') }}</span><span>{{ formatPackageSize(release.packages[app.role].bytes) }}</span><span>APK</span></div>
              <div v-else class="install-app-meta install-missing">该应用的安装包暂未发布</div>
              <a v-if="release.packages[app.role] && !unsupported" :href="release.packages[app.role].href" :download="release.packages[app.role].file" class="install-download-button" :class="app.role" :data-testid="`download-${app.role}`"><ArrowDownToLine :size="18"/>下载 {{ app.role==='agent' ? 'Agent' : 'Updater' }}<ArrowRight :size="17"/></a>
              <button v-else type="button" class="install-download-button" disabled>{{ unsupported ? '请在安卓手机上安装' : '暂无可用安装包' }}</button>
            </article>
          </div>
          <p class="install-download-help"><Download :size="14"/>下载完成后，在浏览器“下载内容”中打开 APK 安装。</p>
        </section>

        <aside class="install-qr-card" aria-labelledby="qr-heading">
          <span class="install-qr-icon"><Monitor :size="19"/></span><h2 id="qr-heading">电脑浏览，手机扫码</h2><p>用安卓手机浏览器打开安装页</p>
          <a :href="INSTALL_URL" aria-label="打开紫薇·互联手机安装页" class="install-qr-link"><img src="/android-install-qr.svg" width="188" height="188" alt="安装页二维码，内容为 https://qzelynth.top/android-install" data-testid="install-qr"/></a>
          <a :href="INSTALL_URL" class="install-page-url">qzelynth.top/android-install</a>
          <span class="install-qr-note">在微信内无法下载时，<br/>请用系统浏览器打开。</span>
        </aside>
      </div>

      <section class="install-connect-guide" aria-labelledby="guide-heading">
        <div class="install-section-heading"><div><span class="install-section-index">02—04</span><h2 id="guide-heading">安装之后，三步接入</h2></div><span class="install-guide-label">按顺序完成</span></div>
        <div class="install-guide-grid">
          <article class="install-guide-step"><span class="install-step-number">02</span><div><h3>在手机上允许必要权限</h3><p>安装时，为下载 APK 的浏览器开启“允许安装未知应用”。打开双应用，按应用提示开启必要的无障碍、通知及后台运行权限。</p><small>这些系统授权需要你在手机上确认。</small></div></article>
          <article class="install-guide-step install-connection-step"><span class="install-step-number">03</span><div><h3>填写中控地址，申请入网</h3><p>进入两个应用的“连接配置”，在“HTTPS 中控根地址”填入：</p><div class="install-address-box"><input ref="addressInput" :value="CONTROL_URL" readonly aria-label="HTTPS 中控根地址" spellcheck="false"/><button type="button" @click="copyAddress" :aria-label="copied ? '中控地址已复制' : '复制中控地址'" data-testid="copy-control-url"><Check v-if="copied" :size="16"/><Copy v-else :size="16"/>{{ copied ? '已复制' : '复制' }}</button></div><p class="install-copy-status" role="status">{{ copyError ? '浏览器未允许复制，地址已选中，请长按复制。' : copied ? '已复制，在两个应用中粘贴同一个地址。' : '' }}</p><p>两个应用填写相同手机名，分别点“申请入网权限”。</p></div></article>
          <article class="install-guide-step"><span class="install-step-number">04</span><div><h3>回主站批准，绑定数字员工</h3><p>由工作区管理员在“紫薇·互联 → 待审核入网”批准 Agent 与 Updater 的申请。双应用自动领取配置，显示在线后，为手机绑定专属数字员工。</p><a :href="managementUrl" class="install-management-link">打开手机管理<ArrowRight :size="15"/></a></div></article>
        </div>
      </section>

      <footer class="install-footer"><span><CheckCircle2 :size="15"/>首次安装双应用 · 后续由中控更新</span><span>紫薇·互联，让设备与数字员工协同。</span></footer>
    </main>
  </div>
</template>

<style>
body:has(.android-install-page) { min-width:0; margin:0; background:#f5f8fc; }
.android-install-page { --install-blue:#2f6fca; --install-ink:#24364e; --install-muted:#62738b; min-height:100vh; color:var(--install-ink); background:radial-gradient(ellipse at 85% 0, #e5effb 0, transparent 42%), #f5f8fc; font-family:"Microsoft YaHei UI","PingFang SC",sans-serif; }
.android-install-page a { color:inherit; text-decoration:none; }
.android-install-page button,.android-install-page a { -webkit-tap-highlight-color:transparent; }
.android-install-page :is(a,button,input):focus-visible { outline:3px solid #9dbde9; outline-offset:4px; }
.install-topbar { max-width:1140px; margin:0 auto; min-height:84px; padding:20px 30px; display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:1px solid #dfe7f1; }
.install-brand { display:flex; align-items:center; gap:10px; font-size:20px; font-weight:700; letter-spacing:1px; white-space:nowrap; }
.install-brand img { width:36px; height:36px; object-fit:contain; border-radius:10px; }
.install-brand-dot { color:var(--install-blue); padding:0 4px; }
.install-return { display:flex; align-items:center; gap:7px; font-size:13px; color:var(--install-muted)!important; padding:9px 0; }
.install-return:hover { color:var(--install-blue)!important; }
.install-main { max-width:1140px; margin:0 auto; padding:45px 30px 26px; }
.install-hero { text-align:left; }
.install-eyebrow { display:inline-flex; align-items:center; gap:8px; color:var(--install-blue); font-size:11px; font-weight:700; letter-spacing:2px; }
.install-eyebrow > span { width:6px; height:6px; border-radius:50%; background:#2f6fca; box-shadow:0 0 0 4px #e0ecfa; }
.install-hero h1 { font-size:36px; line-height:1.4; letter-spacing:-1px; margin:14px 0 10px; font-weight:700; }
.install-mobile-break { display:none; }
.install-hero > p { margin:0; color:var(--install-muted); font-size:14px; line-height:1.9; }
.install-requirements { display:flex; flex-wrap:wrap; align-items:center; gap:8px 22px; margin-top:17px; font-size:11px; color:var(--install-muted); }
.install-requirements > span:first-child { display:flex; align-items:center; gap:5px; color:#3b745a; }
.install-overview { display:grid; grid-template-columns:repeat(4,1fr); list-style:none; margin:28px 0 26px; padding:0; border:1px solid #dce5ef; border-radius:10px; background:#ffffffa6; }
.install-overview li { display:flex; align-items:center; gap:10px; padding:13px 20px; font-size:12px; border-right:1px solid #e4ebf3; }
.install-overview li:last-child { border-right:0; }
.install-overview li > span { font-size:10px; color:var(--install-blue); letter-spacing:1px; font-weight:700; }
.install-platform-note { display:flex; gap:12px; align-items:flex-start; padding:16px 20px; border:1px solid #e4d4ac; background:#fff9ec; border-radius:12px; margin-bottom:20px; color:#7e6127; }
.install-platform-note strong { font-size:14px; }
.install-platform-note p { font-size:12px; line-height:1.8; margin:5px 0 0; }
.install-platform-note svg { flex:none; margin-top:2px; }
.install-download-layout { display:grid; grid-template-columns:minmax(0,1fr) 250px; gap:22px; align-items:stretch; }
.install-downloads { min-width:0; background:white; padding:25px; border:1px solid #dce5ef; border-radius:16px; }
.install-section-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.install-section-heading > div { display:flex; align-items:center; gap:10px; }
.install-section-index { font-size:10px; color:var(--install-blue); font-weight:700; padding:5px 7px; border:1px solid #d9e6f7; border-radius:5px; white-space:nowrap; }
.install-section-heading h2 { margin:0; font-size:17px; letter-spacing:.2px; }
.install-release { font-size:10px; color:var(--install-muted); padding:4px 7px; border-radius:5px; background:#f3f6fa; }
.install-section-copy { font-size:12px; color:var(--install-muted); line-height:1.8; margin:8px 0 19px; }
.install-app-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.install-app-card { min-width:0; border:1px solid #dce5ef; border-radius:12px; padding:18px; background:#fff; }
.install-app-heading { display:flex; align-items:center; gap:10px; }
.install-app-icon { flex:none; display:grid; place-items:center; width:44px; height:44px; background:#eaf2fc; color:#2867bb; border-radius:12px; }
.install-app-icon.updater { background:#eaf5f1; color:#347962; }
.install-app-purpose { color:var(--install-muted); font-size:10px; letter-spacing:.6px; }
.install-app-card h3 { font-size:16px; margin:4px 0 0; line-height:1.35; white-space:nowrap; }
.install-required { margin-left:auto; color:#8a99aa; font-size:9px; align-self:flex-start; }
.install-app-description { font-size:12px; color:var(--install-muted); line-height:1.8; margin:15px 0 14px; min-height:43px; }
.install-app-meta { display:flex; flex-wrap:wrap; gap:6px 10px; font-size:10px; color:var(--install-muted); margin:0 0 15px; min-height:15px; }
.install-app-meta > span:not(:last-child)::after { content:"·"; margin-left:10px; color:#b9c3d0; }
.install-download-button { width:100%; min-height:43px; display:flex; align-items:center; justify-content:center; gap:8px; border:1px solid #2f6fca; border-radius:8px; background:#2f6fca; color:#fff!important; font-size:12px; font-weight:600; padding:10px 9px; }
.install-download-button > svg:last-child { margin-left:auto; }
.install-download-button > svg:first-child { margin-right:auto; }
.install-download-button.updater { color:#2b6aba!important; background:#f2f7fe; border-color:#d1e0f4; }
.install-download-button.agent:hover { background:#235dad; }
.install-download-button.updater:hover { background:#e8f1fd; border-color:#aabfdd; }
.install-download-button:disabled { background:#f0f3f6; border-color:#e1e7ee; color:#78899b!important; cursor:default; font-size:11px; }
.install-download-help { display:flex; align-items:flex-start; gap:6px; font-size:10px; line-height:1.7; color:#8090a3; margin:16px 0 0; }
.install-download-help > svg { flex:none; margin-top:1px; }
.install-load-state { display:flex; justify-content:space-between; gap:14px; align-items:center; min-height:206px; padding:22px; background:#f7faff; border:1px dashed #ccdaed; border-radius:12px; color:#60758c; }
.install-load-state > svg { flex:none; color:#2f6fca; }
.install-load-state strong { font-size:14px; }
.install-load-state p { font-size:12px; line-height:1.8; margin:8px 0 0; overflow-wrap:anywhere; }
.install-load-state button { flex:none; display:flex; align-items:center; gap:6px; padding:9px 12px; border:1px solid #cbdcf3; border-radius:8px; background:#fff; color:#2f6fca; font-size:12px; }
.install-load-error { background:#fffaf7; border-color:#e8d4c5; color:#946746; }
.install-spinner { animation:install-spin 1.5s linear infinite; }
@keyframes install-spin { to { transform:rotate(360deg); } }
.install-qr-card { display:flex; align-items:center; flex-direction:column; text-align:center; border:1px solid #dbe5f1; border-radius:16px; padding:23px 20px 20px; background:#edf3fb; }
.install-qr-icon { display:grid; place-items:center; width:32px; height:32px; border-radius:8px; background:#dde9f8; color:#4b79b4; }
.install-qr-card h2 { font-size:14px; margin:12px 0 7px; }
.install-qr-card > p { color:var(--install-muted); font-size:10px; margin:0 0 14px; }
.install-qr-link { display:block; width:164px; height:164px; background:#fff; border-radius:9px; overflow:hidden; box-shadow:0 2px 6px #5c7fa410; }
.install-qr-link > img { width:100%; height:100%; display:block; }
.install-page-url { color:#52759f!important; margin:13px 0 9px; font-size:10px; overflow-wrap:anywhere; }
.install-qr-note { font-size:10px; line-height:1.7; color:#8091a6; }
.install-connect-guide { background:#fff; border:1px solid #dce5ef; border-radius:16px; padding:25px; margin-top:22px; }
.install-guide-label { font-size:10px; color:#8b99a9; }
.install-guide-grid { display:grid; grid-template-columns:1fr 1.15fr 1fr; gap:24px; margin-top:23px; }
.install-guide-step { min-width:0; display:flex; gap:12px; }
.install-step-number { font-family:Georgia,serif; font-size:20px; color:#b4c7df; line-height:1.3; font-style:italic; }
.install-guide-step > div { min-width:0; }
.install-guide-step h3 { font-size:13px; margin:3px 0 10px; line-height:1.5; }
.install-guide-step p { font-size:11px; line-height:1.9; color:var(--install-muted); margin:0 0 10px; }
.install-guide-step small { display:block; color:#92a0b1; font-size:10px; line-height:1.8; }
.install-address-box { display:flex; gap:4px; border:1px solid #d4e2f5; border-radius:7px; padding:4px; background:#f4f8fe; }
.install-address-box input { width:0; flex:1; min-width:0; padding:6px; border:0; background:transparent; color:#2d60a0; font-size:11px; outline-offset:0!important; }
.install-address-box button { flex:none; padding:6px 7px; display:flex; align-items:center; gap:4px; border:1px solid #d6e3f5; border-radius:5px; background:#fff; color:#3b6eaf; font-size:10px; white-space:nowrap; }
.install-copy-status { margin-top:8px!important; min-height:36px; font-size:10px!important; }
.install-management-link { display:inline-flex; align-items:center; gap:5px; color:#2f6fca!important; font-size:11px; font-weight:600; padding:4px 0; }
.install-footer { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; color:#8b9aab; font-size:10px; line-height:1.7; padding:22px 0 0; }
.install-footer > span:first-child { display:flex; align-items:center; gap:6px; }
@media (max-width:1000px) {
  .install-app-grid { gap:12px; }
  .install-app-card { padding:15px; }
  .install-app-card h3 { font-size:14px; }
  .install-app-icon { width:36px; height:36px; border-radius:9px; }
  .install-required { display:none; }
  .install-download-layout { grid-template-columns:minmax(0,1fr) 210px; gap:16px; }
  .install-guide-grid { gap:18px; grid-template-columns:1fr 1fr; }
  .install-guide-step:last-child { grid-column:1/-1; }
}
@media (max-width:760px) {
  .install-topbar { min-height:70px; padding:16px 20px; gap:10px; }
  .install-brand { font-size:17px; gap:8px; letter-spacing:.5px; }
  .install-brand img { width:31px; height:31px; }
  .install-return { font-size:11px; gap:4px; }
  .install-return svg { width:13px; }
  .install-main { padding:28px 18px 24px; }
  .install-hero h1 { font-size:28px; line-height:1.45; letter-spacing:-.5px; margin:13px 0 10px; }
  .install-mobile-break { display:initial; }
  .install-hero > p { font-size:12px; line-height:1.9; max-width:330px; }
  .install-eyebrow { font-size:10px; letter-spacing:1.6px; }
  .install-requirements { margin-top:14px; font-size:10px; gap:7px 14px; }
  .install-requirements > span:last-child { display:none; }
  .install-overview { margin:21px 0 19px; grid-template-columns:repeat(4,minmax(0,1fr)); }
  .install-overview li { flex-direction:column; gap:5px; padding:10px 3px; font-size:9px; }
  .install-overview li > span { font-size:9px; }
  .install-download-layout { display:flex; flex-direction:column; gap:18px; }
  .install-downloads { padding:19px 16px; border-radius:13px; }
  .install-section-heading { gap:8px; }
  .install-section-heading h2 { font-size:16px; }
  .install-section-heading > div { gap:7px; }
  .install-section-index { font-size:9px; padding:4px 5px; }
  .install-release { font-size:9px; }
  .install-section-copy { margin:8px 0 15px; font-size:11px; }
  .install-app-grid { grid-template-columns:1fr; gap:13px; }
  .install-app-card { padding:16px; }
  .install-app-icon { width:40px; height:40px; }
  .install-app-card h3 { font-size:16px; }
  .install-required { display:block; }
  .install-app-description { margin:12px 0 10px; min-height:0; font-size:11px; }
  .install-app-meta { margin-bottom:12px; }
  .install-download-button { min-height:45px; font-size:12px; padding:11px 13px; }
  .install-download-help { font-size:9px; }
  .install-qr-card { padding:22px 18px; border-radius:13px; }
  .install-qr-link { width:168px; height:168px; }
  .install-qr-card h2 { font-size:15px; }
  .install-qr-card > p,.install-page-url { font-size:11px; }
  .install-qr-note { font-size:10px; }
  .install-connect-guide { margin-top:18px; border-radius:13px; padding:21px 17px; }
  .install-guide-grid { grid-template-columns:1fr; gap:24px; margin-top:23px; }
  .install-guide-step { gap:12px; }
  .install-guide-step h3 { font-size:13px; }
  .install-guide-step p { font-size:12px; }
  .install-address-box input { font-size:12px; padding:8px; }
  .install-address-box button { padding:7px 9px; font-size:11px; }
  .install-copy-status { min-height:0; }
  .install-load-state { flex-wrap:wrap; padding:17px; }
  .install-guide-label { font-size:9px; }
  .install-footer { justify-content:center; text-align:center; font-size:9px; padding-top:20px; gap:7px; }
}
@media (prefers-reduced-motion:reduce) { .install-spinner { animation:none; } }
</style>
