# DSH 原生会话执行合同

来源：2026-10-29 当前发布基线的增量接入；原生 HTTP / remote.mux 形状沿用此前对本机 DSH 0.2.1 session controller / agent loop 的核对。本轮只跑内存协议与隔离测试，不调用付费模型、不启动常驻 Bot。

## 身份与入口

- `src/local-action.mjs` 在正常执行授权、工作目录校验后，从 `profile` / `runtimeProfile` / `runtime_profile` 或显式 Bot 标识选择真实 Bot；不回退员工显示名称。
- DSH endpoint 来自本机 `ZIWEI_DSH_BASE_URL` 或 executor 的本机配置；动作 payload 的 endpoint 不生效。
- DSH 保留自身 provider、模型、MCP 和插件配置。该分支不准备 Hermes owned Profile、provider 凭据或 Codex / Hermes 专用 MCP，也不改其现有实现。
- 每次请求保留当前会话绑定，调用 `session/create` 或续用指定 session，再通过 `session/prompt` 的 `requestId` 关联原生事件。断线只重建 follow，不重复提交 prompt。

## 独立的 session 终态

DSH 是常驻 Bot 中的一次 HTTP / WS session turn。本机没有创建新的 owned Bot 进程；不写 PID 或 `processExit`，不通过终止共享 Bot 来取消任务。

`src/dsh-session-evidence.mjs` 用 WeakMap 保存本进程能力。只有 owned adapter 在原生 user/message 的 `source.rpcId` 匹配本次 requestId 后，收到同一 turn 的 `turn/end`，才能确认 session 终态。payload、普通 callback 对象、序列化 result 和 error 字段都不能制造这种能力。

`src/daemon.mjs` 先完成现有 admission、预算和 started 持久化，再进入独立 DSH 分支。公开 action 回执为：

```json
{
  "result": {
    "output": "实际回答",
    "sessionId": "实际 session id",
    "sessionExit": {
      "schemaVersion": 1,
      "source": "dsh-native-session",
      "actionId": "原 action id",
      "employeeId": "原 employee id",
      "conversationId": "原 conversation id",
      "botName": "真实 Bot 标识",
      "sessionId": "实际 session id",
      "requestId": "本次 request id",
      "turn": 2,
      "reason": "completed",
      "terminalConfirmed": true
    }
  }
}
```

`reason` 如 `error`、`aborted`、`max-tokens` 表示已确认该 turn 结束；动作是否成功仍由 `status` / `code` 表达。session 结束不等于共享 Bot 进程退出，也不代表工具所产生的影响被撤销。

## 取消、预算与恢复

- 保留已有 hard / 显式 idle 预算。取消只请求一次原生 `session/cancel`，继续 follow；cancel ACK、订阅 end、断线均不能确认 turn 已结束。
- 尚未收到本次 request echo 时不取消正在运行的前一 turn；待目标 echo 后才请求本 session 取消，未能确认则保留未知状态。
- 缺少匹配终态时返回 `EXECUTION_UNCERTAIN`，保留 started / quarantine 和原动作身份；重启不能重跑。晚到的同一次可信终态可解除原动作隔离并保存失败回执。
- 已完成 session 的后续 stop control 只说明有可恢复的原动作回执；`stopConfirmed` 仍由投递层核对目标回执是否已被服务端确认。

## 后端与群聊边界

`backend/dsh-adapter.mjs` 只提供原生 transport，HTTP route 必须先核对当前工作区的可见员工与真实 Bot 绑定。Routine cancel 使用保存的真实 session id；返回的是取消请求 ACK。

`src/dsh-group-runtime.mjs` 是原生群成员协议 primitive，保留独立成员 session、@ 选择和部分失败回执。本轮不增加 `dsh.group.execute` 调度旁路；正式群执行需由现有 scheduler 将各个可见绑定成员排为员工动作，并逐个遵守相同会话合同。

DSH 服务端 session 投影和过期 / stop 回执恢复必须单独理解 `sessionExit`；不能把它改写为 `processExit`，也不能放宽现有 Codex / Hermes 进程树条件。

## 验证入口

- `test/dsh-current-runtime.test.mjs`、`test/fixtures/dsh-protocol.mjs`：原生 envelope、流式帧、终态关联、工具事件、断线恢复且不重发。
- `test/dsh-current-supervision.test.mjs`：持久去重、正常 / 失败、确认取消、ACK-only 隔离、晚到终态、伪造证据、hard timeout、stop control。
- `test/dsh-current-local-action.test.mjs`：真实 Bot 与本机 endpoint、专用运行时隔离、本机 executor 到 dispatcher。
- `test/dsh-current-group.test.mjs`、`backend/dsh-current-adapter.test.mjs`：群成员 session / 部分失败、原生错误、RPC 关联和 routine 取消。
