import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverInstalledRuntimes, runtimeSpawnSpec } from '../src/runtime-adapters.mjs';

import { discoverRuntimeCli as discover, createCliDiscoveryContext as contextFor, runtimeDiscoveryEnvironment as runtimeEnv } from '../src/runtime-cli-discovery.mjs';
const definition = runtime => ({ runtime, aliases: [runtime.toLowerCase(), runtime], versionArgs: ['--version'] });

function isolatedVersionEnvironment(root) {
  // A plain spread of process.env can retain both Path and PATH on Windows.
  // Keep only OS launch variables and fresh fixture-owned home/npm paths, so
  // native executables or profiles installed on the host cannot win discovery.
  return {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR || process.env.SystemRoot,
    PATH: [path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    HOME: root,
    USERPROFILE: root,
    HOMEDRIVE: path.parse(root).root.slice(0, 2),
    HOMEPATH: root.slice(2),
    APPDATA: root,
    LOCALAPPDATA: root,
    CODEX_HOME: path.join(root, '.codex'),
    HERMES_HOME: path.join(root, 'hermes'),
    TEMP: root,
    TMP: root,
    npm_config_prefix: root,
    NPM_CONFIG_USERCONFIG: path.join(root, 'fixture-empty.npmrc'),
  };
}

function fixture({ paths = 'C:\\Windows\\System32', files = [], located = [], locatorError = null, version = null, env = {}, extraCandidates = [], metadataVersion = null, npmrc = '' } = {}) {
  const commands = [];
  const installed = new Set(files.map(file => file.toLowerCase()));
  const io = {
    exists: file => installed.has(file.toLowerCase()),
    readNpmPrefix: () => npmrc,
    run(command, args, options) {
      commands.push({ command, args, options });
      if (command === 'where.exe') return locatorError
        ? { status: null, error: { code: locatorError }, stderr: 'private locator diagnostic' }
        : { status: located.length ? 0 : 1, stdout: located.join('\r\n') };
      return typeof version === 'function' ? version(command, args, options) : version || { status: 0, stdout: 'CLI 0.21.3\n' };
    }
  };
  const context = contextFor({ platform: 'win32', arch: 'x64', home: 'C:\\Users\\fixture', env: { PATH: paths, APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming', ...env }, io, now: () => 1_800_000_000_000, spawnSpec: (binary, args) => ({ command: binary, args }), extraCandidates: () => extraCandidates, metadataVersion: () => metadataVersion });
  return { context, commands };
}

test('Windows native executable stays ahead of npm shims and reports an actual version', () => {
  const f = fixture({ files: ['C:\\Agent\\codex.cmd', 'C:\\OpenAI\\codex.exe'], located: ['C:\\Agent\\codex.cmd'], extraCandidates: ['C:\\OpenAI\\codex.exe'] });
  const found = discover(definition('Codex'), f.context);
  assert.equal(found.binary, 'C:\\OpenAI\\codex.exe');
  assert.equal(found.version, '0.21.3');
  assert.equal(found.status, 'available');
  assert.equal(found.detection.state, 'available');
  assert.equal(found.detection.platform, 'win32');
  assert.equal(found.detection.arch, 'x64');
});

test('Windows npm PowerShell and cmd shims are both genuine executable candidates', () => {
  for (const ext of ['ps1', 'cmd']) {
    const binary = `C:\\npm\\hermes.${ext}`;
    const found = discover(definition('Hermes'), fixture({ files: [binary], located: [binary] }).context);
    assert.equal(found.binary, binary);
    assert.equal(found.detection.source, 'path');
    assert.equal(found.status, 'available');
  }
});

test('Windows npm prefix is discovered even when a GUI daemon PATH omits its directory', () => {
  const f = fixture({ files: ['D:\\NodeGlobal\\gemini.cmd'], env: { npm_config_prefix: 'D:\\NodeGlobal' } });
  const found = discover(definition('Gemini'), f.context);
  assert.equal(found.binary, 'D:\\NodeGlobal\\gemini.cmd');
  assert.equal(found.detection.source, 'npm_prefix');
  assert.match(runtimeEnv(found).PATH, /D:\\NodeGlobal/);
  assert.equal(f.commands.at(-1).options.env.PATH, runtimeEnv(found).PATH);
  assert.doesNotMatch(JSON.stringify(found), /"PATH"|"env"/);
});

test('Windows reads only a literal npm prefix from user npmrc and never reports registry credentials', () => {
  const f = fixture({ files: ['D:\\ConfiguredNpm\\gemini.cmd'], npmrc: 'registry=https://example.invalid/\n//example.invalid/:_authToken=PRIVATE_TEST_ONLY\nprefix="D:\\ConfiguredNpm"\n' });
  const found = discover(definition('Gemini'), f.context);
  assert.equal(found.binary, 'D:\\ConfiguredNpm\\gemini.cmd');
  assert.equal(found.detection.source, 'npm_userconfig');
  assert.doesNotMatch(JSON.stringify(found), /PRIVATE_TEST_ONLY|registry|_authToken/);
  assert.match(runtimeEnv(found).PATH, /D:\\ConfiguredNpm/);
});

test('Windows user npm directory and case insensitive Path retain original PATH precedence', () => {
  const f = fixture({ paths: '', files: ['C:\\Selected\\claude.cmd', 'C:\\Users\\fixture\\AppData\\Roaming\\npm\\claude.cmd'], env: { Path: 'C:\\Selected;C:\\Windows\\System32' } });
  const found = discover(definition('Claude'), f.context);
  assert.equal(found.binary, 'C:\\Selected\\claude.cmd');
  assert.equal(found.detection.source, 'path');
});

test('an absent CLI is explicitly reported independently of cached models or authentication', () => {
  const found = discover(definition('Codex'), fixture().context);
  assert.equal(found.binary, null);
  assert.equal(found.version, null);
  assert.equal(found.status, 'unavailable');
  assert.equal(found.detection.state, 'not_found');
  assert.equal(found.detection.reasonCode, 'cli_not_found');
  assert.ok(found.detection.checkedAt);
});

test('an installed version timeout is a detection failure and never discloses raw diagnostics', () => {
  const f = fixture({ files: ['C:\\Agent\\hermes.exe'], located: ['C:\\Agent\\hermes.exe'], version: { status: null, error: { code: 'ETIMEDOUT', message: 'PRIVATE_TEST_ONLY' }, stderr: 'PRIVATE_TEST_ONLY' } });
  const found = discover(definition('Hermes'), f.context);
  assert.equal(found.binary, 'C:\\Agent\\hermes.exe');
  assert.equal(found.detection.state, 'failed');
  assert.equal(found.detection.reasonCode, 'cli_version_timeout');
  assert.equal(found.detection.installed, true);
  assert.equal(found.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(found), /PRIVATE_TEST_ONLY/);
});

test('version exits and missing interpreters have distinct safe reason codes', () => {
  for (const [version, reasonCode] of [[{ status: 2, stderr: 'PRIVATE_TEST_ONLY' }, 'cli_version_failed'], [{ status: null, error: { code: 'ENOENT', message: 'PRIVATE_TEST_ONLY' } }, 'cli_dependency_missing']]) {
    const found = discover(definition('Hermes'), fixture({ files: ['C:\\Agent\\hermes.exe'], located: ['C:\\Agent\\hermes.exe'], version }).context);
    assert.equal(found.detection.reasonCode, reasonCode);
    assert.equal(found.detection.state, 'failed');
    assert.doesNotMatch(JSON.stringify(found), /PRIVATE_TEST_ONLY/);
  }
});

test('stderr versions work but startup warnings do not claim availability', () => {
  const found = discover(definition('Gemini'), fixture({ files: ['C:\\Agent\\gemini.exe'], located: ['C:\\Agent\\gemini.exe'], version: { status: 0, stdout: 'loading configuration\n', stderr: '0.33.1\n' } }).context);
  assert.equal(found.version, '0.33.1');
  const empty = discover(definition('Gemini'), fixture({ files: ['C:\\Agent\\gemini.exe'], located: ['C:\\Agent\\gemini.exe'], version: { status: 0, stdout: 'PRIVATE_TEST_ONLY\n' } }).context);
  assert.equal(empty.detection.reasonCode, 'cli_version_unrecognized');
  assert.doesNotMatch(JSON.stringify(empty), /PRIVATE_TEST_ONLY/);
});

test('a dependency warning version cannot override the requested CLI version', () => {
  const f = fixture({ files: ['C:\\Agent\\gemini.exe'], located: ['C:\\Agent\\gemini.exe'], version: { status: 0, stdout: 'Node.js 22.4.0 startup warning\n', stderr: '0.33.1\n' } });
  assert.equal(discover(definition('Gemini'), f.context).version, '0.33.1');
});

test('native Hermes version output with a v prefix is recognized safely', () => {
  const f = fixture({ files: ['C:\\Agent\\hermes.exe'], located: ['C:\\Agent\\hermes.exe'], version: { status: 0, stdout: 'Hermes Agent v0.21.3\n' } });
  assert.equal(discover(definition('Hermes'), f.context).version, '0.21.3');
});

test('metadata is a version hint and cannot turn a failing CLI into an available runtime', () => {
  const found = discover(definition('Gemini'), fixture({ files: ['C:\\Agent\\gemini.exe'], located: ['C:\\Agent\\gemini.exe'], metadataVersion: '0.33.1', version: { status: 2, stderr: 'PRIVATE_TEST_ONLY' } }).context);
  assert.equal(found.version, '0.33.1');
  assert.equal(found.status, 'unavailable');
  assert.equal(found.detection.state, 'failed');
  assert.equal(found.detection.versionSource, 'installed_metadata');
});

test('where.exe errors are distinct from an ordinary no-match exit', () => {
  const found = discover(definition('Claude'), fixture({ locatorError: 'EACCES' }).context);
  assert.equal(found.detection.state, 'failed');
  assert.equal(found.detection.reasonCode, 'cli_lookup_failed');
  assert.equal(found.detection.installed, null);
  assert.doesNotMatch(JSON.stringify(found), /private locator diagnostic/);
});

test('probes use only locator or --version commands with bounded output and timeouts', () => {
  const f = fixture({ files: ['C:\\Agent\\hermes.exe'], located: ['C:\\Agent\\hermes.exe'] });
  discover(definition('Hermes'), f.context);
  assert.ok(f.commands.length >= 2);
  assert.ok(f.commands.every(item => item.command === 'where.exe' || item.args.join(' ') === '--version'));
  assert.ok(f.commands.every(item => item.options.timeout <= 5000 && item.options.maxBuffer <= 128 * 1024));
});

test('runtime adapter preserves per-CLI detection and private PATH across heartbeat serialization', () => {
  const f = fixture({ files: ['D:\\NodeGlobal\\codex.cmd'], env: { npm_config_prefix: 'D:\\NodeGlobal' } });
  const found = discoverInstalledRuntimes({ force: true, cliDiscovery: f.context });
  assert.deepEqual(Object.keys(found.runtimes), ['Claude', 'Codex', 'Gemini', 'Hermes']);
  assert.equal(found.runtimes.Codex.binary, 'D:\\NodeGlobal\\codex.cmd');
  assert.equal(found.runtimes.Codex.detection.state, 'available');
  assert.equal(found.runtimes.Claude.detection.state, 'not_found');
  assert.match(runtimeEnv(found.runtimes.Codex).PATH, /D:\\NodeGlobal/);
  assert.equal(found.bridge.platform, 'win32');
  assert.equal(found.bridge.arch, 'x64');
  assert.doesNotMatch(JSON.stringify(found.runtimes), /"PATH"|"env"/);
});

test('real isolated Windows npm cmd shim runs adjacent JS for version only', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-cli-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'codex.cmd');
  const js = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.writeFileSync(binary, '@echo off\r\nexit /b 99\r\n');
  fs.writeFileSync(js, "if(process.argv.slice(2).join(' ')!=='--version')process.exit(4);else console.log('codex-cli 0.162.0-alpha.2');");
  const context = contextFor({ home: root, spawnSpec: runtimeSpawnSpec, extraCandidates: () => [binary], env: isolatedVersionEnvironment(root), metadataVersion: () => null });
  const found = discover(definition('Codex'), context);
  assert.equal(found.binary, binary);
  assert.equal(found.version, '0.162.0-alpha.2');
  assert.equal(found.detection.state, 'available');
});

test('a Gemini npm shim cannot be substituted with adjacent Codex even when both are installed', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-cli-separation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'gemini.ps1');
  const codex = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.writeFileSync(binary, "Write-Output '0.61.0'\n");
  fs.writeFileSync(codex, "console.log('codex-cli 0.159.2');\n");
  const spec = runtimeSpawnSpec(binary, ['--version']);
  assert.equal(spec.command, 'powershell.exe');
  assert.equal(spec.args.includes(codex), false);
  const context = contextFor({ home: root, spawnSpec: runtimeSpawnSpec, extraCandidates: () => [binary], env: isolatedVersionEnvironment(root), metadataVersion: () => null });
  const found = discover(definition('Gemini'), context);
  assert.equal(found.binary, binary);
  assert.equal(found.version, '0.61.0');
  assert.equal(found.detection.state, 'available');
});
