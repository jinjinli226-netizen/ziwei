# Q01 保留数据的 V1 兼容回退验收矩阵

2026-10-13，Asia/Shanghai。用户要求“要是能回退我都没问题的”。本轮先只读核实并制定验收矩阵，E02 落实兼容包；Q01 等稳定 SHA/契约/产物后才执行隔离演练。**动态验收目前全部 NOT_RUN；本文不能作为“已能安全回退”或正式切换许可。** 不对当前 5283/4283 预览、正式库/服务/客户端/安装 Hermes/auth/手机/域名/代理做动作。

## 1. 独立核实的现有版本与证据层次

| 层次 | 固定标识 | 本轮已核实的范围 |
| --- | --- | --- |
| 可靠 V1 代码树 | `C:\Users\25941\.codex\worktrees\a2a-delivery-recovery\灵光爸爸拆解`，HEAD `2ebe3dfee2f438a0b6aa3045d46c83bb67d7341b`，干净 | Git/源码只读；与 324731 的 backend/src/daemon/scripts/frontend/package 产品路径 diff 为空 |
| V1 最终 CLI 产品修复 | `324731e79c6a855fad1f501379630bbfa67e5d34` | 原 V1，不含本次封存保护，不可称为安全回退兼容包 |
| V1 主 API / 前端记录 | API `a66df9c76de5ed016932ca0193a307f3df72f47f`；前端 `274a418353b66d3c1dec23590274597921dccc34` | 本轮 2ebe 与 a66 的 backend/frontend、与 274 的 frontend diff 均为空；只证明源码相同，不证明当前正式进程/release 身份 |
| 留存官方 CLI archive | 134338 bytes / 36 files / SHA256 `1592d107fcbcf27b9ec5e0d909f871ffa3851d9e136e015713156144d70fc8cc` | 本地只读重算包 SHA、逐项 tar 内容与 publication manifest 的 36 个原始哈希全部一致，没有解压安装或执行包 |
| archive source build | `7e96fc4aab132a941e460d2be0ef108a5536b825312371b6326cd43cd74757ce` | 按 clientBuildIdentity 的文件集合、排序、NUL 分隔、内容只读重算，与 manifest 一致 |
| 历史 Windows installed build | `7e2ae40a8e9cb12ad8592514db263b6952f27bd0eae6fe01d3b84fe8cd3d1950` | 发布/实际升级记录，不是本轮新实装或当前正式客户端重新核验 |
| 已验收 V2 原候选 | E03 `5643d5d36c3cd85d74ab849c77f52b6f69555093`；docs HEAD `667a4f8a61f5421faf372c9a067bfc376872f9ac` | 本次固定对照；先前 Q01 报告提交3718c52已完成限定 UI/control/cloudcore 联验，不是回退演练证据 |
| 新兼容 V1 / 回退工具 / 恢复 V2 | SHA、包/build、命令与 manifest **null** | 待 E02 稳定交付后独立核验；不测试 WIP |

CLI version 都可能仍为 **0.1.0**。产品 V1/V2、API 源 SHA、前端 SHA、CLI 源 SHA、archive SHA、source build、installed build、实际 running build 必须分别记录，不能用 version 字符串作为切换证明。

本轮另做了 archive 原始字节对 Git 对象的严格比对，exit1、36 个差异保留；随后逐文件确认全部只为 CRLF/LF，其他内容差异为0。**不宣称 archive 与 Git 原对象逐字节相同**，也不以宽松换行归一掩盖候选包错字节；后续安装归一例外必须有确切文件、原/后哈希和实际 npm 行为，只接受契约明确且复核过的例外。第一条 `python` 只读核对因 PATH 无 Python 未执行；改用 Node + tar 只读校验，不触碰 Hermes venv 或安装环境。

## 2. 原 V1 的执行缺口与已有保护

原 V1 没有 Bot 控制语义。数据库附表能够保留、原生 owned HOME 通常缺认证、employee/Routine 被 paused，都不能当作所有执行入口已封存。

