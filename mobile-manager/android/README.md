# 紫薇 Android 管理 App 原生层

包名 `com.ziwei.manager`，最低 Android 8.0（API 26），target API 35。管理界面与 `com.ziwei.device.agent` / updater 独立；Hermes 继续由已有绑定电脑执行。原生层不运行员工任务，没有无障碍、设备管理员或保活前台服务。

## 构建

在仓库根目录执行：

```sh
python3 mobile-manager/scripts/android-tools.py --push
python3 mobile-manager/scripts/test-android.py
python3 mobile-manager/scripts/build-android.py --profile tpns --version-code 11 --version-name 0.4.0-internal
```

默认 `tpns` profile 编译并合并实际官方 TPNS 1.4.4.12-release、六家 OEM 适配器及 FCM 适配器，另含 HMS Push 6.12.0.300 / Firebase Messaging 24.1.0。不是反射占位实现。固定 Gradle 8.10.2、AGP 8.7.3、Temurin JDK 17.0.20.1、Android SDK 35 r02 / build-tools 35.0.0；Gradle 分发包及八个 TPNS AAR 检查固定 SHA-256。原生四种 ABI 均打包。签名继续复用缓存中独立的内部测试身份，私钥和密码不得提交或发布。

`--profile minimal` 仅用于明确需要的无推送 SDK 构建。该 profile 返回不可用，绝不以构建失败自动降级后宣称具有系统推送。输出默认 `mobile-manager/dist/`，另可通过 `--output` 指定；包含 APK、SHA-256、manifest。脚本检查包名、版本、权限、非调试构建、签名、对齐、SDK DEX 标记/ABI，以及打包 web 文件逐字一致性。

Mac 的 Gradle 内部 TCP/UDP 监听也受端口中心管理。构建脚本先 list/allocate，专用 Gradle home 使用预登记 loopback 端口，期间检查归属，结束停止仅自有进程并 release 临时登记。端口中心工具不可用时构建失败；不能绕过。脚本不启动 adb/模拟器。

## 推送配置与准确状态

客户端配置是应用公开 SDK 配置，与后端 TPNS SecretKey 分开。下列环境变量只在正式凭据齐备后注入构建：

| 通道 | 构建输入 |
| --- | --- |
| 小米 / Redmi | `ZIWEI_PUSH_MI_APP_ID`、`ZIWEI_PUSH_MI_APP_KEY` |
| 华为 | `--agconnect-services /absolute/path/agconnect-services.json` |
| 荣耀 | `ZIWEI_PUSH_HONOR_APP_ID` |
| OPPO / Realme / OnePlus | `ZIWEI_PUSH_OPPO_APP_KEY`、`ZIWEI_PUSH_OPPO_APP_SECRET` |
| vivo / iQOO | `ZIWEI_PUSH_VIVO_APP_ID`、`ZIWEI_PUSH_VIVO_APP_KEY` |
| 魅族 | `ZIWEI_PUSH_MZ_APP_ID`、`ZIWEI_PUSH_MZ_APP_KEY` |
| 其他 Google 服务设备 | `--google-services /absolute/path/google-services.json` |

两个 JSON 必须是对应包名的 Android 客户端配置，不能传服务账号私钥。各厂商还需要开发者资格、对应包名/签名及 TPNS 控制台厂商通道设置；仅打包 SDK 不等于这些配置已经生效。服务端 `/api/mobile/push/config` 提供客户端 AccessId / AccessKey，服务端 SecretKey 永不下发。没有配置的候选包保持 `notConfigured`，不得称作已具备后台即时送达。

系统通知由用户主动开启，Android 13+ 再请求系统权限。只有服务端配置、当前设备凭据、真实 TPNS 登记、实际 OEM/FCM `getOtherPushType` / `getOtherPushToken` 注册回执及服务器订阅均成功，状态才为 `deliveryMode: push`。只有 TPNS 在线长连 token 不算系统通道可用。否则通知开关保留 15 分钟 JobScheduler 补充检查，`deliveryMode: supplement` 明确说明；关闭为 `unavailable`。没有强制停止后仍保证送达的承诺。

## 原生桥与生命周期

