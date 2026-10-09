import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('management reads and connection retry retain an explicit workspace while navigation changes', async () => {
  const source = (await readFile(new URL('./api.js', import.meta.url), 'utf8'))
    .replace("'./api-base.js'", JSON.stringify(new URL('./api-base.js', import.meta.url).href))
    .replaceAll('import.meta.env.', '({ VITE_API_URL: "", DEV: false }).');
  const saved = { window: globalThis.window, fetch: globalThis.fetch };
  const requests = [];
  globalThis.window = { location: { origin: 'https://qa.test', pathname: '/workspace-b/open-platform' } };
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, json: async () => ({}) }; };
  try {
    const { api } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    await api.employeeMcp('workspace-a');
    await api.employeeMcpHealth('workspace-a');
    await api.managementMcpDiscovery('workspace-a');
    await api.employeeMcpStatus('employee/a', 'workspace-a');
    assert.deepEqual(requests.map(item => item.url), [
      'https://qa.test/api/workspaces/workspace-a/mcp/status',
      'https://qa.test/api/workspaces/workspace-a/mcp/status',
      'https://qa.test/api/workspaces/workspace-a/mcp/discovery',
      'https://qa.test/api/workspaces/workspace-a/employees/employee%2Fa/mcp/status',
    ]);
    assert.equal(typeof api.retryManagementMcp, 'function');
    await api.retryManagementMcp('computer-a', 'workspace-a');
    assert.equal(requests.at(-1).url, 'https://qa.test/api/workspaces/workspace-a/mcp/retry');
    assert.equal(requests.at(-1).options.method, 'POST');
    assert.deepEqual(JSON.parse(requests.at(-1).options.body), { deviceId: 'computer-a' });
    assert.equal(typeof api.employeeTemplates, 'function');
    await api.employeeTemplates('workspace-a');
    assert.equal(requests.at(-1).url, 'https://qa.test/api/workspaces/workspace-a/employee-templates');
    await api.createEmployeeTemplateInstance('creator/id', {targetDeviceId:'computer-a',runtime:'Codex'}, 'workspace-a');
    assert.equal(requests.at(-1).url, 'https://qa.test/api/workspaces/workspace-a/employee-templates/creator%2Fid/instances');
    assert.deepEqual(JSON.parse(requests.at(-1).options.body), {targetDeviceId:'computer-a',runtime:'Codex'});
  } finally {
    globalThis.window = saved.window; globalThis.fetch = saved.fetch;
  }
});
