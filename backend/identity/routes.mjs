import express from "express";
import {createNativeProvisioningRuntime} from "../member-provisioning/runtime.mjs";
import { createUnifiedIdentity } from "./index.mjs";
import { createIdentitySessions } from "./sessions.mjs";
import { fail } from "./common.mjs";
import { identityRoutePath } from "./route-path.mjs";
import {installControlIdentityBridge} from './control-bridge.mjs';
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch(next);
const machineRequest = (req) =>
  req.method === "POST" &&
  (/^\/api\/(?:daemon\/heartbeat|devices\/heartbeat)$/i.test(
    identityRoutePath(req),
  ) ||
    /^\/api\/workspaces\/[^/]+\/(?:heartbeat|devices\/[^/]+\/heartbeat|runtimes\/register)$/i.test(
      identityRoutePath(req),
    ));
export function installUnifiedIdentity(app, db, options = {}) {
  const identity = createUnifiedIdentity({ db, ...options });
  app.locals.identity = identity;
  app.get("/api/identity/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(
      identity
        ? identity.publicConfig()
        : {
            mode: "legacy",
            service: "workspace",
            issuer: null,
            audience: "ziwei-workspace-api",
            cliClientId: "ziwei-workspace-cli",
            scopes: ["openid", "workspace:read", "workspace:write"],
            ready: false,
            legacyAllowed: true,
            enabledByDefault: false,
            identityContractVersion: "1.0.1",
            cliTransports: ["native", "mcp"],
          },
    );
  });
  if (!identity) return null;
  const memberProvisioning=createNativeProvisioningRuntime({site:"workspace",db,identityConfig:identity.config,env:options.env??process.env,fetch:options.fetch});
  app.use((req,res,next)=>{memberProvisioning.handler(req,res).then(handled=>{if(!handled)next();},next);});
  const sessions = createIdentitySessions(db, identity, options);
  identity.attachSessions(sessions);
  installControlIdentityBridge(app,identity,options);
  app.use(["/api/identity", "/api/auth"], (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  const me = async (req, res) => res.json(await identity.authorizeRequest(req));
  app.get("/api/identity/me", asyncRoute(me));
  app.get("/api/auth/me", asyncRoute(me));
  app.get(
    "/api/auth/status",
    asyncRoute(async (req, res) => {
      let principal = null;
      try {
        principal = await identity.authorizeRequest(req);
      } catch (error) {
        if (error.status !== 401 && error.status !== 403) throw error;
      }
      res.json({
        setup_required: false,
        authenticated: Boolean(principal),
        user: principal?.user || null,
        memberships: principal?.memberships || [],
        identity_mode: "unified",
        login_url: "/api/identity/login",
        ...(principal
          ? {
              identity: principal.identity,
              verification: "server",
              verified: true,
            }
          : {}),
      });
    }),
  );
  app.get(
    "/api/identity/login",
    asyncRoute(async (req, res) => {
      const result = await sessions.begin(req);
      res.setHeader("Set-Cookie", result.cookie);
      res.redirect(302, result.location);
    }),
  );
  app.get(
    "/api/identity/callback",
    asyncRoute(async (req, res) => {
      const result = await sessions.callback(req);
      res.setHeader("Set-Cookie", [result.cookie, result.clearTransaction]);
      res.redirect(303, result.location);
    }),
  );
  const logout = async (req, res) => {
    const { cookie, ...result } = await sessions.logout(req);
    res.setHeader("Set-Cookie", cookie);
    res.json(result);
  };
  app.post("/api/identity/logout", asyncRoute(logout));
  app.post("/api/auth/logout", asyncRoute(logout));
  app.post(
    "/api/identity/backchannel-logout",
    express.urlencoded({ extended: false, limit: "20kb" }),
    asyncRoute(async (req, res) =>
      res.json(await sessions.backchannel(req.body?.logout_token)),
    ),
  );
  app.use("/api/auth", (_req, _res, next) =>
    next(
      Object.assign(
        new Error(
          "Legacy passwords, registration, tokens and sessions are disabled in unified identity mode.",
        ),
        { status: 403, code: "LEGACY_AUTH_DISABLED" },
      ),
    ),
  );

  // Express middleware continues only after asynchronous verification finishes.
  const apiGuard = (req, res, next) => {
    if (machineRequest(req)) return next();
    identity.authorizeRequest(req).then((principal) => {
      req.auth = principal;
      next();
    }, next);
  };
  const mcpGuard = (req, res, next) =>
    identity
      .authorizeRequest(req)
      .then((principal) => {
        req.auth = principal;
        const slug = req.params.slug || principal.memberships[0]?.slug;
        const membership = principal.memberships.find((m) => m.slug === slug);
        if (!membership)
          fail("FORBIDDEN", "Native workspace membership is required.", 403);
        req.mcpCredential = {
          actorUserId: principal.user_id,
          actorRole: membership.role,
          workspaces: [slug],
          workspace: slug,
          enforceEmployeeVisibility: true,
          enforceDeviceOwnership: true,
        };
        next();
      })
      .catch(next);
  return { ...identity, sessions, apiGuard, mcpGuard };
}
