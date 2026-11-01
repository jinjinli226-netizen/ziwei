# 阿特 Gateway 断连与后台任务收尾

2026-11-01，用户反馈阿特再次执行失败。员工为 `employee_1a263572-a5c3-460a-9e13-875ab73a3c87`，Profile 为 `bot-42fb9e86d9edb043e935bc88`，失败动作为 `action_2d82c352-bd6a-4bd1-9eb1-cbb3f4481234`。

## 实际证据

北京时间 22:56:10 原 Gateway 收到请求，22:56:56 CLI 因 `Gateway disconnected; turn outcome is unknown` 退出，22:57:12 平台记录 failed。Gateway 原任务继续到 23:01:54；23:06:53 原会话以 `ws_orphan_reap` 结束。原生 SDK 的只读 receipt 确认 admission `407ffc0923224d58a67ec6ab5da79a65` 已 terminal/interrupted、generation 7，`completed=false`。只有超时诊断，没有可补成成功的业务正文。18:03 另一次执行也出现 CLI 先失败、后台继续数分钟的同类现象。

证据目录：`D:\AINavtie\ops\ziwei\ate-failure-readonly-20261101`，其中 `ATLAS-NATIVE-RECEIPT.json` 是现有 Gateway 的只读 SDK 回执，`ATLAS-ACTION-BINDING.json` 证明原动作直接绑定原生 session。原动作、会话和失败记录均保留。

## 修复范围

- 原生服务端已对 loopback 禁用易受 worker 阻塞影响的心跳超时，客户端却仍使用 websockets 默认 20 秒 ping/20 秒 timeout。紫薇会话桥仅对实际 loopback socket 放宽 ping timeout，保留 ping、RPC 和 action 预算，不修改共享 Hermes 安装或远端连接策略。历史日志没有原 close code，不把本次断连原因写成已证明的 ping timeout。
- 所有受平台监督的 Hermes 对话均记录精确 session/input/admission，包括阿特这种无 `payload.hermesBot` 的普通员工。退出前读取原 admission receipt；仍 queued/started 时只取消该 admission，并有界观察真正终态。断线只连接原有 owner，不启动服务、不重发 prompt、不猜测停止“当前会话”。
- 原生桥在受信 stderr 输出最小 Gateway 证明；运行端按 action、员工和实际 Profile HOME 核验。CLI 进程树退出仍保留为事实，不能替代后台 turn 终态；缺少清理证明或仍未知时必须保留 uncertain。

同次 TTFB 120 秒阈值迟到至约 326 秒才触发，另有 lease 刷新迟到。已读原生实现，尚无当时线程栈证实 GIL、SQLite 写锁或上游握手状态；本轮不猜测调大 provider timeout、不修改 provider/model/推理强度来规避验收。

## 验收状态

根会话组合回归 102/102 通过，无跳过；覆盖真实监督子进程、普通员工的实际 launcher/bootstrap、关闭与取消、未知清理证明、迟到 CLI 回执，以及既有 DSH 收敛和流式链路。独立审查对照实际安装的原生 SDK receipt/cancel/keepalive 实现，未发现阻断项。未修改 provider/model/推理强度或共享 Gateway 安装。

针对性回归与安装、真实对话分别记录。原失败已确认中断，不重放原业务。真实验收将使用明确标记的只读测试消息，保留一次提交标识与原 action 回执，结果未知时先查询原请求，不盲目重发。
