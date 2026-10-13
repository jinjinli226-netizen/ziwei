# E02 Gateway 接收健康 P2 验收

日期：2026-10-13。父提交：`8cca4e2986c1b276ae2c4d48ad7b979c1fd68025`。分支：`codex/v2-e02-native-capabilities`。
工作树：`C:\Users\25941\.codex\worktrees\v2-e02-native-capabilities\灵光爸爸拆解`。最终补丁 SHA 见 `.local/e02-gateway-health-handoff.json`。

## 结果与根因

Q01 在 `2a9c1d94224931c881d8ced988b14b4f0ef1af6d` 的独立审查证据中复现：Slack 原生 `_restart_socket_mode` 先销毁 handler/task，重建失败仍保留 `_running=True`；桥接通用回退把它错误显示为 connected。本补丁把 running 降为前置条件，并要求实际接收证据。

Slack 核对 handler、Socket Mode task、SDK message_receiver/message_processor、重连锁、原生 transport 与 ping/pong；异步探针限时 0.5 秒，返回后复核对象身份与 fatal 状态。重连、结束的任务、失活 socket 为 retrying；缺 API、异常、超时为 unconfirmed。JS 接受 unconfirmed 心跳并立即关闭两侧准入；健康恢复仍可正常回到 connected。同步 fatal 通知、永久停止门闩、原 action 幂等、未知发送不可重放及 Windows 树证据保留。

同样移除其他渠道的 running 通用成功回退，当前覆盖如下：

| 路径 | connected 的接收证据 | 本轮正向/故障证据 |
| --- | --- | --- |
| Slack Socket Mode | 原生任务、SDK receiver/processor、transport、ping/pong、非重连 | 实际安装 adapter 的失败重启/恢复/断开、替换对象竞态、fatal、超时；本地 WS 开/关 |
| Telegram polling | updater.running、当前 generation 的 progress、未 degraded | 原生 generation 开始/进度/撤销/恢复；受控 updater |
| Discord | 活跃 bot task 与原生 WebSocket/ACK/latency 探针 | 正常 ACK、过期 ACK、恢复、task 结束；受控 SDK client |
| Feishu WebSocket | 活跃 future/loop 与 SDK connection open | 实际安装 lark SDK Client 和本地 WebSocket 开/关；future/loop 为受控边界 |
| Feishu webhook | 实际服务中的 aiohttp listener | 本地 listener 启停 |
| DingTalk | 活跃 stream task、SDK socket open | 正常、关闭、恢复、未知 socket API；受控 SDK client |
| Mattermost / Webhook | 原有 task/socket 或 serving listener | 本轮重新运行原生回归 9 项 |

未知插件、尚未核对 listener 的 Telegram webhook 返回 unconfirmed。它们不能仅因进程在运行就显示已验证可收发；本轮没有把所有健康渠道统一禁用。

## 本轮验证

- 先复现再修复：`.local/slack-health-red.log` 的初始 9 项出现 15 个断言失败、0 个测试错误，包含原生失败重连后 connected 误报，以及 worker 仍发送。JS 新增用例也在补丁前失败于 connected/unconfirmed 差异。
- 新原生接收健康用例 16/16；此前 Room/Mattermost/Webhook 原生回归重新执行 9/9。运行器：`node scripts/verify-hermes-receive-health.mjs`。
- 原生完整证据：`.local/receive-health-1791864644172/receipt.json`。两个测试进程及版本探针均由 Windows Job 监管，rootExitCode:0、treeConfirmed:true、activeProcesses:0。原生临时 HOME、异步任务与本地 listener 由夹具清理；保留日志和 receipt。
- 最后一次 Node 全量：`node --test --test-concurrency=4`，788/788 通过，0 失败/跳过，77.52 秒；`.local/receive-health-full.log`。本轮仅运行这一次完整回归。
- JS Gateway 定向 7/7；lint 96 个 source files；三个 Python 文件 AST 检查；`git diff --check` 通过。
- 实际安装 Hermes 0.21.3，HEAD `bbaf7af5c83546d19f8060f4097d3bb25cd1a3c3`。8 个相关安装源码 SHA-256 前后相同，原有 tracked 修改状态前后相同。

## 证据边界与接入

Slack/Telegram/Discord/DingTalk SDK 在此电脑未安装，因此测试加载真实原生 adapter 与其生命周期/探针，SDK 边界使用受控对象；没有声称真实云 SDK 握手成功。Feishu SDK 已安装，本地 WebSocket 只验证实际连接状态接口，没有云服务身份认证、事件协议或真实线程驱动验收。网络保护阻止外部 connect 和 DNS；不读取云账号、发送真实消息或安装依赖。

精简 receipt：`docs/ops/2026-10-13-e02-gateway-receive-health-receipt.json`。API 状态约定已补入 `docs/contracts/2026-10-13-hermes-native-api.md`。协调者可将本提交独立转 E03；页面应直接展示 retrying/unconfirmed/failed 与脱敏 code，停止证据仍由 processExit/stopConfirmed 表达。本报告不表示 E03 已组合验收。

仅修改 E02 隔离树；未操作 E03 预览、原项目、正式客户端/Hermes、2884、设备或外部业务，未 push/merge/部署。后续 Bot 手机组合补丁另行提交，不混入此次 Gateway 修复。
