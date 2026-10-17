# Android 系统推送候选交付

本次实现针对“一个安装包自动适配手机，像微信一样收到员工消息、任务结果和汇报提醒”。客户端集成 TPNS 及厂商 / FCM 适配器，服务端增加持久通知队列。用户不需要选择手机品牌。应用配置、实际厂商通道注册和后台 / 锁屏真机送达仍是独立验收项，不能以编译、服务商接收或模拟器界面代替。

## 源码与上线范围

- 后端分支 `codex/mobile-system-push`，固定实现 `2c2e47961b085552381e60f25a26cf4c8fe17f48`，已推送 GitHub。
- Android 分支 `codex/android-system-push`，合入同一后端实现；安装包源码与哈希以最终 `mobile-manager/dist/manifest.json` 和本次验收记录为准。
- 两分支均保留正式 API `874fcb142f35e78ca1d7d46e0ff92c01d0cee966`、电脑客户端并行修复 `df2f1943c67adae5f4073d831003320b056542dc` 和旧手机权限修复 `20da8856beb7f008d8c3b85f65103f53b9deef19` 的祖先关系。不能从旧分支整包覆盖当前生产服务。
- 本任务交付源码、候选 APK 及隔离证据；未部署正式 API / Windows 客户端，未上传公开 APK 或生成公开安装二维码。统一发布由主控安排。

仅本次推送运行增量为 `backend/app.mjs`、`backend/auth.mjs` 以及 `backend/mobile-push{,-store,-tpns}.mjs`。正式站尚未包含的最近提醒、群分页和身份修复是另有依赖的已复审增量，不应漏掉，也不能借此回退恢复、停止或并行调度逻辑。

当前 preservation / serverCodeRollout 模式明确关闭新推送服务，连新表初始化也不会执行。主控需要在受控数据库备份、迁移与恢复方案中显式安排新表启用，不能移除门禁强行开启。旧 trusted assignment 内部证明、公开字段剥离和无效标记不能退为仅做 projection 的旧实现。

## 已实现行为

- 员工真实回复、可查看的执行完成 / 失败和待办通知进入持久 outbox。汇报由员工原聊天回复产生提醒，不创建另一份汇报或员工执行源。人类提交的 `assistant` 角色消息不被伪装为员工回复。
- 首次开启以当前序列为基线；历史事件补录仍使用原 audit / notification 时间，超过时限或未来 / 非法时间不发送。派发时再次检查源事件、会话、成员、员工、设备、群逻辑身份和 F1 / F5 权限。
- 通知正文固定为通用工作提醒，第三方通道只收到设备 token 和随机 deliveryId，不含员工名、聊天正文、Cookie、账号邮箱或目标 URL。
- 点击携带严格格式 `ziwei-manager://push?deliveryId=...`。原生层先校验本机账号 / 工作区 / 通知代次，页面再通过当前登录会话读取服务端 delivery。失权或失效有可见错误，不能信任 Intent 内旧目标，也不会丢掉未发送草稿。
- 当前聊天可见时发送 60 秒前台租约，离页、遮罩或退到后台清除；有序 presenceSeq 防止迟到心跳覆盖退出。仅前台当前聊天免重复，其余聊天仍可提醒。
- 关闭、登出和切账号立即失效本机回执；持久撤销 epoch 防止旧注册 / 订阅请求迟到后重新开启。未知安装的撤销屏障仅有效登录会话可创建，每账号最多 32 个安装条目；匿名请求不写占位记录。
- 冷启动通知点击与传输注册重试使用独立身份规则。同范围恢复保留原点击，换账号 / 工作区或关闭提醒清除旧点击。
- 系统通道未配置或没有注册成功时明确保留约 15 分钟补充检查。只有实际 OEM / FCM token 注册成功才显示系统推送已开启，TPNS 在线自建通道 token 本身不足以证明锁屏通道可用。
- 聊天首页保留原群组入口，增加直接进入“汇报”的按钮；不自动发消息、启动汇报或停止员工。

## 发送回执与重复控制

队列状态区分待发送、服务商接受、结果未知、明确拒收、取消和前台抑制。providerAccepted 只证明服务商接收请求，不能写成 deviceDisplayed。

TPNS 的 `n_id` 仅作自建通道尽力替换，不承诺各厂商幂等。网络断开 / 超时、网关 5xx、坏响应或发送 lease 过期都视为结果未知，不自动再次 POST；如果服务商实际发出，原 opaque delivery 仍可经新鲜鉴权打开。仅明确未受理的限流拒绝码 `1008028` 才按退避重试。原聊天及未读记录保留为恢复入口，不声称恰好一次送达。

## 唯一的外部配置清单

这些是发布配置，不要求用户提供手机型号。没有在本机创建付费服务、申请控制台应用或伪造真实供应商回执。

