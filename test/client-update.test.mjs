import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { validateUpdateSource, downloadVerifiedPackage, resolveInstalledPackage, validateCandidatePackage, performClientUpdate, resolveNpmCli, describeUpdateFailure, updateFailureResult } from '../scripts/client-update.mjs';

const run = promisify(execFile);

// Match the package-outside detached worker layout produced by launchClientUpdate.
function detachedUpdateWorker(directory) {
  const source=path.resolve(import.meta.dirname,'..'),helper=path.join(directory,'helper');
  for(const relative of ['package.json','daemon/config.mjs','src/management-bootstrap.mjs','scripts/client-update.mjs','scripts/client-update-worker.mjs','scripts/client-lifecycle.mjs','scripts/client-retained-stop-recovery.mjs','scripts/client-legacy-identity.mjs','scripts/client-legacy-identity.ps1']) {
    const target=path.join(helper,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,relative),target);
  }
  return path.join(helper,'scripts/client-update-worker.mjs');
}


function fileInventory(directory) {
  const files = {}, directories = [];
  const visit = (folder, relative = '') => {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const name = relative ? relative + '/' + item.name : item.name;
      assert.equal(item.isSymbolicLink(), false, 'a completed installation must not contain links');
      if (item.isDirectory()) { directories.push(name); visit(path.join(folder, item.name), name); }
      else { assert.equal(item.isFile(), true); files[name] = createHash('sha256').update(fs.readFileSync(path.join(folder, item.name))).digest('hex'); }
    }
  };
  visit(directory);
  return { files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))), directories: directories.sort() };
}

function bundleInstalledRuntimeDependencies(source) {
  const repository = path.resolve(import.meta.dirname, '..'), modules = path.join(repository, 'node_modules');
  const pending = ['express', 'ws', 'yaml'].map(name => ({ name, from: repository })), copied = new Set(), versions = {};
  while (pending.length) {
    const { name, from } = pending.pop();
    const require = createRequire(path.join(from, 'package.json'));
    // Some dependencies intentionally export only subpaths and no bare entry.
    // Resolve the installed package folder using Node's own module search path.
    const directory = require.resolve.paths(name).map(folder => path.join(folder, name)).find(folder => fs.existsSync(path.join(folder, 'package.json')));
    assert.ok(directory, 'installed runtime package must have metadata');
    const meta = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))); assert.equal(meta.name, name);
    if (from === repository) versions[name] = meta.version;
    if (copied.has(directory)) continue;
    copied.add(directory);
    const relative = path.relative(modules, directory);
    assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    const target = path.join(source, 'node_modules', relative);
    // Materialize real installed fixture files without invoking the crashing
    // Node fs.cpSync path before the updater itself is under test.
    const copyFixture = (fromDirectory, toDirectory) => {
      fs.mkdirSync(toDirectory, { recursive: true });
      for (const item of fs.readdirSync(fromDirectory, { withFileTypes: true })) {
        if (item.name === 'node_modules') continue;
        assert.equal(item.isSymbolicLink(), false);
        if (item.isDirectory()) copyFixture(path.join(fromDirectory, item.name), path.join(toDirectory, item.name));
        else { assert.ok(item.isFile()); fs.writeFileSync(path.join(toDirectory, item.name), fs.readFileSync(path.join(fromDirectory, item.name))); }
      }
    };
    copyFixture(directory, target);
    for (const dependency of Object.keys(meta.dependencies || {})) pending.push({ name: dependency, from: directory });
  }
  const packageFile = path.join(source, 'package.json');
  fs.writeFileSync(packageFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(packageFile)), dependencies: versions, bundledDependencies: Object.keys(versions) }));
  return copied.size;
}

test('maintenance diagnostics distinguish a fetch timeout from a child process exit', () => {
  const timedOut = new DOMException('PRIVATE_TIMEOUT_PAYLOAD', 'TimeoutError');
  const diagnostic = describeUpdateFailure(timedOut, 'download_package');
  assert.equal(diagnostic.reasonCode, 'OPERATION_TIMEOUT');
  assert.equal(diagnostic.failureStage, 'download_package');
  assert.equal('exitCode' in diagnostic, false);
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_TIMEOUT_PAYLOAD/);
});

