# Bot 本轮结束后应用配置

实现日期：2026-10-18。以下分别记录自动应用、原生连接和现场查询，不能以保存成功代替已接通。

员工可用已有 `ziwei_bot update` 提交完整合并后的配置，增加 `deferUntilIdle:true`、`expectedRevision`、`expectedControlEpoch`、稳定 `idempotencyKey`；需要自动连接的 MCP 名称放入 `connectMcpServers`。无需新增客户端工具或终端操作。旧客户端即时修改遭遇 `BOT_BUSY` 时，API 返回这条可执行路径，员工不必让用户保存，也不能在当前轮内等待自己结束。

独立持久意图保留原用户／设备授权及员工、工作区、电脑、Profile、配置版本和控制版本。当前轮不改配置或回执。只有绑定原动作的明确完成及进程树退出证据通过后，才应用配置、派原生验证；验证成功后恢复原已启用状态，并串行发起指定 MCP 原生连接。排队期间不派新业务，原执行、停止和维护流程保留。读取 `get.deferredConfig` 显示真实阶段；GET 不触发应用。

重复请求、完成回执和服务重启复用原意图及原连接 action。未知退出继续等待；暂停、版本、绑定、设备所有人或权限改变会冲突退出，不覆盖新修改、不自动恢复已暂停员工。OAuth 令牌和 PKCE 留在目标 Profile。已有有效授权直接复用；首次授权如服务要求用户同意，必须通过原网页授权，不能伪造批准。配置已保存、电脑验证、实际连接和后续会话加载是不同状态。

数据库仅增 `bot_deferred_configs` 及其两个显式索引和 SQLite 自动索引。正式发布必须克隆实际混合服务树，仅覆盖审核过的必要模块，保留手机通知、前端、官方 Windows 包、中控和 Nginx。回退只切回上一代码目录，不恢复数据库、不删除新状态表；再次升级须按当前版本和授权重新核对未完成意图。

回归使用无监听的内存数据库和 Express 请求；包含真实完成后推进、幂等及重启、未知或不完整退出、撤权和暂停、当前员工隔离、真实 MCP service action 复用，以及已有手机通知和停止流程。真实 TK 接入将使用固定唯一请求，结果未知时只读取原回执，不换标识重发。

## 首次发布和 TK 现场结果

产品 `0d26bbe583a78829bf3d59703c4129f33692d170` 经 200 项回归、lint 和独立审查后先推 GitHub，再于北京时间 13:21:53 发布。API 目录 `/opt/ziwei/releases/deferred-mcp-0d26bbe583a7-b8a5f442/v2`，PID 416013。克隆实际混合树，只覆盖八个必要源文件；前端、官方 Windows 包、中控、Nginx 和数据库文件身份保留。仅增前述队列表及索引，未恢复数据库。

随后从 TK 原主聊天提交唯一请求 `tk-viral-deferred-20261018-bc399600`。真实模型运行的原动作 `action_85e1751d-dedc-43e8-83d4-8735faf4d525` 在 r3/e5 中提交意图 `bot-config_cd619a3a-bce1-47d7-b8cb-0f6c8e03ce22`；原动作退出后，自动应用 r4/e6，验证动作 `action_74cd2880-0d34-4deb-986a-081454a16912` 在公司台式原生验证成功、进程树退出 0，然后恢复原已启用状态 r4/e7。原配置、电脑和专属 Profile 绑定保持，只增加 `viral_library`。没有用户或其他员工手工保存。

自动连接动作 `action_146d15de-d5c1-46b2-9b71-7b351c5cbb7e` 返回 `MCP_OAUTH_REQUIRES_DEPENDENCY`，不是已连接。失败原回执和意图保留，不自动换标识重试。TK 的提交和回读还暴露了管理响应包含完整历史而超时的问题。

## Windows OAuth 和管理回执修复

