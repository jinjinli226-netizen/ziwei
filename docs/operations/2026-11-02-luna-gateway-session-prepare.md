# 露娜 Gateway 会话准备超时

2026-11-02，用户反馈露娜 Luna 报 `Gateway connection failed; no local fallback`。员工为 `employee_4fb67a76-5a3b-4fe8-8b88-d1366a6d0432`，Profile 为 `bot-a7f72618c15716b5eabcec39`，原失败动作为 `action_00866971-fde8-42a8-bac5-0331bf1b1c9a`。

## 原失败证据

北京时间 00:20:10 创建动作，00:25:00 电脑领取，00:25:02 开始执行，00:25:55 CLI 退出码 1。领取前等待与实际执行约 53 秒分别计算。00:26:07 原生 Profile 日志记录同一 WebSocket 的 `id=2 method=session.create` 回复发送失败，连接此前已关闭；这不是尚未建立连接的证据。同期 Profile 数据没有本轮新消息、admission 或 turn lease，平台没有 nativeSessionId 或 gatewayTurns。本轮未找到进入模型或生图的记录，不重放原业务。

实际安装的原生 `GatewayClient.rpc` 默认等待 30 秒；`connect_gateway` 的异常处理范围包含上下文内的 RPC，能把 `session.create` 的 TimeoutError 重新包装为笼统的连接失败。既有紫薇 180 秒冷启动预算只覆盖 ensure_gateway_runtime，不覆盖这段会话 RPC。只读复查既有 owner 的 discovery、WebSocket 与 runtime.describe 均正常；未启动或重启共享 Gateway。

session.create 包含配置和会话私有 MCP 的准备路径，但当时没有线程栈或分段耗时，不能把慢返回归因为 MCP、SQLite、模型 provider 或其他某一内部步骤。

脱敏诊断位于 `D:\AINavtie\ops\ziwei\luna-failure-readonly-20261102`，包括 `LUNA-NATIVE.json`、`LUNA-SESSION-OWNER.json`、`LUNA-OWNER-PROBE.json`。原失败、会话和配置保留。

## 修复范围

- 会话桥仅为原生 session.create/session.resume 设置有限的 180 秒默认 RPC 等待，覆盖已有恢复和 policy conflict 处理路径；显式 RPC timeout 保留，其他 RPC、WebSocket 连接、动作和模型预算不变。没有增加重试、创建第二会话或重发 prompt。
- 会话准备 RPC 的 TimeoutError 保留原因并转换为 `BOT_GATEWAY_SESSION_PREPARE_TIMEOUT`，不再被原生上下文误写成连接失败。其他 RPC、网络和模型异常保留原分类。
- 受监督执行通过私有 stderr 回传真实的会话准备阶段；运行端核对 action、员工和 Profile HOME 后使用现有 session 进度通道显示，不向网页传递私有 HOME，不伪造 assistant 正文或 admission 终态。
- 原 admission 的退出清理仍受整体 12 秒预算约束，不因内部 resume 的默认等待而延长。原 Gateway、provider、model、推理等级和其他活动动作不改。

## 验证和发布

实现和独立审查已完成。相关 125 项回归均已通过，覆盖实际安装的 Gateway 编排源码、默认与显式准备预算、恢复冲突路径、原 admission 取消、未知终态、取消优先级、DSH 退出收敛和正文流式通道；lint 检查 440 个源码文件通过。额外的原生工具集用例起初使用不带 ruamel 的通用测试解释器，换用已有 Hermes venv 后通过，未安装依赖或改动产品源码来绕过该环境问题。最后修改的 JS 消费文件整组 34/34 重新通过。

## 原生安装和真实对话

修复源码 `23017f5b65c2f0b970002534cd3068fbdafa15eb` 已推送并核对远端。以本机实际 `6dbe3afa…` 安装为基线，仅叠加两个运行时文件，其余实际增量和既有 Python 缓存保留；官方 updater complete，新客户端 PID 44180，build `13ce4205817b59c297e6e01c44dac6576364c304951f1786880b468923b24ee4`。01:08:32 验收 health/ready 均为 200、connected，quarantine 和 fileIssues 为空。原 Gateway 6716 及其创建时间不变。

第一次 30 秒排空未完成时自动恢复接单，没有强杀活动任务；既有任务随后正常完成并投递，活动数和待投递数归零后才通过正式 stop 安装。原 PID 41344 自然退出，保留第一次排空回执、原结果和 journal。安装证据位于 `D:\AINavtie\ops\ziwei\gateway-prepare-release-20261102\INSTALL-ACCEPTANCE.json`，passed=true。

01:09:42 在露娜原主聊天提交唯一只读验收消息，明确不调用工具、不重做原任务。新 action 为 `action_7b0decb5-1949-47e5-8c8b-5110631f71c8`，01:11:05 读回 succeeded，实际回复“露娜真实对话验收通过。”。沿用原 session `local-3be9395a7e92fbbe91a6ee49f1877a16e47afb7ee4631a75513f69c7b1fe90e8`；admission `3b13fd781bce43bf8dbd957b456fefa5`、generation 7，cleanup terminal/completed、verified=true、cancelRequested=false。Windows job 根进程 56332 退出码 0，treeConfirmed=true，activeProcesses=0。

正式 action.events 收到了 session.create 和 session.resume 的真实 started/ready 事件，timeoutMs=180000；同时观察到正文流式快照 sequence 1→9、字符数 1→11。这证明本次真实对话、准备进度及短回答流式已走通；真实环境此次准备耗时未超过原 30 秒，延迟超过 30 秒的情况由隔离回归验证，不声称本次生图或所有长任务都已验收。证据位于 `D:\AINavtie\ops\ziwei\luna-gateway-live-20261102\ACCEPTANCE.json` 和 `SESSION-PROGRESS.json`。

01:13:05 正式 CLI 资产发布完成，[下载包](https://qzelynth.top/downloads/cli/ziwei-latest.tgz)和[元数据](https://qzelynth.top/downloads/cli/release.json)均为 200，远端字节数、SHA、build 和 source 与验收候选一致。包为 715925 字节，SHA256 `6dac40cb8d4112b60d77bd97d40c2e21b93b75d8db5f33685b7cb367e08831d5`；发布回执 `D:\Ziwei-Local\artifacts\cli-download-23017f5-20261102\PUBLISHED.json`，passed=true。API、网页和手机端本轮未替换。
