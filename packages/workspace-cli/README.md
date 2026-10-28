# @ziwei/workspace-cli 2.0.0

`ziwei-workspace` is the independently installable CLI for the Ziwei digital employee workspace. It uses only Node builtins and fetch, requires Node 20.11 or later, and does not install or run a computer daemon, Control phone CLI, shared cross-site CLI or local server. The original `ziwei_user` and management MCP remain unchanged. This is a new business CLI with default machine contract v1; there is no previous workspace CLI contract to emulate.

Public documentation: <https://ziwei.qzelynth.top/docs>. Standard version 1.3.0; identity contract 1.0.1; CLI/document version 2.0.0 (2026-10-22). Unified identity is implemented in local source and tested with synthetic providers; actual provider integration, artifact installation and public deployment require separate acceptance. The package name does not claim a public npm release. Version 2 intentionally changes the default login to unified identity; v1 JSON, exit codes and the 44 business operations remain stable.

The server defaults to `legacy` during preparation and does not silently cut over an existing deployment. This CLI defaults to `unified`. Default login works only after the server explicitly enables `ZIWEI_IDENTITY_MODE=unified`, has complete trusted issuer/API and web secrets/session encryption key configuration, and has reviewed native subject bindings. Operators must explicitly confirm `ZIWEI_IDENTITY_ORIGIN` against the actual deployment domain; a source default is not evidence of a production domain change. Explicit legacy CLI modes work only when the current server declares legacy compatibility. Keeping preparation compatibility is not the final unified-identity delivery.

## Build and private distribution

From this package directory:

```sh
npm run build
npm test
npm pack
```

Build extracts the original management tool schemas, bounded phone catalog summary and pure completion/uncertainty helpers, and copies the pure Bot/native validation and redaction modules into `vendor/`. These modules have no daemon dependencies or credential discovery. The resulting tarball is self-contained. It contains no runtime dependency, credentials, application data or other site's tool. Compare the tarball SHA256 with the trusted release receipt before installing a privately supplied artifact.

```sh
npm install --global /path/to/ziwei-workspace-cli-2.0.0.tgz
# For a released artifact, use its reviewed immutable HTTPS URL:
npm install --global https://<trusted-release-origin>/<versioned-workspace-cli-2.0.0.tgz>
ziwei-workspace --version
ziwei-workspace --help
# Update uses an explicitly supplied reviewed tarball by the same method.
npm uninstall --global @ziwei/workspace-cli
```

Uninstall removes the package; it does not revoke or delete credentials automatically. Use `auth logout` in each selected slot first. To roll back a future package upgrade, reinstall the previously verified artifact; no business database migration is performed by this CLI.

## Authorize one site and one local slot

`--api` selects a credential-free HTTPS origin. The default is `https://ziwei.qzelynth.top`. Loopback HTTP at literal `127.0.0.1` or `[::1]` requires explicit isolated-test environment `ZIWEI_WORKSPACE_ALLOW_LOOPBACK_HTTP=1`; other HTTP addresses are refused. Public flags work before or after the resource/action. Each credential slot is keyed by service `workspace`, exact normalized origin, `--profile` (default `default`), `--account` (default `default`) and `--purpose person|employee` (default `person`). These are local selectors; they assign no server identity or permission. Credentials never come from legacy `ZIWEI_MCP_TOKEN`, token files, device files or daemon configuration.

The dedicated configuration directory is `~/.config/ziwei-workspace`. `ZIWEI_WORKSPACE_CONFIG_DIR` can explicitly select an absolute directory; tests always supply a fresh temporary directory. The credential file contains sensitive material, uses restrictive filesystem modes, and needs the user's OS account and directory access controls. This package does not claim OS keychain encryption. The `credentials.lock` directory covers only short read/modify/atomic-replace transactions. No network operation or polling wait holds it. Records carry a version for compare-and-swap: logout atomically removes and returns the latest AT/RT, while a late refresh/completion cannot recreate the slot and instead attempts current-site revocation of returned tokens. Remote acceptance, failure, unsupported revocation and uncertainty are reported separately. A crash can leave the lock; it is never stolen by age or PID. Verify the original process before recovering an abandoned lock. The owner record holds only PID/time.

Unified device login is the default:

