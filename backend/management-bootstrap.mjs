import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeTokenEqual } from './a2a-auth.mjs';

const fail = (message, code, status = 401) => { throw Object.assign(new Error(message), { code, status }); };
const audience = 'ziwei-management';
const prefix = 'zmcp1.';
const ttl = 60 * 60 * 1000;

function signingSecret(options) {
  const supplied = options.managementMcpSecret || process.env.ZIWEI_MANAGEMENT_SIGNING_SECRET;
  if (supplied) return supplied;
  if (options.memory) return crypto.randomBytes(32);
  const file = options.managementMcpSecretFile || process.env.ZIWEI_MANAGEMENT_SIGNING_SECRET_FILE || path.resolve(process.cwd(), 'data', 'management-mcp-signing.key');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, crypto.randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const value = fs.readFileSync(file, 'utf8').trim();
  if (value.length < 32) throw new Error('管理 MCP 服务端签名密钥无效');
  try { fs.chmodSync(file, 0o600); } catch {}
  return value;
}

// The device credential authenticates the connection. Only a short-lived,
// separately signed, single-workspace credential is passed to the MCP adapter.
export function createManagementBootstrap(repo, options = {}) {
  const db = repo.db;
  const now = options.managementMcpNow || Date.now;
  const key = crypto.createHash('sha256').update(signingSecret(options)).update('ziwei-management-capability-v1').digest();
  const apiBase = String(options.publicApiBase || process.env.ZIWEI_APP_URL || 'https://qzelynth.top').replace(/\/$/, '');
  const contextFor = (credentialId, deviceId, workspace) => {
    const row = db.prepare(`SELECT c.id,c.revoked_at,d.status,d.owner_user_id,w.slug,w.kind,m.role
      FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.workspace_id=c.workspace_id
      JOIN workspaces w ON w.id=c.workspace_id
      LEFT JOIN members m ON m.workspace_id=w.id AND m.user_id=d.owner_user_id
      WHERE c.id=? AND d.id=? AND w.slug=?`).get(credentialId, deviceId, workspace);
    if (!row || row.revoked_at || row.status === 'disabled') fail('管理 MCP 设备凭据已撤销或停用', 'MANAGEMENT_DEVICE_REVOKED');
    if (row.owner_user_id && !['owner', 'admin', 'member'].includes(row.role)) fail('设备所属账号已失去当前工作区成员权限', 'MANAGEMENT_MEMBERSHIP_REVOKED', 403);
    return { actorUserId: row.owner_user_id || null, actorRole: row.role || 'member', deviceCredentialDeviceId: deviceId, ...(row.kind === 'personal' && !row.owner_user_id ? { deviceScope: deviceId } : {}), enforceEmployeeVisibility: true, enforceDeviceOwnership: true };
  };
  const sign = payload => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${prefix}${body}.${crypto.createHmac('sha256', key).update(prefix + body).digest('base64url')}`;
  };
  const bootstrap = (workspace, credential) => {
    if (!credential || credential.workspace !== workspace) fail('需要当前工作区有效的电脑连接凭据', 'MANAGEMENT_DEVICE_UNAUTHORIZED');
    contextFor(credential.credentialId, credential.deviceId, workspace);
    const payload = { audience, workspace, deviceId: credential.deviceId, credentialId: credential.credentialId, expiresAt: new Date(now() + ttl).toISOString() };
    return { ...payload, token: sign(payload), apiBase, managed: true };
  };
  const authorize = (token, workspace) => {
    if (!String(token || '').startsWith(prefix)) return null;
    if (token.length > 8192) fail('管理 MCP 凭据无效', 'MANAGEMENT_CREDENTIAL_INVALID');
    const [body, signature, ...extra] = token.slice(prefix.length).split('.');
    if (extra.length || !body || !signature || !safeTokenEqual(signature, crypto.createHmac('sha256', key).update(prefix + body).digest('base64url'))) fail('管理 MCP 凭据无效', 'MANAGEMENT_CREDENTIAL_INVALID');
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { fail('管理 MCP 凭据无效', 'MANAGEMENT_CREDENTIAL_INVALID'); }
    const expiry = Date.parse(payload?.expiresAt);
    if (payload?.audience !== audience || !Number.isFinite(expiry) || expiry <= now() || expiry > now() + ttl || !payload.workspace || !payload.deviceId || !payload.credentialId) fail('管理 MCP 凭据已过期或用途不匹配，请由客户端重新准备', 'MANAGEMENT_CREDENTIAL_EXPIRED');
    if (workspace && payload.workspace !== workspace) fail('管理 MCP 凭据没有该工作区权限', 'MANAGEMENT_WORKSPACE_SCOPE', 403);
    const context = contextFor(payload.credentialId, payload.deviceId, payload.workspace);
    return { workspace: payload.workspace, workspaces: [payload.workspace], deviceId: payload.deviceId, credentialId: payload.credentialId, managed: true, ...context };
  };
  const connections = (workspace, context = {}) => repo.listDevices(workspace, { userId: context.actorUserId }).filter(device => !context.deviceScope || device.id === context.deviceScope).map(device => {
    let metadata = {};
    try { metadata = JSON.parse(device.management_mcp_json || '{}'); } catch {}
    const expiry = Date.parse(metadata.expiresAt || '');
    const configured = metadata.managed === true && metadata.configured === true && metadata.workspace === workspace && Number.isFinite(expiry) && expiry > now();
    const state = device.status === 'disabled' ? 'client_required' : configured ? 'ready' : metadata.state === 'failed' ? 'failed' : metadata.state === 'client_required' ? 'client_required' : metadata.managed ? 'pending' : 'client_required';
    return { device_id: device.id, name: device.name, status: device.status, managed: metadata.managed === true, configured, state, workspace, ...(metadata.reasonCode ? { reasonCode: metadata.reasonCode } : {}), ...(metadata.reason ? { reason: metadata.reason } : {}), ...(Number.isFinite(expiry) ? { expiresAt: metadata.expiresAt } : {}) };
  });
  return { bootstrap, authorize, connections, apiBase };
}
