# 紫薇项目管理与 AI 接手手册

> **唯一维护入口**：本文是紫薇项目的当前状态、开发约定、运维流程和 AI 接手说明。
>
> **项目目录**：`D:\灵光爸爸拆解`
>
> **文档状态**：以 2026-10-04 工作区实际代码为准；每次结构、运行方式或功能边界发生变化时必须更新本文。

> **当前本机运行态**：当前 `ziwei_user` 已接入工作区 `bjc-ops`。文中的 `test-111` 是默认示例和历史验收 fixture；接手时必须先读取 `data/ziwei_user.json` 与 `/readyz`，不要把示例工作区当成当前运行工作区。

> **版本事实**：本次 Hermes 独立人格改动位于分支 `codex/hermes-independent-profile`，生产 `main` 未更新；工作树仍保留既有未跟踪临时文件 `tmp_gzgov.html`。不要在未审查 `git status --short` 前执行 reset、clean 或覆盖式 checkout。

## 1. 先看结论

紫薇当前已经具备可运行的本地工作区产品闭环：Vue 前端、Express API、SQLite 持久化、本机 `ziwei_user` 桥接 daemon、A2A action、真实 CLI 运行时发现、任务执行事件、对话收件箱、数字员工、自动化、文档、技能、邀请、设备和通知链路都已接入代码。

当前通过的本地质量门槛：

```text
npm test       90 passed
npm run lint   passed
npm run build  passed
```

最近一次验证环境为 Windows、Node v24.13.0、npm 11.6.2；当前分支为 `main`，工作区仍有未提交的功能修改。接手时先运行 `git status --short`，把这些修改视为现有工作，不要重置、清理或覆盖。

这不等于所有部署边界都完成。远端 Git 同步、生产级 PostgreSQL/Redis/对象存储、云端 OAuth、计费、真正的沙箱隔离以及完整浏览器逐页截图验收仍属于后续工作。不要把这些项目写成“已完成”。

## 2. 60 秒启动和验收

在项目根目录打开 PowerShell：

```powershell
Set-Location 'D:\灵光爸爸拆解'

# 第一次或依赖变化后执行
npm install

# 启动前先确认没有重复实例
Get-NetTCPConnection -LocalPort 5178,4178,20242 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess,State

# 启动前端和后端；已有服务运行时不要重复启动
npm run dev

# 另开一个 PowerShell，启动本机桥接器
npm run ziwei:start

# 查看桥接器状态
npm run ziwei:status
```

浏览器入口：

```text
http://127.0.0.1:5178/test-111/home
```

快速健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4178/healthz
Invoke-RestMethod http://127.0.0.1:20242/readyz
Invoke-RestMethod http://127.0.0.1:4178/api/workspaces/test-111/summary
```

只改了前端时，可单独运行 `npm run dev:frontend`；只改了后端时，可单独运行 `npm run dev:backend`。修改 daemon 或 `src/` 运行时后，必须重启 `ziwei_user`，否则旧进程不会加载新代码。

## 3. 服务、端口和日志

| 组件 | 原生入口 | 端口 | 职责 | 主要日志 |
| --- | --- | ---: | --- | --- |
| Vue/Vite 前端 | `npm run dev:frontend` | 5178 | 页面、路由、交互、实时刷新 | `.local/logs/frontend.log` |
| Express 后端 | `npm run dev:backend` | 4178 | API、认证、领域写入、A2A API | `.local/logs/backend.log` |
| `ziwei_user` | `npm run ziwei:start` | 20242 | 心跳、动作轮询、CLI 执行、结果回传 | `.local/logs/daemon.log` |
| 健康监控 | `npm run diagnose` / `npm run monitor` | 无 | 记录前后端健康状态 | `.local/logs/health.log` |

端口归属固定为 5178/4178/20242。不要为了排查随意换端口、另起一套业务实例或终止用户正在使用的服务。需要隔离测试时使用临时测试端口和独立数据目录，并在结束后清理。

本机配置：

```text
data/ziwei_user.json       # 不提交令牌；示例工作区为 test-111，当前本机以文件内容为准
data/ziwei.sqlite          # 本地持久化数据库
 data/a2a.token             # 本机 A2A 令牌，禁止写入日志或提交
