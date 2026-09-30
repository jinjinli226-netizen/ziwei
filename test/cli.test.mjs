import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = path.join(root, 'scripts', 'ziwei-cli.mjs');

test('ziwei_user CLI writes a token-free local configuration', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-cli-'));
  const config = path.join(temp, 'config.json');
  const env = { ...process.env, ZIWEI_CONFIG: config };
  const { stdout } = await run(process.execPath, [cli, 'setup', '--workspace', 'demo', '--api', 'http://127.0.0.1:4178/?token=do-not-store', '--health-port', '20243'], { cwd: root, env });
  const saved = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert.equal(saved.workspace, 'demo');
  assert.equal(saved.apiBase, 'http://127.0.0.1:4178');
  assert.equal(saved.healthPort, 20243);
  assert.equal(Object.hasOwn(saved, 'token'), false);
  assert.match(stdout, /ziwei_user 已配置/);
  assert.doesNotMatch(stdout, /do-not-store/);
});

test('ziwei_user CLI reports its version', async () => {
  const { stdout } = await run(process.execPath, [cli, 'version'], { cwd: root });
  assert.match(stdout.trim(), /^ziwei_user \d+\.\d+\.\d+$/);
});