1. TPNS 控制台中登记 `com.ziwei.manager` 及实际 APK 签名，启用所需厂商通道。确认应用资质与各厂商允许的消息类别。
2. 服务端配置 `ZIWEI_TPNS_ENABLED=1`、`ZIWEI_TPNS_ACCESS_ID`、`ZIWEI_TPNS_ACCESS_KEY`、`ZIWEI_TPNS_SECRET_KEY`、`ZIWEI_TPNS_REGION`（`guangzhou` / `shanghai` / `hongkong` / `singapore`），以及 32 随机字节 base64url 形式的 `ZIWEI_MOBILE_PUSH_TOKEN_KEY`（43 字符）。secret key 和加密 key 只留服务端，不进入 APK 或日志。
3. 同一 APK 构建注入各厂商公开客户端应用参数：小米、魅族、OPPO、vivo、荣耀；华为使用对应 `agconnect-services.json`，FCM 使用 Android 客户端 `google-services.json`。这些必须与控制台、包名和签名相匹配；不得将服务账号私钥当客户端文件打包。准确字段与命令见 `mobile-manager/android/README.md`。
4. 主控安排受控 API 迁移 / 启用后，用有对应通道的真机逐一检查后台和锁屏通知、点击原会话、关闭 / 登出 / 切账号不再打开旧记录。无 GMS 的 AVD 不能证明 FCM / OEM 锁屏送达。

未满足配置时：`GET /api/mobile/push/config` 为 `notConfigured`，注册返回 503，worker 不访问供应商；页面继续使用原只读提醒。即便 config ready，也必须有匹配客户端厂商配置和实际通道回执才可称为该设备推送就绪。

## 准确安装包

| 项目 | 固定值 |
| --- | --- |
| APK | `mobile-manager/dist/ziwei-manager-0.4.0-internal-code11.apk` |
| 源码 | `9f634d95c0139de003143722d212281982a481c1` |
| SHA-256 | `949a89bb730fbebbc3757ca4b8651ea2b54d97f25889edc79184f312b3ae5fbc` |
| 大小 | 5,414,054 字节 |
| 签名 SHA-256 | `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35` |
| Profile | `tpns`，真实 TPNS 1.4.4.12-release 和全部适配器 |
| 厂商客户端配置 | 未提供，`pushClientConfigurationProvided: false` |

原始构建在 `.local/mobile-manager-push-build/sdk-compile/`；完整验证后按原字节复制到 dist，24 个 web assets 与源码和 APK 逐个比对。原 code 10 APK 和 `manifest-code10.json` 保留。`manifest.json` / `manifest-code11.json` 对应该准确候选，`deviceVerified: false` 不应因模拟器安装而改成真机通过。

Java、lint、资源、DEX、四 ABI 官方库、签名、权限及非调试 APK 均通过。准确合并清单 SHA-256 为 `dcb39e9eb8cd6b59cdac7a7ea339c36b46b8e8a01d43c4e1f23ad8e9166445dd`。保留五个必要 Provider，删除 Firebase / AGConnect / HMS-AAID 自动初始化和 SDK 跨应用保活入口。Huawei 必要的 exported Provider 仅经本 App 声明的 signature 读写权限访问，不能以 exported 一个字段判断无保护暴露。

独立审查发现并关闭“曾开启、离线关闭后重启时 SDK 自动初始化”的 P2：`Application.attachBaseContext` 在安装 Provider 前使用官方公开 `setAutoInit(false)`，显式注册路径保留；注销无论回执成功或失败都持久关闭本机服务。固定官方 SDK 字节码的实际分支序列反例在修复前调用 init，加入门禁后同样的旧持久状态两次均无新增 init。HMS-AAID 原默认即 false，移除其自动 Provider 是防遗留设置，不应声称未同意首次启动原来就会联网。

构建期间几次端口检查或静态守门失败的日志保留；最终构建临时登记 343–346 的四次运行检查及结束检查全绿，已停止释放。具体收据：`.local/mobile-manager-push-build/native-sdk-candidate-evidence.json`。模拟器自身动态 UDP 曾中断前一轮构建，已单独准备预登记固定 UDP 池，不能绕过端口中心或把失败轮次称为通过。

## 已取得的代码与隔离证据

