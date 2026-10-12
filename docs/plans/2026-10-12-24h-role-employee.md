# 24 小时岗位数字员工 Implementation Plan

> **For the authorized V2 executor:** 逐项实施前读取 executing-plans 技能，并服从本任务的用户可见 E/Q/R 会话边界。本文只是待审查实施计划，不授予本 E01 产品实现、测试或发布权限。

**Goal:** 在现有 Windows 持续开机环境提供可配置职责、按需唤醒、可暂停恢复且有可核验交付的全天岗位员工。

**Architecture:** 紫薇平台持有唯一岗位调度权，用 SQLite 持久保存岗位、Routine、意图、占用、执行与汇报；复用 A2A 落盘、断线补传和 Windows Job 监督。首个新增岗位运行组合为 Hermes/openai-codex/本地独立记忆，以有界执行和平台检查点接续工作。

**Tech Stack:** Node.js ESM / Express / SQLite / Vue / 现有 ziwei_user / Windows 原生 Hermes；不引入 Redis、多实例部署或新的业务服务。

---

日期：2026-10-12，Asia/Shanghai。**当前状态：方案中，以下任务全为 NOT_STARTED；未实现、未实测、未发布。** 关联[设计](../superpowers/specs/2026-10-12-24h-role-employee-design.md)、[验收设计](2026-10-12-24h-role-employee-acceptance.md)、[会话台账](../handoffs/V2_SESSION_LEDGER.md)。

追加范围：公共Creator模板各工作区分别安装实例；新增全天能力只针对目标Hermes，Creator自身仍支持原Codex/Hermes，两者runtime不强制相同。Creator通过正式管理工具配置同一套employee+role，E01会话不参与生产运行。第11节Creator接入合同对应下方C1–C3，仍只是未执行计划；本轮不操作bigtron正式Creator。

## 执行条件与拆分

基线为 `2ebe3dfee2f438a0b6aa3045d46c83bb67d7341b`，V1 产品修复 `324731e`。后续 E 执行者开始前重新核对远端/工作树/适用规范及已获实现范围，不以本文当作正式员工启用或服务操作授权。原 D 目录、2884 工作树和可靠接续树的用户/既有修改均保留。本 E01 只落地本文等文档并本地提交，不推送、合并、安装、测试或发布。

建议工作包 P1（Task 1–3）、P2（Task 4–6）、P3（Task 7、C1–C3、Task 8–9）依次推进；共12项任务。C1的数据合同可在P1稳定后审查，C2真实验证依赖P2，Creator整体联调在C1–C3完成后进入Q。数据合同稳定后可以让独立Q准备验收，但有依赖的实现串行，同一时刻最多两个用户可见活跃执行会话。总控随后实际分配E/Q/R编号，本计划不占用或虚构那些编号/会话ID。内部只读审查可提供意见，实际文件写入及实现不能交给隐藏子代理。

每个任务采用“新增可观察行为测试 → 运行并核对预期失败 → 最小实现 → 专项通过 → 本地提交”的步骤；列出的新文件是未来要创建的精确路径，本轮没有创建。每条测试命令均为后续步骤，**本轮未执行**。事务规则与接口若需调整，先同步设计及测试，不以无约束通用脚本替代可信服务方法。

## P1：岗位合同与唯一调度权

### Task 1：兼容数据结构与岗位配置

**Files**：修改 `backend/db.mjs`、`backend/repository.mjs`；新增 `backend/employee-role-repository.mjs`、`test/employee-role-schema.test.mjs`、`test/employee-role-binding.test.mjs`。

1. RED：用临时 SQLite 构造旧库、两个 workspace/owner、共享 source_profile 的两个 employee；断言重复初始化不改变旧行、未启用员工无岗位记录、跨身份配置失败且无部分写入、删除员工不能被回填重建。
2. 建议新增表：`employee_roles`、`employee_routines`、`employee_work_items`、`employee_runs`、`employee_run_slots`、`employee_execution_claims`、`employee_dispatch_outbox`、`employee_checkpoints`、`employee_report_outbox`。字段和权威关系按设计第3–4节；employee_routines用唯一automation_id扩展现automation归属/策略，schedule/timezone/status/next_run只存在原automation行；Routine来源的employee_runs引用关联automation_run，后者为旧页面关联记录、不再独立派发，人工/目标工作无需伪造automation。run/slot/intent有数据库唯一约束。表只在后续授权实现中创建。
3. 岗位必须绑定现有可见 employee 和主聊天，服务器校验实际 owner/workspace/设备及支持组合；新增记录 draft，启用前职责和交付标准非空。旧 employee/schema/Creator 行不批量回填，不把 runtime source profile 当可信 HOME。
4. repository 承担验证、revision 乐观锁与原子写；新模块接受显式 db/clock/id 依赖，保持路由不直写 SQLite。版本冲突返回 409，不自动覆盖用户最新内容。
5. GREEN：`node --test test/employee-role-schema.test.mjs test/employee-role-binding.test.mjs`。预期旧库二次初始化及隔离/冲突用例通过；保存本地提交。

