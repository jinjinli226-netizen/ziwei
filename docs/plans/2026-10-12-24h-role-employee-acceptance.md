# V2 全天岗位：验收设计与 24 小时隔离 soak

日期：2026-10-12，Asia/Shanghai。**本文件是未执行的验收方案，所有 V2 产品项为 NOT_RUN；没有产品测试、真实模型、正式业务或 24 小时运行证据。**

关联：[设计](../superpowers/specs/2026-10-12-24h-role-employee-design.md)、[实施计划](2026-10-12-24h-role-employee.md)、[会话台账](../handoffs/V2_SESSION_LEDGER.md)。V1 的测试/发布记录不能替代本计划的验收。总控后续分派用户可见 Q 会话独立验收，本 E01 不启动或排程验收。

追加范围：公共Creator模板在各工作区分别安装实例，管理边界仍是当前已认证workspace；全天岗位仅面向Hermes，Creator可继续使用其现有Codex/Hermes运行时。第7节C01–C16为Creator→Hermes岗位的新增联调设计，当前全为NOT_RUN，不操作bigtron正式Creator。

## 1. 验收层级

| 层级 | 必须证明 | 不足以证明 |
| --- | --- | --- |
| D 文档审查 | 目标、合同、边界、实现任务、风险与证据标准可执行且一致 | 产品已经实现 |
| F 短时行为夹具 | 竞争、时区、恢复、预算、取消、身份隔离、迁移兼容的可观察结果 | 24 小时稳定性、模型真实能力 |
| N 原生隔离验证 | 精确候选上的真实 Hermes 启动/执行/独立记忆/退出证据 | 正式业务通过、全天无故障 |
| S 真实 24 小时 soak | 连续真实时间的计划/实际执行/离线/重启/暂停统计、原始日志与实际模型探针 | 所有岗位、provider、电脑或生产系统都可靠 |
| Q 独立签收 | 对候选源码、证据完整性、计数、保护边界逐项判断 | 自动获得正式上线授权 |
| R 发布后验证 | 已授权层次的源码/包/安装/build/实际执行与回退证据 | 仅上传包即视作所有客户端升级 |

签收枚举为 PASS / FAIL / INCOMPLETE / NOT_RUN，unknown 字段保持 null；不采用“基本通过”掩盖关键缺证据。身份串用、重复未知执行、暂停后新发 grant、伪造 stopConfirmed、覆盖原 HOME、外部越权动作任一出现，必须 FAIL 并停止新增验收工作，保留证据。

## 2. 前置条件与隔离边界

后续验收者必须先完成以下准备并保存 manifest，才能从 NOT_RUN 变 RUNNING：

1. 固定候选 commit、源码/包/安装/build、Node/Windows/Hermes metadata 与命令入口；本轮文档基线不等于未来候选。先读适用 AGENTS、V2 交接和最新项目顶部，保护全部现存工作树。
2. 使用独立测试数据库、workspace/owner/设备身份、两个隔离岗位、主聊天、HOME、cwd、action-state 和日志；精确 QA IDs 写入 manifest。不使用正式员工或已删除对象，禁止重放原 Creator 请求。
3. 只允许隔离文件中的计数器、随机 nonce、合成文档和记忆标记。模型不得访问正式管理/手机 MCP、外部账号、发布或业务动作；允许工具按测试所需最小范围封存。认证如需引用现有来源，须按已授权且可审查方案处理，不复制全部 HOME，前后验证原认证/配置保护，不输出值。
4. 测试 API/客户端/观察器都是隔离进程，记录 PID、创建时间、命令来源、绝对数据路径和归属；故障注入只终止 manifest 指定的自有隔离进程，不终止正式服务，不改 Windows 电源/开机配置。
5. 涉及测试端口或登记时先读 port-manager，查询/登记与项目诊断按其规范执行；不得为了测试新增正式业务实例。本 E01 未查询/登记端口、未启动任何测试服务。
6. 明确测试的模型启动/时间预算和允许的工具；固定随机数据后封存 hash。观察器独立于业务进程且只能读其精确实例。原始日志追加/按实例分文件，5 MiB × 5 为建议最低轮转参数；须按实测日志量保证覆盖整个窗口，另存封存证据，不用轮转覆盖证据。

