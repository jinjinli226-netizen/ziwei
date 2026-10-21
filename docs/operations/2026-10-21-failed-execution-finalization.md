# 失败执行自动收尾

更新：2026-10-21。本文记录候选源码与自动测试；正式部署、官方客户端下载版本和 Windows 现场恢复由发布主任务另行核验，不能据此认定已经上线或已经恢复某位员工。

## 用户可见行为

- 普通失败显示“失败”。新产生且执行结果未确认的 Hermes Bot 失败，由服务端自动建立独立收尾记录：本轮保持失败，运行电脑自动清理与归档，确认后恢复接收新任务。
- 等待电脑处理时，网页显示“失败，正在自动收尾”；电脑离线时显示“失败，等待电脑连接”。用户可以保留下一条草稿，原电脑归档确认前不派发新执行。
- 历史已经失败、仍占用当前 Bot 的记录，在主聊天和运行记录提供“结束本次执行”按钮。请求绑定原执行 ID、当前配置版本和控制版本，使用稳定幂等标识；随后读回服务器状态，不把 HTTP 成功当作原执行成功。
- 归档后显示“失败 · 已结束本次执行”。原始失败、聊天、业务结果及退出证据保持原样；未知业务不会变成成功，不会自动重跑旧任务，也不要求用户手动核对电脑进程。

## 实现边界

| 层 | 入口 | 约束 |
| --- | --- | --- |
| 启动前网络故障 | `src/runtime-launch-evidence.mjs`、`src/local-action.mjs`、`src/daemon.mjs` | 最终 Bot 启动准入请求超时、断网、异常响应或取消，只有真正经过宿主 `beforeSpawn` 边界的内部凭证才能证明未启动。请求内容自报或普通异常不能伪造此证明。已注册监督或可能已启动的进程仍走原进程树清理。 |
| 服务端收尾 | `backend/bot-failure-finalization.mjs`、`src/bot-failure-finalization-contract.mjs` | 独立记录 `awaiting_client` / `client_archived`，保留原失败；原电脑确认前，新执行明确拒绝准入。工作区、员工、设备、Profile、版本、原失败内容和配对凭证均需匹配。 |
| 原电脑归档 | `src/client-failed-action-finalization.mjs`、`daemon/ziwei_user.mjs` | 处理原电脑的精确收尾请求和本地记录；不重新执行原业务，不清空其它员工的任务。客户端维护与重启可继续处理同一收尾。 |
| 网页 | `frontend/src/bot-failure-finalization.mjs`、`frontend/src/App.vue`、`frontend/src/components/BotMainChat.vue`、`frontend/src/bot-workbench.js` | 以服务端顶层独立记录展示状态，拒绝把结果字段或进度事件冒充归档确认。轮询读回电脑归档状态，保留草稿，拒绝跨员工晚响应覆盖。 |

网页接口为 `GET/POST /api/workspaces/:slug/bots/:id/failure-finalization`。POST 包含 `expectedActionId`、`expectedRevision`、`expectedControlEpoch`、`acknowledgeUncertain: true`、`idempotencyKey`。这是结束失败执行的独立处置，不是补造模型回复或进程退出证据。

Android 管理 App 在独立分支。服务端保留并投射收尾字段，不代表旧 APK 已识别这些字段；本次网页适配不能替代 Android UI 验收。

## 验证记录

- 启动前准入、网络失败、取消及已有监督边界：68 项通过，0 失败、0 跳过。命令如下。
- 网页收尾及相关状态回归：76 项通过，0 失败、0 跳过；其中新增收尾测试 11 项，覆盖实际 App 请求函数、组件状态与 Enter 发送、幂等请求、丢响应不重试、跨员工响应隔离、归档不伪造成功、客户端确认后恢复发送。
- 网页分页、主聊天、草稿、Creator 和工作台读取回归：75 项通过，0 失败、0 跳过。与上一组存在重复，不能相加为独立测试总数。
- 后端定向 151 项、客户端恢复 126 项分别由对应实现代理报告通过，发布主任务继续复核集成结果；这些数字与上述组别也不合并计数。
- `node scripts/lint.mjs` 通过，236 个源码文件；`git diff --check` 通过；`npm run build` 通过，无本地监听服务。

```sh
node --test --test-concurrency=1 \
  test/bot-start-network-prelaunch.test.mjs \
  test/bot-admission-prelaunch.test.mjs \
  test/daemon-runtime-failure-evidence.test.mjs \
  test/daemon-admission-rejection.test.mjs

node --test --test-concurrency=1 \
  frontend/src/bot-failure-finalization.test.mjs \
  frontend/src/bot-api.test.mjs \
  frontend/src/bot-stop-recovery.test.mjs \
  frontend/src/bot-workbench.test.mjs \
  frontend/src/historical-prelaunch-recovery.test.mjs \
  frontend/src/operator-force-abandon-recovery.test.mjs \
  frontend/src/conversation-execution-state.test.mjs
```

上述测试使用模拟网络、组件计算与内存服务端请求，不调用真实模型、不操作手机、不重放员工业务。正式环境仍需分别核验：GitHub 源码、服务端部署、客户端下载内容、原电脑安装版本、客户端归档回执及后续正常准入。
