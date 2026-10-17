# 手机文字输入、自动回查与后台生命周期修复

2026-10-16（Asia/Shanghai）。正常故障处理由程序自动观察原回执和当前页面；不把结果未确认默认转交用户，也不自动重放整轮手机业务。

## 10月17日接续进展

用户恢复手机和电脑后，本对话手动继续工作；10月16日应用户要求暂停的定时接续仍为 PAUSED，没有自动重新启用。

09:25 至 09:33 的只读证据确认，原 Agent18 事务 `device-update-21866c8a-7d0d-4bad-ae35-76a529106451` 已 committed，submitted=1、installed_at 为 09:24:01.773；Agent=`0.4.7 / code18`、Updater=`0.4.5 / code16`，均在线健康。Agent 的 `startTrigger=package_replaced`，包更新时间与本次 reason 10 退出时间同为 `1792200237930`，标记 `updateRelated=true`；Updater 的启动来源为 `peer_recovery`。这证明本次包替换后的实际恢复，不等于杀进程、用户 Stop、重启或长期存活测试。

两端持续报告 `socketConnected=true`；源码仅在 WebSocket `onOpen` 时置 true、关闭或失败时清 false，已取得原手机的实际鉴权握手证据。Nginx 09:23:57 另有真实 channel 101；访问日志不包含设备身份，且长连接可能在关闭时才写日志，不单凭这一行指定手机或角色。

09:31:23 主站活动业务为 0 后，沿原门禁一次提交 Updater18 事务 `device-update-5537b65e-890d-4dc5-825c-36f678ba77bf`，预检原命令 `device-command-e8ff9f5d-bfdd-403e-a190-2d5ef119aeb1` succeeded。该事务 submitted=1 / awaiting_user_action、无 installed_at；没有重提安装。09:33 打开原安装端 Agent 的命令 `device-command-47b03653-cf52-4b0b-820f-9e7e4674acd7` 被 Android 拒绝，failed / not_started / COMMAND_NOT_STARTED，executingConfirmed=false；错误为“指令角色、期限或控制授权无效”。原因是等待安装确认时没有普通租约，客户端安装辅助仅接受截图和点击，launch 无法执行。该失败不改写为成功，后续只在修复授权后发起有独立 ID 的明确未执行动作，不重提原升级。

09:31 前的新电脑业务先由原门禁阻止，待其自然 succeeded 后才开始升级。原业务门禁未修改，未知新业务仍默认阻止。私有证据为 `resume-20261017-device-01.json`、`resume-20261017-device-02.json`、`resume-20261017-ws-lifecycle-01.json`、`resume-scope-terminal-20261017.json` 和原升级 / 命令记录；不公开业务词或截图。下方 10月16日离线及“待取得握手”描述保留为当时的历史状态。

**09:53:32 中控授权衔接修复已发布。** 源码 `67c9b29b07a4975f5c632b724d2daea2afb983c9` 已独立审查、先推 GitHub，完整源码归档 SHA-256 `c89773b567f9779acc2fe50a4f1faec5040057d3a8c0cae608ec4d143d2e3dcf`。远端隔离环境 73/73 回归（含新增 21 项）、0 failures / cancelled / skipped，正式类型检查与构建退出码 0。测试仅执行一次；Node 默认 spec 输出曾使报告解析器未识别总结，保留原失败报告及原日志摘要后，按实际 73/73 结果继续同源构建，没有重跑业务或伪造测试结果。部署前后核对全部 302 个源码成员和 20 个构建产物摘要。

修复新增内部可空列 `android_commands.install_resume_update_id TEXT`，把打开原安装端的单条 launch 绑定原已提交、未安装、awaiting_user_action 的升级事务、原安装端当前 session / epoch 和自身包名。仅首次 queued 投递给有界正常租约，该次 poll 不重发 update 对象，兼容既有 APK；后续 poll / heartbeat 不续租或重投。executing ACK 再核同一绑定，终态缩短租约且保留在途隔离。其他应用、业务动作、角色或并发命令不能借用该租约；本机 enabled / Stop 继续优先。安装 session、原 confirmation 和原升级状态不被改写。

