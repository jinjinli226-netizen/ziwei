# AuraBaba 14 点复刻补齐实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将紫薇当前“可运行骨架”补齐为覆盖原 AuraBaba 14 个核心模块的可操作版本，并以自有 `ziwei_user` 的安装、心跳和 A2A 链路作为唯一本机健康来源。

**Architecture:** 保留当前 Vue 3 + Express 5 + SQLite + `ziwei_user` daemon 架构，先补齐路由、真实交互和本地持久化，再为生产认证、队列、对象存储和 WebSocket 保留适配边界。所有运行时健康由 `ziwei_user` 心跳决定，绝不读取或依赖 Aura daemon 状态。

**Tech Stack:** Vue 3、Vite、`@ziwei/ui`、Express 5、Node 内置 SQLite、Node fetch、A2A v1、Playwright/Node test。

---

## 当前审计结论

| 点 | 模块 | 当前状态 | 主要缺口 |
|---|---|---|---|
| 1 | 全局外壳和跨页按钮 | 部分完成 | 工作流、全语言菜单、快捷托盘拖动/审批、新对话仍有占位 |
| 2 | 主页 | 部分完成 | 只有空状态，聊天入口没有会话和发送链路 |
| 3 | 任务 | 部分完成 | 看板和基础创建可用，筛选维度、泳道、详情、富文本、附件、负责人未闭环 |
| 4 | 自动化 | 未完成 | 没有独立 `/autopilots` 路由、模板、执行记录、Webhook |
| 5 | 日历 | 部分完成 | 月视图基础可用，周/日视图和事件编辑/联动不完整 |
| 6 | 文档 | 部分完成 | 文本上传和新建可用，二进制、打开/下载/重命名/删除/版本缺失 |
| 7 | 团队/设备/运行时 | 部分完成 | 自有心跳已完成，但安装向导、setup、设备操作和权限缺失 |
| 8 | 数字员工 | 部分完成 | 表单可创建草稿，头像、岗位编辑器、伙伴市场和运行时绑定不完整 |
| 9 | 技能中心 | 部分完成 | 平台/团队、搜索、分类、安装已补；URL/zip/工位复制/校验/回滚缺失 |
| 10 | 设置 | 部分完成 | 基本信息可保存，个人资料、偏好、同步源、密钥缺失 |
| 11 | 邀请与积分 | 部分完成 | 邀请表单/链接有，邀请码、积分、海报和记录缺失 |
| 12 | 开放平台 | 部分完成 | 说明卡有，Token、外部链接和提示词复制缺失 |
| 13 | 收件箱/新对话 | 部分完成 | 空状态有，通知、归档、新对话历史和消息协议缺失 |
| 14 | 后端、A2A、验收 | 部分完成 | REST/A2A/SQLite/心跳有，真实 action ack/result、WebSocket、权限和 E2E 缺失 |

---

## 实施顺序

### Task 1: 建立可验收基线和路由矩阵

**Files:**
- Create: `docs/baselines/aura-14-point-baseline.json`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/components/WorkspaceShell.vue`
- Test: `test/routes.test.mjs`

**Steps:**
1. 固定 14 个路由、默认空状态、按钮标题和弹窗标题。
2. 补上 `/test-111/autopilots`、`/test-111/runtimes` 独立路由。
3. 每个路由支持刷新后恢复，未知路由显示可返回的空状态。
4. 用 Node test 检查路由映射和 baseline 字段。
5. 验证 `npm test`、`npm run build`。

### Task 2: 完成全局壳层和全局交互

**Files:**
- Modify: `frontend/src/components/WorkspaceShell.vue`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/workspace-shell.css`
- Test: `test/shell.test.mjs`

**Steps:**
1. 将工作流从 toast 改为真正的“敬请期待”弹窗。
2. 语言菜单补齐 English、中文、한국어、日本語，并保存选择。
3. 快捷托盘支持拖动、Home 复位、搜索、新建任务、审批入口。
4. 所有遮罩、Escape、关闭按钮统一可关闭。
5. 验证桌面宽度、窄屏和键盘路径。

