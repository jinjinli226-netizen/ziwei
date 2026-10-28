# Android 统一登录 code18

用户已授权接入现有统一账号，并在本机独立 Android 模拟器验收。产品提交 `32ace365186863011b0175201b3c7076b411900a` 只启用既有 `OidcRules.CONFIGURED` 并将版本递增至 `0.6.0-internal / code18`；原 code17 不变。

- 包名：`com.ziwei.manager`，Android 8.0 及以上。
- [正式 HTTPS APK](https://ziwei.qzelynth.top/downloads/android/ziwei-manager-0.6.0-internal-code18.apk)，801449 字节。
- SHA-256：`172c92a32247fbbd53c21559a06f63c309d952ca2cb5e88b4def8dbd15f6671e`。
- 原签名证书 SHA-256：`507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`，v2/v3 均通过。
- 362 项原生检查与 10 项桥接回归通过；界面资源与 code17 完全一致。未重复已通过的整套网页审计。
- 独立 Android 15 / API35 模拟器已启动，实际已安装 APK 的字节 SHA 与公开下载及构建产物一致。原统一超管已通过实际系统 Chrome 表单登录并返回 App，原三个工作区保留，BigTron 管理列表与 mobile-v2 提醒读取通过。
- 实际重新启动 App 进程后，恢复加密 RT 并完成续期，未再次打开浏览器或输入密码；退出后回到登录页，新进程也不能恢复旧登录；随后新的授权流程重新登录成功。没有导出 App 私密令牌。

服务器专用客户端 `ziwei-android-manager` 与精确 Android azp/human 准入已上线。服务器负责人另行完成真实 PKCE、JWT 签名与唯一 audience、owner API/mobile-v2、public refresh、本人会话撤销后旧未过期 AT 及旧 RT 拒绝、跨 client 拒绝。本轮直接复用这些实际服务器回执，没有新建合成成员或重做整套矩阵；它们与实际 App 界面证据分开记录。真实手机及真实手机原数据覆盖升级仍未实测。

最终实际回执为交付目录中的 `APP-NATIVE-QA-RESULT.json`，服务器回执为 `ANDROID-SERVER-RESULT.json`。模拟器保留已登录的 BigTron 管理页面，Chrome 私密调试转发验后已关闭。关于页底部继承了旧 `Android 0.5.3` 文字；Android 实际包版本已独立核验为 code18，未为该既有显示文字另打包。

安装时直接覆盖原“紫薇”管理 App，不要卸载或清除数据。本包与“紫薇·互联”的 Agent / Updater 分属不同应用，不替换它们的安装索引或配对数据。模拟器运行时、镜像、AVD、临时数据及持久诊断均放在 D 盘；所有 ADB 操作固定 `emulator-5554`。
