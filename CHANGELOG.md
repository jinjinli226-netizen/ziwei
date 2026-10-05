# 变更记录

本文件只记录可追溯的项目级变更摘要；详细设计、验证命令和未完成边界见 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)。

## Unreleased（2026-10-05）

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
