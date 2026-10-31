import WebSocket from 'ws';
import { createHash } from 'node:crypto';

export const DSH_PLUGIN_UI_RELAY_FEATURE = 'dsh_plugin_ui_relay_v1';
export const DSH_PLUGIN_UI_RELAY_TYPE = 'employee.dsh.ui.relay.open';
export const DSH_PLUGIN_UI_RELAY_PROTOCOL = 'dsh-plugin-ui-relay-v1';
export const DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES = 512 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES / 3) * 4 + 4;
const MAX_HEADER_VALUE_LENGTH = 2_000;
const MAX_PATH_LENGTH = 2_048;
const MAX_QUERY_LENGTH = 1_000;
const ALLOWED_REQUEST_HEADERS = new Set(['accept', 'cache-control', 'content-type', 'last-event-id', 'x-requested-with']);
const ALLOWED_RESPONSE_HEADERS = new Set(['cache-control', 'content-type', 'etag', 'last-modified']);
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const safeErrorCode = value => typeof value === 'string' && /^DSH_PLUGIN_UI_RELAY_[A-Z0-9_]+$/.test(value) ? value : 'DSH_PLUGIN_UI_RELAY_UPSTREAM_ERROR';

function sameOrigin(left, right) {
  try { return new URL(left).origin === new URL(right).origin; } catch { return false; }
}

function sameWebOrigin(left, right) {
  try {
    const expected = new URL(left), actual = new URL(right);
    const protocol = actual.protocol === 'ws:' ? 'http:' : actual.protocol === 'wss:' ? 'https:' : actual.protocol;
    return expected.protocol === protocol && expected.hostname === actual.hostname && expected.port === actual.port;
  } catch { return false; }
}

