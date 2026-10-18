# 自建通知候选：员工名、正文和原聊天

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

- Android 分支：`codex/android-selfhost-notifications`，版本 `0.5.0-internal` / code 12；先完成候选与模拟器证据，再交付。
- 后台分支：`codex/mobile-selfhost-notifications`；首版 v2 为 `ca905ecc`，精确服务启动入口修复为 `a4e0e1fc`，后续标题规范化等修复以最终固定提交为准。
- 相对旧正式 API `874fcb14` 的最小运行增量为 `backend/{app,auth,repository,mobile-notifications,mobile-group-action,mobile-notifications-v2}.mjs` 六个文件；上线前必须重新核实际正式源码，不可覆盖之后的恢复、停止、轮数或并行调度修复。不需要新依赖、DDL、厂商密钥或员工电脑手工配置。
- 回退须保持可信任务绑定 writer / 无效标记和公开字段剥离连续性；可以停 v2 路由，不能裸退旧 writer 再前滚，造成证明缺口。
- 新版服务尚未上线时明确提示服务未更新或接收未运行，不能以编译、夹具或旧包截图称正式包已经测通。

2026-10-18 11:01（Asia/Shanghai）只读现场核对：正式 API / frontend 为 `d45317011235f38c0f1b5b2f2e60eff322338135`，current 为 `/opt/ziwei/releases/unlimited-parallel-d45317011235-55597409/v2`，CLI 为同一提交 / build `203fe63c886b4a98ef510a6302c84c6291f9eb66f095ed42549c4f0d9e903116`。现场尚无 v2 路由或三个通知模块。`df2f1943` 到 `d4531701` 没有 backend 差异；现场 auth 与 Git 的差异仅 CRLF / LF，规范化后内容相同。必须在该现场全树上叠加六文件增量，沿原四锁、snapshot / CAS 进行受控发布，保留 frontend / CLI，不能套用旧正式路径。

**11:25 再次只读核对发现正式 current 已变为 `/opt/ziwei/releases/default-unlimited-12d5aa9f6d62-3f149f60/v2`。** 旧 d453 snapshot / CAS 已正确拒绝，变化包含 API 树、current、frontend / CLI 元数据与服务身份。上述六文件材料及本地 publisher 不得直接激活；恢复发布前必须重新核对新正式版本并生成新的受审基线。本次未执行远程 stage、切换、重启或数据库写入。

## 固定安装包

| 项目 | 值 |
| --- | --- |
| 固定源码 | `5a28be1dac5aad6f6e8ddeec90863cea8dd0a973` |
| 包名 / 版本 | `com.ziwei.manager` / `0.5.0-internal` / code 12 |
| APK SHA-256 | `96811f586c10f06901b29cb57246f05c96f320411821d89b245886ea0c371809` |
| 文件大小 | 764,115 bytes |
| 原有签名 SHA-256 | `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35` |
| 后台候选 | `0c8dc4a955ef7b65bc496ce7f43246b88201a088` |

安装包及 `manifest-code12.json` 位于 `mobile-manager/dist/`。独立二进制复核确认 24 份网页资源与固定源码 / manifest 逐字节一致，包内没有第三方通知 SDK、native `.so`、测试 CA、localhost 源或可调试开关。两个服务均私有，权限只有网络、通知、网络状态和前台服务所需两项。此记录是构建与二进制证据，模拟器 / 正式接口验收须另附实际结果；`deviceVerified:false` 保留，不能据此声称真机已验证。

## 代码与测试记录

网页 400 项检查通过，定向通知 / API / 页面联动 112 项通过；后续接收未运行状态小修另有 71 项通过。合成浏览器检查覆盖 390 / 320 宽度，无本地监听和真实业务写入。

后台固定 `ca905ecc` 的独立扩大反例 14 项、通知 v1 / v2 / F1 / F5 回归 67 项通过；`a4e0e1fc` 服务入口 2 项通过。原生弱网、代次、去重、标题及线程策略持续在最终冻结点复核。后续实际 APK 和模拟器结论只按准确哈希记录。

