import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateUpdateSource, downloadVerifiedPackage, resolveInstalledPackage, validateCandidatePackage, performClientUpdate, resolveNpmCli } from '../scripts/client-update.mjs';

const run = promisify(execFile);

test('update sources reject copied Markdown, embedded credentials and mutable query strings', () => {
  assert.equal(validateUpdateSource('https://qzelynth.top/downloads/cli/ziwei-latest.tgz'), 'https://qzelynth.top/downloads/cli/ziwei-latest.tgz');
  for (const source of ['[https://qzelynth.top/a](https://qzelynth.top/a)', 'https://user:password@example.com/a', 'http://example.com/a', 'https://example.com/a?token=secret', 'file:///tmp/a']) assert.throws(() => validateUpdateSource(source));
});

test('download verification rejects corrupt bytes and keeps previous package and identities intact', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-update-download-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('a genuine fixture archive payload');
  const server = http.createServer((_, response) => { response.end(bytes); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/package.tgz`;
  const target = path.join(directory, 'verified.tgz');
  await assert.rejects(downloadVerifiedPackage({ url, sha256: '0'.repeat(64), destination: target, allowLoopback: true }), /校验|hash|SHA/i);
  assert.equal(fs.existsSync(target), false);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await downloadVerifiedPackage({ url, sha256, destination: target, allowLoopback: true });
  assert.deepEqual(fs.readFileSync(target), bytes);
});

test('update only accepts the canonical Ziwei global install and exact supported bin map', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-update-layout-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'node_modules', 'ziwei');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ziwei', version: '0.1.0', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } }));
  fs.writeFileSync(path.join(root, 'scripts/ziwei-user.mjs'), '// fixture');
  assert.equal(resolveInstalledPackage(root, 'win32').prefix, directory);
  assert.throws(() => resolveInstalledPackage(directory, 'win32'));
  assert.equal(validateCandidatePackage(root).name, 'ziwei');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'other-cli', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } }));
  assert.throws(() => validateCandidatePackage(root), /紫薇|ziwei/);
});

test('Windows staged npm update preserves stopped state, original prefix, bin shim and every connection identity', { skip: process.platform !== 'win32' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-real-npm-update-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const prefix = path.join(directory, 'global-prefix');
  const root = path.join(prefix, 'node_modules', 'ziwei');
  const source = path.join(directory, 'package-source');
  function fixture(target, version) {
    fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'ziwei', version, type: 'module', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } }));
    fs.writeFileSync(path.join(target, 'scripts/ziwei-user.mjs'), `#!/usr/bin/env node\nconsole.log('ziwei_user ${version}');\n`);
  }
  fixture(root, '0.1.0'); fixture(source, '0.1.1');
  for (const suffix of ['', '.cmd', '.ps1']) fs.writeFileSync(path.join(prefix, 'ziwei_user' + suffix), 'node_modules/ziwei/scripts/ziwei-user.mjs');
  fs.mkdirSync(path.join(prefix, 'node_modules', 'other-cli')); fs.writeFileSync(path.join(prefix, 'node_modules', 'other-cli', 'keep'), 'unrelated CLI');
  const home = path.join(directory, 'user-data'); fs.mkdirSync(home);
  const file = path.join(home, 'ziwei_user.json');
  const config = JSON.stringify({ workspace: 'original', deviceId: 'device_same', deviceToken: 'fixture-private', sharedWorkspaces: [{ workspace: 'shared', deviceId: 'device_shared', deviceTokenFile: 'same-file' }], workdir: 'original-workdir' });
  fs.writeFileSync(file, config); fs.writeFileSync(path.join(home, 'MEMORY.md'), 'original Creator memory');
  const npmCli = resolveNpmCli();
  const packed = JSON.parse((await run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', directory], { cwd: source, windowsHide: true })).stdout)[0];
  const archive = path.join(directory, packed.filename);
  let stopped = 0;
  const result = await performClientUpdate({ root, directory: path.join(directory, 'operation'), artifactFile: archive, sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: file }, npmCli, stopClient: async () => { stopped++; return { wasRunning: false, alreadyStopped: true }; } });
  assert.equal(result.state, 'complete'); assert.equal(result.restoredRunning, false); assert.equal(result.prefix, prefix); assert.equal(stopped, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.1.1');
  assert.equal(fs.readFileSync(file, 'utf8'), config); assert.equal(fs.readFileSync(path.join(home, 'MEMORY.md'), 'utf8'), 'original Creator memory');
  assert.equal(fs.readFileSync(path.join(prefix, 'ziwei_user.cmd'), 'utf8'), 'node_modules/ziwei/scripts/ziwei-user.mjs');
  assert.equal(fs.readFileSync(path.join(prefix, 'node_modules', 'other-cli', 'keep'), 'utf8'), 'unrelated CLI');
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.backup, 'package.json'))).version, '0.1.0');
});

