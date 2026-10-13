# Q01 最终组合独立联验

2026-10-13，Asia/Shanghai。Q01 仅作独立 QA，没有原创产品修复、正式部署或重复云模型动作。

## 验收结论与准确版本

**本轮既定的 UI / 控制 / owned Profile / 主聊天 / 真实 Codex 首链组合验收通过，未发现新的产品阻断问题。** 这份结论覆盖下面列出的场景及证据，不等于全部 Hermes 能力已接入，也不等于正式环境、外部消息平台或全天调度已上线。

- E03 运行产品候选：`5643d5d36c3cd85d74ab849c77f52b6f69555093`；E03 最后文档 HEAD：`667a4f8a61f5421faf372c9a067bfc376872f9ac`。
- Q01 真实云产品执行冻结 SHA：`5ed970666907b16a1818464bbc0397ec7136d8af`，包含 E02 `7e846cd845831357efe2f4ed402aec592d2fcb09` 的同源挑入。
- Q01 最终组合执行 SHA：`a70f05e078d29d104daf5db1f47a7cff17f40b53`，只在已验证组合上挑入 E03 的前端/发现补丁 5643。随后新增的是 QA 文档和证据。
- 独立 `git diff --quiet` 确认：Q01 a70 与 E03 5643 的 backend、src、scripts、frontend 全部源码和验证文件一致；Q01 云执行 5ed 与最终 5643 的 backend、src、scripts 无差异。因此已完成的真实云端结果可归入最终组合，不为前端补丁重发模型请求。

## Q01 新执行的最终回归

| 检查 | Q01 结果 | 证据 |
| --- | --- | --- |
| 最终完整 Node 测试 | 892/892，fail/cancelled/skipped/todo 均 0；57093.6036 ms | final-full-node.log |
| lint | 121 源文件通过，exit 0 | final-lint.log |
| build | 1787 modules，exit 0；508.17 kB 主包的既有体积 warning 保留 | final-build.log |
| 最终真实预览 UI/控制不变量 | 10/10，真实持久 API 与已安装 Hermes | final-audit.json、final-live/ 各阶段原始快照 |
| 本轮真实云产品功能场景 | 6 场景、12 actions succeeded、4 模型动作 completed；原 raw harness 计数失败单独保留 | 2026-10-13-q01-product-real-first-chain.md 与对应 evidence/ |

之前 Q01 已新执行的 reasoning/owned 针对回归 15/15、安装版网络阻断原生 reasoning 边界 8/8 与 7 个 config/preflight 场景，以及 owned UI/丢回执/记忆隔离、receive-health 验证仍各自保留在阶段报告中。没有把作者的 892 或 browser fixture 数字计入 Q01 结果。最终完整 Node 只跑一次，测试、lint、build 的独立命令均确认 exit 0。

## 真正的参数 UI / 控制联验

按 E03 上海 16:53:57 稳定检查点进入原持久预览，通过界面仅创建一个临时 QA Bot：

- employee：`employee_6ae5ac62-2574-4abb-aa45-7c8cfe0532f9`，名称 `Q01 Final reasoning 20261013`。
- Profile：`bot-3d2b9626d2c375841c473e35`；主聊天 `conv_3f9d57b8-1de6-4f1c-a563-7539476b5e85`。
- actual HOME：`C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview\runtime-home\.hermes\profiles\bot-3d2b9626d2c375841c473e35`。