test('maintenance diagnostics project only bounded facts from nested or cyclic errors', () => {
  const secret = 'PRIVATE_' + 'S'.repeat(8192);
  const cause = Object.assign(new Error(secret), { code: 'EACCES', signal: secret, stdout: secret, stderr: secret, cmd: secret });
  const outer = Object.assign(new Error(secret, { cause }), { code: secret, configuration: secret, reason: secret, failureStage: secret });
  cause.cause = outer;
  const diagnostic = describeUpdateFailure(outer, secret);
  assert.equal(diagnostic.failureStage, 'unknown');
  assert.equal(diagnostic.reasonCode, 'EACCES');
  assert.equal('signal' in diagnostic, false);
  assert.ok(JSON.stringify(diagnostic).length < 512);
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_|stdout|stderr|cmd|configuration/);
  const result = updateFailureResult(outer, 'stop_client');
  assert.equal(result.reasonCode, 'EACCES');
  assert.equal(result.failureStage, 'stop_client');
  assert.equal(result.code, 'UPDATE_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|stdout|stderr|cmd|configuration/);
});

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
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-update-layout-')));
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

test('Windows staged npm update copies the complete runtime dependency tree before stopping and preserves identity', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
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
  const dependencyCount = bundleInstalledRuntimeDependencies(source);
  assert.ok(dependencyCount > 30, 'exercise the real Express/ws/yaml dependency closure, not a two-file package');
  for (const suffix of ['', '.cmd', '.ps1']) fs.writeFileSync(path.join(prefix, 'ziwei_user' + suffix), 'node_modules/ziwei/scripts/ziwei-user.mjs');
  fs.mkdirSync(path.join(prefix, 'node_modules', 'other-cli')); fs.writeFileSync(path.join(prefix, 'node_modules', 'other-cli', 'keep'), 'unrelated CLI');
  const home = path.join(directory, 'user-data'); fs.mkdirSync(home);
  const file = path.join(home, 'ziwei_user.json');
  const config = JSON.stringify({ workspace: 'original', deviceId: 'device_same', deviceToken: 'fixture-private', sharedWorkspaces: [{ workspace: 'shared', deviceId: 'device_shared', deviceTokenFile: 'same-file' }], workdir: 'original-workdir' });
  fs.writeFileSync(file, config); fs.writeFileSync(path.join(home, 'MEMORY.md'), 'original Creator memory');
  const npmCli = resolveNpmCli();
  const packed = JSON.parse((await run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', directory], { cwd: source, windowsHide: true })).stdout)[0];
  const archive = path.join(directory, packed.filename);
  let stopped = 0, stagedInventory;
  const operation = path.join(directory, 'operation');
  const result = await performClientUpdate({ root, directory: operation, artifactFile: archive, sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: file, npm_config_offline: 'true' }, npmCli, stopClient: async () => {
    stopped++;
    const candidates = fs.readdirSync(path.dirname(root)).filter(name => name.startsWith('.ziwei-ready-'));
    assert.equal(candidates.length, 1);
    stagedInventory = fileInventory(path.join(operation, 'stage-prefix', 'node_modules', 'ziwei'));
    assert.ok(Object.keys(stagedInventory.files).length > 300, 'copy the actual installed dependency files');
    t.diagnostic(`Verified ${dependencyCount} real runtime packages and ${Object.keys(stagedInventory.files).length} installed file hashes before stop.`);
    assert.deepEqual(fileInventory(path.join(path.dirname(root), candidates[0])), stagedInventory, 'all candidate bytes must be prepared before stop');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.1.0');
    return { wasRunning: false, alreadyStopped: true };
  } });
  assert.equal(result.state, 'complete'); assert.equal(result.restoredRunning, false); assert.equal(result.prefix, prefix); assert.equal(stopped, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.1.1');
  assert.equal(fs.readFileSync(file, 'utf8'), config); assert.equal(fs.readFileSync(path.join(home, 'MEMORY.md'), 'utf8'), 'original Creator memory');
  assert.equal(fs.readFileSync(path.join(prefix, 'ziwei_user.cmd'), 'utf8'), 'node_modules/ziwei/scripts/ziwei-user.mjs');
  assert.equal(fs.readFileSync(path.join(prefix, 'node_modules', 'other-cli', 'keep'), 'utf8'), 'unrelated CLI');
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.backup, 'package.json'))).version, '0.1.0');
  assert.deepEqual(fileInventory(root), stagedInventory, 'every installed dependency byte and directory must match staging');
});

