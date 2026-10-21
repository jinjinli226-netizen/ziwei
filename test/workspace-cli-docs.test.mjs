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
  assert.ok(registration < appSource.indexOf("app.use('/api', sessionMiddleware"));
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
    assert.ok(markdown.includes(`### ${operation.name.replace('.', ' ')}`));
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
  for (const text of ['@ziwei/workspace-cli', 'ziwei-workspace', '--password-stdin', '--managed-stdin', '--input-stdin', 'OUTCOME_UNKNOWN', 'CANCELLED', 'no automatic write retry', 'SSO', 'pending', 'scripts/ziwei-mcp.mjs', 'stdio', '尚未发布到公共 npm', '未部署', 'SHA-256']) assert.ok(markdown.includes(text), text);
  for (const code of [0,1,2,3,4,5,6,7,8,9,130]) assert.match(markdown, new RegExp(`\\| ${code} \\|`));
  for (const url of [`${origin}/docs`, `${origin}/docs/cli.md`, `${origin}/llms.txt`]) assert.ok(files['llms.txt'].includes(url));
  assert.doesNotMatch(markdown, /npm install --global @ziwei\/workspace-cli|https:\/\/ziwei\.qzelynth\.top\/mcp(?:\s|["')])/);
});