```sh
ziwei-workspace auth login --mode unified --api https://ziwei.qzelynth.top --profile work --account person-slot --workspace example-workspace --non-interactive
# Visit the returned public verificationUri and enter userCode in your browser.
ziwei-workspace auth complete --profile work --account person-slot --non-interactive
# Or explicitly request bounded polling:
ziwei-workspace auth wait --profile work --account person-slot --timeout 30000 --non-interactive
ziwei-workspace auth status --profile work --account person-slot
ziwei-workspace auth status --profile work --account person-slot --local
ziwei-workspace auth refresh --profile work --account person-slot --non-interactive
ziwei-workspace auth logout --profile work --account person-slot
```

No command opens a browser, waits for stdin without an explicit stdin flag, creates an account or silently selects a password flow. Login starts authorization and returns `state:authorization_required,completed:false`, the public URI and user code. The device code stays in the private store. `complete` makes at most one due token exchange; `wait` respects the provider interval and `slow_down` within one deadline, returning `state:pending,completed:false,timedOut:true` on a known pending wait deadline. Neither state means business permission. Terminal denial/expiry clears only the matching pending record. An exchange that may have issued tokens but lost its result remains unknown and is never automatically replayed; explicitly logout and authorize again. Concurrent refresh attempts fail with `CONFLICT`; uncertain rotation blocks further refresh. A crashed in-flight refresh likewise requires explicit logout and reauthorization.

Trust comes from the selected API's anonymous `GET /api/identity/config`, whose service/client/audience/scopes/readiness must exactly match the workspace contract. The public client is `ziwei-workspace-cli`, audience is `ziwei-workspace-api`, and requested scopes are `openid workspace:read workspace:write`. `offline_access` is never requested. Optional `ZIWEI_IDENTITY_ISSUER` pins the issuer and must match the API configuration exactly; it is not a fallback when server configuration is missing. Discovery must return that exact issuer and HTTPS endpoints within its realm origin/path. No business input accepts an issuer or token endpoint.

The CLI uses the public device, token and revocation endpoints directly with no client secret. Every device flow generates a random PKCE verifier and sends its S256 challenge; later polling sends that exact verifier. Because `login` and `complete/wait` are separate processes, the verifier stays alongside the device code in the protected credential store until completion/logout. It is never printed, logged or packaged, and is included in deep secret redaction. OAuth tokens remain opaque to the client: it does not derive identity or permissions by decoding them. Before saving login/refresh, `GET /api/identity/me` must actually verify the AT, introspection and native binding and return the issuer/subject plus membership in the selected workspace; refresh must keep the same subject. The backend checks live site roles, scopes and native resource permissions on every business request. Business ATs are sent only to the selected workspace origin. Its public configuration must explicitly advertise the mapped `native` or `mcp` transport. Native is preferred; otherwise the exact existing MCP route may carry the unified AT. Per-route idempotency remains as documented.

`auth status --local` is only a public metadata summary. Server status calls `/api/identity/me`, preserves its original safe state and marks verification only after actual validation. Logout clears this local slot first and revokes its latest RT and AT using this public client. RFC 7009 HTTP 200 is reported as `remoteRevocation:accepted,revocationConfirmed:false`; it does not prove token inactivity. `--local` reports `not_requested`. Network uncertainty retains local cleanup and the real unknown outcome. This command does not log out other sites or the whole OP session. Removing a pending authorization locally lets its original provider device code expire; it does not claim provider cancellation.

Employee accounts may use their own interactive device flow with `--purpose employee`. Noninteractive employees use `auth login --mode machine --purpose employee --workspace <slug> --worker-file <absolute private JSON>`. The protected file pins issuer, origin, clientId, subject and clientSecret. It obtains a fresh 300-second site token and verifies the original native binding before storage; no refresh token or secret is stored in the credential slot.

Legacy compatibility requires explicit `--mode native` or `--mode managed` and a current server declaration `mode:legacy,legacyAllowed:true`. Unified mode rejects all old passwords, static bearers and cookies. Version 1 credentials must be explicitly reauthorized for compatibility; local metadata/logout remain available. Missing public configuration never falls back to old login. Native compatibility uses the existing email/password API:

```sh
# Supply the password through a protected stdin producer; never put it in argv.
ziwei-workspace auth login --mode native --api https://ziwei.qzelynth.top --profile work --account person-slot --email person@example.invalid --workspace example-workspace --password-stdin --non-interactive
ziwei-workspace auth status --profile work --account person-slot
ziwei-workspace auth status --profile work --account person-slot --local
ziwei-workspace auth logout --profile work --account person-slot
```

The password is used only for the original login request and is not saved. Only the original `ziwei_session` returned by `Set-Cookie` is saved. Login requires the server to confirm the requested workspace membership. `auth status` actually calls `GET /api/auth/me`; `--local` explicitly reports `verification:local` and `serverVerified:false`. Native logout clears the selected local slot and, unless `--local` is selected, calls the original session logout endpoint. Remote failures preserve their real result; this is not a cross-site or all-session logout.

