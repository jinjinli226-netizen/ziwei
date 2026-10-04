import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// MCP management credentials are deliberately independent from browser sessions,
// A2A machine credentials, and workspace API keys. The file may contain either
// a JSON credential ({ token, workspaces }) or a legacy plain token; plain-token
// files must provide the workspace scope through ZIWEI_MCP_WORKSPACES.
export const defaultMCPTokenPath = () => process.env.ZIWEI_MCP_TOKEN_FILE || path.resolve(process.cwd(), 'data', 'mcp.token');

function normalizeWorkspaces(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))];
}

function parseCredential(raw, fallbackWorkspaces = []) {
  const text = String(raw || '').trim();
  if (!text) return { token: '', workspaces: normalizeWorkspaces(fallbackWorkspaces) };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return {
        token: String(parsed.token || parsed.bearerToken || '').trim(),
        workspaces: normalizeWorkspaces(parsed.workspaces ?? parsed.workspace ?? fallbackWorkspaces)
      };
    }
  } catch {}
  return { token: text, workspaces: normalizeWorkspaces(fallbackWorkspaces) };
}

export function readMCPCredential({ create = true, file = defaultMCPTokenPath(), token = '', workspaces = [] } = {}) {
  const configuredToken = String(token || process.env.ZIWEI_MCP_TOKEN || '').trim();
  const configuredWorkspaces = normalizeWorkspaces(workspaces.length ? workspaces : (process.env.ZIWEI_MCP_WORKSPACES || process.env.ZIWEI_MCP_WORKSPACE));
  if (configuredToken) return { token: configuredToken, workspaces: configuredWorkspaces, source: 'configuration' };
  try {
    const credential = parseCredential(fs.readFileSync(file, 'utf8'), configuredWorkspaces);
    if (credential.token) return { ...credential, source: file };
  } catch {}
  if (!create) return { token: '', workspaces: configuredWorkspaces, source: file };
  const generated = crypto.randomBytes(32).toString('base64url');
  const credential = { token: generated, workspaces: configuredWorkspaces };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(credential, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return { ...credential, source: file };
}

export function writeMCPCredential({ file = defaultMCPTokenPath(), token = crypto.randomBytes(32).toString('base64url'), workspaces = [] } = {}) {
  const credential = { token: String(token).trim(), workspaces: normalizeWorkspaces(workspaces) };
  if (!credential.token) throw new Error('MCP bearer token cannot be empty');
  if (!credential.workspaces.length) throw new Error('MCP credential must include at least one workspace scope');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(credential, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return { file, workspaces: credential.workspaces, token: credential.token };
}

export function mcpTokenFromRequest(req) {
  const authorization = String(req.headers.authorization || '');
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim();
  return String(req.headers['x-ziwei-mcp-token'] || '').trim();
}

export function mcpWorkspaceAllowed(workspaces, slug) {
  return normalizeWorkspaces(workspaces).includes(String(slug || '').trim());
}

// Backwards-compatible route middleware used by the management API. Options
// may use the explicit mcpOptions shape or the older scalar aliases so tests
// and existing deployments can rotate credentials without changing routes.
export function mcpTokenRequired(options = {}) {
  const configured = {
    ...options,
    file: options.file || options.tokenFile,
    token: options.token,
    workspaces: options.workspaces || (options.workspace ? [options.workspace] : [])
  };
  const load = () => readMCPCredential({ ...configured, create: configured.create ?? false });
  return (req, res, next) => {
    const credential = load();
    if (!credential.token) return res.status(503).json({ error: 'MCP 管理入口尚未配置 bearer token' });
    if (!safeTokenEqualCompat(mcpTokenFromRequest(req), credential.token)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="ziwei-mcp"');
      return res.status(401).json({ error: '需要有效的 MCP 管理令牌' });
    }
    const slug = String(req.params.slug || '').trim();
    if (slug && !mcpWorkspaceAllowed(credential.workspaces, slug)) return res.status(403).json({ error: 'MCP 令牌没有该工作区权限' });
    if (!slug && credential.workspaces.length !== 1) return res.status(403).json({ error: 'MCP 令牌需要明确的单一工作区权限' });
    req.mcpCredential = { ...credential, workspace: slug || credential.workspaces[0] };
    next();
  };
}

function safeTokenEqualCompat(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

