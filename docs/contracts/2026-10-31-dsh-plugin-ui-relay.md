# DSH 插件 UI Relay 合同

核对日期：2026-10-31（Asia/Shanghai）。DSH 桌面端的原生插件宿主已经在隔离环境通过 prepare、面板目录、SSE、v1→v2 HMR、停用/启用/卸载和真实回执验收。紫薇当前已接入 `plugins.prepareUiHost` 原生动作；本合同约束下一步网页 relay，不把本机 DSH Hub 直接暴露给浏览器。

## 当前状态

- `plugins.prepareUiHost` 由绑定设备调用 DSH Hub `POST /api/bots/:profile/plugin-ui/prepare`。
- 设备回执只保留当前 subject 的 `application`、`version`、`bridgePackage`、严格匹配的 `mountBase` 和安全 receipt。
- `application: applied` 只证明 DSH Host inventory 的 bridge entry 已 active，不证明 iframe 已收到 `ready`。
- 紫薇当前没有浏览器到目标电脑的长连接 relay；因此不能把 `127.0.0.1:7878`、Hub Cookie 或任意 DSH URL 返回给网页。

## Relay 会话绑定

每个网页插件工作区都必须先创建短期 relay session，绑定：

`workspace + employee + target device + DSH profile + actor + viewKey + nonce + expiresAt`。

服务端每次 HTTP、SSE、WebSocket frame 重新核对绑定和员工可见性。员工、设备、Profile、工作区、权限或 viewKey 变化后立即关闭 relay。relay 不接受浏览器传入的 target host、绝对 URL、Cookie、Authorization 或任意路径；只允许当前 Profile 的 `/runtime/<profile>/ui/` 相对路径及其受控 `/plugins/` 资产、`plugins/events` SSE、原生 remote.mux WebSocket。

## 设备通道

设备能力新增 `dsh_plugin_ui_relay_v1` 后，ziwei_user 才能领取 `employee.dsh.ui.relay.open`。设备动作验证当前 workspace、employee、device、Profile 和 viewKey，向本机 DSH Hub 建上游连接，并通过服务端 relay session 上传有序 frame。frame 必须有单调序号、类型、大小上限、超时和关闭原因；不能把 DSH Cookie 或本机路径写入回执。

浏览器到设备的输入 frame 只能经过同一个 relay session 回传，不能由浏览器直接调用 A2A 或指定另一个 Profile。设备离线、动作未知、撤权或 relay 超时均关闭上游；不得把断线当作 UI 已挂载或业务任务已停止。

## 网页宿主流程

1. 用户显式打开当前 DSH Bot 的插件工作区。
2. 紫薇读取并锁定当前 employee/device/profile，发起 prepare；停止 Bot 不自动启动。
3. prepare 成功后创建 relay session，生成随机 viewKey，创建隐藏同源 iframe。
4. iframe 只接收 `/runtime/<profile>/ui/` 的 relay 根路径，并附加 `dshbotPluginWorkspace=1`、`botName`、`viewKey`。
5. 父页面只接受 `event.source === iframe.contentWindow`、当前 relay origin、`channel === 'dshbot-plugin-ui'`、`version === 1`、botName 和 viewKey 都匹配的消息。
6. 只收到 child `ready` 后显示 iframe；`catalog` 只来自原生 slots，`selected` 只表示面板选择。
7. 收到 `unmounted` 时先隐藏 iframe并等待同一 relay 的新 `ready`，超时才显示宿主断开并允许重试；关闭工作区只卸载 relay，不取消员工任务。

## 分阶段实现与验收

1. 增加设备 capability、relay session 表和人类 API 的创建/关闭/撤权测试。
2. 先实现同源静态 HTTP 资产/JSON 请求的受限 relay，验证路径、大小、超时、员工串线和撤权。
3. 接入插件 SSE `plugins/events`，验证序号、断线、HMR `unmounted → ready`。
4. 接入 remote.mux WebSocket，验证双向 frame、关闭和未知结果。
5. 最后接 Vue iframe/catalog/selected/context，并用隔离 Bot 验收安装、面板出现、更新、停用和卸载。

在 relay 完成前，网页只能显示“宿主已准备，远程界面未接通”，不能显示插件面板，也不能把 prepare 回执当作 UI 挂载成功。
