import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../app.mjs";
import { fixture } from "./fixtures.mjs";
export function handle(app, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const socket = new PassThrough();
    const req = new IncomingMessage(socket);
    if (data) req.push(data);
    req.push(null);
    req.complete = true;
    Object.assign(req, {
      method,
      url: path,
      headers: {
        host: "ziwei.test",
        ...(data
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(data),
            }
          : {}),
        ...headers,
      },
    });
    const res = new ServerResponse(req);
    res.end = function (chunk) {
      const text = chunk ? Buffer.from(chunk).toString("utf8") : "";
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        result = text;
      }
      resolve({
        status: this.statusCode,
        headers: this.getHeaders(),
        body: result,
      });
      return this;
    };
    app.handle(req, res, (error) => {
      if (error) return reject(error);
      res.statusCode = 404;
      res.end("{}");
    });
  });
}

async function managedDeviceFixture(t) {
  const f = await fixture();
  t.after(() => f.db.close());
  let clock = Date.now();
  const app = createApp({
    memory: true,
    enableScheduler: false,
    managementMcpNow: () => clock,
    mcpOptions: { token: "legacy-static-owner-token", workspace: "managed-fixture" },
    identityOptions: { env: f.env, fetch: f.fetch },
  });
  t.after(() => { app.locals.botDeferredConfig.stop(); app.locals.repo.db.close(); });
  const auth = app.locals.auth;
  const user = auth.setup({ email: "managed@example.test", name: "Managed", password: "synthetic-managed-only" });
  const { workspace } = auth.createWorkspace(user.user_id, { name: "Managed fixture", slug: "managed-fixture", kind: "team" });
  const repo = app.locals.repo;
  const paired = repo.claimDevicePairing({ code: repo.createDevicePairing(workspace.slug, { createdBy: user.user_id }).code });
  const other = repo.claimDevicePairing({ code: repo.createDevicePairing(workspace.slug, { createdBy: user.user_id }).code });
  auth.createWorkspace(user.user_id, { name: "Foreign fixture", slug: "foreign-fixture", kind: "team" });
  const bootstrap = await handle(app, `/api/workspaces/${workspace.slug}/mcp/bootstrap`, {
    method: "POST", headers: { "x-ziwei-device-token": paired.deviceToken }, body: {},
  });
  assert.equal(bootstrap.status, 200, JSON.stringify(bootstrap.body));
  assert.equal(bootstrap.body.managed, true);
  return { app, repo, workspace, user, paired, other, token: bootstrap.body.token, advance: ms => { clock += ms; } };
}

test("unified MCP accepts paired-device bootstrap credentials while preserving device and human scopes", async t => {
  const f = await managedDeviceFixture(t);
  const headers = { authorization: "Bearer " + f.token };
  const health = await handle(f.app, "/mcp/v1/workspaces/managed-fixture/health", { headers });
  assert.equal(health.status, 200, JSON.stringify(health.body));
  const discovery = await handle(f.app, "/mcp/v1/workspaces/managed-fixture/discovery", {
    headers: { "x-ziwei-mcp-token": f.token },
  });
  assert.equal(discovery.status, 200, JSON.stringify(discovery.body));
  assert.deepEqual(discovery.body.devices.map(device => device.id), [f.paired.deviceId]);
  assert.equal(discovery.body.devices.some(device => device.id === f.other.deviceId), false);
  const humanApi = await handle(f.app, "/api/workspaces/managed-fixture/tasks", { headers });
  assert.equal(humanApi.status, 401);
});

