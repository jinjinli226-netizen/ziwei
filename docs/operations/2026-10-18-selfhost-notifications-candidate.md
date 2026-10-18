# 自建通知交付：员工名、正文和原聊天

用户已明确选择：不接第三方推送；消息通知显示员工名字和消息内容，点击打开对应原聊天；先在模拟器测通再提供安装。旧 code 11 / TPNS 候选停止推进，本版不需要腾讯推送、FCM 或各手机厂商的账号和密钥。

## 实现

手机直接用原账号的 HTTPS Cookie 连接紫薇自有服务器。新版只读提醒 v2 提供分页、最长 25 秒等待和按原事件重新鉴权的查询，复用现有 `notifications` / `audit_events` 持久记录，不新建推送表、不初始化旧 TPNS worker、不改变共享已读。

员工真实回复的标题是员工名，预览是有界纯文本正文，保留换行、URL 和 emoji；标题上限 160 UTF-8 字节，正文上限 1,024 字节，总响应 64 KiB。HTML / 图片内联字节不进入通知。人类伪装的 assistant 消息不作为员工回复。执行终态、任务负责人证明、群成员和设备可见性仍沿已复审规则；无法证明的群通知隐藏。汇报仍来自原员工聊天，没有第二套汇报执行。

通知的点击能力在手机私有偏好保存随机 key、有限 ID 和代次，不保存正文或 Cookie。点通知先核对当前账号 / 工作区，再由页面重新查询该事件权限，最后打开原员工 / 会话 / 消息。失权时显示错误并保留原草稿。关闭或登出立即使旧回执失效、停止连接并清本 App 通知；换账号的迟到结果不能恢复旧连接。

用户点“开启消息通知”后启动 `specialUse` 前台服务，明确申报持续接收自建员工消息与任务提醒。连接状态使用独立、低重要性、静音通知，员工消息使用正常提醒频道。用户可在 App 或连接通知上停止接收。没有假扮播放音频、短信转移、无障碍或设备管理器，没有自动修改电池设置；系统设置入口仅打开当前 App 的应用详情。

正常后台使用有界长轮询，断网退避后自动重连；网络恢复唤醒与等待使用同一锁，避免丢唤醒后空等。逐条展示前重新鉴权；已处理项按当前账号代次的摘要跳过，以便弱网下部分处理后能继续推进。只有明确 `MOBILE_NOTIFICATION_NOT_FOUND` 的 404 才按已消失项跳过，普通路由 404 不当作消息已处理。约 15 分钟 Job 与实时连接共享游标和去重，仅作补充。

前台正在查看的原聊天由本机免重复，不推进未看到消息的共享已读。初次开启跳过旧事件；v2 游标保存通知与 audit 两个基线及原时间，防止同毫秒或晚补录旧事件重新弹通知。游标失效只建立新基线，不重放历史。旧 v1 原生订阅升级后需重新开启，不混用游标。

## 系统与验收边界

前台服务本身不提供 Doze 网络豁免。用户可以在系统设置中允许后台运行、检查电池限制；深度省电仍可能暂停连接。强行停止或手机重启后需重新打开 App。锁屏内容遵守手机原有隐私设置。不能宣称所有手机被强杀后仍即时送达。

正式包固定连接正式 HTTPS 源，禁止明文、重定向和 TLS 错误放行，无自定义通用 TrustManager、测试 CA 或可传入任意 API 的调试桥。模拟器测试使用的独立 smoke 包必须用不同 applicationId，仅 localhost 专用 CA、完整证书链和主机名校验；固定源码、允许差异与哈希另记，不能当作正式准确 APK 的真实后台送达。

## 发布衔接

- Android 分支：`codex/android-selfhost-notifications`，版本 `0.5.0-internal` / code 12；准确正式 APK 的模拟器与生产接口验收已通过。
- 后台分支：`codex/mobile-selfhost-notifications`；首版 v2 为 `ca905ecc`，精确服务启动入口修复为 `a4e0e1fc`，后续标题规范化等修复以最终固定提交为准。
- 相对旧正式 API `874fcb14` 的最小运行增量为 `backend/{app,auth,repository,mobile-notifications,mobile-group-action,mobile-notifications-v2}.mjs` 六个文件；上线前必须重新核实际正式源码，不可覆盖之后的恢复、停止、轮数或并行调度修复。不需要新依赖、DDL、厂商密钥或员工电脑手工配置。
- 回退须保持可信任务绑定 writer / 无效标记和公开字段剥离连续性；可以停 v2 路由，不能裸退旧 writer 再前滚，造成证明缺口。
- 新版服务尚未上线时明确提示服务未更新或接收未运行，不能以编译、夹具或旧包截图称正式包已经测通。

