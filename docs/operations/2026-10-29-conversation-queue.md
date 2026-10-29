# 当前基线的消息队列管理

本轮从 `8e4f37a` 接入，复用已有 pending actions 和按员工串行 scheduler。没有第二套消息调度器，也没有为了入队发出停止动作。

## 网页行为

- Bot 主聊天与普通会话都可在当前回答期间继续提交文本和图片，POST 确认后恢复输入；“停止”与“加入队列”同时可见。
- 待发列表显示数量、文本和附件数量，可暂停、恢复、移除尚未 ACK 的消息；暂停保留待发内容，不停止正在执行的动作。
- ACK 已开始的消息不能移除；冲突保留队列并显示错误。已移除消息保留聊天记录并标为“已移出待发”。
- 切换会话、工作区或账号后，旧请求不能覆盖当前队列。切换加载失败时仍释放原操作的 busy 状态。
- 入队响应不能用新的 pending action 替换界面上的当前执行，执行状态继续由会话 detail 投影决定。

## 后端合同

会话 detail 的 `queue` 为 `{paused,count,items}`，包含所有未 ACK 的 pending 消息。首条在设备离线时也属于待发；ACK 后从队列移出。

管理入口为 `POST /api/conversations/:id/queue/pause`、`POST /queue/resume`、`DELETE /queue/:actionId`。它们沿用会话可见性及员工、工作区身份权限。

按用户后续要求，队列默认开启，失败或过期不会自动锁住后续待发。手动暂停只暂缓待发；提交新消息、点击恢复或恢复 Bot 会重新开启。入队等待不消耗执行期限，ACK 后才开始计算原有执行预算。ACK 继续校验员工占位、配置版本、设备和原生 Profile，不通过时不能启动新一轮。

暂停和领取竞争时，`CONVERSATION_QUEUE_PAUSED`、`CONVERSATION_QUEUE_BLOCKED` 等临时 admission 冲突保留为可重试，不能写入永久 blocked。真实 daemon 保留后端错误 code，避免内存测试可恢复、HTTP 实际传输却丢失原因。

Bot 恢复时，仅给同一工作区、员工、设备、Profile、revision 和权限快照仍完全一致的未 ACK 消息更新 controlEpoch，不覆盖已执行动作或旧配置。compact ACK 携带最新执行输入，使已经 poll 的客户端也使用当前授权；不重复传送图片。仍明确暂停或未验证的 Bot 继续受原控制权限约束。

队列投影与终态回调必须同时匹配真实工作区、员工、会话和 user message；其他工作区携带相同会话字符串的动作不能暂停本队列。附件列表仅返回 name、mimeType、size 元数据，原始图片保留于数据库与执行动作，避免轮询反复传送整个待发队列的图片。

## 验证边界

`backend/conversation-queue*.test.mjs` 使用真实 SQLite repository 与内存 HTTP，覆盖 FIFO、权限、暂停、失败、移除、重开数据库及附件投影。`frontend/src/conversation-queue.test.mjs` 执行实际 Vue 组件和 App 操作函数，覆盖连续发送入口、当前执行保留、切会话竞态和 ACK 冲突。

本轮为源码及隔离测试，没有部署网页、升级正式 daemon、调用真实模型或使用 Computer Use。旧基线的模型测试不能作为本次上线验收。
