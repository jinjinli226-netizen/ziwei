# 紫薇 Android 管理 App 原生层

首版是独立手机界面加原生 Java `Activity` / `WebView`，连接现有紫薇账号和工作区。
包名 `com.ziwei.manager`，最低 Android 8.0（API 26），target API 35。
它与 `com.ziwei.device.agent` / `com.ziwei.device.updater` 是独立应用；没有手机受控服务、无障碍能力或常驻执行进程。Hermes 仍由已有绑定电脑执行。

## 构建

在仓库根目录运行，Python 3.9+：

```sh
python3 mobile-manager/scripts/android-tools.py
python3 mobile-manager/scripts/test-android.py
python3 mobile-manager/scripts/build-android.py --version-code 9 --version-name 0.2.2-internal
```

自动工具准备支持 Apple Silicon Mac。固定使用 Temurin JDK 17.0.20.1、Android SDK platform 35 r02 和 build-tools 35.0.0；下载文件逐一比对官方校验值，缓存位于 `~/.cache/ziwei-manager-android`。
已有工具可传 `--java-home /path/to/jdk --sdk-root /path/to/sdk`。
构建按 `javac → D8 → AAPT2 → zipalign → apksigner` 执行，不使用 Gradle、adb、模拟器或本地监听服务。

产物在 `mobile-manager/dist/`，包含 APK、SHA-256 文件和 `manifest.json`。
脚本核对包名、版本、SDK、仅 `INTERNET` 权限、v2/v3 签名、对齐及每个打包界面文件的字节一致性。
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
- 只允许正式 HTTPS 源在 WebView 中发出资源请求；没有 `file://` / `content://` 页面访问、混合内容、第三方 Cookie、JS native bridge、TLS 错误放行或网页设备权限。
- 本地资源响应有 CSP。JS 只能来自同源模块，禁止 inline JS；图片支持同源、`data:`、`blob:`；样式允许内联样式，跨域 frame/object/form 被拒绝。
- WebView 主文档只允许打包页面。其他文档导航、弹窗及下载均在 App 内阻止，不发出浏览器 `ACTION_VIEW` Intent；没有可从外部导入任意 URL 的 deep link。相册的系统文档选择器不受此限制。
- 相册使用系统文档选择器，支持页面声明的多选，最多接收 20 张；只接收经用户选中的 `content://` 且 MIME 为 `image/*` 的 URI，不申请存储、摄像头或相册全量权限。

## 界面事件约定

原生层只向受信任的本地页面发送标准 DOM 事件，没有暴露可供 JS 调用的 Java 对象：

- `window` 上 `ziwei:resume` / `ziwei:pause`，`detail.at` 是事件时间。界面恢复到前台时从真实 API 刷新，进入后台时停止轮询。
- `window` 上可取消的 `ziwei:back`。界面同步调用 `event.preventDefault()` 表示已关闭抽屉、返回列表等；未处理时原生层回退 WebView 历史或退出当前 Activity。
- 系统栏和软键盘由原生 WindowInsets 处理，WebView 可用视口不覆盖状态栏、导航条或键盘。

## 验证边界

`test-android.py` 在 JVM 上验证 URL 信任、伪装域名、账号/端口、协议、编码路径和目录穿越；构建验证 Android API 编译和安装包静态属性。
这些结果不代替 Android 手机上的登录、重启后会话、系统返回、键盘、选图、后台恢复、截图及员工真实执行链路测试。需要按实际构建记录实机证据。
若后续调试必须启动 adb、模拟器、Gradle daemon 或任何 Mac 本地监听服务，先遵守仓库统一端口登记流程；现有脚本没有启动这些进程。

参考：[Android 本地资源加载](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)、[WebView 文件访问安全](https://developer.android.com/privacy-and-security/risks/webview-unsafe-file-inclusion)、[文件选择回调](https://developer.android.com/reference/android/webkit/WebChromeClient#onShowFileChooser(android.webkit.WebView,android.webkit.ValueCallback%3Candroid.net.Uri[]%3E,android.webkit.WebChromeClient.FileChooserParams))。
