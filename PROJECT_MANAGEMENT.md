# 紫薇项目管理与 AI 接手手册

> **唯一维护入口**：本文是紫薇项目的当前状态、开发约定、运维流程和 AI 接手说明。
>
> **项目目录**：`D:\灵光爸爸拆解`
>
> **文档状态**：以 2026-10-06 工作区实际代码和服务器发布状态为准；每次结构、运行方式或功能边界发生变化时必须更新本文。

> **当前工作区边界（2026-10-06）**：本地 checkout、本地 API/前端和项目 `data/ziwei_user.json` 属于 `bjc-ops` 的本地代码验收环境。真实本机 daemon 由全局 `D:\\work\\nodejs\\node_global\\ziwei_user` 启动，使用用户目录配置 `C:\\Users\\25941\\AppData\\Local\\Ziwei\\ziwei_user\\ziwei_user.json`，连接服务器 API `https://qzelynth.top` 的 `test_222` 工作区。不要把项目 `data/ziwei_user.json` 的 `bjc-ops` 配置或项目 daemon 当成服务器 daemon；开始操作前分别核对对应配置、端口和 `/readyz`。

> **版本事实**：通用四 Agent daemon 配对改动位于分支 `codex/hermes-independent-profile`（分支名沿用历史命名）；服务器当前已部署提交 `d67d890`，生产 Git `main` 仍保持不变。工作树仍保留既有未跟踪临时文件 `tmp_gzgov.html`。不要在未审查 `git status --short` 前执行 reset、clean 或覆盖式 checkout。

### 2026-10-06 本机 ziwei_user 更新（已完成）

- 问题归属：本机 CLI/daemon。原 20242 进程来自全局旧包，不能执行新的 `directory.inspect` A2A 动作；更新前已读取配置并确认工作区为 `test_222`，没有切换工作区或覆盖设备凭证。
- 更新操作：确认旧 PID 22660 的命令行确实属于 `ziwei_user` 后停止；使用当前 checkout 执行 `npm install --global --omit=dev --force .`，再运行 `ziwei_user start`。当前 daemon PID 33960，监听 20242，配置和工作区仍为 `test_222`。
- 真实验证：`/readyz` 返回 `ready=true`、工作区 `test_222`、4 个 Agent 环境在线；通过服务器 A2A 发起真实 `directory.inspect`，目标电脑返回 `C:\Users\25941` 存在，动作状态为 `succeeded`。随后通过同一链路执行 `hermes.profile.create`，结果为 `succeeded`。
- 回滚依据：本次只替换全局 daemon 包，未改本机配置文件；回滚时停止当前 daemon，重新安装旧提交的 daemon 包并启动原配置。服务器数据库备份和代码回滚记录见下方发布条目。

### 2026-10-06 当前本地代码与服务器 daemon 验收边界

- 本地代码环境：checkout、5178 前端、4178 API 和项目 `data/ziwei_user.json` 固定使用 `bjc-ops`，本地单元/API 测试也以此环境为边界。
- 真实服务器 daemon：使用全局 `ziwei_user` 命令、用户目录配置和已有设备凭证，工作区为 `test_222`，API 为 `https://qzelynth.top`，健康端口仍为本机 `20242`；不得改写项目配置、重新配对或把凭证写入日志。
- 当前真实链路：`ziwei_user status --json` 报告 `test_222`、`ready=true`；服务器 heartbeat 和 A2A poll 成功。`directory.inspect` 元数据动作返回 `succeeded`，目标 `C:\Users\25941` 存在且为目录，未读取文件内容。第一次带根盘扫描的验收动作超时后明确标记为 `failed`，没有改报成功。
- 远程 workspace 隔离：使用 `test_222` 设备凭证查询正确工作区任务详情返回 200，改用 `bjc-ops` 返回 401；action 事件读取同样为正确工作区 200、错误工作区 401。

### 2026-10-06 A2A 活动超时与 Hermes provider 继承（已发布）

- 问题归属：daemon 超时策略、A2A 执行租约、Hermes 本机 profile 初始化和运行时错误可读性。实证 action `action_10891d73-60d5-4223-be18-3a9d7c732d27` 持续产生 20,544 B 输出后仍被固定 600000ms 计时器中止；`test333` 失败的直接原因是 profile 没有连接任何 provider。
- 修复内容：默认运行时动作取消固定总时长，只保留无活动 watchdog；进度/阶段/输出会刷新 daemon watchdog 和服务器 `expires_at`。显式 `timeoutMs` 仍可设置硬上限。新 Hermes profile 默认在目标电脑本机继承主 profile 的 `auth.json`、`config.yaml` 和 `.env`，保持独立 `SOUL.md` 和 profile 目录；CLI 非零退出会附带经过脱敏的首条诊断。
- 验证：完整 `npm test` 159/159、`npm run lint`、`npm run build` 均通过；本机真实 Hermes 调用返回 `PROFILE_PROVIDER_OK`，服务器 A2A `directory.inspect` 和 `hermes.profile.create` 均返回 `succeeded`。没有把旧失败记录改成成功。
- 服务器发布：提交 `d67d890` 已推送到 `origin/codex/hermes-independent-profile` 并快进 `/opt/ziwei`；部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261006T104830Z.before-d67d890`。补齐构建依赖后 `npm run build` 成功，`ziwei-api` active，公网 `https://qzelynth.top/healthz` 返回 200。
- 回滚方式：代码使用 `git revert d67d890` 后重新构建/重启；若需恢复数据，先停止 `ziwei-api`，恢复上述 SQLite 备份，再启动并检查 `/healthz`。本轮没有数据库 schema 变更。

### 2026-10-06 持久会话执行状态误报（已发布）

