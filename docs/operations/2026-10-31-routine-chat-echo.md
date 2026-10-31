# 例行任务结果回员工主聊天

2026-10-31 用户确认：例行工作页管理任务定义、启停、编辑和运行记录；任务的文本和图片进入员工平时的主聊天。没有要求所有新 Bot 自动继承设计 Skill。手机端未经用户验收，本次发布排除。

## 实现

- Hermes/Codex 既有的绑定会话执行结果，继续由 `repository.resultA2AAction` 保存 assistant 文本和 `outputArtifacts` 图片。
- DSH 沿用原生 Routine 调度。`backend/dsh-routine-sync.mjs` 通过既有服务端 tick 排队 `routines.list` / `sessions.history` 只读动作，不创建第二套 schedule、不重放原业务；浏览器关闭或切换员工仍采集。
- 采集指针保存到 `management_requests`，多任务公平读取、重启后查原动作、断线后读取保留的尝试历史。空结果、进行中和图片读取失败可再次读取，不写已送达标记。
- `src/dsh-native-session-operations.mjs` 对当前终态 turn 的 assistant/tool 输出 image attachment ref，调用绑定 session 的 `session/attachment` 取回真实字节。用户输入、旧 turn 和非 append 压缩副本不成为新结果；图片共享 20 张/10 MiB 限制。history 不再重复放入 canonical observations，避免双份 base64。
- `backend/dsh-routine-results.mjs` 汇集同一终态 turn 的文本/图片；成功、原生 error/max-tokens/blocked/interrupted/forked 和取消分别保持真实结果。终态与当前员工绑定核实后，消息和每次尝试的幂等标记在同一 savepoint 保存，排除群专用会话。
- 前端例行页不显示结果正文，也不靠前端定时采集；正常聊天复用已有消息、图片预览/下载及实时刷新。

## 已运行验证

- 原生控制、设备交付、设置、Provider、群聊、relay、聊天前端等相关回归 379/379 通过（包含长容量用例）。
- 新增后台采集/主聊天落库/原生附件读取及其相关测试 104/104 通过，覆盖完整原生附件 ref→设备字节→服务端聊天附件；图片读取失败保留 unknown。
- lint 413 源文件通过；前端生产构建通过。
- 使用新源码适配器只读读取 DSH 已有真实文字测试 session：31 条记录、completed 终态、238 字 assistant 正文；没有新增模型任务。此项没有图片，不能代替真实图片验收。

## 发布边界

本文是源码验证记录，尚未证明正式 API、前端和 CLI 已发布。CLI 必须实际报告 `dsh_native_controls_v1` / `dsh_plugin_ui_relay_v1` 并加载新版 history 取图代码才具备完整链路。正式发布需记录最终推送 SHA、精确增量清单、身份依赖/CLI健康和真实图文验收。保留当前数据、Profile、认证、失败记录及正式入口；不发布 `mobile-manager/`、未提交 `backend/ziwei-connect.mjs`、手机 Agent/Updater 或 APK。
