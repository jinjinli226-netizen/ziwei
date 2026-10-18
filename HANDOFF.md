# 紫薇项目 HandOff

## 2026-10-18 18:43 TK 爆款库长期授权与真实查询完成

爆款库产品082390c4已先推GitHub后发布。当前候选b330843b，主PID439374/应用439384，OAuth schema2，原三库inode保持、没有restore。初次克隆丢失属组导致启动失败，已恢复原服务后以独立reconcile修复；原失败73be保留。真实996服务账号候选/回退两组HTTP通过，兼容fallback8834090a保留永久授权，不能直接回65b代码或恢复旧库。

TK独立principal ece070fd-02bd-4a4a-b20f-a27ac91c1c17 / grant6a50984b已按用户要求在管理员网页授权read+collect、直到手动撤销。原native5417934d成功/tree0，两scope实际确认，页面9工具已连接。只读证明grant和refresh均无日历到期；不读取token/hash，其它旧授权未延长。

真实聊天源6943a761用openai-codex/gpt-6.1-sol/max完成，3项原生爆款库工具执行/完成有CLI证据，原回复返回7平台/12赛道，root3468/tree退出0。数量来源为本轮最终回复；未伪造服务器缺失的原工具结果体，也未等待15分钟后现场刷新。授权与实际模型读取验收已完成。私仓最终文档1603dde3已推main和codex分支。

紫薇API仍acee34d/PID429489，前端/中控/Nginx/官方client均保持。公司台式诊断build5a9c550c/PID21596、原r4/e7及专属Profile/HOME保持，无需用户终端。此前未批准前较早退出的底层cause未复现，不声称已经定位那个未知根因；本次真实授权成功。详见本轮operations与QA；下方均为历史快照。

## 2026-10-18 17:25 当前现场与后续工作

当前API为acee34d目录 `/opt/ziwei/releases/windows-mcp-scope-acee34d32f04-bdc0ae98/v2`、PID429489；官方客户端5a642107，包e386b28a，bootstrap526882bb逐字保留。公司台式已通过单次官方任务自动更新，实际PID23428、09:00:06Z新build心跳。TK仍原r4/e7及专属Profile绑定。

新d06c自助延期已真实成功提交并验证，但原连接267450b8在relay/start499后失败/tree退出。随后等待普通详情完整加载后，在既有MCP卡片只点一次连接：2ea28006实际发布read+collect授权页，9项工具可见，原生callback曾连续19次200；但09:11:56Z在未获用户批准前返回MCP_OAUTH_CONNECTION_FAILED/tree退出。未创建爆款库员工身份或grant、未做实际工具查询，不声称接通。旧页面已关闭。

用户现明确要求本次TK授权长期有效直到主动撤销，替代90天；正在爆款库actual65b源码隔离实现，保15分钟access自动续期及撤销/停用/轮换重放保护，不延长其它旧grant。现有本机两套Hermes原生315/300链已通过虚拟120秒等待，未复现现场较早失败；追加有限安全诊断候选区分实际phase/cause/SDK，不能把未明根因称已修复。详见本轮操作记录和更新的现场QA。

## 2026-10-18 16:50 MCP 显式权限范围兼容候选

TK 的90be验收已通过自己提交、自动验证及网页授权handoff。管理员登录期间旧flow到期并明确失败/tree退出；用户现已登录爆款库，但尚未选择员工身份或批准授权，未完成实际查询。配置请求read+collect，实际SDK却按challenge仅申请read；两套真实Hermes源/SDK已复现并验证窄修。候选保留显式scope、目标Profile令牌及原生PKCE，并在服务端显示实际授权范围证据；已有只读grant不删除、不假称已升级。39项服务端回归、两套各26项helper及真实SDK集成通过。后续先推GitHub、再发布API/Windows，确认公司台式实际更新后重做完整授权及只读查询，下节为此前发布快照。

## 2026-10-18 Bot 本轮结束后自动应用 MCP 配置已发布

主发布分支和 `codex/bot-deferred-mcp-config` 已包含 `0d26bbe` 的持久延期机制及 `fbb52e2` 的 Windows OAuth/管理回执修复，均先推 GitHub 再发布。当前 API 为 `/opt/ziwei/releases/mcp-relay-followup-950f4df2a23f-8304d4c7/v2`、PID 426944（da35省略管理头像，950f4df仅将MCP状态内部读改管理摘要）；官方 Windows 包 build `88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e`。首轮 200 项回归、追加 55 项联合回归及 lint 203 项通过，生产混合树、前端、中控、数据库身份和数据保留。

TK 已用真实模型在自己的本轮提交延期意图，本轮退出后自动保存 `viral_library` 配置、原生验证成功并恢复启用，r3/e5 → r4/e7；无需用户或其他员工手工保存。首次连接真实返回 Windows 事件循环被 OAuth 监听守卫误拦，已修复并发布客户端包。配置成功和实际连接分开记录，尚不能仅凭发布包称 TK 已连通。

公司台式正做无用户终端操作的单次更新验收。Node/npm prefix、Windows 状态备份和 Task Scheduler 账号名/SID 等价校验已逐项修复并由现场回执证实；同名任务随后进入等待空闲，但普通停止仍被维护扫描器 ACTION_STATE_CORRUPT 汇总代码阻塞。该代码不一定表示 JSON 语法损坏。公司台式限定的一次性空闲根进程停止/官方更新入口已通过24项无监听测试和独审，源码5778b69先推GitHub后发布不可变官方入口（SHA33a4bece）；保留历史记录、不补造业务退出。公司台式已实际完成更新：15:44:34开始上报目标88b2ea9f客户端、新PID9784和新鲜心跳，TK原r4/e7 active及专属绑定保持。首次417c重验get超时且未提交update；定位管理回复夹带794807字节内联头像后，da35d3a经42项回归/独审先推后发布，仅省略管理头像，保持网页/数据库原图。417c复验真实成功排队并自动原生验证；新原生授权26adb在relay/start访问中明确失败/tree退出，Nginx记499。发现状态轮询仍每tick取100份mobile完整历史，950f4df经57项回归和独审先推后发布四处读取窄修。正在以新标识90be复验实际授权连接，未声称爆款库已接通。详细原动作、发布与后续验收见 [本轮操作记录](docs/operations/2026-10-18-bot-deferred-mcp-config.md)。

## 2026-10-18 Windows默认不限轮数与真实并行验收通过

李金晋电脑已安装12d5aa9新包，build `161cc99010d6cdee4e3d8834135ac2ed4e8fb2031b746755b7d53de0b76dfb0b`、PID34836。闲鱼运营大神r7默认不限轮数的本机配置验证通过，实际有效轮数9007199254740991、预算86400秒，无需重建或逐个开启。

11:29–11:32（北京时间）在同一电脑给闲鱼运营大神与知微发独立无业务操作测试，均通过真实openai-codex/gpt-6.1-sol请求执行终端等待。只读取两份本次原生Session的terminal工具消息，工具运行区间交叠45.3943362秒，QPC独立印证；根PID2632/31616各在对应工具祖先链，两棵Windows Job树均退出0、无残留。两Bot保持原r7/e17及r3/e10和独立Profile/HOME。未操作手机、店铺、外部消息或旧任务，也不将本次短测试声称为连续24小时或超过100轮验收。

证据摘录见[真机验收记录](docs/qa/2026-10-18-bot-unlimited-parallel-live.json)。本轮未发布服务端新代码；通知App会话已获串行发布窗口，其API后续变化以该会话记录为准。下方“Windows待升级”是此前发布时快照。

## 2026-10-18 Bot默认不限轮数，移除开关已发布

产品12d5aa9已先推GitHub两条发布分支，再上线API/网页和官方Windows包。旧Bot及新Bot普通聊天默认不限轮数，已删除开关和单次轮数输入，保留24小时、手动停止、并行、Goals/Kanban独立预算和Profile/HOME，不需逐个员工重新保存。112项回归、lint192项及14项上线校验通过。API目录 `/opt/ziwei/releases/default-unlimited-12d5aa9f6d62-3f149f60/v2`、PID409294；CLI build `161cc99010d6cdee4e3d8834135ac2ed4e8fb2031b746755b7d53de0b76dfb0b`。李金晋电脑仍为旧623d5585，安装新包后下一次执行生效；尚未宣称真机已更新或完成真实长跑。详见[默认不限轮数记录](docs/operations/2026-10-18-default-unlimited-turns.md)。下方可选模式为历史版本。

## 2026-10-18 不限轮数与并行执行已发布

产品 `d45317011235f38c0f1b5b2f2e60eff322338135` 已先推GitHub，再发布网页、API配置校验和Windows客户端。当前API目录 `/opt/ziwei/releases/unlimited-parallel-d45317011235-55597409/v2`，PID407909；CLI build `203fe63c886b4a98ef510a6302c84c6291f9eb66f095ed42549c4f0d9e903116` 同时包含不限轮数及df2跨员工并行修复。网页高级运行设置可选“不限轮数（最多24小时）”，保留单次24小时和停止。旧Bot配置不自动变化。

服务端只更新 `src/hermes-bot-config.mjs`，原API混合基线的runtime/adapters/启动证据模块保留，不可用整份Git旧树盲盖。14项正式postcheck通过，数据库、MCP、恢复回执、其他服务和下载保持。Windows旧客户端尚需实际更新，新build心跳及模式启用/真实模型并行验收仍待现场完成，不将下载发布称为电脑已生效。完整证据见[发布记录](docs/operations/2026-10-18-unlimited-turns-and-parallel.md)。下方为历史状态。

## 2026-10-17 20:58 手机功能隔离集成与数据兼容回退已推 GitHub，尚未发布

正式产品继续保持下节4f26客户端/网页与9393 API。本轮没有部署服务器、更新员工电脑、
执行真实员工/手机/群组业务，也没有重打包或公开Android APK。

隔离集成分支 `codex/mobile-features-integration` 已实际推送 `14f1979fb0157e2e4e5889eef5a66e4d1b538d75`：
以8629091为基线完整合入已审查20da历史，只取Android ab5045a的固定mobile-manager
子树fbb6cf70与指定3份文档。12个shared路径、67个Android文件和其余698个基线
文件经逐blob/mode核对；保留原MCP、4f启动前证明和网页轮询，未整合Android旧backend分支。
最终624项定向Node、12项Python官方存储、125项JVM规则通过，lint185与网页构建通过。
旧导航测试夹具漏传真实polling helper的失败在原基线同样复现，修正夹具后67项通过；
原失败记录保留，产品页面代码没有因此修改。

数据兼容回退分支 `codex/mobile-data-safe-fallback` 已实际推送 `a942f3635517d33989b1cfb1b0f1b5dc6cc09406`：
唯一运行时变化是repository，保留可信任务创建/实际改派证明、unresolved/unassigned
失效marker、原子事件和公开字段隐藏；不新增feed、路由或schema。真实临时数据库
新版→回退版→新版11项往返通过，含旧writer ABA负对照、私有别名接管、原proof保留、
原子失败与公开HTTP/SSE隐藏，独立审查和主控重跑通过。此为隔离源码/数据验收，
不是生产切换回退证明；不能用未修复旧版替代或回滚业务数据库。

仍待实际API/Windows能力联调和准确code10 APK正常联网验收。准确APK cc2d17…
本轮未变，原模拟器baseline/code10同TLS失败不算通过；不得据本轮公开APK/二维码。
知微历史缺失回执也未被这次验收补足。完整记录见[手机候选审查与发布条件](docs/qa/2026-10-17-mobile-features-candidate-review.json)，
其中链接到两个已推送分支的固定验收记录。下方为历史发布快照。

## 2026-10-17 19:16 启动前误判与待核实聊天刷新修复已发布

产品 `4f26f450e6e1bcba6326fdaedd75937364eb5189` 已先推 GitHub 主发布分支，
再于 **19:15:37 / 19:16:58（Asia/Shanghai）** 发布官方 Windows 安装包和网页。
客户端 build `6067d6462aeb7d7752430bf6c21145aec59d78d84aa2e491c191c217e6df15b5`，
包 SHA `0bf1a8159040f3d37d38ee8aaee31d474cb993c07d4c08c1d8929db1f9a7aa7e`；
网页主入口 `index--E4XPmCF.js`。API仍为下节9393完整树/PID366044，没有重启服务
或修改数据库、员工、Profile/HOME；保留24小时预算、MCP与手机功能。

新客户端在可信bot-start最终spawn前被明确拒绝时，保存绑定原动作的一次性
未启动证明，正常结算释放原占用并保留暂停；已启动辅助进程仍按真实树监督。
网页直接进入待核实聊天及浏览器Back返回同一聊天后，会继续GET等待回执，
有明确终态后停止轮询。142项最终串行回归、独立源码审查、5项真实隔离浏览器
验收和57项发布工具离线检查通过；服务器冷缓存安装、公开包/网页及保护状态校验通过。
19:19独立复核19项保护检查通过，公网CLI、13项前端清单、56个旧assets、API/
中控/Nginx身份、数据库身份/逻辑schema和内外健康均保持。