- 问题归属：会话 API/repository 的 A2A 执行状态选择。目录检查等辅助 action 也携带 `conversationId`，旧查询会把最新的 `directory.inspect` 成功结果误显示为“数字员工已完成”，而关联任务的 `task.execute` 仍在执行。
- 修复内容：会话执行状态只从 `task.execute` 或 `conversation.execute` 中选择最新 action；`directory.inspect`、Hermes profile 等辅助 action 不再覆盖主执行状态。任务板原有状态链路未改动。
- 验证：新增回归测试模拟“任务 action 为 acked、后续目录 action 为 succeeded”，会话仍返回任务 action 的 `acked` 状态；完整 `npm test` 155/155、`npm run lint`、`npm run build` 均通过。
- 发布状态：代码提交 `3d8c5a7` 已推送到 `origin/codex/hermes-independent-profile` 并快进 `/opt/ziwei`。部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261006T101651Z.before-3d8c5a7`；服务器构建成功并重启 `ziwei-api`，随后回环和公网 `/healthz` 均返回 200。
- 回滚方式：使用 `git revert 3d8c5a7` 后重新构建/重启；本轮不改 SQLite schema，无需数据库降级。保留已有未跟踪 `tmp_gzgov.html`。

### 2026-10-06 目标设备真实工作目录选择（已发布）

- 问题归属：会话前端、会话 API/SQLite、A2A 动作和目标电脑上的 `ziwei_user` daemon。此前工作目录只是文本输入框，网页无法确认路径是否存在，也不能区分“选择已有目录”和“创建新目录”。
- 修复内容：会话配置新增“选择目录”弹窗。网页先向当前会话的目标设备排队 `directory.inspect` action；目标 daemon 在自己的 Windows 电脑上扫描真实盘符、检查当前路径并只返回目录名，不读取文件内容。已有目录可直接选择；缺失路径只在用户点击“创建并使用”后由目标电脑显式递归创建；普通输入检查不会静默创建目录。目录结果回读前校验会话、工作区、用户和 action 类型，服务器不直接操作远程文件系统。
- API/实现：新增 `POST /api/conversations/:id/workdir/inspect` 和对应 action 查询接口；`src/local-action.mjs` 提供盘符、子目录和显式创建动作；目录 action 沿用设备凭证和 A2A ACK/结果回传链路。保存工作目录失败时弹窗保持打开，不显示静态成功。
- 本地验证：`test/directory-inspection.test.mjs` 覆盖真实临时目录、已有目录、缺失目录显式创建和文件路径拒绝；API 测试覆盖入队、目标设备、pending 到 succeeded 的结果回读；前端契约测试覆盖选择器和创建按钮。完整 `npm test` 154/154、`npm run lint`、`npm run build` 均已通过。浏览器验收使用真实 Windows 目标 daemon：确认 `D:\灵光爸爸拆解` 的盘符/子目录、缺失目录状态，并点击“创建并使用”后由目标电脑创建目录且重新打开仍显示已存在。
- 发布状态：提交 `3a8455a` 已推送到 `origin/codex/hermes-independent-profile` 并快进 `/opt/ziwei`；部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261006T095244Z.before-3a8455a`。服务器执行 `npm ci --ignore-scripts`、`npm run build` 成功，`ziwei-api` active；本机回环 `http://127.0.0.1:4178/healthz`、公网 `https://qzelynth.top/healthz` 和首页均返回 200。
- 未验证边界：不同目标电脑的权限、网络中断和路径 ACL 仍由目标操作系统决定；目录名之外的文件内容不会跨 A2A 返回。旧版全局 `ziwei_user` 会明确拒绝 `directory.inspect`，各目标电脑需要安装/更新到包含该动作的当前 daemon 后才能使用目录选择器；本机原有 20242 daemon 未被本轮切换。
- 回滚方式：使用本轮代码提交的 `git revert <commit>` 回滚前端、API、repository、daemon 和测试；本轮不改 SQLite schema，不需要数据库降级。服务器保留备份 `/opt/ziwei-backups/ziwei.sqlite.20261006T095244Z.before-3a8455a`；保留既有未跟踪 `tmp_gzgov.html`。

### 2026-10-06 Hermes Profile 与 Codex 风格会话工作区（已发布）

