import {rasterFixtures} from './fixtures/raster-images.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';

const pngContent = rasterFixtures.png.toString('base64');
const image = (extra = {}) => ({ name: 'image.png', mimeType: 'image/png', contentEncoding: 'base64', content: pngContent, ...extra });
const imageMetadata = (name = 'image.png') => ({ name, mimeType: 'image/png', size: Buffer.from(pngContent, 'base64').length });
const sha = content => crypto.createHash('sha256').update(Buffer.from(content, 'base64')).digest('hex');
const occurrences = (json, content) => json.split(content).length - 1;

function fixture(t) {
  const repo = createRepository({ memory: true });
  t.after(() => repo.db.close());
  const device = repo.claimDevicePairing({ code: repo.createDevicePairing('test-111', { name: 'Response fixture PC', os: 'Windows' }).code });
  const employee = repo.createEmployee('test-111', { name: 'Response fixture', runtime: 'Codex', targetDeviceId: device.deviceId });
  const conversation = repo.createConversation('test-111', { employeeId: employee.id, modelId: 'fixture-model', workingDirectory: 'C:/isolated-image-fixture' });
  return { repo, device, employee, conversation };
}

function assertPublicAction(repo, action) {
  const row = repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(action.id);
  assert.equal(Object.hasOwn(action, 'payload_json'), false);
  assert.equal(Object.hasOwn(action, 'result_json'), false);
  for (const [key, value] of Object.entries(row)) if (!['payload_json', 'result_json'].includes(key)) assert.deepEqual(action[key], value, `A2A DTO must preserve ${key}`);
  assert.ok(Object.hasOwn(action, 'payload'));
  assert.ok(Object.hasOwn(action, 'result'));
}

test('normal and idempotent conversation sends carry image bytes once while pending and acked A2A retain exact vision input', t => {
  const { repo, device, conversation } = fixture(t);
  const input = { content: 'image response fixture', attachments: [image()], clientMessageId: 'response-repeat', actorUserId: 'response-owner' };
  const sent = repo.addConversationMessage(conversation.id, input);
  assert.deepEqual(sent.execution.payload.attachments, [imageMetadata()]);
  assert.equal(occurrences(JSON.stringify(sent), pngContent), 1);
  assert.equal(Object.hasOwn(sent, 'attachment_json'), false);
  const pending = repo.listA2AActions('test-111', { deviceId: device.deviceId }).find(item => item.id === sent.execution.id);
  assertPublicAction(repo, pending);
  assert.equal(sha(pending.payload.attachments[0].content), sha(pngContent));
  const acked = repo.ackA2AAction(sent.execution.id, { deviceId: device.deviceId });
  assertPublicAction(repo, acked);
  const replay = repo.listA2AActions('test-111', { deviceId: device.deviceId, includeAcked: true }).find(item => item.id === sent.execution.id);
  assert.equal(sha(acked.payload.attachments[0].content), sha(pngContent));
  assert.equal(sha(replay.payload.attachments[0].content), sha(pngContent));
  const retry = repo.addConversationMessage(conversation.id, input);
  assert.equal(retry.id, sent.id);
  assert.equal(retry.duplicate, true);
  assert.equal(Object.hasOwn(retry, 'attachment_json'), false);
  assert.deepEqual(retry.execution.payload.attachments, [imageMetadata()]);
  assert.equal(occurrences(JSON.stringify(retry), pngContent), 1);
  const history = repo.getConversation(conversation.id);
  assert.equal(Object.hasOwn(history.messages[0], 'attachment_json'), false);
  assert.equal(sha(history.messages[0].attachments[0].content), sha(pngContent));
  assert.equal(occurrences(JSON.stringify(history), pngContent), 1);
  assert.ok(repo.db.prepare('SELECT attachment_json FROM conversation_messages WHERE id=?').get(sent.id).attachment_json.includes(pngContent));
});

