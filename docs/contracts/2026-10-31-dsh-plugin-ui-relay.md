# DSH 插件 UI Relay 合同

核对日期：2026-10-31（Asia/Shanghai）。DSH 桌面端的原生插件宿主已经在隔离环境通过 prepare、面板目录、SSE、v1→v2 HMR、停用/启用/卸载和真实回执验收。紫薇当前已接入 `plugins.prepareUiHost` 原生动作；本合同约束下一步网页 relay，不把本机 DSH Hub 直接暴露给浏览器。

## 当前状态

- `plugins.prepareUiHost` 由绑定设备调用 DSH Hub `POST /api/bots/:profile/plugin-ui/prepare`。
- 设备回执只保留当前 subject 的 `application`、`version`、`bridgePackage`、严格匹配的 `mountBase` 和安全 receipt。
- `application: applied` 只证明 DSH Host inventory 的 bridge entry 已 active，不证明 iframe 已收到 `ready`。
- 紫薇现在有短期 relay session、同源 HTTP/SSE/WS 数据通道和人类 API。浏览器只访问紫薇同源 `/runtime/<profile>/ui/`，服务端通过一次性 viewKey 交换 HttpOnly relay cookie；`127.0.0.1:7878`、Hub Cookie 和任意目标 URL 永不返回给网页。

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
4. iframe 只接收 `/runtime/<profile>/ui/` 的 relay 根路径，并附加 relay 标识、`botName`、`viewKey`；相对 HTTP、SSE 和 remote.mux WS 资源继续使用同源 HttpOnly cookie。
5. 父页面只接受 `event.source === iframe.contentWindow`、当前 relay origin、`channel === 'dshbot-plugin-ui'`、`version === 1`、botName 和 viewKey 都匹配的消息。
6. 只收到 child `ready` 后显示 iframe；`catalog` 只来自原生 slots，`selected` 只表示面板选择。
7. 收到 `unmounted` 时先隐藏 iframe并等待同一 relay 的新 `ready`，超时才显示宿主断开并允许重试；关闭工作区只卸载 relay，不取消员工任务。

## 分阶段实现与验收

1. 增加设备 capability、relay session API 和人类 API 的创建/关闭/撤权测试（已完成）。
2. 同源静态 HTTP/JSON、插件 SSE `plugins/events` 和 remote.mux WebSocket 已接入，覆盖路径、大小、序号、超时、员工串线和撤权。
3. Vue iframe 宿主已接入：只在 child `ready` 后显示，校验 source/origin/channel/version/botName/viewKey，处理 `unmounted → ready` 和 relay 过期。
4. 真实 DSH Bot 生命周期（安装、面板出现、更新、停用、卸载）仍需目标电脑发布新 daemon 后做现场验收；本地协议测试不能替代该验收。
