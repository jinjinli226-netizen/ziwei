import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';
import { normalizeConversationAttachments } from '../backend/conversation-attachments.mjs';

const pngContent = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6gAAAABJRU5ErkJggg==';
const image = (extra = {}) => ({ name: 'image.png', mimeType: 'image/png', contentEncoding: 'base64', content: pngContent, ...extra });

function fixture(t) {
  const repo = createRepository({ memory: true });
  t.after(() => repo.db.close());
  const employee = repo.createEmployee('test-111', { name: 'Image fixture', runtime: 'Codex' });
  const conversation = repo.createConversation('test-111', { employeeId: employee.id });
  return { repo, employee, conversation };
}

test('image-only messages dispatch an image analysis prompt without inventing saved user text or tasks', t => {
  const { repo, conversation } = fixture(t);
  const taskCount = repo.db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE workspace_id=?').get(conversation.workspace_id).count;
  const submitted = repo.addConversationMessage(conversation.id, { attachments: [image()], clientMessageId: 'image-only-1', actorUserId: 'fixture-user' });
  assert.equal(submitted.content, '');
  assert.equal(submitted.attachments[0].size, Buffer.from(pngContent, 'base64').length);
  assert.match(submitted.execution.payload.prompt, /图片/);
  assert.deepEqual(submitted.execution.payload.attachments[0], { name: 'image.png', mimeType: 'image/png', size: Buffer.from(pngContent, 'base64').length });
  const pending = repo.listA2AActions('test-111').find(action => action.id === submitted.execution.id);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(pending.payload.attachments[0].content, 'base64')).digest('hex'), crypto.createHash('sha256').update(Buffer.from(pngContent, 'base64')).digest('hex'));
  assert.equal(repo.getConversation(conversation.id).messages.length, 1);
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE workspace_id=?').get(conversation.workspace_id).count, taskCount);
});

test('conversation request validation rolls back messages, audit and action on invalid dispatch', t => {
  const { repo, conversation } = fixture(t);
  const before = repo.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;
  assert.throws(() => repo.addConversationMessage(conversation.id, { content: 'bad profile', profile: 'not valid' }), /profile/);
  assert.equal(repo.getConversation(conversation.id).messages.length, 0);
  assert.equal(repo.listA2AActions('test-111', { status: 'all' }).length, 0);
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, before);
});

test('bad image bytes, metadata-only images and aggregate oversize fail before saving a message', t => {
  const { repo, conversation } = fixture(t);
  for (const attachment of [image({ content: Buffer.from('<html>not an image</html>').toString('base64') }), image({ mimeType: 'image/jpeg' }), image({ content: undefined }), image({ content: 'invalid base64' })]) {
    assert.throws(() => repo.addConversationMessage(conversation.id, { content: 'must fail', attachments: [attachment] }), /图片|base64/);
  }
  const large = Buffer.alloc(6 * 1024 * 1024).toString('base64');
  assert.throws(() => repo.addConversationMessage(conversation.id, { content: 'too large', attachments: [{ name: 'a.bin', content: large }, { name: 'b.bin', content: large }] }), /10 MiB/);
  assert.equal(repo.getConversation(conversation.id).messages.length, 0);
});

test('image normalization keeps legacy file input, rejects silent truncation and never returns metadata as an output image', () => {
  const text = normalizeConversationAttachments([{ name: 'brief.txt', content: 'read me', contentEncoding: 'utf8', mimeType: 'text/plain' }]);
  assert.equal(Buffer.from(text[0].content, 'base64').toString(), 'read me');
  assert.deepEqual(normalizeConversationAttachments([{ name: 'old.txt', size: 2 }]), [{ name: 'old.txt', size: 2 }]);
  assert.throws(() => normalizeConversationAttachments([{ name: 'path-only.png', path: 'C:/private/image.png' }], { imagesOnly: true }), /实际图片/);
  assert.throws(() => normalizeConversationAttachments(Array.from({ length: 21 }, () => image())), /20/);
  const detected = normalizeConversationAttachments([image({ name: 'C:\\private\\image.png', mimeType: 'application/octet-stream' })]);
  assert.equal(detected[0].name, 'image.png'); assert.equal(detected[0].mimeType, 'image/png');
});

test('client message retries are scoped by conversation and actor, and changed bodies conflict', t => {
  const { repo, conversation } = fixture(t);
  const input = { content: 'image and text', attachments: [image()], clientMessageId: 'repeat-1', actorUserId: 'user-a' };
  const first = repo.addConversationMessage(conversation.id, input);
  const retry = repo.addConversationMessage(conversation.id, input);
  assert.equal(retry.id, first.id); assert.equal(retry.duplicate, true);
  assert.equal(repo.getConversation(conversation.id).messages.length, 1);
  assert.equal(repo.listA2AActions('test-111', { status: 'all' }).length, 1);
  assert.throws(() => repo.addConversationMessage(conversation.id, { ...input, content: 'changed' }), error => error.status === 409);
  const other = repo.addConversationMessage(conversation.id, { ...input, actorUserId: 'user-b' });
  assert.notEqual(other.id, first.id);
  const secondConversation = repo.createConversation('test-111', { employeeId: conversation.employee_id });
  assert.notEqual(repo.addConversationMessage(secondConversation.id, input).id, first.id);
});

