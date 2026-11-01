// Actual Express/session/repository/object-store paths, intercepted without an HTTP listener.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import { createApp } from '../../backend/app.mjs';
import { createMixedGroupStore } from '../../backend/mixed-group-store.mjs';
import { rasterFixtures } from '../../test/fixtures/raster-images.mjs';
import { ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENT_BYTES } from '../../src/conversation-attachment-policy.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url))), web = path.join(root, 'mobile-manager/web'), out = path.join(root, '.local/mobile-attachment-qa');
await fs.mkdir(out, { recursive: true });
const origin = 'https://mobile-attachment.invalid', slug = 'attachment-browser', deviceId = 'attachment-fixture-pc';
const originalFetch = globalThis.fetch, externalRequests = [];
globalThis.fetch = async (url, options = {}) => { externalRequests.push({ url: String(url), method: options.method || 'GET' }); throw new Error('External network disabled in attachment fixture'); };
const app = createApp({ memory: true, requireAuth: true, enableScheduler: false, objectStoreDir: path.join(out, 'objects') }), repo = app.locals.repo;
const principal = app.locals.auth.setup({ name: '附件隔离验收', email: 'attachment-owner@fixture.test', password: 'fixture-private-password' });
app.locals.auth.createWorkspace(principal.user_id, { slug, name: '附件隔离工作区', kind: 'team' });
const cookie = `ziwei_session=${principal.session.token}`;
repo.heartbeatDevice(slug, { deviceId, name: '隔离执行电脑', ownerUserId: principal.user_id, runtimes: { Codex: { status: 'available', version: 'fixture', profiles: [{ name: 'default', provider_configured: true, authentication_configured: true }], readiness: { ready: true, authentication: 'configured', provider: 'configured' } } } });
const employee = repo.createEmployee(slug, { name: '原附件员工', runtime: 'Codex', runtimeProfile: 'default', targetDeviceId: deviceId, ownerUserId: principal.user_id, visibility: 'workspace' });
const conversation = repo.createConversation(slug, { employeeId: employee.id, title: '原附件长期聊天' });
const actor = { actorUserId: principal.user_id, actorRole: 'owner', enforceEmployeeVisibility: true };
const requests = [], errors = [], screenshots = [], checks = [];
let loseFirstChunkReceipt = true, lostReceipts = 0;
let holdNextGroupPut = false, releaseGroupPut;
const groupPutHeld = new Promise(resolve => { releaseGroupPut = { started: resolve }; });
const inputBytes = Buffer.alloc(9 * 1024 * 1024, 0x5a); inputBytes.write('ORIGINAL-ATTACHMENT-FIXTURE', 0); inputBytes.write('END-OF-ORIGINAL', inputBytes.length - 15);
const inputSha256 = createHash('sha256').update(inputBytes).digest('hex');

