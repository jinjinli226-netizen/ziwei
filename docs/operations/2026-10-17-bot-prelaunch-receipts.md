# Bot 启动前拒绝与迟到回执

日期：2026-10-17，Asia/Shanghai。

## 现场与根因

用户的私人秘书“知微”被要求核实原执行，但没有可用确认操作。只读核对为
`employee_5f157a51-a8fa-483c-90df-53d44292b5d2`，原动作为
`action_2805b4da-c082-49a2-b0f1-b43bdeb107fe`。动作使用r3/e5，员工当前
r3/e8且暂停；配置验证与独立Profile创建均已成功。18:44心跳确认李金晋电脑
已运行官方客户端build `7b4939c2…`，不是继续使用15分钟版本的问题。

18:37:29原动作的 `bot-start` 请求返回409。此时 `executeRuntime` 尚未调用
模型的 `spawnSupervisedRuntime`，但拒绝Error只有普通 `definitelyNotStarted`
属性；dispatcher仅认可内部密封的启动前证明，因而误归类为
`EXECUTION_UNCERTAIN / EXECUTOR_WITHOUT_EXIT_EVIDENCE`。原结果没有退出证明，
active槽未释放；之后停止请求也没有找到原控制器或可信完成结果。

现有核实接口只能使用服务器保存的可信终态事件；这条旧记录不具备该事件。
线上日志只见一次409、未见成功启动授权，可印证启动前被拒绝，但服务器未保存
逐次授权决定，不能把缺日志、设备在线或新版心跳伪造成历史退出证明。

## 修复范围

- 本机已配对的 `bot-start` 调用仅对明确HTTP4xx、白名单拒绝code创建内部
  WeakMap标记；最终spawn前的受信边界才将其转换为一次性未启动证明。包含
  原action、工作区、员工、电脑、Profile、revision和control epoch，不接受
  服务端直接提供的processExit或用户/执行器自填flag。
- 普通模型聊天、原生操作、Profile创建和driver覆盖同一边界。已有辅助进程或
  runtime group仍以实际注册的完整树证明为准，不被后续拒绝抹成全程未启动。
  伪造字段、任意Error、网络/JSON/5xx错误不被本次窄规则认定为明确授权拒绝。
- 正常新任务由已认证设备回传failed/未启动结果，现有服务端结算能释放原active槽，
  保留用户的暂停状态。没有更改恢复接口、数据库或历史核实门槛。
- 网页对未确认回执继续只读轮询，降低等待阶段频率；收到晚到的明确终态后停止。
  离开会话或切换作用域取消旧轮询，旧响应不能关闭新会话的计时器；不自动重发任务。

## 验证与边界

此前主控141项相关回归全部通过，包含新27项启动拒绝、旧启动失败/driver/停止恢复、
24小时执行预算、手机授权、MCP连接/native与前端状态/轮询。lint179与前端构建通过。
前端原测试的隔离HTTP改为内存HTTP请求，不再启动随机监听端口。首次真实浏览器
检查发现直接打开未确认聊天仍只按busy启动轮询，已补齐该入口，并增加真实open
函数的未确认/已确认失败两项回归。浏览器Back回到原会话还发现同id路由未重读
detail，已复用现有open刷新链路，保留草稿和作用域校验；前端相关29项均通过
后重新构建。

另有一项未修改的runtime-group假树测试在Mac上失败，已用未修改的a80322d
git archive隔离基线复现同样结果（4过1失败），不属于本补丁，也未为此做Mac适配。

本记录首次提交时修复尚未发布。真实浏览器迟到回执验收、安装包和网页发布结果
需在完成后追加。临时浏览器验收使用端口中心登记291 / 127.0.0.1:9203。

真实Chromium验收5项通过：关闭WS/SSE后直接打开未确认聊天仍继续GET，离开
停止，Back返回同一聊天恢复GET，晚到的已保存原终态通过GET显示“原执行已停止”，
终态后6.8秒不再读取detail。执行动作仍只有1条，无业务重派POST，console/pageerror
均为0，桌面与390px截图已检查。此处晚到回执为隔离memory仓库显式注入固定设备
terminal event后调用真实reconcile，不是对生产旧记录的修复，也没有证明设备向
已terminal动作补写普通事件的通路（该入口会拒绝普通补写）。右侧独立工作面板的
旧摘要仍需点“刷新实际记录”，本轮没有改变其缓存。

一次142项并行复跑有1项在Mac隔离CLI的3秒版本探测阶段超时，未进入bot-start
断言；此前同组141项已完整通过。保留原失败日志，不放宽产品超时；随后最终
`--test-concurrency=1`完整142项全部通过，0失败、0跳过，19.9秒。
临时服务PID68601已停止，端口291已release，9203无监听；端口中心check通过，
无冲突或未登记监听。

**知微这条历史记录尚未解除。** 未修改员工、原动作、Profile/HOME或控制状态，
未伪造退出证明、重试模型或停止其他工作。已向用户索取一次本机原始started/
completed证明的只读输出，由程序和维护人员判断；不能让用户凭空勾选“已核实”。
只读现场证据在 `.local/zhiwei-verification-diagnostic/`。

发布前先推GitHub。此轮仅需Windows客户端包和网页；API仍沿用已发布的9393dcb，
保留完整MCP、移动读取修复、现有数据库与中控。包发布不代表员工电脑已安装。
回退时仅恢复对应代码/下载元数据，不能恢复旧业务数据库或清空原员工凭据。

## 正式发布

产品提交 `4f26f450e6e1bcba6326fdaedd75937364eb5189`（包含前一候选383d4cb）
已实际推送 `codex/v2-20261014-release`，GitHub回读确认候选为远端HEAD后，
主控顺序执行客户端与前端发布。未发布的383d候选包/构建证明单独留档。

