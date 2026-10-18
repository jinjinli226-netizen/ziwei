import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('./api.js', import.meta.url), 'utf8'))
  .replace("'./api-base.js'", JSON.stringify(new URL('./api-base.js', import.meta.url).href))
  .replace("'./bounded-read.js'", JSON.stringify(new URL('./bounded-read.js', import.meta.url).href))
  .replaceAll('import.meta.env.', '({VITE_API_URL:"",DEV:false}).');
async function fixture(t, fetch) {
  const saved = { fetch: globalThis.fetch, window: globalThis.window };
  globalThis.window = { location: { origin: 'https://ziwei.test', pathname: '/wrong-workspace/members' }, dispatchEvent() {} };
  globalThis.fetch = fetch; t.after(() => Object.assign(globalThis, saved));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).api;
}

test('list, chosen-device update and exact-request cancellation use same-origin session auth and explicit scope', async t => {
  const calls = []; const api = await fixture(t, async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ devices: [], request: { id: 'u' } }) }; });
  const body = { idempotencyKey: 'client-update-1', waitForIdle: true };
  await api.clientUpdates('our/workspace'); await api.updateClient('pc/id', body, 'our/workspace'); await api.cancelClientUpdate('pc/id', 'request/id', 'our/workspace');
  const base = 'https://ziwei.test/api/workspaces/our%2Fworkspace';
  assert.deepEqual(calls.map(({ url }) => url), [base + '/client-updates', base + '/devices/pc%2Fid/client-updates', base + '/devices/pc%2Fid/client-updates/request%2Fid/cancel']);
  assert.deepEqual(calls.map(({ options }) => options.method), [undefined, 'POST', 'POST']);
  assert.ok(calls.every(({ options }) => options.credentials === 'include'));
  assert.deepEqual(JSON.parse(calls[1].options.body), body); assert.equal(calls[2].options.body, '{}');
});

test('remote-upgrade permission and capability failures remain typed, with no fallback request', async t => {
  const calls = []; const api = await fixture(t, async (url, options) => { calls.push({ url, options }); return { ok: false, status: 409, json: async () => ({ code: 'REMOTE_UPDATE_CLIENT_REQUIRED', error: '客户端需要首次升级' }) }; });
  await assert.rejects(api.updateClient('pc', { idempotencyKey: 'client-update-1', waitForIdle: true }, 'ws'), error => error.status === 409 && error.code === 'REMOTE_UPDATE_CLIENT_REQUIRED');
  assert.equal(calls.length, 1);
});

test('a stalled status read is bounded and aborted without submitting an update', async t => {
  let signal; const calls = []; const api = await fixture(t, async (url, options) => { signal = options.signal; calls.push(options.method); return new Promise(() => {}); });
  await assert.rejects(api.clientUpdates('ws', { timeoutMs: 5 }), error => error.code === 'READ_TIMEOUT');
  assert.equal(signal.aborted, true); assert.deepEqual(calls, [undefined]);
});