- 问题归属：前端会话配置、会话 API/SQLite、A2A/ziwei_user daemon 和 Hermes 本机 profile 写入。网页创建 Hermes profile 只提交一个带目标设备的 A2A action，由目标电脑上的 `ziwei_user` 写入自己的 `HERMES_HOME/profiles/<name>`；服务器不会直接写目标电脑文件，也不会把其他设备的 profile 混入当前设备。
- 修复内容：Hermes profile 创建支持设备选择、幂等请求、独立 `SOUL.md`/`MEMORY.md`/`IDENTITY.md` 文件，并按设备保存 runtime metadata；Profile 创建完成后 daemon 刷新本机发现结果。会话现在持久保存数字员工、目标设备、模型和工作目录，收件箱可切换目标设备/模型、使用设备当前目录或输入子目录，并可上传单个不超过 10 MiB 的附件。
- 附件链路：浏览器将附件作为真实 Base64 payload 发送到 A2A；目标 daemon 在所选工作目录下的 `.ziwei/attachments/<action>` 写入本地文件，再把真实路径提供给本机 CLI。未知 action、非法 Base64、超限内容和目标设备越权均明确失败，不返回静态成功。
- 本地验证：`npm test` 154/154、`npm run lint`、`npm run build`、真实内存 SQLite + `ActionDispatcher` + `createLocalActionExecutor` 的 Hermes Profile A2A 派发均通过；新增覆盖目标设备 profile 隔离、会话设备/模型/目录/附件 payload、附件落盘幂等、profile 文件落盘和目标设备真实目录检查。
- 未验证边界：未在浏览器中逐项点击验证附件选择器和真实四种 CLI 的附件读取；工作目录选择器的真实多盘符点击验收仍待浏览器环境，本地 daemon 单元/API 链路已覆盖。验收时本机前端 `5178` 和后端 `4178` 未监听；`data/ziwei_user.json` 指向 `bjc-ops`，但现有 `/readyz` 返回 `test_222`，没有在本轮擅自重启或切换本机 daemon。
- 服务器发布：提交 `d18121e` 已推送到 `origin/codex/hermes-independent-profile` 并快进 `/opt/ziwei`；部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261006T073416Z.before-d18121e`。服务器 `npm ci --ignore-scripts`、`npm run build` 成功，`ziwei-api` active；本机回环和公网 `/healthz` 均返回 200。
- 回滚方式：使用 `git revert d18121e` 回滚本轮 API、repository、daemon、前端和测试代码后重新构建/重启；SQLite 新增列和 `runtime_device_metadata` 表采用兼容迁移，不删除既有数据，异常时可先恢复上述备份。保留未跟踪 `tmp_gzgov.html`，不得用 reset/clean 覆盖。

### 2026-10-06 数字员工独立对话隔离（已发布）

- 问题归属：会话 API/repository 与收件箱前端。此前会话虽保存 `employee_id`，工作区列表仍把不同员工会话混在一起，响应也没有员工头像、运行时和执行归属信息。
- 修复内容：会话列表支持按 `employeeId` 查询并在 repository 层执行隔离；会话详情和列表返回明确的员工元数据（名称、头像、运行时、模型、profile）及执行活动关联。新建会话 API 必须绑定数字员工，发送消息始终使用会话持久绑定的员工。收件箱增加当前员工选择器，切换后重新加载独立列表；历史 `employee_id` 为空或指向已删除员工的记录进入“未绑定员工（历史会话）”隔离区，不能猜测归属、不能新建或发送消息。
- 本地验证：`npm test` 147/147、`npm run lint`、`npm run build`、`node --test test/daemon-link.test.mjs` 和 `git diff --check` 均通过；新增 API/repository 测试覆盖员工列表隔离、元数据、未绑定历史记录和缺少员工绑定时拒绝创建。
- 未验证边界：尚未在浏览器中逐页点击验收员工切换、头像渲染和窄窗口布局；生产数据库中的历史空归属记录尚未做只读盘点。A2A 真实本地 daemon 链路已通过，未做跨设备生产链路。
- 服务器发布：提交 `0568cbd` 已推送并快进 `/opt/ziwei`；部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261006T025833Z.before-0568cbd`。服务器 `npm ci --ignore-scripts`、`npm run build` 成功，`ziwei-api` active；本机回环和公网 `/healthz` 均返回 200，公网页面返回 200。安装依赖时 npm 报告 1 个 high severity audit 项，未在本轮擅自升级无关依赖。
- 回滚方式：使用 `git revert 0568cbd` 回滚 API、repository、前端和测试后重新构建/重启；本轮未修改 SQLite schema，回滚无需数据库降级。保留既有未跟踪 `tmp_gzgov.html`。

### 2026-10-05 设备安装方式按钮样式（已发布）

- 问题归属：前端设备 onboarding 样式。安装方式按钮缺少专用 CSS，浏览器显示成原生按钮；已选状态没有视觉反馈，容易误以为点击无效。
- 修复内容：为“电脑已安装 ziwei_user / 这台电脑第一次安装”增加分段按钮、hover、active、focus 和说明文字样式；不改配对逻辑或 daemon 行为。
- 本地验证：`npm test` 141/141、`npm run lint`、`npm run build` 均通过。
- 服务器发布：随提交 `8efd283` 推送并快进 `/opt/ziwei`；服务器构建成功并重启 `ziwei-api`，本机和公网 `/healthz` 均 200。

### 2026-10-05 daemon 工作区切换命令（已发布）

- 问题归属：CLI/daemon 生命周期。`connect` 更新了新工作区凭证，但旧 daemon 仍占用 20242，`start` 只能拒绝启动，用户需要手动找 PID。
- 修复内容：新增 `ziwei_user change`；它只在本地健康接口确认端口属于 `ziwei_user` 且能读取 PID 时停止旧进程，然后启动当前配置。没有旧进程时直接启动；其他服务占用端口时明确拒绝处理。不会重复安装 npm 包，也不改服务器数据库。
- 验证：CLI 测试覆盖“已是当前工作区”和“停止冲突 daemon 后启动新工作区”的真实本地链路。
- 服务器发布：CLI、README 与前端样式已随提交 `8efd283` 同步；服务器仅提供网页/API，目标电脑上的全局 CLI 需更新一次安装包后才有 `change` 子命令。

### 2026-10-05 同一台电脑重复配对说明（已发布）

- 问题归属：前端设备 onboarding 与 CLI 使用说明。复现确认设备弹窗默认把首次安装命令和每次工作区配对命令放在一起，容易让用户在同一台电脑切换工作区时重复执行 `npm install`；默认名称“远程设备”也没有说明其只是网页显示名称。
- 修复内容：命令区默认显示“电脑已安装 ziwei_user”，只复制 `connect` 与 `start`；首次使用时显式切换“这台电脑第一次安装”才附加一次性 npm 安装命令。默认设备名改为“这台电脑”，并在页面解释 `--name` 只影响设备目录显示。当前 CLI 每次配对都会更新本机用户目录中的活动凭证，因此同一 daemon 同时只激活一个工作区，切换前需确认目标工作区。
- 补强：名称留空时配对接口也统一回退为“这台电脑”，避免网页命令与设备记录出现“这台电脑/远程设备”不一致。
- 本地验证：`npm test` 141/141、`npm run lint`、`npm run build` 均通过；新增 onboarding 断言覆盖已安装/首次安装命令切换和显示名称说明。
- 服务器发布：提交 `3e1ac91` 已推送到 `origin/codex/hermes-independent-profile` 并快进 `/opt/ziwei`；部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.before-3e1ac91`。服务器构建成功并重启 `ziwei-api`，回环 `/healthz=200`；公网资源确认包含两种安装模式和设备显示名称说明。
- 回滚方式：使用 `git revert <本轮提交>` 回滚前端、README 和本节文档；不改 SQLite schema 或设备凭证。

### 2026-10-05 新工作区设备引导降噪（已发布）

- 问题归属：前端 onboarding。复现确认 `load()` 在任何没有在线设备的工作区自动打开“连接本机 ziwei_user”弹窗，把可选的设备接入误当成创建项目的前置步骤；正式 HTTPS 页面仍把证书下载入口放在主要信息区，增加了不必要的操作。
- 修复内容：创建或打开工作区不再自动弹出设备连接窗口；用户需要运行数字员工时，再从“添加设备”主动生成一次性配对码。设备弹窗明确说明连接是可选的，并仅在本地地址、IP 或非 HTTPS 地址显示额外证书下载；正式 HTTPS 域名直接提示无需下载证书。CLI 配对命令和真实在线状态保持不变。
- 本地验证：新增 onboarding 回归断言后，`npm test` 141/141、`npm run lint`、`npm run build` 均通过；构建产物不再包含项目路径安装脚本。
- 服务器发布：提交 `88d217e` 已推送到 `origin/codex/hermes-independent-profile` 并快进 `/opt/ziwei`；部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.before-88d217e`。服务器构建成功并重启 `ziwei-api`，本机回环 `/healthz=200`；公网 `https://qzelynth.top/healthz=200`，正式构建资源确认包含可选设备说明、正式 HTTPS 证书提示和通用 `ziwei_user connect`，不包含旧项目路径安装脚本。
- 回滚方式：使用 `git revert <本轮提交>` 回滚前端与文档；本轮不改 SQLite schema 或设备凭证，不需要数据库回滚。保留既有未跟踪 `tmp_gzgov.html`。

