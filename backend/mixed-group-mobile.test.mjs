import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileMixedGroup, mobileMixedGroupList } from './mixed-group-mobile.mjs';
import { createApp } from './app.mjs';
import { createMixedGroupStore } from './mixed-group-store.mjs';
import { normalizeMixedGroup } from './mixed-groups.mjs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';

async function read(app, url) {
  const socket = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
  const req = new IncomingMessage(socket), res = new ServerResponse(req), chunks = [];
  req.method = 'GET'; req.url = url; req.headers = { host: 'mixed-group.fixture' };
  try {
    return await new Promise((resolve, reject) => {
      res.write = chunk => { chunks.push(Buffer.from(chunk)); return true; };
      res.end = chunk => { if (chunk) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks); resolve({ status: res.statusCode, bytes: body.length, json: JSON.parse(body) }); res.emit('finish'); return res; };
      app.handle(req, res, error => reject(error || new Error('Unhandled request'))); req.push(null);
    });
  } finally { socket.destroy(); }
}

const group = () => ({ id: 'mix_large', workspace: 'test-111', title: '混合协作', state: 'unknown',
  members: ['Hermes', 'DSH', 'Codex'].map(runtime => ({ employeeId: runtime, runtime, name: runtime, profile: runtime, deviceId: 'pc', conversationId: 'chat-' + runtime })),
  messages: Array.from({ length: 300 }, (_, index) => ({ id: 'message-' + index, role: 'assistant', text: '\u0001中😀'.repeat(5000), status: 'unknown' })),
  runs: [{ employeeId: 'DSH', actionId: 'original-action', status: 'expired', output: '原始输出'.repeat(50000), error: '未确认'.repeat(10000) }] });

test('mixed mobile detail pages the original 300 messages below 20KB without changing stored messages or run status', () => {
  const original = group(), saved = JSON.stringify(original), seen = [];
  let before;
  do {
    const value = mobileMixedGroup(original, { before });
    assert(Buffer.byteLength(JSON.stringify(value)) < 20000);
    assert(value.messages.every(message => message.textTruncated));
    assert.equal(value.runs[0].status, 'expired'); assert.equal(value.state, 'unknown');
    seen.unshift(...value.messages.map(message => message.id));
    before = value.pagination.hasMore ? value.pagination.nextBefore : null;
  } while (before);
  assert.deepEqual(seen, original.messages.map(message => message.id));
  assert.equal(JSON.stringify(original), saved);
});

test('mixed mobile list omits long histories and provides an explicit next page', () => {
  const groups = Array.from({ length: 12 }, (_, index) => ({ ...group(), id: 'mix_' + index }));
  const first = mobileMixedGroupList(groups), second = mobileMixedGroupList(groups, { before: first.pagination.nextBefore });
  assert(Buffer.byteLength(JSON.stringify(first)) < 20000);
  assert.equal(first.groups.length, 10); assert.equal(second.groups.length, 2);
  assert.equal(second.pagination.hasMore, false);
  assert(first.groups.every(row => row.messages.length === 0 && !row.runs));
  assert.throws(() => mobileMixedGroup(groups[0], { before: 'missing' }), /分页位置/);
});

test('mobile group messages and member outcomes retain authorized attachment identity, checksum and download scope', () => {
  const original = group(), reference = { attachmentId: 'attachment_original', conversationId: 'conversation_original', name: '结果.zip', mimeType: 'application/zip', size: 524288000, sha256: 'a'.repeat(64),
    url: '/api/conversations/conversation_original/attachments/attachment_original', downloadUrl: '/api/conversations/conversation_original/attachments/attachment_original?download=1' };
  original.messages = [{ id: 'message-original', role: 'assistant', text: '实际文件回执', attachments: [reference] }];
  original.runs[0].attachments = [reference];
  const value = mobileMixedGroup(original);
  assert.deepEqual(value.messages[0].attachments[0], reference);
  assert.deepEqual(value.runs[0].attachments[0], reference);
  assert.equal(value.messages[0].attachmentCount, 1);
  assert(!JSON.stringify(value).includes('contentEncoding'));
});

