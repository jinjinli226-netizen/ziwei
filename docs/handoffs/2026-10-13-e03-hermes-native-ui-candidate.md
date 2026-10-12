# E03 Hermes 原生能力界面候选

后续状态：E02稳定候选已组合，唯一5283/4283预览已按原状态根更新并完成真实原生HTTP与持久页面验收。最新数据、证据及两项待修后端审查见 [原生持久预览交接](2026-10-13-e03-hermes-native-preview.md)。下文保留此候选形成时的历史记录。

2026-10-13，Asia/Shanghai。完整原生集成仍在继续；本文记录可审查的前端候选与后续集成入口，不把合成回执当作真实 Hermes 验收。

工作树 `C:\Users\25941\.codex\worktrees\v2-e03-hermes-full-ui\灵光爸爸拆解`，分支 `codex/v2-e03-hermes-full-ui`。基线 `90e588b84a7a69a0ec41fbe41e5ebfb18debdb8a`。第一版预览仍在旧树 `v2-e03-hermes-bot-ui` 的 5283/4283，本轮尚未替换、启动第二套长期预览或修改正式服务。

## 实际前端实现

- Bot 与 Team 继续共享 employee、BotConfig、主聊天、控制状态和版本；四个原生工作分区在同一 Bot 草稿下操作，URL `?section=knowledge|collaboration|channels|proactive` 支持刷新和历史导航。
- 资料与工具：MemoryStore 文档/用户画像读取、CAS 修改、原生逐条移除及最后一条明确清空；SessionDB 搜索和会话读取；技能目录/详情、正文安装/更新/删除、启用/禁用、Hub 查询安装及更新结果；stdio/HTTP/SSE MCP、环境/header 引用、工具过滤、超时、实际加载检查、工具 schema 和调用结果。
- 伙伴协作：同工作区精确目标的 message/group/delegate、保存目标授权、源派发与目标执行分别显示；原生群组列表/事件/决策/有界推进。带来源 Action 的数组回执保留逐目标 ID；丢失响应后按真实 A2A dedupe_key 找回同一批次，不重新派发。
- 消息与音频：Gateway 平台、环境引用、allowlist 和路由；原生同步、连接/断开、精确会话发送；配置与原生最近进程/渠道报告、STT/TTS 配置分别展示。浏览器录音单请求启动、离开时关麦克风；音频上传转写、TTS 多文件播放及语速/指导。
- 主动工作：原生 Goals 状态、结构化验收约定和有限控制，Heartbeat 状态与间隔，Kanban 原生任务创建/详情/分诊/领取/Run 结算/阻断/派发。异步领取后准确更新 `current_run_id`，手动 Run ID 只提交原生正整数。
- Routine 可创建 `goals.step`、`heartbeat.step`、`kanban.dispatch`、`groups.step` 驱动，保留紫薇唯一调度权威；已有 Routine 的执行类型不可在前端假装修改，因为当时后端 updateRoutine 尚不更新 native_driver_json。
- 基础/能力配置补记忆字符上限、技能 autoLoad、management 权限、累计回合预算与截止时间。Bot 主聊天恢复目录检查，设备/模型绑定继续由后端原子校验；旧员工初始化依实际初始化 API 和冲突回执，不以过时的前端预检替代后端修复。

## 契约与恢复

实际调用 `POST /api/workspaces/:slug/bots/:id/native/actions` 与 `/collaboration`，保留 expectedRevision、expectedControlEpoch、同意图 idempotencyKey。只查询原 action 或逐目标 ID；核对工作区、员工、资源/操作、有效版本和 requestId。

E02 受控 Goals/Heartbeat/Kanban driver 当前返回 `_prepare/_settle/_fail`，群组返回 `groups.read` 或 `collaboration.publish`。适配器只有在原 public payload 匹配时接受这些精确内部阶段，保留 raw NativeReceipt，没有修改它的 resource/operation 或将失败转换成功。

执行未知/未终态/uncertain 保留 execution pending 并阻止新意图。action 成功但读回失败保留 `readback_required`，恢复只读、不重写。Memory staged 的 review 元数据单独保存，不参与全局或同 scope 永久锁；不会将读文档或后续新修改称作批准原提案。当前合同没有审批/丢弃 API，因此界面保留旧审核 ID 和缺少终态证据的说明。

sessionStorage 只保存归属、请求/动作 ID、版本、允许的读取标识及恢复阶段；不保存记忆正文、消息正文、MCP 参数、音频或凭据。完整页面刷新后的测试使用新模块实例，覆盖实际 metadata-only lookup。

## 已验证范围

证据均在本树 `.local`，未提交用户数据或秘密：

| 检查 | 最近结果 | 证据 |
| --- | --- | --- |
| 完整 Node 回归 | 795/795，0失败/跳过，71.46秒 | `.local/e03-full-evidence/full-verified.txt`；随后仅增加逐条记忆移除界面，已单独编译/浏览器验证 |
| 核心原生 UI 单元验证 | 39/39；后续 Routine helper 10/10 | controller、transport、native-data；精确阶段/归属、读回失败、fresh reload、review、协作数组/丢回包 |
| 原界面浏览器 | 15/15，页面异常0 | `.local/e03-ui-evidence/browser-fixture-result.json`；含 Bot 目录检查与 native Routine |
| 原生面板浏览器 | 18/18，页面异常0 | `.local/e03-native-ui-evidence/result.json`；含异步技能连续 CAS、异步 Kanban claim、单次麦克风启动、协作丢回包刷新恢复 |
| 构建 | 1781 modules，通过 | 主入口约502kB的原有体积提示仍存在 |
| lint | 104 sources，通过 | 产品源码检查 |

两份浏览器脚本全部拦截在 `ziwei-fixture.invalid`，不启动服务、不调用 Hermes/provider/真实设备；回执标记 `fixture:true / fixture-only`。它们证明界面与当前实际 schema 相接，不证明真实 provider 或 24小时运行。

## 后续集成与唯一预览

E02 工作树 `C:\Users\25941\.codex\worktrees\v2-e02-native-capabilities\灵光爸爸拆解` 此时 HEAD 仍为90e588b，原生源码未形成稳定提交。已只读见到其47项 installed-native-with-loopback-protocol-peers 验收摘要及真实 Gateway/group/DM/delegate runtime 证据；这些由E02运行，不能归为本前端已完成HTTP/浏览器原生验收。待E02稳定候选后挑入本树，执行实际产品HTTP与原生回执集成，再核对最终构建及浏览器。

唯一现有预览入口为旧树 `frontend/preview/supervisor.mjs`，使用 Node + 原生 Vite CLI。更新前重新核对 registry、实际监听/进程与完整命令行身份。保留 `.local/bot-preview` 全部 SQLite/对象、fixture 身份/种子标记、随机访问凭据、runtime-home、实例及日志历史，同时作为opaque资产保留旧树 `.local/employee-env.key`。不读取或回显秘密，不仅复制主SQLite，不覆盖原用户创建数据；旧预览正常结束后才能一致迁移。新原生执行器和预览政策须一并审查，旧通用 fixture worker 不能答复 native 动作为成功。

正式D目录、2884、服务器、现有客户端、Creator HOME/记忆、用户删除状态及真实设备均保持原边界。此时没有完整24小时耐久、外部渠道账号、正式模型/provider或正式上线结论。
