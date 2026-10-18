import { createHash } from 'node:crypto';

const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

export function prelaunchFixture({ postUpdate = false } = {}) {
  const run = { id: 'original', type: 'conversation.execute', status: 'failed', error: '原始待核实失败', payload: { employeeId: 'employee', deviceId: 'device', profile: 'bot-profile', hermesBot: { workspace: 'workspace' } }, result: { code: 'EXECUTION_UNCERTAIN', executionState: 'uncertain', processExit: null, partialEffectsPossible: true } };
  const receipt = { schemaVersion: 1, kind: 'bot.historical_prelaunch_recovery', policy: '6666a63-bot-start-admission-prelaunch-v1', status: 'failed', executionState: 'not_started', recordedAt: '2026-10-18T00:00:00.000Z', localStartedAt: Date.parse('2026-10-17T00:00:00.000Z'), subject: { actionId: run.id, actionType: run.type, workspaceId: 'workspace-id', workspace: 'workspace', employeeId: 'employee', deviceId: 'device', profile: 'bot-profile', originalError: run.error }, admissionProof: { scope: 'conversation-runtime-root', phase: 'bot-start-admission', launched: false, partialEffectsPossible: true }, daemonExit: { stopped: true, pid: 123, creationTime: '2026-10-16T00:00:00.000Z', exitedAt: '2026-10-17T01:00:00.000Z' } };
  for (const key of ['id', 'sourceBuild', 'sourcePolicyDigest', 'subjectDigest', 'evidenceDigest', 'localEvidenceDigest']) receipt[key] = 'a'.repeat(64);
  if (postUpdate) {
    receipt.schemaVersion = 2; receipt.mode = 'post_update_holder'; receipt.policy = '6666a63-post-update-holder-prelaunch-v2';
    receipt.subject.failedEvent = { createdAt: '2026-10-17T00:00:01.000Z' };
    receipt.subject.maintenanceHolderBuild = '6c9345a699c977dcc69f396f2aee96e7ca96e38fc7c9f686b9b49217ae09c8d9'; receipt.subject.maintenanceHolderPid = 456;
    delete receipt.daemonExit;
    receipt.maintenanceHolderExit = { stopped: true, pid: 456, creationTime: '2026-10-17T03:00:00.000Z', exitedAt: '2026-10-17T04:00:00.000Z' };
    receipt.verifiedUpdateFinishedAt = '2026-10-17T02:00:00.000Z'; receipt.migrationEvidenceDigest = 'b'.repeat(64);
  }
  return { ...run, prelaunchRecovery: receipt };
}

