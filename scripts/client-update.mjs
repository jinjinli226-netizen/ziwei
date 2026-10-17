import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolveConfigPath, defaultUserDir } from '../daemon/config.mjs';
import { clientBuildIdentity } from '../src/management-bootstrap.mjs';
import {safeLocalStopReasons,localStopReasonMessage} from './client-lifecycle.mjs';

const run = promisify(execFile);
export const OFFICIAL_UPDATE_SOURCE = 'https://qzelynth.top/downloads/cli/ziwei-latest.tgz';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const failure = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });
const UPDATE_STAGES = new Set(['validate_installation', 'resolve_npm', 'validate_paths', 'verify_archive', 'read_release_manifest', 'download_package', 'stage_install', 'validate_candidate', 'prepare_candidate', 'recover_history', 'stop_client', 'verify_original', 'backup_original', 'activate_candidate', 'verify_installation', 'restart_client', 'verify_configuration', 'stop_failed_candidate', 'restore_original', 'restart_original', 'read_restoration_configuration', 'wait_parent', 'acquire_lock', 'unknown']);
const SAFE_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOENT', 'ENOTDIR', 'ENOSPC', 'EIO', 'EROFS', 'EEXIST', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_INVALID_PACKAGE_CONFIG', 'WINDOWS_ONLY', 'USERDATA_IN_PACKAGE', 'UNSAFE_PATH', 'CONFIG_UNREADABLE', 'CONFIG_INVALID', 'PID_MISMATCH', 'PROCESS_IDENTITY_MISMATCH', 'PROCESS_CHANGED', 'NON_LOCAL_CONTROL', 'INVALID_HEALTH_PORT', 'HEALTH_UNREACHABLE', 'FOREIGN_LISTENER', 'CLIENT_IDENTITY_MISMATCH', 'LIFECYCLE_IDENTITY_MISMATCH', 'LIFECYCLE_DOWNGRADE', 'INVALID_TIMEOUT', 'BUILD_INVALID', 'HEALTH_MISSING', 'PROCESS_MISSING', 'CONTROL_AUTH_MISSING', 'CONFIG_CHANGED', 'CONTROL_REJECTED', 'CLIENT_BUSY', 'CLIENT_RESTARTED', 'STOP_TIMEOUT', 'STOP_FAILED', 'NOT_GLOBAL_INSTALL', 'PACKAGE_MISMATCH', 'BIN_MISMATCH', 'NPM_UNAVAILABLE', 'MAINTENANCE_BUSY', 'MAINTENANCE_OWNER_UNVERIFIED', 'INSTALL_CHANGED', 'INVALID_PARENT', 'PARENT_STILL_RUNNING', 'UPDATE_SOURCE_INVALID', 'UPDATE_HASH_INVALID', 'UPDATE_HTTP_FAILED', 'UPDATE_TOO_LARGE', 'UPDATE_MANIFEST_INVALID', 'UPDATE_BUILD_MISMATCH']);
const SAFE_RECOVERY_PHASES = new Set(['configuration','grant_probe','archive_validation','current_health','source_validation','holder_validation','pause_drain','local_archive_validation','prepare','archive_backup','holder_revalidation','terminate','exit_validation','post_exit_validation','receipt_commit','local_apply','offline_observation','offline_prepare','offline_archive','offline_revalidation','offline_commit','offline_apply']);
const SAFE_RECOVERY_REASONS = new Set(['EVIDENCE_MISMATCH','TRANSPORT_FAILED','INVALID_SERVER_RESPONSE','SERVER_REFUSED','DRAIN_TIMEOUT','CHALLENGE_EXPIRED_BEFORE_STOP']);
const SAFE_SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGINT', 'SIGBREAK']);
SAFE_ERROR_CODES.add('RETAINED_STOP_RECOVERY_REFUSED');
SAFE_ERROR_CODES.add('HISTORICAL_PRELAUNCH_RECOVERY_REFUSED');
SAFE_ERROR_CODES.add('CLIENT_FORCE_ABANDON_REFUSED');
for (const code of ['LEGACY_STOP_CONFIRMATION_REQUIRED', 'LEGACY_CONFIRMATION_INVALID', 'LEGACY_IDENTITY_UNVERIFIED', 'LEGACY_PROTOCOL_MISMATCH', 'LEGACY_PROOF_INVALID', 'LEGACY_PROOF_EXPIRED', 'LEGACY_IDENTITY_CHANGED', 'LEGACY_SOURCE_UNRECOGNIZED', 'LEGACY_CONFIG_MISMATCH', 'LEGACY_CONFIG_NAMESPACE_UNVERIFIED', 'LEGACY_STOP_PROOF_REQUIRED', 'LEGACY_STOP_FAILED']) SAFE_ERROR_CODES.add(code);
const FAILURE_REASONS = {
  CLIENT_FORCE_ABANDON_REFUSED: '已授权的旧任务放弃尚未完成；原始归档已保留，请重试官方更新入口',
  HISTORICAL_PRELAUNCH_RECOVERY_REFUSED: '旧任务自动恢复尚未完成；原始记录已保留，请重试官方更新入口，系统会继续恢复',
  CONTROL_REJECTED: '客户端拒绝停止，请查看具体阻塞记录',
  RETAINED_STOP_RECOVERY_REFUSED: '历史记录未满足自动恢复条件，客户端未被强制停止',
  LEGACY_STOP_CONFIRMATION_REQUIRED: '旧版无法报告当前任务，执行状态未知；须先核验实例并明确确认停止后迁移',
  LEGACY_CONFIRMATION_INVALID: '旧版迁移需要本次明确确认与同一实例的检查凭据',
  LEGACY_IDENTITY_UNVERIFIED: '无法完整核验旧版进程、配置或监听端口，未执行停止',
  LEGACY_PROTOCOL_MISMATCH: '客户端协议与已核验的旧版迁移路径不符',
  LEGACY_PROOF_INVALID: '旧版实例检查凭据无效，未执行停止',
  LEGACY_PROOF_EXPIRED: '旧版实例检查已过期，请重新检查并确认',
  LEGACY_IDENTITY_CHANGED: '旧版实例或配置在确认后发生变化',
  LEGACY_SOURCE_UNRECOGNIZED: '旧版程序不属于已核验的历史版本，未执行停止',
  LEGACY_CONFIG_MISMATCH: '旧版进程实际使用的配置与待升级配置不符',
  LEGACY_CONFIG_NAMESPACE_UNVERIFIED: '无法核验旧版进程与维护进程使用同一配置命名空间',
  LEGACY_STOP_PROOF_REQUIRED: '旧版停止缺少本次确认所绑定的实例检查凭据',
  LEGACY_STOP_FAILED: '未能确认旧版实例已按本次授权停止，请查看停止与恢复结果',
  EBUSY: '文件或安装目录被占用', EPERM: '操作权限不足或文件受保护', EACCES: '访问权限不足', ENOENT: '所需文件或路径不存在', ENOTDIR: '所需路径不是目录', ENOSPC: '磁盘空间不足', EIO: '文件读写失败', EROFS: '文件系统只读', EEXIST: '目标文件已存在', ETIMEDOUT: '操作超时', ECONNREFUSED: '连接被拒绝', ECONNRESET: '连接被重置', ENOTFOUND: '服务器地址解析失败', EAI_AGAIN: '服务器地址解析暂时失败', ERR_CHILD_PROCESS_STDIO_MAXBUFFER: '子进程输出超过维护限制',
  PROCESS_EXIT_NONZERO: '子进程以非零退出码退出', PROCESS_TERMINATED: '子进程被终止', OPERATION_TIMEOUT: '维护请求超时', OPERATION_ABORTED: '维护请求被取消', MAINTENANCE_BUSY: '已有维护worker正在运行；未并发更换安装', MAINTENANCE_OWNER_UNVERIFIED: '维护worker身份暂时无法确认；未更换安装', CLIENT_BUSY: '客户端仍有执行或请求未完成', CONFIG_CHANGED: '连接配置在维护期间发生变化', UPDATE_HASH_INVALID: '更新包 SHA-256 校验失败', UPDATE_HTTP_FAILED: '官方更新请求失败', UPDATE_TOO_LARGE: '更新包超过大小限制', UPDATE_SOURCE_INVALID: '更新地址未通过安全校验', UPDATE_MANIFEST_INVALID: '官方发布清单与更新地址不匹配', UPDATE_BUILD_MISMATCH: '实际安装与已验证候选的 build 不一致', NPM_UNAVAILABLE: '当前 Node 对应的 npm CLI 无法核验', INVALID_PARENT: '发起更新的父进程身份无效', PARENT_STILL_RUNNING: '发起更新的 CLI 未在时限内退出'
};

