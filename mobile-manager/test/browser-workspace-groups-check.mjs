// Browser route fixtures only: no listeners, production accounts or employee executions.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url))), web = path.join(root, 'mobile-manager/web');
const out = path.join(root, '.local/mobile-workspace-groups-qa');
await fs.mkdir(out, { recursive: true });
const origin = 'https://workspace-groups.invalid', slug = 'mixed-fixture', workspaceId = 'workspace-mixed-fixture', accountId = 'mixed-fixture-user';
const employees = [['hermes-one', '策划伙伴', 'Hermes'], ['dsh-one', '运营伙伴', 'DSH'], ['codex-one', '研发伙伴', 'Codex']].map(([id, name, runtime]) => ({
  id, name, runtime, runtime_profile: `${id}-profile`, target_device_id: 'fixture-pc', main_conversation_id: `conversation-${id}`, status: 'active', visibility: 'workspace',
}));
const members = employees.map(employee => ({ employeeId: employee.id, name: employee.name, runtime: employee.runtime, profile: employee.runtime_profile, deviceId: employee.target_device_id, conversationId: employee.main_conversation_id, workspace: slug }));
const existingId = 'mix_existing';
const checks = [], requests = [], errors = [], screenshots = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.ZIWEI_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const click = (page, action, id) => page.locator(`[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}`).first().click();
const raf = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const capture = async (page, name) => { await page.screenshot({ path: path.join(out, `${name}.png`) }); screenshots.push(name); };
async function bounds(page) {
  await raf(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'page fits the mobile viewport');
}
async function fixture(width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  let serial = 0, denyDetail = false;
  const groups = new Map([[existingId, {
    id: existingId, workspace: slug, title: '跨运行时协作群', members, state: 'planned', runs: [],
    messages: [
      { id: 'message-user', role: 'user', text: '请一起整理这次产品发布。', status: 'complete' },
      { id: 'message-hermes', role: 'assistant', employeeId: employees[0].id, runtime: 'Hermes', profile: employees[0].runtime_profile, text: '已整理发布主题和目标受众。', status: 'succeeded' },
      { id: 'message-dsh', role: 'assistant', employeeId: employees[1].id, runtime: 'DSH', profile: employees[1].runtime_profile, text: '已整理运营排期。', status: 'succeeded' },
      { id: 'message-codex', role: 'assistant', employeeId: employees[2].id, runtime: 'Codex', profile: employees[2].runtime_profile, text: '<script>不得执行</script> 研发材料已准备。', status: 'succeeded' },
    ], createdAt: '2026-11-01T01:00:00Z', updatedAt: '2026-11-01T01:01:00Z',
  }]]);
  const writes = { creates: [], sends: [], cancels: [], oldNative: 0, conversationCreates: 0 };
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname, method = request.method(), body = request.postData() ? request.postDataJSON() : undefined;
    if (url.origin !== origin) { errors.push(`Unexpected external request ${url.origin}${p}`); return route.abort(); }
    if (p.startsWith('/__ziwei_manager__/')) {
      const asset = p.slice('/__ziwei_manager__/'.length) || 'index.html';
      if (!/^[a-z-]+\.(html|m?js|css|png)$/.test(asset)) return route.abort();
      return route.fulfill({ contentType: /\.m?js$/.test(asset) ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.png') ? 'image/png' : 'text/html', body: await fs.readFile(path.join(web, asset)) });
    }
    requests.push({ width, method, path: p, query: url.search });
    const base = `/api/workspaces/${slug}`;
    if (p === '/api/auth/me') return json(route, { user_id: accountId, user: { id: accountId, name: '隔离群聊验收' } });
    if (p === '/api/workspaces') return json(route, { workspaces: [{ slug, workspace_id: workspaceId, name: '隔离群聊验收', role: 'owner' }] });
    if (p === base + '/employees') return json(route, { employees });
    if (p === base + '/bots') return json(route, { bots: [] });
    if (p === base + '/chats') return json(route, { chats: [], unreadCount: 0 });
    if (p === base + '/tasks') return json(route, { tasks: [] });
    if (p === base + '/devices') return json(route, { devices: [] });
    if (p === base + '/mobile/notifications-v2') return json(route, { schemaVersion: 2, accountId, workspaceId, workspaceSlug: slug, items: [], nextCursor: 'fixturecursor', hasMore: false });
    if (p === base + '/conversations' && method === 'POST') { writes.conversationCreates++; return json(route, { error: 'Existing bound conversations must be reused' }, 400); }
    if (p === base + '/mixed-groups') {
      if (method === 'GET') { assert.equal(url.searchParams.get('view'), 'mobile'); return json(route, { groups: [...groups.values()].map(group => ({ ...group, messages: [] })), pagination: { limit: 20, before: null, nextBefore: null, hasMore: false } }); }
      if (method === 'POST') {
        writes.creates.push(body); assert.match(body.id, /^mix_[A-Za-z0-9_-]+$/); assert.equal(body.title, '手机新建混合群');
        assert.deepEqual(body.members.map(member => ({ employeeId: member.employeeId, runtime: member.runtime, profile: member.profile, deviceId: member.deviceId, conversationId: member.conversationId })), members.map(member => ({ employeeId: member.employeeId, runtime: member.runtime, profile: member.profile, deviceId: member.deviceId, conversationId: member.conversationId })));
        const group = { ...body, workspace: slug, members: body.members.map(member => ({ ...member, workspace: slug })), messages: [], runs: [], state: 'planned' };
        groups.set(group.id, group); return json(route, group, 201);
      }
    }
    const match = p.match(new RegExp(`^${base}/mixed-groups/([^/]+)(?:/(messages|cancel))?$`));
    if (match) {
      const group = groups.get(match[1]); if (!group) return json(route, { error: 'Missing fixture group' }, 404);
      if (method === 'GET' && !match[2]) {
        assert.equal(url.searchParams.get('view'), 'mobile');
        if (denyDetail) { denyDetail = false; return json(route, { error: '隔离群聊暂时无法读取' }, 503); }
        const before = url.searchParams.get('before');
        if (before) {
          assert.equal(before, 'message-user');
          return json(route, { ...group, messages: [{ id: 'older-message', role: 'user', text: '更早的群聊历史已从上一页读取。', status: 'complete' }], pagination: { limit: 10, before, nextBefore: null, hasMore: false } });
        }
        return json(route, { ...group, pagination: { limit: 10, before: null, nextBefore: 'message-user', hasMore: true } });
      }
      if (method === 'POST' && match[2] === 'messages') {
        writes.sends.push({ groupId: group.id, body }); assert.equal(body.content, '请研发伙伴补充验收清单'); assert.equal(typeof body.messageId, 'string'); assert(body.messageId);
        assert.deepEqual(body.targetEmployeeIds, ['codex-one']);
        const run = { employeeId: 'codex-one', runtime: 'Codex', profile: members[2].profile, conversationId: members[2].conversationId, actionId: `fixture-action-${++serial}`, messageId: body.messageId, status: 'pending' };
        group.messages.push({ id: body.messageId, role: 'user', text: body.content, status: 'pending' }); group.runs = [run]; group.state = 'running';
        return json(route, { state: 'dispatched', group, runs: [run], plan: { groupId: group.id, members: [run] }, execution: 'conversation_execute' });
      }
      if (method === 'POST' && match[2] === 'cancel') { writes.cancels.push({ groupId: group.id, body }); return json(route, { state: 'cancel_requested', groupId: group.id, sourceActionId: null, controls: group.runs.map(run => ({ ...run, cancelActionId: `fixture-cancel-${serial}`, cancellationRequested: true })) }); }
    }
    if (/\/bots\/[^/]+\/(native\/actions|collaboration)$/.test(p)) writes.oldNative++;
    errors.push(`Unhandled ${method} ${p}`); return json(route, { error: 'Unhandled fixture route' }, 404);
  });
  await page.goto(`${origin}/__ziwei_manager__/index.html`); await page.locator('[data-action=groups-open]').first().waitFor();
  for (const employee of employees) assert(await page.locator(`[data-action=chat][data-id="${employee.id}"]`).isVisible(), 'home displays every visible employee');
  assert.equal(await page.locator('[data-action=report-setup]').count(), 0, 'home has no report shortcut');
  assert.equal(await page.locator('.mobile-shortcuts').count(), 0, 'home has no shortcut strip');
  await bounds(page); await capture(page, `${width}-home`);
  return { context, page, writes, groups, denyNextDetail: () => { denyDetail = true; } };
}

