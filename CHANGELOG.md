# 变更记录

本文件只记录可追溯的项目级变更摘要；详细设计、验证命令和未完成边界见 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)。

## Unreleased（2026-10-03）

### Added

- 新增 `PROJECT_MANAGEMENT.md`，集中维护架构、启动、数据、扩展、排障、测试、发布和 AI 接手流程。
- 新增代理解析与继承：`ziwei_user` 在没有显式代理环境变量时，可读取 Windows Internet Settings 的启用代理并传递给本机 CLI。
- Codex CLI 调用使用 ephemeral 会话，避免桥接器复用遗留 CLI 会话状态。

### Fixed

- 修复 Codex CLI 因 daemon 未继承本机代理而持续等待并最终报告 `A2A action timed out after 600000ms` 的问题。
- 真实短 CLI 请求已通过代理返回 `OK`；历史失败动作仍保留原始失败状态，需要重新发送。

### Verification

- `npm test`：84 passed
- `npm run lint`：passed
- `npm run build`：passed
- `ziwei_user /readyz`：ready
- 后端 `/healthz`：HTTP 200

### Deferred

- 远端 Git 双向同步、生产级 PostgreSQL/Redis/对象存储/队列、OAuth/计费/沙箱，以及完整浏览器像素和跨平台安装验收仍未纳入本次完成范围。

## 维护规则

每次功能变更都追加日期、目的、影响边界、验证命令、未验证项和回滚方式；不要修改历史条目来掩盖旧状态。