最终固定点的网页及后台组合测试 417 / 417 通过；原生 JVM 检查 266 项通过，其中包含真实接收 lease 的代次互斥、同锁网络唤醒，以及逐项重新鉴权超过处理预算后仍能推进分页尾部的回归。独立复核重复通过。员工名包含换行的跨端契约已修复：后台标题改为单行、正文保留多行，真实 Cookie → HTTP → 网页解析 6 项及原生标题验证 7 项通过。

### 模拟器当前结果：尚未通过

同源码隔离 smoke 包 SHA-256 为 `3115fb51c71435f606845582e2c2973d366c2db4bbebeb66d1170c47520ab4d4`，使用独立 applicationId、localhost HTTPS 专用测试 CA 和完整 TLS 校验；其 native / web 来源仍为固定 5a28。fixture 的真实内存 repository / v2 baseline / item / 严格 TLS 读取通过，无业务派发。这些结果不能代替 Android 通知送达。

私有原数据 clone 在 guest 启动阶段出现系统命令停滞；改为官方软件渲染后曾达到 boot completed，但随后 guest shell 仍停滞，App 尚未安装。之后使用同 API 35 镜像的全新临时 userdata，guest shell 恢复，系统首次启动持续推进；尝试安装时系统仍未建立 settings provider。采样时宿主为 8 GB 内存、已用 swap 约 15.7 GB，出现很高磁盘活动；这是环境压力证据，不能据此认定 App 崩溃或通知成功。

测试中断时未取得实际系统通知、点击原聊天或准确 canonical 包安装成功的证据。没有发布 APK、二维码或把 `deviceVerified` 改为 true。11:25 清理核对确认本次监听均已停止，347–360 临时登记已释放，项目端口检查无冲突或未登记监听；原六个 AVD 磁盘 SHA / 大小 / mtime 完全未变。两份私有测试磁盘保留供恢复，原 59582 及旧保留登记未操作。记录位于 `.local/mobile-manager-selfhosted-notification-v2-native-qa/interrupted-qa-cleanup.json`。

广回归初轮出现两个旧进程探针超时；端口中心恢复后 prelaunch 真实探针已串行通过。旧官方 Python 群存储探针仍触发 30 秒 wrapper 超时；有界采样停在测试造数阶段的官方配置模块导入 / 编译，未进入群读取本体。缺配置 YAML 依赖导致重复 import 是静态推断，不是已经捕获的 ImportError。未修改产品超时或伪称全套通过；诊断在后端工作树 `.local/mobile-selfhost-probe-diagnostic/`。

## 本机端口中心修复

启动模拟器前，统一工具的扫描进程持有 SQLite 写锁，CLI 返回 `database is locked`。按本机规则先修工具：仅优化本次扫描内的项目 / cwd 去重、只读取活动或本次重现的历史观察，保留原登记、归属规则和序列化事务；副本 A/B 的四张表逐行一致。官方安装脚本受控重启端口面板后，16 项回归、list / check 和页面访问通过，其他 181 个登记的运行进程状态未改，旧 QEMU 和端口保留。

修复收据及备份：`.local/mobile-manager-selfhosted-notification-v2-native-qa/registry-repair-receipt.json`、同目录 `registry-repair-backup/`。端口工具 source / runtime 同 SHA-256 `aebd893802d629e20a0846e14f0afc9c3a244a17a389b0aa8e273ad8a4261911`。

离线 fixture 初次文件名 `fixture-server.mjs` 触发旧 app 的后缀自动启动判断，误起自有 4178 监听后已立即停止、未事后 adopt、未访问正式业务；失败记录保留。随后夹具换名并在产品中精确限定正式 `backend/server.mjs` 启动入口，防止任意同后缀导入产生监听。所有后续测试服务先登记，再启动和核对。

参考：[Android 前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)、[Doze 网络限制](https://developer.android.com/training/monitoring-device-state/doze-standby)。
