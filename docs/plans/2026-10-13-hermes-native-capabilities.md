# Hermes 原生能力实施计划

Goal: 在现有员工与 action 链接入 Hermes 0.21.3 原生能力，并完成隔离验收。

Architecture: 版本化 BotConfig 是运行配置的唯一保存入口。每次原生操作使用绑定解释器与独立 Bot HOME 的短生命周期进程；原生记忆、技能、SessionDB、GoalManager、HeartbeatManager、Kanban 保留自身状态。模型回合沿现有受监管执行器，调度沿现有 automation。

Tech Stack: Node/Express/SQLite、Hermes Python、原生 MCP registry、Gateway adapters。

1. 在 test/hermes-native.test.mjs 写入身份、CAS、占用与 HTTP MCP 回归；运行红灯。
2. 增加 src/hermes-native-contract.mjs、backend native/action routes 与管理 MCP 操作。目录操作和初始化使用同一身份检查。
3. 增加 src/hermes-native-bridge.py，通过绑定 bootstrap 调用原生资源；写入回读、hash CAS，拒绝跨 HOME 输入。
4. 扩展 src/hermes-bot-config.mjs 与 HOME 配置映射，保持配置持久且仅保存凭据引用。
5. 在 src/local-action.mjs 集成 finite driver、协作与 Gateway 生命周期；已有 automation 承载 native driver 元数据。
6. 实际 Hermes + loopback 模型/MCP/Hub/STT/TTS/Gateway 验收；无外部请求、正式状态或业务动作。
7. 运行相关测试、全套测试、lint/build、只读复审，提交稳定候选与 E03 合同。