// Never serialize arbitrary Error.message, command, stdout, stderr, stack or config.
// The cause chain is bounded; only public codes and small numeric facts may leave it.
export function describeUpdateFailure(error, stage = 'unknown') {
  const failureStage = UPDATE_STAGES.has(stage) ? stage : 'unknown';
  let reasonCode = null, exitCode, signal, httpStatus,stopReasons, recoveryPhase, recoveryReasonCode, maintenanceOwnerState, workerPid;
  const seen = new Set();
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 4 && !seen.has(current); current = current.cause, depth++) {
    seen.add(current);
    if (!recoveryPhase && SAFE_RECOVERY_PHASES.has(current.recoveryPhase)) recoveryPhase = current.recoveryPhase;
    if (!recoveryReasonCode && SAFE_RECOVERY_REASONS.has(current.reasonCode)) recoveryReasonCode = current.reasonCode;
    if (!maintenanceOwnerState && MAINTENANCE_STATES.has(current.maintenanceOwnerState)) maintenanceOwnerState = current.maintenanceOwnerState;
    if (workerPid === undefined && Number.isSafeInteger(current.workerPid) && current.workerPid > 0) workerPid = current.workerPid;
    if (!reasonCode && SAFE_ERROR_CODES.has(current.code)) reasonCode = current.code;
    if (!reasonCode && ['TimeoutError', 'AbortError'].includes(current.name)) reasonCode = current.name === 'TimeoutError' ? 'OPERATION_TIMEOUT' : 'OPERATION_ABORTED';
    if (exitCode === undefined && typeof current.cmd === 'string' && Number.isInteger(current.code) && current.code !== 0 && Math.abs(current.code) <= 2147483647) exitCode = current.code;
    if (!signal && SAFE_SIGNALS.has(current.signal)) signal = current.signal;
    if (httpStatus === undefined && ['UPDATE_HTTP_FAILED','CONTROL_REJECTED'].includes(current.code) && Number.isInteger(current.httpStatus) && current.httpStatus >= 100 && current.httpStatus <= 599) httpStatus = current.httpStatus;
    if(!stopReasons&&current.code==='CONTROL_REJECTED'&&current.httpStatus===409){const reasons=safeLocalStopReasons(current.stopReasons);if(reasons.length)stopReasons=reasons;}
  }
  reasonCode ||= exitCode !== undefined ? 'PROCESS_EXIT_NONZERO' : signal ? 'PROCESS_TERMINATED' : failureStage.toUpperCase() + '_FAILED';
  const reason = (FAILURE_REASONS[reasonCode] || (SAFE_ERROR_CODES.has(reasonCode) ? '客户端安全核验或维护操作失败' : '此维护阶段未完成；未记录未经核验的原始输出'))+(stopReasons?'：'+localStopReasonMessage(stopReasons):'');
  return { failureStage, reasonCode, reason, ...(exitCode !== undefined ? { exitCode } : {}), ...(signal ? { signal } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}),...(stopReasons?{stopReasons}:{}), ...(recoveryPhase ? {recoveryPhase} : {}), ...(recoveryReasonCode ? {recoveryReasonCode} : {}), ...(maintenanceOwnerState ? {maintenanceOwnerState} : {}), ...(workerPid !== undefined ? {workerPid} : {}) };
}

function diagnosticMessage(diagnostic) {
  const recovery = diagnostic.recoveryPhase ? `恢复步骤：${diagnostic.recoveryPhase}${diagnostic.recoveryReasonCode ? `；具体原因：${diagnostic.recoveryReasonCode}` : ''}。` : '';
  return `失败阶段：${diagnostic.failureStage}；原因：${diagnostic.reason}（${diagnostic.reasonCode}${diagnostic.exitCode !== undefined ? `，退出码 ${diagnostic.exitCode}` : ''}${diagnostic.httpStatus !== undefined ? `，HTTP ${diagnostic.httpStatus}` : ''}）。${recovery}`;
}

