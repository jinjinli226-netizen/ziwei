# 变更记录

本文件只记录可追溯的项目级变更摘要；详细设计、验证命令和未完成边界见 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)。

## 2026-10-08 紫薇·互联完整终端管理（主站与源归档兼容均已发布）

### Added

- 主站“紫薇·互联”复用原完整终端页面，提供左右手机列表与详情、待审批准/拒绝及加载/提交/成功/失败/空/过期态、双端健康、手动登记和配置下载、原像素截图操控、控制端切换/暂停、回执核实、APK 选择及双端升级、归档。
- 当前手机绑定已有数字员工和外部账号；保留原员工动作、执行记录和诊断。主站工作区代理使用原登录与 Owner/Admin 权限，管理凭据留服务端，复用原手机配对、状态数据库和 MCP/设备协议。

### Fixed

- summary 省略终态回执造成历史消失和升级预检超时：刷新后读取完整详情，升级预检按捕获手机 ID 校验成功截图；离页后停止后续升级提交。
- delivered/executing 不再提前停止员工运行轮询；acknowledged 保持人工核实语义，终端核实会同步旧运行记录；批准与归档成功提示、首条其他手机绑定混入当前账号等问题同时修复。

### Verification

- `npm test -- --test-concurrency=1`：189/189；lint/build 通过。
- 源归档兼容 Android/terminal-console 测试 36/36、生产 build 通过；覆盖旧 schema 迁移、归档安全阻断、双角色凭据失效及历史保留。
- 默认并发运行在构建 CPU 负载下曾触发既有 daemon 60 ms/100 ms 计时测试失败；隔离 daemon 7/7、完整串行 189/189 通过，没有修改 daemon。
- 隔离真实 HTTP/SQLite 协议验证 6 组、合成浏览器 6/6；覆盖原管理页面、审批状态、完整回执、精确 summary 契约、升级预检/离页停止、员工绑定隔离和窄屏弹窗。
- 真实域名只读浏览器使用主站 Owner cookie 验证 1440/390 px、匿名 401/登录 200、无需源登录、页面/弹窗/导航；0 page/console/request 错误、0 真实设备动作。证据 `.local/terminal-live-evidence/results.json`，真实手机 0/待审 0。

### Release

- 主站提交 `a625350b23926597810fe5181741937933303170` 已推送 `origin/codex/ziwei-terminal-console`，服务器 `/opt/ziwei/current -> /opt/ziwei/releases/a625350`；旧版本 `f88d6f8`，前端 `index-noIbPxU1.js`。
- 部署前双 SQLite/config 备份 `/opt/ziwei-backups/terminal-console/20261008T122923Z`，integrity 检查通过；原数据 symlink、凭据、APK/`dist/downloads` 保留。
- 源归档兼容提交 `8a4fe59f0b2486fb584962fd3006e9a47418037a` 已推送 `origin/codex/phone-archive-compat` 并于 `2026-10-08T12:47:46Z` 部署，`current -> releases/8a4fe59`，服务 active/health 200，兼容列真实存在、手机 0。第二备份 `/opt/ziwei-backups/terminal-console/20261008T124627Z` 含 12 配置与两份 SQLite，integrity 均通过。增量仅 `archived_at` 兼容迁移及原归档行为，保留历史、撤销双角色凭据并隐藏手机；原下载/数据/依赖目录继续链接，旧 `af63071` 兼容额外列，可用于代码回滚。
- 源更新后最终生产复核（`2026-10-08T12:49:03Z`）：真实域名 6 检查/5 探针全部通过；两端 health=true，主站/控制/Nginx 三服务 active，归档列存在、手机 0。1440/390 px 无溢出，0 page/console/request 错误、0 设备动作。APK manifest 与双端下载 200，815470/815474 bytes，SHA-256 均匹配；临时 QA 会话已撤销，服务器/本机临时 token 文件已删除。证据 `.local/terminal-live-evidence/deployment.json`。

### Deferred

- 实机 APK 安装、申请获批后自动领取配置、双端心跳、真实屏幕操作与升级仍待手机验收。未改 DNS/子域名或本机 daemon/配置/数据；本机 `20242` PID `33260`、工作区 `test_222` 本轮仅只读核对。

## 2026-10-06 Hermes Profile 与 Codex 风格会话工作区（已发布）

### Added

- Hermes Profile 创建改为网页发起、目标设备上的 `ziwei_user` 本地落盘；Profile 按设备隔离并支持幂等重试。
- 持久会话增加目标设备、模型和工作目录设置；会话附件通过 A2A 传递并在目标电脑工作目录的 `.ziwei/attachments` 下落盘后交给本机 CLI。

### Verification

- `npm test`：152 passed
- `npm run lint`：passed
- `npm run build`：passed
- 真实本地 A2A Profile 派发链路：passed

### Release

