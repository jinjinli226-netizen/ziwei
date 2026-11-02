# Workspace CLI 2.0.4 compatibility map

This new independent CLI defaults to contract v1 and accepts `--contract v1`. The project had no old workspace business CLI. No legacy contract, aliases or exit behavior are invented. Existing computer-client scripts and stdio MCP retain their original behavior and stdout protocols. Installing this package does not install or authorize either of them.

Version 2 changes the default `auth login` from legacy password to unified device authorization. Version 2.0.4 retains the v1 envelope, exit codes, global flags, business input and the current 49 business operations, including employee plugin get/refresh/apply. `auth complete`, `auth wait` and `auth refresh` remain explicit commands; human device grants with refresh tokens also support automatic refresh before business requests and server status. Native and managed login require explicit `--mode native|managed` plus a server legacy declaration. Previously stored legacy records require explicit reauthorization before server use. They remain readable as local metadata and removable by logout. No old bearer/cookie/password is accepted when the server selects unified mode. Rolling back the package does not reactivate credentials rejected by a unified backend.

## Existing ziwei_user computer-client entrypoints

The root package binary still points to `scripts/ziwei-user.mjs`, which forwards to the original `scripts/ziwei-cli.mjs`. Every original branch below remains untouched; these manage the connected computer client, not the workspace business CLI.

| Existing entrypoint | Status / workspace mapping |
| --- | --- |
| `ziwei_user setup` / `npm run ziwei:setup` | Retained; computer-client setup; no workspace alias |
| `ziwei_user connect` | Retained; native device pairing; no workspace alias |
| `ziwei_user start` / `npm run ziwei:start` | Retained; computer process lifecycle; no workspace alias |
| `ziwei_user stop` / `npm run ziwei:stop` | Retained; computer process lifecycle; no workspace alias |
| `ziwei_user update` / `npm run ziwei:update` | Retained; computer package update; no workspace alias |
| `ziwei_user update-check` | Retained; native update verification; no workspace alias |
| `ziwei_user update-status` | Retained; native update task result; no workspace alias |
| `ziwei_user uninstall` | Retained; computer package removal; no workspace alias |
| `ziwei_user remove` | Retained uninstall alias; no workspace alias |
| `ziwei_user change` | Retained; computer configuration workflow; no workspace alias |
| `ziwei_user forget` | Retained; native computer disconnection; no workspace alias |
| `ziwei_user reset` | Retained forget alias; no workspace alias |
| `ziwei_user status` / `npm run ziwei:status` | Retained; computer status; different from `auth status` |
| `ziwei_user version`, `--version`, `-v` / `npm run ziwei:version` | Retained; original computer package version |
| `ziwei_user help`, `--help`, `-h`, empty invocation | Retained; original computer-client help |
| `npm run daemon`, `npm run mcp:manage`, `npm run mcp:token` | Retained internal/native scripts; no workspace protocol replacement |

Control `ziwei` is an independently maintained phone-control CLI in another repository. It is not renamed, bundled, counted as the workspace CLI, or used to bypass precise device targeting. No cross-site tool, device command or universal shared-admin token is added here.

## Original management MCP tools

`scripts/ziwei-mcp.mjs` retains its stdio protocol and existing tool behavior. It also exposes the DSH employee plugin endpoints below. Build reuses its schemas and original phone summary inside this independent package; CLI I/O never hijacks stdio MCP output. Explicit legacy managed calls still use the original `/mcp/v1` API and authorization. Unified requests use their own AT only when public server `cliTransports` explicitly declares the mapped route: prefer native, otherwise MCP; never transform the AT into a legacy managed credential. Native routes are explicitly mapped from `backend/app.mjs`; ID-only task/document/skill endpoints retain their original server resource guards. Every unified business request retains backend live token, site role/scope and native resource validation.

