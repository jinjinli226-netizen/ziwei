import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'docs/baselines/aura-14-point-baseline.json'), 'utf8'));
const appSource = fs.readFileSync(path.join(root, 'frontend/src/App.vue'), 'utf8');
const shellSource = fs.readFileSync(path.join(root, 'frontend/src/components/WorkspaceShell.vue'), 'utf8');
const shellCssSource = fs.readFileSync(path.join(root, 'frontend/src/workspace-shell.css'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'frontend/src/styles.css'), 'utf8');

const expectedRoutes = {
  home: '/test-111/home',
  issues: '/test-111/issues',
  automations: '/test-111/autopilots',
  calendar: '/test-111/calendar',
  docs: '/test-111/project-docs',
  members: '/test-111/members',
  runtimes: '/test-111/runtimes',
  skills: '/test-111/skills',
  settings: '/test-111/settings',
  invite: '/me/invite',
  inviteAccept: '/invite?code=<one-time-code>',
  open: '/test-111/open-platform',
  inbox: '/test-111/inbox',
};

test('14-point baseline has a complete, unique route matrix', () => {
  assert.equal(baseline.schemaVersion, 1);
  assert.equal(baseline.points.length, 14);
  assert.deepEqual(Object.keys(baseline.routeMap), Object.keys(expectedRoutes));
  assert.deepEqual(baseline.routeMap, expectedRoutes);
  assert.deepEqual(baseline.points.map(point => point.id), Array.from({ length: 14 }, (_, index) => index + 1));
  for (const point of baseline.points) {
    assert.ok(point.module, `point ${point.id} module`);
    assert.ok(point.routes.length, `point ${point.id} route`);
    assert.ok(point.uiContracts.length, `point ${point.id} UI contract`);
    assert.ok(point.httpChecks.length, `point ${point.id} HTTP contract`);
    assert.match(point.status, /^(complete|partial|blocked)$/);
  }
});

test('App route parser and navigation paths contain every baseline route', () => {
  assert.match(appSource, /function routeFromPath\(pathname\)/);
  assert.match(appSource, /function routePath\(key(?:,|\))/);
  for (const [key, route] of Object.entries(expectedRoutes)) {
    if (key === 'inviteAccept') {
      assert.match(appSource, /parts\[0\] === 'invite' && new URLSearchParams\(location\.search\)\.has\('code'\)/);
      continue;
    }
    const pathPart = route.replace(/^\/test-111\//, '').replace(/^\/me\//, '');
    assert.match(appSource, new RegExp(`['"]${pathPart}['"]`), `${key} path segment`);
  }
  // Workspace roots and unsupported /<slug>/<page> paths intentionally fall back to home.
  assert.match(appSource, /\[parts\[1\] \|\| 'home'\] \|\| 'home'/);
  assert.match(appSource, /if \(parts\.length === 1\) return 'home'/);
  // Every renderable page has an explicit branch, including inbox and invite acceptance.
  for (const page of ['home', 'issues', 'automations', 'calendar', 'docs', 'runtimes', 'members', 'skills', 'settings', 'invite-accept', 'invite', 'open', 'inbox']) {
    assert.match(appSource, new RegExp(`page===['"]${page}['"]`), `${page} render branch`);
  }
});

test('workspace switching keeps the URL and scoped invite page on the selected slug', () => {
  assert.match(appSource, /parts\[1\] === 'me' && parts\[2\] === 'invite'/);
  assert.match(appSource, /function routePath\(key, detailId = '', workspaceOverride = ''\)/);
  assert.match(appSource, /if \(key === 'invite'\) return `\$\{prefix\}\/me\/invite`/);
  assert.match(appSource, /setWorkspaceSlug\(nextSlug\);\s*history\.pushState\(\{\},'',routePath\(page\.value,'',nextSlug\)\);\s*await load\(\)/);
});

test('global shell contract exposes cross-page navigation and controls', () => {
  for (const key of ['issues', 'calendar', 'docs', 'members', 'skills', 'settings']) {
    assert.match(shellSource, new RegExp(`\\['${key}',`), `${key} navigation`);
  }
  for (const label of ['主页', '语言', '帮助', '工作区导航', '新建项目', '退出登录']) {
    assert.match(shellSource, new RegExp(label), `${label} control`);
  }
  for (const language of ['English', '简体中文', '한국어', '日本語']) assert.match(shellSource, new RegExp(language));
  for (const label of ['快捷菜单', '搜索任务', '通过数字伙伴创建', '收件箱']) assert.match(appSource, new RegExp(`aria-label="${label}"`));
  assert.equal((appSource.match(/class="quick-primary"[^>]*@click="openAgentComposer"/g) || []).length, 4);
  assert.match(appSource, /新建 Markdown/);
  assert.match(appSource, /title="添加设备"|>添加设备</);
  assert.match(appSource, /function createWorkspace\(payload\)/);
  assert.match(appSource, /const workspaceRole = activeMembership\?\.role \|\| authState\.value\.role/);
  assert.match(shellSource, /emit\('logout'\)/);
  assert.match(appSource, /@logout="logout"/);
  assert.match(appSource, /routePath\(page\.value\)/);
});

test('toast notifications use a compact floating status surface', () => {
  assert.match(appSource, /class="notice toast-notice"/);
  assert.match(appSource, /role="status"/);
  assert.match(appSource, /notice-dismiss/);
  assert.match(appSource, /toastTone/);
  assert.match(stylesSource, /\.toast-notice[^}]*position:fixed/);
});