1. 首创建原生 provision succeeded，真实设备 heartbeat 中该 Profile 的 `owned_profile=true / initialization_source=false`；Q01 计算 stage=provisioned，UI 显示“专属 Profile 已创建”。此前发现状态 P2 已闭环。创建弹窗初始化来源只有 default 与空选项，不出现该 owned Profile，模板隔离继续生效。
2. UI 从未指定选择 max、保存并读回，实际 API revision=2/config.reasoningEffort=max；刷新后仍为 max。身份、Profile、HOME 和 main conversation 不变。
3. 该持久预览始终使用 `custom:preview-local / preview-local-model`。真实 config-only 原生检查明确拒绝这个不支持 max 的模型，status=failed/control=draft/externalModelCalls=0。没有把本地模型冒称 Codex，也没有修改其网络或 provider 限制。该失败是必要的负向验收证据。
4. UI 选择“未指定”并保存 revision=3；API 中 **不存在** reasoningEffort 字段，未发送/保留 null。检查 revision=3 成功后，同版本启用成功。
5. 已启用 Bot 再通过 UI 保存 max 为 revision=4；旧检查 revision=3 变为 stale，控制回到 draft。两次直达 API 的当前 revision 启用负向请求均返回 409/BOT_NOT_VALIDATED。主聊天中填入合成草稿后发送按钮不可用，按 Enter 没有产生 conversation.execute 或消息。
6. 删除显式档位并保存 revision=5，重新检查及启用。唯一一次本地模型聊天 succeeded、2 条消息（1 user+1 assistant），配置 revision=5；实际 HOME/profileHome 均等于上面的 owned HOME，Windows Job root/treeConfirmed=true、activeProcesses=0，原生 session `20261013_171644_8bacf8`。该 local reply 只证明 UI→真实 API→已安装 Hermes→结果回传，不属于云质量证据。

运行明细共 5 个 actions：1 provision、3 config validation、1 conversation.execute；4 succeeded、1 明确的 unsupported max validation failed。没有 pending/acked/uncertain，也没有为了失败校验重复模型动作。

## 主聊天 / 团队 / 390px

Bot 与团队 API 始终同一个 employee ID。界面的“在团队管理查看”自动展开同一个员工菜单；该菜单“Bot 设置”返回原 employee 的 settings URL。所有保存始终同一 Profile/HOME/main conversation。

独立主聊天 desktop 根宽 1280，390px mobile 根宽 390；工作区全局导航计数为 0，AX 树只有 Bot 主聊天，没有原工作区全局 chrome。region/editor/compose/tools/chips 内部横向溢出集合为空。刷新仍是同 ID、同会话并有实际回复；返回、浏览器前进后退恢复对应 Bot 详情或独立主聊天；“打开长期聊天”和“进入主聊天”打开原同一 conversation。

普通 `/preview-bots/inbox` 页面 mainChat=0/globalNavigation=1，标准 Inbox 导航保留。直接访问此 Bot 的 **主会话 ID**（即使删掉 query 参数）会重新识别其 main conversation 并保持独立主聊天；这是主会话恢复行为。初次 QA 用 navigation 角色等待该主会话的普通导航超时，随后按实际 DOM/路线核实；没有浏览器产品错误，console error 集合为空。raw UI 观察文件保留该过程，未据此制造一个产品 P2。

390px 设置容器、按钮/下拉容器没有横向溢出，max 菜单左右为 136/296，全部 input 边框在 0–390 内。初始诊断把名称长文字内部 scrollWidth=213/clientWidth=181 计入 overflow；随后核实该文本输入 overflowX=clip、实际边框 124.33–307，容器未扩张。两份诊断都保留，不将控件内部文字滚动等同布局溢出。手机宽度重点验收的独立主聊天完全符合要求。

## 真实 Codex max 与原始失败的归属

使用原机器 `openai-codex` 订阅认证，只读来源 auth/config/.env，既有代理 `127.0.0.1:7890`。服务对 ultra 返回明确 HTTP400/invalid_value，用户授权 Bot max 后，max HTTP200 且精确返回 gpt-6.1-sol/max；没有触发 xhigh 降级。编码/审查/验收聊天的 ultra 设置未改。

正式产品路径的真实 A/B owned Profiles、A 记忆 CAS/连续两主聊天/重建执行器续 session、B 模型记忆隔离、A 普通任务同 HOME 已完成 6 场景；12 产品 actions 全成功，4 云模型动作 completed。最终 4 份上游返回都为 gpt-6.1-sol/max，总已返回 usage 18080，失败 attempt usage 未知/null；requestId 无响应头为 null。