test("unified MCP rejects forged expired cross-workspace revoked and static-owner credentials", async t => {
  const f = await managedDeviceFixture(t);
  const route = "/mcp/v1/workspaces/managed-fixture/health";
  const request = token => handle(f.app, route, { headers: { authorization: "Bearer " + token } });
  const forged = f.token.slice(0, -1) + (f.token.endsWith("0") ? "1" : "0");
  assert.equal((await request(forged)).status, 401);
  assert.equal((await request("legacy-static-owner-token")).status, 401);
  assert.equal((await handle(f.app, "/mcp/v1/workspaces/foreign-fixture/health", {
    headers: { authorization: "Bearer " + f.token },
  })).status, 403);
  f.advance(60 * 60 * 1000);
  assert.equal((await request(f.token)).status, 401);
  f.advance(-60 * 60 * 1000);
  f.repo.setDeviceStatus(f.paired.deviceId, "disabled");
  assert.equal((await request(f.token)).status, 401);
  f.repo.setDeviceStatus(f.paired.deviceId, "pending");
  f.repo.db.prepare("DELETE FROM members WHERE workspace_id=? AND user_id=?").run(f.workspace.id, f.user.user_id);
  assert.equal((await request(f.token)).status, 403);
  f.repo.db.prepare("UPDATE device_credentials SET revoked_at=? WHERE device_id=?").run(new Date().toISOString(), f.paired.deviceId);
  assert.equal((await request(f.token)).status, 401);
});
test("unified HTTP config/status and all legacy human auth paths fail closed without listening", async () => {
  const f = await fixture();
  const app = createApp({
    memory: true,
    enableScheduler: false,
    identityOptions: {
      env: f.env,
      fetch: async () => {
        throw Error("OP offline");
      },
    },
  });
  try {
    const config = await handle(app, "/api/identity/config");
    assert.equal(config.status, 200);
    assert.equal(config.body.mode, "unified");
    assert.equal(config.body.issuer, f.env.ZIWEI_IDENTITY_ISSUER);
    assert.doesNotMatch(JSON.stringify(config.body), /secret|test-api-secret/);
    const status = await handle(app, "/api/auth/status");
    assert.equal(status.status, 200);
    assert.equal(status.body.authenticated, false);
    assert.equal(status.body.identity_mode, "unified");
    for (const endpoint of [
      "login",
      "setup",
      "register",
      "password",
      "token",
      "refresh",
      "session",
    ]) {
      const response = await handle(app, "/api/auth/" + endpoint, {
        method: "POST",
        body: { email: "owner@example.test", password: "not-a-real-password" },
      });
      assert.equal(response.status, 403, endpoint);
    }
    for (const path of [
      "/api/workspaces",
      "/api/auth/me",
      "/api/identity/me",
      "/mcp/v1/workspaces/test-111/health",
    ])
      assert.equal(
        (
          await handle(app, path, {
            headers: {
              cookie: "ziwei_session=legacy",
              "x-ziwei-mcp-token": "old-owner",
              "x-workspace-role": "owner",
            },
          })
        ).status,
        401,
        path,
      );
  } finally {
    app.locals.botDeferredConfig.stop();
    app.locals.repo.db.close();
  }
});
test("legacy preparation mode exposes sanitized readiness without migrating unified tables", async () => {
  const app = createApp({
    memory: true,
    enableScheduler: false,
    identityOptions: { env: {} },
  });
  try {
    const config = await handle(app, "/api/identity/config");
    assert.equal(config.status, 200);
    assert.equal(config.body.mode, "legacy");
    assert.equal(config.body.issuer, null);
    assert.equal(config.body.legacyAllowed, true);
    assert.equal(
      app.locals.repo.db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'unified_identity_%'",
        )
        .get().n,
      0,
    );
  } finally {
    app.locals.botDeferredConfig.stop();
    app.locals.repo.db.close();
  }
});

