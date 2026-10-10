import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveConfigPath, defaultUserDir } from '../daemon/config.mjs';
import { clientBuildIdentity } from '../src/management-bootstrap.mjs';

const run = promisify(execFile);
export const OFFICIAL_UPDATE_SOURCE = 'https://qzelynth.top/downloads/cli/ziwei-latest.tgz';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function validateUpdateSource(value, { allowLoopback = false } = {}) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('更新地址必须是纯 HTTPS URL，不能包含 Markdown 链接格式'); }
  if ((url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('更新地址必须使用 HTTPS，不接受凭据、查询串或片段');
  return url.href;
}

export async function downloadVerifiedPackage({ url, sha256, destination, allowLoopback = false }) {
  const source = validateUpdateSource(url, { allowLoopback });
  if (!/^[a-f0-9]{64}$/.test(sha256 || '')) throw new Error('更新包缺少有效 SHA-256');
  const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`更新包下载失败（HTTP ${response.status}）`);
  if (Number(response.headers.get('content-length')) > 50 * 1024 * 1024) throw new Error('更新包超过大小限制');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 50 * 1024 * 1024) throw new Error('更新包超过大小限制'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  if (hash(bytes) !== sha256) throw new Error('更新包 SHA-256 校验失败，原版本未修改');
  fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
  return { sha256, bytes: size };
}

export function validateCandidatePackage(root) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (meta.name !== 'ziwei' || JSON.stringify(meta.bin) !== JSON.stringify({ ziwei_user: 'scripts/ziwei-user.mjs' }) || !fs.statSync(path.join(root, 'scripts/ziwei-user.mjs')).isFile()) throw new Error('更新目标必须是紫薇 ziwei 包及原 ziwei_user 入口');
  return meta;
}

export function resolveInstalledPackage(input, platform = process.platform) {
  const root = path.resolve(input);
  const actualRoot = fs.realpathSync(root);
  if ((platform === 'win32' ? actualRoot.toLowerCase() !== root.toLowerCase() : actualRoot !== root) || fs.lstatSync(root).isSymbolicLink()) throw new Error('安装目录不能是链接；未修改其他安装');
  validateCandidatePackage(root);
  const modules = path.dirname(root);
  if (path.basename(root) !== 'ziwei' || path.basename(modules) !== 'node_modules') throw new Error('update/uninstall 只支持实际全局安装，源码工作树不属于卸载范围');
  let prefix = path.dirname(modules);
  if (platform !== 'win32') { if (path.basename(prefix) !== 'lib') throw new Error('无法核实全局 npm 安装布局'); prefix = path.dirname(prefix); }
  return { root, prefix, modules, binDirectory: platform === 'win32' ? prefix : path.join(prefix, 'bin') };
}

export function resolveNpmCli({ env = process.env, node = process.execPath } = {}) {
  const paths = [env.npm_execpath, path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(node), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  for (const candidate of paths) {
    try { const real = fs.realpathSync(candidate); if (path.basename(real) === 'npm-cli.js' && JSON.parse(fs.readFileSync(path.resolve(real, '../../package.json'))).name === 'npm') return real; } catch {}
  }
  throw new Error('未找到当前 Node 对应的 npm CLI；原安装未修改，请在正常 Node/npm 终端重试');
}

function assertOutside(file, root) {
  const relative = path.relative(root, path.resolve(file));
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('用户配置与维护目录必须位于客户端程序目录之外，未移动或删除用户数据');
}

function noLinks(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    let stat; try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw new Error('维护路径包含链接，未修改客户端或用户数据');
    if (current === path.dirname(current)) break;
  }
}

function copyPackage(source, destination) {
  function inspect(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isSymbolicLink()) throw new Error('客户端安装包含链接，未复制或更换程序目录'); if (entry.isDirectory()) inspect(file); } }
  inspect(source); fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
}

function configurationSnapshot(file) { return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null; }
function assertConfiguration(file, before) { if (configurationSnapshot(file) !== before) throw new Error('维护期间连接配置发生变化；未覆盖用户的新配置'); }