2026-10-18 11:01（Asia/Shanghai）只读现场核对：正式 API / frontend 为 `d45317011235f38c0f1b5b2f2e60eff322338135`，current 为 `/opt/ziwei/releases/unlimited-parallel-d45317011235-55597409/v2`，CLI 为同一提交 / build `203fe63c886b4a98ef510a6302c84c6291f9eb66f095ed42549c4f0d9e903116`。现场尚无 v2 路由或三个通知模块。`df2f1943` 到 `d4531701` 没有 backend 差异；现场 auth 与 Git 的差异仅 CRLF / LF，规范化后内容相同。必须在该现场全树上叠加六文件增量，沿原四锁、snapshot / CAS 进行受控发布，保留 frontend / CLI，不能套用旧正式路径。

**11:25 再次只读核对发现正式 current 已变为 `/opt/ziwei/releases/default-unlimited-12d5aa9f6d62-3f149f60/v2`。** 旧 d453 snapshot / CAS 已正确拒绝，变化包含 API 树、current、frontend / CLI 元数据与服务身份。当时未执行远程 stage、切换、重启或数据库写入；之后重新核对 12d5 完整现场、生成新受审基线并完成发布，见下文最新记录。

## 固定安装包

| 项目 | 值 |
| --- | --- |
| 固定源码 | `cde5da801e51e01f98e97cbbd8208651b59f5bc6` |
| 包名 / 版本 | `com.ziwei.manager` / `0.5.0-internal` / code 12 |
| APK SHA-256 | `741acad95d933d0db8af7e9b6670fb00a0c605d39c3fbebfb63a7fd6065e3261` |
| 文件大小 | 764,115 bytes |
| 原有签名 SHA-256 | `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35` |
| 后台候选 | `0c8dc4a955ef7b65bc496ce7f43246b88201a088` |

安装包及 `manifest-code12.json` 位于 `mobile-manager/dist/`。独立二进制复核确认 24 份网页资源与固定源码 / manifest 逐字节一致，包内没有第三方通知 SDK、native `.so`、测试 CA、localhost 源或可调试开关。两个服务均私有，权限只有网络、通知、网络状态和前台服务所需两项。此记录是构建与二进制证据，模拟器 / 正式接口验收须另附实际结果；`deviceVerified:false` 保留，不能据此声称真机已验证。

已在原仓库发布[内部测试版 0.5.0](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.5.0-internal)：[直接下载 APK](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.5.0-internal/ziwei-manager-0.5.0-internal-code12.apk)。tag 实际解析到准确 cde5da8 源码，匿名完整下载 SHA-256 与上表一致；随包附 `.sha256` 与 `manifest-code12.json`。安装二维码指向同一直接下载 URL，保存后重新解码核对。发布检查记录位于 `.local/mobile-manager-release-0.5.0/result.json`。

同包名、同签名覆盖安装即可；打开 App 的「最近提醒」开启消息通知并允许系统通知权限。常规升级不卸载。手机实机尚未验收，不改变 `deviceVerified:false`。

## 代码与测试记录

网页 400 项检查通过，定向通知 / API / 页面联动 112 项通过；后续接收未运行状态小修另有 71 项通过。合成浏览器检查覆盖 390 / 320 宽度，无本地监听和真实业务写入。

后台固定 `ca905ecc` 的独立扩大反例 14 项、通知 v1 / v2 / F1 / F5 回归 67 项通过；`a4e0e1fc` 服务入口 2 项通过。原生弱网、代次、去重、标题及线程策略持续在最终冻结点复核。后续实际 APK 和模拟器结论只按准确哈希记录。

