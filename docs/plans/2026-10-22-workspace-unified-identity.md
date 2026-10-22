# Workspace Unified Identity Implementation Plan

> Execute with subagent-driven-development and independent spec/security review. Requirements: CLI-STANDARD 1.3.0, identity contract 1.0.1, native cleanup contract/schema supplied by the coordinating owner. This is preparation, not a production cutover.

**Goal:** Implement per-site unified identity for workspace API/BFF/independent CLI, preserve explicit native resource authorization, and prepare defensible non-destructive account/data migration evidence.

**Architecture:** Default legacy preparation mode preserves the running deployment. Explicit `ZIWEI_IDENTITY_MODE=unified` activates fail-closed RS256 + online introspection, explicit issuer/subject bindings, site role/scope intersection and native resource checks. A code/PKCE BFF stores secrets server-side; the independent CLI uses its own public device client and protected isolated credentials. Cleanup tooling is read-only and separates source probe, proposed manifest, independent baseline validation and synthetic backup/restore tests.

**Tech Stack:** Existing Node 24 / Express / SQLite / Vue; common verifier contract vendored with source hash and local imports; jose for protocol signature verification; node:test synthetic RSA, injected OP transport and temporary databases.

## Source baseline

- Preserved prior CLI commit `9727612fc4cc0e3f351c8f70c10227295bb71cc4`.
- Read back and fetched remote main fixed SHA `543e81d344fa0337328b088134cf742128c1d43d`; merged its client-recovery changes in this clean isolated worktree.
- Integration baseline `19876c0f006af18c9fe3b6ef4a7d9e94c75c14c6`, branch `codex/workspace-unified-identity`.
- No claim that Git main equals mixed production. Old checkout/staging, production 154/186, device pairings and business data remain unchanged.

## Task 1 — API, native bindings and BFF

Owner: workspace_identity_api. Files: `backend/identity/**`, minimal `backend/app.mjs` / `backend/auth.mjs`, necessary root dependency lock and minimal frontend identity entrypoints; new isolated tests.

1. Vendor the fixed reference verifier with provenance and local imports. Require trusted issuer, exact `ziwei-workspace-api` audience/API introspection client and allowed web/CLI/registered employee clients. No guessed production issuer/secrets.
2. Verify RS256, issuer/subject/lifetime/audience/azp/AT token type and online active/introspection subject-client-audience consistency on every request. Reject malformed/missing roles and scopes; use signed/current intersection, explicit read/write/admin, then original workspace/resource/device/employee checks.
3. Bind issuer+subject to original stable user/employee and explicit workspace scope in server state; no email auto-merge or identity supplied through request business fields. Keep employee machine clients single-site/single-employee.
4. Add public sanitized config, code+PKCE/state/nonce BFF login/callback, verified me, per-site logout and signed replay-protected backchannel. Encrypt stored tokens; host-only Secure HttpOnly Cookie. Refresh/logout generations prevent resurrection and late tokens are revoked.
5. In explicit unified mode reject legacy password/setup/register/native cookies/static MCP human credentials. Preserve separate A2A/computer/control identities only on their original exact protocol paths. Do not permit a bypass through old endpoints or memory-mode test shortcuts.
6. Every authorized request must be rechecked. Long-lived WS/SSE paths must either implement renewed checks or explicitly reject in unified mode, documenting the temporary capability boundary.
7. Use offline synthetic RSA/fake OP/in-memory DB tests for positive and negative paths; no listener until root arranges an isolated registered protocol probe if necessary.

## Task 2 — Independent CLI identity

Owner: workspace_identity_cli. Files: `packages/workspace-cli/**` only.

1. Release new major 2.0.0 for default unified auth behavior, preserving machine contract v1 and existing workspace operations.
2. Resolve trusted per-site config and OP metadata; use only public `ziwei-workspace-cli` device grant. Default scopes openid/workspace:read/workspace:write, no offline_access. Never embed API/web secrets.
3. Auth login/complete/wait/refresh/status/logout truthfully represent pending/active/expired/unknown. Non-interactive never opens a browser or waits for user input; polling bounded and protocol interval respected.
4. Tokens/device codes only in protected per-site/origin/profile/account/purpose state, never stdout. Cross-process CAS/leases protect refresh and logout. Discarded late refresh/complete tokens must be revoked without resurrecting a cleared credential slot.
5. Unified business requests use current Bearer AT and server validation. Explicit old native/managed syntax only works against a server declaring legacy mode; unified mode must not fall back to old credentials.
6. Use injected network and temporary store tests; preserve one-write dispatch/timeout/cancellation and strict input semantics.

## Task 3 — Cleanup preparation

Owner: workspace_ai_docs_implementer (reassigned cleanup). Files: `backend/identity-cleanup/**`, `scripts/workspace-identity-cleanup.mjs`, new scoped tests and private-operation documentation.

1. Read actual schema/FK/ownership relationships and cover every table, including shared/mixed/unowned dependencies and object storage. Do not infer ownership solely from workspace creator.
2. Native SQLite probe uses read-only open, query_only and a consistent read transaction; safe IDs/ownership/counts/schema only, no real credential fields or content.
3. Keep source probe independent from proposed manifest; reuse common schema and pure validator with recorded hashes. Production readiness requires independently verified authoritative source fingerprint, not a locally authored self-certification.
4. Preserve designated administrator and verified owned assets, stage removal only of other confirmed website accounts and their confirmed exclusive data; ambiguous/global/shared/mixed remain pending. Do not delete computer pairing or central subjects/other-site grants. Central retain set includes all verified collaboration users.
5. Dry-run never mutates. Backup/restore tests operate only on explicitly synthetic temporary DBs, with private backup paths/retention/fingerprints and assertions that business restoration cannot re-enable old login credentials.
6. Known local databases are historical candidates, not current production. Report actual stable IDs only in protected local evidence, never public docs/Git. If current source is unavailable, finish tooling/tests and leave exact source/backup/manifest production gates pending.

## Task 4 — Integration, reviews and delivery

Root coordinates; no overlapping owner edits.

1. Review spec compliance and security with fresh reviewers; fix critical/important findings and rerun regressions. Use native authorization tests and original CLI tests appropriate to touched paths without starting device/model work.
2. Refresh generated AI docs from actual CLI version/registry; show configured-but-not-deployed identity and production migration prerequisites precisely.
3. Build deterministic independent package twice, install/uninstall a temporary prefix with empty config. Record local artifact vs existing HTTPS distribution separately; do not publish new download code or infer remote installation verification.
4. Produce sanitized source QA/rollback/runbook and a deployable commit on isolated branch. No production login cutover, cleanup, DNS, 154 access, client update or paid/device/message work.
5. Write new identity receipt only to `D:/AINavtie/ops/cli-standard/identity-readiness/workspace.json`, preserving the previous CLI receipt. Include C13/C15/C16, source/clients/config, exact tests, local source limitations, cleanup manifest/dry-run/backup evidence and remaining centralized OP/production gates. Do not call incomplete native-source acceptance complete.
