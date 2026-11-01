# 500 MiB 聊天附件

2026-11-01。用户将附件上限调整为500MB，采用500MiB（524288000字节）文件口径，单文件及单条消息合计同上，最多20个附件。上传使用8MiB二进制分块；JSON parser保持16MiB，消息、action、结果和投递journal只保存文件描述或附件引用。初始化幂等键、分块offset及完成回执可恢复同一次上传，不重跑模型。

## 实现

- 统一限额：`src/conversation-attachment-policy.mjs`。
- 存储与入口：`backend/storage.mjs`、`backend/conversation-attachment-store.mjs`、`backend/conversation-attachment-routes.mjs`；metadata/upload表增量初始化，不替换正式数据库。
- 浏览器前缀 `/api/conversations/:id/attachments`，设备前缀 `/a2a/v1/actions/:id/attachments`；创建、查询、PUT分块、完成及认证二进制下载。引用为 `{attachmentId,name,mimeType,size,sha256}`，不公开storageKey或令牌。
- 设备：`src/conversation-attachment-transfer.mjs`、`src/local-action.mjs`、`src/conversation-image-artifacts.mjs`、`src/daemon-action-delivery.mjs`。产物manifest转本机描述，再上传refs；journal保留原描述与检查点。设备下载有活动时持续续原action lease。
- 网页：`frontend/src/conversation-attachment-upload.js`、`api.js`、`App.vue`、`BotMainChat.vue`、`MixedGroupPanel.vue`。保留原File进行续传，切换会话后可见继续/丢弃入口，上传中不允许移除其他附件使读token失效。历史相对URL按API origin解析。
- 混合群：来源必须是本群成员的真实conversation并经权限检查，每个成员clone独立metadata ref，共用对象字节；原成员action/会话隔离保持，结果图文进入群历史。重复消息请求不重建action或ref。
- PNG/JPEG/GIF/WebP通过 `src/raster-image-file.mjs` 的64KiB分页worker复用原容器解析器验证，拒绝截断或MIME冲突。JPEG别名入口统一；普通大文件按文件下载。
- 小图继续沿Codex/Hermes既有10MiB、DSH既有2MiB原生视觉规则；大文件供运行时本机工具读取。大文件不自动作为网页图片预加载。旧小base64记录仍可读取。

## 验证

根会话组合回归195/195，无失败、无skip；lint435源文件及生产构建通过。另补真实repository加durable daemon回归，确认receiptOnly回复包含ref产物摘要，使设备进入confirmed，而非仅服务器写入成功。

独立真实HTTP验收在固定登记端口46208、内存工作区和合成设备中完成，没有调用模型或正式业务：实际500MiB PNG经浏览器63块上传、消息ref、设备流式下载、产物流式上传、结果ref及assistant附件URL下载。各段SHA均为 `d670d86101da2077d277349b3b66dd30d3ca4680011f134870fdcae2d361ad17`；最大请求8388608字节，历史JSON3655字节，峰值RSS184737792字节。500MiB+1初始化请求返回413。

验收回执：`D:\Ziwei-Local\artifacts\attachment-http-20261101\HTTP-ACCEPTANCE.json`；独立监督日志在其`logs`目录，含10秒健康心跳、PID和隔离退出37/0，失败fixture也保留。服务已关闭并释放临时端口。500MiB图片容器验证实际读取131072字节、结束偏移524288000；另有大IDAT和末尾截断测试。

上述是源码及隔离验证，正式API/Web/CLI/Android按各自发布回执验收。Android候选独立构建并保留头像修正，真实手机未连接不代表已安装。

## 正式发布

API/Web已发布`b1701bc`：API24个增量文件哈希一致，网页入口`assets/index-BJw6qDt8.js`。手机源码`7dc9caf`，code24 APK（0.7.5-mobile-attachments）已进入正式下载索引，SHA256为`6e5e57a3d5dd400aadc15a34f744dbbaad06b40275ece661c12af9202a39fde4`。本会话独立核对公网index、入口JS及APK字节摘要均匹配候选。

CLI启动探针在现场正确ready响应耗时1.1–2秒时仍仅允许1秒，`5851971`将单次探针放宽为5秒，保留整体启动预算及身份验证；真实probe回归先红后绿。新包SHA256为`4a57324ae0add16572a4fe524993199c2c8437aad0d95f0af801297951db03d4`，clientBuild为`2a0f212fbac2fb27a0697da2235a0867d4935e5e118520c5807fd6b9f924ed14`。本轮官方updater实际complete，原生start退出0，PID43912、ready200；原配置及3个Profile、共享Gateway保留，之前失败记录未改。CLI下载迁移漏路由也已修复，正式包与更新元数据已同步。

发布回执：`D:\Ziwei-Local\artifacts\attachment-b1701bc-20261101\api-deployment-receipt.json`、同目录`web-mobile-publication.json`，以及`D:\Ziwei-Local\artifacts\cli-download-5851971-20261101\FINAL-PUBLICATION.json`。设备安装回执在`D:\AINavtie\ops\ziwei\startup-probe-release-20261101\INSTALL-ACCEPTANCE.json`。手机实际APK覆盖安装烟测18项通过；认证大文件的真机网络与保存字节尚未验收，不把桌面HTTP验证写成手机真机完成。