.local/runtime/             # daemon 动作状态
.local/logs/                # 追加日志，单文件超过 5 MiB 会轮转
```

## 4. 系统架构和数据流

```text
浏览器 Vue
  │ fetch / WebSocket / SSE
  ▼
backend/app.mjs（Express API）
  │ repository / models / auth / sanitize / storage
  ▼
SQLite（data/ziwei.sqlite）
  │ 创建 task.execute / conversation.execute A2A action
  ▼
ziwei_user daemon（daemon/ziwei_user.mjs）
  │ poll → ack → ActionDispatcher → local action/runtime adapter
  ▼
本机 CLI（Codex、Claude、Gemini、Hermes）
  │ action.stage / action.output / result
  ▼
后端持久化事件 → WebSocket 优先、SSE fallback → 页面实时更新
```

职责边界：

- `frontend/src/App.vue`：页面路由、工作区入口和页面组合；不要在这里伪造业务数据。
- `frontend/src/components/WorkspaceShell.vue`：全局侧栏、顶部快捷托盘、工作区切换和统一导航。
- `frontend/src/api.js`：前端 API 封装；新增后端能力应先在这里建立明确方法。
- `backend/app.mjs`：HTTP 路由、鉴权边界和请求编排；持久化逻辑下沉到 repository。
- `backend/repository.mjs`：业务实体和状态变更的持久化入口，禁止在路由里直接拼 SQL。
- `backend/db.mjs`：SQLite 连接、表结构和迁移初始化；新增字段必须兼容已有数据库。
- `backend/realtime.mjs`：通知 WebSocket/SSE 通道。
- `backend/storage.mjs`：本地内容寻址对象存储边界。
- `backend/sanitize.mjs`：用户输入 HTML 净化边界。
- `backend/git-sync.mjs`：当前仅本地 Git 导入/导出，不代表远端 Git 已完成。
- `src/daemon.mjs`：动作幂等、ACK 后租约、超时、取消、工作目录校验和事件分类。
- `src/local-action.mjs`：允许的本地动作和运行时执行入口。
- `src/runtime-adapters.mjs`：本机 CLI 发现、版本/模型发现、代理继承、流式输出解析和公开推理摘要。
- `daemon/ziwei_user.mjs`：心跳、A2A 轮询、动作执行和终态回传；在线状态只认自己的心跳。

## 5. 当前真实功能边界

### 已落地并可继续维护

- 工作区创建、独立 slug 路由、工作区切换和账号会话注销。
- 任务看板、列表、负责人视图、状态流转、任务详情、消息、附件和 due date。
- 数字员工创建、运行时选择、任务安排、持久会话和对话收件箱。
- `ziwei_user` 首次安装引导、心跳、就绪状态、设备和 Agent CLI 版本发现。
- Codex/Claude/Gemini/Hermes 本机 CLI 适配；Codex 使用真实本机配置和系统代理，不使用伪造输出。
- Hermes 独立人格（本地分支）：数字员工可绑定本机 Hermes profile；执行时隔离 `HERMES_HOME`，并把岗位说明注入真实 task/conversation prompt。profile 不存在时明确失败，不回退主 profile。该改动尚未部署到生产。
- A2A action 的创建、去重、ACK、事件、执行租约、结果、失败和过期处理。
- 公开推理摘要、命令/工具安全摘要、CLI 输出量和阶段状态；不展示模型原始私有思维链。
- 文档目录树、文件夹、Markdown、二进制附件、下载、回收站、净化和本地 Git 导入/导出。
- Skills 的文本、文件、URL、ZIP 和在线工位导入，校验、版本、停用、卸载和回滚。
- 邀请生命周期、设备管理、成员管理、API Key、Webhook、自动化、日历和通知实时通道。
- 浅色品牌主题、统一蓝色主色、跨页面快捷“数字伙伴创建”入口和运行状态展示。

### 明确延期或有边界的能力

- 远端 Git 仓库同步：当前只保留受控的本地 Git 导入/导出。
- 生产级 PostgreSQL、Redis、对象存储、队列和多实例部署。
- OAuth/SSO、计费、伙伴市场、云端权限模型和生产沙箱隔离。
- 完整浏览器逐页像素对比、四态截图证据和跨浏览器兼容验收。
- 原始模型思维链：页面只展示 provider 提供的公开 reasoning summary；没有公开摘要时不能伪造。

### 当前架构风险

- SQLite、对象存储和自动化 scheduler 都是单机实现；scheduler 使用单进程约 15 秒轮询，没有分布式锁，不适合多实例部署。
- `backend/db.mjs` 当前使用启动时建表和兼容性 `ALTER TABLE`，还没有独立的 migration/version 目录。涉及结构变更时必须先备份数据库，并补充可重复执行的迁移测试。
- 当前工作区有较多未提交修改；在形成领域化提交前，不要把工作树当作干净发布版本。
- 当前自动化测试使用 Node `--test`、HTTP 测试和 UI contract，没有 Playwright 级别的跨浏览器像素验收。

## 6. 扩展新功能的标准流程

功能状态统一使用下面的枚举，并附证据，不使用没有上下文的“完成”：

```text
implemented       已写入代码，但可能还未完成真实运行验收
verified          代码、自动化测试和真实链路均有证据
blocked           有明确外部阻塞，记录阻塞原因和解除条件
deferred          明确延期，记录触发条件
needs-confirmation 需要用户或产品确认范围
```

### 6.1 先写工作项

每项改动先在 issue、计划文件或交接记录中写清：

```text
目标：用户能完成什么动作
边界：哪些不在本次范围
入口：页面路由和 API 路由
数据：新增/修改哪些持久化字段
执行链：是否需要 A2A、daemon 或 CLI
验收：至少一个自动化测试 + 一个真实运行验证
风险：兼容、权限、数据迁移、回滚方式
```

### 6.2 后端改动顺序

1. 在 `backend/db.mjs` 增加兼容初始化或迁移。
2. 在 `backend/repository.mjs` 增加读写方法和状态约束。
3. 在 `backend/app.mjs` 增加参数校验、权限判断和 HTTP 错误。
4. 在 `frontend/src/api.js` 增加明确的 API 方法。
5. 为成功、失败、权限、重复请求和旧数据库各补测试。

路由不能直接操作 SQLite；不要把业务规则只写在前端；所有用户提交的 HTML、文件名、路径和 URL 都要经过现有净化/边界检查。

### 6.3 数字员工和运行时改动顺序

A2A 动作必须遵循：

```text
create pending → daemon poll → ack → action.started
→ action.stage/output → result succeeded/failed
```

新增动作类型时必须同时处理：

- 幂等键和重复投递。
- ACK 后的执行租约和过期判断。
- AbortSignal 取消、超时和 CLI 退出码。
- 结果和失败信息脱敏。
- 前端实时事件和刷新后的历史恢复。
- 无 daemon、daemon 离线、CLI 未安装和网络不可达时的可读错误。

不要用固定模型目录、静态版本或假在线状态代替 `ziwei_user` 的真实发现结果。不要把 AuraBaba daemon 作为紫薇的运行依赖。

### 6.4 前端改动标准

- 所有异步操作必须有 loading、成功、失败和空状态。
- 页面显示的数据必须来自 API 或实时事件；演示数据只能存在于显式 fixture/test 中。
- 选择器使用项目组件，不要恢复浏览器原生 `<select>` 作为员工创建的运行时/模型选择器。
- 任务状态由后端动作结果驱动；用户拖拽只是发起状态变更，不能成为执行状态的唯一来源。
- 长列表、CLI 输出和活动记录必须有边界滚动，不得让内容撑破弹窗或页面。
- 保持紫薇浅色品牌、蓝色主色和共享 UI 令牌；不要重新引入紫色主题残留。

## 7. 常见故障排查

### 页面显示数字员工离线

```powershell
Invoke-RestMethod http://127.0.0.1:20242/healthz
Invoke-RestMethod http://127.0.0.1:20242/readyz
npm run ziwei:status
Get-Content .local/logs/daemon.log -Tail 80
```

`healthz` 只表示进程活着；`readyz` 还要求最近心跳成功并且接入当前工作区。页面只应以 ready/heartbeat 判断在线。

### 任务显示 `A2A action timed out after 600000ms`

这代表动作在 daemon 的 10 分钟执行窗口内没有终态结果，常见根因是 CLI 网络不可达、CLI 进程卡住、工作目录错误或 daemon 未回传结果。不要先把前端提示改成成功。

排查顺序：

```powershell
Get-Content .local/logs/daemon.log -Tail 120
Invoke-RestMethod http://127.0.0.1:20242/readyz
# Windows 代理配置
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer
```

当前 Codex 适配器会自动继承显式 `HTTP_PROXY`/`HTTPS_PROXY`，没有显式变量时读取启用的 Windows Internet Settings 代理。原有失败记录会继续显示失败；修复后需要重新发送任务，不会篡改历史结果。

### 任务执行了但对话没有回复

先查 action 和事件，再查 conversation 关联：

```powershell
Invoke-RestMethod 'http://127.0.0.1:4178/a2a/v1/actions?workspace=test-111&agent=ziwei_user&status=all&includeAcked=1'
Invoke-RestMethod 'http://127.0.0.1:4178/api/workspaces/test-111/summary'
```

重点确认 `task.execute` 是否带有正确的 `conversationId`，ACK、事件和 result 是否都已回传。历史动作关联逻辑在 `backend/repository.mjs`，不要只修页面拼接。

### 修改代码后页面仍是旧行为

- 前端：确认 Vite 页面已刷新，必要时使用强制刷新。
- 后端：重启 4178 服务。
- daemon/运行时：重启 `ziwei_user`，因为 Node 进程会缓存模块。
- 不要同时启动第二个 daemon；先查 20242 的占用 PID。

### 端口冲突

先查实际占用和日志，不要直接杀进程：

```powershell
Get-NetTCPConnection -LocalPort 5178,4178,20242 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess,State
```

## 8. 测试、构建和发布门槛

每次代码修改至少执行：

```powershell
npm test
npm run lint
npm run build
```

涉及以下内容时增加专项验证：

| 改动 | 必跑专项 |
| --- | --- |
| A2A/daemon/运行时 | `node --test test/daemon.test.mjs test/a2a-actions.test.mjs test/runtime-adapters.test.mjs`，再做一次真实短 CLI 请求 |
| 路由/API/权限 | `node --test test/routes.test.mjs test/api.test.mjs test/permissions-devices.test.mjs` |
| 文档/存储/文件 | `node --test test/docs-dataflow.test.mjs test/storage-sanitize-git.test.mjs` |
| Skills | `node --test test/skills-import.test.mjs` |
| 前端契约 | `node --test test/ui-contract.test.mjs test/e2e/aura-14-point.spec.mjs` |

发布前必须确认：

1. 三项质量命令通过。
2. `/healthz`、`/readyz` 返回预期状态。
3. 新增功能在真实 API 和真实 SQLite 上走通一次。
4. 没有 token、Cookie、Authorization、邀请码或用户正文进入日志和提交。
5. `data/ziwei.sqlite` 和 `data/` 私有配置已备份，且不会被提交。
6. 文档中的“已完成/延期/已知限制”与代码一致。

## 9. 数据、权限和回滚

变更数据库结构时优先采用向后兼容的 `CREATE TABLE IF NOT EXISTS`、`ALTER TABLE ... ADD COLUMN` 或明确版本迁移；不得要求用户删除 SQLite 才能启动。破坏性数据变更必须提供备份和回滚步骤。

发布前备份示例：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item data/ziwei.sqlite "data/ziwei.sqlite.$stamp.bak"
```

