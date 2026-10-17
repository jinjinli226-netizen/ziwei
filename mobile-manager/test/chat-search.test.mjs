import test from 'node:test';
import assert from 'node:assert/strict';
import { searchChatMessages, CHAT_SEARCH_QUERY_LIMIT, CHAT_SEARCH_RESULT_LIMIT, CHAT_SEARCH_EXCERPT_LIMIT } from '../web/chat-search.js';

const message = (id, content, extra = {}) => ({ id, role: 'user', content, ...extra });
const forward = (id, quotes, extra = {}) => message(id, '隐藏的转发包装文案', { forward: { schemaVersion: 1, messages: quotes }, ...extra });
const highlighted = result => result.ranges.map(range => result.excerpt.slice(range.start, range.end));

test('literal Chinese search trims the query and keeps loaded history order and roles', () => {
  const rows = [message('two', '找到了订单二', { role: 'assistant' }), message('one', '订单一的订单记录'), message('miss', '别的内容')];
  const result = searchChatMessages(rows, '  订单  ');
  assert.equal(result.query, '订单');
  assert.equal(result.queryTooLong, false);
  assert.equal(result.total, 2);
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.results.map(row => [row.messageId, row.parentMessageId, row.role, row.source, row.quoteIndex, row.matchCount]), [
    ['two', 'two', 'assistant', 'message', null, 1], ['one', 'one', 'user', 'message', null, 2],
  ]);
  assert.deepEqual(highlighted(result.results[1]), ['订单', '订单']);
});

test('case insensitive matching has correct original UTF-16 ranges around emoji and Unicode letters', () => {
  const text = '😀开头 AbC / aBc / Kelvin / Σ / ς';
  assert.deepEqual(highlighted(searchChatMessages([message('unicode', text)], 'abc').results[0]), ['AbC', 'aBc']);
  assert.deepEqual(highlighted(searchChatMessages([message('unicode', text)], 'kelvin').results[0]), ['Kelvin']);
  assert.deepEqual(highlighted(searchChatMessages([message('unicode', text)], 'σ').results[0]), ['Σ', 'ς']);
  const emoji = searchChatMessages([message('unicode', text)], '😀').results[0];
  assert.deepEqual(emoji.ranges, [{ start: 0, end: 2 }]);
});

test('only user and assistant bodies are searched, without attachment or hidden metadata text', () => {
  const result = searchChatMessages([
    message('system', 'needle', { role: 'system' }), message('tool', 'needle', { role: 'tool' }),
    message('unknown', 'needle', { role: 'human' }), message('obj', { text: 'needle' }),
    message('image', '', { attachments: [{ name: 'needle', content: 'needle' }], metadata: { text: 'needle' } }),
    { id: 'legacy', sender_role: 'assistant', text: 'needle' },
  ], 'needle');
  assert.deepEqual(result.results.map(row => row.messageId), ['legacy']);
});

test('forward hits retain the stable parent and quote index, excluding internal roles and wrapper text', () => {
  const row = forward('saved-forward', [
    { role: 'tool', content: '订单' }, { role: 'assistant', content: '订单和订单' }, { role: 'user', content: '订单' },
  ]);
  const found = searchChatMessages([row], '订单');
  assert.equal(found.total, 1);
  assert.deepEqual(found.results.map(hit => [hit.messageId, hit.parentMessageId, hit.quoteIndex, hit.role, hit.source, hit.matchCount]), [
    ['saved-forward', 'saved-forward', 1, 'assistant', 'forward', 2],
  ]);
  assert.equal(searchChatMessages([row], '隐藏的转发包装文案').total, 0);
  assert.equal(searchChatMessages([forward('system-forward', [{ role: 'user', content: '订单' }], { role: 'system' })], '订单').total, 0);
});

test('empty or non-string queries do not match anything and malformed input is harmless', () => {
  for (const query of ['', ' \n\t ', null, undefined, 1, {}]) {
    const result = searchChatMessages([message('one', 'anything')], query);
    assert.deepEqual(result.results, []);
    assert.equal(result.total, 0);
    assert.equal(result.hasMore, false);
    assert.equal(result.queryTooLong, false);
  }
  for (const messages of [null, undefined, {}, [null, undefined, 2, {}]]) assert.equal(searchChatMessages(messages, 'needle').total, 0);
});

