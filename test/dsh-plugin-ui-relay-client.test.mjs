import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDshPluginUiRelayClient, DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES } from '../src/dsh-plugin-ui-relay.mjs';

const binding = (overrides = {}) => ({
  workspace: 'workspace-1', employeeId: 'employee-1', deviceId: 'device-1', profile: 'alpha',
  viewKey: 'view-key-12345678', relayId: 'relay-1',
  relayUrl: 'ws://server.test/a2a/v1/dsh-ui-relays/relay-1/device',
  dshBaseUrl: 'http://dsh.test:7878', expiresAt: new Date(Date.now() + 60_000).toISOString(),
  ...overrides,
});

class Socket extends EventEmitter {
  static sockets = [];
  constructor(url, options) {
    super(); this.url = url; this.options = options; this.sent = []; this.closed = false; this.readyState = 0; Socket.sockets.push(this);
    queueMicrotask(() => { this.readyState = 1; this.emit('open'); });
  }
  send(value) { this.sent.push(value); }
  close(code = 1000, reason = '') { if (this.closed) return; this.closed = true; this.readyState = 3; this.emit('close', code, reason); }
  deliver(value) { this.emit('message', Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))); }
  static reset() { Socket.sockets.length = 0; }
}

function response(body, headers = { 'content-type': 'text/html' }, status = 200) {
  return new Response(body, { status, headers });
}

test('relay client opens a bound tunnel and forwards a bounded HTTP response in order', async () => {
  Socket.reset();
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'http://dsh.test:7878/runtime/alpha/ui/index.html');
    assert.equal(options.headers.accept, 'text/html');
    assert.equal(options.headers.cookie, undefined);
    return response('<h1>ok</h1>');
  };
  const client = createDshPluginUiRelayClient({ apiBase: 'http://server.test', deviceToken: 'device-token', dshBaseUrl: 'http://dsh.test:7878', fetchImpl, WebSocketImpl: Socket });
  const running = client.execute({ id: 'action-1', type: 'employee.dsh.ui.relay.open', payload: binding() });
  await new Promise(resolve => setTimeout(resolve, 25));
  const server = Socket.sockets.find(item => item.url.includes('/device'));
  assert.ok(server);
  server.deliver({ type: 'input', relayId: 'relay-1', seq: 1, kind: 'http', requestId: 'req-1', method: 'GET', path: '/runtime/alpha/ui/index.html', headersAllowlist: { accept: 'text/html' } });
  await new Promise(resolve => setTimeout(resolve, 25));
  const frames = server.sent.map(value => JSON.parse(value));
  assert.equal(frames[0].type, 'ready');
  assert.equal(frames[0].relayId, 'relay-1');
  assert.equal(frames[0].actionId, 'action-1');
  assert.equal(frames[1].type, 'frame');
  assert.equal(frames[1].seq, 1);
  assert.equal(frames[1].requestId, 'req-1');
  assert.equal(Buffer.from(frames[1].bodyBase64, 'base64').toString(), '<h1>ok</h1>');
  server.deliver({ type: 'close', relayId: 'relay-1', reason: 'browser_closed' });
  const result = await running;
  assert.equal(result.status, 'succeeded');
  assert.equal(result.result.frames, 1);
  assert.equal(result.result.closedReason, 'browser_closed');
});

test('relay client streams SSE chunks and keeps monotonic frame sequence', async () => {
  Socket.reset();
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: one\n\n')); controller.enqueue(new TextEncoder().encode('data: two\n\n')); controller.close(); },
  });
  const client = createDshPluginUiRelayClient({
    apiBase: 'http://server.test', deviceToken: 'device-token', dshBaseUrl: 'http://dsh.test:7878', WebSocketImpl: Socket,
    fetchImpl: async (_url, options) => { assert.equal(options.headers.accept, 'text/event-stream'); return new Response(stream, {status: 200, headers: {'content-type': 'text/event-stream'}}); },
  });
  const running = client.execute({ id: 'action-1', type: 'employee.dsh.ui.relay.open', payload: binding() });
  await new Promise(resolve => setTimeout(resolve, 50));
  const server = Socket.sockets.find(item => item.url.includes('/device'));
  server.deliver({ type: 'input', relayId: 'relay-1', seq: 1, kind: 'sse', requestId: 'events-1', method: 'GET', path: '/runtime/alpha/ui/plugins/events', headersAllowlist: {} });
  await new Promise(resolve => setTimeout(resolve, 50));
  try {
    const frames = server.sent.slice(1).map(value => JSON.parse(value)).filter(value => value.type === 'frame');
  assert.deepEqual(frames.map(value => value.seq), [1, 2, 3]);
    assert.equal(frames.every(value => value.kind === 'sse' && value.requestId === 'events-1'), true);
    assert.equal(Buffer.from(frames[0].bodyBase64, 'base64').toString(), 'data: one\n\n');
  } finally { server.deliver({ type: 'close', relayId: 'relay-1', reason: 'done' }); await running; }
});