async function inMemoryAppResponse(browserRequest) {
  const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
  const request = new IncomingMessage(socket), response = new ServerResponse(request), payload = browserRequest.postDataBuffer();
  const url = new URL(browserRequest.url()), incoming = browserRequest.headers();
  request.method = browserRequest.method(); request.url = url.pathname + url.search;
  request.headers = { host: 'mobile-attachment.invalid', cookie, ...(incoming['content-type'] ? { 'content-type': incoming['content-type'] } : {}), ...(payload ? { 'content-length': String(payload.length) } : {}), ...(incoming['idempotency-key'] ? { 'idempotency-key': incoming['idempotency-key'] } : {}) };
  const chunks = [];
  const pending = new Promise((resolve, reject) => {
    response.write = (chunk, encoding, callback) => { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined)); if (typeof encoding === 'function') encoding(); else callback?.(); return true; };
    response.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
      if (typeof encoding === 'function') encoding(); else callback?.();
      resolve({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.getHeaders()).map(([name, value]) => [name, String(value)])), body: Buffer.concat(chunks) });
      response.emit('finish'); return response;
    };
    response.on('error', reject); request.on('error', reject);
    app.handle(request, response, error => reject(error || new Error(`Unhandled ${request.method} ${request.url}`)));
  });
  request.push(payload || null); if (payload) request.push(null);
  try { return await pending; } finally { socket.destroy(); }
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.ZIWEI_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(({ userId, workspace }) => localStorage.setItem(`ziwei.mobile.workspace:${userId}`, workspace), { userId: principal.user_id, workspace: slug });
// Headless Chrome may cancel an anchor download from an intercepted HTTPS
// origin before issuing HTTP. This controlled save sink still follows the
// exact App-created URL through the real authorized Express download route.
await page.addInitScript(() => {
  window.__attachmentDownloadSink = [];
  const original = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && /^\/api\/conversations\/[^/]+\/attachments\/[^/]+$/.test(new URL(this.href).pathname)) {
      const row = { url: this.href, name: this.download }; window.__attachmentDownloadSink.push(row);
      void fetch(this.href, { credentials: 'include' }).then(async response => {
        if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
        const bytes = await response.arrayBuffer(); row.bytes = bytes.byteLength;
        row.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      }).catch(error => { row.error = error.message; });
      return;
    }
    return original.call(this);
  };
});
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()), p = url.pathname, method = request.method();
  if (url.origin !== origin) { errors.push(`Unexpected external browser request ${url.origin}${p}`); return route.abort(); }
  if (p.startsWith('/__ziwei_manager__/')) {
    const asset = p.slice('/__ziwei_manager__/'.length) || 'index.html'; assert.match(asset, /^[a-z-]+\.(html|m?js|css|png)$/);
    return route.fulfill({ contentType: /\.m?js$/.test(asset) ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.png') ? 'image/png' : 'text/html', body: await fs.readFile(path.join(web, asset)) });
  }
  const binary = request.headers()['content-type'] === 'application/octet-stream', payload = request.postDataBuffer();
  const entry = { method, path: p, query: url.search, bytes: payload?.length || 0, ...(binary ? { offset: Number(url.searchParams.get('offset')) } : payload ? { json: request.postDataJSON() } : {}) }; requests.push(entry);
  try {
    const result = await inMemoryAppResponse(request); entry.status = result.status;
    if (loseFirstChunkReceipt && binary && method === 'PUT') {
      assert.equal(result.status, 200); assert.equal(entry.bytes, ATTACHMENT_CHUNK_BYTES);
      loseFirstChunkReceipt = false; lostReceipts++; entry.receiptLostAfterCommit = true; return route.abort('failed');
    }
    if (holdNextGroupPut && binary && method === 'PUT') {
      holdNextGroupPut = false; releaseGroupPut.started();
      await new Promise(resolve => { releaseGroupPut.finish = resolve; });
    }
    return route.fulfill(result);
  } catch (error) { errors.push(error.stack || error.message); return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: error.message }) }); }
});
const click = (action, id) => page.locator(`[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}`).first().click();
const capture = async name => { await page.screenshot({ path: path.join(out, `${name}.png`) }); screenshots.push(name); };
const sends = () => requests.filter(request => request.method === 'POST' && request.path.endsWith('/messages'));
try {
  await page.goto(`${origin}/__ziwei_manager__/index.html`); await page.locator(`[data-action=chat][data-id="${employee.id}"]`).waitFor(); await click('chat', employee.id);
  await page.locator('[name=draft]').fill('上传失败或重试都保留这段草稿');
  await page.locator('input[name=images]').setInputFiles({ name: '原始资料-9MiB.bin', mimeType: 'application/octet-stream', buffer: inputBytes });
  await page.locator('[data-action=attachment-retry]').waitFor();
  assert.equal(lostReceipts, 1); assert.equal(sends().length, 0); assert.equal(await page.locator('[name=draft]').inputValue(), '上传失败或重试都保留这段草稿');
  assert.equal(await page.getByRole('button', { name: '发送消息', exact: true }).isDisabled(), true);
  const failedPut = requests.find(request => request.receiptLostAfterCommit), uploadId = failedPut.path.split('/').at(-1);
  assert.equal(repo.db.prepare('SELECT offset FROM conversation_attachment_uploads WHERE id=?').get(uploadId).offset, ATTACHMENT_CHUNK_BYTES);
  assert.deepEqual(requests.filter(request => request.method === 'PUT').map(request => request.offset), [0]); await capture('01-lost-chunk-receipt');
  await click('attachment-retry'); await page.getByText(/9 MiB · 已上传/).waitFor();
  assert.deepEqual(requests.filter(request => request.method === 'PUT').map(request => [request.offset, request.bytes]), [[0, ATTACHMENT_CHUNK_BYTES], [ATTACHMENT_CHUNK_BYTES, 1024 * 1024]]);
  assert.equal(requests.filter(request => request.method === 'GET' && request.path.endsWith(`/uploads/${uploadId}`)).length, 1);
  assert.equal(await page.locator('[name=draft]').inputValue(), '上传失败或重试都保留这段草稿');
  checks.push('9 MiB real File crosses actual Express upload routes and filesystem store; lost first 8 MiB committed receipt becomes visible failure; only explicit retry GETs original offset and uploads remaining 1 MiB; draft retained');
  await page.locator('[data-form=chat]').evaluate(form => form.requestSubmit()); await page.waitForFunction(() => document.querySelector('[name=draft]')?.value === '');
  const sent = sends()[0], ref = sent.json.attachments[0]; assert(sent.bytes < 2048); assert.equal(ref.size, inputBytes.length); assert.equal(ref.sha256, inputSha256);
  assert.deepEqual(Object.keys(ref).sort(), ['attachmentId', 'mimeType', 'name', 'sha256', 'size']);
  const storedMessage = repo.db.prepare("SELECT attachment_json FROM conversation_messages WHERE conversation_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(conversation.id); assert.deepEqual(JSON.parse(storedMessage.attachment_json), [ref]);
  await click('attachment-download', ref.attachmentId);
  await page.waitForFunction(() => window.__attachmentDownloadSink[0]?.sha256 || window.__attachmentDownloadSink[0]?.error);
  const downloaded = await page.evaluate(() => window.__attachmentDownloadSink[0]); assert.equal(downloaded.error, undefined); assert.equal(downloaded.bytes, inputBytes.length); assert.equal(downloaded.sha256, inputSha256);
  assert.equal(downloaded.name, '原始资料-9MiB.bin'); assert.equal(new URL(downloaded.url).pathname, `/api/conversations/${conversation.id}/attachments/${ref.attachmentId}`); await capture('02-reference-download');
  checks.push('sent message and saved SQLite attachment_json contain only a bounded five-field reference; the download button emits the authorized path and a controlled browser save sink receives all original 9 MiB bytes and matching SHA-256 through the real Express route');
  const firstAction = repo.getConversation(conversation.id, actor).execution; repo.ackA2AAction(firstAction.id, { deviceId }); repo.resultA2AAction(firstAction.id, { deviceId, status: 'succeeded', result: { output: '隔离回执：已核对附件引用。' } });
  await page.evaluate(() => window.dispatchEvent(new Event('ziwei:resume')));
  await page.locator('input[name=images]').setInputFiles({ name: '原始小图.png', mimeType: 'image/png', buffer: rasterFixtures.png }); await page.getByText(/已上传/).last().waitFor();
  await page.locator('[name=draft]').fill('保留原图并显示预览'); await page.locator('[data-form=chat]').evaluate(form => form.requestSubmit()); await page.waitForFunction(() => document.querySelector('[name=draft]')?.value === '');
  const photoRef = sends().at(-1).json.attachments[0]; assert.equal(photoRef.size, rasterFixtures.png.length);
  const image = page.locator(`.message-image img[src*="${photoRef.attachmentId}"]`); await image.waitFor(); await image.evaluate(node => node.decode()); assert(await image.evaluate(node => node.naturalWidth > 0));
  await image.click(); await page.locator('.image-overlay img').evaluate(node => node.decode()); await click('close-image'); await capture('03-authorized-image-preview');
  checks.push('small raster File uses the same upload/reference flow; its authorized image route decodes in message and in-app preview');
  const countBeforeOversize = requests.length; await page.locator('[name=draft]').fill('超限时仍保留的草稿');
  await page.evaluate(maximum => {
    const file = new File(['x'], '声明超限.bin', { type: 'application/octet-stream' }); Object.defineProperty(file, 'size', { value: maximum + 1 });
    window.__oversizeSlices = 0; file.slice = () => { window.__oversizeSlices++; throw new Error('Oversized file must be rejected before slicing'); };
    const input = document.querySelector('input[name=images]'); Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, MAX_ATTACHMENT_BYTES);
  await page.getByText('每个附件须大于 0，且不能超过 500 MiB', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__oversizeSlices), 0); assert.equal(await page.locator('[name=draft]').inputValue(), '超限时仍保留的草稿');
  assert(!requests.slice(countBeforeOversize).some(request => request.method === 'PUT' || request.path.includes('/attachments/uploads')));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await capture('04-oversize-metadata-rejected');
  checks.push('a one-byte File with declared size 500 MiB + 1 is rejected before slicing or network upload without allocating a giant file; existing text draft remains');
  const photoAction = repo.getConversation(conversation.id, actor).execution;
  repo.ackA2AAction(photoAction.id, { deviceId }); repo.resultA2AAction(photoAction.id, { deviceId, status: 'succeeded', result: { output: '隔离回执：原小图引用已核对。' } });
  repo.heartbeatDevice(slug, { deviceId, ownerUserId: principal.user_id, runtimes: { Codex: { status: 'available', profiles: [{ name: 'default' }, { name: 'group-peer' }] } } });
  const peer = repo.createEmployee(slug, { name: '群附件伙伴', runtime: 'Codex', runtimeProfile: 'group-peer', targetDeviceId: deviceId, ownerUserId: principal.user_id, visibility: 'workspace' });
  const peerConversation = repo.createConversation(slug, { employeeId: peer.id, title: '群附件伙伴会话' });
  createMixedGroupStore(repo).create(slug, { id: 'mix_ui', title: '手机附件群聊', members: [
    { employeeId: employee.id, name: employee.name, runtime: 'Codex', profile: 'default', deviceId, conversationId: conversation.id },
    { employeeId: peer.id, name: peer.name, runtime: 'Codex', profile: 'group-peer', deviceId, conversationId: peerConversation.id },
  ] });
  await click('back'); await click('groups-open'); await click('workspace-group-open', 'mix_ui'); await page.setViewportSize({ width: 320, height: 844 });
  await page.locator('[name=workspaceGroupContent]').fill('请两位成员核对这份群附件');
  const groupBytes = Buffer.from('原始群附件字节\nGroup attachment original bytes.');
  holdNextGroupPut = true; await page.locator('input[name=workspaceGroupFiles]').setInputFiles({ name: '群聊附件-真实字节.txt', mimeType: 'text/plain', buffer: groupBytes });
  await groupPutHeld; await page.locator('[data-group-attachment] progress').waitFor();
  assert.equal(await page.locator('[data-action=workspace-group-send]').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await capture('05-group-upload-progress-320');
  releaseGroupPut.finish(); await page.locator('[data-group-attachment]').getByText(/已上传/).waitFor();
  assert.equal(await page.locator('[name=workspaceGroupContent]').inputValue(), '请两位成员核对这份群附件');
  await click('workspace-group-send'); await page.waitForFunction(() => document.querySelector('[name=workspaceGroupContent]')?.value === '');
  const groupSend = requests.find(request => request.method === 'POST' && request.path === `/api/workspaces/${slug}/mixed-groups/mix_ui/messages`);
  assert.equal(groupSend.status, 202); assert(groupSend.bytes < 2048); assert.equal(groupSend.json.attachments.length, 1); assert.equal(groupSend.json.attachments[0].size, groupBytes.length);
  await page.locator('[data-action=workspace-group-attachment-download]').waitFor(); await click('workspace-group-attachment-download');
  await page.waitForFunction(() => window.__attachmentDownloadSink[1]?.sha256 || window.__attachmentDownloadSink[1]?.error);
  const groupDownload = await page.evaluate(() => window.__attachmentDownloadSink[1]); assert.equal(groupDownload.error, undefined); assert.equal(groupDownload.bytes, groupBytes.length); assert.equal(groupDownload.sha256, createHash('sha256').update(groupBytes).digest('hex'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert(await page.locator('.workspace-group-compose').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight + 1)); await capture('06-group-reference-download-320');
  checks.push('320px real mixed-group UI shows a held upload progress chip, keeps the text draft, sends a small reference request and renders the saved download row; authorized group file bytes match through the controlled save sink without any model execution');
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  const result = { passed: true, checks, screenshots, inputBytes: inputBytes.length, inputSha256, chunkPuts: requests.filter(request => request.method === 'PUT').map(({ offset, bytes, receiptLostAfterCommit }) => ({ offset, bytes, ...(receiptLostAfterCommit ? { receiptLostAfterCommit } : {}) })), lostReceipts, sentBodyBytes: sends().map(request => request.bytes), requests: requests.length, externalRequests: 0, localListeners: 0, realDeviceActions: 0, externalModelCalls: 0, evidence: 'Real createApp auth/role/Express routes, in-memory SQLite and local object store; browser request interception only. Device execution result is synthetic. Download sink validates App URL and authorized bytes, not Chrome save UI or Android SAF acceptance.' };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} catch (error) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ error: error.stack, errors, requests, body: await page.locator('body').innerText() }, null, 2)); throw error; }
finally { await browser.close(); repo.db.close(); globalThis.fetch = originalFetch; }
