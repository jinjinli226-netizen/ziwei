import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prelaunchFixture, forceAbandonFixture } from './fixtures/historical-recovery.mjs';
import { historicalPrelaunchRecovery, HISTORICAL_PRELAUNCH_RECOVERY_DETAIL } from '../web/historical-prelaunch-recovery.mjs';
import { operatorForceAbandonRecovery, OPERATOR_FORCE_ABANDON_DETAIL } from '../web/operator-force-abandon-recovery.mjs';
import { botPresence, botStopPresentation, botRecoveryEvent, botRecoveryDetail, executionUncertain, processExitConfirmed } from '../web/bot-presentation.js';

const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);

test('mobile recovery validation and presentation match the desktop contract with repository LF line endings', async () => {
  for (const name of ['bot-presentation.js', 'historical-prelaunch-recovery.mjs', 'operator-force-abandon-recovery.mjs']) {
    const mobile = await readFile(new URL(`../web/${name}`, import.meta.url), 'utf8');
    const desktop = await readFile(new URL(`../../frontend/src/${name}`, import.meta.url), 'utf8');
    assert.equal(mobile, desktop.replace(/\r\n/g, '\n').replace(/\n+$/, '\n'), name);
    assert.doesNotMatch(mobile, /\r/, 'packaged web resources use the Git LF bytes');
  }
});

test('both committed prelaunch versions release the admission block without changing the original failure or claiming process exit', () => {
  for (const postUpdate of [false, true]) {
    const run = prelaunchFixture({ postUpdate }), before = canonical(run), receipt = run.prelaunchRecovery;
    assert.equal(historicalPrelaunchRecovery(run), receipt); assert.equal(executionUncertain(run), false);
    assert.equal(botRecoveryEvent(run), null); assert.equal(botRecoveryDetail(run), HISTORICAL_PRELAUNCH_RECOVERY_DETAIL);
    const stop = botStopPresentation({ latest_run: run, stop_action: { id: 'old-stop', status: 'succeeded', payload: { actionId: run.id } } });
    assert.equal(stop.confirmed, false); assert.equal(stop.notStarted, true); assert.equal(stop.ended, true);
    assert.equal(stop.label, HISTORICAL_PRELAUNCH_RECOVERY_DETAIL);
    assert.equal(processExitConfirmed(run.result), false); assert.equal(run.result.executionState, 'uncertain');
    assert.equal(botPresence({ control_state: 'paused', latest_run: run }).label, '已暂停 · 原模型未启动');
    assert.equal(canonical(run), before);
  }
});

test('prelaunch flags, nested results and uncommitted events cannot clear a genuine uncertainty', () => {
  const source = prelaunchFixture(), { prelaunchRecovery: receipt, ...base } = source;
  const rejected = [base, { ...base, notStarted: true, executionState: 'not_started' }, { ...base, result: { ...base.result, prelaunchRecovery: receipt } }, { ...base, events: [{ type: receipt.kind, data: { receipt } }] }];
  for (const mutate of [
    r => { r.prelaunchRecovery.subject.actionId = 'other'; }, r => { r.prelaunchRecovery.subject.deviceId = 'other'; },
    r => { r.prelaunchRecovery.subject.profile = 'other'; }, r => { r.prelaunchRecovery.subject.workspace = 'other'; },
    r => { r.prelaunchRecovery.subject.originalError = 'other'; }, r => { r.prelaunchRecovery.sourcePolicyDigest = 'bad'; },
    r => { r.prelaunchRecovery.admissionProof.scope = 'all-processes'; }, r => { r.prelaunchRecovery.admissionProof.treeConfirmed = true; },
    r => { r.prelaunchRecovery.processExit = { launched: false, treeConfirmed: true }; }, r => { r.prelaunchRecovery.daemonExit.stopped = false; },
    r => { r.prelaunchRecovery.daemonExit.creationTime = '2026-10-17T03:00:00.000Z'; },
  ]) { const run = structuredClone(source); mutate(run); rejected.push(run); }
  for (const run of rejected) { assert.equal(historicalPrelaunchRecovery(run), null); assert.equal(executionUncertain(run), true); }
});

