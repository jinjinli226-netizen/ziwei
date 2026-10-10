import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultUserDir, resolveConfigPath, resolveDaemonDataDirectory } from '../daemon/config.mjs';
import { clientBuildIdentity } from '../src/management-bootstrap.mjs';

const run = promisify(execFile);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const psQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
const failure = (code, message) => Object.assign(new Error(message), { code });
function windowsOnly() { if (process.platform !== 'win32') throw failure('WINDOWS_ONLY', 'stop/uninstall 当前仅支持 Windows，未修改此平台客户端'); }
function within(file, root) { const relative = path.relative(path.resolve(root), path.resolve(file)); return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); }
function assertOutside(file, root) { if (within(file, root)) throw failure('USERDATA_IN_PACKAGE', '用户配置或数据仍在程序目录内，拒绝卸载；请先迁移到持久用户目录'); }
function noLinks(file) { for (let current = path.resolve(file); ; current = path.dirname(current)) { let stat; try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; } if (stat?.isSymbolicLink()) throw failure('UNSAFE_PATH', '维护路径包含链接，未修改客户端'); if (current === path.dirname(current)) break; } }
function readConfiguration(file) { let bytes; try { bytes = fs.readFileSync(file); } catch (error) { if (error.code === 'ENOENT') return { config: {}, hash: null }; throw failure('CONFIG_UNREADABLE', '本机配置无法读取，未停止客户端'); } try { return { config: JSON.parse(bytes), hash: digest(bytes) }; } catch { throw failure('CONFIG_INVALID', '本机配置不是有效 JSON，未停止客户端'); } }

/** Windows command-line parsing, without executing or echoing its arguments. */
export function windowsCommandArguments(value) {
  const result = []; let token = '', quoted = false, present = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\') { let count = 1; while (value[i + 1] === '\\') { count++; i++; } if (value[i + 1] === '"') { token += '\\'.repeat(Math.floor(count / 2)); i++; if (count % 2) token += '"'; else quoted = !quoted; } else token += '\\'.repeat(count); present = true; }
    else if (char === '"') { quoted = !quoted; present = true; }
    else if (/\s/.test(char) && !quoted) { if (present) { result.push(token); token = ''; present = false; } }
    else { token += char; present = true; }
  }
  if (quoted) return []; if (present) result.push(token); return result;
}