前一冻结点 5a28 的网页及后台组合测试 417 / 417 通过；原生 JVM 检查 266 项通过，其中包含真实接收 lease 的代次互斥、同锁网络唤醒，以及逐项重新鉴权超过处理预算后仍能推进分页尾部的回归。独立复核重复通过。员工名包含换行的跨端契约已修复：后台标题改为单行、正文保留多行，真实 Cookie → HTTP → 网页解析 6 项及原生标题验证 7 项通过。

### Android 验收进展

恢复测试后，实际 Android UI 发现旧候选把工作区成员记录的 `id` 当成工作区 ID；真实工作区位于 `workspace_id`，导致通知列表与点击归属核对失败。cde5da8 统一读取权威 `workspace_id`，仅在该字段不存在时兼容裸工作区 `id`；显式无效绑定不回落成员 ID。通知 scope / envelope / pending、跨工作区切换和任务归属全部统一。真实 membership 形状的全网页 403 / 403 回归通过，独立同 slug 重建 / 旧回执等四项反例通过。旧 5a28 / 96811f 安装包已作废，从未对用户发布。

新同源 smoke 包 `ea8b28f6262b6eb1fae78fa2b5627a4e112a4772d787b521204cdcb4fb78dcda` 已实际完成开启基线、后台员工名和多行正文通知、点击后 fresh item 鉴权、准确 A/B 原聊天及新消息定位；查看甲时抑制甲提醒但保留乙提醒，退出后迟到响应不再弹通知。截图与脱敏 HTTP 轨迹已独立复核，24 个网页资产逐字节等于 cde5。它使用独立包名及 localhost 专用 CA，仍不替代准确 canonical 包的正式账号验收。

canonical 741a 已在原数据私有 clone 覆盖安装，code 7 → 12，appId 10149 与首次安装时间 2026-10-16 21:08:58 保留。旧登录会话保留未证实；最终生产验收在另一份干净私有 API 35 AVD 通过官方 UI 登录原账号完成。没有提取 Cookie、弱化 TLS 或修改正式源。

11:55 正式 schema 2 基线、列表和 wait 均成功，手机端显示消息连接正常，两位原员工的历史聊天均可读取。退至 Launcher 后，由主控只提交一次无工具、无业务操作的原员工测试回复；真实 assistant 成功生成，11:58 系统通知显示员工名字和完整唯一测试正文。11:59 实际点击系统通知后，重新查询同一事件权限，再读取原会话，准确显示原聊天与新回复紫色定位框。没有使用模拟系统通知或注入 Intent。

独立审查结合准确 installed APK SHA、系统通知和聊天截图、主控唯一请求回执及脱敏服务访问顺序确认闭环。准确正式包的安装、生产 v2 读取、后台通知和点击原聊天全部通过；真机仍未验证，manifest 的 `deviceVerified:false` 保持。完整脱敏证据见 `.local/mobile-manager-selfhosted-notification-v2-native-qa/actual-android-canonical-result.json`，独立结论见 `.local/mobile-selfhost-release-independent-review/canonical-production-final-release-review.json`。

验收结束先在 App 关闭持续接收，未登出原会话；仅停止本次自有 fixture、QEMU、ADB，释放 361–374 临时登记并销毁两份私有 AVD 副本。测试 CA、诊断和 smoke APK 已清除，正式交付 APK 保留。原 AVD 六个磁盘 SHA / 大小 / mtime 均未变，旧 59582 和其他项目进程未操作，最终端口检查无冲突或未登记监听。收据见同目录 `cleanup-final-owned.json`。

11:39 主控释放唯一发布窗口后，正式通知 API 已同步至 `/opt/ziwei/releases/mobile-selfhost-candidate-0c8dc4a-a34dea838cd1402e839a365b57d00ec3/v2`，API PID 411840。受审四锁 / 完整 CAS / 停切启及两次只读部署后核对通过；222 条候选闭包仅改变六份源码和独立 receipt，215 个继承 API 条目、13 个前端产物、138 个 runtime 源及 37 个 CLI 条目、metadata、DB inode / schema、持久链接、unit / nginx、其他服务进程均保持。没有恢复 DB、发布 CLI 或派发员工业务。首次 operation e672 的 SFTP x 模式缺写权限，只留下专属空文件，正式 snapshot 未动且未重放；唯一一行改为 wx 并经真实 Paramiko 四项及 17 项状态机验证后，新 a34dea operation 成功。未登录 401 防线不代表合法 schema 2 读取验收。

