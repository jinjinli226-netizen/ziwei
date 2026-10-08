import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function start() {
  const app = createApp({ repository: createRepository({ memory: true }), requireAuth: true, enableScheduler: false });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}`, repo: app.locals.repo };
}
const post = (base, path, body, cookie = '') => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = response => String(response.headers.get('set-cookie')).split(';')[0];

test('first-run setup creates an account without a default workspace', async () => {
  const { server, base } = await start();
  try {
    const response = await post(base, '/api/auth/setup', { name: '个人所有者', email: 'personal@example.com', password: 'password-123' });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(body.memberships, []);
    assert.equal(body.workspace, null);
    const cookie = cookieOf(response);
    const created = await post(base, '/api/workspaces', { name: '我的工作区', kind: 'personal' }, cookie);
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.notEqual(createdBody.workspace.slug, 'test-111');
    assert.equal(createdBody.workspace.kind, 'personal');
    const invitation = await post(base, `/api/workspaces/${createdBody.workspace.slug}/invitations`, { email: 'personal-invite@example.com' }, cookie);
    assert.equal(invitation.status, 201);
    const invitationBody = await invitation.json();
    assert.equal(invitationBody.workspace, createdBody.workspace.slug);
    assert.equal(invitationBody.status, 'pending');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('blank registrations get unique personal workspace slugs', async () => {
  const { server, base } = await start();
  try {
    const first = await post(base, '/api/auth/register', { name: '同名用户', email: 'same-one@example.com', password: 'password-123' });
    const second = await post(base, '/api/auth/register', { name: '同名用户', email: 'same-two@example.com', password: 'password-456' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstMembership = (await first.json()).memberships[0];
    const secondMembership = (await second.json()).memberships[0];
    assert.notEqual(firstMembership.slug, secondMembership.slug);
    assert.equal(firstMembership.kind, 'personal');
    assert.equal(secondMembership.kind, 'personal');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('first-run setup rejects workspace selection instead of claiming the example workspace', async () => {
  const { server, base } = await start();
  try {
    const response = await post(base, '/api/auth/setup', { name: '初始化用户', email: 'init@example.com', password: 'password-123', workspaceSlug: 'test-111' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /只创建账号，请登录后新建工作区/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('registration can join an existing team only with a valid invitation', async () => {
  const { server, base, repo } = await start();
  try {
    const owner = await post(base, '/api/auth/setup', { name: '团队所有者', email: 'team-owner@example.com', password: 'password-123' });
    assert.equal(owner.status, 201);
    const ownerCookie = cookieOf(owner);
    const createdWorkspace = await post(base, '/api/workspaces', { name: '团队 Alpha', slug: 'team-alpha', kind: 'team' }, ownerCookie);
    assert.equal(createdWorkspace.status, 201);
    const rejected = await post(base, '/api/auth/register', { name: '无邀请', email: 'no-invite@example.com', password: 'password-456', workspaceSlug: 'team-alpha' });
    assert.equal(rejected.status, 400);
    const invitation = await post(base, '/api/workspaces/team-alpha/invitations', { email: 'invited@example.com' }, ownerCookie);
    assert.equal(invitation.status, 201);
    const invitationBody = await invitation.json();
    const joined = await post(base, '/api/auth/register', { name: '受邀成员', email: 'invited@example.com', password: 'password-456', workspaceSlug: 'team-alpha', invitationCode: invitationBody.code });
    assert.equal(joined.status, 201);
    const joinedBody = await joined.json();
    assert.equal(joinedBody.memberships[0].slug, 'team-alpha');
    assert.equal(joinedBody.memberships[0].role, 'member');
    assert.equal(repo.getWorkspace('team-alpha').kind, 'team');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('link-only invitations bind to the registering email while email-bound invites stay scoped', async () => {
  const { server, base } = await start();
  try {
    const owner = await post(base, '/api/auth/setup', { name: '链接邀请所有者', email: 'link-owner@example.com', password: 'password-123' });
    const ownerCookie = cookieOf(owner);
    const workspace = await post(base, '/api/workspaces', { name: '链接邀请团队', slug: 'link-invite-team', kind: 'team' }, ownerCookie);
    assert.equal(workspace.status, 201);

    const linkInvite = await post(base, '/api/workspaces/link-invite-team/invitations', {}, ownerCookie);
    assert.equal(linkInvite.status, 201);
    const linkBody = await linkInvite.json();
    const linkRegistration = await post(base, '/api/auth/register', { name: '链接成员', email: 'link-member@example.com', password: 'password-456', workspaceSlug: 'link-invite-team', invitationCode: linkBody.code });
    assert.equal(linkRegistration.status, 201);

    const boundInvite = await post(base, '/api/workspaces/link-invite-team/invitations', { email: 'bound-member@example.com' }, ownerCookie);
    assert.equal(boundInvite.status, 201);
    const boundBody = await boundInvite.json();
    const mismatched = await post(base, '/api/auth/register', { name: '错误邮箱', email: 'other-member@example.com', password: 'password-789', workspaceSlug: 'link-invite-team', invitationCode: boundBody.code });
    assert.equal(mismatched.status, 400);
    assert.match((await mismatched.json()).error, /有效邀请/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('personal workspace invitations remain unable to create a second workspace member through registration', async () => {
  const { server, base } = await start();
  try {
    const owner = await post(base, '/api/auth/setup', { name: '个人所有者', email: 'personal-owner@example.com', password: 'password-123' });
    const ownerCookie = cookieOf(owner);
    const workspace = await post(base, '/api/workspaces', { name: '个人邀请工作区', slug: 'personal-invite-workspace', kind: 'personal' }, ownerCookie);
    assert.equal(workspace.status, 201);
    const invitation = await post(base, '/api/workspaces/personal-invite-workspace/invitations', { email: 'personal-member@example.com' }, ownerCookie);
    assert.equal(invitation.status, 201);
    const body = await invitation.json();
    const registration = await post(base, '/api/auth/register', { name: '个人成员', email: 'personal-member@example.com', password: 'password-456', workspaceSlug: 'personal-invite-workspace', invitationCode: body.code });
    assert.equal(registration.status, 400);
    assert.match((await registration.json()).error, /个人工作区不能直接加入/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('paired devices keep the creating account owner and are isolated in personal workspaces', () => {
  const repo = createRepository({ memory: true });
  const userA = 'user_a'; const userB = 'user_b';
  repo.db.prepare("UPDATE members SET user_id=? WHERE id='member-owner'").run(userA);
  const pairing = repo.createDevicePairing('test-111', { name: 'A computer', createdBy: userA });
  const claimed = repo.claimDevicePairing({ code: pairing.code });
  const row = repo.db.prepare('SELECT owner_user_id FROM devices WHERE id=?').get(claimed.deviceId);
  assert.equal(row.owner_user_id, userA);
  const secondPairing = repo.createDevicePairing('test-111', { name: 'B computer', createdBy: userB });
  assert.equal(repo.claimDevicePairing({ code: secondPairing.code }).deviceId.startsWith('device_'), true);
  assert.equal(repo.listDevices('test-111', { userId: userA }).length, 3); // team workspaces expose all member devices
});

test('personal workspace device reads and management stay owner scoped', () => {
  const repo = createRepository({ memory: true });
  repo.db.prepare("UPDATE workspaces SET kind='personal' WHERE slug='test-111'").run();
  repo.db.prepare("UPDATE members SET user_id='user_a' WHERE id='member-owner'").run();
  const owned = repo.createDevice('test-111', { name: '我的电脑', ownerUserId: 'user_a' });
  const other = repo.createDevice('test-111', { name: '其他电脑', ownerUserId: 'user_b' });
  const visible = repo.listDevices('test-111', { userId: 'user_a' });
  assert.equal(visible.some(device => device.id === owned.id), true);
  assert.equal(visible.some(device => device.id === other.id), false);
  assert.equal(repo.canManageDevice(owned.id, 'user_a', 'member'), true);
  assert.equal(repo.canManageDevice(other.id, 'user_a', 'member'), false);
  assert.equal(repo.canManageDevice('device-ziwei-user', 'user_a', 'member'), false); // historical owner remains unknown
});

test('team members can target another online device while device management stays owner scoped', async () => {
  const { server, base, repo } = await start();
  try {
    const owner = await post(base, '/api/auth/setup', { name: '目标所有者', email: 'target-owner@example.com', password: 'password-123' });
    const ownerBody = await owner.json();
    const ownerCookie = cookieOf(owner);
    const createdWorkspace = await post(base, '/api/workspaces', { name: '目标团队', slug: 'target-team', kind: 'team' }, ownerCookie);
    assert.equal(createdWorkspace.status, 201);
    const invite = await post(base, '/api/workspaces/target-team/invitations', { email: 'target-member@example.com' }, ownerCookie);
    const inviteBody = await invite.json();
    const member = await post(base, '/api/auth/register', { name: '目标成员', email: 'target-member@example.com', password: 'password-456', workspaceSlug: 'target-team', invitationCode: inviteBody.code });
    const memberCookie = cookieOf(member);
    const ownerPairing = repo.createDevicePairing('target-team', { name: 'Owner workstation', createdBy: ownerBody.user.id });
    const ownerDevice = repo.claimDevicePairing({ code: ownerPairing.code }).deviceId;
    const memberBody = await member.json();
    const memberPairing = repo.createDevicePairing('target-team', { name: 'Member workstation', createdBy: memberBody.user.id });
    const memberDevice = repo.claimDevicePairing({ code: memberPairing.code }).deviceId;
    const listed = await fetch(`${base}/api/workspaces/target-team/devices`, { headers: { cookie: memberCookie } });
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).devices.length, 2);
    assert.equal((await fetch(`${base}/api/devices/${ownerDevice}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: memberCookie }, body: JSON.stringify({ name: '越权' }) })).status, 403);
    assert.equal((await fetch(`${base}/api/devices/${memberDevice}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: memberCookie }, body: JSON.stringify({ name: '成员新名称' }) })).status, 200);
    assert.equal((await fetch(`${base}/api/workspaces/not-target/devices/${memberDevice}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: memberCookie }, body: JSON.stringify({ name: '错误工作区' }) })).status, 403);
    repo.heartbeatDevice('target-team', { deviceId: ownerDevice, name: 'Owner workstation' });
    const created = await post(base, '/api/workspaces/target-team/tasks', { title: '定向任务', runtime: 'Codex', execute: true, targetDeviceId: ownerDevice }, memberCookie);
    assert.equal(created.status, 201);
    const task = await created.json();
    const action = repo.listA2AActions('target-team', { status: 'pending' }).find(item => item.task_id === task.id);
    assert.equal(action.payload.deviceId, ownerDevice);
    assert.equal(repo.ackA2AAction(action.id, { deviceId: ownerDevice }).status, 'acked');
    assert.equal(repo.resultA2AAction(action.id, { deviceId: ownerDevice, status: 'succeeded', result: { ok: true } }).status, 'succeeded');
    const conversation = repo.createConversation('target-team', { title: '定向会话' });
    const messageResponse = await post(base, `/api/conversations/${conversation.id}/messages`, { content: '在目标设备继续处理', targetDeviceId: ownerDevice }, memberCookie);
    assert.equal(messageResponse.status, 201);
    const conversationAction = repo.listA2AActions('target-team', { status: 'pending' }).find(item => item.type === 'conversation.execute');
    assert.equal(conversationAction.payload.deviceId, ownerDevice);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('personal digital employees stay owner scoped inside a team workspace', async () => {
  const { server, base } = await start();
  try {
    const owner = await post(base, '/api/auth/setup', { name: '员工所有者', email: 'employee-owner@example.com', password: 'password-123' });
    const ownerBody = await owner.json();
    const ownerCookie = cookieOf(owner);
    assert.equal((await post(base, '/api/workspaces', { name: '员工团队', slug: 'employee-team', kind: 'team' }, ownerCookie)).status, 201);
    const invite = await post(base, '/api/workspaces/employee-team/invitations', { email: 'employee-member@example.com' }, ownerCookie);
    const inviteBody = await invite.json();
    const member = await post(base, '/api/auth/register', { name: '员工成员', email: 'employee-member@example.com', password: 'password-456', workspaceSlug: 'employee-team', invitationCode: inviteBody.code });
    const memberCookie = cookieOf(member);
    const created = await post(base, '/api/workspaces/employee-team/employees', { name: '所有者私人员工', runtime: 'Codex', visibility: 'personal' }, ownerCookie);
    assert.equal(created.status, 201);
    const employee = await created.json();
    assert.equal(employee.owner_user_id, ownerBody.user.id);
    const memberList = await fetch(`${base}/api/workspaces/employee-team/employees`, { headers: { cookie: memberCookie } });
    assert.equal(memberList.status, 200);
    assert.equal((await memberList.json()).employees.some(item => item.id === employee.id), false);
    const deniedConversation = await post(base, '/api/workspaces/employee-team/conversations', { title: '越权对话', employeeId: employee.id }, memberCookie);
    assert.equal(deniedConversation.status, 400);
    const ownerList = await fetch(`${base}/api/workspaces/employee-team/employees`, { headers: { cookie: ownerCookie } });
    assert.equal((await ownerList.json()).employees.some(item => item.id === employee.id), true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('personal task target validation does not allow an anonymous repository caller to choose another device', () => {
  const repo = createRepository({ memory: true });
  repo.db.prepare("UPDATE workspaces SET kind='personal' WHERE slug='test-111'").run();
  const first = repo.createDevice('test-111', { name: '第一台', ownerUserId: 'user_a' });
  const second = repo.createDevice('test-111', { name: '第二台', ownerUserId: 'user_b' });
  assert.throws(() => repo.createTask('test-111', { title: '越权目标', runtime: 'Codex', execute: true, targetDeviceId: second.id, enforceDeviceOwnership: true }), /个人工作区只能使用本人的设备/);
  assert.doesNotThrow(() => repo.createTask('test-111', { title: '本人目标', runtime: 'Codex', execute: true, targetDeviceId: first.id, actorUserId: 'user_a', enforceDeviceOwnership: true }));
});

test('employee default device cannot bypass personal task and conversation ownership checks', () => {
  const repo = createRepository({ memory: true });
  repo.db.prepare("UPDATE workspaces SET kind='personal' WHERE slug='test-111'").run();
  const other = repo.createDevice('test-111', { name: '他人电脑', ownerUserId: 'user_b' });
  const employee = repo.createEmployee('test-111', { name: '绑定他人电脑的员工', runtime: 'Codex', targetDeviceId: other.id });
  const context = { actorUserId: 'user_a', actorRole: 'member', enforceDeviceOwnership: true, enforceEmployeeVisibility: true };
  assert.throws(() => repo.createTask('test-111', { title: '默认员工目标', employeeId: employee.id, execute: true, ...context }), /个人工作区只能使用本人的设备/);
  assert.throws(() => repo.createConversation('test-111', { title: '默认员工会话', employeeId: employee.id, ...context }), /个人工作区只能使用本人的设备/);
  const legacy = repo.createConversation('test-111', { employeeId: employee.id });
  assert.throws(() => repo.addConversationMessage(legacy.id, { content: '不能通过默认目标发起执行', ...context }), /个人工作区只能使用本人的设备/);
});

test('identity-facing defaults do not fabricate the historical workspace or owner account', () => {
  const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
  assert.doesNotMatch(read('frontend/src/api.js'), /test-111/);
  assert.doesNotMatch(read('frontend/src/App.vue'), /name:'紫薇用户',email:'',role:'owner'/);
  assert.doesNotMatch(read('daemon/ziwei_user.mjs'), /test-111/);
  assert.doesNotMatch(read('scripts/ziwei-cli.mjs'), /test-111/);
});