生产中控 current 为 `/opt/ziwei-control/releases/phone-stability-67c9b29b07a4`，仅中控服务重启。备份为 `/opt/ziwei-staging/backups/control-installer-resume-20261017T015331Z`；所有原 commands / updates / sessions / update_events 的旧列逐行摘要、数据库 inode、原 `5537b65e…` pending 行均保持。唯一 schema 变化为上述可空列，全部旧命令此列为 NULL；主站、客户端、Nginx 和所有 APK 字节保持。旧 `1b26b115` 模块已在包含新列的隔离内存数据库完成入网、心跳、命令与回执兼容检查；回退仅切代码，不恢复数据库覆盖自然进展。

09:54 后原电脑又出现新的目录与会话任务，未修改的业务门禁阻止了修复后的 launch，阻止发生在 POST 和持久提交意图之前，没有新手机命令 ID。继续核对业务范围或等待原任务终态，不放宽未知业务，也不重提 `5537b65e…` 安装。Updater18 安装和真实中文输入仍待实际结果。

## 已发布与待完成

| 层 | 源码 / 产物 | 状态 |
| --- | --- | --- |
| 主站 / API | `891685f70e9e4bfc2c56821ee2cc9a28a356f548`，分支 `codex/android-stability-main` | 11:09:08 发布，`/opt/ziwei/releases/v2-hotfix-891685f70e9e/v2` |
| 官方 Windows 客户端包 | 同一提交；build `6b8449d952039abf08bde26c3b3a840e297a250cf684378cd4c4c1371699a8b1`；包 SHA-256 `4d993a13c29cdb66b22d71ccacc77d6a4424fc63766d93a182bf69b19ba52a9f` | 已发布且公网逐字节回读；不等于电脑实际安装完成 |
| 中控 | 私有仓库 `jinjinli226-netizen/ziwei-system`，分支 `codex/android-input-lifecycle`；`1b26b11538916bd2dedd8685bfaa752f5736f567` | 已先推 GitHub，11:50:25 发布，`/opt/ziwei-control/releases/phone-stability-1b26b1153891`；前版 `8be4604` 于 11:15:29 发布 |
| Nginx WebSocket 代理 | 已推模板源码 `98db76d4fa0e42f019e81bf446d382891ec1253f`，仅 10 行精确 channel block | 13:10:38 部署，语法 / graceful reload / 无凭证 401 空 body / Origin 403 空 body 通过；认证手机 101 待补 |
| Android code16（历史发布） | `8be4604f2938271bf54798db9e74ac3dfa0c3b37`；`0.4.5 / versionCode 16` | 11:24:57 原证书发布，11:58:24 双端均在线健康，两条原升级事务均 committed |
| Android code17（历史发布） | `1e7977b43fda78eabc924e8a15c4502dc9a82131`；`0.4.6 / versionCode 17` | 12:20:17 原证书发布；Agent 原 code17 事务 committed，12:38:27 快照 Agent=17 / Updater=16；12:45 实际中文输入未执行 |
| Android code18（当前官方下载） | `c54ec5332c1686d6478aca14aa23cb25166713ce`；`0.4.7 / versionCode 18` | 已冻结、推送 GitHub，106/106 JUnit / 双 R8 / 双 Release 完整构建通过；12:56:34 原证书签名发布，公网回读通过，安装 / 实机验收待补 |

