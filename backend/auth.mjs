import crypto from 'node:crypto';

const SESSION_COOKIE = 'ziwei_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;

const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${crypto.randomUUID()}`;

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || !email.includes('@') || email.length > 320) throw new Error('请输入有效的邮箱');
  return email;
}

function normalizeWorkspaceSlug(value, fallbackName = '') {
  const raw = String(value || fallbackName || '').trim().toLowerCase();
  const normalized = raw
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/[\u4e00-\u9fff]+/g, match => `workspace-${Buffer.from(match).toString('hex').slice(0, 12)}`)
    .replace(/[-_]{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return normalized || `workspace-${crypto.randomBytes(4).toString('hex')}`;
}

function availableWorkspaceSlug(db, value, fallbackName = '') {
  const base = normalizeWorkspaceSlug(value, fallbackName);
  let slug = base;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM workspaces WHERE slug=?').get(slug)) {
    const tail = `-${suffix++}`;
    slug = `${base.slice(0, 63 - tail.length)}${tail}`;
  }
  return slug;
}

function parseCookies(value) {
  const result = {};
  for (const pair of String(value || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const key = pair.slice(0, index).trim();
    const raw = pair.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(raw); } catch { result[key] = raw; }
  }
  return result;
}

function hashPassword(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH) throw new Error(`密码至少需要 ${PASSWORD_MIN_LENGTH} 位`);
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function verifyPassword(password, encoded) {
  try {
    const [algorithm, nText, rText, pText, saltText, hashText] = String(encoded || '').split('$');
    if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const actual = crypto.scryptSync(String(password || ''), salt, expected.length, {
      N: Number(nText) || 16384, r: Number(rText) || 8, p: Number(pText) || 1, maxmem: 32 * 1024 * 1024
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function hashToken(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function sessionCookie(value, maxAgeSeconds = SESSION_TTL_MS / 1000, { secure = false } = {}) {
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function userView(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, created_at: row.created_at, last_login_at: row.last_login_at };
}

export function createAuthService(db, { sessionTtlMs = SESSION_TTL_MS } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS local_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT,
      FOREIGN KEY(user_id) REFERENCES local_users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_local_sessions_expiry ON local_sessions(expires_at);
  `);
  try { db.exec('ALTER TABLE members ADD COLUMN user_id TEXT'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_members_user_workspace ON members(user_id,workspace_id)'); } catch {}

  function memberships(userId) {
    return db.prepare(`SELECT m.id,m.workspace_id,m.name,m.email,m.role,m.avatar,m.joined_at,w.slug,w.name AS workspace_name,w.kind,w.timezone
      FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY m.joined_at`).all(userId)
      .map(row => ({ id: row.id, workspace_id: row.workspace_id, slug: row.slug, name: row.workspace_name, kind: row.kind || 'personal', timezone: row.timezone, role: row.role, member_name: row.name, email: row.email, avatar: row.avatar, joined_at: row.joined_at }));
  }

  function principal(user) {
    const rows = memberships(user.id);
    return { user: userView(user), user_id: user.id, memberships: rows, workspace: rows[0] || null, role: rows[0]?.role || null };
  }

  function purgeExpired() { db.prepare('DELETE FROM local_sessions WHERE expires_at<=?').run(now()); }
  function findSession(token) {
    if (!token) return null;
    purgeExpired();
    const row = db.prepare(`SELECT s.*,u.id AS user_id,u.email,u.name,u.created_at,u.last_login_at FROM local_sessions s JOIN local_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token), now());
    if (!row) return null;
    db.prepare('UPDATE local_sessions SET last_seen_at=? WHERE id=?').run(now(), row.id);
    return principal({ id: row.user_id, email: row.email, name: row.name, created_at: row.created_at, last_login_at: row.last_login_at });
  }

  function issueSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const created = now();
    const expires = new Date(Date.now() + sessionTtlMs).toISOString();
    db.prepare('INSERT INTO local_sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
      .run(id('session'), userId, hashToken(token), created, expires, created);
    return { token, expires_at: expires };
  }

  return {
    cookieName: SESSION_COOKIE,
    status(req) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || req.headers['x-ziwei-session'];
      const auth = findSession(token);
      const users = db.prepare('SELECT COUNT(*) AS count FROM local_users').get().count;
      return { setup_required: Number(users) === 0, authenticated: Boolean(auth), user: auth?.user || null, memberships: auth?.memberships || [] };
    },
    setup(input = {}) {
      if (Number(db.prepare('SELECT COUNT(*) AS count FROM local_users').get().count) > 0) throw new Error('本机已经完成初始化，请直接登录');
      const email = normalizeEmail(input.email);
      const name = String(input.name || email.split('@')[0]).trim().slice(0, 120) || email.split('@')[0];
      const passwordHash = hashPassword(input.password);
      const timestamp = now();
      const userId = id('user');
      const requestedSlug = String(input.workspaceSlug || input.workspace_slug || '').trim();
      if (requestedSlug || input.workspaceName || input.workspace_name || input.workspaceKind || input.workspace_kind) throw new Error('首次初始化只创建账号，请登录后新建工作区');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO local_users(id,email,name,password_hash,created_at,last_login_at) VALUES(?,?,?,?,?,?)').run(userId,email,name,passwordHash,timestamp,timestamp);
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
      const session = issueSession(userId);
      return { ...principal(db.prepare('SELECT * FROM local_users WHERE id=?').get(userId)), session };
    },
    register(input = {}) {
      const email = normalizeEmail(input.email);
      if (db.prepare('SELECT 1 FROM local_users WHERE email=?').get(email)) throw new Error('该邮箱已注册，请直接登录');
      const name = String(input.name || email.split('@')[0]).trim().slice(0, 120) || email.split('@')[0];
      const passwordHash = hashPassword(input.password);
      const timestamp = now();
      const userId = id('user');
      const requestedSlug = String(input.workspaceSlug || input.workspace_slug || '').trim();
      let workspace = db.prepare('SELECT * FROM workspaces WHERE slug=?').get(requestedSlug);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO local_users(id,email,name,password_hash,created_at,last_login_at) VALUES(?,?,?,?,?,?)').run(userId,email,name,passwordHash,timestamp,timestamp);
        if (!workspace) {
          const workspaceId = id('ws');
          const workspaceName = String(input.workspaceName || input.workspace_name || '个人工作区').trim() || '个人工作区';
          const slug = requestedSlug || availableWorkspaceSlug(db, '', workspaceName);
          db.prepare('INSERT INTO workspaces(id,slug,name,kind,plan,timezone,created_at) VALUES(?,?,?,?,?,?,?)').run(workspaceId, slug, workspaceName, 'personal', 'free', 'Asia/Shanghai', timestamp);
          workspace = db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId);
        }
        const invitationCode = String(input.invitationCode || input.invitation_code || '').trim();
        let invitation = null;
        if (requestedSlug) {
          if (workspace.kind !== 'team') throw new Error('个人工作区不能直接加入');
          if (invitationCode) {
            invitation = db.prepare('SELECT * FROM invitations WHERE workspace_id=? AND code_hash=?').get(workspace.id, hashToken(invitationCode));
            if (invitation?.email && String(invitation.email).toLowerCase() !== email) invitation = null;
          } else {
            invitation = db.prepare("SELECT * FROM invitations WHERE workspace_id=? AND lower(email)=? AND status='pending' AND expires_at>? ORDER BY created_at DESC LIMIT 1").get(workspace.id, email, timestamp);
          }
          if (!invitation || !['pending', 'accepted'].includes(invitation.status) || (invitation.status === 'pending' && Date.parse(invitation.expires_at) <= Date.now())) throw new Error('加入团队需要有效邀请');
          if (invitation.status === 'accepted' && invitation.member_id && db.prepare('SELECT user_id FROM members WHERE id=?').get(invitation.member_id)?.user_id) throw new Error('邀请已经被其他账号使用');
        }
        const pendingMember = invitation?.member_id
          ? db.prepare('SELECT * FROM members WHERE id=?').get(invitation.member_id)
          : null;
        if (pendingMember && !pendingMember.user_id) {
          db.prepare('UPDATE members SET user_id=?,name=?,email=? WHERE id=?').run(userId, name, email, pendingMember.id);
        } else if (!pendingMember) {
          const memberRole = workspace.kind === 'personal' ? 'owner' : (invitation?.role === 'admin' ? 'admin' : 'member');
          const memberId = id('member');
          db.prepare('INSERT INTO members(id,user_id,workspace_id,name,email,role,avatar,joined_at) VALUES(?,?,?,?,?,?,?,?)').run(memberId, userId, workspace.id, name, email, memberRole, null, timestamp);
          if (invitation) db.prepare("UPDATE invitations SET status='accepted',accepted_at=?,member_id=? WHERE id=?").run(timestamp, memberId, invitation.id);
        } else {
          throw new Error('该邮箱已属于当前工作区成员');
        }
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
      const session = issueSession(userId);
      return { ...principal(db.prepare('SELECT * FROM local_users WHERE id=?').get(userId)), session };
    },
    login(input = {}) {
      const email = normalizeEmail(input.email);
      const user = db.prepare('SELECT * FROM local_users WHERE email=?').get(email);
      if (!user || !verifyPassword(input.password, user.password_hash)) throw new Error('邮箱或密码错误');
      const timestamp = now();
      // A previously issued invitation may already have created a member row
      // for this email. Attach it to the authenticated local account once the
      // user signs in; workspace membership is then enforced by the guard.
      db.prepare('UPDATE members SET user_id=? WHERE user_id IS NULL AND lower(email)=?').run(user.id, email);
      db.prepare('UPDATE local_users SET last_login_at=? WHERE id=?').run(timestamp, user.id);
      const updated = db.prepare('SELECT * FROM local_users WHERE id=?').get(user.id);
      return { ...principal(updated), session: issueSession(user.id) };
    },
    createWorkspace(userId, input = {}) {
      const user = db.prepare('SELECT * FROM local_users WHERE id=?').get(userId);
      if (!user) throw new Error('请先登录紫薇');
      const name = String(input.name || '').trim();
      if (!name) throw new Error('项目名称不能为空');
      const slug = normalizeWorkspaceSlug(input.slug, name);
      if (!/^[a-z0-9][a-z0-9-_-]{1,62}$/.test(slug)) throw new Error('项目标识需使用 2-63 位字母、数字、下划线或短横线');
      if (db.prepare('SELECT 1 FROM workspaces WHERE slug=?').get(slug)) throw new Error('项目标识已存在，请换一个');
      const kind = input.kind === 'team' || input.workspaceKind === 'team' || input.workspace_kind === 'team' ? 'team' : 'personal';
      const timestamp = now();
      const workspaceId = id('ws');
      const memberId = id('member');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO workspaces(id,slug,name,kind,plan,timezone,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(workspaceId, slug, name, kind, 'free', String(input.timezone || 'Asia/Shanghai'), timestamp);
        db.prepare('INSERT INTO members(id,user_id,workspace_id,name,email,role,avatar,joined_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(memberId, user.id, workspaceId, user.name, user.email, 'owner', null, timestamp);
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
      const membership = memberships(user.id).find(item => item.slug === slug);
      return { workspace: { id: workspaceId, slug, name, kind, plan: 'free', timezone: String(input.timezone || 'Asia/Shanghai'), created_at: timestamp }, membership };
    },
    logout(req) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || req.headers['x-ziwei-session'];
      if (token) db.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(hashToken(token));
    },
    authenticate(req) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || req.headers['x-ziwei-session'];
      return findSession(token);
    },
    canAccess(userId, slug) {
      const row = db.prepare('SELECT m.role FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? AND w.slug=?').get(userId, slug);
      return row ? { role: row.role } : null;
    },
    setCookie(res, session, req = null) {
      const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
      const secure = forwardedProto === 'https' || req?.secure === true || process.env.NODE_ENV === 'production';
      res.setHeader('Set-Cookie', sessionCookie(session.token, sessionTtlMs / 1000, { secure }));
    },
    clearCookie(res, req = null) {
      const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
      const secure = forwardedProto === 'https' || req?.secure === true || process.env.NODE_ENV === 'production';
      res.setHeader('Set-Cookie', sessionCookie('', 0, { secure }));
    },
    memberships,
    verifyPassword
  };
}

export { PASSWORD_MIN_LENGTH, SESSION_COOKIE, hashPassword, verifyPassword, parseCookies };
