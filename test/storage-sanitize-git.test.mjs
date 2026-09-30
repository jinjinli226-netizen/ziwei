import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRepository } from '../backend/repository.mjs';
import { sanitizeHtml } from '../backend/sanitize.mjs';
import { exportDocumentsToGit, importDocumentsFromGit } from '../backend/git-sync.mjs';

test('production document repository can use content-addressed local object storage', () => {
  const objectStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-objects-'));
  const repo = createRepository({ memory: true, objectStoreDir });
  const bytes = Buffer.from([0, 255, 1, 128, 13, 10]);
  const document = repo.createDocument('test-111', { name: 'payload.bin', type: 'file', data: bytes.toString('base64'), contentEncoding: 'base64', mimeType: 'application/octet-stream' });
  assert.match(document.storage_key, /^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/);
  assert.equal(document.content, '');
  assert.deepEqual(Buffer.from(repo.downloadDocument(document.id).content, 'base64'), bytes);
  assert.ok(fs.existsSync(path.join(objectStoreDir, ...document.storage_key.split('/'))));
});

test('HTML task descriptions are sanitized before persistence', () => {
  const repo = createRepository({ memory: true });
  const task = repo.createTask('test-111', { title: '安全', description: '<p onclick="alert(1)">你好<script>alert(2)</script><a href="javascript:alert(3)">链接</a></p>', descriptionFormat: 'html' });
  assert.equal(task.description, '<p>你好<a rel="noopener noreferrer">链接</a></p>');
  assert.equal(sanitizeHtml('<img src="https://example.com/a.png" onerror="x">'), '<img src="https://example.com/a.png">');
});

test('documents can export to and import from a bounded git sync directory', () => {
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-git-'));
  const previous = process.env.ZIWEI_GIT_SYNC_ROOT;
  process.env.ZIWEI_GIT_SYNC_ROOT = gitRoot;
  try {
    const repo = createRepository({ memory: true });
    const folder = repo.createDocument('test-111', { name: '资料', type: 'folder' });
    const document = repo.createDocument('test-111', { name: 'README.md', parentId: folder.id, content: '# 初版' });
    const exported = exportDocumentsToGit(repo, 'test-111', 'handoff');
    assert.equal(exported.files, 1);
    const syncedFile = path.join(gitRoot, 'handoff', '资料', 'README.md');
    assert.equal(fs.readFileSync(syncedFile, 'utf8'), '# 初版');
    fs.writeFileSync(syncedFile, '# 更新版');
    const imported = importDocumentsFromGit(repo, 'test-111', 'handoff');
    assert.equal(imported.updated, 1);
    assert.equal(repo.downloadDocument(document.id).content, '# 更新版');
  } finally {
    if (previous === undefined) delete process.env.ZIWEI_GIT_SYNC_ROOT;
    else process.env.ZIWEI_GIT_SYNC_ROOT = previous;
  }
});