test('page-specific UI contracts cover the requested acceptance surfaces', () => {
  const controls = [
    ['calendar', /page==='calendar'/, /月/, /周/, /日/, /今天/, /新建任务/],
    ['documents', /page==='docs'/, /class="docs-page"/, /新建 Markdown/, /下载/],
    ['team', /page==='members'/, /class="team-page"/, /添加设备/, /添加数字员工/, /邀请伙伴/],
    ['skills', /page==='skills'/, /平台技能/, /团队技能/, /导入 SKILL\.md/],
    ['settings', /page==='settings'/, /基本信息/, /安全与访问/, /保存更改/],
    ['invites', /page==='invite'/, /邀请成员/, /生成并复制链接/, /撤销/],
    ['open platform', /page==='open'/, /REST API/, /A2A v1/, /Webhook/],
    ['inbox', /page==='inbox'/, /收件箱/, /全部已读/],
  ];
  for (const [name, ...patterns] of controls) for (const pattern of patterns) assert.match(appSource, pattern, `${name} contract`);
});

test('task detail modal keeps execution activity readable in a bounded two-column layout', () => {
  assert.match(appSource, /class="task-detail-modal"/);
  assert.match(appSource, /class="task-message-list"/);
  assert.match(shellCssSource, /\.task-detail-modal/);
  assert.match(shellCssSource, /\.task-message-content[^}]*overflow-wrap:anywhere/);
  assert.match(shellCssSource, /\.task-detail-side[^}]*min-width:0/);
});

test('task and conversation views expose safe execution progress instead of hidden reasoning', () => {
  assert.match(appSource, /执行进度/);
  assert.match(appSource, /execution-event-list/);
  assert.match(appSource, /executionEventLabel/);
  assert.match(appSource, /executionEventRows/);
  assert.match(appSource, /executionEventDetail/);
  assert.match(appSource, /event\.detail/);
  assert.match(appSource, /scrollExecutionList/);
  assert.match(appSource, /execution-activity/);
  assert.match(appSource, /运行命令|调用工具|处理上下文/);
  assert.match(shellCssSource, /\.execution-event-list/);
});

test('execution views expose provider reasoning summaries as an explicit expandable item', () => {
  assert.match(appSource, /executionReasoningSummaries/);
  assert.match(appSource, /class="execution-reasoning-drawer/);
  assert.match(shellCssSource, /\.execution-reasoning-drawer/);
});

test('agent creation opens a persistent conversation workspace', () => {
  assert.match(appSource, /navigate\('inbox'\);\s*await openConversation\(\{id:conversation\.id\}\)/);
  assert.match(appSource, /class="conversation-thread"/);
  assert.match(appSource, /class="conversation-messages"/);
  assert.match(appSource, /class="conversation-compose"/);
  assert.match(appSource, /等待数字伙伴回复/);
});

test('baseline explicitly records the browser automation limitation', () => {
  assert.equal(baseline.application.playwright.available, false);
  assert.match(baseline.application.playwright.fallback, /node:test/i);
  assert.ok(baseline.knownLimitations.some(item => /Playwright/.test(item)));
});
