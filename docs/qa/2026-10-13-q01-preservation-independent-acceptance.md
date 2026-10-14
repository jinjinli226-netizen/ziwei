# Q01 最终候选 8556aec 的独立回退验收

2026-10-13，Asia/Shanghai。**候选 `8556aecb6a37385d9fc7061f989e97071bfd6cf9` 未通过完整回退签收，当前不能据此上线。** Q01 独立确认兼容 V1 的 Profile junction 异步窗口 P1：保护检查后等待管理配置，再选择 Profile 时可以进入封存 Bot HOME；真实 installed Hermes 成功写入。RB22 FAIL，依赖全部封存入口有效的 RB25 FAIL。作者修复后必须提供新冻结 SHA、同批包和原窗口重验。

四阶段正常路径、原生重试专项和完整回归已独立完成；它们是有效局部通过证据，不消除上述失败。本报告逐条保留 PARTIAL / NOT_RUN，不能将作者数字、unit fixture或脚本 complete=true提升为RB01–30全部通过。Q01未实施产品修复、推送、合并或正式切换。

## 固定环境及产物

QA树：`C:\Users\25941\.codex\worktrees\v2-q01-preservation-acceptance\灵光爸爸拆解`；分支 `codex/v2-q01-preservation-acceptance`，产品基线8556；仅提交本文及白名单合成证据。作者目录只读，包复制到QA `.local/q01-preservation/author-package-snapshot`。原始数据库、HOMEs、设备凭据和完整回执均私有。

API始终为 `http://127.0.0.1:6397`，文件库始终为 `.local/q01-preservation/runs/1791896780966/original-v1-api/data/ziwei.sqlite`，基础HOME始终为同一run的 `hermes-source`。客户端健康6398、合成provider6399、同批frontend zip走查代理6400。登记ID `dcb927c54914f3c3`；最后无监听，保留归属。Python socket/DNS仅允许loopback，未重复真实Codex付费请求。

| 层次 | Q01独立证据 |
| --- | --- |
| 产品源码 | `8556aecb6a37385d9fc7061f989e97071bfd6cf9`；后续QA提交不改变backend/src/daemon/scripts/frontend/package源码 |
| 原公开V1 CLI | 归档SHA `1592d107fcbcf27b9ec5e0d909f871ffa3851d9e136e015713156144d70fc8cc`；新prefix离线安装，原V1 API源 `2ebe3dfee2f438a0b6aa3045d46c83bb67d7341b` |
| V1兼容包 | client SHA `9252d2b73499719bcb04a63ab4a5fe45eb4503de62a7db33f22cf955c2b72d90`；source build `7562457493b14d7c781647f776bc7fc1253e8589e97b24acfeff224c867d6b76` |
| V1兼容 installed/running | `006573c242a5498eff490644c28d472eaeaf6d34695769c8e09bffb6eda6ecf3`；实际native daemon health匹配、同批API文件逐项SHA与listener PID核对 |
| V2 installed/running | `a7329be3dabde8f68fbe200e37031cd97456faf4efc2e6ec1b0a5890efb81ec3`；切入/恢复的实际native daemon均匹配；6份client/API/frontend产物SHA独立核验 |
| 空cache安装 | 另建两个全新prefix/cache，先断言cache为空，npm `--offline --ignore-scripts` 安装两个真实归档，installed build各自匹配manifest；未新建业务实例 |
| 独立回归 | `node scripts/run-preservation-tests.mjs` **922/922**，0失败/取消/跳过；lint **124文件**；build **1787模块**、成功，现有chunk-size warning保留 |

HOME文件哈希比较使用实际QA helper的 `homeHashes()`，递归排除名为 `logs` 的目录；本文字节保持结论仅覆盖其余文件，不宣称运行日志字节不变。HTTP副作用快照是11条负例整体前后对比，未分别为每请求取快照，矩阵已保留PARTIAL。

## 实际原生执行与数据往返