回滚原则：

- 先停止新代码对应的服务，再恢复代码和数据库备份。
- 不删除用户日志、动作历史和附件对象。
- 对失败的 A2A action 使用重试/新 dedupe key，不直接改写旧终态。
- 回滚后重新执行健康检查和最小真实任务。

## 10. 给其他 AI 的接手顺序

`HANDOFF-CLAUDE-进度记录.md` 是一次历史接手记录，保留用于追溯，不是当前事实来源。任何新 AI 接手本项目时，按下面顺序执行：

1. 阅读本文，再读 `README.md`、`HANDOFF.md` 和最近的 `docs/plans/*.md`。
2. 执行 `git status --short`，把已有工作区修改视为用户资产，不要覆盖或清理。
3. 检查 5178/4178/20242 和三份日志；不要为了“确认启动”重复启动服务。
4. 运行 `npm test`、`npm run lint`、`npm run build`，建立当前基线。
5. 根据问题所在层定位：页面 → API → repository/SQLite → A2A → daemon → CLI。
6. 先复现并记录证据，再改一个根因；不要用假数据、静态成功状态或扩大超时掩盖问题。
7. 完成功能后跑对应专项测试和一次真实本地链路验证。
8. 更新本文的“当前状态”“已知限制”和“最近验证”；同时在 `HANDOFF.md` 追加简短时间线。
9. 最终报告必须说明：改了什么、为什么、验证了什么、未验证什么、如何回滚。

