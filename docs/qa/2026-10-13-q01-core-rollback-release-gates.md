# Q01：核心 Bot 与保留数据回退的最小复验、发布门槛

本轮只读规划，依据产品 `8556aecb6a37385d9fc7061f989e97071bfd6cf9` 与QA报告提交 `99214bafa941aab5699b3b99b9459d2a622db3fd`。没有读取E02变化中的目录、重跑测试、启动服务或修改产品。原RB01–30的1 PASS / 24 PARTIAL / 2 FAIL / 3 NOT_RUN保持原样；本清单不是新候选的通过回执。

建议签收范围为：Windows原生客户端上的owned Profile开通/验证、显式启用/暂停、主聊天、原记忆/session、普通任务，以及普通prompt Routine的有界运行/未来调度；兼容V1继续使用原default/Creator及普通旧员工、任务、文档/对象与旧权限。回退指**同批保留数据的V1兼容包**，不指把原裸V1归档直接接到V2数据上。承诺是“排空并核实后可保留当前数据回退并恢复原身份”；未结/未知执行必须拒切，不能承诺任意状态下立即强退。

## 先确定范围是否实际可限制

Group/协作、外部Gateway、手机、Goals/Heartbeat/Kanban原生驱动和24小时无人值守不纳入本次可用性签收。无需为此连接平台、手机或长跑，但**不使用、未配置、capability标签、隐藏按钮都不是完整禁用证据**。当前没有统一core-only开关，`BotWorkbench.vue:29`、`BotNativeWorkspace.vue:14`和`backend/app.mjs:698`仍提供这些UI/API/MCP入口。

| 排除范围 | 可复用的现有限制与发布所需条件 |
| --- | --- |
| Group/协作 | `backend/bots.mjs:128/144`对手工groups.step/collaboration检查collaboration.enabled和execute。有限配置应为disabled、目标为空，并有API/MCP拒绝证据；`createRoutine:260`仍接受groups.step，因此还要核nativeDriver Routine/后继入口，不能把手工路径保护泛化为全部硬禁用 |
| 外部Gateway | `src/hermes-native-bridge.py:780`的真正worker核平台enabled。须核保存配置无启用平台/路由、相关请求被配置守卫拒绝、原worker已退出；缺凭据导致失败不算限制，也不因新disabled配置忽略旧worker |
| 手机 | `backend/phone-mcp.mjs:21/25`与daemon terminalMcp门槛可复用；核心Bot须没有有效手机执行授权和在途run。只对新范围核限制，不关闭或修改旧员工已授权手机能力，不执行设备动作 |
| Goals/Heartbeat/Kanban及原生driver Routine | 聊天toolset禁止自主工具不等于native入口禁止；native contract仍允许start/resume/step/claim/dispatch，当前没有proactive.enabled整体门槛。若要声明本次不能使用，必须有服务端/客户端的有效限制并覆盖Routine入口；目前仅能标“未验收”，不能声称已强制排除 |
| 24小时/自动运行 | 不承诺长期可靠性即可排除soak；普通prompt Routine若属于核心，仍须有一次有界未来tick与零历史重放验证。不可拿QA的enableScheduler:false冒充正式限制，也不能停掉旧V1全局自动化来缩范围 |

上述限制是发布条件，不是本轮新增产品实现指令。总控需要选择可审查、实际执行的范围限制，或把仍可触达的能力保持为未验且不纳入发布承诺；**若无法实际限制未验入口，且不能核查它们可能产生的存量/后继并在未结或未知时拒切，仍阻断“限定核心可安全回退”的签收。** 不是要求保证故障永不产生unknown，而是要求unknown不会被遗漏后放行。Q01本轮不自行加开关或改权限。

减少可用性承诺不能减少存量排空检查。当前seal/inspect与native collector联合核查：服务端主要检查V2关联action/Routine/webhook/手机run，Gateway inbox当前没有这个关联过滤；native collector核本机journal/delivery、HOME marker及原Gateway生命周期。它们**没有直接读取owned HOME的state.db原生driver/inbound元数据或kanban.db活跃claim**（`backend/preservation-native-evidence.mjs:53/77/121`）。因此collector.safe不能单独证明这类存量零未决，有限核心也需追加只读核查或等效可审计证据：