13:39 的 TK 只读现场诊断确认 Windows Python 3.14.7 创建事件循环时经过 `socket._fallback_socketpair → asyncio.proactor_events._make_self_pipe`，原全局禁止 bind 的规则在任何实际监听前拦截了事件循环。原诊断布尔值漏匹配 `_fallback_socketpair` 别名而为 false；原始调用链保留，未修改原回执。修复仅允许 Windows 标准库代码对象、对应内部 socket、loopback TCP 端口 0 的这一自唤醒路径，仍拒绝 OAuth 本地回调监听及直接 bind。两套原生 Hermes SDK 的目标 HOME、授权、缓存及刷新回归和精确 CPython 3.14.7 无监听模拟通过。

员工管理读和延期申请回执改为当前完整配置及有界执行摘要，保留版本、绑定、验证和退出证明；不再嵌入完整历史事件或 Session 内容。普通网页详情保持原行为，完整原动作仍可用 `ziwei_get_action` 读取。新增大历史、未知状态和恢复凭据边界回归。该修复后续发布与真实连接结果继续追加，不将安装包发布等同于员工电脑已更新。

修复产品 `fbb52e22f27e32de681f2f0300779e6f3945d71f` 经最后 55 项相关联合回归、lint 203 项及独立审查后先推两条 GitHub 发布分支，再于北京时间 13:50:36 发布 API、13:51:38 发布官方 Windows 包。API 目录 `/opt/ziwei/releases/windows-oauth-management-fbb52e22f27e-259be463/v2`，PID 417549；只覆盖 `backend/bots.mjs` 和新增管理摘要模块，其余实际混合树保持。数据库逻辑 schema 和文件身份、前端、中控、Nginx 均未变化。

Windows 包只覆盖 OAuth helper 和管理工具说明，继承其余 930 个文件及原依赖；冷缓存离线安装、真实 API factory 和 CLI 检查通过，无监听或外部网络。实际安装 build `88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e`，包 SHA `7f6941d7e5d6de9fa5c71eae4a79b739359705c5b1e59fd2368c9f523a015e69`，1,133,248 B；官方下载、元数据和官方更新脚本经独立公网核验一致。API 的旧 OAuth helper 保持继承字节，实际修复在 Windows 客户端执行，不能声称 API 整树均来自同一 Git 提交。

为避免要求用户到电脑运行命令，13:59 从 TK 原聊天发送唯一登记请求 `tk-update-fbb52e2-20261018-7ca6`，对应 `action_5c4a172a-eb1f-43fe-a409-ec0eb27f527d`。本次运输脚本仅登记当前用户、Limited 的单次计划任务 `Ziwei.TK.Update.fbb52e2`，在 Hermes Job 外等待客户端空闲，再调用正常官方更新器；不强停、不改执行策略、不重跑业务、不添加维护锁。脚本传输 SHA、任务身份、一次 attempt、官方包和目标 build 固定；真实 ready 后仅清理自己的任务。任务登记或源码检查不等于实际更新完成，后续结果单独记录。


现场更新尚未完成：首次登记因 Hermes 终端的 npm prefix 与真实安装不同而返回 `CLIENT_UNAVAILABLE`，未创建计划；真实安装根为 `C:\Users\PC\AppData\Roaming\npm\node_modules\ziwei`。后续运输只修改进程内 prefix 和真实运行 Node 路径，不改系统环境。又修复 Windows PowerShell 将 `File.Replace` 的 null 备份参数转成非法路径的问题，使用唯一真实备份路径保留原状态。

14:38 的只读请求 `tk-update-state-20261018-6a7c` 对应 `action_02d4f11e-66a4-4019-8e79-32e7472d0dd0`，14:40 根进程及 Windows Job 树退出 0。它确认同名更新任务和 Plan 已存在、attempt 不存在；06:36 UTC 的更新 worker 在 `initializing` 阶段返回 `TASK_NAME_IN_USE`，任务已退出，LastTaskResult=1。因此任务登记实际成功，但自身份校验失败，不能因为先前通用 `TASK_FAILED` 就重发登记，也不能把聊天框架执行成功称为更新完成。原脚本、Plan、失败状态和原始回执均保留；继续只读比较任务定义及实际 SID，不放宽身份检查。

