import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createWorkspaceGroups } from '../web/workspace-groups.js';
import { renderWorkspaceGroups } from '../web/workspace-groups-view.js';
import { createRepository } from '../../backend/repository.mjs';
import { createMixedGroupStore } from '../../backend/mixed-group-store.mjs';
import { mobileMixedGroup } from '../../backend/mixed-group-mobile.mjs';

const employees = ['Codex', 'DSH'].map((runtime, i) => ({ id: `employee-${i}`, name: runtime, runtime, runtime_profile: `profile-${i}`, target_device_id: 'pc', main_conversation_id: `chat-${i}` }));
const group = (id = 'mix_one') => ({ id, workspace: 'group-workspace', title: id, members: employees.map(e => ({ employeeId: e.id, name: e.name, runtime: e.runtime, conversationId: e.main_conversation_id })), messages: [], runs: [] });
async function fixture(t, overrides = {}) {
  const state = { user: { user_id: 'group-user' }, workspace: { slug: 'group-workspace', role: 'owner' }, employees, bots: [], page: 'home' }, calls = [];
  let stored = group(), offset = 0;
  const api = {
    mixedGroups: async () => ({ groups: [stored, group('mix_other')] }), mixedGroup: async (_workspace, id) => id === stored.id ? stored : group(id),
    createAttachmentUpload: async (conversationId, body, key) => { calls.push(['create-upload', conversationId, body, key]); return { uploadId: 'upload-one', offset, chunkSize: 8 * 1024 * 1024 }; },
    attachmentUploadStatus: async conversationId => { calls.push(['upload-status', conversationId]); return { uploadId: 'upload-one', offset }; },
    putAttachmentChunk: async (conversationId, uploadId, start, blob) => { calls.push(['chunk', conversationId, start]); offset = start + blob.size; return { uploadId, offset }; },
    completeAttachmentUpload: async conversationId => { calls.push(['complete', conversationId]); return { attachmentId: 'attachment-one', name: '资料.pdf', mimeType: 'application/pdf', size: 3, sha256: 'a'.repeat(64) }; },
    sendMixedGroupMessage: async (_workspace, _id, body) => { calls.push(['send', body]); stored = { ...stored, messages: [{ id: body.messageId, role: 'user', text: body.content }] }; return { group: stored }; },
    downloadAttachment: async (...args) => { calls.push(['download', ...args]); return { saved: true }; }, ...overrides,
  };
  const module = createWorkspaceGroups({ state, api }); t.after(() => module.dispose());
  await module.open(); await module.actions['workspace-group-open']({ id: 'mix_one' });
  return { state, calls, api, module, setGroup: value => { stored = value; } };
}
const file = () => new File(['abc'], '资料.pdf', { type: 'application/pdf' });
const choose = (f, value = file()) => f.module.change({ name: 'workspaceGroupFiles', files: [value], value: 'selected' });

test('group file selection uploads only to an existing member conversation and sends reference-only after an explicit message', async t => {
  const f = await fixture(t); await choose(f);
  assert.equal(f.calls.some(call => call[0] === 'send'), false);
  assert(f.calls.filter(call => ['create-upload', 'chunk', 'complete'].includes(call[0])).every(call => call[1] === 'chat-0'));
  assert.equal(f.state.workspaceGroups.attachments[0].upload.phase, 'complete');
  assert.equal(await f.module.actions['workspace-group-send'](), false); assert.match(f.state.workspaceGroups.error, /先写一段说明/);
  f.module.change({ name: 'workspaceGroupContent', value: '一起核对这份资料' }); await f.module.actions['workspace-group-send']();
  const body = f.calls.find(call => call[0] === 'send')[1];
  assert.equal(body.attachmentSourceConversationId, 'chat-0'); assert.equal(body.attachments[0].attachmentId, 'attachment-one');
  assert.equal(body.attachments[0].content, undefined); assert.equal(body.attachments[0].file, undefined);
  assert.deepEqual(f.state.workspaceGroups.attachments, []); assert.equal(f.state.workspaceGroups.content, '');
});

