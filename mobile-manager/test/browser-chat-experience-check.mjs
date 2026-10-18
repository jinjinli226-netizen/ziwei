// UI integration only: synthetic route fixtures, no HTTP listener, credentials,
// native keyboard claim, weak-network claim or production/business mutations.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/zhangjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readCursorsOnly = process.env.ZIWEI_CHAT_UI_SCENARIO === 'read-cursors';
const web = path.join(root, 'mobile-manager/web'), out = path.join(root, `.local/mobile-manager-chat-experience${readCursorsOnly ? '-read-cursors' : ''}-qa`);
await fs.mkdir(out, { recursive: true });
const assetNames = ['app.js', 'controller.js', 'view.js', 'styles.css', 'chat-search.js', 'chat-preferences.js', 'chat-inbox.js'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(assetNames.map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(web, name))).digest('hex')])));
const sourceBefore = await sourceHashes();
const origin = 'https://ziwei-chat-experience.invalid', slug = 'chat-ui-fixture', userId = 'chat-ui-user';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const literal = '<script>window.__searchExecuted=1</script> .*+?^${}()|[]\\';
const employees = [
  { id: 'employee-first', name: '第一位员工', runtime: 'Codex', status: 'active', main_conversation_id: 'chat-first' },
  { id: 'employee-second', name: '第二位员工', runtime: 'Codex', status: 'active', main_conversation_id: 'chat-second' },
];
const date = index => new Date(Date.UTC(2026, 9, 17, 1, index)).toISOString();
const row = (id, content, index = 0, extra = {}) => ({ id, content, role: 'assistant', created_at: date(index), ...extra });
const baseMessages = Array.from({ length: 45 }, (_, i) => row(`message-${i}`, `第 ${i} 条工作记录。${'较长正文用于确认聊天历史可滚动与原消息位置。'.repeat(4)}`, i));
baseMessages[8] = row('ordinary-target', `普通定位目标 独立标记 ${literal}`, 8);
baseMessages[20] = row('forward-parent', '隐藏包装文案', 20, { role: 'user', type: 'forward', forward: { schemaVersion: 1, source: { employeeName: '原员工' }, messages: Array.from({ length: 20 }, (_, index) => ({ sourceMessageId: `source-${index}`, role: index % 2 ? 'user' : 'assistant', senderName: `成员${index}`, createdAt: date(index), content: index === 14 ? `转发定位目标 第十四条 ${literal}` : `转发条目${index} ${'群内已保存原文，不派发真实工作。'.repeat(15)}`, attachments: [] })) } });
baseMessages[35] = row('image-parent', '原图与DOM保留标记', 35, { attachments: [{ name: 'original.png', mimeType: 'image/png', contentEncoding: 'base64', content: png }] });
const requests = [], errors = [], checks = [], screenshots = [], sessions = [];
const browser = await chromium.launch({ executablePath: process.env.ZIWEI_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let activePage;
const raf = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const capture = async (page, name) => { await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }); screenshots.push(name); };
const click = (page, action, id) => page.locator(`[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}`).first().click();

