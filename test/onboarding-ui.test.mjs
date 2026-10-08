import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'App.vue'), 'utf8');

test('first-run onboarding does not infer a workspace from the URL', () => {
  assert.match(appSource, /首次使用先创建账号，登录后再建立你的第一个工作区/);
  assert.match(appSource, /const authWorkspaceSlug = ref\(inviteQuery\.get\('workspace'\) \|\| ''\)/);
  assert.doesNotMatch(appSource, /if \(status\.setup_required .*workspaceSlugFromPath/);
  assert.match(appSource, /workspaceCreateRequired/);
});

test('configured workspaces expose a real registration path instead of reusing first-run setup', () => {
  const apiSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'api.js'), 'utf8');
  assert.match(apiSource, /authRegister: body => request\('\/api\/auth\/register'/);
  assert.match(appSource, /api\.authRegister/);
  assert.match(appSource, /authMode==='login'\s*\?\s*'注册新账号'/);
  assert.match(appSource, /v-model="authForm\.invitationCode"/);
  assert.match(appSource, /invitationCode:authForm\.value\.invitationCode/);
});

test('successful authentication loads workspace state so device onboarding can run immediately', () => {
  assert.match(appSource, /authState\.value = \{ \.\.\.authState\.value, \.\.\.result[\s\S]*?setWorkspaceSlug\([\s\S]*?await load\(\)/);
});

test('device setup dismissal is scoped to the authenticated workspace', () => {
  assert.match(appSource, /deviceSetupDismissedKey/);
  assert.match(appSource, /localStorage\.setItem\(deviceSetupDismissedKey\(\), '1'\)/);
  assert.match(appSource, /ziwei\.deviceSetupDismissed:/);
});

test('creating or opening a workspace does not force a device connection modal', () => {
  assert.doesNotMatch(appSource, /const needsDeviceSetup = !s\.device[\s\S]*openDeviceModal\(true\)/);
  assert.match(appSource, /连接设备是可选的/);
});

test('member workspace loading does not let admin-only settings block device onboarding', () => {
  assert.match(appSource, /canReadWorkspaceSettings/);
  assert.match(appSource, /settingsRequest/);
  assert.match(appSource, /canReadWorkspaceSettings\s*\?\s*api\.settings\(\)/);
});

test('device onboarding shows the API origin and optional certificate steps', () => {
  assert.match(appSource, /deviceApiBase/);
  assert.match(appSource, /deviceServerCertificateUrl/);
  assert.match(appSource, /deviceCertificateRequired/);
  assert.match(appSource, /下载服务器证书/);
  assert.match(appSource, /--api/);
  assert.match(appSource, /--tls-ca-file/);
  assert.match(appSource, /正式 HTTPS 地址已验证，无需下载额外证书/);
});

test('device onboarding provisions a generic ziwei_user daemon with a one-time pairing code', () => {
  const apiSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'api.js'), 'utf8');
  assert.match(apiSource, /createDevicePairing:/);
  assert.match(appSource, /api\.createDevicePairing/);
  assert.match(appSource, /devicePairing/);
  assert.match(appSource, /deviceCommandMode = ref\('existing'\)/);
  assert.match(appSource, /电脑已安装 ziwei_user/);
  assert.match(appSource, /这台电脑第一次安装/);
  assert.match(appSource, /deviceForm = ref\(\{name:'这台电脑'/);
  assert.match(appSource, /api\.createDevicePairing\(\{ name: deviceForm\.value\.name \|\| '这台电脑'/);
  assert.doesNotMatch(appSource, /api\.createDevicePairing\(\{ name: deviceForm\.value\.name \|\| '远程设备'/);
  assert.match(appSource, /ziwei_user connect/);
  assert.match(appSource, /--code/);
  assert.match(appSource, /--name/);
  assert.doesNotMatch(appSource, /install-ziwei-user\.ps1/);
});

test('device management exposes real metadata and a rename action', () => {
  assert.match(appSource, /formatDeviceDate\(device\.created_at\)/);
  assert.match(appSource, /deviceLastSeenLabel\(device\)/);
  assert.match(appSource, /openDeviceEditor\(device\)/);
  assert.match(appSource, /api\.updateDevice\(draft\.id/);
  assert.doesNotMatch(appSource, /创建时间 2026\/9\/28/);
});

test('tasks and conversations expose a target device contract', () => {
  assert.match(appSource, /agentComposerDeviceId/);
  assert.match(appSource, /targetDeviceId:agentComposerDeviceId\.value/);
  assert.match(appSource, /conversationDeviceId/);
  assert.match(appSource, /targetDeviceId:conversationDeviceId\.value/);
  assert.match(appSource, /选择目录/);
  assert.match(appSource, /conversationDirectoryPickerOpen/);
  assert.match(appSource, /inspectConversationDirectory/);
  assert.match(appSource, /创建并使用/);
});

test('employee creation keeps runtime discovery generic and preserves an explicit runtime choice', () => {
  assert.doesNotMatch(appSource, /employeeForm = ref\(\{name:'',runtime:'Hermes'/);
  assert.match(appSource, /employeeRuntimeChoices = computed\(\(\) => employeeSelectedDevice\.value\?\.runtimes/);
  assert.match(appSource, /v-for="runtime in employeeRuntimeChoices"/);
  assert.match(appSource, /function selectEmployeeRuntime\(name\) \{[\s\S]*?employeeForm\.value\.runtime=name/);
  assert.match(appSource, /runtime:employee\?\.runtime \|\| 'Codex'/);
  assert.doesNotMatch(appSource, /employeeForm\.value\.runtime\s*=\s*runtimes\.value\[0\]/);
  assert.match(appSource, /employeeReadiness\(managementDiscovery\.value,[\s\S]*?runtime:employeeForm\.value\.runtime/);
  assert.match(appSource, /if \(!employeeReady\.value\.ready\) return notify/);
});

test('Windows device instructions are valid for cmd.exe quoting', () => {
  assert.match(appSource, /function cmdLiteral\(value\)/);
  assert.match(appSource, /windows: `npm install --global \$\{cmdLiteral\(/);
  assert.match(appSource, /archive\/refs\/heads\/codex\/hermes-independent-profile\.tar\.gz/);
  assert.doesNotMatch(appSource, /windows: `npm install --global \$\{powerShellLiteral\(/);
});