截至这次交接记录，公司台式最后已观察 build 仍为 `161cc990…`，目标 `88b2ea9f…` 尚未由目标电脑心跳证实；TK 原意图的连接状态仍为失败。后续必须记录真实更新、下一次明确延期请求、实际 OAuth 连接和工具查询结果，不得用官方下载核验代替现场验收。


14:49 的逐项只读对比 `action_e92aaa37-76e6-48f2-86d7-9567adf7f985` 已证实：Task Scheduler 把 Principal.UserId 保存为账号名，原文字 SID 比较失败；NTAccount 转回 SecurityIdentifier 后与原用户完全一致，脚本 SHA、描述、LogonType、RunLevel、动作数量、可执行文件、完整参数和工作目录全部匹配。只将 OwnTask 改为明确 SID 等价判断，转换失败仍拒绝，不放宽其他检查。

单次修复请求 `tk-sid-owner-20261018-3b29` 对应 `action_a9bb4c4f-8f99-49bb-aa02-28c4820823ae`，14:57 根进程及 Windows Job 树退出 0，实际返回 `SID_OWNER_REPAIRED`。修复在核对旧文件、Plan、XML 和任务状态后备份原件，只以 UPDATE 更新同名任务，并排定 14:58:13 的一次触发；未另建任务或调用 Run。新运输脚本 SHA `25e89206261eb8cb573d15cb3f9fb6e84d0ef5269013d7b185710ba972bd6928`。该结果仅证明任务修复／排定，真实安装仍须由目标构建心跳及本地完成状态另行证实。


15:08 的原生诊断 `action_282db0aa-f3b3-46e5-809b-2a4e6ad697fd` 证实任务已通过 SID 检查并进入等待空闲，但普通停止被维护扫描器的 `ACTION_STATE_CORRUPT` 汇总代码阻塞。此代码不等同于 JSON 语法损坏；实际 dispatcher 能执行本轮诊断，隔离数为零。保留全部历史及去重记录，不把历史业务强行标记成功或退出。

针对用户已授权的公司台式强停及更新，准备公司电脑限定的一次性维护入口，源码位于 `company-mcp-update-20261018/`。仅在当前真实执行、投递、轮询、辅助进程及原 daemon 子进程归零后，核验原安装、配置、设备、用户 SID、PID 创建时间、nonce、监听归属和状态快照，持有准确进程句柄停止空闲 daemon 根进程。独立记录仅证明该根进程退出；不补造历史业务退出证据。随后运行已发布的原官方更新并显式正常启动，须由实际 build88 就绪验收。若停止或更新失败，严格核验后才可正常启动原161安装；不自动重复强停。

24 项无监听回归全部通过，包含真实无害子进程的完整 JSON stdin 与 EOF；独立审查通过。Windows PowerShell 源在本 Mac 未实际运行，入口运行时先解析两份嵌入脚本再写入。后续先推 GitHub，再发布不可变、绑定源码哈希的单次入口；不替换官方包、更新脚本、API 或历史记录。当前尚未声称目标电脑更新完成、爆款库已连接，现场结果继续追加。


15:35 一次性入口 `company-mcp-update-20261018-33a4bece1524.ps1` 在源码5778b69先推两条GitHub分支后，仅新增到官方下载目录；公开SHA256 `33a4bece1524d910682151cab222e9ce7b8cbab5a8a97bc98034ce215300fab1`，71826字节与Git源码逐字一致。官方原包、release.json和update-windows.ps1均核验未变化，未重启API。

15:37 从TK原主聊天发送唯一 `tk-owned-idle-update-20261018-7d82`，对应 `action_d901e533-2fac-4f2a-835c-d1396d8a26d3`。只下载此官方不可变入口并验证SHA/长度后执行一次，收到结果即结束本轮，不重试、不进行业务操作。此处仅记录请求已送达，现场运行和新build仍须另行确认。