- GitHub：`codex/hermes-independent-profile` 已推送提交 `d18121e`
- 服务器：`/opt/ziwei` 已快进到 `d18121e`，SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261006T073416Z.before-d18121e`，`ziwei-api` active，公网 `/healthz=200`

### Deferred

- 浏览器逐项附件选择和四种真实 CLI 的附件读取仍待手工验收。

### Fixed

- 修复 Windows `ziwei_user` 执行 Codex 时通过 PowerShell `.ps1` 传递标准输入标记 `-` 导致参数绑定失败的问题；daemon 会优先发现用户目录中的新版 `codex.exe`，旧包装器则直接调用其 Node 入口，避免把任务交给 PowerShell 参数解析。
- 全站控件视觉统一：主页加号“通过数字伙伴创建”弹窗、收件箱会话、任务状态、日历筛选和工作区创建等入口改用 `@ziwei/ui` 的 `ZiSelect`，移除前端模板中的原生 `<select>` 残留；目标设备下拉不再显示浏览器默认控件。
- 为原生输入框、文本域、复选框、按钮和自定义 tab/listbox 补齐紫薇蓝色令牌、hover/active/focus-visible/disabled 状态；设备/技能/设置/数字伙伴页 tab 增加 `role="tablist"`、`role="tab"` 和 `aria-selected`。
- 数字伙伴创建弹窗新增 Escape 关闭、Tab 焦点循环、打开时聚焦和关闭后焦点恢复；创建者与目标设备选择器保留真实设备/员工数据和 API 调度逻辑。

- 分离账号、成员关系、工作区类型和设备归属：无邀请注册创建个人工作区，加入团队必须匹配有效邀请；设备配对记录 `owner_user_id`，个人设备查询隔离，团队成员可查看和定向使用团队设备，普通成员不能管理他人设备。
- 增加 `workspaces.kind` 与 `devices.owner_user_id` 兼容迁移；历史设备归属未知时保留空值，不伪造主人。
- 清理前端角色/工作区默认文案和 daemon/CLI/A2A 的 `test-111` 用户数据默认；数据库种子和测试兼容 fixture 保留并记录边界。
- 工作区创建入口支持个人/团队选择；普通团队成员仍可添加并使用自己的设备，但成员邀请、成员编辑和成员移除操作只在 Owner/Admin 页面显示。
- 首次初始化改为只创建本地账号，不创建或接管任何工作区；登录后由用户显式创建第一个个人/团队工作区，初始化页面不再从 URL 推断 `test-111`。
- 个人数字员工记录创建者归属，团队成员无法通过列表、任务、会话或配置接口绕过 `visibility='personal'`；个人工作区任务/会话目标设备在带身份的 API 路径强制校验设备主人。

### Verification

- `npm test`：145 passed
- `npm run lint`：passed（30 source files）
- `npm run build`：passed（Vite production build）
- 源码复现确认：前端 Vue 模板已无原生 `<select>`；未启动或重启现有 20242 daemon，未改数据库或 API 数据逻辑。
- `npm test`：140 passed
- `npm run lint`：passed（30 source files）
- `npm run build`：passed（Vite production build）
- 已推送 `1fe9df7` 到 `codex/hermes-independent-profile` 并部署服务器；SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261005T102338Z.before-1fe9df7`，公网 `/healthz` 和前端入口均返回 200。
### Fixed

- 修复设备目录硬编码创建日期和静态“最后在线”状态，改为读取 SQLite 设备创建时间与心跳时间。
- 增加设备显示名称编辑入口；配对流程保存名称并把名称传给目标电脑，避免所有设备都显示为 `ziwei_user`。
- 允许清理历史种子设备，删除时撤销对应设备凭证。

### Verification

- `npm test`：129 passed
- `npm run lint`：passed
- `npm run build`：passed

## Unreleased（2026-10-03）

### Added

- 新增 `PROJECT_MANAGEMENT.md`，集中维护架构、启动、数据、扩展、排障、测试、发布和 AI 接手流程。
- 新增代理解析与继承：`ziwei_user` 在没有显式代理环境变量时，可读取 Windows Internet Settings 的启用代理并传递给本机 CLI。
- Codex CLI 调用使用 ephemeral 会话，避免桥接器复用遗留 CLI 会话状态。

### Fixed

- 分离账号、成员关系、工作区类型和设备归属：无邀请注册创建个人工作区，加入团队必须匹配有效邀请；设备配对记录 `owner_user_id`，个人设备查询隔离，团队成员可查看和定向使用团队设备，普通成员不能管理他人设备。
- 增加 `workspaces.kind` 与 `devices.owner_user_id` 兼容迁移；历史设备归属未知时保留空值，不伪造主人。
- 清理前端角色/工作区默认文案和 daemon/CLI 的 `test-111` 用户数据默认；保留 A2A/测试兼容 fixture 并记录边界。

### Verification

- `npm test`：133 passed
- `npm run lint`、`npm run build`：待本轮最终验证
### Fixed

