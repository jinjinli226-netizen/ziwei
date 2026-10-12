# 2026-10-12 Creator 无活动超时：证据、修复边界与验收记录

状态（2026-10-12 18:20 北京时间）：修复源码 `324731e79c6a855fad1f501379630bbfa67e5d34` 已推送 GitHub，最终整仓 **709/709**、lint **79** 个源文件、前端构建 **1764** 模块通过。36 文件 Windows 包与官方升级入口已发布并独立公网回读核验。本机18:19:57实际升级 complete，新 PID12132、ready=true、原 bigtron 连接和配置保持，36文件与发布build一致。真实模型原 harness 最后一项误判的失败回执保留，独立核验确认执行成功；正式员工手机绑定和原业务工作未因本次修复自动完成。

## 最终修复与客户端发布

原生 CLI 默认120秒静默只发送一次准确的等待事件，不伪造进度；执行默认最多15分钟，另受已确认 ACK 剩余期限减60秒约束。等待事件按现有服务端规则续租，也不能延长固定的本地截止时间。stdout/stderr真实收包均计入活动，显式idle限制仍有效。

Windows CLI先挂起创建、加入独立Job后才允许运行。超时/取消等待执行清理、根退出及所属Job活动进程归零；缺少可靠证据返回 `EXECUTION_UNCERTAIN`，持久保留去重、跨工作区隔离和维护占用。已有结果可独立补传，不再次执行业务。正常CLI退出允许用户启动的后台服务保留，并如实记录剩余进程。官方bootstrap现接受YES/yes及前后空白，其他输入正常取消；身份检查和明确同意要求保持。

| 发布项 | 已验证值 |
| --- | --- |
| 源码 | `324731e79c6a855fad1f501379630bbfa67e5d34`，GitHub HEAD已核对 |
| 时间 | 2026-10-12 17:54:48.57251 +08:00 |
| 包大小/文件数 | 134338 bytes / 36 files |
| 包SHA256 | `1592d107fcbcf27b9ec5e0d909f871ffa3851d9e136e015713156144d70fc8cc` |
| Windows安装build | `7e2ae40a8e9cb12ad8592514db263b6952f27bd0eae6fe01d3b84fe8cd3d1950` |
| 归档sourceBuild | `7e96fc4aab132a941e460d2be0ef108a5536b825312371b6326cd43cd74757ce` |
| 升级入口SHA256/大小 | `579fdeac68b92e24a62069c173af193f5b45bbb0ef220206004d7888ffa99b8a` / 5986 bytes |
| 发布操作 | `c63a4f7d0eaa41f4a79e9db41ab3e4af` |
| 原三文件备份 | `/opt/ziwei-backups/client-legacy-maintenance/c63a4f7d0eaa41f4a79e9db41ab3e4af` |

只替换 `ziwei-latest.tgz`、`update-windows.ps1`、`release.json`，metadata最后发布。独立verify核对三项公网字节，以及主API PID181593、控制PID134533、Nginx PID737、主站目录、前端和Nginx hash保持；无服务重启、无DB写入。主API仍为a66df9c、控制仍为8a4fe59，前端保持员工默认目录发布层。

包来自精确Git commit archive，逐文件核对源码/tgz/Windows npm安装，只有npm对CLI shebang首行的换行归一。新ps1已进入build hash；打包安装后实际启动supervisor并核验精确输出、exit0和Job为空。真实模型快照与最后两项失败分支修正的差异在下文单独记录，不冒称全部最终字节都由该模型轮次覆盖。

私有manifest：`.local/creator-idle-timeout-20261012/build-0d374b6313c14240b8afc4cd9ac19f50/publication-manifest.json`，SHA `3292629c6dc6b56096e427f1a16eebc2c8a5ba0742f3aab7bf3f941ddfac9c1a`。完整709项测试与最终打包smoke覆盖最终提交。Job继承及退出语义参考 [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)，不声称监管经外部WMI服务另外启动的进程。

## 本机实际升级与验收脚本修正

