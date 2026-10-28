import { jwtVerify } from "jose";
import { secureUrl, fail } from "./common.mjs";

const services = new Set([
  "ecosystem",
  "workspace",
  "world",
  "viral",
  "beeftv",
  "xianyu",
  "growth",
  "collaboration",
]);
const apiRoles = new Set(["access", "read", "write", "admin"]);
const exactAudience = (value, audience) =>
  value === audience ||
  (Array.isArray(value) && value.length === 1 && value[0] === audience);
const nonempty = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 512;
const scopes = (value) =>
  typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
function roleList(claims, audience) {
  const access = claims?.resource_access;
  if (
    !access ||
    !Object.hasOwn(access, audience) ||
    !Array.isArray(access[audience]?.roles) ||
    access[audience].roles.some((role) => typeof role !== "string")
  )
    return null;
  return [
    ...new Set(access[audience].roles.filter((role) => apiRoles.has(role))),
  ];
}

/** Reference server library, not an HTTP endpoint or a credentials resolver.
 * Binding and native authorization callbacks must use trusted server-side state.
 * Every verify/authorizeToken checks the real OP; authorize rechecks a prior proof.
 */
export function createSiteIdentity({
  service,
  issuer,
  jwks,
  introspect,
  resolveBinding,
  nativeAuthorize,
  machineClients = [],
  allowLoopback = false,
  now = () => Date.now(),
}) {
  if (
    !services.has(service) ||
    !jwks ||
    typeof introspect !== "function" ||
    typeof resolveBinding !== "function" ||
    typeof nativeAuthorize !== "function" ||
    !Array.isArray(machineClients)
  )
    throw new TypeError("Site identity configuration is incomplete.");
  const configuredIssuer = secureUrl(issuer, { allowLoopback }).href.replace(
    /\/$/,
    "",
  );
  if (configuredIssuer !== issuer)
    throw new TypeError(
      "Use the exact canonical OIDC issuer without a trailing slash.",
    );
  const audience = `ziwei-${service}-api`,
    humanClients = new Set([`ziwei-${service}-web`, `ziwei-${service}-cli`]),
    machines = new Map();
  for (const item of machineClients) {
    if (
      !item ||
      !nonempty(item.clientId) ||
      !item.clientId.startsWith(`ziwei-${service}-worker-`) ||
      !nonempty(item.subject) ||
      !nonempty(item.principalId) ||
      machines.has(item.clientId)
    )
      throw new TypeError(
        "Machine clients require unique explicit site/subject/principal bindings.",
      );
    machines.set(
      item.clientId,
      Object.freeze({
        clientId: item.clientId,
        subject: item.subject,
        principalId: item.principalId,
      }),
    );
  }
  const proofs = new WeakMap();
  async function bindingFor(payload) {
    let binding;
    try {
      binding = await resolveBinding({
        issuer,
        subject: payload.sub,
        site: service,
        clientId: payload.azp,
      });
    } catch {
      fail(
        "SERVICE_UNAVAILABLE",
        "Identity binding lookup is unavailable.",
        503,
      );
    }
    if (
      !binding ||
      binding.enabled !== true ||
      binding.issuer !== issuer ||
      binding.subject !== payload.sub ||
      binding.site !== service ||
      !nonempty(binding.principalId) ||
      !nonempty(binding.nativeUserId) ||
      !nonempty(binding.version) ||
      !["human", "employee"].includes(binding.kind)
    )
      fail(
        "FORBIDDEN",
        "An enabled, explicit native identity binding is required.",
        403,
      );
    const machine = machines.get(payload.azp);
    if (!machine && binding.kind === "employee" && binding.employeeClientId)
      fail(
        "FORBIDDEN",
        "Machine-bound subjects require their registered employee client.",
        403,
      );
    if (
      machine &&
      (binding.kind !== "employee" ||
        binding.employeeClientId !== machine.clientId ||
        binding.principalId !== machine.principalId)
    )
      fail(
        "FORBIDDEN",
        "Machine identity does not match its registered employee binding.",
        403,
      );
    if (
      binding.nativeTenantId !== undefined &&
      !nonempty(binding.nativeTenantId)
    )
      fail("FORBIDDEN", "Native tenant binding is invalid.", 403);
    return binding;
  }
  async function verify(token) {
    let payload;
    try {
      if (typeof token !== "string" || token.length > 16384) throw new Error();
      ({ payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
        algorithms: ["RS256"],
        requiredClaims: ["iss", "sub", "aud", "iat", "exp", "azp", "typ"],
        clockTolerance: 5,
        maxTokenAge: 305,
        currentDate: new Date(now()),
      }));
      if (
        payload.typ !== "Bearer" ||
        !nonempty(payload.sub) ||
        !nonempty(payload.azp) ||
        !exactAudience(payload.aud, audience) ||
        !Number.isInteger(payload.iat) ||
        !Number.isInteger(payload.exp) ||
        payload.exp - payload.iat > 300 ||
        payload.exp <= payload.iat
      )
        throw new Error();
      const machine = machines.get(payload.azp);
      if (
        !humanClients.has(payload.azp) &&
        (!machine || machine.subject !== payload.sub)
      )
        throw new Error();
    } catch (error) {
      if (error?.status === 503) throw error;
      fail(
        "UNAUTHENTICATED",
        "Identity signature, issuer, audience, client or lifetime was rejected.",
        401,
      );
    }
    let active;
    try {
      active = await introspect(token);
    } catch {
      fail(
        "SERVICE_UNAVAILABLE",
        "Online identity verification is unavailable.",
        503,
      );
    }
    if (
      !active ||
      active.active !== true ||
      active.token_type !== "Bearer" ||
      active.sub !== payload.sub ||
      active.client_id !== payload.azp ||
      !exactAudience(active.aud, audience) ||
      (active.iss !== undefined && active.iss !== issuer) ||
      !Number.isInteger(active.exp) ||
      active.exp !== payload.exp ||
      active.exp <= now() / 1000
    )
      fail(
        "UNAUTHENTICATED",
        "Identity is expired, revoked or inconsistent.",
        401,
      );
    const issuedRoles = roleList(payload, audience),
      currentRoles = roleList(active, audience);
    if (!issuedRoles || !currentRoles)
      fail("FORBIDDEN", "Current and issued site roles are required.", 403);
    const roles = issuedRoles.filter((role) => currentRoles.includes(role));
    if (!roles.includes("access"))
      fail("FORBIDDEN", "Access to this site has not been granted.", 403);
    const currentScopes = new Set(scopes(active.scope)),
      effectiveScopes = [...new Set(scopes(payload.scope))].filter((scope) =>
        currentScopes.has(scope),
      );
    const b = await bindingFor(payload);
    const principal = Object.freeze({
      issuer,
      subject: payload.sub,
      site: service,
      audience,
      clientId: payload.azp,
      principalId: b.principalId,
      nativeUserId: b.nativeUserId,
      ...(b.nativeTenantId ? { nativeTenantId: b.nativeTenantId } : {}),
      bindingVersion: b.version,
      kind: b.kind,
      roles: Object.freeze(roles),
      scopes: Object.freeze(effectiveScopes),
      ...(typeof payload.sid === "string" ? { sessionId: payload.sid } : {}),
      identityContractVersion: "1.0.1",
    });
    proofs.set(principal, { token });
    return principal;
  }
  async function check(principal, { permission, resource } = {}) {
    if (!["read", "write", "admin"].includes(permission))
      fail(
        "USAGE",
        "An explicit site read/write/admin permission is required.",
        400,
      );
    const scope = `${service}:${permission === "read" ? "read" : "write"}`;
    if (
      !principal.roles.includes(permission) ||
      !principal.scopes.includes(scope)
    )
      fail(
        "FORBIDDEN",
        "Current site role and requested scope do not permit this operation.",
        403,
      );
    let allowed;
    try {
      allowed = await nativeAuthorize({ principal, permission, resource });
    } catch {
      fail(
        "SERVICE_UNAVAILABLE",
        "Native resource authorization is unavailable.",
        503,
      );
    }
    if (allowed !== true)
      fail(
        "FORBIDDEN",
        "Native resource authorization denied the operation.",
        403,
      );
    return principal;
  }
  async function authorize(principal, request) {
    const proof =
      principal && typeof principal === "object" ? proofs.get(principal) : null;
    if (!proof)
      fail(
        "UNAUTHENTICATED",
        "Use an identity verified by this site instance.",
        401,
      );
    const latest = await verify(proof.token);
    for (const key of [
      "issuer",
      "subject",
      "site",
      "clientId",
      "principalId",
      "nativeUserId",
      "nativeTenantId",
      "bindingVersion",
      "kind",
    ])
      if (latest[key] !== principal[key])
        fail(
          "FORBIDDEN",
          "Native identity binding changed; re-authenticate before this operation.",
          403,
        );
    return check(latest, request);
  }
  return Object.freeze({
    verify,
    authorize,
    authorizeToken: async (token, request) =>
      check(await verify(token), request),
  });
}
