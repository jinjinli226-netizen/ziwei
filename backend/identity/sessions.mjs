import crypto from "node:crypto";
import { jwtVerify } from "jose";
import {
  cookie,
  cookieValue,
  fail,
  hash,
  random,
  sameOrigin,
  seal,
  unseal,
} from "./common.mjs";
export const SESSION_COOKIE = "__Host-ziwei_identity",
  TRANSACTION_COOKIE = "__Host-ziwei_oidc";
export function createIdentitySessions(
  db,
  identity,
  { now = () => Date.now() } = {},
) {
  const { config, op } = identity;
  const flights = new Map();
  db.exec(
    `CREATE TABLE IF NOT EXISTS unified_identity_transactions(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,secret TEXT NOT NULL,expires_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS unified_identity_sessions(id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL,sid TEXT,tokens TEXT NOT NULL,access_exp INTEGER NOT NULL,expires_at INTEGER NOT NULL,generation INTEGER NOT NULL DEFAULT 0,revoked_at INTEGER,lock_owner TEXT,lock_until INTEGER);CREATE INDEX IF NOT EXISTS unified_session_subject ON unified_identity_sessions(issuer,subject,sid);CREATE TABLE IF NOT EXISTS unified_identity_op_logout(issuer TEXT NOT NULL,target_type TEXT NOT NULL,target TEXT NOT NULL,logout_iat INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(issuer,target_type,target));CREATE TABLE IF NOT EXISTS unified_identity_logout_replay(issuer TEXT NOT NULL,jti TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(issuer,jti));`,
  );
  const read = (id) =>
    db.prepare("SELECT * FROM unified_identity_sessions WHERE id=?").get(id);
  const idFor = (req) => {
    const raw = cookieValue(req, SESSION_COOKIE);
    return raw ? hash(raw) : null;
  };
  const live = (row) => row && !row.revoked_at && row.expires_at > now();
  function reject() {
    fail(
      "UNAUTHENTICATED",
      "Unified identity session has expired or was revoked.",
      401,
    );
  }
  async function validateTokens(tokens, expectedSubject, nonce) {
    if (
      !tokens ||
      tokens.token_type !== "Bearer" ||
      typeof tokens.access_token !== "string" ||
      typeof tokens.refresh_token !== "string" ||
      !tokens.refresh_token ||
      tokens.scope?.split(/\s+/).includes("offline_access")
    )
      fail("UNAUTHENTICATED", "OIDC token response was rejected.", 401);
    const principal = await identity.verifier().verify(tokens.access_token);
    if (
      principal.clientId !== config.webClientId ||
      (expectedSubject && principal.subject !== expectedSubject)
    )
      fail("UNAUTHENTICATED", "BFF token subject or client changed.", 401);
    let sid, idIssuedAt;
    if (nonce !== undefined) {
      if (typeof tokens.id_token !== "string")
        fail("UNAUTHENTICATED", "OIDC ID token is required.", 401);
      const id = await op.verifyId(tokens.id_token, {
        nonce,
        subject: principal.subject,
      });
      if (typeof id.sid !== "string" || !id.sid)
        fail("UNAUTHENTICATED", "OIDC session identifier is required.", 401);
      sid = id.sid;
      idIssuedAt = id.iat;
    } else if (tokens.id_token) {
      const id = await op.verifyId(tokens.id_token, {
        subject: principal.subject,
      });
      sid = id.sid;
    }
    if (principal.sessionId && sid && principal.sessionId !== sid)
      fail("UNAUTHENTICATED", "OIDC access and ID token sessions differ.", 401);
    sid ||= principal.sessionId;
    const exp = JSON.parse(
      Buffer.from(tokens.access_token.split(".")[1], "base64url"),
    ).exp;
    return { principal, exp, sid, idIssuedAt };
  }
  async function refresh(id) {
    const row = read(id);
    if (!live(row)) reject();
    if (row.access_exp > now() + 5000)
      return unseal(config.key, row.tokens).access_token;
    const owner = random();
    const claimed = db
      .prepare(
        "UPDATE unified_identity_sessions SET lock_owner=?,lock_until=? WHERE id=? AND generation=? AND revoked_at IS NULL AND (lock_until IS NULL OR lock_until<?)",
      )
      .run(
        owner,
        now() + config.timeoutMs * 3,
        id,
        row.generation,
        now(),
      ).changes;
    if (!claimed) {
      const deadline = now() + config.timeoutMs * 3;
      while (now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const latest = read(id);
        if (!live(latest)) reject();
        if (latest.generation !== row.generation && latest.access_exp > now())
          return unseal(config.key, latest.tokens).access_token;
        if (!latest.lock_owner) break;
      }
      fail(
        "SERVICE_UNAVAILABLE",
        "Identity refresh is unavailable; sign in again.",
        503,
      );
    }
    let fresh;
    try {
      const previous = unseal(config.key, row.tokens);
      fresh = await op.exchange({
        grant_type: "refresh_token",
        refresh_token: previous.refresh_token,
      });
      const proof = await validateTokens(fresh, row.subject);
      if (proof.sid && proof.sid !== row.sid)
        fail("UNAUTHENTICATED", "OIDC session changed during refresh.", 401);
      const saved = db
        .prepare(
          "UPDATE unified_identity_sessions SET tokens=?,access_exp=?,generation=generation+1,lock_owner=NULL,lock_until=NULL WHERE id=? AND generation=? AND revoked_at IS NULL AND lock_owner=?",
        )
        .run(
          seal(config.key, fresh),
          proof.exp * 1000,
          id,
          row.generation,
          owner,
        ).changes;
      if (!saved) {
        reject();
      }
      return fresh.access_token;
    } catch (error) {
      db.prepare(
        "UPDATE unified_identity_sessions SET revoked_at=COALESCE(revoked_at,?),generation=generation+1,lock_owner=NULL,lock_until=NULL WHERE id=? AND lock_owner=?",
      ).run(now(), id, owner);
      if (fresh) await op.revoke(fresh);
      throw error;
    }
  }
  return {
    async begin(req) {
      if (
        (req.headers?.origin && req.headers.origin !== config.origin) ||
        req.headers?.["sec-fetch-site"] === "cross-site"
      )
        fail("FORBIDDEN", "Cross-origin sign-in is not allowed.", 403);
      const state = random(),
        browser = random(),
        nonce = random(),
        verifier = random();
      db.prepare(
        "DELETE FROM unified_identity_transactions WHERE expires_at<=?",
      ).run(now());
      db.prepare(
        "INSERT INTO unified_identity_transactions VALUES(?,?,?,?)",
      ).run(
        hash(state),
        hash(browser),
        seal(config.key, { nonce, verifier }),
        now() + 5 * 60 * 1000,
      );
      const location = new URL((await op.metadata()).authorization_endpoint);
      for (const [key, value] of Object.entries({
        client_id: config.webClientId,
        response_type: "code",
        redirect_uri: config.origin + "/api/identity/callback",
        scope: "openid workspace:read workspace:write",
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: crypto
          .createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      }))
        location.searchParams.set(key, value);
      return {
        location: location.href,
        cookie: cookie(TRANSACTION_COOKIE, browser, 300),
      };
    },
    async callback(req) {
      const state = req.query?.state,
        browser = cookieValue(req, TRANSACTION_COOKIE);
      if (
        typeof state !== "string" ||
        !browser ||
        typeof req.query?.code !== "string" ||
        !req.query.code ||
        req.query.error
      )
        reject();
      const transaction = db
        .prepare(
          "DELETE FROM unified_identity_transactions WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *",
        )
        .get(hash(state), hash(browser), now());
      if (!transaction) reject();
      const secret = unseal(config.key, transaction.secret);
      let tokens;
      try {
        tokens = await op.exchange({
          grant_type: "authorization_code",
          code: req.query.code,
          redirect_uri: config.origin + "/api/identity/callback",
          code_verifier: secret.verifier,
        });
        const proof = await validateTokens(tokens, undefined, secret.nonce);
        const raw = random(),
          id = hash(raw);
        // The tombstone check and insert share a single SQLite write. A
        // backchannel handled by another runtime cannot interleave between them.
        const saved = db
          .prepare(
            `INSERT INTO unified_identity_sessions(id,issuer,subject,sid,tokens,access_exp,expires_at)
           SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (
             SELECT 1 FROM unified_identity_op_logout WHERE issuer=? AND expires_at>?
             AND ((target_type='sid' AND target=?) OR (target_type='sub' AND target=? AND logout_iat>=?))
           )`,
          )
          .run(
            id,
            config.issuer,
            proof.principal.subject,
            proof.sid,
            seal(config.key, tokens),
            proof.exp * 1000,
            now() + 7 * 24 * 60 * 60 * 1000,
            config.issuer,
            now(),
            proof.sid,
            proof.principal.subject,
            proof.idIssuedAt,
          ).changes;
        if (!saved) reject();
        return {
          cookie: cookie(SESSION_COOKIE, raw, 7 * 24 * 60 * 60),
          clearTransaction: cookie(TRANSACTION_COOKIE, "", 0),
          location: config.origin + "/",
        };
      } catch (error) {
        if (tokens) await op.revoke(tokens);
        throw error;
      }
    },
    async accessToken(req) {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
        sameOrigin(req, config);
      const id = idFor(req);
      if (!id) reject();
      const row = read(id);
      if (!live(row)) reject();
      if (row.access_exp > now() + 5000)
        return unseal(config.key, row.tokens).access_token;
      if (!flights.has(id)) {
        const flight = refresh(id).finally(() => flights.delete(id));
        flights.set(id, flight);
      }
      return flights.get(id);
    },
    async logout(req) {
      sameOrigin(req, config);
      const id = idFor(req);
      // Capture the latest committed grant in the same write that tombstones
      // the session. Another SQLite connection may finish refresh at any time.
      const row = id
        ? db
            .prepare(
              "UPDATE unified_identity_sessions SET revoked_at=COALESCE(revoked_at,?),generation=generation+1 WHERE id=? RETURNING *",
            )
            .get(now(), id)
        : null;
      let revoked = null;
      if (row) {
        revoked = await op.revoke(unseal(config.key, row.tokens));
      }
      return {
        localCleared: true,
        remoteRevocation:
          revoked === null ? "not_attempted" : revoked ? "accepted" : "failed",
        confirmed: false,
        scope: "current_site",
        allSitesLoggedOut: false,
        cookie: cookie(SESSION_COOKIE, "", 0),
      };
    },
    async backchannel(raw) {
      let payload;
      try {
        ({ payload } = await jwtVerify(raw, op.jwks, {
          issuer: config.issuer,
          audience: config.webClientId,
          algorithms: ["RS256"],
          requiredClaims: ["iss", "aud", "iat", "jti", "events"],
          clockTolerance: 5,
          maxTokenAge: 300,
          currentDate: new Date(now()),
        }));
        const event =
          payload.events?.[
            "http://schemas.openid.net/event/backchannel-logout"
          ];
        if (
          now() / 1000 - payload.iat > 300 ||
          payload.iat > now() / 1000 + 5 ||
          payload.typ !== "Logout" ||
          payload.aud !== config.webClientId ||
          !Number.isInteger(payload.iat) ||
          typeof payload.jti !== "string" ||
          !payload.jti ||
          payload.jti.length > 512 ||
          payload.nonce !== undefined ||
          !event ||
          typeof event !== "object" ||
          Array.isArray(event) ||
          (!payload.sid && !payload.sub) ||
          (payload.sid !== undefined &&
            (typeof payload.sid !== "string" || !payload.sid)) ||
          (payload.sub !== undefined &&
            (typeof payload.sub !== "string" || !payload.sub))
        )
          throw Error();
      } catch {
        fail("UNAUTHENTICATED", "OIDC logout token was rejected.", 401);
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "DELETE FROM unified_identity_logout_replay WHERE expires_at<?",
        ).run(now());
        db.prepare(
          "INSERT INTO unified_identity_logout_replay VALUES(?,?,?)",
        ).run(config.issuer, payload.jti, now() + 10 * 60 * 1000);
        db.prepare(
          "INSERT INTO unified_identity_op_logout VALUES(?,?,?,?,?) ON CONFLICT(issuer,target_type,target) DO UPDATE SET logout_iat=MAX(logout_iat,excluded.logout_iat),expires_at=MAX(expires_at,excluded.expires_at)",
        ).run(
          config.issuer,
          payload.sid ? "sid" : "sub",
          payload.sid || payload.sub,
          payload.iat,
          now() + 24 * 60 * 60 * 1000,
        );
        const matches = db
          .prepare(
            `SELECT * FROM unified_identity_sessions WHERE issuer=? AND ${payload.sid ? "sid=?" : "subject=?"} AND revoked_at IS NULL`,
          )
          .all(config.issuer, payload.sid || payload.sub);
        for (const row of matches) {
          if (payload.sub && payload.sub !== row.subject) continue;
          db.prepare(
            "UPDATE unified_identity_sessions SET revoked_at=?,generation=generation+1 WHERE id=?",
          ).run(now(), row.id);
        }
        db.exec("COMMIT");
      } catch {
        try {
          db.exec("ROLLBACK");
        } catch {}
        fail(
          "UNAUTHENTICATED",
          "OIDC logout token was replayed or unavailable.",
          401,
        );
      }
      return { ok: true };
    },
  };
}
