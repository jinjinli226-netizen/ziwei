import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRepository } from '../backend/repository.mjs';

test('documents preserve binary bytes and encoding across edits and version restore', () => {
  const repo = createRepository({ memory: true });
  const first = Buffer.from([0, 255, 1, 2, 128, 13, 10]);
  const second = Buffer.from([9, 8, 7, 0, 254]);
  const doc = repo.createDocument('test-111', {
    name: 'payload.bin', type: 'file', mimeType: 'application/octet-stream',
    data: first.toString('base64'), contentEncoding: 'base64', storageKey: 'objects/one'
  });
  assert.equal(doc.size, first.length);
  assert.equal(doc.checksum, createHash('sha256').update(first).digest('hex'));
  repo.updateDocument(doc.id, {
    data: second.toString('base64'), contentEncoding: 'base64',
    mimeType: 'application/x-test', storageKey: 'objects/two'
  });
  const versions = repo.listDocumentVersions(doc.id);
  assert.deepEqual(versions.map(item => item.version), [2, 1]);
  assert.equal(versions[0].content_encoding, 'base64');
  assert.equal(versions[0].mime_type, 'application/x-test');
  repo.restoreDocumentVersion(doc.id, 1);
  const restored = repo.downloadDocument(doc.id);
  assert.equal(restored.content_encoding, 'base64');
  assert.deepEqual(Buffer.from(restored.content, 'base64'), first);
  assert.equal(restored.mime_type, 'application/octet-stream');
  assert.equal(restored.size, first.length);
});

test('documents reject malformed base64 instead of silently truncating bytes', () => {
  const repo = createRepository({ memory: true });
  assert.throws(() => repo.createDocument('test-111', {
    name: 'bad.bin', data: 'not base64!!!', contentEncoding: 'base64'
  }), /base64/);
  assert.throws(() => repo.createDocument('test-111', {
    name: 'bad.bin', data: 'YQ', contentEncoding: 'base64'
  }), /base64/);
});

test('folder moves reject descendant cycles and trash restore keeps the tree reachable', () => {
  const repo = createRepository({ memory: true });
  const root = repo.createDocument('test-111', { name: 'root', type: 'folder' });
  const child = repo.createDocument('test-111', { name: 'child', type: 'folder', parentId: root.id });
  const leaf = repo.createDocument('test-111', { name: 'leaf.txt', parentId: child.id, content: 'ok' });
  assert.throws(() => repo.updateDocument(root.id, { parentId: child.id }), /子文件夹/);
  repo.deleteDocument(root.id);
  assert.equal(repo.getDocument(leaf.id), null);
  repo.restoreDocument(leaf.id);
  assert.equal(repo.getDocument(root.id).deleted_at, null);
  assert.equal(repo.getDocument(child.id).deleted_at, null);
  assert.equal(repo.getDocument(leaf.id).parent_id, child.id);
  assert.equal(repo.listDocuments('test-111').some(item => item.id === leaf.id), true);
});