**知微的历史 `action_2805b4da-c082-49a2-b0f1-b43bdeb107fe` 尚未解除。**
原任务缺乏可恢复的终态/退出证明，不能把一次409、设备在线或发布新包当成
历史进程退出。已请求李金晋电脑一次只读原始状态输出；不得直接改数据库或
伪造终态。19:19:34李金晋电脑仍上报旧build `7b4939c2…` / PID21480；原动作
仍只有2条原事件、processExit:null、员工r3/e8暂停且原占用未释放。安装包发布
不代表电脑已安装，Windows更新和现场验收仍需另行确认。
完整现场、测试边界、发布及保留数据回退见[启动前回执记录](docs/operations/2026-10-17-bot-prelaunch-receipts.md)。下方为历史快照。

## 2026-10-17 18:06 移动运行记录重复图片减负已发布

产品 `9393dcb0aab1c7afeacf368c7205f300264fa69e` 已合入并先推 GitHub 主发布分支，再于 **18:06:21（Asia/Shanghai）** 发布 API。当前 `/opt/ziwei/current` 为 `/opt/ziwei/releases/mobile-runs-projection-9393dcb0aab1-e0f199eb/v2`，API PID `366044`。复制下节完整 MCP 正式树，仅覆盖 `backend/mobile-read-view.mjs` 并增加发布记录；网页仍 `6666a63` / `index-DI_NO0_n.js`，官方 Windows 包仍 `6666a63` / build `7b4939c2…`。

移动运行记录中的明确图片槽改为元数据；同样用于 latest/Stop 和聊天 execution，保留完整报告、提示词、消息 ID、全部终态及最后事件、执行/停止证明。默认网页/MCP、原数据库图片和聊天鉴权图片通路保持。**当前0.2.1 App无需重装即可受益；这不是已经保证所有网络都不超时。** App一分钟读取等待由App分支另行交付。

主发布树78项相关回归、lint178、独立27项复跑/源码审查，以及25项发布器、8项发送检查通过。18:07独立18项生产复核通过，8个MCP源、旧发布记录、全量网页/CLI、数据库逻辑schema/文件身份、中控/Nginx均保持；内外健康200。固定现场同输入投影五条运行 `419,971 → 134,273 B`（减68.0%），聊天execution `258,244 → 17,138 B`，latest/Stop与控制字段保持。这是只读重建视图统计；当时active为空，不冒充手机网络计时或进行中任务跨发布的真机证明。完整弱网边界、发布和回退见[运行记录减负记录](docs/operations/2026-10-17-mobile-runs-timeout.md)。下方为历史快照。

## 2026-10-17 17:43 Bot MCP 远程网页授权已发布

产品 `6666a63b46cd783d6a6537dd3295b37619ba4afa` 已先推 GitHub，再依次于 **17:34:11 / 17:41:37 / 17:43:53（Asia/Shanghai）** 发布 API、Windows 安装包和网页。现有 Bot MCP 页面支持远程 OAuth：中央保存公开配置，精确下发到员工宿主，管理员在自己的浏览器批准，目标 Profile 使用原生凭据存储、复用与刷新；下一次执行自动加载。修复服务名、工具集清单和设备 bootstrap 范围。

当前 `/opt/ziwei/current` 为 `/opt/ziwei/releases/remote-mcp-oauth-6666a63b46cd-a5b46d87/v2`，API PID `364287`；网页入口 `index-DI_NO0_n.js`；官方客户端 build `7b4939c27eb485e0a1eff0635a698eb64b088dbff8ced84391ce1e87889bc212`，包 SHA `b2515f91a7d433d2acb43529a5a14ed21b6137ba4bead7dc1533cac40d4a2da9`。保留此前移动聊天图片、同步、转发与目录修复；未恢复旧数据库，未更新或停止任何 Windows 员工。

**发布安装包不代表现有电脑已更新。旧客户端尚无网页远程升级入口，必须先完成一次更新；此后接 MCP 无需到员工电脑改 YAML、复制 Token、运行登录或手动重载。真实 Windows 员工、Team Planner / 爆款库账号授权及查询仍未验收。** 综合153项回归、另1项登记HTTP合同、9项隔离UI和两套原生SDK模拟传输验证通过；安装包冷缓存与服务器离线安装、发布公网哈希及保护状态验证通过。完整边界、证据与回退见[远程 MCP 记录](docs/operations/2026-10-17-remote-mcp-oauth.md)。下方为历史快照。

## 2026-10-17 13:43 移动聊天图片独立加载已发布

`9668962e1c16d3ee3b11ba9ef33bf95c4ad5842b` 已先推 GitHub，再于 **13:43:13（Asia/Shanghai）** 发布。移动聊天历史的普通图、转发图改用同源鉴权地址，文字记录无需每次携带整段图片。原图、消息、员工配置及默认网页/MCP 响应保持。上一 `0da5581` 的移动 Bot 历史事件减负也已保留。

当前 `/opt/ziwei/current` 指向 `/opt/ziwei/releases/mobile-images-9668962e1c16-1204ed1a/v2`，发布 PID351449；独立复核源树、发布前保护摘要和内外健康200通过。网页仍 `ed499103`，Windows包仍 `5db7d83`，无需更新 Windows。63项相关回归、lint170和独立审查通过；App另验8项真实隔离浏览器图片兼容。样例普通图 JSON 约1MB降到1.3KB，重复保存图片的转发约2MB降到2.5KB；这些不是生产网络计时。

安卓 code7 已支持图片URL；App分支 `f270f10` 的 `0.2.1-internal` / code8 于14:02:25公开发布，可[下载覆盖安装](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.2.1-internal/ziwei-manager-0.2.1-internal-code8.apk)。新包修复缓存与切员工后旧请求取消；213项App单元、52组浏览器及另8组图片兼容通过。原账号模拟器中，闲鱼连续轮询、旧图缩略/放大、TikTok跨70秒同步及后台返回均通过；不是实体手机验收，不声称所有网络超时已根治。主控匿名复核Release和APK digest `fe81bd91…d97678`。发布曾遇到 SQLite 内部计数器误报，已只读验证并修正发布检查；未回滚或覆盖业务数据。

接口、测试、发布证据及保留新数据的代码回退见[移动聊天同步记录](docs/operations/2026-10-17-mobile-chat-sync.md)。下方为历史快照。

## 2026-10-17 12:24 聊天记录转发与共用已读接口已发布

后端 `069b128c29248ec72094019e76bf49dc0b2964d5`、网页 `ed4991036a46a855f091f2913b959dc4a3c95cf8` 均已先推 GitHub，再分别于12:22:53和12:24:13发布。网页可单条/多选合并转发图文到已有员工，默认只保存记录；用户明确选择执行才派任务。新增轻量聊天列表与按用户已读游标供网页/安卓共用，私有员工访问范围保持。成功后可直接查看接收聊天。

当前 `/opt/ziwei/current` 指向 `/opt/ziwei/releases/chat-records-069b128c2924-7a6f44a8/v2`；保留下节目录修复及现场移动接口。数据库只增加两列、已读表和索引，正式迁移前后原数据及消息 rowid 摘要一致。Windows包仍 `5db7d83`，本功能刷新网页即可。后端35项相关纯测试、网页回归、lint/build通过；隔离浏览器完成真实图文转发和接收展示，未在生产员工中派发模型任务。

后续安卓 `0.2.0-internal` / code7 已由 App 会话发布：[GitHub Release](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.2.0-internal)。源码 `2ce1383a1cbe46737ea53cb56b9960c8f7cfccba` 先推 `codex/android-manager`，APK SHA-256 `5a4b2a4a74b268a60dfb78c898beb31290881ba98bbc7cfec8c14a8c307059ff`；沿用签名可覆盖安装。193项App单元、35项后端合同、50组浏览器流程通过，最终包在原AVD保留登录/历史并验证长按与转发确认页；未在实体手机验收，也未向真实员工提交转发或执行。安卓发布不再切换主站。

API合同、版本证据、验收边界和保留新数据的回退方式见[聊天记录转发发布记录](docs/operations/2026-10-17-chat-forwarding.md)。下方为历史快照。

## 2026-10-17 10:52 执行中目录检查与主聊天入口修复已发布

产品 `51e2a25538ea24691c60baf7a8064b9adde8bc5a` 已先推 GitHub，API 于 10:52:42、前端于 10:52:51（Asia/Shanghai）发布。执行中的 Bot 可并行进行只读目录检查，不占用、覆盖或释放原任务的 `active_action_id`；创建目录、实际更改工作路径仍受忙碌状态限制。主聊天入口立即设置目标员工，背景列表不能抢占，用户主动切换仍可取消，加载失败也保留正确员工归属。目录权限、设备、revision/control epoch 与封存检查保留。

最终57项后端、76项前端纯测试、lint、构建及独立审查通过。正式 TikTokTrendS 两次目录读取成功，最新 `action_2729cfe1-8880-49d9-8cfa-c0c30629993e` 约8.6秒返回 `D:\AIUSE\TikTokTrendS`、3个盘符、5个子目录。知微在最终前端 `index-Bs9eeNY3.js` 上也读取成功：`action_f093db74-9810-49cc-bd5b-024ad1406106` 约5.9秒返回李金晋电脑的 `D:\AIUSE\friend`、2个盘符、0个子目录。没有保存路径或发送模型任务。知微最后检查时原任务已结束，执行中并行由真实调度器回归验证，不能称为本次已完成并行实机验收。

本次 API 仅替换 bots/repository/version-preservation 三个文件，保留 `77bb58a` 的目录鉴权和轻量 state 查询性能修复、现场移动接口及既有修补；前端单独发布。官方 Windows 包仍 `5db7d83`，无需更新客户端，刷新网页即可。发布、备份、回退及测试边界见[目录绑定修复记录](docs/operations/2026-10-17-chat-directory-binding.md)，下方记录均为历史快照。

## 2026-10-17 09:36 聊天目录绑定卡住修复已发布

前端产品 `9ba205d68ea1c50bc93118f0780335a6394da808` 已先推 GitHub 后发布。聊天详情刷新不再反复重启 Bot 绑定查询，首次主聊天加载失败可以清除 pending，切员工/账号/工作区或离开聊天后的迟到结果不会打开错误目录弹窗。打开已配置 Bot 的目录时定向更新版本，设备默认路径保持。

37项回归、lint、构建及独立审查通过；正式页面中 TikTokTrendS/公司台式和知微/李金晋电脑均成功打开并读取真实目录。未切换路径或改变私人可见权限。仅更新前端，API仍 `eabe098`、官方Windows包仍 `5db7d83`，无需更新客户端，刷新网页即可。详情与回退见[目录绑定修复记录](docs/operations/2026-10-17-chat-directory-binding.md)。

## 2026-10-16 17:15 Bot 头像编辑器前端修复已发布

最终产品提交 `bf35c45fa2499c04da3f5e415366f0668e6e2538` 已先推 GitHub 后发布，包含首轮 `bb76005` 和子组件按钮样式补齐。Bot基础配置头像改为80px（窄屏64px）预览＋更换/移除按钮，隐藏误导性的原生文件名，明确待保存、已保存、保存待确认。读取期间禁保存，切换员工时取消旧读取。26项回归、构建、lint及浏览器375px与交互验收通过。

仅更新前端静态文件，API仍为 `eabe098`，官方Windows包仍为 `5db7d83`，服务未重启、数据库未迁移。**刷新网页即可，电脑不用更新客户端。** 前端版本以 `/FRONTEND_RELEASE.json` 为准，保留旧chunks和首页备份可单独回退。详见[头像编辑器发布记录](docs/operations/2026-10-16-bot-avatar-editor.md)。


## 2026-10-16 12:57 公司台式更新阻塞修复已发布

公司台式仍运行 `993639eb…`，升级 24 小时客户端时被 `ACTION_STATE_CORRUPT` / HTTP 409 阻塞。根因是旧版允许正常 CLI 完成后留下后台进程，而维护扫描又将该合法历史当成文件损坏：原动作 `action_5b4dc026-2a9e-45db-8169-a08086e6e525` 的 root/host exit 均 0，treeConfirmed=false、activeProcesses=1。不能宣称这个后台进程已退出。

已先推 GitHub 产品提交 `5db7d834deaf3524adfada59a434bc764fda750a`，再于 12:57 发布官方 Windows 更新包，build `208f2350ff390bbf7506e6baaef60eb7c8d467f2c8630a86c670ce01aada1044`。新增精确后台完成分类与旧版更新恢复：仅停止闲置、身份绑定的原 daemon，保留后台程序、Profile/HOME、配置和原回执字节；不伪造整树退出。真实损坏/在途/隔离/未知 Gateway 等仍拒绝。

**用户再运行同一官方更新命令即可，无需先 stop、手工编辑状态文件或重建 Bot。新包包含 24 小时修复；公司台式实际升级仍待新 build 心跳确认。** 本轮仅更新客户端，主站/API 继续 `eabe098`；中控、Nginx、数据库和服务进程未变。详见[后台历史与更新恢复](docs/operations/2026-10-16-background-stop-recovery.md)。


## 2026-10-16 12:14 长任务默认 24 小时已发布

用户明确要求取消原 15 分钟上限。已先推 GitHub `codex/v2-20261014-release` 的 `eabe098af3b6c0e7d76cf4121052e3606e022888`，再发布主站/API 和 Windows 客户端包。生产目录 `/opt/ziwei/releases/v2-hotfix-eabe098af3b6/v2`；新客户端 build `ba86b25db751ac6322d74c6c7e1353a7984b69d5a18a97c7e87beee46c6f195a`。已包含 E04 主站 `891685f` 的手机回执和终端诊断修复；本轮未修改中控/Android。

