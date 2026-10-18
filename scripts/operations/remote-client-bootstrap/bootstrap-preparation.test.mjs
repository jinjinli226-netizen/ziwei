import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { LI_BOOTSTRAP_ROOT, LI_BOOTSTRAP_PREFIX, validateLiBootstrapPins, normalizedLiBootstrapEnvironment, bootstrapIdleObservation, writeBootstrapIdleObservation, withBootstrapPause, resumeOriginalBootstrap, liBootstrapIdle, startLiBootstrap } from './bootstrap-li-worker.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const script = fs.readFileSync(path.join(here, 'register-li-bootstrap.ps1'), 'utf8');
const plan = JSON.parse(fs.readFileSync(path.join(here, 'bootstrap-li-plan.template.json'), 'utf8'));
// Synthetic scope facts only; no live machine nonce, config hash, or private plan.
const isolatedPlan = () => ({ ...plan, nonce: '11111111-1111-4111-8111-111111111111', sourcePid: 4242, sourceNonce: 'isolated-fixture-source-nonce', sourceBuild: '1'.repeat(64), configSha256: '2'.repeat(64), jobDirectory: path.win32.join(plan.userDirectory, 'maintenance', 'remote-bootstrap-11111111-1111-4111-8111-111111111111') });
const user = String.raw`C:\Users\25941`;
test('PowerShell literal Windows paths contain one separator, not JavaScript-style escapes', () => {
  const constants = [...script.matchAll(/'(C:[^']*)'/g)].map(match => match[1]);
  assert(constants.length >= 3);
  assert(constants.includes(user));
  for (const value of constants) { assert.equal(value.includes('\\\\'), false); assert.equal(path.win32.normalize(value), value); }
  assert(script.includes("'System32\\WindowsPowerShell\\v1.0\\powershell.exe'"));
  assert(script.includes("'maintenance\\remote-bootstrap-'"));
});
test('JSON-decoded plan paths exactly match the PowerShell literals and expected user scope', () => {
  assert.equal(plan.userProfile, user);
  assert.equal(plan.userDirectory, path.win32.join(user, 'AppData/Local/Ziwei/ziwei_user'));
  assert.equal(plan.configPath, path.win32.join(plan.userDirectory, 'ziwei_user.json'));
  assert.equal(plan.root, String.raw`D:\work\nodejs\node_global\node_modules\ziwei`);
  assert.equal(LI_BOOTSTRAP_ROOT, plan.root);
  assert(script.includes("'D:\\work\\nodejs\\node_global\\node_modules\\ziwei'"));
  for (const key of ['userProfile', 'userDirectory', 'configPath', 'root']) assert.equal(plan[key].includes('\\\\'), false);
});
test('atomic PowerShell status replacement uses a unique real backup and retains prior status', () => {
  assert(!script.includes('[IO.File]::Replace($temporary,$target,$null)'));
  assert(script.includes("$backup=$target+'.backup-'+[guid]::NewGuid().ToString('N')"));
  assert(script.includes('NoLink $backup'));
  assert(script.includes("Need (!(Test-Path -LiteralPath $backup)) 'BOOTSTRAP_STATUS_BACKUP_CONFLICT'"));
  assert(script.includes('[IO.File]::Replace($temporary,$target,$backup)'));
  assert(!/Remove-Item[^\r\n]*\$backup|Delete\(\$backup\)/.test(script));
});
test('bootstrap preparation remains scoped to Li and defaults to non-executing validation', () => {
  assert(script.includes("[string]$Mode='Validate'"));
  assert.equal(plan.deviceId, 'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493');
  assert(script.includes(plan.deviceId));
  assert(!script.includes('device_11af6d85-6c5c-4cbe-9a25-31599a474e5d'));
  assert(script.includes('$definition.Principal.RunLevel=0'));
  assert(script.includes('$definition.Settings.RestartCount=0'));
  assert(!/Stop-Process|taskkill|\.Kill\(|Register-ScheduledTask[^\r\n]*-Force/.test(script));
});
test('the frozen real Li custom installation is accepted and the Company/default root is rejected', () => {
  const frozen = isolatedPlan();
  const options = { platform: 'win32', env: { USERPROFILE: user }, nodeExe: String.raw`C:\Program Files\nodejs\node.exe` };
  assert.doesNotThrow(() => validateLiBootstrapPins(frozen, options));
  assert.throws(() => validateLiBootstrapPins({ ...frozen, root: path.win32.join(user, 'AppData/Roaming/npm/node_modules/ziwei') }, options), { code: 'BOOTSTRAP_SCOPE_INVALID' });
  assert.throws(() => validateLiBootstrapPins({ ...frozen, root: String.raw`C:\Users\PC\AppData\Roaming\npm\node_modules\ziwei` }, options), { code: 'BOOTSTRAP_SCOPE_INVALID' });
  assert.throws(() => validateLiBootstrapPins({ ...frozen, ownerSid: 'S-1-5-21-1' }, options), { code: 'BOOTSTRAP_USER_INVALID' });
});
test('only the child process npm prefix is normalized with case-duplicate keys removed', () => {
  const inherited = { npm_config_prefix: 'wrong-one', NPM_CONFIG_PREFIX: 'wrong-two', NpM_cOnFiG_pReFiX: 'wrong-three', USERPROFILE: user, HOME: 'preserve-home', ANOTHER_SETTING: 'preserve' };
  const before = { ...inherited }, result = normalizedLiBootstrapEnvironment(plan, inherited);
  assert.deepEqual(inherited, before);
  assert.deepEqual(Object.keys(result).filter(key => key.toLowerCase() === 'npm_config_prefix'), ['npm_config_prefix']);
  assert.equal(result.npm_config_prefix, LI_BOOTSTRAP_PREFIX);
  assert.equal(result.HOME, inherited.HOME); assert.equal(result.ANOTHER_SETTING, inherited.ANOTHER_SETTING);
  assert.equal(result.ZIWEI_USER_HOME, plan.userDirectory); assert.equal(result.ZIWEI_CONFIG, plan.configPath);
  assert(!/SetEnvironmentVariable\([^\r\n]*,'(User|Machine)'\)/.test(script));
  assert(script.includes("[Environment]::SetEnvironmentVariable('npm_config_prefix','D:\\work\\nodejs\\node_global','Process')"));
});
test('idle observations are bounded state facts without private configuration or token fields', () => {
  const row = { pid: 34836, clientBuild: 'a'.repeat(64), connectionState: 'connected', activeActionCount: 1, pollingCount: 0, quarantinedActionCount: 0, config: 'PRIVATE_CONFIG', deviceToken: 'PRIVATE_TOKEN', lifecycle: { nonce: 'PRIVATE_NONCE' }, maintenance: { stopSafe: false, gatewaySafe: true, stopIssues: [{ code: 'ACTION_STATE_CORRUPT', count: 1, path: 'PRIVATE_PATH' }, { code: 'bad private label', count: 2 }] } };
  const value = bootstrapIdleObservation(row, 'waiting_idle');
  assert.equal(value.activeActionCount, 1); assert.equal(value.stopSafe, false); assert.equal(value.phase, 'waiting_idle');
  assert.deepEqual(value.stopIssues, [{ code: 'ACTION_STATE_CORRUPT', count: 1 }]);
  assert(!/PRIVATE_|deviceToken|lifecycle|nonce|config/.test(JSON.stringify(value)));
  assert.equal('failed' in value, false);
  assert.equal(bootstrapIdleObservation({ activeActionCount: Infinity, maintenance: {} }, 'waiting_idle').activeActionCount, null);
});
test('observations write only when state changes and retain previous facts in the own job directory', t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-li-idle-observation-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binding = { jobDirectory: directory }, row = { pid: 34836, connectionState: 'connected', activeActionCount: 1, pollingCount: 0, quarantinedActionCount: 0, maintenance: { stopSafe: false, gatewaySafe: true, stopIssues: [] } };
  assert.equal(writeBootstrapIdleObservation(binding, row, 'waiting_idle'), true);
  assert.equal(writeBootstrapIdleObservation(binding, row, 'waiting_idle'), false);
  assert.equal(writeBootstrapIdleObservation(binding, { ...row, activeActionCount: 0, maintenance: { ...row.maintenance, stopSafe: true } }, 'waiting_idle'), true);
  const history = fs.readdirSync(directory).filter(name => /^idle-observation-.*\.json$/.test(name)); assert.equal(history.length, 2);
  const latest = JSON.parse(fs.readFileSync(path.join(directory, 'idle-observation.json'))); assert.equal(latest.activeActionCount, 0); assert.equal(latest.stopSafe, true);
  assert(fs.readdirSync(directory).every(name => name.endsWith('.json')));
});
test('a pause applied before its response is lost resumes only the exact original boot', async () => {
  const binding = isolatedPlan();
  for (const changeNonce of [false, true]) {
    const calls = [], row = { service: 'ziwei_user', agentId: 'ziwei_user', workspace: binding.workspace, deviceId: binding.deviceId, clientBuild: binding.sourceBuild, pid: binding.sourcePid, connectionState: 'connected', lifecycle: { root: binding.root, configPath: binding.configPath, configSha256: binding.configSha256, nonce: binding.sourceNonce } };
    const controlImpl = async (_plan, operation) => {
      calls.push(operation);
      if (operation === 'pause') { row.connectionState = 'draining'; if (changeNonce) row.lifecycle.nonce = 'another-boot-nonce'; throw Object.assign(new Error('PRIVATE_TIMEOUT'), { code: 'ETIMEDOUT' }); }
      row.connectionState = 'connected';
    };
    let bodyCalled = false;
    await assert.rejects(withBootstrapPause(binding, async () => { bodyCalled = true; }, { controlImpl, resumeImpl: plan => resumeOriginalBootstrap(plan, { healthImpl: async () => row, controlImpl }) }), { code: 'ETIMEDOUT' });
    assert.equal(bodyCalled, false); assert.deepEqual(calls, changeNonce ? ['pause'] : ['pause', 'resume']);
    assert.equal(row.connectionState, changeNonce ? 'draining' : 'connected');
  }
});
test('historical stop safety remains observable and is decided by the official updater recovery', () => {
  const row = { activeActionCount: 0, pollingCount: 0, quarantinedActionCount: 0, executionQuarantined: false, connectionErrors: [], maintenance: { stopSafe: false, gatewaySafe: true, stopIssues: [{ code: 'ACTION_STATE_CORRUPT' }] } };
  assert.equal(liBootstrapIdle(row), true);
  assert.equal(bootstrapIdleObservation(row, 'waiting_idle').stopSafe, false);
  assert.deepEqual(bootstrapIdleObservation(row, 'waiting_idle').stopIssues, [{ code: 'ACTION_STATE_CORRUPT' }]);
  for (const change of [{ activeActionCount: 1 }, { pollingCount: 1 }, { quarantinedActionCount: 1 }, { executionQuarantined: true }, { connectionErrors: [{}] }, { maintenance: { gatewaySafe: false, stopSafe: true } }]) assert.equal(liBootstrapIdle({ ...row, ...change }), false);
  const worker = fs.readFileSync(path.join(here, 'bootstrap-li-worker.mjs'), 'utf8');
  assert(worker.includes('await updater.launchClientUpdate('));
  assert(!/\.kill\(|\.Kill\(|Stop-Process|taskkill|stopClient\(|stopSafe\s*:\s*true/.test(worker));
});
test('the actual bootstrap start path reaches only the official queue for inactive historical file issues', async () => {
  const binding = isolatedPlan();
  for (const activeChange of [null, { activeActionCount: 1 }, { pollingCount: 1 }, { quarantinedActionCount: 1 }, { executionQuarantined: true }, { maintenance: { gatewaySafe: false, stopSafe: false } }]) {
    const row = { service: 'ziwei_user', agentId: 'ziwei_user', workspace: binding.workspace, deviceId: binding.deviceId, clientBuild: binding.sourceBuild, pid: binding.sourcePid, connectionState: 'connected', lifecycle: { root: binding.root, configPath: binding.configPath, configSha256: binding.configSha256, nonce: binding.sourceNonce }, activeActionCount: 0, pollingCount: 0, quarantinedActionCount: 0, executionQuarantined: false, connectionErrors: [], maintenance: { gatewaySafe: true, stopSafe: false, stopIssues: [{ code: 'ACTION_STATE_CORRUPT' }] }, ...(activeChange || {}) };
    let clock = 0, pauses = 0, queues = 0, downloads = 0; const observations = [];
    const run = () => startLiBootstrap(binding, { readConnection: () => {}, readHealth: async () => row, recordObservation: (_plan, value, phase) => observations.push(bootstrapIdleObservation(value, phase)), exists: () => false, writeRecord: () => {}, now: () => clock, wait: async () => { clock += 20; }, idleTimeoutMs: 10, pauseBoundary: async (_plan, body) => { pauses++; row.connectionState = 'draining'; return body(); }, loadUpdater: async () => ({ downloadVerifiedPackage: async value => { downloads++; assert.equal(value.sha256, binding.archiveSha256); }, launchClientUpdate: async value => { queues++; assert.equal(value.root, binding.root); assert.equal(value.args.package.endsWith('bootstrap-client.tgz'), true); assert.equal(value.args.sha256, binding.archiveSha256); assert.equal('force' in value.args, false); return { workerPid: 42, resultFile: 'own-update-result' }; } }) });
    if (activeChange) { await assert.rejects(run(), { code: 'BOOTSTRAP_IDLE_TIMEOUT' }); assert.equal(pauses, 0); assert.equal(queues, 0); assert.equal(downloads, 0); }
    else { assert.equal((await run()).state, 'queued'); assert.equal(pauses, 1); assert.equal(queues, 1); assert.equal(downloads, 1); assert(observations.some(value => value.stopSafe === false)); }
  }
});
test('task boundary uses the unique real scheduler instance without querying protected parent images', () => {
  const helper = script.slice(script.indexOf('function TaskInstance('), script.indexOf('function Status('));
  assert(helper.includes('$task=TaskOrNull;Need (OwnTask $task)'));
  assert(helper.includes('$instances=$task.GetInstances(0)'));
  assert(helper.includes('$instances.Count -eq 1'));
  assert(helper.includes('$instance=$instances.Item(1);$null=$instance.Refresh()'));
  assert(helper.includes("[int]$instance.State -eq 4 -and [string]$instance.Path -ceq ('\\'+$TaskName)"));
  assert(helper.includes('[guid]::TryParse([string]$instance.InstanceGuid,[ref]$instanceGuid) -and $instanceGuid -ne [guid]::Empty'));
  assert(helper.includes("$parent.Name -iin @('svchost.exe','taskeng.exe','taskhostw.exe')"));
  assert(helper.includes('$enginePid -gt 0 -and ($enginePid -eq $PID -or $enginePid -eq [int]$self.ParentProcessId)'));
  assert(helper.includes("throw 'BOOTSTRAP_TASK_INSTANCE_UNAVAILABLE'"));
  assert(!/ParentImage|OpenProcess|QueryFullProcessImageName|Add-Type|SeDebug|AdjustTokenPrivileges|TerminateProcess/.test(script));
});
test('scheduler binding is checked twice, retaining the same instance before starting the worker', () => {
  const helper = script.slice(script.indexOf('function TaskInstance('), script.indexOf('function Status('));
  for (const key of ['instanceGuid', 'enginePid', 'selfPid', 'parentPid']) assert(helper.includes(`$binding.${key} ${key === 'instanceGuid' ? '-ceq' : '-eq'} $expected.${key}`));
  assert(helper.includes("'BOOTSTRAP_TASK_INSTANCE_CHANGED'"));
  const boundary = script.slice(script.indexOf("$Stage='verify_task_boundary'"), script.indexOf("$Stage='observe_own_official_update'"));
  assert(boundary.includes('(OwnTask (TaskOrNull))'));
  assert(boundary.includes('$TaskBoundary=TaskInstance $null'));
  assert(boundary.includes("$Stage='verify_task_boundary_before_start';$null=TaskInstance $TaskBoundary"));
  assert(boundary.indexOf('$TaskBoundary=TaskInstance $null') < boundary.indexOf("Status 'waiting_idle'"));
  assert(boundary.indexOf('$null=TaskInstance $TaskBoundary') > boundary.indexOf("Status 'waiting_idle'"));
  assert(boundary.indexOf('$null=TaskInstance $TaskBoundary') < boundary.indexOf('& $Plan.nodeExe $OwnWorker $OwnPlan --start'));
  for (const evidence of ['$taskSid -ceq $Sid', '$principal.LogonType -eq 3', '$principal.RunLevel -eq 0', "('Ziwei Li bootstrap '+$RegistrationHash)", '$task.Definition.Actions.Count -eq 1', '$task.Definition.Actions.Item(1).Arguments -ceq $Arguments', '$task.Definition.Settings.MultipleInstances -eq 2']) assert(script.includes(evidence));
});
