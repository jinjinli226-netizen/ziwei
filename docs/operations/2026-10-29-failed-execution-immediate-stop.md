# 失败执行立即终止

用户在 2026-10-29 明确要求：失败会话或进程立即终止，不等人工操作。本变更基于 `8e4f37a`，只交付源码，未部署或升级正式设备。

## 执行规则

- 明确的原生终态失败事件、非零进程退出、executor 返回失败或抛错，立即请求终止本次执行拥有的进程树。停止请求在失败路径触发，退出确认只用于如实保存结果，不是终止前的人工门槛。
- Windows 使用本次进程的原始 Job handle，包含 detached 子进程；不扫描同名进程，不用员工显示名推断 PID。
- 成功 CLI 可能启动用户需要的服务。根进程退出码 0 时先保存原始退出回执，保留原 Job handle；如果随后判定业务失败，仍可立即终止这棵树，并另存 cleanup 回执。原成功服务在没有失败或停止请求时继续保留。
- CLI 即使以 0 退出，明确的 `turn.failed` 或失败 `result` 也不能被当成成功；末尾没有换行的失败事件同样处理。普通可恢复工具错误仍由运行中的 Agent 处理。
- 群执行停止覆盖已经返回根退出回执但仍留有子进程的成员，并从实际 cleanup 回执重新聚合状态。
- DSH 是共享常驻 Bot。失败、断线、超时、协议或适配器异常立即请求取消当前 action 所属的 session turn；关联 requestId 和 turn，不杀掉共享 Bot，也不重复提交 prompt。
- 无法确认退出时保留失败和未知证据，不伪造 PID、空进程树或 `stopConfirmed`。既有动作不得因清理而重新执行。

## 验证

- `test/daemon-immediate-failure-stop.test.mjs`：失败返回后立即调用 owned stop、根退出后遗留子进程、未知回执和成功服务保留。
- `test/runtime-execution-lifecycle.test.mjs`：隔离的真实 Windows CLI 发失败事件后，其根进程和 detached 子进程都退出，后台计数停止；根退出码 0 且末尾失败 JSON 没有换行也不能遗留子进程。
- `test/runtime-process*.test.mjs`：默认非零根清理、成功服务保留、后续原 Job 精确停止、新 cleanup 回执及 owner 退出边界。
- `test/runtime-group.test.mjs`、`test/dsh-current-*.test.mjs`：群成员清理和 DSH 本次 session 的停止关联。

所有测试使用隔离的本机进程或协议 fixture，没有调用真实模型或生产设备。正式 daemon 的安装、发布与线上可用性仍需单独验收。
