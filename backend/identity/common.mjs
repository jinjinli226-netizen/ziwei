import crypto from "node:crypto";
export function fail(code, message, status = 401) {
  throw Object.assign(new Error(message), { code, status });
}
export function secureUrl(value, { allowLoopback = false } = {}) {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail(
      "IDENTITY_CONFIGURATION",
      "Unified identity configuration is incomplete.",
      503,
    );
  }
  if (
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    !(
      u.protocol === "https:" ||
      (allowLoopback &&
        u.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(u.hostname))
    )
  )
    fail(
      "IDENTITY_CONFIGURATION",
      "Unified identity configuration requires a trusted HTTPS URL.",
      503,
    );
  return u;
}
export const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
export const random = () => crypto.randomBytes(32).toString("base64url");
export function readConfig(env = process.env, { allowLoopback = false } = {}) {
  if ((env.ZIWEI_IDENTITY_MODE || "legacy") === "legacy") return null;
  if (env.ZIWEI_IDENTITY_MODE !== "unified")
    fail(
      "IDENTITY_CONFIGURATION",
      "Unknown identity mode in server configuration.",
      503,
    );
  const issuer = secureUrl(env.ZIWEI_IDENTITY_ISSUER, {
    allowLoopback,
  }).href.replace(/\/$/, "");
  const site = secureUrl(
    env.ZIWEI_IDENTITY_ORIGIN || "https://ziwei.qzelynth.top",
    { allowLoopback },
  );
  const key = Buffer.from(env.ZIWEI_IDENTITY_SESSION_KEY || "", "base64url");
  if (
    issuer !== env.ZIWEI_IDENTITY_ISSUER ||
    site.pathname !== "/" ||
    !env.ZIWEI_IDENTITY_API_SECRET ||
    !env.ZIWEI_IDENTITY_WEB_SECRET ||
    key.length !== 32
  )
    fail(
      "IDENTITY_CONFIGURATION",
      "Unified identity configuration requires exact issuer, client secrets and a 32-byte session key.",
      503,
    );
  return Object.freeze({
    issuer,
    origin: site.origin,
    audience: "ziwei-workspace-api",
    apiClientId: "ziwei-workspace-api",
    webClientId: "ziwei-workspace-web",
    cliClientId: "ziwei-workspace-cli",
    apiSecret: env.ZIWEI_IDENTITY_API_SECRET,
    webSecret: env.ZIWEI_IDENTITY_WEB_SECRET,
    key,
    allowLoopback,
    timeoutMs: 5000,
  });
}
export function cookie(name, value, maxAge = 3600) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}
export function cookieValue(req, name) {
  const pair = String(req.headers?.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="));
  try {
    return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}
export function sameOrigin(req, config) {
  if (
    req.headers?.origin !== config.origin ||
    req.headers?.["sec-fetch-site"] === "cross-site"
  )
    fail("FORBIDDEN", "A same-origin request is required.", 403);
}
export function seal(key, value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function unseal(key, value) {
  try {
    const data = Buffer.from(value, "base64url"),
      decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        data.subarray(0, 12),
      );
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    fail("UNAUTHENTICATED", "Identity session is unavailable.", 401);
  }
}
