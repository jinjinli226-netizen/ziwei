import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const RENEW_BEFORE_MS = 5 * 60_000;
const SUPPORTED_RUNTIMES = ['Codex', 'Hermes'];

function checkedOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('管理 MCP API 地址无效'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('管理 MCP API 必须为无凭据的 HTTPS 根地址');
  return url.origin;
}

/** One authenticated computer connection owns one atomically renewed private file. */
export function createManagementBootstrap({ workspace, deviceId, deviceToken, apiBase, cacheDirectory, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let origin, tokenFile, setupError;
  try {
    origin = checkedOrigin(apiBase);
    if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(workspace || '') || !deviceId || !deviceToken) throw new Error('管理 MCP 需要当前工作区已配对的电脑身份，请连接或更新 ziwei_user');
    if (!cacheDirectory) throw new Error('管理 MCP 缺少本机私有缓存目录');
    tokenFile = path.join(path.resolve(cacheDirectory), `${createHash('sha256').update(JSON.stringify([origin, workspace, deviceId])).digest('hex')}.json`);
  } catch (error) { setupError = error; }
  const baseStatus = { configured: false, managed: true, workspace: workspace || null, transport: 'stdio', supportedRuntimes: SUPPORTED_RUNTIMES, credentialMode: 'device-bootstrap' };
  let state = { ...baseStatus, state: setupError ? 'client_required' : 'pending', ...(setupError ? { reasonCode: 'MANAGEMENT_CLIENT_REQUIRED', reason: setupError.message } : {}) };
  let inFlight = null, retryAt = null, forceNext = false;

  function valid(credential) {
    return credential?.managed === true && credential.audience === 'ziwei-management' && typeof credential.token === 'string' && credential.token.trim()
      && credential.workspace === workspace && credential.deviceId === deviceId && typeof credential.credentialId === 'string' && credential.credentialId
      && credential.apiBase === origin && Date.parse(credential.expiresAt) > now();
  }
  function cached() {
    try {
      if (process.platform !== 'win32' && (fs.statSync(tokenFile).mode & 0o077)) return null;
      const value = JSON.parse(fs.readFileSync(tokenFile, 'utf8')); return valid(value) ? value : null;
    } catch { return null; }
  }
  function ready(credential) {
    state = { ...baseStatus, configured: true, state: 'ready', expiresAt: credential.expiresAt };
    return { enabled: true, managed: true, tokenFile, baseUrl: origin, deviceId, credentialId: credential.credentialId, expiresAt: credential.expiresAt };
  }
  async function prepare({ force = false, signal } = {}) {
    if (setupError) throw setupError;
    if (inFlight) return inFlight;
    const previous = cached();
    if (!force && !forceNext && previous && Date.parse(previous.expiresAt) - now() > RENEW_BEFORE_MS) return ready(previous);
    forceNext = false;
    state = { ...baseStatus, state: 'pending' };
    inFlight = (async () => {
      let response;
      try {
        response = await fetchImpl(`${origin}/api/workspaces/${encodeURIComponent(workspace)}/mcp/bootstrap`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-ziwei-device-token': deviceToken }, body: '{}', redirect: 'error',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
        });
      } catch { throw Object.assign(new Error('管理 MCP 自动准备服务无法连接；设备心跳仍可继续'), { reasonCode: 'MANAGEMENT_BOOTSTRAP_UNREACHABLE' }); }
      if (!response.ok) {
        // Never forward an arbitrary server response that might include credential material.
        const message = response.status === 401 || response.status === 403 ? '当前电脑配对身份无效、已撤销或不属于此工作区' : response.status === 404 ? '服务器尚不支持自动管理 MCP，请更新主站与 ziwei_user' : '服务器暂时无法准备管理 MCP';
        throw Object.assign(new Error(`管理 MCP 自动准备失败（HTTP ${response.status}）：${message}`), { reasonCode: response.status === 404 ? 'MANAGEMENT_BOOTSTRAP_UNSUPPORTED' : 'MANAGEMENT_BOOTSTRAP_REJECTED' });
      }
      const credential = await response.json().catch(() => null);
      if (!valid(credential)) throw Object.assign(new Error('管理 MCP 自动凭据范围、电脑身份、有效期或 API 不匹配'), { reasonCode: 'MANAGEMENT_BOOTSTRAP_SCOPE_MISMATCH' });
      const value = { token: credential.token, workspace, workspaces: [workspace], deviceId, credentialId: credential.credentialId, expiresAt: credential.expiresAt, apiBase: origin, audience: 'ziwei-management', managed: true };
      fs.mkdirSync(path.dirname(tokenFile), { recursive: true, mode: 0o700 });
      const temporary = `${tokenFile}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, tokenFile);
        if (process.platform !== 'win32') fs.chmodSync(tokenFile, 0o600);
      } finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
      return ready(value);
    })().catch(error => {
      forceNext = true; // A rejected renewal must not resurrect an older cached bearer.
      state = { ...baseStatus, state: error.reasonCode === 'MANAGEMENT_BOOTSTRAP_UNSUPPORTED' ? 'client_required' : 'failed', reasonCode: error.reasonCode || 'MANAGEMENT_CACHE_WRITE_FAILED', reason: error.reasonCode ? error.message : '管理 MCP 私有凭据无法安全保存，请检查用户目录权限' };
      throw Object.assign(new Error(state.reason), { code: state.reasonCode });
    }).finally(() => { inFlight = null; });
    return inFlight;
  }
  return {
    prepare, status: () => ({ ...state, supportedRuntimes: [...SUPPORTED_RUNTIMES] }),
    noteRetry(value) { if (!value || value === retryAt) return false; retryAt = value; forceNext = true; return true; },
  };
}

/** Compare actual packaged source, because historical packages reused version 0.1.0. */
export function clientBuildIdentity(root) {
  const hash = createHash('sha256');
  const files = ['package.json', 'backend/a2a-auth.mjs', 'scripts/ziwei-user.mjs', 'scripts/ziwei-cli.mjs', 'scripts/start-ziwei-user.mjs', 'scripts/ziwei-mcp.mjs', 'scripts/ziwei-terminal-mcp.mjs'];
  function walk(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : entry.name.endsWith('.mjs') ? [path.relative(root, path.join(directory, entry.name))] : []);
  }
  files.push(...walk(path.join(root, 'daemon')), ...walk(path.join(root, 'src')));
  for (const file of [...new Set(files)].sort()) if (fs.existsSync(path.join(root, file))) hash.update(file.replaceAll('\\', '/')).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  return hash.digest('hex');
}

export function clientBuildMismatch(body, version, build) {
  if (body?.clientBuild) return body.clientBuild !== build || (body.version && body.version !== version);
  return Boolean(body?.version); // Known legacy client, no build identity: refresh through native start.
}