class ClientUpdateFailure extends Error {
  constructor(error, stage, originalRestored, backup, recoveryFailure = null, restoration = {}) {
    const diagnostic = describeUpdateFailure(error, stage);
    const busy = ['EBUSY', 'EPERM', 'EACCES'].includes(error?.code);
    const installationRestored = restoration.originalInstallationRestored ?? originalRestored;
    const recovery = originalRestored ? (busy ? 'Windows 安装目录仍被其他进程或终端占用；原版本已保留或恢复，连接配置未清空。请退出该目录/解除实际占用后重试。' : '更新失败，原版本已保留或恢复；连接配置未清空。') : installationRestored ? '更新失败；原安装已保留或恢复，但原运行状态未恢复。请查看维护日志，不要重新配对。' : `更新失败且原版本恢复未完成；${backup ? `原程序备份路径为 ${backup}；` : ''}请查看维护日志，不要重新配对。`;
    super(recovery + diagnosticMessage(diagnostic) + (recoveryFailure ? '恢复失败：' + diagnosticMessage(recoveryFailure) : ''), { cause: error });
    Object.assign(this, diagnostic, { code: busy ? 'PROGRAM_DIRECTORY_BUSY' : 'UPDATE_FAILED', originalRestored, originalInstallationRestored: restoration.originalInstallationRestored ?? originalRestored, runningStateRestored: restoration.runningStateRestored ?? null, ...(recoveryFailure ? { recoveryFailure } : {}) });
  }
}

export function updateFailureResult(error, stage = 'unknown') {
  const captured = error instanceof ClientUpdateFailure;
  const diagnostic = describeUpdateFailure(error, captured ? error.failureStage : stage);
  return { state: 'failed', operation: 'update', code: captured ? error.code : SAFE_ERROR_CODES.has(error?.code) ? error.code : 'UPDATE_FAILED', ...diagnostic, originalRestored: captured ? error.originalRestored : true, originalInstallationRestored: captured ? error.originalInstallationRestored : true, runningStateRestored: captured ? error.runningStateRestored : null, ...(captured && error.recoveryFailure ? { recoveryFailure: error.recoveryFailure } : {}), message: captured ? error.message : '更新未完成；原安装未更换。' + diagnosticMessage(diagnostic) };
}

export function validateUpdateSource(value, { allowLoopback = false } = {}) {
  let url;
  try { url = new URL(String(value)); } catch { throw failure('UPDATE_SOURCE_INVALID', '更新地址必须是纯 HTTPS URL，不能包含 Markdown 链接格式'); }
  if ((url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw failure('UPDATE_SOURCE_INVALID', '更新地址必须使用 HTTPS，不接受凭据、查询串或片段');
  return url.href;
}

export async function downloadVerifiedPackage({ url, sha256, destination, allowLoopback = false }) {
  const source = validateUpdateSource(url, { allowLoopback });
  if (!/^[a-f0-9]{64}$/.test(sha256 || '')) throw failure('UPDATE_HASH_INVALID', '更新包缺少有效 SHA-256');
  const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw failure('UPDATE_HTTP_FAILED', `更新包下载失败（HTTP ${response.status}）`, { httpStatus: response.status });
  if (Number(response.headers.get('content-length')) > 50 * 1024 * 1024) throw failure('UPDATE_TOO_LARGE', '更新包超过大小限制');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 50 * 1024 * 1024) throw failure('UPDATE_TOO_LARGE', '更新包超过大小限制'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  if (hash(bytes) !== sha256) throw failure('UPDATE_HASH_INVALID', '更新包 SHA-256 校验失败，原版本未修改');
  fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
  return { sha256, bytes: size };
}

export function validateCandidatePackage(root) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (meta.name !== 'ziwei' || JSON.stringify(meta.bin) !== JSON.stringify({ ziwei_user: 'scripts/ziwei-user.mjs' }) || !fs.statSync(path.join(root, 'scripts/ziwei-user.mjs')).isFile()) throw failure('PACKAGE_MISMATCH', '更新目标必须是紫薇 ziwei 包及原 ziwei_user 入口');
  return meta;
}

export function resolveInstalledPackage(input, platform = process.platform) {
  const root = path.resolve(input);
  const actualRoot = fs.realpathSync(root);
  if ((platform === 'win32' ? actualRoot.toLowerCase() !== root.toLowerCase() : actualRoot !== root) || fs.lstatSync(root).isSymbolicLink()) throw failure('UNSAFE_PATH', '安装目录不能是链接；未修改其他安装');
  validateCandidatePackage(root);
  const modules = path.dirname(root);
  if (path.basename(root) !== 'ziwei' || path.basename(modules) !== 'node_modules') throw failure('NOT_GLOBAL_INSTALL', 'update/uninstall 只支持实际全局安装，源码工作树不属于卸载范围');
  let prefix = path.dirname(modules);
  if (platform !== 'win32') { if (path.basename(prefix) !== 'lib') throw failure('NOT_GLOBAL_INSTALL', '无法核实全局 npm 安装布局'); prefix = path.dirname(prefix); }
  return { root, prefix, modules, binDirectory: platform === 'win32' ? prefix : path.join(prefix, 'bin') };
}

export function resolveNpmCli({ env = process.env, node = process.execPath } = {}) {
  const paths = [env.npm_execpath, path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(node), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  for (const candidate of paths) {
    try { const real = fs.realpathSync(candidate); if (path.basename(real) === 'npm-cli.js' && JSON.parse(fs.readFileSync(path.resolve(real, '../../package.json'))).name === 'npm') return real; } catch {}
  }
  throw failure('NPM_UNAVAILABLE', '未找到当前 Node 对应的 npm CLI；原安装未修改，请在正常 Node/npm 终端重试');
}

function assertOutside(file, root) {
  const relative = path.relative(root, path.resolve(file));
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw failure('USERDATA_IN_PACKAGE', '用户配置与维护目录必须位于客户端程序目录之外，未移动或删除用户数据');
}

function noLinks(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    let stat; try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw failure('UNSAFE_PATH', '维护路径包含链接，未修改客户端或用户数据');
    if (current === path.dirname(current)) break;
  }
}

function copyPackage(source, destination) {
  // fs.cpSync can abort this Windows Node process (0xC0000409) on an npm
  // dependency tree, bypassing JavaScript recovery entirely. Copy explicitly
  // into the unique candidate directory before touching the original client.
  const copy = (from, to) => {
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw failure('UNSAFE_PATH', '客户端安装包含链接或非普通文件，未更换程序目录');
    if (stat.isDirectory()) {
      fs.mkdirSync(to);
      for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
    } else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  };
  copy(source, destination);
}

function configurationSnapshot(file) { return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null; }
function assertConfiguration(file, before) { if (configurationSnapshot(file) !== before) throw failure('CONFIG_CHANGED', '维护期间连接配置发生变化；未覆盖用户的新配置'); }

/** Confirmation is tied to the exact readonly probe shown to the user. */
export async function readLegacyUpdateConsent(args = {}) {
  if (args['allow-legacy-stop'] === undefined && args['legacy-proof'] === undefined) return {};
  if (args['allow-legacy-stop'] !== true || typeof args['legacy-proof'] !== 'string' || !args['legacy-proof']) throw failure('LEGACY_CONFIRMATION_INVALID', '旧版迁移须同时提供明确确认和本次实例检查文件');
  const file = path.resolve(args['legacy-proof']); noLinks(file);
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 65536) throw failure('LEGACY_CONFIRMATION_INVALID', '旧版实例检查文件无效');
  let legacyProof;
  try { legacyProof = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw failure('LEGACY_CONFIRMATION_INVALID', '旧版实例检查文件无效'); }
  const { assertLegacyProof } = await import('./client-legacy-identity.mjs');
  assertLegacyProof(legacyProof, legacyProof);
  return { allowLegacyStop: true, legacyProof };
}

