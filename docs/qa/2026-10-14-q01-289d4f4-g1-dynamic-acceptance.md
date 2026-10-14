# Q01：289d4f4 的 G1 动态子集复验

冻结候选为 `289d4f455ce93d325cc56effb11ecde2b965f701`。**本次获准的 G1 动态子集 27/27 通过；原 8556 的 Profile 等待窗口 P1 在本次同根场景中未复现。完整 G1 门槛、G2–G5、数据保留回退和正式发布仍未签收。** 原 8556 红回执及 unknown journal 保留原样，本报告不改写它们，也不把作者的回归结果计为独立 QA。

Q01 只在自己的 worktree、文件 DB、HOME、安装目录和 6397/6399 上执行。没有运行作者正在变化的工作目录，没有修改产品、推送、部署、接管原服务、调用手机或外部平台、重置正式 Hermes、重复付费模型或做 24 小时运行。

## 冻结身份与运行层次

交付包复制到 QA 私有目录后重新验 SHA。两角色客户端均由空 cache 使用 `npm install --offline --ignore-scripts` 安装，逐一核对 manifest 中安装后源码摘要及 build。API ZIP 解包后逐文件核对源码，运行时核 6397 的监听 PID 确属相应冻结 API 入口。前端 ZIP 只核摘要，没有在本次做 UI 验收。

| 身份 | V1 兼容 | V2 |
| --- | --- | --- |
| manifest SHA256 | `6db95104cfc85ca46318b74104c9826f97846615c8ad9ad6995756a3e5adb6fd` | `fec574f1b657537146098527aad32f9ba320c1d0b376ae765e62c31e3633b7ab` |
| 安装后 client build | `7ab9f7cac91a158cbcfa2743e15be5f8bcfd222f8a2ddd5a347cf92f588ef862` | `4710a4823bba1ee5a701321b0e5c54bf0c1c9e1773f4c3e62b7aa23fb99fd6bc` |
| client TGZ SHA256 | `276d233f3200781085f76290b6f57c872e361b43f1aad0e976e0b70a87654dcb` | `bbf2d8b99e682ee35ef9235f0943d551aa78b07218824d9cb23bbf9880cab91d` |
| API ZIP SHA256 | `fbfa25c46d8f12eeeb50d3ab2fe0b214ed8965a2acabb74ab6d178f77aa0481b` | `31530549347cb02cbd70e4edfcbcfed3f3e62ab0162580ebbec0afec5906400e` |
| frontend ZIP SHA256 | `3365da4b19e36f0ee9a99467684972445e2d09057350b09aba80f0997e22c1b5` | `21a50595fde61f0bf25ed5dcd193de0f96e2dcd45d887c71b7a135aea44815be` |

契约 SHA256 为 `2162c6373215a060d5758a5e1224e6f21517a6eb5a514bee8c3938d44d2acc3b`。文件大小、产物身份、安装核对和每用例数据见同目录的 `2026-10-14-q01-preservation-evidence/289d4f4-g1-summary.json`。

实际启动的是带 `requireAuth:true`、`requireDeviceAuth:true` 的冻结 API，使用同一文件 DB、origin 与 Hermes 根。QA owner 经真实登录建立工作区、配对两台 QA 设备。设备就绪元数据来自实装原生 runtime discovery 的实际读取，由 QA 手动提交 heartbeat；没有伪造 daemon PID 或运行健康证据。用冻结 V2 executor 实际执行 Bot provisioning，成功回执、持久 Bot binding 和原 marker 提供保护 HOME。

每个动作都先由实际 API 保存、由目标设备 ACK，再从 actions list 取得含 `workspace_id/task_id` 和可信 payload 的完整 fresh wire，并向实际 execution-admission 核原摘要。未使用展示 DTO、补传 ACK DTO 或伪造 admission。Creator 从真正 `ziwei-employee-creator` 模板安装并发消息，可信模板字段来自原持久关联。

