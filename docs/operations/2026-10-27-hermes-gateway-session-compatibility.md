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

## 原生快照字段修复（0.1.3）

本机实际安装 `0.1.2 / cffd5404…` 后，第二条新验收消息在模型调用前以 `BOT_GATEWAY_SESSION_MISMATCH / exit 125` 被拒绝，不能记为聊天修复完成。仅只读连接原生知微 Profile，按精确既有标题读取、恢复同一会话，确认原生 snapshot 没有顶层 `profile_id`，身份在 `info.profile_id`；与 `runtime.describe` 的 Profile、authority epoch 均匹配，既有历史为 406 条，未创建会话或提交 prompt。原生 `gateway/session_controls.py`、`gateway/session_local.py` 与 `GatewayChatView` 的实际投影也相符。

前端桥此前误读顶层字段，隔离夹具也错误添加了该字段。修复统一读取原生嵌套身份，要求与已认证 describe 相同；若同时出现顶层字段，必须一致。缺失、冲突、非法 Profile 或 epoch 均在 admission 前拒绝；实际请求证明同样绑定该身份，不向 snapshot 填造字段、不清历史、不放宽 HOME/模型/MCP 校验。客户端及 lockfile 版本递增至 `0.1.3`。

夹具先改成实际原生形状，原实现出现 7 项预期失败，再实施修复。复制本机实际原生 `gateway_chat.py` 的前端路径参与父会话复核，27 项桥接、独立 Key 及 SDK 回执测试通过，零跳过；独立 Key 仍限隔离 RPC 验证。原第二条失败动作和退出证明保留，新包安装及下一条消息仍需独立现场验收。

## 原生 authority 的提交闭集补齐

第三条新消息已恢复既有原生会话，但在模型前以 `invalid_params / exit 1` 失败。真实 `SessionConnection.dispatch` 已在 wire schema、connection submission 和 `cli_turn_v1` 接齐严格推理参数，随后 `SessionAuthority._submit` 的独立闭集却仍拒绝这三个字段。原假 RPC 测试没有经过该边界，不能替代实际分发链路。

原生增量仅在 `gateway/session_authority.py` 的闭集加入 `strict_reasoning_effort`、`strict_reasoning_model` 和 `strict_reasoning_provider`；AST 比较确认其他语义不变。原 16 个兼容文件及原补丁块逐字节保留，完整补丁扩大为 17 个运行文件。此增量独立于已发布的 `0.1.3 / 56511f8f…` 客户端，正式客户端工件及其内含旧补丁材料保持不可变，不能因此改写已发布包的 SHA。

新增测试经过真实 dispatch、authority、SQLite、幂等、离线 SDK 和 typed view receipt；先在原 authority 复现两个正例被拒绝，修复后 9 项通过，原未知参数、权限及 source 拒绝保留。官方 runner 的相关三文件合计 35 项通过。第三方 Pydantic 插件的环境扫描曾触发隔离测试 HOME guard；仅在私有测试 runner 禁用插件扫描，产品代码及 HOME guard 均未放宽。现场重载仍须单文件 SHA、原生 external drain、两次零在途检查、官方 restart 和新消息验收，不能将离线测试直接记为业务成功。

## Windows 审计文件视图与整体验收

原生增量已按 `ec355e92…` 应用并官方重载至 PID 61328，17 文件、14 个 served Profile、零 parked、无残留 drain 的独立只读复核通过。第四条消息已真实生成固定答复且 Windows 根进程/进程树正常退出，但产品仍以 `management_mcp_not_loaded` 拒绝。真实 stdio 子进程已经完成 initialize/tools-list；其正确 action 审计文件存在于 Codex/MSIX 的文件视图，在实际 `ziwei_user` 的系统视图却不存在。不能将其改判成功、伪写握手、关闭 loaded 校验或盲目搬迁 HOME。

只读双视图比较确认 Hermes 17 源文件及知微配置、记忆和 SQLite/WAL/SHM 均相同。因此修复方向是让官方网关从已验证的系统上下文启动，使真正 MCP 子进程和本机客户端读取同一审计文件。启动前用实际 Node 核验真实配置 SHA，保留原安装、Profile、HOME、身份和原失败回执；不用 WMI 启动 updater，不以 UI 输入终端命令。

用户随后明确要求“修复好再上线”。后续发布和本机服务变更因此暂停，先补以下隔离验收；不能再用分段单测代替整单成功：

- 真 stdio 双上下文用实际安装的 `scripts/ziwei-mcp.mjs` 完成 initialize/tools-list，各返回 24 个工具，并由实际 `managementMcpReceipt()` 读取。重现旧视图分叉后，系统上下文的真实子进程、客户端读取和独立观察器得到同一审计 SHA、loaded=true。网络、业务工具调用、模型调用、生产变更均为零。
- 整单入口直接导入实际安装的 `0.1.3 / 56511f8f…` 执行器，经过 Windows Job、实际原生 dispatch/SQLite/SDK guard/typed view/bridge/parser 和实际 stdio audit，到真实 ActionDispatcher 最终 succeeded；同 SID 历史 2→4，前缀及每例两条旧失败的 SHA 保留。
- 缺失审计、缺失/错绑 SDK 回执、action 授权错绑四类负例均按原生产门禁拒绝。父会话独立复跑同一入口，五例全部通过，exit 0。