执行硬时限、服务器租约、Hermes 软预算、Gateway 结果等待和手机执行授权已同步。默认单次原生模型执行最长 24 小时，手动停止、显式较短 timeout、轮数预算、退出证据与去重仍保留。安装/维护和单条手机命令不随之变为 24 小时。141 项回归通过、1 项 Windows 专项跳过，构建与离线依赖检查通过；这不是已经连续运行 24 小时的实机结论。

**服务器发布不会更新已经运行的 Windows 客户端。公司台式需要用官方 PowerShell 更新入口升级，确认新 build 后再次发起任务；旧进程已启动任务的 15 分钟计时不能追溯更改。** 无需重建 Bot/Profile/HOME。根因、发布校验、测试边界、回退见[24 小时执行记录](docs/operations/2026-10-16-24h-execution-budget.md)。下方为历史记录，以本节为当前主站/客户端版本。


## 2026-10-16 11:15 手机输入与自动恢复修复

主站/API 与官方 Windows 客户端包已发布 `891685f70e9e4bfc2c56821ee2cc9a28a356f548`（分支 `codex/android-stability-main`）；当前 `/opt/ziwei/releases/v2-hotfix-891685f70e9e/v2`。客户端 build `6b8449d9…`，包 SHA `4d993a13…`；发布包不代表电脑已安装。中控私有仓库 `ziwei-system` 的 `8be4604`（分支 `codex/android-input-lifecycle`）也已发布，当前 `/opt/ziwei-control/releases/phone-stability-8be4604f2938`。

已修原命令自动回查、底层 cause / 详细总结保留和重复业务动作保护，补正式终端运行诊断。Android 已修安全焦点与中文读回、超时门禁、退出诊断、停止意图、伙伴退避、升级阻塞心跳和日志主线程负担；76/76 JUnit、50/50 中控集成、72 项主站相关验证及构建通过。**手机仍运行 code15；code16 待原签名文件，尚未发布或实机验收，现场被杀根因未取得证据。** 用户要求正常故障由程序自动观察 / 恢复，不默认让用户逐次核实。旧回执、数据、APK 和 Nginx 保留。

完整证据、备份、回退和接续见[手机输入与生命周期记录](docs/operations/2026-10-16-phone-input-lifecycle.md)。本修复工作树 `/Users/zhangjie/Documents/ChatGPT/紫薇/.codex-worktrees/android-stability-main`；Android 树为同父目录 `ziwei-system-android-stability`。原主目录未提交修改保留。

## 2026-10-16 最新接手状态

### 10:00 更新：确认公司机使用新版 YAML，修正创建及工具配置调用

公司机已运行 `12932d5c…`，09:47 重试回执仍缺 `yaml`，且明确 `distlib-isolated / bootstrapBound=true`。上一版非 isolated 初始化修复未覆盖公司机实际根因。官方 0.22 使用 `hermes_yaml → ruamel.yaml`，紫薇创建和启用工具配置仍硬导入可选的 PyYAML，现已统一跟随已绑定原生 YAML 接口。

源码 `d915129bf45bbb555cb1a089593c9c9cdc940d59` 已先推 GitHub，再于 **10:00:28** 发布客户端。新 build `993639eb3840f257830c2fc8f1400339f2d3ad60a085ab27f4d547824f6b10f9`，包 SHA-256 `702c9027b04a67a23e918c8ce0da7ed727f2ea355f224eb015fcf8885bda2657`。41/41 回归通过；真实官方 PM 在仅有 ruamel、无 PyYAML 的普通及 isolated 入口完成创建/重试/读回，官方固定依赖 0.18.16 另验 5/5。主站/API 保持，服务未重启。

**公司台式仍需更新后实测，不能把离线通过称为 Windows 已成功。** 核对 `993639eb…` 心跳后重试原 Bot，直接读取回执，无需重建员工或安装 PyYAML。上轮测试人为补 PyYAML 的盲点已纠正，详见[原生 YAML 修复记录](docs/operations/2026-10-16-profile-native-yaml.md)。

### 09:43 更新：Bot 创建缺少原生依赖的修复已发布

公司台式已运行诊断版，09:28 的新建动作确认失败在 `native_imports / ModuleNotFoundError`、`import yaml`；用户确认 `hermes profile list` 正常。已修复紫薇非 isolated 创建入口绕过原生 bootstrap、漏加载 PM 依赖的问题，并增加受限模块名和启动方式回执。实际公司机的启动分支仍待新回执，不能将离线复现称为 Windows 创建已成功。

源码 `bb52bbe235aa0e5ab92d4f229021f01f6279ef61` 已先推 GitHub，再于 **09:43:17（Asia/Shanghai）** 发布客户端。新 build `12932d5c024d1bb36584a96f2e06c6d334f5cee5c74fd60fc4d73e8999f3550f`，包 SHA-256 `7b657cc60fb7f26cc4eb6767ef03f97d81896f086971049c153d48f8f1a8c13a`。主站/API 未切换，服务未重启。

最终 40/40 相关回归、真实官方 PM 依赖激活及创建/重试专项 3/3、独立审查、lint、构建和离线包检查通过。下一步在公司台式运行官方更新入口，确认 `12932d5c…` 心跳后重试**原 Bot**，读取新创建结果；无需重建员工。发布、测试边界和回退见[原生依赖修复记录](docs/operations/2026-10-16-profile-native-dependencies.md)。

### 09:24 更新：公司台式已升级，创建仍失败；诊断补丁已发布

现场已确认公司台式运行上一版 `74405c88…`、PID 1528。新员工 TiktokTrendSreach 的两次原生创建均完整退出，但只返回 `BOT_PROFILE_CREATE_FAILED`；旧代码丢弃具体 Python 异常，不能据此归因权限、代理或模型。

已先推 GitHub 再发布诊断客户端 `2fc97a9b4a3d860cc8b2bd642e981b820ea10c74`，build `9230ce66bbe603db79fc0d5f9936a977d61e1d68ea768da30111fa23579888dc`，包 SHA-256 `8258f8bfb0a7c880adf994f516f34c46228133cfe26c6fe3b82a39943db344a2`。固定失败阶段、异常类、Windows错误号现可回传并显示；清理失败不覆盖主因。主站/API 未切换。

相关回归和跨语言真实回执测试已通过；**创建根因仍待公司机升级到这版并重试原Bot后确认，不是创建已修好。** 下一步读取新动作诊断，无需用户重建员工或重登订阅。详见[创建失败诊断记录](docs/operations/2026-10-16-profile-create-diagnostics.md)。

### 09:02 更新：公司台式旧创建失败记录阻塞更新的修复已发布

官方客户端已更新到源码 `40cefe91672b62abe14b8348022e5116803f33de`，先推 GitHub 再于 **09:02:55（Asia/Shanghai）** 发布。新 build `74405c8827b7a1248c57fecfa45ab14f83890a27e5dd504525089785f9258509`，包 SHA-256 `99f6da3729ba51369e91a1ce5c1550d93421aac7fc4b4f2e1775ab87571815d5`。主站/API 仍为下方 `cd610444`；服务未重启，数据库未迁移。

公司台式的 stop 409 已定位为原 Hermes 创建动作 `action_a4ad606b-74ce-4a9e-afd3-e55722945cf4` 的 `UNMAPPED_NATIVE_EXECUTION`，并非待交付回执。新候选 updater 能对已审旧版本、精确失败和原进程进行核验，停止后保留恢复证明，使升级后停止不再被同一条记录卡住；未来纯解析失败也会正确记录未启动。更新错误现在保留实际阻塞原因。

相关新失败回归 137 项、历史恢复 71 项、更新诊断 20 项分别通过；12 项 Windows 原生测试未执行。官方旧安装包的模拟恢复通过，不等于公司台式已升级。请在该机重新运行官方 `update-windows.ps1`，核对新 build 后重试原员工创建，不重建员工或删除执行记录。两项扩展基线失败、完整恢复限制、发布和回退见[停止更新恢复记录](docs/operations/2026-10-16-prelaunch-stop-recovery.md)。

### 00:49 更新：PNG/JPG 误拒收兼容修复已上线

主站、API 和官方客户端现均来自 `cd610444ce793d6e5fbebfa7ed1b982c070ad9a3`，已先推 GitHub 再于 **00:49:35（Asia/Shanghai）** 发布。当前目录 `/opt/ziwei/releases/v2-hotfix-cd610444ce79/v2`；新 build `6de43142dce43675f6b8c8c56fd8d306eec0b0dcea8920091936c1b6c1a1b829`，包 SHA-256 `7d1a231f6bedd897baf314a9e66339f58abdb2fc8d695bffb535fd04dc49282d`。

修复完整 PNG/JPEG/GIF/WebP 末尾有附加数据时被误拒的问题，入站和返回图片共用结构识别，保留原字节；界面明确 JPG/JPEG，错误定位具体文件。三张真实图片的登录态 HTTP 发送、幂等、设备下发和回传逐字节通过；相关回归 313 项通过、8 项 Windows 专用未执行。用户截图中的三张原图未取得，不能断言其具体字节特征。网页上传修复刷新即生效；Windows 返回图片兼容需新客户端。公司台式原生创建和真模型多图仍待设备实际回执。

首次发布曾因 SQLite rollback journal 阻止只读备份及旧服务启动而出现 502，已保留原文件、让 SQLite 自动恢复并验证完整性，修正发布步骤后重新上线。公网健康、前端资源、下载元数据及包哈希均已回读通过。备份 `/opt/ziwei-staging/backups/image-container-20261015T164930Z`，完整验证、恢复经过和后续回退见[图片兼容记录](docs/operations/2026-10-16-chat-image-container-compatibility.md)。

### 00:24 更新：Hermes 0.22 启动器兼容

**公司台式 Hermes 0.22 创建 Bot 的启动器兼容修复已发布。** 源码 `528361d80bf7ac3976bff621cb9d5ac044129cb7` 先推 GitHub，再于 **00:24:43（Asia/Shanghai）** 更新官方下载包；新 build `c3ec583e44396579a8d4bd601061a62de69e184931adc22691917021fd1c3c48`，包 SHA-256 `0448b7baf714159007578f69601557de05ae5baac9539a44219d9c289bd304ca`。主站/API 仍为 `ead2ac9281c47624929f433bc190b44e2659498c`。

这次失败已定位在原生启动器识别：公司台式实际上已运行 `a996e94…` 客户端，Hermes 0.22.0 的 `--version` 成功；不能再沿用下方历史“CLI 探测超时”解释。新版本支持官方 distlib EXE 的 `-I` 和原生依赖初始化，修复 PE 中伪 shebang 的误命中，并保留独立 Profile/HOME。

73 项相关测试已验证，官方 v0.22.0 源码与 distlib 模板的实际 JS 创建、重复创建和配置检查通过。该原生验证在 Mac Python 离线执行，PM 依赖选择有测试替代，**公司 Windows 升级与实机创建尚待回执**。不将样本测试称为 Windows 真机成功。完整范围、发布及回退见[专项记录](docs/operations/2026-10-16-hermes-windows-launcher.md)。

下一步在公司台式 PowerShell 运行 `irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex`，核对新 build，再重试原员工 `employee_6479482e-0842-41ed-98b8-3dd944228a4c` 的创建；不重复创建员工、不覆盖原 HOME。下方 10 月 15 日各设备状态为历史快照，其他未完成事项保留。

## 2026-10-15 最新接手状态

**换电脑接手先读本节。** 下方按日期保留历史记录，其中“V2 未上线／方案中”描述的是当时状态，不代表当前生产。设备状态以各条标注的 2026-10-15 快照为准（Asia/Shanghai），接手后应重新查询。本文记录可复核的项目进度，不包含完整 Codex 聊天。

### 18:49 更新：历史回执阻塞停止与升级的修复已发布

源码 `6ddb51daa6090656a29cec5c09a3ba9d676c7ca5` 已先推 GitHub，再发布官方 Windows 包；新 build `a996e94aebec66b15636d526be8013746617950fab1858d4815720c7b93cb5f1`，包 SHA-256 `86525d20f9239af0a30e867ac3bd72dbc7fb81a1ad0f7e95c67cd048a37f6bcf`。主站/API、三个服务 PID、Nginx 和数据库文件身份保持；备份 `/opt/ziwei-staging/backups/retained-stop-client-20261015T104907Z`，官方包与元数据已公网读回核对。

已定位旧 stop 409：执行/轮询/隔离均为 0，但两条历史 blocked 回执使 strict safe=false。其中一条经原回执恢复 confirmed，另一条原员工已硬删除、原会话 employee_id=null，服务器拒收原结果。新版本独立计算允许停止的 stopSafe；真实完整退出的回执保留后可停，不伪造上传成功。为避免旧 stop 阻塞升级，官方下载入口含仅用于已核验旧空闲实例的恢复通道。[专项记录](docs/operations/2026-10-15-retained-receipt-stop.md)。

**李金晋电脑尚未确认完成本次升级。** 应在 Windows PowerShell 执行以下入口，由它下载新 updater；重复旧 `ziwei_user update` 仍会走旧停止逻辑：

```powershell
irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex
```

本次 124 项相关回归通过，12 项 Windows 专用测试跳过；真实 Windows 句柄退出/升级和后续 Bot 订阅调用仍需设备实际结果，不能以 Mac 模拟验收替代。新包已包含 17:51 的登录续期修复。

