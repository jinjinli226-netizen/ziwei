# Default Management MCP Implementation Plan

> Execute the user-authorized implementation in the current release worktree, with independent backend, daemon/runtime, and frontend changes reviewed together.

**Goal:** Existing and new workspaces and employees use management MCP automatically through their already authenticated workspace computer connection, without separate MCP authorization or private-file editing.

**Architecture:** The server derives a short-lived, management-only, single-workspace credential from a valid paired device identity. Each daemon connection acquires and renews its own private credential; employee execution prepares the same connection before native stdio injection. Workspace/member isolation and phone execution capabilities remain separate; no wildcard bearer or browser-visible credential is introduced.

**Tech Stack:** Existing Node/Express/SQLite backend, ziwei_user daemon, native Codex/Hermes adapters, Vue frontend, Node tests and isolated/real Playwright browser acceptance.

## Accepted product scope and alternatives

The user's explicit implementation and deployment request provides the product decision: default platform management access for all workspace employees and ordinary members, without extra authorization steps. Requiring per-employee toggles or widening one static global bearer would retain the product gap or remove workspace isolation. Use device-derived credentials instead, keeping legacy explicit static bearers compatible and exactly scoped.

## Backend contract

- `POST /api/workspaces/:slug/mcp/bootstrap` accepts only the current connection's device credential, even on auth-disabled test servers. Return `{token,workspace,deviceId,credentialId,expiresAt,apiBase,audience:'ziwei-management',managed:true}` with no-store. The server derives all identity/scope from its credential row, ignores caller role/scope, and rejects anonymous/cookie/API-key/global-A2A/phone-capability substitutes.
- Management credentials use a separate signed audience and expiry; every management request checks current device/credential/workspace validity and revocation. A cap for workspace A cannot call workspace B. Do not pass device credentials to model subprocesses.
- Workspace `/mcp/status` reports default policy, service availability, safe per-device automatic preparation states and actual employee execution receipts separately. Neither API health nor credential acquisition claims actual tool loading.
- Safe preparation state is `{configured,managed:true,state,workspace,transport:'stdio',supportedRuntimes,reasonCode?,reason?,expiresAt?}`. States: pending/ready/failed/client_required. Browser retry requests a connection refresh for the next heartbeat, rather than creating employee tasks or issuing credentials to the browser.
- Migrate existing employees to effective management-enabled, default new employees on, and include management in new and recovered execution payloads. Saving a valid employee may precede automatic preparation; missing CLI/auth/provider/explicit profile still reports its own failure.
- Keep ordinary browser `/api` member/Owner permissions, personal resource checks and phone/cross-workspace connection ownership intact. Management service context is confined to its authenticated workspace.

## Task 1: Backend identity and default data

Files: `backend/management-bootstrap.mjs`, `backend/mcp-auth.mjs`, `backend/app.mjs`, `backend/management.mjs`; `backend/db.mjs`, `backend/repository.mjs` and focused tests.

Write and run RED tests for unauthenticated bootstrap, cross-workspace misuse, expiry/revocation/audience, forged role/scope and default new/existing employee payloads. Implement credential signing and current identity validation before integrating routes and state. Validate no phone capability or browser credential gains management identity.

## Task 2: Automatic client and native runtime injection

Files: `daemon/ziwei_user.mjs`, `daemon/config.mjs`, `src/management-bootstrap.mjs`, `src/local-action.mjs`, `src/runtime-adapters.mjs`, `scripts/ziwei-mcp.mjs`, native setup/start/connect scripts and focused tests.

Use each connection's own origin/workspace/device identity for private cache paths, bootstrap, renewal and recovery. Never reuse the primary identity for a shared connection. Management failure must not stop ordinary device heartbeats. Run bootstrap again at execution when necessary, fail truthfully if unavailable, and restore defaults on older employee actions.

Hermes uses an execution overlay of the selected profile, preserving original provider/auth/persona and explicit profile, including default; do not modify the user's base profile. Clear stale same-name Codex MCP server env precedence. Preserve device identities, workdir, shared connections, port 20242 and persistent diagnostics. Upgrade through the original package/start entry and verify the new running code.

## Task 3: Default-access UI and browser evidence

Files: `frontend/src/App.vue`, `frontend/src/api.js`, `frontend/src/management-mcp.js`, `frontend/src/components/ManagementMcpPanel.vue`, relevant styles, frontend tests and browser scripts.

Replace MCP authorization switches/manual bearer instructions with automatic preparation status, concrete failure reasons, retry and native-client update entry. Do not change employee runtime/profile/phone configuration when opening or refreshing. Add request generation/explicit workspace guards and distinguish failed tool calls from successful receipts. Maintain the recently fixed modal scrolling and native phone/skill checkbox behavior.

Cover new workspace and employee without manual authorization, old false/null employees, preparation/failure/recovery/reload, workspace switching, loaded versus called versus all-failed, and 1440×900/390×844/720×450 layouts. Regress invitation, phone configuration, team layout and installation entry.

## Task 4: Real release and acceptance

Start from Git d5459b3 and verify production f790f09 before any release. Back up both SQLite databases and private/system configuration. Preserve Nginx phone MCP route, cached hash resources, data, Android downloads and control release. Stage and scan only intended files; push before deployment.

Upgrade the actual global Windows package through the existing native entry, retain the primary test_222 and shared phone_ai identities, and verify recovery/heartbeats/diagnostic logs. In isolated QA workspace/resources, prove automatic configuration from a fresh connection and real Codex/Hermes stdio initialize/tools/list, runtime discovery and successful employee creation calls; read back server receipts. Do not consume real invitations or execute phone actions. Clean only QA resources and short-term credentials, then verify real domain/browser/client again.

Update PROJECT_MANAGEMENT/HANDOFF/README and user operation guidance with exact deployed Git/asset/client versions, safe evidence, rollback and any real limitations. The cancelled Mac/Codex detection task stays cancelled.
