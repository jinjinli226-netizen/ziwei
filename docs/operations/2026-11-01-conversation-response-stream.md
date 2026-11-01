# 聊天正文流式输出

2026-11-01，用户反馈主聊天只显示“生成结果 / CLI 输出”。本轮接通运行时公开正文、设备可靠投递、服务端读投影和网页/手机消息区。

## 行为

- DSH、Hermes 按原生公开正文增量更新；Codex 按 CLI 实际提供的公开 assistant 消息快照更新，不伪造 token 或打字动画。
- 正文持续更新同一条 assistant 预览；工具阶段与公开摘要单独显示。终态由正式消息接替，不重复写入聊天历史。
- 主聊天和混合群共用正文合同；断线后读取最新快照恢复，不要求客户端收到所有碎片。新动作不会继承旧动作的正文。
- 网页沿用 WS/SSE 通知和合并读取；手机复用唯一调度器，活跃聊天每秒读快照，完整工作区保持 8 秒刷新。
- 保留中文输入法 500ms 保护、40px 底部跟随和 120px“跳至最新”。临时正文不推进已读，也不作为正式转发目标。

## 合同与入口

原生适配通过 `onStage({stage:'response',text})` 发布累计公开正文。dispatcher 将其转换为 `action.response`；设备投递正文快照为：

```json
{"schemaVersion":1,"responseId":"action_id:assistant","sequence":1,"phase":"streaming","text":"当前公开正文","format":"markdown"}
```

服务端按动作原绑定接收，`execution.stream` 和群 `runs[].stream` 独立下发最新序号；后续工具事件不会挤掉正文。原始 stdout、工具参数/结果及隐藏推理不作为正文，思考摘要只接受明确的公开 summary。正文不进入普通 daemon 日志和 audit 摘要。

设备首段立即发送，后续约 100ms 合并；背压时保留在途快照及最新待发快照。在途 eventId 的内容不变，持久序号在重启后继续。流式预览上限 1MiB UTF-8，最终回答仍以正式 result 为准；进度 POST 停滞不会把最终结果卡死。

- 运行时：`src/runtime-adapters.mjs`、`src/dsh-runtime.mjs`、`src/daemon.mjs`。
- 投递：`src/daemon-action-delivery.mjs`、`daemon/ziwei_user.mjs`。
- 服务端：`backend/action-response-stream.mjs`、`backend/repository.mjs`、`backend/mixed-group-store.mjs`。
- 网页：`frontend/src/conversation-stream.js`、`BotMainChat.vue`、`MixedGroupPanel.vue`。
- 手机：`mobile-manager/web/chat-stream.js`、`controller.js`、消息与群渲染模块。

## 验证边界

`test/conversation-response-chain.test.mjs` 通过真实 parser、dispatcher、durable delivery、内存 repository 和网页消息投影验证：任务终态之前出现正文、快照连续更新、最终只保留一条正式回答。各层另覆盖乱序/重复、千次背压、重启序号、维护暂停、Markdown 转义、作用域切换、跟随滚动与终态替换。

源码验证与真实部署、手机安装分开记录。本轮没有调用真实模型或重放旧业务，不能把解析器 fixture 验证写成某次真实模型流式对话验收。