### 17:51 更新：Bot 登录续期修复已发布

客户端源码 `b78889c8696931e64fb255605845f8c680cb2314` 已先推 GitHub，再发布官方 Windows 包。真实失败原因是 `bot source authentication refresh required`：早期隔离代码拦截了原生登录续期写回。现已恢复唯一来源认证文件的原生持锁刷新，Bot 独立 Profile/HOME 保持，错误摘要也显示真正原因。[故障、修复与验证记录](docs/operations/2026-10-15-bot-source-auth-refresh.md)。

李金晋电脑在 **17:31 已升级至此前多图版本 `855e4fa…`，PID 8832**，不能再按早先“未升级”解释此次失败。本次新修复 build 为下方 `63c8cd…`，仍需运行电脑执行 `ziwei_user update`，再验收真实 Bot 调用。若原生回执报告登录失效，再重新登录对应来源订阅；不要重建员工或还原旧认证。

### 代码、生产与客户端

- GitHub 仓库：[jinjinli226-netizen/ziwei](https://github.com/jinjinli226-netizen/ziwei)，当前发布分支为 `codex/v2-20261014-release`；不要假定默认分支已包含这些提交。
- 最近主站/API 代码提交：`ead2ac9281c47624929f433bc190b44e2659498c`，已先推 GitHub，于 **2026-10-15 15:51:16** 完成服务器发布。客户端与交接文档可以领先此主站提交；17:51 和 18:49 的修复仅发布客户端，主站/API 未切换。
- 正式站：[紫薇](https://qzelynth.top)。服务器 `/opt/ziwei/current` 指向 `/opt/ziwei/releases/v2-hotfix-ead2ac9281c4/v2`。上一产品提交为 `0f54339e3714c9be579482932a6fc294d73d6cca`，该次发布备份在 `/opt/ziwei-staging/backups/bot-stop-20261015T075113Z`；数据库结构未变。本次保留上一版代码，不等于已验证可直接退回 V1.0。
- [官方 Windows 包](https://qzelynth.top/downloads/cli/ziwei-latest.tgz)与[发布元数据](https://qzelynth.top/downloads/cli/release.json)已经公网回读核对。预期 `clientBuild` 为 `a996e94aebec66b15636d526be8013746617950fab1858d4815720c7b93cb5f1`，包 SHA-256 为 `86525d20f9239af0a30e867ac3bd72dbc7fb81a1ad0f7e95c67cd048a37f6bcf`。版本号仍可能显示 `0.1.0`，必须比较实际运行的 build。

### 已完成与验收边界

1. Bot 与团队管理共用数字员工身份；Bot 主聊天、配置、原生 Profile/HOME、能力状态与手机 MCP 已有生产实现。早期方案和合同中的“未实现”不能直接当作当前功能清单；具体能力仍要检查当前配置及执行结果。
2. 手机读图已使用真实 Windows、真实 Codex 订阅 `gpt-6.1-sol / max` 验证：“闲鱼运营大神”调用“闲鱼1”截图并通过 `vision_analyze` 读取图片。发布后成功动作 `action_b6cba77e-b8d8-410e-9b89-624b22261b87`、截图命令 `device-command-92fa88bb-d2a2-490f-9c3b-8da23f960106`；描述的紫薇映界 Agent 页面与实际截图一致，附件回传成功。该验证只截图、读图，没有操作商品或发送消息。实现与此前验收详见[手机读图记录](docs/operations/2026-10-15-phone-vision-default-tools.md)。
3. 新建 Bot 默认启用核心工具与 `execute`，包含 vision；既有保存配置、显式空工具列表和仅对话设置不自动覆盖。外部服务仍需账号、设备绑定和相应配置。
4. Bot 主聊天和普通员工聊天已发布剪贴板粘贴、多图预览/删除与同条消息多图发送；每条最多 20 张、合计 10 MiB。Hermes 多图在执行内兼容层校验数量、原始字节及顺序，单图/无图入口保持。前端 226 项、真实 Vue 浏览器 7 项、运行时/附件最终回归 64 项通过，9 项 Windows 专用测试在 Mac 跳过；lint/build 通过。**Windows 真模型双图验收尚未完成**，不能把浏览器与运行时测试称为完整实测。详见[剪贴板与多图记录](docs/operations/2026-10-15-chat-clipboard-multiple-images.md)。

### 当前未解决的问题

| 设备 / 范围 | 已核实状态 | 接手时下一步 |
| --- | --- | --- |
| 李金晋电脑 | 本轮用户本机确认运行 `855e4fa…`、PID 8832，active/polling/quarantined=0、blocked=2。已定位旧停止逻辑混用了回执交付检查；一条回执恢复 confirmed，剩余回执原员工已硬删除。 | 用上方官方 PowerShell 入口升级至 `a996e94…`，核对实际 build、停止/升级结果，再验收 Bot 真实订阅调用。新包已发布，不等于该机已经升级。 |
| 公司台式 | 17:31 在线且运行多图 build `855e4fa…`。16:27 的探测记录中 Codex CLI 与认证/provider 就绪，Hermes 探测是 `cli_version_timeout / ETIMEDOUT`，3 秒限制；显示的 0.18.2 来自安装元数据，并非版本命令成功。Claude/Gemini 为未发现。 | 用户尚未回复手动 `hermes --version` 的结果和耗时。先确定慢启动/失败原因；版本探测不调用模型，不能直接归因代理。当前探测同步执行，不宜只把 3 秒改为长等待而阻塞心跳、停止与事件处理；应评估异步探测。此修复尚未实现。 |
| Windows 多图真模型验收 | 网页、服务端及多图客户端包已发布；17:31 两台电脑均已确认多图 build，但本次登录续期及停止修复仍须更新至 `a996e94…`。 | 在实际 Bot 绑定的设备确认新 build，再由真实聊天一次发送两张内容不同的图片，让模型按顺序分别描述，并核对同条消息与附件。验收前不要标记完成。 |

停止问题已定位并发布修复，Windows 现场升级仍待用户执行。没有清空原回执、重建已删员工或伪造业务终态；旧版恢复入口只在重新核实已空闲且回执完整退出时退出原客户端。Windows 重启与旧版再次自启动不能替代升级验收。

### 新电脑接手方法与继续工作的约束

有仓库权限的账号可直接拉取当前分支，在“紫薇”文件夹继续：

```sh
git clone --branch codex/v2-20261014-release https://github.com/jinjinli226-netizen/ziwei.git 紫薇
cd 紫薇
git status --short --branch
git log -5 --oneline
```

已有本地项目时先检查未提交修改与当前分支，再 fetch/切换；不要为接手执行覆盖式 reset。阅读顺序：本文件最新节 → 对应专项运维记录 → [项目管理手册](PROJECT_MANAGEMENT.md)及[历史 V2 会话台账](docs/handoffs/V2_SESSION_LEDGER.md)。

GitHub 可恢复已提交代码、提交历史和交接文档；完整 Codex 聊天、忽略的本地验证文件、服务器业务数据库、Windows Profile/HOME、登录态、代理和密钥不会随 clone 自动迁移。生产与设备访问权限另行配置，凭据不得写进仓库或交接文档。

- 产品改动仍按“验证通过 → 推 GitHub 并核对远端 → 从同一源码部署”执行；保留用户当前数据。本次文档同步不触发产品部署。
- 现阶段运行目标是现有 Windows 电脑持续开机；没有要求做 Mac 产品适配。“达到单次轮数上限自动续跑”用户明确要求先别做，仍暂停，不能擅自启动。
- Bot 模型使用现有 Codex 订阅与电脑代理，优先 `gpt-6.1-sol / max`，用户允许不支持时降为 `xhigh`；`ultra` 已被该 Bot 接口拒绝。研发 Codex 任务的模型设置与 Bot 实际运行配置分别核对。
- 本机 Mac 任何新增测试/预览监听服务都须先纳入用户的统一端口中心；接手文档更新不需要启动服务。
- 下方早期会话分工和仅预览要求是历史阶段记录；执行以当前用户明确要求及当前环境指令为准，不为旧台账机械创建新会话。

其他已发布修复可追溯：[停止与回执](docs/operations/2026-10-15-bot-stop-receipt-hotfix.md)、[员工强制删除](docs/operations/2026-10-15-employee-force-removal.md)、[能力状态](docs/operations/2026-10-15-bot-capability-status.md)、[手机能力状态](docs/operations/2026-10-15-bot-phone-capability-status.md)、[手机 MCP 身份](docs/operations/2026-10-15-phone-mcp-bot-identity.md)、[10 月 14 日发布交接](docs/operations/2026-10-14-r01-final-source-server-handoff.md)。

## 以下为历史记录

## 2026-10-12 V2 E02 同一员工的 Hermes Bot 后端候选

基线6eaf7de，隔离分支codex/v2-e02-hermes-bot。已实现Bot附加能力与统一员工身份、配置实际原生生效、Hermes连续聊天/同session恢复、Creator同后端MCP、单一automation Routine与不确定执行保护；普通现有Hermes幂等初始化保持ID和旧聊天，Creator不转普通岗位。候选只交本地预览，E03负责最终集成与唯一预览启动；不发布或更换正式服务/客户端。证据、完整能力缺口、独立Q步骤与启动参数见[交付](docs/handoffs/2026-10-12-e02-hermes-bot-preview.md)及[API](docs/contracts/2026-10-12-hermes-bot-api.md)。725全量、16专项、lint82/build1764和真实CLI+本地假模型两轮证据；外部模型、跨Bot/Gateway/语音/Goals/Heartbeat/Kanban、24小时耐久仍待后续接入/验证。

## 2026-10-12 V1 最终收尾已完成：Creator修复发布、本机升级及QA闭环

用户将当前进度和本轮必要修复定为V1终点，见 [版本边界](docs/releases/V1_FINALIZATION.md)，不启动V2新功能。324731e已推送；709/709、lint79/build1764、36文件Windows包及打包supervisor smoke通过。17:54:48仅官方三下载文件发布：Windows build7e2ae40a…、包1592d107…，独立公网回读及三服务/主站保护核验通过；本机18:19:57已按原连接升级complete，PID12132/ready=true，36文件和build一致，原配置/设备/认证/43会话及action-state保护通过。原观察器自行退出，新观察器36400绑定12132，两次心跳通过。

默认120秒静默不再立即判失败，总期限有界；取消等待executor与所属Job退出，未知状态保留去重、隔离和维护占用，已有结果可纯补传。原action447…已创建文档50c2…；员工c635…随后09:31已由user操作删除，保留当前删除状态，不重发消息或恢复旧数据。真实隔离Codex精确nonce/exit0/树为空通过，原harness的最后标签断言失败及独立复核分别保留。旧QA精确清理18:24:25恰删176，3941条其它主库记录/54控制记录保护及后置独立复核通过；5旧cookie401、6个精确空目录非递归清理完成。ThinkPad已由用户提供54a053…升级成功回执，其当前在线状态尚待独立status。详情和限制见 [本轮记录](docs/operations/2026-10-12-creator-idle-timeout.md)；后续功能按V2.0重新明确需求，不自动续做停止或受阻任务。

## 2026-10-12 Windows 早期协议升级接续

ThinkPad 缺四字段且无 pause/drain 的兼容路径已完成并发布：源码d01dc83，678/678、lint78/build、34文件Windows实装和真实d18121e四场景全部通过；官方包5c0fdb…/build54a053…于16:58:55上线，仅三个下载文件，三服务PID和主站保持。本机仍PID36264/c7b83…在线、观察器39608保持；ThinkPad须运行新官方入口后以该机真实回执确认完成。只读检查→明确YES→原proof精确停止→实际恢复核验；未知计数不填零，不承诺重启不会取得未完成任务。详情见 [专项记录](docs/operations/2026-10-12-legacy-windows-upgrade.md)，原QA清理安全点保持。

## 2026-10-12 当前接续：员工默认目录已发布，真实功能验收通过

GitHub分支 `codex/employee-default-workdir`，功能/前端/官方客户端 `274a418`，主API热修复 `a66df9c`，实际全局Windowsbuild `c7b83…`。主API181593/控制134533/Nginx737，本机原PID36264/独立观察器39608保持。员工默认目录绑定真实电脑检查，新会话保存快照，旧会话和HOME/记忆保持；正式默认字段仍NULL。

精确源码archive662/662、lint78/build、32文件实装、真实API/已安装MCP两工具/Edge长中文保存及重新登录/1440与390布局均通过。唯一只读Codex action9ad030… succeeded、退出0、精确标记，实际CLI33448父36264 PEB目录与页面/会话/action匹配，管理工具与手机动作0。原配置/auth/入口复验一致。

本轮QA清理在预检查安全点保留，尚无apply/删除；正式并发创建的员工、邀请、文档与会话执行均须保留，恢复时先重建比较基线。优先处理ThinkPad已确认的早期health协议兼容：33001实际HTTP200，但缺deviceId/clientBuild/activeActionCount/pollingCount，旧版无pause/drain，不能填0或盲目重试升级。本机25941无需再次升级/启动，已通过的功能无需重跑。服务端旧SQLite锁崩溃一次已记录并修复，控制/Nginx保持。详细状态见 [本轮运维记录](docs/operations/2026-10-12-employee-default-workdir.md) 与 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)。

## 2026-10-10 当前发布：Windows 本地工作目录

目录 inspect 与原生执行不再把 config.workdir 当唯一批准根；用户可访问本地 C/D 等盘，默认目录仅作起点及相对基准。两层统一词法/真实路径解析，修复相对路径重复解析和盘符简写；Windows ACL、设备/工作区、runtimeDir/附件边界保留，非 Windows 原规则保持。24 项专项及隔离 CLI 实际 cwd、旧 bigtron 客户端 C/D 错误已有证据。源码/官方包发布及用户实际更新分别记录，见 [工作目录运维记录](docs/operations/2026-10-10-windows-workdir.md)；不得据历史 disconnected 磁盘配置停止或重配对当前在线 bigtron 实例。

0349b91已从远端最新4c41c4a增量提交并推送，最新版检测/维护及ASCII脚本保持。完整479/479、lint66/build通过；北京时间18:20:38官方Windows包发布，SHAe2a446c6…、sourceBuild86228203…、Windows实际安装build7c2d47ab…，公开包/metadata/脚本均200。双库及原身份/保护行复核通过，主站36d6bf1/控制8a4fe59/三服务PID保持，无重启。用户18:22:00真实升级complete，实际全局build7c2d47ab…；已安装模块再验24/24且配置保持。其后用户手动stop(PID34312)，保留停止状态；另外两次并发update被锁拒绝，latest指到最后失败请求而非已完成任务，不能说整机升级失败。锁已释放、无worker；未删失败日志/重写状态/自行start，真实网页after待用户原连接在线。

> **当前维护入口**：请先阅读根目录 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)。本文保留阶段性交接时间线；其中较早的验证数字和“待完成”描述可能已经过时，当前状态以项目管理手册、代码和最近一次真实验证为准。

> **2026-10-08 历史环境区分说明**：本地 checkout、5178 前端、4178 API 和项目 `data/ziwei_user.json` 是 `bjc-ops` 的本地代码验收环境；真实本机 `ziwei_user` daemon 由全局命令启动，使用用户目录配置连接 `https://qzelynth.top` 的服务器工作区 `test_222`。不要把项目配置或项目 daemon 当成服务器 daemon；接手时分别核对用户目录配置、项目配置和各自 `/readyz`。详细维护约定统一见 `PROJECT_MANAGEMENT.md`。

## 2026-10-10 当前发布：Windows 客户端检测与维护（已上线）

最新范围仅Windows：设备树与后端读取每台电脑自身runtime元数据，CLI区分未找到/检测失败/未上报/设备离线，新增安全stop/update/uninstall与旧版PowerShell官方升级入口。主站36d6bf1于04:02:12Z部署、仅主API重启；最终静态前端4464bb5于04:22:16Z发布且服务PID不变，控制8a4fe59/Nginx/Android保持。用户本人bigtron/device_bfd9a3d2…实际页面4/4可用、另一台791独立1/4，三视口24/24、39截图、零业务写和正常错误；版本标签裁切已修。

完整回归454/454、0skip，最终WinPS5编码新增回归1/1，lint65/build、布局fixture24/24；实际纯IRM|IEX隔离全局升级/停止/恢复/卸载11/11。公开包SHA628976fc…、93,329bytes、Windows真实npm安装build6d0709a2…，原归档sourceBuildcf30d9b6…（npm仅归一shebang换行），公开metadata已区分。最终ASCII无BOM脚本来源c5b720b，公开SHA与真实HTTP解码已验证；两次OwnerQA均撤销、旧cookie401、私有token文件清除。

本人实际PID58720/旧build40af5811、20242在线，本轮未停止/升级/重连；Gemini旧误报Codex版本仍展示现有心跳，需更新原客户端才上报新探测。旧用户目录断开配置hash不变，不能把磁盘历史0连接当作当前运行状态。用户新正式工作区/账号/邀请/设备保留，不重跑清理；Creator/phone_ai/手机MCP/配对/认证/工作目录保持。最终备份 `/opt/ziwei-backups/windows-client/20261010T035832Z`，两库integrity/FK与保护资源复核通过，回滚仅代码不整库覆盖。Mac适配、本人daemon升级、模型/provider和手机实机未执行。完整证据、准确命令与限制见 [Windows 运维记录](docs/operations/2026-10-10-windows-client-maintenance.md)。

## 2026-10-10 历史接续：业务清理与本机全部断开（已完成）

- 最新用户授权覆盖下方历史“test_222 主连接保留”目标：删除 `test_222` 和其他无关工作区、员工及业务记录，保留 `phone_ai` Creator/手机 MCP；当前电脑 `ziwei_user` 最终清空所有主/shared 连接并停止，不自行重新配对或重新运行员工。
- Creator 原 shared 持久 HOME、记忆、人格、profile、正式会话和模板，两个手机 MCP 宿主、技能/配置/绑定，以及手机配对/节点/控制服务均受保护。客户端程序、工作目录、CLI/provider 认证和其他项目数据不属于删除范围。
- 生产主站 `3421046684a2ab1b484674500b803ea6dd1c14b7` / `/opt/ziwei/releases/3421046`，控制仍 `8a4fe59`，Nginx 不变。一次性 seed marker 和 native forget 已发布。`02:20:20Z` 按审核 SHA `b7077d642890aa6b4a691e23d0731958b8c4ecce6bce2d3101a5559f43aae7a2` 删除 6,665 行、迁移 5 项平台技能归属。真实剩余 phone_ai 1 区、Creator+2 手机宿主、f956 1 电脑/凭据、Owner 1、技能 6、正式会话/模板各 1；普通任务/消息/历史为 0，手机配置/绑定各 2、中控手机 2/节点 4（页面活跃 1/2）保留。
- 本机全局包升级 PID48624→52780 后原生 forget 已完成：0 连接/4 对应缓存删除/20242 无监听，两个 daemon 与观察器均退出，不自行 start/connect。Creator 原 HOME 20 持久文件、2 action-state、4 源 config/SOUL 哈希不变，认证及用户目录保留。
- 停写前备份 `/opt/ziwei-backups/launch-cleanup/20261010T021519Z-predelete`，本机最终备份 `C:\Users\25941\AppData\Local\Ziwei\backups\launch-cleanup-disconnect-20261010T021200Z`，双库及 Creator state 独立恢复校验通过。断开前实际 Creator 只读 succeeded/loaded；断开后不宣称可执行。桌面/390px 实际 18/18、34 图、正常错误与业务写请求 0；原图长摘要两行/卡高126/环境gap32，正式会话打开刷新正确。
- 在线 SQL 验收长读锁曾使主服务短暂退出，systemd 于02:22:10Z恢复；保留首轮17/18及502证据，改用 backup API 离线快照后复验通过。最终85表仅接受既有登录last_seen变化、已撤销QA一行及控制启动单设备lease宽限这一精确例外，其余保留字段与删除后清单一致。临时QA已撤销/旧cookie401/两端token文件清除；原4账号保留。实际手机动作、Codex执行均0。完整结果见 [2026-10-10 运维记录](docs/operations/2026-10-10-business-cleanup.md)。

## 2026-10-10 追加接续：紫薇 Logo favicon

- `74cefd5485916614d8357e779fdb3f223b1d53e8` 仅增前端head PNG favicon声明，复用全局品牌原图与内容版本URL，构建/diff check通过；02:41:16Z以os.replace原子替换3421046的静态index，后端仍3421046、控制8a4，业务JS/CSS/53项旧assets、三服务PID/重启计数、CLI/APK与数据库均保持。
- 正确图片URL为 `https://qzelynth.top/ziwei-logo.png?v=68452b1f4299`，实际200/image/png/hash与全局一致。五个无Cookie浏览器入口5/5、context全关闭、16/32px解码渲染通过，错误/业务写0；Headless自动标签图标未目视，证据边界如实记录。当前本机继续disconnected/0、20242无监听；旧HTML备份 `/opt/ziwei-backups/favicon/20261010T024116Z`，只恢复静态index即可回退。详见 [favicon运维记录](docs/operations/2026-10-10-favicon.md)。

## 2026-10-10 历史接手续记：内置 Creator 发布、真实 Hermes 验收与清理已完成

- 生产代码为 `db0aa68b0735c30c65acdf342c3080655892a286`，北京时间 **00:08:06**（`2026-10-09T16:08:06Z`）发布 `/opt/ziwei/releases/db0aa68`，前一版 `1ca9c6b`。备份 `/opt/ziwei-backups/creator-platform/20261009T144859Z`；仅主 API 重启，控制仍为 `8a4fe59`，Nginx 原 hash 不变。新前端 `index-DRTDY7kv.js` / `index-CJMLdFH9.css`，新/旧资源均 200，主站健康、三服务 active、Android code15 双 APK HEAD200 已证；此处没有新增 APK hash 或手机实机结论。
- 市场模板 `ziwei-employee-creator` 1.0.0 使用现有员工、管理校验和会话系统，按 workspace/owner/template 幂等复用；默认 personal，不自动覆盖已定制实例。旧同名兼容实例采用时保留原配置并标记 `adopted-existing`，不假称已应用 v1。跨区/私有成员/伪造 actor 与真实电脑、CLI、auth/provider/profile 检查继续保留。
- 正式 `phone_ai` Creator **保留**：员工 `employee_743801eb-189d-4a57-bb57-64adebf7b571`、首个会话 `conv_3c72ac45-1551-44d2-a1ed-c0900adc137a`，Hermes `default` / `device_f9568c06-d932-4264-9d4c-acc5122097ea` / personal / template 1.0.0。三组真实视口 1440×900、390×844、720×450 已确认市场可见、持久会话打开、刷新保留、pageErrors 0；原员工 7 个不变，正式实例与 1 条模板元数据已纳入新的只读 baseline。
- Creator 每次会话执行只拼接本会话、本员工、本工作区最近 user/assistant 文本：排除当前消息，最多16条/12,000字符，历史是引用，当前请求最后作为执行依据。普通员工不扩历史；派发快照不包含之后才产生的前轮回复。Hermes 实例 MEMORY/state/SOUL 使用独立持久 HOME，原认证路径不复制；当前只验证 openai-codex+本地 memory，绑定 profile 迁移/其他 provider/远程 memory 安全拒绝。模型及工具调用仍需本次真实 action 结果与 MCP audit。
- 发布前本地 **398/398** 测试、0 skip，lint60/build通过；runtime无模型 fixture 新9/9、focused47/47。公开客户端24文件/73,936B，SHA `355aef510a8d52d43308e73d580a7aa93a9390bfd14be2a57d3288fc8c4c04ee` 与公开metadata一致。原生全局 PID48624、20242、build `ca0807e0a3f3ace0fa9184c58886dd5e14e76191aae97982865d27caa0800068` ready；原配置保持，不重新配对。
- **真实 Hermes 四阶段验收通过**：四个 Creator parent 的 create/verify/repeat/history 均 succeeded / MCP loaded；两名不同岗位/人格的 Hermes default 临时子员工、两任务及共六个 action 全部 succeeded，子任务返回各自成功 marker。故意 missing 查询真实失败后完成修正创建，repeat 返回原两员工 ID；history 当前请求无资源 ID，仅六次 get 回读原两员工/两任务/两 action，派发历史 6 条 / 7,185 字符且包含真实助手返回的六个 ID。四次 Creator 实际模型均为 `gpt-6.1-sol`，同一持久 HOME 的原生 state/SOUL 确认存在、auth/`.env` 未复制、原配置不变；普通子员工未宣称 HOME/memory 隔离。
- `16:22:00Z`（北京时间00:22:00）批准计划 SHA `ade946133e3b71e950643ff9fab26b68a88f8b223a3177bc2ed6d918ee9a6e70` 已执行，精确删除 QA 2员工/1会话/2任务/6action，以及8消息/23事件/2task message/4management request，0模板记录；正式 Creator、首个用户会话与模板记录保持新 baseline `/opt/ziwei/.local/creator-platform/formal-baseline.sqlite`。清理后18张保护表count/stablehash一致、8员工全enabled、FK通过、QA残留0；旧management-default清理计划不适用，既有设备/配对/手机/邀请未改。正式 POST 复用最终200、duplicate=true、配置与原正式ID不变。
- 最终两区 health/discovery/employees 只读18/18，自身200/匿名401/跨区403；PID48624/20242持续ready，先前两区queue=0留证，watcher33376最新心跳仍指向同一ready进程。团队布局两区三视口实际6/6、18截图、6 context全关闭，卡片126px/环境间距32px；page/console/request/unexpected错误与业务写请求为0。最终health在16:23:14Z通过；16:25:24Z QA登录会话撤销、旧cookie401、服务器私有文件删除及本机临时token清除均已完成。
- Codex真机本轮按用户要求取消，实际0次Codex执行/0手机动作；模板支持保留，其他provider/远程memory/普通员工HOME隔离及APK hash不扩大结论。本机缓存/synthetic目录此前自动审批拒绝的清理不得绕过。安全证据集中在 `.local/creator-platform/` 的 `native-creator-qa-result.json`、`native-execution-detail.json`、`cleanup-execute-result.json`、`data-final-result.json`、`client-final-readonly.json`、`live-team-layout-final/results.json`、`formal-reuse-result.json`、`session-final-result.json` 和 `health-final.log`；详见 [Creator 运维记录](docs/operations/2026-10-09-creator-platform.md)。

## 2026-10-09 历史接手续记：默认自动管理 MCP

- 已推送/部署代码 `1ca9c6b8761a8ee17adb2fd6d4fa92f385718c05`，北京时间 21:18:32（13:18:32Z）；前一版 1ac0395，备份 `/opt/ziwei-backups/management-default/20261009T130953Z`。前端仍为 `index-Caqrwk2Y.js` / `index-C30xBdgl.css`，控制保持 8a4fe59。下面的 f790f09、82c4f8e、628482d 等保持为历史快照，功能均已包含，历史 PID、手工开关与 token 配置不作为当前操作指引。
- 所有工作区新旧员工有效管理配置默认开启。每条已配对电脑连接用自己的设备身份领取单工作区、短期、management-only 凭据，按 origin/workspace/device 私有缓存并自动恢复/续期；跨区、匿名、撤销/过期及错误 audience 继续拒绝，不让浏览器或模型拿到设备凭据。新增 shared 连接仍需原双 Owner 授权，普通成员的网页角色及手机 capability/精确绑定规则不变。
- 表单不再提供管理 MCP 授权 checkbox；准备中或自动准备失败可先保存有效员工配置，原 device/workspace/offline/CLI/auth/provider/显式 profile 检查继续生效。页面显示准备进度、失败原因、重试与更新入口，workspace 切换/刷新有显式 slug 和 generation 防串区。重试仅请求指定连接在下一次心跳刷新管理配置，不创建任务、员工或手机动作。
- Hermes 管理 MCP 支持真实发现的 default 或显式 profile。执行使用所选 profile 的原生临时 managed overlay，认证继续来自原 `HERMES_HOME`，不复制 auth、不改原配置；手机技能独立 profile 限制保留。实际管理 MCP 注入支持 Codex/Hermes，其他运行时缺适配会明确失败，不宣称全部 CLI 完成实际验收。官方客户端来源为 `https://qzelynth.top/downloads/cli/ziwei-latest.tgz`；已配对电脑升级只用 npm 全局安装与原生 start，不重新配对、不切工作区或端口。
- 最终 343/343、lint52/build 通过；同一前端包的真实域名开放平台/既有 Hermes 6/6、五视口创建/编辑只读10/10，以及两工作区只读18/缓存缺失恢复/续期/主动重试证据保留。浏览器全部关闭、只读0写请求/手机动作，员工hash不变；后续模型QA资源写入与清理由发布负责人精确管理。
- **本轮 default Hermes 实际 succeeded/loaded，discover/list/create/get 四工具均ok，子员工精确default/电脑回读正确；独立 ziwei-qa-mgmt-20261008 实际 succeeded/loaded，discover/list/health 三工具ok。** 独立原 SOUL 明确只读/不创建业务，写序列未完成且没有第二个子员工，原config/SOUL均不变。首次failed/无握手保留为修复前历史；旧员工页历史回执与这两次新action分别保留。用户取消本轮Codex，实际0次Codex执行；手机离线、实机暂缓、0手机动作。
- 正式客户端 tgz 22文件/66542bytes、SHA `ae27327bbcfcbcd9f7518cc9b74e357374c04a228189391e91ba4151360d5da4`。原生全局客户端 PID48208、build `f26077c6abcb6479a63948439938097151888751b150780069eb714bf36348b4`、20242、watcher50908，配置不变。实际包/metadata与运行证据见[默认管理 MCP 发布记录](docs/operations/2026-10-09-default-management-mcp.md)。13:22:32Z已按精确计划清理QA4employee/3conversation/3action及6消息/11事件/4管理引用，0tasks；FK通过，原18保护表count/stablehash保持，7原员工全enabled，最终health通过。两区最终只读18/18于13:29:09Z通过：test_222员工3/phone_ai员工2、自身API200/匿名401/跨区403、两区queue0，PID48208持续ready。QA会话精确撤销，服务器私有文件移除/本机token清除，旧cookie于13:29:51Z真实401；安全汇总证据保留，私有凭据未公开。

## 2026-10-09 历史接手续记：员工弹窗勾选框修复

- 生产代码 `f790f099ae80b8cac8d272c9b260527f8c611e0b` 已于北京时间12:13:51发布，目录 `/opt/ziwei/releases/f790f09`，JS/CSS为 `index-Bxj_j2AJ.js` / `index-Du5DwJBi.css`。包含82c4f8e邀请及全部手机/管理/卡片增量；文档与截图helper后续提交不改变该生产代码版本。
- 文本框规则排除checkbox/radio；共享原生18px勾选框保留label和键盘交互，SKILLS不缩小、敏感项同步回归。手机继续选项进入正文滚动区，编辑标题正确且不显示创建专属项。真实未授权管理MCP仍阻止提交，取消后按其他条件恢复可用。
- 296/296、lint49/build、隔离弹窗11/11、原UI36/36、生产五视口创建/编辑10/10及独立footer/body最终5/5通过；生产15个checkbox均18×18/gap8、无错误和业务写请求、员工摘要hash及2→2数量不变。720×450为CSS视口而非真实200%缩放。手机动作仍待在线，不以UI验收代替实机结果。
- 备份 `/opt/ziwei-backups/employee-modal/20261009T035856Z` 双库ok、13配置。服务PID80617/44591/737全不变、0重启；后端/runtime字节一致，Nginx手机路由与hash保留，六份旧hash HEAD200、Android最新code15。回滚只切回82c4f8e，不重启、不恢复旧库。
- QA会话已撤销并用旧cookie验证401，服务器私有文件删除、本机token已移除。仅截图helper补充隐去背景账户区域，避免遮罩盖住前景。最终无遮挡截图、结构化结果、中间脚本和网络失败记录见[弹窗修复记录](docs/operations/2026-10-09-employee-modal-checkbox-fix.md)。

## 2026-10-09 历史接手续记：邀请注册修复

- 主站已于北京时间11:12:26发布 `82c4f8e`，目录 `/opt/ziwei/releases/82c4f8e`；控制 `8a4fe59`。手机技能628482d、管理MCP、卡片与原Nginx手机路由保留，只有主API重启。文档Git头可晚于该代码发布。
- 根因是个人工作区有效邀请被注册kind限制拒绝；共享事务校验现支持个人/团队邀请、即时user_id绑定、同邮箱legacy Owner保持与未知工作区无code拒绝。错误持续可见，已有账号登录接受后即时进入目标工作区；普通受邀者无owner权限。
- 296/296、lint49/build、隔离邀请6/6、真实新上下文邀请6/6和原UI30/30通过。独立QA四账号三工作区已删除、session0、外键检查无新增问题；真实bjc邀请在清理后仍pending且未被验收消费。Mac场景为Chromium UA模拟，非实体Mac。
- 备份 `/opt/ziwei-backups/invite-registration/20261009T030846Z` 双库ok、13配置；API PID80617，控制44591/nginx737未重启。APK code15双包hash、旧JS/CSS、手机/管理匿名401 JSON均通过。回滚628482d仅需切symlink并重启主API，不恢复旧库。
- 独立邀请树发布，未覆盖原D与2884树任何dirty/untracked；T8手机文档与验收增量已合并保留。用户可刷新原邀请链接注册，已注册邮箱登录后接受。详细记录见[邀请注册发布记录](docs/operations/2026-10-09-invitation-registration-fix.md)。

## 2026-10-09 手机 MCP 平台技能接续快照

本节保留手机技能发布时的版本、客户端及验收记录；当前管理默认规则和待验边界以顶部为准。管理默认开启不替代手机授权；下文旧“两 runtime 顺序实机验收”计划已调整为 Codex 本轮取消、手机实机暂缓。

- 最新主站已由邀请注册T7接续发布 `82c4f8e`（北京时间11:12:26），包含手机功能 `628482d`；前端 `index-C8RY6SXs.js`。本工作树已快进包含该邀请增量，本轮只提交文档与验证脚本、不再发布。邀请验收及其QA清理以T7独立记录为准。
- 手机技能代码 `628482d` 已推送并发布 `/opt/ziwei/releases/628482d`，前端 `index-DL3srw7J.js/index-F195zgZe.css`，控制 `8a4fe59`、Android code15不变。仅主API重启；公网真实员工检测发现并补齐 Nginx `^~ /terminal-mcp/v1/ →4178`，后续发布必须保留并运行匿名 transport 门槛。
- 平台目录 `ziwei-phone-control` v1.0.0，三个入口共用向导，原创建表单可返回手机配置；既有版本、卸载、人格与其他技能保留。每次执行的短期 capability 限定 workspace/employee/computer/profile/phone/revision/action，源管理员凭据不下发；原十工具/队列/回执保留。
- 正式搭建师仍在test_222，原persona/runtime/device/技能保留，岗位说明补充用户授权的phone_ai搭建流程；既有bearer精确增加phone_ai、bjc-ops继续403，管理stdio21工具真实验证。phone_ai正式Codex b723a169…由网页创建；Hermes e60938a6…与独立ziwei-phone-ops-20261009由真实搭建师MCP创建配置。完整IDs见[验收记录](docs/operations/2026-10-09-phone-platform-skill-acceptance.md)。
- 同一全局客户端保留test_222/20242，双Owner grant新增phone_ai/device_f9568c06…独立身份。原生重载后PID29976从磁盘恢复两连接、配置字节不变。两真实员工最终check action790f3310…/be35fa83… succeeded，实际MCP loaded/list/status均成功，读到手机offline。
- 276/276、lint/build、隔离phone12/12、team12/12、management6/6、真实配置9/9与加载后最终只读9/9均通过，搭建师同一持久会话复验succeeded。**用户暂时不能操作手机，本轮没有手机命令；截图/有限动作/业务实机验收仍待完成**，不能用只读MCP成功代替该边界。下一步手机在线后两runtime顺序验收，沿原commandId/实际截图，不重放uncertain，不改控制源、不升级/重启手机。
- 双库/12配置完整备份20261009T020417Z，scope与Nginx另有原子变更备份，客户端私有包/配置/入口/日志备份保留。PID53712曾未知退出，已恢复并补独立user日志观察，当前观察PID29976；不宣称退出根因修复。全局旧管理员手机MCP虽canonical已修正，旧密码仍401，禁止重置源口令或分发给员工。
- 邀请注册T7已独立接续发布，后续先核对最新服务器/Git并合并双方增量，不能覆盖手机技能、管理MCP、卡片或邀请修复。本轮临时Owner QA会话已撤销实测401、执行capability文件0；本机三份临时私有文件删除被自动审批拦截，仍在ignored目录待清理。用户三份untracked保留。使用指南见[PHONE_MCP.md](docs/PHONE_MCP.md)，历史快照在下方。

## 2026-10-09 历史接手续记：团队员工卡片重叠修复

- 用户截图揭示此前未覆盖的团队页长指令布局：最高卡片 787px，组织区固定 500px，卡片与设备表重叠。`instructions` 优先展示、后置 CSS 取消截断、绝对定位列表不能撑高父容器共同导致问题。
- 该历史发布主站为 `dc3917341cd801d4e83bda8da24fe794d35f23f2`，北京时间 00:50:22 发布；前端 `index-PEvi9Z0Z.js` / `index-DyDgRE0D.css`。岗位摘要优先 description，缺失时有界取指令首句；详情和编辑保留完整指令。组织列表随排数撑高，390px 员工文字列恢复可读宽度。
- 235/235、lint/build、卡片隔离 12/12、MCP UI 回归 6/6、真实线上四视口 8/8 通过。线上三卡统一 126px，与环境区间距 32px；没有写请求或设备动作。390px 顶部四个管理按钮的既有裁切未在本轮修复，不宣称整页窄屏控件全部完善。
- 最新备份 `/opt/ziwei-backups/terminal-console/20261008T164821Z`，12 配置和双 SQLite integrity=ok；原 runtime 文件逐字节一致，三服务 PID/启动时间不变，daemon 仍 test_222/20242/PID49296/ready。当前前端回滚至 `/opt/ziwei/releases/4db30ce`，不需重启 API。详细证据与临时 QA 会话清理状态见[修复记录](docs/operations/2026-10-09-team-card-layout-fix.md)。

## 2026-10-09 管理 MCP 真实员工链路发布快照

- 当前开发/发布接续目录为 `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解`。原 D checkout 的用户 dirty/untracked 文件和本工作树 `.domain-occurrences.txt`、`.local-ziwei-readonly-evidence.json`、`tmp_gzgov.html` 均保留，不执行 reset/clean。
- 本节发布快照为 `4db30ce`，管理实现 `bef1944`，前端 `index-Bebxc5Te.js` / `index-DejeXhlj.css`；控制端 `8a4fe59` 未变。00:03:50 管理代码上线仅重启主 API；00:14:28 Escape 与 00:28:55 窄屏标题前端补丁均未重启服务，运行时代码逐字节一致。当时备份 `/opt/ziwei-backups/terminal-console/20261008T162818Z` 双 SQLite integrity=ok、12 配置。
- 全局客户端已用验证后的 tgz 替换旧 D checkout link，真实 package 在 `D:\work\nodejs\node_global\node_modules\ziwei`。原用户配置及设备凭据保留，工作区 `test_222`、canonical API、工作目录和 `20242` 不变。daemon 实际刷新 `1700 → 49296`，配置哈希不变、ready/MCP 正常。项目 `bjc-ops` 配置只供隔离代码验收。
- 正式“紫薇员工搭建师”ID `employee_eddccbcf-3faa-4f55-a2f9-a12de9c679fe` 已可在网页对话，Codex / gpt-6.1-sol / zheng，挂载真实“员工搭建与只读验收”技能。模型实际 stdio MCP 发现→独立 Hermes profile→两名 QA 员工→真实任务→回读链路已通过；每名 QA 相同创建请求重试返回同 ID。
- Codex `employee_20f5a646-025c-4e05-aed9-d08ba60edd72`、Hermes `employee_748360a3-a0e4-444b-9125-5fe96f943d39` 都仅一名；Hermes 使用独立 `ziwei-qa-mgmt-20261008`。首次与刷新后共 4 个 task/action succeeded，均 loaded=true、实际管理工具成功，并有两轮各自结果标记。不要把宿主工具或直接管理员创建当成这些真实员工证据。
- 开放平台展示真实 15 工具和安全 stdio 配置，员工 MCP 页签展示实际证据。HTTP `/mcp/v1` 不是远程 MCP URL；专用 bearer 与 API Key/设备凭据隔离。作用域实测 test_222 200、bjc-ops/phone_ai 403，Owner cookie 不能替代 bearer。
- 235/235 串行测试、lint/build、隔离 UI 6/6、真实 HTTPS 桌面/移动宽度验证已完成。完整资源 IDs、临时会话清理、浏览器截图/错误记录、客户端与服务证据、限制和回滚见 [最终验收记录](docs/operations/2026-10-09-management-mcp-acceptance.md)。旧手机 MCP 的 TLS 配置问题仍属单独历史边界；本轮未操作手机或绑定。

## 2026-10-08 真实手机技术验收历史补记

- 本轮在 `phone_ai` 管理入口唯一可见的目标手机来自源中控全局设备目录；员工绑定 0，不代表手机独占归属该工作区。Agent/Updater v0.4.4/code15 双端 online、无障碍 true、亮屏未锁、peerBound/canInstall true、无 pending，当前 Agent 控制。下文手机 0 和未实机验收记录是较早阶段历史。
- 设备动作由主任务独占，经真实域名主站 Owner 代理完成 33 条命令：17 截图、9 点击、5 系统返回、2 启动应用，全部 succeeded；系统设置启动后已通过截图确认，并成功返回原应用。23:24:47 最终记录 updates/pending 0、三服务 active，主站/控制端仍 `81b6ec8/8a4fe59`。
- 两次大响应读取 20 秒超时，命令已 succeeded，未重放；17 readback 为只读补取。04 点击虽回执成功但首次页面未切换，观察后 06 新点击才进入目标页，不将命令成功等同导航成功。
- 北京时间 23:25:04–23:25:26 动作后网页只读后验通过：真实 JPEG 720×1612 正常渲染，详情 33 条 succeeded、DOM 最近 20 条均成功且有完整回执入口；双端 online、待审/绑定 0，页面/控制台/请求失败/响应体读取失败/告警/阻止写请求均 0，后验设备动作 0。短期主站 Owner QA 会话已撤销，服务器与本机私有会话文件已删除；未创建员工或手机设备令牌。
- 员工 0、员工绑定 0；宿主 Codex 可用不代表员工手机执行链路已通过。终端 MCP 实际 list/status 失败，旧 IP 配置触发 ERR_TLS_CERT_ALTNAME_INVALID；正式域名健康 200，本轮未修配置，也未改 test_222 daemon。员工/MCP 链路、真实双端升级、业务消息仍未验收。
- 提交文档仅保留技术状态，见 [脱敏验收记录](docs/operations/2026-10-08-real-phone-acceptance.md)。完整账号、作品与指标只保存在 ignored `.local/real-phone-acceptance/report.md`；本地结构化总结果 `result.json`、`final-state.json` 和截图保留，不推送私人数据。

## 2026-10-08 接手续记：公开 Android 安装页已上线

- **当前生产版本**：T4 提交 `81b6ec8d0eb5693f3faf5eab88cd7ff2aeabdb00` 已快进进入并推送 `codex/ziwei-terminal-console`；北京时间 22:23 切 `/opt/ziwei/current -> /opt/ziwei/releases/81b6ec8`，前端 `index-BUxdmKav.js` / `index-C8foC8Iv.css`。source 保持 `8a4fe59`；下文完整终端的 `a625350` 发布是较早阶段历史，当前状态以本节与维护手册顶部为准。
- 公开 `https://qzelynth.top/android-install`（尾斜杠也 200），无需登录。主站完整终端标题栏的“安装手机端”实际跳转 `/android-install?workspace=phone_ai`，返回同工作区终端通过真实 Owner 浏览器验收。只精确安装路径公开，原主站及手机管理认证保留。
- 双按钮从真实 index/manifest 选最新发布并显示大小；目前 code15/v0.4.4 的 Agent/Updater 为 815470/815474 B，生产 HEAD、GET、SHA-256 均匹配。QR 实际渲染解码为 canonical 安装页；复制根地址正确。首次同机安装双应用、确认权限、两端填写同一根地址/手机名并分别申请，管理员回原终端审批及绑定；不默认要求手工 token/JSON。
- 发布备份 `/opt/ziwei-backups/terminal-console/20261008T142230Z`：mainBefore=`a625350`、sourceBefore=`8a4fe59`、12 配置、两 SQLite integrity 通过。backend 和 69 个运行时 lock 条目均无变化，新增 jsqr/qrcode-generator 仅 dev 构建/QA，生产复用原 modules。此次未重启任何服务、未改 Nginx/DNS/daemon/数据/原 APK。
- 最终验证：T4 完整串行 207/207、安装 UI 9/9、终端回归 6/6；root fresh lint 39 files、build 通过。真实匿名安装页 1440/390 两组 passed，二维码/复制/版本大小/下载/认证返回正确，0 errors/overflow/设备动作。主站 Owner 终端 6 checks/5 probes 通过，手机与待审 0。生产证据 `.local/install-live/results.json`、`main-entry.json`、`terminal/results.json`、`stale-assets/results.json`、`deployment.json`。
- 北京时间 22:26:46 生产记录：主站/控制 health=true，三服务 active/NRestarts 0，启动时间未因安装页发布改变（主站 20:35、控制 20:47；Nginx UTC 2026-10-07 16:13:39，即北京时间 10-08 00:13:39）。临时 QA 会话已撤销、remaining 0，服务器/本机 token 文件已删除。
- 用户白屏恢复后进行了只读排查，未复现用户事故，根因尚未证实。独立实验确认旧 f88d6f8 HTML 引用缺失 hash 时会被 SPA fallback 返回 HTML 而触发模块 MIME 白屏；新 dist 已携带 a625 assets 和 f88 旧 JS/CSS，同一旧 HTML 真实生产请求现返回正确 MIME/大小，登录可见、0 errors。不能把这项合成复现当作用户事故根因。后续发布继续保留缓存 HTML 所需旧 hash，详见 [排查记录](docs/operations/2026-10-08-white-screen-investigation.md)。
- 本机 daemon 最新只读 `/readyz` 为 ready=true，PID `33260`、`20242`、工作区 `test_222`，与发布前一致；原 D 目录和源中控所有 dirty/untracked 文件保留。
- 回滚仅切前端 symlink 回 `a625350`，backend 未变，无需重启 API；保留 source、原 data/APK 与旧 hash。实机 APK 安装、权限、入网、真实操控升级未验收。详见 [安装页最终记录](docs/plans/2026-10-08-android-install.md)。

## 2026-10-08 接手续记：主站完整终端控制台（较早阶段历史）

- 主站功能提交 `a625350b23926597810fe5181741937933303170` 已推送 `origin/codex/ziwei-terminal-console` 并上线；`/opt/ziwei/current -> /opt/ziwei/releases/a625350`，上一个发布为 `f88d6f8`。前端 `index-noIbPxU1.js`。原控制服务提交 `8a4fe59f0b2486fb584962fd3006e9a47418037a` 已推送 `origin/codex/phone-archive-compat` 并于 `2026-10-08T12:47:46Z` 部署至 `/opt/ziwei-control/releases/8a4fe59`；第二次部署前备份为 `/opt/ziwei-backups/terminal-console/20261008T124627Z`（12 配置、两份 SQLite，integrity 均通过；mainBefore=`a625350`、sourceBefore=`af63071`）。
- 用户登录主站后，进入左侧“系统 → 紫薇·互联”；手机工作区为 `https://qzelynth.top/phone_ai/ziwei-connect`。Owner/Admin 可以在“待审核入网”直接批准/拒绝手机，无需再登录原中控。手机连接页填本站 HTTPS 根地址后提交申请，获批后沿原配对协议自动取 Agent/Updater 配置。
- `frontend/src/components/terminal/TerminalConsole.vue` 实质复用原完整手机管理页：列表/详情、双端健康、手动登记配置、截图操控、控制端、回执核实、升级和归档；App 内的当前手机插槽绑定已有员工与账号，原员工运行记录及诊断保留。API 通过主站工作区身份代理，管理员凭据不发给浏览器，手机状态与命令仍由原控制服务保存。
- 重点维护：不要把列表 summary 当完整回执；它会省略成功命令与结果。当前刷新串行读取完整详情，升级预检直接按捕获的手机 ID 读取成功截图与新画面，离页后不再提交升级。acknowledged 表示人工核实，不能标成 succeeded 或重放；delivered/executing 需继续轮询。
- 发布前双 SQLite 与配置备份：`/opt/ziwei-backups/terminal-console/20261008T122923Z`，integrity 检查通过。真实数据及原 `data/.local/node_modules` symlink、服务端凭据、既有 APK/`dist/downloads` 均保留；不改 DNS/子域名，不启停本机 daemon、不切换配置、不新增本机业务实例。
- 源 `af63071` 复核缺少归档 API 和 `archived_at`。源增量只补归档与兼容列，保留历史、撤销双角色凭据和配对授权、从列表隐藏。源 `8a4fe59` 已 active/health 200，兼容列真实存在，手机数 0；只重启原控制服务，主站/Nginx 未为此重启，源 `node_modules/.local/data/dist/downloads` 链接原目录以保留 APK/CLI。旧 `af63071` 可兼容额外列，代码回滚不会自动恢复撤销的凭据。
- 验证：主站完整串行测试 189/189、lint/build 通过；隔离真实 HTTP/SQLite 6 组、合成浏览器 6/6 通过。默认并发运行在构建 CPU 负载下曾触发既有 daemon 60 ms/100 ms 计时测试失败，隔离 daemon 7/7 与全套串行复核通过，未改 daemon。
- 真实域名只读浏览器：`.local/terminal-live-evidence/results.json`，1440/390 px、主站 Owner cookie、匿名 401/登录 200/直接源管理 401，无源登录，0 page/console/request 错误、0 设备动作；真实手机和待审均为 0。实机 APK 安装、自动领取配置、双端心跳、屏幕控制和升级仍未验证。
- 源更新后的最终生产复核已完成（`2026-10-08T12:49:03Z`）：真实域名 6 检查/5 探针全部通过，Owner 200/匿名 401/源直接 API 401，1440/390 px 无溢出，0 page/console/request 错误、设备动作 0。`.local/terminal-live-evidence/deployment.json` 记录两端 health=true、三服务 active、归档兼容列存在、手机 0；v0.4.4/code 15 manifest 与 Agent/Updater APK GET 均 200，APK 分别 815470/815474 bytes，SHA-256 匹配清单。临时 QA 会话已撤销，服务器/本机临时 token 文件已删除，没有额外登录残留。
- 当前本机 daemon 只读事实：`20242`、PID `33260`、工作区 `test_222`。下文旧 PID/部署条目仅是历史记录。原有 dirty 文件和 `tmp_gzgov.html` 保留，禁止 reset/clean 覆盖。
- 回滚：主站切回 `f88d6f8` 发布 symlink，源端需要时切回 `af63071`，仅重启对应既有服务；恢复数据库前核对对应备份和发布后的有效数据。详细版本、协议、证据和边界见 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md) 与 [本轮实施记录](docs/plans/2026-10-08-ziwei-terminal-integration.md)。

