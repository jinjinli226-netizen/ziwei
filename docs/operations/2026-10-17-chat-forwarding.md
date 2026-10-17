# 网页与安卓共用聊天记录转发、已读接口

用户在“紫薇 App 设计与开发”会话授权主控与 App 会话协作，实现类似微信的聊天列表及把聊天记录转给另一位员工。主控负责共用 API、网页入口和主站发布；App 会话负责 `mobile-manager` 与 APK，不用其较早的后端基线覆盖主站。

## 已发布版本

- 后端产品：`069b128c29248ec72094019e76bf49dc0b2964d5`，先推 `codex/v2-20261014-release`，于 **2026-10-17 12:22:53（Asia/Shanghai）** 发布。
- 网页产品：`ed4991036a46a855f091f2913b959dc4a3c95cf8`，先推同一分支，于 **12:24:13** 独立发布静态资源。
- 当前主站目录：`/opt/ziwei/releases/chat-records-069b128c2924-7a6f44a8/v2`，发布时 API MainPID `345037`。
- 上一目录：`/opt/ziwei/releases/mobile-runs-1757bd819099-51e2a255-bf145367/v2`。
- 前端入口：`assets/index-B7aTGrd_.js`；首页 SHA-256 `d24b9bb9a2f955f2d6153d427372a4eb60197b5fc10fb7a30769f33be164d71e`。
- Windows 官方包继续 `5db7d834deaf3524adfada59a434bc764fda750a`，无需因本功能更新客户端。

后端以现场复合版本为底，仅替换 app、repository、db 及新增 conversation-forwarding、conversation-read-state 五个运行文件。保留 `51e2a25` 的目录修复、`1757bd8` 的移动 runs 改进、原生封存文件与现场其他补丁。网页发布验证公网首页、全部新增资源及元数据，API、客户端、中控、Nginx 与受保护配置保持。

## 使用与接口

网页消息提供“转发”“多选”；可合并文字与图片，选择同工作区已有员工，默认“仅发送记录”。接收消息展示可展开的聊天记录卡，保留原发送者、时间、内容和图片，成功后可“查看接收聊天”。该入口刷新目标员工的列表并选中实际接收会话。

### 转发

`POST /api/conversations/:sourceId/forwards`

```json
{
  "messageIds": ["原消息 ID"],
  "targetEmployeeId": "目标员工 ID",
  "mode": "reference",
  "note": "可省略的附言",
  "clientRequestId": "调用方稳定请求标识"
}
```

`reference` 只保存记录，不启动执行、不占用 Bot，即使目标忙碌或设备离线也可接收。用户明确选择 `execute` 才走原执行准入和派发。员工私有可见范围、工作区身份和封存限制不放宽。Bot 使用已存在的主聊天，不借转发创建 Profile/HOME；普通员工复用最近活跃聊天，没有时创建普通会话。

服务器从真实消息 ID 生成快照，按原时间及消息 rowid 排序。每次最多20条记录、20张图片、图片实际解码总量10 MiB、文字100000字符、附言4000字符。空附言省略；递归转发展开为可兼容的内容和附件，不嵌套无限快照。旧客户端可读取降级文字/图片；原历史文本不是新用户指令。

响应含 `forward`、持久化 `message`、可选 `execution`、`duplicate`。快照 `message.forward` 的 schemaVersion 为1，包含 source、messages、mode、可选 note；messages 含 sourceMessageId、role、senderName、createdAt、content、attachments。

成功请求以同一 key 重试时返回原消息/原执行，不因目标后来忙碌、暂停或主聊变化再次派发；仍重新验证当前访问权限。同 key 改内容返回 `FORWARD_REQUEST_CONFLICT`，无法恢复旧回执返回 `FORWARD_RECEIPT_INVALID`，都不新派任务。普通消息接口拒绝用户提交伪造 forward 元数据。执行准入失败时，事务及待发事件一起回滚。

客户端遇到结果不明时保留原请求内容和 key，关闭弹窗、切页及后续错误均不能生成另一项执行；获得对应有效回执才确认完成。首次明确拒绝且没有未知结果的请求可修改后再发。

### 轻量聊天列表与已读

- `GET /api/workspaces/:slug/chats` 返回 `{chats, unreadCount}`。每项含 conversationId、employeeId、employee、title、preview、updatedAt、unreadCount、latestMessageId、messageCount；只取可见员工的有效主聊天。头像为鉴权同源地址，摘要最多180字符，不装载全部聊天、图片字节或执行历史。
- `POST /api/conversations/:id/read`，body 为 `{messageId}`。返回 conversationId、lastReadMessageId、unreadCount。按用户保存单调前进的内部 rowid 游标，不更新聊天排序、消息或执行；不能用别的聊天消息标已读。
- 自己发送的消息不计未读，历史缺少作者的 user 消息不追算；收到的员工/system 消息和其他已知用户消息按游标计算。网页只提交前台实际可见消息，换员工/账号/工作区隔离迟到响应，失败后可重试。

## 数据迁移、验收与边界

迁移只增加 `conversation_messages.sender_user_id`、`forward_json` 两个 nullable TEXT 列、`conversation_reads` 表及 `idx_conversation_messages_chat(conversation_id, created_at)` 非唯一索引。复用已有 management_requests 保存去重，不存在 conversation_forwards 新表。没有重建原表、VACUUM、清理消息或重排原 rowid。

