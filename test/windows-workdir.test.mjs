import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ActionDispatcher } from '../src/daemon.mjs';
import { createLocalActionExecutor, inspectLocalDirectory, materializeRuntimeAttachments } from '../src/local-action.mjs';
import { discoverInstalledRuntimes, resetRuntimeDiscovery } from '../src/runtime-adapters.mjs';

const windowsOnly = { skip: process.platform !== 'win32' };

// Every write belongs to one of these fresh, exact fixture roots. The D root
// is intentionally on a different physical drive from the C default workdir.
function fixture(t) {
  const cParent = path.join(os.homedir(), 'AppData', 'Local', 'Temp');
  assert.equal(path.parse(cParent).root.toUpperCase(), 'C:\\');
  assert.ok(fs.statSync(cParent).isDirectory());
  assert.ok(fs.statSync('D:\\').isDirectory(), 'This Windows acceptance requires the real C and D drives');
  const cRoot = fs.mkdtempSync(path.join(cParent, 'ziwei-windows-workdir-'));
  const dLeaf = `.ziwei-windows-workdir-${randomUUID()}`;
  const dRoot = path.join('D:\\', dLeaf);
  assert.equal(fs.existsSync(dRoot), false);
  fs.mkdirSync(dRoot);
  const roots = [{ root: cRoot, parent: cParent, leaf: path.basename(cRoot) }, { root: dRoot, parent: 'D:\\', leaf: dLeaf }];
  const links = [];
  t.after(() => {
    for (const link of links) {
      assert.ok(roots.some(({ root }) => path.dirname(path.resolve(link)).toLowerCase() === path.resolve(root).toLowerCase()));
      if (fs.existsSync(link)) fs.unlinkSync(link);
    }
    for (const owned of roots) {
      const absolute = path.resolve(owned.root);
      assert.equal(path.dirname(absolute).toLowerCase(), path.resolve(owned.parent).toLowerCase());
      assert.equal(path.basename(absolute), owned.leaf);
      assert.notEqual(absolute.toLowerCase(), path.parse(absolute).root.toLowerCase());
      assert.equal(fs.lstatSync(absolute).isSymbolicLink(), false);
      fs.rmSync(absolute, { recursive: true, force: false });
    }
  });
  const defaultWorkdir = path.join(cRoot, '默认 工作目录');
  const cDirectory = path.join(cRoot, '中文 C 资料');
  const dDirectory = path.join(dRoot, '中文 D 资料');
  const runtimeDir = path.join(cRoot, 'private-runtime');
  for (const directory of [defaultWorkdir, cDirectory, dDirectory, runtimeDir]) fs.mkdirSync(directory);
  return { cRoot, dRoot, defaultWorkdir, cDirectory, dDirectory, runtimeDir, links };
}

function dispatcherFor(f, options = {}) {
  return new ActionDispatcher({ workdir: f.defaultWorkdir, execute: createLocalActionExecutor({ runtimeDir: f.runtimeDir, ...options }) });
}

function inspectAction(id, directory, extra = {}) {
  return { id, dedupeKey: id, type: 'directory.inspect', payload: { path: directory, includeRoots: true, includeChildren: false, ...extra } };
}

