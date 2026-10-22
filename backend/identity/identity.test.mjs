import test from "node:test";
import assert from "node:assert/strict";
import {
  authorize,
  fixture,
  token,
  request,
  issuer,
  origin,
  aud,
} from "./fixtures.mjs";
import { DatabaseSync } from "node:sqlite";
const load = () => import("./index.mjs");
test("configuration is opt in and has no default issuer or secret fallback", async () => {
  const { createUnifiedIdentity } = await load();
  assert.equal(
    createUnifiedIdentity({ db: new DatabaseSync(":memory:"), env: {} }),
    null,
  );
  assert.throws(
    () =>
      createUnifiedIdentity({
        db: new DatabaseSync(":memory:"),
        env: { ZIWEI_IDENTITY_MODE: "unified" },
      }),
    /configuration/i,
  );
});
test("signed AT and confidential introspection map only explicit native subject binding", async () => {
  const f = await fixture();
  const p = await authorize(f, token());
  assert.equal(p.user_id, "u1");
  assert.equal(p.identity.subject, "person");
  assert.equal(f.calls.filter((c) => c.url.endsWith("/introspect")).length, 1);
  assert.match(
    f.calls.find((c) => c.url.endsWith("/introspect")).options.headers
      .authorization,
    /^Basic /,
  );
  assert.deepEqual(
    p.memberships.map((m) => m.workspace_id),
    ["w1"],
  );
});
test("cross site audience, multiple aud, unknown azp, ID token and excessive lifetime fail closed", async () => {
  for (const claims of [
    { aud: "ziwei-world-api" },
    { aud: [aud, "ziwei-world-api"] },
    { azp: "zw-cli" },
    { typ: "ID" },
    { exp: Math.floor(Date.now() / 1000) + 301 },
    { sub: "" },
    { iat: Math.floor(Date.now() / 1000) + 90 },
  ]) {
    const f = await fixture();
    await assert.rejects(authorize(f, token(claims)), (e) => e.status === 401);
  }
});
test("bad signature and revoked or inconsistent introspection fail closed", async () => {
  const f = await fixture(),
    t = token();
  for (const active of [
    null,
    { active: true },
    { active: false, ...t.payload, client_id: t.payload.azp },
    { active: true, ...t.payload, client_id: "other" },
    {
      active: true,
      ...t.payload,
      client_id: t.payload.azp,
      exp: t.payload.exp + 1,
    },
  ]) {
    f.setCurrent(active);
    await assert.rejects(f.identity.authorizeRequest(request(t.raw)), (e) =>
      [401, 403].includes(e.status),
    );
  }
  f.setCurrent({ active: true, ...t.payload, client_id: t.payload.azp });
  await assert.rejects(
    f.identity.authorizeRequest(request(t.raw.slice(0, -8) + "AAAAAAAA")),
    (e) => e.status === 401,
  );
});
test("roles and scopes intersect issued and current permissions without admin implication", async () => {
  for (const roles of [["access", "read"], ["access", "admin"], [], null]) {
    const f = await fixture(),
      t = token();
    f.setCurrent({
      active: true,
      ...t.payload,
      client_id: t.payload.azp,
      resource_access: roles === null ? {} : { [aud]: { roles } },
    });
    await assert.rejects(
      f.identity.authorizeRequest(request(t.raw, undefined, "POST")),
      (e) => e.status === 403,
    );
  }
  const f = await fixture(),
    t = token({ resource_access: { [aud]: { roles: ["access", "read"] } } });
  await assert.rejects(
    authorize(f, t, undefined, "POST"),
    (e) => e.status === 403,
  );
  const g = await fixture(),
    s = token({ scope: "workspace:read" });
  await assert.rejects(
    authorize(g, s, undefined, "POST"),
    (e) => e.status === 403,
  );
});
test("native workspace membership and binding scope are both required and current", async () => {
  const f = await fixture();
  await assert.rejects(
    authorize(f, token(), "/api/workspaces/two/tasks"),
    (e) => e.status === 403,
  );
  f.db.prepare("DELETE FROM members WHERE user_id=?").run("u1");
  await assert.rejects(authorize(f, token()), (e) => e.status === 403);
  const g = await fixture();
  await assert.rejects(
    authorize(g, token({ sub: "unbound", email: "owner@example.test" })),
    (e) => e.status === 403,
  );
});
test("employee machine clients require immutable subject and single native employee binding", async () => {
  const f = await fixture();
  const worker = {
    issuer,
    subject: "machine",
    nativeUserId: "u1",
    workspaceIds: ["w1"],
    kind: "employee",
    employeeId: "e1",
    clientId: "ziwei-workspace-worker-e1",
  };
  f.identity.bindings.bind(worker);
  assert.throws(
    () => f.identity.bindings.bind({ ...worker, employeeId: "e2" }),
    /immutable|binding/i,
  );
  const t = token({ sub: "machine", azp: worker.clientId });
  await authorize(f, t, "/api/workspaces/one/employees/e1");
  await assert.rejects(
    authorize(f, t, "/api/workspaces/one/employees/e2"),
    (e) => e.status === 403,
  );
  await assert.rejects(
    authorize(f, t, "/api/workspaces/one/tasks"),
    (e) => e.status === 403,
  );
  f.identity.bindings.disable(issuer, "machine");
  await assert.rejects(
    authorize(f, t, "/api/workspaces/one/employees/e1"),
    (e) => e.status === 403,
  );
});
test("legacy session headers and static MCP owner tokens do not authenticate unified requests", async () => {
  const f = await fixture();
  for (const req of [
    request(null, undefined, "GET", { cookie: "ziwei_session=old" }),
    request("old-token"),
    request(null, undefined, "GET", {
      "x-ziwei-session": "old",
      "x-workspace-role": "owner",
      "x-ziwei-mcp-token": "old",
    }),
  ])
    await assert.rejects(
      f.identity.authorizeRequest(req),
      (e) => e.status === 401,
    );
});