export async function performClientUpdate(options = {}) {
  const progress = { stage: 'validate_installation' };
  try { return await performClientUpdateInternal(options, progress); }
  catch (error) {
    if (error instanceof ClientUpdateFailure) throw error;
    const originalRestored = !progress.originalTouched;
    const captured = new ClientUpdateFailure(error, progress.stage, originalRestored, progress.backup || null);
    (options.log || (() => {}))('update_failed', { ...describeUpdateFailure(captured, captured.failureStage), code: captured.code, originalRestored, backup: progress.backup || null });
    throw captured;
  }
}

async function performClientUpdateInternal({ root, env = process.env, directory, artifactFile, sha256, source = OFFICIAL_UPDATE_SOURCE, npmCli, stopClient, allowLegacyStop = false, legacyProof, log = () => {} }, progress) {
  if (process.platform !== 'win32') throw failure('WINDOWS_ONLY', '本轮 update 仅支持 Windows；未修改此平台客户端');
  const installation = resolveInstalledPackage(root);
  const lifecycle = await import('./client-lifecycle.mjs');
  const originalLayout = lifecycle.validateInstalledClientLayout({ root, env });
  if (allowLegacyStop !== false || legacyProof !== undefined) {
    if (allowLegacyStop !== true || !legacyProof) throw failure('LEGACY_CONFIRMATION_INVALID', '旧版迁移缺少明确确认或同一实例凭据');
    const { inspectLegacyClientIdentity } = await import('./client-legacy-identity.mjs');
    await inspectLegacyClientIdentity({ root, env, expectedProof: legacyProof });
  }
  progress.stage = 'resolve_npm';
  npmCli ||= resolveNpmCli({ env });
  progress.stage = 'validate_paths';
  directory = path.resolve(directory); assertOutside(directory, root); noLinks(directory);
  const configFile = resolveConfigPath({ root, env }); assertOutside(configFile, root); noLinks(configFile);
  const configBefore = configurationSnapshot(configFile);
  const userHome = defaultUserDir({ env }); assertOutside(userHome, root); noLinks(userHome);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const archive = path.join(directory, 'verified-update.tgz');
  progress.stage = 'verify_archive';
  if (artifactFile) { const bytes = fs.readFileSync(path.resolve(artifactFile)); if (!/^[a-f0-9]{64}$/.test(sha256 || '') || hash(bytes) !== sha256) throw failure('UPDATE_HASH_INVALID', '本地更新包 SHA-256 校验失败'); fs.writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600 }); }
  else {
    progress.stage = 'read_release_manifest';
    source = validateUpdateSource(source);
    const metadataUrl = new URL('release.json', source).href;
    const response = await fetch(metadataUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw failure('UPDATE_HTTP_FAILED', '官方发布清单读取失败', { httpStatus: response.status });
    const metadata = await response.json();
    if (metadata.url !== source || !/^[a-f0-9]{64}$/.test(metadata.sha256 || '')) throw failure('UPDATE_MANIFEST_INVALID', '官方发布清单与安装地址不一致');
    sha256 = metadata.sha256;
    progress.stage = 'download_package';
    await downloadVerifiedPackage({ url: source, sha256, destination: archive });
  }
  // Install and validate the complete dependency tree before touching the running client.
  const stage = path.join(directory, 'stage-prefix');
  log('update_staging', { sha256 });
  progress.stage = 'stage_install';
  await run(process.execPath, [npmCli, 'install', '--global', '--prefix', stage, archive, '--ignore-scripts', '--no-audit', '--no-fund'], { env, cwd: directory, timeout: 180_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const stagedRoot = path.join(stage, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', 'ziwei');
  progress.stage = 'validate_candidate';
  validateCandidatePackage(stagedRoot);
  await run(process.execPath, [path.join(stagedRoot, 'scripts/ziwei-user.mjs'), 'version'], { env, cwd: directory, timeout: 15_000, windowsHide: true });
  const newBuild = clientBuildIdentity(stagedRoot), oldBuild = clientBuildIdentity(root);
  progress.stage = 'prepare_candidate';
  const operationId = randomUUID();
  const candidate = path.join(installation.modules, `.ziwei-ready-${operationId}`);
  const backup = path.join(installation.modules, `.ziwei-backup-${operationId}`);
  copyPackage(stagedRoot, candidate);
  assertConfiguration(configFile, configBefore);
  let stopped, moved = false, installed = false;
  const stop = stopClient || lifecycle.stopClient;
  const start = async expectedBuild => {
    const legacyMigration = stopped?.legacyProtocol === 'pre-identity';
    // Historical start scripts accept a weak health identity. The maintained
    // helper independently proves the port is free and the restarted instance
    // actually belongs to this installation and unchanged configuration.
    if (legacyMigration && (await lifecycle.inspectClientMaintenance({ root, env })).state !== 'stopped') throw failure('CLIENT_RESTARTED', '恢复前已有运行实例，未启动第二个客户端');
    await run(process.execPath, [path.join(root, 'scripts/start-ziwei-user.mjs')], { env, cwd: userHome, timeout: 30_000, windowsHide: true });
    if (legacyMigration) {
      const running = await lifecycle.inspectClientMaintenance({ root, env });
      if (!running.wasRunning || !['ready', 'legacy_confirmation_required'].includes(running.state)) throw failure('HEALTH_MISSING', '原生启动退出后未核验到此安装的运行实例');
      assertConfiguration(configFile, configBefore);
      if (clientBuildIdentity(root) !== expectedBuild || (running.legacyProof && (running.legacyProof.installedBuild !== expectedBuild || running.legacyProof.configSha256 !== configBefore))) throw failure('INSTALL_CHANGED', '恢复后的运行实例或安装身份不匹配');
    }
  };
  try {
    progress.stage = 'recover_history';
    const recovery = await recoverBeforeClientUpdateStop({ candidate, root, env, log });
    // Historical quarantine is included in the old daemon's active count. Its
    // audited recovery must run before the ordinary zero-active drain loop.
    if (recovery.recovered) stopped = { ...recovery };
    else {
      progress.stage = 'stop_client';
      stopped = await stop({ root, env, retainedRecoveryRoot: candidate, ...(allowLegacyStop ? { allowLegacyStop: true, legacyProof } : {}) });
    }
    progress.stage = 'verify_original';
    assertConfiguration(configFile, configBefore);
    if (clientBuildIdentity(root) !== oldBuild) throw failure('INSTALL_CHANGED', '原程序在准备期间已变化，未覆盖另一维护任务的安装');
    const currentLayout = lifecycle.validateInstalledClientLayout({ root, env });
    if (currentLayout.binHashes.some((item, i) => item.hash !== originalLayout.binHashes[i].hash)) throw failure('BIN_MISMATCH', '原 npm 入口在维护期间已变化，未覆盖或修改其他程序入口');
    // Both renames stay in the original node_modules directory. npm's original bin shims
    // continue pointing to the same ziwei_user entry; no global prefix is rewritten.
    progress.stage = 'backup_original';
    fs.renameSync(root, backup); moved = true; progress.originalTouched = true; progress.backup = backup;
    progress.stage = 'activate_candidate';
    fs.renameSync(candidate, root); installed = true;
    progress.stage = 'verify_installation';
    validateCandidatePackage(root);
    if (clientBuildIdentity(root) !== newBuild) throw failure('UPDATE_BUILD_MISMATCH', '实际安装 build 与已验证候选不一致');
    assertConfiguration(configFile, configBefore);
    const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile)) : null;
    const restart = Boolean(stopped.wasRunning && config?.workspace && config?.connectionState !== 'disconnected');
    if (restart) { progress.stage = 'restart_client'; await start(newBuild); }
    progress.stage = 'verify_configuration';
    assertConfiguration(configFile, configBefore);
    log('update_complete', { oldBuild, clientBuild: newBuild, sha256, restoredRunning: restart, backup });
    return { state: 'complete', operation: 'update', oldBuild, clientBuild: newBuild, sha256, restoredRunning: restart, configurationPreserved: true, prefix: installation.prefix, backup, ...(stopped.legacyProtocol === 'pre-identity' ? { legacyMigration: { confirmed: true, activeActionCount: null, pollingCount: null, drained: false, unfinishedTasksMayResume: restart } } : {}) };
  } catch (error) {
    // A verified stop may finish before a later config/exit check throws.
    // Preserve that receipt rather than losing it at `stopped = await stop`.
    if (!stopped && error.stoppedClientReceipt?.stopped === true && error.stoppedClientReceipt.wasRunning === true) stopped = error.stoppedClientReceipt;
    let recovered = !moved;
    let recoveryFailure = null;
    if (moved) {
      let recoveryStage = 'stop_failed_candidate';
      try {
        // A failed startup may leave a new daemon alive; stop only that exact installation.
        if (installed) await stop({ root, env });
        recoveryStage = 'restore_original';
        if (fs.existsSync(root)) fs.renameSync(root, path.join(installation.modules, `.ziwei-failed-${operationId}`));
        fs.renameSync(backup, root); recovered = clientBuildIdentity(root) === oldBuild;
      } catch (cause) { recovered = false; recoveryFailure = describeUpdateFailure(cause, recoveryStage); }
    }
    if (recovered) {
      try { if (clientBuildIdentity(root) !== oldBuild) throw failure('INSTALL_CHANGED', '原安装身份发生变化，未报告原安装已恢复'); }
      catch (cause) { recovered = false; recoveryFailure = describeUpdateFailure(cause, 'restore_original'); }
    }
    const originalInstallationRestored = recovered;
    let runningStateRestored = stopped?.wasRunning ? false : null;
    // Once the audited holder has exited, a failed remote commit must keep
    // that generation stopped. Restarting it would strand the durable recovery
    // journal behind a new daemon that cannot own the original execution.
    const historicalRecoveryPending = stopped?.prelaunchHistoryRetained === true || progress.stage === 'recover_history' && stopped?.stopped === true;
    if (historicalRecoveryPending) recovered = false;
    if (recovered && stopped?.wasRunning) {
      let recoveryStage = 'read_restoration_configuration';
      try {
        assertConfiguration(configFile, configBefore);
        if (clientBuildIdentity(root) !== oldBuild) throw failure('INSTALL_CHANGED', '原安装身份发生变化，未启动另一份程序');
        let config;
        try { config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile)) : null; }
        catch (cause) { if (cause instanceof SyntaxError) throw failure('CONFIG_INVALID', '恢复期间连接配置不是有效 JSON；未覆盖用户配置', { cause }); throw cause; }
        if (config?.workspace && config?.connectionState !== 'disconnected') { recoveryStage = 'restart_original'; await start(oldBuild); runningStateRestored = true; }
      } catch (cause) { recovered = false; recoveryFailure = describeUpdateFailure(cause, recoveryStage); }
    }
    const captured = new ClientUpdateFailure(error, progress.stage, recovered, moved ? backup : null, recoveryFailure, { originalInstallationRestored, runningStateRestored });
    log('update_failed', { ...describeUpdateFailure(captured, captured.failureStage), originalRestored: recovered, originalInstallationRestored, runningStateRestored, code: captured.code, ...(recoveryFailure ? { recoveryFailure } : {}), backup: moved ? backup : null });
    throw captured;
  }
}