export async function performClientUpdate({ root, env = process.env, directory, artifactFile, sha256, source = OFFICIAL_UPDATE_SOURCE, npmCli = resolveNpmCli({ env }), stopClient, log = () => {} } = {}) {
  if (process.platform !== 'win32') throw new Error('本轮 update 仅支持 Windows；未修改此平台客户端');
  const installation = resolveInstalledPackage(root);
  const lifecycle = await import('./client-lifecycle.mjs');
  const originalLayout = lifecycle.validateInstalledClientLayout({ root, env });
  directory = path.resolve(directory); assertOutside(directory, root); noLinks(directory);
  const configFile = resolveConfigPath({ root, env }); assertOutside(configFile, root); noLinks(configFile);
  const configBefore = configurationSnapshot(configFile);
  const userHome = defaultUserDir({ env }); assertOutside(userHome, root); noLinks(userHome);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const archive = path.join(directory, 'verified-update.tgz');
  if (artifactFile) { const bytes = fs.readFileSync(path.resolve(artifactFile)); if (!/^[a-f0-9]{64}$/.test(sha256 || '') || hash(bytes) !== sha256) throw new Error('本地更新包 SHA-256 校验失败'); fs.writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600 }); }
  else {
    source = validateUpdateSource(source);
    const metadataUrl = new URL('release.json', source).href;
    const response = await fetch(metadataUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`官方发布清单读取失败（HTTP ${response.status}）`);
    const metadata = await response.json();
    if (metadata.url !== source || !/^[a-f0-9]{64}$/.test(metadata.sha256 || '')) throw new Error('官方发布清单与安装地址不一致');
    sha256 = metadata.sha256;
    await downloadVerifiedPackage({ url: source, sha256, destination: archive });
  }
  // Install and validate the complete dependency tree before touching the running client.
  const stage = path.join(directory, 'stage-prefix');
  log('update_staging', { sha256 });
  await run(process.execPath, [npmCli, 'install', '--global', '--prefix', stage, archive, '--ignore-scripts', '--no-audit', '--no-fund'], { env, cwd: directory, timeout: 180_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const stagedRoot = path.join(stage, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', 'ziwei');
  validateCandidatePackage(stagedRoot);
  await run(process.execPath, [path.join(stagedRoot, 'scripts/ziwei-user.mjs'), 'version'], { env, cwd: directory, timeout: 15_000, windowsHide: true });
  const newBuild = clientBuildIdentity(stagedRoot), oldBuild = clientBuildIdentity(root);
  const operationId = randomUUID();
  const candidate = path.join(installation.modules, `.ziwei-ready-${operationId}`);
  const backup = path.join(installation.modules, `.ziwei-backup-${operationId}`);
  copyPackage(stagedRoot, candidate);
  assertConfiguration(configFile, configBefore);
  let stopped, moved = false, installed = false;
  const stop = stopClient || lifecycle.stopClient;
  const start = async () => run(process.execPath, [path.join(root, 'scripts/start-ziwei-user.mjs')], { env, cwd: userHome, timeout: 30_000, windowsHide: true });
  try {
    stopped = await stop({ root, env });
    assertConfiguration(configFile, configBefore);
    if (clientBuildIdentity(root) !== oldBuild) throw new Error('原程序在准备期间已变化，未覆盖另一维护任务的安装');
    const currentLayout = lifecycle.validateInstalledClientLayout({ root, env });
    if (currentLayout.binHashes.some((item, i) => item.hash !== originalLayout.binHashes[i].hash)) throw new Error('原 npm 入口在维护期间已变化，未覆盖或修改其他程序入口');
    // Both renames stay in the original node_modules directory. npm's original bin shims
    // continue pointing to the same ziwei_user entry; no global prefix is rewritten.
    fs.renameSync(root, backup); moved = true;
    fs.renameSync(candidate, root); installed = true;
    validateCandidatePackage(root);
    if (clientBuildIdentity(root) !== newBuild) throw new Error('实际安装 build 与已验证候选不一致');
    assertConfiguration(configFile, configBefore);
    const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile)) : null;
    const restart = Boolean(stopped.wasRunning && config?.workspace && config?.connectionState !== 'disconnected');
    if (restart) await start();
    assertConfiguration(configFile, configBefore);
    log('update_complete', { oldBuild, clientBuild: newBuild, sha256, restoredRunning: restart, backup });
    return { state: 'complete', operation: 'update', oldBuild, clientBuild: newBuild, sha256, restoredRunning: restart, configurationPreserved: true, prefix: installation.prefix, backup };
  } catch (error) {
    let recovered = !moved;
    if (moved) {
      try {
        // A failed startup may leave a new daemon alive; stop only that exact installation.
        if (installed) await stop({ root, env });
        if (fs.existsSync(root)) fs.renameSync(root, path.join(installation.modules, `.ziwei-failed-${operationId}`));
        fs.renameSync(backup, root); recovered = clientBuildIdentity(root) === oldBuild;
      } catch { recovered = false; }
    }
    if (recovered && stopped?.wasRunning) {
      const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile)) : null;
      if (config?.workspace && config?.connectionState !== 'disconnected') { try { await start(); } catch { recovered = false; } }
    }
    const busy = ['EBUSY', 'EPERM', 'EACCES'].includes(error.code);
    log('update_failed', { originalRestored: recovered, code: error.code || 'UPDATE_FAILED', backup: moved ? backup : null });
    throw Object.assign(new Error(recovered ? (busy ? 'Windows 安装目录仍被其他进程或终端占用；原版本已保留或恢复，连接配置未清空。请退出该目录/解除实际占用后重试。' : '更新失败，原版本已保留或恢复；连接配置未清空。请查看维护日志。') : `更新失败且原版本恢复未完成；原程序备份保留于 ${backup}，请查看维护日志，不要重新配对。`, { cause: error }), { code: busy ? 'PROGRAM_DIRECTORY_BUSY' : 'UPDATE_FAILED', originalRestored: recovered });
  }
}

