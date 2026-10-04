import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';

test('employee configuration API enforces redaction and role boundaries', async () => {
  const app = createApp({ memory: true, mcpToken: 'config-test-token', mcpWorkspace: 'test-111' });
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const employee = app.locals.repo.createEmployee('test-111', { name: 'API 配置员工' });
    const created = await fetch(`${base}/api/workspaces/test-111/employees/${employee.id}/environment`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ key:'API_TOKEN', value:'secret-value', sensitive:true }) });
    assert.equal(created.status, 201); const createdBody = await created.json(); assert.equal('value' in createdBody, false); assert.match(createdBody.masked_value, /•/);
    const listed = await fetch(`${base}/api/workspaces/test-111/employees/${employee.id}/environment`).then(r => r.json());
    assert.equal('value' in listed.variables[0], false); assert.equal(listed.local_source.source, 'ziwei_user');
    const denied = await fetch(`${base}/api/workspaces/test-111/employees/${employee.id}/environment`, { method:'POST', headers:{'content-type':'application/json','x-workspace-role':'member'}, body:JSON.stringify({ key:'NOPE', value:'x' }) });
    assert.equal(denied.status, 403);
    const params = await fetch(`${base}/api/workspaces/test-111/employees/${employee.id}/custom-params`, { method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({ values:{ temperature:0.4, mode:'safe' } }) });
    assert.equal(params.status, 200); assert.deepEqual((await params.json()).values, { temperature:0.4, mode:'safe' });
    const mcp = await fetch(`${base}/api/workspaces/test-111/mcp/status`).then(r => r.json());
    assert.equal(mcp.scope_allowed, true); assert.deepEqual(mcp.capabilities, ['employees','tasks','documents']); assert.match(mcp.boundary, /SQLite/);
    const health = await fetch(`${base}/mcp/v1/workspaces/test-111/health`, { headers:{ authorization:'Bearer config-test-token' } }).then(r => r.json());
    assert.equal(health.ok, true);
    const profiles = await fetch(`${base}/api/workspaces/test-111/hermes/profiles`).then(r => r.json());
    assert.equal(profiles.runtime, 'Hermes'); assert.equal(profiles.independent_home, true);
  } finally { server.close(); }
});