async function powershell(code) {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' + code], { encoding: 'utf8', timeout: 6000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : null;
}
export async function inspectNativeClientProcess(pid, root) {
  windowsOnly();
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw failure('PID_MISMATCH', '目标 PID 不属于可停止的本机 daemon');
  const record = await powershell(`Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; executable=$_.ExecutablePath; command=$_.CommandLine; creationTime=$_.CreationDate.ToUniversalTime().ToString('o') } } | ConvertTo-Json -Compress`);
  if (!record) return null;
  const args = windowsCommandArguments(String(record.command || ''));
  if (!samePath(record.executable, process.execPath) || args.length !== 2 || !samePath(args[0], process.execPath) || !samePath(args[1], path.join(root, 'daemon', 'ziwei_user.mjs')) || !Number.isFinite(Date.parse(record.creationTime))) throw failure('PROCESS_IDENTITY_MISMATCH', '目标 PID 的 Node 路径、入口或创建时间不属于此安装，拒绝停止');
  return { pid, creationTime: record.creationTime, commandHash: digest(String(record.command)), executable: record.executable };
}
async function assertProcessUnchanged(before, root) { const current = await inspectNativeClientProcess(before.pid, root); if (!current || current.creationTime !== before.creationTime || current.commandHash !== before.commandHash) throw failure('PROCESS_CHANGED', 'daemon PID 或进程身份已变化，拒绝停止'); return current; }
async function findNativePids(root) {
  const records = await powershell("Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; executable=$_.ExecutablePath; command=$_.CommandLine } } | ConvertTo-Json -Compress");
  return (Array.isArray(records) ? records : records ? [records] : []).filter(record => { const args = windowsCommandArguments(String(record.command || '')); return samePath(record.executable, process.execPath) && args.slice(1).some(argument => samePath(argument, path.join(root, 'daemon', 'ziwei_user.mjs'))); }).map(record => record.pid);
}
function healthOrigin(config, env) {
  let host = String(config.healthHost || env.ZIWEI_HEALTH_HOST || '127.0.0.1');
  if (host === 'localhost') host = '127.0.0.1';
  if (!['127.0.0.1', '::1', '[::1]'].includes(host)) throw failure('NON_LOCAL_CONTROL', '维护命令只连接明确的本机 loopback 地址');
  const port = Number(config.healthPort || env.ZIWEI_HEALTH_PORT || 20242);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw failure('INVALID_HEALTH_PORT', '本机健康端口无效');
  return `http://${host.includes(':') ? '[::1]' : host}:${port}`;
}
async function health(origin) {
  let response;
  try { response = await fetch(origin + '/healthz', { redirect: 'error', signal: AbortSignal.timeout(1500) }); }
  catch (error) { if (error.cause?.code === 'ECONNREFUSED') return null; throw failure('HEALTH_UNREACHABLE', '本机健康接口无法安全核验，未停止任何进程'); }
  if (!response.ok) throw failure('FOREIGN_LISTENER', '本机健康端口存在无法核验的服务，未停止任何进程');
  try { return await response.json(); } catch { throw failure('FOREIGN_LISTENER', '本机健康端口返回未知格式，未停止任何进程'); }
}
function validateHealth(body, { root, file, snapshot, build, expectedPid, expectedNonce, pinned, processRecord }) {
  if (body?.service !== 'ziwei_user' || body.agentId !== 'ziwei_user' || !Number.isSafeInteger(body.pid) || body.pid <= 0 || body.workspace !== (snapshot.config.workspace || '') || body.deviceId !== snapshot.config.deviceId || body.clientBuild !== build || !Number.isSafeInteger(body.activeActionCount) || body.activeActionCount < 0 || !Number.isSafeInteger(body.pollingCount) || body.pollingCount < 0) throw failure('CLIENT_IDENTITY_MISMATCH', 'daemon 的工作区、设备、build 或执行状态不匹配，拒绝停止');
  if (expectedPid !== undefined && body.pid !== expectedPid) throw failure('PID_MISMATCH', '当前 daemon PID 与指定 PID 不一致');
  if (pinned && body.pid !== pinned.pid) throw failure('PROCESS_CHANGED', 'daemon PID 已变化，拒绝停止');
  if (body.lifecycle !== undefined) {
    const value = body.lifecycle;
    if (!value || !/^[A-Za-z0-9_-]{16,128}$/.test(value.nonce || '') || !samePath(value.root, root) || !samePath(value.configPath, file) || value.configSha256 !== snapshot.hash || !Number.isFinite(Date.parse(value.startedAt)) || value.managedAuxiliaryCount !== 0 || (expectedNonce !== undefined && value.nonce !== expectedNonce) || (pinned?.lifecycle && value.nonce !== pinned.lifecycle.nonce) || (processRecord && Math.abs(Date.parse(value.startedAt) - Date.parse(processRecord.creationTime)) > 15000)) throw failure('LIFECYCLE_IDENTITY_MISMATCH', 'daemon 实例 nonce、配置、辅助进程或启动身份不匹配，拒绝停止');
  } else if (expectedNonce !== undefined || pinned?.lifecycle) throw failure('LIFECYCLE_DOWNGRADE', 'daemon 实例 nonce 缺失，拒绝降级停止');
  return body;
}
async function boundLegacyTermination(record, root) {
  await assertProcessUnchanged(record, root);
  // Hold a Windows process handle before the final checks. Kill uses that handle,
  // so a reused numeric PID can never redirect termination to a new process.
  await powershell(`$p=Get-Process -Id ${record.pid} -ErrorAction Stop; $handle=$p.Handle; $c=Get-CimInstance Win32_Process -Filter 'ProcessId = ${record.pid}'; if(!$c -or $c.CreationDate.ToUniversalTime().ToString('o') -ne ${psQuote(record.creationTime)} -or [Math]::Abs(($p.StartTime.ToUniversalTime()-$c.CreationDate.ToUniversalTime()).TotalMilliseconds) -gt 2 -or $c.ExecutablePath -ine ${psQuote(process.execPath)} -or $c.CommandLine -cne ${psQuote(record.command || '')}) { throw 'Process identity changed' }; $p.Kill(); [pscustomobject]@{stopped=$true}|ConvertTo-Json -Compress`);
}