### 2026-10-05 账号、团队与设备可见性架构验收（本地未发布）

- 归属层：API/auth、SQLite/repository、前端成员与设备页、A2A 目标设备路由；本次修复遵循“账号独立、一个账号可有多个设备、邀请才加入团队”的模型。工作区通过 `workspaces.kind` 区分 `personal` / `team`，不再用账号角色推断团队身份。
- 注册行为：首次初始化只创建本地账号，不创建任何项目工作区，也不会从当前 URL 推断 `test-111`；登录后必须通过工作区创建入口显式选择个人或团队。普通注册不填写工作区时创建唯一的个人工作区；填写已有团队工作区时必须匹配有效邀请，邀请角色决定 `member` / `admin`；个人工作区不能直接被其他账号加入。
- 设备行为：配对码创建者写入 `devices.owner_user_id`。个人工作区按当前用户过滤设备；团队成员可以查看团队全部设备并在任务/会话中选择目标设备。只有设备主人或团队 Owner/Admin 能编辑、停用和删除设备；后端同时校验设备所属工作区，前端隐藏普通成员的成员管理操作。
- 兼容迁移：已有多成员工作区自动标记为团队；只有一个明确 Owner 的个人工作区历史设备会回填主人，归属不明确的历史设备保留 `NULL`。不会把 `test-111` 或固定 Owner 写入新账号默认值。
- 数字员工行为：`visibility='personal'` 的员工写入创建者 `owner_user_id`；个人员工在团队工作区对普通成员不可见，任务、会话和配置读取也由后端校验，不能只靠前端隐藏。个人工作区的任务/会话目标设备在有身份的 API 路径强制匹配设备主人；Owner/Admin 或 MCP 管理入口才可使用管理级目标。
- 本地验证：`npm test` 140/140、`npm run lint`、`npm run build` 均通过；新增首次初始化无工作区、拒绝领取历史示例工作区、注册、邀请、个人隔离、团队定向设备、个人数字员工可见性和匿名设备目标拒绝断言。
- 服务器发布：提交 `1fe9df7` 已推送 `origin/codex/hermes-independent-profile` 并快进 `/opt/ziwei`；部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261005T102338Z.before-1fe9df7`。服务器 `npm ci`、`npm run build` 成功，`ziwei-api` active，`employees.owner_user_id` 迁移列已确认；公网 `/healthz=200`、页面 `200`、未授权 MCP `401`。本次没有重启目标电脑上的 ziwei_user daemon。
- 回滚方式：发布前先将本轮代码形成独立提交，随后使用 `git revert <commit>` 回滚代码；SQLite 新增列是兼容迁移，不删除既有数据。保留未跟踪的 `tmp_gzgov.html`。

### 2026-10-05 设备记录可管理性与真实时间

- 问题归属：前端设备目录、SQLite/repository 设备元数据和设备删除 API。复现确认设备目录把“创建时间 2026/9/28”写死在 `frontend/src/App.vue`，`devices` 表没有创建时间字段，且页面没有重命名入口。
- 修复内容：为设备和配对记录增加创建时间/显示名元数据；配对码保存用户输入的设备名，目标电脑即使不传 `--name` 也会沿用；设备目录显示真实创建时间和最后心跳时间，增加设备编辑入口；历史种子设备可由 owner/admin 删除，删除时同步撤销设备凭证。
- 本地验证：`npm test` 129/129、`npm run lint`、`npm run build` 均通过；内存 SQLite 验证历史设备删除、配对自定义名称和创建时间持久化。服务器已快进到 `744fed2`，SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261005T063349Z.before-744fed2`，`ziwei-api` active，公网 `/healthz=200`，数据库迁移列已确认。
- 未验证边界：旧数据库历史种子设备没有可靠的原始创建时间，页面显示“历史设备”；已配对设备会从 `device_credentials.created_at` 回填真实时间。设备删除后目标 daemon 凭证失效，需要重新配对才能恢复连接。
- 回滚方式：代码使用 `git revert` 回滚本节对应提交；数据库新增列为兼容迁移，保留即可，不需要删除。保留既有 `tmp_gzgov.html` 未跟踪文件。

### 2026-10-05 通用 ziwei_user daemon 配对（本地与服务器已验证）

