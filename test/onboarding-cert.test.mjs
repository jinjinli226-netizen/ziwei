import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../backend/app.mjs';

const certificate = Buffer.from('-----BEGIN CERTIFICATE-----\nlocal-onboarding-test\n-----END CERTIFICATE-----\n', 'ascii');

test('server certificate download exposes only the configured public certificate', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ziwei-onboarding-'));
  const certificatePath = path.join(directory, 'server.crt');
  await fs.writeFile(certificatePath, certificate);
  const app = createApp({ memory: true, tlsCertFile: certificatePath });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/server.crt`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/x-x509-ca-cert');
    assert.match(response.headers.get('content-disposition') || '', /ziwei-server\.crt/);
    assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), certificate), 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('server certificate download fails clearly when no certificate is configured', async () => {
  const app = createApp({ memory: true, tlsCertFile: path.join(os.tmpdir(), 'ziwei-cert-does-not-exist.crt') });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/server.crt`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: '服务器证书未配置' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('server certificate download rejects non-certificate files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ziwei-onboarding-'));
  const certificatePath = path.join(directory, 'not-a-cert');
  await fs.writeFile(certificatePath, 'private material is not served');
  const app = createApp({ memory: true, tlsCertFile: certificatePath });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/server.crt`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: '服务器证书格式无效' });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('server certificate download never serves a private key bundle', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ziwei-onboarding-'));
  const certificatePath = path.join(directory, 'private-bundle.pem');
  await fs.writeFile(certificatePath, '-----BEGIN CERTIFICATE-----\npublic\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n');
  const app = createApp({ memory: true, tlsCertFile: certificatePath });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/server.crt`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: '服务器证书格式无效' });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