以下为中断前的历史诊断，保留失败记录，不作为当前安装包通过证据。

同源码隔离 smoke 包 SHA-256 为 `3115fb51c71435f606845582e2c2973d366c2db4bbebeb66d1170c47520ab4d4`，使用独立 applicationId、localhost HTTPS 专用测试 CA 和完整 TLS 校验；其 native / web 来源仍为固定 5a28。fixture 的真实内存 repository / v2 baseline / item / 严格 TLS 读取通过，无业务派发。这些结果不能代替 Android 通知送达。

私有原数据 clone 在 guest 启动阶段出现系统命令停滞；改为官方软件渲染后曾达到 boot completed，但随后 guest shell 仍停滞，App 尚未安装。之后使用同 API 35 镜像的全新临时 userdata，guest shell 恢复，系统首次启动持续推进；尝试安装时系统仍未建立 settings provider。采样时宿主为 8 GB 内存、已用 swap 约 15.7 GB，出现很高磁盘活动；这是环境压力证据，不能据此认定 App 崩溃或通知成功。

测试中断时未取得实际系统通知、点击原聊天或准确 canonical 包安装成功的证据。没有发布 APK、二维码或把 `deviceVerified` 改为 true。11:25 清理核对确认本次监听均已停止，347–360 临时登记已释放，项目端口检查无冲突或未登记监听；原六个 AVD 磁盘 SHA / 大小 / mtime 完全未变。两份私有测试磁盘保留供恢复，原 59582 及旧保留登记未操作。记录位于 `.local/mobile-manager-selfhosted-notification-v2-native-qa/interrupted-qa-cleanup.json`。

广回归初轮出现两个旧进程探针超时；端口中心恢复后 prelaunch 真实探针已串行通过。旧官方 Python 群存储探针仍触发 30 秒 wrapper 超时；有界采样停在测试造数阶段的官方配置模块导入 / 编译，未进入群读取本体。缺配置 YAML 依赖导致重复 import 是静态推断，不是已经捕获的 ImportError。未修改产品超时或伪称全套通过；诊断在后端工作树 `.local/mobile-selfhost-probe-diagnostic/`。

## 本机端口中心修复

启动模拟器前，统一工具的扫描进程持有 SQLite 写锁，CLI 返回 `database is locked`。按本机规则先修工具：仅优化本次扫描内的项目 / cwd 去重、只读取活动或本次重现的历史观察，保留原登记、归属规则和序列化事务；副本 A/B 的四张表逐行一致。官方安装脚本受控重启端口面板后，16 项回归、list / check 和页面访问通过，其他 181 个登记的运行进程状态未改，旧 QEMU 和端口保留。

修复收据及备份：`.local/mobile-manager-selfhosted-notification-v2-native-qa/registry-repair-receipt.json`、同目录 `registry-repair-backup/`。端口工具 source / runtime 同 SHA-256 `aebd893802d629e20a0846e14f0afc9c3a244a17a389b0aa8e273ad8a4261911`。

离线 fixture 初次文件名 `fixture-server.mjs` 触发旧 app 的后缀自动启动判断，误起自有 4178 监听后已立即停止、未事后 adopt、未访问正式业务；失败记录保留。随后夹具换名并在产品中精确限定正式 `backend/server.mjs` 启动入口，防止任意同后缀导入产生监听。所有后续测试服务先登记，再启动和核对。

