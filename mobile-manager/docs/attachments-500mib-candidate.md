# 500 MiB 附件手机版源码候选

2026-11-01（Asia/Shanghai）。本轮与主线程的后端、网页和设备实现合并验收。后续已原签名构建 code24 并在原 QA AVD 覆盖安装，18 项实际 APK 烟测通过，尚未上传正式下载入口；详见[code24 产物与验收](../../docs/mobile/2026-11-01-attachments-code24.md)。此前 code23 只包含头像同步，不能作为本功能已上线的证据。

## 合同与源码

- `web/conversation-attachment-policy.js` 由构建脚本从 `src/conversation-attachment-policy.mjs` 自动同步，单文件及单消息合计 `524288000` bytes，最多 20 个附件，分块 `8388608` bytes。JSON 上限仍为 16 MiB；头像单独保留 2 MiB，汇报旧小图片路径保留原限制。
- `web/attachment-upload.js`、`controller.js`、`api.js`：选择时仅保留 File/Blob 与元数据；稳定 Idempotency-Key 创建上传，查询原 uploadId 的 offset，按 Blob.slice 分块，complete 返回五字段 ref；普通聊天发送和指纹只含 ref，不把 500 MiB 编成 JSON/base64。选文件本身不派活，失败需显式重试。
- HTTP：`POST /api/conversations/:id/attachments/uploads {name,mimeType,size}`、`GET .../uploads/:uploadId`、`PUT .../uploads/:uploadId?offset=n`（octet-stream）、`POST .../uploads/:uploadId/complete {}`。消息附件使用 `{attachmentId,name,mimeType,size,sha256}`，历史旧小型 base64 继续读取。
- `native-identity.js`、`IdentityBridge/IdentitySession`、`AttachmentTransferRules`：单个不超过 8 MiB 的 Blob 分片可转有限 base64 过桥，Java 解码后按原认证 HTTP 传输；不把整文件塞进桥。仅创建上传可带限长 Idempotency-Key，不开放任意头/URL，原账号和文档代次隔离保留。
- `MainActivity`：普通文件入口允许用户选择 PDF/ZIP 等内容 URI；头像及旧图片入口仍按 accept 类型筛图。保存走用户显式选择的系统文档位置，原生 HTTPS 每次 64 KiB 写入，文件字节不返回 JS。失败或取消清理本次未完成输出。
- `web/view.js`：文件卡片、进度、失败重试、授权下载；仅不超过 10 MiB 的已支持 raster 提供图片预览，大图只下载。聊天头与头像规则不改。
- `workspace-groups.js/view`：文件上传到本群冻结成员的已有 conversation，发送额外提供 `attachmentSourceConversationId`，服务端给每个成员 clone 元数据。File/草稿按账号、工作区和群保存在内存；未知发送按原 messageId 查询确认后再清理，不自动重发。群附件需同时提供文字说明，沿用服务端合同。
- `forwarding.js`：仍只传原消息 ID，附件引用合计按 500 MiB/20 个校验，不读或拷贝文件内容。
- 与主线程明确协作修改 `backend/mixed-group-mobile.mjs`：保留可见附件的 attachmentId、conversationId、name、mimeType、size、sha256、url、downloadUrl。未并改由其他 agent 负责的 `mixed-group-store.mjs`。

## 验证

- `ZIWEI_JAVA_HOME=D:/Ziwei/tools/jdk-17.0.20.1+1 node --test mobile-manager/test/*.test.mjs`：621/621，通过，无 skip；完整日志 `.local/mobile-attachment-full-tests.log`。
- Java 实际实现 51 项边界检查：`-Xmx96m` 下流过 `524288000` bytes，最大读写缓冲 65536 bytes；8 MiB 解码、超限、严格路径、账号改变、通用选文件类型、轮转日志均通过。
- Android 19 个源码文件用 SDK35/JDK17 全量编译通过；原生既有规则 362 项、构建安全 17/17 通过。
- 新真实 Chromium 专项 `test/browser-attachment-check.mjs`：原 Express/session/role/SQLite/对象存储，无监听服务。9 MiB 文件的首个 8 MiB 块在服务器提交后丢回执；显式重试查询 offset，再上传余 1 MiB，未重复首块。普通聊天 JSON 356 bytes、小图消息 316 bytes、群消息 423 bytes。
- 相同专项验证授权下载全部 9 MiB 与原 SHA 一致、小图与 App 内预览 decode、声明 500 MiB+1 在切片/联网前拒绝，及 320px 群进度/下载卡片。40 次请求、6 张截图，结果 `.local/mobile-attachment-qa/result.json`；下载使用受控保存 sink，不能冒充 Chrome 保存 UI 或 Android SAF 已实测。
- 旧 `test/browser-check.mjs` 已改用真实对象存储分块上传和 ref 消息，旧导航/图片/管理回归通过。群真实仓库闭环包括原字节上传、成员 refs、授权原字节下载；移动投影回归 5/5。
- lint 435 个源码文件通过，diff 检查通过。

## 待整链验收与已知边界

- code24 准确包、原签名覆盖安装、实际 APK 聊天和附件桥接烟测已完成，可交主线程统一归并/推送及发布，不以真实手机是否连接作为阻塞。实际系统保存窗口打开/取消已验；认证后的原生 HTTP 上传/原字节保存、断网后续传及完整 500 MiB 手机网络整链仍需单独验收。19 个 Java 文件编译和 96 MiB 堆下的 500 MiB 流测试不替代后者。
- 未在真实账号/真机完成 500 MiB 上传、系统保存位置、断网及后台流程；不宣称“500 MiB 已对用户可用”。源码提交/推送、APK 版本与发布由主线程整链验收后决定。
- File 与上传 WeakMap 仅在当前 App 进程内；退出进程后需重新选文件，不宣称跨进程自动恢复大文件草稿。
- 群移动历史仍沿用每条最多展示 3 个附件及 attachmentCount 的投影边界，其余文件保留完整群记录；不是手机全 20 个历史附件均已有入口。主线程可按产品决定后续分页。
- 主线程已自行验收的 Web/API/CLI/设备状态应分别记录，本记录只代表上述手机版源码与隔离验证。
