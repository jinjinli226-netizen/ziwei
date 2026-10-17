# 移动聊天读取减负与图片独立加载

## 已发布内容

用户在安卓聊天中反馈“聊天记录同步失败／读取超时”。主控与“紫薇 App 设计与开发”会话协作：主控负责共用 API 和主站，App 会话负责客户端、APK 与安卓验收。没有用 Android 工作树的旧后端覆盖生产。

- `0da5581963b140fbf7dcf929748dbe16781a06dc`：仅移动 Bot 列表、详情、runs 避免装载全部历史事件。保留最近100项完整动作结果供能力判断；最新动作和停止动作从 SQL 取终态事件及最后一条事件，另保留原事件总数。默认 API/MCP 不变。
- `9668962e1c16d3ee3b11ba9ef33bf95c4ad5842b`：移动会话中的普通图片及转发快照图片改成同源鉴权地址。已先推 GitHub `codex/v2-20261014-release`，于 **2026-10-17 13:43:13（Asia/Shanghai）** 发布。
- 当前代码目录：`/opt/ziwei/releases/mobile-images-9668962e1c16-1204ed1a/v2`，发布 API PID `351449`。
- 上一代码目录：`/opt/ziwei/releases/mobile-sync-0da5581963b1-9b2c66c0/v2`。
- 网页仍为 `ed4991036a46a855f091f2913b959dc4a3c95cf8`；官方 Windows 包仍为 `5db7d834deaf3524adfada59a434bc764fda750a`。本轮无需更新 Windows 客户端。

最终图片补丁仅替换 `backend/app.mjs`、`backend/mobile-read-view.mjs` 两个运行文件，没有修改数据库结构、原图片、消息、员工配置、设备执行或模型调用。前一节目录绑定修复和聊天转发功能均保留。

## 接口与兼容

仅 `GET /api/conversations/:id?view=mobile` 将已识别的内联 PNG/JPEG/GIF/WebP 换为 `attachment.url`，保留名称、类型、大小和顺序。默认网页 API、MCP、数据库原始消息及转发快照保持。无法识别的历史附件原样返回；同图的重复内联字段只在实际字节哈希一致时去除，未知或不同图片字段不会被删除。

- 普通图：`/api/conversations/:id/messages/:messageId/images/:index?v=<sha256>`。
- 转发图：`/api/conversations/:id/messages/:parentId/forwards/:quotedIndex/images/:index?v=<sha256>`。

图片接口先验证登录、工作区成员及员工可见范围，再按所属会话与父消息读取单条已存附件。转发图片来自**接收会话父消息的已存快照**，不要求接收者能访问原会话；不能通过此接口读取其他父消息或外部 URL。返回原图字节，采用 `private, no-cache, must-revalidate`、ETag、`Vary: Cookie` 和 `nosniff`；撤销权限后的请求不会因旧 ETag 得到304。

已发布安卓 code7 支持该 URL 形式及内嵌大图预览；不因此新增原生下载能力。App code8 的缓存 LRU、切员工取消旧 GET 等改动由 App 分支独立交付，不能把候选 APK 写成已公开发布。

## 验证证据与边界

冻结提交的相关 **63/63** 纯回归、lint170文件及独立审查通过，无本地监听。覆盖移动投影、四种图片格式及动画/EXIF 原字节、成员撤权和登录失效、父消息归属、转发源私有/删除后的目标快照读取、默认 API/MCP、转发及已读逻辑。

```sh
node --test backend/mobile-read-view.test.mjs backend/bot-runs-query.test.mjs test/bot-capabilities.test.mjs test/conversation-forwarding.test.mjs backend/conversation-read-state.test.mjs
```

无头像测试会话的实际 HTTP JSON 字节：

| 场景 | 原响应 | 移动响应 |
| --- | ---: | ---: |
| 普通图片聊天 | 1,049,778 | 1,276 |
| 转发父附件与快照各保存同一张图 | 2,099,511 | 2,529 |

后者通过真实 `reference` 转发创建，没有增加执行动作；默认响应与数据库原字节保持。上述数字是隔离样例，不能当成生产聊天的实测响应大小。

App 会话另外报告 **8/8** 图片 URL 浏览器兼容通过：后端严格为 `9668962`，客户端资产匹配 `f270f10c84ce724b23563e7d2055f34f4e23bb86`。普通四格式缩略图/大图、转发详情图片通过；17次二进制响应与原字节哈希一致，HttpOnly 会话 Cookie、无 Cookie401、私有来源404、来源删除后目标快照200和目标撤权后带 ETag仍404均验证。该项使用隔离内存服务，无生产业务消息或模型任务。

生产诊断曾确认闲鱼、TikTok 历史图片 JSON 约0.8／1.16 MB，Bot 历史分别约6483／5415条事件。本轮确实移除了重复传输和装载，但**不能仅据此宣称所有读取超时已经根治**。Nginx 原日志没有请求耗时；安卓模拟器在旧 API 组合下仍曾出现最近聊天列表超时，该列表响应本身约4.6 KB。05:42 UTC附近安卓请求持续到站并返回304，不能单凭状态码判断端到端是否及时完成。最终真实账号、原图及连续轮询的安卓结果由 App 会话另行记录；不能将模拟器等同实体手机验收。

## 发布检查与回退

- 发布 stage：`/opt/ziwei-staging/mobile-images-9668962e1c16-eebc98fc`。
- 源清单 SHA-256：`efbce8b37fe1eb74db32f4b6fdb739f74351947f17fc1a29d003e74fd043ce81`。
- 当前目录 `MOBILE_IMAGES_RELEASE.json` SHA-256：`f4b23ca80365e532a333ab5a23e0266b726d17521465983b6318a35f0b70f114`。
- 服务器 stage 内 `preflight-protected.json` 权限0600，保存发布前完整保护摘要；`publish-result.json` 为成功。主控独立复核源文件树、全部保护摘要、数据链接和同一 API PID，并确认内外健康200。
- 公网首页 SHA-256 保持 `d24b9bb9a2f955f2d6153d427372a4eb60197b5fc10fb7a30769f33be164d71e`。网页、CLI、中控、Nginx、原生封存文件及数据库文件身份保持。

上一 `0da5581` 发布曾被 `POST_RELEASE_STATE_CHANGED` 阻断最后确认，但候选已启动。经只读核对，SQLite `schema_version` 从243变247；用原对象定义及旧计数器复算，匹配发布前哈希。正常启动两次重建相同保护触发器会让计数器增加4，逻辑结构未变。旧失败结果和独立复核记录保留，没有重放该 stage 或恢复数据库。原发布器未持久化全部前置保护摘要，因此旧跟进记录不冒称独立证明了每项外部状态前后一致。

本次发布器改为比较 `sqlite_master` 完整对象定义与 `user_version`，将内部 `schema_version` 单独记为诊断；247→251正常通过。8项离线发布模拟通过，包括计数器+4、真实结构变更拒绝、未知服务结果不重放、PID变化拒绝回退；发布器另有旧 stage 禁止重用检查。

需要撤回时，先核对当前目录仍属于本次发布，防止覆盖后续版本；只恢复上一代码指针并验证服务，保留当前业务库、聊天、原图、转发、已读和幂等记录。不恢复旧数据库，不修改 Windows 包、中控或网页。旧代码仍可读取原始图片和新数据；撤回图片补丁会恢复移动历史内联图片的大响应。不得直接重放已使用的发布 stage。
