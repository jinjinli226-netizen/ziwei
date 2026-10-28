import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const load = async () =>
  import("./index.mjs").catch(() => ({
    createUnifiedIdentity: () => {
      throw new Error("Unified identity implementation missing");
    },
  }));
const issuer = "https://identity.test/realms/ziwei",
  origin = "https://ziwei.test",
  aud = "ziwei-workspace-api";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-rsa",
  alg: "RS256",
  use: "sig",
};
const now = () => Date.now();
function token(claims = {}, type = "Bearer") {
  const time = Math.floor(now() / 1000);
  const payload = {
    iss: issuer,
    sub: "person",
    aud,
    azp: "ziwei-workspace-cli",
    iat: time,
    exp: time + 300,
    typ: type,
    scope: "openid workspace:read workspace:write",
    resource_access: { [aud]: { roles: ["access", "read", "write", "admin"] } },
    ...claims,
  };
  const data = [{ alg: "RS256", kid: "test-rsa", typ: "JWT" }, payload]
    .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
    .join(".");
  return {
    raw: `${data}.${crypto.sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`,
    payload,
  };
}
function dbFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE local_users(id TEXT PRIMARY KEY,email TEXT,name TEXT,created_at TEXT,last_login_at TEXT);CREATE TABLE workspaces(id TEXT PRIMARY KEY,slug TEXT,name TEXT,kind TEXT,timezone TEXT);CREATE TABLE members(id TEXT,user_id TEXT,workspace_id TEXT,name TEXT,email TEXT,role TEXT,avatar TEXT,joined_at TEXT);CREATE TABLE employees(id TEXT PRIMARY KEY,workspace_id TEXT,owner_user_id TEXT,target_device_id TEXT,visibility TEXT);INSERT INTO local_users VALUES('u1','owner@example.test','Owner','now',NULL);INSERT INTO workspaces VALUES('w1','one','One','team','UTC');INSERT INTO workspaces VALUES('w2','two','Two','team','UTC');INSERT INTO members VALUES('m1','u1','w1','Owner','owner@example.test','owner',NULL,'now');INSERT INTO employees VALUES('e1','w1','u1','d1','private');`,
  );
  return db;
}
async function fixture(overrides = {}) {
  const { createUnifiedIdentity } = await load();
  const db = dbFixture();
  let current = null,
    calls = [];
  const env = {
    ZIWEI_IDENTITY_MODE: "unified",
    ZIWEI_IDENTITY_ISSUER: issuer,
    ZIWEI_IDENTITY_ORIGIN: origin,
    ZIWEI_IDENTITY_API_SECRET: "test-api-secret",
    ZIWEI_IDENTITY_WEB_SECRET: "test-web-secret",
    ZIWEI_IDENTITY_SESSION_KEY: crypto.randomBytes(32).toString("base64url"),
  };
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer,
        authorization_endpoint: issuer + "/auth",
        token_endpoint: issuer + "/token",
        jwks_uri: issuer + "/jwks",
        introspection_endpoint: issuer + "/introspect",
        revocation_endpoint: issuer + "/revoke",
      });
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/introspect")) return Response.json(current);
    if (url.endsWith("/revoke")) return new Response("", { status: 200 });
    throw new Error("Unexpected endpoint");
  };
  const identity = createUnifiedIdentity({ db, env, fetch, ...overrides });
  identity.bindings.bind({
    issuer,
    subject: "person",
    nativeUserId: "u1",
    workspaceIds: ["w1"],
  });
  return {
    db,
    identity,
    env,
    calls,
    fetch,
    setCurrent: (p) => (current = p ? { token_type: "Bearer", ...p } : p),
  };
}
const request = (
  raw,
  path = "/api/workspaces/one/tasks",
  method = "GET",
  headers = {},
) => ({
  method,
  originalUrl: path,
  url: path,
  path,
  headers: { ...(raw ? { authorization: `Bearer ${raw}` } : {}), ...headers },
  body: {},
  params: {},
});
async function authorize(f, t, path, method) {
  f.setCurrent({ active: true, ...t.payload, client_id: t.payload.azp });
  return f.identity.authorizeRequest(request(t.raw, path, method));
}
export {
  authorize,
  fixture,
  token,
  request,
  issuer,
  origin,
  aud,
  privateKey,
  jwk,
};