test('a corrupt candidate fails before stopping the client or touching its installed program', { skip: process.platform !== 'win32' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-update-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'prefix/node_modules/ziwei');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const metadata = JSON.stringify({ name: 'ziwei', version: '0.1.0', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } });
  fs.writeFileSync(path.join(root, 'package.json'), metadata); fs.writeFileSync(path.join(root, 'scripts/ziwei-user.mjs'), '// keep');
  for (const suffix of ['', '.cmd', '.ps1']) fs.writeFileSync(path.join(directory, 'prefix', 'ziwei_user' + suffix), 'node_modules/ziwei/scripts/ziwei-user.mjs');
  const home = path.join(directory, 'home'); fs.mkdirSync(home);
  const file = path.join(home, 'ziwei_user.json'); fs.writeFileSync(file, '{"workspace":"original","deviceId":"unchanged"}');
  const artifact = path.join(directory, 'corrupt.tgz'); fs.writeFileSync(artifact, 'not a tar archive');
  let stops = 0;
  await assert.rejects(performClientUpdate({ root, env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: file }, directory: path.join(directory, 'maintenance'), artifactFile: artifact, sha256: createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), stopClient: async () => { stops++; return { wasRunning: true }; } }));
  assert.equal(stops, 0); assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), metadata);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"workspace":"original","deviceId":"unchanged"}');
});

test('failed startup after package swap restores the original program and connection data', { skip: process.platform !== 'win32' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-update-rollback-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const prefix = path.join(directory, 'prefix');
  const root = path.join(prefix, 'node_modules', 'ziwei');
  const source = path.join(directory, 'candidate');
  for (const [target, version] of [[root, '0.1.0'], [source, '0.1.1']]) {
    fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'ziwei', version, type: 'module', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } }));
    fs.writeFileSync(path.join(target, 'scripts/ziwei-user.mjs'), `console.log('ziwei_user ${version}');\n`);
  }
  const home = path.join(directory, 'user-data'); fs.mkdirSync(home);
  const configFile = path.join(home, 'ziwei_user.json');
  const configBytes = JSON.stringify({ workspace: 'original', deviceId: 'original-device', deviceToken: 'private-fixture', connectionState: 'connected' });
  fs.writeFileSync(configFile, configBytes);
  fs.writeFileSync(path.join(home, 'Creator-MEMORY.md'), 'original memory');
  // The candidate passes version validation but cannot start; only the restored
  // original script can produce this marker. Neither fixture starts a daemon.
  fs.writeFileSync(path.join(root, 'scripts/start-ziwei-user.mjs'), "import fs from 'node:fs'; import path from 'node:path'; fs.writeFileSync(path.join(process.env.ZIWEI_USER_HOME,'original-restarted'), 'original');\n");
  fs.writeFileSync(path.join(source, 'scripts/start-ziwei-user.mjs'), "process.exit(23);\n");
  const bins = ['', '.cmd', '.ps1'].map(suffix => path.join(prefix, 'ziwei_user' + suffix));
  for (const file of bins) fs.writeFileSync(file, 'node_modules/ziwei/scripts/ziwei-user.mjs');
  const npmCli = resolveNpmCli();
  const packed = JSON.parse((await run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', directory], { cwd: source, windowsHide: true })).stdout)[0];
  const archive = path.join(directory, packed.filename);
  const stoppedVersions = [];
  await assert.rejects(performClientUpdate({ root, directory: path.join(directory, 'maintenance'), artifactFile: archive,
    sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: configFile }, npmCli,
    stopClient: async () => { stoppedVersions.push(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version); return { wasRunning: true }; }
  }), error => error.code === 'UPDATE_FAILED' && error.originalRestored === true);
  assert.deepEqual(stoppedVersions, ['0.1.0', '0.1.1']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.1.0');
  assert.equal(fs.readFileSync(path.join(home, 'original-restarted'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(configFile, 'utf8'), configBytes);
  assert.equal(fs.readFileSync(path.join(home, 'Creator-MEMORY.md'), 'utf8'), 'original memory');
  assert.ok(bins.every(file => fs.readFileSync(file, 'utf8') === 'node_modules/ziwei/scripts/ziwei-user.mjs'));
});