- Windows安装包于 **19:15:37（Asia/Shanghai）** 发布，build
  `6067d6462aeb7d7752430bf6c21145aec59d78d84aa2e491c191c217e6df15b5`，
  1,087,344字节，SHA256
  `0bf1a8159040f3d37d38ee8aaee31d474cb993c07d4c08c1d8929db1f9a7aa7e`。
  公开release.json SHA
  `453a187fa6f3c07090be5d8b38389d770e382d87185766350b2940dcd015e3fe`。
- 网页于 **19:16:58** 发布，主资源 `assets/index--E4XPmCF.js`，首页SHA
  `5bf67ca1f4eb9e9909d49c85f7168a8e3fd566023398058dacd06728723e2a22`。
  公网index、metadata、全部assets核验通过；保留旧chunks。
- API保持 `/opt/ziwei/releases/mobile-runs-projection-9393dcb0aab1-e0f199eb/v2`，
  PID366044，完整源树、MCP、旧发布记录、服务身份/配置、数据库文件身份与逻辑
  schema均通过发布器前后保护检查；未重启API/中控/Nginx，未恢复数据库。

本地发布记录在 `.local/zhiwei-prelaunch-repair/releases/`；服务器安装包备份
`/opt/ziwei-staging/backups/zhiwei-prelaunch-client-d5ed87ec4d884f72a73901109103549f`，
前端备份
`/opt/ziwei-staging/backups/frontend-zhiwei-prelaunch-4f26f450e6e1-20261017T111658Z-0779a80d`。
回退应核对当前发布版本，在发布锁内仅恢复旧下载包/release.json或网页index/meta；
旧版本包与hash assets保留，业务数据库不回退。未知执行结果时先读原stage记录，
不得重复运行execute。

**Windows安装、实际模型执行及知微原任务恢复尚未验收。** 本轮没有远程更新或
停止员工电脑，未在真实员工中重跑模型/手机/群组业务，未改历史不确定结果。

19:19:42独立只读复核完成，19项保护检查全部通过。公网包精确匹配4f26/6067、
75项包内容、43项runtime源码与固定commit的git archive、71项依赖manifest已验；
npm bin入口仅首行shebang规范化去除1个CR，逐字匹配manifest，未忽略整文件差异。
前端13项清单资源和根首页匹配，56个旧assets保留。API仍9393/PID366044，中控
PID361304、Nginx737及启动身份/配置，完整非frontend源/MCP、DB文件身份和逻辑
schema保持，内外health200。证据 `.local/zhiwei-prelaunch-repair/inspection-complete.json`。

同次复核知微仍为r3/e8暂停、active为原2805；原动作仍
`EXECUTION_UNCERTAIN / EXECUTOR_WITHOUT_EXIT_EVIDENCE`、processExit:null，只有
原2条事件，没有新可信终态。李金晋电脑19:19:34心跳online，但仍为旧build
`7b4939c2…` / PID21480，不能宣称已安装6067或历史任务已恢复。


## 用户回传的本机记录与恢复边界

用户随后执行了本页原动作的只读PowerShell诊断。输出匹配原action、workspace、
设备、员工和r3/e5绑定，含nativeRuntime:true，以及
`quarantine.reason=EXECUTOR_WITHOUT_EXIT_EVIDENCE`、`stopConfirmed:false`；
未打印选取的processExit/prelaunch字段。命令没有输出完整completed条目，因此
不能将“这些字段未返回”扩大为“completed条目绝对不存在”。该文本是人工转述，
不能作为同设备认证回执提交，也未据此修改服务器或本机记录。

nativeRuntime是任务类型标记，不证明原进程当前仍在运行；stopConfirmed:false
表示未确认停止，也不证明原进程仍存活。原任务尚未恢复。当前普通取消只控制
内存中的controller/supervision，重启不会重建历史Job与action的映射；正常回执
恢复只重投真实绑定的完整completed/processExit。a996 provision的窄历史恢复
策略不适用于7b4939的conversation.execute。4f26仅预防新任务同类误分类，
不能宣称安装后会自动修复这条旧记录。

独立审查确认：若需新增历史prelaunch恢复，必须由目标端读取并校验固定源码、
原始state及配对delivery证据，和服务端原始失败对应；现有恢复链还需明确支持
受限的未启动证明，不能只把launched:false塞入要求真实PID/完整树退出的旧接口。
未取得这种证明时，不能用“管理员已核实”、缺少PID、一次409、换Profile或
停止daemon来伪造原树退出。本轮未增加该恢复实现，也未解除原占用。

去敏回传与边界保存在
`.local/zhiwei-verification-diagnostic/user-state-output-20261017.json`。


## 知微历史 admission 隔离恢复实现（2026-10-17）

本次新增独立恢复机制，固定到原 action `action_2805b4da-c082-49a2-b0f1-b43bdeb107fe`、原设备、员工、Profile、失败事件及 `6666a63` 官方客户端的16份源文件。原 failed action/result/error/event 不改；恢复结果单独保存，不能解释成历史模型进程树已经退出。源审计能够确认的是正式 conversation runtime 的启动点未到达，授权前的探测及配置副作用仍可能存在。

官方 Windows 更新器先核对同一 daemon generation、真实安装与原始本地记录，持有原 Windows Process handle 停止准确实例，然后凭设备身份提交独立 admission proof。原 started、delivery 和原始 action/result 字节保存在 runtime/history-recovery 下；新完成记录不覆盖其他员工历史，不删除 Profile/HOME，不重派原消息。持久化日志支持备份、停止、提交及本地写回各阶段中断重试。恢复或升级失败后不重启会重新堵住日志的旧实例；重新运行官方更新入口即可继续。

