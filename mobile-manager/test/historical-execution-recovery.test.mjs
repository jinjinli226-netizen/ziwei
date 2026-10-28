import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prelaunchFixture, forceAbandonFixture, readOnlyObservationFixture } from './fixtures/historical-recovery.mjs';
import { historicalPrelaunchRecovery, HISTORICAL_PRELAUNCH_RECOVERY_DETAIL } from '../web/historical-prelaunch-recovery.mjs';
import { operatorForceAbandonRecovery, OPERATOR_FORCE_ABANDON_DETAIL } from '../web/operator-force-abandon-recovery.mjs';
import { botPresence, botStopPresentation, botRecoveryEvent, botRecoveryDetail, executionUncertain, executionOccupiesSlot, processExitConfirmed } from '../web/bot-presentation.js';
import { exitedReadOnlyPhoneObservation } from '../web/bot-execution-occupancy.mjs';
import { blockingChatExecution, initialState } from '../web/model.js';

const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);

test('mobile historical recovery validators match the desktop contract with repository LF line endings', async () => {
  for (const name of ['historical-prelaunch-recovery.mjs', 'operator-force-abandon-recovery.mjs']) {
    const mobile = await readFile(new URL(`../web/${name}`, import.meta.url), 'utf8');
    const desktop = await readFile(new URL(`../../frontend/src/${name}`, import.meta.url), 'utf8');
    assert.equal(mobile, desktop.replace(/\r\n/g, '\n').replace(/\n+$/, '\n'), name);
    assert.doesNotMatch(mobile, /\r/, 'packaged web resources use the Git LF bytes');
  }
});