13:16:21 的最终只读快照显示，主站已由另一项后续发布推进到 `eabe098af3b6c0e7d76cf4121052e3606e022888`（`/opt/ziwei/releases/v2-hotfix-eabe098af3b6/v2`），该提交继承本轮 `891685f` 手机修复；已核对 ancestry 和 phone MCP 差异，未覆盖原回执机制。官方下载客户端元数据为源码 `5db7d834deaf3524adfada59a434bc764fda750a`、build `208f2350ff390bbf7506e6baaef60eb7c8d467f2c8630a86c670ce01aada1044`、包 SHA-256 `2aadef1b066953fb81ff247ec16cd1a5e5e91a8d34490b66b8d47f11fa13d734`。这些后续发布保持现状，不回退为 11:09 的历史包。中控仍为 `1b26b115`；双服务、公开健康与 Android index 在最终检查中正常，手机双端仍离线，活动手机命令为 0、原安装事务为 1。

原签名已私下获得并验证。官方最新 APK 为 `0.4.7 / code18`，Agent / Updater 包名仍为 `com.ziwei.device.agent` / `com.ziwei.device.updater`；code16、code17 和 code18 均通过 `apksigner 35.0.0`、包名 / 版本 / 字节数 / SHA-256 校验，证书 SHA-256 与原版一致：`6292cfac129ee17f36d0c08ebc430fd4b0e502c7ccce99927ea70c3f149e80f8`。发布 manifest 保留 `deviceVerified=false`，没有把发包写成完整实机通过。

| code16 历史安装包 | 字节数 | SHA-256 |
| --- | --- | --- |
| Agent | 846630 | `5524ed1e312536b3318574d7803d932456c5f65e31b9accdfa990a77cccf824b` |
| Updater | 846634 | `fa9f21552cd997a3e4ebfd987941d7446601132c8043dc99bcdaed7564ab1376` |

| code17 官方安装包 | 字节数 | SHA-256 |
| --- | --- | --- |
| Agent | 861862 | `685241034dddeb6f96e046401996f7f213707c58382d6d6151d9c96d931b8be2` |
| Updater | 861866 | `eec6400c945dbf601258ab405b34bf1f35bd5e6f75d8c489ad69d4726f96deb1` |

| code18 官方安装包 | 字节数 | SHA-256 |
| --- | --- | --- |
| Agent | 869578 | `f6e5d83917e91ec79ef0a437a75e687bd9324622ce785fc9bf42248468f91531` |
| Updater | 869582 | `f689a4263b2e8c775435376a824821596a4a48bab761ea133a7991a40b0868a3` |

code18 冻结归档 SHA-256 为 `bca0a4e87d299341ef2a56fd4dafa53fa6ef6c771efaca467612f90b2e186b08`。它是本次构建源码身份，尚不是 APK 摘要或实机通过证据。

## 证据与实际修复

闲鱼1设备 `android-a2d39137-4c04-463c-b03b-6165a9f12f35` 三条中文输入命令均有 executing ACK 和 uncertain 回执，但只留下 `执行结果待核实 ExecutionException`，没有原 cause。不能从历史记录反推每条输入失败的具体原因，也未独立目视旧截图。旧源码只查 active root 的 input focus，且未验证写入结果。