test('failed group upload and its File survive group switching; explicit retry reads the original offset without repeating committed bytes', async t => {
  let lost = true, committed = 0;
  const f = await fixture(t, {
    putAttachmentChunk: async (conversationId, uploadId, start, blob) => { f.calls.push(['chunk', conversationId, start]); committed = start + blob.size; if (lost) { lost = false; throw new Error('分片回执丢失'); } return { uploadId, offset: committed }; },
    attachmentUploadStatus: async conversationId => { f.calls.push(['upload-status', conversationId]); return { uploadId: 'upload-one', offset: committed }; },
  });
  const original = file(); await choose(f, original); f.module.change({ name: 'workspaceGroupContent', value: '只属于第一个群的草稿' });
  const draft = f.state.workspaceGroups.attachments[0]; assert.equal(draft.upload.phase, 'failed');
  await f.module.open(); await f.module.actions['workspace-group-open']({ id: 'mix_other' }); assert.deepEqual(f.state.workspaceGroups.attachments, []);
  await f.module.open(); await f.module.actions['workspace-group-open']({ id: 'mix_one' });
  assert.equal(f.state.workspaceGroups.attachments[0].file, original); assert.equal(f.state.workspaceGroups.content, '只属于第一个群的草稿');
  await f.module.actions['workspace-group-attachment-retry']();
  assert.equal(f.calls.filter(call => call[0] === 'chunk').length, 1); assert.equal(f.calls.filter(call => call[0] === 'upload-status').length, 1);
  assert.equal(f.state.workspaceGroups.attachments[0].ref.attachmentId, 'attachment-one'); assert.equal(f.calls.some(call => call[0] === 'send'), false);
});

test('unknown group send retains the same File until a GET confirms its exact message id, including history paging', async t => {
  const f = await fixture(t, { sendMixedGroupMessage: async (_workspace, _id, body) => { f.calls.push(['send', body]); throw Object.assign(new Error('送达待确认'), { uncertain: true }); } });
  await choose(f); f.module.change({ name: 'workspaceGroupContent', value: '保留附件的原消息' }); await f.module.actions['workspace-group-send']();
  const body = f.calls.find(call => call[0] === 'send')[1], draft = f.state.workspaceGroups.attachments[0];
  await f.module.open(); await f.module.actions['workspace-group-open']({ id: 'mix_one' });
  assert.equal(f.state.workspaceGroups.attachments[0], draft); assert.equal(await f.module.actions['workspace-group-send'](), false);
  f.setGroup({ ...group(), messages: [{ id: 'another-message', role: 'user', text: body.content }], pagination: { hasMore: true, nextBefore: 'another-message' } });
  await f.module.actions['workspace-group-refresh'](); assert.equal(f.state.workspaceGroups.pending.messageId, body.messageId); assert.equal(f.state.workspaceGroups.attachments.length, 1);
  f.api.mixedGroup = async () => ({ ...group(), messages: [{ id: body.messageId, role: 'user', text: body.content }], pagination: { hasMore: false } });
  await f.module.actions['workspace-group-history']();
  assert.equal(f.state.workspaceGroups.pending, null); assert.deepEqual(f.state.workspaceGroups.attachments, []); assert.equal(f.state.workspaceGroups.content, '');
  assert.equal(f.calls.filter(call => call[0] === 'send').length, 1);
});