test('conversation history and sidebar project wrapped artifacts without altering text, diagnostics, receipts, events or execution identity', t => {
  const { repo, device, employee, conversation } = fixture(t);
  const sent = repo.addConversationMessage(conversation.id, { content: 'wrapped response', attachments: [image()] });
  const event = repo.recordA2AEvent(sent.execution.id, { type: 'stage', message: 'fixture stage', data: { stage: 'responding' } });
  const diagnostics = 'diagnostic text preserved\n'.repeat(5000);
  const nativeResult = { runtime: 'Codex', output: 'Original model output text', diagnostics, managementMcp: { loaded: true, toolCalls: [{ toolName: 'fixture', ok: true }] }, outputArtifacts: [image({ name: 'returned.png' })] };
  repo.resultA2AAction(sent.execution.id, { result: { status: 'succeeded', result: nativeResult, diagnostics: 'outer diagnostics preserved' } });
  const history = repo.getConversation(conversation.id);
  assert.deepEqual(history.execution.payload.attachments, [imageMetadata()]);
  assert.deepEqual(history.execution.result.result.outputArtifacts, [imageMetadata('returned.png')]);
  assert.equal(history.execution.result.result.output, nativeResult.output);
  assert.equal(history.execution.result.result.diagnostics, diagnostics);
  assert.equal(history.execution.result.diagnostics, 'outer diagnostics preserved');
  assert.deepEqual(history.execution.result.result.managementMcp, nativeResult.managementMcp);
  assert.deepEqual(history.execution.events, [event]);
  assert.equal(history.execution.payload.deviceId, device.deviceId);
  assert.equal(history.execution.payload.employeeId, employee.id);
  assert.equal(history.execution.payload.conversationId, conversation.id);
  assert.equal(history.execution.payload.model, 'fixture-model');
  assert.equal(history.execution.payload.cwd, 'C:/isolated-image-fixture');
  assert.equal(occurrences(JSON.stringify(history.execution), pngContent), 0);
  assert.equal(history.messages.length, 2);
  for (const message of history.messages) {
    assert.equal(Object.hasOwn(message, 'attachment_json'), false);
    assert.equal(sha(message.attachments[0].content), sha(pngContent));
  }
  assert.equal(occurrences(JSON.stringify(history), pngContent), 2, 'One canonical image per user/assistant message');
  const sidebar = repo.listConversations('test-111').find(item => item.id === conversation.id);
  assert.equal(occurrences(JSON.stringify(sidebar), pngContent), 0);
  assert.deepEqual(sidebar.execution, history.execution);
  const internal = repo.getA2AAction(sent.execution.id);
  assert.equal(sha(internal.payload.attachments[0].content), sha(pngContent));
  assert.equal(sha(internal.result.result.outputArtifacts[0].content), sha(pngContent));
  const stored = repo.db.prepare('SELECT payload_json,result_json FROM a2a_actions WHERE id=?').get(sent.execution.id);
  assert.equal(sha(JSON.parse(stored.payload_json).attachments[0].content), sha(pngContent));
  assert.equal(sha(JSON.parse(stored.result_json).result.outputArtifacts[0].content), sha(pngContent));
});

test('top-level artifact metadata is conversation-only and public A2A receipts retain full parsed data and every row field once', t => {
  const { repo, device, conversation } = fixture(t);
  const sent = repo.addConversationMessage(conversation.id, { content: 'top-level response', attachments: [image()] });
  const receipt = repo.resultA2AAction(sent.execution.id, { result: { output: 'Result text retained', diagnostics: 'diagnostics retained', outputArtifacts: [image({ name: 'top.png' })] } });
  const duplicate = repo.resultA2AAction(sent.execution.id, { result: { output: 'must not replace original' } });
  const ackDuplicate = repo.ackA2AAction(sent.execution.id, { deviceId: device.deviceId });
  const listed = repo.listA2AActions('test-111', { status: 'all', deviceId: device.deviceId }).find(item => item.id === sent.execution.id);
  for (const action of [receipt, duplicate, ackDuplicate, listed]) {
    assertPublicAction(repo, action);
    assert.equal(sha(action.payload.attachments[0].content), sha(pngContent));
    assert.equal(sha(action.result.outputArtifacts[0].content), sha(pngContent));
    assert.equal(action.result.output, 'Result text retained');
    assert.equal(action.result.diagnostics, 'diagnostics retained');
    assert.equal(occurrences(JSON.stringify(action), pngContent), 2, 'One parsed input and one parsed output; no raw JSON copies');
  }
  assert.equal(duplicate.duplicate, true);
  assert.equal(ackDuplicate.duplicate, true);
  const execution = repo.getConversation(conversation.id).execution;
  assert.deepEqual(execution.result.outputArtifacts, [imageMetadata('top.png')]);
  assert.equal(execution.result.output, 'Result text retained');
  assert.equal(execution.result.diagnostics, 'diagnostics retained');
  assert.equal(occurrences(JSON.stringify(execution), pngContent), 0);
});