### Task 2：Routine 的时区、计划 revision 与槽位

**Files**：修改 `backend/repository.mjs`；新增 `backend/employee-role-schedule.mjs`、`test/employee-role-schedule.test.mjs`。

1. RED：覆盖 Asia/Shanghai 日期边界、明确其他 IANA 时区、无效时区、夏令时缺失/重复时刻、interval anchor 漂移、计划变更与重复 tick。
2. 保留未绑定工作区automation行为与API；复用repository现cronPart/parseCron/zonedParts/nextCron/parseSchedule，必要时原样抽取共享函数，禁止重写通用Cron解析器。岗位方法只补anchor、revision及策略，保存前预览未来3次UTC/本地时间；首版最短间隔5分钟。旧API操作已绑定automation时进入同一岗位方法，不批量迁移现计划。
3. `authority=platform`，计划键为岗位/Routine/revision/scheduled_at_utc；每一槽位只能有一个 disposition/work_id。tick 用注入的 at 推导，不混入内部 Date.now 造成不可复现；clock rollback 不重复槽位。
   沿用backend/app.mjs唯一现有tick，在tickAutomations/runAutomation中按真实岗位绑定分流：普通automation保持旧路径，岗位scheduled/manual/retry只进入岗位队列；不能先产生旧automation.execute再派新action，也不加第二setInterval。下一次时间只推进关联automation.next_run。RED覆盖同一到期事件同时经旧/新入口仍只有一个slot/run/action，以及memory/disableScheduler、原生authority拒绝双触发。
4. 明确 `coalesce_latest`（默认，6 小时内最近一次）、`skip`、`catch_up_bounded`（最多 3 次）和 skipped_* 原因；暂停期间默认不补。超长离线分批生成/聚合可核对的槽位统计，单事务最多处理 100 个到期项，不进行无界逐分钟数据库扫描。
5. 改计划/时区递增 revision，旧未派发项 superseded；当前运行快照保留。人工有效期、容量和稳定排序按设计执行。
6. GREEN：`node --test test/employee-role-schedule.test.mjs test/automations.test.mjs test/webhook-scheduler.test.mjs`。预期新语义和旧自动化/HMAC 行为均通过；本地提交。

### Task 3：持久队列、占用、start grant 与 outbox

**Files**：修改 `backend/repository.mjs`、`backend/app.mjs`；新增 `backend/employee-role-dispatch.mjs`、`test/employee-role-dispatch.test.mjs`、`test/employee-role-recovery.test.mjs`。

1. RED：两个实际独立 scheduler 实例/数据库连接竞争同一岗位；claim/outbox/action 各崩溃窗口；重复用户请求/重复 tick；两个设备领取；旧 token 迟到结果；租约到期但旧 CLI 未知；100 项容量、人工/例行公平性及每岗60秒/每设备3次每分钟的补跑限速。
2. 一次短事务写槽位、work、outbox 和 next_due；另一短事务领取 employee_claim、预留预算并生成 run/start grant。事务外派发，稳定 dedupeKey 关联同一 run/attempt；不得因 HTTP 超时换 ID。
3. dispatch 前和客户端 spawn 前分别校验 control_epoch、binding_revision、当前 active、设备和 grant。只有服务器发出的受信任作用域可启用该通路。暂停与 grant 按事务顺序决定在途集合。
   已启用岗位的可信employee必须在所有旧/新入口汇入统一队列，包括 `backend/repository.mjs` 的 createTask/task.execute、管理MCP/Creator派工、直接A2A和普通聊天；缺岗位字段的旧payload不得降级绕过grant。启用前已有员工动作需先收敛/隔离，补从每个旧入口绕过pause的负例。未启用员工兼容原链路。