async function fixture(name, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push({ scenario: name, message: error.message }));
  const control = { messages: structuredClone(baseMessages), holdNextRead: false, held: [], readWrites: [] };
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  const chats = () => employees.map((employee, i) => ({ conversationId: employee.main_conversation_id, employeeId: employee.id, employee, title: `${employee.name}的聊天`, preview: i ? '较新的消息' : '旧消息', updatedAt: i ? date(59) : date(1), unreadCount: 1, latestMessageId: i ? 'second-message' : control.messages.at(-1).id, messageCount: i ? 1 : control.messages.length }));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname, method = request.method();
    if (url.origin !== origin) { errors.push({ scenario: name, message: `External request ${url.origin}${p}` }); return route.abort(); }
    if (p.startsWith('/__ziwei_manager__/')) {
      const asset = p.slice('/__ziwei_manager__/'.length) || 'index.html';
      if (!/^[a-z-]+\.(html|m?js|css|png)$/.test(asset)) return route.abort();
      return route.fulfill({ contentType: /\.m?js$/.test(asset) ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.png') ? 'image/png' : 'text/html', body: await fs.readFile(path.join(web, asset)) });
    }
    requests.push({ scenario: name, method, path: p });
    if (/^\/api\/conversations\/[^/]+\/read$/.test(p) && method === 'POST') {
      const body = request.postDataJSON(); control.readWrites.push(body);
      const answer = () => json(route, { conversationId: p.split('/')[3], lastReadMessageId: body.messageId, unreadCount: 0 });
      if (control.holdNextRead) { control.holdNextRead = false; control.held.push(answer); return; }
      return answer();
    }
    if (method !== 'GET') { errors.push({ scenario: name, message: `Unexpected business mutation ${method} ${p}` }); return json(route, { error: 'No business writes in UI QA' }, 405); }
    if (p === '/api/auth/me') return json(route, { user_id: userId, user: { id: userId, name: '隔离体验验收' }, memberships: [{ slug, name: '隔离体验验收', role: 'owner' }] });
    if (p === '/api/workspaces') return json(route, { workspaces: [{ slug, name: '隔离体验验收', role: 'owner' }] });
    const base = `/api/workspaces/${slug}`;
    if (p === `${base}/chats`) return json(route, { chats: chats(), unreadCount: 2 });
    if (p === `${base}/employees`) return json(route, { employees });
    if (p === `${base}/bots`) return json(route, { bots: [] });
    if (p === `${base}/tasks`) return json(route, { tasks: [] });
    if (p === `${base}/devices`) return json(route, { devices: [] });
    if (p === '/api/conversations/chat-first') return json(route, { id: 'chat-first', employee_id: employees[0].id, messages: control.messages });
    if (p === '/api/conversations/chat-second') return json(route, { id: 'chat-second', employee_id: employees[1].id, messages: [row('second-message', '第二段聊天', 59)] });
    errors.push({ scenario: name, message: `Unhandled request ${method} ${p}` });
    return json(route, { error: 'Unhandled fixture route' }, 404);
  });
  const releaseRead = async () => { for (const release of control.held.splice(0)) await release(); await raf(page); };
  const session = { context, page, control, releaseRead, close: async () => { await releaseRead(); await context.close(); } }; sessions.push(session);
  await page.goto(`${origin}/__ziwei_manager__/index.html`);
  await page.getByRole('heading', { name: '聊天', exact: true }).waitFor();
  await page.locator('.thread-row').first().waitFor();
  return session;
}

async function assertNoHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  const bounds = await page.locator('.chat-find-panel,.composer-area').evaluateAll(elements => elements.map(element => ({ name: element.className, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, bottom: element.getBoundingClientRect().bottom })));
  const width = page.viewportSize().width;
  for (const bound of bounds) assert.ok(bound.left >= -1 && bound.right <= width + 1, `${bound.name} fits viewport ${width}`);
}

async function openChat(session, employeeId = employees[0].id) {
  await click(session.page, 'chat', employeeId);
  await session.page.locator('[data-message-id]').first().waitFor(); await raf(session.page);
}