15:42:32，单次入口原动作 `action_d901e533-2fac-4f2a-835c-d1396d8a26d3` 成功、根及Windows Job树退出0（activeProcesses=0），实际返回 `OWNED_IDLE_UPDATE_SCHEDULED`。同名任务的新worker SHA `74e1a307bb2902a3a7243b39735e86bb43fa4e4d50b345b27b52bf66f4e25953`，nextRunTime=15:43:20，attempt尚不存在。本结果仅证明准确同名任务替换和排定，不能代替宿主停止、安装或就绪证据。


15:44:45 的独立只读生产快照确认：公司台式已经上报目标 `88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e`，新PID9784、心跳15:44:34，距快照10.8秒，设备online。TK仍为原r4/e7 active，validatedRevision4、原设备及专属Profile固定，activeActionId为空。这证明目标客户端已实际更新并重启；旧失败连接意图仍保留，新一轮延期接入另行提交，不把客户端更新代替MCP连接。


15:48:10 从TK自己原聊天提交唯一重验 `tk-viral-repair-fbb52e2-20261018-417c`，原动作 `action_93ef6da9-9e6d-4b5d-8525-df9208aa3810` 于15:50:21失败、根及树退出0，原工具错误为 `ziwei_bot get` 30秒超时。未调用update，未创建417c意图；不复用请求未知的说法或改写失败回执。

只读Nginx元数据确认原管理GET实际返回200、gzip正文499989字节；本地/公网health检查200分别0.087/0.033秒，不能据此断言服务器宕机或代理故障。15:57:39单事务分量统计明确：employee JSON798680字节，其中内联data URI头像794807字节；config557字节，全部相关compact动作8057字节，单reader0.7–4.61毫秒。因此追加最小管理头像省略修复，不扩大超时、不改头像存储或网页显示；修复后重新用真实TK请求验证。原统计不读取或输出头像正文/凭据。


追加修复只在管理响应省略内联头像本体，返回avatarPresent、avatarBytes与avatarRepresented:false，省略不合成为avatar:null。统一getter覆盖已初始化/未初始化和create/replay/update/control/list回执；普通网页、移动端、URL头像、数据库原图、完整配置和版本/身份/原执行证据保持。795KB真实factory回归验证get和延期ack低于40KB、同幂等重放及实际apply后头像字节未改。42项联合回归、lint203及独立审查通过；主控另重跑39项全部通过。没有扩大30秒超时、改变查询/schema或授权。


16:03:37，产品 `da35d3a6d652f26906f1dc5dfc44eb09df71e139` 已先推两条GitHub分支后发布API。实际目录 `/opt/ziwei/releases/compact-management-followup-da35d3a6d652-01ec30ce/v2`，PID424996，回退目录为原fbb。仅覆盖 `backend/bots.mjs`；实际混合树其余源、前端、官方Windows三文件、中控/Nginx以及数据库文件身份/schema保持。停机前在实际候选树执行两组真实内存测试通过，无监听、无员工调用。未重打Windows包，当前公司台式88继续可用。

随后从TK原聊天提交唯一复验消息 `tk-viral-after-avatar-20261018-47d1`，管理操作仍复用原幂等键 `tk-viral-repair-fbb52e2-20261018-417c`。前一轮get明确失败且无update，不创建第二套连接；本轮真实结果继续记录。


16:04:46复验原动作 `action_da74c660-638d-4a7f-93d8-7c56bb0ed48e` 真实完成，16:05:47根及树退出0，取得自己的延期意图 `bot-config_ecfc5a83-da74-46b0-b155-8055a7103810`。同配置无变化，因此仍r4/e7；16:05:48自动发起原生验证 `action_3ea83e17-8fd9-48f3-908e-feee27cf9be4`，16:05:52成功且树退出0，随后自动原生授权 `action_26adb3d7-b75f-4611-a8fc-e5e4322e461f`。管理GET在Nginx实际返回200，gzip正文从499989字节降到17177字节；本轮get/update均成功，自动应用及校验链真实通过。