test('Windows staged candidate junction is rejected before stopping and cannot copy external userdata', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-update-copy-link-'));
  const resolved = path.resolve(directory); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('ziwei-update-copy-link-'));
  t.after(() => fs.rmSync(resolved, { recursive: true, force: true }));
  const prefix = path.join(directory, 'prefix'), root = path.join(prefix, 'node_modules', 'ziwei'), source = path.join(directory, 'source');
  for (const [folder, version] of [[root, '0.1.0'], [source, '0.1.1']]) {
    fs.mkdirSync(path.join(folder, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'ziwei', version, type: 'module', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } }));
    fs.writeFileSync(path.join(folder, 'scripts', 'ziwei-user.mjs'), 'console.log("fixture");');
  }
  for (const suffix of ['', '.cmd', '.ps1']) fs.writeFileSync(path.join(prefix, 'ziwei_user' + suffix), 'node_modules/ziwei/scripts/ziwei-user.mjs');
  const home = path.join(directory, 'userdata'); fs.mkdirSync(home);
  const configPath = path.join(home, 'ziwei_user.json'); fs.writeFileSync(configPath, '{"workspace":"retained"}');
  fs.writeFileSync(path.join(home, 'memory.txt'), 'must never enter candidate');
  // Version validation runs in staging before copy. Create an actual Windows
  // junction there to exercise refusal without exposing any real user folder.
  fs.writeFileSync(path.join(source, 'scripts', 'ziwei-user.mjs'), 'import fs from "node:fs";import path from "node:path";fs.symlinkSync(process.env.ZIWEI_USER_HOME,path.resolve(import.meta.dirname,"../external-data"),"junction");console.log("fixture");');
  const npmCli = resolveNpmCli();
  const packed = JSON.parse((await run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', directory], { cwd: source, windowsHide: true })).stdout)[0];
  const archive = path.join(directory, packed.filename), original = fileInventory(root), originalUserdata = fileInventory(home);
  let stops = 0;
  await assert.rejects(performClientUpdate({ root, directory: path.join(directory, 'operation'), artifactFile: archive, sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: configPath }, npmCli, stopClient: async () => { stops++; return { wasRunning: false }; } }), error => error.failureStage === 'prepare_candidate' && error.reasonCode === 'UNSAFE_PATH');
  assert.equal(stops, 0); assert.deepEqual(fileInventory(root), original); assert.deepEqual(fileInventory(home), originalUserdata);
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
  const events = [];
  await assert.rejects(performClientUpdate({ root, env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: file }, directory: path.join(directory, 'maintenance'), artifactFile: artifact, sha256: createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), stopClient: async () => { stops++; return { wasRunning: true }; }, log: (event, data) => events.push({ event, ...data }) }), error => {
    assert.equal(error.failureStage, 'stage_install');
    assert.equal(error.reasonCode, 'PROCESS_EXIT_NONZERO');
    assert.equal(error.exitCode, 1);
    assert.equal(error.originalRestored, true);
    assert.doesNotMatch(error.message, /npm ERR|Command failed|npm-cli\.js|corrupt\.tgz/);
    return true;
  });
  assert.equal(stops, 0); assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), metadata);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"workspace":"original","deviceId":"unchanged"}');
  assert.equal(events.filter(item => item.event === 'update_failed').length, 1);
  assert.equal(events.at(-1).failureStage, 'stage_install');
  assert.equal(events.at(-1).reasonCode, 'PROCESS_EXIT_NONZERO');
  fs.mkdirSync(path.join(home, 'maintenance'), { recursive: true });
  const workerDirectory = path.join(home, 'maintenance', 'update-12345678-1234-1234-1234-123456789abc'); fs.mkdirSync(workerDirectory);
  const parent = await run(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { windowsHide: true });
  const jobFile = path.join(workerDirectory, 'job.json');
  fs.writeFileSync(jobFile, JSON.stringify({ root, directory: workerDirectory, parentPid: Number(parent.stdout), artifactFile: artifact, sha256: createHash('sha256').update(fs.readFileSync(artifact)).digest('hex') }));
  await assert.rejects(run(process.execPath, [detachedUpdateWorker(workerDirectory), jobFile], { env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: file }, windowsHide: true, timeout: 10_000 }), error => error.code === 1);
  const result = JSON.parse(fs.readFileSync(path.join(workerDirectory, 'result.json')));
  assert.equal(result.code, 'UPDATE_FAILED');
  assert.equal(result.failureStage, 'stage_install');
  assert.equal(result.reasonCode, 'PROCESS_EXIT_NONZERO');
  assert.equal(result.exitCode, 1);
  assert.equal(result.originalRestored, true);
  assert.match(result.message, /stage_install/);
  const workerEvents = fs.readFileSync(path.join(workerDirectory, 'maintenance.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const workerFailures = workerEvents.filter(item => ['update_failed', 'maintenance_failed'].includes(item.event));
  assert.equal(workerFailures.length, 2);
  for (const event of workerFailures) {
    assert.equal(event.failureStage, result.failureStage);
    assert.equal(event.reasonCode, result.reasonCode);
    assert.equal(event.exitCode, result.exitCode);
    assert.equal(event.originalRestored, true);
  }
  assert.doesNotMatch(JSON.stringify({ result, workerEvents }), /Command failed|npm ERR|stdout|stderr/);
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), metadata);
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
  fs.writeFileSync(path.join(source, 'scripts/start-ziwei-user.mjs'), "console.error('deviceToken=PRIVATE_DIAGNOSTIC_SECRET config=PRIVATE_CONFIGURATION'); process.exit(23);\n");
  const bins = ['', '.cmd', '.ps1'].map(suffix => path.join(prefix, 'ziwei_user' + suffix));
  for (const file of bins) fs.writeFileSync(file, 'node_modules/ziwei/scripts/ziwei-user.mjs');
  const npmCli = resolveNpmCli();
  const packed = JSON.parse((await run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', directory], { cwd: source, windowsHide: true })).stdout)[0];
  const archive = path.join(directory, packed.filename);
  const stoppedVersions = [];
  const events = [];
  await assert.rejects(performClientUpdate({ root, directory: path.join(directory, 'maintenance'), artifactFile: archive,
    sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: configFile }, npmCli,
    stopClient: async () => { stoppedVersions.push(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version); return { wasRunning: true }; },
    log: (event, data) => events.push({ event, ...data })
  }), error => {
    assert.equal(error.code, 'UPDATE_FAILED');
    assert.equal(error.originalRestored, true);
    assert.equal(error.failureStage, 'restart_client');
    assert.equal(error.reasonCode, 'PROCESS_EXIT_NONZERO');
    assert.equal(error.exitCode, 23);
    assert.match(error.message, /restart_client|启动/);
    assert.doesNotMatch(error.message, /PRIVATE_|Command failed|start-ziwei-user\.mjs/);
    return true;
  });
  assert.deepEqual(stoppedVersions, ['0.1.0', '0.1.1']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.1.0');
  assert.equal(fs.readFileSync(path.join(home, 'original-restarted'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(configFile, 'utf8'), configBytes);
  assert.equal(fs.readFileSync(path.join(home, 'Creator-MEMORY.md'), 'utf8'), 'original memory');
  assert.ok(bins.every(file => fs.readFileSync(file, 'utf8') === 'node_modules/ziwei/scripts/ziwei-user.mjs'));
  const failures = events.filter(item => item.event === 'update_failed');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].failureStage, 'restart_client');
  assert.equal(failures[0].reasonCode, 'PROCESS_EXIT_NONZERO');
  assert.equal(failures[0].exitCode, 23);
  assert.doesNotMatch(JSON.stringify(failures), /PRIVATE_|Command failed|deviceToken|stdout|stderr/);

  // A second isolated attempt has a restored original that cannot restart either.
  // Both failure causes must survive; the original program still remains on disk.
  fs.writeFileSync(path.join(root, 'scripts/start-ziwei-user.mjs'), "console.error('PRIVATE_RESTORE_SECRET'); process.exit(19);\n");
  events.length = 0;
  await assert.rejects(performClientUpdate({ root, directory: path.join(directory, 'maintenance-restart-failure'), artifactFile: archive,
    sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: configFile }, npmCli,
    stopClient: async () => ({ wasRunning: true }), log: (event, data) => events.push({ event, ...data })
  }), error => {
    const result = updateFailureResult(error);
    assert.equal(result.originalRestored, false);
    assert.equal(result.failureStage, 'restart_client');
    assert.equal(result.exitCode, 23);
    assert.equal(result.recoveryFailure?.failureStage, 'restart_original');
    assert.equal(result.recoveryFailure?.reasonCode, 'PROCESS_EXIT_NONZERO');
    assert.equal(result.recoveryFailure?.exitCode, 19);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|Command failed|stdout|stderr/);
    return true;
  });
  assert.equal(events.at(-1).recoveryFailure?.exitCode, 19);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.1.0');
  assert.equal(fs.readFileSync(configFile, 'utf8'), configBytes);
  assert.equal(fs.readFileSync(path.join(home, 'Creator-MEMORY.md'), 'utf8'), 'original memory');
  assert.ok(bins.every(file => fs.readFileSync(file, 'utf8') === 'node_modules/ziwei/scripts/ziwei-user.mjs'));

  const externalConfig = '{"newConfiguration":"PRIVATE_EXTERNAL_CHANGE"';
  let stopCalls = 0;
  await assert.rejects(performClientUpdate({ root, directory: path.join(directory, 'maintenance-external-config'), artifactFile: archive,
    sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: configFile }, npmCli,
    stopClient: async () => { if (++stopCalls === 2) fs.writeFileSync(configFile, externalConfig); return { wasRunning: true }; }
  }), error => {
    const result = updateFailureResult(error);
    assert.equal(result.originalRestored, false);
    assert.equal(result.failureStage, 'restart_client');
    assert.equal(result.exitCode, 23);
    assert.equal(result.recoveryFailure?.failureStage, 'read_restoration_configuration');
    assert.equal(result.recoveryFailure?.reasonCode, 'CONFIG_CHANGED');
    assert.equal(result.originalInstallationRestored, true);
    assert.equal(result.runningStateRestored, false);
    assert.match(result.message, /原运行状态未恢复/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|Command failed|stdout|stderr/);
    return true;
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.1.0');
  assert.equal(fs.readFileSync(configFile, 'utf8'), externalConfig, 'maintenance must never restore stale connection configuration');
  assert.equal(fs.readFileSync(path.join(home, 'Creator-MEMORY.md'), 'utf8'), 'original memory');
  assert.ok(bins.every(file => fs.readFileSync(file, 'utf8') === 'node_modules/ziwei/scripts/ziwei-user.mjs'));
});