客户端维护检查单独识别此类 admission 历史；普通 processExit、进程树退出证明及正式生产保全规则没有放宽。服务器首次恢复要求原 paused r3/e8 与精确 active；幂等取回仅返回原回执，不清除后来出现的新 active。页面从经过后端完整校验的独立投影展示“原模型未启动 · 已恢复”，保留原失败详情。

旧版服务器投递会重排 managementMcp 并规范化员工模板元数据，故签名 subject 额外绑定实际投递格式的 canonical digest；原 raw payload SHA 仍固定保留。本例实机只读确认无模板实例且无四项模板元数据。首次恢复仍保留用户的暂停状态，恢复后可从正常启用入口继续使用，不自动恢复原业务消息。

发布验收应分别记录：GitHub提交、API/前端/CLI发布、Windows实际更新、独立恢复事件和真实模型新消息。模拟测试与服务器发布不等同于知微现场已恢复；本 Mac 无法直接运行那台 Windows 的 held-handle 程序。


### 本次正式发布结果（北京时间 2026-10-17 22:12）

- 产品提交 `4bd14cb0772f6ddd47735be36bcd50f7a6fb50f9` 已先推 GitHub `codex/v2-20261014-release` 和 `codex/bot-historical-recovery`，再发布服务器。
- 当前 API/前端目录 `/opt/ziwei/releases/historical-admission-4bd14cb0772f-cfcb8384/v2`，API PID `374987`。前一目录 `/opt/ziwei/releases/mobile-runs-projection-9393dcb0aab1-e0f199eb/v2` 保留。
- API 从当时完整生产目录复制，只叠加10项本次来源与前端产物。生产 preservation 模块与 Git 源有既存差异，实际仅移植本次4行，不连带发布未请求的 background 恢复改动。DB inode/schema、data/.local/node_modules 归属、控制服务与 Nginx 保持；未恢复数据库。
- 官方 Windows 客户端 build `6c9345a699c977dcc69f396f2aee96e7ca96e38fc7c9f686b9b49217ae09c8d9`。包 SHA256 `408fbf7f501025b0c290393b96902d70ad4bbc0ed82b305955995c494ba15703`，1101693 bytes；公开 release.json SHA256 `8449e0eb343d403d5d639db37c8c15e0411b39f406a4bd9af0ff07317908dbba`。本地空缓存离线安装/工厂检查及服务器 Linux 独立离线复核通过，公开下载内容逐字节核对。
- 本次恢复相关最终53项测试通过，包含实际内存设备鉴权/数据库、客户端持久化中断恢复、dispatcher重启后新任务执行以及前端状态。更广145项回归中曾有既有模拟 CLI 版本探测超时，定向重跑通过；原始日志保留，没有把该次145项运行写成全绿。生产构建及静态检查通过。没有启动本机监听。
- 官方 bootstrap 一次更新会先运行精确历史恢复，再安装并启动新客户端。旧 `ziwei_user update` 自身不具备这套机制，不能用它代替新 bootstrap。Windows 原生句柄段、真实员工恢复与新模型对话，仍须以那台设备的实际执行回执验收；服务器发布本身没有提交历史恢复，没有改原 action 或主动重跑消息。

本轮私有发布证据位于实现工作树 `.local/historical-admission-release/`，服务器留存对应 staging、旧代码与旧客户端包。源码和公开记录已入 Git；真实设备是否完成更新、是否新增独立恢复事件及是否启用，应在后续验收中单独记录。

### 已更新后重新启动的历史 holder 分支

用户完成上一版官方更新并启动后，设备心跳确认已从7b4939更新到6c9345，但没有产生prepare/commit请求。上次更新在daemon已停止时完成（restoredRunning:false），原恢复逻辑只处理旧daemon仍运行的分支，因此旧任务仍被隔离；不能把“新版在线”认定为恢复成功。

本次补齐独立schema2分支：新版bootstrap在覆盖latest-update前保留上次成功更新指针，严格验证成功更新记录、原7b4939安装备份及当前6c9345完整固定来源。设备签名subject绑定真实当前holder PID，持有句柄只停止这个更新后holder。迁移证据只说明当前维护进程来源；原正式conversation启动点未到达仍由原始失败、原delivery/state及官方旧源码证明，不把当前holder退出冒充原daemon或模型进程树退出。旧schema1 policy摘要及时间规则保持不变。

本地写回同时验证完整迁移证据；历史原始记录、聊天、Profile/HOME及其他完成记录保留。新增设备鉴权的有限阶段诊断，供维护侧读取失败阶段，诊断不解除占用。首次恢复仍需要精确paused/active，幂等重取不清除后续任务。

相关121项测试通过，单独6项指针/本地完成测试通过；源码静态检查通过。无新增本机监听。Windows原生现场执行尚待新版官方bootstrap；旧6c9345普通update入口没有保留指针这一步，不能替代该入口。服务器和客户端发布结果、真实独立回执及恢复后新模型消息，需分别记录。

### 第二轮正式发布（北京时间 2026-10-17 22:44）

产品 `501bc263242fb1a96399a3b3447c8cc28a3e8acb` 先推送上述两条GitHub分支，随后发布。API/前端切换到 `/opt/ziwei/releases/historical-postupdate-501bc263242f-2110aa35/v2`，API PID377076；从完整上一版生产目录继承，只叠加上述5项API来源及前端产物，保留原preservation混合来源。DB文件身份/schema、其他服务及配置保持，未恢复数据库。

Windows下载build `c477b6bb9044ae181d97efaae9ee3188a985cc32805f5a8eedfe3df09660e341`，包1106183字节，SHA256 `9d2e311f4fa4560a84beffe8115a57ec40c58643a4502f0e66990bf13e3a1731`；release.json SHA256 `c44f05496dd09d2197c1f979d3077d16f36e1c484aa1f3b96d3017750e4327fa`。本地及服务器空缓存离线安装/工厂检查、公网包内容核对通过。前端生产构建成功，源码干净；独立发布前审查核对了5项原字节、归一化Git基线与候选hash，无阻断问题。发布证据在 `.local/historical-postupdate-release/`。