本机使用原生命名空间执行维护，原安装路径为 `D:\work\nodejs\node_global\node_modules\ziwei`。工具进程读取同名 AppData 路径可能得到另一份历史配置，因此执行前用真实进程身份、PEB路径环境及配置SHA核对原 PID36264，不能直接用工具环境中的历史配置替换原连接。

首次维护 `update-4db4800f-afb2-44ca-a39b-0c5b6edab210` 于10:10:19.709 UTC明确 failed/EPERM，原安装和PID未变。该失败没有进入 `performClientUpdate`：worker写第一次running回执时就失败，标签仍停留validate_installation；独立原生调用两项安装检查均通过。隔离文件复现证明，验收Python脚本持有结果文件读取句柄时，Node替换该文件会报EPERM；无读取句柄的控制组成功。显式共享删除句柄在该机仍失败，因此没有采用未经验证的共享标记修补。原失败结果及日志原样保留。

修正仅涉及私有验收脚本：提交后不打开维护结果文件，持有精确worker的查询/同步句柄，确认worker退出后才读取终态。正常退出与有界未知两项真实隔离进程验证通过。确认旧worker6472已退出、维护锁释放、原配置/安装/进程保持后，另立一次性intent；没有重放结果未知的请求，没有更改已发布产品源码。

随后任务 `update-ff05ecbc-f09c-436b-ba1a-34d3b66dfe9e` 于 **2026-10-12T10:19:57.408Z** complete，worker52396退出码0。旧build c7b83…变为发布表中的7e2ae40a…；原运行状态恢复，实际新PID **12132**、创建时间10:19:53.290877Z，ready=true、connected、activeActionCount=0、pollingCount=0。

本机验收逐文件匹配36项安装清单；原设备 `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`、bigtron主连接、配置SHA `7913bf1c1b490ecf9b6d6760787973c28f8c484703c144eb0028b57ef8166b72`、入口、凭据与Codex auth/config均保持。43个封存会话与action-state共44文件的既有前缀保持，允许正常会话追加。原PEB采集的路径/HOME变量保持，只有updater按既有设计新增同一原配置路径的显式ZIWEI_CONFIG；HOME/CODEX_HOME仍缺省。无独立start/repair调用、无业务重放。

原安装备份保留在 `D:\work\nodejs\node_global\node_modules\.ziwei-backup-524d4c4c-9e3f-49fe-ad8d-bfb2ddfd1e24`。本机最终私有回执为 `.local/creator-idle-timeout-20261012/native-upgrade-preflight/upgrade-a208cded338841d8908be5d2843de7ef/operation-result.private.json`，passed=true、complete_and_verified。