- 归属层：daemon、API/A2A 鉴权、SQLite/repository、CLI 和前端设备引导；目标是让任意远程电脑安装同一个 `ziwei_user`，一次配对后发现并连接该电脑上的 Claude、Codex、Gemini、Hermes 四类 Agent。
- 网页设备入口通过 `POST /api/workspaces/:slug/devices/pairing` 生成短时一次性配对码；目标电脑执行 `ziwei_user connect --api ... --code ...`，服务器只返回一次 workspace 绑定的设备凭证，心跳、runtime 注册和 A2A 请求使用该设备凭证。配对码和完整凭证不会写入审计日志。
- SQLite 新增 `device_pairing_codes`、`device_credentials` 及索引；配对消费和设备/凭证写入在同一事务中完成，撤销或停用设备后凭证立即失效。成员可以配对自己控制的电脑，但设备删除、停用和其它管理操作仍需 owner/admin。
- CLI 增加用户目录模式和 npm `bin`：`npm install --global https://github.com/jinjinli226-netizen/ziwei/archive/refs/heads/codex/hermes-independent-profile.tar.gz` 后使用 `ziwei_user connect` / `ziwei_user start`；配置、日志、动作状态写入用户目录，执行工作目录取配对时的当前目录，不落到 npm 包缓存。使用 GitHub tarball 是为了避开 Windows npm 全局安装 Git junction 的临时目录问题。项目 checkout 模式仍保留给本地开发。
- daemon 全局包不再安装网页前端依赖：`@ziwei/ui`、Vite、Vue 等只留在 `devDependencies`，API 的 Express/WS 运行依赖仍保留；本地打包后以 `npm install --omit=dev` 安装并执行 `ziwei_user version` 已通过。
- 前端设备弹窗已改为通用四 Agent 配对引导，移除依赖当前项目路径的 `install-ziwei-user.ps1` 命令；正式域名证书无需额外 CA，私有证书仍可通过 `--tls-ca-file` 指定。
- Windows 安装命令使用 `cmd.exe` 兼容的双引号；PowerShell 和 macOS/Linux 保留各自 shell 的引号规则，避免把 GitHub 包地址当成本地路径。
- 新建数字员工时不再把 Hermes 设为默认运行时；页面会优先选择当前 `ziwei_user` 发现的第一个 Agent，四个运行时仍可在同一选择器中分别配置，Hermes profile 只在选择 Hermes 时出现。
- 本地证据：配对/API 鉴权、四 runtime 心跳、CLI、引导契约和真实子进程 daemon→HTTP heartbeat/A2A 链路均有测试；`test/daemon-link.test.mjs` 使用临时 API、临时用户目录和真实 daemon 进程，确认设备 online 且四类 runtime 均回报。
- 服务器部署证据：`154.202.118.5:/opt/ziwei` 曾快进到 `9cd62b5` 完成通用 daemon 发布；随后设备元数据修复已快进到 `744fed2`，前端构建和 `ziwei-api` 重启成功，服务器只运行 API，不代替目标电脑运行 Agent daemon。
- 兼容边界：生产 API 默认要求设备凭证，已有电脑上的旧 `data/ziwei_user.json` 没有 `deviceToken` 时会保持离线；必须从网页生成一次性配对码，在目标电脑安装当前分支的 `ziwei_user` 后执行 `ziwei_user connect` 再 `ziwei_user start`。当前服务器部署已验证服务健康和数据库迁移，真实目标电脑重新配对仍需在该电脑上完成。
- 当前未覆盖：多设备对同一工作区的 runtime metadata 聚合和按设备的员工调度仍需后续设计；本轮不把第二台电脑的状态伪装成第一台，也不以全局 A2A token 代替新设备凭证。回滚方式是恢复本节涉及的代码提交并恢复 `/opt/ziwei-backups/ziwei.sqlite.20261005T050337Z.before-8c84bb1`。

## 1. 先看结论

紫薇当前已经具备可运行的本地工作区产品闭环：Vue 前端、Express API、SQLite 持久化、本机 `ziwei_user` 桥接 daemon、A2A action、真实 CLI 运行时发现、任务执行事件、对话收件箱、数字员工、自动化、文档、技能、邀请、设备和通知链路都已接入代码。

当前通过的本地质量门槛：

```text
npm test       154 passed
npm run lint   passed
npm run build  passed
```

本轮在已有初始化账号的实例上补充了公开注册入口：`POST /api/auth/register` 会创建新的本地账号并自动登录；不填写工作区时创建独立个人工作区，填写已有团队工作区标识时必须同时匹配有效邀请，受邀账号按邀请角色加入。工作区类型来自 `workspaces.kind`，不从账号类型推断；一个账号可拥有多个个人或团队成员关系。`/api/auth/setup` 只创建首次本地账号；初始化账号没有工作区时，前端会引导用户显式创建第一个工作区，不会复用 `test-111`。

最近一次验证环境为 Windows、Node v24.13.0、npm 11.6.2；当前分支为 `codex/hermes-independent-profile`，工作区只保留既有未跟踪临时文件。接手时先运行 `git status --short`，把这些修改视为现有工作，不要重置、清理或覆盖。

这不等于所有部署边界都完成。远端 Git 同步、生产级 PostgreSQL/Redis/对象存储、云端 OAuth、计费、真正的沙箱隔离以及完整浏览器逐页截图验收仍属于后续工作。不要把这些项目写成“已完成”。

### 2026-10-04 发布与真实链路验证