- 输入目标改为前台非键盘窗口中的安全可编辑节点，优先唯一焦点，无法排歧时不写入。查找有时间、节点和深度上限。中文直接通过 `ACTION_SET_TEXT`，同一节点自动读回验证；系统返回 false 也可能是回调超时，读回成功才宣告成功，不盲目重发。
- 取消门禁覆盖主线程排队动作，超时后尚未开始的动作不会稍后落地。执行前明确拒绝报告 `failed / not_started`；可能产生副作用但尚无验证的情况保留 `uncertain`。executing ACK 不代表动作已发生。解包 `ExecutionException` / `CompletionException`，保留可读错误和 `errorCode`。
- 后端对已受理命令按原 commandId 自动只读回查，最多两次；手机 MCP 对失败的只读请求最多重读一次，不重复动作提交。AI 获得继续观察原回执 / 当前页面的指引。截图已完成但图片下载失败时保留真实动作终态，单独说明图片交付问题。
- 聊天保留员工完整总结及底层错误。混合动作不把先前成功点击描述成整轮未执行；同一原命令的最终回执可解除早期未确认状态，别的命令成功不能抵消。automation 不自动或同 run 手动重放整个已尝试手机动作的流程；电脑进程完整退出时不会因手机结果未知而误隔离电脑。
- Android 新增系统退出历史、机型 / 系统、前台通知、省电 / 后台限制和内存诊断。读取失败的字段保持未上报。伙伴恢复识别用户停止、设置有界持久退避，旧回调不复活已停服务；前台状态恢复失败会退出并释放唤醒锁。
- 控制 POST 改为有界短超时；APK 下载和安装串行放到独立 worker，不阻塞心跳。安装提交前再次检查停止和授权状态。Receiver 的磁盘与安装查询移出主线程。日志面板改为后台读取和缓存，最多 200 行 / 32 KiB UTF-8，暂停或销毁页面后拒绝晚到更新，清空显示保留之后新增事件。
- 正式终端页每个角色增加折叠诊断，缺字段显示未上报，离线记录带时间；历史退出原因不自动等同本次离线原因。
- 中控 `1b26b115` 增加已确认安装结束后的显式恢复交接：只允许离线目标交给原健康安装端，仍检查原动作与租约排空、递增 epoch 并留审计。实际控制端为安装端时，轮询不重发已完成的安装工作，避免旧 APK 因收到 update 对象清掉本地租约；原 awaiting_health 事务继续保留在数据库和状态接口。安装未完成阶段的隔离不变。
- code17 在未声明 SET_TEXT 的同一目标上增加 API33 无障碍输入连接；已有原生写入发出后不会转后端重写。异步只读、会话 / 授权 / 取消重检、单次提交与自动读回机制已实现，但现场 text 仍被焦点安全检查拒绝，不能称闲鱼中文已修好。
- code18 增加 `isFocused` 或系统 `root.findFocus(FOCUS_INPUT)` 精确等于原节点作为输入焦点证据，不根据键盘显示、无障碍焦点或仅同包名豁免。生命周期实现持久冻结首次 MY_PACKAGE_REPLACED 边界和精确退出标记，重复广播、空结果或晚查询不能绑定后续退出；首 MY 之前仅用窄时间窗推断，SDK34 的 reason 10 不适用升级例外。
- code18 的主进程 Application 入口单次登记 13 字节版本 summary，已知同 / 高版本或坏 summary 拒绝升级豁免，保留本机 Stop、enabled=false 和 FLAG_STOPPED 优先。旧 code17 没有 summary 时，首次 MY 之前的 reason 10 仍有因果歧义，不能称已证明旧版本或绝对识别用户停止。系统历史 / 包信息查询在 worker；主线程仅有早期 summary 登记和微小广播边界持久化。

现场已经回传退出诊断，但仍不能断言已定位其“经常被杀”的具体根因。Updater 有升级后自动恢复证据；Agent 的本次启动来源和旧 reason 13 记录仍有证据缺口，详见下方设备验收。用户明确停止继续被尊重，不用双端互拉风暴覆盖用户意图。

## 验证范围

