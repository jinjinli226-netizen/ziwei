import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeIdentity } from '../web/native-identity.js';

const signedIn = { available: true, mode: 'oidc', configured: true, authenticated: true };
const tick = () => new Promise(resolve => setImmediate(resolve));
const chunkPath = '/api/conversations/conv_1/attachments/uploads/upload_1?offset=0';
const downloadPath = '/api/conversations/conv_1/attachments/att_1';
function fixture(t, options = {}) {
  const calls = [], binary = [], downloads = [], cancelled = [], events = new EventTarget();
  const bridge = { getStatus: () => JSON.stringify(signedIn), login: () => JSON.stringify(signedIn), logout: () => '{}',
    request: (...args) => calls.push(args), requestBinary: (...args) => binary.push(args), downloadAttachment: (...args) => downloads.push(args), cancel: id => cancelled.push(id) };
  const identity = createNativeIdentity({ bridge, events, ...options }); t.after(() => identity.dispose());
  const emit = (name, detail) => { const event = new Event(name); Object.defineProperty(event, 'detail', { value: detail }); events.dispatchEvent(event); };
  const respond = (call, result) => emit('ziwei:identity-response', { id: call[0], status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) });
  return { identity, bridge, calls, binary, downloads, cancelled, emit, respond };
}

test('the native adapter transports one exact binary chunk as bounded base64 and receives only JSON', async t => {
  const f = fixture(t), bytes = new Uint8Array(8 * 1024 * 1024); bytes[0] = 31; bytes[bytes.length - 1] = 255;
  const request = f.identity.fetch(chunkPath, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([bytes]) });
  for (let i = 0; !f.binary.length && i < 100; i++) await tick();
  assert.equal(f.calls.length, 0); assert.equal(f.binary.length, 1); assert.equal(f.binary[0][1], chunkPath);
  assert.deepEqual(Buffer.from(f.binary[0][3], 'base64'), Buffer.from(bytes));
  f.respond(f.binary[0], { offset: bytes.length }); assert.deepEqual(await (await request).json(), { offset: bytes.length });
});

test('oversized or unrelated binary requests and misplaced idempotency headers never reach the bridge', async t => {
  const f = fixture(t);
  for (const [path, size, method] of [[chunkPath, 8 * 1024 * 1024 + 1, 'PUT'], [chunkPath, 1, 'POST'], [downloadPath, 1, 'PUT']])
    await assert.rejects(f.identity.fetch(path, { method, headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([new Uint8Array(size)]) }), error => error.code === 'NATIVE_BINARY_INVALID');
  for (const path of ['/api/auth/me', '/api/conversations/conv_1/messages']) await assert.rejects(f.identity.fetch(path, { method: 'POST', headers: { 'Idempotency-Key': 'request-one' }, body: '{}' }), error => error.code === 'NATIVE_HEADERS_INVALID');
  assert.equal(f.calls.length, 0); assert.equal(f.binary.length, 0);
});

test('upload creation alone allows the stable idempotency key and lost chunks never replay', async t => {
  const f = fixture(t, { mutationTimeoutMs: 25 });
  const create = f.identity.fetch('/api/conversations/conv_1/attachments/uploads', { method: 'POST', headers: { 'Idempotency-Key': 'original:request-one' }, body: '{"size":524288000}' });
  await tick(); assert.equal(JSON.parse(f.calls[0][3])['idempotency-key'], 'original:request-one'); f.respond(f.calls[0], { uploadId: 'upload_1' }); await create;
  await assert.rejects(f.identity.fetch(chunkPath, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob(['chunk']) }), error => error.code === 'NATIVE_REQUEST_TIMEOUT' && error.uncertain === true);
  assert.equal(f.binary.length, 1);
});

test('attachment saving opens only an explicit native picker and never returns file bytes to JavaScript', async t => {
  const f = fixture(t), save = f.identity.downloadAttachment(downloadPath, 'report.pdf', 'application/pdf');
  await tick(); assert.deepEqual(f.downloads[0].slice(1), [downloadPath, 'report.pdf', 'application/pdf']);
  assert.equal(f.calls.length, 0); assert.equal(f.binary.length, 0);
  f.respond(f.downloads[0], { saved: true, cancelled: false, bytes: 500 * 1024 * 1024 });
  assert.deepEqual(await save, { saved: true, cancelled: false, bytes: 500 * 1024 * 1024 });
  for (const path of ['https://ziwei.qzelynth.top' + downloadPath, downloadPath + '?token=x', '/api/conversations/conv_1/attachments/uploads'])
    await assert.rejects(f.identity.downloadAttachment(path, 'report.pdf', 'application/pdf'), error => error.code === 'NATIVE_DOWNLOAD_INVALID');
  assert.equal(f.downloads.length, 1);
});

test('download cancellation and account changes discard old save responses without replay', async t => {
  const f = fixture(t), signal = new AbortController();
  const save = f.identity.downloadAttachment(downloadPath, 'report.pdf', 'application/pdf', { signal: signal.signal }); const rejected = assert.rejects(save, error => error.code === 'READ_CANCELLED');
  await tick(); signal.abort(); await rejected; assert.deepEqual(f.cancelled, [f.downloads[0][0]]);
  f.respond(f.downloads[0], { saved: true, cancelled: false, bytes: 1 });
  const next = f.identity.downloadAttachment(downloadPath, 'report.pdf', 'application/pdf'); const changed = assert.rejects(next, error => error.code === 'AUTH_CHANGED');
  await tick(); f.emit('ziwei:identity', { ...signedIn, authenticated: false }); await changed; assert.equal(f.downloads.length, 2);
});

test('actual Java binary policy streams 500MiB with bounded memory and enforces path, size and account fences', async t => {
  const { spawnSync } = await import('node:child_process'), fs = await import('node:fs/promises'), path = await import('node:path'), os = await import('node:os'), { fileURLToPath } = await import('node:url');
  const javaHome = process.env.ZIWEI_JAVA_HOME || process.env.JAVA_HOME, javac = javaHome ? path.join(javaHome, 'bin', 'javac') : 'javac', java = javaHome ? path.join(javaHome, 'bin', 'java') : 'java';
  const probe = spawnSync(javac, ['-version'], { encoding: 'utf8' }); if (probe.error || probe.status !== 0) { t.skip('Working JDK unavailable; set ZIWEI_JAVA_HOME'); return; }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ziwei-binary-native-'));
  t.after(async () => { const resolved = path.resolve(directory); if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('ziwei-binary-native-')) throw new Error('Unexpected test path'); await fs.rm(resolved, { recursive: true, force: true }); });
  const sources = ['OidcRules', 'IdentityFence', 'AttachmentTransferRules', 'AttachmentTransferLog'].map(name => fileURLToPath(new URL(`../android/src/com/ziwei/manager/${name}.java`, import.meta.url)));
  sources.push(fileURLToPath(new URL('../android/test/com/ziwei/manager/AttachmentTransferRulesTest.java', import.meta.url)));
  let run = spawnSync(javac, ['--release', '8', '-encoding', 'UTF-8', '-d', directory, ...sources], { encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr);
  run = spawnSync(java, ['-Xmx96m', '-ea', '-cp', directory, 'com.ziwei.manager.AttachmentTransferRulesTest', directory], { encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /streamed 524288000 bytes with 65536 byte buffers/); t.diagnostic(run.stdout.trim());
});