### Task 3: 完成任务领域

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/api.js`
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Modify: `backend/db.mjs`
- Test: `test/tasks.test.mjs`

**Steps:**
1. 写状态转移、日期快捷范围、负责人/创建者/标签筛选测试。
2. 实现看板、列表、泳道三种真实视图。
3. 实现分组、排序、卡片字段开关和任务详情抽屉。
4. 创建任务支持工作区、数字伙伴、富文本说明、附件元数据和校验。
5. 验证创建、移动、阻塞、取消、刷新恢复和审计记录。

### Task 4: 完成主页、聊天和收件箱

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Create: `backend/migrations/notifications.sql`
- Test: `test/inbox.test.mjs`

**Steps:**
1. 建立 Conversation、Message、Notification 数据表和 API。
2. 新对话弹窗支持选择数字伙伴、附件、发送/禁用状态和历史。
3. 收件箱支持未读、全部已读、归档、恢复。
4. 主页快速入口写入任务或打开对应页面。
5. 验证空、加载、失败、成功四种状态。

### Task 5: 完成自动化页面和执行记录

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/api.js`
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Modify: `backend/db.mjs`
- Test: `test/automations.test.mjs`

**Steps:**
1. 建立 `/test-111/autopilots` 路由和模板数据。
2. 创建表单支持 Markdown 说明、执行者、输出模式、时间表、Webhook 和时区。
3. 增加启用、暂停、编辑、删除、手动执行和 execution log。
4. 保存 cron 解析结果和 next_run，不把模板硬编码在组件中。
5. 验证非法计划、Webhook 重复事件和失败重试。

### Task 6: 完成日历月/周/日和事件联动

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/api.js`
- Modify: `backend/repository.mjs`
- Test: `test/calendar.test.mjs`

**Steps:**
1. 保留动态 5/6 行月格，补周视图和日视图。
2. 实现显示任务、仅显示人类任务、任务筛选和项目勾选。
3. 支持从日期格新建任务/事件并回写任务 due_date。
4. 加入时区和当前日期状态。
5. 验证任务在任务页和日历页双向可见。

### Task 7: 完成文档和资源同步

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/api.js`
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Modify: `backend/db.mjs`
- Test: `test/documents.test.mjs`

**Steps:**
1. 文档上传改为 multipart/二进制元数据保存，保留 Markdown 文本编辑。
2. 补打开、下载、重命名、移动、删除恢复、文件夹折叠和行菜单。
3. 增加版本和大小校验，超过配额返回明确错误。
4. 增加 Git HTTPS/SSH 资源同步源的增删改、分支和失败状态。
5. 验证树结构、搜索、刷新、权限和审计。

### Task 8: 完成自有设备、安装引导和运行时

**Files:**
- Create: `scripts/ziwei-cli.mjs`
- Create: `scripts/install-ziwei-user.ps1`
- Create: `scripts/install-ziwei-user.bat`
- Modify: `daemon/ziwei_user.mjs`
- Modify: `frontend/src/App.vue`
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Test: `test/daemon.test.mjs`

**Steps:**
1. 提供 `ziwei setup` 等价的本地配置入口，写入 `data/ziwei_user.json`。
2. 提供 Windows PowerShell/cmd 安装脚本，安装后输出启动、健康检查和卸载命令。
3. 添加设备向导显示当前工作区命令、复制按钮、等待上线和失败重试。
4. 增加设备重命名、删除确认、在线/异常/离线统计。
5. 只使用 `ziwei_user` heartbeat 判断健康；验证停止 daemon 后 45 秒内变离线，重新启动后恢复在线。
6. 保留每个 Claude/Codex/Gemini/Hermes 自己的 CLI 版本探测，桥接器版本单独展示。

### Task 9: 完成数字员工创建闭环

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Modify: `backend/db.mjs`
- Test: `test/employees.test.mjs`

**Steps:**
1. 增加头像上传/移除、岗位说明编辑器、模型来源和技能选择。
2. 运行时离线时明确阻止创建并显示原因。
3. 增加伙伴市场空、加载、错误和模板选择状态。
4. 创建后在组织树和运行时行显示绑定关系。
5. 验证工作区/个人可见性和重复提交幂等。

