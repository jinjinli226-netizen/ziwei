import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';
import { createZiweiConnect } from '../backend/ziwei-connect.mjs';

for (const status of [403, 503]) test(`accepted command retains original receipt-read error (${status}) without resubmission`, async t => {
  const repo = createRepository({ memory: true });
  t.after(() => repo.db.close());
  const employee = repo.createEmployee('test-111', { name: 'Receipt read fixture' });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let submitted = 0;
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (path.endsWith('/android-devices')) return reply({ devices: [{ id: 'phone-fixture', alias: 'fixture', nodes: [] }] });
    if (path.endsWith('/commands')) { submitted++; return reply({ command: { id: 'command-original', status: 'queued' } }, 201); }
    if (path.endsWith('/status')) return reply({ message: '原回执读取被拒绝，请核对原命令' }, status);
    throw new Error('unexpected path ' + path);
  };
  const connect = createZiweiConnect(repo, { apiBase: 'https://phone.invalid/api', cookie: 'fixture_session=only-test' });
  await connect.bind('test-111', { employeeId: employee.id, deviceId: 'phone-fixture' });
  const result = await connect.toolCall('test-111', { employeeId: employee.id, phoneDeviceId: 'phone-fixture', actionId: 'action-fixture' }, 'ziwei_phone_action', { action: 'text', args: { text: '刘娜娜688' } });
  assert.equal(result.command.id, 'command-original');
  assert.equal(result.command.status, 'uncertain');
  assert.match(result.command.error, /原回执读取被拒绝/);
  assert.equal(result.command.result.executionState, 'uncertain');
  assert.equal(result.command.result.errorCode, 'RECEIPT_READ_FAILED');
  assert.match(result.verificationError, /不重复提交/);
  assert.deepEqual(result.recovery, { attempts: 2, nextAction: 'observe', retryAllowed: false });
  assert.equal(submitted, 1);
});

for (const status of [403, 503]) test(`accepted command automatically recovers its original receipt after HTTP ${status}`, async t => {
  const repo = createRepository({ memory: true }); t.after(() => repo.db.close());
  const employee = repo.createEmployee('test-111', { name: 'Automatic observation fixture' });
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  let submissions = 0, reads = 0;
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    const reply = (body, code = 200) => new Response(JSON.stringify(body), { status: code });
    if (path.endsWith('/android-devices')) return reply({ devices: [{ id: 'phone-fixture', alias: 'fixture', nodes: [] }] });
    if (path.endsWith('/commands')) { submissions++; return reply({ command: { id: 'command-original', status: 'queued' } }, 201); }
    if (path.endsWith('/status')) {
      reads++;
      if (reads === 1) return reply({ message: '临时状态读取失败' }, status);
      assert.equal(new URL(url).searchParams.get('commandId'), 'command-original');
      return reply({ device: { id: 'phone-fixture', commands: [{ id: 'command-original', status: 'succeeded', result: { performed: true, textVerified: true } }] } });
    }
    throw new Error('unexpected path ' + path);
  };
  const connect = createZiweiConnect(repo, { apiBase: 'https://phone.invalid/api', cookie: 'fixture_session=only-test' });
  await connect.bind('test-111', { employeeId: employee.id, deviceId: 'phone-fixture' });
  const result = await connect.toolCall('test-111', { employeeId: employee.id, phoneDeviceId: 'phone-fixture', actionId: 'action-fixture' }, 'ziwei_phone_action', { action: 'text', args: { text: '刘娜娜688' } });
  assert.equal(result.command.status, 'succeeded'); assert.equal(result.command.result.textVerified, true);
  assert.equal(submissions, 1); assert.equal(reads, 2); assert.equal(result.verificationError, undefined);
  assert.equal(repo.db.prepare('SELECT status FROM ziwei_connect_runs WHERE id=?').get(result.runId).status, 'succeeded');
});

test('automatic receipt recovery preserves screenshot success when only image delivery fails', async t => {
  const repo = createRepository({ memory: true }); t.after(() => repo.db.close());
  const employee = repo.createEmployee('test-111', { name: 'Snapshot delivery fixture' });
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  let submissions = 0;
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    const reply = (body, code = 200) => new Response(JSON.stringify(body), { status: code });
    if (path.endsWith('/android-devices')) return reply({ devices: [{ id: 'phone-fixture', alias: 'fixture', nodes: [] }] });
    if (path.endsWith('/commands')) { submissions++; return reply({ command: { id: 'command-original', status: 'queued' } }, 201); }
    if (path.endsWith('/status')) return reply({ device: { id: 'phone-fixture', commands: [{ id: 'command-original', action: 'screenshot', status: 'succeeded' }] } });
    if (path.endsWith('/snapshot')) return reply({ message: '图片下载暂失败' }, 503);
    throw new Error('unexpected path ' + path);
  };
  const connect = createZiweiConnect(repo, { apiBase: 'https://phone.invalid/api', cookie: 'fixture_session=only-test' });
  await connect.bind('test-111', { employeeId: employee.id, deviceId: 'phone-fixture' });
  const result = await connect.toolCall('test-111', { employeeId: employee.id, phoneDeviceId: 'phone-fixture', actionId: 'action-fixture' }, 'ziwei_phone_screenshot', { waitSeconds: 0 });
  assert.equal(result.command.status, 'succeeded'); assert.equal(result.nextAction, 'observe');
  assert.match(result.verificationError, /图片读取暂失败/); assert.equal(submissions, 1);
  assert.equal(repo.db.prepare('SELECT status FROM ziwei_connect_runs WHERE id=?').get(result.runId).status, 'succeeded');
});