## 3. 必须通过的功能与故障矩阵

| 编号 | 输入/故障 | 核验结果与证据 |
| --- | --- | --- |
| A01 | 旧库初始化两次；原 employee/Creator/history 存在 | 新表可重复初始化；原行/删除状态/原 HOME 不变；精确字段比较，不用整库恢复 |
| A02 | 两 workspace/owner/employee/device/profile 交叉请求 | 非授权请求原子拒绝；不创建 work/action/主聊天消息/占用；不能请求体自报 owner 取得权限 |
| A03 | 同员工人工、Routine、目标后续段同时到达；两个实际独立scheduler实例并发且重启 | 持久唯一索引/条件事务保证一个有效 grant/一个实际执行；员工间仅允许配置内有限并发；稳定排序与公平性，不依赖内存集合 |
| A04 | 相同请求重复、派发超时、outbox 落盘后/API 回执前崩溃 | 同 intent/slot/run 不额外启动；稳定 action/dedupeKey 与进程启动记录相互对应 |
| A05 | claim 后、spawn 前；spawn 后、结果落盘前；结果落盘后、上报前退出 | 分别证明未启动可恢复、未知必须隔离、结果只补传；原 action ID 不因恢复改变 |
| A06 | lease 过期、旧设备复连、旧 token 迟到结果；重启后不确定结算 | 不盲目抢占；旧结果不释放新锁；结算验证可信evidence_id/精确run/action/device/token并在客户端持久确认后释放server claim；重复/断线幂等，错证据拒绝；停止已确认与业务unknown分开，不能手改状态文件 |
| A07 | 断网/客户端退出/隔离宿主恢复 | availability 准确；离线不新发 start grant；queued不耗模型；恢复按 missed policy，unknown 不重放 |
| A08 | 6 小时内/外离线、skip/coalesce/catch_up、满队列 | 槽位均有 disposition；最多补 3 次且受窗口；补跑每岗间隔≥60秒、每设备≤3次/分钟；人工优先且无饥饿；过期/容量原因可见；无静默漏项 |
| A09 | 上海午夜、UTC、纽约 DST 两边界、时钟前后跳、interval 延迟 | UTC 槽位唯一；缺失本地时刻记 skipped_dst；重复本地时刻只选第一个；anchor 不漂移 |
| A10 | Routine 修改/时区变更与领取竞态 | revision 冲突409；旧未派发 superseded；已运行保留旧快照，结果不算新 revision 完成 |
| A11 | 选择同 source_profile 的两个隔离岗位；关闭并重启隔离客户端 | 不同 HOME，记忆不自动跨岗加载/注入/写入，错误绑定拒绝；同岗位恢复标记与检查点；原 source profile/Creator 不被覆盖；不声称OS沙箱隔离 |
| A12 | 连续两问，第二问在第一问完成前排队 | 第二问取得执行权后包含第一问已提交结果；有 context_revision/来源 ID；历史不会变新授权 |
| A13 | 缺少所需交付、需输入、预算耗尽、原生费用字段缺失 | 不伪报 succeeded；waiting 不续叫模型；8 段/96 次/120 分钟预算守住；费用是 null 而非0 |
| A14 | 暂停时无运行/有排队/已有grant/正在运行 | paused持久；新 grant数为0；在途运行发停止且直到真实回执才确认；刷新/重启保持paused |
| A15 | 执行槽满、离线停止、成功/停止竞态、停止证据缺失 | 控制通道不被堵；accepted ≠ stopped；真实成功先到则保留成功；未知保持占用与提醒 |
| A16 | 恢复岗位、原生plan也试图表达相同意图；现tick和旧手动automation入口并发 | 暂停期不补跑；uncertain不解除；首版同一现tick分流、一个automation下一次时间、一个slot/run/action，无第二生产tick或双authority；未改用户原生cron；未来native hook未满足时明确不支持接管 |
| A17 | 成功/失败/需输入/有变化/无变化与结果补传 | 主聊天归属正确；同result只一条相应汇报；无变化不重复通知；全部执行仍可查 |
| A18 | UI 1440/390、切岗位/工作区、断线重连、刷新/重登录 | 异步响应不串岗位；离线/暂停/运行/不确定清晰；停止按钮反馈真实；长职责/路径可读 |
| A19 | 验收进程正常/异常退出、观察器采样中断与重挂 | 独立退出记录含精确实例和exit/unknown；不能把观察器断线当业务成功；缺口明确统计 |
| A20 | 现有自动化parser/CRUD/tick、通知/HMAC投递/重试、Creator、会话图片、默认目录、A2A维护 | 原解析器直接复用，未绑定automation行为保持；已绑定旧API经岗位revision/控制；同一结果/投递补传无重复模型与通知、无变化审计不扰民；对应专项回归通过，无业务/手机执行，不宣称补齐其他受阻功能 |
| A21 | 单Routine暂停、取消当前工作、岗位暂停分别操作 | 三者作用域准确；暂停Routine不停止当前run或其他来源；岗位暂停对所有在途请求停止；均可追溯且不追补暂停窗口 |
| A22 | 删除员工/职责revision变化/绑定切换与旧worker并发 | 删除持久撤销、墓碑和在途证据保留；迟到结果不复活员工；旧revision不自动续作；未收敛拒绝换设备/profile；保留HOME |
| A23 | 已启用岗位通过旧task、普通聊天、Creator/管理MCP和直接A2A派工；旧payload到达 | 所有可信employee入口受同一占用/control epoch/grant门槛；缺字段不降级；启用前旧在途先收敛/隔离；暂停不可经旧入口绕过；未启用员工旧链路保持 |

