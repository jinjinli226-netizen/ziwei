# 变更记录

本文件只记录可追溯的项目级变更摘要；详细设计、验证命令和未完成边界见 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)。

## Unreleased（2026-10-03）

### Added

- 新增 `PROJECT_MANAGEMENT.md`，集中维护架构、启动、数据、扩展、排障、测试、发布和 AI 接手流程。
- 新增代理解析与继承：`ziwei_user` 在没有显式代理环境变量时，可读取 Windows Internet Settings 的启用代理并传递给本机 CLI。
- Codex CLI 调用使用 ephemeral 会话，避免桥接器复用遗留 CLI 会话状态。

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
- `npm test`：104 passed；`npm run lint`：passed；`npm run build`：passed；本轮未对生产服务器或生产 SQLite 做写入。
- 隔离 HTTP 验证：实际 `scripts/ziwei-mcp.mjs` 客户端通过 `/mcp/v1` 返回 health、员工列表和窄管理面能力；本机 Hermes profile 发现 5 个，`ziwei-aigc` 校验通过。

### Deferred

- 伙伴市场、帮助中心和邮件发送保持现状并延期；本轮未用假页面标记为完成。远端 Git、生产外部存储/队列、OAuth、计费、沙箱和完整浏览器逐页截图验收仍延期。

### Rollback

- 本轮代码未触碰 `tmp_gzgov.html`、生产服务或生产 SQLite。审查前可用 `git diff` 保存补丁；若已提交，按提交粒度执行 `git revert <commit>`，并保留数据库迁移表以兼容旧库。