4. lease 失效只触发核实，不能发第二份执行；曾确认启动且未收敛时保持 uncertain。回传旧 token 只能结算对应 run，不能释放其他占用；结果补传与执行队列分离。
   实现精确不确定结算合同：可信监督回执含run/action/device/token/PID创建时间/Job事实/hash，服务端以evidence_id引用而不信任用户自报停止。pending期间不释放占用；客户端按原记录幂等持久结算后再确认服务端释放匹配claim。新增明确客户端reconcile方法（修改 `src/daemon.mjs` 与 `src/daemon-action-delivery.mjs`），不能调用私有字段或手改状态文件。未有证据则保持uncertain；停止已确认与business_outcome=unknown分开，依赖原交付的目标不续作。
5. 将新岗位结果路由到岗位领域方法。不得沿 `completeAutomationRun` 将所有 failed 自动转重试；显式识别 EXECUTION_UNCERTAIN、not_started、confirmed_stopped、side_effect_unknown。仅明确安全的可恢复错误按 not_before 与最多 2 次附加尝试处理；退避期限由领取器实际执行。
6. GREEN：`node --test test/employee-role-dispatch.test.mjs test/employee-role-recovery.test.mjs test/a2a-actions.test.mjs test/daemon-action-delivery.test.mjs`。预期竞争最多一次启动、断线仅补传、旧结果不放错锁；本地提交。

## P2：有界执行、记忆与用户控制

### Task 4：普通岗位独立 HOME 与执行时上下文

**Files**：修改 `backend/repository.mjs`、`src/local-action.mjs`、`src/runtime-adapters.mjs`；新增 `src/employee-role-home.mjs`、`backend/employee-role-context.mjs`、`test/employee-role-home.test.mjs`、`test/employee-role-context.test.mjs`；只在复用确需时调整 `src/creator-runtime-home.mjs`。

1. RED：两岗位共用 source_profile 仍有不同 namespace、不自动跨岗加载/注入/写记忆；同岗位跨重启持续；伪造 HOME/owner/device/profile/template 拒绝；旧 Creator 与原生 HOME 原始字节保持；排队消息取得执行权后能看到前一结果。该测试不声称同Windows用户下OS层不可读。
2. 实现按可信 origin/workspace/employee 派生路径和 binding marker，维护认证引用边界，只支持已核实组合；不复制整个 HOME、认证/锁/.env，不修改用户源码安装树，不给普通岗位伪装 Creator 身份。
3. 当前 prompt 的岗位职责、最近消息、摘要、交付引用均带来源/revision；历史不构成新授权。原生 session 未集成时返回 `context_mode=platform_checkpoint`；不能因 native resume 回落到新 session 而谎称恢复成功。
4. 建立可审查的选择性记忆迁移清单/回退合同；默认 none/保留源，不执行自动搬迁。冲突、失败和不支持组合保持岗位 draft/paused。
5. 保留现有技能 prompt 注入和图片能力边界。env/custom args 若不纳入此任务，页面/回执不能标已生效；不顺便实现所有 native skills/provider 同步。
6. GREEN：`node --test test/employee-role-home.test.mjs test/employee-role-context.test.mjs test/creator-runtime-home.test.mjs test/runtime-adapters.test.mjs test/runtime-conversation-images.test.mjs`。预期隔离、同岗位持久、Creator及图片回归通过；本地提交。

### Task 5：有界目标与完成证据/用量

**Files**：新增 `backend/employee-role-goals.mjs`、`test/employee-role-goals.test.mjs`；修改 `backend/employee-role-repository.mjs`、`backend/employee-role-dispatch.mjs`、`src/local-action.mjs`。

1. RED：有证据才能完成；缺信息不自动续跑；8 段上限、96 次/日和120分钟/日边界；cost 缺失为 null；摘要/重试计费次数；跨日期/重启不重置已预留额度；运行中达到预算停止在安全边界。
2. 目标保存 steps/checkpoint/artifacts/completion_contract。仅确定还有工作且允许继续时写下一段 work；不使用高频模型自问自答维持活跃。
3. 本次硬截止取 `min(15分钟, ACK剩余期限-安全余量, 本日剩余墙钟预算)`；claim 原子预留，结果按实际结算。没有运行时 token/cost 证据时不填零，保留 usage_source。
4. 交付检查按岗位约定的结构、文件/文档版本与可复核引用；模型文字仅候选结论。预算耗尽和等待输入只通知一次。
5. GREEN：`node --test test/employee-role-goals.test.mjs test/employee-role-dispatch.test.mjs`；本地提交。