test('employee outputArtifacts persist on the action conversation and input attachments are never echoed', t => {
  const { repo, conversation } = fixture(t);
  const foreign = repo.createConversation('test-111', { employeeId: conversation.employee_id });
  const sent = repo.addConversationMessage(conversation.id, { content: 'Return a picture', attachments: [image()] });
  const completed = repo.resultA2AAction(sent.execution.id, { status: 'succeeded', result: { output: 'My image', attachments: [{ path: 'C:/private/input.png' }], conversationId: foreign.id, outputArtifacts: [image({ name: 'returned.png' })] } });
  assert.equal(completed.status, 'succeeded');
  const saved = repo.getConversation(conversation.id).messages.at(-1);
  assert.equal(saved.role, 'assistant'); assert.equal(saved.attachments[0].name, 'returned.png'); assert.equal(saved.attachments[0].content, pngContent);
  assert.equal(repo.getConversation(foreign.id).messages.length, 0);
  assert.equal(repo.resultA2AAction(sent.execution.id, { status: 'succeeded', result: { outputArtifacts: [image()] } }).duplicate, true);
  assert.equal(repo.getConversation(conversation.id).messages.length, 2);
  const next = repo.addConversationMessage(conversation.id, { content: 'Return only text', attachments: [image()] });
  repo.resultA2AAction(next.execution.id, { result: { output: 'Text', attachments: [{ path: 'C:/private/input.png' }] } });
  assert.deepEqual(repo.getConversation(conversation.id).messages.at(-1).attachments, []);
});

test('invalid employee output is a visible failed execution and a terminal retry cannot duplicate the reply', t => {
  const { repo, conversation } = fixture(t);
  const sent = repo.addConversationMessage(conversation.id, { content: 'Return a picture' });
  const completed = repo.resultA2AAction(sent.execution.id, { status: 'succeeded', result: { output: 'claimed success', outputArtifacts: [image({ content: Buffer.from('not png').toString('base64') })] } });
  assert.equal(completed.status, 'failed'); assert.match(completed.error, /图片/);
  const current = repo.getConversation(conversation.id);
  assert.equal(current.execution.status, 'failed'); assert.match(current.messages.at(-1).content, /图片/); assert.deepEqual(current.messages.at(-1).attachments, []);
  assert.equal(repo.resultA2AAction(sent.execution.id, { result: { outputArtifacts: [image()] } }).duplicate, true);
  assert.equal(repo.getConversation(conversation.id).messages.length, 2);
});

test('an explicit execution error cannot be reported as succeeded by a contradictory client status', t => {
  const { repo, conversation } = fixture(t);
  const sent = repo.addConversationMessage(conversation.id, { content: 'Return a picture' });
  const completed = repo.resultA2AAction(sent.execution.id, { status: 'succeeded', error: 'isolated image transfer failure', result: { outputArtifacts: [image()] } });
  assert.equal(completed.status, 'failed');
  assert.match(repo.getConversation(conversation.id).messages.at(-1).content, /isolated image transfer failure/);
  assert.deepEqual(repo.getConversation(conversation.id).messages.at(-1).attachments, []);
});

test('a failed assistant write rolls back the terminal result so delivery can be retried without loss', t => {
  const { repo, conversation } = fixture(t);
  const sent = repo.addConversationMessage(conversation.id, { content: 'Return a picture' });
  const beforeAudit = repo.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;
  repo.db.exec("CREATE TRIGGER image_reply_failure BEFORE INSERT ON conversation_messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT, 'isolated reply write failure'); END");
  assert.throws(() => repo.resultA2AAction(sent.execution.id, { result: { outputArtifacts: [image()] } }), /isolated reply write failure/);
  assert.equal(repo.getA2AAction(sent.execution.id).status, 'pending');
  assert.equal(repo.getConversation(conversation.id).messages.length, 1);
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, beforeAudit);
  repo.db.exec('DROP TRIGGER image_reply_failure');
  assert.equal(repo.resultA2AAction(sent.execution.id, { result: { outputArtifacts: [image()] } }).status, 'succeeded');
  assert.equal(repo.getConversation(conversation.id).messages.length, 2);
});