所有行为用实际数据库约束、HTTP结果、持久事件和所属进程回执验证，不能只用实现字符串快照或 UI 文案断言。短时夹具可以注入时钟与假运行时，但必须标 `fixture=true`，不作为真实模型结果。

## 4. 24 小时窗口与计划

**候选演示窗口**：北京时间 **2026-10-14 10:00:00 至 2026-10-15 10:00:00**（UTC `2026-10-14T02:00:00Z` 至 `2026-10-15T02:00:00Z`）。这只是可审查排期示例，未预约、未创建任何自动化；若届时候选/授权未就绪，Q 将窗口整体顺延并在开始前封存新的明确起止。

```json
{
  "status": "NOT_RUN",
  "timezone": "Asia/Shanghai",
  "proposed_start": "2026-10-14T10:00:00+08:00",
  "proposed_end": "2026-10-15T10:00:00+08:00",
  "actual_start": null,
  "actual_end": null,
  "actual_elapsed_seconds": null,
  "candidate_commit": null,
  "model_calls_actual": null,
  "cost_actual": null
}
```

实际计时用 UTC 时间戳加独立观察器的单调时钟，要求 elapsed ≥ 86,400 秒；记录系统时钟偏移。24 小时结束时尚有工作必须追到可解释终态或明确 uncertain，再封存结束报告。观察缺口无法重建时为 INCOMPLETE，不用首尾时间差掩盖中间缺证据。

建议两个隔离岗位，全部走候选岗位调度/A2A/监督链，不只单独调度库函数：

| 岗位 | 计划与预期计划数 | 实际执行载荷 | 能证明的范围 |
| --- | --- | --- | --- |
| QA-A：调度与故障岗 | `[T0,T0+24h)` 每 30 分钟一次，从 T0 起，共48个槽位 | 本地确定性 fixture CLI；产出包含 slot/run/action/nonce 的隔离JSON并追加计数器 | 24小时调度、持久恢复、重复/遗漏、停止与通知；不是48次真实模型 |
| QA-B：记忆与交付岗 | T0+10分钟开始，每2小时一次，最后T0+22h10m，共12个槽位 | 真实 Hermes 有界执行；读写本岗位合成记忆和小文档，检查已提交上下文；禁止正式/外部业务 | 12次真实原生模型探针和跨重启记忆；不是所有时间都在调用模型 |