本次没有运行自动 poll/dispatch daemon。大部分用例执行已安装 `createLocalActionExecutor`；beforeSpawn、noManagement、tombstone 使用同一原动作的真实许可和可信 guard，直接调用已安装 native adapter，以精确插入晚期 barrier。management bootstrap 是真实本地 API；terminal bootstrap 是明确的无设备能力响应夹具，只测其 await 窗口，没有发出手机动作。

## 同根动态结果

所有 Profile alias、普通 HOME 和真实 owned Bot HOME 位于同一个 Hermes 根，避免跨根检查提前遮蔽原 P1。除 modeFlip 外，实际 API 均读取真实 preparing 状态。该状态由冻结候选自身 `createPreservation.begin` 在原 SQLite 上建立，之前保存一致备份；未手改状态或 marker。没有尝试借 G1 达成 seal/restore。

| 用例 | V1 兼容 / V2 结果 | 模型与实际进程 |
| --- | --- | --- |
| management await 后 alias → owned | 两角色均 `V2_OBJECT_SEALED`、definitelyNotStarted | 每次执行 Job 0、模型请求 0；保护 HOME 全字节不变 |
| terminal bootstrap await 后 alias → owned | 两角色均同上 | Job 0、请求 0；无手机执行 |
| beforeSpawn await 后 alias → owned | 两角色均同上 | Job 0、请求 0；部分 probe 已运行，不声明所有 raw Python 均为零 |
| raw bootstrap 启动后 native barrier 切 alias | 两角色均原生 `V2_OBJECT_SEALED` 并 failed | 每次 1 个受监管 bootstrap Job、模型请求 0；barrier 确认进入；原树完整退出 |
| await 后 alias →另一普通 HOME | 两角色均 `EXECUTION_RESOURCE_CHANGED` | Job 0、请求 0 |
| 普通 / 大小写 / default / noManagement | 两角色各 4 个成功正例 | 每例真实 loopback 模型请求 1，原生会话和状态 HOME 对应原动作，Job 完整退出 |
| genuine Creator | 两角色各 1 个成功正例 | 原模板身份、私有状态 HOME、原 source auth store；真实 OpenAI Codex responses 协议请求各 1 |
| 本地更改原 wire payload | 两角色均 `EXECUTION_ADMISSION_REFUSED` | Job 0、请求 0，原动作保留并保存明确拒绝 |
| 错设备凭据 | 两角色均 `EXECUTION_DEVICE_MISMATCH` | Job 0、请求 0，未借另一个设备获得许可 |
| tombstone +普通非 flag prompt | 两角色均原生 selector 拒绝并 failed | 原 selector error 被观察；每次 1 个 bootstrap Job、请求 0、原树完整退出 |
| cached v2 permit → management await 内原 DB begin preparing → alias → owned | V2 专项 1 例被拒绝 | Job 0、请求 0、保护 HOME 不变；实际原因是“Bot 专属 Profile 的认证来源绑定不匹配” |

modeFlip 证明这个具体缓存许可场景被拒绝，**不将既有 readiness 拒绝归功于新 binding**。其许可最初确为 `productState:v2`，另一个 DB 连接实际进入 preparing，原动作没有换身份继续执行。该结论不推广成所有状态切换或所有 OS 目录并发攻击均已覆盖。

27 例合计 10 个合成模型请求：8 个 custom chat-completions、2 个 openai-codex responses。执行 Job 合计 14，另有 1 个真实 Bot provisioning Job；Job 计数不等于所有 Python/probe/SDK 启动数量。负例没有模型调用，所有保护 HOME 比较包含 logs 在内的完整文件字节，所有临时 execution overlay 残留均为 0。

## 实际 SDK HOME 与持久结果补证

普通 `result.profile` 只是请求字段，不能作 HOME 证明。QA 的 Python 仪表保留原 selector 实现，仅记录原返回或异常；SQLite/file audit 也只作观察。probe 与实际 `--launcher` PID 分别记录。Windows Job 根为启动包装进程，与实际 Python PID不同，最终回执同时保留该根及整树终态，不把两者当同一个进程。

