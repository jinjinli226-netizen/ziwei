import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

test('official compression adapter checks recorded 0.21.3 ABI shapes and safe continuation without listeners', () => {
  const fixture = fileURLToPath(new URL('./fixtures/hermes-official-compression.py', import.meta.url));
  const result = spawnSync('python3', ['-B', fixture], {encoding:'utf8', timeout:30000, maxBuffer:128000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stderr, /Ran 21 tests/);
});

test('bootstrap installs official in-process recovery before the maintenance hook and never injects /new', () => {
  const source = fs.readFileSync(new URL('../src/hermes-mcp-bootstrap.py', import.meta.url), 'utf8');
  assert.ok(source.indexOf('compression.install(') < source.indexOf('finish_maintenance = lambda: None'));
  assert.match(source, /hermes-official-compression\.py/);
  const helper = fs.readFileSync(new URL('../src/hermes-official-compression.py', import.meta.url), 'utf8');
  assert.doesNotMatch(helper, /snapshot_is_current=|verbatim_tail=/, 'actual 0.21.3 ABI receives no 0.22-only arguments');
});