test('six maximum-length members and twenty attachments fit the mobile budget without losing their original count', t => {
  const members = Array.from({ length: 6 }, (_, index) => ({
    employeeId: (`e${index}`).padEnd(160, 'e'), name: '名'.repeat(240), runtime: 'Codex',
    profile: (`p${index}`).padEnd(160, 'p'), deviceId: 'd'.repeat(160),
    conversationId: (`c${index}`).padEnd(160, 'c'), sessionId: (`s${index}`).padEnd(160, 's'),
  }));
  const original = normalizeMixedGroup({ id: 'mix_budget', workspace: 'w'.repeat(160), title: '名'.repeat(480), members,
    messages: [{ id: 'm', role: 'assistant', text: '中'.repeat(20000), employeeId: members[0].employeeId, runtime: 'Codex', profile: members[0].profile,
      actionId: 'action_'.padEnd(43, 'a'), status: 'succeeded', attachments: Array.from({ length: 20 }, () => ({ name: '中'.repeat(100), mimeType: 'image/png' })) }],
  });
  original.runs = members.map((member, index) => ({ employeeId: member.employeeId, runtime: member.runtime, profile: member.profile,
    conversationId: member.conversationId, actionId: (`action_${index}`).padEnd(43, 'a'), messageId: 'mobile-group:'.padEnd(50, 'm'), status: 'succeeded', error: '中'.repeat(4000) }));
  const saved = JSON.stringify(original), value = mobileMixedGroup(original), size = Buffer.byteLength(JSON.stringify(value));
  assert(size < 20000, `Mobile detail must remain below 20KB; received ${size} bytes`);
  assert.equal(value.members.length, 6); assert.equal(value.runs.length, 6);
  assert.equal(value.messages.length, 1); assert.equal(value.messages[0].attachmentCount, 20); assert.equal(value.messages[0].attachments.length, 3);
  assert.equal(value.messages[0].textTruncated, true); assert(value.runs.every(run => run.status === 'succeeded'));
  assert.equal(JSON.stringify(original), saved);
  t.diagnostic(`maximum-contract mixed detail bytes: ${size}; original attachment count: ${value.messages[0].attachmentCount}`);
});

test('actual mixed-group HTTP routes select mobile paging and keep default full history unchanged', async t => {
  const app = createApp({ memory: true, requireAuth: false, enableScheduler: false }), repo = app.locals.repo;
  t.after(() => repo.db.close());
  repo.heartbeatDevice('test-111', { deviceId: 'mixed-mobile-pc', runtimes: { Codex: { status: 'available' }, DSH: { status: 'available' } } });
  const members = ['Codex', 'DSH'].map(runtime => {
    const employee = repo.createEmployee('test-111', { name: runtime, runtime, runtimeProfile: runtime, targetDeviceId: 'mixed-mobile-pc' });
    const conversation = repo.createConversation('test-111', { employeeId: employee.id });
    return { employeeId: employee.id, name: employee.name, runtime, profile: runtime, deviceId: 'mixed-mobile-pc', conversationId: conversation.id };
  });
  const messages = group().messages, store = createMixedGroupStore(repo);
  store.create('test-111', { id: 'mix_http', title: '手机混合群', members, messages });
  const before = repo.db.prepare('SELECT messages_json FROM mixed_groups WHERE id=?').get('mix_http').messages_json;
  const full = await read(app, '/api/workspaces/test-111/mixed-groups/mix_http');
  const mobile = await read(app, '/api/workspaces/test-111/mixed-groups/mix_http?view=mobile');
  const list = await read(app, '/api/workspaces/test-111/mixed-groups?view=mobile');
  assert.equal(full.status, 200); assert.equal(mobile.status, 200); assert.equal(list.status, 200);
  assert.equal(full.json.messages.length, 300); assert.deepEqual(full.json.messages, messages);
  assert.equal(mobile.json.messages.length, 10); assert(mobile.json.pagination.hasMore);
  assert(mobile.bytes < 20000); assert(list.bytes < 20000);
  assert.equal(repo.db.prepare('SELECT messages_json FROM mixed_groups WHERE id=?').get('mix_http').messages_json, before);
  t.diagnostic(`mixed-group actual full/mobile/list bytes: ${full.bytes}/${mobile.bytes}/${list.bytes}`);
});