test('query limits count Unicode code points and reject a long query without silently truncating it', () => {
  const within = '😀'.repeat(CHAT_SEARCH_QUERY_LIMIT);
  assert.equal(searchChatMessages([message('one', within)], within).total, 1);
  const over = searchChatMessages([message('one', within)], `${within}多`);
  assert.equal(over.queryTooLong, true);
  assert.equal(over.total, 0);
  assert.deepEqual(over.results, []);
});

test('script strings and every regex metacharacter are searched as literal text, without escaping the result', () => {
  const literal = '<script>alert("x")</script> .*+?^${}()|[]\\';
  const found = searchChatMessages([message('literal', literal), message('other', 'any unrelated string')], literal);
  assert.equal(found.total, 1);
  assert.equal(found.results[0].excerpt, literal);
  assert.deepEqual(highlighted(found.results[0]), [literal]);
  for (const query of ['[', '\\', '.*', 'a|b', '(a+)+$']) {
    const result = searchChatMessages([message('literal', query), message('other', 'aaaaaaaaaa')], query);
    assert.deepEqual(result.results.map(row => row.messageId), ['literal']);
  }
});

test('empty, numeric, whitespace, control-character and ambiguous duplicate IDs cannot invent a location', () => {
  const result = searchChatMessages([
    message('', 'needle'), message(123, 'needle'), message(' spaced ', 'needle'), message('new\nline', 'needle'),
    message('null\0id', 'needle'), message('x'.repeat(201), 'needle'),
    message('duplicate', 'needle'), message('duplicate', 'other'),
    message('also-duplicate', 'needle'), message('also-duplicate', 'internal', { role: 'tool' }),
    message('valid', 'needle'),
  ], 'needle');
  assert.deepEqual(result.results.map(row => row.messageId), ['valid']);
});

test('large messages keep complete match counts, bounded snippets and offsets without splitting surrogate pairs', () => {
  const text = '😀'.repeat(200000) + '目标'.repeat(400) + '结尾'.repeat(200000);
  const hit = searchChatMessages([message('large', text)], '目标').results[0];
  assert.equal(hit.matchCount, 400);
  assert.equal([...hit.excerpt].length, CHAT_SEARCH_EXCERPT_LIMIT);
  assert.equal(hit.excerptStart, 400000 - 48);
  assert.equal(hit.excerpt, text.slice(hit.excerptStart, hit.excerptEnd));
  assert.equal(hit.leadingEllipsis, true);
  assert.equal(hit.trailingEllipsis, true);
  assert.equal(hit.excerpt.startsWith('😀'.repeat(24)), true);
  assert.equal(highlighted(hit).every(value => value === '目标'), true);
  assert.equal(hit.ranges.length > 0 && hit.ranges.length <= CHAT_SEARCH_EXCERPT_LIMIT, true);
});

test('one result per message counts nonoverlapping occurrences and truncates only the returned result list', () => {
  const rows = Array.from({ length: CHAT_SEARCH_RESULT_LIMIT + 27 }, (_, i) => message(`m${i}`, 'aaaa'));
  const result = searchChatMessages(rows, 'aa');
  assert.equal(result.limit, CHAT_SEARCH_RESULT_LIMIT);
  assert.equal(result.results.length, CHAT_SEARCH_RESULT_LIMIT);
  assert.equal(result.total, CHAT_SEARCH_RESULT_LIMIT + 27);
  assert.equal(result.hasMore, true);
  assert.equal(result.results[0].matchCount, 2);
  assert.equal(result.results.at(-1).messageId, `m${CHAT_SEARCH_RESULT_LIMIT - 1}`);
});

test('search is repeatable and does not mutate frozen ordinary messages or forward snapshots', () => {
  const quote = Object.freeze({ role: 'assistant', content: '保存的订单正文' });
  const record = Object.freeze({ schemaVersion: 1, messages: Object.freeze([quote]) });
  const rows = Object.freeze([Object.freeze(message('ordinary', '订单')), Object.freeze(message('forward', 'wrapper', { forward: record }))]);
  const before = JSON.stringify(rows);
  const first = searchChatMessages(rows, '订单');
  assert.deepEqual(searchChatMessages(rows, '订单'), first);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(rows[1].forward.messages[0], quote);
});
