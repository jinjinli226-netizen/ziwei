import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';

test('automation templates, lifecycle actions, and run records are exposed', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (path, options) => fetch(`${base}${path}`, { headers:{'content-type':'application/json'}, ...options }).then(async response => ({ response, body: await response.json() }));
  try {
    const templates = await json('/api/workspaces/test-111/automation-templates');
    assert.equal(templates.response.status, 200);
    assert.ok(templates.body.templates.some(item => item.id === 'daily-summary'));

    const created = await json('/api/workspaces/test-111/automations', { method:'POST', body:JSON.stringify({ templateId:'daily-summary' }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.schedule, '每天 09:00');
    assert.equal(created.body.status, 'active');

    const paused = await json(`/api/automations/${created.body.id}`, { method:'PATCH', body:JSON.stringify({ status:'paused' }) });
    assert.equal(paused.body.status, 'paused');
    const queued = await json(`/api/automations/${created.body.id}/run`, { method:'POST', body:JSON.stringify({ mode:'manual' }) });
    assert.equal(queued.response.status, 202);
    assert.equal(queued.body.status, 'queued');
    assert.match(queued.body.message, /ziwei_user/);

    const runs = await json(`/api/automations/${created.body.id}/runs`);
    assert.equal(runs.body.runs.length, 1);
    assert.equal(runs.body.runs[0].mode, 'manual');
    const detail = await json('/api/workspaces/test-111/automations/' + created.body.id);
    assert.equal(detail.body.run_count, 1);

    const deleted = await json(`/api/automations/${created.body.id}`, { method:'DELETE' });
    assert.equal(deleted.body.deleted, true);
    assert.equal((await json('/api/workspaces/test-111/automations')).body.automations.length, 0);
  } finally {
    server.close();
  }
});
