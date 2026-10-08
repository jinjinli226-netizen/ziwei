#!/usr/bin/env node
/**
 * Read-only production browser acceptance. Never creates devices or commands.
 * Usage: node scripts/verify-ziwei-terminal-live.mjs --session-file .local/session.json
 * The session file is provisioned separately and must never be committed.
 * Screenshots mask account details; evidence records counts/statuses, not bodies.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback = '') => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const sessionFile = option('--session-file');
if (!sessionFile) throw new Error('--session-file is required; provision an expiring main-site Owner session separately.');
const session = JSON.parse(await readFile(resolve(sessionFile), 'utf8'));
if (typeof session.token !== 'string' || !session.token || session.workspace !== 'phone_ai') throw new Error('Session file must contain token and workspace phone_ai.');
const expiresAt = typeof session.expiresAt === 'number' ? session.expiresAt : Date.parse(session.expiresAt);
if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Acceptance session is missing an expiry or has already expired.');
const base = option('--base', 'https://qzelynth.top').replace(/\/$/, '');
const origin = new URL(base);
if (origin.protocol !== 'https:' || origin.pathname !== '/') throw new Error('Production acceptance requires an HTTPS root origin.');
const output = resolve(option('--output', join(root, '.local/terminal-live-evidence')));
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch {}
}
if (!playwright) throw new Error('Preinstalled Playwright unavailable; set PLAYWRIGHT_MODULE.');
const evidence = { mode: 'production-readonly-headless', observedAt: new Date().toISOString(), origin: origin.origin, workspace: session.workspace, session: 'temporary-main-site-owner-cookie', realDeviceActions: 0, mutationsBlocked: [], probes: [], tests: [], screenshots: [], pageErrors: [], consoleErrors: [], requestFailures: [] };
const scrub = value => String(value).replaceAll(session.token, '[REDACTED]').replace(/ziwei_session=[^;\s]+/g, 'ziwei_session=[REDACTED]').slice(0, 2500);
const endpoint = value => { try { return new URL(value).pathname; } catch { return '[invalid-url]'; } };
const browser = await playwright.chromium.launch({ headless: true });
const terminalPath = `/api/workspaces/${encodeURIComponent(session.workspace)}/ziwei-connect/terminal/android-devices`;
async function run(name, callback) {
  const startedAt = Date.now();
  try { await callback(); evidence.tests.push({ name, passed: true, durationMs: Date.now() - startedAt }); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { evidence.tests.push({ name, passed: false, durationMs: Date.now() - startedAt, error: scrub(error.message) }); process.stderr.write(`FAIL ${name}: ${scrub(error.message)}\n`); }
}
async function poll(check, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(message);
}
async function probe(context, path, expectedStatus, countKey = '') {
  const response = await context.request.get(`${base}${path}`, { timeout: 15000, failOnStatusCode: false });
  const result = { endpoint: path.split('?')[0], status: response.status(), expectedStatus };
  if (countKey && response.ok()) { const data = await response.json(); result.count = Array.isArray(data[countKey]) ? data[countKey].length : null; }
  evidence.probes.push(result);
  assert.equal(response.status(), expectedStatus, `GET ${result.endpoint} returned ${response.status()}`);
  if (countKey) assert.notEqual(result.count, null, `GET ${result.endpoint} has no ${countKey} array`);
  return result;
}
async function authenticatedContext(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: false });
  await context.addCookies([{ name: 'ziwei_session', value: session.token, url: origin.origin, expires: Math.floor(expiresAt / 1000), httpOnly: true, secure: true, sameSite: 'Lax' }]);
  await context.route('**/*', async route => {
    const request = route.request(); const method = request.method();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      evidence.mutationsBlocked.push({ method, endpoint: endpoint(request.url()) });
      await route.abort('blockedbyclient'); return;
    }
    await route.continue();
  });
  return context;
}
async function capture(page, filename) {
  const path = join(output, filename);
  await page.screenshot({ path, fullPage: true, mask: [page.locator('.sidebar-account')], maskColor: '#edf3fa' });
  evidence.screenshots.push(path);
}
function observe(page) {
  page.on('pageerror', error => evidence.pageErrors.push(scrub(error.message)));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push({ text: scrub(message.text()), endpoint: endpoint(message.location().url) }); });
  page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') evidence.requestFailures.push({ endpoint: endpoint(request.url()), error: scrub(request.failure()?.errorText || 'failed') }); });
}
try {
  await run('anonymous main proxy requires main-site login', async () => {
    const context = await browser.newContext();
    try { await probe(context, `${terminalPath}?summary=1`, 401); await probe(context, `${terminalPath}/enrollment-requests`, 401); }
    finally { await context.close(); }
  });
  await run('Owner main cookie reads terminal and enrollment without source login', async () => {
    const context = await authenticatedContext(1440, 1000);
    try {
      await probe(context, `${terminalPath}?summary=1`, 200, 'devices');
      await probe(context, `${terminalPath}/enrollment-requests`, 200, 'requests');
      await probe(context, '/api/android-devices?summary=1', 401);
    } finally { await context.close(); }
  });
  for (const viewport of [{ width: 1440, height: 1000, label: 'desktop' }, { width: 390, height: 844, label: 'narrow' }]) {
    await run(`${viewport.label} terminal page, approval empty state, modal and navigation`, async () => {
      const context = await authenticatedContext(viewport.width, viewport.height); const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page);
      try {
        const response = await page.goto(`${base}/${session.workspace}/ziwei-connect`, { waitUntil: 'networkidle', timeout: 30000 });
        assert.equal(response.status(), 200);
        await page.getByTestId('android-devices').waitFor(); await page.getByTestId('enrollment-requests').waitFor();
        await page.getByTestId('enrollment-empty').waitFor(); await page.getByText('还没有接入手机', { exact: true }).waitFor();
        const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert(overflow.document <= overflow.viewport + 1 && overflow.body <= overflow.viewport + 1, `page horizontal overflow ${JSON.stringify(overflow)}`);
        evidence.tests.push({ name: `${viewport.label} widths`, passed: true, measurements: overflow });
        await capture(page, `terminal-${viewport.label}.png`);
        const register = page.getByTestId('register-phone'); const previousOverflow = await page.evaluate(() => document.body.style.overflow);
        await register.click(); let dialog = page.getByRole('dialog', { name: '登记手机', exact: true }); await dialog.waitFor();
        await dialog.getByTestId('phone-alias').fill('只读验收，不提交');
        assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'modal did not lock background scroll');
        await capture(page, `register-modal-${viewport.label}.png`);
        await page.keyboard.press('Escape'); await poll(async () => await page.getByRole('dialog').count() === 0, 'Escape did not close register modal');
        assert.equal(await page.evaluate(() => document.body.style.overflow), previousOverflow, 'modal did not restore scroll');
        assert.equal(await register.evaluate(element => document.activeElement === element), true, 'modal did not restore trigger focus');
        await register.click(); dialog = page.getByRole('dialog', { name: '登记手机', exact: true }); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await poll(async () => await page.getByRole('dialog').count() === 0, 'close button did not close register modal');
        const navigation = page.getByRole('complementary', { name: '工作区导航' });
        // The existing narrow sidebar hides its text spans; locate their real
        // parent buttons by DOM text and click the visible icon buttons.
        await navigation.getByRole('button').filter({ hasText: /^团队管理$/ }).click(); await poll(() => page.url().endsWith(`/${session.workspace}/members`), 'members navigation failed');
        await navigation.getByRole('button').filter({ hasText: /^紫薇·互联$/ }).click(); await page.getByTestId('android-devices').waitFor(); await page.getByTestId('enrollment-empty').waitFor();
        await capture(page, `terminal-return-${viewport.label}.png`);
      } catch (error) { await capture(page, `failure-${viewport.label}.png`).catch(() => {}); throw error; }
      finally { await context.close(); }
    });
  }
} finally {
  await browser.close();
  evidence.passed = evidence.tests.every(test => test.passed) && !evidence.pageErrors.length && !evidence.consoleErrors.length && !evidence.requestFailures.length && !evidence.mutationsBlocked.length;
  await writeFile(join(output, 'results.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: evidence.passed, tests: evidence.tests.map(({ name, passed }) => ({ name, passed })), probes: evidence.probes, realDeviceActions: 0, blockedWrites: evidence.mutationsBlocked.length, pageErrors: evidence.pageErrors.length, consoleErrors: evidence.consoleErrors.length, requestFailures: evidence.requestFailures.length, output })}\n`);
  process.exitCode = evidence.passed ? 0 : 1;
}
