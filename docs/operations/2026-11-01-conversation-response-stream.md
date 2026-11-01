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

根会话组合回归 150/150、lint 440 个源文件和生产构建通过。手机全源测试 630 项：628 通过、2 环境跳过；实际安装 APK 的隔离烟测 28/28，通过正文更新、终态清除旧占位、草稿保留、覆盖升级及头像附件回归。

## 实际发布

源码 `45209a6b36099ca6239ed81ac53c25bdf2485d1d` 已推送并核对远端；API、网页、CLI 和手机管理端 code25 已发布。

- API 增量 3 文件，PID 4020、原端口 46197，保留其他 22 个已发布增量文件及正式数据；本机/公网健康均 200。
- 网页入口 `assets/index-BN_tLowp.js`，index SHA256 `f4e54c33c74f8cc468dd3a6288b8bc54883f6c6408cf260d0a4ff1cfc5b4ce6a`，静态文件、身份与群聊入口验收通过。
- CLI 原生安装仅覆盖 5 个运行时文件，前一轮 DSH 收敛保留，官方 updater complete、原生启动退出 0。PID 42960，build `21bb84a19365da74836cefaefdefe75f66e20135280960378bf70b2fc4a8cf5c`；正式包 706230 字节，SHA256 `bfbf7751f034cf716c603e2666b3ac01d55b2fcce839dd461b2d86ce4f2956d1`。API 切换阶段观测过临时 503，原记录保留；最终重新核对 ready=200/true、connected、目标 build 一致。
- Android 管理端同包名、原签名、`0.7.6-mobile-streaming`/code25，APK 847371 字节，SHA256 `54463c09fb3071f18dec6f55931c643af04b615595d14f6fab7c5895022859b9`。下载索引与公网文件验收通过；原 code24 与 18 个 Agent/Updater 版本项保留。

统一发布回执：`D:\Ziwei-Local\artifacts\stream-45209a6-20261101\FINAL-PUBLICATION.json`。CLI 安装回执：`D:\AINavtie\ops\ziwei\body-stream-release-20261101\INSTALL-ACCEPTANCE.json`。

源码验证、真实部署、模拟器 APK 与用户手机分别验收。本轮没有调用真实模型或重放旧业务，用户真机与真实员工/模型流式会话尚未验收；不能把解析器 fixture 或隔离 APK 验证写成真实模型对话通过。