function normalizeBaseUrl(value, { protocols = ['http:', 'https:'] } = {}) {
  let url;
  try { url = new URL(String(value)); } catch { fail('DSH_PLUGIN_UI_RELAY_URL_INVALID'); }
  if (!protocols.includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('DSH_PLUGIN_UI_RELAY_URL_INVALID');
  return url.toString().replace(/\/$/, '');
}

function validateProfile(value) {
  if (!text(value, 80) || /[\\/]/.test(value)) fail('DSH_PLUGIN_UI_RELAY_PROFILE_INVALID');
  return value;
}

function validatePath(profile, value, kind = 'http') {
  if (!text(value, MAX_PATH_LENGTH) || value.includes('\\') || value.includes('#') || /^(?:https?:)?\/\//i.test(value)) fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID');
  const [rawPath, query = ''] = value.split('?', 2);
  if (query.length > MAX_QUERY_LENGTH || /[\u0000-\u001f\u007f]/.test(query)) fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID');
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID'); }
  if (decoded.includes('..') || /[\u0000-\u001f\u007f\\]/.test(decoded)) fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID');
  const encodedProfile = encodeURIComponent(profile);
  const uiBase = `/runtime/${encodedProfile}/ui/`;
  const muxPath = `/runtime/${encodedProfile}/api/remote.mux`;
  if (kind === 'ws' ? rawPath !== muxPath : !rawPath.startsWith(uiBase)) fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID');
  if (kind === 'sse' && rawPath !== `${uiBase}plugins/events`) fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID');
  return value;
}

function validateHeaders(headers = {}) {
  if (!object(headers) || Object.keys(headers).length > 16) fail('DSH_PLUGIN_UI_RELAY_HEADERS_INVALID');
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = String(key).toLowerCase();
    if (!ALLOWED_REQUEST_HEADERS.has(name) || !text(value, MAX_HEADER_VALUE_LENGTH)) fail('DSH_PLUGIN_UI_RELAY_HEADERS_INVALID');
    normalized[name] = value;
  }
  return normalized;
}

function decodeBody(value) {
  if (value === undefined || value === '') return Buffer.alloc(0);
  if (!text(value, MAX_BASE64_LENGTH) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('DSH_PLUGIN_UI_RELAY_BODY_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES) fail('DSH_PLUGIN_UI_RELAY_FRAME_TOO_LARGE');
  return bytes;
}

function encodeBody(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  if (bytes.length > DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES) fail('DSH_PLUGIN_UI_RELAY_FRAME_TOO_LARGE');
  return bytes.toString('base64');
}

function responseHeaders(response) {
  const headers = {};
  for (const [key, value] of response.headers || []) {
    const name = String(key).toLowerCase();
    if (ALLOWED_RESPONSE_HEADERS.has(name) && text(String(value), MAX_HEADER_VALUE_LENGTH)) headers[name] = String(value);
  }
  return headers;
}

async function* responseChunks(response, signal) {
  if (response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of response.body) { if (signal?.aborted) fail('DSH_PLUGIN_UI_RELAY_CANCELLED'); yield Buffer.from(chunk); }
    return;
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    try { while (true) { if (signal?.aborted) fail('DSH_PLUGIN_UI_RELAY_CANCELLED'); const item = await reader.read(); if (item.done) break; yield Buffer.from(item.value); } }
    finally { try { reader.releaseLock(); } catch {} }
    return;
  }
  yield Buffer.from(await response.arrayBuffer());
}

async function readBodyBounded(response, maxBytes, signal) {
  const chunks = [];
  let total = 0;
  for await (const bytes of responseChunks(response, signal)) {
    total += bytes.length;
    if (total > maxBytes) fail('DSH_PLUGIN_UI_RELAY_FRAME_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

function safeReason(value, fallback = 'closed') {
  return text(value, 160) ? value : fallback;
}

function validateAction(action, options) {
  if (!action || action.type !== DSH_PLUGIN_UI_RELAY_TYPE || !object(action.payload)) fail('DSH_PLUGIN_UI_RELAY_ACTION_INVALID');
  const payload = action.payload;
  const workspace = String(payload.workspace ?? action.workspace ?? '');
  const employeeId = String(payload.employeeId ?? payload.employee_id ?? '');
  const deviceId = String(payload.deviceId ?? payload.device_id ?? '');
  const profile = validateProfile(String(payload.profile ?? ''));
  const viewKey = String(payload.viewKey ?? payload.view_key ?? '');
  const relayId = String(payload.relayId ?? payload.relay_id ?? '');
  if (!text(workspace, 240) || !text(employeeId, 240) || !text(deviceId, 240) || !/^[A-Za-z0-9._:-]{16,200}$/.test(viewKey) || !/^[A-Za-z0-9._:-]{1,200}$/.test(relayId)) fail('DSH_PLUGIN_UI_RELAY_BINDING_INVALID');
  if (options.workspace && workspace !== options.workspace || options.deviceId && deviceId !== options.deviceId) fail('DSH_PLUGIN_UI_RELAY_BINDING_INVALID');
  if (action.workspace && String(action.workspace) !== workspace) fail('DSH_PLUGIN_UI_RELAY_BINDING_INVALID');
  if (!text(String(options.deviceToken || ''), 1000)) fail('DSH_PLUGIN_UI_RELAY_DEVICE_TOKEN_REQUIRED');
  const dshBaseUrl = normalizeBaseUrl(payload.dshBaseUrl ?? payload.dsh_base_url ?? options.dshBaseUrl);
  // The daemon owns the local Hub base path.  Matching only the origin would
  // let a forged action redirect the relay into another local HTTP path.
  if (options.dshBaseUrl && dshBaseUrl !== String(options.dshBaseUrl).replace(/\/$/, '')) fail('DSH_PLUGIN_UI_RELAY_DSH_URL_MISMATCH');
  const relayOrigin = normalizeBaseUrl(options.apiBase, { protocols: ['http:', 'https:'] });
  let relayUrl = payload.relayUrl ?? payload.serverRelayUrl ?? payload.server_relay_url;
  if (!relayUrl) relayUrl = `${relayOrigin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/a2a/v1/dsh-ui-relays/${encodeURIComponent(relayId)}/device`;
  let relay;
  try { relay = new URL(String(relayUrl)); } catch { fail('DSH_PLUGIN_UI_RELAY_URL_INVALID'); }
  if (!['ws:', 'wss:'].includes(relay.protocol) || !sameWebOrigin(relayOrigin, relay.origin) || relay.username || relay.password || relay.search || relay.hash || relay.pathname !== `/a2a/v1/dsh-ui-relays/${encodeURIComponent(relayId)}/device`) fail('DSH_PLUGIN_UI_RELAY_URL_INVALID');
  const expiresAt = Date.parse(String(payload.expiresAt ?? payload.expires_at ?? ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) fail('DSH_PLUGIN_UI_RELAY_EXPIRED');
  const actionId = String(action.id ?? '');
  if (!text(actionId, 200)) fail('DSH_PLUGIN_UI_RELAY_ACTION_INVALID');
  const scopeHash = String(payload.scopeHash ?? payload.scope_hash ?? '');
  const expectedScopeHash = createHash('sha256').update(JSON.stringify({workspace,employeeId,deviceId,profile,viewKey,relayId})).digest('hex');
  if (scopeHash && scopeHash !== expectedScopeHash) fail('DSH_PLUGIN_UI_RELAY_SCOPE_MISMATCH');
  return { actionId, workspace, employeeId, deviceId, profile, viewKey, relayId, scopeHash: scopeHash || expectedScopeHash, relayUrl: relay.toString(), dshBaseUrl, expiresAt };
}

export function createDshPluginUiRelayClient({ apiBase, workspace = null, deviceId = null, deviceToken, dshBaseUrl = process.env.ZIWEI_DSH_BASE_URL || 'http://127.0.0.1:7878', fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket, now = Date.now, requestTimeoutMs = 10_000 } = {}) {
  if (!text(String(apiBase || ''), 2000)) throw new TypeError('apiBase is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const trustedDshBaseUrl = normalizeBaseUrl(dshBaseUrl);
  const trustedApiBase = normalizeBaseUrl(apiBase);

  async function execute(action, { signal, onActivity = () => {}, onStage = () => {} } = {}) {
    const binding = validateAction(action, {apiBase: trustedApiBase, workspace, deviceId, deviceToken, dshBaseUrl: trustedDshBaseUrl});
    let socket;
    let inputSequence = 0;
    let frameSequence = 0;
    let frames = 0;
    let closedReason = null;
    let fatalError = null;
    let ready = false;
    let inputQueue = Promise.resolve();
    let settled = false;
    const upstream = new Map();
    const requests = new Map();
    const aborters = new Set();
    const expireTimer = setTimeout(() => socket?.close(1000, 'expired'), Math.max(0, binding.expiresAt - now()));
    const clear = () => { clearTimeout(expireTimer); for (const controller of aborters) controller.abort(); for (const item of upstream.values()) { try { item.close(); } catch {} } upstream.clear(); requests.clear(); };
    const send = value => {
      if (!socket || socket.closed || socket.readyState === 3) return;
      try { socket.send(JSON.stringify(value)); }
      catch (error) { fatalError ||= Object.assign(new Error('DSH_PLUGIN_UI_RELAY_TRANSPORT_ERROR'), {code:'DSH_PLUGIN_UI_RELAY_TRANSPORT_ERROR',cause:error}); }
    };
    const sendError = (code, message = code, requestId = undefined) => send({type:'error',relayId:binding.relayId,seq:++frameSequence,...(text(requestId, 200) ? {requestId} : {}),code,message: safeReason(message)});
    const sendFrame = ({kind,requestId,status,headersAllowlist = {},body = Buffer.alloc(0),end = true}) => {
      const encoded = encodeBody(body);
      const value = {type:'frame',relayId:binding.relayId,seq:++frameSequence,kind,requestId,status,headersAllowlist,bodyBase64:encoded,end};
      if (JSON.stringify(value).length > DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES * 2) fail('DSH_PLUGIN_UI_RELAY_FRAME_TOO_LARGE');
      send(value); frames += 1; onActivity();
    };
    const urlFor = pathValue => `${binding.dshBaseUrl}${pathValue}`;
    const requestSignal = () => { const controller = new AbortController(); aborters.add(controller); const timer = setTimeout(() => controller.abort(), requestTimeoutMs); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, {once:true}); return {controller, cleanup: () => { clearTimeout(timer); aborters.delete(controller); signal?.removeEventListener('abort', abort); }}; };
    const dispatchHttp = async input => {
      const kind = input.kind;
      const path = validatePath(binding.profile, input.path, kind);
      if (!text(input.method, 10) || !HTTP_METHODS.has(String(input.method).toUpperCase())) fail('DSH_PLUGIN_UI_RELAY_INPUT_INVALID');
      const headers = validateHeaders(input.headersAllowlist ?? input.headers ?? {});
      if (kind === 'sse' && !headers.accept) headers.accept = 'text/event-stream';
      const body = decodeBody(input.bodyBase64);
      const request = requestSignal();
      try {
        const response = await fetchImpl(urlFor(path), {method: String(input.method).toUpperCase(), headers, ...(body.length ? {body} : {}), redirect:'error', signal: request.controller.signal});
        const responseHeaderValues = responseHeaders(response);
        if (kind === 'sse') {
          if (!String(response.headers?.get?.('content-type') || '').toLowerCase().includes('text/event-stream')) fail('DSH_PLUGIN_UI_RELAY_SSE_INVALID');
          let first = true; let sent = false;
          for await (const chunk of responseChunks(response, request.controller.signal)) {
            const bytes = Buffer.from(chunk); if (bytes.length === 0) continue;
            for (let offset = 0; offset < bytes.length; offset += DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES) {
              const piece = bytes.subarray(offset, Math.min(bytes.length, offset + DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES));
              sendFrame({kind,requestId:input.requestId,status:first ? response.status : undefined,headersAllowlist:first ? responseHeaderValues : {},body:piece,end:false}); first = false; sent = true;
            }
          }
          sendFrame({kind,requestId:input.requestId,status:first ? response.status : undefined,headersAllowlist:first ? responseHeaderValues : {},body:Buffer.alloc(0),end:true});
          if (!sent) onActivity();
        } else {
          const bytes = await readBodyBounded(response, DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES, request.controller.signal);
          sendFrame({kind,requestId:input.requestId,status:response.status,headersAllowlist:responseHeaderValues,body:bytes,end:true});
        }
      } finally { request.cleanup(); }
    };
    const dispatchWs = async input => {
      const path = input.path || `/runtime/${encodeURIComponent(binding.profile)}/api/remote.mux`;
      validatePath(binding.profile, path, 'ws');
      const body = decodeBody(input.bodyBase64);
      let channel = upstream.get(input.requestId);
      if (!channel) {
        const url = urlFor(path).replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
        channel = new WebSocketImpl(url);
        upstream.set(input.requestId, channel);
        channel.on('open', () => { if (body.length) channel.send(body); });
        channel.on('message', value => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); if (bytes.length > DSH_PLUGIN_UI_RELAY_MAX_FRAME_BYTES) { sendError('DSH_PLUGIN_UI_RELAY_FRAME_TOO_LARGE'); try { channel.close(1009, 'frame_too_large'); } catch {} return; } sendFrame({kind:'ws',requestId:input.requestId,body:bytes,end:false}); });
        channel.on('error', () => sendError('DSH_PLUGIN_UI_RELAY_UPSTREAM_ERROR'));
        channel.on('close', (code, reason) => { upstream.delete(input.requestId); send({type:'close',relayId:binding.relayId,seq:++frameSequence,kind:'ws',requestId:input.requestId,code,reason:safeReason(String(reason || ''), 'upstream_closed')}); });
      } else if (channel.readyState === 1 && body.length) channel.send(body);
    };
    const handle = async input => {
      if (!object(input) || input.type !== 'input' || input.relayId !== binding.relayId || !Number.isSafeInteger(input.seq) || input.seq !== inputSequence + 1 || !text(input.requestId, 200) || !['http','sse','ws'].includes(input.kind)) {
        sendError('DSH_PLUGIN_UI_RELAY_INPUT_INVALID', 'DSH_PLUGIN_UI_RELAY_INPUT_INVALID', input?.requestId); return;
      }
      inputSequence = input.seq; onActivity();
      try { if (input.kind === 'ws') await dispatchWs(input); else await dispatchHttp(input); }
      catch (error) { const code = safeErrorCode(error?.code); sendError(code, code, input.requestId); }
    };
    return await new Promise((resolve, reject) => {
      const finish = () => { if (settled) return; settled = true; clear(); if (fatalError) reject(fatalError); else resolve({status:'succeeded',result:{relayId:binding.relayId,profile:binding.profile,viewKey:binding.viewKey,frames,closedReason:safeReason(closedReason)}}); };
      const abort = () => { fatalError = Object.assign(new Error('DSH_PLUGIN_UI_RELAY_CANCELLED'), {code:'cancelled'}); try { socket?.close(1000, 'cancelled'); } catch {} finish(); };
      signal?.addEventListener('abort', abort, {once:true});
      try { socket = new WebSocketImpl(binding.relayUrl, {headers:{'x-ziwei-device-token':String(deviceToken),'x-ziwei-workspace':binding.workspace,'x-ziwei-device-id':binding.deviceId,'x-ziwei-relay-id':binding.relayId}}); }
      catch (error) { signal?.removeEventListener('abort', abort); fatalError = error; finish(); return; }
      socket.on('open', () => { ready = true; send({type:'ready',relayId:binding.relayId,actionId:binding.actionId,workspace:binding.workspace,deviceId:binding.deviceId,profile:binding.profile,viewKey:binding.viewKey,protocol:DSH_PLUGIN_UI_RELAY_PROTOCOL}); onStage({stage:'relay',message:'DSH 插件 UI relay 已连接',summary:{relayId:binding.relayId}}); });
      socket.on('message', raw => {
        if (!ready) return;
        let input; try { input = JSON.parse(String(raw)); } catch { sendError('DSH_PLUGIN_UI_RELAY_INPUT_INVALID'); return; }
        if (input?.type === 'close' && input.relayId === binding.relayId) { closedReason = safeReason(input.reason, 'server_closed'); try { socket.close(1000, closedReason); } catch {} return; }
        if (input?.type === 'ready' && input.relayId === binding.relayId && input.accepted === true) return;
        inputQueue = inputQueue.then(() => handle(input)).catch(error => { const code = safeErrorCode(error?.code); sendError(code, code, input?.requestId); });
      });
      socket.on('error', error => { if (!ready) { fatalError = Object.assign(new Error('DSH_PLUGIN_UI_RELAY_TRANSPORT_ERROR'), {code:'DSH_PLUGIN_UI_RELAY_TRANSPORT_ERROR',cause:error}); try { socket.close(); } catch {} } else sendError('DSH_PLUGIN_UI_RELAY_TRANSPORT_ERROR'); });
      socket.on('close', (code, reason) => {
        closedReason = String(reason || '') || closedReason || 'closed';
        if (code >= 1002 && code !== 1000) fatalError ||= Object.assign(new Error('DSH_PLUGIN_UI_RELAY_TRANSPORT_CLOSED'), {code:'DSH_PLUGIN_UI_RELAY_TRANSPORT_CLOSED'});
        signal?.removeEventListener('abort', abort); finish();
      });
    });
  }
  return Object.freeze({ execute, feature: DSH_PLUGIN_UI_RELAY_FEATURE });
}

export const validateDshPluginUiRelayPath = validatePath;
export const validateDshPluginUiRelayHeaders = validateHeaders;
