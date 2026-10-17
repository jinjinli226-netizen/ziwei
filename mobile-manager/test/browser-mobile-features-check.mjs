// Browser UI fixtures only. No listeners, production accounts, real employee
// actions or native notification/keyboard claims. Chromium communicates by pipe.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/zhangjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url))), web = path.join(root, 'mobile-manager/web'), out = path.join(root, '.local/mobile-manager-features-qa');
await fs.mkdir(out, { recursive: true });
const sourceNames = ['app.js', 'controller.js', 'api.js', 'view.js', 'styles.css', 'mobile-groups.js', 'mobile-groups-view.js', 'mobile-tasks.js', 'mobile-tasks-view.js', 'mobile-notifications.js', 'mobile-notifications-view.js'];
const hashes = async () => Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(web, name))).digest('hex')])));
const before = await hashes();
const origin = 'https://ziwei-mobile-features.invalid', slug = 'feature-fixture', workspaceId = 'workspace-db-fixture', accountId = 'feature-account';
const date = '2026-10-17T10:00:00.000Z';
const employees = ['source', 'partner', 'other'].map(id => ({ id, name: { source: '群组负责员工', partner: '已授权伙伴', other: '未授权伙伴' }[id], runtime: 'Hermes', status: 'active', main_conversation_id: `chat-${id}`, target_device_id: 'fixture-pc' }));
const bot = id => ({ id, employee_id: id, workspace: slug, kind: 'employee', employee: employees.find(employee => employee.id === id), configuration_state: 'initialized', revision: 4, control_epoch: 7, control_state: 'active', validation: { status: 'succeeded' }, main_conversation_id: `chat-${id}`, config: { permissions: { mode: 'execute' }, collaboration: { enabled: true, targetEmployeeIds: ['partner'] }, memory: {}, skills: {}, drivers: {} } });
const existing = 'group_existing';
const roster = () => ['source', 'partner'].map(id => ({ member_id: id, profile: id, display_name: employees.find(employee => employee.id === id).name }));
const requests = [], errors = [], checks = [], screenshots = [], sessions = [];
const browser = await chromium.launch({ executablePath: process.env.ZIWEI_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let activePage;
const raf = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const capture = async (page, name) => { await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }); screenshots.push(name); };
const click = (page, action, id) => page.locator(`[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}`).first().click();

