import { randomUUID } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_BODY_BASE64 = 700000;
const REQUEST_TIMEOUT_MS = 15000;
const STREAM_TIMEOUT_MS = 120000;
const PROTOCOL = 'dsh-plugin-ui-relay-v1';
const REQUEST_HEADERS = new Set(['accept', 'cache-control', 'content-type', 'last-event-id', 'x-requested-with']);
const RESPONSE_HEADERS = new Set(['cache-control', 'content-type', 'etag', 'last-modified', 'retry-after']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

const fail = (code, status = 400, message = code) => { throw Object.assign(new Error(message), { code, status }); };
const string = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const isSocketOpen = socket => socket && (socket.readyState === undefined || socket.readyState === socket.OPEN || socket.readyState === 1);
const decodeBody = value => {
  if (value === undefined || value === '') return Buffer.alloc(0);
  if (!string(value, MAX_BODY_BASE64) || !/^[-A-Za-z0-9+/=]*$/.test(value)) fail('DSH_PLUGIN_UI_RELAY_BODY_INVALID', 400);
  let result;
  try { result = Buffer.from(value, 'base64'); } catch { fail('DSH_PLUGIN_UI_RELAY_BODY_INVALID', 400); }
  if (result.length > 512 * 1024) fail('DSH_PLUGIN_UI_RELAY_FRAME_TOO_LARGE', 413);
  return result;
};
const encodeBody = value => Buffer.from(value || '').toString('base64');
const parseJson = raw => { try { return JSON.parse(String(raw)); } catch { fail('DSH_PLUGIN_UI_RELAY_FRAME_INVALID', 400); } };
const headerAllowlist = (headers, allowed) => {
  if (headers === undefined) return {};
  if (!object(headers) || Object.keys(headers).length > 16) fail('DSH_PLUGIN_UI_RELAY_HEADERS_INVALID', 400);
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = String(key).toLowerCase();
    if (!allowed.has(normalized) || !string(value, 2000)) fail('DSH_PLUGIN_UI_RELAY_HEADERS_INVALID', 400);
    result[normalized] = value;
  }
  return result;
};
const safeSend = (socket, value) => {
  if (!isSocketOpen(socket)) return false;
  const serialized = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  if (Buffer.byteLength(serialized) > MAX_FRAME_BYTES) fail('DSH_PLUGIN_UI_RELAY_FRAME_TOO_LARGE', 413);
  socket.send(serialized);
  return true;
};
const cookieValue = (header, name = 'ziwei_dsh_relay') => {
  const match = String(header || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!match) return '';
  try { return decodeURIComponent(match.slice(name.length + 1)); } catch { return ''; }
};
const relayCookie = (relayId, viewKey) => `${relayId}.${viewKey}`;
const parseRelayCookie = value => {
  const raw = String(value || ''), separator = raw.indexOf('.');
  if (separator <= 0) return null;
  const relayId = raw.slice(0, separator), viewKey = raw.slice(separator + 1);
  return relayId && viewKey ? { relayId, viewKey } : null;
};
const profilePath = (profile, suffix = '/', query = '') => `/runtime/${encodeURIComponent(profile)}/ui/${String(suffix || '/').replace(/^\/+/, '')}${query}`.replace(/\/ui\/\/(?:\?|$)/, '/ui/$1');

/**
 * Pair the browser-facing same-origin relay with the device WebSocket.
 * The service owns authorization and current employee binding; this module
 * owns only ephemeral sockets and bounded frames.
 */
