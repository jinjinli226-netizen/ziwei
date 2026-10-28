import test from "node:test";
import assert from "node:assert/strict";
import { fixture, token, request, issuer, origin, aud } from "./fixtures.mjs";
const create = async (f) => {
  const { createIdentitySessions } = await import("./sessions.mjs").catch(
    () => ({
      createIdentitySessions: () => {
        throw Error("BFF sessions missing");
      },
    }),
  );
  const s = createIdentitySessions(f.db, f.identity);
  f.identity.attachSessions(s);
  return s;
};
async function login(f, s, options = {}) {
  const begin = await s.begin(request(null, "/api/identity/login"));
  const u = new URL(begin.location);
  const at = token({ azp: "ziwei-workspace-web", ...options });
  f.setCurrent({ active: true, ...at.payload, client_id: at.payload.azp });
  let nonce = u.searchParams.get("nonce");
  f.identity.op.exchange = async () => ({
    access_token: at.raw,
    refresh_token: "refresh-one",
    id_token: token({
      aud: "ziwei-workspace-web",
      azp: "ziwei-workspace-web",
      typ: "ID",
      nonce,
      sid: "op-sid",
    }).raw,
    token_type: "Bearer",
  });
  const callback = request(null, "/api/identity/callback");
  callback.query = { state: u.searchParams.get("state"), code: "opaque-code" };
  callback.headers.cookie = begin.cookie.split(";")[0];
  const completed = await s.callback(callback);
  return {
    begin,
    callback,
    completed,
    at,
    cookie: completed.cookie.split(";")[0],
  };
}
test("BFF uses PKCE S256 exact callback state nonce and host-only Secure HttpOnly cookies", async () => {
  const f = await fixture(),
    s = await create(f),
    x = await login(f, s);
  const u = new URL(x.begin.location);
  assert.equal(
    u.searchParams.get("redirect_uri"),
    origin + "/api/identity/callback",
  );
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("state"));
  assert.ok(u.searchParams.get("nonce"));
  assert.ok(!u.searchParams.get("scope").includes("offline_access"));
  assert.match(
    x.completed.cookie,
    /^__Host-ziwei_identity=.*;.*Secure; HttpOnly/,
  );
  assert.doesNotMatch(x.completed.cookie, /Domain=|refresh-one|eyJ/);
  const persisted = f.db
    .prepare("SELECT tokens FROM unified_identity_sessions")
    .get().tokens;
  assert.doesNotMatch(persisted, /refresh-one|eyJ/);
  const p = await f.identity.authorizeRequest(
    request(null, undefined, "GET", { cookie: x.cookie }),
  );
  assert.equal(p.user_id, "u1");
  await assert.rejects(s.callback(x.callback), (e) => e.status === 401);
});
test("BFF rejects wrong browser state cookie and nonce without issuing session", async () => {
  const f = await fixture(),
    s = await create(f),
    begin = await s.begin(request(null));
  const u = new URL(begin.location),
    req = request(null);
  req.query = { state: "wrong", code: "x" };
  req.headers.cookie = begin.cookie.split(";")[0];
  await assert.rejects(s.callback(req), (e) => e.status === 401);
  const at = token({ azp: "ziwei-workspace-web" });
  f.setCurrent({ active: true, ...at.payload, client_id: at.payload.azp });
  f.identity.op.exchange = async () => ({
    access_token: at.raw,
    refresh_token: "r",
    id_token: token({
      aud: "ziwei-workspace-web",
      nonce: "wrong",
      sid: "sid",
      typ: "ID",
      azp: "ziwei-workspace-web",
    }).raw,
    token_type: "Bearer",
  });
  req.query.state = u.searchParams.get("state");
  await assert.rejects(s.callback(req), (e) => e.status === 401);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM unified_identity_sessions").get().n,
    0,
  );
});
test("Cookie state changes require exact same origin even with valid session", async () => {
  const f = await fixture(),
    s = await create(f),
    x = await login(f, s);
  const req = request(null, undefined, "POST", { cookie: x.cookie });
  await assert.rejects(
    f.identity.authorizeRequest(req),
    (e) => e.status === 403,
  );
  await assert.rejects(s.logout(req), (e) => e.status === 403);
  req.headers.origin = origin;
  const result = await s.logout(req);
  assert.equal(result.scope, "current_site");
  assert.equal(result.allSitesLoggedOut, false);
  await assert.rejects(s.accessToken(req), (e) => e.status === 401);
});
test("refresh is single-flight and logout prevents late refresh token resurrection and revokes new tokens", async () => {
  const f = await fixture(),
    s = await create(f),
    x = await login(f, s, {
      iat: Math.floor(Date.now() / 1000) - 298,
      exp: Math.floor(Date.now() / 1000) + 2,
    });
  let release, started;
  const entered = new Promise((r) => (started = r));
  let refreshes = 0;
  f.identity.op.exchange = async () => {
    refreshes++;
    started();
    return new Promise((r) => (release = r));
  };
  const req = request(null, undefined, "GET", { cookie: x.cookie }),
    first = s.accessToken(req),
    second = s.accessToken(req);
  await entered;
  const logout = await s.logout({
    ...req,
    method: "POST",
    headers: { ...req.headers, origin },
  });
  assert.equal(logout.localCleared, true);
  const rotated = token({ azp: "ziwei-workspace-web" });
  f.setCurrent({
    active: true,
    ...rotated.payload,
    client_id: rotated.payload.azp,
  });
  release({
    access_token: rotated.raw,
    refresh_token: "refresh-late",
    token_type: "Bearer",
  });
  await assert.rejects(first, (e) => e.status === 401);
  await assert.rejects(second, (e) => e.status === 401);
  assert.equal(refreshes, 1);
  assert.ok(
    f.calls.some(
      (c) =>
        c.url.endsWith("/revoke") &&
        new URLSearchParams(c.options.body).get("token") === "refresh-late",
    ),
  );
  await assert.rejects(s.accessToken(req), (e) => e.status === 401);
});
test("signed backchannel validates type event issuer audience time and consumes jti once", async () => {
  const f = await fixture(),
    s = await create(f),
    x = await login(f, s);
  const logout = token({
    aud: "ziwei-workspace-web",
    azp: "ziwei-workspace-web",
    typ: "Logout",
    jti: "logout-jti",
    sid: "op-sid",
    events: { "http://schemas.openid.net/event/backchannel-logout": {} },
  }).raw;
  await s.backchannel(logout);
  await assert.rejects(
    s.accessToken(request(null, undefined, "GET", { cookie: x.cookie })),
    (e) => e.status === 401,
  );
  await assert.rejects(s.backchannel(logout), (e) => e.status === 401);
  for (const override of [
    { aud },
    { iat: Math.floor(Date.now() / 1000) - 301 },
    { typ: "ID" },
    { events: {} },
    { nonce: "forbidden" },
    { sub: undefined, sid: undefined },
  ])
    await assert.rejects(
      s.backchannel(
        token({
          typ: "Logout",
          aud: "ziwei-workspace-web",
          jti: "other-" + Math.random(),
          sid: "op-sid",
          events: { "http://schemas.openid.net/event/backchannel-logout": {} },
          ...override,
        }).raw,
      ),
      (e) => e.status === 401,
    );
});