### Task 6：暂停/停止/恢复的真实确认

**Files**：修改 `backend/app.mjs`、`backend/employee-role-repository.mjs`、`src/daemon.mjs`、`src/daemon-action-scheduler.mjs`、`daemon/ziwei_user.mjs`；新增 `test/employee-role-controls.test.mjs`。

1. RED：暂停前后 grant 竞态、排队取消、执行中停止、离线停止、stop/成功竞态、重启保持 paused、uncertain 恢复仍隔离、执行槽位满仍可处理取消；单Routine暂停不停止其他来源；删除员工保留在途墓碑并阻止旧worker续作；revision变化不能让旧步骤自动进入新职责。
2. 提议 API：`GET/PUT /api/employees/:id/role`、`POST /api/employees/:id/role/pause`、`.../resume`；`POST /api/employee-runs/:runId/stop`。全部按登录身份与可信资源归属校验，requestId/revision 必需，授权失败无数据变化。
3. pause 持久写控制 epoch 后冻结队列，对在途集合逐个发稳定取消意图；专用控制通道不消耗业务执行槽，不被 manager/concurrency 限制饿死。复用现有 AbortController/Job 监督，不新增任意进程 kill。
4. cancel request 成功只表示 accepted；目标 stopConfirmed、根/Job 回执才表示停止。断线或进程状态缺证据保持 waiting/uncertain，不按 30 秒定时器伪造 cancelled。
5. resume 不清除 uncertain、不追补暂停期间计划、不重放原 action；保留用户授权范围，不增加逐工具重复审批。
6. 单Routine暂停冻结该来源未来调度并明确当前运行可结束；删除 employee 的既有 repository/API 入口对已启用岗位接入撤销epoch、取消队列、停止在途和保留墓碑，不级联销毁恢复证据。职责/计划修改使旧revision未派发工作失效且拒绝旧worker新续段；绑定/profile切换须等在途收敛。
   提议增加 `POST /api/employee-runs/:runId/reconcile`（请求只传evidence_id/requestId/expected token）；复用当前身份权限，不新增绕过平台阻断的授权能力。覆盖跨客户端重启、双端结算中断、重复/错token/evidence、业务unknown仍不重试原意图；仅当设备监督证据可信且两个持久状态一致才解除占用。
7. GREEN：`node --test test/employee-role-controls.test.mjs test/daemon-action-scheduler.test.mjs test/runtime-process.test.mjs test/runtime-execution-lifecycle.test.mjs test/daemon-action-delivery.test.mjs`；本地提交。

## P3：可见闭环、独立验收与发布准备

### Task 7：岗位主聊天、Routine 管理与汇报

**Files**：修改 `frontend/src/api.js`、`frontend/src/App.vue`、`frontend/src/conversation-execution-state.mjs`；新增 `frontend/src/components/EmployeeRolePanel.vue`、`frontend/src/employee-role-state.mjs`、`frontend/src/employee-role-state.test.mjs`、`test/employee-role-api.test.mjs`、`test/employee-role-notifications.test.mjs`；修改岗位 repository/report outbox。

1. RED：workspace/employee 切换中的迟到响应、revision 冲突、control/availability/work 组合状态、空闲不显示工作中、停止 accepted 不显示已停止、unknown费用、刷新/重登录保留状态。
2. 提议 API：岗位 `GET/POST /api/employees/:id/routines`、`PATCH /api/employee-routines/:routineId`、`GET /api/employees/:id/work-items`、`GET /api/employee-runs/:runId`；人工主聊天派工仍从现有消息入口进入岗位统一队列。所有权不依赖浏览器字段。
3. 用户配置职责/禁区/交付/计划与预算；页面展示下一次时间/时区、上一交付、当前工作、暂停/停止/恢复、历史槽位与失败原因。没有职责时不能启用，服务在线仅显示待命。
4. 原子生成 report outbox 与关联主聊天消息，按 result/run/通知种类去重。无变化只写台账，成功交付/失败/需输入/实质变化才通知；补传不重复通知。历史普通会话不自动加看板卡。
   复用现notifications存储/实时通道/读取和Webhook安全URL/HMAC/dispatch重试；内部无变化审计不直接调用会创建用户通知的audit。只有用户明确配置出站Webhook才通过关联automation_run投递，默认无新增外部投递；稳定结果键阻止重复入delivery，补投不得调用模型。A2A和daemon补传保留，岗位只增加归属/revision/控制层。