- 主站相关回执、自动回查、A2A、daemon 与 reconciliation 联合回归 66/66；正式诊断 UI helper 6/6。lint 150 个源文件、构建和离线客户端依赖闭包通过。
- 主站更广的旧测试存在 4 项已在未改发布基线上复现的 Mac 环境失败：本地 Sonnet 模型、两项 Hermes profile、Windows 固定路径断言；不把它们算作通过。
- 精确 Android 提交 `8be4604` 在隔离 Linux 工具目录运行 Agent / Updater 各 38 项 JUnit，共 76/76；两个 debug 角色 R8、两个 unsigned release 的编译 / Dex / Lint / 组装通过。
- code17 提交 `1e7977b` 在远端完成各角色 43 项 JUnit、共 86/86、0 failures / errors / skipped，R8 和 Release 构建通过。code18 `c54ec533` 已冻结并推送 GitHub；远端各角色 53 项、共 106/106 JUnit（0 failures / errors / skipped）、双 Debug R8 和双 Release 完整 Lint / compile / Dex / assemble 均已通过，完整构建 2m31s、159 个任务全部执行，日志有 CODE18_BUILD_TESTS_SUCCESS；原证书签名与 12:56:34 公网发布验证已完成，安装和实机证据待主代理补入，不将完整构建通过写成手机验收通过。
- 中控 `8be4604` 的 Android 设备、轻量回执、终端控制及 MCP 集成 50/50；最终恢复提交 `1b26b115` 新增两项后，远端最终回归 52/52、0 skipped。中控 Vue 类型检查和构建通过；此次 server 修复没有重建或更换 code16 APK，Android 76/76 的源码基准仍为 `8be4604`。
- Mac 未新增监听服务；需要监听的中控集成测试在服务器隔离 staging 数据目录运行，未使用生产库。
- code16 双端实际升级和 code17 Agent 升级已完成，历史包逐文件摘要保持；APK 发布未启停服务、未改数据库。12:02 code16 与 12:45 code17 的真实闲鱼中文输入均未通过，返回确定未执行；code18 尚未实机验收。断网 / 熄屏 / 重启和长期存活证据仍待补。构建、单元测试和下载验签不能代替这些实机证据。未发布闲鱼商品、发送消息或修改历史回执冒充成功。

## 设备验收（当前双端离线，code18 原事务待安装确认）

11:17:12 的发布后只读快照仍显示闲鱼1双端 `0.4.4 / code15`；该快照早于 code16 APK 发布，不能代表后续升级结果。

**当前记录：Agent17 / Updater16 自 13:01:19 之后双端无 HTTP 并离线。** code18 原 Agent 升级事务 `device-update-21866c8a-7d0d-4bad-ae35-76a529106451` 为 submitted=1 / awaiting_user_action、无 installed_at。原事务已受理但尚无安装结束证据，不能重提安装或宣告 code18 已升级、自动恢复或输入成功。服务 API / Nginx / 下载仍 200，但没有新退出或 TLS 失败证据，不能据此归因“被杀”或 WebSocket。程序分别调查 TLS 与绑定电脑恢复通道；此前在线健康快照均保留为历史时点。

绑定电脑的只读查询也显示离线，最后 heartbeat 为 12:59:40、未见活动任务；没有操作其他电脑或修改 allowlist。生产公开证书的磁盘与实际服务端回读 SHA-256 均为 `c7e65503c1a23b41e17f498ec29bd8150302c43ecb819664d1eb1755799f2f0c`，mtime 为 10 月 4 日，有效期 2026-10-04 至 2027-01-02；13:01 附近没有 Nginx reload，仅有下述 13:10 修复。Android 使用系统默认信任链，没有缓存该叶证书或固定 pin。此证据仅排除该观察端所见证书过期 / 轮换，不能证明手机网络或 TLS 正常，不能据此判断被杀原因。

