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