原V1先真实完成普通员工default聊天、Creator聊天及普通任务。V2再创建A/B两个owned Profile，A记忆marker写入、B原生聊天报告memory=false，A手工Routine及普通任务完成。三个Bot（含后续重试C）的原HOME、marker.key/ownershipId、employee/profile/初始provisionActionId均独立对账；实际provision HOME等于绑定推导的真实路径。

第一次测试控制器中断在prepare之前，没有最终receipt，原因未核实；原日志保留。11个动作已有成功及原Windows Job root/treeConfirmed、active0证据。第12个原action `action_aa43b286-c5e8-47cc-9d3f-424cd199f6ae` 为pending、acked_at=NULL、没有journal start，并已超原expiry。恢复前核11个原树已退出、不改原payload、不清journal；同一API自然将该原action置expired，原action仍留存且没有启动。后续已确认原action未启动/自然过期后，才创建独立的新延迟测试意图；未用新key覆盖未知执行。

续跑真实API/client在新延迟action已ACKed且Hermes正在请求合成provider时prepare；seal明确返回ROLLBACK_NOT_DRAINED。原action在preparing期间正常完成，assistant结果落库，未接纳新Bot聊天；drain原client、精确nonce核验后seal。真正换成兼容V1 API/实装daemon后，11条HTTP负例返回V2_OBJECT_SEALED：Bot browser task、管理MCP task、主聊天dispatch省略/true/false、手工run、Routine PATCH/DELETE、employee runtime PATCH、两种A2A绑定请求。受保护表的行快照、action-state缓存SHA和模型调用数均不变。

兼容V1阶段真实旧员工与Creator各增加一条原生聊天，旧员工任务完成；原文档修改、另一个文档soft-delete墓碑保留。恢复V2的同一文件库integrity=ok、FK violations=0；A原除 logs 外的 HOME 文件字节、历史消息/结果、凭据行、binding未重建。重复seal/restore保持同operation。恢复后Bot/Routine仍paused、可领取旧队列为空，显式activate后的新聊天续用原session `20261013_210731_cb56d6` 并报告memory=true。第二个prepare/drain/seal/restore操作保持除 logs 外的 HOME 文件字节且模型调用零增量；此第二循环没有再次换API/client代码，范围单列。

最终库20个action：17 succeeded、2 failed、1 expired。2个failed分别为下述明确故障模拟和错marker原生拒绝；expired为上述从未领取的原action。不能把它们改为绿或从统计中删除。19个已领取动作保留各自原生结果和Job证明；完整树退出以具体processExit字段为准。

## 原生开通重试专项

Q01创建独立Bot C，实际installed V2 daemon/Hermes在原HOME完成首次开通、原Job exit0/tree0。QA API外围仅在这个精确Bot的首次成功设备result上注入显式 `QA_INJECTED_POST_PUBLISH_FAILURE`，保存实际原生成功input与fault标记后将设备报告状态置failed。这是**设备报告失败的故障模拟**，不是Hermes开通自身失败；没有修改产品源码。

将自有C marker.employeeId改为错值后，新原生重试action返回failed、`BOT_PROFILE_OWNERSHIP_CONFLICT`，原目录与除 logs 外的 HOME 文件字节保留。还原原marker字节后，合法新action `action_05583cc4-01c7-4962-8847-e05f98b28b4b` succeeded、duplicate=true、原Windows Job tree0，除 logs 外的 HOME 文件字节完全相同。binding/marker初始action保持 `action_35bd4f89-7c9e-4ee6-868e-96248771cf8f`；row.provision_action_id更新为最新重试action。真实prepare/drain/seal/restore再次通过，collector按初始marker而非最新重试ID核验。

## RB01–30 按整条要求裁定

PASS要求该行全部硬条件；PARTIAL是已有有效证据但仍缺所列现场变体；NOT_RUN不以邻近fixture冒充矩阵实跑。共 **PASS 1 / PARTIAL 24 / FAIL 2 / NOT_RUN 3**。