export async function recoverBeforeClientUpdateStop({candidate,root,env=process.env,log=()=>{},load=specifier=>import(specifier)}={}) {
  const module = await load(pathToFileURL(path.join(candidate,'scripts/client-historical-prelaunch-recovery.mjs')).href);
  const receipt = await module.recoverHistoricalPrelaunchForUpdate({root,env,log});
  if(receipt?.recovered===true) {
    const observedAbsent = receipt.operatorAbandoned===true && receipt.currentDaemonAbsent===true && receipt.stopped===false && receipt.wasRunning===false && receipt.originalExecutionExitConfirmed===false && receipt.executionConfirmedStopped===false;
    if(receipt.currentDaemonAbsent===true ? !observedAbsent : receipt.stopped!==true||receipt.wasRunning!==true)throw failure('HISTORICAL_PRELAUNCH_RECOVERY_REFUSED','历史恢复未给出可核验的停止结果');
    log(receipt.operatorAbandoned===true?'operator_force_abandon_recovered':'historical_prelaunch_recovered',{actionId:receipt.actionId});
  }
  return receipt || {recovered:false};
}

/** Preserve the last completed update before latest-update becomes this job. */
export function retainLastCompletedUpdatePointer({home}={}) {
  const maintenance=path.join(path.resolve(home),'maintenance'),latest=path.join(maintenance,'latest-update.json'),retained=path.join(maintenance,'last-completed-update.json');
  try {
    const read=file=>{noLinks(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>65536)throw failure('UNSAFE_PATH','维护记录路径无效');return JSON.parse(fs.readFileSync(file,'utf8'));};
    const pointer=read(latest);
    if(!pointer||Object.keys(pointer).some(key=>!['resultFile','directory'].includes(key))||typeof pointer.resultFile!=='string'||typeof pointer.directory!=='string')return {retained:false};
    const directory=path.resolve(pointer.directory),resultFile=path.resolve(pointer.resultFile);
    if(path.dirname(directory)!==maintenance||!/^update-[a-f0-9-]{36}$/.test(path.basename(directory))||path.dirname(resultFile)!==directory||path.basename(resultFile)!=='result.json')return {retained:false};
    const result=read(resultFile);if(result?.state!=='complete'||result.operation!=='update')return {retained:false};
    noLinks(retained);const temporary=retained+'.'+randomUUID()+'.tmp';let fd;
    try {fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({resultFile,directory}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,retained);}
    finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch{}}
    return {retained:true};
  } catch {return {retained:false};}
}

