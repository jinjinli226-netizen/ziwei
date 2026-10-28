import { readConfig, fail } from "./common.mjs";
import { createBindingStore } from "./bindings.mjs";
import { createOpAdapter } from "./op.mjs";
import { createSiteIdentity } from "./verifier.mjs";
import { createNativeAuthorization, requiredPermission } from "./native.mjs";
import {assertUnifiedFloor} from './floor.mjs';
export function createUnifiedIdentity({
  db,
  env = process.env,
  fetch,
  now = () => Date.now(),
  allowLoopback = false,
} = {}) {
  assertUnifiedFloor(db,env);
  const config = readConfig(env, { allowLoopback });
  if (!config) return null;
  const bindings = createBindingStore(db),
    op = createOpAdapter(config, { fetch, now }),
    native = createNativeAuthorization(db, bindings);
  const verifier = () =>
    createSiteIdentity({
      service: "workspace",
      issuer: config.issuer,
      jwks: op.jwks,
      introspect: op.introspect,
      resolveBinding: ({ issuer, subject }) => bindings.get(issuer, subject),
      nativeAuthorize: native.native,
      machineClients: bindings.machines(),
      androidClientId: config.androidClientId,
      allowLoopback,
      now,
    });
  let sessions;
  async function authorizeRequest(req) {
    let token;
    const auth = String(req.headers?.authorization || "");
    if (auth) {
      if (!/^Bearer [^\s]+$/i.test(auth))
        fail("UNAUTHENTICATED", "A site access token is required.", 401);
      token = auth.slice(7);
    } else token = await sessions?.accessToken(req);
    if (!token) fail("UNAUTHENTICATED", "Unified sign-in is required.", 401);
    const principal = await verifier().authorizeToken(token, {
      permission: requiredPermission(req),
      resource: req,
    });
    return native.view(principal, req);
  }
  return {
    config,
    bindings,
    op,
    verifier,
    authorizeRequest,
    attachSessions: (value) => (sessions = value),
    publicConfig: () => ({
      mode: "unified",
      service: "workspace",
      issuer: config.issuer,
      audience: config.audience,
      apiClientId: config.apiClientId,
      webClientId: config.webClientId,
      cliClientId: config.cliClientId,
      ...(config.androidClientId ? { androidClientId: config.androidClientId } : {}),
      scopes: ["openid", "workspace:read", "workspace:write"],
      ready: true,
      legacyAllowed: false,
      enabledByDefault: false,
      identityContractVersion: "1.0.1",
      cliTransports: ["native", "mcp"],
    }),
  };
}
