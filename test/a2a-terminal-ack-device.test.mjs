import {rasterFixtures} from './fixtures/raster-images.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApp } from '../backend/app.mjs';

const content = rasterFixtures.png.toString('base64');
const image = name => ({ name, mimeType: 'image/png', contentEncoding: 'base64', content });
const sha = value => crypto.createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex');

test('authenticated A2A ack enforces the target device before terminal duplicate receipts', async t => {
  const app = createApp({ memory: true, requireAuth: true, requireDeviceAuth: true, enableScheduler: false });
  const repo = app.locals.repo;
  const owner = app.locals.auth.setup({ name: 'Ack owner', email: 'ack-owner@example.test', password: crypto.randomUUID() });
  const member = app.locals.auth.register({ name: 'Ack member', email: 'ack-member@example.test', password: crypto.randomUUID() });
  const ws = app.locals.auth.createWorkspace(owner.user_id, { name: 'Ack device fixture', slug: 'ack-device-fixture', kind: 'team' }).workspace;
  repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)')
    .run('ack-fixture-member', ws.id, member.user_id, member.user.name, member.user.email, 'member', new Date().toISOString());
  const pair = (userId, name) => repo.claimDevicePairing({ code: repo.createDevicePairing(ws.slug, { createdBy: userId, ownerUserId: userId, name, os: 'Windows' }).code });
  const assigned = pair(owner.user_id, 'Owner PC'), other = pair(member.user_id, 'Member PC');
  const employee = repo.createEmployee(ws.slug, { name: 'Private ack fixture', ownerUserId: owner.user_id, visibility: 'personal', runtime: 'Codex', targetDeviceId: assigned.deviceId });
  const conversation = repo.createConversation(ws.slug, { employeeId: employee.id });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(() => { repo.db.close(); resolve(); })));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(app.locals.authBypass, false);

  const ack = (actionId, token) => fetch(`${base}/a2a/v1/actions/${actionId}/ack`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-ziwei-device-token': token } : {}) }, body: '{}'
  });
  const managementReceipt = { loaded: true, injected: true, toolCalls: [{ toolName: 'fixture-only', ok: true }] };
  for (const status of ['succeeded', 'failed']) {
    const sent = repo.addConversationMessage(conversation.id, { content: `No-model ${status} ack fixture`, attachments: [image('input.png')] });
    const actionId = sent.execution.id;
    const anonymous = await ack(actionId); assert.equal(anonymous.status, 401); await anonymous.text();
    const pendingDenied = await ack(actionId, other.deviceToken);
    assert.equal(pendingDenied.status, 400); assert.match((await pendingDenied.json()).error, /another device/);
    const accepted = await ack(actionId, assigned.deviceToken); assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json();
    assert.equal(sha(acceptedBody.payload.attachments[0].content), sha(content));
    assert.deepEqual(acceptedBody.payload.managementMcp, { enabled: true, workspace: ws.slug });

    const result = { runtime: 'no-model-fixture', output: 'Fixture output retained', managementMcp: managementReceipt, outputArtifacts: [image('output.png')] };
    const completed = await fetch(`${base}/a2a/v1/actions/${actionId}/result`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ziwei-device-token': assigned.deviceToken },
      body: JSON.stringify({ status, ...(status === 'failed' ? { error: 'QA fixture failure; no model called' } : {}), result })
    });
    assert.equal(completed.status, 200); assert.equal((await completed.json()).status, status);
    const terminalDenied = await ack(actionId, other.deviceToken);
    assert.equal(terminalDenied.status, 400, `${status} duplicate ack must enforce its assigned device`);
    assert.match((await terminalDenied.json()).error, /another device/);

    const duplicateResponse = await ack(actionId, assigned.deviceToken); assert.equal(duplicateResponse.status, 200);
    const duplicate = await duplicateResponse.json();
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.id, actionId); assert.equal(duplicate.status, status);
    assert.equal(duplicate.workspace_id, ws.id); assert.equal(duplicate.payload.deviceId, assigned.deviceId);
    assert.equal(duplicate.payload.attachments[0].name, 'input.png');
    assert.equal(sha(duplicate.payload.attachments[0].content), sha(content));
    assert.equal(duplicate.result.outputArtifacts[0].name, 'output.png');
    assert.equal(sha(duplicate.result.outputArtifacts[0].content), sha(content));
    assert.deepEqual(duplicate.payload.managementMcp, { enabled: true, workspace: ws.slug });
    assert.deepEqual(duplicate.result.managementMcp, managementReceipt);
    assert.equal(duplicate.result.output, result.output);
    assert.equal(Object.hasOwn(duplicate, 'payload_json'), false); assert.equal(Object.hasOwn(duplicate, 'result_json'), false);
    assert.equal(repo.getA2AAction(actionId).status, status);
  }
});
