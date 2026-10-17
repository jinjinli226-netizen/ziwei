# 紫薇 Android 管理 App 原生层

首版是独立手机界面加原生 Java `Activity` / `WebView`，连接现有紫薇账号和工作区。
包名 `com.ziwei.manager`，最低 Android 8.0（API 26），target API 35。
它与 `com.ziwei.device.agent` / `com.ziwei.device.updater` 是独立应用；没有手机受控服务、无障碍能力或常驻执行进程。Hermes 仍由已有绑定电脑执行。

## 构建

在仓库根目录运行，Python 3.9+：

```sh
python3 mobile-manager/scripts/android-tools.py
python3 mobile-manager/scripts/test-android.py
python3 mobile-manager/scripts/build-android.py --version-code 10 --version-name 0.3.0-internal
```

自动工具准备支持 Apple Silicon Mac。固定使用 Temurin JDK 17.0.20.1、Android SDK platform 35 r02 和 build-tools 35.0.0；下载文件逐一比对官方校验值，缓存位于 `~/.cache/ziwei-manager-android`。
已有工具可传 `--java-home /path/to/jdk --sdk-root /path/to/sdk`。
构建按 `javac → D8 → AAPT2 → zipalign → apksigner` 执行，不使用 Gradle、adb、模拟器或本地监听服务。

产物在 `mobile-manager/dist/`，包含 APK、SHA-256 文件和 `manifest.json`。
脚本核对包名、版本、SDK、`INTERNET` / `POST_NOTIFICATIONS` / `ACCESS_NETWORK_STATE` 三项权限、v2/v3 签名、对齐及每个打包界面文件的字节一致性。
后续发包递增 `versionCode`，并在最后一次界面修改后重新打包。

内部测试签名首次构建自动创建，持久保存在缓存 `signing/`，目录权限 0700、私钥/密码文件 0600。
该身份与原有 Agent 的签名分离。保留并安全备份它，后续内部升级继续复用；不把私钥或密码提交到 Git、上传至发布附件或输出到日志。

## 安装

将 APK 传到 Android 手机，打开文件，按系统提示授权本次来源安装，启动「紫薇」并使用现有账号登录。
系统允许同签名、更大 `versionCode` 的管理 App 覆盖升级。升级不需要卸载员工受控 Agent，也不需要重新创建员工、Profile 或电脑身份。

内部签名可供直接安装测试；没有声称已完成商店上架或正式分发签名配置。
`manifest.json` 的 `deviceVerified: false` 表示尚无此构建的物理手机验收；模拟器和隔离测试证据按版本另行记录。

## 资源、登录与安全边界

- 将 `mobile-manager/web/` 原样打包为 APK assets。`https://qzelynth.top/__ziwei_manager__/index.html` 和该目录下资源由 `shouldInterceptRequest` 返回本地字节；路径缺失/越界不会回退到远端页面。
- `/api/`、同源头像/截图仍经正常 HTTPS 请求到现有后端，`CookieManager` 接受一方 Cookie 并在退出前台时持久化，继续遵守服务器会话有效期。
- 只允许正式 HTTPS 源在 WebView 中发出资源请求；没有 `file://` / `content://` 页面访问、混合内容、第三方 Cookie、TLS 错误放行或网页设备权限。通知专用桥的范围见下文。
- 本地资源响应有 CSP。JS 只能来自同源模块，禁止 inline JS；图片支持同源、`data:`、`blob:`；样式允许内联样式，跨域 frame/object/form 被拒绝。
- WebView 主文档只允许打包页面。其他文档导航、弹窗及下载均在 App 内阻止，不发出浏览器 `ACTION_VIEW` Intent；没有可从外部导入任意 URL 的 deep link。相册的系统文档选择器不受此限制。
- 相册使用系统文档选择器，支持页面声明的多选，最多接收 20 张；只接收经用户选中的 `content://` 且 MIME 为 `image/*` 的 URI，不申请存储、摄像头或相册全量权限。

## 界面事件约定

原生层向受信任的本地页面发送标准 DOM 事件：

- `window` 上 `ziwei:resume` / `ziwei:pause`，`detail.at` 是事件时间。界面恢复到前台时从真实 API 刷新，进入后台时停止轮询。
- `window` 上可取消的 `ziwei:back`。界面同步调用 `event.preventDefault()` 表示已关闭抽屉、返回列表等；未处理时原生层回退 WebView 历史或退出当前 Activity。
- 系统栏和软键盘由原生 WindowInsets 处理，WebView 可用视口不覆盖状态栏、导航条或键盘。

## 用户选择开启的系统通知