- 服务器 `154.202.118.5` 已部署分支 `codex/hermes-independent-profile` 的提交 `8a95ac8`；服务器 `main` 未被改写。部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T104845Z.before-8a95ac8`。
- 服务器 `ziwei-api` 重启后保持 active；本地和公网 `/healthz` 均返回 200。服务器前端构建产物包含岗位说明内联编辑入口。
- 最新服务器替换已快进到 `59f0715`；部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T114756Z.before-59f0715`。systemd 已配置 `ZIWEI_TLS_CERT_FILE=/etc/ziwei/server.crt`，Nginx 已增加精确 `/server.crt` 反代并通过语法检查。
- 本机 `data/ziwei_user.json` 以 `bjc-ops` 为工作区，A2A 令牌与服务器已重新同步；本机 `/readyz` 为 ready，daemon 日志持续记录 `heartbeat` 和 `a2a_poll` 成功。
- 真实服务器动作已完成两次独立验收：`runtime=Hermes`、`profile=ziwei-aigc`，分别返回 `HERMES_PROD_PROFILE_OK` 和 `HERMES_PROD_PROFILE_RECHECK_OK`，结果均为 `succeeded`。服务器返回结果包含独立 profile，profile 不存在时仍会明确失败。
- 本机和服务器 `bjc-ops` 均已创建数字员工“调研大师”：本机 ID 为 `employee_53dae986-9446-4e05-b474-3e0c000472a6`，服务器 ID 为 `employee_f5deedce-1404-4764-86ae-835c4f219bc6`，两者都绑定 `runtime=Hermes`、`profile=ziwei-research`。该 profile 拥有独立的 `SOUL.md`、记忆、会话和技能目录；本机 `executeRuntime` 返回 `RESEARCH_PROFILE_OK`，服务器真实 A2A 链路返回 `SERVER_RESEARCH_PROFILE_OK`。服务器 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T021917Z.before-research-master`；生产 `main` 未修改。
- MCP 管理入口已部署：`/mcp/v1/workspaces/:slug/employees`、`/tasks`、`/documents` 由独立 bearer 文件和显式工作区白名单保护，MCP 客户端只调用 HTTPS API，repository 负责所有持久化。服务器 Nginx 已为 `/mcp/` 增加反代；本机 `ziwei-research` profile 已注册 `ziwei_management`，通过服务器真实 MCP 链路完成员工列表、描述更新回读与原值恢复，确认没有直接打开 SQLite。令牌文件和服务器自签 CA 仅保存在被忽略的 `data/` 文件中。
- 本轮代码验证：此前数字员工/MCP 版本为 `npm test` 104/104；当前引导补丁的本地门槛为 `npm test` 111/111、`npm run lint`、`npm run build`，公网引导入口待部署后复测。

### 2026-10-04 正式域名证书切换进度

- 已在服务器安装 Certbot，并为 `qzelynth.top` / `www.qzelynth.top` 配置了可回滚的 ACME webroot：`/var/www/letsencrypt/.well-known/acme-challenge/`。Nginx 已通过语法检查，源站直连挑战文件返回 200。
- 真实 Let’s Encrypt webroot 申请已执行但未通过：两个域名当前仍解析到 Cloudflare 代理 IP，CA 从公网获取挑战文件时收到 403。没有生成或替换任何证书，现有 `/etc/ziwei/server.crt` 与 `/etc/ziwei/server.key` 保持不变。
- 继续申请前需将 Cloudflare 中 `@` 和 `www` 临时切换为 DNS only（灰云），或改用 Cloudflare DNS-01。解析切回服务器 `154.202.118.5` 后再重试；签发成功才会切换 Nginx/systemd 到 `/etc/letsencrypt/live/qzelynth.top/`。
- 本轮服务器 Nginx 配置备份：`/etc/nginx/sites-available/ziwei.20261004T121751Z.before-qzelynth-acme.bak`。重复的旧备份 symlink 已移出 `sites-enabled`，当前 `nginx -t` 无重复 `server_name` 警告。

### 2026-10-04 主域名正式证书已切换

- `qzelynth.top` 的 A 记录已直连腾讯云服务器 `154.202.118.5`；真实 Let’s Encrypt webroot 申请成功，证书位于 `/etc/letsencrypt/live/qzelynth.top/`，有效期至 2027-01-02。Certbot 自动续期任务已启用，`certbot renew --dry-run --no-random-sleep-on-renew` 模拟续期成功，并配置 deploy hook 自动 reload Nginx。
- Nginx 已切换到 `fullchain.pem` / `privkey.pem`，systemd `ziwei-api` 的 `ZIWEI_TLS_CERT_FILE` 已同步到公开 fullchain；切换前备份为 `/etc/nginx/sites-available/ziwei.20261004T141659Z.before-letsencrypt.bak` 和 `/etc/systemd/system/ziwei-api.service.d/onboarding.conf.20261004T141659Z.before-letsencrypt.bak`。
- 真实验证：使用正常 TLS 校验连接 `qzelynth.top`，Node 报告 `authorized=true`，证书主题为 `qzelynth.top`、签发者为 Let’s Encrypt YR1；直连源站 `/healthz=200`、`/server.crt=200`，下载证书 SHA-256 与服务器 fullchain 一致；Nginx 与 `ziwei-api` 均 active。
- `www.qzelynth.top` 当前仍解析到 Cloudflare 代理 IP，未纳入本次证书 SAN；需要把 `www` 也设为灰云并直连 `154.202.118.5` 后，再重新申请包含 `www` 的证书。当前正式可用入口是 `https://qzelynth.top`。

### 2026-10-04 已有工作区的注册入口

- 问题归属：API/auth 与登录前端。生产复现证据是已有账号时 `POST /api/auth/setup` 返回 `400 本机已经完成初始化，请直接登录`，页面“首次使用，创建账号”因此无法创建第二个账号。
- 修复内容：新增 `POST /api/auth/register`，前端登录页增加“注册新账号”；注册成功会建立真实 `local_users`、工作区成员关系和会话，不直接操作 SQLite 文件。若存在同邮箱的待接受邀请，会在注册事务中绑定原成员记录。
- 本地验证：`npm test` 113/113、`npm run lint`、`npm run build` 全部通过；注册成功、加入已有工作区、自动登录和重复邮箱错误均有 HTTP 测试覆盖。
- 生产验证：服务器 `/opt/ziwei` 已快进到 `7fa17dd`，部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T151310Z.before-7fa17dd`；构建成功并重启 `ziwei-api`，服务保持 active。公网 `GET /api/auth/status=200`、已有邮箱注册返回预期 `400`、注册预检 `OPTIONS=204`，正式页面构建产物包含“注册新账号”。

### 2026-10-04 新注册用户的 ziwei_user 引导

- 问题归属：前端 onboarding 状态与成员权限兼容。新注册账号是 `member`，工作区设置读取会被后端正确返回 403；此前 `load()` 把它和设备、任务请求放在同一个 `Promise.all`，导致离线心跳检查没有执行。同时“稍后”标记使用全浏览器共享 key，旧账号关闭过引导会抑制新账号的首次提示。
- 修复内容：成员跳过 owner/admin 专用的设置读取，继续加载设备和工作区基础数据；引导关闭标记按认证用户和工作区隔离。检测到真实 `ziwei_user` 离线且当前账号未关闭过时，打开包含 API 地址、工作区、证书下载和安装命令的连接引导。没有伪造在线状态，也不依赖 AuraBaba daemon。
- 本地验证：`npm test` 116/116、`npm run lint`、`npm run build` 全部通过；UI contract 覆盖成员权限下的加载路径、新账号登录后加载与引导 key 隔离。
- 生产验证：服务器已快进到 `5b50452`，部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T161858Z.before-5b50452`；前端构建成功，`ziwei-api` 保持 active，公网 `/healthz=200`，正式页面已返回包含新成员加载逻辑的构建包。数据库只读核对确认该账号属于 `test-111` 且 `ziwei_user` 状态为 offline；刷新账号页面后应进入离线引导。

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
data/ziwei_user.json       # 不提交令牌；当前本机以文件内容为准，并引用本机私有 TLS CA 路径
data/ziwei.sqlite          # 本地持久化数据库
 data/a2a.token             # 本机 A2A 令牌，禁止写入日志或提交