新授权动作16:06:32真实失败，根和树退出证据完整，公开原始码 `MCP_OAUTH_RELAY_FAILED`。原回执未保存底层cause/status/phase；此码合并网络及非200，不能凭此声称viral服务或代理不可用。Nginx进一步只读证实对当前action的relay/start POST已抵达，于16:06:14记为499/零字节，后续publish/callback不存在。

源码确认MCP连接模块四处仅需id/config/version/binding的状态读，仍使用mobile完整历史视图；持久延期轮询每tick会重复该路径。追加窄修将这四处改管理投影，保留context/作用域和begin/deviceAction/authorizeBotStart，不改原10秒网络截止、不改schema。当前未知此开销是否解释全部现场等待，最终仍以新连接实际回执为准。未发送原计划的员工网络诊断，避免不必要的终端执行。


四处MCP读取窄修经57项联合回归、lint203及独立审查通过；主控另18项、独审15项均全部通过。新增120份大旧历史的full-action读取陷阱，覆盖start/幂等重放/list/read/cancel/deferred快照；真实工厂完成延期应用、验证、恢复、同一OAuth动作五次等待、浏览器handoff和原native树退出后完成，期间不读取旧完整历史、不重复派发。只覆盖连接服务模块，客户端88保持。


16:20:22，产品 `950f4df2a23f6c7a279acd4ea6121208a01015c0` 在两条GitHub分支先推后发布API。目录 `/opt/ziwei/releases/mcp-relay-followup-950f4df2a23f-8304d4c7/v2`，PID426944，回退目录为da35。唯一覆盖 `backend/bot-mcp-connections.mjs`；实际候选两组18项测试通过，无监听，完整混合源码其余路径、前端、中控/Nginx、官方88安装包及DB身份/schema保留。新验收标识 `tk-viral-relay-followup-20261018-90be` 在原26adb明确失败/tree退出后提交，从TK自己的本轮再次走延期链，不改写或自动重放旧失败意图。

16:21:29—16:22:53，新90be源动作 `action_4fc473bc-e2c6-40d2-a304-4bd010a83a79` 成功且根/树退出；意图 `bot-config_0871d161-38a0-452f-94aa-5c4429c3c7e9` 自动验证通过，原生授权 `action_5531e20f-c102-4ea6-9ee6-d69cc600c92b` 实际达到网页授权handoff。管理员登录期间旧flow到期，原动作16:28:22明确失败/tree退出，原码MCP_OAUTH_RELAY_FAILED，失败记录保留。用户随后已登录爆款库，但尚未选择/创建员工身份或批准，不能称已连接或已查询。

中央配置原本请求library:read与library:collect，而真实授权URL仅请求read；公开401 challenge也仅给read，受保护资源元数据则支持两者。真实Hermes 0.22归档与官方913d源码、MCP SDK两套无监听集成复现SDK覆盖显式scope。窄修仅在当前目标OAuth进程、当前dashboard flow中保留配置scope并合并SDK原生附加项，finally还原选择器；保持DCR、PKCE、目标Profile令牌存储和原回调链。实际token scope不足则明确拒绝，未知scope不声称确认；服务端仅投影有限原生scope证据，不从工具名推断权限。已有read-only缓存不会被删除或强制登出，单纯重连不能承诺自动升级旧grant；本次TK没有完成旧授权。

追加39项服务端定向回归、两套各26项helper及实际SDK后台线程授权/刷新/缓存集成全部通过。发布及公司台式新包生效、实际完整授权和查询仍须另行记录。

16:51:35，权限修复产品 `acee34d32f04167038cb1b55eab2377c142df614` 先推两条GitHub分支，再发布API `/opt/ziwei/releases/windows-mcp-scope-acee34d32f04-bdc0ae98/v2`、PID429489，仅覆盖管理scope投影和MCP连接模块；39项候选实际内存测试通过。16:52:18发布官方Windows包，实际build `5a642107fa32d8e8f09ea139a9f964e7f50c77d9648788ae5aba6e96ac509fec`、包SHA `e386b28ab38fddfa53c88091418f372a2c91ebd8c1402b19d3db22b1d60e157c`、1134321B，公开元数据SHA789eae1c；仅覆盖remote OAuth helper、native bridge和descriptor，930个继承文件及原bundled依赖保持。原bootstrap526882bb/6390B逐字保留。DB身份/schema、前端、中控/Nginx保持。发布包不代表公司电脑已安装。

