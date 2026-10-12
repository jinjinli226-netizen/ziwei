import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

/**
 * Resolve files for a daemon installation. Project mode deliberately keeps
 * the historical data/ path, while a packaged daemon can set ZIWEI_USER_HOME
 * and keep credentials, logs and runtime state outside any checkout.
 */
export function defaultUserDir({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (env.ZIWEI_USER_HOME) return path.resolve(String(env.ZIWEI_USER_HOME));
  if (platform === 'win32') return path.join(String(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')), 'Ziwei', 'ziwei_user');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Ziwei', 'ziwei_user');
  return path.join(String(env.XDG_STATE_HOME || path.join(home, '.local', 'state')), 'ziwei_user');
}

export function resolveConfigPath({ root = process.cwd(), env = process.env } = {}) {
  if (env.ZIWEI_CONFIG) return path.resolve(String(env.ZIWEI_CONFIG));
  if (env.ZIWEI_USER_HOME) return path.join(defaultUserDir({ env, home: os.homedir() }), 'ziwei_user.json');
  return path.join(path.resolve(root), 'data', 'ziwei_user.json');
}

export function resolveConfigFile(value, { configPath, root = process.cwd() } = {}) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  if (path.isAbsolute(candidate)) return path.normalize(candidate);
  const base = configPath ? path.dirname(path.resolve(configPath)) : path.resolve(root);
  return path.resolve(base, candidate);
}

function checkedApiBase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('共享工作区 API 地址无效'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('共享工作区 API 必须使用 HTTPS 根地址（隔离验收允许 loopback HTTP）');
  return url.origin;
}

/** Each workspace has its own paired device identity; invalid shares never stop the primary. */
export function resolveWorkspaceConnections(config = {}, { configPath, root = process.cwd() } = {}) {
  const connections = [{ ...config, primary: true }];
  const errors = [];
  const seen = new Set([config.workspace]);
  for (const entry of Array.isArray(config.sharedWorkspaces) ? config.sharedWorkspaces : []) {
    if (entry?.enabled === false) continue;
    try {
      if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(entry?.workspace || '') || seen.has(entry.workspace)) throw new Error('共享工作区为空、无效或重复');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(entry.deviceId || '')) throw new Error('共享工作区缺少独立设备 ID');
      const file = resolveConfigFile(entry.deviceTokenFile, { configPath, root });
      let credential;
      try { credential = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('共享工作区私有设备凭据不存在或不可读取'); }
      if (!credential.deviceToken || credential.workspace !== entry.workspace || credential.deviceId !== entry.deviceId) throw new Error('共享工作区设备凭据范围不匹配');
      const apiBase = checkedApiBase(entry.apiBase || config.apiBase);
      connections.push({ ...config, ...entry, apiBase, workdir: entry.workdir || config.workdir, primary: false, deviceToken: credential.deviceToken });
      seen.add(entry.workspace);
    } catch (error) { errors.push({ workspace: String(entry?.workspace || ''), configured: false, reason: error.message }); }
  }
  return { connections, errors };
}

/** Claim an explicit server grant using the primary identity, without leaking the new credential. */
export async function claimWorkspaceGrant({ config, configPath, privateDirectory, grantId, signal } = {}) {
  if (!config?.deviceToken || !configPath || !privateDirectory) throw new Error('共享接入缺少主工作区设备凭据或本机私有配置路径');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(grantId || '')) throw new Error('共享授权 grantId 无效');
  const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const duplicate = current.sharedWorkspaces?.find(entry => entry.grantId === grantId);
  if (duplicate) {
    const resolved = resolveWorkspaceConnections(current, { configPath }).connections.find(entry => !entry.primary && entry.grantId === grantId);
    if (!resolved) throw new Error('已接收共享授权的私有凭据缺失；请重新授权，不会重放旧 grant');
    return { workspace: resolved.workspace, deviceId: resolved.deviceId, duplicate: true };
  }
  if (current.workspace !== config.workspace || current.deviceId !== config.deviceId) throw new Error('主工作区配置已变化，拒绝接收旧设备共享授权');
  const apiBase = checkedApiBase(config.apiBase);
  let response;
  try {
    response = await fetch(`${apiBase}/api/daemon/workspace-grants/${encodeURIComponent(grantId)}/claim`, { method: 'POST', headers: { 'x-ziwei-device-token': config.deviceToken }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000), redirect: 'error' });
  } catch { throw new Error('共享工作区授权服务无法连接'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`共享工作区授权领取失败（HTTP ${response.status}）；请核对Owner授权和主设备身份`);
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(body.workspace || '') || body.workspace === config.workspace || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(body.deviceId || '') || body.deviceId === config.deviceId || !body.deviceToken || checkedApiBase(body.apiBase) !== apiBase) throw new Error('共享授权返回的工作区、独立设备或 API 范围不匹配');
  const shares = Array.isArray(current.sharedWorkspaces) ? current.sharedWorkspaces : [];
  if (shares.some(entry => entry.workspace === body.workspace)) throw new Error('目标工作区已有显式共享连接；请先撤销旧授权');
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  const deviceTokenFile = path.join(privateDirectory, `${body.workspace}-${randomUUID()}.json`);
  fs.writeFileSync(deviceTokenFile, JSON.stringify({ workspace: body.workspace, deviceId: body.deviceId, deviceToken: body.deviceToken }), { mode: 0o600, flag: 'wx' });
  const entry = { workspace: body.workspace, deviceId: body.deviceId, apiBase, deviceTokenFile, grantId, authorizedAt: new Date().toISOString() };
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ ...current, sharedWorkspaces: [...shares, entry] }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, configPath);
  } catch (error) {
    try { fs.rmSync(deviceTokenFile, { force: true }); fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
  return { workspace: body.workspace, deviceId: body.deviceId, duplicate: false };
}
