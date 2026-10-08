#!/usr/bin/env node
/** Build first. UI/API requests use dist/fixtures without a listener/backend.
 * --public-downloads also clicks the two real anonymous APK links and compares
 * bytes/SHA-256 with the real manifest. Chromium download requests can bypass
 * Playwright routing, so fixture-only mode deliberately does not click them. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_URL, INSTALL_URL, PUBLIC_ORIGIN, formatPackageSize, loadLatestAndroidRelease } from '../frontend/src/android-install.js';
import { createFixture, fixtureSession } from './fixtures/ziwei-terminal-ui.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (key, fallback) => { const at = process.argv.indexOf(key); return at < 0 ? fallback : process.argv[at + 1]; };
const dist = resolve(option('--dist', join(root, 'frontend/dist')));
const output = resolve(option('--output', join(root, '.local/android-install-evidence')));
const publicDownloads = process.argv.includes('--public-downloads');
const require = createRequire(import.meta.url);
function dependency(candidates) {
  for (const candidate of candidates.filter(Boolean)) { try { return require(candidate); } catch {} }
  throw new Error(`Missing verification dependency: ${candidates[0]}`);
}
const bundled = 'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = dependency([process.env.PLAYWRIGHT_MODULE, 'playwright', `${bundled}/playwright`]);
const sharp = dependency(['sharp', `${bundled}/sharp`]);
const jsqr = dependency(['jsqr', '../.local/qr-tools/node_modules/jsqr']);
await stat(join(dist, 'index.html'));
await mkdir(output, { recursive: true });
const evidence = { observedAt: new Date().toISOString(), mode: 'dist-with-intercepted-https-fixtures', publicDownloads, businessBackendStarted: false, listeningPorts: [], realDeviceActions: 0, tests: [], screenshots: [], pageErrors: [], consoleErrors: [], unexpectedRequests: [], requests: [], publicApks: [] };
const browser = await chromium.launch({ headless: true });
const contexts = [];
const hash = 'a'.repeat(64), signer = 'b'.repeat(64);
function release(code = 15, version = '0.4.4') {
  const dir = `/downloads/android/v${version}-code${code}`;
  return { versionCode: code, versionName: version, buildType: 'debug', manifest: `${dir}/manifest.json`, packages: Object.fromEntries(['agent', 'updater'].map(role => [role, { packageName: `com.ziwei.device.${role}`, file: `ziwei-${role}-debug.apk`, path: `${dir}/ziwei-${role}-debug.apk`, sha256: hash, signerSha256: signer }])) };
}
function manifest(item, roles = ['agent', 'updater']) {
  return { schemaVersion: 1, buildType: item.buildType, packages: roles.map(role => ({ role, ...item.packages[role], versionCode: item.versionCode, versionName: item.versionName, bytes: role === 'agent' ? 815470 : 815474 })) };
}
function state() { const latest = release(); return { releases: [release(7, '0.3.0'), latest, release(12, '0.4.0')], manifests: new Map([[15, manifest(latest)]]), indexStatus: 200, hold: null, releaseHold: null, requests: [] }; }
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
async function open(s = state(), options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1440, height: 1000 }, userAgent: options.userAgent, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  contexts.push(context);
  if (options.fixture) await context.addCookies([{ name: 'ziwei_session', value: fixtureSession, url: PUBLIC_ORIGIN, httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const record = { path: url.pathname, method: request.method(), cookie: Boolean(request.headers().cookie), kind: 'static' };
    s.requests.push(record); evidence.requests.push(record);
    try {
      if (url.origin !== PUBLIC_ORIGIN) { evidence.unexpectedRequests.push(request.url()); await route.abort(); return; }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/a2a/')) {
        record.kind = 'api';
        if (options.fixture) { await route.fulfill(await options.fixture.handle(request)); return; }
        if (url.pathname === '/api/auth/status' || url.pathname === '/api/auth/me') { await route.fulfill(json({ authenticated: false, setup_required: false })); return; }
        evidence.unexpectedRequests.push(url.pathname); await route.fulfill(json({ error: '请先登录' }, 401)); return;
      }
      if (url.pathname === '/downloads/android/index.json') {
        record.kind = 'release'; if (s.hold) { s.releaseHold = s.hold.resolve; await s.hold.promise; }
        await route.fulfill(json({ schemaVersion: 1, releases: s.releases }, s.indexStatus)); return;
      }
      if (url.pathname.startsWith('/downloads/android/')) {
        record.kind = 'release';
        const item = s.releases.find(row => row.manifest === url.pathname);
        if (item) { await route.fulfill(json(s.manifests.get(item.versionCode) || manifest(item))); return; }
        const pkg = s.releases.flatMap(row => Object.values(row.packages)).find(row => row.path === url.pathname);
        if (pkg) { await route.fulfill({ status: 200, contentType: 'application/vnd.android.package-archive', headers: { 'content-disposition': `attachment; filename="${pkg.file}"` }, body: Buffer.from(`PK\x03\x04isolated-${pkg.file}`) }); return; }
        throw new Error(`Unknown release path ${url.pathname}`);
      }
      let path = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if (path !== dist && !path.startsWith(`${dist}${sep}`)) throw new Error('Static traversal');
      if (!extname(path)) path = join(dist, 'index.html');
      await route.fulfill({ status: 200, contentType: mime[extname(path)] || 'application/octet-stream', body: await readFile(path) });
    } catch (error) { evidence.unexpectedRequests.push(error.message); await route.fulfill(json({ error: 'Fixture failed' }, 500)); }
  });
  await context.routeWebSocket('**/*', socket => { socket.send(JSON.stringify({ type: 'ready' })); socket.onMessage(() => {}); });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => evidence.pageErrors.push(error.stack));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push({ text: message.text(), expected: /Failed to load resource: the server responded with a status of 503/.test(message.text()) }); });
  await page.goto(options.url || INSTALL_URL, { waitUntil: 'domcontentloaded' });
  return { page, context, s };
}
async function run(name, action) {
  const start = Date.now();
  try { await action(); evidence.tests.push({ name, passed: true, durationMs: Date.now() - start }); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { evidence.tests.push({ name, passed: false, error: error.stack }); process.stderr.write(`FAIL ${name}: ${error.message}\n`); }
}
async function shot(page, filename) { const path = join(output, filename); await page.screenshot({ path, fullPage: true }); evidence.screenshots.push(path); }
async function ready(page) { await page.getByTestId('download-agent').waitFor(); }
async function layout(page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert(sizes.document <= sizes.width + 1 && sizes.body <= sizes.width + 1, `Overflow: ${JSON.stringify(sizes)}`);
  for (const selector of ['[data-testid="download-agent"]', '[data-testid="download-updater"]', '[data-testid="install-qr"]', '.install-address-box']) {
    const bounds = await page.locator(selector).boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= sizes.width + 1, `Clipped ${selector}`);
  }
  return sizes;
}
async function qr(page) {
  const bytes = await page.getByTestId('install-qr').screenshot();
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsqr(Uint8ClampedArray.from(data), info.width, info.height);
  assert.equal(decoded?.data, INSTALL_URL); evidence.qrDecoded = decoded.data;
}
try {
  await run('anonymous desktop: release links, copy, QR and optional real public APK downloads', async () => {
    let initial = state(), expected = release(), expectedManifest = manifest(expected);
    if (publicDownloads) {
      const options = { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) };
      const actual = await loadLatestAndroidRelease({ signal: AbortSignal.timeout(20000) }); assert(actual?.packages.agent && actual.packages.updater, 'Public release lacks both roles');
      const response = await fetch(`${PUBLIC_ORIGIN}/downloads/android/index.json`, options); assert(response.ok); const index = await response.json();
      expected = index.releases.find(row => row.versionCode === actual.versionCode); assert(expected, 'Publication changed during verification; retry');
      const manifestResponse = await fetch(new URL(expected.manifest, PUBLIC_ORIGIN), { ...options, signal: AbortSignal.timeout(15000) }); assert(manifestResponse.ok); expectedManifest = await manifestResponse.json();
      initial = state(); initial.releases = index.releases; initial.manifests = new Map([[expected.versionCode, expectedManifest]]);
    }
    const { page, context, s } = await open(initial); await ready(page);
    assert((await page.locator('.install-release').innerText()).includes(`v${expected.versionName}`));
    for (const role of ['agent', 'updater']) {
      const button = page.getByTestId(`download-${role}`);
      const pkg = expectedManifest.packages.find(item => item.role === role);
      assert.equal(await button.getAttribute('href'), new URL(expected.packages[role].path, PUBLIC_ORIGIN).href);
      assert((await page.getByTestId(`app-${role}`).innerText()).includes(formatPackageSize(pkg.bytes)));
      assert.equal(await button.getAttribute('download'), pkg.file);
      if (publicDownloads) {
        const event = page.waitForEvent('download', { timeout: 30000 }); await button.click(); const download = await event;
        assert.equal(download.suggestedFilename(), pkg.file); assert.equal(await download.failure(), null);
        const bytes = await readFile(await download.path()), sha256 = createHash('sha256').update(bytes).digest('hex');
        assert.equal(bytes.length, pkg.bytes, `Public ${role} byte length differs`); assert.equal(sha256, pkg.sha256, `Public ${role} SHA-256 differs`);
        evidence.publicApks.push({ role, href: await button.getAttribute('href'), versionCode: expected.versionCode, bytes: bytes.length, sha256, passed: true });
      }
    }
    await page.getByTestId('copy-control-url').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), CONTROL_URL);
    assert(await page.getByText('两个应用填写相同手机名，分别点“申请入网权限”。', { exact: true }).isVisible());
    await qr(page); evidence.desktopLayout = await layout(page);
    assert.equal(s.requests.filter(row => row.kind === 'api').length, 0, 'Public page queried authentication/workspace APIs');
    assert(s.requests.filter(row => row.kind === 'release').every(row => !row.cookie));
    await shot(page, '01-install-desktop.png'); await context.close();
  });
  await run('390px reduced Android Chrome: both links, full content and QR remain usable', async () => {
    const { page, context } = await open(state(), { width: 390, userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36' });
    await ready(page); assert.equal(await page.getByTestId('platform-not-supported').count(), 0);
    evidence.mobileLayout = await layout(page); await qr(page); await shot(page, '02-install-390px.png'); await context.close();
  });
  await run('later publication replaces download versions and URLs without a build', async () => {
    const s = state(); const { page, context } = await open(s); await ready(page);
    const next = release(21, '0.5.2'); s.releases.splice(1, 0, next); s.manifests.set(21, manifest(next));
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
    assert.match(await page.locator('.install-release').innerText(), /v0\.5\.2.*21/);
    assert.equal(await page.getByTestId('download-updater').getAttribute('href'), `${PUBLIC_ORIGIN}${next.packages.updater.path}`); await context.close();
  });
  await run('loading, failed index retry, empty publication and role missing', async () => {
    const s = state(); let resolveHold; const promise = new Promise(resolve => { resolveHold = resolve; }); s.hold = { promise, resolve: resolveHold };
    const { page, context } = await open(s); await page.getByTestId('release-loading').waitFor(); assert.equal(await page.locator('a.install-download-button').count(), 0);
    s.indexStatus = 503; s.hold = null; resolveHold(); await page.getByTestId('release-error').waitFor();
    s.indexStatus = 200; await page.getByRole('button', { name: '重新加载' }).click(); await ready(page);
    s.releases = []; await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByTestId('release-empty').waitFor();
    s.releases = [release()]; s.manifests.set(15, manifest(release(), ['agent'])); await page.getByRole('button', { name: '刷新发布' }).click(); await ready(page);
    assert.equal(await page.getByTestId('download-updater').count(), 0); assert(await page.getByTestId('app-updater').getByRole('button').isDisabled()); await shot(page, '03-role-missing.png'); await context.close();
  });
  await run('iOS cannot download APK; safe return context and trailing slash work', async () => {
    const { page, context } = await open(state(), { width: 390, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', url: `${INSTALL_URL}/?workspace=https://evil.example` });
    await page.getByTestId('app-agent').waitFor(); await page.getByTestId('platform-not-supported').waitFor();
    assert.equal(await page.locator('a.install-download-button').count(), 0); assert.equal(await page.locator('.install-return').getAttribute('href'), `${PUBLIC_ORIGIN}/phone_ai/ziwei-connect`); await qr(page); await context.close();
  });
  await run('clipboard denial preserves application instructions and selects address', async () => {
    const { page, context } = await open(); await ready(page);
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }));
    await page.getByTestId('copy-control-url').click(); await page.getByText(/浏览器未允许复制/).waitFor();
    assert(await page.getByText('两个应用填写相同手机名，分别点“申请入网权限”。', { exact: true }).isVisible());
    assert.equal(await page.getByLabel('HTTPS 中控根地址', { exact: true }).evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd)), CONTROL_URL); await context.close();
  });
  await run('unsafe manifest gives retryable error without download links', async () => {
    const s = state(); s.releases[1].manifest = 'https://evil.example/manifest.json';
    const { page, context } = await open(s); await page.getByTestId('release-error').waitFor(); assert.equal(await page.locator('a.install-download-button').count(), 0); assert.match(await page.getByTestId('release-error').innerText(), /安全校验/); await context.close();
  });
  await run('public exception does not bypass login on main or similarly named routes', async () => {
    for (const path of ['/phone_ai/ziwei-connect', '/android-install-evil', '/phone_ai/android-install']) {
      const { page, context } = await open(state(), { url: `${PUBLIC_ORIGIN}${path}` });
      await page.getByRole('heading', { name: '登录紫薇', exact: true }).waitFor(); assert.equal(await page.getByTestId('android-install-page').count(), 0); await context.close();
    }
  });
  await run('authenticated terminal entry links to public installation and returns to same workspace', async () => {
    const fixture = createFixture(); const { page, context } = await open(state(), { fixture, url: `${PUBLIC_ORIGIN}/phone_ai/ziwei-connect` });
    await page.getByTestId('android-devices').waitFor(); const entry = page.getByRole('link', { name: '安装手机端', exact: true });
    assert.equal(await entry.getAttribute('href'), `${INSTALL_URL}?workspace=phone_ai`); await shot(page, '04-terminal-install-entry.png');
    await entry.click(); await ready(page); assert.equal(page.url(), `${INSTALL_URL}?workspace=phone_ai`);
    await page.locator('.install-return').click(); await page.getByTestId('android-devices').waitFor(); assert.equal(page.url(), `${PUBLIC_ORIGIN}/phone_ai/ziwei-connect`);
    assert.equal(fixture.state.rejectedRequests.length, 0); await context.close();
  });
} finally {
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close();
  evidence.passed = evidence.tests.every(row => row.passed) && !evidence.pageErrors.length && !evidence.unexpectedRequests.length && !evidence.consoleErrors.some(row => !row.expected);
  await writeFile(join(output, 'results.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: evidence.passed, tests: evidence.tests.map(({ name, passed }) => ({ name, passed })), pageErrors: evidence.pageErrors, unexpectedRequests: evidence.unexpectedRequests, unexpectedConsole: evidence.consoleErrors.filter(row => !row.expected), output })}\n`);
  process.exitCode = evidence.passed ? 0 : 1;
}