test("native HTTP and MCP use verified AT while role and native member revocation deny the next request", async () => {
  const f = await fixture();
  const app = createApp({
    memory: true,
    enableScheduler: false,
    identityOptions: { env: f.env, fetch: f.fetch },
  });
  try {
    const auth = app.locals.auth,
      created = auth.setup({
        email: "fixture@example.test",
        name: "Fixture",
        password: "fixture-only-password",
      });
    const { workspace } = auth.createWorkspace(created.user_id, {
      name: "Identity fixture",
      slug: "identity-fixture",
      kind: "team",
    });
    app.locals.identity.bindings.bind({
      issuer: f.env.ZIWEI_IDENTITY_ISSUER,
      subject: "person",
      nativeUserId: created.user_id,
      workspaceIds: [workspace.id],
    });
    const { token } = await import("./fixtures.mjs");
    const t = token();
    f.setCurrent({ active: true, ...t.payload, client_id: t.payload.azp });
    const headers = { authorization: "Bearer " + t.raw };
    for (const path of [
      "/api/identity/me",
      "/api/workspaces/identity-fixture/tasks",
      "/mcp/v1/workspaces/identity-fixture/health",
    ]) {
      const r = await handle(app, path, { headers });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const me = await handle(app, "/api/identity/me", { headers });
    assert.equal(me.body.identity.subject, "person");
    assert.equal(me.body.verified, true);
    f.setCurrent({
      active: true,
      ...t.payload,
      client_id: t.payload.azp,
      resource_access: { "ziwei-workspace-api": { roles: ["access", "read"] } },
    });
    assert.equal(
      (
        await handle(app, "/api/workspaces/identity-fixture/tasks", {
          method: "POST",
          headers,
          body: { title: "must not write" },
        })
      ).status,
      403,
    );
    app.locals.repo.db
      .prepare("DELETE FROM members WHERE user_id=?")
      .run(created.user_id);
    assert.equal(
      (await handle(app, "/api/workspaces/identity-fixture/tasks", { headers }))
        .status,
      403,
    );
  } finally {
    app.locals.botDeferredConfig.stop();
    app.locals.repo.db.close();
  }
});
test("preserved paired-device heartbeat cannot target a different URL device", async () => {
  const f = await fixture(),
    app = createApp({
      memory: true,
      enableScheduler: false,
      identityOptions: { env: f.env, fetch: f.fetch },
    });
  try {
    const auth = app.locals.auth,
      u = auth.setup({
        email: "devices@example.test",
        name: "Devices",
        password: "synthetic-fixture-only",
      });
    auth.createWorkspace(u.user_id, {
      name: "Device fixture",
      slug: "device-fixture",
      kind: "team",
    });
    const repo = app.locals.repo;
    const a = repo.claimDevicePairing({
      code: repo.createDevicePairing("device-fixture", { createdBy: u.user_id })
        .code,
    });
    const b = repo.claimDevicePairing({
      code: repo.createDevicePairing("device-fixture", { createdBy: u.user_id })
        .code,
    });
    let calls = 0;
    repo.heartbeatDevice = (_slug, input) => {
      calls++;
      return { id: input.deviceId };
    };
    const headers = { "x-ziwei-device-token": a.deviceToken };
    const foreign = await handle(
      app,
      `/api/workspaces/device-fixture/devices/${b.deviceId}/heartbeat`,
      { method: "POST", headers, body: {} },
    );
    assert.equal(foreign.status, 401);
    assert.equal(calls, 0);
    const own = await handle(
      app,
      `/api/workspaces/device-fixture/devices/${a.deviceId}/heartbeat`,
      { method: "POST", headers, body: {} },
    );
    assert.equal(own.status, 200);
    assert.equal(calls, 1);
  } finally {
    app.locals.botDeferredConfig.stop();
    app.locals.repo.db.close();
  }
});
test("a paired heartbeat with no body device id uses only its authenticated device", async () => {
  const f = await fixture(),
    app = createApp({
      memory: true,
      enableScheduler: false,
      identityOptions: { env: f.env, fetch: f.fetch },
    });
  try {
    const auth = app.locals.auth,
      u = auth.setup({
        email: "heartbeat@example.test",
        name: "Heartbeat",
        password: "synthetic-fixture-only",
      });
    auth.createWorkspace(u.user_id, {
      name: "Heartbeat fixture",
      slug: "heartbeat-fixture",
    });
    const repo = app.locals.repo,
      a = repo.claimDevicePairing({
        code: repo.createDevicePairing("heartbeat-fixture", {
          createdBy: u.user_id,
        }).code,
      });
    repo.heartbeatDevice = (_slug, input) => ({ id: input.deviceId });
    const response = await handle(
      app,
      "/api/workspaces/heartbeat-fixture/heartbeat",
      {
        method: "POST",
        headers: { "x-ziwei-device-token": a.deviceToken },
        body: {},
      },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.device.id, a.deviceId);
  } finally {
    app.locals.botDeferredConfig.stop();
    app.locals.repo.db.close();
  }
});
test("Express case-insensitive static segments and trailing slash cannot bypass unified admin or stream policies", async () => {
  const f = await fixture(),
    app = createApp({
      memory: true,
      enableScheduler: false,
      identityOptions: { env: f.env, fetch: f.fetch },
    });
  try {
    const auth = app.locals.auth,
      u = auth.setup({
        email: "case@example.test",
        name: "Case fixture",
        password: "synthetic-case-only",
      }),
      { workspace } = auth.createWorkspace(u.user_id, {
        name: "Case fixture",
        slug: "case-fixture",
        kind: "team",
      }),
      db = app.locals.repo.db,
      stamp = new Date().toISOString();
    db.prepare(
      "INSERT INTO employees(id,workspace_id,owner_user_id,name,runtime,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      "EmployeeCase",
      workspace.id,
      u.user_id,
      "Employee",
      "codex",
      stamp,
      stamp,
    );
    app.locals.identity.bindings.bind({
      issuer: f.env.ZIWEI_IDENTITY_ISSUER,
      subject: "person",
      nativeUserId: u.user_id,
      workspaceIds: [workspace.id],
    });
    const { token } = await import("./fixtures.mjs");
    let touched = 0;
    app.locals.repo.upsertEmployeeEnvironment = () => {
      touched++;
      return { ok: true };
    };
    app.locals.phoneMcp.save = async () => {
      touched++;
      return { ok: true };
    };
    for (const admin of [false, true]) {
      const t = token({
        resource_access: {
          "ziwei-workspace-api": {
            roles: ["access", "read", "write", ...(admin ? ["admin"] : [])],
          },
        },
      });
      f.setCurrent({ active: true, ...t.payload, client_id: t.payload.azp });
      const headers = { authorization: "Bearer " + t.raw };
      for (const [method, url] of [
        [
          "PATCH",
          "/api/workspaces/case-fixture/employees/EmployeeCase/ENVIRONMENT/KEY/",
        ],
        [
          "PUT",
          "/API/WORKSPACES/case-fixture/EMPLOYEES/EmployeeCase/PHONE-MCP/",
        ],
      ]) {
        const r = await handle(app, url, {
          method,
          headers,
          body: { value: "synthetic" },
        });
        assert.equal(
          r.status,
          admin ? 200 : 403,
          url + " " + JSON.stringify(r.body),
        );
      }
      if (admin)
        assert.equal(
          (await handle(app, "/API/IDENTITY/ME/", { headers })).status,
          200,
        );
    }
    assert.equal(touched, 2);
    for (const url of [
      "/api/workspaces/case-fixture/NOTIFICATIONS/stream/",
      "/API/WORKSPACES/case-fixture/MOBILE/notifications-v2/",
    ]) {
      const r = await handle(app, url);
      assert.equal(r.status, 401);
      assert.equal(r.body.code, "UNAUTHENTICATED");
    }
  } finally {
    app.locals.botDeferredConfig.stop();
    app.locals.repo.db.close();
  }
});