QA-B 12 次只是计划上限，实际次数必须从进程与模型回执统计，缺费用保持 null。每次最多 2 分钟，整个岗位仍服从默认单次/日预算；无自动模型重试，准备失败保留并标相应未执行。若 Q 未获真实模型验证范围，仅能做 fixture soak，结论须为“真实模型层 NOT_RUN”，不能签首版完整 PASS。

以下故障安排主要作用于 QA-A，另有明确标注的 QA-B 自有隔离客户端重启；两岗使用独立隔离设备身份、客户端实例和状态，避免一个设备的 uncertain 隔离被绕过或影响另一岗探针。不得改整台机器网络或电源从而影响正式服务：

| 相对 T0 | 隔离动作 | 预期记录 |
| --- | --- | --- |
| +04:10 至 +04:50 | QA-A 传输层隔离断线，保留进程日志 | +04:30槽位按默认coalesce_latest补一次；无重复启动；offline窗口如实记 |
| +05:50 / +06:20 | 分别重启QA-B与QA-A自有隔离客户端，不重启用户电脑/正式daemon | 新PID/创建时间；从持久记录恢复；QA-B在+06:10探针核对+04:10已保存记忆 |
| +08:10 至 +09:10 | 暂停 QA-A；恢复时不追补暂停窗口 | +08:30、+09:00两个槽位 skipped_paused；暂停接受后新grant为0 |
| +12:05 | 更新 QA-A 职责/计划revision，保持原30分钟节奏 | 48个计划时刻不变，后半归新revision；无新旧重复槽位 |
| +14:00 | 在该次 QA-A 隔离执行制造“已启动但结果/停止证据缺失” | uncertain，禁止因lease过期重启或重放该slot |
| +14:40 | Q引用可信监督器事先持有的该fixture精确实例/Job停止证据，经产品reconcile接口结算 | 不手改DB/action-state；客户端持久确认解除匹配隔离后server释放claim；保留业务unknown与失败证据；独立的+14:30等待项可后续开始，原+14:00不再执行 |
| 其余预先封存时刻 | 重复请求、结果落盘后丢上传、执行中单次停止 | 使用单列的 adhoc fixture 意图，不混入48/12 Routine分母，原结果只补传 |

如果 +14:40 无法取得有效停止证据，保持 uncertain、后续任务如实等待，最终 FAIL/INCOMPLETE，不为了按时完成强行释放。计划表是输入，不是预期成功事实。48个 QA-A 槽位中暂停2个，其余应最终有可核对处置；若只有上述事件且无额外失败，Routine 实际启动目标为46个。QA-B目标为12个实际启动。不可提前把这些目标数字填到 actual 栏。

## 5. 证据目录、日志与统计

后续 Q 使用自身隔离工作树下 `.local/v2-role-soak/<run-id>/`，**启动前在 manifest 填写解析后的绝对根路径**。本轮没有创建此证据目录。建议结构：

```text
manifest.json                 精确版本/身份/预算/路径/计划/授权边界
scheduled-slots.jsonl         每个计划时刻、revision、disposition
work-events.jsonl             queued/claim/grant/spawn/stop/exit/result各阶段
instance-<id>-runtime.jsonl    PID/创建时间/build/运行摘要/退出码或unknown
observer-<id>.jsonl           独立健康/退出/采样缺口；只读观察
results/<run-id>.json         终态、交付引用、hash、用量字段与来源
notifications.jsonl          主聊天/网页汇报ID、幂等键、投递状态
failure-injections.jsonl      精确隔离目标/起止/恢复证据
protection-before-after.json 原有资源保护摘要，不存凭据/私密正文
summary.json                 计划值/实际值/分母/窗口/缺证据
review.md                    Q判断与失败/限制，原回执不可改写
```

清单包含所有文件 hash，原始数据库、完整用户会话和认证不提交 Git。表中的“日志绝对路径/验证状态”由后续运行者填写实际值，尚未创建只能写 null/NOT_RUN，不能套用 V1 观察器日志声称本岗位已被监测。

必须统计并可从原始记录重算：

