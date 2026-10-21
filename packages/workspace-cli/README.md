# @ziwei/workspace-cli 1.0.0

`ziwei-workspace` is the independently installable CLI for the Ziwei digital employee workspace. It uses only Node builtins and fetch, requires Node 20.11 or later, and does not install or run a computer daemon, Control phone CLI, shared cross-site CLI or local server. The original `ziwei_user` and management MCP remain unchanged. This is a new business CLI with default machine contract v1; there is no previous workspace CLI contract to emulate.

Public documentation: <https://ziwei.qzelynth.top/docs>. Standard version 1.2.0; CLI/document version 1.0.0. Implementation is local source until separately packaged, installed, reviewed and released. The package name is not a claim that a public npm release exists. Unified identity/C13 and public deployment remain pending.

## Build and private distribution

From this package directory:

```sh
npm run build
npm test
npm pack
```

Build extracts the original management tool schemas, bounded phone catalog summary and pure completion/uncertainty helpers, and copies the pure Bot/native validation and redaction modules into `vendor/`. These modules have no daemon dependencies or credential discovery. The resulting tarball is self-contained. It contains no runtime dependency, credentials, application data or other site's tool. Compare the tarball SHA256 with the trusted release receipt before installing a privately supplied artifact.

```sh
npm install --global /path/to/ziwei-workspace-cli-1.0.0.tgz
ziwei-workspace --version
ziwei-workspace --help
# Update uses an explicitly supplied reviewed tarball by the same method.
npm uninstall --global @ziwei/workspace-cli
```

Uninstall removes the package; it does not revoke or delete credentials automatically. Use `auth logout` in each selected slot first. To roll back a future package upgrade, reinstall the previously verified artifact; no business database migration is performed by this CLI.

## Authorize one site and one local slot

`--api` selects a credential-free HTTPS origin. The default is `https://ziwei.qzelynth.top`; isolated loopback HTTP is also accepted. Public flags work before or after the resource/action. Each credential slot is keyed by service `workspace`, exact normalized origin, `--profile` (default `default`), `--account` (default `default`) and `--purpose person|employee` (default `person`). These are local selectors; they do not assign any server identity or permission. Credentials never come from legacy `ZIWEI_MCP_TOKEN`, token files, device files or daemon configuration.

The dedicated configuration directory is `~/.config/ziwei-workspace`. `ZIWEI_WORKSPACE_CONFIG_DIR` can explicitly select an absolute directory; tests must always supply a fresh temporary directory. The credential file contains sensitive material, is created with restrictive filesystem modes, and should be protected by the user's OS account and directory access controls. CLI output and `config show` contain only public configuration. This package does not claim OS keychain encryption. Cross-process saves and logout hold an exclusive `credentials.lock` directory across the entire read/modify/atomic-replace transaction, preserving the existing store format and unrelated slots. Contention fails after a bounded wait. A crash can leave this lock behind; the CLI never steals it by age or PID, so first verify the original process is absent before manually removing only that abandoned lock directory. Its owner record contains only PID/time, never credentials.

Migration-compatible native login uses the existing email/password API:

```sh
# Supply the password through a protected stdin producer; never put it in argv.
ziwei-workspace auth login --api https://ziwei.qzelynth.top --profile work --account person-slot --email person@example.invalid --workspace example-workspace --password-stdin --non-interactive
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

Managed remote revocation is unsupported by the original credential protocol; logout reports that fact and clears only this local slot. Disabling/revoking the original device/server credential remains a server operation. `auth login --mode unified` returns `NOT_SUPPORTED` with `pending`; no new issuer, automatic email merge or self-reported employee identity is created.

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

`capabilities.data.operations` is the authoritative command/schema catalog: all 24 original management MCP tools are represented, with `ziwei_bot` expanded into its 20 original operations. Schemas, native tool descriptions, explicit native/managed routes, permissions, side effects, transport-specific idempotency and result queries are exported from `src/registry.mjs`. `getCapabilities()` is offline public documentation, never proof of current authorization. `--help` on a command prints its schema. Human sessions have no corresponding endpoint for `management health` or `employees get`; these return `NOT_SUPPORTED`. `actions cancel` is unsupported. The narrower original `bots control` stop and `bots cancelMcpConnection` retain their actual cancellation boundaries.

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

`npm test` uses `node:test`, injected fetch/Response fixtures and temporary configuration directories. It performs no listening server, real authentication, model call, message, device or production action. Independent install/pack acceptance and backend permission-domain checks are recorded separately by the coordinating task. C13 unified identity and C14 public deployment require their own evidence.

See [COMPATIBILITY.md](COMPATIBILITY.md) for every retained computer-client entrypoint, original management MCP tool mapping, intentional unsupported operations and the independent Control boundary.