5. GREEN：`node --test frontend/src/employee-role-state.test.mjs test/employee-role-api.test.mjs test/employee-role-notifications.test.mjs test/permissions-devices.test.mjs`。随后由授权验收者进行真实隔离浏览器 1440/390 核对；本地提交。

### Task C1：公共岗位能力catalog与现有员工上的draft搭建

**Files**：新增 `backend/employees/role-templates.mjs`、`backend/employees/role-setup.mjs`、`test/creator-role-setup.test.mjs`；修改 `backend/db.mjs`、`backend/repository.mjs`、`backend/management.mjs`、`backend/employee-role-repository.mjs`。现 `backend/employees/templates.mjs` 只在兼容接入确需时改动，不改Creator单例约束。

1. RED：两个隔离工作区分别安装自己的Creator；catalog相同、实例/主聊天/人格不跨区泄露；同owner两个相同配置但不同创建意图可产生两名Hermes岗位；同意图重试不重复。非Hermes目标返回unsupported，Creator为Codex不影响选择目标Hermes。
2. 新role catalog建议ID `ziwei-hermes-24h-role`，版本在候选冻结时分配；声明仅Hermes、支持provider与所需client protocol/schema/validation配方。catalog不返回任何实例私有数据、真实资源ID或凭据。
3. 按设计第11.3节最小方式在已有`employee_roles`增加template/version/hash/provenance/apply_revision字段；应用历史用现有审计追加，不新增第二套员工/模板实例表。Creator `employee_template_instances` 的unique和new-instances-only保持。
4. 新增setup及step receipts，按可信workspace+owner+根intent key保存fingerprint与固定步骤key，记录source user message/action和各阶段ID。删除保留墓碑；同key异参409，原资源删除返回Gone，不自动换key重建。
5. `ziwei_create_employee`的后端可选roleSetupId须在创建employee的同事务绑定draft role；setup链漏字段拒绝，避免active普通employee在后续apply前被旧task入口启动。已有employee仅按用户明确ID回读/检查无在途后采用，保存非请求字段，不能收养同名或修改Creator本体。
6. draft配置含职责/交付/禁区、同员工主聊天、独立namespace、明确Hermes绑定、disabled Routines/预算；原子保存与revision校验。配置回读与hash一致，阶段中断保留原资源；不在跨模型调用长事务内持锁。
7. GREEN：`node --test test/creator-role-setup.test.mjs test/employee-role-schema.test.mjs test/employee-role-binding.test.mjs test/creator-template.test.mjs`，断言旧Creator来源和定制字节不变；本地提交。

### Task C2：MCP端到端工具合同、draft验证与启用

**Files**：修改 `scripts/ziwei-mcp.mjs`、`backend/app.mjs`、`backend/management.mjs`、`backend/employees/role-setup.mjs`、`src/local-action.mjs`、`src/runtime-adapters.mjs`、`src/daemon.mjs`、`src/management-bootstrap.mjs`；必要的可信执行上下文绑定同时修改 `backend/management-bootstrap.mjs`、`backend/repository.mjs`；新增 `test/creator-role-mcp.test.mjs`、`test/creator-role-validation.test.mjs`。