- `ziwei.driver.pending:*`历史key不会删除。Goals/Heartbeat核同request/resource的`ziwei.driver.settled`、sourceActionId、原终态/结果与原树退出（`hermes-native-bridge.py:324–355`）；Kanban没有同样的settled key，核同一原task/run的原生终态、complete/block结算结果、sourceActionId与原树退出（`:405`）。缺匹配结算或未知才阻切，不按pending key存在一刀切。
- Gateway inbound的pending/accepted/delivery_started/未知发送，Kanban claimed/running和Group原成员未结算均阻切。delivered/delivery_failed及已settled历史须关联原来源/结果后保留，不清key造zero。
- 补充证据绑定同operation、原HOME/设备/DB一致快照；在freeze、原客户端排空与树退出之后核验，并在seal前核一致性。若无法证明，拒切。UI最新100条nativeResources、action数量或“此次没有用过”均不替代该证据。

## 五组必须闭环的现场验证

收到E02新clean SHA、契约差异和同批产物后再执行。五组可合并为一次新包V2→兼容V1→V2往返，加少量独立故障副本；不要求RB01–30全部PASS，不重复原V1初始化整段、不重复相同开通故障或付费云首链。

| 门槛 | 最小而充分的现场证据 | 对应RB |
| --- | --- | --- |
| G1 新身份及P1闭环 | 新源码/三类两角色产物manifest与SHA、兼容/V2实装及running build、API入口/PID精确吻合；至少一次实际错manifest/文件或错running身份拒切且无状态半改。打包后兼容执行器复跑原management bootstrap await junction窗口，并按修复涉及路径补terminal await对应变体：明确保护拒绝、native spawn0、owned **全部文件含logs**无新增/修改；原失败仍保留。再跑ordinary/default/Creator真实本地正例，防止修复全局封禁。拒绝回执/journal应明确未启动，不借清unknown完成排空 | RB01/02/22/25 |
| G2 补传及未知拒切 | 一次真实核心native完成、原Job树0后，由QA外围在服务器接收result前明确阻断上传，形成真实result_pending；prepare后seal拒绝，重启原API/client并保留同runtimeDir/原action/HOME，结果仅补传一次、assistant/task或run只结算一次、native/model调用不增加。另在自有故障副本中接实际collector→seal，覆盖pending、ACKed-expired/递归uncertain、started无result或损坏、blocked/retainEvidence、缺原tree证明五类拒切；核原payload/字节/phase不被“修绿”。故障注入标明层次并保证错误来自目标故障，而非复制后路径不匹配 | RB05–08/17/18，兼顾11/12/27 |
| G3 核心入口及身份 | 同一封存API复用11条负例并记录安全caseId、409、每用例或等价明确小组的DB/HOME/cache/对象/calls前后。补代表性profile/device/status修改、employee DELETE、Routine绑定/executor改写、原action直接ACK/renew/poll，以及仅通过task/automation/source持久关联的A2A各一例；无需遍历type/参数笛卡尔积。主聊天若继续开放图片/附件，补一例封存附件拒绝及对象存储无残留。保留旧无V2关联动作正例；多workspace实际开放时补错workspace/device拒绝与同名普通员工不误伤；并行部署不在本轮范围 | RB13–17/19–22及24有限子集 |
| G4 新包往返与当前数据 | 复用已建QA数据或独立自有基线，不复制正式数据；同DB绝对路径/origin/baseHOME/journal真实换API与实装客户端V2→兼容V1→V2。切前对全部既有表PK/稳定列、对象文件及实际存在的HOME/原生资源建一致基线；只白名单允许pause/epoch/next_run/时间审计，以及回退期间明确的旧功能增量/墓碑。对账原身份/Profile/marker初始provision/HOME/mainchat/session/memory/结果及权限/凭据摘要。兼容阶段旧default/Creator聊天任务继续可用，补一个旧Creator管理MCP普通任务及普通旧员工修改/删除正例；兼容纯V1无Bot数据与无ID普通action可用的薄smoke可并入。恢复仍暂停，显式启用的新聊天续原session，不恢复整库或重建HOME | RB02–04/15/20/21/25–27/29 |
| G5 持久fence及零重放 | 在同一次往返中，preparing期间API重启与并发新Bot task/聊天请求仍拒绝且无半写。同operation重复seal/restore可回读、异参拒绝；至少一个提交后丢回执/控制器退出的原phase回读恢复，先读状态再继续，不换key。恢复故意错身份/snapshot时仍sealed且无部分解封。一个到期普通Routine保持paused、无旧run/action补跑；显式启用Bot，并显式恢复该普通Routine后，核按当前时间安排未来一次有界tick，旧去重/已完成结果不重放。保留独立observer、原树/补传核实和精确QA清理 | RB11/12/19/27/28/30 |