test('the mobile occupancy exception uses the exact server contract from authority commit 794211e', async () => {
  const bytes = await readFile(new URL('../web/bot-execution-occupancy.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '4a3cd7a5c5a4460e639f794238057d4058a71bf0f91904902f20737fa8649d1f');
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

const observationState = (run, overrides = {}) => ({ ...initialState(), phase: 'ready', workspace: { id: 'observation-workspace-id', slug: 'observation-workspace' }, selectedEmployee: { id: 'observation-employee', target_device_id: 'observation-pc', runtime_profile: 'observation-profile' }, conversation: { id: 'original-chat', employee_id: 'observation-employee', execution: { id: 'new-success', status: 'succeeded' } }, runs: [run], bot: { id: 'observation-employee', workspace: 'observation-workspace', latest_run: { id: 'new-success', status: 'succeeded' } }, ...overrides });

test('567 original receipts release only the matching historical slot while preserving every unknown result and retained process', () => {
  const run = readOnlyObservationFixture(), before = canonical(run);
  assert.equal(run.result.terminalMcp.toolCalls.length, 567); assert.equal(exitedReadOnlyPhoneObservation(run), true);
  assert.equal(executionOccupiesSlot(run), false); assert.equal(executionUncertain(run), true);
  assert.equal(processExitConfirmed(run.result), false); assert.equal(run.result.processExit.treeConfirmed, false); assert.equal(run.result.processExit.activeProcesses, 3);
  assert.equal(blockingChatExecution(observationState(run)), null); assert.equal(canonical(run), before);
  assert.match(run.error, /phone observation remains unknown/); assert.equal(run.result.executionState, 'uncertain');
  assert.equal(botPresence({configuration_state:'initialized',control_state:'active',latest_run:run}).label,'上次结果待核实');
  assert.match(botRecoveryDetail(run),/只读观察.*待核实/);
  const stop=botStopPresentation({latest_run:run});
  assert.equal(stop.confirmed,false);assert.equal(stop.released,true);assert.equal(stop.ended,undefined);
  assert.doesNotMatch(stop.label,/进程树退出|已停止|已完成|成功/);
  const sameConversation = observationState(run); sameConversation.conversation.execution = run;
  assert.equal(blockingChatExecution(sameConversation), null);
  const withoutDatabaseId = structuredClone(run); delete withoutDatabaseId.workspace_id;
  assert.equal(blockingChatExecution(observationState(withoutDatabaseId)), null, 'ordinary API action views retain full binding without workspace_id');
});

test('new successful replies cannot release unknown writes, missing native evidence or unrelated uncertainty', () => {
  const variants = [
    a => { const c = a.result.terminalMcp.toolCalls.find(c => c.toolName === 'ziwei_phone_action'); delete c.commandId; delete c.ids.commandId; c.ok = false; c.commandExecutionState = 'uncertain'; },
    a => { for (const c of a.result.terminalMcp.toolCalls) if (c.commandId === 'write-0') { c.status = c.commandStatus = 'queued'; c.commandExecutionState = 'pending'; } },
    a => { a.result.terminalMcp.toolCalls.findLast(c => c.commandId === 'write-0').commandExecutionState = 'uncertain'; },
    a => { a.result.terminalMcp.toolCalls.push({ toolName: 'ziwei_phone_upgrade', ok: false, error: 'Original response lost' }); },
    a => { a.result.terminalMcp.toolCalls.push({ toolName: 'ziwei_phone_upgrade', ok: true, updateId: 'pending-upgrade', updateStatus: 'awaiting_health' }); },
    a => { a.result.terminalMcp.toolCalls.push({ toolName: 'ziwei_phone_control', ok: true }); },
    a => { a.result.code = 'EXECUTION_UNCERTAIN'; }, a => { a.result.processExit.rootConfirmed = false; },
    a => { a.result.processExit.rootExitCode = null; a.result.code = null; }, a => { a.result.processExit.streamsComplete = false; },
    a => { a.result.processExit.cancelled = true; }, a => { a.result.processExit.failureCode = 'WINDOWS_JOB_UNKNOWN'; },
    a => { delete a.result.processExit.backgroundProcessesRetained; }, a => { a.result.processExit.activeProcesses = 0; },
    a => { a.result.nativeOperation = { status: 'uncertain' }; }, a => { a.result.supervision = { rootConfirmed: false }; },
    a => { a.result.residentExit = { treeConfirmed: false }; }, a => { a.result.quarantined = true; },
    a => { a.result.other = { executionState: 'uncertain' }; }, a => { a.result.futureEvidence = { safe: true }; },
    a => { a.result.managementMcp.toolCalls.push({ toolName: 'ziwei_update_employee', ok: true }); },
    a => { a.result.managementMcp.toolCalls.push({ toolName: 'ziwei_get_employee', ok: false }); },
    a => { delete a.result.managementMcp; }, a => { delete a.result.terminalMcp; },
    a => { a.result.terminalMcp.tool_calls = []; }, a => { a.result.terminalMcp.actionId = 'another-action'; },
    a => { a.result.terminalMcp.employeeId = 'another-employee'; }, a => { a.result.terminalMcp.workspace = 'another-workspace'; },
    a => { a.result.terminalMcp.profile = 'another-profile'; }, a => { a.result.terminalMcp.toolCalls[0].deviceId = 'another-phone'; },
    a => { a.payload.terminalMcp.deviceId = 'another-phone'; }, a => { a.payload.deviceId = 'another-pc'; },
    a => { a.result.botIsolation.key = 'another-owner'; }, a => { a.result.terminalMcp.loaded = false; },
    a => { a.result.fixture = true; }, a => { a.status = 'cancelled'; },
  ];
  for (const mutate of variants) {
    const run = readOnlyObservationFixture(); mutate(run); const before = canonical(run), state = observationState(run);
    assert.equal(exitedReadOnlyPhoneObservation(run), false, mutate.toString());
    assert.equal(executionUncertain(run), true); assert.equal(executionOccupiesSlot(run), true);
    assert.equal(blockingChatExecution(state), run, 'new success cannot erase another original blocker'); assert.equal(canonical(run), before);
  }
});

test('generic released markers, an incomplete management summary and receipts nested in events are never release authority', () => {
  const complete = readOnlyObservationFixture();
  for (const run of [
    { id: complete.id, status: 'failed', payload: complete.payload, result: { executionState: 'uncertain' }, released: true },
    { id: complete.id, status: 'failed', payload: complete.payload, result: { executionState: 'uncertain' }, executionOccupancy: { state: 'released' } },
    { ...complete, result: { executionState: 'uncertain' }, managementSummary: { detailsOmitted: true } },
    { ...complete, result: { executionState: 'uncertain' }, events: [{ type: 'failed', data: { result: complete.result } }] },
  ]) {
    assert.equal(executionOccupiesSlot(run), true); assert.equal(blockingChatExecution(observationState(run)), run);
  }
});

test('a historical observation does not release a real pending or unknown execution in another chat of the same employee', () => {
  const history = readOnlyObservationFixture();
  for (const status of ['pending', 'queued', 'acked', 'running', 'executing', 'uncertain', 'expired']) {
    const run = { id: 'another-chat-action', status, acked_at: '2026-10-19T10:00:00Z', payload: { employeeId: 'observation-employee', conversationId: 'another-chat', hermesBot: { workspace: 'observation-workspace' } } };
    const state = observationState(history, { runs: [history, run] });
    assert.equal(blockingChatExecution(state), run, status);
  }
  const otherUnknown = { id: 'different-unknown', status: 'failed', payload: { employeeId: 'observation-employee', conversationId: 'another-chat' }, result: { code: 'EXECUTION_UNCERTAIN' } };
  assert.equal(blockingChatExecution(observationState(history, { runs: [history, otherUnknown] })), otherUnknown);
});

test('observation release must match current employee, computer, profile and workspace scope', () => {
  const run = readOnlyObservationFixture();
  for (const expected of [{ workspace: 'foreign' }, { workspaceId: 'foreign' }, { employeeId: 'foreign' }, { deviceId: 'foreign' }, { profile: 'foreign' }]) assert.equal(executionOccupiesSlot(run, expected), true);
  for (const field of ['target_device_id', 'runtime_profile']) {
    const state = observationState(run); state.selectedEmployee[field] = 'changed-binding';
    assert.equal(blockingChatExecution(state), run, field);
  }
});