必须准确保留 **原 cloud harness exit 1/status=failed**。它误假设每个请求都 completed，末尾断言 4≠5。真实首次 A 的一个 HTTP200/SSE 明确服务过载 error 后，安装版在同原 action、同 session、同客户端请求标识、同 model/max 内一次有界 API 重试成功；5 attempts=4 completed+1 explicit error。Q01 白名单 wire、原生日志、源码 retry 路径和独立离线不变量审计与 SessionDB/dispatcher/MEMORY 副作用对账一致：没有未知断流重放、重复任务、工具调用或重复记忆作用。原文件未改绿、未重跑已完成云模型动作。该结论只适用于这一次有明确失败及零副作用证据的重试，不扩展到未知 transport error。

详证与 response IDs 在前一份真实首链报告。最终 source byte equality 将其关联到当前集成；本轮 UI 没有增加云模型请求。

## 清理、原数据与安全检查点

上海 17:20:37，精确暂停这个 QA ID、确认无在途、不确定动作后通过员工 API 删除，GET 返回 404；仅余原 2 employee IDs。原生 QA HOME 留存作证据，未启动任何长期 QA 业务实例。临时浏览器页关闭，viewport 恢复。

17:20:38 独立 SQLite 只读对账：原 2 employee、14 conversation、22 message 每个原 ID 的字段摘要与基线 backup/manifest 一致。1 local account 与备份比对相同，允许排除普通登录时间 last_login_at；鉴权材料未更改。17:22:54 最终审计再次核实 **1205 个既有 HOME 文件全部 byte/link hashes 一致**，包括旧 Profile 与来源配置。新 QA HOME 仅追加，不伪称整个目录零新增。

真实来源 Hermes config/.env/auth 的 3 个哈希仍与云首链执行前相同；**6685 个 tracked Python/JS/PowerShell 安装代码文件**仍与最初基线相同。没有改安装 effort 列表、复制凭据、刷新/login 或改变系统代理。

最终 checkpoint：frontend200，APIhealthy，全数据库 pending/acked/EXECUTION_UNCERTAIN/uncertain 查询为空；original stateRoot/5283/4283 不变。2026-10-13T09:24:09Z 只读 PID/parent/command-line/listener 再核：监督8436、API16872、Vite54484，127.0.0.1 的两个端口由原进程监听；完成 QA root PID31892/41724 均不存在。当前 sourceTree 为 E03 bot-reasoning，active-instance candidate=5643。

既有业务 backend 与独立 supervisor 追加日志继续在原 `C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview\logs` 更新，历史实例日志保留。没有为验收登记新端口、重启/终止预览或业务服务。预览仍 local test provider、scheduler false、无外部 gateway listener/手机接入；正式 server/client/domain/proxy/账号/安装 Hermes 保持原状。

## 可复核证据

本报告相邻目录 `2026-10-13-q01-final-evidence/` 保存完整 Node/lint/build 命令日志、最终阶段 API/discovery/identity/raw actions 快照、10 不变量 audit、参数/主聊天/团队截图、390px 布局与导航观察、浏览器错误集合、清理/数据/HOME/进程 checkpoint，以及本轮 QA harness 源文件。仅包含 QA 合成输入、ID、路径和白名单哈希，没有 credential 值或旧会话正文。

配套报告：

- `2026-10-13-q01-provider-and-owned-ui.md`（报告提交 fc72536）：直接真实 capability、原生 owned UI/隔离、旧 P2 与清理证据。
- `2026-10-13-q01-product-real-first-chain.md`（报告提交 fb4f24c）：正式产品云首链、原始 strict failure、离线恢复和零副作用审计。
- 本最终报告新增 UI/控制/892 回归和最终保留对账；准确报告提交 SHA 在 Q01 最终交接输出中，不覆盖前述原始失败。

本轮验收已收尾，可供总控评估下一阶段；尚未授权或执行正式合并、push、部署、真实业务账号接入或自动 Routine 全天运行。