本轮发布本身没有操作Windows、提交恢复或启用员工。用户上一版更新和启动已由在线6c9345/PID34292心跳证实，但历史恢复仍未完成；已给出一次新版官方bootstrap入口，等待设备真实prepare/commit及独立回执。不得把构建、模拟测试、心跳在线或服务器发布写成现场恢复成功。

### 明确授权的强制放弃恢复

用户第二次更新后，设备已实际安装c477b6/PID27868并在线，但前一次post_update_holder诊断在inspecting阶段因EVIDENCE_MISMATCH拒绝，prepare/commit均为0。不能据此猜测具体哪项本机迁移字段不同，也不能把新版在线写成恢复成功。用户随后明确提出强行停止，修复改为独立的人工强制放弃流程，不再靠扩大旧prelaunch迁移策略解决。

此流程只处理知微固定的原2805任务：现有登录网页的真实owner/admin、员工可见范围及精确r3/e8暂停/active绑定生成授权。设备凭自身身份读取授权并签定当前c477维护daemon的PID、出生时间、nonce、安装根及原记录摘要；维护helper持准确进程句柄暂停、排空polling并停止当前daemon。原模型进程树是否退出仍未知，不生成假processExit、不改成not_started或成功。

服务器新增独立operator_force_abandon回执，原action/result/error/failed-event字节保持；首次CAS解除该active并递增control_epoch到9，保持暂停，不派发旧消息。设备在取得有效回执后，仅将这条started/quarantine及配对delivery原字节移入持久归档，其余历史、聊天、Profile/HOME保留；中断后按WAL前向续办。网页显示“已强制放弃，原执行结果仍未知”，不再把这条已放弃记录当作当前占用或要求人工核实。

当前c477没有可由服务器反向调用的维护控制通道，普通file.read等新任务也被quarantine拦住。维护helper必须在Windows实际运行一次；新候选保留旧updater已经使用的prelaunch导出入口，先检查独立放弃授权，无授权时沿用原恢复逻辑。安装/发布/授权本身都不等同于设备归档完成，须独立回执、重新上线及一条不重放的真实新模型消息分别验收。

### 强制放弃版本发布与授权结果

产品 `702c5ba326d57c0129e822a53ea2c7cef064e412` 已先推GitHub两条既有分支，再发布。最终冻结源码166项相关测试全部通过，静态检查191项通过，Vue编译与生产构建成功；独立审查核对4项API来源、完整48项客户端源码与真实归档字节。杀前授权不足30秒会拒绝并恢复接收；Windows在持有句柄的最终Kill前再核期限和等待余量，退出时间取同一Process.ExitTime，迟交不接受晚停。

API/前端于UTC `2026-10-17T15:50:00Z`切换到 `/opt/ziwei/releases/operator-force-abandon-702c5ba326d5-2e3d2920/v2`，PID380630；上一501目录保留。精确4项API叠加，数据库文件身份/schema、MCP/继承源码/旧metadata、其他服务配置及身份保持，未恢复数据库。官方CLI于UTC15:51发布，build `957abd8caa3103757c1924c5f12af686f02a56a1c169c98ada0aa232ed1a18fa`，包1114675字节，SHA256 `39445ce54205b805d086efe74e343902192fc12fc70f346ad870cceabb546443`；release.json SHA256 `0857b0d2bb5da82b5ffcad1bef1d487b138687f9f59ecaab316e0b0fbcffe69c`。本地及Linux空缓存离线检查、公开包/13项前端资源核对通过。无本机新增监听，端口中心复查通过。

网页原生确认弹窗使自动浏览器目标挂起，未重复点击或伪造actor。随后使用用户已授权账号正常登录API，核实其确为原员工所属工作区owner，正常POST精确强制放弃意图，退出本次临时登录；没有提取浏览器cookie或修改认证上下文。授权 `action-event_force-grant_25b9b7ae-3f2d-45e6-a261-c46fb46ea138` 已保存，另一个正常网页目标已显示“已授权强制恢复”。密码/会话凭据不保存到发布记录。

UTC15:59:55只读复核仍为requested，grant1、receipt0，授权后prepare/commit均0；Windows仍为c477/PID27868在线，知微仍r3/e8暂停、active为原2805，原三项hash保持。已要求用户在该电脑运行一次普通 `ziwei_user update`（c477旧worker可通过新candidate薄包装进入独立force helper），无需用户查记录。此刻没有声称强停、归档、解除占用、启用或真实新模型消息验收已经完成。私有证据 `.local/operator-force-abandon-release/`；后续必须继续核实实际设备回执并用正常用户入口恢复Bot，再只发送一条不重放的无副作用验证消息。


### 维护锁遗留、假 running 与已停客户端恢复（2026-10-18 北京时间）

用户实际回传：旧 c477 updater 的 update-aa35b60a-8731-4ea9-bead-a406286fb986 在 UTC16:08:15 的 recover_history 步骤写入 update_failed / maintenance_failed，原安装未替换，结果文件却一直显示 running。后一次 update-7ba45935-3c50-4014-afd8-9e21101b5e26 在 UTC16:30:43 因遗留 operation.lock 报 MAINTENANCE_BUSY；用户同时报告 readyz 离线。以上是用户日志证据，不能等同于已原生核验该 worker 或 daemon 退出。

