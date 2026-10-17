import { accountId, workspaceId } from './model.js';

const ID = /^[A-Za-z0-9._:-]{1,160}$/;

// Presence is a short-lived hint for one currently visible chat, never a read
// receipt or authority to subscribe to another user's messages. Native owns
// the installation proof; the server checks the current session and chat.
export function createNotificationPresence({ state, native, visible = () => !globalThis.document?.hidden, now = Date.now } = {}) {
  let previous = '', lastSent = 0, active = false, disposed = false;
  function send(conversationId) {
    try { const pending = native?.setForeground?.(conversationId); pending?.catch?.(() => {}); } catch {}
  }
  function sync() {
    if (disposed || typeof native?.setForeground !== 'function') return;
    const conversationId = state.phase === 'ready' && visible() && state.page === 'chat'
      && !state.imagePreview && !state.forward && !state.forwardDetail && !state.chatFind
      && ID.test(state.conversation?.id || '') ? state.conversation.id : '';
    const account = accountId(state), workspace = workspaceId(state);
    const next = account && workspace && conversationId ? JSON.stringify([account, workspace, state.workspace?.id || '', conversationId]) : '';
    const at = now();
    if (next !== previous || next && at - lastSent >= 20000) {
      send(next ? conversationId : ''); previous = next; lastSent = at; active = Boolean(next);
    }
  }
  function clear() { if (active) send(''); previous = ''; active = false; lastSent = 0; }
  return { sync, pause: clear, dispose() { clear(); disposed = true; } };
}