| 指标 | 口径与门槛 |
| --- | --- |
| planned_slots | 按开始前封存的revision时序列举，分别报告QA-A=48、QA-B=12的计划值与实际台账数 |
| admitted / skipped / held | 每个计划槽位唯一归入已入队、策略跳过/过期/替代、等待核实；含每个原因和时间窗口 |
| unexplained_missing | `计划槽位 - 有唯一可解释处置的槽位`，必须0；不能把策略跳过计成执行成功 |
| duplicate_launches | 同一逻辑意图/尝试的实际原生spawn超过1次；必须0。授权安全重试另记attempt，unknown重试本身即FAIL |
| actual_launches / results | 进程spawn、根退出、Job证据、结果落盘、结果ACK、通知投递分别计数；不强行相等，不把accepted当started |
| late starts | 实际spawn-应开始时间；健康在线、无前序占用、无故障注入时p95≤30秒、max≤60秒为提议门槛；排队与控制故障窗口单列，不能删异常美化 |
| offline windows | 精确起止、检测延迟、原因/unknown、持续秒数；检测按实际心跳TTL验收并记录TTL |
| pause/stop | 暂停接受后新grant=0；停止接受/送达/目标退出/确认时间分别记录；健康网络接受≤2秒、送达≤5秒为目标；>30秒无确认必须如实显示 |
| concurrency | 每岗位同时实际执行≤1；每设备≤配置值；设备隔离阻断不被新岗位路径绕过 |
| memory | 两岗位标记不会跨岗自动加载/注入/写入、错误绑定拒绝；QA-B跨隔离客户端重启读取前一次提交标记和任务checkpoint；原profile/Creator保护通过，不声称OS层不可读 |
| idle/budget | 无work的模型启动数=0；waiting/paused不发新grant；暂停前已确认grant的在途单列spawn/stop时序并收敛，确认停止后不得spawn/续段；实际段数/次数/墙钟不超封存预算；cost不可得为null |
| reports | 有交付/失败/需输入/实质变化的通知按策略唯一；无变化主动通知=0；消息全部回正确主聊天 |
| observer coverage | 连续24小时观测可解释，缺口逐段记录；业务退出必须有独立观察证据或unknown，不能推断exit0 |
| protection | 原有正式资源与受保护路径未被修改；仅QA白名单变化，用户新增/删除状态保留 |

actual 数据初始全部 null，不能以计划数、0次错误猜测或旧报告替代。实际开始/结束同时记录北京时间和UTC，报告不能仅写“跑了一天”。

## 6. 收尾、验收结论与发布门槛

Q 在24小时后只读重算上述指标，并独立抽查全部失败/unknown、所有模型探针、两个岗位隔离与暂停事件。任何未知在最终报告中有明确归属和处理，不按缺日志判成功。控制场景可保留历史uncertain→已核实终态轨迹；不能删掉uncertain以美化统计。

只清理由本次 manifest 确定且证据已封存的 QA 资源；不按名称前缀批量删除、不碰共享认证/缓存/原有profile、不整库恢复。失败证据与必要追溯保留。正式业务、受阻任务和旧 QA 范围不会因这次验收被唤醒。

首版产品PASS必须满足A01–A23、候选宣称支持组合对应的C01–C16、必要回归/构建、真实Hermes隔离层、真实24小时层及数据保护全部通过。Creator runtime组合只按实际验证的矩阵单元签收，未测组合NOT_RUN，不从Codex Creator推导Hermes Creator或反向推导。未来R发布前仍需再次核实运行环境和分层版本；发布后实际设备离线或未升级时应分别标记，不能因此回填本次soak成功结论。

## 7. Creator → Hermes全天岗位的独立联调

### 7.1 当前能力与候选范围

现有源码只有Creator市场模板`ziwei-employee-creator 1.0.0`及普通员工/任务/会话/profile管理工具；七项新role工具、draft验证/activate合同、旧Creator能力overlay均未实现。UI能打开Creator、HTTP管理入口健康、device prepare/configured、stdio tools/list、loaded/toolCalls和岗位交付成功分别取证，不能相互替代。