function installIsolatedCli(t, f) {
  const binary = path.join(f.cRoot, 'codex.cmd');
  const entry = path.join(f.cRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const codexHome = path.join(f.cRoot, 'fixture-codex-home');
  const hermesHome = path.join(f.cRoot, 'fixture-hermes-home');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.mkdirSync(codexHome);
  fs.mkdirSync(hermesHome);
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'synthetic-cwd-fixture-only' }));
  fs.writeFileSync(binary, '@echo off\r\nexit /b 99\r\n');
  fs.writeFileSync(entry, `const fs = require('node:fs');
if (process.argv.slice(2).join(' ') === '--version') { console.log('codex-cli 0.162.0'); process.exit(0); }
if (process.argv[2] !== 'exec') process.exit(4);
process.stdin.resume();
process.stdin.on('end', () => console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ cwd: process.cwd(), realCwd: fs.realpathSync.native(process.cwd()), fixture: true, models: 0 }) } })));
`);
  const envKeys = ['CODEX_HOME', 'HERMES_HOME', 'NPM_CONFIG_USERCONFIG', 'PATH', 'APPDATA', 'npm_config_prefix'];
  const original = new Map(envKeys.map(key => [key, process.env[key]]));
  process.env.CODEX_HOME = codexHome;
  process.env.HERMES_HOME = hermesHome;
  process.env.NPM_CONFIG_USERCONFIG = path.join(f.cRoot, 'empty.npmrc');
  process.env.PATH = [f.cRoot, path.join(process.env.SystemRoot, 'System32')].join(';');
  process.env.APPDATA = f.cRoot;
  process.env.npm_config_prefix = f.cRoot;
  fs.writeFileSync(process.env.NPM_CONFIG_USERCONFIG, '');
  t.mock.method(os, 'homedir', () => f.cRoot);
  t.after(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    resetRuntimeDiscovery();
  });
  resetRuntimeDiscovery();
  const found = discoverInstalledRuntimes({ force: true });
  assert.equal(found.runtimes.Codex.binary, binary);
  assert.equal(found.runtimes.Codex.status, 'available');
  assert.ok(Object.values(found.runtimes).filter(item => item.status === 'available').every(item => item.binary === binary));
  // executeRuntime makes this exact cache lookup; test the normal call before
  // any action can launch a process, rather than assuming fixture discovery
  // injected through cliDiscovery will populate the adapter's cache.
  assert.equal(discoverInstalledRuntimes().runtimes.Codex.binary, binary);
  return { CODEX_HOME: codexHome, HERMES_HOME: hermesHome, OPENAI_API_KEY: 'synthetic-cwd-fixture-only' };
}

test('Windows directory inspection accepts real C and D roots with a nested default', windowsOnly, async t => {
  const f = fixture(t);
  const dispatcher = dispatcherFor(f);
  for (const [index, root] of ['C:\\', 'D:\\', 'C:', 'D:', 'C:/', 'D:/'].entries()) {
    const expected = `${root[0]}:\\`;
    const result = await dispatcher.dispatch(inspectAction(`root-${index}`, root));
    assert.equal(result.status, 'succeeded', result.error);
    assert.equal(result.result.path.toUpperCase(), expected);
    assert.equal(result.result.isDirectory, true);
    assert.ok(result.result.roots.some(item => item.toUpperCase() === 'C:\\'));
    assert.ok(result.result.roots.some(item => item.toUpperCase() === 'D:\\'));
    assert.deepEqual(result.result.entries, []);
  }
});

test('Windows directory action without payload uses the configured default rather than the daemon process cwd', windowsOnly, async t => {
  const f = fixture(t);
  const result = await dispatcherFor(f).dispatch({ id: 'no-payload-directory', type: 'directory.inspect' });
  assert.equal(result.status, 'succeeded', result.error);
  assert.equal(result.result.currentPath, f.defaultWorkdir);
  assert.equal(result.result.path, f.defaultWorkdir);
});

test('Windows direct executor uses its explicit defaultWorkdir as the directory starting location', windowsOnly, async t => {
  const f = fixture(t);
  const execute = createLocalActionExecutor({ runtimeDir: f.runtimeDir, defaultWorkdir: f.defaultWorkdir });
  const result = await execute({ id: 'executor-default-directory', type: 'directory.inspect', payload: { includeChildren: false } });
  assert.equal(result.status, 'succeeded', result.error);
  assert.equal(result.result.currentPath, f.defaultWorkdir);
  assert.equal(result.result.path, f.defaultWorkdir);
});

test('Windows directory target aliases resolve once from the configured starting location', windowsOnly, async t => {
  const f = fixture(t);
  const child = path.join(f.defaultWorkdir, 'child');
  fs.mkdirSync(child);
  const dispatcher = dispatcherFor(f);
  for (const alias of ['workingDirectory', 'working_directory']) {
    const result = await dispatcher.dispatch({ id: `directory-target-${alias}`, type: 'directory.inspect', payload: { [alias]: 'child', includeChildren: false } });
    assert.equal(result.status, 'succeeded', result.error);
    assert.equal(result.result.currentPath, f.defaultWorkdir);
    assert.equal(result.result.path, child);
    assert.equal(result.result.exists, true);
  }
});

