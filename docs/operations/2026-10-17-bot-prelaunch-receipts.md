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