这份文档用于把当前工作交给 Claude 继续。项目根目录是：

```text
D:\灵光爸爸拆解
```

## 目标

紫薇是 AuraBaba 的自有实现，前后端分离，使用自己的 `ziwei_user` 作为本机桥接 daemon。后续实现只认紫薇自己的设备、心跳、A2A 动作和 Agent/CLI 发现，不依赖 AuraBaba daemon 是否运行。

## 当前架构和端口

| 服务 | 原生入口 | 端口 | 作用 |
| --- | --- | ---: | --- |
| 前端 | `npm run dev:frontend`，由 `npm run dev` 启动 | `5178` | Vue 3 + Vite 页面 |
| 后端 | `npm run dev:backend`，由 `npm run dev` 启动 | `4178` | Express + SQLite API |
| 本机桥接 | `npm run ziwei:start` | `20242` | `ziwei_user` 健康检查和就绪检查 |

端口已经登记为项目“紫薇”。不要换端口，也不要为端口登记另起一套服务。日志目录：

```text
D:\灵光爸爸拆解\.local\logs\backend.log
D:\灵光爸爸拆解\.local\logs\frontend.log
D:\灵光爸爸拆解\.local\logs\daemon.log
D:\灵光爸爸拆解\.local\logs\health.log
```

`data/ziwei_user.json` 只代表本地项目验收配置，workspace 是 `bjc-ops`。真实服务器 daemon 使用 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json`，workspace 是 `test_222`，API 是 `https://qzelynth.top`，健康端口仍为 `20242`。不要把 token、Cookie 或认证头写入日志。

