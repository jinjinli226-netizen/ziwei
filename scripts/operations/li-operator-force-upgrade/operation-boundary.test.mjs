import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = n => fs.readFileSync(path.join(dir, n), 'utf8');
const launcher = read('register-once.mjs'), native = read('register-li-force-upgrade-once.ps1'), worker = read('li-force-upgrade-worker.mjs');
const H = b => createHash('sha256').update(b).digest('hex');
test('launcher binds the exact shipped native/worker bytes before register', () => {
  for (const file of ['register-li-force-upgrade-once.ps1', 'li-force-upgrade-worker.mjs']) assert.ok(launcher.includes(H(fs.readFileSync(path.join(dir, file)))));
  assert.ok(launcher.indexOf("stage = 'native_syntax'") < launcher.indexOf("stage = 'register'"));
  assert.match(launcher, /const mode = process\.argv\[2\] \|\| '--validate'/);
});
test('unrelated platform cannot read configuration, schedule or stop anything', { skip: process.platform === 'win32' }, () => {
  let output; try { execFileSync(process.execPath, [path.join(dir, 'register-once.mjs'), '--register', '00000000-0000-0000-0000-000000000000'], { encoding: 'utf8' }); assert.fail('expected platform refusal'); } catch (e) { assert.equal(e.status, 1); output = e.stdout; }
  const row = JSON.parse(output);
  assert.equal(row.state, 'failed'); assert.equal(row.stage, 'fixed_scope'); assert.equal(row.code, 'ONCE_ARGUMENTS');
});
test('fixed target package is verified before any pause or kill; official updater follows a full receipt', () => {
  assert.ok(native.indexOf("NodeStep '--prepare'") < native.indexOf("Control 'pause'"));
  assert.ok(native.indexOf("NodeStep '--prepare'") < native.indexOf('$Main.Kill()'));
  for (const field of ['capturedDescendantsExited===true', 'currentOwnedTreeEmptyObserved===true', 'originalActionCompletionInferred===false', 'originalActionTreeExitInferred===false']) assert.ok(worker.includes(field));
  assert.ok(native.indexOf('WriteNew $ForceReceipt') < native.indexOf("NodeStep '--launch'"));
  assert.match(worker, /20a1c9c849e70f14291429bf04bd1da7058e369989d51687eb05303bf705cf53/);
});
test('only the completed Creator branch is awaited; faulty historical counters are not stop gates', () => {
  assert.ok(launcher.includes('while($current -ne ${p.sourcePid})'));
  assert.match(launcher, /sourcePid: 55824/);
  assert.match(native, /\$ancestor\.pid -ne \$Plan\.sourcePid/);
  assert.doesNotMatch(native, /activeActionCount|pollingCount|stopSafe|maintenance\.safe|pendingDeliveryCount|blockedDeliveryCount/);
  assert.match(native, /AddMinutes\(10\)/); assert.match(native, /BOOTSTRAP_CREATOR_EXIT_TIMEOUT/);
});
test('tree members use held generation handles and actual parent exit time; no machine-wide name kill', () => {
  assert.match(native, /\$null=\$p\.Handle/);
  assert.match(native, /\$owner\.process\.ExitTime\.ToUniversalTime\(\)/);
  assert.match(native, /BOOTSTRAP_PARENT_GENERATION_CHANGED/);
  assert.match(native, /BOOTSTRAP_TASK_IN_TARGET_TREE/);
  assert.doesNotMatch(native, /taskkill|Stop-Process|\.Kill\(\$true\)|\.Kill\(true\)|stoppedAt=\[DateTime\]/i);
  assert.match(native, /AddSeconds\(30\)/);
});
test('preserve history, separate force receipt, partial failure and explicit restart reporting', () => {
  assert.match(native, /original-runtime-history/); assert.match(native, /Copy-Item -LiteralPath \$src/);
  assert.doesNotMatch(native, /Remove-Item/);
  assert.match(native, /capturedDescendantsExited=\$false/);
  assert.match(native, /originalActionTreeExitInferred=\$false/);
  assert.match(native, /NodeStep '--start'/);
  assert.match(worker, /authenticatedServerHeartbeatVerified:false/);
});
