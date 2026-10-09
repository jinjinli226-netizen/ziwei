# 紫薇

紫薇是一个前后端分离的智能工作区原型，复刻了 AuraBaba 示例工作区的核心流程、任务、文档、运行时、技能、自动化和连接器流程。项目中的本机 daemon 由我们自己实现，服务名称是 `ziwei_user`。

## 维护与 AI 接手

开发、启动、架构、真实完成边界、扩展规范、故障排查、发布门槛和接手顺序统一维护在 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)；项目级变更摘要见 [CHANGELOG.md](CHANGELOG.md)。需要把项目交给新 AI 时，直接使用 [NEW_AI_SESSION_PROMPT.md](NEW_AI_SESSION_PROMPT.md) 中的提示词。任何 AI 接手项目时先读维护手册，再读本文件和 `HANDOFF.md`；不要只依据旧截图或历史计划判断当前状态。

## 邀请注册修复（2026-10-09 已上线）

当前主站为 `82c4f8e`，包含手机技能 `628482d`、管理 MCP 和团队卡片修复。个人与团队工作区的有效邀请都可注册加入，普通受邀者按邀请获得 member/admin；历史 Owner 不被降权。已有账号可在原邀请页切换登录并接受，当前会话立即可访问目标工作区。页面持续显示无效、过期、撤销、邮箱不匹配等具体错误；未知工作区且无邀请码会明确拒绝，不创建误填的工作区。

用户刷新原邀请链接即可重试。完整串行296/296、隔离邀请6/6、真实域名新上下文6/6和原手机/卡片/管理回归30/30通过；真实邀请未消费，独立QA已清理。仅主API重启，原数据、手机MCP路由、APK和旧hash资源保留。发布、备份与回滚见[邀请注册修复记录](docs/operations/2026-10-09-invitation-registration-fix.md)。

## 团队员工卡片重叠修复（2026-10-09 历史发布）

该次发布为 `dc39173`，已包含在当前版本中。团队卡片和设备下员工行展示两行岗位摘要，完整指令保留在员工详情与编辑表单；多排卡片会撑高组织图，避免覆盖下方 Agent 环境。覆盖 1440/2048/2549/390px 的 12 组隔离布局测试、真实线上 8 项检查，以及完整串行 235/235 均通过。本次仅更新前端，服务未重启。原因、发布与回滚见[修复验收记录](docs/operations/2026-10-09-team-card-layout-fix.md)。

## 管理 MCP 与正式员工搭建师（2026-10-09 已上线）