.local/runtime/             # daemon 动作状态
.local/server.crt           # 服务器自签名证书副本，仅供本机 daemon 的 NODE_EXTRA_CA_CERTS 使用
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
- Hermes 独立人格：数字员工可绑定本机 Hermes profile；执行时隔离 `HERMES_HOME`，并把岗位说明注入真实 task/conversation prompt。profile 不存在时明确失败，不回退主 profile。服务器当前运行 `codex/hermes-independent-profile`，已用真实 A2A action 验证 `runtime=Hermes`、`profile=ziwei-aigc` 和独立输出。
- 数字员工配置页已接入员工级环境变量、自定义 JSON 参数、MCP 状态/健康检查和 Hermes profile 发现；敏感变量使用 AES-256-GCM 加密存储，列表与审计不暴露原值。当前环境变量和自定义参数完成配置持久化，尚未注入 A2A/CLI 执行环境；MCP 仍是员工、任务、文档的窄管理面，不提供这两类配置工具。
- MCP 客户端继续通过 HTTPS /mcp/v1 窄管理面调用 repository，不直接打开 SQLite；开放能力明确限定为员工、任务和文档。
- 数字伙伴岗位说明页支持内联编辑；保存只更新岗位说明，不再打开完整的数字伙伴配置弹窗。
- A2A action 的创建、去重、ACK、事件、执行租约、结果、失败和过期处理。
- 公开推理摘要、命令/工具安全摘要、CLI 输出量和阶段状态；不展示模型原始私有思维链。
- 文档目录树、文件夹、Markdown、二进制附件、下载、回收站、净化和本地 Git 导入/导出。
- Skills 的文本、文件、URL、ZIP 和在线工位导入，校验、版本、停用、卸载和回滚。
- 邀请生命周期、设备管理、成员管理、API Key、Webhook、自动化、日历和通知实时通道。
- 浅色品牌主题、统一蓝色主色、跨页面快捷“数字伙伴创建”入口和运行状态展示。

### 2026-10-04 数字员工配置页验证

- 本地 `npm test` 104/104、`npm run lint`、`npm run build` 通过；隔离 HTTP 链路使用真实 `scripts/ziwei-mcp.mjs` 客户端验证 health、员工列表和窄管理面能力。
- 未启动或修改 5178/4178/20242 生产入口，未写入生产 SQLite；既有 `tmp_gzgov.html` 保持未跟踪。

### 2026-10-04 新用户服务器连接引导（本地与服务器已验证）

- 归属层：前端引导 + CLI 配置 + API 公开证书入口；不直接写 SQLite，不依赖 AuraBaba daemon。
- 首次账号页要求明确填写工作区标识；设备连接弹窗显示当前 API 地址、工作区和证书下载入口。Windows、macOS、Linux 命令都携带明确的 `--api` 与 `--tls-ca-file`，不会通过关闭 TLS 校验来掩盖证书问题。
- `GET /server.crt` 只返回配置的公开 PEM 证书；缺失、格式错误或包含私钥时拒绝服务。CLI 会校验证书文件存在并把路径写入本机 `data/ziwei_user.json`，启动器继续通过 `NODE_EXTRA_CA_CERTS` 注入 daemon 子进程。
- 本地证据：`npm test` 111/111、`npm run lint`、`npm run build` 通过；隔离 HTTP 链路验证 `/healthz=200`、证书下载 `200`、首次账号创建 `201` 且工作区标识持久化；另以临时配置跑过真实本地 daemon 心跳，`/readyz` ready 且设备 online。
- 服务器证据：`/opt/ziwei` 已部署 `59f0715` 并重启 `ziwei-api`；公网 `/healthz=200`、前端 `200`、`/api/auth/status=200`、未授权 MCP `401`；公网 `/server.crt=200`，`application/x-x509-ca-cert`，下载 SHA-256 与 `/etc/ziwei/server.crt` 一致。Nginx 既有重复 `server_name` 警告仍存在，但配置语法检查成功。
- 回滚：代码执行 `git revert 59f0715` 后重新构建/重启；数据库恢复 `/opt/ziwei-backups/ziwei.sqlite.20261004T114756Z.before-59f0715`；Nginx 与 systemd 原文件备份在同一部署时间戳下的 `.bak` 文件中。未验证边界仍包括真实新用户浏览器下载自签证书后的跨平台安装体验，以及正式域名证书替换。

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

这条历史错误曾代表 daemon 的固定 10 分钟计时器先于 CLI 终态结果中止动作。不要先把前端提示改成成功；应先确认 daemon 是否仍在输出、CLI 是否真的退出，以及 A2A action 的租约是否持续有效。

排查顺序：

```powershell
Get-Content .local/logs/daemon.log -Tail 120
Invoke-RestMethod http://127.0.0.1:20242/readyz
# Windows 代理配置
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer
```

