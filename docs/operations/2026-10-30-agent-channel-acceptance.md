# 本机三运行时通道验收（2026-10-30）

基线网页为 `57531bd`。`94196d1` 修复普通 Hermes 员工经原生 Gateway 聊天时丢失执行私有 MCP；`2daa821` 在 unified 模式复用既有配对设备短期管理凭据验证，保留 deviceScope，未恢复静态 owner token。`e6dd591` 归并已验证的 DSH 原生终态维护扫描修复。

## 已验证

- 合并后的 Gateway/bootstrap/unified MCP 与管理凭据边界回归 45/45；DSH 维护回归 21/21；lint 检查 345 个源码文件通过。
- Hermes 真正主目录是环境 `HERMES_HOME` 所指的 `C:/Users/25941/AppData/Local/hermes`，原配置 `openai-codex / gpt-6.1-sol`，代理 `http://127.0.0.1:7890`。`C:/Users/25941/.hermes` 是旧目录，不作为本次继承来源。
- 已配对本机身份 `device_ea81efb4-daf6-4140-b8ac-31d5aa7eabd2`。Windows Store 应用的 AppData 虚拟化别名与独立进程视图不同；独立启动时显式指定本次既有 LocalCache 用户目录，避免连接到旧 device_bfd9 身份。
- API 窄改动已部署至现有服务，网页资源沿用基线构建；真实设备管理 MCP health 和员工回读成功。
- Codex 网页/API 消息 `action_51d4e352-b872-47a2-9cb2-4ecd759d691f` 成功，返回 `CODEX-CHANNEL-OK`；Windows 进程树结束确证且 activeProcesses=0，原生会话映射持久保存，管理 MCP loaded=true。
- DSH 网页/API 消息 `action_b1fe6f65-a633-4354-97e1-7e2d0df42c5c` 成功，返回 `DSH-CHANNEL-OK`；复用原生会话 `session-95902602-d7c3-410d-84f8-3e092e997973` 的第二轮，completed/terminalConfirmed=true。
- 修复源码运行的 Hermes 真模型会话 `local-2be74c5bf7d51fd5f9b119e07f644365a0c1b0463df1484213605425778867ad` 返回 `HERMES-MCP-OK`；审计 initialize/tools/list 成功，实际 `ziwei_mcp_health` 调用成功。此条为源码原生验收，尚不是安装客户端后的网页消息验收。

## 安装客户端后的最终验收

官方更新器已完成合并包安装。安装后 build `2c5c054d8ac48e380652da6eaf2c10f3bd604eca450a3f880053d7e4caf1ed29`（npm 对 bin 脚本换行规范化），PID 18924，20242 唯一监听，ready=true。Hermes 网页/API 第一轮 `action_ccf29715-5e54-4587-b72b-f4fc676ffb40` succeeded，返回 `HERMES-CHANNEL-OK`，管理 MCP loaded=true 且 `ziwei_mcp_health` 实际调用成功；第二轮 `action_e3986dd1-e57a-470d-958f-71a1bc2c558e` succeeded，准确回复第一轮口令。两轮均有 Windows 进程树退出确证和 activeProcesses=0。两轮应用会话上下文已验收；普通员工每轮由 Hermes 生成各自 native session ID，不将此描述为复用同一原生 session。现有历史失败保留。最终 ready/maintenance.safe/stopSafe 均 true、activeActionCount=0。

本机独立日志在 `D:/Ziwei-Local/logs/hermes-channel-20261030/`，仅脱敏结论入 Git。统一登录 OP 曾间歇 502，API public config 的 ready 仅表示本地配置齐全。