管理 MCP 实现为 `bef1944`，后续包含 profile 下拉框 Escape、员工页窄屏标题与团队卡片修复，控制服务仍为 `8a4fe59`。登录后打开 [`test_222 / 开放平台`](https://qzelynth.top/test_222/open-platform)，可以查看真实的 15 项管理工具、工作区、设备发现与安全 stdio 接入示例；员工详情的 MCP 页签显示该员工实际执行的握手及工具调用回执。

正式员工 **紫薇员工搭建师** 已在 `test_222` 创建并接入管理 MCP，runtime 为 Codex，模型 `gpt-6.1-sol`，绑定电脑 `zheng`，挂载真实的“员工搭建与只读验收”技能。可在[员工详情](https://qzelynth.top/test_222/employee/employee_eddccbcf-3faa-4f55-a2f9-a12de9c679fe)进入对话，例如：“在 zheng 创建一个 Codex 员工，职责是只读检查工作区状态，人格严谨直白，挂载员工搭建与只读验收技能，启用管理 MCP，安排一次只读验收并回读结果。”如需 Hermes，将 runtime 明确写为 Hermes 并要求新建独立 profile；搭建师会先发现设备、CLI、认证/provider、profile 和技能，条件缺失时返回具体错误。

本轮由搭建师的真实模型通过 MCP 创建两名带 QA 名称的员工，各重试一次返回相同 ID；Codex 与独立 Hermes profile 的首次任务和 daemon 刷新后任务均真实 `succeeded`，都有本次 stdio 握手、health/list 工具成功及结果标记。全套串行测试 235/235、lint/build、隔离 UI 6/6、真实域名 1440/390 px 验收通过。完整 IDs、版本、证据、边界及回滚见[最终验收记录](docs/operations/2026-10-09-management-mcp-acceptance.md)。

管理 MCP 以 `scripts/ziwei-mcp.mjs` 提供 **stdio** 服务，内部经 HTTPS 请求 `/mcp/v1`；该 HTTP 管理 API 地址不能填作远程 MCP transport URL。MCP bearer、普通 API Key、设备凭据相互独立。真实 daemon 的私有 `managementMcp` 配置保存专用 token 文件路径，凭据不进入员工人格、提示词、命令行参数、前端或 Git。仅 Codex/Hermes 完成本轮实际管理 MCP 验收；其他 CLI 的发现状态不代表已完成认证或工具调用验收。手机执行、绑定和旧手机 MCP 配置不属于本轮通过范围。

## 紫薇·互联 Android 安装页（已上线并完成真实域名验收）

安装页公开路径为 [`https://qzelynth.top/android-install`](https://qzelynth.top/android-install)，无需登录；登录主站后，“系统 → 紫薇·互联”标题栏新增“安装手机端”入口。安装页可以返回当前工作区的手机管理，扫码入口则使用不含会话或凭据的固定公开地址。

页面分别提供“紫薇 Agent（手机操作）”和“紫薇 Updater（更新与维护）”下载，版本、大小和具体 APK 来自当前 `/downloads/android/index.json` 及其发布 manifest，按发布数据选择最新版本，不固定某个历史版本。二维码由本地脚本生成，不调用第三方服务。首次在同一台安卓手机安装两个应用并确认必要系统权限，在两应用“连接配置”的“HTTPS 中控根地址”填写 `https://qzelynth.top`，使用相同手机名分别点击“申请入网权限”；管理员回主站“待审核入网”批准，显示在线后绑定已有数字员工。后续更新继续使用原中控流程。

本轮基于 `c91f331`（包含 `a625350` 完整终端控制台）开发，仅变更前端与验证工具，不修改后端认证或手机协议。完整串行测试 207/207、lint/build、安装页浏览器 9/9、原终端浏览器回归 6/6 均通过。提交 `81b6ec8` 已于 2026-10-08 22:23（北京时间）上线，生产安装页在 390/1440px 匿名访问、真实发布数据、二维码解码、复制地址、主站入口及返回管理均已验证；两个 APK 的实际下载大小与 SHA-256 匹配清单。保留既有 APK、控制服务、数据与旧版 hash 资源，本次没有重启服务。未在真实手机执行安装或授权。详见 [本轮实施与验收记录](docs/plans/2026-10-08-android-install.md)。

## 已实现

- Vue 3 + Vite 前端，使用本地 `@ziwei/ui@0.1.1` 组件包。
- Express 5 独立后端，API 监听 `127.0.0.1:4178`。
- Node 24 内置 SQLite，数据库文件为 `data/ziwei.sqlite`。
- A2A v1 Agent Card、Task、Task list、Message、状态查询接口。
- 邀请成员、登记设备、创建数字员工和自动化会真实写入 SQLite。
- `daemon/ziwei_user.mjs` 本机 daemon：心跳、A2A 任务轮询、本地健康检查。
- 独立诊断日志：`.local/logs/backend.log`、`frontend.log`、`daemon.log`、`health.log`。

## 启动

```powershell
npm install
npm test
npm run build
npm run dev       # 前端 + 后端
npm run daemon    # 单独启动 ziwei_user daemon
npm run ziwei:setup -- --workspace <workspace-slug> --api http://127.0.0.1:4178 --health-port 20242
npm run ziwei:status # 查看本机 ziwei_user 配置和健康状态
npm run ziwei:version
npm run ziwei:start  # 已配置时复用现有进程，否则后台启动 ziwei_user
npm run mcp:token -- --workspace bjc-ops  # 生成工作区限定的 MCP bearer 文件
npm run mcp:manage -- --api-base http://127.0.0.1:4178 --workspace bjc-ops --token-file data/mcp.token  # 以 stdio MCP 服务运行
npm run diagnose  # 单次健康检查
```

`npm run dev` 启动前端 `5178` 和后端 `4178`；daemon 健康接口使用 `20242`。参考 AuraBaba daemon 已占用 `20241`，紫薇不会抢占它。

## 验收环境边界

- **本地代码验收**：项目 checkout、本地前端 `5178`、本地 API `4178`、单元/API 测试和浏览器回归使用项目 `data/ziwei_user.json` 的 `bjc-ops` 工作区。需要运行项目 daemon 时，只使用项目入口并先核对该配置；它代表本地代码环境。
- **真实服务器 daemon/A2A 验收**：使用全局 `D:\work\nodejs\node_global\ziwei_user`，读取用户配置 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json`，目标服务器 API 为 `https://qzelynth.top`，工作区为 `test_222`。先核对 `ziwei_user status --json` 和 `http://127.0.0.1:20242/readyz` 的工作区身份。
- `npm run daemon`、`npm run ziwei:start` 和项目 `data/ziwei_user.json` 不得用于冒充或替代 `test_222` 的服务器证据；不要为了服务器验收启动项目 daemon、切换项目配置或把令牌写入日志。

## ziwei_user 设备连接

创建工作区和管理项目不需要先连接设备。只有要让某台电脑运行数字员工时，才在网页的“添加设备”里生成一次性配对码。`ziwei_user` 在每台电脑上只需安装一次；后续给同一台电脑连接新的工作区时，直接运行 `connect` 和 `start`，不要重复执行 `npm install`。

```powershell
npm install --global "https://github.com/jinjinli226-netizen/ziwei/archive/refs/heads/codex/ziwei-terminal-console.tar.gz"
ziwei_user connect --api "https://qzelynth.top" --code "<网页生成的一次性配对码>" --name "我的电脑"
ziwei_user change
```

上面第一行只在这台电脑第一次安装时执行；如果 `ziwei_user version` 已经能返回版本号，就跳过第一行。`--name` 是网页设备目录中的显示名称，例如“办公室电脑”，不代表远程账号或新的 Agent。`connect` 会保存新工作区的配对凭证；`change` 会检查 20242 上是否有旧的 `ziwei_user`，在确认它是本 daemon 后停止旧进程，再启动当前配置，因此切换工作区不需要手动找 PID，也不需要重新安装 npm 包。第一次没有旧 daemon 时，`change` 也可以直接启动；`ziwei_user start` 仍可作为只启动命令。配置、日志和运行时状态写入用户目录，不依赖项目源码目录，也不会安装网页前端依赖。每个工作区都要使用自己的网页一次性配对码；当前 daemon 配置同时只激活一个工作区，切换工作区前应先在网页确认目标工作区，避免把心跳发到错误工作区。正式 HTTPS 域名不需要下载证书；只有私有证书或本地地址才需要在 `ziwei_user setup` 中通过 `--tls-ca-file` 指定公钥证书。

## API 入口

- `GET /healthz`
- `GET /server.crt`（下载配置的公开服务器证书，不需要登录）
- `GET /api/workspaces`、`POST /api/workspaces`（登录用户列出/创建项目；创建后访问 `/<slug>/<page>`）
- `GET /api/workspaces/<workspace-slug>/summary`
- `GET|POST /api/workspaces/<workspace-slug>/tasks`
- `PATCH /api/tasks/:id`、`GET|POST /api/tasks/:id/messages`
- `POST /api/tasks/:id/state`
- `GET|POST|PATCH|DELETE /api/workspaces/<workspace-slug>/automations`（模板、运行记录和执行接口见 `/api/automations/:id/*`）
- `GET|POST|PATCH|DELETE /api/workspaces/<workspace-slug>/documents`（单文档操作使用 `/api/documents/:id`）
- `GET|POST /api/workspaces/<workspace-slug>/members`
- `GET|POST /api/workspaces/<workspace-slug>/devices`
- `POST /api/workspaces/<workspace-slug>/heartbeat`（仅接受 `ziwei_user`，用于设备与运行时健康链路）
- `GET|POST /api/workspaces/<workspace-slug>/api-keys`、`POST /api/api-keys/:id/revoke`、`POST /api/api-keys/:id/rotate`
- `GET|POST /api/external/workspaces/:slug/*`（需要 `Authorization: Bearer zwi_...` 或 `X-Ziwei-Api-Key`）
- `GET|POST /api/workspaces/<workspace-slug>/notifications`（支持 `unread`/`archived`、未读统计和已读；`/notifications/ws` 优先使用 WebSocket，`/notifications/stream` 提供 SSE fallback）
- `GET|POST /api/workspaces/<workspace-slug>/conversations`、`GET|POST /api/conversations/:id/messages`（新对话、消息和附件元数据）
- `GET|POST /api/workspaces/<workspace-slug>/skills`、`PATCH /api/skills/:id`
- `POST /api/skills/:id/uninstall`、`GET /api/skills/:id/versions`、`POST /api/skills/:id/rollback`
- `GET|POST /api/workspaces/<workspace-slug>/employees`
- `GET|POST /mcp/v1/workspaces/<slug>/employees`、`PATCH /mcp/v1/workspaces/<slug>/employees/:id`（独立 MCP bearer 令牌）
- `GET|POST /mcp/v1/workspaces/<slug>/tasks`、`GET|POST /mcp/v1/workspaces/<slug>/documents`（同一工作区限定令牌）
- `GET /a2a/v1/agents`
- `POST /a2a/v1/register`
- `GET|POST /a2a/v1/actions`、`POST /a2a/v1/actions/:id/ack`、`POST /a2a/v1/actions/:id/result`
- `GET|POST /a2a/v1/tasks`
- `GET /a2a/v1/tasks/:id`
- `POST /a2a/v1/tasks/:id/messages`

A2A 注册、轮询和任务接口都要求显式传入 workspace；服务端不会把请求落到历史示例工作区。

首次初始化只创建本地账号，不会自动创建或加入 `test-111`。登录后必须在页面选择“新建工作区”，显式创建个人或团队工作区；普通注册则会自动创建独立个人工作区，加入已有团队必须使用有效邀请。

设备与运行时在线状态只由 `ziwei_user` daemon 的心跳决定。超过心跳有效期的设备和运行时会自动显示为离线；AuraBaba 或其他参考 daemon 的进程状态不会参与紫薇页面健康判断。

MCP 管理入口使用独立的 `data/mcp.token` 凭据文件（可用 `ZIWEI_MCP_TOKEN_FILE` 指定路径），文件内必须同时保存 bearer token 和 `workspaces` 工作区白名单。`npm run mcp:token -- --workspace <slug>` 会生成权限最小化的文件；文件和 token 不提交到 Git，也不写入日志。MCP 客户端通过 HTTPS 调用 `/mcp/v1`，服务器路由只调用 repository，不向客户端暴露 SQLite。

## 命名约定

产品/工作区叫“紫薇”，本机连接 daemon 服务叫 `ziwei_user`，`test-111` 仅作为历史/测试兼容工作区示例，账号注册不会默认加入它；实际工作区必须来自当前会话与成员关系。任何访问令牌、Cookie、Authorization 和密码都不能写入日志或提交到仓库。

## 界面约定

页面布局、导航层级、操作位置和流程参考 AuraBaba；配色、字体、Logo 和基础组件使用紫薇自己的品牌与 `@ziwei/ui`。保持浅色背景，主操作和选中态使用紫薇的蓝色主色令牌，成功与告警色沿用组件库语义色。

## 还未接生产的部分

生产 PostgreSQL/Redis、云端 OAuth、外部对象存储、真正的任务执行沙箱、队列、计费和伙伴市场仍保留在适配边界中；本地 SQLite 已支持 API Key 轮换、A2A action 重试、通知 WebSocket（SSE fallback）、Webhook HMAC 签名与重试、文档回收站和技能回滚。远端 Git 同步按当前范围保留本地 Git 导入/导出，暂不连接远端仓库。

## 紫薇·互联手机终端管理

登录主站后，在目标工作区左侧“系统 → 紫薇·互联”进入完整终端控制台；手机工作区的正式入口为 `https://qzelynth.top/phone_ai/ziwei-connect`。Owner/Admin 使用现有主站登录即可审批手机，不需要另登录原中控。

- 手机双端填写 `https://qzelynth.top` 并申请入网后，在页面上方“待审核入网”查看名称、Agent/Updater 角色、版本和有效期，批准或拒绝；批准后双端通过原配对协议自动取得各自配置。
- 左侧选择手机，右侧查看双端健康、心跳与错误、截图及原尺寸坐标操控、控制端切换/暂停、完整命令回执与人工核实、已发布 APK 和升级事务、归档。
- “登记手机”保留手动登记和双角色 JSON 配置下载；当前手机详情可绑定工作区内已有数字员工与外部账号，不创建额外数字员工。
- 主站代理入口为 `/api/workspaces/:slug/ziwei-connect/terminal/android-devices/*`。生产默认经 `http://127.0.0.1:5191/api` 连接原服务；手机状态、入网申请、命令、升级和截图仍由原服务持久保存，主站只保存员工绑定和运行记录。
- 隔离回归：构建后运行 `node scripts/verify-ziwei-terminal-ui.mjs`；真实源协议回归运行 `node scripts/verify-ziwei-terminal-protocol.mjs <原中控源码目录>`。两者均不操作真实手机；域名只读浏览器验收使用 `scripts/verify-ziwei-terminal-live.mjs --session-file <私密短期主站会话文件>`。

## 许可证

本项目以 MIT 许可证发布，详见 [LICENSE](LICENSE)。




