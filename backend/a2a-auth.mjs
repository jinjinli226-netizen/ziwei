import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// A2A is consumed by the local ziwei_user process rather than a browser
// session. Keep its credential out of the database and share it through a
// machine-local, owner-readable file. An explicit environment variable still
// wins for containers and managed deployments.
const defaultTokenPath = () => process.env.ZIWEI_A2A_TOKEN_FILE || path.resolve(process.cwd(), 'data', 'a2a.token');

export function readA2AToken({ create = true } = {}) {
  const configured = String(process.env.ZIWEI_A2A_TOKEN || '').trim();
  if (configured) return configured;
  const file = defaultTokenPath();
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (value) return value;
  } catch {}
  if (!create) return '';
  const token = crypto.randomBytes(32).toString('base64url');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
  } catch {}
  return token;
}

export function safeTokenEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function tokenFromRequest(req) {
  const authorization = String(req.headers.authorization || '');
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim();
  return String(req.headers['x-ziwei-a2a-token'] || '').trim();
}

export function deviceTokenFromRequest(req) {
  const authorization = String(req.headers.authorization || '');
  if (/^device\s+/i.test(authorization)) return authorization.replace(/^device\s+/i, '').trim();
  return String(req.headers['x-ziwei-device-token'] || '').trim();
}

