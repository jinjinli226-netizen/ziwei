# Built-in Employee Creator Implementation Plan

> Execute the detailed user-authorized feature and deployment in the existing release worktree. The user explicitly requested implementation, release and a permanent phone_ai instance; design review must not add another approval loop.

**Goal:** A user can select a real connected Codex/Hermes environment in the existing partner market, create their own versioned 数字员工·Creator, and immediately continue a persistent conversation that creates, verifies and iterates real employees through management MCP.

**Architecture:** Add a reusable platform template catalog and instance provenance, while using the existing employee model, management validation and conversations. Instances belong to workspace/user, are idempotently reused and retain their saved customization across template releases. The market loads actual discovery and shows preparation/failure/recovery; automatic management credentials and independent phone authorization remain unchanged.

**Tech Stack:** Vue, existing UI components, Express, SQLite, existing management MCP, native ziwei_user runtimes, Node tests and isolated/production Playwright.

## Accepted design

The existing market tab is a placeholder. Implement a catalog card there, with a choice of actual environment and a create/start control. Reusing a global shared employee would break instance isolation; distributing a prompt file would leave the real creation workflow incomplete. Use per-user workspace instances of one built-in versioned template instead.

The initial template is `ziwei-employee-creator` version `1.0.0`. It separates duties, persona and operating instructions, uses only real supported management tools, asks only necessary questions, acts on explicit creation/modification requests, preserves unrequested fields and distinguishes saved/loaded/tool/task success. It discovers live device/runtime/profile/provider/skills before creating, uses stable request identifiers, reads back exact results, and never automatically operates phones.

`GET /api/workspaces/:slug/employee-templates` supplies catalog and the caller's instance metadata. `POST /api/workspaces/:slug/employee-templates/:id/instances` validates the selected computer/runtime, fills only unambiguous profile defaults from discovery, creates or reuses an employee and a persistent conversation, and returns `{employee,conversation,template,duplicate}`. Actor/workspace come from authentication; request body identity cannot override them. Template upgrades affect new instances; existing customized instances keep their saved configuration. Ordinary employee editing remains the explicit customization path.

## Task 1: Catalog behavior and provenance

- Add `backend/employees/creator-template.mjs` with versioned content and catalog projection.
- Write tests for real tool names, behavior/authorization, runtime distinction, idempotency and preservation guidance.
- Add instance provenance with employee foreign key and workspace/owner/template uniqueness; migrate additively without modifying existing employee data.

## Task 2: Existing employee/conversation integration

- Add `backend/employees/templates.mjs`, routes in `backend/app.mjs`, and required repository/database hooks.
- RED/GREEN API tests cover member isolation, forged actor, cross-workspace device rejection, unknown readiness, explicit runtime/profile retention, transaction rollback, retries and concurrent duplicate requests.
- Reuse an existing same-owner Creator only after identity/provenance checks; never overwrite customization or adopt another user's employee.
- Use existing management validation and conversation ownership, including personal visibility and the exact selected computer.

## Task 3: Market user flow

- Replace App market placeholder using a focused reusable component and explicit workspace API calls.
- Show the template's role/workflow/version, actual environment choices, readable errors and retry, saved instance and direct persistent chat.
- Fixture/browser coverage includes create, refresh, existing-instance reuse, failure recovery, workspace races, keyboard interaction, desktop, 390px and short windows.
- Regress card clipping, modal/footer scrolling, native checkbox dimensions and phone/invitation/install entry behavior.

## Task 4: Production and real Creator acceptance

- Confirm production 1ca9c6b, control 8a4fe59, actual global client PID/build, test_222 and phone_ai identities and original port 20242. Do not start a substitute daemon or perform Mac setup.
- Run appropriate full tests/lint/build, inspect intended changes, push and deploy with database/config backup. Preserve original data, old hash assets, Nginx phone route, control/APK and diagnostic logs.
- In real browser, create the phone_ai permanent 数字员工·Creator with actual Codex when usable, otherwise verified Hermes with explicit recorded configuration; confirm refresh and direct chat.
- The real Creator must load management MCP, create Codex and Hermes QA employees from natural language, read back exact environment/profile, execute a small task, correct an intentional safe failure, and demonstrate idempotent reuse.
- Record actual tool/action/task receipts, preserve the formal Creator and its conversation, and precisely clean only enumerated QA children and temporary sessions. Never consume invitations or operate phones.
- Recheck production/browser/data boundaries and update PROJECT_MANAGEMENT, README, HANDOFF, CHANGELOG and a release/rollback acceptance record with exact links and unverified limits.