export async function launchClientUpdate({ codeRoot, root = codeRoot, args = {}, env = process.env } = {}) {
  if (process.platform !== 'win32') throw new Error('本轮 update 仅支持 Windows；未修改此平台客户端');
  resolveInstalledPackage(root);
  const { validateInstalledClientLayout } = await import('./client-lifecycle.mjs');
  validateInstalledClientLayout({ root, env });
  const npmCli = resolveNpmCli({ env });
  const home = defaultUserDir({ env }); assertOutside(home, root); noLinks(home);
  if (args.force) throw new Error('update 不使用 --force；Windows 文件占用不能强制绕过。此命令会先安全停止本客户端再更换已验证程序。');
  const directory = path.join(home, 'maintenance', `update-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const helperRoot = path.join(directory, 'helper'); fs.mkdirSync(helperRoot);
  for (const relative of ['package.json', 'daemon/config.mjs', 'src/management-bootstrap.mjs', 'scripts/client-update.mjs', 'scripts/client-update-worker.mjs', 'scripts/client-lifecycle.mjs']) {
    const target = path.join(helperRoot, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(codeRoot, relative), target);
  }
  const job = { root: path.resolve(root), parentPid: process.pid, directory, npmCli, ...(args.package ? { artifactFile: path.resolve(String(args.package)), sha256: args.sha256 } : {}) };
  const jobFile = path.join(directory, 'job.json'); fs.writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });
  const resultFile = path.join(directory, 'result.json');
  fs.writeFileSync(resultFile, JSON.stringify({ state: 'queued', operation: 'update', queuedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.writeFileSync(path.join(home, 'maintenance', 'latest-update.json'), JSON.stringify({ resultFile, directory }), { mode: 0o600 });
  const child = spawn(process.execPath, [path.join(helperRoot, 'scripts/client-update-worker.mjs'), jobFile], { env: { ...env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: resolveConfigPath({ root, env }) }, cwd: directory, detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
  return { state: 'queued', operation: 'update', workerPid: child.pid, resultFile, logFile: path.join(directory, 'maintenance.jsonl') };
}

export function readUpdateResult({ env = process.env } = {}) {
  try { const pointer = JSON.parse(fs.readFileSync(path.join(defaultUserDir({ env }), 'maintenance', 'latest-update.json'))); return { ...JSON.parse(fs.readFileSync(pointer.resultFile)), resultFile: pointer.resultFile, logFile: path.join(pointer.directory, 'maintenance.jsonl') }; } catch (error) { if (error.code === 'ENOENT') return { state: 'none', operation: 'update' }; throw error; }
}

export async function waitForParentExit(pid, timeoutMs = 30_000) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('更新父进程身份无效，未修改安装');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { let alive = true; try { process.kill(pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; } if (!alive) return; await pause(100); }
  throw new Error('发起更新的 CLI 未退出，未停止 daemon 或更换程序目录');
}