test('Windows direct directory executor resolves an explicit relative workdir from its configured default', windowsOnly, async t => {
  const f = fixture(t);
  const child = path.join(f.defaultWorkdir, 'child');
  fs.mkdirSync(child);
  const execute = createLocalActionExecutor({ runtimeDir: f.runtimeDir, defaultWorkdir: f.defaultWorkdir });
  const result = await execute({ id: 'direct-directory-relative-base', type: 'directory.inspect', payload: { workdir: 'child', includeChildren: false } });
  assert.equal(result.status, 'succeeded', result.error);
  assert.equal(result.result.currentPath, child);
  assert.equal(result.result.path, child);
  assert.equal(result.result.exists, true);
});

test('Windows native bare drive workdir inputs select the drive root before normalization', windowsOnly, async t => {
  const f = fixture(t);
  const dispatcher = new ActionDispatcher({ workdir: f.defaultWorkdir, execute: async action => ({ receivedCwd: action.payload.cwd }) });
  for (const drive of ['C:', 'D:']) {
    const result = await dispatcher.dispatch({ id: `native-bare-drive-${drive[0]}`, type: 'conversation.execute', payload: { workdir: drive, prompt: 'No runtime or process is started for a drive-root parser check' } });
    assert.equal(result.status, 'succeeded', result.error);
    assert.equal(result.result.receivedCwd, `${drive}\\`);
  }
});

test('Windows native drive-relative workdir inputs are rejected explicitly before filesystem resolution', windowsOnly, async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.defaultWorkdir, 'relative'));
  let executed = false;
  const dispatcher = new ActionDispatcher({ workdir: f.defaultWorkdir, execute: async () => { executed = true; return {}; } });
  for (const drive of ['C:', 'D:']) {
    const result = await dispatcher.dispatch({ id: `native-drive-relative-${drive[0]}`, type: 'conversation.execute', payload: { workdir: `${drive}relative`, prompt: 'Must fail before any execution' } });
    assert.equal(result.status, 'failed');
    assert.match(result.error, /明确|绝对|盘根/i);
  }
  assert.equal(executed, false);
});

test('Windows direct directory executor treats a bare drive workdir as the root starting location', windowsOnly, async t => {
  const f = fixture(t);
  const execute = createLocalActionExecutor({ runtimeDir: f.runtimeDir, defaultWorkdir: f.defaultWorkdir });
  for (const drive of ['C:', 'D:']) {
    const result = await execute({ id: `direct-bare-drive-${drive[0]}`, type: 'directory.inspect', payload: { workdir: drive, includeChildren: false } });
    assert.equal(result.status, 'succeeded', result.error);
    assert.equal(result.result.currentPath, `${drive}\\`);
    assert.equal(result.result.path, `${drive}\\`);
    assert.equal(result.result.isDirectory, true);
  }
});

test('Windows absolute, relative, parent traversal and Chinese spaced paths are local workdirs', windowsOnly, async t => {
  const f = fixture(t);
  const dispatcher = dispatcherFor(f);
  const cases = [[f.cDirectory, f.cDirectory], [f.dDirectory, f.dDirectory], [path.relative(f.defaultWorkdir, f.cDirectory), f.cDirectory]];
  for (const [index, [input, expected]] of cases.entries()) {
    const result = await dispatcher.dispatch(inspectAction(`path-${index}`, input));
    assert.equal(result.status, 'succeeded', result.error);
    assert.equal(result.result.path, path.resolve(expected));
  }
  const base = inspectLocalDirectory({ directoryPath: f.dDirectory, basePath: path.join(f.cRoot, 'no-longer-existing-default'), includeChildren: false });
  assert.equal(base.exists, true, 'An explicit valid absolute directory must not depend on the old default still existing');
});

test('Windows browsing a missing folder never creates it and explicit creation uses the same path', windowsOnly, async t => {
  const f = fixture(t);
  const target = path.join(f.dDirectory, '用户显式 创建', '报告');
  const dispatcher = dispatcherFor(f);
  const missing = await dispatcher.dispatch(inspectAction('missing', target));
  assert.equal(missing.status, 'succeeded', missing.error);
  assert.equal(missing.result.exists, false);
  assert.equal(missing.result.created, false);
  assert.equal(fs.existsSync(target), false);
  const created = await dispatcher.dispatch(inspectAction('create', target, { createIfMissing: true }));
  assert.equal(created.status, 'succeeded', created.error);
  assert.equal(created.result.path, target);
  assert.equal(created.result.created, true);
  assert.equal(fs.statSync(target).isDirectory(), true);
});

