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
