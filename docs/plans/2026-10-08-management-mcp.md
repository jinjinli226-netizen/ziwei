# 紫薇管理 MCP 真实员工接入

状态：已实现、推送并部署；2026-10-09 完成真实管理 MCP 创建和 Codex/Hermes 首次及进程刷新后验收。最终资源 IDs、测试、发布、截图、清理与边界见 [最终验收记录](../operations/2026-10-09-management-mcp-acceptance.md)。

- 目标：开放平台展示准确的 stdio 管理 MCP 接入；正式员工搭建师在 test_222 的真实 Codex 执行会话中发现设备/运行时/profile，分别创建并试运行 Codex 和独立 Hermes profile 员工。
- 边界：不改 phone_ai 真实手机、手机绑定、控制端协议、DNS/IP/端口；保留原 D 目录用户修改及接续工作树三份未跟踪文件。API Key、MCP bearer 和设备凭据独立。
- 入口：/:workspace/open-platform、员工配置、/mcp/v1/workspaces/:slug；MCP 客户端经 stdio 启动 scripts/ziwei-mcp.mjs，再经 HTTPS 调工作区管理 API，该 HTTP 地址不是远程 MCP transport。
- 数据：复用员工职责、人格、技能、目标设备、runtime/profile、环境变量、A2A 与任务记录；按需增加幂等和执行证据，凭据不进入 Git、前端源码、提示词或日志。
- 执行链：工作区管理 API → A2A → 用户目录配置的真实全局 ziwei_user → 明确选择的 Codex/Hermes CLI → stdio MCP → 管理 API → 创建员工/试运行 → 回读 action/task 终态。
- 验收：自动化测试覆盖认证/工作区、发现选择、启动注入、幂等和不可用反馈；全套串行测试、lint/build；真实 HTTPS 浏览器截图与错误记录；模型实际 MCP 工具调用、创建读回及两个无副作用任务；进程刷新后复验。
- 运维：已发现全局 npm 安装是指向旧 D checkout 的 link，必须备份 link/原用户配置，再使用验证后的打包安装；配置 API/workspace/device/凭据/工作目录及 20242 保留。服务器沿用双 SQLite/配置备份、发布目录与 current symlink、原 systemd 服务；保留旧 hash 资产和 APK。代码回滚不恢复覆盖业务数据库。

当前基线：接续工作树 ae5c972；主站 81b6ec8，控制端 8a4fe59（待本轮线上再次核验）。真实 daemon 初始 PID33260，ready=true，test_222，canonical API；Codex 0.162.0-alpha.2、Hermes 0.21.3 可被发现。发现 CLI 不代表认证/provider/管理 MCP 已通过。

最终交付：管理实现 `bef1944`，生产前端补丁 `4acfeb4`、`4db30ce`（当前）；正式搭建师与两名 QA 真实员工均已加载并调用管理 MCP，独立 Hermes profile 保留主配置；两 QA 首次及刷新后共 4 项只读任务实际 succeeded。全套 235/235、lint/build、隔离浏览器 6/6 及窄屏标题 2/2、真实 HTTPS 1440/390 验证通过。原设备身份/工作区/健康端口不变，控制源和手机未改；旧基线与当时“待核验”描述作为实施前历史保留。