`ZiweiNotifications` 只供打包的本地主文档调用；主文档导航限制、同源资源限制及禁止 frame/object 的 CSP 继续生效。桥仅提供通知开关、权限请求、固定本 App 通知设置、状态读取与一次性目标消费，不提供 Cookie、任意 URL、Intent、HTTP、文件或员工操作接口。未经前台受信页面调用不会弹权限或打开设置。

- `getStatus()`、`configure(workspaceSlug, enabled)`、`requestPermission()`、`openSystemSettings()`、`clear()` 返回 JSON 字符串。`ziwei:notifications` 事件的 `detail` 是同份状态对象，包含 `available`、`enabled`、`subscriptionState`、`permission`、账号/工作区标识、`intervalMinutes: 15`、`pendingTarget` 和简短状态文案。`permission` 为 `granted` / `denied` / `channel_disabled`。App 内提醒不依赖通知权限。
- Android 13 及以上仅在用户点击开启后请求 `POST_NOTIFICATIONS`。网络约束 Job 在 Android 14 及以上必须具备普通权限 `ACCESS_NETWORK_STATE`；没有新增无障碍、设备管理员、前台服务、WakeLock、启动广播或厂商 SDK。
- 开启先通过正式 HTTPS 的只读 `GET /api/workspaces/{slug}/mobile/notifications?baseline=1` 绑定当前服务端账号和真实工作区 ID。首次只保存 head cursor，不发历史提醒。服务未上线、schema 不兼容、登录失效或工作区不可访问时不会声称已开启。
- 只有一个 `JobScheduler` 周期任务，周期 15 分钟。系统可能因省电、网络、厂商策略或强制停止而延后，不能称为即时推送。任务只读现有事件，不运行模型、不执行员工任务。每次最多两页，每页请求 30 条，上限 50 条 / 64 KiB；有 45 秒执行期限检查及最多 10 秒的每段连接 / 读取超时。使用系统为 Job 分配的网络，没有连续重试。
- Job 不持久跨手机重启，重新打开 App 会恢复已开启的单个任务，无需 `RECEIVE_BOOT_COMPLETED`。App 页面退到后台停止界面轮询，独立的系统 Job 由 Android 决定何时执行。
- 身份只从系统 `CookieManager` 读取同源 Cookie 到请求内存，不创建第二份持久 Cookie，不给 JS 返回、不输出日志。每轮固定 Cookie 快照，回执前后校验 generation、账号和工作区；401 / 403、账号不符、退出登录 `clear()` 会取消 Job、清除点击目标并取消该 App 旧通知。迟到回执不能恢复旧订阅。TLS 正常校验，禁止跟随重定向。
- 私有偏好仅保存 cursor、账号 / 工作区 / generation、有限去重哈希和安全目标元数据；不持久化 title / summary、消息正文、prompt / result 或 Cookie。通知为 `VISIBILITY_PRIVATE`。点击使用显式、不可变的 `PendingIntent`，只传 192 bit 随机 key；外部传任意 URL / 目标不能生成可消费目标。最多保留 64 个私有 key，24 小时过期，使用一次即失效。
- 点击后先用当前会话 baseline 只读校验订阅身份，不推进 cursor，通过才排队等待界面启动和登录完成。`consumePendingTarget()` 返回 `{accountId,workspaceId,workspaceSlug,eventId,target}` 或 JSON `null`。界面再通过新鲜的事件 resolve API 检查权限并导航，不能信任缓存 target 直接读取私信，不写共享 `read_at`。

参考：[通知运行时权限](https://developer.android.com/develop/ui/views/notifications/notification-permission)、[Android 14 的 Job 网络权限](https://developer.android.com/about/versions/14/behavior-changes-14#jobscheduler)、[JobInfo.Builder](https://developer.android.com/reference/android/app/job/JobInfo.Builder)、[WebView 原生桥安全](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)。

## 验证边界

`test-android.py` 在 JVM 上验证 URL 信任、伪装域名、账号/端口、协议、编码路径和目录穿越，以及通知 slug / ID / UTF-8 长度、目标字段、过期与 generation / Cookie 快照规则；构建验证 Android API 编译和安装包静态属性。
这些结果不代替 Android 手机上的登录、重启后会话、系统返回、键盘、选图、后台恢复、截图及员工真实执行链路测试。需要按实际构建记录实机证据。
若后续调试必须启动 adb、模拟器、Gradle daemon 或任何 Mac 本地监听服务，先遵守仓库统一端口登记流程；现有脚本没有启动这些进程。

参考：[Android 本地资源加载](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)、[WebView 文件访问安全](https://developer.android.com/privacy-and-security/risks/webview-unsafe-file-inclusion)、[文件选择回调](https://developer.android.com/reference/android/webkit/WebChromeClient#onShowFileChooser(android.webkit.WebView,android.webkit.ValueCallback%3Candroid.net.Uri[]%3E,android.webkit.WebChromeClient.FileChooserParams))。
