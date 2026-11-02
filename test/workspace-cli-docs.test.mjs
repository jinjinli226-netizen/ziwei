import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {operations, CLI_VERSION, STANDARD_VERSION} from '../packages/workspace-cli/src/registry.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const moduleUrl = new URL('../backend/workspace-cli-docs.mjs', import.meta.url);
const generatorUrl = new URL('../scripts/build-workspace-cli-docs.mjs', import.meta.url);
const origin = 'https://ziwei.qzelynth.top';
const expected = new Map([
  ['/docs', {file:'index.html', type:'text/html; charset=utf-8', body:/<h1>紫薇驾驶舱/}],
  ['/docs/cli.md', {file:'cli.md', type:'text/markdown; charset=utf-8', body:/# 紫薇驾驶舱 CLI/}],
  ['/llms.txt', {file:'llms.txt', type:'text/plain; charset=utf-8', body:/紫薇驾驶舱/}]
]);

function mockResponse() {
  return {statusCode:200, headers:{}, body:null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    send(body) { this.body = Buffer.isBuffer(body) ? body.toString('utf8') : body; return this; }
  };
}

test('workspace documentation module exists for public route registration', () => {
  assert.ok(fs.existsSync(moduleUrl), 'anonymous document routes are not implemented');
});

test('three exact anonymous GET routes serve real UTF-8 bodies without an auth dependency', async () => {
  const {registerWorkspaceCliDocs} = await import(moduleUrl);
  const routes = new Map();
  registerWorkspaceCliDocs({get(url, ...handlers) { assert.equal(handlers.length, 1); routes.set(url, handlers[0]); }});
  assert.deepEqual([...routes.keys()], [...expected.keys()]);
  for (const [url, check] of expected) {
    const res = mockResponse();
    routes.get(url)({method:'GET', path:url, headers:{}}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], check.type);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.body, check.body);
    assert.match(res.body, /https:\/\/ziwei\.qzelynth\.top\/docs\/cli\.md/);
    assert.match(res.body, new RegExp(CLI_VERSION.replaceAll('.', '\\.')));
    assert.match(res.body, new RegExp(STANDARD_VERSION.replaceAll('.', '\\.')));
    assert.doesNotMatch(res.body, /<script\b|id=["']app["']/i);
  }
  assert.equal(routes.has('/docs/missing.md'), false);
  assert.equal(routes.has('/docs/*'), false);
  assert.equal(routes.has('/mcp-docs'), false);
  const appSource = fs.readFileSync(path.join(root, 'backend/app.mjs'), 'utf8');
  const registration = appSource.indexOf('registerWorkspaceCliDocs(app)');
  assert.ok(registration >= 0);
  assert.ok(registration < appSource.indexOf("app.use('/api', unifiedIdentity?.apiGuard || sessionMiddleware"));
  assert.ok(appSource.includes("app.use('/api/workspaces/:slug', workspaceMembershipGuard"));
  assert.ok(appSource.includes("app.use('/api', resourceWorkspaceGuard"));
});

test('missing packaged documents are 404 and filesystem failures are sanitized 500', async () => {
  const {registerWorkspaceCliDocs} = await import(moduleUrl);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-docs-'));
  try {
    const routes = new Map();
    registerWorkspaceCliDocs({get(url, handler) {routes.set(url, handler);}}, {publicDirectory:temporary});
    const missing = mockResponse();
    routes.get('/docs/cli.md')({headers:{}}, missing);
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers['content-type'], 'text/plain; charset=utf-8');
    assert.doesNotMatch(missing.body, /ENOENT|Users|workspace-docs-/);
    fs.mkdirSync(path.join(temporary, 'cli.md'));
    const invalid = mockResponse();
    routes.get('/docs/cli.md')({headers:{}}, invalid);
    assert.equal(invalid.statusCode, 500);
    assert.doesNotMatch(invalid.body, /EISDIR|Users|workspace-docs-/);
  } finally { fs.rmSync(temporary, {recursive:true, force:true}); }
});

test('generated files are current and every registry schema/behavior has one exact public entry', async () => {
  const {buildWorkspaceCliDocs, writeWorkspaceCliDocs} = await import(generatorUrl);
  const files = buildWorkspaceCliDocs();
  assert.deepEqual(Object.keys(files).sort(), ['cli.md', 'index.html', 'llms.txt']);
  for (const [name, content] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, 'docs/public/workspace-cli', name), 'utf8'), content, `${name} is stale`);
    assert.doesNotMatch(content, /[A-Z]:[\\/]|\/opt\/|\/Users\/|employee_[a-f0-9-]{20,}|Bearer\s+[a-zA-Z0-9_-]{20,}/);
  }
  const markdown = files['cli.md'];
  for (const operation of operations) {
    const marker = `<!-- operation:${operation.name} -->`;
    assert.equal(markdown.split(marker).length - 1, 1, `${operation.name} appears exactly once`);
    assert.ok(markdown.includes(JSON.stringify(operation.inputSchema, null, 2)), `${operation.name} schema drift`);
    assert.ok(markdown.includes(`### ${operation.name.replaceAll('.', ' ')}`));
    const {name, description, inputSchema, ...details} = operation;
    assert.ok(markdown.includes(JSON.stringify(details, null, 2)), `${operation.name} behavior drift`);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-docs-build-'));
  try {
    assert.throws(() => writeWorkspaceCliDocs({outputDirectory:temporary, check:true}), /stale|missing/);
    writeWorkspaceCliDocs({outputDirectory:temporary});
    assert.equal(writeWorkspaceCliDocs({outputDirectory:temporary, check:true}), 3);
    fs.appendFileSync(path.join(temporary, 'cli.md'), '\nstale');
    assert.throws(() => writeWorkspaceCliDocs({outputDirectory:temporary, check:true}), /stale/);
  } finally { fs.rmSync(temporary, {recursive:true, force:true}); }
});