Managed credentials must be explicitly imported, for example:

```sh
ziwei-workspace auth login --mode managed --purpose employee --profile employee-work --account employee-slot --api https://ziwei.qzelynth.top --managed-file /protected/path/managed-credential.json --non-interactive
ziwei-workspace auth status --purpose employee --profile employee-work --account employee-slot
ziwei-workspace auth logout --purpose employee --profile employee-work --account employee-slot
```

`--managed-stdin` is the alternative explicit safe source. Accepted restricted JSON must have `managed:true`, audience `ziwei-management`, exactly one original workspace (`workspace` or a one-element `workspaces` array), a nonempty `deviceId`, a future `expiresAt`, an `apiBase` matching the selected origin and the original `token`/`bearerToken`. The original `credentialId` field is accepted and checked when supplied. Tokens must use the original `zmcp1.<claims>.<signature>` wire format; audience/workspace/device/expiry/credential claims must match the imported metadata. This is structural validation, not local signature verification. Conflicting aliases, other audiences, other API origins, static legacy owner tokens (even relabelled `managed:true`), expired or multi-workspace credentials are rejected. No token is printed. Import verification is local; server status actually calls the original scoped `/mcp/v1/workspaces/<workspace>/health`. All managed commands retain the original per-request backend actor, employee visibility and device-scope checks. Changing a local account label never impersonates an employee.

Managed remote revocation is unsupported by the original credential protocol; logout reports that fact and clears only this local slot. Disabling/revoking the original device/server credential remains a server operation. Explicit compatibility never bypasses the server's unified-mode rejection. No automatic email merge or client-reported employee identity is created.

## Commands and native input

```sh
ziwei-workspace capabilities --json --contract v1
ziwei-workspace employees list --non-interactive
ziwei-workspace tasks get --id task-placeholder
ziwei-workspace bots get --id employee-placeholder
ziwei-workspace bots control --input '{"id":"employee-placeholder","data":{"expectedRevision":1,"expectedControlEpoch":1,"operation":"pause"}}'
ziwei-workspace documents write --input-file /path/to/document-input.json
ziwei-workspace tasks create --input-stdin
ziwei-workspace actions wait --id original-action-placeholder --timeout 30000
```

Shell quoting differs across platforms; the JSON examples use POSIX shell quoting. PowerShell can also use single quoted JSON with double quotes inside. Credentials in these examples are placeholders only. Creating tasks with execution enabled, Bot provisioning/native/Routine/collaboration, Profile creation and phone MCP checks/trials can dispatch real work; do not run those as compatibility smoke tests.

`capabilities.data.operations` is the authoritative command/schema catalog: all 24 original management MCP tools are represented, with `ziwei_bot` expanded into its 20 original operations. Schemas, native tool descriptions, explicit native/managed routes, permissions, side effects, transport-specific idempotency and result queries are exported from `src/registry.mjs`. `getCapabilities()` is offline public documentation, never proof of current authorization. `--help` on a command prints its schema. Legacy native sessions have no corresponding endpoint for `management health` or `employees get`; these return `NOT_SUPPORTED`. A unified identity can use their exact MCP routes when the public server configuration advertises MCP support and server permission permits it. `actions cancel` is unsupported. The narrower original `bots control` stop and `bots cancelMcpConnection` retain their actual cancellation boundaries.

Every operation declares `unifiedAuthorization` for the actual server role/scope policy, in addition to original native checks. `phone-mcp configure` binds an employee to phone MCP and requires current site `access` + `admin`, `workspace:write`, and a native workspace owner/admin. Ordinary task/document mutations remain `write`; a read-only operation does not inherently imply permission to change bindings. The catalog is checked against both native and MCP server route classifications and still does not assert that the current account holds any role.

`--input <JSON>`, `--input-file <path>` and `--input-stdin` are mutually exclusive. Top-level native field shortcuts use exact names such as `--id`, `--title`, `--data`; a field cannot also occur in JSON. Public flags remain reserved for CLI settings: `profiles create` must supply its native `profile` field in JSON, while `--profile work` selects only the `work` credential slot. `--workspace` is the explicit scope selector and conflicts with a duplicate JSON `workspace` field. Duplicate flags, duplicate JSON keys, unknown outer fields, unsafe integers, schema violations and unsupported native operations fail before authentication or submission. String IDs and exact decimal strings remain strings. Passwords/tokens/raw secrets are forbidden in business input. Bot external integrations accept only original permitted environment references such as `${EXTERNAL_API_KEY}` or native `tokenEnv` names; internal credential/environment references remain forbidden by native validation. The CLI does not read referenced values.