| 验收项 | 当前记录 | 待补证据 |
| --- | --- | --- |
| Agent / Updater 沿原协议升级至 code16 | 11:58:24 双端均为 `0.4.5 / code16`、online；无障碍 / 亮屏 / peerBound 均为 true，locked=false；两条原事务均 committed，control=agent / epoch 3、draining=false，活动动作与升级均为 0 | 已取得版本、事务和健康心跳；不等于长期存活验收 |
| code17 实机升级 | Agent 原事务 committed；12:38:27 快照 Agent=`0.4.6/17`、Updater=`0.4.5/16`，双端在线健康 | 不把 Agent 升级扩大为 Updater 已 code17 或 code18 已升级 |
| 中文输入与焦点 / 键盘切换 | code16 `0ad2168c…` failed / not_started / INPUT_UNSUPPORTED；12:45 code17 `5309ba7c…` failed / not_started / INPUT_EDITOR_FOCUS_REQUIRED | code18 修复后的原命令 textVerified、页面观察及焦点 / 键盘切换证据尚未取得 |
| code18 安装与恢复 | 12:56:34 原签名发布通过；原 Agent 事务 21866c8a… awaiting_user_action / submitted=1、无 installed_at，Agent17 / Updater16 当前均离线 | 按原事务等待可核安装状态及恢复通道，不重提；双端 code18、健康和输入均待补 |
| WebSocket channel 修复 | 13:10:38 代理补丁已部署，真实 Upgrade 无凭证 401 空 body / Origin 403 空 body 通过 | 未取得认证手机 101；不以代理探针替代手机连接、安装或输入验收 |
| 系统退出诊断与后台恢复 | OPPO PHJ110 / Android 13；双端前台与通知启用、忽略电池优化为 true，后台限制 / 省电 / idle 为 false；Updater 已证明升级自动恢复，Agent 启动来源未证实 | 断网 / 熄屏 / 重启恢复及长期观察；未知退出原因保持未知 |
| `1b26b115` 恢复交接分支 | code17 Agent 已安装 awaiting_health 且离线时，实际交接 Updater / epoch 5，Updater16 正常 lease 下 launch succeeded，AI 允许打开并显式 Start 后 Agent17 健康 / committed；12:42 已恢复 Agent / epoch 6 | 旧 APK 兼容恢复分支已实测；Agent17 仍依赖 AI 显式 Start，不能宣称自动复活 |

两条升级事务为 Agent `device-update-3d4973fa-573a-4cea-806a-a32ff78d0b35`（安装端 Updater，installed_at 11:42:08.700）与 Updater `device-update-468c004f-1162-4d11-b7fe-63cfea614200`（安装端 Agent，installed_at 11:56:49.277），均为原签名 code16，原记录保留。

真实闲鱼 text 命令 `device-command-0ad2168c-180b-4d28-8748-47ea7ad2cb3e` 于 12:02:23 提交，12:02:27 按原 ID 回查为 `failed`，结构化结果为 `executionState=not_started / errorCode=INPUT_UNSUPPORTED`，底层错误“目标输入框未提供系统文本写入操作”。虽有 `executingConfirmed=true`，本次尚未开始写入，不能视为中文输入成功；code16 实际控件兼容仍待定位与修复。保留该原回执，不盲目重复提交。

Agent code17 原升级事务 `device-update-3060d5bb-579c-4cb5-98f8-3dc6cc721c56` 已 committed，installed_at 为 12:29:07.407。code17 实际 text 命令 `device-command-5309ba7c-9c68-48dd-bde5-436235039298` 于 12:45:07 提交、12:45:11 回查 `failed / not_started / INPUT_EDITOR_FOCUS_REQUIRED`，底层错误“系统输入连接要求目标为当前非密码输入焦点，未继续输入”，有 executing ACK、没有写入成功证明。保留原 ID，code18 实机结果待补。

code17 恢复时，`handoff_recovery_v17` 在 Agent 已安装、awaiting_health 且目标离线条件下实际 POST control=updater 成功，epoch 5；Updater16 的旧 poll 获得正常 lease，原 launch 命令 `device-command-288d2de9-e63e-4c43-b1f6-7ef51e2002c1` succeeded。AI 随后允许打开并点击 Start，原命令 `device-command-1094e3b2-9cbb-4264-bfdf-582fae510088` succeeded，Agent17 才恢复健康 / committed。12:42 已恢复 control=agent / epoch 6。此为 `1b26b115` 兼容旧 APK 的真实恢复分支证据，同时明确 Agent17 并非无需显式 Start 的自动复活；早期 code16 那次脚本因事务已 committed 停止只作历史记录。