test('A2A includeResult false is explicit and preserves status, identity, lease and complete input payload', t => {
  const { repo, device, conversation } = fixture(t);
  const sent = repo.addConversationMessage(conversation.id, { content: 'Optional result projection', attachments: [image()] });
  const pending = repo.listA2AActions('test-111', { includeResult: false, deviceId: device.deviceId }).find(item => item.id === sent.execution.id);
  assertPublicAction(repo, pending);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.result, null);
  assert.equal(sha(pending.payload.attachments[0].content), sha(pngContent));
  repo.ackA2AAction(sent.execution.id, { deviceId: device.deviceId });
  const acked = repo.listA2AActions('test-111', { includeAcked: true, includeResult: false, deviceId: device.deviceId }).find(item => item.id === sent.execution.id);
  assert.equal(acked.status, 'acked');
  assert.equal(sha(acked.payload.attachments[0].content), sha(pngContent));
  repo.resultA2AAction(sent.execution.id, { result: { output: 'Optional output', outputArtifacts: [image()] } });
  const defaultResult = repo.listA2AActions('test-111', { status: 'all', deviceId: device.deviceId }).find(item => item.id === sent.execution.id);
  const metadataOnly = repo.listA2AActions('test-111', { status: 'all', includeResult: false, deviceId: device.deviceId }).find(item => item.id === sent.execution.id);
  assert.equal(metadataOnly.result, null);
  assertPublicAction(repo, metadataOnly);
  assert.equal(Object.hasOwn(acked, 'payload_json'), false);
  assert.equal(Object.hasOwn(acked, 'result_json'), false);
  for (const key of ['id', 'status', 'workspace_id', 'expires_at', 'completed_at', 'acked_at']) assert.equal(metadataOnly[key], defaultResult[key]);
  assert.deepEqual(metadataOnly.payload, defaultResult.payload);
  assert.equal(sha(defaultResult.result.outputArtifacts[0].content), sha(pngContent));
  assert.equal(sha(metadataOnly.payload.attachments[0].content), sha(pngContent));
});

function sizedPng(size) {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  const prefix = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,18,52,86])))]);
  const text = Buffer.alloc(size - prefix.length - 24, 120); text.write('fixture\0');
  return Buffer.concat([prefix, chunk('tEXt', text), chunk('IEND', Buffer.alloc(0))]);
}