test("backchannel sid tombstone prevents a callback arriving after OP logout", async () => {
  const f = await fixture(),
    s = await create(f);
  const begin = await s.begin(request(null));
  const u = new URL(begin.location),
    at = token({ azp: "ziwei-workspace-web" });
  f.setCurrent({ active: true, ...at.payload, client_id: at.payload.azp });
  f.identity.op.exchange = async () => ({
    access_token: at.raw,
    refresh_token: "late-code-refresh",
    id_token: token({
      aud: "ziwei-workspace-web",
      azp: "ziwei-workspace-web",
      typ: "ID",
      nonce: u.searchParams.get("nonce"),
      sid: "closed-sid",
    }).raw,
    token_type: "Bearer",
  });
  await s.backchannel(
    token({
      aud: "ziwei-workspace-web",
      typ: "Logout",
      jti: "before-callback",
      sid: "closed-sid",
      events: { "http://schemas.openid.net/event/backchannel-logout": {} },
    }).raw,
  );
  const req = request(null);
  req.query = { state: u.searchParams.get("state"), code: "late-code" };
  req.headers.cookie = begin.cookie.split(";")[0];
  await assert.rejects(s.callback(req), (e) => e.status === 401);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM unified_identity_sessions").get().n,
    0,
  );
});
test("BFF cookie permission revocation is rechecked on each request", async () => {
  const f = await fixture(),
    s = await create(f),
    x = await login(f, s);
  const req = request(null, "/api/workspaces/one/tasks", "POST", {
    cookie: x.cookie,
    origin,
  });
  await f.identity.authorizeRequest(req);
  f.setCurrent({
    active: true,
    ...x.at.payload,
    client_id: x.at.payload.azp,
    resource_access: { [aud]: { roles: ["access", "read"] } },
  });
  await assert.rejects(
    f.identity.authorizeRequest(req),
    (e) => e.status === 403,
  );
});
test("two BFF runtimes share state consumption and refresh CAS on the same database", async () => {
  const f = await fixture(),
    s1 = await create(f),
    x = await login(f, s1, {
      iat: Math.floor(Date.now() / 1000) - 298,
      exp: Math.floor(Date.now() / 1000) + 2,
    }),
    s2 = await create(f);
  await assert.rejects(s2.callback(x.callback), (e) => e.status === 401);
  let release, started;
  const entered = new Promise((r) => (started = r)),
    fresh = token({ azp: "ziwei-workspace-web" });
  let exchanges = 0;
  f.identity.op.exchange = async () => {
    exchanges++;
    started();
    return new Promise((r) => (release = r));
  };
  const req = request(null, undefined, "GET", { cookie: x.cookie }),
    a = s1.accessToken(req);
  await entered;
  const b = s2.accessToken(req);
  f.setCurrent({
    active: true,
    ...fresh.payload,
    client_id: fresh.payload.azp,
  });
  release({
    access_token: fresh.raw,
    refresh_token: "shared-rotated",
    token_type: "Bearer",
  });
  assert.equal(await a, fresh.raw);
  assert.equal(await b, fresh.raw);
  assert.equal(exchanges, 1);
  await f.identity.authorizeRequest(req);
});
test("logout without a site session truthfully skips remote revocation", async () => {
  const f = await fixture(),
    s = await create(f);
  const result = await s.logout(request(null, undefined, "POST", { origin }));
  assert.equal(result.remoteRevocation, "not_attempted");
  assert.equal(f.calls.length, 0);
});
test("BFF rejects access and ID tokens from different OP sessions", async () => {
  const f = await fixture(),
    s = await create(f);
  await assert.rejects(
    login(f, s, { sid: "different-access-session" }),
    (e) => e.status === 401,
  );
});
test("logout revokes tokens committed by another runtime immediately before its tombstone write", async () => {
  const f = await fixture(),
    s = await create(f),
    x = await login(f, s),
    fresh = token({ azp: "ziwei-workspace-web" });
  const { seal } = await import("./common.mjs");
  const prepare = f.db.prepare.bind(f.db);
  let interleaved = false;
  f.db.prepare = function (sql) {
    if (
      !interleaved &&
      sql.startsWith("UPDATE unified_identity_sessions SET revoked_at=COALESCE")
    ) {
      interleaved = true;
      prepare(
        "UPDATE unified_identity_sessions SET tokens=?,generation=generation+1",
      ).run(
        seal(f.identity.config.key, {
          access_token: fresh.raw,
          refresh_token: "concurrent-latest-refresh",
          token_type: "Bearer",
        }),
      );
    }
    return prepare(sql);
  };
  await s.logout(
    request(null, undefined, "POST", { origin, cookie: x.cookie }),
  );
  assert.equal(interleaved, true);
  const revoked = f.calls
    .filter((c) => c.url.endsWith("/revoke"))
    .map((c) => new URLSearchParams(c.options.body).get("token"));
  assert.ok(revoked.includes("concurrent-latest-refresh"));
  assert.ok(revoked.includes(fresh.raw));
  assert.ok(!revoked.includes("refresh-one"));
});
