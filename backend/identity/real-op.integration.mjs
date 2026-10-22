// Explicit real Keycloak + workspace integration, synthetic memory business data.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import { once } from "node:events";
import { createApp } from "../app.mjs";
import { runCli } from "../../packages/workspace-cli/src/main.mjs";
import {
  CredentialStore,
  selector,
} from "../../packages/workspace-cli/src/config.mjs";
import { unseal } from "./common.mjs";
const f = JSON.parse(fs.readFileSync(process.argv[2], "utf8")),
  checks = [],
  secrets = Object.values(f.credentials).concat([f.password, f.tlsPass]);
const passed = (name, details = {}) => {
  checks.push({ name, passed: true, ...details });
  console.log(JSON.stringify({ check: name, passed: true, ...details }));
};
const remember = (tokens) => {
  for (const [key, value] of Object.entries(tokens || {}))
    if (/token|code|verifier/i.test(key) && typeof value === "string")
      secrets.push(value);
  return tokens;
};
const safe = (error) => {
  let text = String(error?.message || "");
  for (const s of secrets) if (s) text = text.replaceAll(s, "[redacted]");
  return text.replace(/https?:\/\/\S+/g, "[url]").slice(0, 250);
};
const decode = (token) =>
  JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
const req = (
  raw,
  method = "GET",
  url = "/api/workspaces/fixture-one/tasks",
) => ({
  method,
  originalUrl: url,
  url,
  path: url,
  headers: { ...(raw ? { authorization: "Bearer " + raw } : {}) },
  params: {},
  body: {},
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const entity = (x) =>
  x
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
const attr = (tag, name) =>
  entity(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] || "",
  );
function formAgent() {
  const jar = new Map();
  let passwordForms = 0;
  return {
    get passwordForms() {
      return passwordForms;
    },
    cookies(url) {
      const u = new URL(url);
      return [...jar.values()]
        .filter(
          (x) =>
            x.host === u.hostname &&
            u.pathname.startsWith(x.path) &&
            (!x.secure || u.protocol === "https:"),
        )
        .map((x) => x.pair)
        .join("; ");
    },
    async request(url, options = {}) {
      const u = new URL(url);
      assert.ok(
        [new URL(f.issuer).origin, f.origin].includes(u.origin),
        "Only isolated fixture origins",
      );
      const r = await fetch(u, {
        ...options,
        redirect: "manual",
        headers: { ...(options.headers || {}), cookie: this.cookies(u) },
        signal: AbortSignal.timeout(15000),
      });
      for (const item of r.headers.getSetCookie()) {
        const [pair, ...flags] = item.split(";"),
          i = pair.indexOf("="),
          name = pair.slice(0, i),
          value = pair.slice(i + 1),
          p =
            flags
              .find((x) => /^\s*path=/i.test(x))
              ?.trim()
              .slice(5) || "/";
        secrets.push(value);
        if (name.startsWith("__Host-"))
          assert.ok(
            flags.some((x) => x.trim().toLowerCase() === "secure") &&
              flags.some((x) => x.trim().toLowerCase() === "httponly") &&
              !flags.some((x) => /^\s*domain=/i.test(x)),
            "BFF host-only secure HttpOnly cookie",
          );
        const key = u.hostname + "|" + p + "|" + name;
        if (flags.some((x) => /^\s*max-age=0$/i.test(x))) jar.delete(key);
        else
          jar.set(key, {
            host: u.hostname,
            path: p,
            secure: flags.some((x) => x.trim().toLowerCase() === "secure"),
            pair,
          });
      }
      return r;
    },
    async navigate(start, { userCode, stopAt } = {}) {
      let url = new URL(start),
        method = "GET",
        body;
      if (userCode) url.searchParams.set("user_code", userCode);
      for (let step = 0; step < 30; step++) {
        if (stopAt && url.origin + url.pathname === stopAt) return url;
        const r = await this.request(url, {
          method,
          ...(body
            ? {
                body,
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                  origin: url.origin,
                },
              }
            : {}),
        });
        if (r.headers.get("location")) {
          url = new URL(r.headers.get("location"), url);
          method = "GET";
          body = undefined;
          continue;
        }
        const html = await r.text(),
          form = /<form\b[^>]*>[\s\S]*?<\/form>/i.exec(html)?.[0];
        if (!form) {
          assert.ok(r.ok, "Synthetic form page accepted");
          return {
            completed:
              /success|approved|complete|authorized|granted|Workspace fixture/i.test(
                html,
              ),
          };
        }
        const fields = new URLSearchParams();
        for (const tag of form.matchAll(/<input\b[^>]*>/gi)) {
          const name = attr(tag[0], "name");
          if (name) fields.set(name, attr(tag[0], "value"));
        }
        if (fields.has("username"))
          fields.set("username", "fixture-human@example.invalid");
        if (fields.has("password")) {
          passwordForms++;
          fields.set("password", f.password);
        }
        for (const name of fields.keys())
          if (/user.?code/i.test(name) && userCode) fields.set(name, userCode);
        for (const [tag] of form.matchAll(/<(?:button|input)\b[^>]*>/gi))
          if (
            attr(tag, "name") &&
            !/cancel|deny|reject/i.test(attr(tag, "name")) &&
            (attr(tag, "type") === "submit" || /^<button/i.test(tag))
          )
            fields.set(attr(tag, "name"), attr(tag, "value") || "yes");
        url = new URL(
          attr(form.slice(0, form.indexOf(">") + 1), "action") || url,
          url,
        );
        method = "POST";
        body = fields.toString();
      }
      throw Error("Bounded synthetic form navigation exhausted");
    },
  };
}
const opBase = f.issuer + "/protocol/openid-connect";
async function oauth(clientId, body) {
  const r = await fetch(opBase + "/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(f.credentials[clientId]
        ? {
            authorization:
              "Basic " +
              Buffer.from(clientId + ":" + f.credentials[clientId]).toString(
                "base64",
              ),
          }
        : {}),
    },
    body: new URLSearchParams({ client_id: clientId, ...body }),
    signal: AbortSignal.timeout(15000),
  });
  const p = remember(await r.json());
  assert.ok(r.ok, "Real isolated token endpoint accepted grant");
  return p;
}
async function codeGrant(
  clientId = "ziwei-workspace-web",
  scope = "openid workspace:read workspace:write",
) {
  const verifier = crypto.randomBytes(32).toString("base64url"),
    state = crypto.randomBytes(24).toString("hex"),
    nonce = crypto.randomBytes(24).toString("hex");
  secrets.push(verifier, state, nonce);
  const callback =
      f.origin +
      (clientId === "ziwei-workspace-web"
        ? "/api/identity/callback"
        : "/fixture-callback/" + clientId),
    url = new URL(opBase + "/auth");
  for (const [key, value] of Object.entries({
    client_id: clientId,
    response_type: "code",
    redirect_uri: callback,
    scope,
    state,
    nonce,
    code_challenge: crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
  }))
    url.searchParams.set(key, value);
  const reply = await formAgent().navigate(url, { stopAt: callback });
  assert.equal(reply.searchParams.get("state"), state);
  secrets.push(reply.searchParams.get("code"));
  return oauth(clientId, {
    grant_type: "authorization_code",
    code: reply.searchParams.get("code"),
    redirect_uri: callback,
    code_verifier: verifier,
  });
}
let stage = "tls-discovery",
  app,
  server,
  operator,
  admin,
  backchannelToken,
  backchannelRequests = 0,
  backchannelStatus = [],
  heartbeat;