export function createDshPluginUiRelayTransport({ relay, now = Date.now, requestTimeoutMs = REQUEST_TIMEOUT_MS, streamTimeoutMs = STREAM_TIMEOUT_MS } = {}) {
  if (!relay) throw new TypeError('relay is required');
  const channels = new Map();
  const channelFor = relayId => {
    let channel = channels.get(relayId);
    if (!channel) {
      channel = { relayId, device: null, browser: null, ready: false, expectedDeviceId: null, serverSeq: 0, deviceSeq: 0, pending: new Map(), waiters: [], closed: false, lastActivity: now(), unsubscribe: null, expiryTimer: null, healthTimer: null };
      channels.set(relayId, channel);
      channel.unsubscribe = relay.onClose?.(relayId, () => closeChannel(channel, 1008, 'relay revoked')) || null;
      try {
        const snapshot = relay.status(relayId, { actorRole:'owner' });
        const ttl = Math.max(1, Date.parse(snapshot.expiresAt) - now());
        channel.expiryTimer = setTimeout(() => closeChannel(channel, 1008, 'relay expired'), ttl);
        channel.expiryTimer.unref?.();
        channel.healthTimer = setInterval(() => { try { relay.status(relayId, { actorRole:'owner' }); } catch { closeChannel(channel, 1008, 'relay revoked'); } }, 5000);
        channel.healthTimer.unref?.();
      } catch { closeChannel(channel, 1008, 'relay unavailable'); }
    }
    return channel;
  };
  const rejectPending = (channel, error) => {
    for (const pending of channel.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    channel.pending.clear();
    for (const waiter of channel.waiters.splice(0)) waiter.reject(error);
  };
  function closeChannel(channel, code = 1000, reason = 'relay closed') {
    if (!channel || channel.closed) return;
    channel.closed = true;
    channel.unsubscribe?.();
    if (channel.expiryTimer) clearTimeout(channel.expiryTimer);
    if (channel.healthTimer) clearInterval(channel.healthTimer);
    const error = Object.assign(new Error(reason), { code: 'DSH_PLUGIN_UI_RELAY_CLOSED', status: 410 });
    rejectPending(channel, error);
    for (const socket of [channel.browser, channel.device]) {
      try { if (isSocketOpen(socket)) socket.close(code, reason.slice(0, 120)); } catch {}
    }
    channels.delete(channel.relayId);
  }
  const touch = channel => { channel.lastActivity = now(); };
  function checkLive(channel, context) {
    if (!channel || channel.closed) fail('DSH_PLUGIN_UI_RELAY_CLOSED', 410);
    try { relay.status(channel.relayId, context); } catch (error) { closeChannel(channel, 1008, error.code || 'relay revoked'); throw error; }
  }
  function bindDevice(relayId, socket, binding) {
    relay.assertDevice(relayId, binding);
    const channel = channelFor(relayId);
    channel.expectedDeviceId = binding.deviceId;
    if (channel.device && channel.device !== socket) { try { channel.device.close(1008, 'replaced'); } catch {} }
    channel.device = socket; channel.ready = false; channel.deviceSeq = 0; touch(channel);
    socket.on('message', raw => onDeviceMessage(channel, raw));
    socket.on('close', () => { if (channel.device === socket) { channel.device = null; channel.ready = false; for (const pending of channel.pending.values()) pending.reject(Object.assign(new Error('device disconnected'), { code: 'DSH_PLUGIN_UI_RELAY_DEVICE_OFFLINE', status: 503 })); } });
    socket.on('error', () => {});
    return channel;
  }
  function acceptDevice(relayId, socket, { deviceId } = {}) {
    if (!string(deviceId, 200)) fail('DSH_PLUGIN_UI_RELAY_DEVICE_BINDING_INVALID', 403);
    // The token/device binding is checked by the HTTP upgrade handler. Keep
    // the session live check here so an expired or revoked relay cannot hold
    // an otherwise valid device socket.
    relay.status(relayId, { actorRole: 'owner' });
    const channel = channelFor(relayId);
    channel.expectedDeviceId = deviceId; channel.device = socket; channel.ready = false; channel.deviceSeq = 0; touch(channel);
    socket.on('message', raw => onDeviceMessage(channel, raw));
    socket.on('close', () => { if (channel.device === socket) { channel.device = null; channel.ready = false; const error = Object.assign(new Error('device disconnected'), { code: 'DSH_PLUGIN_UI_RELAY_DEVICE_OFFLINE', status: 503 }); rejectPending(channel, error); } });
    socket.on('error', () => {});
    return channel;
  }
  function bindBrowser(relayId, socket, context, viewKey) {
    relay.assertBrowser(relayId, { ...context, viewKey });
    const channel = channelFor(relayId);
    if (channel.browser && channel.browser !== socket) { try { channel.browser.close(1008, 'replaced'); } catch {} }
    channel.browser = socket; touch(channel);
    socket.on('message', raw => onBrowserMessage(channel, raw, context));
    socket.on('close', () => { if (channel.browser === socket) channel.browser = null; });
    socket.on('error', () => {});
    if (channel.ready) safeSend(socket, { type: 'ready', protocol: PROTOCOL, relayId, profile: relay.status(relayId, context).profile });
    return channel;
  }
  function awaitDevice(channel, timeoutMs) {
    if (channel.ready && isSocketOpen(channel.device)) return Promise.resolve(channel);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { const index = channel.waiters.findIndex(item => item.resolve === resolve); if (index >= 0) channel.waiters.splice(index, 1); reject(Object.assign(new Error('device relay not ready'), { code: 'DSH_PLUGIN_UI_RELAY_DEVICE_OFFLINE', status: 503 })); }, timeoutMs);
      channel.waiters.push({ resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
  }
  function sendInput(channel, input) {
    const message = { type: 'input', relayId: channel.relayId, seq: ++channel.serverSeq, ...input };
    touch(channel); safeSend(channel.device, message);
  }
  function onDeviceReady(channel, frame) {
    if (!object(frame) || frame.type !== 'ready' || frame.protocol !== PROTOCOL || frame.relayId !== channel.relayId || !string(frame.deviceId, 200) || !string(frame.workspace, 200) || !string(frame.profile, 80) || !string(frame.viewKey, 200) || !string(frame.actionId, 200)) { closeChannel(channel, 1008, 'invalid ready'); return; }
    try { relay.assertDevice(channel.relayId, { deviceId: frame.deviceId, workspace: frame.workspace, profile: frame.profile, viewKey: frame.viewKey, actionId: frame.actionId }); } catch { closeChannel(channel, 1008, 'invalid ready'); return; }
    if (channel.expectedDeviceId && channel.expectedDeviceId !== frame.deviceId) { closeChannel(channel, 1008, 'device mismatch'); return; }
    channel.ready = true; channel.deviceSeq = 0; touch(channel);
    safeSend(channel.device, { type: 'ready', protocol: PROTOCOL, relayId: channel.relayId, accepted: true });
    for (const waiter of channel.waiters.splice(0)) waiter.resolve(channel);
    if (channel.browser && isSocketOpen(channel.browser)) safeSend(channel.browser, { type: 'ready', protocol: PROTOCOL, relayId: channel.relayId, profile: frame.profile });
  }
  function onDeviceMessage(channel, raw) {
    if (Buffer.byteLength(raw) > MAX_FRAME_BYTES) { closeChannel(channel, 1009, 'frame too large'); return; }
    let frame; try { frame = parseJson(raw); } catch { closeChannel(channel, 1008, 'invalid frame'); return; }
    touch(channel);
    if (!channel.ready) { if (frame?.type === 'ready') onDeviceReady(channel, frame); else closeChannel(channel, 1008, 'ready required'); return; }
    if (!object(frame) || frame.relayId !== channel.relayId || !Number.isSafeInteger(frame.seq) || frame.seq <= channel.deviceSeq) { closeChannel(channel, 1008, 'invalid sequence'); return; }
    channel.deviceSeq = frame.seq;
    if (frame.type === 'close') { closeChannel(channel, 1000, string(frame.reason, 120) ? frame.reason : 'device closed'); return; }
    if (frame.type === 'error') { const error = Object.assign(new Error(string(frame.message, 240) ? frame.message : 'device relay error'), { code: frame.code || 'DSH_PLUGIN_UI_RELAY_DEVICE_ERROR', status: 502 }); const pending = channel.pending.get(frame.requestId); if (pending) { clearTimeout(pending.timer); channel.pending.delete(frame.requestId); pending.reject(error); } else closeChannel(channel, 1011, error.message); return; }
    if (frame.type !== 'frame' || !string(frame.requestId, 200) || !['http', 'sse', 'ws'].includes(frame.kind)) { closeChannel(channel, 1008, 'invalid frame'); return; }
    let body, headers;
    try { body = decodeBody(frame.bodyBase64); headers = headerAllowlist(frame.headersAllowlist, RESPONSE_HEADERS); } catch { closeChannel(channel, 1008, 'invalid response frame'); return; }
    const pending = channel.pending.get(frame.requestId);
    if (pending) {
      try { pending.onFrame?.({ ...frame, headersAllowlist: headers, body }); } catch (error) { pending.reject(error); }
      // Device frames use `end` to mark the terminal chunk.  HTTP can resolve
      // after its single response frame; SSE must stay open until the explicit
      // terminal frame so the browser receives the complete event stream.
      if (pending.kind === 'http' || frame.end === true || frame.final === true) { clearTimeout(pending.timer); channel.pending.delete(frame.requestId); pending.resolve({ status: Number(frame.status) || 200, headers, body }); }
    } else if (frame.kind === 'ws' && channel.browser && isSocketOpen(channel.browser)) {
      try { channel.browser.send(body); } catch { closeChannel(channel, 1011, 'browser disconnected'); }
    }
  }
  function onBrowserMessage(channel, raw, context) {
    try { checkLive(channel, context); } catch { closeChannel(channel, 1008, 'relay revoked'); return; }
    if (Buffer.byteLength(raw) > MAX_FRAME_BYTES) { closeChannel(channel, 1009, 'frame too large'); return; }
    let frame;
    try { frame = Buffer.isBuffer(raw) ? null : parseJson(raw); } catch { frame = null; }
    // The browser-facing WebSocket carries the native DSH mux bytes directly.
    // Only our optional relay envelope is decoded; arbitrary JSON from the
    // plugin must be forwarded byte-for-byte instead of being treated as an
    // empty `{body}` field.
    const rawBytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
    const body = frame?.type === 'input' && frame.kind === 'ws' && frame.bodyBase64 !== undefined
      ? decodeBody(frame.bodyBase64)
      : rawBytes;
    if (body.length > 512 * 1024) { closeChannel(channel, 1009, 'frame too large'); return; }
    if (frame?.type === 'input' && frame.kind !== 'ws') { closeChannel(channel, 1008, 'browser input kind invalid'); return; }
    sendInput(channel, { kind: 'ws', requestId: string(frame?.requestId, 200) ? frame.requestId : randomUUID(), headersAllowlist: {}, bodyBase64: encodeBody(body) });
  }
  function forward(relayId, input, context = {}, { onFrame } = {}) {
    const method = String(input.method || '').toUpperCase();
    if (!METHODS.has(method) || !string(input.path, 2048) || !string(input.requestId, 200)) return Promise.reject(Object.assign(new Error('DSH_PLUGIN_UI_RELAY_REQUEST_INVALID'), { code: 'DSH_PLUGIN_UI_RELAY_REQUEST_INVALID', status: 400 }));
    const channel = channelFor(relayId);
    let request;
    try { request = relay.assertRequest(relayId, { method, path: input.path, headers: headerAllowlist(input.headers, REQUEST_HEADERS), bodyBase64: input.bodyBase64 || '', requestId: input.requestId }, context); } catch (error) { return Promise.reject(error); }
    const kind = input.kind === 'sse' ? 'sse' : 'http';
    return awaitDevice(channel, kind === 'sse' ? streamTimeoutMs : requestTimeoutMs).then(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { channel.pending.delete(request.requestId); reject(Object.assign(new Error('DSH_PLUGIN_UI_RELAY_TIMEOUT'), { code: 'DSH_PLUGIN_UI_RELAY_TIMEOUT', status: 504 })); }, kind === 'sse' ? streamTimeoutMs : requestTimeoutMs);
      channel.pending.set(request.requestId, { kind, timer, resolve, reject, onFrame });
      try { sendInput(channel, { kind, requestId: request.requestId, method: request.method, path: request.path, headersAllowlist: request.headers, bodyBase64: request.bodyBase64 }); } catch (error) { clearTimeout(timer); channel.pending.delete(request.requestId); reject(error); }
    }));
  }
  function runtimeRelay(req) {
    const queryRelay = req.query?.dshPluginUiRelay || req.query?.relayId;
    const queryView = req.query?.viewKey;
    const fromCookie = parseRelayCookie(cookieValue(req.headers.cookie));
    return queryRelay ? { relayId: String(queryRelay), viewKey: String(queryView || '') , initial: true } : fromCookie ? { ...fromCookie, initial: false } : null;
  }
  async function proxyRuntimeHttp(req, res, context) {
    const profile = String(req.params.profile || '');
    if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(profile)) return res.status(404).json({ error: 'DSH Profile invalid' });
    const relayInfo = runtimeRelay(req); if (!relayInfo) return res.status(401).json({ error: 'DSH relay cookie required' });
    const row = relay.assertBrowser(relayInfo.relayId, { ...context, viewKey: relayInfo.viewKey });
    if (row.profile !== profile) return res.status(409).json({ error: 'DSH relay profile changed' });
    // DSH UI assets live under /ui/, while its native remote.mux WebSocket is
    // under /api/remote.mux.  Scope the host-only cookie to the profile root
    // so both paths carry the same relay binding; never use Path=/.
    if (relayInfo.initial) res.setHeader('Set-Cookie', `ziwei_dsh_relay=${encodeURIComponent(relayCookie(row.relayId, row.viewKey))}; Path=/runtime/${encodeURIComponent(row.profile)}/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1, Math.floor((Date.parse(row.expiresAt) - now()) / 1000))}`);
    const suffix = String(req.path || '/');
    const query = new URL(req.originalUrl || '/', 'http://ziwei.invalid').searchParams;
    query.delete('dshPluginUiRelay'); query.delete('relayId'); query.delete('viewKey');
    const search = query.toString();
    const path = `/runtime/${encodeURIComponent(row.profile)}/ui/${suffix.replace(/^\/+/, '')}${search ? `?${search}` : ''}`;
    const headers = {}; for (const [key, value] of Object.entries(req.headers || {})) { const normalized = key.toLowerCase(); if (REQUEST_HEADERS.has(normalized) && typeof value === 'string') headers[normalized] = value; }
    const body = req.method === 'GET' || req.method === 'HEAD' ? '' : encodeBody(Buffer.from(req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body || ''), 'utf8'));
    const kind = /text\/event-stream/i.test(String(req.headers.accept || '')) || /\/events(?:\/|$)/.test(suffix) ? 'sse' : 'http';
    let wrote = false;
    try {
      const result = await forward(row.relayId, { kind, method: req.method, path, headers, bodyBase64: body, requestId: randomUUID() }, context, { onFrame: frame => {
        if (!wrote) { wrote = true; res.statusCode = Number(frame.status) >= 100 && Number(frame.status) <= 599 ? Number(frame.status) : 200; for (const [key, value] of Object.entries(frame.headersAllowlist || {})) res.setHeader(key, value); if (kind === 'sse' && !res.getHeader('content-type')) res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', res.getHeader('cache-control') || 'no-store'); }
        if (req.method !== 'HEAD') res.write(frame.body);
        if (frame.end === true || frame.final === true || kind === 'http') res.end();
      }});
      if (!wrote) { res.statusCode = result.status; for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value); if (req.method !== 'HEAD') res.end(result.body); else res.end(); }
      return result;
    } catch (error) { if (!res.headersSent) return res.status(error.status || 502).json({ error: error.message, code: error.code }); try { res.destroy(); } catch {} return null; }
  }
  function runtimeUpgrade(req, socket, head, context, relayInfo) {
    const info = relayInfo || parseRelayCookie(cookieValue(req.headers.cookie)); if (!info) return false;
    const row = relay.assertBrowser(info.relayId, { ...context, viewKey: info.viewKey });
    const channel = bindBrowser(row.relayId, socket, context, row.viewKey);
    socket.__ziweiRelay = channel;
    if (!head?.length) return true;
    return true;
  }
  return { bindDevice, acceptDevice, bindBrowser, forward, proxyRuntimeHttp, runtimeRelay, runtimeUpgrade, close: relayId => closeChannel(channels.get(relayId), 1000, 'closed'), channel: relayId => channels.get(relayId) };
}

export { MAX_FRAME_BYTES, MAX_BODY_BASE64, PROTOCOL, parseRelayCookie, cookieValue, relayCookie, profilePath };
