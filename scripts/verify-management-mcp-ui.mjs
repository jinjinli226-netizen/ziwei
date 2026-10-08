#!/usr/bin/env node
/** Isolated browser acceptance; serves only built static assets and intercepts every API request. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const dist = resolve(option('--dist', join(root, 'frontend/dist')));
const output = resolve(option('--output', join(root, '.local/management-mcp-ui')));
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) { try { playwright = require(candidate); break; } catch {} }
if (!playwright) throw new Error('Preinstalled Playwright unavailable.');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://fixture.test').pathname);
    let file = resolve(dist, `.${pathname}`);
    if (file !== dist && !file.startsWith(`${dist}${sep}`)) return response.writeHead(403).end();
    if (pathname.startsWith('/api/') || pathname.startsWith('/a2a/')) return response.writeHead(500).end('API escaped fixture');
    if (!extname(file)) file = join(dist, 'index.html');
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true });
const evidence = { mode: 'isolated-headless-api-fixtures', observedAt: new Date().toISOString(), businessBackendStarted: false, realDeviceActions: 0, tests: [], pageErrors: [], consoleErrors: [], failedRequests: [], screenshots: [] };
const ws = { id: 'workspace-fixture', slug: 'test_222', name: 'MCP 隔离测试工作区', kind: 'team', timezone: 'Asia/Shanghai', preferences: {} };
const prefix = '/api/workspaces/test_222';
const ready = { authentication: 'configured', provider: 'configured', ready: true };
function fixture() {
  const state = {
    statusFailure: false, createFailure: false, posts: [], calls: [],
    receipt: { status: 'injected', injected: true, loaded: false, action_id: 'action-ui-injected', tool_calls: [] },
    employees: [{ id: 'builder-fixture', name: 'QA 员工搭建师', runtime: 'Codex', runtime_profile: 'qa-codex', instructions: '构建员工并验证交付', persona: '清楚准确', skills: [], status: 'active', target_device_id: 'pc-ready', management_mcp_enabled: true }],
    devices: [{ id: 'pc-ready', name: 'QA 在线电脑', status: 'online', healthy: true, bridge_name: 'ziwei_user', last_seen: new Date().toISOString(), management_mcp: { configured: true, workspace: ws.slug, supportedRuntimes: ['Codex', 'Hermes'] }, runtimes: [{ name: 'Codex', cli_status: 'available', version: 'fixture-codex', available: true, readiness: ready, profiles: [{ name: 'default', readiness: ready }, { name: 'qa-codex', readiness: ready }] }, { name: 'Hermes', cli_status: 'available', version: 'fixture-hermes', available: true, readiness: ready, profiles: [{ name: 'qa-independent', provider_configured: true, authentication_configured: true, readiness: ready }] }] }, { id: 'pc-offline', name: 'QA 离线电脑', status: 'offline', management_mcp: { configured: false }, runtimes: [{ name: 'Codex', cli_status: 'offline', available: false, readiness: { ready: false, reason: '电脑离线，等待原 ziwei_user 心跳' } }] }]
  };
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  async function handle(request) {
    const path = new URL(request.url()).pathname; const method = request.method(); const body = request.postDataJSON?.() || {};
    state.calls.push({ path, method });
    if (path === '/api/auth/status' || path === '/api/auth/me') return json({ authenticated: true, configured: true, user: { id: 'qa-owner', name: '隔离 QA', email: 'qa@example.test' }, role: 'owner', memberships: [{ ...ws, role: 'owner' }] });
    if (path === `${prefix}/summary`) return json({ workspace: ws, counts: {}, taskStates: {}, device: { status: 'online', name: 'fixture' } });
    if (path === `${prefix}/settings`) return json({ workspace: ws });
    if (path === `${prefix}/devices`) return json({ devices: state.devices });
    if (path === `${prefix}/runtimes`) return json({ runtimes: state.devices[0].runtimes.map(runtime => ({ ...runtime, id: runtime.name })) });
    if (path === `${prefix}/employees`) {
      if (method === 'POST') {
        state.posts.push(body);
        if (state.createFailure) return json({ error: '隔离 QA：暂时不可用，请重试' }, 503);
        let employee = state.employees.find(row => row.idempotencyKey === body.idempotencyKey);
        if (!employee) { employee = { ...body, id: `employee-ui-${state.employees.length}`, target_device_id: body.targetDeviceId, runtime_profile: body.runtimeProfile }; state.employees.push(employee); }
        return json(employee, 201);
      }
      return json({ employees: state.employees });
    }
    if (path === `${prefix}/employees/builder-fixture` && method === 'PATCH') { state.posts.push(body); Object.assign(state.employees[0], body, { runtime_profile: body.runtimeProfile, target_device_id: body.targetDeviceId }); return json(state.employees[0]); }
    if (path === `${prefix}/mcp/status`) return state.statusFailure ? json({ error: '隔离 QA：管理状态暂时不可达' }, 503) : json({ workspace: ws.slug, workspaces: [ws.slug], health: 'healthy', transport: 'stdio', api_endpoint: `https://qzelynth.top/mcp/v1/workspaces/${ws.slug}`, credential: { configured: true, scope_allowed: true, masked: '••••••••' }, tools: [{ name: 'ziwei_discover_environment', description: '来自心跳的目标电脑、CLI 和 profile 发现', inputSchema: { type: 'object', properties: {} } }, { name: 'ziwei_create_employee', description: '按明确 runtime 和电脑创建员工', inputSchema: { type: 'object', required: ['name', 'runtime', 'targetDeviceId'] } }], config_template: { mcpServers: { 'ziwei-management': { command: 'node', args: ['C:/Ziwei/scripts/ziwei-mcp.mjs'], env: { ZIWEI_MCP_TOKEN: 'must-never-render-fixture-secret' } } } } });
    if (path === `${prefix}/mcp/discovery`) return json({ workspace: ws.slug, source: 'device_heartbeat', devices: state.devices });
    if (/\/employees\/[^/]+\/mcp\/status$/.test(path)) return json({ employee_id: 'builder-fixture', enabled: true, target_device_id: 'pc-ready', runtime: 'Codex', receipt: state.receipt });
    if (path.endsWith('/environment')) return json({ variables: [], local_source: { source: 'ziwei_user', variables: [] } });
    if (path.endsWith('/custom-params')) return json({ values: {} });
    if (path === `${prefix}/hermes/profiles`) return json({ profiles: state.devices[0].runtimes[1].profiles });
    if (path === `${prefix}/hermes/profiles/requests` && method === 'POST') { state.posts.push(body); state.devices[0].runtimes[1].profiles.push({ name: body.profile, provider_configured: true, authentication_configured: true, readiness: ready }); return json({ action: { id: 'profile-action-ui', status: 'succeeded', result: { profile: body.profile } } }); }
    if (path === '/a2a/v1/agents') return json({ agents: [] });
    return json({ tasks: [], models: [], skills: [], documents: [], automations: [], members: [], calendars: [], notifications: [], stats: {}, conversations: [], keys: [] });
  }
  return { state, handle };
}
async function open(path, state, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__qaCopied = text; } } }); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/a2a/')) return route.fulfill(await state.handle(route.request()));
    if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
    await route.continue();
  });
  await context.routeWebSocket('**/*', socket => { socket.send(JSON.stringify({ type: 'ready' })); socket.onMessage(() => {}); });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => evidence.pageErrors.push(error.stack));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push({ text: message.text(), expectedHttpFailure: /503/.test(message.text()) }); });
  page.on('requestfailed', request => evidence.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  return { page, context };
}
async function run(name, action) { try { await action(); evidence.tests.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); } catch (error) { evidence.tests.push({ name, passed: false, error: error.stack }); process.stderr.write(`FAIL ${name}: ${error.message}\n`); } }
async function screenshot(page, name) { const file = join(output, name); await page.screenshot({ path: file, fullPage: true }); evidence.screenshots.push(file); }
async function chooseDevice(page, label) { await page.getByRole('combobox', { name: '目标电脑', exact: true }).click(); await page.getByRole('option', { name: label, exact: true }).click(); }
try {
  await run('open platform exposes real tools, stdio configuration, credential boundary and mobile layout', async () => {
    for (const width of [1440, 390]) {
      const f = fixture(); const { page, context } = await open('/test_222/open-platform', f, width);
      const panel = page.getByTestId('management-mcp-panel'); await panel.getByText('ziwei_discover_environment', { exact: true }).waitFor();
      assert.match(await panel.innerText(), /API 健康/); assert.match(await panel.innerText(), /不是.*远程 MCP/);
      assert.doesNotMatch(await panel.innerText(), /must-never-render-fixture-secret/);
      await panel.getByRole('button', { name: '复制 stdio 配置', exact: true }).click();
      const copied = await page.evaluate(() => window.__qaCopied); const config = JSON.parse(copied);
      assert.equal(config.mcpServers['ziwei-management'].env.ZIWEI_MCP_WORKSPACE, 'test_222');
      assert.equal(config.mcpServers['ziwei-management'].env.ZIWEI_API_BASE, 'https://qzelynth.top');
      assert.doesNotMatch(copied, /must-never-render-fixture-secret|ZIWEI_MCP_TOKEN"/);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal page overflow');
      await panel.locator('h3').scrollIntoViewIfNeeded(); await screenshot(page, `open-platform-${width}.png`); await context.close();
    }
  });
  await run('employee MCP distinguishes injection, actual tool load and failure with API still healthy', async () => {
    const f = fixture(); const { page, context } = await open('/test_222/employee/builder-fixture', f);
    await page.getByRole('tab', { name: '♧ MCP', exact: true }).click();
    const panel = page.getByTestId('management-mcp-panel');
    await panel.getByText('已注入，等待加载回执', { exact: true }).waitFor();
    assert.doesNotMatch(await panel.innerText(), /已加载并调用工具/);
    f.state.receipt = { status: 'loaded', loaded: true, injected: true, action_id: 'action-ui-loaded', tool_calls: [{ toolName: 'ziwei_discover_environment', ok: true }] };
    await panel.getByRole('button', { name: '刷新真实状态' }).click(); await panel.getByText('已加载并调用工具', { exact: true }).waitFor();
    await screenshot(page, 'employee-loaded.png');
    f.state.receipt = { status: 'failed', error: '隔离 QA：profile provider 未配置', action_id: 'action-ui-failed', tool_calls: [] };
    await panel.getByRole('button', { name: '刷新真实状态' }).click(); await panel.getByText('加载或执行失败', { exact: true }).waitFor();
    assert.match(await panel.innerText(), /API 健康/); assert.match(await panel.innerText(), /provider 未配置/);
    await screenshot(page, 'employee-failed.png'); await context.close();
  });
  await run('explicit Codex runtime and target device persist across failed create retry', async () => {
    const f = fixture(); const { page, context } = await open('/test_222/members', f);
    await page.getByRole('button', { name: '添加数字员工', exact: true }).first().click();
    const modal = page.locator('.employee-create-modal');
    await page.getByLabel('名称', { exact: true }).fill('QA Codex 员工');
    const submit = modal.getByRole('button', { name: '创建', exact: true }); assert(await submit.isDisabled());
    await chooseDevice(page, 'QA 离线电脑 · 离线'); assert(await submit.isDisabled()); assert.match(await modal.innerText(), /目标电脑离线/);
    await chooseDevice(page, 'QA 在线电脑 · 在线');
    await page.getByLabel('人格与协作方式', { exact: true }).fill('QA：核对事实，回传证据');
    await page.getByLabel('岗位说明', { exact: true }).fill('QA：负责无副作用试运行');
    await page.getByLabel('启用紫薇管理 MCP', { exact: true }).check();
    await page.getByTestId('employee-ready').waitFor();
    f.state.createFailure = true; await submit.click(); await page.getByText('隔离 QA：暂时不可用，请重试', { exact: true }).waitFor();
    f.state.createFailure = false; await submit.click(); await modal.waitFor({ state: 'hidden' });
    assert.equal(f.state.posts.length, 2); assert.equal(f.state.posts[0].idempotencyKey, f.state.posts[1].idempotencyKey);
    assert.equal(f.state.posts[1].runtime, 'Codex'); assert.equal(f.state.posts[1].targetDeviceId, 'pc-ready'); assert.equal(f.state.posts[1].managementMcpEnabled, true); assert.match(f.state.posts[1].persona, /核对事实/);
    await screenshot(page, 'codex-created.png'); await context.close();
  });
  await run('Hermes blocks default and missing profile, provisions independent profile on the same exact device', async () => {
    const f = fixture(); const { page, context } = await open('/test_222/members', f, 390);
    await page.getByRole('button', { name: '添加数字员工', exact: true }).first().click();
    const modal = page.locator('.employee-create-modal'); await page.getByLabel('名称', { exact: true }).fill('QA Hermes 员工');
    await chooseDevice(page, 'QA 在线电脑 · 在线');
    await page.locator('#employee-runtime').click(); await page.getByRole('option', { name: /Hermes/ }).click();
    const profile = page.getByLabel('Hermes Profile', { exact: true }); const submit = modal.getByRole('button', { name: '创建', exact: true });
    await profile.fill('default'); assert(await submit.isDisabled()); assert.match(await modal.innerText(), /请选择或创建独立 Hermes profile/);
    await profile.fill('qa-new-independent'); assert(await submit.isDisabled());
    await modal.getByRole('button', { name: '在此设备创建 Profile', exact: true }).click();
    await page.getByTestId('employee-ready').waitFor(); await submit.click(); await modal.waitFor({ state: 'hidden' });
    const [profilePost, employeePost] = f.state.posts; assert.equal(profilePost.deviceId, 'pc-ready'); assert.equal(profilePost.profile, 'qa-new-independent'); assert.equal(employeePost.runtime, 'Hermes'); assert.equal(employeePost.runtimeProfile, 'qa-new-independent'); assert.equal(employeePost.targetDeviceId, 'pc-ready');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); await screenshot(page, 'hermes-created-mobile.png'); await context.close();
  });
  await run('editing preserves explicit Codex profile and runtime switch clears incompatible Hermes profile', async () => {
    const f = fixture(); const { page, context } = await open('/test_222/employee/builder-fixture', f);
    await page.getByRole('button', { name: '编辑伙伴', exact: true }).click();
    const modal = page.locator('.employee-create-modal');
    await page.getByTestId('employee-ready').waitFor();
    assert.match(await page.getByRole('combobox', { name: '运行配置 Profile', exact: true }).innerText(), /qa-codex/);
    await page.getByRole('combobox', { name: '运行配置 Profile', exact: true }).click(); await page.keyboard.press('Escape'); assert(await modal.isVisible(), 'Escape from profile listbox closed employee editor');
    await modal.getByRole('button', { name: '保存', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
    assert.equal(f.state.posts.at(-1).runtimeProfile, 'qa-codex');
    await page.getByRole('button', { name: '编辑伙伴', exact: true }).click(); await page.getByTestId('employee-ready').waitFor();
    await page.locator('#employee-runtime').click(); await page.getByRole('option', { name: /Hermes/ }).click();
    await page.getByLabel('Hermes Profile', { exact: true }).fill('qa-independent');
    await page.locator('#employee-runtime').click(); await page.getByRole('option', { name: /Codex/ }).click();
    assert.match(await page.getByRole('combobox', { name: '运行配置 Profile', exact: true }).innerText(), /默认 CLI 配置/);
    await page.getByRole('combobox', { name: '运行配置 Profile', exact: true }).click(); await page.getByRole('option', { name: 'qa-codex', exact: true }).click();
    await modal.getByRole('button', { name: '保存', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
    assert.equal(f.state.posts.at(-1).runtime, 'Codex'); assert.equal(f.state.posts.at(-1).runtimeProfile, 'qa-codex'); await context.close();
  });
  await run('MCP API error preserves actionable retry instead of a healthy label', async () => {
    const f = fixture(); f.state.statusFailure = true; const { page, context } = await open('/test_222/open-platform', f);
    const panel = page.getByTestId('management-mcp-panel'); await panel.getByRole('alert').waitFor(); assert.doesNotMatch(await panel.innerText(), /API 健康/);
    f.state.statusFailure = false; await panel.getByRole('button', { name: '重试', exact: true }).click(); await panel.getByText('API 健康', { exact: true }).waitFor(); await context.close();
  });
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  evidence.passed = evidence.tests.every(test => test.passed) && !evidence.pageErrors.length && !evidence.consoleErrors.some(error => !error.expectedHttpFailure) && !evidence.failedRequests.length;
  await writeFile(join(output, 'results.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: evidence.passed, tests: evidence.tests.length, pageErrors: evidence.pageErrors.length, consoleErrors: evidence.consoleErrors.length, failedRequests: evidence.failedRequests.length, output })}\n`);
  if (!evidence.passed) process.exitCode = 1;
}

