# Workspace CLI 2.0.0 compatibility map

This new independent CLI defaults to contract v1 and accepts `--contract v1`. The project had no old workspace business CLI. No legacy contract, aliases or exit behavior are invented. Existing computer-client scripts and stdio MCP retain their original behavior and stdout protocols. Installing this package does not install or authorize either of them.

Version 2 changes the default `auth login` from legacy password to unified device authorization, so it is a new major version. The v1 envelope, exit codes, global flags, business input and 44 operations stay stable. `auth complete`, `auth wait` and `auth refresh` are explicit new commands. Native and managed login require explicit `--mode native|managed` plus a server legacy declaration. Previously stored legacy records require explicit reauthorization before server use. They remain readable as local metadata and removable by logout. No old bearer/cookie/password is accepted when the server selects unified mode. Rolling back the package does not reactivate credentials rejected by a unified backend.

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

The schemas and exact route/capability metadata are exported in `src/registry.mjs`. Native task/conversation creation is available but does not acquire managed idempotency by virtue of sharing a CLI command name. Bot deferred updates have their original conditional key semantics; ordinary Bot updates and control do not gain idempotency.

## Explicit unsupported and pending boundaries

`actions cancel` has no generic workspace endpoint. Use only the actual narrower authorized Bot stop or MCP connection cancellation when appropriate; these are not guarantees that all past downstream work was cancelled. `bots force-abandon` and `bots failure-finalization` are privileged recovery interfaces intentionally unexposed by version 2.0.0. Extra native APIs outside the catalog remain available through existing authorized product interfaces, not fabricated CLI routes.

Unified human/employee account device authorization, opaque site token storage, explicit refresh, live API status and current-site public-client revocation are implemented and tested with synthetic fetch fixtures. Real OP, package/HTTP and deployment acceptance remain separate. Registered per-employee machine clients use explicit private worker files. Global OP logout is `NOT_SUPPORTED`; local logout does not claim cross-site logout. The CLI creates no issuer, account merge or client-asserted employee identity. Public documentation, local acceptance, private artifact installation and production deployment remain separate states.
