import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../backend/app.mjs';
import { readMCPCredential, writeMCPCredential } from '../backend/mcp-auth.mjs';

async function start(options = {}) {
  const app = createApp({ memory: true, mcpOptions: { token: 'mcp-test-token', workspaces: ['test-111'] }, ...options });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return { app, server, base: `http://127.0.0.1:${server.address().port}` };
}

const auth = { authorization: 'Bearer mcp-test-token', 'content-type': 'application/json' };

test('MCP management API requires its dedicated bearer token and workspace scope', async () => {
  const { server, base } = await start();
  try {
    assert.equal((await fetch(`${base}/mcp/v1/workspaces/test-111/employees`)).status, 401);
    assert.equal((await fetch(`${base}/mcp/v1/workspaces/test-111/employees`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/mcp/v1/workspaces/other/employees`, { headers: auth })).status, 403);
  } finally { server.close(); }
});

test('MCP management API delegates employee and task changes to the repository', async () => {
  const { app, server, base } = await start();
  try {
    const created = await fetch(`${base}/mcp/v1/workspaces/test-111/employees`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: '调研大师', runtime: 'Hermes', runtimeProfile: 'ziwei-research', instructions: '保留来源和证据链' })
    });
    assert.equal(created.status, 201);
    const employee = await created.json();
    assert.equal(employee.name, '调研大师');
    assert.equal(employee.runtime_profile, 'ziwei-research');

    const listed = await fetch(`${base}/mcp/v1/workspaces/test-111/employees`, { headers: auth }).then(response => response.json());
    assert.ok(listed.employees.some(item => item.id === employee.id));

    const updated = await fetch(`${base}/mcp/v1/workspaces/test-111/employees/${employee.id}`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ description: '通用调研助手' })
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).description, '通用调研助手');

    const taskResponse = await fetch(`${base}/mcp/v1/workspaces/test-111/tasks`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: '验证 MCP 管理入口', description: '只记录任务，不伪造执行结果', assignee: employee.name })
    });
    assert.equal(taskResponse.status, 201);
    const task = await taskResponse.json();
    assert.equal(task.title, '验证 MCP 管理入口');
    assert.equal(app.locals.repo.getTask(task.id).assignee, employee.name);
  } finally { server.close(); }
});

test('MCP employee updates cannot cross workspace boundaries', async () => {
  const { app, server, base } = await start();
  try {
    const employee = app.locals.repo.createEmployee('test-111', { name: '范围测试' });
    const response = await fetch(`${base}/mcp/v1/workspaces/other/employees/${employee.id}`, { method: 'PATCH', headers: auth, body: '{}' });
    assert.equal(response.status, 403);
  } finally { server.close(); }
});

test('MCP credential files carry an explicit workspace allow-list', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-mcp-'));
  const file = path.join(directory, 'mcp.token');
  try {
    const saved = writeMCPCredential({ file, token: 'file-token', workspaces: ['bjc-ops'] });
    assert.equal(readMCPCredential({ file, create: false }).token, saved.token);
    assert.deepEqual(readMCPCredential({ file, create: false }).workspaces, ['bjc-ops']);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