### Task 10: 完成技能安装来源和回滚

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Modify: `backend/db.mjs`
- Create: `backend/skills/validator.mjs`
- Test: `test/skills.test.mjs`

**Steps:**
1. 添加技能入口：数字伙伴创建、URL 导入、zip 上传、工位复制、平台发现。
2. 校验 `SKILL.md`、版本、SHA-256 和来源。
3. 实现安装、重装、卸载、解除员工绑定和失败回滚。
4. 保留平台/团队 tab、搜索、分类、推荐、安装次数。
5. 验证重复安装、非法包、缺少 `SKILL.md` 和卸载回滚。

### Task 11: 完成设置、Token 和权限

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/api.js`
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Modify: `backend/db.mjs`
- Test: `test/settings.test.mjs`

**Steps:**
1. 补工作区描述、上下文、可见性、前缀和配额。
2. 补个人资料、偏好、主题和完整时区。
3. 实现访问密钥创建、哈希存储、一次明文显示、过期和撤销。
4. 加入 Owner/Admin/Member 权限中间件。
5. 验证越权请求、撤销即时性和日志脱敏。

### Task 12: 完成邀请、积分和开放平台

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/api.js`
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Modify: `backend/db.mjs`
- Test: `test/invite-open-platform.test.mjs`

**Steps:**
1. 实现邀请码、邀请链接、邀请记录和积分流水。
2. 生成三种邀请海报的可下载文件，支持分享前预览。
3. 开放平台补 REST/A2A/Token 说明、GitHub/ClawHub/OpenClaw 外链和复制提示词。
4. 所有外部跳转和 Token 复制都显示可见反馈。
5. 验证积分归因、撤销和外部链接参数。

### Task 13: 完成后端 A2A、实时状态和可观测性

**Files:**
- Modify: `daemon/ziwei_user.mjs`
- Modify: `src/daemon.mjs`
- Modify: `backend/app.mjs`
- Modify: `backend/repository.mjs`
- Create: `backend/realtime.mjs`
- Test: `test/a2a.test.mjs`

**Steps:**
1. 增加 register、poll、ack、result、dedupeKey 和 action 过期协议。
2. 实现 WebSocket 优先、HTTP fallback、指数退避和补偿同步。
3. 任务执行限制在注册 Runtime 和受控工作目录。
4. 为设备、任务、技能、文档和 Token 写审计事件。
5. 验证断线重连、重复 action、失败结果和心跳过期。

### Task 14: 视觉、权限和端到端验收

**Files:**
- Create: `test/e2e/aura-14-point.spec.mjs`
- Create: `docs/baselines/aura-14-point-report.md`
- Modify: `scripts/lint.mjs`
- Modify: `README.md`

**Steps:**
1. 每条路由分别验收空、正常、加载/失败、权限不足四种状态。
2. Playwright 覆盖登录/进入工作区、创建任务、创建设备、创建员工、安装技能、创建文档、自动化、Token、邀请和退出。
3. 做桌面端截图比对，检查侧边栏、快捷托盘、加号、弹窗、日历和文档树。
4. 扫描构建产物和日志，确认没有 Cookie、Token、密码、真实机器 ID。
5. 只有 14 点证据全部通过，才把复刻标记为完成。

---

## 本轮继续执行顺序

本轮先执行 Task 1、Task 2、Task 5、Task 8 的第一批可见缺口：

1. 补独立 `autopilots` 路由，避免自动化只存在于任务页弹窗。
2. 把工作流 toast 改成 Aura 风格“敬请期待”弹窗。
3. 补 `ziwei setup` 等价配置入口和 Windows 安装脚本骨架。
4. 补添加设备向导中的安装命令、复制和等待心跳状态。
5. 对这批变更跑 lint、单元测试、build，并用真实 `ziwei_user` 心跳验收。

后续按 Task 3 → Task 14 顺序推进，每个任务完成后更新本计划中的状态和证据。

## 2026-09-30 继续执行增量

