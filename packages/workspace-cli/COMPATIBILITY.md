# Workspace CLI 1.0.0 compatibility map

This new independent CLI defaults to contract v1 and accepts `--contract v1`. The project had no old workspace business CLI. No legacy contract, aliases or exit behavior are invented. Existing computer-client scripts and stdio MCP retain their original behavior and stdout protocols. Installing this package does not install or authorize either of them.

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

`scripts/ziwei-mcp.mjs` is preserved unchanged. Build reuses its schemas and original phone summary inside this independent package; CLI I/O never hijacks stdio MCP output. Managed calls still use the original `/mcp/v1` API and authorization on every request. Native routes are explicitly mapped from `backend/app.mjs`; ID-only human task/document/skill endpoints retain their original server resource guards.

| Original tool | New CLI resource/action |
| --- | --- |
| `ziwei_bot` | `bots capabilities/list/create/initialize/get/update/provision/validate/control/runs/routines/createRoutine/updateRoutine/deleteRoutine/runRoutine/native/collaboration/mcpConnections/connectMcp/cancelMcpConnection` |
| `ziwei_inspect_workdir` | `workdirs inspect` |
| `ziwei_create_conversation` | `conversations create` |
| `ziwei_mcp_health` | `management health`; managed only, native unsupported |
| `ziwei_discover_environment` | `environment discover` |
| `ziwei_get_employee` | `employees get`; managed only, native unsupported; use native `employees list` |
| `ziwei_get_employee_mcp_status` | `employees mcp-status` |
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

`actions cancel` has no generic workspace endpoint. Use only the actual narrower authorized Bot stop or MCP connection cancellation when appropriate; these are not guarantees that all past downstream work was cancelled. `bots force-abandon` and `bots failure-finalization` are privileged recovery interfaces intentionally unexposed by version 1.0.0. Extra native APIs outside the catalog remain available through existing authorized product interfaces, not fabricated CLI routes.

Unified identity/C13 remains **pending**: only migration-compatible native sessions and explicit original managed credentials are implemented. There is no local issuer, automatic email account merge, cross-site bearer reuse or client-asserted employee identity. Public documentation route implementation, local HTTP acceptance, private artifact installation and production deployment are separate states; a local package or generated document does not claim a production release.