已复现旧更新器的诊断降级：旧501/c477错误白名单不认识新 helper 的 CLIENT_FORCE_ABANDON_REFUSED，会变成 RECOVER_HISTORY_FAILED；正式702冷包及旧更新器加载新 wrapper 的原生 ESM 导入在当前 Mac 成功，未据日志臆断漏包。新版传递有限恢复 phase/reason，并写 ASCII JSON，避免终端乱码掩盖 JSON。日志失败不再阻断终态落盘和自身维护锁释放，另有独立 terminal.json；状态查询结合 worker 实例及旧失败日志，不把已退出 worker 永久展示成 running。

新版官方 bootstrap 使用候选更新器核验并归档失效维护锁。核验仅指维护 worker：Windows 原生 PID、创建时间、命令行及原锁字节一致后，通过独占文件句柄归档；活 worker 或无法核验时不移锁、不杀进程。此操作不是原业务任务退出证明。更新状态查询绑定精确 job，不能被后来的 latest-update 指针覆盖。必须同时发布 scripts/update-windows.ps1 独立下载文件，不能只换 tgz。

另补独立 schema2 no_current_daemon 放弃路径：原 owner/admin 授权、设备凭据、原动作/失败字节、员工/Profile/r3e8 与 CAS 全保留。设备原生检查当前安装无 daemon、健康端口无任何监听且实际拒连，在 prepare 前、commit 前及本机归档前复核，并绑定配置/安装/state/source。该路径只观察当前客户端已不存在，不生成 currentDaemonExit，不把原执行未知变为已停止。旧 v1 策略摘要与真实退出规则不变。取得严格独立回执后才归档指定旧条目，其余记录、聊天、Profile/HOME保留；离线分支不伪造 wasRunning，也不借此自动重启原客户端。

本轮整合175项回归，168通过、7项Windows平台条件跳过、0失败；未运行与本次修改无关的本机HTTP下载测试，未启动本机监听。额外4项最终诊断/原生枚举边界用例通过；静态检查191项通过。Windows原生句柄段尚未现场执行，不能宣称真机恢复完成。新发布脚本基于当前702完整生产目录，仅叠加2个API来源及新前端；保留数据库、MCP、旧metadata、旧CLI工件与其他服务。

当前代码等待先推GitHub再正式发布；发布本身不会解除知微占用。后续必须收到目标设备独立回执、确认原slot解除，再通过正常用户控制恢复Bot，并只发送一条不重放旧任务的新连通性消息。私有证据位于 .local/operator-force-abandon-maintenance-release/；不在Git保存凭据或私有日志。


### 本轮维护恢复版已正式发布（北京时间 2026-10-18 00:54）

产品提交 f7c28ee5bc288aa8a9e6434043f22fe6390010e3 及包清单补充 874fcb142f35e78ca1d7d46e0ff92c01d0cee966 已先推GitHub两条既有分支。正式打包时检测出独立PS尚未列入package.files，已补上再重新生成冷包，未将失败候选发布。最终53项required客户端源码、2项API叠加及独立PS均由第二位审查者逐项比对Git归档、tgz、payload和manifest通过。

API/前端于UTC16:54:04切换到 /opt/ziwei/releases/maintenance-recovery-874fcb142f35-d8d2eebc/v2，API PID383266；上一702目录保持。只叠加backend/bot-force-abandon.mjs和src/bot-force-abandon-contract.mjs，数据库inode/schema、MCP与继承源码、旧release metadata、控制服务/Nginx身份及配置保持，未恢复DB、未提交业务恢复。13项公开前端资源逐字节核验通过。

官方Windows包于UTC16:54:35发布，实际build f888c61360fd9a1292a01e57526c6e8b753d14393379e950d8108a5a325310b6；tgz1126097字节，SHA256 eec3341adc85b66b36ebeecaae0b085797b192be5900abe84287543c75831033。独立update-windows.ps1共6390字节，SHA256 526882bbed69de976a546e4d1cff122d55ab838d5d3ab4bad621121dd7cdd9bd；与同包和Git归档字节一致，release.json摘要c98495eee9d9aecf0c1999126f7a36db8a1d8a6d2155207df27d1e955928e6b5。本地及服务器Linux空缓存离线检查通过；公开PS/tgz/metadata已回读确认。独立postcheck全部通过，无失败项。

此刻知微仍为授权requested、恢复回执0，不宣称设备已更新或已解除占用。已请用户在CMD调用一次新版官方PowerShell外部入口；它可装入新worker回收经证实失效的旧锁。旧c477普通update无法在自己加锁前装入这一修复，不能继续循环重试。明确看到Ziwei update complete后再启动客户端；之后仍需核实独立恢复回执和一次真实新模型消息。Windows原生测试仍待该设备执行。私有发布证据完整保存在 .local/operator-force-abandon-maintenance-release/；临时node_modules链接已移除，本机端口中心check通过（无本项目冲突或未登记监听）。


### 874现场终态与只读诊断（2026-10-18）

用户实际回传新外部bootstrap job update-7587a999-3482-4c29-83bb-0e7ea191823b 的terminal.json：UTC17:00:19.033Z已failed，recover_history / CLIENT_FORCE_ABANDON_REFUSED，recoveryPhase offline_observation、recoveryReasonCode EVIDENCE_MISMATCH；原安装保留。脚本先前的“worker已退出，更新未完成”遮蔽了实际保存的failed；状态读取先看running、等待原生进程查询期间worker落终态并退出的竞态已可复现，但尚未将本次现场唯一定因于该竞态。修复为：判中断前重读同job独立terminal/result/有限失败日志，不能据此宣称实际恢复成功。

服务端UTC17:02只读核验：目标设备offline，最后心跳16:24:26，仍c477；原r3e8暂停/active2805，grant1/receipt0，原hash保持。17:00:15一次prepare409表明新worker越过维护锁并进入恢复探测；不能只凭409判断是哪条校验拒绝。offline_observation还包括WAL与readLocal，不能误判一定是进程或端口。

