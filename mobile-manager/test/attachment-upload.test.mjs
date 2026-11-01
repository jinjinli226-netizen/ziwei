import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttachmentUploader, createDraftAttachments, releaseDraftAttachments } from '../web/attachment-upload.js';
import { MAX_ATTACHMENT_BYTES, ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENTS } from '../../src/conversation-attachment-policy.mjs';
import { createConversationAttachmentStore } from '../../backend/conversation-attachment-store.mjs';
import { createRepository } from '../../backend/repository.mjs';
import { createLocalObjectStore } from '../../backend/storage.mjs';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const file = (bytes, name = '资料.zip') => new File([bytes], name, { type: 'application/zip' });
test('selection retains Files and metadata without reading or encoding the complete file', () => {
  const selected = { size: MAX_ATTACHMENT_BYTES, name: '大文件.zip', type: 'application/zip', slice() {}, arrayBuffer() { throw new Error('whole-file read forbidden'); } };
  const items = createDraftAttachments([selected], []);
  assert.equal(items[0].file, selected); assert.equal(items[0].size, MAX_ATTACHMENT_BYTES); assert.equal(items[0].content, undefined);
  assert.throws(() => createDraftAttachments([{ ...selected, size: MAX_ATTACHMENT_BYTES + 1 }], []), /500 MiB/);
  assert.throws(() => createDraftAttachments([{ ...selected, size: 1 }], items), /合计/);
  assert.throws(() => createDraftAttachments([selected], Array.from({ length: MAX_ATTACHMENTS }, () => ({ size: 1 }))), /20/);
  releaseDraftAttachments(items);
});

test('actual Blob slices upload to the real store, complete with exact bytes and reuse the same reference', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mobile-upload-'));
  const repo = createRepository({ memory: true }); t.after(async () => { repo.db.close(); await rm(directory, { recursive: true, force: true }); });
  const employee = repo.createEmployee('test-111', { name: '附件验收', runtime: 'Codex' });
  const conversation = repo.createConversation('test-111', { employeeId: employee.id });
  const scope = { workspaceId: repo.getWorkspace('test-111').id, conversationId: conversation.id, uploaderId: 'isolated-user' };
  const store = createConversationAttachmentStore({ db: repo.db, objectStore: createLocalObjectStore({ dir: directory }) }), calls = [];
  const api = {
    createAttachmentUpload: async (id, body, key) => { assert.equal(id, conversation.id); calls.push(['create', key]); return store.create(scope, body, key); },
    attachmentUploadStatus: async (_id, uploadId) => { calls.push(['status', uploadId]); return store.status(scope, uploadId); },
    putAttachmentChunk: async (_id, uploadId, offset, blob) => { calls.push(['chunk', offset, blob.size]); return store.append(scope, uploadId, offset, Readable.fromWeb(blob.stream())); },
    completeAttachmentUpload: async (_id, uploadId) => { calls.push(['complete']); return store.complete(scope, uploadId); },
  };
  const contents = new Uint8Array(ATTACHMENT_CHUNK_BYTES + 37); contents.fill(29); contents[contents.length - 1] = 91;
  const original = file(contents), upload = createAttachmentUploader({ api }), progress = [];
  const ref = await upload(conversation.id, original, { onProgress: value => progress.push(value.offset) });
  assert.deepEqual(calls.filter(call => call[0] === 'chunk').map(call => call.slice(1)), [[0, ATTACHMENT_CHUNK_BYTES], [ATTACHMENT_CHUNK_BYTES, 37]]);
  const stored = store.open(scope, ref.attachmentId), chunks = []; for await (const chunk of stored.stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(contents)); assert.equal(ref.size, original.size);
  assert.equal(await upload(conversation.id, original), ref); assert.equal(calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(progress, [0, ATTACHMENT_CHUNK_BYTES, original.size]);
});