test('relay client forwards native remote.mux WebSocket messages and closes upstream', async () => {
  Socket.reset();
  const client = createDshPluginUiRelayClient({ apiBase: 'http://server.test', deviceToken: 'device-token', dshBaseUrl: 'http://dsh.test:7878', WebSocketImpl: Socket });
  const running = client.execute({ id: 'action-1', type: 'employee.dsh.ui.relay.open', payload: binding() });
  await new Promise(resolve => setImmediate(resolve));
  const server = Socket.sockets.find(item => item.url.includes('/device'));
  server.deliver({ type: 'input', relayId: 'relay-1', seq: 1, kind: 'ws', requestId: 'mux-1', method: 'GET', path: '/runtime/alpha/api/remote.mux', headersAllowlist: {}, bodyBase64: '' });
  await new Promise(resolve => setImmediate(resolve));
  const upstream = Socket.sockets.find(item => item.url.includes('/runtime/alpha/api/remote.mux'));
  try {
    assert.ok(upstream);
    upstream.deliver(Buffer.from('plugin-frame'));
    await new Promise(resolve => setTimeout(resolve, 25));
  const frame = server.sent.map(value => JSON.parse(value)).find(value => value.type === 'frame' && value.kind === 'ws' && value.bodyBase64);
    assert.equal(Buffer.from(frame.bodyBase64, 'base64').toString(), 'plugin-frame');
    server.deliver({ type: 'input', relayId: 'relay-1', seq: 2, kind: 'ws', requestId: 'mux-1', method: 'POST', path: '/runtime/alpha/api/remote.mux', headersAllowlist: {}, bodyBase64: Buffer.from('browser-frame').toString('base64') });
    await new Promise(resolve => setImmediate(resolve));
  assert.equal(Buffer.from(upstream.sent.at(-1)).toString(), 'browser-frame');
  } finally { server.deliver({ type: 'close', relayId: 'relay-1', reason: 'browser_closed' }); await running; }
  assert.equal(upstream.closed, true);
});

test('relay client rejects cross profile paths and credential headers before contacting DSH', async () => {
  Socket.reset(); let calls = 0;
  const client = createDshPluginUiRelayClient({ apiBase: 'http://server.test', deviceToken: 'device-token', dshBaseUrl: 'http://dsh.test:7878', WebSocketImpl: Socket, fetchImpl: async () => { calls += 1; return response('unexpected'); } });
  const running = client.execute({ id: 'action-1', type: 'employee.dsh.ui.relay.open', payload: binding() });
  await new Promise(resolve => setImmediate(resolve));
  const server = Socket.sockets.find(item => item.url.includes('/device'));
  server.deliver({ type: 'input', relayId: 'relay-1', seq: 1, kind: 'http', requestId: 'bad-path', method: 'GET', path: '/runtime/beta/ui/index.html', headersAllowlist: {} });
  await new Promise(resolve => setImmediate(resolve));
  server.deliver({ type: 'input', relayId: 'relay-1', seq: 2, kind: 'http', requestId: 'bad-header', method: 'GET', path: '/runtime/alpha/ui/index.html', headersAllowlist: { cookie: 'secret' } });
  await new Promise(resolve => setImmediate(resolve));
  const errors = server.sent.map(value => JSON.parse(value)).filter(value => value.type === 'error');
  assert.deepEqual(errors.map(value => value.code), ['DSH_PLUGIN_UI_RELAY_PATH_INVALID', 'DSH_PLUGIN_UI_RELAY_HEADERS_INVALID']);
  assert.equal(calls, 0);
  server.deliver({ type: 'close', relayId: 'relay-1', reason: 'invalid_input' });
  await running;
});

test('relay client enforces the frame size limit', async () => {
  Socket.reset();
  const client = createDshPluginUiRelayClient({ apiBase: 'http://server.test', deviceToken: 'device-token', dshBaseUrl: 'http://dsh.test:7878', WebSocketImpl: Socket, fetchImpl: async () => response('x'.repeat(DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES + 1)) });
  const running = client.execute({ id: 'action-1', type: 'employee.dsh.ui.relay.open', payload: binding() });
  await new Promise(resolve => setImmediate(resolve));
  const server = Socket.sockets.find(item => item.url.includes('/device'));
  server.deliver({ type: 'input', relayId: 'relay-1', seq: 1, kind: 'http', requestId: 'too-large', method: 'GET', path: '/runtime/alpha/ui/index.html', headersAllowlist: {} });
  await new Promise(resolve => setImmediate(resolve));
  const error = server.sent.map(value => JSON.parse(value)).find(value => value.type === 'error');
  assert.equal(error.code, 'DSH_PLUGIN_UI_RELAY_FRAME_TOO_LARGE');
  server.deliver({ type: 'close', relayId: 'relay-1', reason: 'frame_too_large' });
  await running;
});
