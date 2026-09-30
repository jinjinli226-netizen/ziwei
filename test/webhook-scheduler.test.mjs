import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createRepository } from '../backend/repository.mjs';

test('cron schedules persist next_run and reject malformed expressions', () => {
  const repo = createRepository({ memory: true });
  const everyFive = repo.createAutomation('test-111', { name: 'cron', schedule: '*/5 * * * *' });
  assert.ok(everyFive.next_run);
  assert.equal(new Date(everyFive.next_run).getUTCSeconds(), 0);
  assert.throws(() => repo.createAutomation('test-111', { name: 'bad', schedule: '60 * * * *' }), /Cron|计划/);
});

test('automation completion signs and durably delivers a webhook once', async () => {
  const secret = 'test-webhook-secret'; let received;
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
      const body = Buffer.concat(chunks).toString(); received = { body, headers: req.headers };
      res.writeHead(202); res.end('accepted');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const repo = createRepository({ memory: true });
    const automation = repo.createAutomation('test-111', { name: 'push', schedule: '手动', webhookUrl: `http://127.0.0.1:${server.address().port}/hook`, webhookSecret: secret });
    assert.equal(automation.webhook_secret, secret);
    const run = repo.runAutomation(automation.id);
    repo.ackA2AAction(run.action_id);
    repo.resultA2AAction(run.action_id, { status: 'succeeded', result: { ok: true } });
    for (let i = 0; i < 20 && !received; i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(received);
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(received.body).digest('hex')}`;
    assert.equal(received.headers['x-ziwei-signature'], expected);
    assert.equal(JSON.parse(received.body).run_id, run.id);
    assert.equal(repo.listWebhookDeliveries(run.id)[0].status, 'delivered');
    repo.resultA2AAction(run.action_id, { status: 'succeeded', result: { duplicate: true } });
    assert.equal(repo.listWebhookDeliveries(run.id).length, 1);
  } finally { server.close(); }
});