1. RED：stdio tools/list与tools/call、client router、HTTP guards、service/schema一致；旧schema/缺工具/错误actor或workspace不能宣称就绪；伪造creatorId/templateId/owner/activate/checkOnly不产生权限或业务grant。
2. 实现设计第11.4节七项提议工具及精确路由，discovery报告catalog/capability/schema/build所需与实际值。保留已存在工具参数（model不是modelId；update_employee不擅加幂等语义），两类工具在文档与UI清楚区分。
3. 建立可信execution context/intentRef关联：由当前合法用户请求/平台实际action绑定，服务端核对workspace/owner/source及作用域；现managed bearer没有callerEmployee，不能用请求体冒充。引用不扩大现有权限；缺actor/上下文返回明确不足，不做跨区或旧归属兼容扩展。
4. verify工具生成专用setup_validation work、purpose grant、固定probeId与run/action，绑定employee/device/role和binding revision。draft仅允许这类服务端验证，不接受任意prompt或模型自报checkOnly；paused/deleted/uncertain拒绝，所有普通旧task/聊天/A2A入口仍受draft门槛。复用现有监督、预算、幂等及停止确认。
   验证专用临时overlay使用可核验toolset/MCP允许清单，不能沿现Hermes适配器`--toolsets all`；禁用正式写入、手机、外部账号和任意shell，不把业务instructions/SOUL当probe指令，保留源profile。RED覆盖残留写工具/额外MCP、允许清单未生效、只loaded无只读调用等负例；记录实际生效工具hash，无法证明当前原生支持限制则validation_unsupported并保持draft。
   建议复用runtime.execute原生动作并由服务端提供validation目的，目标普通employee不占第二个manager槽；role/setup结果处理负责主聊天归属。并发上限1或无子槽时Creator返回原ID后结束，禁止提高并发或原地无限等候；测试父任务释放后同一个validation action只启动一次。
5. 回执分开保存结构校验、真实action、产出检查、MCP准备、tools schema/loaded/toolCalls及setup/config revision。成功probe只说明本次验证，不是24小时PASS；unknown保留原action不重放。证据建议30分钟有效，绑定/template/模型/配置/client build变更后过期。
   现get_employee_mcp_status只选最近匹配action，作为辅助展示；新setup证据必须引用精确get_action及本次服务端回执，不能为省事采用另一轮loaded=true。
6. activate原子核对当前revision、证据和原用户明确启用意图，再active/开放未来Routine；只有搭建草稿意图时维持draft。response丢失回读原setup，不重建；普通update_employee(status=active)不能替代激活。控制工具复用第8节pause/resume/stop语义，不能形成MCP例外。
   增补first_activated_at/suspended_from_state/activation_required和expectedControlEpoch/intentRevision合同；首次激活唯一走activate，draft直接resume、draft暂停后resume不能变active。验证后用户暂停/取消/暂缓或源聊天出现未处理新输入时，旧activate因epoch/intent cursor过期而拒绝；先处理新输入，不要求用户重新批准未变范围。旧激活key在后来暂停后重试只回当前paused，不重新启用。RED覆盖这些竞态及新revision要求重验证不能靠历史first_activated_at绕过。
7. GREEN：`node --test test/creator-role-mcp.test.mjs test/creator-role-validation.test.mjs test/employee-role-controls.test.mjs test/management-mcp-runtime.test.mjs`；保留schema/静态契约与真实stdio fixture证据的区别；本地提交。真实模型由后续Q另做，不能把fixture标成真实loaded业务通过。

### Task C3：已有Creator的指导overlay、市场与真实联调交接

**Files**：修改 `backend/employees/creator-template.mjs`、`backend/employees/templates.mjs`（仅只读能力展示）、`backend/repository.mjs` 的可信执行上下文构造、`frontend/src/components/CreatorMarket.vue`、`frontend/src/creator-market.js`、`frontend/src/components/EmployeeRolePanel.vue`；新增 `backend/employees/creator-role-guidance.mjs`、`test/creator-role-guidance.test.mjs`、`test/creator-role-integration.test.mjs`。

1. RED：origin=template、adopted-existing、customized三路径；源码模板版本不匹配/缺能力/定制禁区冲突；sourceTemplateVersion/null、capabilityVersion、authoringWorkflowRevision各自如实显示。非Creator按名字伪装不会获得可信模板身份。
2. 采用可信discovery+执行时版本化搭建overlay，帮助现有Creator按“begin→create/reuse→draft→read→verify→activate”推进；保留原persona/instructions/SOUL/memory/auth/会话，不能覆写旧实例或假报已升级模板。新catalog内容只对新实例应用，旧实例能力说明和永久人格分开。用户未请求全天模式时普通员工流程保持。
3. 普通缺项一次汇总询问，发现可查信息不重复问，已有明确搭建启用意图不增加逐步批准。Creator当前预算耗尽则回报原setup/phase/IDs，下一次合法执行从持久进度续办，不等待自己的/另一Creator串行任务导致死锁。
4. 市场保留Creator主入口，仅展示真实可用的Hermes全天搭建能力与缺项，不要求新建第二张人工安装卡。目标多岗位由既有employee列表/role面板按employeeId呈现，不能塞进`template.instance`单对象；刷新打开按ID只读，不触发再安装。
5. 新岗位Routine结果回目标主聊天；Creator主聊天只收搭建回执/链接和请求相关反馈。联调矩阵为Codex Creator→Hermes目标、Hermes Creator→Hermes目标；对未实测组合标NOT_RUN，不从一种推导另一种。Codex/Claude/Gemini目标全天申请被拒而普通路径保持。
6. GREEN：`node --test test/creator-role-guidance.test.mjs test/creator-role-integration.test.mjs test/creator-template.test.mjs frontend/src/creator-market.test.mjs`；交付后续Q按验收C01–C16进行隔离真实联调，当前bigtron正式Creator只作为保护对象，不发送业务消息或改其配置来验证；本地提交。

