# 500 MiB 聊天附件实施计划

**Goal:** 网页、手机及 Codex/Hermes/DSH 可传输、保存和回传每条合计 500 MiB 的实际文件，JSON 和投递日志只保存引用。

**Architecture:** 复用 SHA256 对象存储，按 8 MiB 分块接收，完成后返回受会话/action 约束的附件引用。旧小型 inline 图片继续读取；模型原生图像输入限制与文件传输分开，大文件以本机路径供工具读取。JSON parser 保持 16 MiB。

**Tech Stack:** Node streams、SQLite metadata、现有 Express/device auth、Vue、Android WebView。

## 统一合同

- `MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_TOTAL_BYTES = 524288000`；20 个文件；`ATTACHMENT_CHUNK_BYTES = 8388608`。
- 浏览器前缀 `/api/conversations/:id/attachments`；设备前缀 `/a2a/v1/actions/:id/attachments`。
- `POST /uploads {name,mimeType,size}`，稳定 `Idempotency-Key`；返回 `uploadId,offset,chunkSize`。
- `GET /uploads/:uploadId` 查询 offset；`PUT /uploads/:uploadId?offset=n` 接收二进制块；`POST /uploads/:uploadId/complete {}` 完成。
- 完成引用 `{attachmentId,name,mimeType,size,sha256}`；`GET /:attachmentId` 认证二进制下载，令牌不出现在 URL。
- 输入、结果、历史、转发保存引用；设备仅下载本 action 的输入或产物，上传块活动沿既有 action lease 机制续期。

## 实施与验证

1. **Backend/shared policy**：`src/conversation-attachment-policy.mjs`、`backend/storage.mjs`、新 attachment store/routes、`backend/db.mjs`、`backend/repository.mjs`、`backend/app.mjs` 及 thread/mobile 投影。先验证 chunk、重试创建、断流、跨会话/action 拒绝和真实文件流，保持 SQLite 不含大 base64。
2. **CLI/runtime**：`src/conversation-attachment-transfer.mjs`、`src/local-action.mjs`、`src/conversation-image-artifacts.mjs`、`src/daemon-action-delivery.mjs`。输入流式物化；产物 manifest descriptor 上传；持久进度与引用恢复不重跑模型；三运行时大文件只给文件路径。
3. **Web**：新 browser uploader、`frontend/src/api.js`、`App.vue`、`BotMainChat.vue`、转发/预览。只读取 Blob 分片，保存稳定上传请求标识，进度可见，失败沿原上传继续。组件和 uploader 测试必须覆盖丢失创建/块/完成响应。
4. **Mobile**：独立手机版会话修改 `mobile-manager/**`，沿同一协议，检查 native identity 的分块二进制桥接及下载落盘，保留头像 2 MiB 规则。
5. **整链验收与发布**：隔离端口按 port-manager 登记；实际 500 MiB 文件上传/下载 SHA 一致，500 MiB+1 与总量边界拒绝，断传重试无重复消息/模型动作，内存有界，JSON 很小。再推源码并按增量发布 API/Web/CLI/手机，逐层核验，不用本方案代表上线。

当前原样图 `action_80c02997-18f5-4d04-932f-b0197585a2da` 已完成独立原结果恢复，后续容量测试使用隔离样本，不重用该业务 action。
