# 已完成结果被进度事件队列延迟

2026-11-02，紫衡用管理 MCP 路线完成短路由任务后，CEO 会话反馈网页仍显示 acked/in_progress。原 action 为 `action_f27854d1-fbb0-474a-8a54-f4a344a27455`，任务 `task_f7ab0cc1-15af-46c3-8332-153f77cb4b2e`。只读核查未重新执行原业务，也未修改原父子任务。

## 现场事实

北京时间 13:10:51.879 原生模型回合结束、最终正文 818 字；13:10:55.209 本机已成功，CLI 退出码 0、原 admission terminal/completed verified。13:18:31.834 服务端才收到 succeeded，13:18:32.653 本机 journal confirmed，延迟约 456.5 秒。13:22:59 正式 API 已确认 task completed、action succeeded、结果消息已送达。旧 MCP 失败 admission 仍保留，没有把其改成成功。

相关日志包含 response 436 条、output 427 条及 188 次队列满报告；队列满集中于 13:10:50–55。结果原文已在本机持久保存，并非模型仍在运行或 MCP 仍未终结。此延迟会让本地 execute Promise 和调度槽继续等投递，后续工作也受到影响。

证据位于 `D:\AINavtie\ops\ziwei\company-router-mcp-failure-20261102\management-route-settlement\REPORT.md` 和同目录脱敏 JSON。只读正式 CLI GET、文件/健康检查和 SQLite，无模型、重放、cancel、强杀或服务操作。

## 实现定位和修复范围

`src/daemon-action-delivery.mjs` 先持久保存 result，但随后等待普通 output/stage/progress 事件 FIFO 逐条上传，再投递真实 `/result`。原代码只对 in-flight action.response 做旁路，未覆盖其他进度；256 项队列与逐事件网络往返可以实质阻挡终态。

修复必须保留 durable 原结果、附件完整性、精确事件 ID/去重和结果未知状态。DSH 的 session binding 是服务端验收依赖的关键事件，须优先得到确认；普通进度不能阻挡结果，结果确认后也不应让过期进度继续挤占后续工作。原正式动作已经正常完成，本轮不做历史恢复或重放。

## 验证进度

实现仅改 delivery 模块和两个相关测试。新增红测复现 held output/stage/progress、256 项满队列、后续调度被挡、DSH 必需 binding 被满队列拒绝，以及未知结果投递。修复后代理组合 158/158 通过，根会话另跑包括正文、附件、未知/归档/重试、真实 DSH 控制/群成员及调度的 9 文件组合 145/145，无失败、无跳过；lint 440 文件和 diff 检查通过。独立 review 无阻断项，关键 DSH/inflight/unknown/scheduler 用例另 4/4 通过。

结果先 durable 保存，仅精确 DSH binding 等必要证据构成完成前屏障；普通进度异步投递，不再等待旧 FIFO。确认 result 后退休旧进度，迟到 POST 不改已确认记录、不继续重试。结果未知时保留原 blob 和事件，后续只投递原结果；附件完整回执与去重规则不变。未修改原正式动作或运行模型。

源码、安装、发布与现场效果分别补录；共享 Gateway 的另一个原生就绪问题不以本投递修复冒充解决。