| ID | 结论 | 本轮实际证据与剩余范围 |
| --- | --- | --- |
| RB01 | PARTIAL | 真实6产物/空cache安装/installed/running/API身份正例通过；错SHA/manifest fixture通过；缺实际文件/错running拒切现场未做 |
| RB02 | PARTIAL | 原V1纯库default/Creator真实执行；兼容V1对纯V1 schema及无ID普通action现场未做 |
| RB03 | PARTIAL | 同文件库原V1→V2及integrity/FK、原员工/消息/凭据和选定对象保留；全表旧task/object/来源HOME初始完整快照未做 |
| RB04 | PASS | A/B不同Profile/HOME、原生记忆隔离、provision/binding/marker/session关联、Routine和Bot普通任务，各原Job树退出；C重试专项另列 |
| RB05 | PARTIAL | 真实ACKed在途拒seal与自然unACK expiry保留；pending拒seal、已领取expired/递归uncertain仍主要unit/reader |
| RB06 | PARTIAL | suite真实daemon delivery恢复专项通过；health两计数0但delivery pending/blocked非0的实际seal组合未做 |
| RB07 | PARTIAL | journal损坏/started/retainEvidence/blob/hash相关专项通过；各故障接入同次实际seal且核原证据保留未做 |
| RB08 | PARTIAL | 真实Windows Job原树退出、validation/lifecycle身份专项；脱离后代/PID复用/host失联实际seal链未完整做 |
| RB09 | PARTIAL | suite真实驻留Node Job/cache/restart/tamper/disconnect通过，但fetch为fixture；同原worker→真实API collector/seal组合未做 |
| RB10 | NOT_RUN | 真实Group远端source/member/settlement组合未做；suite Group children/native/fetch是fixture |
| RB11 | PARTIAL | 真实SQLite两连接写锁/DDL事务专项、preparing新消息实际拒绝；并发task/Routine/ACK/Gateway入站及API重启组合未做 |
| RB12 | PARTIAL | 实际重复seal/restore/第二operation、保留中断原数据；各phase崩溃/丢响应/异参及损坏现场未完整做 |
| RB13 | PARTIAL | 兼容V1主会话dispatch省略/true/false真实HTTP拒绝且DB/cache/calls无增量；其他会话/附件现场未做 |
| RB14 | PARTIAL | 兼容V1 browser employeeId+execute真实拒绝、旧任务正例；external/assignee名字/runtime/model组合未全做 |
| RB15 | PARTIAL | 真实管理MCP Bot task拒绝；旧Creator管理MCP task正例和全部旧校验现场未做 |
| RB16 | PARTIAL | 两种A2A真实请求拒绝；type全集及task/automation/source/member关联变体未全做 |
| RB17 | PARTIAL | unit list/admission与daemon recovery专项；兼容V1预存pending/acked、直接ACK/renew现场组合未做 |
| RB18 | PARTIAL | 真实ACKed原action在preparing补传完成；suite丢ACK/cache补传真实daemon通过；result-upload失败→prepare→仅补传及uncertain对照未组合 |
| RB19 | PARTIAL | 真实兼容手工run拒绝；orphan绑定/retry/tick/webhook与旧automation正例未全做 |
| RB20 | PARTIAL | 真实runtime PATCH拒绝、原行保持；status/profile/device/model、HTTP delete/CASCADE及旧员工变更删除未全做 |
| RB21 | PARTIAL | 真实Routine PATCH/DELETE拒绝且原行保持；解绑executor及旧普通automation正例未全做 |
| RB22 | FAIL | 兼容V1异步Profile junction窗口实际installed Hermes进入封存owned HOME；API admission是受控fixture，执行器/Job/HOME真实；见独立P1报告 |
| RB23 | NOT_RUN | 真实封存后Gateway入站/重复事件/旧source及Group后继组合未做，邻近suite fixture不升级签收 |
| RB24 | NOT_RUN | 兼容封存下跨workspace/owner同名、Profile alias及并行scope组合未做，原权限suite不替代 |
| RB25 | FAIL | 同DB/origin真实API/client代码切换机械正例通过；整行要求RB13–24全部有效，已被RB22 P1否定 |
| RB26 | PARTIAL | 兼容期间旧聊天/任务增量、文档修改与删除墓碑、选定原数据保持；所有对象全量初始对账/旧员工task删除未全做 |
| RB27 | PARTIAL | 实际恢复原Profile/HOME/mainchat/session/memory/result、重复restore和C初始ID重试核验；丢回执/重启及checkpoint/native claim完整对账未全做 |
| RB28 | PARTIAL | 旧run数量/队列空、显式新chat续session、第二循环零calls；多retry/历史tick/Gateway pending/native claims现场未全做 |
| RB29 | PARTIAL | 最终A marker在、B无A marker、真实Creator/legacy续用、全局来源3文件/installed6685文件哈希不变；所有旧HOME完整起止快照及全部原生资源表未全做 |
| RB30 | PARTIAL | 第二prepare/drain/seal/restore、forced-exit诊断与最终精确自有进程/端口清理通过；第二循环未再换代码，首轮observer未知退出仍保留，不补造exit |