- Task 7：对象存储、HTML 净化、Git 文档导出/导入已接入并通过 `test/storage-sanitize-git.test.mjs`；文档页按钮已做内置浏览器点击验收。
- Task 11/12：开放平台 API Key 已接入真实创建、一次明文显示、复制、轮换、撤销和脱敏列表；开放平台 REST 地址复制改为真实剪贴板操作。
- Task 4：数字伙伴创建弹窗的创建按钮现在创建真实任务并刷新任务数据；附件入口给出明确任务详情入口提示。
- 浏览器修复：窄窗口下快捷托盘与文档操作栏发生命中遮挡，已通过窄屏定位和操作栏层级修复，并在 5178 实例复测导出 Git 弹窗。
- 验证：`npm test` 59/59、`npm run lint`、`npm run build` 通过。14 点仍不能标记全部完成，剩余项见 `HANDOFF.md`。


## 2026-09-29 当前进度

- Task 1：已补独立自动化路由映射与独立管理工位路由；跨页基线和端到端路由测试仍待补。
- Task 2：已把工作流改为真实“敬请期待”弹窗，语言菜单补齐四种语言；本机离线时首页会显示安装并连接 ziwei_user 的入口；托盘拖动、审批和完整新对话仍待实现。
- Task 4/5：已补自动化模板、启停、立即运行、运行记录、删除、中文计划和五段 cron 解析、A2A 调度动作、失败重试和结果回写；现已增加 webhook 密钥/HMAC-SHA256 签名、持久化投递队列、HTTP 推送、指数退避和投递结果查询。
- Task 7：文档新增打开/编辑/保存/下载/递归删除、二进制元数据、回收站和版本历史/恢复接口；外置对象存储和 Git 同步仍待实现。
- Task 8：已补 `ziwei_user` setup/status/version CLI、PowerShell/cmd 安装脚本、Web UI OS 安装命令和独立“管理工位”页；首页首次检测到离线会自动打开安装引导，安装脚本会复用或后台启动 daemon 并等待 ready，安装命令会携带当前紫薇 API 地址；未写配置文件时 status 也会探测默认本机 health，登录态自动下载、开机自启和设备删除/权限仍待实现。
- Task 13：新增持久化 A2A action 队列、register/poll/ack/result、dedupeKey、过期状态、指数退避和自动化结果回写；调度器现在扫描所有持久化工作区而非固定 `test-111`，并按每个自动化的 timezone/next_run 计算 cron；当前实时边界为 SSE，WebSocket 和受控执行目录仍待实现。
- Task 6：日历单元格加号和快捷托盘已改为按日期创建任务，截止日期会回写任务并出现在月/周/日视图；独立事件、时区、拖拽和外部日历同步仍待实现。
- Task 3：任务页已补成员/数字伙伴、状态、优先级、搜索筛选，真实看板/列表/泳道视图和任务详情弹窗；详情支持标题、描述、状态、优先级、截止日期、负责人编辑，以及任务消息读取/添加。后端新增任务 PATCH 和消息读取接口，并加入生命周期回归测试；富文本、附件、创建者筛选和审计细节仍待补齐。
- Task 2/13： 首页“通过数字伙伴创建”现在会创建真实任务；收件箱已接入通知表、未读持久化、全部已读、归档、会话消息和 SSE 实时边界。附件内容上传和完整对话 UI 仍待补齐。
- Task 11：API Key 已改为哈希存储、创建时一次显示明文、列表脱敏、过期、撤销和轮换；外部 API 已增加 Bearer/X-Ziwei-Api-Key 鉴权中间件，设置已持久化 profile/preferences 并支持角色检查。完整资源矩阵仍待实现。
- Task 14 前置：新增文档 CRUD、自动化生命周期、A2A action、API Key 和心跳语义回归覆盖；覆盖离线、过期、未来时间戳、设备隔离和 CLI 版本来源。
- 验证：`npm run lint`、`npm test`（30/30）、`npm run build` 已通过；真实 `ziwei_user` `/healthz`、`/readyz`、后端心跳、运行时版本、自动化 API、A2A action、API Key、邀请和技能导入全链路均已实机核验。`npm run ziwei:start` 已验证可复用在线 daemon。