已准备公司台式88到5a6421的限定一次性官方更新入口，源码位于 `company-mcp-scope-update-20261018/`，27项无监听回归、freezer正反校验及独立逐字审查通过。新任务CREATE-only、当前用户Limited、仅一个延后触发；重新取证当前空闲daemon根，不复用旧exit，不改旧历史。入口bcf8e1ee/76251B及实际包/构建/脚本固定，后续先推源码，再仅新增不可变下载入口；现场注册和真实新build尚待验收。

17:00:11只读快照确认公司台式已经是5a642107、新PID23428、17:00:06新鲜心跳；原调度source `action_bec46d82-ae12-4975-b99d-d637fd3bb48b` 成功且root/tree退出，SCOPE_UPDATE_SCHEDULED原JSON保留。本次未要求用户到电脑运行命令。

17:02新d06c source `action_5a532e68-de6c-4f74-b6e8-48fcafd875de` 成功/tree0，自己提交意图 `bot-config_460772a1-46f3-439c-a4ae-c3997a9ca919`，原生验证dbb722a5成功/tree0；原授权267450b8仍在relay/start返回499后明确失败/tree0。普通Bot页当时也出现详情读取超时；源码仍有完整历史重复读取，不能只凭时间重叠认定本次499原因。

17:10:30在已完整加载的既有工具页，仅点一次连接，精确原native `action_2ea28006-6d65-4a66-ba1c-c58730a62879`、requestId95997bfa，实际发布包含read+collect的新URL，授权页显示9项阅读与采集工具。start、authorization和19次callback均返回200，未见429或本轮poll网络错误；但未批准前17:11:56原动作返回MCP_OAUTH_CONNECTION_FAILED/root与tree退出。没有创建员工身份或grant，页面已关闭，不把等待授权当连接通过。

用户随后明确要求本次TK长期授权直到撤销；爆款库actual65b实现仍有grant90天及refresh30天限制，正在独立源码修复，不批量延长其它旧grant。现有两套原生315秒连接/300秒callback实现已通过虚拟120秒等待、301秒过期与取消真实SDK回归；未复现现场较早退出，不能再声称是已找到30/60秒硬限。

17:36:49诊断产品 `e2a360c13765c6f4fce3aa1c34966388a327dd1c` 已先推双GitHub分支后，仅发布官方Windows包：build `5a9c550c26ec02ffe16f68d11e732e35aa5695f756b9b464e6ae80ab4af8a45b`、包SHA `b721f079c9a39f40d4d699904160b1a09ca3570eb5fcb512c071f355eff4e851`、1136585B，metadata03b800d2，bootstrap526882bb/6390B不变。有限失败诊断只含phase/cause/异常类型/HTTP状态/SDK版本等10字段，不含URL、消息、headers或凭据。两套各30项helper及实际SDK集成、独审、客户端933项闭包和Linux冷验通过；930继承文件保持。API、前端、中控/Nginx、DB身份/schema均不改。新5a9机器实际更新另行取证。

后续公司台式5a到诊断包的限定一次性入口源保存在 `company-mcp-oauth-diagnostic-update-20261018/`，27项无监听测试及冻结器通过；只为取得真实失败原因，不声称已修复未知根因。新任务OAuthWait CREATE-only、fresh持有句柄只停空闲原daemon根、旧Scope任务/Plan/archive只读，保留全部历史。源码先推后新增不可变官方入口，实际执行继续记录。


17:53:24，新一次性官方更新已自动完成。源359def0b成功且root/tree退出0，实际Company心跳确认build5a9c550c、PID21596、17:53:18.598，全部旧历史保留，无需用户终端。此前注册入口a8b414279c9a/76404B已先推GitHub、单次发布并公网原字节核验。