| 固定 V1 源码位置 | 已核实事实 | 验收影响 |
| --- | --- | --- |
| backend/app.mjs:382、590；repository.mjs:573 | 普通 browser/external POST task 直接 createTask；runtime/model/execute 任一触发，未查 paused/Bot；task INSERT/audit 在 createA2AAction 前 | 需要入口前置或事务保护；只在 createAction 拒绝会留下 task/audit |
| backend/app.mjs:564；repository.mjs:1707 | 普通会话可用 runtime/model/profile/device/cwd 覆盖，未查 paused/Bot；消息已有 savepoint | 普通会话派发与绑定修改都要按持久身份封存；拒绝不得留下伪成功消息/动作 |
| backend/management.mjs:174–176 | 管理 task **已有** active 和 runtime/profile 匹配检查 | 保留该旧保护；不能因这一路较严格就推断普通 task 已安全 |
| backend/app.mjs:781；repository.mjs:1775、1786、1799 | 通用 A2A create/list pending+acked/ACK 未识别 Bot | 必须核原 action 及 employee/conversation/task/automation/source 关联，不能只看请求 hermesBot/type 标签 |
| backend/repository.mjs:1005、1018 | 手工 runAutomation 不查 status/executor；tick 才筛 active | paused ziwei_bot Routine 仍可能退化普通 automation.execute；run/update/delete/retry 都须封存 |
| src/local-action.mjs:415、424 | profile/model 和 payload.env 进入原执行器 | default/别名/路径/HERMES_HOME/env/device 覆盖不能绕过持久封存身份 |
| daemon/ziwei_user.mjs:228、238 | poll 包含 acked；本地 recoverActions 合并回调度 | 服务器 pending=0 不能证明本机不会恢复旧 Bot 执行 |
| src/daemon.mjs:357、371–378 | 损坏 journal、STARTED_WITHOUT_RESULT、EXECUTION_UNCERTAIN 保持拒绝/隔离 | 准备回退必须阻切，不能删记录或改写 failed 美化排空 |
| src/daemon-action-delivery.mjs:115–136 | result_pending 仅补传原结果、不 dispatch；retainEvidence 保留不确定原输入/结果 | 把“允许原结果补传”与“允许重新执行”分开；封存 guard 不得丢补传证据 |

V2 冻结源码另有边界：daemon/ziwei_user.mjs:257/275 的 health/stop 只核 scheduler active/polling；delivery 的 pendingCount/blockedCount 和 Gateway manager/Group 远端成员不能由这两个计数推断。src/hermes-gateway-runtime.mjs:17/56/79/88/93 分别区分 admission、processAlive、连接成功、completionEvidence 和真正断开/树退出。src/hermes-group-runtime.mjs:63–81 独立核原 member action 与 settlement；父本机退出不是远端完成。

封存必须按修改前持久 `hermes_bots`、`profile_binding_json` 与 HOME/ownership 证据判断。原 V1 employee.update 可以改 runtime/profile/device/status；deleteEmployee 的 CASCADE 会删 Bot 附表并使 conversation.employee_id=NULL。新 Bot 的更新/删除及 Routine update/delete 必须 **变更前** 拒绝，不能先删身份再依赖 central guard。纯 V1 库、不关联 V2 的无 employeeId 普通 action、旧 Creator/default/认证来源保留正常兼容，不能按 Hermes/default 或名字前缀一刀切。

## 3. 隔离演练结构及入场契约

实际动态顺序固定 **原 V1 → V2 → 带封存保护的兼容 V1 → V2 恢复**；保留原 V1 原字节 archive 作版本/差异对照，但不把它直接接 V2 DB 后宣称安全。只使用新隔离文件 SQLite、新 QA workspace/actor/device、独立安装 prefix 和 QA 原生 HOME。正式记录不复制到 fixture，认证不复制/刷新，模型只用 loopback 合成 provider，外部网络/手机/业务工具禁用。至少真实本地 API + 实装客户端或足够完整的实装执行器 + 已安装 Hermes 对 QA HOME 的真实 read/write/session/Job 证据；仅 mock repo、内存DB或假 HOME 不满足主往返场景。