- Task 12（邀请生命周期）：已新增 SQLite invitations 表与生命周期 API（创建、列表、重发、撤销、过期、按邀请码查询、接受并幂等创建成员）；邀请码只保存 SHA-256，创建/重发响应一次返回链接。邀请页已显示状态、有效期、重发次数，支持生成/复制链接、重发和撤销；`/invite?workspace=...&code=...` 有接受邀请页。验证：`node --test test/invite-lifecycle.test.mjs`（2/2）、`npm test`（30/30）、lint/build 通过。
- Task 10（技能导入与校验）：已新增 SKILL.md 本地文件/粘贴/HTTP(S) URL 导入入口；服务端解析 front matter、标题、描述、分类、标签和语义化版本，计算 SHA-256、检测重复导入并持久化来源/内容/校验状态/失败原因。校验失败的技能保留在团队目录且禁止安装；新增导入 API、版本快照、卸载解绑和回滚 API；zip、工位复制仍待实现。
- 本轮 daemon 安装验收：Windows PowerShell 安装脚本已实测完成 setup、复用在线 `ziwei_user`、ready 检查；前端安装命令会带上当前 API 地址，避免云端页面把心跳误发到本机回环地址。文档版本历史创建/更新/恢复和外部 API 未授权/授权/撤销也已用真实 4178 端口验收。

## 2026-09-30 本轮补齐与证据

- Task 4/5/13：自动化现在按可识别的“每小时/每天/每周/间隔/基础 cron”计算 `next_run`；生产 `createApp` 默认启动 unref 本地调度器，调度会创建 `automation.execute` A2A action。daemon 回传 action result 后会把运行记录写成 `completed`/`failed`，失败按指数退避安排有限次数重试，并回写 result/error/attempt/next_retry_at/action_id。
- Task 4/13：通知从审计事件派生为独立 SQLite 表，持久化 `read_at`/`archived_at`，支持未读统计、批量已读、归档恢复和 `/notifications/stream` SSE 边界；会话、消息和附件元数据已持久化并提供创建、读取、发送、归档 API。前端连接 SSE，收到事件后刷新未读状态。
- Task 7：文档增加 mime/storage/checksum/encoding 元数据；删除改为可恢复回收站，支持递归恢复、回收站列表、二进制下载和版本历史兼容。原有文本编辑接口保持可用。
- Task 10：技能安装时记录版本快照；新增卸载（同时解除数字员工绑定）、版本列表和回滚 API，前端对导入技能显示卸载入口。
- Task 11：工作区设置新增描述、上下文、可见性、前缀、配额、profile/preferences 持久化；请求可通过 `X-Workspace-Role`（owner/admin/member）执行角色检查；API Key 增加 role、轮换接口，旧 key 即时撤销，新 Token 只返回一次。前端设置页加入轮换入口。
- 验证证据：`npm test` 33/33、`npm run lint`、`npm run build` 均通过；新增 `test/completion-gaps.test.mjs` 覆盖调度/重试/结果回写、通知/会话、二进制回收站、技能卸载回滚、设置权限和密钥轮换。真实 `ziwei_user` `0.1.0` 进程 PID 39492 在 `20242` 提供 `/healthz`，日志持续写入 `.local/logs/daemon.log`，后端/前端健康检查通过。
- 仍待完成：WebSocket（当前为 SSE）、对象存储外置、Git 同步、完整 Owner/Admin/Member 资源矩阵、受控执行目录和 Playwright 14 点 E2E；因此不能把 14 点标记为全部完成。

### 2026-09-30 Task 4/5/13 收尾证据

- `webhook_deliveries` SQLite 表持久化 URL、事件、请求体、签名、尝试次数、下次重试时间、响应和最终失败原因；自动化可传入 `webhookUrl`/`webhookSecret`，未提供密钥时服务端生成随机密钥，创建响应仅返回一次密钥，后续 API 只返回是否已配置。
- 完成或失败的 automation run 以稳定 JSON 生成 `X-Ziwei-Signature: sha256=...`、事件和 delivery headers，并通过 HTTP POST 推送；重复 A2A result 和重复 run/event 不会产生重复投递。失败按指数退避，达到上限后保留 `failed` 和错误结果，可从 `/api/automation-runs/:id/webhooks` 查询。
- cron 支持五段表达式的通配符、列表、范围和步长，按自动化 timezone 计算下一分钟；中文每小时/每天/每周/间隔计划继续兼容。调度器遍历 `workspaces` 表，每次 tick 只消费已到期的持久化 `next_run`。
- 新增 `test/webhook-scheduler.test.mjs` 覆盖 cron 持久化/非法表达式、签名校验、HTTP 推送和幂等投递；`npm test`（42/42）、`npm run lint`、`npm run build` 通过。