参考：[Android 前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)、[Doze 网络限制](https://developer.android.com/training/monitoring-device-state/doze-standby)。

## 0.5.1：历史恢复后仍无法发送的修复

用户安装 code 12 后，原聊天已有恢复后的成功回复，顶部也显示“上次已完成”，底部却仍显示旧停止请求的“执行待核实”，非空草稿无法发送。准确旧包在模拟器实际复现。根因是手机缺少桌面已有的严格历史恢复规则，同时从全部运行历史取任意 uncertain 作为当前阻断，显示与发送还使用了不同判定。

新版同步 `prelaunchRecovery` / `forceAbandonRecovery` 的严格顶层投影校验；只有服务端已核验的原历史 disposition 解除自身阻断。原 result、error、停止回执和聊天记录均保留，不宣称旧执行已经停止或成功。新回复或新时间本身不会解除另一个真实未知任务。

显示和发送共同使用同一个阻断选择器，明确核对当前员工与工作区。异员工、异工作区的快照不再误锁本聊天；同员工在另一个聊天中的真实 pending / acked / uncertain 仍阻止再次派发。没有修改服务端、原生通知实现、权限或后台连接机制。

| 项目 | 值 |
| --- | --- |
| 准确源码 | `a741ace054ce38817504fc977a6c5c77dbb685fd` |
| 版本 | `0.5.1-internal` / code 13 |
| APK SHA-256 | `f15996be722cc0338f51b8c8d212eb5928e46b8ad8ef30f870dc0394f9ade227` |
| 大小 | 772,481 bytes |
| 包名及签名 | 沿用 `com.ziwei.manager` 及上表原签名 |

全网页 444 / 444、独立定向 41 / 41 和真实 Chromium 历史聊天检查通过。两份恢复模块及 presentation 与桌面源按 LF / 单末尾换行规范一致；六个浏览器夹具已补 `.mjs` 的允许范围和 MIME。首轮浏览器夹具因未允许新扩展而未加载，修正夹具后通过；没有为此改变产品网络或超时。

独立二进制检查确认 26 份网页资源与准确 Git / manifest / APK 字节一致；`classes.dex` 与已验 code 12 完全一致。生产 owner API 的完整脱敏形状直接输入新版选择器后，原历史恢复收据有效、当前无阻断；去掉该收据则原未知执行立即重新阻断，原数据保持。

同一私有 API 35 AVD 已从准确 code 12 覆盖升级到准确 code 13，安装内 APK 实读 SHA 一致。UID、首次安装时间、原账号登录、旧版非空草稿及原聊天历史均保留；旧错误底栏消失，发送按钮可用。随后通过正常 App 界面在该原聊天只发送一次无业务测试；服务端确认一个用户消息、一个请求和一个执行，真实模型成功并具备 Windows 根进程与进程树退出证明。后台收到员工名与完整唯一回复，实际点击系统通知后回到原聊天并以紫框定位新回复，聊天增为 28 条消息，旧误锁不再出现。未通过 API、DOM 或夹具代发。完整证据在 `.local/mobile-manager-known-uncertain-recovery-code13-native-qa/`；最终独立审查已通过，公开下载校验见下文。

TikTok 仅作只读对照：旧包较早看到运行中，新包检查时其真实执行已经成功结束，因此可发送是正常状态；本轮没有额外发任务制造在途，也没有把该对照计为真实在途保护通过。真实 pending / acked / uncertain 的保护由匹配归属的九种组合及独立范围复审验证。

本轮验收结束已在 App 关闭持续接收，停止自有 QEMU / ADB，释放 375–387 临时登记并销毁本轮私有新 userdata；未登出原账号，原六盘 SHA / 大小 / mtime 未变，旧 59582 / 保留登记及其他项目进程未操作。没有创建本地 HTTPS 夹具、测试 CA 或诊断 APK。最后项目端口检查无冲突和未登记监听，真实测试记录及脱敏证据保留。收据为新 QA 目录 `cleanup-final-owned.json`。

已发布[内部测试版 0.5.1](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.5.1-internal)，[直接下载 code13 APK](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.5.1-internal/ziwei-manager-0.5.1-internal-code13.apk)。真实 tag 固定 a741ace，匿名完整下载 SHA-256 为 f15996be…ade227，与准确模拟器安装包一致；不更换已验包的任何运行资源。

追加只读访问关联：真实 assistant 消息对应通知事件 `audit_3b02507a-ad62-498b-944e-ba3644a5b24e`；12:49:22 同事件 fresh item 200，随后系统显示通知。12:50:40.962 实际点卡后，12:50:42 原聊天 200 及 feed 200，12:50:43 baseline 200 / 同事件 fresh item 200，12:50:44 原聊天为正常条件读取 304。不能把最后一次 304 写作 200，前台恢复读取与通知定位各自存在。补强记录为主控工作树 `.local/mobile-stale-recovery/notification-verification.json`，只含脱敏元数据。

新版安装二维码保存后已重新解码，内容准确等于上述 code13 直接下载 URL。稳定交付目录为 `output/android-manager/v0.5.1-internal/`，包含 APK、SHA、manifest、二维码与 `release-verification.json`。保持内部测试性质及 `deviceVerified:false`；实际真机效果待安装确认。


## 0.5.2：输入法、草稿和导航

本轮独立处理手机端输入与导航问题，没有联系主控或其他 Codex 聊天，也没有发布服务端改动。准确旧 code13 在模拟器真实 InputConnection 组合输入遇到自然 8 秒轮询时重启输入法连接，最终把“中文组合”写成“中中文组合”。普通同聊天刷新原先会替换整个输入框及祖先；仅保留历史节点不能避免输入法被断开。

code14 对同一聊天做原位 DOM 更新，保留输入框、祖先、选区与历史图片节点；组合输入期间不写旧模型值，不在组合结束后补写旧值。切页先同步当前草稿，跨员工或工作区不恢复前一输入框的焦点。发送回执根据原草稿修订号清理，返回原员工后也不能把已接受消息重新存回；新输入继续保留。

详情与设置返回栈保存原 conversationId。独立审核补充发现群组委托导航绕过旧通知的导航代次，已统一覆盖实际导航动作，包括同页群来源、房间和表单替换、设备、汇报与弹层。旧通知查询及原生 consume 迟到不再抢走新页面；普通轮询、刷新和自动已读不会撤销当前导航。业务写入、幂等、权限和真实执行保护不因撤销导航而取消或重发。

| 项目 | 值 |
| --- | --- |
| 准确源码 | `65eb8b036f6d579065f3942f8dbc79a250b4400a` |
| 版本 | `0.5.2-internal` / code 14 |
| APK SHA-256 | `9959c7f7ade4cc708081aec40549b2609b82e9d72c093a781fd90ccbab22024d` |
| 大小 | 772,549 bytes |
| 签名 | 沿用原 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35` |

全网页 465/465、独立输入与导航 51/51、Chromium 真实组合输入与跨工作区草稿回归通过。27 份网页资源经独立检查与准确 Git / manifest / APK 字节一致；Java、资源和 `classes.dex` 与 code13 完全一致，无第三方 SDK、测试 CA、测试输入法或调试桥入包。

同一私有 API35 模拟器从准确旧13覆盖升级到准确14，安装内 APK SHA 与上表相同，appId 10148、首次安装时间、原账号免重登与旧非空草稿均保留。真实 Android InputMethodService / InputConnection 跨三次自然轮询，starts / restarts / finishes 增量均为0；中文组合恰好一次且光标4。选区1–3跨轮询保留，一次替换后文字与光标2正确；24次连续原生输入未重复或丢失。实际详情刷新、模型设置只读进入与两次返回、A/B/A独立未发草稿均通过。

原聊天身份通过官方界面查找并定位前轮唯一 C13 assistant 标记，关联前轮已核验原会话收据；本轮 UI 不直接暴露原始 ID，没有虚称从 UI 读取 ID 或新发服务端探针。全程新增消息0、配置写入0，未重复真实后台通知或模型执行验收。真机仍未验证，`deviceVerified:false` 保持。

独立测试输入法无网络权限、不提供发送动作，正式登录完成后才用于非密码多行输入；验收后已恢复 LatinIME、卸载输入法并删除临时二进制与签名。只停止自己的 QEMU / ADB、释放388–400并销毁本轮新 userdata，原六个磁盘 SHA / 大小 / mtime 不变，旧59582、保留登记及其他项目260未改。原生验收与清理见 `.local/mobile-manager-composer-code14-native-qa/{actual-android-canonical-result,cleanup-final-owned}.json`，源码和最终独立审查见 `.local/mobile-manager-composer-code14-independent-review/`。

已在原仓库发布[内部测试版 0.5.2](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.5.2-internal)：[直接下载 APK](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.5.2-internal/ziwei-manager-0.5.2-internal-code14.apk)。tag 解析到准确 65eb8b0 源码，匿名完整下载 SHA 与模拟器准确包一致；同包附 SHA256 与 manifest-code14.json。安装二维码为590×590，保存后重新解码确认同一直接下载 URL；交付文件位于 `output/android-manager/v0.5.2-internal/`。发布记录见 `.local/mobile-manager-release-0.5.2/result.json`，root gate 固定30份验收和清理证据。原临时依赖链接已移除，真实依赖目录未改，端口检查无冲突或未登记监听。