整个循环必须复用 **同一隔离 API origin/端口、同一数据库绝对路径、同一基础 Hermes HOME**。owned ziwei-instance.json 含 origin/sourceHome/device/provisionActionId；legacy_private_home key 也含 origin/workspace/employeeId，换 origin/root 再生成一个新 HOME 不能叫恢复。保存原 provision action/result 与 ownershipId，不仅留目录。

初始 V1 建纯 legacy 员工及 Creator、旧主聊天/任务/合成资料/删除墓碑；V2 再创建 A/B 两个不同 owned Profile，A 留 synthetic memory/session/checkpoint，B 不含 A marker。期间追加合法旧员工消息/任务、删除一个 QA 对象，让回退后证明保留 **最新增量和删除状态**，不能只比较升级前快照。所有路径/ID由运行 manifest白名单确定。

E02 交付必须有：稳定 clean SHA；原 V1 与兼容 V1 diff/范围；prepare/seal/switch/restore/recover 的实际命令/参数/error contract；数据库/HOME允许变更字段；mode/journal 原子性与故障恢复规则；client/archive/install/running build证据；队列/Gateway/Group排空证明接口与持久位置；已知 NOT_RUN 和部署层次。没有冻结上述信息就不运行候选，命令名字不在本计划里凭空发明。

测试端口目前 **null**，诊断日志验证状态 **NOT_RUN**。真正启动前读取 port-manager、查登记簿与 OS、保留原项目端口，用本次隔离项目登记实际端口与绝对日志。每个隔离 API/client/observer 保留启动、PID/创建时间、异常/退出码/信号、周期心跳和独立健康/退出观察，追加或分实例保留历史；不能用现有预览日志冒充新演练。API 换版本复用已登记的自身端口；占用不符则拒切，不杀其他进程。

## 4. 必须实跑的矩阵（全部 NOT_RUN）