test('returning while a chunk is pending retains one upload and resumes only after its original receipt settles', async t => {
  let finish, committed = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = await fixture(t, {
    putAttachmentChunk: async (conversationId, uploadId, start, blob) => { f.calls.push(['chunk', conversationId, start]); committed = start + blob.size; return pending; },
    attachmentUploadStatus: async conversationId => { f.calls.push(['upload-status', conversationId]); return { uploadId: 'upload-one', offset: committed }; },
  });
  const selecting = choose(f); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.module.change({ name: 'workspaceGroupContent', value: '上传期间继续写说明' }), true);
  assert.equal(f.state.workspaceGroups.content, '上传期间继续写说明');
  await f.module.open(); await f.module.actions['workspace-group-open']({ id: 'mix_one' });
  assert.equal(f.state.workspaceGroups.draft.uploading, true); assert.equal(await f.module.actions['workspace-group-attachment-retry'](), false);
  finish({ uploadId: 'upload-one', offset: committed }); await selecting;
  assert.equal(f.state.workspaceGroups.draft.uploading, false); assert.equal(f.state.workspaceGroups.attachments[0].upload.phase, 'failed');
  await f.module.actions['workspace-group-attachment-retry']();
  assert.equal(f.calls.filter(call => call[0] === 'chunk').length, 1); assert.equal(f.calls.filter(call => call[0] === 'upload-status').length, 1);
  assert.equal(f.state.workspaceGroups.attachments[0].upload.phase, 'complete');
});

test('clearing one account releases its group File draft and cannot leak it into another account', async t => {
  const f = await fixture(t); await choose(f); f.module.change({ name: 'workspaceGroupContent', value: '原账号附件草稿' });
  f.module.reset({ clearAccount: true });
  f.state.user = { user_id: 'second-account' }; await f.module.open(); await f.module.actions['workspace-group-open']({ id: 'mix_one' });
  assert.deepEqual(f.state.workspaceGroups.attachments, []); assert.equal(f.state.workspaceGroups.content, '');
  f.state.user = { user_id: 'group-user' }; f.module.reset(); await f.module.open(); await f.module.actions['workspace-group-open']({ id: 'mix_one' });
  assert.deepEqual(f.state.workspaceGroups.attachments, []); assert.equal(f.state.workspaceGroups.content, '');
});

test('group attachment display and downloads use each stored reference conversation and never preview 500MiB images', async t => {
  const f = await fixture(t), small = { attachmentId: 'attachment-small', conversationId: 'chat-1', name: '<script>图.png</script>', mimeType: 'image/png', size: 100, url: 'https://untrusted.invalid/must-not-use' };
  const big = { ...small, attachmentId: 'attachment-big', name: 'large.png', size: 500 * 1024 * 1024 };
  f.setGroup({ ...group(), messages: [{ id: 'saved-message', role: 'assistant', text: '文件', attachments: [small, big] }] }); await f.module.actions['workspace-group-refresh']();
  f.state.messages = [{ id: 'saved-message', attachments: [{ ...small, conversationId: 'wrong-private-chat' }] }];
  const html = renderWorkspaceGroups(f.state);
  assert.match(html, /src="\/api\/conversations\/chat-1\/attachments\/attachment-small"/);
  assert.doesNotMatch(html, /src="[^"]*attachment-big|untrusted\.invalid|<script>/); assert.match(html, /&lt;script&gt;/);
  await f.module.actions['workspace-group-attachment-download']({ message: 'saved-message', attachment: small.attachmentId });
  assert.deepEqual(f.calls.find(call => call[0] === 'download').slice(1), ['chat-1', 'attachment-small', { name: small.name, mimeType: 'image/png' }]);
});