async function fixture(width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push({ width, message: error.message }));
  let serial = 0;
  const actions = new Map(), rooms = new Map([[existing, { room_id: existing, name: '现有原生群', members: roster() }]]);
  const logs = new Map([[existing, Array.from({ length: 35 }, (_, index) => ({ event_id: `saved-event-${index + 1}`, seq: index + 1, kind: 'message.user', actor: { kind: 'member', id: index % 2 ? 'partner' : 'source' }, payload: { text: `持久事件第${index + 1}条 ${'已保存正文。'.repeat(4)}` } }))]]);
  const tasks = [
    { id: 'planned-task', title: '原计划待办', description: '不会自动执行', state: 'planned', assignee: 'source', workspace_id: workspaceId, created_at: date },
    { id: 'running-task', title: '正在进行的工作', state: 'in_progress', workspace_id: workspaceId, created_at: date },
    { id: 'done-task', title: '已经完成的工作', state: 'completed', workspace_id: workspaceId, created_at: date },
    { id: 'cancelled-task', title: '已取消的工作', state: 'cancelled', workspace_id: workspaceId, created_at: date },
  ];
  const notices = [
    { id: 'notice-task', kind: 'attention.required', title: '<script>notice()</script> 待办提醒', summary: '这项工作需要查看', createdAt: date, executionState: 'not_applicable', target: { kind: 'task', id: 'planned-task' } },
    { id: 'notice-chat', kind: 'execution.completed', title: '员工完成提醒', summary: '从原事件核对当前权限后查看', createdAt: date, executionState: 'confirmed', target: { kind: 'conversation', id: 'chat-source', employeeId: 'source', messageId: 'chat-message', actionId: 'original-run' } },
  ];
  const control = { nativePosts: [], sends: [], taskPosts: [], legacyNext: false, denyResolve: false };
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  function nativeAction(sourceId, body) {
    const collaboration = body.mode === 'group', actionId = `fixture-action-${++serial}`;
    const request = { schemaVersion: 2, resource: collaboration ? 'collaboration' : body.resource, operation: collaboration ? 'message' : body.operation, requestId: body.idempotencyKey,
      input: collaboration ? { mode: 'group', groupId: body.groupId, content: body.content, targets: body.targetEmployeeIds.map(id => ({ id, name: employees.find(employee => employee.id === id).name, revision: 4, controlEpoch: 7, conversationId: `chat-${id}` })) } : body.input };
    const action = { id: actionId, status: 'pending', payload: { employeeId: sourceId, hermesBot: { employeeId: sourceId, workspace: slug, revision: body.expectedRevision, controlEpoch: body.expectedControlEpoch }, nativeOperation: request } };
    let data;
    if (collaboration) {
      const room = { room_id: body.groupId, name: '新建协作群', members: roster() }; rooms.set(body.groupId, room);
      logs.set(body.groupId, [{ event_id: `new-event-${serial}`, seq: 1, kind: 'message.user', actor: { kind: 'user', id: 'source' }, payload: { text: body.content } }]);
      data = { room, events: { events: [{ event_id: 'must-not-render-unpaged-send-result', seq: 9999, payload: { text: '禁止把发送回执冒充已分页持久历史' } }] } };
      const child = { id: `fixture-child-${serial}`, status: 'succeeded', payload: { employeeId: 'partner', hermesBot: { employeeId: 'partner', workspace: slug, revision: 4, controlEpoch: 7 }, collaboration: { sourceEmployeeId: 'source', sourceActionId: actionId, groupId: body.groupId } } };
      actions.set(child.id, child); action.memberRefs = [{ actionId: child.id, employeeId: 'partner', status: 'succeeded' }];
    } else if (body.operation === 'list') data = { items: [...rooms.values(), { room_id: 'group_missing', name: '读取失败的原生群' }] };
    else if (body.input.groupId === 'group_missing') { action.failure = '群记录读取失败（隔离夹具）'; }
    else {
      const entries = (logs.get(body.input.groupId) || []).filter(event => event.seq > body.input.afterSeq).slice(0, body.input.limit), next = entries.at(-1)?.seq ?? body.input.afterSeq, more = (logs.get(body.input.groupId) || []).some(event => event.seq > next);
      data = { room: rooms.get(body.input.groupId), events: { events: entries, cursor: next, has_more: more }, pagedRead: true, pagination: { limit: body.input.limit, afterSeq: body.input.afterSeq, nextAfterSeq: next, hasMore: more }, decision: null, plan: null };
      if (control.legacyNext) { control.legacyNext = false; delete data.pagedRead; delete data.pagination; }
    }
    action.finish = () => { action.status = action.failure ? 'failed' : 'succeeded'; if (action.failure) action.error = action.failure;
      else action.result = { nativeOperation: { schemaVersion: 2, resource: request.resource, operation: collaboration ? 'publish' : request.operation, employeeId: sourceId, revision: body.expectedRevision, status: 'succeeded', data }, ...(collaboration ? { nativeGroup: { groupId: body.groupId, runs: action.memberRefs } } : {}) };
    };
    actions.set(actionId, action); return action;
  }
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, method = req.method(), body = req.postData() ? req.postDataJSON() : undefined;
    if (url.origin !== origin) { errors.push({ width, message: `External request ${url.origin}${p}` }); return route.abort(); }
    if (p.startsWith('/__ziwei_manager__/')) {
      const asset = p.slice('/__ziwei_manager__/'.length) || 'index.html';
      if (!/^[a-z-]+\.(html|js|css|png)$/.test(asset)) return route.abort();
      return route.fulfill({ contentType: asset.endsWith('.js') ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.png') ? 'image/png' : 'text/html', body: await fs.readFile(path.join(web, asset)) });
    }
    requests.push({ width, method, path: p });
    const base = `/api/workspaces/${slug}`;
    if (p === '/api/auth/me') return json(route, { user_id: accountId, user: { id: accountId, name: '隔离功能验收' }, memberships: [{ slug, id: workspaceId, name: '隔离功能验收', role: 'owner' }] });
    if (p === '/api/workspaces') return json(route, { workspaces: [{ slug, id: workspaceId, name: '隔离功能验收', role: 'owner' }] });
    if (p === `${base}/employees`) return json(route, { employees });
    if (p === `${base}/bots`) return json(route, { bots: employees.map(employee => bot(employee.id)) });
    if (p === `${base}/chats`) return json(route, { chats: [], unreadCount: 0 });
    if (p === `${base}/devices`) return json(route, { devices: [] });
    if (p === `${base}/tasks`) {
      if (method === 'GET') return json(route, { tasks });
      if (method === 'POST') { control.taskPosts.push(body); const saved = { ...body, id: `saved-task-${width}`, workspace_id: workspaceId, created_at: date }; tasks.unshift(saved); return json(route, saved, 201); }
    }
    const task = p.match(/^\/api\/tasks\/([^/]+)$/); if (task && method === 'GET') return json(route, tasks.find(taskRow => taskRow.id === task[1]));
    const employeeBot = p.match(new RegExp(`^${base}/bots/([^/]+)$`)); if (employeeBot && method === 'GET') return json(route, bot(employeeBot[1]));
    const native = p.match(new RegExp(`^${base}/bots/([^/]+)/(native/actions|collaboration)$`));
    if (native && method === 'POST') { const target = native[2] === 'collaboration' ? control.sends : control.nativePosts; target.push(body); return json(route, { action: nativeAction(native[1], body) }, 202); }
    const action = p.match(new RegExp(`^${base}/actions/([^/]+)$`));
    if (action && method === 'GET') { const value = actions.get(action[1]); if (value?.status === 'pending') value.finish(); return value ? json(route, value) : json(route, { error: 'No original action' }, 404); }
    if (p === `${base}/mobile/notifications`) return json(route, { schemaVersion: 1, accountId, workspaceId, workspaceSlug: slug, items: url.searchParams.has('cursor') ? [] : notices, nextCursor: 'fixturecursor', hasMore: false, ...(url.searchParams.has('history') || url.searchParams.has('limit') && !url.searchParams.has('cursor') ? { historyWindow: true } : {}) });
    const notice = p.match(new RegExp(`^${base}/mobile/notifications/([^/]+)$`));
    if (notice && method === 'GET') {
      if (control.denyResolve) return json(route, { error: '当前已无权查看这条提醒' }, 403);
      const original = notices.find(item => item.id === notice[1]);
      // Intentionally update the target: navigation must follow the fresh
      // authorized resolver, never the originally cached notification row.
      return json(route, { schemaVersion: 1, accountId, workspaceId, workspaceSlug: slug, item: { ...original, target: { kind: 'task', id: 'done-task' } } });
    }
    if (method !== 'GET') errors.push({ width, message: `Unexpected fixture business mutation ${method} ${p}` });
    else errors.push({ width, message: `Unhandled GET ${p}` });
    return json(route, { error: 'Unsupported fixture route' }, 404);
  });
  const session = { page, context, control, close: () => context.close() }; sessions.push(session);
  await page.goto(`${origin}/__ziwei_manager__/index.html`); await page.getByRole('heading', { name: '聊天', exact: true }).waitFor();
  return session;
}

