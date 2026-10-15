import {rasterFixtures} from './fixtures/raster-images.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { crc32, deflateSync } from 'node:zlib';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';

const previousLocalToken = process.env.ZIWEI_A2A_TOKEN;
test.before(() => { process.env.ZIWEI_A2A_TOKEN = `isolated-delivery-${crypto.randomUUID()}`; });
test.after(() => { if (previousLocalToken === undefined) delete process.env.ZIWEI_A2A_TOKEN; else process.env.ZIWEI_A2A_TOKEN = previousLocalToken; });

function fixture(t, options = {}) {
  const repo = createRepository({ memory: true, envEncryptionKey: crypto.randomUUID(), ...options });
  t.after(() => repo.db.close());
  const pair = name => repo.claimDevicePairing({ code: repo.createDevicePairing('test-111', { name, os: 'Windows' }).code });
  return { repo, deviceA: pair('Delivery fixture A'), deviceB: pair('Delivery fixture B') };
}

async function httpFixture(t, options = {}) {
  const value = fixture(t, options);
  const app = createApp({ repository: value.repo, requireDeviceAuth: true, requireAuth: true, enableScheduler: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  const base = `http://127.0.0.1:${server.address().port}/a2a/v1/actions`;
  const request = async (device, suffix, body) => {
    const response = await fetch(`${base}${suffix}`, {
      headers: { 'x-ziwei-device-token': device.deviceToken, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  return { ...value, request };
}

test('HTTP includeAcked=1 recovers only this device active ACK leases', async t => {
  const { repo, deviceA, deviceB, request } = await httpFixture(t);
  const active = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId, prompt: 'recover active' }, expiresAt: new Date(Date.now() + 1000).toISOString() });
  const ack = await request(deviceA, `/${active.id}/ack`, {});
  assert.equal(ack.status, 200);
  assert.equal(ack.body.status, 'acked');
  assert.ok(Date.parse(ack.body.expires_at) >= Date.parse(ack.body.acked_at) + 16 * 60 * 1000, 'ACK returns the extended execution lease');
  const other = repo.createA2AAction('test-111', { payload: { deviceId: deviceB.deviceId } });
  repo.ackA2AAction(other.id, { deviceId: deviceB.deviceId });
  const expired = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  repo.ackA2AAction(expired.id, { deviceId: deviceA.deviceId });
  repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), expired.id);
  const normal = await request(deviceA, '?workspace=test-111');
  assert.equal(normal.status, 200);
  assert.deepEqual(normal.body.actions, []);
  const recovered = await request(deviceA, '?workspace=test-111&includeAcked=1&includeResult=false');
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.body.actions.map(action => action.id), [active.id]);
  assert.equal(recovered.body.actions[0].result, null);
  assert.equal(repo.getA2AAction(expired.id).status, 'expired');
  const alias = await request(deviceA, '?workspace=test-111&include_acked=1');
  assert.deepEqual(alias.body.actions.map(action => action.id), [active.id]);
});

test('repo includeAcked accepts explicit true and 1 only, never arrays or other values', t => {
  const { repo, deviceA } = fixture(t);
  const action = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  repo.ackA2AAction(action.id, { deviceId: deviceA.deviceId });
  for (const includeAcked of [true, 1, 'true', 'TRUE', '1']) {
    assert.deepEqual(repo.listA2AActions('test-111', { includeAcked, deviceId: deviceA.deviceId }).map(item => item.id), [action.id], `accepted ${JSON.stringify(includeAcked)}`);
  }
  for (const includeAcked of [false, 0, 'false', '0', '', 'yes', 'anything', ['true'], ['1'], [1], {}, null, undefined]) {
    assert.deepEqual(repo.listA2AActions('test-111', { includeAcked, deviceId: deviceA.deviceId }), [], `rejected ${JSON.stringify(includeAcked)}`);
  }
});

