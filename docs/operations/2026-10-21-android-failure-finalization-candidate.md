# Android 本轮失败自动收尾：候选验收

日期：2026-10-21。范围：Android 管理 App 的状态判定与发送入口；本记录不代表已发布或真机验收。

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

私有初次候选位于 `.local/android-failure-finalization-code16/candidate/`，包含 APK、SHA256 和 manifest；不随 Git 上传。发布前先推送源代码，重新核对正式最新版本，防止覆盖并发发布。本页不代表已创建 GitHub release 或已发布。旧 APK 不会因服务器网页更新而自动获得这段内置状态逻辑，需要安装新版本。