11:58 的 code16 快照中，Updater 的 `startTrigger=package_replaced`，reason 10 退出记录 `updateRelated=true`，退出时间比包更新时间早 13ms，支持本次升级后自动恢复。Agent 的 `startTrigger=explicit` 来源未证实；reason 10 显示名为“用户请求停止”、`updateRelated=false`，退出时间比包更新时间晚 340ms，这组证据仍无法区分旧 Android 升级退出与用户停止，不能认定此次 Agent 上线全自动，也不能据此认定用户主动停止。两端旧 reason 13“其他系统原因”缺少进一步原因证据，不能归咎 OEM。

上述 340ms 为 code16 历史记录。code17 Agent 又出现 reason 10，退出 `1792124945625` 比包更新 `1792124945610` 晚 15ms、`updateRelated=false`；这是 code18 修复升级恢复误判链路的现场依据，不足以将 Android 13 同码歧义彻底消除。

以上待补项由程序沿既有回执和只读观察链收集；不默认转交用户逐项核实，也不重放真实业务。

## 发布、数据保护与接续

先推 GitHub 并核对远端，再按相同源码归档发布。主站和中控分别只重启自己的服务。11:50 恢复发布在停服务前后均要求活动手机命令为 0，仅允许精确原 Agent `3d497…` 已安装且 awaiting_health 的事务保留，拒绝其他未完成升级。SQLite 备份使用 backup API，核验 integrity / FK，保留原数据库 inode；中控 schema 与全部原命令、升级和会话行摘要保持。11:09 主站及 11:50 中控发版时 Nginx 未改；13:10:38 的 channel 配置修复是后续明确例外。

- 主站 / 旧客户端备份：`/opt/ziwei-staging/backups/phone-receipts-20261016T030906Z`。
- 中控初次发布备份：`/opt/ziwei-staging/backups/android-control-20261016T031528Z`；11:50:25 恢复发布备份：`/opt/ziwei-staging/backups/android-control-20261016T035025Z`。
- 旧主站：`/opt/ziwei/releases/v2-hotfix-cd610444ce79/v2`；中控此次回退基线为 `/opt/ziwei-control/releases/phone-stability-8be4604f2938`，更早的 `/opt/ziwei-control/releases/8a4fe59` 继续保留。
- Android 历史包已逐文件核对复制至 `/opt/ziwei-control/shared/downloads/android`；新 release 的 `dist/downloads/android` 指向它。11:15 中控切换时原 index 保持 SHA-256 `20cc66c484238f3e8316b7ce9604cbc5fb45785736624552708a9d658c8aef7a`。
- 11:24:57 仅新增 `v0.4.5-code16` 产物，并最后原子更新 index；历史包与旧 release 条目保持。新 index SHA-256 `1f64cec0f3eed435af75baafa8e96dd70de7adb95566407d82fc59878a7d5aa2`，manifest SHA-256 `8b1806e70d3a1c275a6d9fabfeaa38f00abb5febae281d752f9fcf7e47adabb8`，公网回读匹配。
- APK 发布备份：`/opt/ziwei-staging/backups/android-apks-20261016T032457Z-23bc1467`，保存原 index、拟发布 index 及结果。撤回下载索引时恢复该原 index，保留版本化产物供复核；不删除历史包。
- 11:50:25 中控恢复发布确认 schema、全部旧 command / update / session 行摘要、数据库 inode、主站与 Nginx 服务及配置均保持；Android shared 下载目录与 index SHA-256 `1f64cec0f3eed435af75baafa8e96dd70de7adb95566407d82fc59878a7d5aa2` 保持。
- 12:20:17 code17 原签名双包发布，保留 code16 及更早版本；备份 `/opt/ziwei-staging/backups/android-apks-20261016T042017Z-fcda5d01`。新 index SHA-256 `4015ae5a1f80545ac89ff4f098ef3c5f5741b1f3e0ac9d44f15f77780639a016`，manifest SHA-256 `9f1d5c99a2b501ed04f368fc5cb1be38374fe05a0d34924bc664b2dfb2ae443f`，公网回读通过；未修改服务或数据库。
- 12:56:34 code18 原证书双包已发布，publicVerified=true、历史文件保持、servicesChanged=false / databaseChanged=false；备份 `/opt/ziwei-staging/backups/android-apks-20261016T045634Z-452e0449`。当前 index SHA-256 `49204ab39fa7843a12efcd0918581810b962ec98d393d13ef8e7c75805391ac2`，manifest SHA-256 `f286bdc0c7575b2e751e4bbf7139e04af9773f626ddab3ad7eda0d709bd85959`；安装验收仍待补。
- 13:10:38 仅向原 Nginx 配置插入源码 `98db76d4fa0e42f019e81bf446d382891ec1253f` 的 10 行精确 `/api/device/v1/channel` block。配置 SHA-256 `21a955cdfaef8d16837671b20ec07ddcf4c7f61d0c1feea9c1885a4a3dedd231` → `8c92827d0e8cae5377c04f33bc775c3c9ab39b156d924638abca7a7a25472aec`，其余配置字节保持；备份 `/opt/ziwei-staging/backups/android-websocket-20261016T051038Z`。发布脚本在 reload 前记录尝试状态并检查配置漂移，语法 / 探针失败时恢复原配置并 reload。实际 nginx -t、graceful reload、无凭证 Upgrade 401 空 body、有 Origin 403 空 body 验证通过；主站 / 中控 PID 和 current、code18 index 均保持，无 DB 写。authenticatedDevice101Verified=false，认证手机连接尚待观察。
- 回退服务只切代码 current 链接并重启对应服务，必要时恢复客户端发布三文件；不覆盖当前业务数据库。手机覆盖更新不能直接降级，恢复旧逻辑需原签名与更高版本号。

