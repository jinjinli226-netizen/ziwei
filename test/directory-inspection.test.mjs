import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActionDispatcher } from '../src/daemon.mjs';
import { createLocalActionExecutor } from '../src/local-action.mjs';

test('directory.inspect lists roots, selects existing directories, creates missing directories, and rejects files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-directory-inspect-'));
  const runtimeDir = path.join(root, 'runtime');
  const existing = path.join(root, 'existing');
  const missing = path.join(root, 'new', 'reports');
  const file = path.join(root, 'not-a-directory.txt');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(file, 'file');
  const execute = createLocalActionExecutor({ runtimeDir });
  const dispatcher = new ActionDispatcher({ workdir: root, execute });
  try {
    const roots = await dispatcher.dispatch({ id: 'directory-roots', dedupeKey: 'directory-roots', type: 'directory.inspect', payload: { includeRoots: true } });
    assert.equal(roots.status, 'succeeded');
    assert.ok(Array.isArray(roots.result.roots));
    assert.ok(roots.result.currentPath);

    const selected = await dispatcher.dispatch({ id: 'directory-existing', dedupeKey: 'directory-existing', type: 'directory.inspect', payload: { path: existing, createIfMissing: false } });
    assert.equal(selected.status, 'succeeded');
    assert.equal(selected.result.path, path.resolve(existing));
    assert.equal(selected.result.exists, true);
    assert.equal(selected.result.created, false);
    assert.equal(selected.result.isDirectory, true);

    const created = await dispatcher.dispatch({ id: 'directory-create', dedupeKey: 'directory-create', type: 'directory.inspect', payload: { path: missing, createIfMissing: true } });
    assert.equal(created.status, 'succeeded');
    assert.equal(created.result.path, path.resolve(missing));
    assert.equal(created.result.exists, true);
    assert.equal(created.result.created, true);
    assert.equal(fs.statSync(missing).isDirectory(), true);

    const rejected = await dispatcher.dispatch({ id: 'directory-file', dedupeKey: 'directory-file', type: 'directory.inspect', payload: { path: file, createIfMissing: true } });
    assert.equal(rejected.status, 'failed');
    assert.match(rejected.error, /不是目录|directory/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