test('task execution outputArtifacts use the linked persistent conversation once', t => {
  const { repo, conversation } = fixture(t);
  const task = repo.createTask('test-111', { title: 'Image output fixture', employeeId: conversation.employee_id, conversationId: conversation.id, execute: true });
  const action = repo.listA2AActions('test-111', { status: 'all' }).find(item => item.task_id === task.id);
  repo.resultA2AAction(action.id, { result: { result: { output: 'nested CLI result', outputArtifacts: [image()] } } });
  assert.equal(repo.getConversation(conversation.id).messages.length, 1);
  assert.equal(repo.getConversation(conversation.id).messages[0].attachments[0].content, pngContent);
});

test('a forged cross-workspace or wrong employee action cannot deposit images in another conversation', t => {
  const { repo, conversation } = fixture(t);
  repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,plan,timezone,created_at) VALUES(?,?,?,?,?,?,?)').run('image-other-workspace', 'image-other', 'Other images', 'team', 'free', 'Asia/Shanghai', new Date().toISOString());
  const wrongWorkspace = repo.createA2AAction('image-other', { type: 'conversation.execute', payload: { conversationId: conversation.id } });
  assert.throws(() => repo.resultA2AAction(wrongWorkspace.id, { result: { outputArtifacts: [image()] } }), /会话|工作区/);
  assert.equal(repo.getA2AAction(wrongWorkspace.id).status, 'pending');
  const otherEmployee = repo.createEmployee('test-111', { name: 'Other image fixture', runtime: 'Codex' });
  const wrongEmployee = repo.createA2AAction('test-111', { type: 'conversation.execute', payload: { employeeId: otherEmployee.id, conversationId: conversation.id } });
  assert.throws(() => repo.resultA2AAction(wrongEmployee.id, { result: { outputArtifacts: [image()] } }), /员工|会话/);
  assert.equal(repo.getConversation(conversation.id).messages.length, 0);
});

test('real authentication protects image send, image history and result device assignment', async t => {
  const app = createApp({ memory: true, requireAuth: true, requireDeviceAuth: true, enableScheduler: false });
  const repo = app.locals.repo;
  const owner = app.locals.auth.setup({ name: 'Image owner', email: 'images-owner@example.test', password: 'fixture-password' });
  const ws = app.locals.auth.createWorkspace(owner.user_id, { name: 'Image workspace', slug: 'image-workspace', kind: 'team' }).workspace;
  const pairing = repo.createDevicePairing(ws.slug, { ownerUserId: owner.user_id, createdBy: owner.user_id, name: 'Image PC', os: 'Windows' });
  const device = repo.claimDevicePairing({ code: pairing.code });
  const second = repo.claimDevicePairing({ code: repo.createDevicePairing(ws.slug, { createdBy: owner.user_id, name: 'Second PC', os: 'Windows' }).code });
  const employee = repo.createEmployee(ws.slug, { name: 'Private images', visibility: 'personal', ownerUserId: owner.user_id, runtime: 'Codex', targetDeviceId: device.deviceId });
  const conversation = repo.createConversation(ws.slug, { employeeId: employee.id });
  const member = app.locals.auth.register({ name: 'Image member', email: 'images-member@example.test', password: 'fixture-password' });
  repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('images-fixture-member', ws.id, member.user_id, member.user.name, member.user.email, 'member', new Date().toISOString());
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(() => { repo.db.close(); resolve(); })));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = headers => fetch(`${base}/api/conversations/${conversation.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ attachments: [image()], clientMessageId: 'authenticated-image-1' }) });
  assert.equal(app.locals.authBypass, false);
  assert.equal((await send({})).status, 401);
  assert.equal((await send({ cookie: `ziwei_session=${member.session.token}` })).status, 400);
  const response = await send({ cookie: `ziwei_session=${owner.session.token}` }); assert.equal(response.status, 201);
  const sent = await response.json();
  const retries = await Promise.all(Array.from({ length: 5 }, () => send({ cookie: `ziwei_session=${owner.session.token}` })));
  assert.deepEqual(retries.map(row => row.status), [200, 200, 200, 200, 200]);
  for (const retry of retries) assert.equal((await retry.json()).id, sent.id);
  assert.equal(repo.getConversation(conversation.id).messages.length, 1);
  const result = token => fetch(`${base}/a2a/v1/actions/${sent.execution.id}/result`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ziwei-device-token': token }, body: JSON.stringify({ result: { outputArtifacts: [image()] } }) });
  assert.equal((await result(second.deviceToken)).status, 400);
  assert.equal(repo.getA2AAction(sent.execution.id).status, 'pending');
  assert.equal((await result(device.deviceToken)).status, 200);
  assert.equal((await fetch(`${base}/api/conversations/${conversation.id}`)).status, 401);
  assert.equal((await fetch(`${base}/api/conversations/${conversation.id}`, { headers: { cookie: `ziwei_session=${member.session.token}` } })).status, 404);
  const history = await fetch(`${base}/api/conversations/${conversation.id}`, { headers: { cookie: `ziwei_session=${owner.session.token}` } }).then(row => row.json());
  assert.equal(history.messages.at(-1).attachments[0].content, pngContent);
});
