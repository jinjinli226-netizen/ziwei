// Real in-memory employee/avatar/read projections; routed browser only, no listeners or live actions.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRepository } from '../../backend/repository.mjs';
import { createAuthService } from '../../backend/auth.mjs';
import { createManagementService } from '../../backend/management.mjs';
import { createConversationReadService } from '../../backend/conversation-read-state.mjs';
import { createMobileReadView } from '../../backend/mobile-read-view.mjs';
import { employeeAvatarSrc, isCharacterAvatar } from '../../src/employee-avatar.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url))), web = path.join(root, 'mobile-manager/web'), out = path.join(root, '.local/mobile-avatar-qa');
await fs.mkdir(out, { recursive: true });
assert.deepEqual(await fs.readFile(path.join(web, 'employee-avatar.js')), await fs.readFile(path.join(root, 'src/employee-avatar.mjs')), 'Packaged renderer must match canonical desktop source');
const repo = createRepository({ memory: true }), slug = 'test-111', deviceId = 'avatar-fixture-pc', origin = 'https://avatar-fixture.invalid';
const principal = createAuthService(repo.db).setup({ name: '头像隔离验收', email: 'avatar-owner@fixture.test', password: 'isolated-fixture-password' });
const userId = principal.user_id, workspace = repo.getWorkspace(slug), actor = { actorUserId: userId, actorRole: 'owner', enforceEmployeeVisibility: true };
repo.db.prepare('INSERT INTO members(id,user_id,workspace_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('avatar-fixture-member', userId, workspace.id, '头像隔离验收', 'avatar-owner@fixture.test', 'owner', new Date().toISOString());
const ready = { ready: true, authentication: 'configured', provider: 'configured' };
repo.heartbeatDevice(slug, { deviceId, name: '隔离头像验收电脑', runtimes: Object.fromEntries(['Hermes', 'DSH', 'Codex'].map(runtime => [runtime, { status: 'available', version: 'fixture', profiles: [{ name: 'default', provider_configured: true, authentication_configured: true, readiness: ready }], models: [{ id: 'fixture-avatar-model' }], readiness: ready }])) });
const uploaded = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const employees = [
  ['蓝豆策划', 'grok:bean:blue', 'Hermes'], ['橙云运营', 'grok:cloud:orange', 'DSH'], ['绿方研发', 'grok:squircle:green', 'Codex'],
  ['默认头像伙伴', null, 'Codex'], ['上传图片伙伴', uploaded, 'Codex'],
].map(([name, avatar, runtime]) => repo.createEmployee(slug, { name, avatar, runtime, runtimeProfile: 'default', targetDeviceId: deviceId, model: 'fixture-avatar-model', ownerUserId: userId, visibility: 'workspace', status: 'active' }));
const management = createManagementService(repo), bots = management.bots;
bots.initialize(slug, employees[0].id, { idempotencyKey: 'avatar-fixture-init' }, actor);
const chats = employees.map((employee, index) => index === 0 ? repo.getConversation(bots.get(slug, employee.id, actor).main_conversation_id, actor) : repo.createConversation(slug, { employeeId: employee.id, title: `${employee.name} · 原会话`, ...actor }));
for (const chat of chats) repo.addConversationMessage(chat.id, { role: 'assistant', content: '这是原员工会话的头像验收记录，未启动员工执行。', ...actor });
const ids = new Set(employees.map(employee => employee.id)), mobile = createMobileReadView(repo), reads = createConversationReadService(repo);
const requests = [], errors = [], checks = [], screenshots = [], projections = { employees: 0, bots: 0, chats: 0 }, imageReads = [];
const currentEmployees = () => repo.listEmployees(slug).filter(employee => ids.has(employee.id));
function assertProjection(values) {
  for (const employee of values) {
    const saved = repo.getEmployee(employee.id, actor);
    if (isCharacterAvatar(saved.avatar)) assert.equal(employee.avatar_character, saved.avatar, 'Projection preserves the saved shape/color token');
  }
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.ZIWEI_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const click = (page, action, id) => page.locator(`[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}`).first().click();
const capture = async (page, name) => { await page.screenshot({ path: path.join(out, `${name}.png`) }); screenshots.push(name); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function checkAvatar(locator, employeeId, { visible = true } = {}) {
  await locator.waitFor({ state: visible ? 'visible' : 'attached' });
  assert.equal(await locator.count(), 1);
  assert.equal(await locator.isVisible(), visible);
  const info = await locator.evaluate(async img => { await img.decode(); return { src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight, kind: img.dataset.avatarKind }; });
  assert(info.width > 0 && info.height > 0, 'Actual browser image decode succeeds');
  const original = repo.getEmployee(employeeId, actor);
  if (!original.avatar || isCharacterAvatar(original.avatar)) {
    assert.equal(info.src, employeeAvatarSrc(original.avatar, original.id), 'App uses desktop shared SVG with employee id as default seed');
    assert.equal(info.kind, 'character');
    const svg = decodeURIComponent(info.src.split(',').slice(1).join(','));
    assert(svg.includes('class="avatar-eyes"')); assert(svg.includes('class="avatar-body"'));
  } else {
    const projected = mobile.employee(slug, original), expected = employeeAvatarSrc(projected.avatar, original.id);
    const actualUrl = new URL(info.src), expectedUrl = new URL(expected, origin);
    assert.equal(actualUrl.pathname + actualUrl.search, expectedUrl.pathname + expectedUrl.search, 'Uploaded image keeps its authorized avatar route');
    assert.equal(info.kind, 'image');
    assert.equal(hash(mobile.avatar(slug, original.id, actor).bytes), hash(Buffer.from(uploaded.split(',')[1], 'base64')));
  }
  assert.equal(await locator.locator('..').locator(':scope > span').count(), 0, 'No name-initial fallback node');
  return info.src;
}
async function fixture(width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname, method = request.method();
    const avatar = p.match(/^\/api\/workspaces\/test-111\/employees\/([^/]+)\/avatar$/);
    if (avatar && [origin, 'https://qzelynth.top', 'https://ziwei.qzelynth.top'].includes(url.origin)) {
      const source = mobile.avatar(slug, avatar[1], actor); assert(source, 'Avatar bytes come from actual stored employee');
      if (url.searchParams.has('v')) assert.equal(url.searchParams.get('v'), source.version);
      imageReads.push({ employeeId: avatar[1], mimeType: source.mimeType, bytes: source.bytes.length });
      return route.fulfill({ status: 200, contentType: source.mimeType, body: source.bytes });
    }
    if (url.origin !== origin) { errors.push(`Unexpected external request ${url.origin}${p}`); return route.abort(); }
    if (p.startsWith('/__ziwei_manager__/')) {
      const asset = p.slice('/__ziwei_manager__/'.length) || 'index.html';
      if (!/^[a-z-]+\.(html|m?js|css|png)$/.test(asset)) return route.abort();
      return route.fulfill({ contentType: /\.m?js$/.test(asset) ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.png') ? 'image/png' : 'text/html', body: await fs.readFile(path.join(web, asset)) });
    }
    requests.push({ width, method, path: p, query: url.search });
    try {
      if (p === '/api/auth/me') return json(route, { user_id: userId, user: { id: userId, name: '头像隔离验收' } });
      if (p === '/api/workspaces') return json(route, { workspaces: [{ slug, workspace_id: workspace.id, role: 'owner', name: '头像隔离验收' }] });
      const base = `/api/workspaces/${slug}`;
      if (p === base + '/employees') { const values = mobile.employees(slug, currentEmployees()); assertProjection(values); projections.employees++; return json(route, { employees: values }); }
      if (p === base + '/bots') { const values = bots.list(slug, actor).filter(bot => ids.has(bot.employee_id || bot.id)).map(bot => mobile.bot(slug, bot)); assertProjection(values.map(bot => bot.employee).filter(Boolean)); projections.bots++; return json(route, { bots: values }); }
      if (p === base + '/chats') { const value = reads.list(slug, actor); value.chats = value.chats.filter(chat => ids.has(chat.employeeId)); assertProjection(value.chats.map(chat => chat.employee)); projections.chats++; return json(route, value); }
      if (p === base + '/devices') return json(route, { devices: repo.listDevices(slug) });
      if (p === base + '/tasks') return json(route, { tasks: [] });
      if (p === base + '/mobile/notifications-v2') return json(route, { schemaVersion: 2, accountId: userId, workspaceId: workspace.id, workspaceSlug: slug, items: [], nextCursor: 'avatar-fixture-cursor', hasMore: false, historyWindow: true });
      if (p === base + '/conversations') return json(route, { conversations: repo.listConversations(slug, { ...actor, conversationEmployeeId: url.searchParams.get('employeeId') }) });
      const bot = p.match(new RegExp(`^${base}/bots/([^/]+)(?:/(runs|routines|interactions))?$`));
      if (bot) {
        if (bot[2] === 'runs') return json(route, { runs: bots.runs(slug, bot[1], actor).map(mobile.run) });
        if (bot[2] === 'routines') return json(route, { routines: [] });
        if (bot[2] === 'interactions') return json(route, { requests: [] });
        return json(route, mobile.bot(slug, bots.get(slug, bot[1], actor)));
      }
      const conversation = p.match(/^\/api\/conversations\/([^/]+)$/);
      if (conversation) return json(route, mobile.conversation(repo.getConversation(conversation[1], actor, Object.fromEntries(url.searchParams))));
      const read = p.match(/^\/api\/conversations\/([^/]+)\/read$/);
      if (read && method === 'POST') return json(route, reads.read(read[1], request.postDataJSON(), actor));
      errors.push(`Unhandled ${method} ${p}`); return json(route, { error: 'Unsupported isolated avatar fixture route' }, 404);
    } catch (error) { errors.push(error.message); return json(route, { error: error.message }, error.status || 400); }
  });
  await page.goto(`${origin}/__ziwei_manager__/index.html`);
  await page.getByRole('heading', { name: '我的员工', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.employee-identity').length === 5);
  return { page, context };
}
try {
  for (const width of [390, 320]) {
    const { page, context } = await fixture(width);
    try {
      const before = new Map();
      for (const employee of employees) before.set(employee.id, await checkAvatar(page.locator(`.employee-identity[data-id="${employee.id}"] .avatar img`), employee.id));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await capture(page, `${width}-01-home`);
      await click(page, 'refresh');
      for (const employee of employees) assert.equal(await checkAvatar(page.locator(`.employee-identity[data-id="${employee.id}"] .avatar img`), employee.id), before.get(employee.id));
      const renamed = employees[3]; repo.updateEmployee(renamed.id, { name: `改名后的默认伙伴${width}` }, actor);
      const character = employees[2]; repo.updateEmployee(character.id, { name: `改名后的绿方伙伴${width}` }, actor);
      await click(page, 'refresh'); await page.getByRole('button', { name: `打开聊天：改名后的默认伙伴${width}`, exact: true }).waitFor();
      for (const employee of employees) assert.equal(await checkAvatar(page.locator(`.employee-identity[data-id="${employee.id}"] .avatar img`), employee.id), before.get(employee.id));
      await capture(page, `${width}-02-renamed-home`);
      await page.locator('.bottom-nav [data-action=navigate][data-tab=chat]').click(); await page.locator('.thread-row').first().waitFor();
      for (const employee of employees) assert.equal(await checkAvatar(page.locator(`.thread-row[data-id="${employee.id}"] .avatar img`), employee.id), before.get(employee.id));
      for (const [index, employee] of employees.entries()) {
        await click(page, 'chat', employee.id); await page.locator('.chat-timeline .message').first().waitFor();
        await checkAvatar(page.locator('.detail-header-title .avatar img'), employee.id, { visible: width > 350 });
        if ([0, 3, 4].includes(index)) await capture(page, `${width}-03-chat-${index}`);
        await click(page, 'employee-detail', employee.id); await page.locator('.employee-profile').waitFor();
        await checkAvatar(page.locator('.employee-profile .avatar img'), employee.id);
        if ([0, 3, 4].includes(index)) await capture(page, `${width}-04-detail-${index}`);
        await click(page, 'back');
        await click(page, 'back');
        if (await page.locator('.thread-row').count() === 0) {
          await page.locator('.bottom-nav [data-action=navigate][data-tab=chat]').click(); await page.locator('.thread-row').first().waitFor();
        }
      }
      checks.push(`${width}px: five stored employee avatars are visible and decode on home/recent chats/detail; chat-header avatars decode with exact sources${width <= 350 ? ' while remaining hidden by the existing compact-header CSS rule' : ' and are visible'}; three saved shape/color tokens match desktop renderer and remain in all projections; empty avatar uses stable employee-id seed; refresh and rename preserve sources; uploaded PNG keeps authenticated route and exact original bytes; no initials or horizontal overflow`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []); assert(projections.employees > 0 && projections.bots > 0 && projections.chats > 0);
  assert(imageReads.some(image => image.mimeType === 'image/png'));
  const result = { passed: true, checks, screenshots, projections, requestCount: requests.length, avatarImageReads: imageReads.length, compactChatHeaderAvatar: { width: 320, visible: false, reason: 'Existing max-width:350px rule hides .detail-header .avatar.small; attached image decode/source verified, home and profile remain visible.' }, externalRequests: 0, localListeners: 0, realDeviceActions: 0, externalModelCalls: 0, productionWrites: 0, evidence: 'Real in-memory repository, initialized Hermes Bot, stored character/image avatars, mobile and chat-read projections; headless Chromium request routes only. Not a production account, native Android keyboard or device acceptance.' };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); repo.db.close(); }
