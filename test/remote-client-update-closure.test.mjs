import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {REMOTE_UPDATE_HELPER_FILES} from '../scripts/client-remote-update-worker.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';

test('the actual exported supervisor closure loads from outside the installed package without node_modules', t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-update-closure-')));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const root = path.resolve(import.meta.dirname, '..');
  for (const relative of REMOTE_UPDATE_HELPER_FILES) {
    const destination = path.join(directory, relative);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(path.join(root, relative), destination);
  }
  const entry = pathToFileURL(path.join(directory, 'scripts/client-remote-update-worker.mjs')).href;
  const env = {...process.env};
  delete env.NODE_OPTIONS; delete env.NODE_PATH;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'const m=await import(process.argv[1]);if(typeof m.runRemoteClientUpdateWorker!=="function")process.exit(2);', entry], {
    cwd: directory, env, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(directory, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(directory, 'maintenance')), false, 'import must not initiate maintenance');
});

test('packaged client identity covers the independent remote updater entry', t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-update-identity-')));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  fs.mkdirSync(path.join(directory, 'scripts'));
  const entry = path.join(directory, 'scripts/client-remote-update-worker.mjs');
  fs.writeFileSync(entry, '// first audited entry\n');
  const before = clientBuildIdentity(directory);
  fs.writeFileSync(entry, '// different entry\n');
  assert.notEqual(clientBuildIdentity(directory), before);
});