正式发布前，对生产 SQLite 副本运行迁移两次，校验幂等、列/主键/外键/索引结构以及原表、原列数据摘要。停 API 后生成新备份，对正式库迁移并再验证原数据和消息 rowid 均保留。发布成功不意味着已经演练过一次真实生产回退。

后端转发19、已读4、移动读取8、runs4，共35项相关纯测试通过；另有更广的相关57项纯回归通过。网页转发/已读最终五文件34项通过，包含最后补入的目标会话列表刷新2项；此前目录与主聊天76项回归、lint 和构建也通过。不将不同批次通过数相加当成一次全量测试。

```sh
node --test frontend/src/conversation-forward.test.mjs frontend/src/conversation-forward-card.test.mjs frontend/src/conversation-forward-api.test.mjs frontend/src/conversation-read.test.mjs frontend/src/conversation-read-lifecycle.test.mjs
```

实际浏览器在隔离数据中完成“2条文字＋图片合并转发 → 普通员工接收 → 展开原发送者、时间、文字和图片 → 查看接收聊天并刷新列表”。默认参考模式没有执行派发。证据截图在主工作目录 `output/verification/chat-forward-preview-20261017.jpg`；未向真实工作员工发送业务记录，也未用真实 provider 执行本轮转发测试。显式执行、回执丢失与去重通过真实内存数据库和原执行准入的测试验证，不能描述为生产模型任务验收。

## 发布证据与回退

- API 阶段：`/opt/ziwei-staging/chat-records-069b128c2924-d3ec0604`。
- API源清单：`/opt/ziwei-staging/chat-records-069b128c2924-d3ec0604/manifest.json`，SHA-256 `e6b84134703183a541bf70327bf602336a8cbf0a9b76c318fa1a4da67c9dc89b`。
- API发布记录：`/opt/ziwei/releases/chat-records-069b128c2924-7a6f44a8/v2/CHAT_RELEASE.json`，SHA-256 `c13d7a45fb084fbbd8cc9ed66d695d9eccf1dbde2be9cbd04d0796f785d5f65e`。
- 停服后迁移前数据库备份：`/opt/ziwei-staging/chat-records-069b128c2924-d3ec0604/before-migration.sqlite`，权限600。
- 前端阶段：`/opt/ziwei-staging/chat-web-ed4991036a46-237e4579`。
- 前端备份：`/opt/ziwei-staging/backups/frontend-directory-ed4991036a46-20261017T042413Z-100d251c`。
- 本机摘要：`.local/chat-forward-release/publish-result.json` 与 `frontend-result.json`。随后只读复核确认同一 API PID active/running、无 systemd Job，公网健康200；源清单和发布元数据哈希如上。发布脚本、数据库及认证资料留在本机/服务器，不提交仓库。

若需撤回，先确认当前目录/发布版本与本记录匹配，避免覆盖后续发布。恢复上一代码目录及对应前端首页/版本记录，保留当前业务数据库、两个新增列、新表、索引、所有新消息、已读数据和 management_requests 幂等记录；保留旧哈希静态资源。不要以旧数据库备份覆盖发布后产生的数据，不 DROP 新表/列或 VACUUM，也不要回退 Windows 包或中控。发布脚本的自动回退只用于当次已确认失败，没有独立 rollback 命令，不得重放已使用的 stage。后续撤回必须重新核对进程及文件树；执行服务操作前后仍核实所属 PID、启动身份与 systemd Job，结果未知时先查状态，不盲目重放 stop/start。旧代码能读降级转发文本和普通附件，但没有新转发/已读 API；回退代码后新 App 的该功能需等接口恢复。

本机验收服务通过端口中心登记260/9203，验收后已停止并释放；项目检查无冲突、无未登记监听。

## 安卓后续发布已完成

安卓 App `0.2.0-internal` / versionCode7 已由独立 App 会话于2026-10-17 13:13:14（Asia/Shanghai）发布；没有再次部署主站。主控通过匿名 GitHub API 独立复核 Release 非草稿、标为 prerelease，APK 大小及 GitHub 记录的 SHA-256 与下列值一致。

- 产品源码：`2ce1383a1cbe46737ea53cb56b9960c8f7cfccba`，先推 `codex/android-manager`。
- 发布页：[android-manager-v0.2.0-internal](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.2.0-internal)。
- [直接下载 APK](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.2.0-internal/ziwei-manager-0.2.0-internal-code7.apk)，706114字节，SHA-256 `5a4b2a4a74b268a60dfb78c898beb31290881ba98bbc7cfec8c14a8c307059ff`。
- 沿用证书 SHA-256 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`，可覆盖安装。旧 `b7b…` 候选未公开。
- 安卓详细验收文档提交 `9096f7d` 位于该分支 `docs/operations/2026-10-17-android-chat-forwarding.md`；不能假定它已合并到主控分支。

App 会话报告193项单元、35项后端合同/迁移/移动读取、50组隔离浏览器流程通过。原AVD最终签名包覆盖安装保留登录；两位员工历史正文跨轮询稳定，800ms长按松手后菜单保持，后续新触摸可立即多选、选择目标并看到默认 reference 确认，模型能力/设备摘要读取与返回通过。此次补修兼容click误点遮罩，保留500ms长按与滚动取消。

App 已对匿名下载的完整 APK 回读校验。真实账号验收仅读取及更新自身已读游标，没有提交真实转发、执行、消息、配置或设备命令；模拟器选1条记录，完整多条图文转发/重试在隔离真实Express与内存数据库完成。不能称为实体手机或生产模型执行验收。临时SDK/ADB已停止，261–265端口登记释放，AVD数据/登录保留。