export function forceAbandonFixture({ absent = false, nullHeartbeat = false } = {}) {
  const binding = { mode: 'owned_profile', profile: 'bot-e1bf33c85b1543b18ecd3d6a', templateProfile: 'default', ownershipId: '187b5fff-7df9-4ca8-87d3-980c0855e3c1', provisionActionId: 'action_4f59d06e-207d-4f17-aff8-d739ba138a3b' };
  const subject = { schemaVersion: 1, actionId: 'action_2805b4da-c082-49a2-b0f1-b43bdeb107fe', actionType: 'conversation.execute', workspace: 'bigtron', workspaceId: 'ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e', deviceId: 'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493', employeeId: 'employee_5f157a51-a8fa-483c-90df-53d44292b5d2', credentialId: 'fixture-credential-id', profile: binding.profile, profileBinding: binding, profileBindingDigest: digest(binding), dedupeKey: 'conversation:original-message', createdAt: '2026-10-17T10:37:20.955Z', ackedAt: '2026-10-17T10:37:25.701Z', completedAt: '2026-10-17T10:37:30.568Z', originalRevision: 3, originalControlEpoch: 5, currentRevision: 3, currentControlEpoch: 8, currentControlState: 'paused', currentEmployeeStatus: 'paused', originalActionSha256: 'b'.repeat(64), originalPayloadSha256: 'e09ffebdb7d2e775fc3a3712159d2076c26319977b8596f05f22c816c6848448', originalDeliveredPayloadDigest: 'c'.repeat(64), originalResultSha256: 'cd625b824e89339e813ee4c8f9b43e9101076b6af6585d4ed48ab5270f6a372f', originalResultDigest: '', originalError: '执行状态无法安全确认，需人工核实后处理：Bot 配置或控制状态已变化，请重新读取', failedEvent: { id: 'action-event_6c9a3e9aebb7d93cae4358455b7558c393d36d845877dade1ae62ea2d686e6b3', type: 'failed', createdAt: '2026-10-17T10:37:29.414Z', dataSha256: 'bec062593118dae53cfea8df2b533e59e5e6542d68e7e7fef33c37903fb3d857' }, grantId: 'fixture-force-abandon-grant', grantDigest: 'e'.repeat(64), holderBuild: 'c477b6bb9044ae181d97efaae9ee3188a985cc32805f5a8eedfe3df09660e341', holder: { pid: 27868, creationTime: '2026-10-17T15:00:00.000Z', nonce: 'f'.repeat(48), root: 'C:\\fixture\\ziwei', configSha256: '1'.repeat(64), stateSha256: '2'.repeat(64) } };
  const result = { processExit: null, partialEffectsPossible: true, code: 'EXECUTION_UNCERTAIN', executionState: 'uncertain', reason: 'EXECUTOR_WITHOUT_EXIT_EVIDENCE' };
  subject.originalResultDigest = digest(result);
  const run = { id: subject.actionId, agent_id: 'ziwei_user', type: subject.actionType, status: 'failed', dedupe_key: subject.dedupeKey, created_at: subject.createdAt, acked_at: subject.ackedAt, completed_at: subject.completedAt, error: subject.originalError, result, payload: { runtime: 'Hermes', employeeId: subject.employeeId, deviceId: subject.deviceId, profile: subject.profile, hermesBot: { employeeId: subject.employeeId, workspace: subject.workspace, deviceId: subject.deviceId, sourceProfile: subject.profile, revision: 3, controlEpoch: 5, instance: binding } } };
  const receipt = { schemaVersion: 1, kind: 'bot.operator_force_abandon', id: '', policy: 'zhiwei-operator-force-abandon-v1', policyDigest: '21c59abdb77f1a887c45110ba4ac89dcf6277f0f7a0af8a236aaa6d456271a37', subject, subjectDigest: '', grantId: subject.grantId, grantDigest: subject.grantDigest, evidenceDigest: '6'.repeat(64), localArchiveDigest: '7'.repeat(64), currentDaemonExit: { scope: 'daemon-root-only', stopped: true, pid: subject.holder.pid, creationTime: subject.holder.creationTime, exitedAt: '2026-10-17T15:05:00.000Z' }, resultingControlEpoch: 9, executionState: 'uncertain', disposition: 'abandoned_by_user', executionConfirmedStopped: false, partialEffectsPossible: true, recordedAt: '2026-10-17T15:05:01.000Z' };
  if (absent) {
    const { holder, holderBuild, ...originalSubject } = subject;
    const initialAbsence = { scope: 'current-daemon-holder', state: 'absent', health: 'connection_refused', nativeDaemonCount: 0, healthListenerCount: 0, checkedAt: '2026-10-17T15:04:00.000Z' };
    Object.assign(receipt, { schemaVersion: 2, mode: 'no_current_daemon', policy: 'zhiwei-operator-force-abandon-no-current-daemon-v2', policyDigest: 'c263b8afa4584dad4049a34cb9eac89a2d2f4beb96566d354a54f1f0a62e7a40', subject: { ...originalSubject, schemaVersion: 2, mode: 'no_current_daemon', installation: { build: holderBuild, root: holder.root, configSha256: holder.configSha256, stateSha256: holder.stateSha256 }, initialAbsence, serverHeartbeat: { clientBuild: holderBuild, pid: nullHeartbeat ? null : holder.pid, lastSeen: nullHeartbeat ? null : '2026-10-17T15:00:00.000Z', heartbeatAt: nullHeartbeat ? null : '2026-10-17T15:00:00.000Z' } }, currentDaemonAbsence: { ...initialAbsence, checkedAt: '2026-10-17T15:05:00.000Z' } });
    delete receipt.currentDaemonExit;
  }
  receipt.subjectDigest = digest(receipt.subject); receipt.id = digest({ actionId: run.id, subjectDigest: receipt.subjectDigest, evidenceDigest: receipt.evidenceDigest });
  return { ...run, forceAbandonRecovery: receipt };
}