G1建议增加一个**真实API admission**版本：由已封存真实QA库/兼容API保存的Bot binding及成功provision回执提供protectedHomes；以合法普通旧action取得原摘要许可，在同类await barrier切换自有alias，打包后执行器最终拒绝。原P1的admission fixture可作为精确回归用例继续保留；新链需区分真正HTTP、受控bootstrap/barrier与真正native/Job。两者共同证明最终选择的profile/HOME与真正native入参使用同一固定身份，不能在check后又重新选一个可变alias。仅在早期入口加检查不满足。OS任意并发目录攻击不在本case保证范围。

G2/G5只用自有故障进程/文件与合成provider，必须保留原输入、原action和失败日志。明确注入的临时故障可以恢复其原字节继续测试；真实unknown记录必须保留隔离，不能用恢复副本、改failed/expired或另造key解锁。所有故障副本与正常基线分开登记，不能混称实际发生过每种生产崩溃。

## 可以复用的证据，及不能升级的层次

| 既有证据 | 复用条件与实际层次 |
| --- | --- |
| 8556独立922/922、lint124、build1787 | 是8556结果。SQL触发器两连接锁/DDL回滚、技能原子卸载、权限、dispatcher/delivery、Job等未改专项可作为支持证据；新SHA先读diff，独立跑受影响P1、admission/profile/runtime/包装邻域，不自动说新SHA也922绿。若修复扩大到schema/collector/daemon或测试依赖无法界定，再有理由扩大回归 |
| 原四阶段真实正例 | 复用原V1建库、A/B、旧功能增量、同根身份与实际机械切换的历史证明；新包仍补G1/G4必要实际切换与完整新基线，不能只改receipt候选SHA |
| C原生重试与collector闭环 | provision/binding/marker/collector/native实现未变时复用首次实际成功、明确报告失败模拟、错marker拒绝、合法duplicate及初始ID核验；涉及文件若改，才补对应邻域，不自动重复整次故障 |
| 既有真实Codex/max首链 | 按原固定范围复用6场景/12成功动作/4completed、5attempt含1明确overload，相关model/request路径未变才关联；不把原raw失败改绿，不再付费，不作为回退/新包签收替代 |
| Gateway真实Node Job专项 | 仅原worker/tree/cache/restart/tamper层，fetch为fixture；可支持fail-closed规则，不能升级成外部平台可用或原HOME全部claim已核 |
| Group、跨scope及故障fixture | 保留原unit/reader/注入层次，未验能力不声称可用。缺源码/运行/原证据关联时仍NOT_RUN或阻切，不能借相邻PASS推定 |

可不做：全平台/全type/全部附件参数/每phase崩溃组合，第二次完整代码往返、24h soak、真实phone/外部账号/云模型、全旧UI页面及日志轮转阈值压力。**可不做的是穷举和未承诺能力的业务可用性，不是核心身份、旧功能、数据增量、原未决执行或安全恢复。**

## 即使限定核心仍阻断，及正式发布层

以下任一未闭环仍不签收：原P1；新包/运行身份不一致；G2的真实仅补传或未知拒切没有原证据；G3身份可变更/解绑或拒绝留下副作用；G4当前数据/原身份丢失；G5fence重启失效、部分解封或历史重放；未验入口实际仍可产生未核工作；原生pending/settled/inbound/claim无法核实。允许受限scope后部分RB继续PARTIAL/NOT_RUN，但以上不能用scope缩减免除。

Q01局部现场闭环后，正式发布还须由发布执行者核：GitHub确切冻结提交/QA证据已保存；前端/API/client各机器实际版本与原启动方式；一致DB/对象/HOME备份及最新删除/增量；所有作用域的原V2关联执行，以及被切换客户端/worker/手机共享实例的未决排空；明确每步失败保留状态、回读及回退入口。**当前apply CLI仅接受标记的QA根，不能把QA标记复制到正式目录绕过限制；正式环境需要已审查、可执行的回退流程。** 尚无该流程/正式预检证据时，即使限定核心QA通过也只能进入发布准备，不能直接说可正式上线。

本轮不进行以上正式预检，不写生产运行命令，不替换原项目启动入口。待E02稳定交付由总控转交后，Q01才执行G1及必要邻域/缺口；真正启动前重新核原QA端口6397–6400归属和实际占用，复用持久observer日志，原红证据与unknown状态保留。

建议最终签收措辞：“在明确受限且已验的核心范围，V2排空后可切换到同批保留当前数据的V1兼容包，并恢复原Bot身份、记忆和会话；恢复保持暂停，新工作须显式启用；未结、损坏或未知证据阻止切换。未验能力和正式切换状态分别列明。” 本文五组当前均是待新稳定候选复验的门槛，不是PASS结果。