test('the actual group module uploads bytes, dispatches reference-only members and downloads the original file through real stores', async t => {
  const base = process.platform === 'win32' ? 'D:/tmp/ziwei-attachment-tests' : os.tmpdir(); fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'mobile-group-refs-')), repo = createRepository({ memory: true, objectStoreDir: directory });
  t.after(() => { repo.db.close(); const resolved = path.resolve(directory); if (!resolved.startsWith(path.resolve(base) + path.sep) || !path.basename(resolved).startsWith('mobile-group-refs-')) throw new Error('Unexpected fixture path'); fs.rmSync(resolved, { recursive: true, force: true }); });
  repo.heartbeatDevice('test-111', { deviceId: 'pc-one', runtimes: { Codex: { status: 'available' }, DSH: { status: 'available' } } });
  const employees = ['Codex', 'DSH'].map((runtime, i) => {
    const e = repo.createEmployee('test-111', { name: runtime, runtime, runtimeProfile: `p${i}`, targetDeviceId: 'pc-one', status: 'active' });
    return { ...e, main_conversation_id: repo.createConversation('test-111', { employeeId: e.id }).id };
  });
  const members = employees.map(e => ({ employeeId: e.id, name: e.name, runtime: e.runtime, profile: e.runtime_profile, deviceId: e.target_device_id, conversationId: e.main_conversation_id }));
  const groups = createMixedGroupStore(repo); groups.create('test-111', { id: 'mix_real', title: '真实附件群', members });
  const state = { user: { user_id: 'isolated-user' }, workspace: { slug: 'test-111', role: 'owner' }, employees, bots: [], page: 'home' };
  const scope = conversationId => ({ workspaceId: repo.getWorkspace('test-111').id, conversationId, uploaderId: 'isolated-user' }), sent = [];
  let downloaded;
  const api = {
    mixedGroups: async () => ({ groups: groups.list('test-111').map(group => mobileMixedGroup(group)) }), mixedGroup: async (_workspace, id) => mobileMixedGroup(groups.get('test-111', id)),
    createAttachmentUpload: async (conversationId, body, key) => repo.conversationAttachmentStore.create(scope(conversationId), body, key),
    attachmentUploadStatus: async (conversationId, uploadId) => repo.conversationAttachmentStore.status(scope(conversationId), uploadId),
    putAttachmentChunk: async (conversationId, uploadId, offset, blob) => repo.conversationAttachmentStore.append(scope(conversationId), uploadId, offset, Readable.fromWeb(blob.stream())),
    completeAttachmentUpload: async (conversationId, uploadId) => repo.conversationAttachmentStore.complete(scope(conversationId), uploadId),
    sendMixedGroupMessage: async (_workspace, groupId, body) => { sent.push(body); const result = groups.planSend('test-111', groupId, body); return { ...result, group: mobileMixedGroup(result.group) }; },
    downloadAttachment: async (conversationId, attachmentId) => { const chunks = []; for await (const bytes of repo.conversationAttachmentStore.open(scope(conversationId), attachmentId).stream) chunks.push(bytes); downloaded = Buffer.concat(chunks); return { saved: true }; },
  };
  const module = createWorkspaceGroups({ state, api }); t.after(() => module.dispose());
  await module.open(); await module.actions['workspace-group-open']({ id: 'mix_real' });
  const before = repo.db.prepare('SELECT count(*) AS count FROM a2a_actions').get().count;
  await module.change({ name: 'workspaceGroupFiles', files: [new File(['actual file bytes'], 'report.txt', { type: 'text/plain' })], value: 'selected' });
  assert.equal(repo.db.prepare('SELECT count(*) AS count FROM a2a_actions').get().count, before, 'upload alone cannot dispatch a member');
  module.change({ name: 'workspaceGroupContent', value: '请共同核对报告' }); assert.equal(await module.actions['workspace-group-send'](), true);
  assert.equal(sent.length, 1); assert.equal(sent[0].attachments.length, 1); assert.equal(sent[0].attachments[0].content, undefined);
  const record = state.workspaceGroups.group.messages.find(message => message.id === sent[0].messageId), attachment = record.attachments[0];
  assert.equal(attachment.conversationId, members[0].conversationId); assert.equal(attachment.size, 17);
  await module.actions['workspace-group-attachment-download']({ message: record.id, attachment: attachment.attachmentId });
  assert.equal(downloaded.toString(), 'actual file bytes');
  for (const run of groups.get('test-111', 'mix_real').runs) assert.equal(repo.getA2AAction(run.actionId).payload.attachments[0].content, undefined);
});