旧观察器39608随旧客户端退出，cleanExit=true。沿原日志与轮转方案挂接一次新观察器 **36400 → daemon12132**，精确创建时间、配置和build匹配，两个有效健康心跳通过。日志仍为 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\logs\client-exit-watch.jsonl`，10秒采样、5MiB×5轮转；旧源文件与日志保留。观察器只查询进程，不控制业务；绑定当前实例，未来重启仍需重新挂接。附加核验的runtime目录下Creator homes前后均为0，仅此范围可作前后比较；Hermes配置补充哈希标为升级后观察，未冒充升级前完整HOME证据。

## 旧默认目录 QA 的精确收尾

旧QA run `d7b9a08c-5314-42ad-90a1-70c81c702a0f` 原归属集合178条不变。两名QA员工此前由user删除，七条会话仅因已核实的FK规则将employee_id置null，因此本次范围为剩余176条。新增的三条删除审计、三条通知及正式员工已删除状态都保留；不得按当前关联重新扩大QA集合。

原三次完整双库备份共6个文件SHA核对通过，176条当前原始行另有逐行hash匹配的私有备份。正常删除和两个负例的离线SQLite验证均通过：正常恰删176，保留全部其它字段；新增非QA主键或改变QA目标行hash均拒绝且不提交。

唯一提交 `9e1846c3-35f3-4e71-a985-c0f03ded079c` 在2026-10-12T10:24:25.420Z明确committed=true，删除176条。BEGIN IMMEDIATE内，main40表原4117条变为3941条，逐行证明严格等于事务开始状态减去176；control45表54条完整指纹前后相同，FK检查通过。事务前22条非QA自然变化原样保留，没有用旧基线覆盖；没有整库恢复或服务重启。

提交后独立只读现库核验PASS：原178个QA主键全部不存在，3941条主库与54条控制库记录的完整主键/稳定字段保持，正常动态字段仅按已审核源码和真实观测时间窗口验证；三名员工保持用户删除状态，三条审计与三条通知保留，正式action/doc、发布文件、前端、服务PID和持久链接保护通过。独立证据SHA `21dca4aadd3420fc668003c72ca86ff261c5e4a03030eaab821fd94a0a180bf6`，原commit SHA `6e22e0599636b1ec580117e1a7a1ceb48aca911a39f04ec289bceba9fecf0512`，transaction proof SHA `9f6815457617032460770af9363a7cba6d16fb3a18060ebd33690bf0eacd0ef9`。

核实7个保留正式session均未过期且不会在验证窗口到期后，5个存档QA cookie逐个实际返回401。随后仅按原manifest删除6个精确空目录：4个已知直接子目录、QA根目录以及由本次QA创建且已空的 `D:\digital`，全部使用非递归删除；没有扩大到用户文件、HOME、浏览器profile或原共享认证/缓存。原始证据与备份保留，早先其他轮次被阻挡的浏览器profile清理不在本次范围。

计划canonical SHA `07ddbcb5d9e05c83e3ca06ab3317e9c478bdb626b8f27ebfeb308f9d57699414`，176条备份SHA `dee76a3b7dd1bc15dde88ac38b18d5a63b9110cb2a737d3119874e59b1dacf42`。完整私有清理回执位于旧QA目录的 `resume-readonly-20261012/`，不提交数据库、凭据或原始行。

## 实际事故及已经发生的写入

工作区为 `bigtron`（`ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e`），会话为 `conv_4aa75f39-2b55-4a9e-8519-5449000ac05e`，动作是 `action_44707bbd-5e33-4c64-9b91-4a8650318283`，目标电脑是 `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`。

执行者是原 Creator `employee_d64dd3bd-3a17-4568-bb8b-5c5a8ade3c26`；本轮新创建的 `employee_c6357e54-52c5-4dae-b741-d97ecaa0a926` 是产物，不是执行者。触发消息 `convmsg_9c21b074-407c-4a7d-9040-b9f9f5596bad` 要求搭建闲鱼员工，并明确暂不做定时任务。

| UTC 时间 | 已核实事件 |
| --- | --- |
| 07:08:43.638 | 服务端创建 conversation.execute 动作。 |
| 07:08:48.046 | 服务端记录接收确认。 |
| 07:08:49.312 | 正式本机 daemon 记录开始执行。 |
| 07:12:12.513 | 文档 `doc_50c2da31-b3c1-4ad8-b859-5d6dc60c2a9d` 及版本 1 写入。 |
| 07:13:29.282 | “闲鱼1·项目运营专员”写入并生成员工创建幂等回执。 |
| 07:13:50.434 | 服务端工具阶段记录 ziwei_get_employee 已完成。 |
| 07:13:51.426 | 本机管理审计记录最后一个 ziwei_read_document 成功。 |
| 07:13:51.432 | 本机最后进度；服务端相应进度记录为 .642，累计 3871 B。 |
| 07:15:51.863 | 本机持久失败结果完成，比最后进度晚 120431 ms。 |
| 07:15:52.893 | 本机收到失败结果投递确认。 |

服务端终态记录为 07:15:51.644，错误是 `A2A action timed out after no activity for 120000ms`。服务器接收时间、本机事件时间与结果时间不是同一时钟，不通过混减推断具体超时精度。本机自身时间差与 120000 ms watchdog 一致。

服务端保存 69 条原始事件和 8 条会话消息。截图里的 62 阶段与原始事件总数并非同一计数；具体 UI 筛选差异尚未核实。

事故结束时已经保存的产物（后续删除审计见下段）：

- 员工“闲鱼1·项目运营专员”，ID `employee_c6357e54-52c5-4dae-b741-d97ecaa0a926`，active，Codex/default，目标电脑如上，management MCP enabled；model 和默认工作目录均为 null。
- 文档“闲鱼1·项目运营岗位手册与报告模板”，ID `doc_50c2da31-b3c1-4ad8-b859-5d6dc60c2a9d`，6350 bytes，版本 1，校验和 `6844ac5084cfde45780438a7719b9a395b86d668fe54ea54bd7e72ba24778b54`。
- 员工挂载既有技能 `skill_90f8a9b3-8d84-4ab2-8e54-9112b56ed62a`；本轮没有新建或更新技能。

截至 09:16:19 UTC，原 action 没有迟到事件或成功结果，原会话没有新消息或新动作，员工/文档没有后续修改审计，bigtron 在该终态后没有新建 A2A 动作。新员工没有手机 MCP 配置、手机绑定、手机执行记录、执行 action 或按精确 ID/名称分配的任务。`ziwei_phone_mcp_setup` 是只读发现接口，不能据它推断手机绑定完成。

后续只读核验发现，09:31:55.300 UTC 的 `employee.deleted` 审计已将员工 `employee_c6357e54-52c5-4dae-b741-d97ecaa0a926` 删除；其 actor 标为 `user`，不能据此归因具体人或终端。同一时段还有两名旧 QA 员工被删除。当前清理必须保留这三次删除状态、对应审计和通知，不重建员工。岗位手册、原 action 与其余 231 条此前新增正式记录仍与原指纹一致。

不得重发原创建请求，不得通过删除文档或重建员工来“重试”。后续业务若需继续，应重新核实当前员工状态与未完成配置，不能沿用事故结束时“员工仍存在”的快照。

## 正式客户端与未知项

本机只读证据把该动作绑定到原生 daemon PID 36264、build `c7b83a41d997ace8b9aa5d07e6acf5ebcc189fad4f9f41d2f6ed0c436242fab5`。安装的 runtime adapter SHA 为 `6973f39274ff3fb4597e515fc13246077c0c94c99256ee087b5a9d1fe4b96f81`，daemon SHA 为 `f975f9df67e16063aa9255107569c7f572527dd5eff212c12706b28ce05f6e5d`。

请求选择 Codex，profile/model=null，cwd=`C:\Users\25941`。安装源码使用 `--ephemeral`，没有对应持久 Codex session 并不证明根本未启动。实际继承的 provider/model 没有保存在失败回执中，值为 **unknown**。

可以确认：管理审计共有 10 次成功调用；最后一次回读成功之后，约 120 秒没有向 watchdog 报告活动。不能确认：这段静默属于正常模型思考、provider/网络等待还是运行时挂起；目前均为 **unknown**。

旧实现取消只调用直接子进程 `kill('SIGTERM')`；dispatcher 的 `Promise.race` 会在超时分支先返回，未等待执行 promise 及整个进程树确认退出。事故回执没有 root PID、退出码或进程树收敛证明。Windows Security 在有界时间窗口没有可匹配的 4688/4689 记录，Sysmon 日志不存在；事后进程快照不能证明超时瞬间是否遗留后代。事故实际进程树退出状态为 **unknown**，不能把隔离复现等同于事故历史事实。

## 旧实现真实 Windows 隔离复现

本轮 fixture 使用本地假 Codex CLI，不发网络请求、不运行正式模型、不访问正式凭据、员工或手机。Node v24.13.0，win32，700 ms idle / 1500 ms 合法静默工作用于缩短观察；生产默认是 120000 ms，不把 fixture 时间说成生产阈值。

| fixture | 实际旧行为 |
| --- | --- |
| quiet | 约 929 ms 失败；dispatcher 返回时 execution promise 尚未 settle。 |
| stderr-partial | 已写 9 个 stderr chunk，仍约 908 ms 超时。 |
| stderr-json | 已写 8 个完整 stderr JSON 行，仍超时。 |
| stdout-partial | 17 个 stdout chunk 刷新活动，1500 ms 工作成功。 |
| tree | 超时返回时 execution 尚未 settle；普通后代在之后的采样已退出。 |
| tree-detached | 超时返回后 detached 后代仍活着，tick 从 15 增至 20；随后按 fixture 自己的截止时间退出。 |

这证实两个可修复缺陷：stderr 活动和 stdout 活动处理不一致；终态返回与完整执行树退出之间缺少可靠边界。quiet 超时只证明旧策略，不证明原事故确实在正常思考。

原复现证据保留在 `.local/creator-idle-timeout-20261012/repro/run-67w3Rq/result.json`。第一次未完成的复现目录保留，不覆盖成通过结果。

## 新实现验收条件与实际结果

本轮按以下条件准备及核验，实际结果和未覆盖范围见本节后半部分：

1. 确定冻结候选源码及 SHA，核对 runtime-process.mjs / runtime-process.ps1 确实进入发布包和 clientBuildIdentity。
2. 使用现有纯本地 runtime fixtures 检验完整/不完整 stdout/stderr 活动、无输出、取消、硬截止、普通/脱离后代、快速退出与退出回执。超时或取消的终态必须区分确认退出和无法确认；不得把仅发出 kill 当作确认。
3. 用独立 Windows HOME、Codex config/auth 副本、工作目录及独立 action-state 运行一次真实已安装 Codex。只读取现有用户 provider/auth 后建立最小隔离配置，不回显凭据；不复制 MCP、插件、skills 或历史会话配置。所有 MCP 禁用，不注入管理或手机 MCP；仅要求输出本轮随机 nonce，不执行工具。
4. 真实模型必须经冻结的新 ActionDispatcher → executeRuntime → supervisor 路径，结果 succeeded、退出码 0、输出精确 nonce、无工具阶段；记录具体 CLI、模型、隔离 cwd、root/退出/树收敛回执。若缺少回执则不能给完整监督验收 PASS。
5. 运行前后核对原用户 Codex config/auth SHA 不变。隔离认证副本仅在确认自有进程收敛后清除；失败或结果未知时先诊断，不重复模型调用，不触碰正式 PID36264。

最终冻结提交的整仓回归 **709/709** 通过，0 fail/cancelled/skipped/todo，耗时 59.39 秒；lint 检查 79 个源文件，前端构建 1764 个模块通过。Windows supervisor 与 adapter 专项 **13/13**、delivery 与 dispatcher supervision **43/43** 通过，覆盖真实 I/O、根退出、取消 detached 后代、启动失败、host crash 时不伪造退出证明、正常完成保留后台服务及隔离状态下只补传已有结果。

真实隔离模型 run 为 `c22b3670-f208-4772-9aba-68c5d96d284d`。开始于 09:46:58.386 UTC，09:47:28.094 收到精确 nonce，09:47:37.516 完成执行及监督回执；实际 Codex CLI 0.159.2，provider=openai，显式 model=gpt-6.1-sol。通过冻结快照的 ActionDispatcher → executeRuntime → Windows Job supervisor，status=succeeded、exit=0，root PID53384、rootConfirmed=true、treeConfirmed=true、activeProcesses=0、streamsComplete=true；终态时 execution promise 已 settle。原用户 config/auth 前后 SHA 相同，仅该隔离 run 的认证和配置副本在确认树为空后清除。

原 harness 把一条 `action.output(stage=command)` 当成了真正工具阶段，导致最后断言失败，原 worker/native report 的 `passed=false` 及 worker exit 1 均保留。该输出标签由现有 `classifyOutputStage` 对普通文本猜测得到：它与启动 stderr 623 bytes 同时，且早于全部 stdout 数据。记录没有任何结构化 `action.stage` 事件；独立核验据此将执行验收记为 PASS，同时明确原 harness FAIL，不改写原回执、不再请求模型。原始诊断全文没有存入报告，隔离 CLI logs 表为空，因此诊断具体文字为 unknown。

MCP 无模型配置预检查 exit=0，仅一个有效但 disabled 的 ziwei-terminal transport，enabledServers=0；没有配置插件或复制用户 skills，没有观察到结构化工具调用。CLI 自己在隔离 HOME 自动生成了内置 system skills 和 app metadata cache，不能声称操作系统层阻断了所有 CLI 内部网络/文件访问。前三个准备 run 分别因 shim 路径断言和两次本地 MCP transport 配置解析失败停止；它们没有模型回答，不冒充成功或删除失败记录。

真实模型的 manifest SHA 为 `c31a4decba0d89aef788f981dce9c0a142b5876d9bc87894522e234d716a7bd0`；独立核验记录 SHA 为 `4bfad0d7a81bb6b409dece066ba78b66868741e07ee6c12492687441f8ec7a50`。最终提交的 `src/daemon-action-delivery.mjs`、`src/runtime-process.mjs` 比该快照分别增加未知状态字段上传保护、操作系统确定未创建 host 时的启动失败分类，其他 82 个采样文件一致。本次真实 nonce 不冒充对这两文件后续字节的验证；后续改动由上述专项、最终709项回归及精确打包安装后的 supervisor smoke 覆盖。

兼容边界：超时/取消必须停止该次执行所属进程树并确认结果；正常 CLI 主动完成时，可能已按用户要求启动后台开发服务，不能一概杀掉所有后代。正常完成记录 root 退出和实际 remaining/active 后代数，不能将正常保留后台服务伪报为“整棵树已退出”。本轮 nonce 不要求任何后台服务，因此只有其实际树为空才给本轮完整 PASS。

这次真实模型验收不创建网页 QA 账号、员工、会话或正式任务，不通过正式 daemon 派发，不操作手机、不访问正式管理 API。之前默认工作目录 QA 的真实 nonce 成功只作为环境经验，不能替代此次新候选验证。

## 构建身份注意事项

`src/management-bootstrap.mjs` 的 `clientBuildIdentity` 递归扫描 daemon/src，原扩展名筛选仅为 `.mjs|.py`。本次已将 `.ps1` 加入筛选，避免 package.json 包含整个 src、构建 hash 却漏掉新 `src/runtime-process.ps1` 的情况。修改该脚本字节影响 build 的回归通过；最终源码、36文件包及 Windows npm 安装已逐文件核对，npm bin 首行换行归一与两种 build 均按发布表记录。

## 同期 Windows 升级入口兼容记录

协调侧转述的用户 ThinkPad 终端回执表明：旧 PID43812，维护 job `update-20ca1135-cb74-49ab-8de7-8c61e5647664`，用户在官方入口输入 YES 后收到 complete，Actual build 为 `54a0530deb0d0a0a6936a64abc77793fa7f1e72d91bb416204656687e6bf0ee7`，回执称保留原 prefix、main/shared 连接、身份及用户数据。这是**用户提供的另一台机器回执**，不是本机执行的复核。

ThinkPad 当前在线状态仍为 **unknown / 待用户 ziwei_user.cmd status**。PowerShell 执行策略阻止 `.ps1` 不能等同于安装升级失败，不重做已 complete 的升级。同期 bootstrap 对明确 YES 增加空白修剪及大小写兼容；其他回答作为正常取消 return，不进入升级。入口回归 2/2 通过，已随17:54官方三资源发布，公网回读 SHA 与发布表一致。

## 私有证据与审计边界

- remote：strict known-host SSH、SQLite mode=ro/query_only、有界精确行查询；5 份证据及 source hash 清单。manifest SHA `0008f7ba4e66c276cd95fa92be423dcf6ab95d5b2236618760bf38582ec151e6`。
- local：原生 Windows namespace 验证、本机动作时间线、管理回执元数据、安装源码/进程审计可用性；无凭据输出。
- repro：纯本地合成运行时，保留旧实现 source SHA 和实际测量。
- acceptance：84 文件封存快照、三次本地准备失败、一次真实模型执行原始失败 harness 回执及独立执行 PASS 核验；没有重放已执行的模型请求。

所有完整私有证据位于 `.local/creator-idle-timeout-20261012/`，不提交 GitHub。本文不包含认证值或完整用户消息。源码修复、最终测试、发布或官方客户端更换后必须补入实际结果，不能仅因文档存在将任务标为完成。