test('Windows workdirs reject files and unavailable drives with meaningful errors', windowsOnly, async t => {
  const f = fixture(t);
  const file = path.join(f.dDirectory, '文件.txt');
  fs.writeFileSync(file, 'only fixture bytes');
  const dispatcher = dispatcherFor(f);
  const result = await dispatcher.dispatch(inspectAction('file', file));
  assert.equal(result.status, 'failed');
  assert.match(result.error, /不是目录|not.*directory/i);
  const unavailable = [...'ZYXWVUTSRQPONMLKJIHGFEB A'.replace(/ /g, '')].map(letter => `${letter}:\\`).find(root => !fs.existsSync(root));
  assert.ok(unavailable, 'This acceptance requires one unused drive letter');
  const drive = await dispatcher.dispatch(inspectAction('unavailable-drive', path.join(unavailable, 'missing'), { createIfMissing: true }));
  assert.equal(drive.status, 'failed');
  assert.match(drive.error, /盘|驱动|不存在|unavailable|not found/i);
  assert.equal(fs.existsSync(unavailable), false);
});

test('Windows workdirs reject UNC and device namespace paths before filesystem access', windowsOnly, t => {
  const f = fixture(t);
  for (const target of ['\\\\localhost\\C$\\', '\\\\other-computer\\share\\folder', '\\\\?\\UNC\\other-computer\\share', '\\\\.\\C:\\', '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\']) {
    assert.throws(() => inspectLocalDirectory({ directoryPath: target, basePath: f.defaultWorkdir, includeChildren: false }), /本地|UNC|网络|设备|namespace/i);
  }
  for (const target of ['C:relative-folder', 'D:relative-folder']) {
    assert.throws(() => inspectLocalDirectory({ directoryPath: target, basePath: f.defaultWorkdir, includeChildren: false }), /明确|绝对|盘根/i);
  }
});

test('Windows directory inspection reports actual current-user ACL denial without bypassing it', windowsOnly, t => {
  const f = fixture(t);
  const folder = f.cDirectory;
  const system32 = path.join(process.env.SystemRoot, 'System32');
  const whoami = execFileSync(path.join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = whoami.match(/S-1-[0-9-]+/)?.[0];
  assert.ok(sid, 'Current-user SID is needed only for this isolated folder ACL');
  const icacls = path.join(system32, 'icacls.exe');
  // Deny only directory listing on our own fresh folder. Keep the ability to
  // remove that deny entry and restore it synchronously before fixture cleanup.
  try {
    execFileSync(icacls, [folder, '/deny', `*${sid}:(RD)`], { windowsHide: true, stdio: 'ignore' });
    assert.throws(() => fs.readdirSync(folder), /EACCES|EPERM|permission|denied/i);
    assert.throws(() => inspectLocalDirectory({ directoryPath: folder, basePath: f.defaultWorkdir, includeChildren: true }), /权限|EACCES|EPERM|permission|denied/i);
  } finally {
    execFileSync(icacls, [folder, '/remove:d', `*${sid}`], { windowsHide: true, stdio: 'ignore' });
    assert.deepEqual(fs.readdirSync(folder), []);
  }
});

test('Windows native actions pass actual C and D cwd through dispatcher and CLI process', windowsOnly, async t => {
  const f = fixture(t);
  const env = installIsolatedCli(t, f);
  const dispatcher = dispatcherFor(f);
  for (const type of ['agent.execute', 'conversation.execute', 'runtime.execute', 'automation.execute', 'task.execute']) {
    for (const directory of [f.cDirectory, f.dDirectory]) {
      const id = `cwd-${type}-${directory[0]}`;
      const result = await dispatcher.dispatch({ id, type, payload: { runtime: 'Codex', cwd: directory, prompt: 'isolated cwd fixture; no model', env } });
      assert.equal(result.status, 'succeeded', result.error);
      const actual = JSON.parse(result.result.output);
      assert.equal(actual.cwd, directory);
      assert.equal(actual.realCwd, fs.realpathSync.native(directory));
      assert.equal(actual.models, 0);
      assert.equal(actual.fixture, true);
    }
  }
});

test('Windows native action without a requested directory starts the isolated CLI in its default cwd', windowsOnly, async t => {
  const f = fixture(t);
  const env = installIsolatedCli(t, f);
  const result = await dispatcherFor(f).dispatch({ id: 'default-cwd', type: 'conversation.execute', payload: { runtime: 'Codex', prompt: 'isolated cwd fixture; no model', env } });
  assert.equal(result.status, 'succeeded', result.error);
  const actual = JSON.parse(result.result.output);
  assert.equal(actual.cwd, f.defaultWorkdir);
  assert.equal(actual.models, 0);
});

test('Windows native explicit cwd wins over workdir default and relative cwd resolves from that default', windowsOnly, async t => {
  const f = fixture(t);
  const env = installIsolatedCli(t, f);
  const dispatcher = dispatcherFor(f);
  for (const [index, [cwd, expected]] of [[f.dDirectory, f.dDirectory], [path.relative(f.cRoot, f.cDirectory), f.cDirectory]].entries()) {
    const result = await dispatcher.dispatch({ id: `cwd-with-base-${index}`, type: 'conversation.execute', payload: { workdir: f.cRoot, cwd, runtime: 'Codex', prompt: 'isolated cwd fixture; no model', env } });
    assert.equal(result.status, 'succeeded', result.error);
    assert.equal(JSON.parse(result.result.output).cwd, expected);
  }
});

test('Windows dispatcher resolves a relative workdir once when there is no separate cwd', windowsOnly, async t => {
  const f = fixture(t);
  const child = path.join(f.defaultWorkdir, 'child');
  fs.mkdirSync(child);
  const env = installIsolatedCli(t, f);
  const result = await dispatcherFor(f).dispatch({ id: 'relative-workdir-only-dispatcher', type: 'conversation.execute', payload: { workdir: 'child', runtime: 'Codex', prompt: 'isolated cwd fixture; no model', env } });
  assert.equal(result.status, 'succeeded', result.error);
  assert.equal(JSON.parse(result.result.output).cwd, child);
});

test('Windows direct executor resolves a relative workdir once from its configured default', windowsOnly, async t => {
  const f = fixture(t);
  const child = path.join(f.defaultWorkdir, 'child');
  fs.mkdirSync(child);
  const env = installIsolatedCli(t, f);
  const execute = createLocalActionExecutor({ runtimeDir: f.runtimeDir, defaultWorkdir: f.defaultWorkdir });
  const result = await execute({ id: 'relative-workdir-only-executor', type: 'conversation.execute', payload: { workdir: 'child', runtime: 'Codex', prompt: 'isolated cwd fixture; no model', env } });
  assert.equal(result.status, 'succeeded', result.error);
  assert.equal(JSON.parse(result.result.output).cwd, child);
});

test('Windows prompt and model task actions without runtime fields also use the selected cross-drive cwd', windowsOnly, async t => {
  const f = fixture(t);
  const env = installIsolatedCli(t, f);
  const dispatcher = dispatcherFor(f, { defaultRuntime: 'Codex' });
  for (const [index, settings] of [{}, { modelId: 'fixture-no-model' }].entries()) {
    const result = await dispatcher.dispatch({ id: `task-without-runtime-${index}`, type: 'task.execute', payload: { cwd: f.dDirectory, prompt: 'isolated cwd fixture; no model', env, ...settings } });
    assert.equal(result.status, 'succeeded', result.error);
    assert.equal(JSON.parse(result.result.output).cwd, f.dDirectory);
  }
});

test('Windows native cwd aliases resolve relative to the configured default and existing folders are required', windowsOnly, async t => {
  const f = fixture(t);
  const env = installIsolatedCli(t, f);
  const dispatcher = dispatcherFor(f);
  for (const alias of ['cwd', 'workdir', 'workingDirectory', 'working_directory']) {
    const result = await dispatcher.dispatch({ id: `alias-${alias}`, type: 'conversation.execute', payload: { runtime: 'Codex', [alias]: path.relative(f.defaultWorkdir, f.cDirectory), prompt: 'isolated cwd fixture; no model', env } });
    assert.equal(result.status, 'succeeded', result.error);
    assert.equal(JSON.parse(result.result.output).cwd, f.cDirectory);
  }
  const missing = path.join(f.dDirectory, 'never implicitly create');
  const result = await dispatcher.dispatch({ id: 'missing-execution', type: 'conversation.execute', payload: { runtime: 'Codex', cwd: missing, prompt: 'isolated cwd fixture; no model', env } });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /不存在|not found|ENOENT/i);
  assert.equal(fs.existsSync(missing), false);
});

test('Windows junction directory is listed, inspectable and its real target becomes actual CLI cwd', windowsOnly, async t => {
  const f = fixture(t);
  const junction = path.join(f.cRoot, '跨盘 junction');
  fs.symlinkSync(f.dDirectory, junction, 'junction');
  f.links.push(junction);
  const listing = inspectLocalDirectory({ directoryPath: f.cRoot, basePath: f.defaultWorkdir, includeRoots: false });
  assert.ok(listing.entries.some(entry => entry.path === junction), 'Directory junctions are navigable directory entries');
  const inspected = inspectLocalDirectory({ directoryPath: junction, basePath: f.defaultWorkdir, includeChildren: false });
  assert.equal(fs.realpathSync.native(inspected.path), fs.realpathSync.native(f.dDirectory));
  const env = installIsolatedCli(t, f);
  const result = await dispatcherFor(f).dispatch({ id: 'junction-cwd', type: 'conversation.execute', payload: { runtime: 'Codex', cwd: junction, prompt: 'isolated cwd fixture; no model', env } });
  assert.equal(result.status, 'succeeded', result.error);
  assert.equal(JSON.parse(result.result.output).realCwd, fs.realpathSync.native(f.dDirectory));
});

test('Windows paired device and workspace identity remain enforced for directory and native actions', windowsOnly, async t => {
  const f = fixture(t);
  const execute = createLocalActionExecutor({ runtimeDir: f.runtimeDir, workspace: 'fixture_workspace', deviceId: 'fixture_device' });
  for (const type of ['directory.inspect', 'conversation.execute']) {
    await assert.rejects(() => execute({ id: `wrong-device-${type}`, workspace: 'fixture_workspace', type, payload: { deviceId: 'another_device', path: f.dDirectory, cwd: f.dDirectory, runtime: 'Codex', prompt: 'never execute' } }), /目标设备.*不一致/);
    await assert.rejects(() => execute({ id: `wrong-workspace-${type}`, workspace: 'another_workspace', type, payload: { deviceId: 'fixture_device', path: f.dDirectory, cwd: f.dDirectory, runtime: 'Codex', prompt: 'never execute' } }), /工作区.*不一致/);
  }
});

test('Windows private runtime file and allowlisted command actions cannot escape onto another drive', windowsOnly, async t => {
  const f = fixture(t);
  const execute = createLocalActionExecutor({ runtimeDir: f.runtimeDir, allowedExecutables: [process.execPath, 'node'] });
  for (const type of ['file.read', 'file.write']) {
    await assert.rejects(() => execute({ id: type, type, payload: { path: path.join(f.dDirectory, 'must-not-be-written'), content: 'fixture only' } }), /outside the registered runtime directory/);
  }
  await assert.rejects(() => execute({ id: 'command-cross-drive', type: 'command.execute', payload: { executable: 'node', cwd: f.dDirectory, args: ['-e', 'process.exit(0)'] } }), /outside the registered runtime directory/);
  const junction = path.join(f.runtimeDir, 'escape');
  fs.symlinkSync(f.dDirectory, junction, 'junction');
  // The root cleanup removes this link without following its destination.
  await assert.rejects(() => execute({ id: 'file-junction', type: 'file.write', payload: { path: 'escape/never-write', content: 'fixture only' } }), /resolves outside the registered runtime directory/);
  assert.equal(fs.existsSync(path.join(f.dDirectory, 'never-write')), false);
});

test('Windows attachments stay below the selected cwd and reject a junction escape', windowsOnly, t => {
  const f = fixture(t);
  const attachment = { name: '../中文 附件.txt', content: Buffer.from('only fixture bytes').toString('base64') };
  const normal = materializeRuntimeAttachments({ attachments: [attachment], cwd: f.dDirectory, actionId: 'fixture-attachment' });
  assert.equal(normal.length, 1);
  assert.ok(normal[0].path.startsWith(path.join(f.dDirectory, '.ziwei', 'attachments', 'fixture-attachment')));
  assert.equal(fs.readFileSync(normal[0].path, 'utf8'), 'only fixture bytes');
  const escapeLink = path.join(f.cDirectory, '.ziwei');
  fs.symlinkSync(f.dDirectory, escapeLink, 'junction');
  assert.throws(() => materializeRuntimeAttachments({ attachments: [attachment], cwd: f.cDirectory, actionId: 'blocked' }), /附件|批准根目录|outside/i);
  assert.equal(fs.existsSync(path.join(f.dDirectory, 'attachments', 'blocked')), false);
});
