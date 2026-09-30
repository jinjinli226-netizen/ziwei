# AuraBaba test-111 Replication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a locally runnable AuraBaba-style workspace product with the inspected routes, controls, task workflow, Agent Runtime model, and an outbound Daemon connection that can later be pointed at real cloud services.

**Architecture:** Use a separated Vue 3 frontend and Express backend. The frontend consumes HTTP APIs and the A2A v1 contract; the backend owns SQLite persistence for local development and leaves a PostgreSQL adapter boundary for production. The Node daemon is a local reference implementation of the AuraBaba-style connector because Go is not available in this environment.

**Tech Stack:** Vue 3, Vite, @ziwei/ui 0.1.1, Express 5, Node built-in sqlite, A2A v1 over HTTP, Node daemon, Node test runner.

---

## Task 1: Create the project skeleton and local developer runtime

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `apps/web/`
- Create: `apps/api/`
- Create: `packages/shared/`
- Create: `packages/ui/`
- Create: `daemon/`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Test: `scripts/healthcheck.ps1`

**Step 1: Create the workspace directories**

Run:

```powershell
New-Item -ItemType Directory -Force apps/web,apps/api,packages/shared,packages/ui,daemon,scripts
```

Expected: all directories exist.

**Step 2: Add package scripts**

Add scripts for `dev`, `build`, `lint`, `test`, `test:e2e`, `db:migrate`, and `daemon:build`.

**Step 3: Add local services**

Configure PostgreSQL and Redis in `docker-compose.yml` with development-only credentials from `.env.example`.

**Step 4: Add health checks**

Implement:

- Web: `GET /healthz`
- API: `GET /healthz`
- Daemon: `GET http://127.0.0.1:20241/healthz`

**Step 5: Verify the skeleton**

Run:

```powershell
pnpm install
pnpm dev
pwsh scripts/healthcheck.ps1
```

Expected: web and API health checks return HTTP 200; the Daemon health check is skipped until Task 6.

---

## Task 2: Define shared domain types and database schema