test('authenticated HTTP responses return a maximum 10 MiB PNG once and preserve canonical SHA within one-image response budget', async t => {
  const app = createApp({ memory: true, requireAuth: true, requireDeviceAuth: true, enableScheduler: false });
  const repo = app.locals.repo;
  const owner = app.locals.auth.setup({ name: 'Response owner', email: 'image-response@example.test', password: crypto.randomUUID() });
  const ws = app.locals.auth.createWorkspace(owner.user_id, { name: 'Response budget fixture', slug: 'response-budget-fixture', kind: 'team' }).workspace;
  const device = repo.claimDevicePairing({ code: repo.createDevicePairing(ws.slug, { ownerUserId: owner.user_id, name: 'Isolated response PC', os: 'Windows' }).code });
  const employee = repo.createEmployee(ws.slug, { name: 'Response budget fixture', runtime: 'Codex', targetDeviceId: device.deviceId });
  const conversation = repo.createConversation(ws.slug, { employeeId: employee.id });
  const sent = repo.addConversationMessage(conversation.id, { content: 'No-model response budget fixture' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(() => { repo.db.close(); resolve(); })));
  const base = `http://127.0.0.1:${server.address().port}`;
  const png = sizedPng(10 * 1024 * 1024), content = png.toString('base64');
  const result = { runtime: 'no-model fixture', output: 'Original output retained', diagnostics: 'diagnostic text retained', outputArtifacts: [image({ name: 'maximum.png', content, size: png.length })] };
  const response = await fetch(`${base}/a2a/v1/actions/${sent.execution.id}/result`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ziwei-device-token': device.deviceToken }, body: JSON.stringify({ result }) });
  assert.equal(response.status, 200);
  const receiptJson = await response.text(), receipt = JSON.parse(receiptJson);
  assert.equal(occurrences(receiptJson, content), 1);
  assert.ok(Buffer.byteLength(receiptJson) <= content.length + 64 * 1024, 'Receipt must fit one image plus bounded small fixture metadata');
  assertPublicAction(repo, receipt);
  assert.equal(sha(receipt.result.outputArtifacts[0].content), sha(content));
  const headers = { cookie: `ziwei_session=${owner.session.token}` };
  const historyResponse = await fetch(`${base}/api/conversations/${conversation.id}`, { headers }); assert.equal(historyResponse.status, 200);
  const historyJson = await historyResponse.text(), history = JSON.parse(historyJson);
  assert.equal(occurrences(historyJson, content), 1);
  assert.ok(Buffer.byteLength(historyJson) <= content.length + 64 * 1024, 'History must contain only the canonical image copy');
  assert.equal(sha(history.messages.at(-1).attachments[0].content), sha(content));
  assert.equal(history.execution.result.output, result.output);
  assert.equal(history.execution.result.diagnostics, result.diagnostics);
  const sidebarResponse = await fetch(`${base}/api/workspaces/${ws.slug}/conversations`, { headers }); assert.equal(sidebarResponse.status, 200);
  const sidebarJson = await sidebarResponse.text();
  assert.equal(occurrences(sidebarJson, content), 0);
  assert.ok(Buffer.byteLength(sidebarJson) < 64 * 1024);
  const actionHeaders = { 'x-ziwei-device-token': device.deviceToken };
  const actionsPath = `${base}/a2a/v1/actions?workspace=${ws.slug}&agent=ziwei_user&status=all`;
  const defaultListResponse = await fetch(actionsPath, { headers: actionHeaders }); assert.equal(defaultListResponse.status, 200);
  const defaultListJson = await defaultListResponse.text(), defaultAction = JSON.parse(defaultListJson).actions.find(item => item.id === sent.execution.id);
  assert.equal(occurrences(defaultListJson, content), 1);
  assert.ok(Buffer.byteLength(defaultListJson) <= content.length + 64 * 1024);
  assert.equal(sha(defaultAction.result.outputArtifacts[0].content), sha(content));
  const projectedListResponse = await fetch(actionsPath + '&includeResult=false', { headers: actionHeaders }); assert.equal(projectedListResponse.status, 200);
  const projectedListJson = await projectedListResponse.text(), projectedAction = JSON.parse(projectedListJson).actions.find(item => item.id === sent.execution.id);
  assert.equal(projectedAction.result, null);
  assert.equal(occurrences(projectedListJson, content), 0);
  assert.ok(Buffer.byteLength(projectedListJson) < 64 * 1024);
  assertPublicAction(repo, projectedAction);
  for (const key of ['id', 'status', 'workspace_id', 'expires_at']) assert.equal(projectedAction[key], defaultAction[key]);
  assert.deepEqual(projectedAction.payload, defaultAction.payload);
  assert.equal(sha(repo.getA2AAction(sent.execution.id).result.outputArtifacts[0].content), sha(content));
  t.diagnostic(JSON.stringify({ scope:'authenticated loopback memory API; no model', imageBytes:png.length, receiptBytes:Buffer.byteLength(receiptJson), historyBytes:Buffer.byteLength(historyJson), sidebarBytes:Buffer.byteLength(sidebarJson), defaultListBytes:Buffer.byteLength(defaultListJson), projectedListBytes:Buffer.byteLength(projectedListJson), canonicalSha:sha(content) }));
});