test('first authenticated ACK claims an unbound action and fences the other device', async t => {
  const { repo, deviceA, deviceB, request } = await httpFixture(t);
  const action = repo.createA2AAction('test-111', { payload: { prompt: 'unbound legacy action' } });
  for (const device of [deviceA, deviceB]) {
    const polled = await request(device, '?workspace=test-111');
    assert.deepEqual(polled.body.actions.map(item => item.id), [action.id]);
  }
  const ackA = await request(deviceA, `/${action.id}/ack`, {});
  assert.equal(ackA.status, 200);
  assert.equal(ackA.body.payload.deviceId, deviceA.deviceId);
  const ackB = await request(deviceB, `/${action.id}/ack`, {});
  assert.ok(ackB.status >= 400);
  assert.match(ackB.body.error, /another device/);
  const pollB = await request(deviceB, '?workspace=test-111&includeAcked=1');
  assert.deepEqual(pollB.body.actions, []);
  const result = await request(deviceA, `/${action.id}/result`, { result: { output: 'one execution' } });
  assert.equal(result.status, 200);
  const ackAgain = await request(deviceA, `/${action.id}/ack`, {});
  assert.equal(ackAgain.status, 200);
  assert.equal(ackAgain.body.duplicate, true);
  const resultAgain = await request(deviceA, `/${action.id}/result`, { result: { output: 'must preserve first' } });
  assert.equal(resultAgain.body.duplicate, true);
  assert.equal(resultAgain.body.result.output, 'one execution');
  for (const endpoint of ['ack', 'result', 'events']) {
    const rejected = await request(deviceB, `/${action.id}/${endpoint}`, { eventId: crypto.randomUUID(), result: { output: 'cross device' } });
    assert.ok(rejected.status >= 400, endpoint);
    assert.match(rejected.body.error, /another device/, endpoint);
  }
});