**Files:**
- Create: `packages/shared/src/domain.ts`
- Create: `packages/shared/src/protocol.ts`
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/domain/state-machine.ts`
- Test: `packages/shared/src/domain.test.ts`
- Test: `apps/api/src/domain/state-machine.test.ts`

**Step 1: Write failing tests for task state transitions**

Cover:

- `planned -> todo`
- `todo -> in_progress`
- `in_progress -> review`
- `review -> completed`
- any active state -> blocked
- planned/todo/in_progress/review/blocked -> cancelled
- invalid transitions rejected

Run:

```powershell
pnpm vitest apps/api/src/domain/state-machine.test.ts
```

Expected: FAIL because the state machine is not implemented.

**Step 2: Define entities**

Add types and Prisma models for:

- Workspace
- User
- Membership
- Device
- Runtime
- DigitalEmployee
- Skill
- SkillInstallation
- Task
- TaskComment
- TaskSubtask
- Automation
- AutomationExecution
- CalendarEvent
- Document
- Folder
- RepositorySource
- AccessTokenHash
- Invitation
- Notification
- AuditEvent

**Step 3: Implement the state machine**

Reject invalid transitions and require an actor, timestamp, and reason for state changes.

**Step 4: Run the tests and migration**

```powershell
pnpm vitest apps/api/src/domain/state-machine.test.ts packages/shared/src/domain.test.ts
pnpm --filter api prisma migrate dev
```

Expected: tests pass and the initial schema is created.

---

## Task 3: Build the shared UI shell and route map

**Files:**
- Create: `apps/web/app/(workspace)/test-111/layout.tsx`
- Create: `apps/web/components/shell/AppShell.tsx`
- Create: `apps/web/components/shell/Sidebar.tsx`
- Create: `apps/web/components/shell/WorkspaceSwitcher.tsx`
- Create: `apps/web/components/shell/AccountMenu.tsx`
- Create: `apps/web/components/shell/GlobalSearchDialog.tsx`
- Create: `apps/web/components/shell/QuickCreateTaskDialog.tsx`
- Create: `apps/web/components/shell/ConversationPopover.tsx`
- Create: `apps/web/lib/routes.ts`
- Test: `apps/web/e2e/shell.spec.ts`

**Step 1: Write the shell navigation test**

Verify the sidebar contains links for home, issues, calendar, documents, members, skills, settings, invite, and open platform.

Run:

```powershell
pnpm playwright test apps/web/e2e/shell.spec.ts
```

Expected: FAIL because the shell is not implemented.

**Step 2: Implement the shell**

Match the inspected labels, active route behavior, side rail, responsive collapse, global menus, and floating tray.

**Step 3: Implement modal primitives**

All dialogs must support:

- Close button
- Escape
- Overlay click where safe
- Focus return
- Disabled submit state
- Loading state
- Error state

**Step 4: Run the shell test**

Expected: all navigation and modal smoke tests pass.

---

## Task 4: Implement the task workspace and view configuration

**Files:**
- Create: `apps/web/app/(workspace)/test-111/issues/page.tsx`
- Create: `apps/web/components/tasks/TaskBoard.tsx`
- Create: `apps/web/components/tasks/TaskList.tsx`
- Create: `apps/web/components/tasks/TaskSwimlane.tsx`
- Create: `apps/web/components/tasks/TaskFilters.tsx`
- Create: `apps/web/components/tasks/BoardSettingsPopover.tsx`
- Create: `apps/web/components/tasks/TaskCreateDialog.tsx`
- Create: `apps/api/src/modules/tasks/routes.ts`
- Create: `apps/api/src/modules/tasks/service.ts`
- Test: `apps/api/src/modules/tasks/service.test.ts`
- Test: `apps/web/e2e/tasks-empty-state.spec.ts`
- Test: `apps/web/e2e/tasks-create.spec.ts`

**Step 1: Add failing empty-state tests**

Assert:

- Six empty columns are present.
- All counts are zero.
- New task buttons exist.
- Board/list/swimlane view menu contains the three view choices.
- Filter menu contains status, priority, date, owner, creator, and labels.

**Step 2: Implement read APIs and Mock data**

Return an empty workspace by default and allow seeded test data through a development fixture.

**Step 3: Implement task creation validation**

Require workspace, title/instructions, and a valid executor when the chosen mode requires an Agent.

**Step 4: Implement view state**

Persist view, grouping, sorting, and card properties in URL search params or workspace preferences.

**Step 5: Run task tests**

```powershell
pnpm vitest apps/api/src/modules/tasks/service.test.ts
pnpm playwright test apps/web/e2e/tasks-empty-state.spec.ts apps/web/e2e/tasks-create.spec.ts
```

Expected: task creation, filtering, grouping, and empty-state tests pass.

---

## Task 5: Implement workspace, team, device, Runtime, and digital employee APIs

**Files:**
- Create: `apps/web/app/(workspace)/test-111/members/page.tsx`
- Create: `apps/web/app/(workspace)/test-111/runtimes/page.tsx`
- Create: `apps/web/components/team/AddDeviceDialog.tsx`
- Create: `apps/web/components/team/InviteMemberForm.tsx`
- Create: `apps/web/components/team/DigitalEmployeeDialog.tsx`
- Create: `apps/api/src/modules/devices/routes.ts`
- Create: `apps/api/src/modules/runtimes/routes.ts`
- Create: `apps/api/src/modules/digital-employees/routes.ts`
- Test: `apps/api/src/modules/devices/service.test.ts`
- Test: `apps/web/e2e/team-empty-state.spec.ts`

**Step 1: Write tests for the inspected empty state**

Verify one device, four Runtime cards, zero digital employees, the organization/tree tabs, and disabled/available actions.

**Step 2: Implement device and Runtime models**

A Device owns multiple Runtimes. Each Runtime reports provider, version, state, last heartbeat, and current task.

**Step 3: Implement add-device UX**

Show Linux, macOS, Windows commands, one-time token placeholder, copy buttons, waiting state, cancel, and close. Never expose test secrets in fixtures.

**Step 4: Implement digital employee creation**

Support avatar, name, description, workspace/personal visibility, Runtime, model, job description, and skill bindings.

**Step 5: Run tests**

```powershell
pnpm vitest apps/api/src/modules/devices/service.test.ts
pnpm playwright test apps/web/e2e/team-empty-state.spec.ts
```

Expected: team and Runtime pages match the inspected states.

---

## Task 6: Implement the Go Daemon and cloud connection protocol

**Files:**
- Create: `daemon/cmd/aura/main.go`
- Create: `daemon/internal/config/config.go`
- Create: `daemon/internal/cloud/client.go`
- Create: `daemon/internal/cloud/ws.go`
- Create: `daemon/internal/runtime/registry.go`
- Create: `daemon/internal/runtime/heartbeat.go`
- Create: `daemon/internal/actions/dispatcher.go`
- Create: `daemon/internal/health/server.go`
- Create: `daemon/internal/agents/adapter.go`
- Test: `daemon/internal/cloud/ws_test.go`
- Test: `daemon/internal/actions/dispatcher_test.go`
- Test: `daemon/internal/runtime/heartbeat_test.go`

**Step 1: Write the protocol tests**

Cover:

- Registration sends device and Runtime metadata.
- WebSocket reconnects with exponential backoff.
- Heartbeats occur every 15 seconds.
- Workspace sync occurs every 30 seconds.
- Duplicate `dedupeKey` is ignored.
- Action acknowledgement precedes execution result.
- Local health server binds only to `127.0.0.1:20241`.

Run:

```powershell
go test ./daemon/...
```

Expected: FAIL because the Daemon protocol is not implemented.

**Step 2: Implement configuration loading**

Read server URL, app URL, workspace ID, device name, workspace root, and token from a local config file. Never print token values.

**Step 3: Implement REST registration and workspace sync**

Use the hostname, TLS, request IDs, timeouts, and redacted structured logs.

**Step 4: Implement WebSocket task wakeup**

Support ping/pong, reconnect, action receipt, ack, result, and replay after reconnect.

**Step 5: Implement Runtime discovery**

Detect Claude, Codex, Gemini, and Hermes versions through adapters. Treat missing binaries as an unavailable Runtime instead of crashing the Daemon.

**Step 6: Implement the local health endpoint**

Expose readiness, last cloud ack, last sync, active actions, and Runtime states on localhost only.

**Step 7: Run Daemon tests**

```powershell
go test ./daemon/...
```

Expected: all protocol tests pass with a local fake cloud server.

---

## Task 7: Implement skills, documents, repositories, calendar, and automations

**Files:**
- Create: `apps/web/app/(workspace)/test-111/skills/page.tsx`
- Create: `apps/web/app/(workspace)/test-111/project-docs/page.tsx`
- Create: `apps/web/app/(workspace)/test-111/calendar/page.tsx`
- Create: `apps/web/app/(workspace)/test-111/autopilots/page.tsx`
- Create: `apps/api/src/modules/skills/`
- Create: `apps/api/src/modules/documents/`
- Create: `apps/api/src/modules/repositories/`
- Create: `apps/api/src/modules/calendar/`
- Create: `apps/api/src/modules/automations/`
- Test: `apps/web/e2e/skills-docs-calendar.spec.ts`
- Test: `apps/api/src/modules/automations/scheduler.test.ts`

**Step 1: Implement skills**

Add platform/team tabs, search, filters, install, reinstall, uninstall, URL import, upload, Agent-created skill, and Runtime copy.

**Step 2: Implement documents**

Add upload, Markdown, folder creation, search, refresh, tree state, quota checks, and file operation audit events.

**Step 3: Implement repositories**

Add HTTPS/SSH URL validation, encrypted credential references, default branch, sync status, and rollback to the last successful revision.

**Step 4: Implement calendar**

Add month/week/day views, task visibility switches, human-only filter, project checkboxes, and timezone handling.

**Step 5: Implement automations**

Add templates, blank editor, schedule, Webhook, event filters, executor, subscriber list, execution logs, retry, pause, and delete confirmation.

**Step 6: Run tests**

```powershell
pnpm vitest apps/api/src/modules/automations/scheduler.test.ts
pnpm playwright test apps/web/e2e/skills-docs-calendar.spec.ts
```

Expected: all four page groups pass their core flows.

---

## Task 8: Implement settings, access keys, invitations, inbox, and open platform

**Files:**
- Create: `apps/web/app/(workspace)/test-111/settings/page.tsx`
- Create: `apps/web/app/me/invite/page.tsx`
- Create: `apps/web/app/(workspace)/test-111/inbox/page.tsx`
- Create: `apps/web/app/(workspace)/test-111/open-platform/page.tsx`
- Create: `apps/api/src/modules/settings/`
- Create: `apps/api/src/modules/access-tokens/`
- Create: `apps/api/src/modules/invitations/`
- Create: `apps/api/src/modules/notifications/`
- Test: `apps/api/src/modules/access-tokens/service.test.ts`
- Test: `apps/web/e2e/settings-invite-inbox.spec.ts`

**Step 1: Implement settings tabs**

Add workspace general, repositories, profile, password, preferences, and access keys.

**Step 2: Implement one-time access key display**

Return plaintext only in the creation response, hash it immediately, and make refresh/reopen show only a prefix.

**Step 3: Implement invitations and points**

Add invitation code, link, poster variants, download/share actions, point ledger, and invited-user records.

**Step 4: Implement inbox**

Add empty state, new conversation, mark-read and archive operations with audit records.

**Step 5: Run tests**

```powershell
pnpm vitest apps/api/src/modules/access-tokens/service.test.ts
pnpm playwright test apps/web/e2e/settings-invite-inbox.spec.ts
```

Expected: sensitive flows are tested without storing real secrets.

---

## Task 9: Add authorization, redacted logging, and failure recovery

**Files:**
- Create: `apps/api/src/auth/permissions.ts`
- Create: `apps/api/src/observability/audit.ts`
- Create: `apps/api/src/observability/redaction.ts`
- Modify: `daemon/internal/logging/logger.go`
- Test: `apps/api/src/auth/permissions.test.ts`
- Test: `apps/api/src/observability/redaction.test.ts`

**Step 1: Write permission tests**

Test Owner, Admin, and Member against save workspace, invite, delete device, delete workspace, create token, revoke token, and install skill.

**Step 2: Implement permission checks**

Enforce permissions server-side and mirror them in UI disabled states.

**Step 3: Implement redaction**

Redact token, cookie, authorization header, API key, password, and secret fields from logs, errors, screenshots, and test snapshots.

**Step 4: Implement failure recovery**

Cover WebSocket failure, Daemon restart, skill install failure, repository sync failure, file upload failure, token expiry, and duplicate Webhook events.

**Step 5: Run security tests**

```powershell
pnpm vitest apps/api/src/auth/permissions.test.ts apps/api/src/observability/redaction.test.ts
go test ./daemon/...
```

Expected: all forbidden operations are rejected and no secret appears in captured output.

---

## Task 10: Visual and end-to-end parity verification

**Files:**
- Create: `apps/web/e2e/parity.spec.ts`
- Create: `apps/web/e2e/fixtures/empty-workspace.json`
- Create: `apps/web/e2e/fixtures/seeded-workspace.json`
- Create: `apps/web/tests/visual/`
- Create: `docs/qa/aura-parity-checklist.md`

**Step 1: Seed empty and populated fixtures**

Keep the empty fixture aligned with the inspected `test-111` state and add a populated fixture for tasks, employees, skills, documents, repositories, and automations.

**Step 2: Capture screenshots**

Capture desktop and narrow-width screenshots for every route, every modal, and each task view.

**Step 3: Run Playwright flows**

```powershell
pnpm playwright test apps/web/e2e/parity.spec.ts --project=chromium
```

**Step 4: Run unit and build checks**

```powershell
npm test
pnpm lint
pnpm build
```

Expected: no failed route, no console error in core flows, and no secret in snapshots or build output.

**Step 5: Record deviations**

For every mismatch, record route, state, expected behavior, actual behavior, screenshot, and decision. Do not silently change the baseline.

---

## Definition of done

The project is ready for deployment when:

- All inspected routes work with direct URL navigation.
- Global shell, menus, dialogs, filters, empty states, and disabled states match the baseline.
- Tasks support board/list/swimlane, filtering, sorting, card properties, creation, assignment, comments, and state transitions.
- Devices and Runtimes register through the Daemon protocol and recover after disconnect.
- Digital employees can bind Runtime and Skills.
- Skills, documents, repositories, calendar, automations, invitations, access keys, inbox, and open platform are functional.
- Owner/Admin/Member permissions are enforced on the API.
- Tokens, logs, WebSocket actions, retries, and audit events follow the defined security rules.
- Playwright, Vitest, Go tests, lint, and production build pass.

## Execution handoff

原始计划的分阶段任务已转化为当前实现：第一阶段本地 Vue/Express/SQLite/A2A/ziwei_user daemon 已落地；后续任务只补生产化适配，不再重复创建规划中的目录。

## 23. 已落地的紫薇实现（2026-09-28）

项目名称固定为“紫薇”，自研 daemon 服务名称固定为 ziwei_user。当前实现已经从原始规划的 Next.js/Fastify/Go 假设切换为可以在当前 Windows 环境直接运行的分离式实现：

- 前端：frontend/，Vue 3 + Vite，入口统一引入 @ziwei/ui/style.css，使用真实组件库的 ZiButton、ZiCard、ZiMetricCard、ZiStatusTag、ZiEmptyState、ZiModal、ZiFormField、ZiInput、ZiSelect、ZiTextarea、ZiSwitch、ZiTabs 等组件。
- 后端：backend/，Express 5，监听 127.0.0.1:4178；路由覆盖工作区摘要、任务状态机、文档、成员、运行时、技能、自动化、日历、设置和审计。
- 数据库：backend/db.mjs 使用 Node 24 内置 node:sqlite，默认文件为 data/ziwei.sqlite；表已经包含工作区、成员、设备、Runtime、任务、消息、文档、技能、自动化和审计事件，后续可替换为 PostgreSQL。
- A2A：/a2a/v1/agents、/a2a/v1/tasks、/a2a/v1/tasks/:id、/a2a/v1/tasks/:id/messages 已可用，任务状态与本地领域状态机复用。
- Daemon：daemon/ziwei_user.mjs 是我们自己的本地连接器，agent id 为 ziwei_user，向后端发心跳和 A2A 轮询；健康端口为 127.0.0.1:20242，避让参考 AuraBaba daemon 已占用的 20241。
- 诊断：.local/logs/ 保存 backend、frontend、daemon、health 的追加日志；scripts/health-monitor.mjs 独立记录 15 秒健康检查，日志包含 PID、端口、心跳、退出和异常信息，不保存 Token/Cookie。
- 端口登记：紫薇已登记后端 4178、前端 5178、本机 daemon 健康 20242。参考系统 20241 仅作为现有占用端口保留。
- 视觉对齐：团队管理页按用户提供的参考截图实现顶部品牌/工作区栏、分组侧栏、快捷操作条、组织架构图、设备—Agent 环境树和悬浮助手入口；颜色和品牌资产保持紫薇自己的设计令牌。

验证命令：
npm test（10 个测试通过）、
npm run build（Vite 生产构建通过）、
npm run diagnose（后端和前端均返回 200）、Invoke-RestMethod http://127.0.0.1:20242/healthz（daemon ready）。

当前仍保留为后续业务决策的事项：生产 PostgreSQL/Redis、云端身份认证、真实任务执行沙箱、Webhook 签名、计费与伙伴市场规则。这些不影响本地前后端、数据库、A2A 和 daemon 第一阶段运行。