export async function launchClientUpdate({ codeRoot, root = codeRoot, args = {}, env = process.env } = {}) {
  if (process.platform !== 'win32') throw new Error('本轮 update 仅支持 Windows；未修改此平台客户端');
  const legacyConsent = await readLegacyUpdateConsent(args);
  resolveInstalledPackage(root);
  const { validateInstalledClientLayout } = await import('./client-lifecycle.mjs');
  validateInstalledClientLayout({ root, env });
  const npmCli = resolveNpmCli({ env });
  const home = defaultUserDir({ env }); assertOutside(home, root); noLinks(home);
  if (args.force) throw new Error('update 不使用 --force；Windows 文件占用不能强制绕过。此命令会先安全停止本客户端再更换已验证程序。');
  if (legacyConsent.allowLegacyStop) {
    const { inspectLegacyClientIdentity } = await import('./client-legacy-identity.mjs');
    await inspectLegacyClientIdentity({ root, env, expectedProof: legacyConsent.legacyProof });
  }
  const directory = path.join(home, 'maintenance', `update-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const helperRoot = path.join(directory, 'helper'); fs.mkdirSync(helperRoot);
  for (const relative of ['package.json', 'daemon/config.mjs', 'src/management-bootstrap.mjs', 'scripts/client-update.mjs', 'scripts/client-update-worker.mjs', 'scripts/client-lifecycle.mjs', 'scripts/client-retained-stop-recovery.mjs', 'scripts/client-legacy-identity.mjs', 'scripts/client-legacy-identity.ps1']) {
    const target = path.join(helperRoot, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(codeRoot, relative), target);
  }
  const job = { root: path.resolve(root), parentPid: process.pid, directory, npmCli, ...legacyConsent, ...(args.package ? { artifactFile: path.resolve(String(args.package)), sha256: args.sha256 } : {}) };
  const jobFile = path.join(directory, 'job.json'); fs.writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });
  const resultFile = path.join(directory, 'result.json');
  fs.writeFileSync(resultFile, JSON.stringify({ state: 'queued', operation: 'update', queuedAt: new Date().toISOString() }), { mode: 0o600 });
  retainLastCompletedUpdatePointer({home});
  fs.writeFileSync(path.join(home, 'maintenance', 'latest-update.json'), JSON.stringify({ resultFile, directory }), { mode: 0o600 });
  const child = spawn(process.execPath, [path.join(helperRoot, 'scripts/client-update-worker.mjs'), jobFile], { env: { ...env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: resolveConfigPath({ root, env }) }, cwd: directory, detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
  return { state: 'queued', operation: 'update', workerPid: child.pid, resultFile, logFile: path.join(directory, 'maintenance.jsonl') };
}

// Only maintenance-worker identity is described here. It is never evidence that
// an employee task, Hermes process or its descendants exited.
const MAINTENANCE_STATES = new Set(['alive', 'exited', 'pid_reused', 'unknown']);
const sameMaintenancePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const psLiteral = value => "'" + String(value).replaceAll("'", "''") + "'";
const asciiJson = value => JSON.stringify(value, null, 2).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';

function readMaintenanceBytes(file) {
  noLinks(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) throw failure('UNSAFE_PATH', '维护记录不是受限的普通文件');
  return fs.readFileSync(file);
}

function readMaintenanceJson(file) { return JSON.parse(readMaintenanceBytes(file).toString('utf8').replace(/^\uFEFF/, '')); }

export function writeMaintenanceResult(file, value, { io = fs } = {}) {
  const temporary = file + '.next-' + randomUUID(); let fd;
  try {
    fd = io.openSync(temporary, 'wx', 0o600);
    io.writeFileSync(fd, asciiJson(value)); io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
    io.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) try { io.closeSync(fd); } catch {}
    try { io.unlinkSync(temporary); } catch {}
  }
}

export async function inspectMaintenanceProcess(pid) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid < 1) return { state: 'unknown' };
  try {
    const code = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){[pscustomobject]@{pid=[int]$p.ProcessId;creationTime=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;command=$p.CommandLine}|ConvertTo-Json -Compress}else{'null'}`;
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { encoding: 'utf8', timeout: 8000, windowsHide: true, maxBuffer: 65536 });
    const record = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (record === null) return { state: 'exited' };
    if (record?.pid !== pid || typeof record.command !== 'string' || !record.command || typeof record.executable !== 'string' || !record.executable || !Number.isFinite(Date.parse(record.creationTime))) return { state: 'unknown' };
    return { state: 'present', record };
  } catch { return { state: 'unknown' }; }
}

