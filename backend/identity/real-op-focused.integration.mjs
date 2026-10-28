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
let stage = "focused-discovery",
  app,
  server,
  admin,
  heartbeat,
  introspections = 0;
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
      if (
        (
          await fetch(f.issuer + "/.well-known/openid-configuration", {
            signal: AbortSignal.timeout(1500),
          })
        ).ok
      )
        break;
    } catch {}
    if (Date.now() > deadline)
      throw Error("Synthetic realm TLS readiness timeout");
    await sleep(1000);
  }
  const listenerDeadline = Date.now() + 30000;
  while (!fs.existsSync(path.join(f.runDir, "listeners-approved"))) {
    if (Date.now() > listenerDeadline)
      throw Error("Independent listener approval timeout");
    await sleep(100);
  }
  app = createApp({
    memory: true,
    enableScheduler: false,
    identityOptions: { env },
  });
  const auth = app.locals.auth,
    user = auth.setup({
      email: "focused-native@example.invalid",
      name: "Focused native fixture",
      password: crypto.randomBytes(24).toString("hex"),
    }),
    one = auth.createWorkspace(user.user_id, {
      name: "Focused fixture",
      slug: "fixture-one",
      kind: "team",
    }).workspace,
    id = app.locals.identity,
    stamp = new Date().toISOString();
  app.locals.repo.db
    .prepare(
      "INSERT INTO employees(id,workspace_id,owner_user_id,name,runtime,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      "focused-employee",
      one.id,
      user.user_id,
      "Focused employee",
      "codex",
      stamp,
      stamp,
    );
  server = https.createServer(
    { pfx: fs.readFileSync(f.pfx), passphrase: f.tlsPass },
    (req, res) => {
      if (req.url === "/") {
        res.end("Workspace fixture");
        return;
      }
      app.handle(req, res);
    },
  );
  server.listen(5373, "127.0.0.1");
  await once(server, "listening");
  const originalIntrospect = id.op.introspect;
  id.op.introspect = async (token) => {
    introspections++;
    return originalIntrospect(token);
  };
  const operator = await oauth("fixture-operator", {
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
    assert.ok(r.ok, "Synthetic realm admin request");
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  const workerClientId = "ziwei-workspace-worker-fixture",
    api = (await admin("/clients?clientId=ziwei-workspace-api"))[0],
    workerClient = (await admin("/clients?clientId=" + workerClientId))[0],
    worker = await admin(
      "/clients/" + workerClient.id + "/service-account-user",
    ),
    workerRolePath = "/users/" + worker.id + "/role-mappings/clients/" + api.id,
    read = await admin("/clients/" + api.id + "/roles/read"),
    write = await admin("/clients/" + api.id + "/roles/write"),
    workerPath = "/api/workspaces/fixture-one/employees/focused-employee";
  id.bindings.bind({
    issuer: f.issuer,
    subject: worker.id,
    nativeUserId: user.user_id,
    workspaceIds: [one.id],
    kind: "employee",
    employeeId: "focused-employee",
    clientId: workerClientId,
  });
  const machine = () =>
    oauth(workerClientId, {
      grant_type: "client_credentials",
      scope: "workspace:read workspace:write",
    });
  const call = async (token, permission = "read", kind = "worker") => {
    const path =
      kind === "worker" ? workerPath : "/api/workspaces/fixture-one/tasks";
    return id.authorizeRequest(
      req(token, permission === "read" ? "GET" : "POST", path),
    );
  };
  const denied = async (token, permission = "read", kind = "worker") =>
    assert.rejects(
      call(token, permission, kind),
      (error) => error.status === 403,
    );
  const effective = async (token) =>
    (await id.op.introspect(token)).resource_access?.["ziwei-workspace-api"]
      ?.roles || [];
  const initial = await machine();
  await call(initial.access_token);
  await call(initial.access_token, "write");
  passed(
    "focused_workspace_real_worker_site_at_introspection_native_single_employee_baseline",
  );
  stage = "worker-direct";
  await admin(workerRolePath, "DELETE", [write]);
  await denied(initial.access_token, "write");
  assert.ok(!(await effective(initial.access_token)).includes("write"));
  const issuedRead = await machine();
  await call(issuedRead.access_token);
  await admin(workerRolePath, "POST", [write]);
  assert.ok((await effective(issuedRead.access_token)).includes("write"));
  assert.ok(
    !decode(issuedRead.access_token).resource_access[
      "ziwei-workspace-api"
    ].roles.includes("write"),
  );
  await denied(issuedRead.access_token, "write");
  const issuedWrite = await machine();
  await call(issuedWrite.access_token, "write");
  passed(
    "worker_op_direct_write_removal_denies_old_at_and_addition_does_not_expand_read_at_new_at_can_write",
  );
  await admin(workerRolePath, "DELETE", [read, write]);
  await admin("/groups", "POST", { name: "focused-worker-readers" });
  const group = (
      await admin("/groups?search=focused-worker-readers&exact=true")
    )[0],
    groupRoles = "/groups/" + group.id + "/role-mappings/clients/" + api.id,
    groupMember = "/users/" + worker.id + "/groups/" + group.id;
  await admin(groupRoles, "POST", [read]);
  await admin(groupMember, "PUT");
  const groupToken = await machine();
  await call(groupToken.access_token);
  await admin(groupRoles, "POST", [write]);
  await denied(groupToken.access_token, "write");
  assert.ok((await effective(groupToken.access_token)).includes("write"));
  const groupNew = await machine();
  await call(groupNew.access_token, "write");
  await admin(groupMember, "DELETE");
  await denied(groupToken.access_token);
  await denied(groupNew.access_token, "write");
  passed(
    "worker_op_group_added_write_old_at_denied_and_membership_removal_revokes_read_write",
  );
  await admin(groupMember, "PUT");
  const groupRestored = await machine();
  await call(groupRestored.access_token);
  await admin(groupRoles, "DELETE", [read]);
  await denied(groupRestored.access_token);
  passed("worker_op_group_role_removal_revokes_old_read_at");
  await admin(groupMember, "DELETE");
  await admin("/groups/" + group.id, "DELETE");
  stage = "worker-composite";
  const roles = "/clients/" + api.id + "/roles",
    bundlePath = roles + "/focused-worker-bundle";
  await admin(roles, "POST", { name: "focused-worker-bundle" });
  await admin(bundlePath + "/composites", "POST", [read]);
  let bundle = await admin(bundlePath);
  await admin(workerRolePath, "POST", [bundle]);
  const compositeToken = await machine();
  await call(compositeToken.access_token);
  await admin(bundlePath + "/composites", "POST", [write]);
  assert.ok((await effective(compositeToken.access_token)).includes("write"));
  await denied(compositeToken.access_token, "write");
  const compositeNew = await machine();
  await call(compositeNew.access_token, "write");
  await admin(bundlePath + "/composites", "DELETE", [read]);
  await denied(compositeToken.access_token);
  passed(
    "worker_op_composite_added_write_cannot_expand_old_at_and_child_removal_revokes_read",
  );
  await admin(workerRolePath, "DELETE", [bundle]);
  await denied(compositeNew.access_token, "write");
  passed("worker_op_composite_mapping_removal_revokes_old_write_at");
  await admin(bundlePath, "DELETE");
  await admin(workerRolePath, "POST", [read, write]);
  stage = "worker-client-disable";
  const beforeDisable = await machine();
  await call(beforeDisable.access_token, "write");
  await admin("/clients/" + workerClient.id, "PUT", { enabled: false });
  assert.equal(
    (await id.op.introspect(beforeDisable.access_token)).active,
    false,
  );
  await assert.rejects(
    call(beforeDisable.access_token),
    (error) => error.status === 401,
  );
  const disabledGrant = await fetch(opBase + "/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization:
        "Basic " +
        Buffer.from(
          workerClientId + ":" + f.credentials[workerClientId],
        ).toString("base64"),
    },
    body: new URLSearchParams({
      client_id: workerClientId,
      grant_type: "client_credentials",
      scope: "workspace:read",
    }),
  });
  assert.ok([400, 401].includes(disabledGrant.status));
  passed(
    "worker_op_client_disabled_old_at_inactive_and_new_client_credentials_grant_rejected",
  );
  await admin("/clients/" + workerClient.id, "PUT", { enabled: true });
  stage = "web-cli-worker-matrix";
  const webBefore = await codeGrant(),
    humanSub = decode(webBefore.access_token).sub;
  id.bindings.bind({
    issuer: f.issuer,
    subject: humanSub,
    nativeUserId: user.user_id,
    workspaceIds: [one.id],
  });
  await call(webBefore.access_token, "write", "human");
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
    return { result, out: JSON.parse(stdout) };
  }
  const started = await cli(["auth", "login", "--workspace", "fixture-one"]);
  assert.equal(started.result.exitCode, 0);
  assert.equal(
    (
      await formAgent().navigate(started.out.data.verificationUri, {
        userCode: started.out.data.userCode,
      })
    ).completed,
    true,
  );
  const completed = await cli(["auth", "wait", "--timeout", "30000"]);
  assert.equal(completed.result.exitCode, 0);
  const store = new CredentialStore(cliRoot),
    selection = selector({}, f.origin),
    cliStored = await store.load(selection);
  remember({
    access_token: cliStored.accessToken,
    refresh_token: cliStored.refreshToken,
  });
  const cliBefore = {
      access_token: cliStored.accessToken,
      refresh_token: cliStored.refreshToken,
    },
    workerBefore = await machine();
  const before = { web: webBefore, cli: cliBefore, worker: workerBefore };
  const kindFor = (name) => (name === "worker" ? "worker" : "human");
  const matrix = async (
    tokens,
    expectedPermission = "write",
    expectDenied = false,
  ) => {
    for (const [name, value] of Object.entries(tokens)) {
      if (expectDenied)
        await denied(value.access_token, expectedPermission, kindFor(name));
      else await call(value.access_token, expectedPermission, kindFor(name));
    }
  };
  const mint = async () => ({
    web: await codeGrant(),
    cli: await oauth("ziwei-workspace-cli", {
      grant_type: "refresh_token",
      refresh_token: cliBefore.refresh_token,
    }),
    worker: await machine(),
  });
  await matrix(before);
  passed(
    "web_actual_code_cli_actual_device_and_registered_worker_baseline_before_mapper_changes",
  );
  const scopes = await admin("/client-scopes"),
    actionScopes = scopes.filter((x) =>
      ["workspace:read", "workspace:write"].includes(x.name),
    ),
    scopeByName = Object.fromEntries(actionScopes.map((x) => [x.name, x])),
    mapperRecords = [];
  for (const scope of actionScopes) {
    const mappers = await admin(
      "/client-scopes/" + scope.id + "/protocol-mappers/models",
    );
    for (const mapper of mappers)
      if (mapper.protocolMapper === "oidc-usermodel-client-role-mapper")
        mapperRecords.push({ scope, mapper: structuredClone(mapper) });
  }
  assert.equal(mapperRecords.length, 2);
  const configureMappers = async (changes) => {
    for (const { scope, mapper } of mapperRecords)
      await admin(
        "/client-scopes/" + scope.id + "/protocol-mappers/models/" + mapper.id,
        "PUT",
        { ...mapper, config: { ...mapper.config, ...changes } },
      );
  };
  stage = "introspection-mapper-output-removal";
  await configureMappers({ "introspection.token.claim": "false" });
  await matrix(before, "write", true);
  for (const value of Object.values(before)) {
    const current = await id.op.introspect(value.access_token);
    assert.equal(current.active, true);
    assert.ok(!current.resource_access?.["ziwei-workspace-api"]?.roles);
  }
  passed(
    "web_cli_worker_introspection_role_mapper_output_removed_fail_closed_for_existing_signed_at",
  );
  await configureMappers({ "introspection.token.claim": "true" });
  await matrix(before);
  passed(
    "web_cli_worker_introspection_mapper_restored_only_signed_grants_resume",
  );
  stage = "access-token-mapper-output-removal";
  await configureMappers({ "access.token.claim": "false" });
  const missingAt = await mint();
  for (const value of Object.values(missingAt))
    assert.ok(
      !decode(value.access_token).resource_access?.["ziwei-workspace-api"]
        ?.roles,
    );
  await matrix(missingAt, "write", true);
  await configureMappers({ "access.token.claim": "true" });
  await matrix(missingAt, "write", true);
  const restoredTokens = {
    web: await codeGrant(),
    cli: await oauth("ziwei-workspace-cli", {
      grant_type: "refresh_token",
      refresh_token: missingAt.cli.refresh_token,
    }),
    worker: await machine(),
  };
  await matrix(restoredTokens);
  passed(
    "web_cli_worker_missing_signed_role_mapper_fail_closed_and_restoring_mapper_does_not_expand_old_at_new_at_works",
  );
  stage = "client-scope-role-mapping-removal";
  const writeScopeRolePath =
    "/client-scopes/" +
    scopeByName["workspace:write"].id +
    "/scope-mappings/clients/" +
    api.id;
  await admin(writeScopeRolePath, "DELETE", [write]);
  await matrix(restoredTokens, "write", true);
  for (const value of Object.values(restoredTokens))
    assert.ok(!(await effective(value.access_token)).includes("write"));
  const whileScopeRemoved = {
    web: await codeGrant(),
    cli: await oauth("ziwei-workspace-cli", {
      grant_type: "refresh_token",
      refresh_token: restoredTokens.cli.refresh_token,
    }),
    worker: await machine(),
  };
  await matrix(whileScopeRemoved, "write", true);
  await admin(writeScopeRolePath, "POST", [write]);
  await matrix(whileScopeRemoved, "write", true);
  assert.ok(
    (await effective(whileScopeRemoved.worker.access_token)).includes("write"),
  );
  const finalTokens = {
    web: await codeGrant(),
    cli: await oauth("ziwei-workspace-cli", {
      grant_type: "refresh_token",
      refresh_token: whileScopeRemoved.cli.refresh_token,
    }),
    worker: await machine(),
  };
  await matrix(finalTokens);
  passed(
    "web_cli_worker_client_scope_write_role_mapping_removal_revokes_old_at_and_addition_requires_new_signed_at",
  );
  stage = "mapper-model-deletion";
  for (const { scope, mapper } of mapperRecords)
    await admin(
      "/client-scopes/" + scope.id + "/protocol-mappers/models/" + mapper.id,
      "DELETE",
    );
  await matrix(finalTokens, "read", true);
  const missingMapper = {
    web: await codeGrant(),
    cli: await oauth("ziwei-workspace-cli", {
      grant_type: "refresh_token",
      refresh_token: finalTokens.cli.refresh_token,
    }),
    worker: await machine(),
  };
  await matrix(missingMapper, "read", true);
  for (const { scope, mapper } of mapperRecords) {
    const { id: _removedId, ...body } = mapper;
    await admin(
      "/client-scopes/" + scope.id + "/protocol-mappers/models",
      "POST",
      body,
    );
  }
  await matrix(missingMapper, "read", true);
  const afterRecreate = {
    web: await codeGrant(),
    cli: await oauth("ziwei-workspace-cli", {
      grant_type: "refresh_token",
      refresh_token: missingMapper.cli.refresh_token,
    }),
    worker: await machine(),
  };
  await matrix(afterRecreate);
  passed(
    "web_cli_worker_role_mapper_models_deleted_fail_closed_and_recreated_do_not_upgrade_unsigned_role_absent_at",
  );
  stage = "cleanup";
  await store.clear(selection);
  await sleep(12000);
  fs.writeFileSync(
    f.resultFile,
    JSON.stringify({
      passed: true,
      synthetic: true,
      production: false,
      focus: "worker-roles-and-mappers",
      stage: "complete",
      checks,
      introspections,
      productCodeChanged: false,
      realClients: [
        "ziwei-workspace-web",
        "ziwei-workspace-cli",
        "ziwei-workspace-worker-fixture",
      ],
      mutationScope:
        "Disposable synthetic OP realm plus memory native DB only; no business action handler invoked",
      limitations: [
        "Browser-engine/public TLS/production binding and multi-host crash recovery remain separate; no system trust modified.",
        "CLI device grant used actual CLI; subsequent malformed mapper tokens use its real public-client refresh grant so API refusal can be tested without treating CLI rejected login as a grant.",
      ],
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "workspace_focused_real_op_failure",
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
      focus: "worker-roles-and-mappers",
      stage,
      error: {
        name: error.name,
        code: error.code || null,
        message: safe(error),
      },
      checks,
      introspections,
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
