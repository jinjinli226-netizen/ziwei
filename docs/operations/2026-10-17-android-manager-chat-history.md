# 2026-10-17 Android 管理 App 聊天历史修复

用户报告两位员工进入聊天后看不到历史。电脑版闲鱼员工的原长期聊天仍正常显示，本轮未写入正式业务数据。

## 已复现原因与修复

原 `openEmployee` 即使缓存了 Bot 的主会话 ID，仍先等待一次 Bot 详情；历史返回后，又等待 Bot、运行记录、例行工作和重复会话请求全部完成才重绘。真实内存 repository 的 initialized Hermes Bot 复现表明，messages 已含原历史，界面却仍为空且 busy=true；仅挂起任一辅助请求即可稳定复现。

现在直接读取已绑定原会话，历史返回立即重绘并解除聊天加载态。辅助请求独立更新，各自保留工作区和员工守卫。刷新时会话读取也不等待工作区列表。首次失败可重试同一主会话；GET 20 秒超时明确提示，非法历史响应不会被当成空聊天，不新建会话替代已初始化 Bot 的主会话。

独立审查还复现了旧历史刷新覆盖发送后新消息与 execution 的竞态。发送及切换员工时提升聊天读取版本，旧快照、旧错误不再回写；发送期间暂停会话轮询，失败后恢复。

## 验证

- 40/40 移动端单元测试；新增慢辅助请求、原会话重试、跨员工隔离和发送/刷新竞态。
- 原 15 条浏览器流程保持通过；新增 7 组 initialized Hermes 历史回归，含长文字滚动、原 PNG base64 解码、慢辅助请求期间编辑草稿、辅助 503 保留历史、首次 503 后重试、晚返回隔离。新增回归仅 50 次 GET，零业务写入、零新建会话。
- 55 项原生 URL 检查通过；独立复核确认所发现的竞态已闭环。
- 首次构建的版本门禁发现 aapt2 参数未覆盖源 manifest 的版本值；已使用 `--replace-version` 并更新默认版本，重新构建通过身份、权限、签名、zipalign 及逐文件资源比对。

## 更新包

- 应用 `com.ziwei.manager`，`0.1.1-internal` / code 2；Android 8.0 及以上。
- 产品源码先推 GitHub，再构建/发布。聊天修复 `c372d0d`；最终打包源码 `9fcb83c84652b09927e73172880bc32f1196e921`。
- APK `ziwei-manager-0.1.1-internal-code2.apk`，66382 字节，SHA-256 `1deac0c3b087171dfa910bab560c4115ea508238dd4fea8f6e468b4b5abb91e1`。
- 与 code 1 同内部证书 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`，覆盖安装，无需卸载。
- 主站/API、数据库、原员工身份、Profile/HOME、Windows 和互联 Agent / Updater 不变。

模拟器、隔离 browser/Android WebView 回归不代表用户真机与正式账号历史实测。实际设备登录、Cookie 与用户手机显示仍以实际回执为准。

## Android 与发布回读

Android 15/API 35 ARM64、WebView 124 模拟器：code 1 → code 2 同证书覆盖安装成功，原 firstInstallTime 保留；最终包逐项资源哈希与 manifest 一致，正式匿名 API 路径显示登录页。独立 `com.ziwei.manager.smoke` 只增加隔离 GET fixture，真正新版 app/controller/API/view/model 等模块与正式 APK 哈希一致，禁止 API 网络透传。347ms 内显示 3 条历史，Bot/runs/routines 共 3 项仍 pending，草稿可编辑保留、原 PNG 可解码、历史可滚动。截图已目视核对。未重复原生测试同会话发送竞态，该点由专项单元覆盖。

前台未观察到崩溃；AOSP WebView 124 的 seed 签名和首更缓存 index 诊断保留，不宣称 Chromium 日志为空。临时 SDK 进程全部停止，端口登记 240–244 已释放，最终 check 为 ok=true、conflicts=[]、unregistered=[]。

[0.1.1 内部发布](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.1.1-internal)已公开，APK 从公开下载地址回读 SHA-256 与本机一致。未覆盖 code 1 的旧发布资产。完整本机交付目录 `/Users/zhangjie/Documents/ChatGPT/紫薇/output/android-manager/v0.1.1-internal`，包含 APK、校验、manifest、验证 JSON 和明确标注隔离验收的预览。
