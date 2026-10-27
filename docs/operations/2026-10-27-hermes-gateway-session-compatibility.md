# Hermes Gateway 会话兼容修复

来源：2026-10-27 用户真实知微聊天回报，以及本机已安装 Hermes `c2c5eef14924a09021ef8af1e8b9f1135879d89e` 的源码、原生控制接口和产品动作回执。源码测试、安装、模型回复和产品动作成功分别验收。

## 已证实的三个边界

1. `profile_parked` 是整机 Profile 迁移的重复凭据预检阻塞。旧测试 Profile 复制了 default 的飞书、微信凭据，使没有配置这些平台的知微也无法进入共享 Gateway。保留 default 作为既有平台所有者，用受支持的 `hermes config set platforms.<platform>.enabled false` 明确禁用旧副本中的重复适配器；没有删除 `.env`、Profile、记忆或授权文件。
2. 清除预检阻塞后，在原生实时控制接口确认零在途工作，并用原生 external drain 阻止新任务进入，再运行 `hermes gateway migrate --multiplex --yes`。迁移后 14 个 Profile 均被服务，parked 为空。迁移过程中的 stopped/starting 是中间状态，不能单独当最终故障。
3. 用户明确要求修复后发送一条验证消息。第一条新验证消息实际生成了固定回复，但产品动作仍失败：`BOT_REASONING_UNCONFIRMED`，随后还会被 `management_mcp_not_loaded` 阻断。新版 Hermes 在 Gateway 后台执行模型；旧版紫薇只在前端进程安装推理 guard、注入临时 MCP overlay，不能跨进程生效。CLI 退出 0、模型有答复、preflight matched 均不能替代完整产品成功。

## 会话适配

`src/hermes-gateway-session.py` 在现有 bootstrap 的 Bot 聊天路径安装会话桥。保留真实 `cli` / `oneshot` source、原 HOME、Profile 和已有会话。运行时能力必须明确声明 `shell_private_mcp_v1` 与 `strict_reasoning_receipts_v1`；新版 Gateway 缺少能力时拒绝，不静默降级。

管理 MCP 仅复制本次 overlay 的 `ziwei_management` / `ziwei-terminal`，经原生私有 transport 传递。秘密只在内存中供应；原生只持久化指纹与工具 manifest，恢复时重新供应。续接沿用原生控制权限、空闲检查和 revision/generation CAS；不伪造 ACP 身份、不把令牌加入 argv、普通 client_env 或日志。

严格推理要求作为每个 admission 的 effort/model/provider 输入，不篡改旧会话冻结策略。实际 SDK 调用边界在所有改写后核验最终 model/effort，不匹配时不发送请求。既有 `openai-codex / gpt-6.1-sol / max` 的精确兼容转换保留；其他模型、供应商或晚到的覆盖不能套用该例外。

实际请求证据由 Gateway 发布 typed `inference.request`，携带 Profile、session、admission、authority epoch、execution generation 和每次物理请求的 UUID。原生 view 与外层 owner stamp 和当前 admission 对齐后，前端再绑定员工和配置 revision，输出 `native_gateway_sdk` 证据。`src/hermes-bot-reasoning.mjs` 保留这些字段；缺失、旧执行代、预检冒充和未知字段均不能充当请求证明。

独立 Provider Key 另通过 `src/hermes-provider-key.py` 的临时 Namespace 送入原生 create/resume 的 launch-only Key 通道。无独立 Key 的 OAuth 路径不安装该包装。隔离 RPC 测试不能宣称独立 Key 的真实后台或模型已验收。

## 验证与发布边界

客户端发布版本由此前固定的 `0.1.0` 递增至 `0.1.1`，同步根 package 与 lockfile；构建标识仍作为精确文件身份。此前不同补丁只更新 `clientBuild`，所以显示版本一直相同。安装验收同时检查 `ziwei_user --version`、daemon 版本、目标 build 与认证心跳。

本项涉及紫薇前端桥和固定基线的原生 Gateway 扩展，两者需要分别验证和安装。不能仅发布紫薇包后声称已经兼容仍缺能力的原生后台，也不能用原生源树覆盖紫薇生产 API、网页或客户端已有增量。原生补丁须按原文件哈希逐文件应用，并保留可回退源码；不改用户数据库或用旧库覆盖当前状态。

可审阅的原生候选保存在 `src/hermes-native-gateway-compat/compat.patch` 与 `manifest.json`，身份为固定基线加精确补丁，不声称已经发布为 Hermes 官方版本。原生隔离回归 39 项及 4 个子测试通过；紫薇相关回归 35 项通过、零跳过，lint 通过。没有私有 MCP 和严格推理需求的普通 Gateway 聊天保留原生路径。原生独立上游提交的开发工具链缺少 Ruff 与 ESLint 配置依赖，未创建或推送上游提交；不把隔离测试等同于全部原生仓库 CI。

产品验收必须是新的小型验证消息，完整动作 `succeeded`，实际助手回复匹配固定内容，推理实际请求回执存在，管理 MCP 已握手，Windows 根进程与进程树退出均确认。原 `profile_parked` 动作及较早失败/unknown 回执原样保留；不重放原业务。

本机脱敏事件证据在 `D:\AINavtie\ops\ziwei\hermes-gateway-parked-20261027\`；原生独立退出/健康日志在 `D:\灵光爸爸拆解\.local\hermes-gateway-parked-20261027\observer\logs`，10 秒采样，已以隔离进程验证正常退出、外部终止、unclean 恢复、身份错配、重复实例及轮转。源码测试通过不自动表示安装或产品聊天已完成，最终结论以本事件验收回执为准。
