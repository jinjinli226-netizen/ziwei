#!/usr/bin/env node
/**
 * npm run build && node scripts/verify-ziwei-terminal-ui.mjs
 * Headless, synthetic UI acceptance. Serves dist on an ephemeral loopback port,
 * intercepts every API request and never starts a backend or sends phone traffic.
 * PLAYWRIGHT_MODULE may point to a preinstalled Playwright package directory.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture, enrollment, fixtureSession, phone } from './fixtures/ziwei-terminal-ui.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const dist = resolve(option('--dist', join(root, 'frontend/dist')));
const output = resolve(option('--output', join(root, '.local/terminal-ui-evidence')));
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch {}
}
if (!playwright) throw new Error('Preinstalled Playwright unavailable; set PLAYWRIGHT_MODULE to its package directory.');
await stat(join(dist, 'index.html'));
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://fixture.test').pathname);
    let path = resolve(dist, `.${pathname}`);
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
    if (pathname.startsWith('/api/') || pathname.startsWith('/a2a/')) { response.writeHead(500).end('API escaped browser fixture'); return; }
    if (!extname(path)) path = join(dist, 'index.html');
    const bytes = await readFile(path);
    response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const evidence = { mode: 'isolated-headless-fixtures', observedAt: new Date().toISOString(), base, businessBackendStarted: false, realDeviceActions: 0, tests: [], consoleErrors: [], pageErrors: [], unexpectedRequests: [], screenshots: [] };
const fixtures = [];
const browser = await playwright.chromium.launch({ headless: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(check, message, timeout = 8000) {
  const deadline = Date.now() + timeout; let error;
  while (Date.now() < deadline) { try { const value = await check(); if (value) return value; } catch (cause) { error = cause; } await sleep(50); }
  throw new Error(`${message}${error ? `: ${error.message}` : ''}`);
}
async function run(name, action) {
  const started = Date.now();
  try { await action(); evidence.tests.push({ name, passed: true, durationMs: Date.now() - started }); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { evidence.tests.push({ name, passed: false, error: error.stack, durationMs: Date.now() - started }); process.stderr.write(`FAIL ${name}: ${error.message}\n`); }
}
async function open(fixture, width = 1440, height = 1000) {
  fixtures.push(fixture);
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  await context.addCookies([{ name: 'ziwei_session', value: fixtureSession, url: base, httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/a2a/') || url.pathname === '/downloads/android/index.json') {
      try { await route.fulfill(await fixture.handle(request)); } catch (error) { evidence.pageErrors.push(`Fixture ${url.pathname}: ${error.stack}`); await route.fulfill({ status: 500, body: '{}' }); }
      return;
    }
    if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) { evidence.unexpectedRequests.push(request.url()); await route.abort(); return; }
    await route.continue();
  });
  await context.routeWebSocket('**/*', socket => { socket.send(JSON.stringify({ type: 'ready' })); socket.onMessage(() => {}); });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => evidence.pageErrors.push(error.stack));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push({ text: message.text(), location: message.location(), expectedHttpFailure: /Failed to load resource: the server responded with a status of (409|503)/.test(message.text()) }); });
  await page.goto(`${base}/phone_ai/ziwei-connect`, { waitUntil: 'networkidle' });
  await page.getByTestId('android-devices').waitFor();
  return { page, context, fixture };
}
async function shot(page, filename) { const path = join(output, filename); await page.screenshot({ path, fullPage: true }); evidence.screenshots.push(path); }
const terminalCalls = fixture => fixture.state.calls.filter(call => call.path.includes('/terminal/android-devices'));
try {
  await run('empty enrollment, main session, navigation and registration modal', async () => {
    const fixture = createFixture(); const { page, context } = await open(fixture);
    await page.getByText('还没有接入手机', { exact: true }).waitFor();
    await poll(async () => /暂无.*入网|没有.*入网|暂无.*申请|没有.*申请/.test(await page.getByTestId('enrollment-requests').innerText()), 'enrollment empty state absent');
    assert(terminalCalls(fixture).every(call => call.hasSession), 'main session missing from terminal calls');
    assert(!fixture.state.calls.some(call => /^\/api\/android-devices/.test(call.path)), 'legacy unauthenticated API used');
    await page.getByRole('button', { name: '登记手机', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '登记手机', exact: true }); await dialog.waitFor();
    await dialog.getByTestId('phone-alias').fill('隔离登记手机');
    await dialog.getByRole('button', { name: '登记并创建凭证' }).click();
    await page.getByTestId('device-credentials').waitFor();
    await page.getByTestId('credential-api-url').fill('https://qzelynth.top');
    const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 Agent 配置', exact: true }).click();
    const download = await downloadEvent; const bytes = await readFile(await download.path(), 'utf8'); const config = JSON.parse(bytes);
    assert.equal(config.apiUrl, 'https://qzelynth.top'); assert.equal(config.role, 'agent'); assert.equal(config.deviceId, fixture.state.devices[0].id);
    await page.getByRole('button', { name: '关闭凭证窗口', exact: true }).click(); await poll(async () => await page.getByRole('dialog').count() === 0, 'credential modal did not close');
    await page.getByRole('button', { name: '登记手机', exact: true }).click(); await page.keyboard.press('Escape'); await poll(async () => await page.getByRole('dialog').count() === 0, 'Escape did not close modal');
    const nav = page.getByRole('complementary', { name: '工作区导航' }); await page.locator('.shell-home').click();
    await poll(() => page.url().endsWith('/phone_ai/home'), 'home navigation failed');
    await nav.getByRole('button', { name: '紫薇·互联', exact: true }).click(); await page.getByTestId('android-devices').waitFor();
    await shot(page, '01-empty-registration-desktop.png'); await context.close();
  });
  await run('pending / expired enrollment; submitting, success, reject and retryable error', async () => {
    const fixture = createFixture(); const elapsed = { ...enrollment('request-elapsed', '等待时过期手机'), expiresAt: new Date(Date.now() - 60000).toISOString() }; fixture.state.requests = [enrollment('request-agent', '待审 Agent 手机'), enrollment('request-updater', '待审 Updater 手机', 'updater'), enrollment('request-expired', '已过期手机', 'agent', true), elapsed];
    const { page, context } = await open(fixture); const panel = page.getByTestId('enrollment-requests');
    await panel.getByText('待审 Agent 手机', { exact: true }).waitFor();
    const expired = panel.locator('article').filter({ hasText: '已过期手机' }); assert.match(await expired.innerText(), /已过期/);
    assert.equal(await expired.getByRole('button', { name: /批准/ }).count(), 0);
    assert.equal(await panel.locator('article').filter({ hasText: '等待时过期手机' }).getByRole('button', { name: /批准/ }).count(), 0);
    fixture.state.holdEnrollment = true;
    const pending = panel.locator('article').filter({ hasText: '待审 Agent 手机' }); await pending.getByRole('button', { name: '批准入网', exact: true }).click();
    await poll(() => typeof fixture.state.releaseEnrollment === 'function', 'approval request not received');
    assert(await pending.getByRole('button', { name: /批准|处理中|提交中/ }).isDisabled(), 'approval duplicate not disabled');
    await shot(page, '02-approval-submitting.png'); fixture.state.holdEnrollment = false; fixture.state.releaseEnrollment();
    await page.getByText(/已批准入网/).waitFor(); await page.getByTestId('phone-enrolled-fixture').waitFor();
    const updater = panel.locator('article').filter({ hasText: '待审 Updater 手机' }); await updater.getByRole('button', { name: '拒绝', exact: true }).click(); await page.getByText(/入网申请已拒绝/).waitFor();
    fixture.state.requests.push(enrollment('request-error', '失败可重试手机')); await panel.getByRole('button', { name: '刷新申请' }).click(); await panel.getByText('失败可重试手机', { exact: true }).waitFor();
    fixture.state.enrollmentFailure = true; const errored = panel.locator('article').filter({ hasText: '失败可重试手机' }); await errored.getByRole('button', { name: '批准入网', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '隔离模拟：审批服务暂时不可达' }).waitFor(); assert(await errored.isVisible(), 'failed request removed'); assert(!await errored.getByRole('button', { name: '批准入网', exact: true }).isDisabled(), 'retry button disabled');
    fixture.state.holdEnrollment = true; fixture.state.releaseEnrollment = null; await errored.getByRole('button', { name: '拒绝', exact: true }).click(); await poll(() => typeof fixture.state.releaseEnrollment === 'function', 'reject submission not received'); assert(await errored.getByRole('button', { name: /拒绝|处理中|提交中/ }).isDisabled(), 'reject duplicate not disabled'); fixture.state.holdEnrollment = false; fixture.state.releaseEnrollment(); await page.getByRole('alert').filter({ hasText: '隔离模拟：审批服务暂时不可达' }).waitFor();
    await shot(page, '03-approval-error-and-expired.png'); await context.close();
  });
  await run('phone detail, dual health, controls, original-pixel gestures and command receipts', async () => {
    const fixture = createFixture(); const device = phone(); fixture.state.devices = [device, phone('phone-fixture-2', '验收手机 02')]; fixture.state.bindings = [{ id: 'existing-second-binding', employeeId: fixture.employee.id, deviceId: 'phone-fixture-2', accountId: 'second-only-account', accountLabel: '第二手机账号' }];
    device.commands.push({ id: 'unknown-fixture', deviceId: device.id, role: 'agent', action: 'tap', args: { x: 100, y: 200 }, epoch: 1, status: 'uncertain', createdAt: new Date().toISOString(), expiresAt: new Date().toISOString() });
    const { page, context } = await open(fixture);
    assert.equal(await page.getByTestId('terminal-employee-binding').getByPlaceholder('例如 douyin-main').inputValue(), '', 'initial first phone inherited second phone account');
    await page.getByTestId('phone-phone-fixture-2').click(); await page.getByRole('heading', { name: '验收手机 02', exact: true }).waitFor();
    await page.getByTestId('phone-phone-fixture-1').click(); await page.getByRole('heading', { name: '验收手机 01', exact: true }).waitFor();
    const binding = page.getByTestId('terminal-employee-binding'); await binding.getByLabel('选择手机数字员工').click(); await page.getByRole('option', { name: '已有手机数字员工', exact: true }).click();
    await binding.getByPlaceholder('例如 douyin-main').fill('fixture-account-1'); await binding.getByPlaceholder('例如 抖音主号').fill('隔离账号一'); await binding.getByRole('button', { name: '保存绑定', exact: true }).click();
    await poll(() => fixture.state.bindings.some(row => row.deviceId === device.id && row.employeeId === fixture.employee.id), 'existing employee binding absent'); await binding.getByText('隔离账号一', { exact: true }).waitFor();
    await page.getByTestId('phone-phone-fixture-2').click(); assert.equal(await page.getByTestId('terminal-employee-binding').getByText('隔离账号一', { exact: true }).count(), 0, 'binding leaked across selected phone'); await page.getByTestId('phone-phone-fixture-1').click();
    await binding.getByRole('button', { name: '删除绑定', exact: true }).click(); await poll(() => fixture.state.bindings.length === 1 && fixture.state.bindings[0].deviceId === 'phone-fixture-2', 'binding deletion failed or touched the other phone');
    await page.getByText('测试诊断：此前网络中断，已恢复', { exact: true }).waitFor();
    await page.getByRole('button', { name: '切换至 Updater', exact: true }).click(); await poll(() => device.control.role === 'updater', 'control did not switch');
    await page.getByRole('button', { name: '暂停新指令', exact: true }).click(); await poll(() => device.control.role === null, 'control did not pause');
    await page.getByRole('button', { name: '切换至 Agent', exact: true }).click(); await poll(() => device.control.role === 'agent', 'Agent control did not return');
    await page.getByRole('button', { name: '检查健康', exact: true }).click(); await poll(() => device.commands.some(row => row.action === 'health'), 'health receipt absent');
    await page.getByRole('button', { name: '请求截图', exact: true }).click(); await page.getByTestId('device-snapshot').waitFor();
    await page.getByTestId('enable-manipulation').check(); const image = page.getByTestId('device-snapshot'); await image.scrollIntoViewIfNeeded(); const box = await image.boundingBox(); assert(box);
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.4); await poll(() => device.commands.some(row => row.action === 'tap' && row.id !== 'unknown-fixture'), 'tap command absent');
    const tap = device.commands.find(row => row.action === 'tap' && row.id !== 'unknown-fixture'); assert(Math.abs(tap.args.x - 270) <= 2 && Math.abs(tap.args.y - 768) <= 2, `wrong original pixel ${JSON.stringify(tap.args)}`);
    await page.getByLabel('拖动滑动', { exact: true }).check(); await image.scrollIntoViewIfNeeded(); const swipeBox = await image.boundingBox();
    await page.mouse.move(swipeBox.x + swipeBox.width * 0.5, swipeBox.y + swipeBox.height * 0.7); await page.mouse.down(); await page.mouse.move(swipeBox.x + swipeBox.width * 0.5, swipeBox.y + swipeBox.height * 0.2, { steps: 5 }); await page.mouse.up(); await poll(() => device.commands.some(row => row.action === 'swipe'), 'swipe command absent');
    await page.getByPlaceholder('将写入手机当前聚焦的输入框').fill('隔离浏览器验收'); await page.getByRole('button', { name: '发送文字', exact: true }).click(); await poll(() => device.commands.some(row => row.action === 'text'), 'text command absent');
    await page.getByLabel('系统操作').selectOption('home'); await page.getByRole('button', { name: '执行', exact: true }).click(); await poll(() => device.commands.some(row => row.action === 'global'), 'navigation command absent');
    await page.getByPlaceholder('应用包名，例如 com.example.app').fill('com.example.fixture'); await page.getByRole('button', { name: '打开应用', exact: true }).click(); await poll(() => device.commands.some(row => row.action === 'launch'), 'launch command absent');
    const countBefore = device.commands.length; await page.getByRole('button', { name: '核实并解除阻塞', exact: true }).click(); await page.getByTestId('command-resolution-note').fill('已对照当前截图核实，解除阻塞；不重发动作。'); await page.getByRole('button', { name: '已核实，解除阻塞', exact: true }).click(); await poll(() => device.commands.find(row => row.id === 'unknown-fixture').status === 'acknowledged', 'uncertain command unresolved'); assert.equal(device.commands.length, countBefore, 'resolution replayed command');
    await page.getByTestId('android-devices').getByRole('button', { name: '刷新', exact: true }).click(); await poll(async () => (await page.getByTestId('command-history').innerText()).includes('已人工核实'), 'summary refresh lost terminal receipts');
    const receipt = page.getByTestId('command-history').locator('.receipt-payload').first(); await receipt.locator('summary').click(); const receiptPayload = JSON.parse(await receipt.locator('pre').innerText()); assert(receiptPayload.id && receiptPayload.status && receiptPayload.args, 'full receipt metadata absent');
    await shot(page, '04-phone-details-controls-receipts.png'); await context.close();
  });
  await run('published APK selector, preflight, upgrades, cancel, verify and archive', async () => {
    const fixture = createFixture(); const device = phone(); fixture.state.devices = [device]; const { page, context } = await open(fixture);
    await page.getByLabel('已发布安装包').selectOption('0.4.5-fixture-16'); await poll(async () => (await page.getByLabel('APK 安装包路径').inputValue()).includes('/fixture/agent.apk'), 'release did not populate URL');
    await page.getByRole('button', { name: '检查并提交升级', exact: true }).click(); await poll(() => device.updates.length === 1, 'upgrade not created'); assert(device.updates[0].preflightCommandId, 'upgrade missing preflight');
    await page.getByRole('button', { name: '处理 / 取消事务', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '人工核实升级事务', exact: true }); await dialog.getByLabel('处理方式').selectOption('cancel'); await dialog.locator('input[type="checkbox"]').check(); await dialog.getByRole('button', { name: '提交处理请求', exact: true }).click(); await poll(() => device.updates[0].status === 'cancelled', 'upgrade not cancelled');
    fixture.state.nextUpdateStatus = 'awaiting_health'; await page.getByLabel('要升级的端点').selectOption('updater'); await page.getByRole('button', { name: '检查并提交升级', exact: true }).click(); await poll(() => device.updates.length === 2, 'Updater upgrade absent'); assert.equal(device.updates[0].targetRole, 'updater');
    await page.getByRole('button', { name: '人工核实并处理', exact: true }).click(); await dialog.locator('input[type="checkbox"]').check(); await dialog.getByRole('button', { name: '提交处理请求', exact: true }).click(); await poll(() => device.updates[0].status === 'committed', 'upgrade verification absent');
    await shot(page, '05-upgrade-transactions.png'); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '移除手机', exact: true }).click(); await page.getByText('还没有接入手机', { exact: true }).waitFor(); await page.getByRole('status').filter({ hasText: '已移除手机' }).waitFor(); assert.equal(fixture.state.devices.length, 0); await context.close();
  });
  await run('leaving page during screenshot preflight does not submit an upgrade', async () => {
    const fixture = createFixture(); const device = phone(); fixture.state.devices = [device]; fixture.state.screenshotStatus = 'queued'; const { page, context } = await open(fixture);
    await page.getByLabel('已发布安装包').selectOption('0.4.5-fixture-16'); await page.getByRole('button', { name: '检查并提交升级', exact: true }).click(); await poll(() => device.commands.some(row => row.action === 'screenshot'), 'preflight screenshot absent');
    await page.locator('.shell-home').click(); await poll(() => page.url().endsWith('/phone_ai/home'), 'navigation during preflight failed'); await sleep(750); assert.equal(device.updates.length, 0, 'upgrade submitted after leaving phone page'); assert.equal(fixture.state.calls.filter(call => call.method === 'POST' && call.path.endsWith('/updates')).length, 0, 'unexpected upgrade POST'); await context.close();
  });
  await run('390px layout, dialog scrolling and unavailable control service', async () => {
    const fixture = createFixture(); fixture.state.devices = [phone('phone-with-long-id-fixture-01234567890123456789', '窄屏验收手机 01234567890123456789')]; fixture.state.requests = [enrollment('mobile-request', '窄屏申请手机 01234567890123456789')];
    const { page, context } = await open(fixture, 390, 844);
    const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, terminal: document.querySelector('[data-testid="android-devices"]').scrollWidth, terminalWidth: document.querySelector('[data-testid="android-devices"]').clientWidth }));
    assert(overflow.document <= overflow.width + 1 && overflow.body <= overflow.width + 1, `horizontal page overflow ${JSON.stringify(overflow)}`);
    await shot(page, '06-narrow-phone-console.png'); await page.getByRole('button', { name: '登记手机', exact: true }).click(); await page.getByTestId('phone-alias').fill('窄屏手动登记'); await page.getByRole('button', { name: '登记并创建凭证', exact: true }).click(); await page.getByTestId('device-credentials').waitFor(); const close = page.getByRole('button', { name: '关闭凭证窗口', exact: true }); await close.scrollIntoViewIfNeeded(); await shot(page, '07-narrow-credential-modal-scroll.png'); await close.click();
    fixture.state.listFailure = true; await page.getByTestId('android-devices').getByRole('button', { name: '刷新', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '隔离模拟：控制服务暂时不可达' }).waitFor(); assert(await page.getByRole('button', { name: '请求截图', exact: true }).isDisabled(), 'actions remain enabled with stale data'); await context.close();
  });
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  evidence.mockRequests = fixtures.flatMap(fixture => fixture.state.calls);
  evidence.unexpectedRequests.push(...fixtures.flatMap(fixture => fixture.state.rejectedRequests.map(request => `${request.method} ${request.path}`)));
  evidence.passed = evidence.tests.every(test => test.passed) && !evidence.pageErrors.length && !evidence.consoleErrors.some(row => !row.expectedHttpFailure) && !evidence.unexpectedRequests.length;
  await writeFile(join(output, 'results.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: evidence.passed, tests: evidence.tests.map(({ name, passed }) => ({ name, passed })), consoleErrors: evidence.consoleErrors.length, pageErrors: evidence.pageErrors.length, output })}\n`);
  process.exitCode = evidence.passed ? 0 : 1;
}