| ID | 场景与负例 | 硬性通过条件及证据 |
| --- | --- | --- |
| RB01 | 原 V1、兼容 V1、恢复 V2 artifact/manifest、错 SHA/缺文件/错 running build | 精确源/包/安装/build分别吻合；篡改或缺证据拒切；原 V1 与保护补丁差异可审查，不伪称原字节安全 |
| RB02 | 纯 V1 DB无Bot表/默认员工/Creator/无ID普通action | 兼容包正常读写/本地有界执行；不要求存在V2 schema，不误伤 default/认证来源/旧MCP scope |
| RB03 | 原 V1→V2 增量schema及旧功能正例 | 同一文件库，integrity/FK通过，旧行/列/对象/HOME不丢；不做整库替换或清目录；旧员工/Creator聊天与任务继续正常 |
| RB04 | V2 A/B创建、开通、记忆、原生session、普通任务 | 两Profile/HOME不同、actual HOME等于存储；A/B标记隔离；原session/result/action/provision关联证据完整、每动作有原Job退出 |
| RB05 | 准备回退时服务器 pending、acked；已expired但存在acked_at；递归结果含uncertain | 每种拒绝切换；mode/current包/DB/HOME不危险半切，原action及原payload保留；超时不等于退出，不自动取消/改failed去造排空 |
| RB06 | scheduler/polling为0但 delivery.pendingCount/blockedCount不为0 | 拒切或先按已固定的仅补传合同收敛；不能仅看 health 两计数给PASS |
| RB07 | startedWithoutResult、EXECUTION_UNCERTAIN、retainEvidence、journal损坏/丢blob/hash错 | 每种拒切；完整原始证据不删除、不重建、unknown不补0，不把 uncertain改failed/expired解锁 |
| RB08 | unknown根/后代/脱离进程、PID复用/创建时间不符、host失联 | 未确认原执行树为空即拒切；精确原processExit/Job/creation identity证明；发kill/stop accepted不等于退出 |
| RB09 | Gateway connect succeeded/lease撤销/disconnected/admissionClosed但worker仍活着 | active/pending为0也拒切；精确原worker processAlive=false、processExit/treeConfirmed/active0后才可签收 |
| RB10 | Group父本机已退出，member/sourceActionId远端pending/acked/uncertain/已领取expired | 任一未核原终态即拒切；父/成员原action链、各实际执行与settlement证据完整，不能只用父Job |
| RB11 | 准备读取排空后并发发消息/任务/手工Routine/ACK/新Gateway入站 | admission/mode与检查具有持久原子顺序；不能检查之后另接纳一份执行再切换；多调用/重启不绕锁 |
| RB12 | prepare/switch各阶段崩溃、响应丢失、重复同key、异参、manifest/state损坏 | 原phase/ID/证据可回读；异参拒绝；不盲目新意图；失败保持原模式或明确可核验安全封存阶段，不让混合版本开放执行 |
| RB13 | 兼容 V1普通会话：主聊天/其他会话、dispatch省略/true、文字/附件 | 持久关联的新Bot拒绝派发；无model spawn/A2A/伪成功消息；旧V1正例仍成功 |
| RB14 | 兼容 V1 browser/external task：employeeId/assignee ID或名字/runtime/model/execute组合 | 新Bot拒绝；task/action/audit无残留或事务回滚；旧员工相同入口正常，不能只测管理MCP |
| RB15 | 管理MCP task及旧员工正例 | 旧active/profile/runtime/device校验保留；新Bot独立于status拒绝，Creator旧管理能力不误伤 |
| RB16 | 通用A2A type变化、去掉hermesBot、只给conversation/task/automation/source/member关联 | 按原持久关联拒绝所有新Bot执行；请求标签和action type不是授权；正常无V2关联action可用 |
| RB17 | 预存Bot pending/acked、绕list直接ACK/renewLease、客户端recoverActions | 兼容客户端/API均不执行封存Bot；原ID/队列不被删；兼容guard后仍须执行前核实，不能只隐藏list |
| RB18 | result_pending：已明确原Job退出/有效原结果；另测 uncertain+retainEvidence | 前者原action结果仅补传、execution/spawn增量0，证据完整保留；后者仍阻切/隔离。不得将补传也挡掉并丢原结果 |
| RB19 | paused Routine旧手工run、executor=ziwei_bot/绑定缺失、retry队列、定时tick | 不降级普通automation，不建run/action，不发webhook；旧V1普通automation正例保持；关联不完整显式拒绝 |
| RB20 | 新Bot employee update改status/runtime/profile/device/model；delete后CASCADE/conv脱钩 | 变更前拒绝，原附表/ProfileBinding/会话关联保留；不能靠删Bot附表或改active绕过；旧员工正常变更/删除仍可用 |
| RB21 | Bot Routine update/delete/解绑executor或关联 | 变更前拒绝，保留原绑定/恢复证据；旧普通automation编辑/删除正常 |
| RB22 | 绑定覆盖：default/其他profile/model/runtime/device/cwd，profile大小写/路径别名/junction，HERMES_HOME/env | 同一Bot及其owned HOME都拒绝；不能因无auth“通常失败”算保护；default/source本身和旧Creator合法执行仍可用 |
| RB23 | Gateway封存后入站/重复事件/旧source action；Group父/子/重试后继 | 新消息不产生Bot动作/成员后继；原事件/去重键及结果保留；不连云平台，只用本地合成peer和实际生命周期 |
| RB24 | 跨workspace/owner的同名员工、Profile alias、并行回退scope | 依精确workspace/employee/ownership判断；封存范围不串区，不能按名字前缀封存整个Hermes；权限原样保持 |
| RB25 | 安全 V2→兼容V1真正代码/安装/运行切换 | manifest/current源/installed/running build一致，真实API仍用同DB/origin；兼容模式下RB13–24全部实际生效；只打包不算切换 |
| RB26 | 兼容V1运行期间旧员工/Creator追加消息/任务/合法删除 | 最新增量与墓碑留在同一库和对象存储；原新Bot/HOME/config/result保持，只改契约允许的封存/控制字段 |
| RB27 | 兼容V1→V2恢复及重复restore/丢回执 | 原employee/Profile/ownership/HOME/mainchat/provision/nativeSession/memory/checkpoint/result不重建；epoch等允许变动单列；原操作幂等，不重新provision/resetHOME |
| RB28 | 恢复后旧消息/任务/action去重键、过期队列/历史tick/多retry、Gateway pending metadata/native driver原claim | 原结果仍可读，execution计数不增；不补历史tick/重复已完成执行，不清旧claim重执行或静默认领旧入站。新的合成后续回合才产生一个新action并续原session/HOME |
| RB29 | 恢复后A/B记忆与旧Creator/default/来源认证 | A原marker仍在/B不含A；原HOME/认证哈希保持；无复制auth或移存储根，workdir不冒称HOME |
| RB30 | 再一次 prepare/拒绝/恢复、清理与独立退出 | 重复往返仍保持身份/零重放；只清精确QA ID/进程，树退出/结果补传核实后才清；失败证据与日志保留 |

