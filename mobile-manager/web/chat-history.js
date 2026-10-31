import { executionUncertain } from './bot-presentation.js';
import { failureFinalization } from './failure-finalization.mjs';

// Keep loaded older pages when polling the latest page. IDs and boundaries
// belong to the shared server, never to a phone-local transcript.
function mergeMessages(first, second) {
  const messages = [], indices = new Map();
  for (const message of [...first, ...second]) {
    if (indices.has(message.id)) {
      const index = indices.get(message.id);
      messages[index] = { ...messages[index], ...message };
    } else { indices.set(message.id, messages.length); messages.push(message); }
  }
  return messages.sort((a,b) => Date.parse(a.created_at || a.createdAt) - Date.parse(b.created_at || b.createdAt) || 0);
}
export function mergeLatestChat(current, incoming) {
  if (!incoming.messagePage || current?.id !== incoming.id) return incoming;
  if (current.messages.length && incoming.messages.length && !incoming.messages.some(message=>current.messages.some(previous=>previous.id===message.id))) return incoming;
  const messages = mergeMessages(current.messages, incoming.messages);
  const page = current.messages.length && messages[0]?.id === current.messages[0]?.id ? current.messagePage || incoming.messagePage : incoming.messagePage;
  return { ...current, ...incoming, messages, messagePage:{ ...page, total:incoming.messagePage.total, beforeCursor:messages[0]?.id || null } };
}
export function prependChatHistory(current, older) {
  if (current?.id !== older.id) return current;
  const messages = mergeMessages(older.messages, current.messages);
  return { ...current, messages, messagePage:{ ...older.messagePage, beforeCursor:messages[0]?.id || null, total:current.messagePage?.total ?? older.messagePage?.total } };
}
export function canQueueChat(state, blocking) {
  return Boolean(state.conversation?.queue && Array.isArray(state.conversation.queue.items) &&
    (!blocking || !executionUncertain(blocking) && !failureFinalization(blocking)));
}