const env = {
  ZIWEI_IDENTITY_MODE: "unified",
  ZIWEI_IDENTITY_ISSUER: f.issuer,
  ZIWEI_IDENTITY_ORIGIN: f.origin,
  ZIWEI_IDENTITY_API_SECRET: f.credentials["ziwei-workspace-api"],
  ZIWEI_IDENTITY_WEB_SECRET: f.credentials["ziwei-workspace-web"],
  ZIWEI_IDENTITY_SESSION_KEY: crypto.randomBytes(32).toString("base64url"),
};
try {
  heartbeat = setInterval(
    () =>
      console.log(
        JSON.stringify({
          event: "worker_heartbeat",
          pid: process.pid,
          stage,
          intervalMs: 10000,
        }),
      ),
    10000,
  );
  const deadline = Date.now() + 240000;
  while (true) {
    try {
      const r = await fetch(f.issuer + "/.well-known/openid-configuration", {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw Error("Independent TLS realm readiness timeout");
    await sleep(1000);
  }
  const discovery = await (
    await fetch(f.issuer + "/.well-known/openid-configuration")
  ).json();
  assert.equal(discovery.issuer, f.issuer);
  passed("real_keycloak_26_8_1_https_discovery_hostname_and_isolated_ca_trust");
  stage = "listener-approval";
  const listenerDeadline = Date.now() + 30000;
  while (!fs.existsSync(path.join(f.runDir, "listeners-approved"))) {
    if (Date.now() > listenerDeadline)
      throw Error("Independent listener approval timeout");
    await sleep(100);
  }
  passed("independent_owned_process_tree_registered_loopback_listeners_only");
  app = createApp({
    memory: true,
    enableScheduler: false,
    identityOptions: { env },
  });
  const auth = app.locals.auth,
    user = auth.setup({
      email: "original-fixture@example.invalid",
      name: "Original native fixture",
      password: crypto.randomBytes(24).toString("hex"),
    });
  const one = auth.createWorkspace(user.user_id, {
      name: "Synthetic one",
      slug: "fixture-one",
      kind: "team",
    }).workspace,
    two = auth.createWorkspace(user.user_id, {
      name: "Synthetic two",
      slug: "fixture-two",
      kind: "team",
    }).workspace;
  server = https.createServer(
    { pfx: fs.readFileSync(f.pfx), passphrase: f.tlsPass },
    async (incoming, res) => {
      if (incoming.url === "/") {
        res.end("Workspace fixture");
        return;
      }
      if (incoming.url?.startsWith("/api/identity/backchannel-logout")) {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const data = Buffer.concat(chunks);
        backchannelToken = new URLSearchParams(data.toString()).get(
          "logout_token",
        );
        if (backchannelToken) secrets.push(backchannelToken);
        backchannelRequests++;
        const { Readable } = await import("node:stream");
        const clone = Readable.from([data]);
        Object.assign(clone, {
          method: incoming.method,
          url: incoming.url,
          headers: incoming.headers,
          socket: incoming.socket,
          complete: true,
        });
        const end = res.end;
        res.end = function (...args) {
          backchannelStatus.push(res.statusCode);
          return end.apply(this, args);
        };
        app.handle(clone, res);
        return;
      }
      app.handle(incoming, res);
    },
  );
  server.listen(5373, "127.0.0.1");
  await once(server, "listening");
  passed("workspace_memory_app_identity_routes_over_real_https_harness");
  const docsProof = [];
  for (const [pathname, type] of [
    ["/docs", "text/html"],
    ["/docs/cli.md", "text/markdown"],
    ["/llms.txt", "text/plain"],
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(f.origin + pathname, {
        method,
        redirect: "manual",
      });
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("content-type")?.startsWith(type));
      const text = await response.text();
      if (method === "GET") {
        assert.ok(text.includes("2.0.0"));
        if (pathname === "/docs/cli.md") {
          assert.equal((text.match(/^### [^\r\n]+/gm) || []).length, 44);
          const schemas = [
            ...text.matchAll(/输入 schema：\s*```json\s*([\s\S]*?)```/g),
          ].map((match) => JSON.parse(match[1]));
          assert.equal(schemas.length, 44);
          assert.ok(
            schemas.every(
              (schema) => schema.type === "object" && schema.properties,
            ),
          );
          assert.ok(text.includes("inputSchema"));
        }
      } else assert.equal(text, "");
      docsProof.push({
        path: pathname,
        method,
        status: response.status,
        contentType: response.headers.get("content-type"),
      });
    }
  }
  assert.equal((await fetch(f.origin + "/docs/missing")).status, 404);
  assert.equal((await fetch(f.origin + "/api/identity/me")).status, 401);
  passed(
    "anonymous_real_https_get_head_docs_cli_markdown_llms_2_0_0_all_44_schemas_and_unknown_404_private_401",
    { requests: docsProof },
  );
  const access = await codeGrant(),
    claims = decode(access.access_token);
  app.locals.identity.bindings.bind({
    issuer: f.issuer,
    subject: claims.sub,
    nativeUserId: user.user_id,
    workspaceIds: [one.id],
  });
  const id = app.locals.identity,
    raw = access.access_token;
  secrets.push(raw);
  const introspect = (token) => id.op.introspect(token);
  let introspections = 0;
  const originalIntrospect = id.op.introspect;
  id.op.introspect = async (token) => {
    introspections++;
    return originalIntrospect(token);
  };
  const me = await fetch(f.origin + "/api/identity/me", {
    headers: { authorization: "Bearer " + raw },
  });
  assert.equal(me.status, 200);
  const identity = await me.json();
  assert.equal(identity.user.id, user.user_id);
  assert.equal(identity.identity.subject, claims.sub);
  assert.equal(identity.verified, true);
  await id.authorizeRequest(req(raw));
  await id.authorizeRequest(req(raw));
  assert.ok(introspections >= 3);
  passed(
    "workspace_real_signed_at_confidential_introspection_each_request_and_explicit_native_binding",
    { introspections },
  );
  assert.equal(
    (
      await fetch(f.origin + "/api/workspaces/fixture-two/tasks", {
        headers: { authorization: "Bearer " + raw },
      })
    ).status,
    403,
  );
  await assert.rejects(
    id.authorizeRequest(req(access.id_token)),
    (e) => e.status === 401,
  );
  const foreign = await codeGrant("ziwei-world-web", "openid world:read");
  await assert.rejects(
    id.authorizeRequest(req(foreign.access_token)),
    (e) => e.status === 401,
  );
  passed(
    "workspace_real_id_token_cross_site_at_and_native_unbound_workspace_rejected",
  );
  for (const [url, method] of [
    ["/api/auth/login", "POST"],
    ["/api/auth/register", "POST"],
    ["/api/auth/setup", "POST"],
    ["/api/auth/token", "POST"],
    ["/api/auth/session", "POST"],
    ["/api/workspaces/fixture-one/tasks", "GET"],
    ["/mcp/v1/workspaces/fixture-one/health", "GET"],
  ]) {
    const r = await fetch(f.origin + url, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "ziwei_session=synthetic-old-cookie",
        authorization: "Bearer " + "synthetic-old-static-owner",
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    assert.ok([401, 403].includes(r.status), "Legacy path rejected");
  }
  passed(
    "workspace_legacy_password_cookie_token_and_static_mcp_bearer_rejected_in_unified_mode",
  );
  operator = await oauth("fixture-operator", {
    grant_type: "client_credentials",
  });
  admin = async (p, method = "GET", body) => {
    const r = await fetch(
      new URL(f.issuer).origin + "/admin/realms/" + f.instance + p,
      {
        method,
        headers: {
          authorization: "Bearer " + operator.access_token,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      },
    );
    assert.ok(r.ok, "Synthetic realm administration accepted");
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  const users = await admin("/users?username=fixture-human&exact=true"),
    apiClient = (await admin("/clients?clientId=ziwei-workspace-api"))[0],
    rolePath =
      "/users/" + users[0].id + "/role-mappings/clients/" + apiClient.id,
    role = async (name) => admin("/clients/" + apiClient.id + "/roles/" + name),
    read = await role("read"),
    write = await role("write"),
    adminRole = await role("admin");
  stage = "bff-login";
  const browser = formAgent();
  assert.ok(
    (await browser.navigate(f.origin + "/api/identity/login")).completed,
  );
  const bffMe = await browser.request(f.origin + "/api/identity/me");
  assert.equal(bffMe.status, 200);
  const cookieHeader = browser.cookies(f.origin);
  assert.ok(cookieHeader.includes("__Host-ziwei_identity="));
  let session = app.locals.repo.db
    .prepare("SELECT * FROM unified_identity_sessions WHERE revoked_at IS NULL")
    .get();
  assert.ok(session);
  const before = remember(unseal(id.config.key, session.tokens));
  assert.ok(before.refresh_token && !before.scope?.includes("offline_access"));
  passed(
    "workspace_bff_real_authorization_code_pkce_state_nonce_id_token_sid_secure_cookie_and_server_tokens",
    { passwordForms: browser.passwordForms },
  );
  const csrf = await browser.request(f.origin + "/api/identity/logout", {
    method: "POST",
    headers: {
      origin: "https://cross-site.invalid",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(csrf.status, 403);
  const wrongCallback = await browser.request(
    f.origin + "/api/identity/callback?code=synthetic&state=wrong",
  );
  assert.equal(wrongCallback.status, 401);
  passed("workspace_bff_wrong_state_and_cross_origin_logout_denied");
  await id.authorizeRequest({
    ...req(null, "POST"),
    headers: { cookie: cookieHeader, origin: f.origin },
  });
  await admin(rolePath, "DELETE", [write]);
  await assert.rejects(
    id.authorizeRequest({
      ...req(null, "POST"),
      headers: { cookie: cookieHeader, origin: f.origin },
    }),
    (e) => e.status === 403,
  );
  passed("workspace_bff_current_op_role_removal_revokes_same_cookie_write");
  const oldRead = await codeGrant();
  await assert.rejects(
    id.authorizeRequest(req(oldRead.access_token, "POST")),
    (e) => e.status === 403,
  );
  await admin(rolePath, "POST", [write]);
  await assert.rejects(
    id.authorizeRequest(req(oldRead.access_token, "POST")),
    (e) => e.status === 403,
  );
  await id.authorizeRequest(req(raw, "POST"));
  passed(
    "workspace_current_op_role_addition_cannot_expand_old_at_but_original_grant_restored",
  );
  stage = "site-admin-revocation";
  const managementStamp = new Date().toISOString();
  app.locals.repo.db
    .prepare(
      "INSERT OR IGNORE INTO employees(id,workspace_id,owner_user_id,name,runtime,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      "fixture-employee",
      one.id,
      user.user_id,
      "Synthetic employee",
      "codex",
      managementStamp,
      managementStamp,
    );
  app.locals.repo.db
    .prepare(
      "INSERT INTO devices(id,workspace_id,owner_user_id,name,os,status,bridge_name,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "fixture-device",
      one.id,
      user.user_id,
      "Synthetic device",
      "test",
      "pending",
      "ziwei_user",
      managementStamp,
    );
  const managementCases = [
    ["POST", "/documents/git/export"],
    ["POST", "/devices/fixture-device/client-updates"],
    ["POST", "/devices/pairing"],
    ["GET", "/employees/fixture-employee/environment"],
    ["DELETE", "/employees/fixture-employee"],
    ["PUT", "/employees/fixture-employee/phone-mcp"],
    ["POST", "/ziwei-connect/bindings"],
  ];
  for (const [method, suffix] of managementCases)
    await id.authorizeRequest(
      req(raw, method, "/api/workspaces/fixture-one" + suffix),
    );
  await admin(rolePath, "DELETE", [adminRole]);
  for (const [method, suffix] of [
    [
      "PATCH",
      "/API/WORKSPACES/fixture-one/EMPLOYEES/fixture-employee/ENVIRONMENT/KEY/",
    ],
    [
      "PUT",
      "/API/WORKSPACES/fixture-one/EMPLOYEES/fixture-employee/PHONE-MCP/",
    ],
  ]) {
    const response = await fetch(f.origin + suffix, {
      method,
      headers: {
        authorization: "Bearer " + raw,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
  }
  for (const streamPath of [
    "/api/workspaces/fixture-one/NOTIFICATIONS/stream/",
    "/API/WORKSPACES/fixture-one/MOBILE/notifications-v2/",
  ]) {
    const response = await fetch(f.origin + streamPath, {
      headers: { authorization: "Bearer " + raw },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "UNIFIED_STREAM_DISABLED");
  }
  passed(
    "workspace_real_http_case_insensitive_static_paths_trailing_slash_admin_and_stream_bypass_rejected",
  );
  for (const [method, suffix] of managementCases)
    await assert.rejects(
      id.authorizeRequest(
        req(raw, method, "/api/workspaces/fixture-one" + suffix),
      ),
      (e) => e.status === 403,
    );
  await id.authorizeRequest(req(raw, "POST"));
  await admin(rolePath, "POST", [adminRole]);
  passed(
    "workspace_real_admin_role_removal_blocks_secrets_pairing_upgrades_employee_delete_phone_bindings_and_git_management",
  );
  const readOnly = await codeGrant(
    "ziwei-workspace-web",
    "openid workspace:read",
  );
  await assert.rejects(
    id.authorizeRequest(
      req(readOnly.access_token, "GET", "/api/workspaces/fixture-one/settings"),
    ),
    (e) => e.status === 403,
  );
  passed(
    "workspace_real_admin_role_read_scope_cannot_run_management_permission",
  );
  stage = "group-composite";
  await admin(rolePath, "DELETE", [read, write, adminRole]);
  await admin("/groups", "POST", { name: "fixture-workspace-readers" });
  const group = (
    await admin("/groups?search=fixture-workspace-readers&exact=true")
  )[0];
  const groupRole =
    "/groups/" + group.id + "/role-mappings/clients/" + apiClient.id;
  await admin(groupRole, "POST", [read]);
  await admin("/users/" + users[0].id + "/groups/" + group.id, "PUT");
  const groupToken = await codeGrant();
  await id.authorizeRequest(req(groupToken.access_token));
  await admin("/users/" + users[0].id + "/groups/" + group.id, "DELETE");
  await assert.rejects(
    id.authorizeRequest(req(groupToken.access_token)),
    (e) => e.status === 403,
  );
  passed("workspace_real_group_membership_removal_revokes_old_at_read");
  await admin("/groups/" + group.id, "DELETE");
  const bundle = "/clients/" + apiClient.id + "/roles/fixture-workspace-bundle";
  await admin("/clients/" + apiClient.id + "/roles", "POST", {
    name: "fixture-workspace-bundle",
  });
  await admin(bundle + "/composites", "POST", [read]);
  await admin(rolePath, "POST", [await admin(bundle)]);
  const compositeToken = await codeGrant();
  await id.authorizeRequest(req(compositeToken.access_token));
  await admin(bundle + "/composites", "DELETE", [read]);
  await assert.rejects(
    id.authorizeRequest(req(compositeToken.access_token)),
    (e) => e.status === 403,
  );
  passed("workspace_real_composite_child_removal_revokes_old_at_read");
  await admin(rolePath, "DELETE", [await admin(bundle)]);
  await admin(bundle, "DELETE");
  await admin(rolePath, "POST", [read, write, adminRole]);
  stage = "employee";
  const employeeToken = await oauth("ziwei-workspace-worker-fixture", {
      grant_type: "client_credentials",
      scope: "workspace:read workspace:write",
    }),
    employeeClaims = decode(employeeToken.access_token),
    stamp = new Date().toISOString();
  app.locals.repo.db
    .prepare(
      "INSERT OR IGNORE INTO employees(id,workspace_id,owner_user_id,name,runtime,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      "fixture-employee",
      one.id,
      user.user_id,
      "Synthetic employee",
      "codex",
      stamp,
      stamp,
    );
  await assert.rejects(
    id.authorizeRequest(req(employeeToken.access_token)),
    (e) => e.status === 401,
  );
  id.bindings.bind({
    issuer: f.issuer,
    subject: employeeClaims.sub,
    nativeUserId: user.user_id,
    workspaceIds: [one.id],
    kind: "employee",
    employeeId: "fixture-employee",
    clientId: "ziwei-workspace-worker-fixture",
  });
  const employeePath = "/api/workspaces/fixture-one/employees/fixture-employee";
  await id.authorizeRequest(
    req(employeeToken.access_token, "GET", employeePath),
  );
  await assert.rejects(
    id.authorizeRequest(req(employeeToken.access_token)),
    (e) => e.status === 403,
  );
  id.bindings.disable(f.issuer, employeeClaims.sub);
  await assert.rejects(
    id.authorizeRequest(req(employeeToken.access_token, "GET", employeePath)),
    (e) => e.status === 403,
  );
  passed(
    "workspace_real_machine_at_requires_registry_subject_single_employee_and_current_enabled_binding",
  );
  stage = "bff-refresh";
  app.locals.repo.db
    .prepare("UPDATE unified_identity_sessions SET access_exp=0 WHERE id=?")
    .run(session.id);
  assert.equal(
    (await browser.request(f.origin + "/api/identity/me")).status,
    200,
  );
  session = app.locals.repo.db
    .prepare("SELECT * FROM unified_identity_sessions WHERE id=?")
    .get(session.id);
  const refreshed = remember(unseal(id.config.key, session.tokens));
  assert.ok(
    refreshed.refresh_token !== before.refresh_token,
    "Real web RT rotated",
  );
  await browser.request(f.origin + "/api/identity/logout", {
    method: "POST",
    headers: { origin: f.origin, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(
    (await browser.request(f.origin + "/api/identity/me")).status,
    401,
  );
  assert.equal((await introspect(refreshed.access_token)).active, false);
  passed(
    "workspace_bff_real_refresh_rotation_and_current_site_logout_latest_at_revocation",
  );
  stage = "cli-device";
  const cliRoot = path.join(f.runDir, "cli-private"),
    cliEnv = {
      ZIWEI_WORKSPACE_CONFIG_DIR: cliRoot,
      ZIWEI_IDENTITY_ISSUER: f.issuer,
    };
  async function cli(args) {
    let stdout = "";
    const result = await runCli([...args, "--api", f.origin], {
      env: cliEnv,
      stdout: (value) => (stdout += value),
      stderr: () => {},
      fetchImpl: fetch,
    });
    const out = JSON.parse(stdout);
    assert.ok(!stdout.includes(f.password), "CLI secret redaction");
    return { result, out };
  }
  const login = await cli(["auth", "login", "--workspace", "fixture-one"]);
  assert.equal(login.result.exitCode, 0);
  assert.equal(
    (
      await formAgent().navigate(login.out.data.verificationUri, {
        userCode: login.out.data.userCode,
      })
    ).completed,
    true,
  );
  const completion = await cli(["auth", "wait", "--timeout", "30000"]);
  assert.equal(completion.result.exitCode, 0);
  assert.equal((await cli(["auth", "status"])).result.exitCode, 0);
  assert.equal((await cli(["tasks", "list"])).result.exitCode, 0);
  assert.equal((await cli(["bots", "capabilities"])).result.exitCode, 0);
  for (const pathname of [
    "/api/workspaces/fixture-one/documents/trash",
    "/API/WORKSPACES/fixture-one/BOTS/CAPABILITIES/",
    "/mcp/v1/workspaces/fixture-one/bots/capabilities",
  ]) {
    assert.equal(
      (
        await fetch(f.origin + pathname, {
          headers: { authorization: "Bearer " + raw },
        })
      ).status,
      200,
    );
  }
  passed(
    "workspace_real_http_collection_static_actions_and_cli_bot_capabilities_supported",
  );
  assert.equal((await cli(["auth", "refresh"])).result.exitCode, 0);
  const store = new CredentialStore(cliRoot),
    selection = selector({}, f.origin),
    cliCredential = await store.load(selection);
  remember({
    access_token: cliCredential.accessToken,
    refresh_token: cliCredential.refreshToken,
  });
  const logout = await cli(["auth", "logout"]);
  assert.equal(logout.result.exitCode, 0);
  assert.equal(logout.out.data.remoteRevocation, "accepted");
  assert.equal((await introspect(cliCredential.accessToken)).active, false);
  assert.equal(await store.load(selection), null);
  passed(
    "workspace_cli_real_device_pkce_approval_server_native_verification_tasks_read_refresh_logout_and_revocation",
  );
  stage = "backchannel";
  const backBrowser = formAgent();
  assert.ok(
    (await backBrowser.navigate(f.origin + "/api/identity/login")).completed,
  );
  assert.equal(
    (await backBrowser.request(f.origin + "/api/identity/me")).status,
    200,
  );
  const backCookie = backBrowser.cookies(f.origin),
    beforeBack = backchannelRequests;
  await admin("/users/" + users[0].id + "/logout", "POST");
  for (let i = 0; i < 30 && backchannelRequests === beforeBack; i++)
    await sleep(200);
  assert.ok(
    backchannelRequests > beforeBack,
    "Real OP delivered signed backchannel",
  );
  assert.ok(
    backchannelStatus.includes(200),
    "Workspace accepted OP signed logout token",
  );
  assert.equal(
    (
      await fetch(f.origin + "/api/identity/me", {
        headers: { cookie: backCookie },
      })
    ).status,
    401,
  );
  const replay = await fetch(f.origin + "/api/identity/backchannel-logout", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ logout_token: backchannelToken }),
  });
  assert.equal(replay.status, 401);
  passed(
    "workspace_bff_real_op_signed_backchannel_logout_tombstone_and_jti_replay_denied",
    { backchannelRequests },
  );
  stage = "disabled";
  const enabledToken = await codeGrant();
  await id.authorizeRequest(req(enabledToken.access_token));
  await admin("/users/" + users[0].id, "PUT", { enabled: false });
  await assert.rejects(
    id.authorizeRequest(req(enabledToken.access_token)),
    (e) => e.status === 401,
  );
  passed("workspace_real_op_disabled_user_old_at_denied");
  stage = "final-listener-observation";
  console.log(
    JSON.stringify({
      event: "browser_observation_window",
      origin: f.origin,
      certificateTrust: "self-signed fixture; browser trust unchanged",
    }),
  );
  await sleep(
    process.env.ZIWEI_REAL_OP_BROWSER_OBSERVATION === "1" ? 60000 : 12000,
  );
  fs.writeFileSync(
    f.resultFile,
    JSON.stringify({
      passed: true,
      synthetic: true,
      production: false,
      checks,
      introspections,
      backchannelRequests,
      stage: "complete",
      browser: {
        engine: "HTTPS form agent using real OP HTML forms; no browser engine",
        secureCookieFlagsVerified: true,
        realBrowserSecureCookieSemantics: false,
      },
      limitations: [
        "Real browser engine/UI, public DNS/TLS and actual production bindings were not exercised.",
        "Refresh scheduling was forced by changing only the isolated SQL access_exp; actual OP refresh/token verification remained unchanged.",
        "Two registered loopback TLS harness ports only; no production business service or device action was started.",
      ],
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "workspace_real_op_failure",
      stage,
      error: {
        name: error.name,
        code: error.code || null,
        message: safe(error),
      },
    }),
  );
  fs.writeFileSync(
    f.resultFile,
    JSON.stringify({
      passed: false,
      synthetic: true,
      production: false,
      checks,
      stage,
      error: {
        name: error.name,
        code: error.code || null,
        message: safe(error),
      },
    }),
  );
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  if (admin)
    try {
      await admin("", "DELETE");
      console.log(
        JSON.stringify({
          event: "synthetic_realm_deleted",
          instance: f.instance,
        }),
      );
    } catch {
      console.log(
        JSON.stringify({
          event: "realm_discarded_by_owned_in_memory_process_shutdown",
          instance: f.instance,
        }),
      );
    }
  if (server) {
    server.closeIdleConnections();
    await new Promise((r) => server.close(r));
  }
  app?.locals.botDeferredConfig.stop();
  app?.locals.repo.db.close();
}