test("malformed role element, introspection scope omission and network outage fail closed", async () => {
  const f = await fixture(),
    t = token();
  f.setCurrent({
    active: true,
    ...t.payload,
    client_id: t.payload.azp,
    resource_access: { [aud]: { roles: ["access", "read", 99] } },
  });
  await assert.rejects(
    f.identity.authorizeRequest(request(t.raw)),
    (e) => e.status === 403,
  );
  f.setCurrent({
    active: true,
    ...t.payload,
    client_id: t.payload.azp,
    scope: undefined,
  });
  await assert.rejects(
    f.identity.authorizeRequest(request(t.raw)),
    (e) => e.status === 403,
  );
  const g = await fixture({
    fetch: async () => {
      throw Error("offline");
    },
  });
  g.setCurrent({ active: true, ...t.payload, client_id: t.payload.azp });
  await assert.rejects(g.identity.authorizeRequest(request(t.raw)), (e) =>
    [401, 503].includes(e.status),
  );
});
test("public human client cannot use a registered machine subject", async () => {
  const f = await fixture();
  f.identity.bindings.bind({
    issuer,
    subject: "machine",
    nativeUserId: "u1",
    workspaceIds: ["w1"],
    kind: "employee",
    employeeId: "e1",
    clientId: "ziwei-workspace-worker-e1",
  });
  await assert.rejects(
    authorize(f, token({ sub: "machine" }), "/api/workspaces/one/employees/e1"),
    (e) => e.status === 403,
  );
});
test("an employee owned interactive identity uses site CLI within its single employee binding", async () => {
  const f = await fixture();
  f.identity.bindings.bind({
    issuer,
    subject: "interactive-employee",
    nativeUserId: "u1",
    workspaceIds: ["w1"],
    kind: "employee",
    employeeId: "e1",
  });
  const p = await authorize(
    f,
    token({ sub: "interactive-employee" }),
    "/api/workspaces/one/employees/e1",
  );
  assert.equal(p.identity.kind, "employee");
  await assert.rejects(
    authorize(
      f,
      token({ sub: "interactive-employee" }),
      "/api/workspaces/one/tasks",
    ),
    (e) => e.status === 403,
  );
});
test("direct native resource routes and attachment ownership enforce the current workspace", async () => {
  const f = await fixture();
  f.db.exec(
    "CREATE TABLE documents(id TEXT PRIMARY KEY,workspace_id TEXT);INSERT INTO documents VALUES('doc1','w1');INSERT INTO documents VALUES('doc2','w2');CREATE TABLE tasks(id TEXT PRIMARY KEY,workspace_id TEXT);INSERT INTO tasks VALUES('task1','w1');INSERT INTO tasks VALUES('task2','w2');CREATE TABLE task_attachments(id TEXT PRIMARY KEY,task_id TEXT);INSERT INTO task_attachments VALUES('attachment1','task1');INSERT INTO task_attachments VALUES('attachment2','task2');",
  );
  await authorize(f, token(), "/api/documents/doc1");
  await authorize(f, token(), "/api/task-attachments/attachment1/download");
  await assert.rejects(
    authorize(f, token(), "/api/documents/doc2"),
    (e) => e.status === 403,
  );
  await assert.rejects(
    authorize(f, token(), "/api/task-attachments/attachment2/download"),
    (e) => e.status === 403,
  );
  await authorize(f, token(), "/api/workspaces/one/notifications/read", "POST");
});
test("employee identity metadata permits CLI server verification without granting resource collections", async () => {
  const f = await fixture();
  f.identity.bindings.bind({
    issuer,
    subject: "machine",
    nativeUserId: "u1",
    workspaceIds: ["w1"],
    kind: "employee",
    employeeId: "e1",
    clientId: "ziwei-workspace-worker-e1",
  });
  const p = await authorize(
    f,
    token({ sub: "machine", azp: "ziwei-workspace-worker-e1" }),
    "/api/identity/me",
  );
  assert.equal(p.identity.kind, "employee");
  await assert.rejects(
    authorize(
      f,
      token({ sub: "machine", azp: "ziwei-workspace-worker-e1" }),
      "/api/workspaces/one/employees",
    ),
    (e) => e.status === 403,
  );
});
test("provider malformed JSON is sanitized and connectivity failures report service unavailable", async () => {
  const f = await fixture({
    fetch: async () => new Response("sensitive-provider-body", { status: 200 }),
  });
  await assert.rejects(
    f.identity.op.metadata(),
    (e) => e.status === 503 && !e.message.includes("sensitive-provider-body"),
  );
  const g = await fixture({
    fetch: async () => {
      throw Error("provider secret detail");
    },
  });
  await assert.rejects(
    g.identity.authorizeRequest(request(token().raw)),
    (e) => e.status === 503 && !e.message.includes("provider secret detail"),
  );
});
test("explicit management operations need current site admin and original native owner/admin", async () => {
  const paths = [
    ["POST", "/api/workspaces/one/documents/git/import"],
    ["POST", "/api/workspaces/one/documents/git/export"],
    ["POST", "/api/workspaces/one/devices/d1/client-updates"],
    ["POST", "/api/workspaces/one/devices/pairing"],
    ["DELETE", "/api/workspaces/one/employees/e1"],
    ["GET", "/api/workspaces/one/employees/e1/environment"],
    ["POST", "/api/workspaces/one/employees/e1/environment"],
    ["PUT", "/api/workspaces/one/employees/e1/phone-mcp"],
    ["POST", "/api/workspaces/one/ziwei-connect/bindings"],
    ["DELETE", "/api/workspaces/one/ziwei-connect/bindings/b1"],
  ];
  const f = await fixture();
  f.db.exec(
    "CREATE TABLE devices(id TEXT PRIMARY KEY,workspace_id TEXT,owner_user_id TEXT);INSERT INTO devices VALUES('d1','w1','u1');",
  );
  const ordinary = token({
    resource_access: { [aud]: { roles: ["access", "read", "write"] } },
  });
  for (const [method, url] of paths)
    await assert.rejects(
      authorize(f, ordinary, url, method),
      (e) => e.status === 403,
      url,
    );
  for (const [method, url] of paths) await authorize(f, token(), url, method);
  f.db.prepare("UPDATE members SET role='member'").run();
  await assert.rejects(
    authorize(f, token(), paths[0][1], paths[0][0]),
    (e) => e.status === 403,
  );
  await authorize(f, ordinary, "/api/workspaces/one/tasks", "POST");
});
test("unknown signing key refresh recovers after a transient JWKS fetch failure", async () => {
  const { createOpAdapter } = await import("./op.mjs"),
    { jwk } = await import("./fixtures.mjs");
  let reads = 0;
  const f = await fixture();
  const op = createOpAdapter(f.identity.config, {
    fetch: async (url) => {
      if (String(url).endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer,
          authorization_endpoint: issuer + "/auth",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
          introspection_endpoint: issuer + "/introspect",
          revocation_endpoint: issuer + "/revoke",
        });
      reads++;
      if (reads === 2) throw Error("transient JWKS failure");
      return Response.json({ keys: [jwk] });
    },
  });
  await op.jwks({ alg: "RS256", kid: jwk.kid }, {});
  await assert.rejects(
    op.jwks({ alg: "RS256", kid: "rotated-key" }, {}),
    (e) => e.status === 503,
  );
  await op.jwks({ alg: "RS256", kid: jwk.kid }, {});
  assert.equal(reads, 3);
});
test("exact read-only collection actions are supported without broadening employee resource scope", async () => {
  const f = await fixture();
  for (const path of [
    "/api/workspaces/one/bots/capabilities",
    "/mcp/v1/workspaces/one/bots/capabilities",
    "/API/WORKSPACES/one/BOTS/CAPABILITIES/",
    "/api/workspaces/one/documents/trash",
    "/API/WORKSPACES/one/DOCUMENTS/TRASH/",
  ])
    await authorize(f, token(), path);
  f.identity.bindings.bind({
    issuer,
    subject: "machine-actions",
    nativeUserId: "u1",
    workspaceIds: ["w1"],
    kind: "employee",
    employeeId: "e1",
    clientId: "ziwei-workspace-worker-actions",
  });
  for (const path of [
    "/api/workspaces/one/bots/capabilities",
    "/api/workspaces/one/documents/trash",
  ])
    await assert.rejects(
      authorize(
        f,
        token({
          sub: "machine-actions",
          azp: "ziwei-workspace-worker-actions",
        }),
        path,
      ),
      (e) => e.status === 403,
    );
  for (const path of [
    "/api/workspaces/one/bots/capabilities",
    "/api/workspaces/one/documents/trash",
  ])
    await assert.rejects(
      authorize(f, token(), path, "POST"),
      (e) => e.status === 403,
    );
});