长期授权源码在私库`jinjinli226-netizen/ai-viral-library`，082390c4767db1f0caa4261e60e5fe33831a7476已推main与codex/long-lived-mcp-grants并精确回读。该库以实际65b源文件c1b62导入基线，不伪称找回原Git历史；不含生产数据库或凭据。显式新授权可选until_revoked，旧有限期保持、access仍15分钟，refresh无日历到期且保留旋转/撤销检查。64项本地纯测试、类型和构建、独立源码审查通过；Linux隔离真实OAuth接口联合70/70，未打开生产数据库或更改服务。发布器和schema v2兼容回退还在独立验收，生产未变、TK grant尚未创建，不能称已接通。


18:12长期授权首发布attempt lifetime-publish-082390c4767d-73beee48在完成三库SQLite一致性备份后切候选，进程校验SERVICE_PROCESS_MISMATCH失败；不能当部署成功。真实原因是copytree只保mode不保属组，原root:996/0640入口成为root:0/0640，服务用户无法读取。原记录和候选/回退树、全部失败回执保留。原数据库inode/schema保持，OAuth尚未迁移。随后以confirmed-empty状态及schema1执行限定恢复：先切精确65b，因自动重启限流一次start被拒；只读明确rate-limit后，仅reset-failed本unit并正常start一次，原服务PID438574/应用438581实际恢复，三库原inode及schema1、本地/公网健康、issuer/PRM/MCP401和其它项目保护全部通过。未restore/更换DB，未改sidecars（实际均996/0600）。

当前补做精确代码metadata继承以及实际viral-library服务用户的低权compiled HTTP验收，准备新独立reconcile attempt；不会重跑或覆盖73be原失败。TK外部身份ece070fd-02bd-4a4a-b20f-a27ac91c1c17已在管理员网页创建一次，当前0连接、grant仍未提交。


18:24:48，新独立reconcile-25902d48成功上线同一Git082候选b330843b，主PID439374/应用439384。元数据逐文件继承原root:996与权限，新增JS沿原资产；原BASE和node_modules未改。停服前真实996账户完成入口/npm读取与候选/兼容回退两组synthetic compiled HTTP，通过后才新取三库SQLite一致性备份并切换。schema2迁移成功，三库原inode由新应用FD实际持有；本地/公网/前端hash/issuer/PRM/MCP401、其它项目和官方Windows均通过保护核对。原失败73be回执保留，未restore任何数据库。

18:26新UI连接只提交一次，原native5417934d、keyf8afca15；管理员已按用户本轮要求选择TK独立身份、阅读与采集、直到手动撤销。18:27:13原native成功、根16092与tree退出0，requested/granted两scope均确认；真实紫薇卡片显示已连接9工具。独立RO确认grant6a50984b principal/client精确对应，expires/revoked均NULL，refresh聚合1条未消费且expiry NULL，不读token/hash。当前永久授权已真实持久生效，但尚不据此声称业务聊天工具已加载。新真实模型只读三工具验收源6943a761于18:30在原聊天派一次，结果继续记录。


18:33:13，真实TK查询源6943a761成功，root3468与tree退出0/active0。原生请求回执openai-codex / gpt-6.1-sol / max匹配，8次native_codex_transport request；模型沿本机Profile选择。原CLI阶段直接记录三项mcp__viral_library工具执行及完成，另有tool_describe与execute_code内部工具。当前原回复明确三项读取成功、7平台/12赛道，前三为AI工具/AI绘画/AI视频；read/collect均true，未继续业务。服务器未保留原tool-role结果体，数字标为本轮原回复，不伪造独立结构化结果。真实网页主聊天已显示完成回复；连接9工具，授权直到撤销。本次接入及真实模型读取验收完成。未等待15分钟后真实刷新，不把合成长闲置回归说成现场已刷新。

爆款库最终实测文档已推私仓main与codex/long-lived-mcp-grants，两ref均1603dde3eb72e9249d1adfe987583561d56cfc3e；相对部署源082只变文档。
