import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../web/controller.js';
import { createApi } from '../web/api.js';
import { initialState } from '../web/model.js';
import { ATTACHMENT_CHUNK_BYTES } from '../../src/conversation-attachment-policy.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const refFor = size => ({ attachmentId: 'attachment-original', name: '报告.pdf', mimeType: 'application/pdf', size, sha256: 'a'.repeat(64) });
function fixture(t, overrides = {}) {
  const values = new Map(), sent = [], calls = [];
  const storage = { get length() { return values.size; }, key: index => [...values.keys()][index], getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const employees = [{ id: 'one', name: '员工一', runtime: 'Other', main_conversation_id: 'chat-one' }, { id: 'two', name: '员工二', runtime: 'Other', main_conversation_id: 'chat-two' }];
  const state = { ...initialState(), phase: 'ready', user: { user_id: 'user' }, workspace: { slug: 'workspace', role: 'owner' }, employees };
  let size = 0, offset = 0;
  const api = {
    employees: async () => ({ employees }), bots: async () => ({ bots: [] }), chats: async () => ({ chats: [], unreadCount: 0 }), devices: async () => ({ devices: [] }), tasks: async () => ({ tasks: [] }), logout: async () => ({}),
    conversation: async id => ({ id, employee_id: id.replace('chat-', ''), messages: [] }),
    createAttachmentUpload: async (conversationId, body, key) => { calls.push(['create', conversationId, body, key]); size = body.size; return { uploadId: 'upload-original', offset: 0, chunkSize: ATTACHMENT_CHUNK_BYTES }; },
    attachmentUploadStatus: async conversationId => { calls.push(['status', conversationId]); return { uploadId: 'upload-original', offset, chunkSize: ATTACHMENT_CHUNK_BYTES }; },
    putAttachmentChunk: async (conversationId, uploadId, start, blob) => { calls.push(['chunk', conversationId, uploadId, start, blob]); offset = start + blob.size; return { uploadId, offset }; },
    completeAttachmentUpload: async conversationId => { calls.push(['complete', conversationId]); return refFor(size); },
    sendMessage: async (conversationId, body) => { sent.push({ conversationId, body }); return { id: 'saved-message', role: 'user', content: body.content, attachments: body.attachments }; },
    ...overrides,
  };
  const controller = createController({ state, api, storage }); t.after(() => controller.dispose());
  return { state, api, values, sent, calls, controller };
}
const content = text => { const form = new FormData(); form.set('draft', text); return form; };

test('ordinary files upload as Blob chunks and the eventual message/fingerprint contain only bounded reference metadata', async t => {
  const f = fixture(t); await f.controller.actions.chat({ id: 'one' });
  const file = new File(['原始PDF内容'], '报告.pdf', { type: 'application/pdf' });
  file.arrayBuffer = () => { throw new Error('whole file cannot be read by selection/controller'); };
  await f.controller.change({ name: 'images', files: [file], value: '' });
  assert.equal(f.state.attachments[0].file, file); assert.equal(f.state.attachments[0].upload.phase, 'complete'); assert.equal(f.sent.length, 0);
  assert(f.calls.find(call => call[0] === 'chunk')[4] instanceof Blob);
  assert(![...f.values.values()].some(value => value.includes('PDF')));
  await f.controller.submit('chat', content('请阅读报告'));
  assert.equal(f.sent.length, 1); assert.deepEqual(f.sent[0].body.attachments, [refFor(file.size)]);
  assert(!JSON.stringify(f.sent[0]).includes('原始PDF内容')); assert.equal(f.state.attachments.length, 0);
});

test('failed upload requires explicit retry and never dispatches an employee message while incomplete', async t => {
  const f = fixture(t); let once = true;
  const put = f.api.putAttachmentChunk;
  f.api.putAttachmentChunk = async (...args) => { const answer = await put(...args); if (once) { once = false; throw new Error('connection lost'); } return answer; };
  await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'images', files: [new File(['hello'], '报告.pdf', { type: 'application/pdf' })], value: '' });
  const localId = f.state.attachments[0].localId;
  assert.equal(f.state.attachments[0].upload.phase, 'failed'); assert.equal(f.sent.length, 0);
  await f.controller.submit('chat', content('保留草稿')); assert.equal(f.sent.length, 0); assert.match(f.state.error, /尚未上传完成/);
  await f.controller.actions['attachment-retry']({ id: localId });
  assert.equal(f.state.attachments[0].upload.phase, 'complete'); assert.equal(f.calls.filter(call => call[0] === 'create').length, 1); assert.equal(f.calls.filter(call => call[0] === 'chunk').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'status').length, 1); assert.equal(f.state.draft, '保留草稿'); assert.equal(f.sent.length, 0); assert.equal(f.state.error, '');
});