本次E01只读检查未取得bigtron现存Creator的新元数据：可用连接器没有员工管理读取接口，Edge inventory报`nodeRepl.fetch request failed`，本会话IAB无已有tab。正式employeeId、模板来源/应用版本、runtime/profile/model/device、主聊天/MCP状态均unknown。后续Q如果需要正式保护元数据，只能通过已有合法只读路径核实；不得填入旧事故employeeId当当前实例、创建新登录/凭据或执行模型来查身份。首次联调的执行主体全部是隔离QA Creator，不用正式Creator。

拟验证矩阵（全部NOT_RUN）：

| Creator执行runtime | 目标员工runtime/模式 | 预期合同 | 签收范围 |
| --- | --- | --- | --- |
| Codex | Hermes全天 | 允许；发现与选择各自runtime，不把Creator配置复制给目标 | 真实通过后只签此组合 |
| Hermes | Hermes全天 | 允许；Creator与目标独立HOME，父子有界执行不死锁 | 真实通过后只签此组合 |
| 现有受支持Creator | Codex/Claude/Gemini全天 | 明确unsupported，不换目标runtime、不偷偷安装role | 负例/普通路径兼容 |
| 现有受支持Creator | 普通员工（非全天） | 保持既有可用组合；不默认安装role或启用Routine | 不扩大各CLI既有功能边界 |

同一catalog在两个隔离workspace的Creator实例可分别使用，但一个实例不能指定另一个workspace管理员工。只检查保留的现有scope拒绝，不实施跨区权限扩展或旧受阻兼容修复。

### 7.2 联调用例

| 编号 | 场景 | 必须留下的可核验证据 |
| --- | --- | --- |
| C01 | 两区/同区不同owner读取公共catalog并安装各自Creator | 公共定义一致，instance ID/owner/workspace隔离；catalog无跨成员persona/主聊天/凭据；当前workspace固定 |
| C02 | 同owner用同Hermes能力模板创建两个相同配置但不同意图的岗位 | 两个employee/role/主聊天/namespace；Creator旧来源表单例约束保持；role按workspace+employee保存来源，不按template全区复用一个岗位 |
| C03 | 每阶段响应丢失/重试，同key同参/异参，源员工已被用户删除 | 同setup/step返回原ID，异参409，删除返回Gone/墓碑；无换key重建或恢复已删除员工 |
| C04 | 自然语言明确“搭建并按计划工作”，信息齐/缺关键项两种 | discovery先查可得信息；缺项一次汇总；从原用户请求追溯intentRef，已有授权不逐步重问；没有启用意图则draft |
| C05 | 创建到draft配置之间崩溃，旧create_task/runtime/model/status=active请求并发 | employee与draft控制原子关联；未配置/未激活前旧入口无业务grant；不因employee.status active绕过role |
| C06 | 完整配置回读、同名既有员工/明确指定已有employee | 配置hash/revision/ID一致；只按用户明确ID采用；非请求字段保持；不修改Creator本体，不给普通员工默认安装role |
| C07 | draft验证、任意checkOnly/probe/prompt伪造、paused/deleted/uncertain验证；profile带写工具/额外MCP或限制不受支持 | 仅固定配方的服务端validation grant；精确run/action/employee/device/revision/purpose；临时overlay实际toolset/MCP允许清单/hash与只读调用可核验，无all/任意shell/正式写入/手机/外部账号；业务指令只作配置数据，源profile保持；限制无法证实则validation_unsupported、保持draft，模型/浏览器自报无效 |
| C08 | probe succeeded但内容错误、只有loaded无toolCall、旧配置MCP回执 | 验证失败/缺证据而非validated；保存本次action的schema/loaded/toolCalls及产出检查；不从最近无关记录取成功 |
| C09 | validate后修改职责/Routine/model/profile/namespace/build；30分钟过期；暂停/取消/新用户输入；draft→resume；激活后暂停再重试原activate | 旧证据/epoch/intent cursor不可激活；draft直接或经pause/resume不变active；未处理新输入先处理；相关变更重新验证且unknown不重放；合法激活只一次，旧key不能撤销后来暂停，next_due从真实激活后开始 |
| C10 | origin=template/adopted-existing/customized旧Creator接入 | 原persona/instructions/SOUL/memory/认证/主聊天字节或适用稳定字段保持；sourceTemplateVersion（含null）不变；能力版本/overlay revision单列；不是批量改模板 |
| C11 | Codex Creator→Hermes与Hermes Creator→Hermes；target非Hermes | 正向分别真实runtime/action/profile证据；负向unsupported；Creator runtime不强制等于目标；未测组合NOT_RUN |
| C12 | 刷新/重新打开Creator和目标主聊天，重启隔离客户端 | 原setup/employee/conversation IDs保持；不通过POST重装恢复视图；同岗位记忆/检查点仍在，Creator与岗位不自动串记忆 |
| C13 | 激活后实际到期Routine，人工消息插入与无变化观察 | 唯一slot/grant/实际action，目标主聊天收到唯一结果；Creator只收搭建回执/链接；无变化安静，不产生额外Creator模型轮次 |
| C14 | Creator通过MCP暂停岗位/单Routine、停止run、删除/revision后旧派工 | 和网页相同控制合同；accepted≠stopped；旧MCP/Creator入口不能续作，停止证据明确，无新权限例外 |
| C15 | 联调中断网、客户端退出、未知停止与恢复 | 原phase/ID不丢；已有结果仅补传；unknown不再启动原执行；精确reconcile后才解除匹配隔离，不以resume直接解锁 |
| C16 | 旧schema/缺工具/缺actor或真实环境、Creator自身预算耗尽、同机并发1或无子槽、模板升级 | 不声称ready，不猜owner/建凭据/切scope/升级；Creator返回原phase/ID后释放父槽，原validation action再启动且仅一次，不伪装第二manager或提高并发；新catalog不覆盖定制或HOME；所有失败/保护证据保留 |

