import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createMcpClient } from '../scripts/ziwei-mcp.mjs';
import * as runtime from '../src/runtime-adapters.mjs';

const bootstrapModule = await import('../src/management-bootstrap.mjs').catch(() => ({}));
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-managed-client-'));
async function fixture(t, handler) {
  const directory = temp(); let calls = [];
  const server = http.createServer((req, res) => {
    calls.push({ path: req.url, method: req.method, token: req.headers['x-ziwei-device-token'] });
    const slug = req.url.split('/')[3];
    const value = { token: `private-management-${calls.length}`, workspace: slug, deviceId: `device_${slug}`, credentialId: `credential_${slug}`, expiresAt: new Date(Date.now() + 3600000).toISOString(), apiBase: `http://127.0.0.1:${server.address().port}`, managed: true, audience: 'ziwei-management', ...(handler?.(req, calls.length) || {}) };
    res.writeHead(value.status || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  function client(slug = 'first', extras = {}) {
    assert.equal(typeof bootstrapModule.createManagementBootstrap, 'function', 'Automatic management bootstrap is missing');
    return bootstrapModule.createManagementBootstrap({ workspace: slug, deviceId: `device_${slug}`, deviceToken: `private-device-${slug}`, apiBase: `http://127.0.0.1:${server.address().port}`, cacheDirectory: directory, ...extras });
  }
  return { client, calls, directory };
}

test('paired connection automatically acquires a private single-workspace management credential', async t => {
  const f = await fixture(t); const client = f.client();
  assert.equal(client.status().state, 'pending');
  const config = await client.prepare();
  assert.equal(config.managed, true); assert.equal(config.enabled, true);
  assert.deepEqual(f.calls, [{ path: '/api/workspaces/first/mcp/bootstrap', method: 'POST', token: 'private-device-first' }]);
  const credential = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8'));
  assert.equal(credential.workspace, 'first'); assert.equal(credential.deviceId, 'device_first');
  assert.equal(credential.audience, 'ziwei-management');
  assert.equal(client.status().state, 'ready');
  assert.doesNotMatch(JSON.stringify(client.status()) + JSON.stringify(config), /private-device|private-management/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(config.tokenFile).mode & 0o777, 0o600);
});

test('management cache isolates workspace/device identities and recovers without a manual token file', async t => {
  const f = await fixture(t); const a = await f.client().prepare(); const b = await f.client('second').prepare();
  assert.notEqual(a.tokenFile, b.tokenFile);
  const restored = f.client(); await restored.prepare(); assert.equal(f.calls.length, 2);
  fs.unlinkSync(a.tokenFile); await restored.prepare(); assert.equal(f.calls.length, 3);
  assert.equal(restored.status().configured, true);
});

test('expiring cache and a changed server retry marker renew once; concurrent preparations coalesce', async t => {
  let now = Date.now(); const f = await fixture(t, () => ({ expiresAt: new Date(now + 3600000).toISOString() })); const c = f.client('first', { now: () => now });
  const first = await c.prepare();
  now += 56 * 60000; await Promise.all([c.prepare(), c.prepare()]); assert.equal(f.calls.length, 2);
  assert.equal(c.noteRetry('2026-10-09T04:00:00Z'), true); await c.prepare(); assert.equal(f.calls.length, 3);
  assert.equal(c.noteRetry('2026-10-09T04:00:00Z'), false); await c.prepare(); assert.equal(f.calls.length, 3);
  assert.equal(first.tokenFile, (await c.prepare()).tokenFile);
});

test('bootstrap failure stays safe and truthful and never falls back to legacy/global credentials', async t => {
  const f = await fixture(t, () => ({ status: 403, error: 'server may contain private-device-first and private-management-secret' })); const c = f.client();
  await assert.rejects(c.prepare(), /403/);
  assert.equal(c.status().configured, false); assert.equal(c.status().state, 'failed');
  assert.doesNotMatch(JSON.stringify(c.status()), /private-device|private-management/);
  const unpaired = f.client('first', { deviceToken: '' }); await assert.rejects(unpaired.prepare(), /配对/);
  assert.equal(unpaired.status().state, 'client_required');
});

test('a rejected forced renewal cannot silently reuse the previous cached credential', async t => {
  let rejected = false;
  const f = await fixture(t, () => rejected ? { status: 403 } : {});
  const c = f.client(); await c.prepare(); rejected = true;
  c.noteRetry('new-server-marker');
  await assert.rejects(c.prepare(), /403/);
  await assert.rejects(c.prepare(), /403/);
  assert.equal(f.calls.length, 3);
  assert.equal(c.status().state, 'failed');
});

test('foreign identity, audience or API returned by bootstrap is rejected before storing credentials', async t => {
  const f = await fixture(t, () => ({ token: 'foreign-private', workspace: 'other', deviceId: 'device_other', credentialId: 'credential_foreign', expiresAt: new Date(Date.now() + 3600000).toISOString(), apiBase: 'https://foreign.test', audience: 'ziwei-terminal', managed: true }));
  await assert.rejects(f.client().prepare(), /范围|身份|不匹配/);
  assert.equal(fs.readdirSync(f.directory).length, 0);
});

test('stdio client rereads managed credentials for each request after daemon renewal', async t => {
  const directory = temp(); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tokenFile = path.join(directory, 'managed.json');
  const credential = token => ({ token, workspace: 'first', workspaces: ['first'], managed: true, deviceId: 'device_first', audience: 'ziwei-management', apiBase: 'https://example.test', expiresAt: new Date(Date.now() + 3600000).toISOString() });
  fs.writeFileSync(tokenFile, JSON.stringify(credential('first-private')));
  const authorizations = [];
  const client = createMcpClient({ tokenFile, baseUrl: 'https://example.test', workspace: 'first', fetchImpl: async (_url, init) => { authorizations.push(init.headers.authorization); return { ok: true, text: async () => '{}' }; } });
  await client.health(); fs.writeFileSync(tokenFile, JSON.stringify(credential('renewed-private'))); await client.health();
  assert.deepEqual(authorizations, ['Bearer first-private', 'Bearer renewed-private']);
  await assert.rejects(client.health({ workspace: 'other' }), /工作区/);
});

test('Hermes default management injection uses an execution overlay without changing config or persona', t => {
  const directory = temp(); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const home = path.join(directory, 'hermes'); fs.mkdirSync(home);
  const original = 'model:\n  provider: openai-codex\nmcp_servers:\n  ziwei-terminal:\n    command: legacy-host-admin\n';
  fs.writeFileSync(path.join(home, 'config.yaml'), original); fs.writeFileSync(path.join(home, 'SOUL.md'), 'Original persona');
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ providers: { 'openai-codex': { access_token: 'original-provider-private' } } }));
  const tokenFile = path.join(directory, 'management.json'); fs.writeFileSync(tokenFile, JSON.stringify({ token: 'management-private', workspace: 'first' }));
  const launch = runtime.prepareManagementMcpLaunch({ runtime: 'Hermes', profile: 'default', workspace: 'first', config: { enabled: true, tokenFile, baseUrl: 'https://example.test' }, auditDirectory: path.join(directory, 'audit'), invocation: { args: [] }, env: { HERMES_HOME: home } });
  assert.equal(launch.env.HERMES_HOME, home);
  assert.ok(launch.invocation.args.includes('--profile'));
  assert.equal(launch.invocation.args[launch.invocation.args.indexOf('--profile') + 1], 'default');
  assert.equal(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(home, 'SOUL.md'), 'utf8'), 'Original persona');
  assert.deepEqual(fs.readdirSync(launch.env.HERMES_MANAGED_DIR), ['config.yaml']);
  assert.match(fs.readFileSync(path.join(launch.env.HERMES_MANAGED_DIR, 'config.yaml'), 'utf8'), /ziwei_management:/);
  const phone = runtime.prepareTerminalMcpLaunch({ runtime: 'Hermes', profile: 'default', invocation: launch.invocation, env: launch.env, hermesOverlayHome: launch.overlayHome, profileBaseHome: home });
  assert.equal(phone.env.HERMES_HOME, home);
  assert.match(fs.readFileSync(path.join(phone.env.HERMES_MANAGED_DIR, 'config.yaml'), 'utf8'), /enabled: false/);
  const overlay = launch.env.HERMES_MANAGED_DIR; launch.cleanup(); assert.equal(fs.existsSync(overlay), false); assert.equal(fs.existsSync(home), true);
});