for (const leave of ['employee', 'logout']) test(`a late upload after ${leave} does not clear another draft, complete a second chunk or dispatch a message`, async t => {
  const held = deferred(), started = deferred(), f = fixture(t, { putAttachmentChunk: async (...args) => { f.calls.push(['chunk', ...args]); started.resolve(); return held.promise; } });
  await f.controller.actions.chat({ id: 'one' });
  const uploading = f.controller.change({ name: 'images', files: [new File([new Uint8Array(ATTACHMENT_CHUNK_BYTES + 2)], '报告.pdf', { type: 'application/pdf' })], value: '' });
  await started.promise;
  if (leave === 'employee') { await f.controller.actions.chat({ id: 'two' }); await f.controller.change({ name: 'draft', value: '另一位员工的新草稿' }); }
  else await f.controller.actions.logout();
  held.resolve({ uploadId: 'upload-original', offset: ATTACHMENT_CHUNK_BYTES }); await uploading;
  assert.equal(f.calls.filter(call => call[0] === 'chunk').length, 1); assert.equal(f.calls.filter(call => call[0] === 'complete').length, 0); assert.equal(f.sent.length, 0);
  if (leave === 'employee') { assert.equal(f.state.draft, '另一位员工的新草稿'); assert.equal(f.state.conversation.id, 'chat-two'); assert.deepEqual(f.state.attachments, []); }
  else { assert.equal(f.state.phase, 'login'); assert.equal(f.state.user, null); }
});

test('attachment API sends stable creation headers, binary Blob PUTs and delegates native download streaming', async t => {
  const calls = [], downloads = [], blob = new Blob(['file bytes']);
  const identity = { fetch: async (url, options) => { calls.push([url, options]); return new Response('{}', { headers: { 'content-type': 'application/json' } }); }, subscribe: () => () => {}, downloadAttachment: async (...args) => { downloads.push(args); return { saved: true, bytes: 10 }; } };
  const api = createApi({ identity }); t.after(() => api.dispose());
  await api.createAttachmentUpload('chat/a', { name: '报告.pdf', size: 10, mimeType: 'application/pdf' }, 'stable-upload-key');
  await api.putAttachmentChunk('chat/a', 'upload/b', 8, blob); await api.attachmentUploadStatus('chat/a', 'upload/b'); await api.completeAttachmentUpload('chat/a', 'upload/b');
  assert.equal(calls[0][1].headers['Idempotency-Key'], 'stable-upload-key'); assert.equal(calls[1][0], '/api/conversations/chat%2Fa/attachments/uploads/upload%2Fb?offset=8');
  assert.equal(calls[1][1].body, blob); assert.equal(calls[1][1].headers['Content-Type'], 'application/octet-stream');
  assert.equal((await api.downloadAttachment('chat/a', 'attachment/c', { name: '报告.pdf', mimeType: 'application/pdf' })).saved, true);
  assert.deepEqual(downloads, [['/api/conversations/chat%2Fa/attachments/attachment%2Fc', '报告.pdf', 'application/pdf']]);
});