export async function maintenanceOwnerStatus(lock, { inspectProcess = inspectMaintenanceProcess } = {}) {
  if (!lock || lock.operation !== 'update' || !Number.isSafeInteger(lock.pid) || lock.pid < 1 || typeof lock.jobFile !== 'string' || !path.isAbsolute(lock.jobFile) || path.basename(lock.jobFile) !== 'job.json') return { state: 'unknown' };
  const probe = await inspectProcess(lock.pid);
  if (probe?.state === 'exited') return { state: 'exited', pid: lock.pid, probe };
  if (probe?.state !== 'present' || !probe.record) return { state: 'unknown', pid: lock.pid };
  const current = probe.record, args = (await import('./client-lifecycle.mjs')).windowsCommandArguments(current.command || '');
  const expectedEntry = path.join(path.dirname(lock.jobFile), 'helper', 'scripts', 'client-update-worker.mjs');
  const matchesLegacyCommand = args.length === 3 && sameMaintenancePath(args[0], current.executable) && sameMaintenancePath(args[1], expectedEntry) && sameMaintenancePath(args[2], lock.jobFile);
  const matchesGeneration = lock.version === 2 ? Number.isFinite(Date.parse(lock.creationTime)) && lock.creationTime === current.creationTime && sameMaintenancePath(lock.executable, current.executable) && lock.commandHash === hash(current.command) : matchesLegacyCommand;
  return { state: matchesLegacyCommand && matchesGeneration ? 'alive' : 'pid_reused', pid: lock.pid, probe };
}