因此新增一次官方只读诊断，不再让用户重复升级碰运气：复用实际本地校验器的静态ruleID，输出前后本机health拒连/状态、native inventory与listener数量或明确unknown、源码/配置/build是否相等、WAL及旧任务四份记录的失败规则。只读本机文件、loopback GET和原生清点；不提交prepare/commit、不暂停/停止、不中断任务、不改员工资料或业务记录，不输出密钥/原配置/聊天/命令行/原始子进程输出。PowerShell独立入口下载固定官方URL并校验SHA；诊断为单文件Node bundle，无需npm安装或正常更新，临时文件仅清理本次新建目录。源码先推GitHub，再仅发布3个静态诊断文件，正式API与CLI更新包保持874。现场具体拒绝规则须等目标电脑实际诊断，不预设根因。

### 只读诊断静态发布核验（北京时间 2026-10-18 01:23）

提交 `1412c336496e65bb1e5019246c34a94d447735b4` 已先推GitHub两条既有分支，UTC17:21仅发布三个下载文件：`diagnose-bot-recovery.mjs`、`diagnose-windows-recovery.ps1`、`recovery-diagnostic.json`。单文件bundle由完整Git归档打包，9项输入逐字节比对；第二位审查者内存重建得到相同bundle。72项相关测试71通过、1项Windows平台条件跳过、0失败；Mac上原生ESM导入和CLI平台拒绝入口通过，未宣称Windows原生诊断已现场执行。

公开bundle为88256字节，SHA256 `c206051eecdb76facdc24e2cec9b465561fb9608d5b4050cfa24187559b42f4d`；独立PS为3090字节，SHA256 `3f4423fab616faa928c4b1e760dc90bb06d676f0c15ac7a8bc4442d4b212d55f`；诊断metadata为2155字节，SHA256 `748f81473ed46a0d0a45b76b57e3113f827073ed8982ad6308fdcbc48818ba8e`。UTC17:23独立postcheck重新核验全部公开字节、既有CLI文件及API服务身份、数据库inode/schema均保持；没有提交业务写入或调用目标设备。当前正式API及CLI更新包仍为874版本，不把诊断静态发布写成完整产品升级。

已请用户在李金晋电脑运行一次官方只读诊断入口，等待精确rule结果；未要求再次更新。此刻知微恢复仍未验收，不声称slot已解除、员工已启用或真实模型新消息成功。私有证据在 `.local/operator-force-abandon-diagnostic-release/`，未将凭据或原始本机业务数据写入Git。

### 现场明确规则与投递日志恢复修复（2026-10-18）

用户已实际运行只读诊断：scopeMatched为true；46项source可读且未变；build匹配；前后health均实际connection_refused；Windows原生客户端清点为0、健康端口监听为0；配置未变，force-abandon WAL不存在。唯一明确失败为local / EVIDENCE_MISMATCH / JOURNAL_TERMINAL。此前4d19c58d更新仍使用旧874入口，重现同阶段；这次不再将错误归因于锁、代理或进程无法停止。

根因已通过真实createActionDelivery持久化流程复现：uncertain结果先保存为result_pending / retainEvidence:true / dispatcherStatus:failed，后续收到服务端确认才写confirmed/serverStatus。响应丢失可留下result_pending，永久4xx会保存blocked；服务器已有失败记录不代表本机已完成确认。人工放弃恢复反而要求本机confirmed/failed，形成错误前置条件。

新增的窄支路仅接受这条已授权原任务的result_pending或blocked：双blob必须存在，身份、绑定、SHA均有效，retainEvidence与dispatcherStatus正确，serverStatus不得为成功、过期或未知值；blockedStatus必须是永久4xx并排除408/429。结果的error和完整uncertain正文必须精确匹配固定原失败。仍归档原始四文件字节、不伪造confirmed/serverStatus/原进程退出，不重放消息；其余started/completed、聊天及Profile/HOME保留。既有confirmed/failed路径和服务端合同不变，不需切换API。正式更新失败回执同步增加有限白名单recoveryRule，避免再次只留下笼统EVIDENCE_MISMATCH；不输出原配置、命令行或错误原文。

最终整合136项测试，131通过、5项Windows平台条件跳过、0失败；另排除未变的本机HTTP下载测试以免启动临时监听。包含真实writer产生的pending/blocked离线归档端到端、拒绝矛盾状态/错误结果/损坏blob、原字节与其他历史保留、只读诊断不写入、更新状态及安全错误投影。静态检查191项通过，未启动本机监听。Windows现场恢复仍待新版官方更新实际回执，不将这些测试写成知微已经恢复。源码先推GitHub，之后仅更新官方CLI下载；发布及真实设备结果另记。

### 投递日志恢复版已正式发布（北京时间 2026-10-18 01:40）

产品提交 `e9ff426be18dfb72ea0f9fd5ef34701e290aab40` 已先推GitHub两条既有分支。第二位审查者独立运行89项回归，88通过、1项Windows平台跳过、0失败，并检查全部56个静态失败规则均可进入受限更新诊断；原合同/API不需修改。首次私有打包因发布器多要求两个未列入package.files的诊断源而被阻止；移除多余要求，未改产品包清单，另建final目录重新完成完整冷包校验，失败候选未发布。

最终53项required源码与Git归档、tgz逐字节一致；本地及服务器Linux空缓存离线安装/运行闭包核验通过，未启动监听或运行设备维护。冻结manifest SHA256 `40f1d9d68f67ad59f9448622025f9684de5d52074fffbc70480bfc2f7bc18520`，payload SHA256 `22df3c61a47784547942cc6dd557855e48b1b7f05b6eb73c95476c45c42b27db`，仅含CLI包、离线检查包/程序与独立更新PS。独立核验源、包、上传计划及远端执行脚本均通过。

