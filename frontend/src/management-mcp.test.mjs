import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeMcpEvidence, employeeReadiness, profileAfterRuntimeChange, safeMcpConfig } from './management-mcp.js';

test('copied stdio configuration keeps workspace and excludes all credential values', () => {
  const config = safeMcpConfig({ config_template: { mcpServers: { 'ziwei-management': { command: 'node', args: ['C:/Ziwei/scripts/ziwei-mcp.mjs'], env: { ZIWEI_MCP_TOKEN: 'sensitive-test-value', ZIWEI_API_BASE: 'http://old.invalid' } } } } }, 'test_222');
  const server = config.mcpServers['ziwei-management'];
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['C:/Ziwei/scripts/ziwei-mcp.mjs']);
  assert.equal(server.env.ZIWEI_API_BASE, 'https://qzelynth.top');
  assert.equal(server.env.ZIWEI_MCP_WORKSPACE, 'test_222');
  assert.equal(server.env.ZIWEI_MCP_TOKEN_FILE, '<PRIVATE_MCP_TOKEN_FILE>');
  assert.doesNotMatch(JSON.stringify(config), /sensitive-test-value|ZIWEI_MCP_TOKEN"|old.invalid/);
});

const device = { id: 'computer-1', status: 'online', management_mcp: { configured: true, workspace: 'test_222', supportedRuntimes: ['Codex', 'Hermes'] }, runtimes: [{ name: 'Codex', cli_status: 'available', available: true, readiness: 'ready' }, { name: 'Hermes', cli_status: 'available', available: true, readiness: 'ready', profiles: [{ name: 'qa', ready: true, hasProvider: true }] }] };
test('employee readiness requires the exact discovered device and runtime', () => {
  assert.equal(employeeReadiness({ devices: [device] }, { deviceId: device.id, runtime: 'Codex', mcpEnabled: true }).ready, true);
  assert.match(employeeReadiness({ devices: [device] }, { deviceId: 'missing', runtime: 'Codex' }).issues.join(' '), /目标电脑/);
  assert.match(employeeReadiness({ devices: [{ ...device, status: 'offline' }] }, { deviceId: device.id, runtime: 'Codex' }).issues.join(' '), /离线/);
  assert.match(employeeReadiness({ devices: [device] }, { deviceId: device.id, runtime: 'Gemini' }).issues.join(' '), /Gemini.*未发现/);
  assert.match(employeeReadiness({ devices: [{ ...device, runtimes: [{ name: 'Codex', cli_status: 'unavailable', issues: ['请安装 Codex CLI'] }] }] }, { deviceId: device.id, runtime: 'Codex' }).issues.join(' '), /请安装 Codex CLI/);
});

test('Hermes requires a discovered independent profile with provider readiness', () => {
  assert.equal(employeeReadiness({ devices: [device] }, { deviceId: device.id, runtime: 'Hermes', profile: 'qa' }).ready, true);
  assert.match(employeeReadiness({ devices: [device] }, { deviceId: device.id, runtime: 'Hermes', profile: '' }).issues.join(' '), /独立.*profile/);
  assert.match(employeeReadiness({ devices: [device] }, { deviceId: device.id, runtime: 'Hermes', profile: 'default' }).issues.join(' '), /独立.*profile/);
  assert.match(employeeReadiness({ devices: [device] }, { deviceId: device.id, runtime: 'Hermes', profile: 'missing' }).issues.join(' '), /未发现.*missing/);
  const missingProvider = { ...device, runtimes: [{ ...device.runtimes[1], profiles: [{ name: 'qa', hasProvider: false }] }] };
  assert.match(employeeReadiness({ devices: [missingProvider] }, { deviceId: device.id, runtime: 'Hermes', profile: 'qa' }).issues.join(' '), /provider/);
});

test('management MCP readiness enforces workspace and supported runtime evidence', () => {
  assert.match(employeeReadiness({ workspace: 'other', devices: [device] }, { deviceId: device.id, runtime: 'Codex', mcpEnabled: true }).issues.join(' '), /工作区.*不同/);
  assert.match(employeeReadiness({ devices: [{ ...device, management_mcp: { configured: true, supportedRuntimes: ['Hermes'] } }] }, { deviceId: device.id, runtime: 'Codex', mcpEnabled: true }).issues.join(' '), /Codex.*注入/);
});

test('Hermes independent profile readiness is not replaced by main profile provider state', () => {
  const independent = { ...device, runtimes: [{ ...device.runtimes[1], readiness: { ready: false, provider: 'missing', authentication: 'missing', reason: '主 profile 未配置' } }] };
  assert.equal(employeeReadiness({ devices: [independent] }, { deviceId: device.id, runtime: 'Hermes', profile: 'qa' }).ready, true);
});

test('Codex named profiles are preserved and must exist on the selected device', () => {
  const profiled = { ...device, runtimes: [{ ...device.runtimes[0], profiles: [{ name: 'qa-codex', readiness: { ready: true } }] }] };
  assert.equal(employeeReadiness({ devices: [profiled] }, { deviceId: device.id, runtime: 'Codex', profile: 'qa-codex' }).ready, true);
  assert.match(employeeReadiness({ devices: [profiled] }, { deviceId: device.id, runtime: 'Codex', profile: 'missing-codex' }).issues.join(' '), /未发现.*missing-codex/);
  assert.equal(profileAfterRuntimeChange('Codex', 'Codex', 'qa-codex'), 'qa-codex');
  assert.equal(profileAfterRuntimeChange('Hermes', 'Codex', 'qa-independent'), '');
});

test('HTTP health and injection alone cannot claim actual employee MCP load', () => {
  assert.equal(employeeMcpEvidence({ receipt: { status: 'injected', injected: true }, health: 'healthy' }).label, '已注入，等待加载回执');
  assert.equal(employeeMcpEvidence({ receipt: { status: 'never_run' } }).label, '尚无运行回执');
  assert.equal(employeeMcpEvidence({ receipt: { status: 'loaded', loaded: true, tool_calls: [] } }).label, '已加载，尚无工具调用');
  assert.equal(employeeMcpEvidence({ receipt: { status: 'loaded', loaded: true, tool_calls: [{ name: 'ziwei_list_employees' }] } }).label, '已加载并调用工具');
  assert.equal(employeeMcpEvidence({ receipt: { status: 'failed', error: 'provider unavailable' } }).tone, 'failed');
});