## 2026-09-30 Task 14 验收基线

- 新增 `docs/baselines/aura-14-point-baseline.json`，固定 14 点模块、路由、UI contract、HTTP contract、状态和证据文件；新增 `docs/baselines/aura-14-point-report.md` 记录运行方式、结果和限制。
- 新增 `test/routes.test.mjs`：检查 14 点路由矩阵、App render 分支、WorkspaceShell 全局导航/语言/帮助、任务/日历/文档/团队/技能/设置/邀请/开放平台/收件箱关键按钮文本，并明确未知路径行为。
- 新增 `test/e2e/aura-14-point.spec.mjs`：Playwright 未安装时的 Node HTTP fallback，在内存 SQLite 和临时端口中验收任务→日历、文档 CRUD/版本/回收站、团队设备/心跳/运行时/数字员工、技能导入安装卸载、自动化和 A2A ack/result、设置/API Key 轮换撤销、邀请接受、Agent Card、通知和会话。
- 新增测试结果：`node --test test/routes.test.mjs test/e2e/aura-14-point.spec.mjs` 为 **6/6 通过**；随后 `npm test` 为 **43/43 通过**，`npm run lint` 与 `npm run build` 通过。该测试不连接、不重启现有服务；Playwright、真实浏览器点击/截图/剪贴板/拖动、每路由四态、未知路径专用空状态、WebSocket、外部 Webhook/对象存储/Git、多工作区 cron、设备删除重命名和完整角色矩阵仍待补。

## 2026-09-30 Task 8/11 权限与设备收尾

- Task 8：设备资源新增重命名、停用/启用、删除接口；停用设备的心跳不会重新唤醒，重命名会在后续 `ziwei_user` 心跳中保留。管理工位页面已接入重命名、停用/启用和删除确认操作。
- Task 11：新增统一 Owner/Admin/Member 资源权限矩阵接口；`/api` 资源路由统一执行角色检查，API Key 角色不能被请求头覆盖，工作区设置和 API Key 读取也受管理员权限保护。新增设备与资源矩阵回归测试。
- 验证证据：`npm test` **43/43**、`npm run lint`、`npm run build` 均通过；未重启现有服务。

## 2026-09-30 继续补齐 UI 链路与最终验收

- Task 1/2：快捷托盘支持指针拖动位置；未知地址显示专用空状态；首页数字伙伴创建同时落会话消息和任务；收件箱新增通知归档、会话列表、消息读取/发送/归档。
- Task 6/7：文档页接入回收站列表与恢复按钮，继续保留二进制下载、版本历史和递归恢复接口。
- Task 11：设置页接入描述、上下文、可见性、API 前缀、配额、个人资料和语言/主题/周起始日偏好保存。
- Task 12：邀请页加入积分视图、流水视图、分享文案复制和方形/横版/竖版海报下载；开放平台页加入 Webhook 配置提示、GitHub/ClawHub 外链和开发提示词复制。
- 真实实例重载后验收：`/healthz`、权限矩阵、设备、设置、会话接口均 HTTP 200；`ziwei_user` 心跳仍在线。
- 最新验证：`npm test` **43/43**、`npm run lint`、`npm run build` 均通过。
- 仍未达到“14 点全部完成”的项目：日历独立事件/拖拽/外部同步和时区编辑、任务富文本/附件/创建者筛选、技能 zip/工位复制、对象存储、Git 同步、WebSocket（当前 SSE）、受控执行目录、完整浏览器 Playwright 四态/截图验收。邀请积分目前由邀请记录计算展示，尚未单独持久化积分流水表。