UTC17:39:48仅发布官方CLI，build `484fa58efd3b9dc569f8f9ceefd92b15ee23f00a9831142fbea7904e047793b7`；tgz1128958字节，SHA256 `67d4e5f73054a3ed4a655c8c81f816ac34811e2aafca9ac88e3c39eee7b8de3e`。独立PS仍为6390字节、原526882摘要；release.json摘要 `745fc7f8f8313bd6604e91bf24e4419e61429d04010d74d963b84f2c5c45d837`。API/前端继续874目录，PID383266；metadata如实保留pairedApiCommit/frontendCommit为874，仅CLI commit为e9ff426。UTC17:40独立postcheck核验公开包/PS/metadata、API文件/服务身份、DB inode/schema及其他CLI工件全部通过，三项只读诊断工件未变。无API重启、业务恢复提交或Windows远程调用。

已请用户在李金晋电脑执行一次官方bootstrap，明确成功后再start；此电脑原先离线，更新器不能伪称恢复原在线状态。后续仍需设备独立恢复回执、原slot解除、新版上线，再从正常用户入口启用并发送一条不重放旧任务的无副作用真实模型验收消息。此发布时不宣称知微已恢复。私有证据在 `.local/operator-force-abandon-journal-release/`。

### 离线准备拒绝、服务端时间基准和错误详情（2026-10-18）

用户现场job `update-7cede314-c19d-4102-ad40-0ac980d315ef` 已越过本机JOURNAL_TERMINAL，失败转为recover_history / CLIENT_FORCE_ABANDON_REFUSED / offline_prepare / SERVER_REFUSED。UTC17:42:26及17:42:28两次prepare均为409，commit为0；旧客户端把HTTP状态和服务端公开code丢弃，API错误中间件也未记录响应正文，因此不能把该409直接说成某个具体code。UTC17:45只读检查16项服务器数据库谓词均通过：原raw/唯一failed字节、授权及两个marker、真实owner成员、r3/e8暂停与旧active、Profile/设备所有权、唯一有效凭据、c477心跳build和结构完整。grant1/receipt0；未重放prepare/commit或修改业务数据库。

静态复核确认原离线协议把电脑wall clock的checkedAt直接与服务器now比较，快1ms即可被拒绝，慢过120秒也会被拒绝。已用真实服务端factory、设备token校验、真实本机helper和投递writer的内存协议回归重现：快5分钟的pending及慢5分钟的blocked均由旧helper得到真实ABSENCE_REQUIRED409。该实验说明一个确定的兼容缺陷，不冒充已读取现场丢失的服务端响应或证实其唯一根因。

新离线证据使用受信HTTPS响应Date及单调计时建立服务端时间下界；新prepare经原完整策略校验后，以expiresAt减固定TTL重新锚定收到的服务端issuedAt。观测时间使用收件时刻下界，期限检查使用同次请求发送时刻的保守上界，不把网络往返耗时延长为可用TTL。缺/坏Date或单调计时逆跳拒绝新证据；已提交的有效receipt及已applied续办仍只做原生presence检查，不依赖新Date。原WAL/receipt/执行时间均不重写，服务端合同、策略digest、120秒窗口、旧live/v1停止规则不变。

同时，正式失败回执保留22项明确枚举的公开服务端code及100..599整数HTTP状态，仍拒绝原始body/error/命令行/配置/秘密；状态日志降级恢复也保留受限详情。移除失败文案中诱导用户反复重试更新的提示。恢复决策本身未因错误展示而放宽。

新helper与真实严格后端的两条协议回归均达到probe409、prepare200、commit200，独立reader验证schema2原执行未知，r3/e9暂停且active解除，四原件字节和其他历史均保持。最终203项整合测试198通过、5项Windows平台跳过、0失败；另排除未变的本机HTTP下载测试，静态检查191项通过。覆盖本机±5分钟/±24小时、HTTP Date秒精度和延迟、单调时间逆跳、严格期限边界、无Date、原WAL和receipt中断续办及错误详情脱敏。未启动Mac监听或完成Windows现场恢复；后续先推GitHub再仅发CLI，实际设备结果另记。私有证据在 `.local/operator-force-abandon-clock-release/` 及前一journal-release只读谓词报告。

### 服务端时间基准恢复版已发布（北京时间 2026-10-18 02:00）

产品 `776ae4c58b68e0526ab53f9cca8ff0ddb4ec94c2` 已先推GitHub两条既有分支，独立源审及115项通过/1项Windows平台跳过的复核无阻断。53项required源码、helper/updater实际字节与Git归档和tgz一致；本地及Linux服务器冷安装/运行闭包校验通过。冻结manifest摘要 `a56c67db3de428c39b4d7224d848d9aca4526769c296816187e6d47b711baed3`，payload摘要 `d9429dac2a894bf693939771500a2d2701a7a7e25347f8f90d77dafc7cb1945f`；仅四项CLI发布输入，上传计划和远端脚本由第二位审查者独立核过。包内preservation proof的publicationKind沿用前一journal修复类别，实际正式下载scope为clock-fix；候选commit、build和实际API绑定均精确记录。

UTC18:00:37正式CLI切到build `623d5585b2a2e706299a79f6ae72f0d0232d3efebe5d59c51da6fcddbbf5ab14`，tgz1130649字节，SHA256 `80b44b8c3803f1aebaefc33a15070f23b83de41aad4b2124e5c32738249f0dad`；独立PS仍6390字节及原526882摘要，release.json摘要 `5b97b251f770451ebb730cf16302d56a05f8e5cc3004d9ed14f7163b1bb73b90`。API/前端维持874目录和PID383266，未重启API或改业务数据。UTC18:00:46独立postcheck核验公开包/metadata/PS、API与前端文件/服务身份、DB inode/schema、其他CLI工件均通过，原三项诊断下载保持。临时node_modules链接已移除，目标依赖目录保留，无本机新增监听。

