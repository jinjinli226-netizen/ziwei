import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'App.vue'), 'utf8');

test('first-run onboarding keeps the server workspace explicit', () => {
  assert.match(appSource, /label="工作区标识"/);
  assert.match(appSource, /v-model="authWorkspaceSlug"/);
  assert.match(appSource, /workspaceSlug:authWorkspaceSlug\.value\.trim\(\)/);
  assert.match(appSource, /workspaceSlugFromPath/);
});

test('configured workspaces expose a real registration path instead of reusing first-run setup', () => {
  const apiSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'api.js'), 'utf8');
  assert.match(apiSource, /authRegister: body => request\('\/api\/auth\/register'/);
  assert.match(appSource, /api\.authRegister/);
  assert.match(appSource, /authMode==='login'\s*\?\s*'注册新账号'/);
});

test('successful authentication loads workspace state so device onboarding can run immediately', () => {
  assert.match(appSource, /authState\.value = \{ \.\.\.authState\.value, \.\.\.result[\s\S]*?setWorkspaceSlug\([\s\S]*?await load\(\)/);
});

test('device setup dismissal is scoped to the authenticated workspace', () => {
  assert.match(appSource, /deviceSetupDismissedKey/);
  assert.match(appSource, /localStorage\.setItem\(deviceSetupDismissedKey\(\), '1'\)/);
  assert.match(appSource, /localStorage\.getItem\(deviceSetupDismissedKey\(\)/);
});

test('member workspace loading does not let admin-only settings block device onboarding', () => {
  assert.match(appSource, /canReadWorkspaceSettings/);
  assert.match(appSource, /settingsRequest/);
  assert.match(appSource, /canReadWorkspaceSettings\s*\?\s*api\.settings\(\)/);
});

test('device onboarding shows the API origin and optional certificate steps', () => {
  assert.match(appSource, /deviceApiBase/);
  assert.match(appSource, /deviceServerCertificateUrl/);
  assert.match(appSource, /下载服务器证书/);
  assert.match(appSource, /--api/);
  assert.match(appSource, /--tls-ca-file/);
  assert.match(appSource, /正式域名证书无需额外文件/);
});

test('device onboarding provisions a generic ziwei_user daemon with a one-time pairing code', () => {
  const apiSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'api.js'), 'utf8');
  assert.match(apiSource, /createDevicePairing:/);
  assert.match(appSource, /api\.createDevicePairing/);
  assert.match(appSource, /devicePairing/);
  assert.match(appSource, /ziwei_user connect/);
  assert.match(appSource, /--code/);
  assert.doesNotMatch(appSource, /install-ziwei-user\.ps1/);
});

test('employee creation keeps the four-agent runtime choice generic', () => {
  assert.doesNotMatch(appSource, /employeeForm = ref\(\{name:'',runtime:'Hermes'/);
  assert.match(appSource, /runtime:runtimes\.value\[0\]\?\.name \|\| 'Codex'/);
});

test('Windows device instructions are valid for cmd.exe quoting', () => {
  assert.match(appSource, /function cmdLiteral\(value\)/);
  assert.match(appSource, /windows: `npm install --global \$\{cmdLiteral\(/);
  assert.match(appSource, /archive\/refs\/heads\/codex\/hermes-independent-profile\.tar\.gz/);
  assert.doesNotMatch(appSource, /windows: `npm install --global \$\{powerShellLiteral\(/);
});