test('post-update evidence cannot substitute the original holder or manufacture a process-tree claim', () => {
  for (const mutate of [
    r => { r.daemonExit = r.maintenanceHolderExit; }, r => { r.originalDaemonExit = r.maintenanceHolderExit; },
    r => { r.mode = 'same_generation'; }, r => { r.migrationEvidenceDigest = 'bad'; },
    r => { r.subject.maintenanceHolderBuild = 'a'.repeat(64); }, r => { r.subject.maintenanceHolderPid = 789; },
    r => { r.verifiedUpdateFinishedAt = '2026-10-16T00:00:00.000Z'; }, r => { r.maintenanceHolderExit.creationTime = '2026-10-17T01:00:00.000Z'; },
    r => { r.admissionProof.treeConfirmed = true; }, r => { r.processExit = { treeConfirmed: true }; },
  ]) {
    const run = prelaunchFixture({ postUpdate: true }); mutate(run.prelaunchRecovery);
    assert.equal(historicalPrelaunchRecovery(run), null, mutate.toString()); assert.equal(executionUncertain(run), true);
  }
});

test('live and absent-holder operator dispositions preserve the unknown result and override only the matching historical stop', () => {
  for (const options of [{ absent: false }, { absent: true }, { absent: true, nullHeartbeat: true }]) {
    const run = forceAbandonFixture(options), before = canonical(run), receipt = run.forceAbandonRecovery;
    assert.equal(operatorForceAbandonRecovery(run), receipt); assert.equal(executionUncertain(run), false);
    assert.equal(botRecoveryEvent(run), null); assert.equal(botRecoveryDetail(run), OPERATOR_FORCE_ABANDON_DETAIL);
    assert.deepEqual(botStopPresentation({ latest_run: run, stop_action: { id: 'old-stop', status: 'succeeded', payload: { actionId: run.id } } }), { confirmed: false, abandoned: true, label: OPERATOR_FORCE_ABANDON_DETAIL, tone: 'muted' });
    assert.equal(botPresence({ control_state: 'paused', latest_run: run }).label, '已暂停 · 旧记录已放弃');
    assert.equal(processExitConfirmed(run.result), false); assert.equal(run.result.executionState, 'uncertain');
    assert.doesNotMatch(botRecoveryDetail(run), /未启动|已停止|已完成|成功/); assert.equal(canonical(run), before);
  }
});

test('operator result flags and event bodies cannot impersonate a committed server disposition', () => {
  const { forceAbandonRecovery: receipt, ...base } = forceAbandonFixture();
  for (const run of [base, { ...base, abandoned: true, disposition: 'abandoned_by_user' }, { ...base, result: { ...base.result, forceAbandonRecovery: receipt } }, { ...base, events: [{ type: receipt.kind, data: { receipt } }] }]) {
    assert.equal(operatorForceAbandonRecovery(run), null); assert.equal(executionUncertain(run), true);
    assert.match(botStopPresentation({ latest_run: run, stop_action: { id: 'old-stop', status: 'succeeded', payload: { actionId: run.id } } }).label, /退出证据尚未确认/);
  }
});

test('another action, altered failure, wrong binding or an invented exit keeps the original block', () => {
  for (const mutate of [
    r => { r.id = 'another'; }, r => { r.agent_id = 'another'; }, r => { r.type = 'hermes.bot.native'; }, r => { r.status = 'succeeded'; },
    r => { r.dedupe_key = 'another'; }, r => { r.acked_at = '2026-10-17T10:37:26.000Z'; }, r => { r.error = 'changed'; }, r => { r.result.reason = 'another'; },
    r => { r.payload.employeeId = 'another'; }, r => { r.payload.deviceId = 'another'; }, r => { r.payload.profile = 'another'; },
    r => { r.payload.hermesBot.workspace = 'another'; }, r => { r.payload.hermesBot.instance = { ...r.payload.hermesBot.instance, ownershipId: 'another' }; },
    r => { r.forceAbandonRecovery.subject.workspace = 'another'; }, r => { r.forceAbandonRecovery.subject.originalPayloadSha256 = '8'.repeat(64); },
    r => { r.forceAbandonRecovery.subject.originalResultSha256 = '8'.repeat(64); }, r => { r.forceAbandonRecovery.subject.failedEvent.dataSha256 = '8'.repeat(64); },
    r => { r.forceAbandonRecovery.grantId = 'another'; }, r => { r.forceAbandonRecovery.grantDigest = '8'.repeat(64); }, r => { r.forceAbandonRecovery.resultingControlEpoch = 8; },
    r => { r.forceAbandonRecovery.executionState = 'not_started'; }, r => { r.forceAbandonRecovery.executionConfirmedStopped = true; },
    r => { r.forceAbandonRecovery.partialEffectsPossible = false; }, r => { r.forceAbandonRecovery.disposition = 'recovered'; },
    r => { r.forceAbandonRecovery.currentDaemonExit.pid++; }, r => { r.forceAbandonRecovery.currentDaemonExit.scope = 'process-tree'; },
    r => { r.forceAbandonRecovery.currentDaemonExit.treeConfirmed = true; }, r => { r.forceAbandonRecovery.currentDaemonExit.exitedAt = '2026-10-17T16:00:00.000Z'; },
    r => { r.forceAbandonRecovery.processExit = { treeConfirmed: true }; }, r => { r.forceAbandonRecovery.policyDigest = '8'.repeat(64); },
  ]) {
    const run = forceAbandonFixture(); mutate(run); assert.equal(operatorForceAbandonRecovery(run), null, mutate.toString());
    assert.equal(executionUncertain(run), true, 'the original uncertain result remains fenced even if the status was changed');
  }
});

