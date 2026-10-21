# Workspace CLI v1 Implementation Plan

> Execute with subagent-driven-development; root coordinates and independently reviews. The approved source of requirements is `D:/AINavtie/CLI-STANDARD.md` v1.2.0, machine contract v1.

**Goal:** Deliver an independently installable driving-cockpit CLI, preserving existing ziwei_user/MCP/Control boundaries, and anonymous HTTP-readable AI documentation.

**Architecture:** New zero-runtime-dependency Node package `packages/workspace-cli` with binary `ziwei-workspace`, default v1 envelope. Reuse the existing management MCP schemas and native HTTP mappings; preserve all existing scripts. Explicit legacy human sessions and managed credentials remain migration-compatible. Unified SSO verification/binding/grants are separately pending until the coordinator fixes the common identity contract.

**Tech Stack:** Node builtins, node:test, deterministic npm pack, existing Express route registration for documentation only.

## Baseline and constraints

- Clean managed worktree at `C:/Users/25941/.codex/worktrees/workspace-cli-contract-v1/灵光爸爸拆解`, branch `codex/workspace-cli-contract-v1`, base `b8c8a669e0fb18623166628bd3e1088dfb133249`. Remote was read back before fetching this fixed SHA. It is newer than the handed-off e950e474; no claim that it matches mixed production.
- Old root f88d6f8 and detached staging dd9bc04 are untouched. No checkout/reset of old directories.
- No production deployment, credentials inspection, daemon startup, devices, paid generation, account migration, or external messages. Tests use injected transports/in-memory domain fixtures. Any actual loopback HTTP docs probe must first follow local port registry and durable diagnostics requirements.
- Root CLI `ziwei_user` remains computer client; Control `ziwei` remains separate. New package is not a renamed phone CLI or a universal cross-site client.

## Task 1: Independent CLI implementation and tests

Owned files: `packages/workspace-cli/**`; no existing source mutations without coordination.

1. Inspect current MCP definitions/routes, auth and management/native response shapes; record supported/unsupported native routes and precise side effects.
2. Write meaningful failing node:test cases for parse/input conflicts, JSON envelopes/errors, bounded no-auth failure, per-site/profile/account/purpose secrets separation, redaction, native/managed auth, real native states, timeout submit count and cancellation.
3. Implement public option extraction before/after commands; CLI name/version/help/docs link, strict unknown args and timeout/profile validation. New independent command defaults v1 and accepts explicit `--contract v1`. Preserve all previous entrypoints unchanged.
4. Implement mutually exclusive JSON input sources and schema validation against reused native schemas; reject field collisions, unsafe numeric IDs and secret-bearing generic input before transport. Never coerce string IDs or decimal strings to numbers.
5. Implement credential store and auth login/status/logout with explicit transport/mode, server/local verification and legacy/unified provenance; never implicitly discover real tokens or default to static owner. Unified mode returns precise not-supported/pending until trusted identity contract exists. Keep station/origin/profile/account/purpose slots isolated.
6. Expose a registry of actual workspace operations for capabilities, CLI dispatch and docs. Preserve route/HTTP failure/native code. Advertise side effects, exact schemas, real idempotency and result queries. Commands may use legacy managed MCP API but do not launch stdio MCP for each call.
7. No write retry. Distinguish dispatched mutation transport loss (OUTCOME_UNKNOWN), readonly unavailable, synchronous accepted entities, asynchronous accepted/running/terminal states, wait timeout and supported cancellation boundaries. Do not fabricate server receipt IDs.
8. Run isolated CLI tests and inspect outputs. Build standalone package from repository sources without requiring other sites, the daemon or global configuration. Build must be reproducible and not include state/secrets.

## Task 2: Anonymous docs routes and generated content

Owned files: `backend/workspace-cli-docs.mjs`, minimal registration in `backend/app.mjs`, `docs/public/workspace-cli/**`, CLI docs generator/tests under package, docs compatibility notes. Coordinate registry exports with task 1.

1. Verify no existing `/docs` or `/mcp-docs` route will be overwritten; add exact `/docs`, `/docs/cli.md`, `/llms.txt` routes outside auth guards, no wildcard fake-200.
2. Generate public UTF-8 content from actual CLI capabilities/registry. Include positioning, package availability (local artifact, not public npm), install/update/uninstall/version checks, auth/SSO pending, schemas/examples, public flags, envelope/error table, async/no-replay/reconciliation, exact MCP details and document/version/update metadata.
3. Keep target absolute links at `https://ziwei.qzelynth.top`; no real accounts/private employee records/secrets/internal installation directories in public docs.
4. Test handler body/status/content types/links and catalog completeness with in-memory responses; perform registered isolated HTTP probe later, recording local HTTP separately from public deployment.

## Task 3: Independent reviews, package/install acceptance

1. Spec reviewer compares implementation with v1.2.0 C01-C14 and original behavior; fix substantive findings and re-review.
2. Quality/security reviewer checks route/auth semantics, secret redaction, credential boundaries, timeout/idempotency/cancellation and packaging closure. Fix/review findings before success claims.
3. Run scoped existing offline CLI and management authorization domain tests without starting listeners or production services; preserve original MCP/schemas and update `docs/FEATURE_MAP.md` with real paths.
4. Pack twice and compare artifact SHA; install into fresh temporary prefix/home, invoke installed bin for help/version/capabilities/no-auth failure; uninstall same prefix and confirm removal. Save raw stdout/stderr/exit status and test summaries in local evidence.
5. Commit source/docs changes on isolated branch. Record source commit and package SHA separately. Do not deploy or claim public docs/SSO ready.

## Task 4: Receipt

Write only `D:/AINavtie/ops/cli-standard/receipts/workspace.json` using latest template. Record C01-C14 individually with evidence, supported/pending/N/A boundaries, compatibility mapping, package/install status, identity pending and public docs pending. No edits to main standard or other service receipts. Final reply is self-contained; cross-thread messaging is unnecessary.