## 同批UI、保护及诊断

实际frontend zip在各阶段由私有代理读取，仅UI登录/查询和导航。V2升级前走查desktop/390及刷新；兼容V1 desktop/390显示封存banner、A/B已暂停，旧Creator/default可用；恢复V2工作台A/B仍暂停，打开原主会话URL保留A原会话ID和历史marker回复，composer禁用且提示“Bot 尚未启用”，Routine paused。390与1280主聊天无body水平溢出。UI JSON的paused字段只匹配字面“已暂停”，在主聊天为false；不能将它误读成control_state已激活，禁用composer/提示及工作台快照才是对应证据。恢复UI refresh与所有普通V1页面没有全部走查。

QA代理原版本切API时发生ERR_HTTP_HEADERS_SENT并exit1，产品API/client正常；仅修复私有代理catch/清理逻辑并保留失败。替代UI observer退出同样独立记录code1（Windows外部终止自有UI），不宣称所有工具命令exit0。首轮测试控制器中断无原exit记录，续跑observer的previous_unclean_exit与旧日志保留；最终按记录PID、commandline及QA路径核自有进程不存在，6397–6400无监听。

项目诊断绝对路径为QA树 `.local/q01-preservation/diagnostics`：分实例追加启动/PID、10秒observer心跳与HTTP健康、异常stdout/stderr、退出码/信号；已用隔离forced-exit验证独立退出记录。5MiB/5代轮转实现只读核实，阈值压力验收NOT_RUN。登记备注如实保留unknown与exit1状态。最终独立重算安装Hermes **6685** 个tracked code文件及全局来源config/.env/auth **3** 文件，全部与先前QA基线相同。当前5283/4283预览、正式库/服务/手机/auth/域名/代理未操作；没有formal上线层验收。

原始私有主回执：`.local/q01-preservation/runs/1791896780966/resume-receipt.json`；重试回执与实际故障input在该run的 `native-retry-receipt-private.json` / `retry-published-result-private.json`。可提交摘要为本目录 `2026-10-13-q01-preservation-evidence/independent-preservation-summary.json`，P1证据为 `p1-profile-window.json`；请勿上传原库、HOME、auth、完整receipt或.local。

**正式上线结论：NO。** 此8556冻结候选存在独立P1，RB矩阵尚未全签收。E02负责修复，Q01等待新稳定产物后重验受影响窗口；Group、Gateway、并发/故障/跨scope等余项按表保留。正式发布仍需另获切换范围授权并执行真实版本/排空/备份核对；本地往返通过不表示正式服务已经切换。
