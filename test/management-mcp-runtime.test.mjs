import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as runtime from '../src/runtime-adapters.mjs';
import { createLocalActionExecutor } from '../src/local-action.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-management-runtime-'));
  const tokenFile = path.join(root, 'mcp-private.json');
  fs.writeFileSync(tokenFile, JSON.stringify({ token: 'test-private-bearer-unique', workspaces: ['runtime-test'] }));
  return { root, tokenFile, config: { enabled: true, tokenFile, baseUrl: 'https://example.test' } };
}

test('management MCP is bound to the paired workspace and rejects missing scoped credentials', () => {
  assert.equal(typeof runtime.managementMcpStatus, 'function');
  const f = fixture();
  try {
    assert.equal(runtime.managementMcpStatus({ config: f.config, workspace: 'runtime-test' }).configured, true);
    const foreign = runtime.managementMcpStatus({ config: f.config, workspace: 'other-workspace' });
    assert.equal(foreign.configured, false);
    assert.match(foreign.reason, /工作区/);
    assert.equal(runtime.managementMcpStatus({ config: { ...f.config, tokenFile: path.join(f.root, 'missing') }, workspace: 'runtime-test' }).configured, false);
    assert.doesNotMatch(JSON.stringify(foreign), /test-private-bearer/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('Codex launch injects a real stdio server without credentials in argv', () => {
  assert.equal(typeof runtime.prepareManagementMcpLaunch, 'function');
  const f = fixture();
  try {
    const launch = runtime.prepareManagementMcpLaunch({ runtime: 'Codex', profile: null, config: f.config, workspace: 'runtime-test', request: { enabled: true, workspace: 'runtime-test' }, auditDirectory: f.root, actionId: 'codex-qa', invocation: runtime.runtimeInvocation('Codex', { prompt: 'hello' }), env: {} });
    assert.ok(launch.invocation.args.some(value => value.includes('mcp_servers.ziwei_management.command')));
    assert.ok(launch.invocation.args.some(value => value.includes('ziwei-mcp.mjs')));
    assert.equal(launch.env.ZIWEI_MCP_TOKEN_FILE, f.tokenFile);
    assert.equal(launch.env.ZIWEI_MCP_WORKSPACE, 'runtime-test');
    assert.doesNotMatch(JSON.stringify(launch.invocation.args), /test-private-bearer/);
    assert.throws(() => runtime.prepareManagementMcpLaunch({ runtime: 'Codex', config: f.config, workspace: 'runtime-test', request: { enabled: true, workspace: 'foreign' }, auditDirectory: f.root, invocation: { args: [] } }), /工作区/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('Hermes MCP uses the explicit isolated profile and preserves provider and existing servers', () => {
  assert.equal(typeof runtime.prepareManagementMcpLaunch, 'function');
  const f = fixture();
  const hermes = path.join(f.root, 'hermes');
  const profile = path.join(hermes, 'profiles', 'qa-isolated');
  fs.mkdirSync(profile, { recursive: true });
  const original = 'model:\n  provider: openai-codex\n  default: test-model\nmcp_servers:\n  other:\n    command: another-binary\n';
  fs.writeFileSync(path.join(profile, 'config.yaml'), original);
  fs.writeFileSync(path.join(hermes, 'config.yaml'), 'model:\n  provider: root-untouched\n');
  try {
    const options = { runtime: 'Hermes', profile: 'qa-isolated', config: f.config, workspace: 'runtime-test', request: { enabled: true }, auditDirectory: f.root, invocation: runtime.runtimeInvocation('Hermes', { prompt: 'hello' }), env: { HERMES_HOME: hermes } };
    const first = runtime.prepareManagementMcpLaunch(options);
    assert.equal(first.env.HERMES_HOME, profile);
    assert.ok(first.invocation.args.includes('--toolsets'));
    const modified = fs.readFileSync(path.join(first.env.HERMES_MANAGED_DIR, 'config.yaml'), 'utf8');
    assert.match(modified, /ziwei_management:/);
    assert.match(modified, /ZIWEI_MCP_TOKEN_FILE:/);
    assert.doesNotMatch(modified, /other:|openai-codex/);
    assert.doesNotMatch(modified, /\$\{ZIWEI_MCP_TOKEN\}/);
    assert.doesNotMatch(modified, /test-private-bearer/);
    const second = runtime.prepareManagementMcpLaunch(options);
    assert.equal(fs.readFileSync(path.join(profile, 'config.yaml'), 'utf8'), original);
    assert.equal(second.env.HERMES_HOME, profile);
    assert.notEqual(second.env.HERMES_MANAGED_DIR, first.env.HERMES_MANAGED_DIR);
    assert.equal(fs.readFileSync(path.join(second.env.HERMES_MANAGED_DIR, 'config.yaml'), 'utf8').replace(second.receipt.auditFile, 'AUDIT'), modified.replace(first.receipt.auditFile, 'AUDIT'));
    assert.equal(fs.readFileSync(path.join(hermes, 'config.yaml'), 'utf8'), 'model:\n  provider: root-untouched\n');
    const main = runtime.prepareManagementMcpLaunch({ ...options, profile: 'default' });
    assert.equal(fs.readFileSync(path.join(hermes, 'config.yaml'), 'utf8'), 'model:\n  provider: root-untouched\n');
    first.cleanup(); second.cleanup(); main.cleanup();
    assert.throws(() => runtime.prepareManagementMcpLaunch({ ...options, profile: 'missing' }), /不存在/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('Hermes discovery distinguishes profile existence from provider and authentication readiness', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.root, 'profiles', 'empty'), { recursive: true });
    fs.mkdirSync(path.join(f.root, 'profiles', 'ready'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'profiles', 'ready', 'config.yaml'), 'model:\n  provider: openai-codex\n');
    fs.writeFileSync(path.join(f.root, 'profiles', 'ready', 'auth.json'), JSON.stringify({ providers: { 'openai-codex': { tokens: { access_token: 'local-secret' } } } }));
    const profiles = runtime.listHermesProfiles({ baseHome: f.root });
    const empty = profiles.find(item => item.name === 'empty');
    const ready = profiles.find(item => item.name === 'ready');
    assert.equal(empty.readiness.ready, false);
    assert.match(empty.readiness.reason, /provider/);
    assert.equal(ready.readiness.authentication, 'configured');
    assert.equal(ready.readiness.ready, true);
    assert.doesNotMatch(JSON.stringify(profiles), /local-secret/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('legacy environment-only management auth remains an env reference in Hermes overlay', () => {
  const f = fixture();
  const previous = { token: process.env.ZIWEI_MCP_TOKEN, workspace: process.env.ZIWEI_MCP_WORKSPACE };
  try {
    fs.writeFileSync(path.join(f.root, 'config.yaml'), 'model:\n  provider: fixture-provider\n');
    process.env.ZIWEI_MCP_TOKEN = 'private-environment-bearer'; process.env.ZIWEI_MCP_WORKSPACE = 'runtime-test';
    const launch = runtime.prepareManagementMcpLaunch({ runtime: 'Hermes', profile: 'default', config: { enabled: true, baseUrl: 'https://example.test' }, workspace: 'runtime-test', auditDirectory: f.root, invocation: { args: [] }, env: { HERMES_HOME: f.root } });
    assert.equal(launch.env.ZIWEI_MCP_TOKEN, 'private-environment-bearer');
    const text = fs.readFileSync(path.join(launch.overlayHome, 'config.yaml'), 'utf8');
    assert.match(text, /\$\{ZIWEI_MCP_TOKEN\}/); assert.doesNotMatch(text, /private-environment-bearer/);
    launch.cleanup();
  } finally {
    for (const [key, value] of [['ZIWEI_MCP_TOKEN', previous.token], ['ZIWEI_MCP_WORKSPACE', previous.workspace]]) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('management MCP receipt requires an actual successful handshake and preserves safe tool IDs', () => {
  const f = fixture();
  try {
    const launch = runtime.prepareManagementMcpLaunch({ runtime: 'Codex', config: f.config, workspace: 'runtime-test', request: { enabled: true }, auditDirectory: f.root, actionId: 'same-action', invocation: { args: [] } });
    const second = runtime.prepareManagementMcpLaunch({ runtime: 'Codex', config: f.config, workspace: 'runtime-test', request: { enabled: true }, auditDirectory: f.root, actionId: 'same-action', invocation: { args: [] } });
    assert.notEqual(launch.receipt.auditFile, second.receipt.auditFile);
    assert.equal(runtime.managementMcpReceipt(launch.receipt).loaded, false);
    fs.writeFileSync(launch.receipt.auditFile, [
      { method: 'initialize', ok: true },
      { method: 'tools/call', toolName: 'ziwei_create_employee', ok: true, resourceId: 'employee-qa', employeeId: 'employee-qa' },
      { method: 'tools/call', toolName: 'ziwei_create_task', ok: false },
    ].map(item => JSON.stringify(item)).join('\n'));
    const receipt = runtime.managementMcpReceipt(launch.receipt);
    assert.equal(receipt.loaded, true);
    assert.equal(receipt.tool_calls[0].ids.employeeId, 'employee-qa');
    assert.equal(receipt.tool_calls[1].ok, false);
    assert.equal(runtime.managementMcpReceipt(second.receipt).loaded, false);
    assert.equal('auditFile' in receipt, false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('management MCP cannot silently use an unsupported runtime or a foreign device', async () => {
  const f = fixture();
  try {
    assert.throws(() => runtime.prepareManagementMcpLaunch({ runtime: 'Gemini', config: f.config, workspace: 'runtime-test', request: { enabled: true }, invocation: { args: [] } }), /尚不支持/);
    const executor = createLocalActionExecutor({ runtimeDir: path.join(f.root, 'runtime'), workspace: 'runtime-test', deviceId: 'paired-device' });
    await assert.rejects(() => executor({ type: 'agent.execute', workspace: 'runtime-test', payload: { runtime: 'Codex', deviceId: 'other-device', prompt: 'hello' } }), /目标设备/);
    await assert.rejects(() => executor({ type: 'agent.execute', workspace: 'foreign', payload: { runtime: 'Codex', prompt: 'hello' } }), /工作区/);
    await assert.rejects(() => runtime.executeRuntime({ runtime: 'Unknown', prompt: 'hello' }), /未知本机运行时/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('Hermes profile readiness does not borrow credentials from the main profile', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.root, 'profiles', 'unauthed'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'config.yaml'), 'model:\n  provider: openai-codex\n');
    fs.writeFileSync(path.join(f.root, 'auth.json'), JSON.stringify({ providers: { 'openai-codex': { tokens: { access_token: 'main-profile-only' } } } }));
    fs.writeFileSync(path.join(f.root, 'profiles', 'unauthed', 'config.yaml'), 'model:\n  provider: openai-codex\n');
    assert.equal(runtime.hermesProfileReadiness('default', { baseHome: f.root }).ready, true);
    assert.equal(runtime.hermesProfileReadiness('unauthed', { baseHome: f.root }).ready, false);
    assert.match(runtime.hermesProfileReadiness('unauthed', { baseHome: f.root }).reason, /不能回退主 profile/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('native stdio adapter really handshakes, calls the scoped API, and records a credential-free receipt', async () => {
  const f = fixture();
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url, authorized: req.headers.authorization === 'Bearer test-private-bearer-unique' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, workspace: 'runtime-test', transport: 'stdio' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = { ...f.config, baseUrl: `http://127.0.0.1:${server.address().port}` };
    const launch = runtime.prepareManagementMcpLaunch({ runtime: 'Codex', config, workspace: 'runtime-test', request: { enabled: true }, auditDirectory: f.root, actionId: 'stdio-real', invocation: { args: [] }, env: process.env });
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/ziwei-mcp.mjs', import.meta.url))], { env: launch.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let diagnostics = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { diagnostics += chunk; });
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    child.stdin.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ziwei-native-runtime-test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ziwei_mcp_health', arguments: {} } },
    ].map(item => JSON.stringify(item)).join('\n') + '\n');
    assert.equal(await exited, 0, diagnostics);
    const messages = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(messages.length, 3);
    assert.ok(messages[1].result.tools.some(item => item.name === 'ziwei_discover_environment'));
    assert.deepEqual(requests, [{ path: '/mcp/v1/workspaces/runtime-test/health', authorized: true }]);
    const receipt = runtime.managementMcpReceipt(launch.receipt);
    assert.equal(receipt.loaded, true);
    assert.deepEqual(receipt.toolCalls.map(item => [item.toolName, item.ok]), [['ziwei_mcp_health', true]]);
    assert.doesNotMatch(fs.readFileSync(launch.receipt.auditFile, 'utf8') + output + diagnostics, /test-private-bearer-unique/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a loaded MCP with only failed tool attempts fails the employee execution', () => {
  assert.equal(typeof runtime.managementMcpExecutionFailure, 'function');
  const failure = runtime.managementMcpExecutionFailure({ runtime: 'Codex', loaded: true, toolCalls: [
    { toolName: 'ziwei_discover_environment', ok: false },
    { toolName: 'ziwei_create_employee', ok: false },
  ] });
  assert.equal(failure.code, 'management_mcp_tools_failed');
  assert.match(failure.error, /全部失败/);
  assert.match(failure.error, /ziwei_discover_environment/);
  assert.match(failure.error, /ziwei_create_employee/);
});

test('MCP retries can recover and loaded-only employee tasks remain valid', () => {
  assert.equal(typeof runtime.managementMcpExecutionFailure, 'function');
  assert.equal(runtime.managementMcpExecutionFailure({ runtime: 'Hermes', loaded: true, toolCalls: [
    { toolName: 'ziwei_discover_environment', ok: false },
    { toolName: 'ziwei_discover_environment', ok: true },
  ] }), null);
  assert.equal(runtime.managementMcpExecutionFailure({ runtime: 'Codex', loaded: true, toolCalls: [] }), null);
  assert.equal(runtime.managementMcpExecutionFailure(null), null);
  assert.equal(runtime.managementMcpExecutionFailure({ runtime: 'Codex', loaded: false, toolCalls: [] }).code, 'management_mcp_not_loaded');
});