| Original tool | New CLI resource/action |
| --- | --- |
| `ziwei_bot` | `bots capabilities/list/create/initialize/get/update/provision/validate/control/runs/routines/createRoutine/updateRoutine/deleteRoutine/runRoutine/native/collaboration/mcpConnections/connectMcp/cancelMcpConnection` |
| `ziwei_inspect_workdir` | `workdirs inspect` |
| `ziwei_create_conversation` | `conversations create` |
| `ziwei_mcp_health` | `management health`; MCP route only, native unsupported; unified requires advertised MCP support |
| `ziwei_discover_environment` | `environment discover` |
| `ziwei_get_employee` | `employees get`; MCP route only, native unsupported; unified requires advertised MCP support; use native `employees list` |
| `ziwei_get_employee_mcp_status` | `employees mcp-status` |
| `ziwei_get_employee_capabilities` | `employees capabilities get`; detected and agent-reported inventory |
| `ziwei_report_employee_capabilities` | `employees capabilities report`; persists agent reports without installation, authorization or runtime verification |
| `ziwei_get_employee_plugins` | `employees plugins get`; observed snapshot of the employee-bound native DSH Bot |
| `ziwei_refresh_employee_plugins` | `employees plugins refresh`; queues readonly device discovery, requires `dsh_plugins_v1` |
| `ziwei_apply_employee_plugins` | `employees plugins apply`; queues saving the same native Bot bundle selection, requires a stable key; does not restart or imply loaded skills/tools |
| `ziwei_create_hermes_profile` | `profiles create` |
| `ziwei_get_action` | `actions get`; `actions wait` is bounded readonly polling of that endpoint |
| `ziwei_get_task` | `tasks get` |
| `ziwei_list_employees` | `employees list` |
| `ziwei_create_employee` | `employees create` |
| `ziwei_update_employee` | `employees update` |
| `ziwei_list_tasks` | `tasks list` |
| `ziwei_create_task` | `tasks create`; native lacks managed idempotency semantics |
| `ziwei_list_documents` | `documents list` |
| `ziwei_read_document` | `documents get` |
| `ziwei_write_document` | `documents write` (PATCH existing ID, POST otherwise) |
| `ziwei_phone_mcp_setup` | `phone-mcp setup`; full or original bounded `summary` conversion |
| `ziwei_install_skill` | `skills install`; native explicit PATCH mapping, original default installed:true |
| `ziwei_configure_phone_mcp` | `phone-mcp configure` |
| `ziwei_get_phone_mcp_status` | `phone-mcp status` |
| `ziwei_check_phone_mcp` | `phone-mcp check`; actual employee execution/load, not a passive query |
| `ziwei_trial_phone_mcp` | `phone-mcp trial`; actual employee/phone health or screenshot, not a passive query |

The schemas and exact route/capability metadata are exported in `src/registry.mjs`. The offline catalog does not verify current authorization; actual unified use requires a configured ready server, trusted issuer and backend validation on every request. Native task/conversation creation is available but does not acquire managed idempotency by virtue of sharing a CLI command name. Bot deferred updates have their original conditional key semantics; ordinary Bot updates and control do not gain idempotency.

The existing Bot schemas retain Hermes/DSH/Codex runtimes and mixed `members` / `memberDescriptors`, each carrying employeeId and runtime, with up to six members. Mixed collaboration uses existing `bots collaboration` and native Bot operations. There is no independent `mixedGroups.*` command catalog or new group route.

## Explicit unsupported and pending boundaries

`actions cancel` has no generic workspace endpoint. Use only the actual narrower authorized Bot stop or MCP connection cancellation when appropriate; these are not guarantees that all past downstream work was cancelled. `bots force-abandon` and `bots failure-finalization` are privileged recovery interfaces intentionally unexposed by version 2.0.4. Extra native APIs outside the catalog remain available through existing authorized product interfaces, not fabricated CLI routes.

Unified human/employee device authorization, opaque token storage, live API status and current-site revocation are implemented. Human `--purpose person` login can explicitly request `--long-lived`, adding `offline_access` when the already configured OP permits it. Automatic refresh runs when a device grant's access token has at most 30 seconds left. A per-slot session lock serializes refresh and logout; callers reread the latest record after waiting. Returned AT/RT generations are saved with pending server verification before `/api/identity/me`, so an API outage preserves the rotated refresh token. Business use still requires server verification. An unresolved rotation is not replayed; `invalid_grant` preserves the record as `reauthorization_required`.

Expiry metadata follows the actual OP response: `accessExpiresAt` uses `expires_in`, and positive `refresh_expires_in` supplies the rolling `refreshIdleExpiresAt`. `loginSessionExpiresAt` may be null if no final deadline is known. Long-lived login promises no fixed duration or permanent session; OP expiry and revocation policy remain authoritative.

Registered per-employee machine clients require `auth login --mode machine --purpose employee --workspace <slug> --worker-file <absolute private JSON>`. They use a dedicated employee/site client and subject, a single employee/workspace native binding, an access-token lifetime <=300 seconds and no refresh token. The private worker file holds the client secret; the token slot does not. Human long-lived login and automatic refresh do not apply to machine grants, and no shared administrator credentials are used.

Global OP logout is `NOT_SUPPORTED`; local logout does not claim cross-site logout. The CLI creates no issuer, account merge or client-asserted employee identity. Synthetic tests, actual OP/server acceptance, private artifact installation and public distribution require their own evidence. The proposed versioned 2.0.4 HTTPS tarball URL documented in README is not yet published; documentation does not establish public download availability or a public npm release.
