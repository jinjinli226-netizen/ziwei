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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-terminal-runtime-'));
  const tokenFile = path.join(root, 'execution-private.json');
  const scope = { token: 'private-phone-capability-for-test', workspace: 'phone_ai', employeeId: 'employee_phone', deviceId: 'android_phone', actionId: 'action_phone', expiresAt: new Date(Date.now() + 60_000).toISOString(), baseUrl: 'https://example.test/terminal-mcp/v1/workspaces/phone_ai/employees/employee_phone' };
  fs.writeFileSync(tokenFile, JSON.stringify(scope));
  const request = { enabled: true, workspace: scope.workspace, employeeId: scope.employeeId, deviceId: scope.deviceId };
  return { root, tokenFile, scope, request, config: { enabled: true, tokenFile, baseUrl: scope.baseUrl } };
}

test('phone MCP requires an exact employee/phone/action scoped capability', () => {
  assert.equal(typeof runtime.prepareTerminalMcpLaunch, 'function');
  const f = fixture();
  try {
    const options = { runtime: 'Codex', request: f.request, config: f.config, workspace: 'phone_ai', actionId: 'action_phone', auditDirectory: f.root, invocation: { args: ['exec', '-'] }, env: {} };
    const launch = runtime.prepareTerminalMcpLaunch(options);
    assert.ok(launch.invocation.args.some(value => value.includes('mcp_servers.ziwei-terminal.command')));
    assert.ok(launch.invocation.args.includes('mcp_servers.ziwei-terminal.env.ZIWEI_CONTROL_CREDENTIALS_FILE=""'), 'Codex requires TOML values: blank administrator env per key, without a JSON object');
    assert.equal(launch.invocation.args.some(value => value.startsWith('mcp_servers.ziwei-terminal.env=')), false, 'JSON objects become invalid string values in Codex config');
    assert.equal(launch.env.ZIWEI_TERMINAL_TOKEN_FILE, f.tokenFile);
    assert.equal(launch.env.ZIWEI_TERMINAL_EMPLOYEE_ID, 'employee_phone');
    assert.equal(launch.env.ZIWEI_TERMINAL_DEVICE_ID, 'android_phone');
    assert.doesNotMatch(JSON.stringify(launch.invocation.args) + JSON.stringify(launch.receipt), /private-phone-capability/);
    assert.throws(() => runtime.prepareTerminalMcpLaunch({ ...options, request: { ...f.request, deviceId: 'android_foreign' } }), /手机|scope|范围/);
    assert.throws(() => runtime.prepareTerminalMcpLaunch({ ...options, actionId: 'action_foreign' }), /执行|scope|范围/);
    assert.throws(() => runtime.prepareTerminalMcpLaunch({ ...options, workspace: 'test_222' }), /工作区/);
    assert.throws(() => runtime.prepareTerminalMcpLaunch({ ...options, runtime: 'Gemini' }), /不支持/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the launched phone stdio bridge really handshakes, calls the scoped API and writes a safe receipt', async () => {
  const f = fixture();
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      requests.push({ path: req.url, authorized: req.headers.authorization === `Bearer ${f.scope.token}`, body: JSON.parse(raw) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ device: { id: 'android_phone', status: 'online' } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/terminal-mcp/v1/workspaces/phone_ai/employees/employee_phone`;
    fs.writeFileSync(f.tokenFile, JSON.stringify({ ...f.scope, baseUrl }), { mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(f.tokenFile, 0o600);
    const launch = runtime.prepareTerminalMcpLaunch({ runtime: 'Codex', request: f.request, config: { ...f.config, baseUrl }, workspace: 'phone_ai', actionId: 'action_phone', auditDirectory: f.root, invocation: { args: [] }, env: process.env });
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/ziwei-terminal-mcp.mjs', import.meta.url))], { env: launch.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let diagnostics = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { diagnostics += chunk; });
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    child.stdin.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'isolated-phone-runtime-test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ziwei_phone_status', arguments: { deviceId: 'android_phone' } } },
    ].map(item => JSON.stringify(item)).join('\n') + '\n');
    assert.equal(await exited, 0, diagnostics);
    const messages = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(messages.length, 3);
    assert.equal(messages[1].result.tools.length, 10);
    assert.deepEqual(requests, [{ path: '/terminal-mcp/v1/workspaces/phone_ai/employees/employee_phone/call', authorized: true, body: { name: 'ziwei_phone_status', arguments: { deviceId: 'android_phone' } } }]);
    const receipt = runtime.terminalMcpReceipt(launch.receipt);
    assert.equal(receipt.loaded, true);
    assert.deepEqual(receipt.toolCalls.map(item => [item.toolName, item.ok, item.deviceId]), [['ziwei_phone_status', true, 'android_phone']]);
    assert.doesNotMatch(output + diagnostics + fs.readFileSync(launch.receipt.auditFile, 'utf8'), /private-phone-capability/);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('phone MCP is separately installed in an isolated Hermes profile and uninstall preserves persona and management MCP', () => {
  assert.equal(typeof runtime.prepareTerminalMcpLaunch, 'function');
  const f = fixture();
  const hermes = path.join(f.root, 'hermes');
  const profile = path.join(hermes, 'profiles', 'phone-employee');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(hermes, 'config.yaml'), 'model:\n  provider: main-untouched\n');
  fs.writeFileSync(path.join(profile, 'SOUL.md'), 'Original employee persona, unchanged.');
  fs.writeFileSync(path.join(profile, 'config.yaml'), 'model:\n  provider: openai-codex\nmcp_servers:\n  ziwei_management:\n    command: existing-management\n  unrelated:\n    command: another-server\n');
  try {
    const options = { runtime: 'Hermes', profile: 'phone-employee', request: f.request, config: f.config, workspace: 'phone_ai', actionId: 'action_phone', auditDirectory: f.root, invocation: { args: ['-z', 'hello'] }, env: { HERMES_HOME: hermes } };
    const launch = runtime.prepareTerminalMcpLaunch(options);
    assert.equal(launch.env.HERMES_HOME, profile);
    assert.ok(launch.invocation.args.includes('--toolsets'));
    assert.equal(launch.invocation.args.at(-1), 'all');
    const installed = fs.readFileSync(path.join(profile, 'config.yaml'), 'utf8');
    assert.match(installed, /ziwei-terminal:/);
    assert.match(installed, /ziwei_management:/);
    assert.match(installed, /\$\{ZIWEI_TERMINAL_TOKEN_FILE\}/);
    assert.doesNotMatch(installed, /private-phone-capability/);
    runtime.prepareTerminalMcpLaunch({ ...options, request: { enabled: false } });
    const removed = fs.readFileSync(path.join(profile, 'config.yaml'), 'utf8');
    assert.doesNotMatch(removed, /ziwei-terminal:/);
    assert.match(removed, /ziwei_management:/);
    assert.match(removed, /another-server/);
    assert.equal(fs.readFileSync(path.join(profile, 'SOUL.md'), 'utf8'), 'Original employee persona, unchanged.');
    assert.equal(fs.readFileSync(path.join(hermes, 'config.yaml'), 'utf8'), 'model:\n  provider: main-untouched\n');
    assert.throws(() => runtime.prepareTerminalMcpLaunch({ ...options, profile: 'default' }), /独立.*profile/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('phone MCP receipts require actual handshake and keep command IDs/status but no bodies', () => {
  assert.equal(typeof runtime.terminalMcpReceipt, 'function');
  const f = fixture();
  try {
    const launch = runtime.prepareTerminalMcpLaunch({ runtime: 'Codex', request: f.request, config: f.config, workspace: 'phone_ai', actionId: 'action_phone', auditDirectory: f.root, invocation: { args: [] }, env: {} });
    assert.equal(runtime.terminalMcpReceipt(launch.receipt).loaded, false);
    fs.writeFileSync(launch.receipt.auditFile, [
      { method: 'initialize', ok: true },
      { method: 'tools/call', toolName: 'ziwei_phone_action', ok: true, deviceId: 'android_phone', commandId: 'command_123', status: 'queued', arguments: { text: 'private-message' } },
      { method: 'tools/call', toolName: 'ziwei_phone_wait', ok: true, ids: { deviceId: 'android_phone', commandId: 'command_123' }, status: 'succeeded' },
    ].map(item => JSON.stringify(item)).join('\n'));
    const receipt = runtime.terminalMcpReceipt(launch.receipt);
    assert.equal(receipt.loaded, true);
    assert.equal(receipt.targetDeviceId, 'android_phone');
    assert.equal(receipt.tool_calls[0].commandId, 'command_123');
    assert.equal(receipt.tool_calls[0].status, 'queued');
    assert.equal(receipt.tool_calls[1].ids.deviceId, 'android_phone');
    assert.doesNotMatch(JSON.stringify(receipt), /private-message|auditFile|private-phone-capability/);
    assert.equal(runtime.terminalMcpExecutionFailure({ runtime: 'Hermes', loaded: true, toolCalls: [{ toolName: 'ziwei_phone_status', ok: false }] }).code, 'terminal_mcp_tools_failed');
    assert.equal(runtime.terminalMcpExecutionFailure({ runtime: 'Hermes', loaded: true, toolCalls: [] }), null);
    assert.equal(runtime.terminalMcpExecutionFailure({ runtime: 'Hermes', loaded: false }).code, 'terminal_mcp_not_loaded');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('execution bootstrap uses paired device auth and saves only a local short-lived scoped token file', async () => {
  assert.equal(typeof runtime.bootstrapTerminalMcp, 'function');
  const f = fixture();
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, method: req.method, authorized: req.headers['x-ziwei-device-token'] === 'paired-device-secret', body: JSON.parse(raw) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...f.scope, baseUrl: `http://127.0.0.1:${server.address().port}/terminal-mcp/v1/workspaces/phone_ai/employees/employee_phone` }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const session = await runtime.bootstrapTerminalMcp({ request: f.request, workspace: 'phone_ai', actionId: 'action_phone', apiBase: `http://127.0.0.1:${server.address().port}`, deviceToken: 'paired-device-secret', privateDirectory: f.root });
    assert.deepEqual(requests, [{ url: '/api/workspaces/phone_ai/terminal-mcp/bootstrap', method: 'POST', authorized: true, body: { employeeId: 'employee_phone', deviceId: 'android_phone', actionId: 'action_phone' } }]);
    const saved = JSON.parse(fs.readFileSync(session.config.tokenFile, 'utf8'));
    assert.equal(saved.token, f.scope.token);
    assert.equal(saved.actionId, 'action_phone');
    session.cleanup();
    assert.equal(fs.existsSync(session.config.tokenFile), false);
    await assert.rejects(() => runtime.bootstrapTerminalMcp({ request: f.request, workspace: 'phone_ai', actionId: 'action_phone', apiBase: 'https://example.test', privateDirectory: f.root }), /设备.*凭据|配对/);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('employees with no phone skill cannot inherit the host global phone MCP or legacy admin environment', () => {
  const disabled = runtime.prepareTerminalMcpLaunch({ runtime: 'Codex', invocation: { args: ['exec', '-'] }, env: { ZIWEI_CONTROL_AUTH: 'legacy-admin-secret', ZIWEI_CONTROL_CREDENTIALS_FILE: '/host/private.json', ZIWEI_TERMINAL_TOKEN_FILE: '/another/execution.json' } });
  assert.ok(disabled.invocation.args.includes('mcp_servers.ziwei-terminal.enabled=false'));
  assert.equal(disabled.receipt, null);
  assert.equal(disabled.env.ZIWEI_CONTROL_AUTH, undefined);
  assert.equal(disabled.env.ZIWEI_TERMINAL_TOKEN_FILE, undefined);
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'config.yaml'), 'mcp_servers:\n  ziwei-terminal:\n    command: legacy-admin-server\n');
    const original = fs.readFileSync(path.join(f.root, 'config.yaml'), 'utf8');
    assert.throws(() => runtime.prepareTerminalMcpLaunch({ runtime: 'Hermes', profile: 'default', invocation: { args: ['-z', 'hi'] }, env: { HERMES_HOME: f.root } }), /独立.*profile|管理员/);
    assert.equal(fs.readFileSync(path.join(f.root, 'config.yaml'), 'utf8'), original);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('management and phone MCP coexist in the same selected Hermes profile without nested profile fallback', () => {
  const f = fixture();
  const hermes = path.join(f.root, 'hermes');
  const profile = path.join(hermes, 'profiles', 'combined');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'config.yaml'), 'model:\n  provider: openai-codex\n');
  const managementToken = path.join(f.root, 'management.json');
  fs.writeFileSync(managementToken, JSON.stringify({ token: 'local-management-test-token', workspaces: ['phone_ai'] }));
  try {
    const management = runtime.prepareManagementMcpLaunch({ runtime: 'Hermes', profile: 'combined', config: { enabled: true, tokenFile: managementToken, baseUrl: 'https://example.test' }, workspace: 'phone_ai', request: { enabled: true, workspace: 'phone_ai' }, auditDirectory: f.root, invocation: runtime.runtimeInvocation('Hermes', { prompt: 'hello' }), env: { HERMES_HOME: hermes } });
    const phone = runtime.prepareTerminalMcpLaunch({ runtime: 'Hermes', profile: 'combined', config: f.config, workspace: 'phone_ai', request: f.request, actionId: 'action_phone', auditDirectory: f.root, invocation: management.invocation, env: management.env, profileBaseHome: hermes, hermesOverlayHome: management.overlayHome });
    assert.equal(phone.env.HERMES_HOME, profile);
    assert.equal(phone.env.HERMES_MANAGED_DIR, management.overlayHome);
    assert.equal(phone.env.ZIWEI_MCP_TOKEN_FILE, managementToken);
    assert.equal(phone.invocation.args.filter(item => item === '--toolsets').length, 1);
    const config = fs.readFileSync(path.join(phone.env.HERMES_MANAGED_DIR, 'config.yaml'), 'utf8');
    assert.match(config, /ziwei_management:/);
    assert.match(config, /ziwei-terminal:/);
    assert.doesNotMatch(config, /local-management-test-token|private-phone-capability/);
    assert.equal(fs.readFileSync(path.join(profile, 'config.yaml'), 'utf8'), 'model:\n  provider: openai-codex\n');
    management.cleanup();
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('issued phone commands require each original receipt to succeed, and unrelated success cannot hide failures', () => {
  const receipt = { runtime: 'Codex', loaded: true, toolCalls: [
    { toolName: 'ziwei_phone_action', ok: true, deviceId: 'android_phone', commandId: 'command_first', status: 'queued' },
    { toolName: 'ziwei_phone_status', ok: true, deviceId: 'android_phone' },
  ] };
  const pending = runtime.terminalMcpExecutionFailure(receipt);
  assert.equal(pending?.code, 'terminal_mcp_receipt_incomplete');
  assert.deepEqual(pending.commandIds, ['command_first']);
  const complete = { ...receipt, toolCalls: [...receipt.toolCalls, { toolName: 'ziwei_phone_wait', ok: true, commandId: 'command_first', deviceId: 'android_phone', status: 'succeeded' }] };
  assert.equal(runtime.terminalMcpExecutionFailure(complete), null);
  const failed = { ...complete, toolCalls: [...complete.toolCalls, { toolName: 'ziwei_phone_action', ok: true, commandId: 'command_second', status: 'failed' }, { toolName: 'ziwei_phone_list', ok: true }] };
  assert.equal(runtime.terminalMcpExecutionFailure(failed)?.code, 'terminal_mcp_receipt_failed');
  assert.deepEqual(runtime.terminalMcpExecutionFailure(failed).commandIds, ['command_second']);
  const uncertain = { ...receipt, toolCalls: [{ toolName: 'ziwei_phone_screenshot', ok: true, commandId: 'command_capture', status: 'uncertain' }] };
  assert.equal(runtime.terminalMcpExecutionFailure(uncertain)?.code, 'terminal_mcp_receipt_incomplete');
});

test('phone upgrade completion requires committed on its original update ID', () => {
  const base = { runtime: 'Hermes', loaded: true, toolCalls: [{ toolName: 'ziwei_phone_upgrade', ok: true, updateId: 'update_original', status: 'installed' }] };
  assert.equal(runtime.terminalMcpExecutionFailure(base)?.code, 'terminal_mcp_receipt_incomplete');
  assert.equal(runtime.terminalMcpExecutionFailure({ ...base, toolCalls: [...base.toolCalls, { toolName: 'ziwei_phone_wait', ok: true, updateId: 'update_original', status: 'committed' }] }), null);
  assert.equal(runtime.terminalMcpExecutionFailure({ ...base, toolCalls: [...base.toolCalls, { toolName: 'ziwei_phone_wait', ok: true, updateId: 'update_original', status: 'cancelled' }] })?.code, 'terminal_mcp_receipt_failed');
  assert.equal(runtime.terminalMcpExecutionFailure({ runtime: 'Hermes', loaded: true, toolCalls: [{ toolName: 'ziwei_phone_status', ok: true, commandId: 'another_task_pending', status: 'queued' }] }), null, 'read-only observation must not adopt another task command');
});

test('status audit receipts finish only IDs issued in this execution and omit raw payloads', () => {
  const f = fixture();
  try {
    const launch = runtime.prepareTerminalMcpLaunch({ runtime: 'Codex', request: f.request, config: f.config, workspace: 'phone_ai', actionId: 'action_phone', auditDirectory: f.root, invocation: { args: [] } });
    fs.writeFileSync(launch.receipt.auditFile, [
      { method: 'initialize', ok: true },
      { method: 'tools/call', toolName: 'ziwei_phone_action', ok: true, deviceId: 'android_phone', commandId: 'command_issued', status: 'queued' },
      { method: 'tools/call', toolName: 'ziwei_phone_status', ok: true, deviceId: 'android_phone', receipts: [{ commandId: 'command_issued', status: 'succeeded', result: 'private-result' }, { commandId: 'command_unrelated', status: 'failed' }] },
    ].map(item => JSON.stringify(item)).join('\n'));
    const receipt = runtime.terminalMcpReceipt(launch.receipt);
    assert.deepEqual(receipt.toolCalls[1].receipts, [{ commandId: 'command_issued', status: 'succeeded' }, { commandId: 'command_unrelated', status: 'failed' }]);
    assert.equal(runtime.terminalMcpExecutionFailure(receipt), null);
    assert.doesNotMatch(JSON.stringify(receipt), /private-result/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('local executor removes the execution capability even when an explicit runtime cannot start', async () => {
  const f = fixture();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/workspaces/phone_ai/mcp/bootstrap') return res.end(JSON.stringify({ token: 'management-private', workspace: 'phone_ai', deviceId: 'device_workstation', credentialId: 'credential_workstation', managed: true, audience: 'ziwei-management', expiresAt: new Date(Date.now() + 3600000).toISOString(), apiBase: `http://127.0.0.1:${server.address().port}` }));
    res.end(JSON.stringify({ ...f.scope, baseUrl: `http://127.0.0.1:${server.address().port}/terminal-mcp/v1/workspaces/phone_ai/employees/employee_phone` }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const runtimeDir = path.join(f.root, 'runtime');
    const executor = createLocalActionExecutor({ runtimeDir, workspace: 'phone_ai', deviceId: 'device_workstation', deviceToken: 'paired-workstation-secret', apiBase: `http://127.0.0.1:${server.address().port}` });
    await assert.rejects(() => executor({ id: 'action_phone', workspace: 'phone_ai', type: 'agent.execute', payload: { deviceId: 'device_workstation', runtime: 'UnknownExplicitRuntime', workdir: f.root, prompt: 'do not start a model', terminalMcp: f.request } }), /未知本机运行时/);
    assert.deepEqual(fs.readdirSync(path.join(runtimeDir, 'terminal-mcp-credentials')), []);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(f.root, { recursive: true, force: true }); }
});