test('update worker reports an unverified lock without changing another maintenance operation', async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-update-worker-lock-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const home = path.join(directory, 'home');
  const maintenance = path.join(home, 'maintenance');
  fs.mkdirSync(maintenance, { recursive: true });
  const lockFile = path.join(maintenance, 'operation.lock');
  const originalLock = '{"operation":"uninstall","private":"PRIVATE_EXISTING_LOCK"}';
  fs.writeFileSync(lockFile, originalLock);
  const parent = await run(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { windowsHide: true });
  const workerDirectory=path.join(maintenance,'update-12345678-1234-1234-1234-123456789abc');fs.mkdirSync(workerDirectory);
  const jobFile = path.join(workerDirectory, 'job.json');
  fs.writeFileSync(jobFile, JSON.stringify({ directory:workerDirectory, parentPid: Number(parent.stdout), root: path.join(directory, 'untouched-installation') }));
  await assert.rejects(run(process.execPath, [detachedUpdateWorker(workerDirectory), jobFile], { env: { ...process.env, ZIWEI_USER_HOME: home }, windowsHide: true, timeout: 10_000 }), error => error.code === 1);
  const result = JSON.parse(fs.readFileSync(path.join(workerDirectory, 'result.json')));
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'MAINTENANCE_OWNER_UNVERIFIED');
  assert.equal(result.failureStage, 'acquire_lock');
  assert.equal(result.reasonCode, 'MAINTENANCE_OWNER_UNVERIFIED');
  assert.equal(result.originalRestored, true);
  const failed = fs.readFileSync(path.join(workerDirectory, 'maintenance.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).find(item => item.event === 'maintenance_failed');
  assert.equal(failed.failureStage, result.failureStage);
  assert.equal(failed.reasonCode, result.reasonCode);
  assert.equal(failed.originalRestored, true);
  assert.doesNotMatch(JSON.stringify({ result, failed }), /PRIVATE_|private|stdout|stderr/);
  assert.equal(fs.readFileSync(lockFile, 'utf8'), originalLock);
});