async function noOverflow(page, label) {
  const layout = await page.evaluate(() => ({ window: innerWidth, document: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('main input,main select,main textarea,main button')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map(element => ({ name: element.name || element.dataset.action, rect: element.getBoundingClientRect().toJSON() })) }));
  assert.equal(layout.document <= layout.window + 1, true, `${label}: no horizontal overflow ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.offenders, [], `${label}: controls fit viewport`);
}
async function settleNative(page) {
  await page.getByRole('button', { name: '查询原请求', exact: true }).waitFor();
  await page.getByRole('button', { name: '查询原请求', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-action=group-check]'));
  await raf(page);
}

try {
  for (const width of [390, 320]) {
    const f = await fixture(width), { page, control } = f;
    await click(page, 'groups-open'); await page.locator('[name=groupSource]').selectOption('source');
    await page.getByRole('button', { name: '读取员工群组', exact: true }).waitFor();
    assert.equal(control.nativePosts.length, 0, 'Opening/selecting cannot dispatch a native read or model work');
    await click(page, 'groups-read'); assert.equal(control.nativePosts.length, 1); await settleNative(page);
    await click(page, 'group-open', existing); await settleNative(page);
    assert.equal(await page.locator('.group-status').innerText().then(text => text.includes('等待目标电脑回执')), false);
    assert.equal(await page.locator('[data-group-event-id]').count(), 30);
    assert.deepEqual(control.nativePosts.at(-1).input, { groupId: existing, limit: 30, afterSeq: 0 });
    await noOverflow(page, `group-${width}`); await capture(page, `group-${width}-first-page`);
    await click(page, 'group-more'); await settleNative(page);
    assert.equal(await page.locator('[data-group-event-id]').count(), 35);
    assert.deepEqual(control.nativePosts.at(-1).input, { groupId: existing, limit: 30, afterSeq: 30 });
    await click(page, 'back'); await click(page, 'group-open', 'group_missing'); await settleNative(page);
    await page.getByText('群记录读取失败（隔离夹具）', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-action=group-send]').isDisabled(), true);
    assert.equal(await page.locator('[data-group-event-id]').count(), 0);
    await capture(page, `group-${width}-failed-other-room`);
    await click(page, 'back'); await click(page, 'group-new');
    assert.equal(await page.locator('[data-action=group-target][data-id=other]').count(), 0, 'Unsaved collaboration targets never appear as authorized choices');
    await click(page, 'group-target', 'partner'); await click(page, 'group-mention', 'partner');
    const content = '<script>window.__groupInjection=1</script> 请伙伴处理';
    await page.locator('[name=groupContent]').fill(content);
    assert.equal(control.sends.length, 0); await page.getByRole('button', { name: '创建并发送', exact: true }).click(); await settleNative(page);
    assert.equal(control.sends.length, 1); assert.deepEqual(control.sends[0].targetEmployeeIds, ['partner']);
    assert.equal(control.sends[0].content, `@partner\n${content}`);
    assert.equal(await page.locator('[name=groupContent]').inputValue(), '', 'Successful send clears the real composer after App focus/form restoration');
    assert.equal(await page.locator('[data-group-event-id]').count(), 0);
    assert.equal(await page.getByText('禁止把发送回执冒充已分页持久历史', { exact: true }).count(), 0);
    assert.equal(await page.locator('.group-member-runs').innerText().then(text => text.includes('已完成')), true);
    await click(page, 'group-refresh'); await settleNative(page);
    assert.equal(await page.locator('[data-group-event-id]').count(), 1);
    assert.equal(await page.locator('.group-message script').count(), 0); assert.equal(await page.evaluate(() => window.__groupInjection), undefined);
    await noOverflow(page, `new-group-${width}`); await capture(page, `group-${width}-sent-and-reread`);
    await click(page, 'back'); control.legacyNext = true; await click(page, 'group-open', existing); await settleNative(page);
    await page.getByText('目标电脑暂不支持手机分页群记录，请先更新电脑端', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-group-event-id]').count(), 0); assert.equal(await page.locator('[data-action=group-send]').isDisabled(), true);
    const count = control.nativePosts.length; await page.evaluate(() => window.dispatchEvent(new Event('ziwei:resume'))); await raf(page); assert.equal(control.nativePosts.length, count, 'Resume/periodic polling cannot dispatch a fresh groups.read');
    await click(page, 'back'); await click(page, 'back');
    await page.locator('.bottom-nav [data-action=navigate][data-tab=work]').click(); await page.locator('.task-filters').waitFor();
    await click(page, 'work-filter', 'pending'); assert.deepEqual(await page.locator('.task-card').evaluateAll(elements => elements.map(element => element.dataset.id)), ['planned-task']);
    await click(page, 'work-filter', 'running'); assert.deepEqual(await page.locator('.task-card').evaluateAll(elements => elements.map(element => element.dataset.id)), ['running-task']);
    await click(page, 'work-filter', 'completed'); assert.deepEqual(await page.locator('.task-card').evaluateAll(elements => elements.map(element => element.dataset.id)), ['done-task']);
    await click(page, 'mobile-task-new');
    const title = '<img src=x onerror="run()"> 新待办', description = '保存为计划事项，不启动员工执行。\n保留这段说明。';
    await page.locator('[name=mobile-task-title]').fill(`  ${title}  `); await page.locator('[name=mobile-task-description]').fill(description); await page.locator('[name=mobile-task-assignee]').selectOption('source');
    await noOverflow(page, `task-form-${width}`); await capture(page, `task-${width}-planned-form`);
    await page.getByRole('button', { name: '保存待办', exact: true }).click(); await page.locator(`.task-card[data-id="saved-task-${width}"]`).waitFor();
    assert.deepEqual(control.taskPosts, [{ title, description, assignee: 'source', state: 'planned' }]);
    assert.equal(await page.locator(`.task-card[data-id="saved-task-${width}"] img`).count(), 0); assert.equal(control.sends.length, 1, 'Task save does not dispatch employee/group work');
    await noOverflow(page, `task-list-${width}`); await capture(page, `task-${width}-saved-pending`);
    await page.locator('.bottom-nav [data-action=navigate][data-tab=chat]').click(); await click(page, 'notifications-open');
    await page.locator('.notification-item').first().waitFor(); assert.equal(await page.locator('.notification-item').count(), 2);
    assert.equal(await page.locator('.notification-list script').count(), 0); assert.equal(await page.locator('[data-action=notifications-enable]').count(), 0, 'Ordinary browser cannot claim a native system notification bridge');
    await noOverflow(page, `notifications-${width}`); await capture(page, `notifications-${width}-in-app`);
    await click(page, 'notifications-target', 'notice-task');
    await page.getByRole('heading', { name: '已经完成的工作', exact: true }).waitFor();
    assert.ok(requests.some(request => request.width === width && request.method === 'GET' && request.path.endsWith('/mobile/notifications/notice-task')));
    assert.ok(requests.some(request => request.width === width && request.method === 'GET' && request.path === '/api/tasks/done-task'));
    await click(page, 'back'); await page.locator('.bottom-nav [data-action=navigate][data-tab=chat]').click(); await click(page, 'notifications-open');
    const writes = requests.filter(request => request.width === width && request.method !== 'GET').length;
    await click(page, 'notifications-read-all'); assert.equal(await page.locator('.notification-item.is-unread').count(), 0);
    assert.equal(requests.filter(request => request.width === width && request.method !== 'GET').length, writes, 'Notification read-all is a local preference, not a shared server mutation');
    await page.reload(); await page.getByRole('heading', { name: '聊天', exact: true }).waitFor(); await click(page, 'notifications-open'); await page.locator('.notification-item').first().waitFor();
    assert.equal(await page.locator('.notification-item.is-unread').count(), 0, 'Personal notification read markers survive reload');
    control.denyResolve = true; await click(page, 'notifications-target', 'notice-chat');
    await page.getByText('当前已无权查看这条提醒', { exact: true }).waitFor(); assert.equal(await page.locator('.app-shell').getAttribute('data-page'), 'notifications');
    checks.push(`${width}px: explicitly selected responsible employee's local native groups, 30+5 persistent events, queued original action query, failed room scope/legacy-host blocking, authorized name-chip send, exact body, composer clear, member action receipt, escaped reread; task filters and exact planned-only save; escaped in-app reminders, fresh authorized event target, local read marker/reload and denied-target blocking, no horizontal overflow`);
    await f.close();
  }
  assert.deepEqual(errors, []); const after = await hashes(); assert.deepEqual(after, before, 'Re-run UI QA against stable product sources');
  const result = { passed: true, checks, screenshots, sourceHashes: before, requests: requests.length, fixtureBusinessWrites: requests.filter(request => request.method !== 'GET').length, realBusinessWrites: 0, externalRequests: 0, localListeners: 0, evidence: 'Synthetic route fixtures with Chromium pipe. Groups belong to the chosen employee native room, not a workspace-wide human group chat. No production/backend/Android notification or weak-network acceptance claim.' };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const result = { passed: false, error: error.stack || error.message, errors, checks, requests };
  if (activePage && !activePage.isClosed()) { await capture(activePage, 'failure').catch(() => {}); result.body = await activePage.locator('body').innerText().catch(() => null); }
  await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify(result, null, 2) + '\n'); throw error;
} finally { for (const session of sessions) await session.close().catch(() => {}); await browser.close(); }