Other public options: `--json`, `--non-interactive`, `--contract v1`, `--timeout <milliseconds>` (integer 100–300000, default 30000), `--profile`, `--help`, `--version`. No interactive login or browser prompt is opened. No endpoint in this version offers a non-submitting dry run; `--dry-run` explicitly returns `NOT_SUPPORTED`.

## Results, errors and reconciliation

Every ordinary success/error writes exactly one JSON object to stdout, even without `--json`. Help/version remain text. An example success is:

```json
{"schemaVersion":1,"service":"workspace","ok":true,"data":{"native":{"id":"original-id"}},"requestId":"local-cli-correlation-id"}
```

`data.native` preserves the original response, with secrets redacted; `phone-mcp setup --view summary` applies the original bounded MCP summary. Asynchronous responses additionally include `data.operation` with `state`, `completed`, `nativeState`, the original `serverReceiptId`, `receiptKind` and a result query. Local `requestId` is never a server receipt. Pending/queued map to accepted, acked to running, connected/provisioned/succeeded to succeeded; known failed/expired/cancelled results map to failed. Bot expiry after acknowledgement and arbitrary nested execution-uncertain evidence remain unknown with `completed:false`; readonly waiting continues until its deadline. Original phone audit semantics allow a later receipt for the same submitted ID to supersede prior uncertainty, while an unrelated success does not. Native payloads retain their actual values. Deferred configuration IDs are queried with `bots get`; automation run IDs are not passed off as action IDs. An action returned under a task's `execution` is queried through `actions get`.

| Exit | Error code |
| ---: | --- |
| 0 | CLI request succeeded; asynchronous acceptance is not completion |
| 1 | `INTERNAL_ERROR` |
| 2 | `USAGE` |
| 3 | `UNAUTHENTICATED` |
| 4 | `FORBIDDEN` |
| 5 | `NOT_FOUND` |
| 6 | `CONFLICT` |
| 7 | `SERVICE_UNAVAILABLE` |
| 8 | `OUTCOME_UNKNOWN` |
| 9 | `NOT_SUPPORTED` |
| 130 | `CANCELLED` |

Errors preserve safe original HTTP status and native error code. The end-to-end deadline covers response-body reads. There is no write retry: a dispatched write whose response is lost/times out returns exit 8 with `outcomeUnknown:true`, the original key if supplied and reconciliation instructions. Read failures and readonly wait timeouts use exit 7. SIGINT uses 130 and retains unknown outcome if a write was already dispatched. Read the original resource/action before deciding what to do; keep the same original key when using an endpoint that truly supports it. No backend receipt or idempotency guarantee is fabricated. Native task/conversation creation does not share managed endpoint idempotency; ordinary Bot update is not idempotent, while `deferUntilIdle:true` has its original persisted key semantics.

## Verification and compatibility

`npm test` uses `node:test`, injected fetch/Response fixtures, temporary stores and isolated child processes. It uses no listening server, real authentication, model call, message, device or production action. Independent install/pack acceptance, actual OP verification and backend permission checks are recorded separately by the coordinating task. Local CLI tests do not establish public identity deployment or actual role-revocation behavior.

The retained `scripts/ziwei-mcp.mjs` stdio implementation has no new OP device/refresh flow. Its original managed token-file configuration is not a unified CLI authorization proxy. CLI AT support for declared MCP HTTP routes, retained independent daemon/A2A/terminal credentials, and migration of every employee's actual management MCP runtime are separate acceptance items. The last item remains pending until tested with the intended employee identity and native scope.

See [COMPATIBILITY.md](COMPATIBILITY.md) for every retained computer-client entrypoint, original management MCP tool mapping, intentional unsupported operations and the independent Control boundary.

## 员工能力主动回填

`ziwei-workspace employees capabilities get --id <employeeId>` 读取检测与 AI 回填记录。`ziwei-workspace employees capabilities report --input-file report.json` 增量登记 Skill/MCP/CLI，body 含 `id`、稳定 `idempotencyKey` 与 `entries`；条目含 `kind`、`id`、`name`、`status`（declared/working/failed/removed）。可选 description/version/command/evidenceActionId；command 仅命令名。来源固定 agent_reported，自报不等于已授权、已加载或独立验证；不运行额外业务。沿用当前身份选择参数，未知写入结果先 get 回读。