**本轮状态：代码、构建和发布完成，真机验收未完成，已自动接续等待连接恢复；完整任务尚未完成。** 原签名、code16 双端升级及 code17 官方发布 / Agent 升级均已完成；code18 `c54ec533` 已推送且 106/106 单测及完整构建通过，12:56:34 原证书签名与官方发布验证已完成。已为本对话创建 heartbeat“闲鱼1恢复后自动接续验收”（id 1，ACTIVE，每 10 分钟）；私有 `resume-state.json` 保留原 `21866c8a…` 事务、证据路径和严格不重投约束，连接恢复后继续完成双端 code18 与实机输入验收，通过后停用计划。该计划依赖本 Mac 开机且 Codex App 运行，不是任意时刻均能执行的云端任务。

输入验收仅为“中文+数字搜索词（仅搜索框，不提交搜索）”；公开文档只记原命令 ID、状态 / 校验位，不放原词、截图或完整业务数据。程序继续在同一原回执和当前页面上定位输入问题，验证焦点 / 键盘切换、读回和后台存活，不重复真实业务动作。私有证据位于 gitignored `.local/android-stability/`：部署依据 `control-recovery-deploy-result.json`、`test-recovery-final-check3.json`；code16 为 `device-observe-05.json`、`xianyu-text-1.json`；code17 为 `apk-publication-v17-check1.json`、`v17-device-observe-02.json`、`v17-xianyu-text-1.json`；code18 当前有 `code18-source.json`、构建 / 签名 / 发布和首个升级 tick 记录，最终手机原事务与文本回执待主代理补入。不得提交其签名或运维凭据。

## 签名材料的未完成安全事项

原签名材料已私下接收并用于本次签名。误传材料已在 `dd813218` 从公开 `main` 最新文件树删除，`709166` 增加忽略保护，但历史仍可访问，尚需后续独立处理；不能将删除最新文件或添加忽略规则当作已清除历史暴露。文档不提供该材料的位置或下载入口。仓库补充 `*.keystore`、`*.jks`、`*.p12`、`*.pfx` 忽略规则，签名与运维凭据仅保存在私有目录。