test('Hermes execution overlay inherits managed policy and env without copying profile authentication', t => {
  const directory = temp(); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const home = path.join(directory, 'profiles', 'selected'); fs.mkdirSync(home, { recursive: true });
  const managed = path.join(directory, 'policy'); fs.mkdirSync(managed);
  fs.writeFileSync(path.join(home, 'config.yaml'), 'model:\n  provider: openai-codex\n');
  fs.writeFileSync(path.join(home, 'auth.json'), 'original auth store');
  const original = 'security:\n  redact_secrets: true\nmcp_servers:\n  unrelated:\n    command: pinned-server\n';
  fs.writeFileSync(path.join(managed, 'config.yaml'), original);
  fs.writeFileSync(path.join(managed, '.env'), 'POLICY_FLAG=original\n');
  const overlay = runtime.createHermesExecutionOverlay({ profile: 'selected', baseHome: directory, managedDirectory: managed, privateDirectory: path.join(directory, 'executions') });
  assert.equal(overlay.sourceHome, home);
  assert.match(fs.readFileSync(path.join(overlay.home, 'config.yaml'), 'utf8'), /redact_secrets: true|pinned-server/);
  assert.equal(fs.readFileSync(path.join(overlay.home, '.env'), 'utf8'), 'POLICY_FLAG=original\n');
  assert.equal(fs.existsSync(path.join(overlay.home, 'auth.json')), false);
  // Native auth refresh resolves the original HERMES_HOME and atomically replaces its auth file.
  fs.writeFileSync(path.join(home, 'auth.json.tmp'), 'refreshed auth store');
  fs.renameSync(path.join(home, 'auth.json.tmp'), path.join(home, 'auth.json'));
  overlay.cleanup();
  assert.equal(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'), 'refreshed auth store');
  assert.equal(fs.readFileSync(path.join(managed, 'config.yaml'), 'utf8'), original);
});

test('default supported runtime injection clears inherited Codex management token precedence', t => {
  const directory = temp(); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tokenFile = path.join(directory, 'management.json'); fs.writeFileSync(tokenFile, JSON.stringify({ token: 'management-private', workspace: 'first' }));
  const launch = runtime.prepareManagementMcpLaunch({ runtime: 'Codex', workspace: 'first', config: { enabled: true, tokenFile, baseUrl: 'https://example.test' }, auditDirectory: directory, invocation: { args: ['-'] }, env: {} });
  assert.ok(launch.receipt?.injected, 'Old payloads must inject by default');
  assert.ok(launch.invocation.args.includes('mcp_servers.ziwei_management.env.ZIWEI_MCP_TOKEN=""'));
  assert.ok(launch.invocation.args.includes(`mcp_servers.ziwei_management.env.ZIWEI_MCP_TOKEN_FILE=${JSON.stringify(tokenFile)}`));
  assert.ok(launch.invocation.args.includes('mcp_servers.ziwei_management.env.ZIWEI_MCP_WORKSPACE="first"'));
  assert.ok(launch.invocation.args.includes('mcp_servers.ziwei_management.env.ZIWEI_API_BASE="https://example.test"'));
});

test('client build identity detects upgraded code even when package version is unchanged', () => {
  assert.equal(typeof bootstrapModule.clientBuildIdentity, 'function');
  assert.equal(typeof bootstrapModule.clientBuildMismatch, 'function');
  const directory = temp();
  try {
    fs.mkdirSync(path.join(directory, 'src')); fs.writeFileSync(path.join(directory, 'package.json'), '{"version":"0.1.0"}'); fs.writeFileSync(path.join(directory, 'src', 'one.mjs'), 'first');
    const first = bootstrapModule.clientBuildIdentity(directory); fs.writeFileSync(path.join(directory, 'src', 'one.mjs'), 'second');
    const second = bootstrapModule.clientBuildIdentity(directory); assert.notEqual(first, second);
    assert.equal(bootstrapModule.clientBuildMismatch({ version: '0.1.0', clientBuild: first }, '0.1.0', second), true);
    assert.equal(bootstrapModule.clientBuildMismatch({ version: '0.1.0', clientBuild: second }, '0.1.0', second), false);
    fs.writeFileSync(path.join(directory, 'src', 'hermes-mcp-bootstrap.py'), 'first Python bootstrap');
    const beforePythonChange = bootstrapModule.clientBuildIdentity(directory);
    fs.writeFileSync(path.join(directory, 'src', 'hermes-mcp-bootstrap.py'), 'updated Python bootstrap only');
    const afterPythonChange = bootstrapModule.clientBuildIdentity(directory);
    assert.notEqual(beforePythonChange, afterPythonChange, 'Python-only startup fixes must trigger the same-version native upgrade');
    assert.equal(bootstrapModule.clientBuildMismatch({ version: '0.1.0', clientBuild: beforePythonChange }, '0.1.0', afterPythonChange), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