当前 Codex 适配器会自动继承显式 `HTTP_PROXY`/`HTTPS_PROXY`，没有显式变量时读取启用的 Windows Internet Settings 代理。运行时动作默认不设固定总时长上限，只在超过无活动 watchdog 时失败；显式传入 `timeoutMs` 时仍按调用方要求设置硬上限。daemon 的输出、阶段和进度事件会刷新无活动计时，服务端也会据此续 A2A 执行租约。原有失败记录会继续显示失败；修复后需要重新发送任务，不会篡改历史结果。

### 任务持续有输出却在 10 分钟后失败（已修复）

2026-10-06 的实证记录 `action_10891d73-60d5-4223-be18-3a9d7c732d27` 在 `10:04:52Z` ACK 后持续产生阶段、输出和进度，最后一条进度在 `10:13:57Z`，但 daemon 在 `10:14:53Z` 以 `A2A action timed out after 600000ms` 结束。问题属于 daemon 超时策略和 API 执行租约续期，不是前端状态渲染。

修复包括：

- daemon 默认只使用无活动 watchdog；收到 `action.output`、`action.stage` 或 `action.progress` 就刷新计时，不再用默认 10 分钟总时长截断持续工作的 CLI。
- 显式 `timeoutMs` 仍可作为调用方硬上限，避免调用方需要严格截止时间时失去控制。
- API 在活动事件写入时把 ACK action 的 `expires_at` 延长到新的执行租约，daemon 持续回传时不会被服务端误判过期。
- Hermes profile 创建默认从本机主 Hermes home 继承 `auth.json`、`config.yaml` 和 `.env`（仅 daemon 本机文件操作），因此新 profile 默认继承 provider；profile 仍保留独立目录和独立 `SOUL.md`。如果主 profile 尚未连接 provider，创建动作不会伪造连接，Hermes 会返回可操作的 provider 提示。

回归验证覆盖无活动超时、活动续时、A2A 租约续期、Hermes provider 继承，以及 `test333` profile 的真实本机调用。历史已失败 action 不会被篡改，需要更新 daemon 后重新发送。

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

### 2026-10-06 前端控件样式统一发布

- 问题归属：前端交互与样式。复现确认主页“通过数字伙伴创建”、任务状态、日历筛选、会话目标设备和工作区创建等位置仍会落回浏览器原生下拉控件，创建数字伙伴弹窗也缺少完整的焦点与键盘行为。
- 修复内容：统一改用 `@ziwei/ui` 的 `ZiSelect`，补齐输入框、文本域、复选框、按钮、tab/listbox 的紫薇令牌和状态样式；数字伙伴弹窗增加 Escape 关闭、Tab 焦点循环、自动聚焦和关闭后焦点恢复。数据来源和 API 调度保持真实设备/员工数据，不新增静态成功状态。
- 本地验收：`npm test` 145 passed、`npm run lint` 通过（30 source files）、`npm run build` 通过；源码检索确认 `frontend/src` 已无原生 `<select>`；`git diff --check` 通过。
- GitHub：提交 `b67ad15` 已推送到 `origin/codex/hermes-independent-profile`。
- 服务器发布：`/opt/ziwei` 已快进到 `b67ad15`，部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261005T135324Z.before-b67ad15`；`npm ci --ignore-scripts`、`npm run build` 成功，`ziwei-api` active。重启后立即探测曾处于监听尚未完成阶段，随后日志确认 4178 已监听；复测本机和公网 `/healthz` 均返回 200，公网页面和新构建资源均返回 200。
- 回滚方式：前端代码使用 `git revert b67ad15` 后重新构建/重启；本轮没有数据库结构或数据写入，保留上述 SQLite 备份用于异常时恢复。未跟踪的 `tmp_gzgov.html` 未修改。

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

### 2026-10-05 身份、工作区与设备归属边界

- `workspaces.kind` 区分 `personal` 与 `team`；账号类型不再承担团队身份。无邀请注册或首次初始化不填写工作区时创建独立个人工作区，显式加入已有团队必须匹配有效邀请，`test-111` 只保留为历史/示例团队工作区。
- 个人工作区不发放成员邀请；邀请入口只对团队工作区生效。
- `devices.owner_user_id` 记录配对码创建者。个人工作区的设备查询按当前用户隔离；团队成员可以查看并使用团队设备，但只有设备主人或团队 Owner/Admin 可以编辑、停用和删除设备。历史设备无法安全回溯归属时保持 `NULL`，不会伪造主人。
- 任务和会话执行 payload 可携带 `targetDeviceId`，团队成员可以将动作定向到工作区内的设备；设备凭证仍按单设备校验。
- 硬编码审计：前端用户/角色/工作区默认值已移除；daemon/CLI 和 A2A 路由在没有 workspace 配置时都会明确报错。数据库种子、测试夹具和历史文档中的 `test-111` 仅用于兼容/示例，不能作为认证或权限决策来源。
- 回滚方式：使用 `git revert` 回滚本节对应代码提交；数据库新增列为兼容迁移，保留列不会破坏旧记录。未修改既有未跟踪 `tmp_gzgov.html`。

### 2026-10-05 Windows Codex CLI 启动适配

- 根因：Windows daemon 发现旧的 `codex.ps1` 后，用 `powershell -File` 传递 Codex 的标准输入参数 `-`；PowerShell 会把它解释为脚本参数并在 CLI 启动前报 `argument "name" is not valid`。
- 变更：运行时发现优先扫描用户目录中的新版 OpenAI `codex.exe`；对 npm 包装器在可用时直接调用 `@openai/codex/bin/codex.js`，否则使用 PowerShell `-Command` 兼容调用，避免 `-File` 参数绑定。
- 验证：新增 Windows 运行时发现与包装器回归测试；`npm test`（145 passed）、`npm run lint`（30 source files）、`npm run build` 均通过；真实本机 Codex smoke test 已进入 CLI 并输出运行时日志，15 秒后按测试超时取消，未再出现 PowerShell 参数绑定错误。
- 回滚方式：回滚本节对应代码提交即可；不改数据库、不改既有设备凭证，重启 daemon 后重新发现本机 CLI。
