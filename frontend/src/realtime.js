// One workspace subscription with WebSocket preference, SSE fallback and
// bounded reconnect delays. A ready event triggers compensation through the
// caller so a disconnect cannot permanently hide persisted notifications.
export function connectWorkspaceRealtime({ wsUrl, sseUrl, onEvent, onReady, WebSocketClass = globalThis.WebSocket, EventSourceClass = globalThis.EventSource, schedule = setTimeout, cancel = clearTimeout }) {
  let stopped = false;
  let transport = null;
  let retry = null;
  let attempts = 0;
  let connectionTimeout = null;
  let fallbackStarted = false;
  const cleanTransport = () => {
    if (connectionTimeout) cancel(connectionTimeout);
    connectionTimeout = null;
    if (transport) {
      transport.onopen = transport.onerror = transport.onclose = transport.onmessage = null;
      transport.close();
    }
    transport = null;
  };
  const ready = () => { attempts = 0; onReady?.(); };
  const reconnect = () => {
    cleanTransport();
    if (stopped || retry) return;
    retry = schedule(() => { retry = null; connect(); }, Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)));
  };
  const connectSse = () => {
    if (fallbackStarted || stopped) return;
    fallbackStarted = true;
    cleanTransport();
    if (!EventSourceClass) { reconnect(); return; }
    try {
      const source = new EventSourceClass(sseUrl, { withCredentials: true });
      transport = source;
      source.addEventListener('notification', message => {
        if (stopped || transport !== source) return;
        try { const event = JSON.parse(message.data); if (event.type === 'ready') ready(); else onEvent?.(event); } catch {}
      });
      source.onerror = reconnect;
    } catch { reconnect(); }
  };
  const connect = () => {
    if (stopped) return;
    fallbackStarted = false;
    if (!WebSocketClass) { connectSse(); return; }
    try {
      const socket = new WebSocketClass(wsUrl);
      transport = socket;
      let opened = false;
      connectionTimeout = schedule(connectSse, 5000);
      socket.onopen = () => { opened = true; if (connectionTimeout) cancel(connectionTimeout); connectionTimeout = null; };
      socket.onmessage = message => {
        if (stopped || transport !== socket) return;
        try { const payload = JSON.parse(message.data); if (payload.type === 'ready') ready(); else if (payload.type === 'notification') onEvent?.(payload.event); } catch {}
      };
      socket.onerror = () => { if (!opened) connectSse(); };
      socket.onclose = () => { if (opened) reconnect(); else connectSse(); };
    } catch { connectSse(); }
  };
  connect();
  return { close() { stopped = true; if (retry) cancel(retry); retry = null; cleanTransport(); } };
}