test('public instructions state distribution, identity, native MCP and deployment boundaries', async () => {
  const {buildWorkspaceCliDocs} = await import(generatorUrl);
  const files = buildWorkspaceCliDocs();
  const markdown = files['cli.md'];
  for (const text of ['@ziwei/workspace-cli', 'ziwei-workspace', 'ziwei_user', '--password-stdin', '--managed-stdin', '--input-stdin', 'OUTCOME_UNKNOWN', 'CANCELLED', 'no automatic write retry', 'SSO', 'scripts/ziwei-mcp.mjs', 'stdio', 'SHA-256', 'release.json']) assert.ok(markdown.includes(text), text);
  for (const code of [0,1,2,3,4,5,6,7,8,9,130]) assert.match(markdown, new RegExp(`\\| ${code} \\|`));
  for (const url of [`${origin}/docs`, `${origin}/docs/cli.md`, `${origin}/llms.txt`]) assert.ok(files['llms.txt'].includes(url));
  assert.doesNotMatch(markdown, /npm install --global @ziwei\/workspace-cli|https:\/\/ziwei\.qzelynth\.top\/mcp(?:\s|["')])/);
  for (const content of Object.values(files)) assert.doesNotMatch(content, /未提交增量|当前候选字节一致|公网可用性 pending|公网读取 pending|改动未部署|未部署这次|未覆盖：员工机器 client_credentials|client_credentials[^\n]*未由本 CLI 实现|19876c0f006af18c9fe3b6ef4a7d9e94c75c14c6/);
});

test('identity docs describe current unified configuration and the full public protocol without conflating acceptance', async () => {
  const {buildWorkspaceCliDocs} = await import(generatorUrl);
  const files = buildWorkspaceCliDocs(), markdown = files['cli.md'];
  for (const text of [`CLI ${CLI_VERSION}`, `规范 ${STANDARD_VERSION}`, '身份契约 1.0.1', 'CLI 默认 unified', 'mode:unified', 'ready:true', 'legacyAllowed:false', 'native', 'mcp', 'auth complete', 'auth wait', 'auth refresh', 'PKCE S256', 'ziwei-workspace-api', 'ziwei-workspace-cli', '/api/identity/config', '/api/identity/me', 'offline_access', 'revocationConfirmed:false', 'legacyAllowed:true', 'stdio 脚本未新增统一 OP 授权', '不代表所有模型或 SSO 全流程均已验收']) assert.ok(markdown.includes(text), text);
  assert.doesNotMatch(markdown, /统一身份[^\n]{0,80}返回[^\n]{0,40}NOT_SUPPORTED|native 模式默认|未覆盖：统一身份|ziwei-workspace-cli-1\.0\.0\.tgz/);
  for (const name of ['index.html','llms.txt']) {
    assert.ok(files[name].includes(`CLI ${CLI_VERSION}`));
    assert.match(files[name], /1\.0\.1/);
    assert.match(files[name], /legacy/);
    assert.match(files[name], /unified/);
  }
});

test('versioned public documentation links the matching package and receipt and retains the complete catalog', async () => {
  const {buildWorkspaceCliDocs, DOCUMENT_VERSION, UPDATED_AT} = await import(generatorUrl);
  const files = buildWorkspaceCliDocs(), markdown = files['cli.md'];
  const releaseBase = `${origin}/downloads/workspace-cli/${CLI_VERSION}`;
  const artifact = `${releaseBase}/ziwei-workspace-cli-${CLI_VERSION}.tgz`;
  assert.equal(DOCUMENT_VERSION, '2.1.0');
  assert.equal(UPDATED_AT, '2026-11-02');
  assert.equal(operations.length, 49);
  assert.equal([...markdown.matchAll(/<!-- operation:/g)].length, operations.length);
  for (const content of Object.values(files)) {
    assert.ok(content.includes(`文档 ${DOCUMENT_VERSION}`));
    assert.ok(content.includes(`更新 ${UPDATED_AT}`));
    assert.ok(content.includes(artifact));
    assert.ok(content.includes(`${releaseBase}/release.json`));
  }
  assert.ok(markdown.includes(`npm install --global "${artifact}"`));
  assert.ok(markdown.includes('bots collaboration'));
  assert.ok(markdown.includes('members'));
  assert.ok(markdown.includes('memberDescriptors'));
  assert.ok(markdown.includes('没有独立的 groups CLI 命令'));
});

test('person long-lived authorization and automatic renewal keep worker and uncertain-write boundaries explicit', async () => {
  const {buildWorkspaceCliDocs} = await import(generatorUrl);
  const markdown = buildWorkspaceCliDocs()['cli.md'];
  for (const text of ['--long-lived', '--purpose person', 'offline_access', 'accessExpiresAt', 'refreshIdleExpiresAt', 'loginSessionExpiresAt', 'loginMode', '业务调用前', '临近过期', '自动续期', '401', '不重发业务请求', '--mode machine', '--worker-file', '不保存 RT', '实际返回的期限']) assert.ok(markdown.includes(text), text);
  assert.doesNotMatch(markdown, /offline_access`?。不会|offline_access`?。普通|offline_access`?永不|永久登录|保证[^\n]*365/);
});

test('all 49 CLI routes advertise the actual server unified role and scope including phone binding admin', async () => {
  const {requiredPermission} = await import('../backend/identity/native.mjs');
  assert.equal(operations.length,49);
  for (const op of operations) for (const route of Object.values(op.routes).filter(Boolean)) {
    const permission=requiredPermission({method:route.method,originalUrl:route.path.replaceAll('{workspace}','example-workspace').replace(/\{[^}]+\}/g,'example-id')});
    assert.equal(op.unifiedAuthorization?.requiredRole,permission,op.name);
    assert.equal(op.unifiedAuthorization?.requiredScope,permission==='read'?'workspace:read':'workspace:write',op.name);
    assert.equal(op.unifiedAuthorization?.requiresAccess,true,op.name);
    assert.equal(op.unifiedAuthorization?.nativeOwnerAdmin,permission==='admin',op.name);
  }
  assert.equal(operations.find(op=>op.name==='phone-mcp.configure').unifiedAuthorization.requiredRole,'admin');
  assert.equal(operations.find(op=>op.name==='tasks.create').unifiedAuthorization.requiredRole,'write');
});
