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

## 源码与本机安装

修复提交 `0f79c2b728cbbf50785bbdf9a621fe633b8974e5` 已推送。沿实际安装的 `13ce4205…` 增量基线仅覆盖 delivery 模块，保留其他已上线修复，没有用整个 Git 树替换实际安装。新包 `ziwei-0.1.4.tgz` 为 717513 字节，SHA256 `25310169a35625feb6a6afadbd4f26c8bd056b14c3874d1274bd703d68190012`，client build 为 `b1bd1803fb9b42c4a54dfba66069514a3aaf6bdaf70eb508e2c05e4793090d63`。

北京时间 14:11:40，官方 updater 已 complete，原客户端经正式接口停止、自然退出，没有强杀；新原生客户端 health/ready 均为 200，14 项安装检查通过。安装后 138 个非 pyc 源文件与候选一致，delivery 文件 SHA256 为 `1cd468597598accccb39b0aca673a2d9d3fe021775cc995fcfbf863e59f22d17`。根会话再次比较安装文件与 Git 工作树的 LF 正文一致，并重新运行 9 文件组合 145/145；独立复核关键新用例 10/10。员工 Profile、Hermes 根配置、独立 Workspace CLI 2.0.4 保持，未重放原业务或调用模型。

打包、正式 stop、updater 与原生验收证据保存于 `D:\AINavtie\ops\ziwei\terminal-priority-release-20261102\`。原 verifier 固定读取旧 Gateway PID，重启后复跑会覆盖同名安装回执；14:11 成功记录另存 `owner-recovery/HISTORICAL-INSTALL-141140.json`，明确为原工具输出摘要，不冒充完整原始回执。当前状态以独立时间戳回执为准。

## 随后电脑重启与维护分工

电脑于 14:13:57 重启，旧客户端和 Gateway PID 因此失效。14:38 发现自动启动入口固定了 Codex MSIX LocalCache 下的旧工作区配置，当前 build 虽正确，owner 与原生配置不符。原生配置未丢失，也没有历史 delivery 记录阻塞。

既有 `D:\Ziwei-Local\Start-Services.ps1` 仅把 `ZIWEI_USER_HOME` 固定路径改回原生目录，继续同时显式固定 `ZIWEI_CONFIG`；文本差异仅一个 literal，PowerShell 解析无错误。旧重复 Startup VBS 完整移到本次运维目录备份停用，未新增调度器或守护。空闲错误 owner 经正式 pause/drain/stop 自然退出，正确 owner 用既有 CLI 启动；旧 VBS 留下的另一进程没有控制监听，未声称已停止或空闲。没有执行整份多服务启动脚本。

14:53:55 的独立恢复回执确认原生 owner、build、安装源文件、配置、Profile、独立 Workspace CLI 和当前 Gateway 保持，12/13 项通过；唯一未通过为 ready。公网 origin 的 HTTPS 握手完成后仍无 HTTP 响应，管理 MCP bootstrap 超时。根会话的三条无凭据公网 GET 也在 12 秒内无响应；这只能证明当时连接未恢复，不能据此认定 API、转发或网络中的具体故障点。

用户随后明确由另一位维护者处理重启后的连接恢复。本会话及协作维护会话停止额外服务操作，保留候选包，暂缓正式下载 latest 指针切换；待连接恢复后再只读核对实际生效和发布结果。没有把 14:11 的历史 ready 当作重启后的当前成功。

恢复与启动证据见上述目录的 `owner-recovery/STARTUP-ACCEPTANCE.json`、`RECOVERY-ACCEPTANCE-2026-11-02T06-53-55-171Z.json` 和 `MAINTAINER-HANDOFF.json`。没有清理、迁移或手改正式会话库；也没有全库逐字节比较，不能据此声称所有会话内容均已独立验收。

## 连接恢复后的验收与正式包发布

15:24 只读检查确认当前原生 owner 的 health/ready 均为 200，工作区和配置身份正确，build 为 `b1bd1803…`，管理 MCP ready、心跳新鲜、隔离数为 0。15:30 再次核对已安装 delivery 文件与 Git LF 正文一致，blocked delivery 为 0；此时有 1 个活跃动作和 1 个待投递记录，不能把正常执行中的 pending 或“暂不安全停止”误判为旧队列卡死。102 个 archived-unconfirmed 历史记录保留且不阻塞 ready。本轮没有发起模型任务或重放原动作。

15:30:28 仅更新正式下载的 `ziwei-latest.tgz` 与 `release.json`，保留前版包和元数据。发布方完整公网 GET 核实包为 717513 字节、SHA256 与上述候选一致，release JSON 为 2113 字节，source 为 `0f79c2b…`、build 为 `b1bd1803…`。独立只读复核于 15:32:49–50 确认公网 health 200 和新 release 标识。旧的 15:24 元数据快照已被新证据取代。

独立 Workspace CLI、历史包、公开 docs/llms、API、网页和手机端文件指纹保持发布前状态；没有启停服务、改变转发或 Nginx 配置、写业务数据、请求设备批量升级。正式发布回执为 `D:\Ziwei-Local\artifacts\cli-delivery-priority-0f79c2b-20261102\publication-20261102T073009Z\PUBLISHED.json`，passed=true。本机追加快照为 `POST-RECOVERY-2026-11-02T07-30-37-004Z.json`；其 pending-clear 检查为 false 对应上述正在执行的动作，不表示 ready 或本次投递修复失败。

此处确认的是本投递修复的源码、安装、连接恢复和下载发布，不替代[原生 Gateway 尚未上线候选的验收](2026-11-02-router-private-mcp-discovery.md)。

根会话于 15:41:09 另用无凭据 GET 完整下载正式 tgz，717513 字节与 SHA256 全部一致。此前额外带查询参数的 Node GET 在 20 秒预算内超时；后续普通 health GET 为 200、0.85 秒，完整包回读成功，不将单次探测结果扩大为长期稳定性结论。