test('pure local history stop failure can restore the original client while audited business recovery stays stopped', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-local-history-rollback-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const localHistoryRetained of [true, false]) {
    const scope = path.join(directory, localHistoryRetained ? 'local-history' : 'audited-business');
    const prefix = path.join(scope, 'prefix'), root = path.join(prefix, 'node_modules', 'ziwei'), source = path.join(scope, 'candidate'), home = path.join(scope, 'home');
    for (const [target, version] of [[root, '0.1.0'], [source, '0.1.1']]) {
      fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'ziwei', version, type: 'module', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } }));
      fs.writeFileSync(path.join(target, 'scripts/ziwei-user.mjs'), `console.log('ziwei_user ${version}');\n`);
    }
    fs.mkdirSync(home); const configPath = path.join(home, 'ziwei_user.json'), marker = path.join(home, 'original-restarted');
    const originalConfig = JSON.stringify({ workspace: 'fixture', deviceId: 'fixture-device', deviceToken: 'private-fixture', connectionState: 'connected' }); fs.writeFileSync(configPath, originalConfig);
    fs.writeFileSync(path.join(root, 'scripts/start-ziwei-user.mjs'), "import fs from 'node:fs';import path from 'node:path';fs.writeFileSync(path.join(process.env.ZIWEI_USER_HOME,'original-restarted'),'yes');\n");
    const receipt = { stopped: true, wasRunning: true, pid: 12345, originalExecutionExitConfirmed: false, executionConfirmedStopped: false, ...(localHistoryRetained ? { localHistoryRetained: true } : { prelaunchHistoryRetained: true }) };
    fs.writeFileSync(path.join(source, 'scripts/client-historical-prelaunch-recovery.mjs'), `export async function recoverHistoricalPrelaunchForUpdate(){throw Object.assign(Error('fixture recovery failed'),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED',stoppedClientReceipt:${JSON.stringify(receipt)}});}`);
    for (const suffix of ['', '.cmd', '.ps1']) fs.writeFileSync(path.join(prefix, 'ziwei_user' + suffix), 'node_modules/ziwei/scripts/ziwei-user.mjs');
    const npmCli = resolveNpmCli(); const packed = JSON.parse((await run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', scope], { cwd: source, windowsHide: true })).stdout)[0];
    const archive = path.join(scope, packed.filename);
    await assert.rejects(performClientUpdate({ root, directory: path.join(scope, 'maintenance'), artifactFile: archive, sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), npmCli, env: { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: configPath }, stopClient: async () => { throw Error('normal stop must not run after candidate recovery fails'); } }), error => {
      assert.equal(error.failureStage, 'recover_history'); assert.equal(error.reasonCode, 'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'); assert.equal(error.originalInstallationRestored, true); assert.equal(error.runningStateRestored, localHistoryRetained); return true;
    });
    assert.equal(fs.existsSync(marker), localHistoryRetained); assert.equal(fs.readFileSync(configPath, 'utf8'), originalConfig); assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.1.0');
  }
});
