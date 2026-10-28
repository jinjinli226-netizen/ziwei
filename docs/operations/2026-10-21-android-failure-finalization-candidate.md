# Android 本轮失败自动收尾：验收与发布

日期：2026-10-21。范围：Android 管理 App 的状态判定与发送入口；已发布内部测试版，尚未真机或模拟器安装验收。

## 原问题与改动

旧 App 的 `blockingChatExecution` 会扫描当前会话、最近运行记录和 Bot 最新动作。即使服务端已经通过独立 `failureFinalization` 结束旧失败，原 `EXECUTION_UNCERTAIN` 仍会禁用发送。

新增 `mobile-manager/web/failure-finalization.mjs` 识别受信 API 返回的顶层独立合同，核对动作、类型、工作区、员工、电脑、Profile、原配置版本和控制代际。只有 `client_archived` 且归档确认匹配原 receipt ID、摘要和设备时才解除占位；原 error、result、未知业务事实与进程退出证明均保留，不借用旧的知微专用恢复合同。

`awaiting_client` 继续等待原电脑收尾，显示“执行失败，正在自动收尾”或“执行失败，等待电脑连接”。不再让用户手工核实，且不显示误导的重复停止按钮。即使新的只读记录覆盖最近动作，Bot 顶层待收尾记录也会继续显示。其他真实在途执行保持阻断。

## 验证

- 新增 25 项纯函数、真实 controller 与 renderer 回归；连同原历史恢复两组共 72 项通过，无网络监听。
- JVM URL 策略 73 项、通知边界 52 项、自建连接规则 141 项及原生 manifest 权限边界通过。
- 候选 APK 已完成编译、包名/版本、SDK、签名、zipalign、五项原生权限及 29 份内置网页资产逐字节检查。
- 未启动模拟器、未安装真机、未向员工发送业务，也未升级员工电脑或发布服务器。

## 候选与发布边界

首次构建前通过 GitHub 发布 API 及正式 `manifest-code15.json` 核对：正式最新仍为 `android-manager-v0.5.3-internal / code 15`。初次候选使用分支基线 `c9e20e42b44305e39262d21c1acc38dcce7155f6` 加当时尚未提交的修改；候选内置资产由随包 manifest 的 `webAssets` 固定。正式包须在本次源代码提交推送后重建，以正式 manifest 的 `sourceRevision` 和 SHA 为准。

初次候选为 `com.ziwei.manager`，`0.5.4-internal / versionCode 16`。初次候选 APK SHA-256：`6a5be5f47a257df8e616d4ca34e5ad891d7e7df800e57b6f18516d2ea2d0438c`；该摘要不作为重建正式包的摘要。

签名证书 SHA-256：`507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`，与正式 code 15 的公开 manifest 相同，沿用原内部管理 App 签名。

私有初次候选位于 `.local/android-failure-finalization-code16/candidate/`，不随 Git 上传，未作为正式安装包发布。旧 APK 不会因服务器网页更新而自动获得这段内置状态逻辑，需要安装新版本。

## 已发布产物

2026-10-21 19:24 北京时间，确认配套服务端 `1b9dbe40f4940a6b8105a34a670ed7094db4c3ea` 已上线并通过健康检查后，发布 [Android 管理 App 0.5.4 内部测试版](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.5.4-internal)。产品源码先推送 `codex/android-selfhost-notifications`，再从干净提交 `6a857c54c197fc774e5549aa4ffcdca6779afc7b` 重建；公开 tag 精确指向该提交。

- [APK 下载](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.5.4-internal/ziwei-manager-0.5.4-internal-code16.apk)：SHA-256 `1d1cb8269472ebaa51ddd59ba8edb52770d5aae37a24323ed2c21ef5c9576366`。
- [正式 manifest](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.5.4-internal/manifest-code16.json)：SHA-256 `fb54450c923af6348e21f376c9e8e7a4b39503d7b7a16cd636ac3793ba2766bf`。
- APK 完整匿名下载、manifest 原字节、SHA 文件和远端 tag 已核对；29 份内置资产同时匹配正式 APK 和准确产品提交。沿用原签名，`nativeProfile: selfhost`、`pushSdk: null`、`deviceVerified: false`。
- 未替换受控手机 Agent/Updater 下载目录；未安装管理手机或模拟器，未声明覆盖安装、登录或真实员工业务已验收。私有发布回执位于 `.local/android-failure-finalization-code16/`，公开产物和本页提供可迁移的核对入口。
