# Mobile mixed group code21 deployment receipt

核对时间：2026-11-01（Asia/Shanghai）。源码提交：`d6861e8ae0a67ba57d93aa35eb96117f6f56efa5`（`feat: add mixed Hermes DSH Codex group chat`）。本轮没有改动手机 Agent / Updater 实机协议。

## 构建

- 版本：`0.7.2-mobile-mixed-group / versionCode 21`，包名 `com.ziwei.manager`，minSdk 26、targetSdk 35。
- APK：`mobile-manager/dist/cockpit-20261101-code21/ziwei-manager-0.7.2-mobile-mixed-group-code21.apk`
- SHA-256：`ee93d5676366b5eda6c6a64d1be5332278f98053d0e4a862dc9c80ff4d5ee8ea`
- 签名 SHA-256：`507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`，与原管理 App 身份一致。
- `test-android.py`：URL 86、通知 52、自建接收/退避 141、OIDC 71、原生取消 12、manifest 边界通过。
- `test-build-android.py`：16/16 通过。
- mobile-manager 全量 Node 测试：564 tests，563 pass，1 skip，0 fail。
- 混合群/移动投影/CLI/DSH 受影响测试：103 pass；独立审计相关集合 46/46 pass。

## 大历史移动投影

真实 mobile route 的合成大历史投影保持在 20KB 以下：full/mobile `8,199,313 / 5,623` bytes；bots `3,836,803 / 6,800`；bot `3,829,599 / 15,328`；runs `2,546,822 / 3,980`；conversation `2,826,060 / 4,818`。完整历史仍由分页读取，原数据库、完整 action/result、默认/电话/MCP 响应未被压缩改写。

## Android QA AVD

- AVD：`Ziwei_Manager_QA_API35`，serial `emulator-5554`，沿用登记的 ADB 5037 / console 5554 / debug 5555。
- 覆盖安装：code20 → code21，`adb install -r -d` 返回 `Success`。
- 安装前：versionCode 20、versionName `0.7.1-mobile-candidate`；安装后：versionCode 21、versionName `0.7.2-mobile-mixed-group`。
- `firstInstallTime` 保留为 `2026-10-25 04:59:09`；`lastUpdateTime` 更新为 `2026-10-31 18:44:51`。
- code21 登录页 UIAutomator 看到“使用原账号邮箱和密码登录”，以及“将在系统浏览器中输入邮箱和密码；紫薇不会读取或保存密码。”；点击后焦点进入 Chrome，地址栏为 `auth.qzelynth.top/realms/ziwei/protocol/openid-connect/auth?...client_id=ziwei-android-manager...`。
- AVD 对外网络仍显示 Chrome “No internet connection”，所以真实邮箱密码、OIDC 回调、正式 API 与真实员工回执没有冒充为通过。
- 证据文件：`.local/android-vm-qa/code21-ui.xml`、`.local/android-vm-qa/code21-login.png`、`.local/android-vm-qa/code21-browser.xml`。

## 运行与日志

当前任务 AVD 仍由原生 `emulator-runtime.py` 监督；实例和健康日志位于 `D:\AINavtie\ops\identity\android-unified-20261025\emulator\logs`，未新建业务实例，也未终止 Agent / Updater。
