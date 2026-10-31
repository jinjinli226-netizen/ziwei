import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDshPluginUiRelayTransport, PROTOCOL } from './dsh-plugin-ui-relay-transport.mjs';

class FakeSocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.OPEN = 1; this.sent = []; }
  send(value) { this.sent.push(value); }
  close(code = 1000, reason = '') { this.readyState = 3; this.emit('close', code, reason); }
}
const frame = (body = '') => Buffer.from(body).toString('base64');

function fixture() {
  const row = { relayId:'relay-1', workspace:'fixture', employeeId:'employee-1', deviceId:'device-1', profile:'alpha', viewKey:'v'.repeat(16), relayActionId:'action-relay-1', expiresAt:new Date(Date.now()+60000).toISOString(), status:'open' };
  const calls = [];
  const relay = {
    status: id => { if (id !== row.relayId) throw Object.assign(new Error('not found'), { code:'DSH_PLUGIN_UI_RELAY_NOT_FOUND', status:404 }); return row; },
    assertDevice: (id, input) => { calls.push(['device', id, input]); assert.equal(id, row.relayId); assert.equal(input.deviceId, row.deviceId); assert.equal(input.workspace, row.workspace); assert.equal(input.profile, row.profile); assert.equal(input.viewKey, row.viewKey); assert.equal(input.actionId, row.relayActionId); return row; },
    assertBrowser: (id, input) => { assert.equal(id, row.relayId); assert.equal(input.viewKey, row.viewKey); return row; },
    assertRequest: (id, input) => { assert.equal(id, row.relayId); return { ...input, method:input.method.toUpperCase(), headers:input.headers || {}, bodyBase64:input.bodyBase64 || '', relay:row }; },
    onClose: () => () => {}
  };
  const transport = createDshPluginUiRelayTransport({ relay, requestTimeoutMs:500, streamTimeoutMs:1000 });
  return { row, calls, relay, transport };
}

test('device and browser sockets pair, forward HTTP frames, and enforce monotonic device sequence', async () => {
  const f = fixture(), device = new FakeSocket(), browser = new FakeSocket();
  f.transport.acceptDevice(f.row.relayId, device, { deviceId:f.row.deviceId });
  device.emit('message', JSON.stringify({ type:'ready', protocol:PROTOCOL, relayId:f.row.relayId, deviceId:f.row.deviceId, workspace:f.row.workspace, profile:f.row.profile, viewKey:f.row.viewKey, actionId:f.row.relayActionId }));
  f.transport.bindBrowser(f.row.relayId, browser, { actorRole:'owner' }, f.row.viewKey);
  assert.equal(JSON.parse(browser.sent.at(-1)).type, 'ready');
  const request = f.transport.forward(f.row.relayId, { kind:'http', method:'GET', path:'/runtime/alpha/ui/index.html', headers:{accept:'text/html'}, requestId:'req-1' }, { actorRole:'owner' });
  await new Promise(resolve => setImmediate(resolve));
  const input = JSON.parse(device.sent.at(-1)); assert.equal(input.type, 'input'); assert.equal(input.kind, 'http'); assert.equal(input.path, '/runtime/alpha/ui/index.html');
  device.emit('message', JSON.stringify({ type:'frame', relayId:f.row.relayId, seq:1, kind:'http', requestId:'req-1', status:200, headersAllowlist:{'content-type':'text/html'}, bodyBase64:frame('<h1>ok</h1>') }));
  const result = await request; assert.equal(result.status, 200); assert.equal(result.body.toString(), '<h1>ok</h1>');
  device.emit('message', JSON.stringify({ type:'frame', relayId:f.row.relayId, seq:1, kind:'http', requestId:'unknown', status:200, bodyBase64:'' }));
  assert.equal(device.readyState, 3);
});

test('browser WebSocket payload is wrapped as a bounded device input and response bytes return unchanged', () => {
  const f = fixture(), device = new FakeSocket(), browser = new FakeSocket();
  f.transport.acceptDevice(f.row.relayId, device, { deviceId:f.row.deviceId });
  device.emit('message', JSON.stringify({ type:'ready', protocol:PROTOCOL, relayId:f.row.relayId, deviceId:f.row.deviceId, workspace:f.row.workspace, profile:f.row.profile, viewKey:f.row.viewKey, actionId:f.row.relayActionId }));
  f.transport.bindBrowser(f.row.relayId, browser, { actorRole:'owner' }, f.row.viewKey);
  browser.emit('message', Buffer.from('client-payload'));
  const input = JSON.parse(device.sent.at(-1)); assert.equal(input.kind, 'ws'); assert.equal(Buffer.from(input.bodyBase64, 'base64').toString(), 'client-payload');
  device.emit('message', JSON.stringify({ type:'frame', relayId:f.row.relayId, seq:1, kind:'ws', requestId:input.requestId, bodyBase64:frame('server-payload') }));
  assert.equal(Buffer.from(browser.sent.at(-1)).toString(), 'server-payload');
});

test('device ready frame cannot switch the relay profile, view key, or action', () => {
  const f = fixture(), device = new FakeSocket();
  f.transport.acceptDevice(f.row.relayId, device, { deviceId:f.row.deviceId });
  device.emit('message', JSON.stringify({ type:'ready', protocol:PROTOCOL, relayId:f.row.relayId, deviceId:f.row.deviceId, workspace:f.row.workspace, profile:'beta', viewKey:f.row.viewKey, actionId:f.row.relayActionId }));
  assert.equal(device.readyState, 3);
});
