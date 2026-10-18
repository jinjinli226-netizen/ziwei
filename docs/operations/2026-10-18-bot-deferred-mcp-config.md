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