最终只读核对 10 个成功正例：每个实际 launcher 的全部 `state.db` 路径均归预期唯一 HOME；该 SQLite 实际存在且 integrity 为 ok，存在与原 API payload prompt 和 ACK→完成时间区间唯一匹配的用户消息、对应 session 及助手消息。Creator 的私有 state.db 与 source Profile 分离，模型为 `gpt-fixture`、billing provider 为 `openai-codex`、实际 base URL 为 loopback，launcher 实际读取原 source auth.json，回执 `authMode=source-native-store`，私有 HOME 没有 auth.json/.env。

Creator 合成 source auth 文件由原生 SDK 增补 credential_pool/version/updated_at，V1 正例的源文件字节确有变化；原 access/refresh 凭据指纹稳定，V2继续引用同一源 store。该正常 QA 源 store 变化单列，未改成“源文件完全不变”。用户全局真实 source 配置和认证文件则与原基线完全一致。

原 API SQLite 中有 28 个明确终态动作，包括 seed：11 succeeded、17 failed，无 pending/acked/uncertain。逐一比较 27 例的实际 result 与落库 processExit、Creator isolation、bootstrap、output或明确拒绝 code，关键字段无丢失。**本 helper 未执行 uncertain 回传、daemon journal、result_pending 或补传故障；它不能作为这些契约的验收工具。** 本次实际结果未出现 uncertain，不通过清理未知记录取得终态。

所有 14 个模型/拒绝执行 Job 及 seed 的 rootConfirmed/treeConfirmed 均成立、activeProcesses=0、failureCode为空。原 Hermes 6,685 个源码文件和全局 config.yaml/.env/auth.json 摘要与之前保存的原基线一致。API DB integrity ok、foreign_key_check 无行。29 个原进程身份结束；一个 PID后被其他新进程复用，以原完成时间与新启动时间辨别，未终止该新进程。6397–6400 收尾无监听，端口归属继续保留。

新诊断目录为 QA 私有 `run-1791909806179/diagnostics`。独立 observer 每 10 秒保存心跳，追加分实例 stdout/stderr/退出信息，5MiB轮转保留历史。本次另用隔离无业务进程验证心跳和 SIGKILL 的退出留痕。登记备注已写实际绝对日志路径与已验证状态；历史诊断和原 unknown 记录保留。

## 失败尝试与尚未签收的部分

初次控制脚本导入 API ZIP 的维护 CLI 时，`scripts/client-lifecycle.mjs` 缺其引用的 `daemon/config.mjs`，在任何服务/动作启动前停止。这只是本次对 API ZIP 内 CLI入口的观察；尚未形成正式维护入口布局的签收，也未修改产品补文件。首次 API 入口配置遗漏 `/api` 后，原进程明确退出 1，已保存并修正 QA 配置。

预备 run `1791909134438` 的跨根 alias 用例被既有 containment 提前拒绝；Creator 的源 auth 归一化和 wrong-device 精确 code与最初期望不同；dedupe key遗漏 role导致回读明确终态原 action而停止。该 run 原输入、失败和诊断均保留，不判成产品回归，不覆盖原回执。之后用新自有 DB/安装根 `1791909806179` 做同根场景，没有重放任何 unknown 或未确认动作。

完整 G1 还包括真实 daemon running 身份及错身份/错文件拒切层；本次未运行这些门槛。此处兼容 API 与 preparing V2 API 的切换是 G1 动态取证，**不能替代真正 sealed V2→兼容V1→restoreV2 的 G4往返**。G2–G5、native pending/settled/claims/inbound/Group数据库收集、外部Gateway、正式 apply入口及受限 scope能力边界仍需要后续冻结交付与独立现场证据。作者 924/924、18 个 native fixture和四阶段报告保持“作者结果”。本次没有重复全套回归，也不把旧8556独立922/922迁移到本 SHA。

Q01可交付的结论是：289d4f4 在上述同根、真实 API许可、实装执行器/adapter、实际 Hermes SDK和有限 loopback transport下，已闭环本轮 G1动态子集和原 P1的目标等待窗口；其余身份、排空、往返与发布层继续分别保留未签收。