环境边界必须保持清晰：本地 checkout、前端/API、单元/API 测试和浏览器回归属于 `bjc-ops`；服务器 daemon/A2A 证据只来自全局 `D:\work\nodejs\node_global\ziwei_user` 及用户目录配置。`npm run daemon` 和 `npm run ziwei:start` 只能在明确的本地 `bjc-ops` 验收中使用，不能用于服务器验收或代替 `test_222` 结果。服务器验收前分别核对项目配置、用户配置、端口和 `/readyz`，不得切换配置或把凭据写入日志。

## 启动和检查

本地 `bjc-ops` 代码验收时，在项目根目录运行：

```powershell
npm run dev
npm run ziwei:start
npm run ziwei:status
```

上述项目 daemon 命令不属于服务器验收流程；服务器 daemon/A2A 证据只用全局 `ziwei_user status --json`、用户目录配置和 `test_222` 工作区核对。

状态检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4178/healthz
Invoke-RestMethod http://127.0.0.1:20242/readyz
Invoke-RestMethod http://127.0.0.1:4178/api/workspaces/test-111/summary
```

当前已验证的启动结果：前端 `5178`、后端 `4178`、`ziwei_user` `20242` 都能监听；最近一次 `ziwei_user` PID 为 `8232`，但 PID 会随重启变化。Windows 启动器已改成直接执行 `daemon/ziwei_user.mjs`，不要改回 `npm.cmd + detached`，后者在本机返回 `spawn EINVAL`。

## 已完成的关键实现

### 本机 ziwei_user

- `daemon/ziwei_user.mjs` 使用真实心跳、A2A action 拉取、ACK、执行和结果回传。
- 本机动作执行在 `src/local-action.mjs`，支持受控的 `message.deliver`、`local.message`、`task.execute`、`file.read`、`file.write`；命令执行有白名单和工作目录限制。
- `src/daemon.mjs` 负责过期、幂等、路径穿越/符号链接检查、超时和终态结果判断。
- `/healthz` 表示进程活着，`/readyz` 只有最近心跳成功才返回 ready；前端和 CLI 使用 ready 状态，不把进程存在误判为在线。
- 设备状态、bridge 版本、Agent CLI 版本分开存储；不能用 bridge 版本冒充 Agent CLI 版本。
- 首次进入页面且自己的 `ziwei_user` 不在线时，会弹出本机安装引导；引导只介绍紫薇自己的安装和启动命令。

### 前端页面

已有路由：

```text
/test-111/home
/test-111/issues
/test-111/autopilots
/test-111/calendar
/test-111/project-docs
/test-111/members
/test-111/runtimes
/test-111/skills
/test-111/settings
/me/invite
/invite?code=<one-time-code>
/test-111/open-platform
/test-111/inbox
```

已经接入的行为包括：

- 任务看板/列表、状态移动、任务详情、Markdown/纯文本/HTML 描述格式、消息、附件上传/下载/删除。
- 日历月/周/日视图、任务显示开关、人类任务过滤、项目过滤、月份切换和创建入口。
- 文档搜索、目录树、文件夹创建、Markdown 创建、文件上传、下载；后端按 base64 保留二进制文件。
- 团队页、设备列表、自己的 `ziwei_user` 在线状态、运行时版本、数字员工创建。
- 自定义运行时/模型下拉框，不使用浏览器原生 `<select>` 作为员工创建的运行时和模型选择器。
- 邀请记录、生成链接、撤销、查找和接受邀请。
- Skills 平台/团队标签、安装/停用、团队技能创建、`SKILL.md` 文件或文本导入。
- 设置、开放平台、A2A agent card 和收件箱基础入口。

主要前端文件：

```text
frontend/src/App.vue
frontend/src/api.js
frontend/src/components/WorkspaceShell.vue
frontend/src/style.css
```

## 当前验证证据

以下命令在这次交接前已通过：

```text
npm test       -> 56/56 passed
node --test test/routes.test.mjs -> 5/5 passed
npm run build  -> Vite build passed
npm run lint   -> lint ok: 19 source files checked
```

后端专项测试覆盖 A2A action、daemon 心跳、安装/状态、任务附件、二进制文档、邀请生命周期、技能导入、日历、自动化、API key、权限和资源矩阵。

## 需要后续处理的边界工作

以下项目属于部署或浏览器证据边界，不能用本地测试冒充已完成：

1. 用 Edge/Codex 浏览器逐页打开本地页面，与 AuraBaba 截图逐项比对，重点检查像素级布局：左侧栏、顶部快捷托盘、日历开关、加号按钮、任务看板、文档目录树、团队环境树和数字员工创建弹窗。
2. 逐个点击所有按钮和菜单，做浏览器证据留档；功能入口已接到紫薇后端真实 API。
3. 验证邀请流程：创建邀请 -> 复制真实 link -> 新标签打开 `/invite?code=...` -> 查找 -> 接受 -> 成员和邀请状态持久化 -> 撤销邀请后链接不可接受。
4. 验证 Skills：导入合法/非法 `SKILL.md`、重复导入、版本和校验错误提示，确认 UI 不吞掉后端错误。
5. 验证文档二进制：上传图片/压缩包，下载后 byte-for-byte 一致；确认目录树展开、进入、返回根目录和搜索行为。
6. 验证 A2A 真链路：创建 pending action，确认 `ziwei_user` ACK、实际执行、回传 succeeded/failed；重复 action 必须幂等；过期 action 不得执行。
7. 验证 Agent CLI 发现：桥接器版本和四个 Agent 的 CLI 版本分别从发现结果获取；不可使用固定 catalog 值冒充在线版本。
8. 对照 AuraBaba 的安装体验补齐跨平台安装说明；当前仓库安装脚本是本地项目脚本，并不是远程下载器，不能在报告里声称已经等同 AuraBaba 的公网安装流程。
9. 14 点基线已经按当前实现更新为 `complete`；历史实施记录中的旧 partial 只作为时间线保留，不要据此回退状态。
10. 不要为了验证而关闭用户正在使用的服务；需要做离线分支时使用隔离测试进程或独立临时端口。

## 推荐验收顺序

```powershell
# 1. 先确认服务和本机桥接
npm run ziwei:status