接手时禁止做的事：

- 不读取、输出或提交令牌、Cookie、完整 Authorization、邀请码和用户私密正文。
- 不依赖 AuraBaba daemon，不为了验证关闭用户自己的 `ziwei_user`。
- 不把旧失败记录改写成成功，不把截图或静态 fixture 当成真实链路。
- 不在没有测试和回滚方案时直接改数据库结构。
- 不把“构建通过”写成“浏览器验收完成”。

## 11. 后续路线图

### P0：持续可靠性

- 补一键重试失败 conversation/action 的用户入口，并保留原始失败记录。
- 增加 CLI 进程退出、网络不可达、代理不可用和取消动作的独立状态展示。
- 把真实浏览器验收纳入发布门槛，覆盖工作区、任务、数字员工、对话、文档和 Skills。

### P1：生产化基础

- 抽象 SQLite 到 PostgreSQL 的 repository 适配层。
- 引入持久队列/锁和多实例 daemon 协调，替换单进程轮询假设。
- 将对象存储、日志、指标和审计事件做可配置后端。
- 完善权限矩阵、OAuth/SSO 和密钥轮换策略。

### P2：外部集成

- 远端 Git 双向同步和冲突处理。
- 伙伴市场、Webhook 管理界面和更多外部连接器。
- 计费、配额和组织级审计报表。

## 12. 工作记录模板

新工作完成后，在 `HANDOFF.md` 或对应计划文件追加：

```markdown
### YYYY-MM-DD <主题>
- 目标：
- 变更：
- 影响文件：
- 数据/兼容：
- 验证：`npm test`、`npm run lint`、`npm run build`、真实链路
- 未验证或延期：
- 回滚方式：
```

这份手册是维护入口，不替代代码、测试和运行日志。任何结论都必须能回到真实文件、真实 API、真实进程或真实测试结果。