- 修复 Codex CLI 因 daemon 未继承本机代理而持续等待并最终报告 `A2A action timed out after 600000ms` 的问题。
- 修复生产前端登录请求仍指向 `http://127.0.0.1:4178` 的问题：开发模式保留本机 API 默认值，生产模式默认使用当前页面 origin，并允许 `VITE_API_URL` 显式覆盖；WebSocket/SSE 也随同源地址工作。
- 真实短 CLI 请求已通过代理返回 `OK`；历史失败动作仍保留原始失败状态，需要重新发送。

### Verification

- `npm test`：84 passed
- `npm run lint`：passed
- `npm run build`：passed
- `ziwei_user /readyz`：ready
- 后端 `/healthz`：HTTP 200
- 生产 API 预检：`OPTIONS https://154.202.118.5/api/auth/login` 返回 204，并包含允许当前 HTTPS origin 的 CORS 头。
- 前端 API 地址回归测试：开发默认、本页面 origin 和显式覆盖均通过。
- 服务器 `https://154.202.118.5`：HTTPS、前端、API 和 SQLite 已部署；服务器证书已加入当前 Windows 用户信任存储。
- 本机 `bjc-ops` Agent 已通过真实 A2A action 完成回传；用户级启动目录脚本 `ZiweiUserRemoteAgent.vbs` 已验证可拉起 daemon，无需管理员权限。
- 已初始化测试登录账号 `admin@ziwei.local` 并验证登录、`/api/auth/me` 与工作区列表；服务器 root 密码未修改。

### Deferred

- 远端 Git 双向同步、生产级 PostgreSQL/Redis/对象存储/队列、OAuth/计费/沙箱，以及完整浏览器像素和跨平台安装验收仍未纳入本次完成范围。

## 维护规则

每次功能变更都追加日期、目的、影响边界、验证命令、未验证项和回滚方式；不要修改历史条目来掩盖旧状态。
# 2026-10-03

- 修正本地 `@ziwei/ui` tarball 的 `package-lock.json` integrity，确保干净服务器执行 `npm install` 可复现。
- 完成本地工作区与远端服务器的真实部署验证：服务器由 systemd 管理 API，Nginx 提供 HTTPS，Windows `ziwei_user` 通过出站 A2A 轮询连接服务器并成功执行回传。
- 当前服务器证书按 IP 使用临时自签名证书；接入正式域名后应替换为受信任证书。

## Unreleased（2026-10-04）

### Added

- 数字员工详情页的环境变量已接入 repository/API/SQLite：员工级变量采用 AES-256-GCM 加密存储，敏感值列表和 UI 只返回掩码；本机 `ziwei_user` 变量仅展示名称与来源，不进入普通列表或日志。环境变量写入仅限 Owner/Admin，读取仍遵循工作区成员权限。
- 自定义参数支持 JSON 对象读取、编辑、校验、全量替换和持久化；新增表使用 `CREATE TABLE IF NOT EXISTS` 与迁移兼容旧数据库。
- MCP 详情页接入真实状态、工作区范围、HTTPS 管理端点、健康检查和窄管理面边界；`scripts/ziwei-mcp.mjs` 新增 `ziwei_mcp_health`，继续只通过 `/mcp/v1` 管理员工、任务、文档。
- Hermes profile 发现、profile 名称校验和独立 `HERMES_HOME` 说明已接入；已发现 profile 之外的名称会给出明确失败，远程 API 无法看到本机 profile 时仍由 `ziwei_user` 作为运行时来源。

### Verification

- 新增 repository、API、UI contract、Hermes profile discovery 测试；专项测试和现有 MCP/runtime 测试通过。
- `npm test`：104 passed；`npm run lint`：passed；`npm run build`：passed；服务器已快进到 `8a95ac8`，SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T104845Z.before-8a95ac8`，API 重启后健康检查通过。
- 隔离 HTTP 验证：实际 `scripts/ziwei-mcp.mjs` 客户端通过 `/mcp/v1` 返回 health、员工列表和窄管理面能力；本机 Hermes profile 发现 5 个，`ziwei-aigc` 校验通过。

### Deferred

- 伙伴市场、帮助中心和邮件发送保持现状并延期；本轮未用假页面标记为完成。远端 Git、生产外部存储/队列、OAuth、计费、沙箱和完整浏览器逐页截图验收仍延期。
- 环境变量和自定义参数当前仅完成加密持久化与配置页编辑，尚未进入 A2A/CLI 执行环境；MCP 尚未提供这两类配置的工具入口。

### Rollback

- 本轮未触碰 `tmp_gzgov.html`，生产 SQLite 只做了备份和兼容迁移初始化。代码可用 `git revert 8a95ac8` 回滚，服务器数据可恢复 `/opt/ziwei-backups/ziwei.sqlite.20261004T104845Z.before-8a95ac8`。