test('absent-holder disposition requires the exact observations and cannot borrow a daemon exit', () => {
  for (const mutate of [
    r => { r.forceAbandonRecovery.mode = 'offline'; }, r => { r.forceAbandonRecovery.subject.mode = 'offline'; },
    r => { r.forceAbandonRecovery.currentDaemonExit = forceAbandonFixture().forceAbandonRecovery.currentDaemonExit; },
    r => { r.forceAbandonRecovery.subject.holder = forceAbandonFixture().forceAbandonRecovery.subject.holder; },
    r => { r.forceAbandonRecovery.currentDaemonAbsence.scope = 'original-execution-tree'; }, r => { r.forceAbandonRecovery.currentDaemonAbsence.health = 'timeout'; },
    r => { r.forceAbandonRecovery.currentDaemonAbsence.nativeDaemonCount = 1; }, r => { r.forceAbandonRecovery.currentDaemonAbsence.healthListenerCount = 1; },
    r => { r.forceAbandonRecovery.currentDaemonAbsence.checkedAt = '2026-10-17T15:03:00.000Z'; }, r => { r.forceAbandonRecovery.currentDaemonAbsence.checkedAt = '2026-10-17T15:06:00.000Z'; },
    r => { r.forceAbandonRecovery.subject.initialAbsence.health = 'timeout'; }, r => { r.forceAbandonRecovery.subject.installation.build = '8'.repeat(64); },
    r => { r.forceAbandonRecovery.subject.installation.configSha256 = 'bad'; }, r => { r.forceAbandonRecovery.subject.serverHeartbeat.clientBuild = '8'.repeat(64); },
    r => { r.forceAbandonRecovery.subject.serverHeartbeat.pid = 0; }, r => { r.forceAbandonRecovery.subject.serverHeartbeat.lastSeen = 'bad'; },
    r => { r.forceAbandonRecovery.subject.schemaVersion = 1; }, r => { r.forceAbandonRecovery.executionConfirmedStopped = true; },
  ]) {
    const run = forceAbandonFixture({ absent: true }); mutate(run); assert.equal(operatorForceAbandonRecovery(run), null, mutate.toString()); assert.equal(executionUncertain(run), true);
  }
});

test('new true in-flight or uncertain executions do not borrow the abandoned action receipt', () => {
  for (const run of [{ id: 'new-action', status: 'acked' }, { id: 'new-action', status: 'failed', result: { code: 'EXECUTION_UNCERTAIN', processExit: null } }]) {
    assert.equal(operatorForceAbandonRecovery(run), null); assert.equal(historicalPrelaunchRecovery(run), null);
    const bot = { control_state: 'active', configuration_state: 'initialized', latest_run: run };
    assert.equal(botPresence(bot).label, run.status === 'acked' ? '正在执行' : '执行待核实');
    const withOldReceipt = { ...run, forceAbandonRecovery: forceAbandonFixture().forceAbandonRecovery };
    assert.equal(operatorForceAbandonRecovery(withOldReceipt), null);
    assert.equal(executionUncertain(withOldReceipt), run.status !== 'acked');
  }
});