受信本地主文档的 `ZiweiNotifications` 只提供 `getStatus`、`configure`、`requestPermission`、`openSystemSettings`、`clear`、`setForeground(conversationId|'')` 和一次性 `consumePendingTarget`。没有 JS Cookie、安装秘密、任意 HTTP、文件、Intent 或员工操作接口。状态增加 `pushAvailable`、`pushConfigured`、`pushState`、`deliveryMode`；旧版状态按补充检查解释。

`ManagerApplication.attachBaseContext` 在 provider 创建前以公开 API 关闭 TPNS 自动初始化，每次进程重建都执行；这也覆盖曾开启、离线关闭且厂商注销回执未到的情况。显式注册路径才启动 SDK，关闭时公开 `enableService(false)` 落地本机禁用，不依赖远端注销成功。SDK 仅在用户开启并取得服务端配置/本机所需凭据后初始化；移除 Firebase / AGConnect 自动初始化 provider，关闭额外定位、应用列表上报、跨应用拉起和自启动选项。通知文案固定为通用提醒，不放员工消息正文、报告或目标。可见性为 PRIVATE，点击不信任供应商提供的目标。

Native 的随机 installationId / 32 字节 secret 仅存应用私有偏好；正常 HTTPS 请求从系统 CookieManager 读取同源会话到内存，不给 JS、不创建第二份持久 Cookie、不输出日志。全部请求限定正式 HTTPS 源 `/api/mobile/push/`、禁止重定向、限制请求和响应大小、校验 schema/账号/工作区回执。注册操作持久保存单调 clientEpoch；订阅和前台回执带服务端 generation。可见原会话由网页续报，原生串行发送并持久提升 presenceSeq；离页/后台清除，失败不会延长服务端 60 秒 TTL。

正常退出、登录过期及账号切换会清除旧订阅。若 Cookie 在进程之间变化且没有经过该清除流程，同 scope 的恢复会被服务器以 409 拒绝，保持补充检查状态；需要在当前登录下重新开启通知，不自动续活旧会话。

关闭/退出先失效本地 scope、取消迟到请求和目标，再保留 durable revoke 意图直到服务端确认。登记 HTTP 发送前落盘 attempted 标记；从未登记的缺配置安装不用等待不存在的撤销。若曾发出登记，网络未知或 secret-only 404 均不能清除撤销。有效会话可由后端建立受账号配额约束的 absent-install revoked fence，阻止迟到旧 epoch 登记复活。

供应商只携带 opaque 32 字符 deliveryId。Huawei 点击兼容入口为 `ziwei-manager://push?deliveryId=...`，原生严格校验 scheme/host/路径/唯一 query，不接受 URL、正文或聊天目标；也接收本应用显式 immutable PendingIntent。私有待处理目标绑定账号、工作区、通知 generation，24 小时过期，本地只消费一次。进程回收后的同 scope 恢复复用注册 epoch，不会在 onResume 抹掉刚点击的目标。网页在登录 ready 后再次向当前会话的 delivery API fresh resolve，服务器仍校验 epoch/会话/权限，失败不导航。厂商 OS 直接展示的重复通知不能靠应用回调保证全部消除。

## WebView 与验证

打包 `mobile-manager/web/` 原样 assets；仅正式 HTTPS 源下固定本地入口由拦截器返回，不给缺失资源回退到远端。禁止任意主文档/弹窗外跳、混合内容、第三方 Cookie、TLS 放行和网页设备权限。图片选择使用系统文档选择器，只接收用户选中图片，不申请全盘存储权限。标准 DOM `ziwei:resume` / `ziwei:pause` / `ziwei:back` 保持原行为。

JVM 检查覆盖 URL 信任、通知 receipt、严格 opaque URI/token，以及真实原生代码所用的冷启动恢复、scope、epoch 和撤销策略。编译和静态 APK 检查不代替厂商实机、真实凭据和实际投递验收；未配置时只能验收准确不可用状态，不能声称已完成实际离线推送。

官方资料：[TPNS Android 集成](https://cloud.tencent.com/document/product/548/36652)、[SDK 更新记录](https://cloud.tencent.com/document/product/548/44520)、[厂商通道](https://cloud.tencent.com/document/product/548/61135)、[Huawei Push](https://cloud.tencent.com/document/product/548/45909)、[Android 通知权限](https://developer.android.com/develop/ui/views/notifications/notification-permission)。