### 7.3 真实联调步骤与回执

1. Q先固定候选SHA/build、服务与stdio schema版本、两种模板manifest、capability/overlay revision和要签收的矩阵单元；完成A系列基础门槛及C系列非模型行为测试。记录隔离QA的精确身份/允许路径/模型预算，不启用生产工具或手机。
2. 用隔离Creator主聊天提交一次明确且有完成标准的自然语言搭建请求。请求只针对隔离合成资料与目标Hermes岗位，包含是否启用、例行计划及资源边界；不要复制或重放正式旧创建消息。
3. 从实际Creator action提取成功工具调用链：环境/模板发现→begin setup→employee创建或复用→draft及主聊天回读→verify→真实probe结果→activate。同时核对数据库/审计状态；工具输出声称成功但缺服务端状态则不通过。
4. 故障注入覆盖创建/验证/激活响应丢失，必须先回读原setup/action；未知执行不重放。再次表达同一意图时稳定key复用；明确第二个独立岗位用新根key，二者不混淆。恢复步骤由后续合法Creator执行完成，不要求单次模型跑满24小时。
5. 实际等待至少一个正常到期Routine运行并核对主聊天交付、暂停/停止、离线/unknown恢复和跨重启记忆。该短时真实链路只能签联调探针，不等于24小时PASS；随后第4节连续24小时soak应使用至少一个经该搭建流程产生的隔离Hermes岗位（QA-B），并保留setup→role→slot→run链。
6. 确认实例来源、scope、正式保护状态和失败证据后，Q按组合给PASS/FAIL/INCOMPLETE/NOT_RUN。只有候选宣称支持的组合全部达到合同才能宣称该范围Creator联调通过，不能用一种runtime或一个owner的结果泛化。

证据追加到同一私有验收根：`creator-integration/intent-manifest.json`（只含QA意图与ID）、`setup-phases.jsonl`、`tool-chain.jsonl`、`configuration-readback.json`、`validation-evidence.json`、`runtime-matrix.json`及正式保护摘要。每条工具证据关联Creator actual action、setup、目标employee、role/configuration revision、tool/schema和结果；保存用户原始QA请求的hash及授权范围，不写正式私密正文/凭据。

原生probe的产出、停止/恢复、24小时台账与模板应用是分别签收的层次。全部字段当前为null/NOT_RUN；本轮没有新增模型调用、QA账号/员工、正式配置写入、手机动作或发布。
