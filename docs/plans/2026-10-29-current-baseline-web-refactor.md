# 最新基线网页重构实施计划

**目标：** 在已发布 `8e4f37a` 的完整链路上保留并完善用户要求的网页重构、可管理消息队列与 DSH 接入，不以旧实现反向覆盖正式能力。

**架构：** 复用现有持久 action、员工串行 scheduler、delivery 回执及原生会话绑定。队列界面投影现有 action；DSH 是新增运行时适配，不替换 Hermes Bot、身份或 provider 体系。

**技术栈：** 既有 Vue / @ziwei/ui、Node HTTP/SQLite、原生 CLI 与 HTTP/WS、node:test；不引入新的调度框架。

## 1. 保存并核准基线

- 已完成：旧改动提交 `0d9f504`，本机补丁/bundle 可恢复；当前完整基线 `8e4f37a`。
- 读取当前 `AGENTS.md`、`AI_HANDOFF.md` 与 `docs/FEATURE_MAP.md`。按照功能入口展开，不以历史本机证据判断正式状态。
- 安装锁文件对应的现有依赖，运行新基线相关测试；将结果与旧 304 项验收分开记录。

## 2. 网页交互约束

- 针对 `BotMainChat.vue`、`conversation-history.mjs`、现有员工/会话入口复现 IME 229、compositionend 500ms、40/120px 跟随和深链问题。
- 保留分页、滚动锚点、统一登录/BFF 与 memberships 校验；只修仍存在的路径。
- 复用最新能力清单组件和主动回填协议，不迁入旧的替代清单服务。

## 3. 消息队列管理

- 先用真实 repository 和 scheduler 测试核准当前排队行为，保留按员工串行及取消控制通道。
- 在现有 pending actions 上增加会话级可见、移除待发、暂停/恢复合同；不并行建立第二套独立 action 调度。
- 当前执行不中断；新输入和附件持久化；投递时仍由最新会话逻辑补入前序已完成回答、排除后续输入。
- 保留明确存活进程禁止重放、失败直接终态及 delivery 的持久回执与恢复。
- 新增有意义的 repo/HTTP/scheduler/组件测试，覆盖 FIFO、绑定、权限、失败、重开数据库和原生 thread 复用。

## 4. DSH 增量适配

- 从旧快照仅迁入新增 DSH 协议模块和已核准的官方 HTTP/mux fixture。
- 接入最新员工/设备权限、scheduler 和 delivery；真实 Bot 标识独立于显示名。
- DSH provider、模型、MCP、插件以其原生 home 为准，不把 Hermes 专用凭据/Profile 机制改写为通用复制机制。
- 群组各成员均须是当前工作区可见的真实绑定；保留 requestId、session 和回执关联，断线不重发业务。

## 5. 保护性回归与交付

- 回归精确 Codex 会话、owned profile、provider 密文/墓碑、MCP 延后配置、统一登录与 BigTron 开户权限、手机互联及主动回填。
- 复用既有测试，不重跑无关付费模型或手机业务；仅在新差异需要时增加隔离验收。
- 更新 `docs/FEATURE_MAP.md` 入口、差异和保留清单；提供明确源码 commit。
- 不部署、不升级正式客户端、不覆盖生产混合源码或数据库。原模型验收不替代新基线验证。
