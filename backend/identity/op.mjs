import { createLocalJWKSet, jwtVerify } from "jose";
import { fail, secureUrl } from "./common.mjs";
export function createOpAdapter(
  config,
  { fetch = globalThis.fetch, now = () => Date.now() } = {},
) {
  let metadataFlight, jwksFlight;
  async function request(url, options = {}) {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) throw new Error();
      return response;
    } catch {
      fail(
        "SERVICE_UNAVAILABLE",
        "Unified identity provider is unavailable.",
        503,
      );
    }
  }
  async function json(response) {
    try {
      return await response.json();
    } catch {
      fail(
        "SERVICE_UNAVAILABLE",
        "Identity provider response was rejected.",
        503,
      );
    }
  }
  async function metadata() {
    if (!metadataFlight)
      metadataFlight = (async () => {
        const d = await json(
          await request(config.issuer + "/.well-known/openid-configuration"),
        );
        if (d.issuer !== config.issuer)
          fail(
            "SERVICE_UNAVAILABLE",
            "Identity discovery issuer was rejected.",
            503,
          );
        for (const field of [
          "authorization_endpoint",
          "token_endpoint",
          "jwks_uri",
          "introspection_endpoint",
          "revocation_endpoint",
        ]) {
          const u = secureUrl(d[field], config);
          if (
            u.origin !== new URL(config.issuer).origin ||
            !u.pathname.startsWith(new URL(config.issuer).pathname + "/")
          )
            fail(
              "SERVICE_UNAVAILABLE",
              "Identity discovery endpoint was rejected.",
              503,
            );
        }
        return d;
      })().catch((error) => {
        metadataFlight = null;
        throw error;
      });
    return metadataFlight;
  }
  async function jwks(header, token) {
    if (!jwksFlight)
      jwksFlight = (async () =>
        createLocalJWKSet(
          await json(await request((await metadata()).jwks_uri)),
        ))().catch((error) => {
        jwksFlight = null;
        throw error;
      });
    let key = await jwksFlight;
    try {
      return await key(header, token);
    } catch (error) {
      if (error.code !== "ERR_JWKS_NO_MATCHING_KEY") throw error;
      jwksFlight = null;
      key = await (async () => {
        jwksFlight = (async () =>
          createLocalJWKSet(
            await json(await request((await metadata()).jwks_uri)),
          ))().catch((error) => {
          jwksFlight = null;
          throw error;
        });
        return jwksFlight;
      })();
      return key(header, token);
    }
  }
  const basic = (id, secret) =>
    "Basic " +
    Buffer.from(
      `${encodeURIComponent(id)}:${encodeURIComponent(secret)}`,
    ).toString("base64");
  async function post(endpoint, body, client = "web") {
    const d = await metadata(),
      id = client === "api" ? config.apiClientId : config.webClientId,
      secret = client === "api" ? config.apiSecret : config.webSecret;
    return request(d[endpoint], {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: basic(id, secret),
      },
      body: new URLSearchParams(body).toString(),
    });
  }
  return {
    metadata,
    jwks,
    introspect: async (token) =>
      json(await post("introspection_endpoint", { token }, "api")),
    exchange: async (body) => json(await post("token_endpoint", body)),
    async revoke(tokens) {
      let success = true;
      for (const [key, hint] of [
        ["refresh_token", "refresh_token"],
        ["access_token", "access_token"],
      ])
        if (tokens?.[key])
          try {
            await post("revocation_endpoint", {
              token: tokens[key],
              token_type_hint: hint,
            });
          } catch {
            success = false;
          }
      return success;
    },
    async verifyId(token, { nonce, subject } = {}) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.webClientId,
          algorithms: ["RS256"],
          requiredClaims: ["iss", "sub", "aud", "iat", "exp"],
          clockTolerance: 5,
          currentDate: new Date(now()),
        });
        if (
          (payload.aud !== config.webClientId &&
            !(
              Array.isArray(payload.aud) &&
              payload.aud.length === 1 &&
              payload.aud[0] === config.webClientId
            )) ||
          (payload.azp && payload.azp !== config.webClientId) ||
          (nonce !== undefined && payload.nonce !== nonce) ||
          (subject && payload.sub !== subject) ||
          typeof payload.sub !== "string" ||
          !payload.sub ||
          !Number.isInteger(payload.iat) ||
          !Number.isInteger(payload.exp) ||
          payload.iat > now() / 1000 + 5
        )
          throw new Error();
        return payload;
      } catch {
        fail("UNAUTHENTICATED", "OIDC ID token was rejected.", 401);
      }
    },
  };
}
