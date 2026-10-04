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

test('device onboarding shows the API origin and pinned certificate steps', () => {
  assert.match(appSource, /deviceApiBase/);
  assert.match(appSource, /deviceServerCertificateUrl/);
  assert.match(appSource, /下载服务器证书/);
  assert.match(appSource, /data\\\/ziwei-server\.crt|data\\\\ziwei-server\.crt/);
  assert.match(appSource, /--api/);
  assert.match(appSource, /--tls-ca-file/);
  assert.match(appSource, /先下载并保存证书/);
});