RB13–24 的拒绝不能只检查 HTTP status：逐项记录原请求/响应/trace、DB before/after 行键与稳定字段、dispatcher started/completed、delivery、原生spawn及副作用计数。拒绝结果不得在检查前 INSERT task/run、delete附表或清journal；允许的只读查询/原结果补传单列。数据为空、缺日志、模型未认证造成失败，都不能冒充守卫拒绝。

RB05–12 的失败试验用自有隔离进程/本地peer与缩短测试时钟，不去制造正式事故，不跑24小时。所有 fault 记录原起止、命令与退出/response；未知不重试执行。必要回归仅在稳定候选跑一次完整门槛，再按新增风险补必要专项，不立即对5643旧候选重跑892。

## 5. 数据、状态与证据对账

文件库比较必须同时核 schema/列/索引/FK/integrity、逐表原PK/新增PK/删除墓碑，保护员工/Creator/template origin、conversations/messages/附件/objects、tasks/a2a actions/events、automations/runs/重试、management_requests/幂等、users/memberships/设备/绑定/认证。新 `hermes_bots / bot_routines / bot_gateway_inbox` 与 `profile_binding_json / provision_action_id / native_driver_json` 留存，不能DROP或整库恢复。只允许冻结契约明确的mode/control/epoch/schedule字段改变，字段变化逐条关联操作/理由；历史数据总量不能当本轮基线。

HOME对账分来源/旧Creator/legacy、QA A/B owned、worker journal/delivery、Gateway/Group原生状态四组。未触碰来源用byte/link hash保护；QA工作HOME允许真实执行产生的session/cache/log增量，但既有memory/config/profile ownership与原session/result不能丢。memory原文/摘要、state.db的session/messages/tool计数与metadata、kanban.db/hosted_rooms.db/collaboration和Gateway/driver pending记录分别比对；不能只信nativeResources展示。活跃SQLite使用一致snapshot/逻辑行比较并正确保留WAL/SHM，不能只哈希主db文件证明全部数据。认证只比较必要哈希，不提交原body、DB或token。API、sourceHome、workspace/employee/device/ownership/provisionActionId等稳定坐标保留。

私有执行manifest需记录：source/code/archive/install/running身份，API origin/database/HOME/prefix绝对路径，port登记ID和日志验证状态，原始操作ID/命令数组/UTC及北京时间起止，精确QA允许范围、进程PID+creation+Job、scene状态/response/error/退出，slot/action/session/member/gateway关联，原始失败与变更摘要。公用报告只提交合成内容、白名单摘要/哈希与方法，原库/完整认证不入Git。

证据层次分别签收：**静态/本地归档核实**、**实际隔离安装/build**、**隔离真实API/client/HOME往返演练**、**正式服务器或正式客户端切换**。本轮只完成第一层，后三层目前 NOT_RUN；最后一层未获本轮执行授权。先前真实 gpt-6.1-sol/max 的6功能场景、12成功动作、4completed和5attempt/1明确过载审计仅复用原 cloudcore 范围，不为回退重复云调用，也不代替往返证据。

## 6. 收尾与下一步

矩阵与静态证据完成后提交总控，Q01本轮停止在计划检查点。待E02稳定产物/契约/SHA由总控转交，才在自己的隔离树真正执行RB01–30；不测试作者WIP、不更换持久预览。任一P0缺证据记INCOMPLETE/FAIL，不能承诺V2可上线后随时安全回退。