// Rename the exact stale lock through its exclusively held Windows file handle.
// A path-based check followed by rename can otherwise retire a new contender's
// lock. The native operation rechecks both bytes and the observed PID generation.
export async function retireMaintenanceLock({ file, archive, sha256, owner }) {
  if (process.platform !== 'win32' || !['exited', 'pid_reused'].includes(owner?.state)) return false;
  const expected = Buffer.from(JSON.stringify({ sha256, pid: owner.pid, probe: owner.probe })).toString('base64');
  const source = `using System; using System.IO; using System.Text; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public sealed class ZiweiMaintenanceLock : IDisposable {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileSizeEx(SafeFileHandle h,out long size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadFile(SafeFileHandle h,byte[] bytes,uint size,out uint read,IntPtr overlapped);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int kind,IntPtr info,uint size);
  readonly SafeFileHandle handle;
  public ZiweiMaintenanceLock(string file) { handle=CreateFile(file,0x80010000,0,IntPtr.Zero,3,0,IntPtr.Zero); if(handle.IsInvalid)throw new IOException("LOCK_UNAVAILABLE"); }
  public byte[] Read() {long size;uint read;if(!GetFileSizeEx(handle,out size)||size<1||size>65536)throw new IOException("LOCK_INVALID");byte[] b=new byte[(int)size];if(!ReadFile(handle,b,(uint)size,out read,IntPtr.Zero)||read!=size)throw new IOException("LOCK_READ_FAILED");return b;}
  public void Rename(string file) {byte[] name=Encoding.Unicode.GetBytes(file);int root=IntPtr.Size==8?8:4;int length=root+IntPtr.Size;int start=length+4;IntPtr p=Marshal.AllocHGlobal(start+name.Length);try{for(int i=0;i<start;i++)Marshal.WriteByte(p,i,0);Marshal.WriteIntPtr(p,root,IntPtr.Zero);Marshal.WriteInt32(p,length,name.Length);Marshal.Copy(name,0,IntPtr.Add(p,start),name.Length);if(!SetFileInformationByHandle(handle,3,p,(uint)(start+name.Length)))throw new IOException("LOCK_RENAME_FAILED");}finally{Marshal.FreeHGlobal(p);}}
  public void Dispose(){handle.Dispose();}
}`;
  const code = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -TypeDefinition ${psLiteral(source)}; $expected=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${psLiteral(expected)}))|ConvertFrom-Json); $h=$null; try{$h=[ZiweiMaintenanceLock]::new(${psLiteral(file)});$hasher=[Security.Cryptography.SHA256]::Create();try{$actual=[BitConverter]::ToString($hasher.ComputeHash($h.Read())).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose()};if($actual -cne $expected.sha256){throw 'LOCK_CHANGED'};$p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$expected.pid);if($expected.probe.state -eq 'exited'){if($p){throw 'OWNER_CHANGED'}}else{if(!$p -or [int]$p.ProcessId -ne [int]$expected.probe.record.pid -or $p.CreationDate.ToUniversalTime().ToString('o') -cne $expected.probe.record.creationTime -or $p.ExecutablePath -cne $expected.probe.record.executable -or $p.CommandLine -cne $expected.probe.record.command){throw 'OWNER_CHANGED'}};$h.Rename(${psLiteral(archive)});'{"retired":true}'}catch{'{"retired":false}'}finally{if($h){$h.Dispose()}}`;
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 65536 });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim())?.retired === true;
  } catch { return false; }
}

function validateMaintenanceJobFile(jobFile, maintenance) {
  const directory = path.dirname(path.resolve(jobFile));
  return sameMaintenancePath(path.dirname(directory), maintenance) && /^update-[a-f0-9-]{36}$/.test(path.basename(directory)) && path.basename(jobFile) === 'job.json';
}

export async function acquireUpdateMaintenanceLock({ home, jobFile, inspectProcess = inspectMaintenanceProcess, retireLock = retireMaintenanceLock, log = () => {} }) {
  const maintenance = path.join(path.resolve(home), 'maintenance'), file = path.join(maintenance, 'operation.lock');
  noLinks(file);
  if (!validateMaintenanceJobFile(jobFile, maintenance)) throw failure('UNSAFE_PATH', '维护任务路径无效');
  const self = await inspectProcess(process.pid);
  if (self?.state !== 'present') throw failure('MAINTENANCE_OWNER_UNVERIFIED', '无法核验当前维护worker实例');
  const lock = { version: 2, pid: process.pid, operation: 'update', jobFile: path.resolve(jobFile), creationTime: self.record.creationTime, executable: self.record.executable, commandHash: hash(self.record.command), nonce: randomUUID() };
  if ((await maintenanceOwnerStatus(lock, { inspectProcess })).state !== 'alive') throw failure('MAINTENANCE_OWNER_UNVERIFIED', '当前维护worker身份不匹配');
  const bytes = asciiJson(lock);
  for (let attempt = 0; attempt < 4; attempt++) {
    try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); return { file, bytes, lock }; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    let existing, original;
    try { original = readMaintenanceBytes(file); existing = JSON.parse(original.toString('utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw failure('MAINTENANCE_OWNER_UNVERIFIED', '维护锁身份无法确认，未覆盖已有维护'); }
    if (!validateMaintenanceJobFile(existing.jobFile || '', maintenance)) throw failure('MAINTENANCE_OWNER_UNVERIFIED', '维护锁路径无法确认');
    const owner = await maintenanceOwnerStatus(existing, { inspectProcess });
    if (!['exited', 'pid_reused'].includes(owner.state)) throw failure(owner.state === 'alive' ? 'MAINTENANCE_BUSY' : 'MAINTENANCE_OWNER_UNVERIFIED', '维护worker仍在运行或身份无法确认', { maintenanceOwnerState: owner.state, workerPid: existing.pid });
    const archive = path.join(maintenance, `retired-operation-${randomUUID()}.json`);
    if (!await retireLock({ file, archive, sha256: hash(original), owner })) continue;
    log('stale_maintenance_lock_retired', { previousWorkerPid: existing.pid, ownerState: owner.state });
  }
  throw failure('MAINTENANCE_OWNER_UNVERIFIED', '维护锁状态持续变化或暂时无法归档；未更换安装');
}

export function releaseUpdateMaintenanceLock(lease) {
  if (!lease) return false;
  try { noLinks(lease.file); if (fs.readFileSync(lease.file, 'utf8') !== lease.bytes) return false; fs.unlinkSync(lease.file); return true; }
  catch { return false; }
}

function lastMaintenanceEvent(directory) {
  try {
    const file = path.join(directory, 'maintenance.jsonl'); noLinks(file);
    const stat = fs.statSync(file); if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index--) {
      let event; try { event = JSON.parse(lines[index]); } catch { continue; }
      if (event && typeof event.event === 'string' && /^[a-z_]{1,64}$/.test(event.event) && Number.isFinite(Date.parse(event.at))) return event;
    }
  } catch {}
  return null;
}

function terminalMaintenanceFailure(directory) {
  try {
    const file = path.join(directory, 'maintenance.jsonl'); noLinks(file);
    const stat = fs.statSync(file); if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index--) {
      let event; try { event = JSON.parse(lines[index]); } catch { continue; }
      if (!['maintenance_failed', 'update_failed'].includes(event?.event) || !Number.isFinite(Date.parse(event.at))) continue;
      const diagnostic = describeUpdateFailure({ code: event.reasonCode, ...(Number.isInteger(event.exitCode) ? { code: event.exitCode, cmd: 'child' } : {}) }, event.failureStage);
      return { state: 'failed', operation: 'update', code: 'UPDATE_FAILED', ...diagnostic, originalRestored: typeof event.originalRestored === 'boolean' ? event.originalRestored : null, originalInstallationRestored: typeof event.originalInstallationRestored === 'boolean' ? event.originalInstallationRestored : null, runningStateRestored: typeof event.runningStateRestored === 'boolean' ? event.runningStateRestored : null, finishedAt: event.at, recoveredFrom: 'maintenance-log', message: '更新失败；已从维护日志恢复真实结果。' + diagnosticMessage(diagnostic) };
    }
  } catch {}
  return null;
}

export async function readUpdateResult({ env = process.env, resultFile, inspectProcess = inspectMaintenanceProcess } = {}) {
  try {
    const maintenance = path.join(defaultUserDir({ env }), 'maintenance');
    const pointer = resultFile ? {resultFile:path.resolve(String(resultFile)),directory:path.dirname(path.resolve(String(resultFile)))} : readMaintenanceJson(path.join(maintenance, 'latest-update.json'));
    if (!validateMaintenanceJobFile(path.join(pointer.directory || '', 'job.json'), maintenance) || !sameMaintenancePath(pointer.resultFile, path.join(pointer.directory, 'result.json'))) throw failure('UNSAFE_PATH', '更新状态入口无效');
    let result = readMaintenanceJson(pointer.resultFile);
    const details = { resultFile: pointer.resultFile, logFile: path.join(pointer.directory, 'maintenance.jsonl') };
    if (!['queued', 'running'].includes(result.state)) return { ...result, ...details };
    try { const terminal = readMaintenanceJson(path.join(pointer.directory, 'terminal.json')); if (['complete', 'failed'].includes(terminal.state)) result = terminal; } catch {}
    if (['queued', 'running'].includes(result.state)) result = terminalMaintenanceFailure(pointer.directory) || result;
    const event = lastMaintenanceEvent(pointer.directory);
    let identity;
    try { identity = readMaintenanceJson(path.join(pointer.directory, 'worker.json')); } catch {}
    if (!identity) try { const candidate = readMaintenanceJson(path.join(maintenance, 'operation.lock')); if (sameMaintenancePath(candidate.jobFile, path.join(pointer.directory, 'job.json'))) identity = candidate; } catch {}
    if (!identity && Number.isSafeInteger(result.workerPid || event?.pid) && (result.workerPid || event?.pid) > 0) identity = {operation:'update',pid:result.workerPid || event.pid,jobFile:path.join(pointer.directory,'job.json')};
    const owner = identity ? await maintenanceOwnerStatus(identity, { inspectProcess }) : { state: 'unknown' };
    if (['queued', 'running'].includes(result.state)) { const {finishedAt:_staleFinishedAt,...nonterminal}=result; result=nonterminal; }
    if (['queued', 'running'].includes(result.state) && ['exited', 'pid_reused'].includes(owner.state)) result = { ...result, state: 'interrupted', code: 'MAINTENANCE_WORKER_EXITED', reason: '维护worker已退出，更新未完成；下次官方更新会自动归档失效维护锁', message: '维护worker已退出，更新未完成；下次官方更新会自动归档失效维护锁', finishedAt: event?.at || null };
    return { ...result, ...details, workerStatus: owner.state, ...(identity ? { workerPid: identity.pid } : {}), ...(event ? { lastEvent: event.event, lastProgressAt: event.at } : {}) };
  } catch (error) { if (error.code === 'ENOENT') return { state: 'none', operation: 'update' }; throw error; }
}

export async function waitForParentExit(pid, timeoutMs = 30_000) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw failure('INVALID_PARENT', '更新父进程身份无效，未修改安装');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { let alive = true; try { process.kill(pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; } if (!alive) return; await pause(100); }
  throw failure('PARENT_STILL_RUNNING', '发起更新的 CLI 未退出，未停止 daemon 或更换程序目录');
}