/** Stop preserves pairing/config/auth/state. It never starts or forgets a client. */
export async function stopClient({ root, env = process.env, configPath, expectedPid, expectedNonce, expectedBuild, timeoutMs = 30000, drainTimeoutMs, shutdownTimeoutMs = 8000 } = {}) {
  windowsOnly(); root = path.resolve(root); noLinks(root);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || !Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs < 1 || (drainTimeoutMs !== undefined && (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs < 1))) throw failure('INVALID_TIMEOUT', '停止超时参数无效');
  const file = configPath ? path.resolve(configPath) : resolveConfigPath({ root, env }); noLinks(file);
  const snapshot = readConfiguration(file), origin = healthOrigin(snapshot.config, env), build = expectedBuild || clientBuildIdentity(root);
  if (!/^[a-f0-9]{64}$/.test(build)) throw failure('BUILD_INVALID', '客户端 build 身份无效');
  let initial = await health(origin);
  if (!initial) {
    if (expectedPid !== undefined && await inspectNativeClientProcess(expectedPid, root)) throw failure('HEALTH_MISSING', '指定 daemon 仍存活但健康接口缺失，拒绝停止');
    if ((await findNativePids(root)).length) throw failure('HEALTH_MISSING', '此安装仍有未核验 daemon，拒绝报告已停止');
    return { stopped: true, alreadyStopped: true, wasRunning: false, pid: null };
  }
  const context = { root, file, snapshot, build, expectedPid, expectedNonce };
  validateHealth(initial, context);
  const record = await inspectNativeClientProcess(initial.pid, root); if (!record) throw failure('PROCESS_MISSING', '健康接口的 daemon 进程已退出');
  validateHealth(initial, { ...context, processRecord: record });
  // Keep the actual command privately only for the final handle-bound legacy check.
  const commandRecord = await powershell(`Get-CimInstance Win32_Process -Filter 'ProcessId = ${record.pid}' | Select-Object CommandLine | ConvertTo-Json -Compress`);
  record.command = commandRecord?.CommandLine;
  if (typeof record.command !== 'string' || digest(record.command) !== record.commandHash) throw failure('PROCESS_CHANGED', 'daemon 进程入口已变化');
  if (!snapshot.config.deviceToken) throw failure('CONTROL_AUTH_MISSING', '运行实例缺少本机控制凭据，拒绝停止');
  const assertConfig = () => { if (readConfiguration(file).hash !== snapshot.hash) throw failure('CONFIG_CHANGED', '停止期间配置已变化，未覆盖或删除用户配置'); };
  let paused = false;
  const control = async (operation, allowConfigurationChange = false) => {
    const response = await fetch(origin + '/local/connection-control', { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-ziwei-local-control': snapshot.config.deviceToken }, body: JSON.stringify({ operation, ...(initial.lifecycle ? { nonce: initial.lifecycle.nonce } : {}) }), signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw failure('CONTROL_REJECTED', `本机控制请求被拒绝（HTTP ${response.status}），未强制结束进程`);
    if (operation === 'pause') paused = true;
    const body = await response.json().catch(() => null); validateHealth(body, { ...context, ...(allowConfigurationChange ? { snapshot: { ...snapshot, hash: body?.lifecycle?.configSha256 } } : {}), pinned: initial }); return body;
  };
  const deadline = Date.now() + Math.min(drainTimeoutMs ?? timeoutMs, timeoutMs);
  try {
    assertConfig(); await assertProcessUnchanged(record, root); initial = validateHealth(await health(origin), { ...context, pinned: initial });
    const pausedBody = await control('pause'); paused = true;
    let current = pausedBody;
    while (current.activeActionCount || current.pollingCount) {
      if (Date.now() >= deadline) throw failure('CLIENT_BUSY', '客户端仍有执行或请求未完成，请稍后重试');
      await sleep(100); assertConfig(); current = validateHealth(await health(origin), { ...context, pinned: initial });
    }
    assertConfig(); await assertProcessUnchanged(record, root);
    const final = validateHealth(await health(origin), { ...context, pinned: initial });
    if (final.connectionState !== 'draining' || final.activeActionCount || final.pollingCount) throw failure('CLIENT_BUSY', '客户端执行状态变化；未强制结束进程');
    if (initial.lifecycle) await control('stop'); else await boundLegacyTermination(record, root);
    const stoppedDeadline = Date.now() + Math.min(shutdownTimeoutMs, timeoutMs);
    while (Date.now() < stoppedDeadline) {
      const currentProcess = await inspectNativeClientProcess(record.pid, root);
      if (!currentProcess || currentProcess.creationTime !== record.creationTime) {
        const remaining = await findNativePids(root);
        if (remaining.length) throw failure('CLIENT_RESTARTED', '停止后此安装又出现 daemon，未结束新进程');
        assertConfig();
        return { stopped: true, alreadyStopped: false, wasRunning: true, pid: record.pid, legacyIdentity: !initial.lifecycle };
      }
      await sleep(100);
    }
    throw failure('STOP_TIMEOUT', 'daemon 未在时限内退出，未强制结束进程');
  } catch (error) {
    if (paused) {
      try { await assertProcessUnchanged(record, root); const current = await health(origin); validateHealth(current, { ...context, snapshot: { ...snapshot, hash: current?.lifecycle?.configSha256 }, pinned: initial }); await control('resume', true); error.resumed = true; }
      catch { error.resumeFailed = true; error.message += '；恢复接收失败，请核对原实例健康状态'; }
    }
    if (!error.code) throw failure('STOP_FAILED', '客户端停止失败，未修改配置或删除数据');
    throw error;
  }
}

/** Only the installed ziwei package and its three Windows npm shims are owned. */
export function validateInstalledClientLayout({ root, env = process.env } = {}) {
  windowsOnly(); root = path.resolve(root); noLinks(root);
  const modules = path.dirname(root), prefix = path.dirname(modules);
  if (path.basename(root).toLowerCase() !== 'ziwei' || path.basename(modules).toLowerCase() !== 'node_modules' || !samePath(fs.realpathSync(root), root)) throw failure('NOT_GLOBAL_INSTALL', 'uninstall 只支持实际 npm 全局安装，源码工作树不属于卸载范围');
  const bytes = fs.readFileSync(path.join(root, 'package.json')), meta = JSON.parse(bytes);
  if (meta.name !== 'ziwei' || JSON.stringify(meta.bin) !== JSON.stringify({ ziwei_user: 'scripts/ziwei-user.mjs' })) throw failure('PACKAGE_MISMATCH', '实际包名或 bin 入口不匹配，未卸载其他程序');
  const entry = path.join(root, 'scripts/ziwei-user.mjs'); noLinks(entry); if (!fs.statSync(entry).isFile()) throw failure('BIN_MISMATCH', '实际客户端入口缺失');
  const bins = ['', '.cmd', '.ps1'].map(suffix => path.join(prefix, 'ziwei_user' + suffix));
  const binHashes = bins.map(file => { noLinks(file); const value = fs.readFileSync(file); const targets = value.toString().replaceAll('\\', '/').match(/node_modules\/[A-Za-z0-9@._/-]+/g) || []; if (!targets.length || targets.some(target => target !== 'node_modules/ziwei/scripts/ziwei-user.mjs')) throw failure('BIN_MISMATCH', 'npm bin/shim 入口已指向其他包，未卸载'); return { file, hash: digest(value) }; });
  for (const folder of ['data', '.local']) { const local = path.join(root, folder); if (fs.existsSync(local) && fs.readdirSync(local).length) throw failure('USERDATA_IN_PACKAGE', '程序目录仍有历史用户数据，拒绝卸载；请先迁移持久数据'); }
  if (env.ZIWEI_USER_HOME || env.ZIWEI_CONFIG) { assertOutside(resolveConfigPath({ root, env }), root); assertOutside(resolveDaemonDataDirectory({ root, env }), root); }
  const configFile = resolveConfigPath({ root, env });
  if (fs.existsSync(configFile)) {
    const { config } = readConfiguration(configFile);
    for (const value of [config.hermesHome, config.workdir, env.HERMES_HOME, env.CODEX_HOME, ...[config, ...(Array.isArray(config.sharedWorkspaces) ? config.sharedWorkspaces : [])].flatMap(connection => [connection.deviceTokenFile, connection.managementMcp?.tokenFile, connection.tlsCaFile])]) {
      if (typeof value === 'string' && value) assertOutside(path.resolve(path.dirname(configFile), value), root);
    }
  }
  return { root, prefix, modules, bins, binHashes, packageHash: digest(bytes) };
}
function resolveNpmCli(env) {
  const candidate = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  noLinks(candidate);
  if (!fs.existsSync(candidate) || JSON.parse(fs.readFileSync(path.resolve(candidate, '../../package.json'))).name !== 'npm') throw failure('NPM_UNAVAILABLE', '当前 Node 对应的 npm CLI 不可核验，未卸载程序');
  return candidate;
}
export function acquireMaintenanceLock({ directory, operation }) {
  noLinks(directory); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'operation.lock'); const nonce = randomUUID();
  try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, operation, nonce, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw failure('MAINTENANCE_BUSY', '已有维护操作或未清理的维护锁；本次未停止或卸载客户端'); throw error; }
  return () => { try { if (JSON.parse(fs.readFileSync(file)).nonce === nonce) fs.unlinkSync(file); } catch {} };
}

