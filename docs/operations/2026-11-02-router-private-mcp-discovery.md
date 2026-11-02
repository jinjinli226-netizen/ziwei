# 公司 Router 的会话私有 MCP 发现失败

2026-11-02，CEO 会话按用户“出问题找紫薇驾驶舱维护”的授权转来紫衡首轮路由验收失败。员工 `employee_7343c4fe-b170-4d46-8a75-5bc1360c445c`，Profile `bot-7dd32f65d66e041875a13cad`，原 action `action_7a25eb68-06ba-496d-8786-72ddabf966b6`。本轮只处理平台运行端，不改岗位、模型、工具集或项目分工，不重发原任务。

## 原失败事实

原 admission `5932762fec544590832b85d1ce6e602e` 为 terminal/failed、epoch 1、generation 1；原 session 的模型 API、输入输出 token、工具调用均为 0，未发生项目委派。CLI 根进程退出码 1、树退出确认，后台原 admission 已有可信失败终态，取证时无 lease。原记录保留。

北京时间 12:35:33 第一批三个私有 MCP 共注册 32 个工具。12:35:42–49 第二批只有 collaboration 未连上，autonomy 和 management 正常；错误显示 `CancelledError`。原生执行最终抛 `RuntimeStoreError: acp_mcp_discovery_failed`。该 Profile 同期未见用户取消、Gateway 停止或 drain，不能把监督回执中的 `cancelled:true` 当成用户取消原因。

## 源码和隔离诊断

实际安装的 `gateway/session_local_mcp.py` 为编辑器 MCP 固定 5 秒连接预算，范围包含准备、进程启动、握手及 tools/list。创建会话时的 partial discovery 在尚无 viewer 时释放连接；admission 前 refreeze 会再次发现。refreeze 发现不完整时保留原冻结工具集，执行阶段再明确失败，不静默降低原本需要的协作能力。相同 fingerprint 的 session.resume 只 attach，不应仅凭两轮日志归咎其重复绑定。

原生错误格式化器会把 `TimeoutError → CancelledError` 异常链显示为单独的 CancelledError；超时清理 await 已取消子任务，也可能覆盖原 TimeoutError。直接提取实际函数的无网络隔离验证已复现两条路径。故日志不足以恢复本次最初异常，5 秒连接预算耗尽是符合时序的假说，尚不能断言具体卡在启动、握手或 tools/list。

原失败证据位于 `D:\AINavtie\ops\ziwei\company-router-mcp-failure-20261102\REPORT.md` 和同目录脱敏 JSON，使用隐藏原生 helper 与只读 SQLite 核验，无模型、业务重放或共享服务操作。

声明的 Hermes base Python 与现有测试解释器各做 5 次直接入口、1 次审计包装握手，合计 12/12 通过。只发送 initialize、initialized 和两次 tools/list，spawn 到 tools/list 为约 231–547 毫秒，未复现第二次变慢；没有 tools/call、网络、嵌套进程或真实 Profile 读取。该实验使用 `-I -B` 禁止字节码写入，仅证明隔离条件下入口协议与启动正常，不排除现场父进程调度、管道、authority 生命周期或预算问题。证据在同目录 `handshake/STDIO-HANDSHAKE.json`。

## 生命周期候选已验证，未生产化

直接使用原生 authority、临时 SQLite、dispatch/fenced mutation 和受控 stdio peer 对比：当前 create 流程第一次启动 3 个 server 后释放，admission 后累计 6 次启动；在 viewer 已存在后绑定则保持 3 个连接，admission 不再冷启。两种路径都只提交一次隔离 prompt、原生终态 completed，3 个私有工具、推理约束、标题续接、凭据轮换和跨会话隔离均通过。合法旧 revision 被原生拒绝，未启动新进程。没有真实模型、正式 Profile、外部 API 或 HTTP/WS 服务；Windows 标准库内部 socketpair 与真实网络服务在审计中区分处理。

partial mutation 的真实返回只列 2 个已连接 server，却仍可用整个请求的相同 fingerprint resume。因此仅去掉 create 的 editor 字段并在 conflict 时验证 mutation 不足以保证下轮能力完整。每轮强制 fenced binding 能验证完整名单，但同 fingerprint 的忙会话原可 attach 排队，新方案会被原生 idle gate 拒绝，存在排队语义成本。该候选没有贸然生产化，未改变共享 Hermes 或现有桥的行为。完整证据位于同目录 `lifecycle-isolation-report.md`、`lifecycle-isolation-result.json`。

CEO 会话自行维护紫衡的配置，将故障 sidecar 收起并沿管理 MCP 完成路由验证；本维护会话没有更改该配置或重发原测试。随后发现的完成结果投递延迟见[结果投递优先级](2026-11-02-result-delivery-priority.md)。

## 后续两次 Gateway 失败

知舟子 action `action_988fedd1-022c-4318-a154-544de36ec5ac` 在 13:15:58–13:17:28 的旧 owner 失联窗口报告 connection/read failed，session 为空。紫衡 action `action_3ce7b2d3-501f-426e-8bfb-00966bafd59a` 于 13:24 开始后在新 owner 冷启动窗耗尽 ensure 预算，报告 starting:deadline；两次均没有新 session/admission 或模型消息，没有自动重放。

旧 Gateway PID 6716 在 13:21:35.736 被自身 watchdog 判为主 loop 连续三次未响应而退出 75，宿主自动创建 PID 58340（13:24:22.824）。源 SHA 仍为 `c2c5eef14924a09021ef8af1e8b9f1135879d89e`，不是本轮修改或人工重启。旧 owner 持久线程栈停于 hosted-room watcher → `_ensure_hosted_service` → `_profile_runtime_scope` → `owner_secret_scope` → `_is_process_home` → Windows `Path.resolve`/`ntpath.realpath`，并非 MCP 工具调用栈。

原生 identify 控制线程可独立返回 descriptor ready，不能单独证明 asyncio/WS 可服务。13:39 的追加只读 probe 已通过两 profile 的 discovery/ticket/WS；紫衡 runtime.describe 在 485 毫秒返回，知舟未在明确的 3 秒诊断预算内返回。该短预算不等同原业务默认预算，也不足以断言新 owner 与旧 owner 同一栈阻塞。

后续先核验当前 profile 就绪和 hosted-service 主 loop 同步 I/O，不能只调高业务 timeout、把描述符当成功或强制重启有活动的 owner。此处尚未宣称原生问题已修复。新两失败证据在同目录 `gateway-start-failures/REPORT.md` 与 `WATCHDOG-STACKS.json`。
