import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { hermesProfileHome, listHermesProfiles, normalizeProxyUrl, parseRuntimeStreamLine, proxyUrlForChild, runtimeInvocation, validateHermesProfile } from '../src/runtime-adapters.mjs';

// Existing tests remain below; this contract is intentionally first so a missing
// discovery implementation fails before production code is added.
test('Hermes profile discovery lists configured profiles and validates missing names', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-hermes-'));
  fs.mkdirSync(path.join(root, 'profiles', 'ziwei-aigc'), { recursive: true });
  fs.writeFileSync(path.join(root, 'profiles', 'ziwei-aigc', 'SOUL.md'), '# profile');
  assert.deepEqual(listHermesProfiles({ baseHome: root }).map(item => item.name), ['default', 'ziwei-aigc']);
  assert.equal(validateHermesProfile('ziwei-aigc', { baseHome: root }).valid, true);
  assert.equal(validateHermesProfile('missing', { baseHome: root }).valid, false);
  assert.throws(() => validateHermesProfile('../outside', { baseHome: root }), /profile 名称无效/);
  fs.rmSync(root, { recursive: true, force: true });
});