export async function performClientUninstall({ root, env = process.env, directory, npmCli, stop = stopClient, log = () => {} } = {}) {
  windowsOnly(); const layout = validateInstalledClientLayout({ root, env });
  const home = defaultUserDir({ env }), file = resolveConfigPath({ root, env }); assertOutside(home, root); assertOutside(file, root); assertOutside(resolveDaemonDataDirectory({ root, env }), root);
  directory = path.resolve(directory || path.join(home, 'maintenance', randomUUID())); assertOutside(directory, root); noLinks(home); noLinks(file); noLinks(directory);
  const before = readConfiguration(file).hash;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const release = acquireMaintenanceLock({ directory: path.join(home, 'maintenance'), operation: 'uninstall' });
  try {
    npmCli ||= resolveNpmCli(env); noLinks(npmCli); assertOutside(npmCli, root); assertOutside(process.execPath, root);
    if (JSON.parse(fs.readFileSync(path.resolve(npmCli, '../../package.json'))).name !== 'npm') throw failure('NPM_UNAVAILABLE', 'npm CLI 不属于可核验 npm 包');
    const stopped = await stop({ root, env });
    const current = validateInstalledClientLayout({ root, env });
    if (before !== readConfiguration(file).hash || current.packageHash !== layout.packageHash || current.binHashes.some((value, i) => value.hash !== layout.binHashes[i].hash)) throw failure('INSTALL_CHANGED', '维护期间包、入口或配置已变化，未卸载');
    log('uninstall_started', { prefix: layout.prefix, stoppedPid: stopped.pid || null });
    // npm's package name and prefix are fixed verified values; lifecycle scripts
    // and network access are disabled. The worker cwd is outside the installation.
    try { await run(process.execPath, [npmCli, 'uninstall', '--global', '--prefix', layout.prefix, 'ziwei', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { env, cwd: directory, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }); }
    catch { throw failure('UNINSTALL_FAILED', 'npm 卸载失败，请查看程序目录；用户配置和认证目录未删除'); }
    if (fs.existsSync(root) || layout.bins.some(bin => fs.existsSync(bin))) throw failure('UNINSTALL_INCOMPLETE', '卸载后仍有原包或入口，未报告完成');
    if (readConfiguration(file).hash !== before) throw failure('CONFIG_CHANGED', '卸载期间用户配置发生变化，未覆盖用户数据');
    log('uninstall_complete');
    return { state: 'complete', operation: 'uninstall', prefix: layout.prefix, userdataPreserved: true, configurationPreserved: true, wasRunning: stopped.wasRunning, stoppedPid: stopped.pid || null };
  } finally { release(); }
}

export async function waitForMaintenanceParent(pid, timeoutMs = 30000) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw failure('INVALID_PARENT', '维护父进程无效');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; } await sleep(100); }
  throw failure('PARENT_STILL_RUNNING', '发起维护的 CLI 尚未退出，未停止或卸载客户端');
}
export async function launchClientUninstall({ root, env = process.env } = {}) {
  windowsOnly(); validateInstalledClientLayout({ root, env });
  const home = defaultUserDir({ env }); assertOutside(home, root); assertOutside(resolveConfigPath({ root, env }), root); noLinks(home);
  const directory = path.join(home, 'maintenance', randomUUID()), helperRoot = path.join(directory, 'helper-root');
  fs.mkdirSync(helperRoot, { recursive: true, mode: 0o700 });
  for (const relative of ['package.json', 'scripts/client-lifecycle.mjs', 'scripts/client-maintenance-helper.mjs', 'daemon/config.mjs', 'src/management-bootstrap.mjs']) {
    const target = path.join(helperRoot, relative); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.copyFileSync(path.join(root, relative), target);
  }
  const jobFile = path.join(directory, 'job.json'), resultFile = path.join(directory, 'result.json');
  fs.writeFileSync(jobFile, JSON.stringify({ root: path.resolve(root), directory, parentPid: process.pid, operation: 'uninstall' }), { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(resultFile, JSON.stringify({ state: 'queued', operation: 'uninstall' }), { mode: 0o600, flag: 'wx' });
  const child = spawn(process.execPath, [path.join(helperRoot, 'scripts/client-maintenance-helper.mjs'), jobFile], { env: { ...env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: resolveConfigPath({ root, env }) }, cwd: directory, detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
  return { state: 'queued', operation: 'uninstall', workerPid: child.pid, resultFile, logFile: path.join(directory, 'maintenance.jsonl') };
}
