export const CHAT_SEARCH_QUERY_LIMIT = 200;
export const CHAT_SEARCH_RESULT_LIMIT = 100;
export const CHAT_SEARCH_EXCERPT_LIMIT = 240;

const rows = value => Array.isArray(value) ? value : [];
const roleOf = value => value?.role || value?.sender_role || value?.senderRole;
const ordinary = value => ['user', 'assistant'].includes(roleOf(value));
const textOf = value => typeof value?.content === 'string' ? value.content : typeof value?.text === 'string' ? value.text : '';
const stableId = value => typeof value === 'string' && value && value.length <= 200 && value === value.trim() && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value) ? value : '';

function tooLong(value, limit) {
  let length = 0;
  for (const _ of value) if (++length > limit) return true;
  return false;
}

// Move across code points while retaining UTF-16 offsets for DOM text ranges.
function advance(text, index, count) {
  while (count > 0 && index < text.length) {
    const point = text.codePointAt(index);
    index += point > 0xffff ? 2 : 1;
    count--;
  }
  return index;
}

function retreat(text, index, count) {
  while (count > 0 && index > 0) {
    index--;
    const unit = text.charCodeAt(index);
    if (unit >= 0xdc00 && unit <= 0xdfff && index > 0) {
      const previous = text.charCodeAt(index - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) index--;
    }
    count--;
  }
  return index;
}

function firstMatch(pattern, text) {
  pattern.lastIndex = 0;
  return pattern.exec(text);
}

function resultFor(message, candidate, pattern, first) {
  const text = candidate.text;
  const excerptStart = retreat(text, first.index, 24);
  const excerptEnd = advance(text, excerptStart, CHAT_SEARCH_EXCERPT_LIMIT);
  const ranges = [];
  let matchCount = 0;
  pattern.lastIndex = 0;
  for (let match; (match = pattern.exec(text));) {
    matchCount++;
    const end = match.index + match[0].length;
    if (match.index >= excerptStart && end <= excerptEnd) ranges.push({ start: match.index - excerptStart, end: end - excerptStart });
  }
  return {
    messageId: message.id,
    parentMessageId: message.id,
    role: candidate.role,
    source: candidate.source,
    quoteIndex: candidate.quoteIndex,
    excerpt: text.slice(excerptStart, excerptEnd),
    excerptStart,
    excerptEnd,
    leadingEllipsis: excerptStart > 0,
    trailingEllipsis: excerptEnd < text.length,
    matchCount,
    ranges,
  };
}

/**
 * Search only loaded, visibly rendered chat text. One result per unambiguous
 * parent message, in history order; a forward selects its first matching quote.
 * Offsets/ranges use UTF-16, not escaped HTML. Renderers must escape excerpts.
 * total counts matching parent messages; matchCount counts nonoverlapping
 * occurrences in the selected body/quote. Nothing is fetched or modified.
 */
export function searchChatMessages(messages, query) {
  const normalized = typeof query === 'string' ? query.trim() : '';
  const queryTooLong = tooLong(normalized, CHAT_SEARCH_QUERY_LIMIT);
  const output = { query: normalized, queryTooLong, results: [], total: 0, hasMore: false, limit: CHAT_SEARCH_RESULT_LIMIT };
  if (!normalized || queryTooLong) return output;

  // Escape every regular-expression metacharacter. The query is always literal.
  const pattern = new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const ids = new Map();
  for (const message of rows(messages)) {
    const id = stableId(message?.id);
    if (id) ids.set(id, (ids.get(id) || 0) + 1);
  }
  for (const message of rows(messages)) {
    const id = stableId(message?.id);
    if (!id || ids.get(id) !== 1 || !ordinary(message)) continue;
    const forward = message.forward;
    // Match the chat renderer: a valid forward hides its generated wrapper body.
    const candidates = forward?.schemaVersion === 1 && Array.isArray(forward.messages)
      ? forward.messages.flatMap((quote, quoteIndex) => ordinary(quote) ? [{ text: textOf(quote), role: roleOf(quote), source: 'forward', quoteIndex }] : [])
      : [{ text: textOf(message), role: roleOf(message), source: 'message', quoteIndex: null }];
    for (const candidate of candidates) {
      const match = firstMatch(pattern, candidate.text);
      if (!match) continue;
      output.total++;
      if (output.results.length < CHAT_SEARCH_RESULT_LIMIT) output.results.push(resultFor(message, candidate, pattern, match));
      break;
    }
  }
  output.hasMore = output.total > output.results.length;
  return output;
}