已发一次新版官方更新及成功后start的指令，等待Windows实际结果。发布不等同于原slot已解除，也未宣称现场SERVER_REFUSED的唯一原因已经拿到；若仍拒绝，新版会给出受限具体serverCode/HTTP。后续必须验证独立回执、新版设备上线及一条不重放的真实模型验收。原用户授权继续有效，不重复请求批准。

### Windows 恢复和真实模型验收已完成（北京时间 2026-10-18 02:19）

用户实际完成 update-3fc8514d-19c2-4b82-8ae8-a42faf2b67ed，更新器报告 Ziwei update complete、实际 build 为上述623d5585；随后正确执行 ziwei_user start，PID21776、readyz就绪。服务端只读核验确认该设备以此build重新在线，而不是仅依据本机成功文案。

UTC18:02:13.492服务器保存并经严格reader核验独立恢复回执 ec66be0ff9854c3bc8b3a6c4b7dbfdade31f8fc1bf8c25dda43318100bcea373：schema2/no_current_daemon，disposition为abandoned_by_user，原executionState仍uncertain，executionConfirmedStopped仍false。原2805任务占用已经解除，Bot先保持r3/e9暂停；未伪造原进程退出、旧任务成功或重放旧消息。随后通过真实owner已登录网页的正常“恢复 Bot”入口启用，成为r3/e10。

正常主聊天入口仅发送一次无副作用新消息，要求只回复“知微恢复正常”，不调用工具、操作手机、修改文件或继续旧任务。新action_9f576f71-3f6e-4da8-81fa-421a4be27895于UTC18:08:05.958创建、18:14:56.020 ACK、18:15:26.416 succeeded；真实Hermes使用gpt-6.1-sol、requested/actual均为max，返回“知微恢复正常”。新进程PID36508退出码0，root/tree均确认退出、activeProcesses为0；此退出证明仅属于本次新验收。精确用户消息计数为1，Bot最终启用且active为空，设备继续在线。私有截图及结构化证据保存在clock-release目录，未提交聊天截图或凭据。

本次新消息排队约410秒，ACK后实际执行约30秒。只读队列与请求记录表明，同电脑另一个员工正在执行且poll正常；其结束后知微自动获调度，未额外重试或停止其他员工。源码确认全局managers>=1把不同员工的主对话串行，用户已明确要求多员工并行；该调度缺陷另行修复，不影响上述旧记录恢复和真实模型成功结论。

### 同电脑多员工并行调度修复（2026-10-18）

移除跨员工仅一个主对话的限制：默认三个非控制执行槽允许两位员工主对话并行，保留一个直接协作子任务槽；同员工的可执行消息按当前poll顺序串行，停止请求保留独立旁路。协作优先只接受活动本机父任务、相同工作区/设备、不同目标员工及完整服务器来源字段，不让裸source标签占用保留容量，也不让较新子任务越过同员工旧消息。明确拒绝执行的新消息不阻挡该员工已验证的持久回执重传；执行前再次检查隔离门槛，失败释放计数。

总预算仍为3，不按员工数无限启动进程；固定容量仅保留直接子任务空间，不能据此保证任意嵌套同步等待无死锁。服务器忙碌槽、独立Profile/HOME、既有隔离与进程退出规则保持。工作目录可由用户选择共享，并行本身不提供共享文件写入隔离。

最终207项相关回归全部通过、0跳过，静态检查191项通过。新增集成用例实际运行两个独立Node子进程，经真实scheduler、delivery和ActionDispatcher同时ACK并持有在途执行，独立完成及交付；验证同员工后续消息保序、重复poll及重建delivery不重跑、持久未知状态不放行新执行。该集成只mock服务器传输，不连接模型、不操作员工电脑；本段不宣称新版已在Windows真机完成并行模型验收。源码先推GitHub，再仅发布CLI下载，API和网页无需切换；正式发布结果另记。

### 多员工并行版本发布核验（北京时间 2026-10-18 02:33）

产品提交 `df2f1943c67adae5f4073d831003320b056542dc` 已先推GitHub两条既有分支。独立审查64项定向回归全部通过，53项required客户端源码逐字节匹配Git归档和tgz；相对上一CLI776产品增量仅调度器。冻结manifest摘要 `f60e89cfb868fce3be2762bf0a7586aaffe5559306248a1e54f770888845a8c9`、payload摘要 `d1aca6fbf26e6d9bead825a574f7ca956e002a29dfe78d81b3a745ec73dafbea`，上传计划4项文件逐项校验，源码和发布范围未扩大。

UTC18:32:52仅发布官方CLI，build `4291265f95770c7d8a9952325d3bb4bcd12c35b2fe485eef38645a662fde9ccb`；tgz1131470字节，SHA256 `0b232e72addfb0e026b3a33bfebf2c45fcb5fdd8e26a9958be36718d3536c467`。更新PS仍6390字节及原526882摘要，release.json摘要 `3aff09130350806042c2bf9677566eb1bbb693db8f2b2931147f7334e9cd86cc`。UTC18:33:07独立postcheck确认公开字节及metadata、API/前端874目录与PID383266、服务身份、DB inode/schema、其他CLI和三项诊断下载均保持。正式下载已可用；服务器发布没有自动更新Windows客户端，真机安装新版后的并行模型验收仍待执行。

验证期间独立审查误跑了既有动态端口daemon integration用例，该用例已自行清理，未发现残留fixture进程或监听；实际临时端口未记录，不能事后补造。本轮root采用的207项验证及新增集成均未启动监听；最终端口中心check本worktree为ok、conflicts和unregistered均为空。临时依赖链接已移除、原依赖目录保留。私有证据位于 `.local/employee-parallel-release/`。
