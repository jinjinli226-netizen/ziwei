import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as update from '../scripts/client-update.mjs';

test('legacy update requires both explicit confirmation and a bounded proof file', async t => {
  assert.equal(typeof update.readLegacyUpdateConsent, 'function');
  assert.deepEqual(await update.readLegacyUpdateConsent({}), {});
  for (const args of [
    { 'allow-legacy-stop': true },
    { 'legacy-proof': 'not-read.json' },
    { 'allow-legacy-stop': 'false', 'legacy-proof': 'not-read.json' },
    { 'allow-legacy-stop': 'true', 'legacy-proof': 'not-read.json' },
  ]) await assert.rejects(update.readLegacyUpdateConsent(args), error => error.code === 'LEGACY_CONFIRMATION_INVALID');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-consent-proof-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'proof.json');
  for (const value of ['{', JSON.stringify({ pid: process.pid }), ' '.repeat(65537)]) {
    fs.writeFileSync(file, value);
    await assert.rejects(update.readLegacyUpdateConsent({ 'allow-legacy-stop': true, 'legacy-proof': file }));
  }
});

test('legacy diagnostics disclose unknown activity without leaking raw health or configuration', () => {
  const result = update.updateFailureResult(Object.assign(new Error('private-token-and-config'), { code: 'LEGACY_STOP_CONFIRMATION_REQUIRED' }), 'stop_client');
  assert.equal(result.reasonCode, 'LEGACY_STOP_CONFIRMATION_REQUIRED');
  assert.match(result.reason, /未知|确认/);
  assert.doesNotMatch(JSON.stringify(result), /private-token-and-config/);
  for (const code of ['LEGACY_CONFIRMATION_INVALID', 'LEGACY_IDENTITY_UNVERIFIED', 'LEGACY_PROTOCOL_MISMATCH', 'LEGACY_PROOF_INVALID', 'LEGACY_PROOF_EXPIRED', 'LEGACY_IDENTITY_CHANGED', 'LEGACY_SOURCE_UNRECOGNIZED', 'LEGACY_CONFIG_MISMATCH', 'LEGACY_CONFIG_NAMESPACE_UNVERIFIED', 'LEGACY_STOP_PROOF_REQUIRED', 'LEGACY_STOP_FAILED']) {
    const diagnostic = update.updateFailureResult(Object.assign(new Error('private-token-and-config'), { code }), 'stop_client');
    assert.equal(diagnostic.reasonCode, code);
    assert.doesNotMatch(diagnostic.reason, /此维护阶段未完成|客户端安全核验或维护操作失败/);
    assert.doesNotMatch(JSON.stringify(diagnostic), /private-token-and-config/);
  }
});