- 后端固定 `2c2e4796`：联合 191 / 191 Node、12 / 12 官方 Hermes Python；独立 13 / 13 顺序反例和 84 / 84 既有 push / F1 / F5 / writer / public 检查。HTTP 采用 `app.handle`，无监听服务，供应商为夹具。
- 独立反例覆盖历史重放、两 Cookie 人类伪回复、结果未知不重发、失效 lease、明确限流退避、迟到无效 token 不撤新代次、前台旧序列、账号 / 权限、absent fence、错误 secret、匿名不落库和 32 条配额。
- Android 界面测试 398 / 398，通过通知鉴权 / 失权、原草稿保存、当前聊天前台租约、旧桥兼容及原手机功能回归；与新推送后端合并后的运行是 429 / 429。合成浏览器检查涵盖 390 / 320 宽度。
- 固定原生代码独立审查 194 个 JVM 检查、83 个通知 / 页面联动检查通过。构建脚本后续修订不改变这批 Java、SDK 适配器和 web 运行代码；准确 SDK 包另经完整 Android 编译验证。独立记录在 `.local/mobile-system-push-native-independent/`。
- 最终 `9f634d9` 二进制独立补验通过，24 项资产同时匹配固定源码、manifest 和 APK，签名、版本、非调试状态及最终 Provider / signature 权限一致；记录为 `.local/mobile-system-push-native-independent/binary-9f634d9/result.json`。
- 后端独立记录：`.local/mobile-system-push-independent-review/result-2c2e47961b08.json`（在后端工作树）。首轮独立夹具时钟误设的失败原记录保留，修正夹具后通过，不掩盖原输出。

## 模拟器 HTTPS 修复及证据边界

原 emulator guest 使用 Clash TUN DNS，正式域名被解析成 fake IP，出现 TLS 握手错误。仅在本任务私有 AVD 克隆启动参数中改用 Mac `en0` 已配置的 LAN DNS `192.168.31.1`，恢复正常域名解析和严格 HTTPS。未固定正式域名 IP，未放行 TLS 错误，未改 Mac 全局网络或用户原 AVD。

准确旧候选 code 10（SHA-256 `cc2d17f5f445c27e09d967c7f5993811410aa9ff6a8808457c86bf9b0523bcad`）在新网络环境已打开两位原员工的原聊天，完成未发送本机草稿往返与只读汇报选择页；没有发送、停止或启动汇报。code 9 仅证实首页和 HTTPS，不能套用 code 10 的详细验收结论。

基线索引：`.local/mobile-manager-code11-network-native-qa/baseline-evidence-index.sanitized.json`。原六个 AVD 磁盘的 SHA / 大小 / mtime 核对未变。以下准确 code 11 记录基于另行安装，未用旧包基线替代。

准确 code 11（上述 `949a89…`）现已另行安装并通过本次模拟器范围，观察区间为 2026-10-17 19:23:37–19:26:47 UTC：

- `adb install -r` 原位覆盖，原 UID / appId `10149` 与首次安装时间 `2026-10-16 21:08:58` 保留；原登录有效。
- 两位原员工原会话正文均可见，其中一位跨一次轮询仍正常；旧未发送草稿在升级后和 force-stop 冷启后均在原聊天输入框精确恢复。
- 首页“汇报”进入员工选择页，保持 0 人，未启动汇报；没有发送业务消息或开始 / 停止员工任务。
- 正式 API 未部署新提醒服务，页面如实显示 `请求失败（404）` 和“系统提醒未开启”，没有“消息通知已开启”。本次未点通知开启，所以不能把此记录称为 `notConfigured` 注册分支实测，更不能称为厂商即时推送验收；该分支的证据来自代码 / 隔离测试。
- force-stop 后冷启动恢复首页和原聊天，日志中的 TLS handshake、`-100`、FATAL、renderer crash、ANR 均为 0。
- 独立 QEMU shim 预登记固定 UDP 池处理 DNS / 出站隐式 bind，实测使用池内 9208 / 9210 / 9215，无随机 UDP 端口；未改变正式 Mac 网络、TLS、Gradle shim 或用户原 AVD。

准确候选截图与收据均留在本机私有 `.local/mobile-manager-code11-network-native-qa/`，未上传含原聊天的图片。此范围证明实际 SDK 包能保留登录 / 草稿并读取原聊天，仍不代替物理手机和已配置供应商的后台 / 锁屏送达验收。

最终脱敏索引为 `code11-sdk-native-qa-result.sanitized.json`。`cleanup-final-sdk.json` 记录 19:27:07 UTC 正常停止本轮 QEMU / ADB、无开放文件后销毁私有克隆、源六盘 SHA / 大小 / mtime 均不变，释放本轮 302–306 / 331–338 共 13 项登记，端口检查全绿。旧 PID 59582、原 267 / 268 / 271 以及其它项目 260 未动。两工作树临时依赖链接也已清理。

## 参考

- [TPNS HTTP 签名](https://cloud.tencent.com/document/product/548/41046)
- [TPNS 通知点击](https://cloud.tencent.com/document/product/548/48572)
- [TPNS HTTP API](https://intl.cloud.tencent.com/zh/document/api/1024/33764)
- [Android 通知权限](https://developer.android.com/develop/ui/views/notifications/notification-permission)