# 2. 跑静态和全量测试
node --test test/routes.test.mjs
npm test
npm run build
npm run lint

# 3. 打开页面
# http://127.0.0.1:5178/test-111/issues
# http://127.0.0.1:5178/test-111/calendar
# http://127.0.0.1:5178/test-111/project-docs
# http://127.0.0.1:5178/test-111/members
# http://127.0.0.1:5178/test-111/skills
```

## 重要约束

- 品牌名称和 UI 使用“紫薇”；本机桥接名称统一为 `ziwei_user`。
- 不要依赖、启动或修复 AuraBaba 的 daemon；只判断自己的 `ziwei_user` 是否在线。
- 不要把 `daemon/ziwei_user.mjs` 改名回 AuraBaba 名称，也不要在 UI 文案里出现 Aura daemon 作为运行依赖。
- 不要把 token、Cookie、完整邀请码或请求正文写入日志。
- 用户要求的是功能和视觉复刻，不能用“弹一个提示”代替已有的真实流程。
- 修改后必须重新跑测试和构建，并在浏览器里实际检查页面，而不是只看源码。

## 2026-09-30 继续执行记录

- 已把此前孤立的 `backend/storage.mjs`、`backend/sanitize.mjs`、`backend/git-sync.mjs` 接入生产路径：文档/附件可使用内容寻址本地对象存储，HTML 任务描述入库前净化，文档支持受控 Git 导出/导入接口和页面按钮。
- 文档页窄窗口下快捷托盘曾遮挡“导出 Git”按钮，实际点击会命中收件箱；已加入窄屏避让和操作栏层级，内置浏览器复测能打开 Git 同步弹窗。
- 开放平台“创建 API Key”已接真实创建、一次明文显示、复制、轮换、撤销和脱敏列表；数字伙伴创建弹窗的“创建”已写入真实任务。
- 技能文件名解析已修正，根目录 `SKILL.md` 和子目录路径都能正确推导名称。
- 验证：`npm test` **62/62**、`npm run lint`、`npm run build` 均通过；真实服务端口保持 5178/4178/20242，`ziwei_user` 仍以自身 ready/heartbeat 作为在线来源。
- 已补齐：通知 WebSocket 优先、SSE fallback、指数退避和 ready 后补偿刷新；A2A 生产令牌已落到本机权限文件并由 `ziwei_user` 自动读取。仍需后续处理：远端 Git、完整浏览器四态和截图比对；这些外部验收项不能仅凭本轮构建标记完成。

## 2026-10-01 真实功能落地记录

- `ziwei_user` 继续作为唯一本机桥接器：运行时和模型只取本机实际发现结果，AuraBaba daemon 不参与在线判断。
- 技能中心已经接入四种真实来源：SKILL.md 文本/文件、URL、ZIP（服务端校验并只提取 SKILL.md）和在线 ziwei_user 工位复制。
- 工作流侧边栏已接入自动化页面，不再弹出“敬请期待”；自动化创建支持计划、指令、Webhook 回调、输出方式和重试配置。
- 开放平台的 Webhook 卡片已连接到自动化配置入口；任务/日历/文档/团队页的助手快捷按钮会进入真实数字伙伴编排器，不再只弹提示。
- 紫色主题残留已统一替换为紫薇的蓝色主色和浅蓝中性表面，包含 daemon 提示和任务泳道 hover 状态。
- 本轮只做前端构建级检查，按要求暂不进行完整浏览器验收和全量验证；端口与现有服务入口保持不变。

## 2026-10-01 后续补齐（Git 远程同步暂缓）

- 清理了工作区中多余的离线设备记录；当前仅保留在线 canonical `device-ziwei-user`。
- 团队页组织架构图和目录树增加多余设备移除入口，在线 canonical 设备受保护。
- 任务页新增负责人泳道视图、任务卡拖拽切换状态、快捷托盘真实菜单。
- 日历月/周/日视图支持拖动自定义日程到日期；任务拖动会更新 due date。
- 团队成员、数字员工、设备数量改为动态显示；数字员工支持头像选择/清除、删除和运行时下属列表；成员支持移除非 Owner 成员。
- 自动化新增编辑、启用/暂停、立即运行、删除和运行记录入口。
- 后端增加员工头像持久化、成员/员工编辑删除接口、A2A action events 查询接口与终态事件保护。
- 运行状态：前端 5178、后端 4178、ziwei_user 20242 均监听；`ziwei_user` 在线。
- 验证：`npm run build`、`npm run lint`、`npm test`（59/59）及设备/权限/A2A/自动化/邀请相关测试通过；Git 远程同步未处理。

### 2026-10-01 追加

- 任务泳道、看板拖拽改状态、日历事件/任务拖动改日期均已接通。
- 自动化支持编辑、暂停/启用、立即执行和删除；开放平台 API Key 支持轮换/撤销。
- 快捷创建弹窗支持附件上传并随任务保存；移除遗留的“敬请期待/头像预留/快捷菜单提示”占位。
- 成员与数字员工列表可动态展示，非 Owner 成员和数字员工可移除。
- 已将旧测试中的静态模型断言改为先经过 `ziwei_user` 心跳再断言真实 CLI 模型；`npm test` 59/59 通过。
- Git 远程同步仍暂缓，当前只保留已有本地 Git 导入/导出能力。

本轮文档校准（2026-10-01）：以上状态以当前工作区代码和最近一次 `npm test` 62/62、`npm run lint`、`npm run build` 结果为准。日历拖拽、自动化生命周期、成员/数字员工/设备动态管理、A2A 终态事件保护、WebSocket/SSE 实时双通道、登录用户创建工作区路由和真实会话注销已落地；远端 Git 同步、完整浏览器四态/截图验收仍明确延期。
- 追加落地：数字伙伴编排器麦克风使用浏览器 SpeechRecognition（无支持时给出明确反馈），工作区语言属性和浅色/深色/跟随系统主题设置会实际应用到页面根节点。

### 2026-10-04 Hermes 独立人格服务器验收

- 服务器 `/opt/ziwei` 已切换到 `codex/hermes-independent-profile`，部署提交 `d1a4c9c`；部署前备份为 `/opt/ziwei-backups/ziwei.sqlite.20261003T165528Z`，生产 `main` 保持不变。
- 本机 `bjc-ops` daemon 与服务器 A2A 令牌已同步。由于服务器使用自签名证书，启动器现在支持配置 `tlsCaFile` 并把证书作为 `NODE_EXTRA_CA_CERTS` 传给子进程，不再依赖关闭 TLS 校验。
- 真实动作验收通过：Hermes profile `ziwei-aigc` 返回 `HERMES_PROD_PROFILE_OK` 与 `HERMES_PROD_PROFILE_RECHECK_OK`，服务器动作终态为 `succeeded`。
- 本轮质量门槛：`npm test` 90/90、`npm run lint`、`npm run build` 通过。工作树中的 `tmp_gzgov.html` 继续保留，未改动。