test('a lost PUT receipt is retried only explicitly, reads the same upload offset and does not repeat committed bytes', async () => {
  let offset = 0, creates = 0, statuses = 0, failOnce = true; const puts = [], uploadId = 'upload-original';
  const original = file(new Uint8Array(ATTACHMENT_CHUNK_BYTES + 19));
  const api = {
    createAttachmentUpload: async () => { creates++; return { uploadId, offset, chunkSize: ATTACHMENT_CHUNK_BYTES }; },
    attachmentUploadStatus: async (_id, id) => { assert.equal(id, uploadId); statuses++; return { uploadId, offset, chunkSize: ATTACHMENT_CHUNK_BYTES }; },
    putAttachmentChunk: async (_id, id, start, blob) => { assert.equal(id, uploadId); puts.push(start); offset = start + blob.size; if (failOnce) { failOnce = false; throw new Error('receipt lost after server committed chunk'); } return { uploadId, offset }; },
    completeAttachmentUpload: async () => ({ attachmentId: 'attachment-original', name: original.name, mimeType: original.type, size: original.size, sha256: 'a'.repeat(64) }),
  };
  const upload = createAttachmentUploader({ api });
  await assert.rejects(upload('original-chat', original), /receipt lost/); assert.deepEqual(puts, [0]);
  await upload('original-chat', original); assert.deepEqual(puts, [0, ATTACHMENT_CHUNK_BYTES]); assert.equal(creates, 1); assert.equal(statuses, 1);
});

test('500 MiB virtual file is sliced into bounded chunks without allocating or reading the whole file', async () => {
  let sliceCount = 0, maxSlice = 0;
  const original = { name: 'boundary.bin', type: 'application/octet-stream', size: MAX_ATTACHMENT_BYTES,
    arrayBuffer() { throw new Error('whole-file read forbidden'); }, slice(start, end) { sliceCount++; maxSlice = Math.max(maxSlice, end - start); return { size: end - start }; } };
  const api = {
    createAttachmentUpload: async () => ({ uploadId: 'upload-virtual', offset: 0, chunkSize: ATTACHMENT_CHUNK_BYTES }),
    putAttachmentChunk: async (_id, uploadId, offset, blob) => ({ uploadId, offset: offset + blob.size }),
    completeAttachmentUpload: async () => ({ attachmentId: 'attachment-virtual', name: original.name, mimeType: original.type, size: original.size, sha256: 'b'.repeat(64) }),
  };
  const ref = await createAttachmentUploader({ api })('virtual-chat', original);
  assert.equal(ref.size, MAX_ATTACHMENT_BYTES); assert.equal(sliceCount, Math.ceil(MAX_ATTACHMENT_BYTES / ATTACHMENT_CHUNK_BYTES)); assert.equal(maxSlice, ATTACHMENT_CHUNK_BYTES);
});

test('a lost create acknowledgement reuses its exact idempotency key without auto-retrying', async () => {
  const keys = [], original = file('hello'), ref = { attachmentId: 'attachment-create', name: '资料.zip', mimeType: original.type, size: original.size, sha256: 'c'.repeat(64) };
  const api = {
    createAttachmentUpload: async (_id, _body, key) => { keys.push(key); if (keys.length === 1) throw new Error('create receipt lost'); return { uploadId: 'upload-existing', offset: original.size, chunkSize: ATTACHMENT_CHUNK_BYTES, attachment: ref }; },
  };
  const upload = createAttachmentUploader({ api });
  await assert.rejects(upload('same-chat', original), /receipt lost/); assert.equal(keys.length, 1);
  assert.deepEqual(await upload('same-chat', original), ref); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});

test('a lost completion acknowledgement resolves its stored reference by GET without reupload or repeat completion', async () => {
  const original = file('hello'), ref = { attachmentId: 'attachment-complete', name: original.name, mimeType: original.type, size: original.size, sha256: 'd'.repeat(64) };
  let offset = 0, complete = 0, chunks = 0, status = 0;
  const api = {
    createAttachmentUpload: async () => ({ uploadId: 'upload-complete', offset: 0 }),
    putAttachmentChunk: async (_id, uploadId, start, blob) => { chunks++; offset = start + blob.size; return { uploadId, offset }; },
    completeAttachmentUpload: async () => { complete++; throw new Error('complete receipt lost'); },
    attachmentUploadStatus: async () => { status++; return { uploadId: 'upload-complete', offset, attachment: ref }; },
  };
  const upload = createAttachmentUploader({ api });
  await assert.rejects(upload('same-chat', original), /receipt lost/); assert.equal(complete, 1);
  assert.deepEqual(await upload('same-chat', original), ref); assert.equal(status, 1); assert.equal(chunks, 1); assert.equal(complete, 1);
});