整单夹具明确替换 CLI 发现、授权 HTTP、SDK 返回、WebSocket 传输和 MCP 池编排；stdio adapter、manifest、审计与产品读取/成功判断实际运行。离线 SDK 不证明新物理模型请求，不能把此测试写成现场聊天已成功。单入口及替身边界保存在事件目录 `offline-acceptance/ACCEPTANCE.md`，执行为 `node --experimental-vm-modules <事件目录>/offline-acceptance/run.mjs`；父会话证明 SHA 为 `1b4a755ddcc86faab406bbc2e48b840d4f89827eb7b5f1886f90067042cad8b5`。真实双上下文证明为 `MCP-DUAL-CONTEXT-ISOLATED-ACCEPTANCE.json`，SHA 为 `dbdbc3245576745f9b855166929b6717562bc3b54fa6a2a4360d034905197afb`。

隔离验收通过后仍需统一切换的原生进程/文件视图复核，以及一条新的有限真实消息：同一个既有原生会话，实际 SDK 请求回执、管理 MCP 握手、产品 succeeded、实际助手回复和旧失败记录保护全部通过后，才可宣告修复完成。

统一切换前另完成全部 14 个 served Profile 的双视图只读核验：70 项 config/.env/SQLite/WAL/SHM 与 14 个 memories 聚合摘要均相同或明确同时不存在；现存文件各视图两次摘要稳定，差异及不稳定项为零。没有 SQL 连接、checkpoint、Profile 写入或模型调用。证据为 `ALL-PROFILES-NAMESPACE-COMPARISON-FINAL.json`，SHA `83389e476408311b9e7f5e11cd053ec6111402f712c7f91bbb1016eb13a17b3d`，不能用单个员工的数据比较代替涉及全部 Profile 的上下文切换检查。

## 最终现场验收

2026-10-27 15:10（Asia/Shanghai），在上述隔离整单及负例、真实 stdio 双上下文、全部 Profile 数据核验通过后，统一从现有桌面 Explorer 的系统进程接口执行官方 `hermes.exe --profile default gateway restart`。只做这一次上下文切换，没有再次发布客户端、改源码或配置、搬 HOME、复制数据库。原生新 PID 为 59448；首次就绪探测延迟记录保留，独立只读复核随后确认 17 源文件、14 served、零 parked、无 drain 和两项兼容能力均通过。

最后一条唯一新消息使用 `hermes-gateway-recovery-20261027-zhiwei-v5`，正式 action `action_d96d2a13-6114-417d-aca8-a26a3bc09b9c`，状态 `succeeded`；助手实际回复“知微在线，验证通过”。实际安装仍为 `0.1.3 / 56511f8fa78ed5dad96064c6fceb6df41445ec8b42740081b657f89268e92148`，本机 PID 48228，配置原字节 SHA 未变。

该次真实 SDK 证据为 `native_gateway_sdk / phase=request / requests=1`，`openai-codex / gpt-6.1-sol / requested=effective=actual=max / nativeActual=max / mode=native`，六项执行绑定一致。沿用原生会话 `20261017_013836_f47f1b`；管理 MCP `loaded=true`、实际业务工具调用为零；Windows 根进程退出 0、进程树确认且活动子进程为零。员工配置和六条既有失败回执在消息前后 SHA 均不变，未重放原业务。

脱敏最终证据为事件目录 `BOT-SMOKE-V5.json`（verified=true）、`INTEGRATED-ROLLOUT-GATE.json` 和 `NATIVE-GATEWAY-CONTEXT-READBACK.json`；真实客户端强协议升级的独立证据是 `CLIENT-PRODUCT-UPDATE-V3-READONLY-ACCEPTANCE.json`（worker+heartbeat 均验证）。本机与网关独立退出观察器分别为 4904→48228、75832→59448，均为 10 秒采样并保留原日志历史。此结论仅覆盖实际知微 OAuth 路径和本次无业务工具调用的有限验收，独立 Provider Key 仍仅隔离测试，不宣称所有供应商或全部管理/手机业务操作均已实测。

本机脱敏事件证据在 `D:\AINavtie\ops\ziwei\hermes-gateway-parked-20261027\`；原生独立退出/健康日志在 `D:\灵光爸爸拆解\.local\hermes-gateway-parked-20261027\observer\logs`，10 秒采样，已以隔离进程验证正常退出、外部终止、unclean 恢复、身份错配、重复实例及轮转。源码测试通过不自动表示安装或产品聊天已完成，最终结论以本事件验收回执为准。
