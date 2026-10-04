import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../backend/app.mjs';
import { createMcpClient, createMcpHandler } from '../scripts/ziwei-mcp.mjs';

const TOKEN = 'mcp-test-token-012345678901234567';

async function listen(app) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return server;
}

test('MCP management API requires the dedicated token and stays workspace scoped', async () => {
  const app = createApp({ memory: true, mcpToken: TOKEN, mcpWorkspace: 'test-111', mcpRole: 'admin' });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/mcp/v1/workspaces/test-111/employees`)).status, 401);
    const list = await fetch(`${base}/mcp/v1/workspaces/test-111/employees`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray((await list.json()).employees));
    const created = await fetch(`${base}/mcp/v1/workspaces/test-111/employees`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '调研大师', runtime: 'Hermes', runtimeProfile: 'ziwei-research', instructions: '保留证据链' })
    });
    assert.equal(created.status, 201);
    const employee = await created.json();
    assert.equal(employee.runtime_profile, 'ziwei-research');
    assert.equal((await fetch(`${base}/mcp/v1/workspaces/other/employees`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 403);
    const task = await fetch(`${base}/mcp/v1/workspaces/test-111/tasks`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'MCP 联调', description: '保留证据', assignee: employee.id })
    });
    assert.equal(task.status, 201);
    const document = await fetch(`${base}/mcp/v1/workspaces/test-111/documents`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '调研记录.md', type: 'file', content: '# 证据' })
    });
    assert.equal(document.status, 201);
    const doc = await document.json();
    const read = await fetch(`${base}/mcp/v1/documents/${doc.id}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).content, '# 证据');
  } finally { server.close(); }
});

test('MCP handler speaks JSON-RPC and dispatches management tools', async () => {
  const calls = [];
  const handler = createMcpHandler({
    listEmployees: async args => { calls.push(['listEmployees', args]); return { employees: [] }; },
    createEmployee: async input => { calls.push(['createEmployee', input]); return { id: 'employee_1', ...input }; },
    updateEmployee: async input => input,
    listTasks: async () => ({ tasks: [] }),
    createTask: async input => input,
    listDocuments: async () => ({ documents: [] }),
    readDocument: async input => input,
    writeDocument: async input => input
  });
  const initialize = await handler({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(initialize.result.serverInfo.name, 'ziwei-management');
  const tools = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.ok(tools.result.tools.some(tool => tool.name === 'ziwei_create_employee'));
  const result = await handler({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ziwei_create_employee', arguments: { name: '研究员' } } });
  assert.equal(JSON.parse(result.result.content[0].text).name, '研究员');
  assert.deepEqual(calls, [['createEmployee', { name: '研究员' }]]);
  assert.equal(await handler({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await handler({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'unknown' } })).error.code, -32602);
});

test('MCP client injects HTTPS API auth without opening SQLite', async () => {
  const requests = [];
  const client = createMcpClient({ baseUrl: 'https://example.test', workspace: 'test-111', token: TOKEN, fetchImpl: async (url, init) => {
    requests.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ employees: [] }) };
  } });
  await client.listEmployees();
  assert.equal(requests[0].url, 'https://example.test/mcp/v1/workspaces/test-111/employees');
  assert.equal(requests[0].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(requests[0].init.body, undefined);
});

test('MCP client reads the generated plural workspace scope from its token file', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-mcp-client-'));
  const file = path.join(directory, 'mcp.token');
  fs.writeFileSync(file, JSON.stringify({ token: TOKEN, workspaces: ['test-111'] }));
  const requests = [];
  try {
    const client = createMcpClient({ baseUrl: 'https://example.test', tokenFile: file, fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ employees: [] }) };
    } });
    await client.listEmployees();
    assert.equal(requests[0].init.headers.authorization, `Bearer ${TOKEN}`);
    assert.match(requests[0].url, /\/mcp\/v1\/workspaces\/test-111\/employees$/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