try {
  for (const width of readCursorsOnly ? [] : [390, 320]) {
    const session = await fixture(`layout-${width}`, width), { page, control } = session;
    assert.equal(await page.locator('.thread-row').first().getAttribute('data-id'), employees[1].id);
    await click(page, 'chat-pin', 'chat-first');
    assert.equal(await page.locator('.thread-row').first().getAttribute('data-id'), employees[0].id);
    assert.equal(await page.locator('[data-action=chat-pin][data-id=chat-first]').getAttribute('aria-pressed'), 'true');
    await openChat(session);
    const image = page.locator('[data-message-id=image-parent] img');
    // Bring a lazy image into the viewport before awaiting decode; a narrow
    // layout can legitimately keep it outside Chromium's lazy-load distance.
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(img => Promise.race([img.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture image decode timed out')), 5000))]));
    await page.locator('.chat-timeline').evaluate(element => { element.scrollTop = element.scrollHeight; }); await raf(page);
    await page.evaluate(() => { window.__keptTimeline = document.querySelector('.chat-timeline'); window.__keptImage = document.querySelector('[data-message-id=image-parent] img'); });
    await click(page, 'chat-find-open');
    await page.locator('[name=chatFind]').fill(literal); await raf(page);
    assert.equal(await page.evaluate(() => document.querySelector('.chat-timeline') === window.__keptTimeline && document.querySelector('[data-message-id=image-parent] img') === window.__keptImage), true, 'Opening/typing search must retain original timeline/image DOM');
    assert.equal(await page.locator('.chat-find-results button').count(), 2);
    assert.equal(await page.locator('.chat-find-results mark').first().innerText(), literal);
    assert.equal(await page.locator('.chat-find-results script,.chat-find-results img').count(), 0);
    assert.equal(await page.evaluate(() => window.__searchExecuted), undefined);
    assert.equal(await page.locator('.chat-find-summary').innerText(), '2 条相关消息 · 当前聊天已加载记录');
    await page.locator('[name=chatFind]').click();
    await page.locator('[name=chatFind]').press('End');
    await page.locator('[name=chatFind]').press('Space'); await raf(page);
    assert.equal(await page.evaluate(() => document.activeElement?.name), 'chatFind');
    const caretBefore = await page.locator('[name=chatFind]').evaluate(input => input.selectionStart);
    const polled = page.waitForResponse(response => new URL(response.url()).pathname === '/api/conversations/chat-first');
    await page.evaluate(() => window.dispatchEvent(new Event('ziwei:resume'))); await polled; await raf(page);
    assert.equal(await page.evaluate(() => document.activeElement?.name), 'chatFind');
    assert.equal(await page.locator('[name=chatFind]').evaluate(input => input.selectionStart), caretBefore);
    assert.equal(await page.evaluate(() => document.querySelector('.chat-timeline') === window.__keptTimeline && document.querySelector('[data-message-id=image-parent] img') === window.__keptImage), true, 'Unchanged poll during search must retain original timeline/image DOM');
    await assertNoHorizontalOverflow(page);
    await page.setViewportSize({ width, height: 500 }); await raf(page);
    assert.equal(await page.evaluate(() => document.activeElement?.name), 'chatFind');
    await assertNoHorizontalOverflow(page); await capture(page, `search-${width}-resized-viewport`);
    await page.setViewportSize({ width, height: 844 }); await raf(page);
    await page.locator('[name=chatFind]').fill('普通定位目标');
    await click(page, 'chat-find-result', 'ordinary-target'); await raf(page);
    assert.equal(await page.locator('.chat-find-panel').count(), 0);
    const ordinary = await page.locator('[data-message-id=ordinary-target]').evaluate(element => { const a = element.getBoundingClientRect(), b = element.closest('.chat-timeline').getBoundingClientRect(); return { top: a.top, bottom: a.bottom, viewportTop: b.top, viewportBottom: b.bottom, center: (a.top + a.bottom) / 2, viewportCenter: (b.top + b.bottom) / 2 }; });
    assert.ok(ordinary.top >= ordinary.viewportTop - 1 && ordinary.bottom <= ordinary.viewportBottom + 1, 'Ordinary result remains visible after render scroll restoration');
    assert.ok(Math.abs(ordinary.center - ordinary.viewportCenter) < 4, 'Ordinary result is centered after render scroll restoration');
    assert.equal(await page.evaluate(() => document.querySelector('.chat-timeline') === window.__keptTimeline && document.querySelector('[data-message-id=image-parent] img') === window.__keptImage), true, 'Selecting an ordinary result preserves the original decoded image and timeline');
    await capture(page, `ordinary-jump-${width}`);
    await page.evaluate(() => { window.__afterJumpTimeline = document.querySelector('.chat-timeline'); window.__afterJumpImage = document.querySelector('[data-message-id=image-parent] img'); });
    await click(page, 'chat-find-open');
    assert.equal(await page.evaluate(() => document.querySelector('.chat-timeline') === window.__afterJumpTimeline && document.querySelector('[data-message-id=image-parent] img') === window.__afterJumpImage), true, 'Reopening search after an earlier result must retain the existing timeline and image DOM');
    await page.locator('[name=chatFind]').fill('第 10 条工作记录');
    await click(page, 'chat-find-result', 'message-10'); await raf(page);
    assert.equal(await page.evaluate(() => document.querySelector('.chat-timeline') === window.__afterJumpTimeline && document.querySelector('[data-message-id=image-parent] img') === window.__afterJumpImage), true, 'Selecting a different ordinary result keeps the same timeline and decoded image');
    assert.equal(await page.locator('[data-message-id=message-10].search-match').count(), 1);
    assert.equal(await page.locator('[data-message-id=ordinary-target].search-match').count(), 0);
    const secondCentered = await page.locator('[data-message-id=message-10]').evaluate(element => { const a = element.getBoundingClientRect(), b = element.closest('.chat-timeline').getBoundingClientRect(); return Math.abs((a.top + a.bottom - b.top - b.bottom) / 2) < 4; });
    assert.equal(secondCentered, true, 'A different ordinary match also centers after scroll restoration');
    await click(page, 'chat-find-open');
    await page.locator('[name=chatFind]').fill('转发定位目标');
    await click(page, 'chat-find-result', 'forward-parent'); await raf(page);
    await page.locator('.forward-detail-overlay').waitFor();
    assert.equal(await page.locator('.forward-snapshot-message.search-match').getAttribute('data-search-quote-index'), '14');
    const quote = await page.locator('[data-search-quote-index="14"]').evaluate(element => { const a = element.getBoundingClientRect(), b = element.closest('.forward-detail-messages').getBoundingClientRect(); return { top: a.top, bottom: a.bottom, viewportTop: b.top, viewportBottom: b.bottom }; });
    assert.ok(quote.top >= quote.viewportTop - 1 && quote.bottom <= quote.viewportBottom + 1, 'Matched quote, rather than another forwarded row, is visible');
    assert.equal(await page.evaluate(() => window.__searchExecuted), undefined);
    await capture(page, `forward-jump-${width}`);
    assert.equal(await page.evaluate(() => window.dispatchEvent(new CustomEvent('ziwei:back', { cancelable: true }))), false);
    await page.locator('.forward-detail-overlay').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.app-shell').getAttribute('data-page'), 'chat');
    await click(page, 'chat-find-open');
    assert.equal(await page.evaluate(() => window.dispatchEvent(new CustomEvent('ziwei:back', { cancelable: true }))), false);
    await page.locator('.chat-find-panel').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.app-shell').getAttribute('data-page'), 'chat');
    const draft = `<img src=x onerror="window.__draftExecuted=1"> ${'草稿 '.repeat(4)}`;
    await page.locator('[name=draft]').fill(draft); await click(page, 'back');
    await page.locator('.thread-preview.has-draft').waitFor();
    assert.equal(await page.locator('.thread-preview.has-draft').innerText(), `[草稿] ${draft.trimEnd()}`);
    assert.equal(await page.locator('.thread-preview img').count(), 0);
    assert.equal(await page.evaluate(() => window.__draftExecuted), undefined);
    await capture(page, `pinned-draft-${width}`);
    await page.reload(); await page.locator('.thread-preview.has-draft').waitFor();
    assert.equal(await page.locator('.thread-row').first().getAttribute('data-id'), employees[0].id);
    await openChat(session); assert.equal(await page.locator('[name=draft]').inputValue(), draft);
    checks.push(`${width}px: escaped literal search/highlights, stable image/timeline during open/type/poll/reopen and two different ordinary jumps, caret through poll and resized viewport, centered ordinary jumps, exact forwarded quote jump, native back ordering, pin sort/reload and escaped draft preview/restore`);
    await session.close();
  }

  const pending = await fixture('queued-read-search-overlay', 390), { page, control } = pending;
  control.holdNextRead = true; await openChat(pending);
  await page.waitForFunction(() => document.querySelector('.chat-timeline')?.scrollTop > 0);
  for (let attempt = 0; !control.held.length && attempt < 120; attempt++) await raf(page);
  assert.ok(control.held.length, 'The first visible cursor write must actually be pending');
  const firstReadCount = control.readWrites.length;
  assert.equal(firstReadCount, 1);
  control.messages.push(row('new-after-pending', '新增的末条消息，用于排队已读验证', 55));
  const updated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/conversations/chat-first');
  await page.evaluate(() => window.dispatchEvent(new Event('ziwei:resume'))); await updated; await raf(page);
  await page.locator('[data-message-id=new-after-pending]').waitFor();
  await click(page, 'chat-find-open'); await pending.releaseRead();
  await page.waitForTimeout(100);
  assert.equal(control.readWrites.length, firstReadCount, 'A queued read is not sent once search has opened');
  const resumedRead = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/read'));
  await click(page, 'chat-find-close'); await resumedRead;
  assert.equal(control.readWrites.at(-1).messageId, 'new-after-pending');
  checks.push('A real in-flight read acknowledgement with a queued newer visible message does not dispatch that queued read during search; closing search resumes the correct last visible cursor');

  control.holdNextRead = true;
  control.messages.push(row('pending-before-forward', '挂起第二个已读，用于转发记录面板验证', 56));
  let refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/conversations/chat-first');
  await page.evaluate(() => window.dispatchEvent(new Event('ziwei:resume'))); await refreshed; await raf(page);
  for (let attempt = 0; !control.held.length && attempt < 120; attempt++) await raf(page);
  assert.ok(control.held.length, 'A second cursor acknowledgement is actually pending');
  const forwardReadCount = control.readWrites.length;
  control.messages.push(row('queued-during-forward', '再次新增末条，转发面板期间不得自动标记', 57));
  refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/conversations/chat-first');
  await page.evaluate(() => window.dispatchEvent(new Event('ziwei:resume'))); await refreshed; await raf(page);
  await click(page, 'forward-detail', 'forward-parent');
  await page.locator('.forward-detail-overlay').waitFor(); await pending.releaseRead();
  await page.waitForTimeout(100);
  assert.equal(control.readWrites.length, forwardReadCount, 'A queued cursor is not sent while a forwarded record overlay is open');
  const afterForwardRead = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/read'));
  await page.getByRole('button', { name: '关闭聊天记录', exact: true }).last().click();
  await page.locator('.chat-timeline').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await afterForwardRead;
  assert.equal(control.readWrites.at(-1).messageId, 'queued-during-forward');
  checks.push('A second in-flight cursor with a newer queued message is also blocked throughout the forwarded-record overlay; scrolling the original timeline afterward marks its actual visible last message');
  await pending.close();

  assert.deepEqual(errors, []);
  const sourceAfter = await sourceHashes();
  assert.deepEqual(sourceAfter, sourceBefore, 'Re-run against frozen sources if product changes during integration QA');
  const result = { passed: true, checks, screenshots, sourceHashes: sourceBefore, requests: requests.length, readCursorWrites: requests.filter(entry => entry.method === 'POST').length, businessWrites: 0, externalRequests: 0, localListeners: 0, evidence: 'Synthetic Playwright route.fulfill fixtures over browser pipe: UI correctness, viewport resize and browser focus only; not native Android IME or weak-network/production validation' };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const result = { passed: false, error: error.stack || error.message, errors, checks, screenshots, requests };
  if (activePage && !activePage.isClosed()) {
    await capture(activePage, 'failure').catch(() => {});
    result.body = await activePage.locator('body').innerText().catch(() => null);
    result.layout = await activePage.locator('.app-shell,.chat-main,.chat-timeline,.chat-find-panel,.composer-area,.forward-detail-messages').evaluateAll(elements => elements.map(element => ({ className: element.className, rect: element.getBoundingClientRect().toJSON(), scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))).catch(() => null);
  }
  await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify(result, null, 2) + '\n'); throw error;
} finally {
  for (const session of sessions) await session.close().catch(() => {});
  await browser.close();
}
