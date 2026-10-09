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
const output = resolve(option('--output', join(root, '.local/team-card-fix/after')));
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
    devices: [{ id: 'pc-ready', name: 'QA 在线电脑', status: 'online', healthy: true, bridge_name: 'ziwei_user', last_seen: new Date().toISOString(), management_mcp: { managed: true, state: 'ready', configured: true, workspace: ws.slug, supportedRuntimes: ['Codex', 'Hermes'] }, runtimes: [{ name: 'Codex', cli_status: 'available', version: 'fixture-codex', available: true, readiness: ready, profiles: [{ name: 'default', readiness: ready }, { name: 'qa-codex', readiness: ready }] }, { name: 'Hermes', cli_status: 'available', version: 'fixture-hermes', available: true, readiness: ready, profiles: [{ name: 'qa-independent', provider_configured: true, authentication_configured: true, readiness: ready }] }] }, { id: 'pc-offline', name: 'QA 离线电脑', status: 'offline', management_mcp: { managed: true, state: 'pending', configured: false, workspace: ws.slug }, runtimes: [{ name: 'Codex', cli_status: 'offline', available: false, readiness: { ready: false, reason: '电脑离线，等待原 ziwei_user 心跳' } }] }]
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
    if (path === `${prefix}/mcp/status`) return state.statusFailure ? json({ error: '隔离 QA：管理状态暂时不可达' }, 503) : json({ workspace: ws.slug, workspaces: [ws.slug], health: 'healthy', transport: 'stdio', api_endpoint: `https://qzelynth.top/mcp/v1/workspaces/${ws.slug}`, managed: true, default_enabled: true, configured: true, scope_allowed: true, connections: state.devices.map(device => ({ device_id:device.id, name:device.name, status:device.status, ...device.management_mcp })), credential: { configured:true, managed:true, mode:'device-bootstrap', scope_allowed:true, masked:'' }, tools: [{ name: 'ziwei_discover_environment', description: '来自心跳的目标电脑、CLI 和 profile 发现', inputSchema: { type: 'object', properties: {} } }, { name: 'ziwei_create_employee', description: '按明确 runtime 和电脑创建员工', inputSchema: { type: 'object', required: ['name', 'runtime', 'targetDeviceId'] } }], config_template: { mcpServers: { 'ziwei-management': { command: 'node', args: ['C:/Ziwei/scripts/ziwei-mcp.mjs'], env: { ZIWEI_MCP_TOKEN: 'must-never-render-fixture-secret' } } } } });
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
const actualFixture = option('--employees', '');
const longText = '仅在明确的工作区与运行时执行已授权任务，核对设备和独立运行配置，使用真实工具回读结果，失败如实报告，不得替换目标或输出凭据。';
const makeInstructions = length => `${longText.repeat(Math.ceil(length / longText.length)).slice(0, length - 21)} FULL_INSTRUCTION_END`;
const inputEmployees = actualFixture ? JSON.parse(await readFile(resolve(actualFixture), 'utf8')) : [
  { id:'team-hermes', name:'QA 管理 MCP Hermes 验收员工', runtime:'Hermes', runtime_profile:'qa-independent-long-profile', description:'负责核验工作区状态，并记录真实工具调用结果和失败原因。', instructions:makeInstructions(554), status:'active' },
  { id:'team-codex', name:'QA 管理 MCP Codex 验收员工', runtime:'Codex', runtime_profile:'qa-codex-long-profile', description:'负责核验工作区状态，并记录真实工具调用结果和失败原因。', instructions:makeInstructions(417), status:'active' },
  { id:'team-builder', name:'数字员工搭建师', runtime:'Codex', description:'梳理员工需求，创建或调整员工，并验证交付结果。', instructions:makeInstructions(233), status:'active' }
];
const originalEmployees = JSON.stringify(inputEmployees);
const missingDescription = [{ ...inputEmployees[0], id:'team-fallback', name:'未填写描述的长指令员工', description:'', instructions:`\n\n${'fallbackInstruction'.repeat(90)} FULL_INSTRUCTION_END` }];
const twelve = Array.from({ length:12 }, (_, index) => ({ ...inputEmployees[index % inputEmployees.length], id:`many-${index}`, name:`${inputEmployees[index % inputEmployees.length].name} ${index + 1}`, status:index === 11 ? 'inactive' : 'active' }));
const cases = [{ name:'three-employees', employees:inputEmployees }, { name:'twelve-employees', employees:twelve }, { name:'missing-description', employees:missingDescription }];
evidence.fixtureSource = actualFixture ? 'saved-real-employee-fields-offline' : 'synthetic-long-instructions-short-description';
evidence.geometry = [];
evidence.writeRequests = [];
function teamFixture(rows) {
  const f = fixture(); f.state.employees = structuredClone(rows);
  f.state.devices = [f.state.devices[0]]; f.state.devices[0].name = '隔离验收电脑';
  f.state.devices[0].id = rows[0]?.target_device_id || 'pc-ready';
  return f;
}
async function teamGeometry(page) {
  return page.locator('.members-panel').evaluate(panel => {
    const box = element => { const r = element.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    const chart = panel.querySelector('.org-chart'); const list = panel.querySelector('.org-employee-list'); const environment = panel.querySelector('.team-environment-section');
    return { chart:box(chart), list:list ? box(list) : null, environment:box(environment), documentWidth:document.documentElement.scrollWidth, viewport:innerWidth, cards:[...panel.querySelectorAll('.org-employee-card')].map(card => { const summary = card.querySelector('em'); return { ...box(card), summary:box(summary), summaryText:summary.textContent.trim(), summaryLineHeight:parseFloat(getComputedStyle(summary).lineHeight), copy:box(card.querySelector('.org-employee-copy')), avatar:box(card.querySelector('.ziwei-avatar')), status:box(card.querySelector('.ziwei-status-tag')) }; }), treeRows:[...panel.querySelectorAll('.employee-tree-row')].map(row => { const summary = row.querySelector('.employee-role-summary'); return { ...box(row), summary:summary ? box(summary) : null, summaryText:summary?.textContent.trim() || '', summaryLineHeight:summary ? parseFloat(getComputedStyle(summary).lineHeight) : null }; }) };
  });
}
async function teamShot(page, name) {
  const file = join(output, name); await page.screenshot({ path:file, fullPage:true, mask:[page.locator('.sidebar-account')], maskColor:'#edf3fa' }); evidence.screenshots.push(file);
}
try {
  for (const width of [1440, 2048, 2549, 390]) for (const scenario of cases) await run(`${scenario.name} layout at ${width}`, async () => {
    const f = teamFixture(scenario.employees); const { page, context } = await open('/test_222/members', f, width);
    try {
      await page.locator('.org-employee-card').first().waitFor();
      const geometry = await teamGeometry(page); evidence.geometry.push({ width, scenario:scenario.name, ...geometry });
      await page.locator('.team-scroll').evaluate(element => { element.scrollTop = 270; }); await teamShot(page, `${scenario.name}-${width}.png`);
      assert.equal(geometry.documentWidth <= geometry.viewport, true, 'page overflows viewport');
      assert.equal(geometry.cards.length, scenario.employees.length);
      assert.ok(Math.max(...geometry.cards.map(card => card.bottom)) <= geometry.chart.bottom - 16, 'employee cards escape organization area');
      assert.ok(geometry.environment.y >= geometry.list.bottom + 16, 'employee cards overlap Agent environment');
      assert.ok(geometry.cards.every(card => card.height <= 160), 'card expands with full instructions');
      assert.ok(geometry.cards.every(card => card.summary.height <= card.summaryLineHeight * 2 + 1), 'summary exceeds two lines');
      assert.ok(geometry.cards.every(card => card.copy.width >= 150), 'employee text squeezed into a narrow column');
      assert.ok(geometry.cards.every(card => card.status.bottom <= card.y + 48 && card.avatar.bottom <= card.y + 48), 'avatar/status drift down the long text');
      assert.ok(geometry.cards.every(card => card.summaryText.length <= 81 && !card.summaryText.includes('FULL_INSTRUCTION_END')), 'list exposes full execution instructions');
      for (let index=0; index<scenario.employees.length; index++) if (scenario.employees[index].description) assert.equal(geometry.cards[index].summaryText, scenario.employees[index].description, 'card does not prefer description');
      assert.equal(geometry.treeRows.length, scenario.employees.length);
      assert.ok(geometry.treeRows.every(row => !row.summary || row.summary.width >= 120), 'environment employee text squeezed into a narrow column');
      assert.ok(geometry.treeRows.every(row => !row.summary || row.summary.height <= row.summaryLineHeight * 2 + 1), 'environment employee summary exceeds two lines');
      assert.ok(geometry.treeRows.every(row => row.summaryText.length <= 90 && !row.summaryText.includes('FULL_INSTRUCTION_END')), 'environment employee row exposes full instructions');
      if (width === 390 && scenario.employees.length > 1) assert.ok(new Set(geometry.cards.map(card => card.y)).size > 1, 'narrow employee cards do not wrap');
      if (scenario.employees.length === 12) assert.ok(new Set(geometry.cards.map(card => card.y)).size > 1, 'twelve employees do not form multiple rows');
      if (scenario.name === 'missing-description') assert.match(geometry.cards[0].summaryText, /^fallbackInstruction/, 'leading whitespace discards instruction fallback');
      if (scenario.name === 'three-employees') {
        await page.locator('.employee-tree-row').first().scrollIntoViewIfNeeded(); await teamShot(page, `environment-employees-${width}.png`);
        await page.getByRole('tab', { name:'目录树', exact:true }).click(); await page.locator('.directory-tree').waitFor();
        assert.equal(await page.locator('.org-chart').count(), 0, 'directory tab did not switch');
        await teamShot(page, `directory-tree-${width}.png`);
        await page.getByRole('tab', { name:'组织架构图', exact:true }).click(); await page.locator('.org-employee-card').first().waitFor();
      }
      await page.locator('.org-employee-card').last().click();
      const lastMenu = page.locator('.org-employee-actions'); await lastMenu.scrollIntoViewIfNeeded();
      const menuBounds = await lastMenu.boundingBox(); const chartBounds = await page.locator('.org-chart').boundingBox();
      assert.ok(menuBounds.y + menuBounds.height <= chartBounds.y + chartBounds.height - 12, 'last-row menu escapes organization area');
      for (const name of ['安排任务','配置伙伴']) assert.equal(await lastMenu.getByRole('menuitem', { name, exact:true }).evaluate(element => { const r=element.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return element===hit || element.contains(hit); }), true, `last-row ${name} is covered`);
      await page.locator('.org-employee-card').last().click();
      if (scenario.name !== 'twelve-employees') {
        for (let index=0; index<scenario.employees.length; index++) {
          const card = page.locator('.org-employee-card').nth(index); await card.click();
          const menu = page.locator('.org-employee-actions'); await menu.scrollIntoViewIfNeeded();
          for (const name of ['安排任务','配置伙伴']) {
            const item = menu.getByRole('menuitem', { name, exact:true });
            assert.equal(await item.evaluate(element => { const r=element.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return element===hit || element.contains(hit); }), true, `${name} menu is covered`);
          }
          await menu.getByRole('menuitem', { name:'配置伙伴', exact:true }).click();
          await page.locator('.employee-profile-tabs button').filter({ hasText:'岗位说明' }).click();
          assert.equal(await page.locator('.employee-profile-copy').first().textContent(), scenario.employees[index].instructions, 'detail no longer preserves complete instructions');
          assert.ok(page.url().endsWith(`/employee/${scenario.employees[index].id}`), 'menu navigated to wrong employee');
          await page.goto(`${base}/test_222/members`, { waitUntil:'networkidle' });
        }
        await page.locator('.org-employee-card').last().click(); const menu=page.locator('.org-employee-actions'); await menu.scrollIntoViewIfNeeded(); await teamShot(page, `${scenario.name}-menu-${width}.png`);
        await menu.getByRole('menuitem', { name:'安排任务', exact:true }).click(); await page.locator('.agent-composer').waitFor();
        assert.match(await page.locator('.agent-composer-creator').innerText(), new RegExp(scenario.employees.at(-1).name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')), 'task form did not preselect employee');
      }
      assert.equal(f.state.posts.length, 0, 'layout verification attempted a mutation');
      const writes = f.state.calls.filter(call => !['GET','HEAD','OPTIONS'].includes(call.method));
      evidence.writeRequests.push(...writes); assert.equal(writes.length, 0, 'layout verification attempted a write request');
    } finally { await context.close(); }
  });
  assert.equal(JSON.stringify(inputEmployees), originalEmployees, 'original employee fields changed');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  evidence.passed = evidence.tests.every(test => test.passed) && !evidence.pageErrors.length && !evidence.consoleErrors.some(error => !error.expectedHttpFailure) && !evidence.failedRequests.length;
  await writeFile(join(output, 'results.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: evidence.passed, tests: evidence.tests.length, pageErrors: evidence.pageErrors.length, consoleErrors: evidence.consoleErrors.length, failedRequests: evidence.failedRequests.length, output })}\n`);
  if (!evidence.passed) process.exitCode = 1;
}