test('HTTP malformed includeAcked query values never enable recovery', async t => {
  const { repo, deviceA, request } = await httpFixture(t);
  const action = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  repo.ackA2AAction(action.id, { deviceId: deviceA.deviceId });
  for (const query of ['includeAcked=false', 'includeAcked=0', 'includeAcked=yes', 'includeAcked=true&includeAcked=false', 'includeAcked=0&include_acked=1']) {
    const response = await request(deviceA, `?workspace=test-111&${query}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.actions, [], query);
  }
});

test('HTTP event retry persists once and remains retryable after the result, with one image reply', async t => {
  const { repo, deviceA, deviceB, request } = await httpFixture(t);
  const employee = repo.createEmployee('test-111', { name: 'Delivery fixture employee', runtime: 'Codex', targetDeviceId: deviceA.deviceId });
  const conversation = repo.createConversation('test-111', { employeeId: employee.id, modelId: 'fixture-model', workingDirectory: 'C:/isolated-delivery-fixture' });
  const png = rasterFixtures.png.toString('base64');
  const image = { name: 'delivered.png', mimeType: 'image/png', contentEncoding: 'base64', content: png };
  const sent = repo.addConversationMessage(conversation.id, { content: 'Isolated delivery', attachments: [image] });
  const actionId = sent.execution.id;
  assert.equal((await request(deviceA, `/${actionId}/ack`, {})).status, 200);
  const eventInput = { eventId: crypto.randomUUID(), agentId: 'ziwei_user', type: 'action.progress', message: 'fixture started', data: { stage: 'started', index: 1 } };
  const event = await request(deviceA, `/${actionId}/events`, eventInput);
  assert.equal(event.status, 202);
  const eventAgain = await request(deviceA, `/${actionId}/events`, eventInput);
  assert.equal(eventAgain.status, 202);
  assert.equal(eventAgain.body.duplicate, true);
  assert.equal(eventAgain.body.id, event.body.id);
  assert.equal(eventAgain.body.created_at, event.body.created_at);
  assert.equal(repo.listA2AEvents(actionId).length, 1);
  assert.equal(repo.listAudit('test-111', 200).filter(item => item.action === 'a2a.action.event').length, 1);
  const resultInput = { result: { output: 'Fixture original output', diagnostics: 'Fixture diagnostics', outputArtifacts: [image] } };
  const result = await request(deviceA, `/${actionId}/result`, resultInput);
  assert.equal(result.status, 200);
  const resultAgain = await request(deviceA, `/${actionId}/result`, { result: { output: 'must not replace first' } });
  assert.equal(resultAgain.status, 200);
  assert.equal(resultAgain.body.duplicate, true);
  assert.equal(resultAgain.body.result.output, 'Fixture original output');
  assert.equal(resultAgain.body.result.outputArtifacts[0].content, png);
  const terminalEventAgain = await request(deviceA, `/${actionId}/events`, eventInput);
  assert.equal(terminalEventAgain.status, 202);
  assert.equal(terminalEventAgain.body.duplicate, true);
  assert.equal(terminalEventAgain.body.id, event.body.id);
  const conflict = await request(deviceA, `/${actionId}/events`, { ...eventInput, message: 'changed payload' });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /eventId|event.*content|事件/);
  const newTerminalEvent = await request(deviceA, `/${actionId}/events`, { ...eventInput, eventId: crypto.randomUUID() });
  assert.ok(newTerminalEvent.status >= 400);
  assert.match(newTerminalEvent.body.error, /terminal/);
  for (const endpoint of ['ack', 'result', 'events']) {
    const rejected = await request(deviceB, `/${actionId}/${endpoint}`, endpoint === 'events' ? eventInput : resultInput);
    assert.ok(rejected.status >= 400, endpoint);
    assert.match(rejected.body.error, /another device/, endpoint);
  }
  const wrongWorkspace = await request(deviceA, `/${actionId}/events`, { ...eventInput, workspace: 'bjc-ops' });
  assert.ok([401, 403].includes(wrongWorkspace.status));
  const messages = repo.getConversation(conversation.id).messages;
  assert.equal(messages.filter(message => message.role === 'assistant').length, 1);
  assert.equal(messages[1].content, 'Fixture original output');
  assert.equal(messages[1].attachments[0].content, png);
  assert.equal(repo.listA2AEvents(actionId).length, 1);
});

test('event retry uses action-scoped identity and normalized data while legacy events stay distinct', t => {
  const { repo, deviceA } = fixture(t);
  const first = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  const second = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  const input = { eventId: crypto.randomUUID(), deviceId: deviceA.deviceId, type: 'action.stage', message: 'same stage', data: { stage: 'working', nested: { a: 1, b: 2 } } };
  const event = repo.recordA2AEvent(first.id, input);
  const again = repo.recordA2AEvent(first.id, { ...input, data: { nested: { b: 2, a: 1 }, stage: 'working' } });
  assert.equal(again.id, event.id);
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.data, event.data);
  for (const changed of [{ ...input, type: 'different' }, { ...input, message: 'different' }, { ...input, data: { stage: 'other' } }]) {
    assert.throws(() => repo.recordA2AEvent(first.id, changed), error => error.status === 409);
  }
  assert.notEqual(repo.recordA2AEvent(second.id, input).id, event.id);
  const legacy = { deviceId: deviceA.deviceId, message: 'legacy progress' };
  assert.notEqual(repo.recordA2AEvent(first.id, legacy).id, repo.recordA2AEvent(first.id, legacy).id);
  assert.equal(repo.listA2AEvents(first.id).length, 3);
});

test('terminal event duplicate still verifies device and workspace, and never renews an expired lease', t => {
  const { repo, deviceA, deviceB } = fixture(t);
  const action = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  const input = { eventId: crypto.randomUUID(), deviceId: deviceA.deviceId, message: 'before expiry' };
  const event = repo.recordA2AEvent(action.id, input);
  const expiry = new Date(Date.now() - 1000).toISOString();
  repo.db.prepare("UPDATE a2a_actions SET status='expired',expires_at=? WHERE id=?").run(expiry, action.id);
  assert.throws(() => repo.recordA2AEvent(action.id, { ...input, deviceId: deviceB.deviceId }), /another device/);
  assert.throws(() => repo.recordA2AEvent(action.id, { ...input, workspace: 'bjc-ops' }), /工作区|workspace/);
  const again = repo.recordA2AEvent(action.id, input);
  assert.equal(again.duplicate, true);
  assert.equal(again.id, event.id);
  assert.equal(repo.db.prepare('SELECT expires_at FROM a2a_actions WHERE id=?').get(action.id).expires_at, expiry);
  assert.throws(() => repo.recordA2AEvent(action.id, { ...input, eventId: crypto.randomUUID() }), /terminal/);
  assert.throws(() => repo.ackA2AAction(action.id, { deviceId: deviceB.deviceId }), /another device/);
  assert.throws(() => repo.resultA2AAction(action.id, { deviceId: deviceB.deviceId }), /another device/);
});

for (const failure of ['lease', 'notification']) {
  test(`event, renewed lease, audit and notification roll back atomically on ${failure} failure`, t => {
    const observed = [];
    const { repo, deviceA } = fixture(t, { onEvent: event => observed.push(event) });
    const action = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
    repo.ackA2AAction(action.id, { deviceId: deviceA.deviceId });
    const expiry = new Date(Date.now() + 1000).toISOString();
    repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(expiry, action.id);
    const audits = repo.listAudit('test-111', 200).length;
    const notices = repo.db.prepare('SELECT count(*) AS n FROM notifications').get().n;
    observed.length = 0;
    repo.db.exec(failure === 'lease'
      ? `CREATE TEMP TRIGGER delivery_failure BEFORE UPDATE OF expires_at ON a2a_actions BEGIN SELECT RAISE(ABORT, 'isolated delivery lease failure'); END`
      : `CREATE TEMP TRIGGER delivery_failure BEFORE INSERT ON notifications WHEN NEW.action='a2a.action.event' BEGIN SELECT RAISE(ABORT, 'isolated delivery notification failure'); END`);
    const input = { eventId: crypto.randomUUID(), deviceId: deviceA.deviceId, message: 'atomic fixture' };
    assert.throws(() => repo.recordA2AEvent(action.id, input), /isolated delivery/);
    assert.equal(repo.listA2AEvents(action.id).length, 0);
    assert.equal(repo.db.prepare('SELECT expires_at FROM a2a_actions WHERE id=?').get(action.id).expires_at, expiry);
    assert.equal(repo.listAudit('test-111', 200).length, audits);
    assert.equal(repo.db.prepare('SELECT count(*) AS n FROM notifications').get().n, notices);
    assert.equal(observed.length, 0);
    repo.db.exec('DROP TRIGGER delivery_failure');
    const saved = repo.recordA2AEvent(action.id, input);
    assert.equal(repo.listA2AEvents(action.id).length, 1);
    assert.ok(Date.parse(repo.db.prepare('SELECT expires_at FROM a2a_actions WHERE id=?').get(action.id).expires_at) > Date.parse(expiry));
    assert.equal(observed.length, 1);
    assert.equal(repo.recordA2AEvent(action.id, input).id, saved.id);
    assert.equal(observed.length, 1);
  });
}

test('legacy local ACK without device identity stays compatible and explicitly unbound', t => {
  const { repo } = fixture(t);
  const action = repo.createA2AAction('test-111', { payload: { prompt: 'legacy local bearer' } });
  const ack = repo.ackA2AAction(action.id);
  assert.equal(ack.status, 'acked');
  assert.equal(ack.payload.deviceId, undefined);
  assert.equal(repo.ackA2AAction(action.id).duplicate, true);
});

function sizedPng(size) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  const prefix = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,18,52,86])))]);
  const text = Buffer.alloc(size - prefix.length - 24, 120); text.write('fixture\0');
  return Buffer.concat([prefix, chunk('tEXt', text), chunk('IEND', Buffer.alloc(0))]);
}

test('result receiptOnly is an explicit compact projection and the default DTO stays complete', t => {
  const { repo, deviceA } = fixture(t);
  const employee = repo.createEmployee('test-111', { name: 'Receipt projection fixture', runtime: 'Codex', targetDeviceId: deviceA.deviceId });
  const conversation = repo.createConversation('test-111', { employeeId: employee.id });
  const sent = repo.addConversationMessage(conversation.id, { content: 'Receipt fixture' });
  const result = { output: 'Full result fixture', diagnostics: 'Full diagnostics fixture' };
  const receipt = repo.resultA2AAction(sent.execution.id, { deviceId: deviceA.deviceId, receiptOnly: true, result });
  assert.deepEqual(receipt.result, { outputLength: result.output.length, outputArtifacts: [] });
  assert.equal(Object.hasOwn(receipt, 'payload'), false);
  for (const receiptOnly of [undefined, false, 0, 'false', '0', 'yes', ['true'], ['1'], {}]) {
    const full = repo.resultA2AAction(sent.execution.id, { deviceId: deviceA.deviceId, receiptOnly });
    assert.deepEqual(full.result, result);
    assert.ok(full.payload);
  }
});

test('compact failed result receipts tolerate legacy path-only artifacts without changing stored data', t => {
  const { repo, deviceA } = fixture(t);
  const action = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  const result = { output: 'Failure fixture diagnostics', outputArtifacts: [{ name: 'unmaterialized.png', path: 'C:/isolated-failed-output.png' }] };
  const receipt = repo.resultA2AAction(action.id, { deviceId: deviceA.deviceId, status: 'failed', error: 'isolated failure', receiptOnly: true, result });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.error, 'isolated failure');
  assert.deepEqual(receipt.result, { outputLength: result.output.length, outputArtifacts: [] });
  assert.deepEqual(repo.getA2AAction(action.id).result, result);
  assert.equal(repo.resultA2AAction(action.id, { deviceId: deviceA.deviceId, receiptOnly: true }).duplicate, true);
});

test('authenticated result upload ACK renewal extends a live lease without a second claim or ACK timestamp', async t => {
  const { repo, deviceA, deviceB, request } = await httpFixture(t);
  const action = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  const first = await request(deviceA, `/${action.id}/ack`, { receiptOnly: true });
  assert.equal(first.status, 200);
  const nearExpiry = new Date(Date.now() + 5000).toISOString();
  repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(nearExpiry, action.id);
  const auditCount = repo.listAudit('test-111', 200).length;
  for (const renewLease of [undefined, false, 0, 1, 'true', ['true']]) {
    const repeat = await request(deviceA, `/${action.id}/ack`, { receiptOnly: true, renewLease });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.expires_at, nearExpiry);
    assert.notEqual(repeat.body.leaseRenewed, true);
  }
  const wrong = await request(deviceB, `/${action.id}/ack`, { receiptOnly: true, renewLease: true });
  assert.ok(wrong.status >= 400);
  assert.match(wrong.body.error, /another device/);
  assert.equal(repo.db.prepare('SELECT expires_at FROM a2a_actions WHERE id=?').get(action.id).expires_at, nearExpiry);
  const startedAt = Date.now();
  const renewed = await request(deviceA, `/${action.id}/ack`, { receiptOnly: true, renewLease: true });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.status, 'acked');
  assert.equal(renewed.body.deviceId, deviceA.deviceId);
  assert.equal(renewed.body.acked_at, first.body.acked_at);
  assert.equal(renewed.body.duplicate, true);
  assert.equal(renewed.body.leaseRenewed, true);
  assert.ok(Date.parse(renewed.body.expires_at) >= startedAt + 16 * 60 * 1000);
  assert.equal(repo.listAudit('test-111', 200).length, auditCount);
  await request(deviceA, `/${action.id}/result`, { receiptOnly: true, result: { output: 'completed fixture' } });
  const terminalRenewal = await request(deviceA, `/${action.id}/ack`, { receiptOnly: true, renewLease: true });
  assert.equal(terminalRenewal.status, 200);
  assert.equal(terminalRenewal.body.status, 'succeeded');
  assert.equal(terminalRenewal.body.expires_at, renewed.body.expires_at);
  assert.notEqual(terminalRenewal.body.leaseRenewed, true);
});

test('ACK renewal refuses expired leases and legacy unbound or unidentified callers', t => {
  const { repo, deviceA } = fixture(t);
  const bound = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  repo.ackA2AAction(bound.id, { deviceId: deviceA.deviceId });
  const nearExpiry = new Date(Date.now() + 5000).toISOString();
  repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(nearExpiry, bound.id);
  assert.throws(() => repo.ackA2AAction(bound.id, { renewLease: true }), /device|设备/);
  assert.equal(repo.db.prepare('SELECT expires_at FROM a2a_actions WHERE id=?').get(bound.id).expires_at, nearExpiry);
  const expired = new Date(Date.now() - 1000).toISOString();
  repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(expired, bound.id);
  assert.throws(() => repo.ackA2AAction(bound.id, { deviceId: deviceA.deviceId, renewLease: true }), /expired/);
  assert.equal(repo.getA2AAction(bound.id).status, 'expired');
  assert.equal(repo.db.prepare('SELECT expires_at FROM a2a_actions WHERE id=?').get(bound.id).expires_at, expired);
  const legacy = repo.createA2AAction('test-111', { payload: {} });
  repo.ackA2AAction(legacy.id);
  assert.throws(() => repo.ackA2AAction(legacy.id, { deviceId: deviceA.deviceId, renewLease: true }), /device|设备/);
  assert.equal(repo.getA2AAction(legacy.id).payload.deviceId, undefined);
});

test('new progress cannot resurrect a past ACK lease while an existing retry stays idempotent', t => {
  const { repo, deviceA } = fixture(t);
  const action = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  repo.ackA2AAction(action.id, { deviceId: deviceA.deviceId });
  const input = { deviceId: deviceA.deviceId, eventId: crypto.randomUUID(), message: 'before outage' };
  const event = repo.recordA2AEvent(action.id, input);
  const expiry = new Date(Date.now() - 1000).toISOString();
  repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(expiry, action.id);
  const duplicate = repo.recordA2AEvent(action.id, input);
  assert.equal(duplicate.id, event.id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(repo.db.prepare('SELECT expires_at FROM a2a_actions WHERE id=?').get(action.id).expires_at, expiry);
  assert.throws(() => repo.recordA2AEvent(action.id, { ...input, eventId: crypto.randomUUID(), message: 'after expiry' }), /expired|terminal/);
  assert.equal(repo.db.prepare('SELECT expires_at FROM a2a_actions WHERE id=?').get(action.id).expires_at, expiry);
  assert.equal(repo.getA2AAction(action.id).status, 'expired');
  assert.equal(repo.listA2AEvents(action.id).length, 1);
  assert.equal(repo.listAudit('test-111', 200).filter(item => item.action === 'a2a.action.event').length, 1);
});

test('real isolated SQLite write contention produces retryable HTTP 503 and later succeeds once', async t => {
  const prefix = 'ziwei-delivery-lock-';
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryParent, prefix));
  const exactDirectory = fs.realpathSync(directory);
  const filename = path.join(exactDirectory, 'isolated.sqlite');
  const { repo, deviceA, request } = await httpFixture(t, { memory: false, filename });
  t.after(() => {
    assert.equal(fs.realpathSync(directory), exactDirectory);
    assert.equal(path.dirname(exactDirectory).toLowerCase(), temporaryParent.toLowerCase());
    assert.ok(path.basename(exactDirectory).startsWith(prefix));
    fs.rmSync(exactDirectory, { recursive: true, force: true });
    assert.equal(fs.existsSync(exactDirectory), false);
    t.diagnostic(JSON.stringify({ fixtureDirectory: exactDirectory, cleaned: true }));
  });
  const action = repo.createA2AAction('test-111', { payload: { deviceId: deviceA.deviceId } });
  const locker = new DatabaseSync(filename);
  try {
    locker.exec('BEGIN IMMEDIATE');
    const input = { eventId: crypto.randomUUID(), type: 'action.progress', message: 'isolated lock retry' };
    for (const [endpoint, body] of [['ack', { receiptOnly: true }], ['events', input], ['result', { receiptOnly: true, result: { output: 'isolated locked result' } }]]) {
      const locked = await request(deviceA, `/${action.id}/${endpoint}`, body);
      assert.equal(locked.status, 503, endpoint);
      assert.equal(locked.body.code, 'ERR_SQLITE_ERROR', endpoint);
    }
    assert.equal(repo.getA2AAction(action.id).status, 'pending');
    assert.equal(repo.listA2AEvents(action.id).length, 0);
    locker.exec('ROLLBACK');
    assert.equal((await request(deviceA, `/${action.id}/ack`, { receiptOnly: true })).status, 200);
    const event = await request(deviceA, `/${action.id}/events`, input);
    assert.equal(event.status, 202);
    const eventRetry = await request(deviceA, `/${action.id}/events`, input);
    assert.equal(eventRetry.body.id, event.body.id);
    assert.equal(eventRetry.body.duplicate, true);
    assert.equal(repo.listA2AEvents(action.id).length, 1);
    assert.equal((await request(deviceA, `/${action.id}/result`, { receiptOnly: true, result: { output: 'isolated recovered result' } })).status, 200);
  } finally {
    if (locker.isTransaction) locker.exec('ROLLBACK');
    locker.close();
  }
});

for (const bytes of [1024, 10 * 1024 * 1024]) {
  test(`authenticated compact ACK/result receipts omit ${bytes} byte image payloads and preserve SHA/storage`, async t => {
    const { repo, deviceA, deviceB, request } = await httpFixture(t);
    const employee = repo.createEmployee('test-111', { name: 'Compact receipt fixture', runtime: 'Codex', targetDeviceId: deviceA.deviceId });
    const conversation = repo.createConversation('test-111', { employeeId: employee.id });
    const png = sizedPng(bytes), content = png.toString('base64');
    const image = { name: 'receipt.png', mimeType: 'image/png', contentEncoding: 'base64', content };
    const sent = repo.addConversationMessage(conversation.id, { content: 'Fixture input retained', attachments: [image] });
    const ack = await request(deviceA, `/${sent.execution.id}/ack`, { receiptOnly: true });
    assert.equal(ack.status, 200);
    assert.equal(ack.body.id, sent.execution.id);
    assert.equal(ack.body.status, 'acked');
    assert.equal(ack.body.deviceId, deviceA.deviceId);
    assert.ok(Date.parse(ack.body.expires_at) >= Date.parse(ack.body.acked_at) + 16 * 60 * 1000);
    assert.equal(Object.hasOwn(ack.body, 'payload'), false);
    assert.equal(Object.hasOwn(ack.body, 'result'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(ack.body)) < 2048);
    const result = { output: 'Fixture full output'.repeat(1000), diagnostics: 'Fixture full diagnostics'.repeat(1000), outputArtifacts: [image] };
    const receipt = await request(deviceA, `/${sent.execution.id}/result`, { receiptOnly: true, result });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.id, sent.execution.id);
    assert.equal(receipt.body.status, 'succeeded');
    assert.equal(receipt.body.result.outputLength, result.output.length);
    assert.deepEqual(receipt.body.result.outputArtifacts, [{ name: 'receipt.png', mimeType: 'image/png', size: bytes, sha256: crypto.createHash('sha256').update(png).digest('hex') }]);
    const json = JSON.stringify(receipt.body);
    assert.ok(Buffer.byteLength(json) < 2048);
    assert.equal(json.includes(content), false);
    assert.equal(json.includes(result.output), false);
    assert.equal(json.includes(result.diagnostics), false);
    assert.equal(Object.hasOwn(receipt.body, 'payload'), false);
    const retry = await request(deviceA, `/${sent.execution.id}/result`, { receiptOnly: true, result: { output: 'must not replace original' } });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    assert.deepEqual(retry.body.result, receipt.body.result);
    const ackAgain = await request(deviceA, `/${sent.execution.id}/ack`, { receiptOnly: true });
    assert.equal(ackAgain.status, 200);
    assert.equal(ackAgain.body.duplicate, true);
    assert.equal(Object.hasOwn(ackAgain.body, 'payload'), false);
    for (const endpoint of ['ack', 'result']) {
      const rejected = await request(deviceB, `/${sent.execution.id}/${endpoint}`, { receiptOnly: true, result });
      assert.ok(rejected.status >= 400);
      assert.match(rejected.body.error, /another device/);
      const wrongWorkspace = await request(deviceA, `/${sent.execution.id}/${endpoint}`, { receiptOnly: true, workspace: 'bjc-ops', result });
      assert.ok([401, 403].includes(wrongWorkspace.status));
    }
    const stored = repo.getA2AAction(sent.execution.id);
    assert.equal(stored.payload.attachments[0].content, content);
    assert.equal(stored.result.outputArtifacts[0].content, content);
    assert.equal(stored.result.output, result.output);
    assert.equal(stored.result.diagnostics, result.diagnostics);
    const history = repo.getConversation(conversation.id);
    assert.equal(history.messages.filter(message => message.role === 'assistant').length, 1);
    assert.equal(history.messages[0].attachments[0].content, content);
    assert.equal(history.messages[1].attachments[0].content, content);
    const complete = await request(deviceA, `/${sent.execution.id}/result`, { result: {} });
    assert.equal(complete.body.result.outputArtifacts[0].content, content);
    assert.equal(complete.body.result.output, result.output);
    t.diagnostic(JSON.stringify({ fixtureImageBytes: bytes, ackReceiptBytes: Buffer.byteLength(JSON.stringify(ack.body)), resultReceiptBytes: Buffer.byteLength(json), sha256: receipt.body.result.outputArtifacts[0].sha256 }));
  });
}