try {
  for (const width of [320, 390]) {
    const f = await fixture(width), { page } = f;
    try {
      await click(page, 'groups-open'); await page.locator(`[data-action=workspace-group-open][data-id="${existingId}"]`).waitFor();
      assert.equal(f.writes.creates.length + f.writes.sends.length + f.writes.cancels.length, 0);
      assert(requests.some(request => request.width === width && request.path.endsWith('/mixed-groups') && request.method === 'GET'));
      await bounds(page); await capture(page, `${width}-01-list`);
      await click(page, 'workspace-group-open', existingId); await page.getByText('已整理发布主题和目标受众。', { exact: true }).waitFor();
      for (const runtime of ['Hermes', 'DSH', 'Codex']) assert(await page.getByText(runtime, { exact: true }).first().isVisible(), `${runtime} runtime is visible`);
      assert(await page.getByText('<script>不得执行</script> 研发材料已准备。', { exact: true }).isVisible());
      assert.equal(await page.locator('script').filter({ hasText: '不得执行' }).count(), 0);
      await bounds(page); await capture(page, `${width}-02-detail`);
      await page.locator('[name=workspaceGroupContent]').fill('读取旧历史时保留这段草稿');
      await click(page, 'workspace-group-history'); await page.getByText('更早的群聊历史已从上一页读取。', { exact: true }).waitFor();
      assert.equal(await page.locator('[name=workspaceGroupContent]').inputValue(), '读取旧历史时保留这段草稿');
      assert(await page.getByText('已整理发布主题和目标受众。', { exact: true }).isVisible());
      f.denyNextDetail(); await click(page, 'workspace-group-refresh'); await page.getByText('隔离群聊暂时无法读取', { exact: false }).waitFor();
      assert(await page.getByText('已整理发布主题和目标受众。', { exact: true }).isVisible(), 'failed refresh preserves the original timeline');
      await click(page, 'workspace-group-refresh');
      await page.locator('[name=workspaceGroupContent]').fill('请研发伙伴补充验收清单');
      await click(page, 'workspace-group-mention', 'codex-one'); await click(page, 'workspace-group-send');
      await page.waitForFunction(() => document.querySelector('[name=workspaceGroupContent]')?.value === '');
      assert.equal(f.writes.sends.length, 1); assert.equal(f.writes.sends[0].groupId, existingId);
      await click(page, 'workspace-group-cancel');
      await page.getByText('取消请求已提交，成员是否停止以实际回执为准', { exact: true }).waitFor();
      assert.equal(f.writes.cancels.length, 1); assert.equal(f.writes.cancels[0].groupId, existingId);
      assert.equal(f.groups.get(existingId).runs[0].status, 'pending', 'cancel request cannot fabricate a stopped member');
      await bounds(page); await capture(page, `${width}-03-member-receipt`);
      await click(page, 'back'); await click(page, 'workspace-group-new');
      await page.locator('[name=workspaceGroupTitle]').fill('手机新建混合群');
      for (const member of members) await click(page, 'workspace-group-member', member.employeeId);
      await click(page, 'workspace-group-create'); await page.getByRole('heading', { name: '手机新建混合群', exact: true }).waitFor();
      assert.equal(f.writes.creates.length, 1); assert.equal(f.writes.conversationCreates, 0); assert.equal(f.writes.oldNative, 0);
      assert.equal(f.writes.sends.length, 1, 'creating a group never dispatches a member turn');
      await bounds(page); await capture(page, `${width}-04-created`);
      checks.push(`${width}px: home displays all three employees without report/shortcut strip; default group entry GETs workspace mixed-groups; existing Hermes/DSH/Codex roster and escaped messages render; real before-cursor history preserves latest records and composer draft; failed refresh retains history; explicit @Codex send and cancel use mixed-groups only; new group reuses exact employee bindings without dispatch or native Bot actions; no horizontal overflow`);
    } finally { await f.context.close(); }
  }
  assert.deepEqual(errors, []);
  const result = { passed: true, checks, screenshots, requestCount: requests.length, externalRequests: 0, localListeners: 0, realDeviceActions: 0, productionWrites: 0, evidence: 'Real mobile app source in headless Chromium; request routing supplies workspace mixed-group fixtures; not production authentication, native keyboard, device execution or model acceptance.' };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