### Task 8：日志、故障夹具与真实 24 小时证据

**Files**：未来新增 `scripts/qa/employee-role-soak.mjs`、`scripts/qa/employee-role-observer.mjs`、`test/employee-role-soak-harness.test.mjs`；必要修改 `scripts/client-lifecycle.mjs`、`src/daemon-action-delivery.mjs`（仅有证据支持的诊断接入）。运行私有证据只在 `.local/`，不提交正式数据。

1. RED：观察器独立于被观察进程，记录 PID/创建时间/退出码、实例结束与未知；日志轮转不覆盖历史；读取日志无需重启；统计能发现丢槽位、重复启动和缺回执。故障子进程只属于隔离夹具。
2. 按[验收设计](2026-10-12-24h-role-employee-acceptance.md)实现 manifest/slot/event/result/summary，实际值与计划分开；固定源 commit/build/安装元数据，两个隔离岗位及精确允许路径/MCP范围。
3. 先跑短时逻辑夹具，结果单独命名 accelerated；再在授权 Q 范围内运行连续真实 24 小时窗口。未满 24 小时不签收，发生缺失留 FAIL/INCOMPLETE，不删失败后重命名 PASS。
4. 涉及测试端口或后续登记时先读取 port-manager；沿项目原端口和原生入口，禁止为验收停止正式服务或改 Windows 电源配置。正式观察器和客户端启动配置不在本 E01 范围。
5. GREEN：`node --test test/employee-role-soak-harness.test.mjs` 只证明夹具；真实 soak 报告需要另有精确起止/日志/统计，不能混成该测试的输出。

### Task 9：Q 独立验收与 R 发布准备

1. E 在候选冻结后运行必要专项及仓库门槛 `npm test`、`npm run lint`、`npm run build`，保存实际统计；结果属于候选 SHA，不能引用 V1 的 709 项冒充。后续改动按风险补验，不反复无目的跑全量。
2. Q 读取全部原始/失败证据、检查关键身份与恢复行为，并独立复核Creator自然语言搭建→岗位运行的C01–C16与24小时统计及正式数据保护；接受标准见验收设计。总控负责判断并建立实际会话台账。首次均为隔离QA，不使用bigtron正式Creator实发创建消息。
3. R 在用户后续明确发布范围内才实施发布；分别记录后端 schema/API、前端、官方客户端包、实际目标客户端 build。需要哪层才发布哪层，包已上传不等于客户端已生效。R 前再次核实远端 SHA，不用本地 tracking ref 替代。
4. 预制可审查的兼容迁移/备份/代码回退计划：新表新增不覆盖旧库，关闭新岗位派发必须先核实在途状态，回退保留新表及证据，不能整库恢复或让旧版本执行不认识的队列。回退不重放旧业务。
5. 更新 `PROJECT_MANAGEMENT.md` 顶部、V2 台账及实际运维记录，只写真实状态；本 E01 不执行这五步，也不创建 Q/R 会话。

## 本文完成与交接标准

本轮交付仅要求设计（含Creator接入合同）、分期计划、验收设计、会话台账和项目顶部状态齐备；源码引用可追溯、文档链接有效、Git diff仅文档、专用分支本地提交且干净。公共模板跨区复用/实例按当前区隔离、仅Hermes全天模式已明确；正式岗位职责仍待用户提供。bigtron当前Creator安全元数据尚未取得新的只读证据，保持unknown而不套用旧事故快照；不为补证据读取密钥或新建登录。原生运行兼容、真实联调、24小时可靠性和发布均待后续授权执行，不把这些依赖写成已完成。
