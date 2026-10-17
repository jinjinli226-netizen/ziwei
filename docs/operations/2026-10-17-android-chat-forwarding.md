# 2026-10-17 Android 聊天首页、已读与记录转发

用户明确授权与总控会话 `01a12fe0-a8f2-7c50-bf23-38ff2230015f` 协作并实施。分工为总控维护共享后端、网页与主站串行发布，Android 分支维护 App、隔离测试、模拟器和 APK。Android 分支没有部署主站或发送真实员工业务消息。

## 产品与协议

`0.2.0-internal / code 7` 默认打开最近聊天，底栏为聊天、员工、工作、我的，设备互联移入我的。列表直接使用当前用户可见的服务端员工和原主会话 ID；原目录较慢不会阻止列表打开原聊天，也不会用空历史创建替代会话。员工详情、汇报、工作、App 内模型能力与设备设置保留，官网图标字节不变。

`GET /api/workspaces/:slug/chats` 返回轻量索引和真实未读。App 在布局完成或滚动后，提交当前 timeline 实际可见的最后消息 ID 给 `POST /api/conversations/:id/read`。队列实际发送前重新检查页面、员工、工作区、前后台、转发、详情与图片遮罩；不会以“标记到现在”清除后到的消息。水位不更改聊天正文或 updated_at、不派发工作。这个 POST 是读取缓存失效的唯一受控例外，历史仍逐次经当前会话认证及 ETag 验证。

持久化普通 user/assistant 消息可长按文字或点消息操作，单条或多选最多20条；system/tool、未落库消息与已有转发卡片不作为 App 首版转发选择项。附言最多4000字符。默认 reference 仅保存记录，execute 需要明确选择。App 只发送原消息 ID、目标员工 ID、模式、附言和请求 ID，快照由服务端从源消息生成；卡片和详情按 v1 原文、发送者、时间和附件显示，原图在 App 内打开。

`POST /api/conversations/:sourceId/forwards` 检查当前真实成员和来源、目标可见性。reference 不初始化 Bot/Profile、不派发；execute 沿用原准入。回执匹配源、目标、模式和消息 ID 集合，保留服务端原序。未知回执、无分类冲突和两种转发409持续保留原 key/body；首次未知后，即使后续403或404也不据此判定原请求没有成功。只有明确点击才重试同一请求，不自动重派或切换模式。本机按账号、工作区、源和指纹保存哈希与请求 ID，不保存转发正文；不同待核对请求不覆盖彼此。

## 来源和发布责任

App 产品源码 `2ce1383a1cbe46737ea53cb56b9960c8f7cfccba` 已推送 `codex/android-manager`。为可复现合同测试，本地选择性整合总控 `069b128c29248ec72094019e76bf49dc0b2964d5` 的共享 API 增量与原有轻量 `getConversationAccess` 方法；保留 App 基线已有 mobile avatar、原聊天、32 MiB 条件缓存和最近5次运行优化。该分支不是整站部署基线，禁止从它覆盖主站 repository 或整个 backend。

总控确认 API 为 `069b128`，生产目录 `/opt/ziwei/releases/chat-records-069b128c2924-7a6f44a8/v2`；网页为 `ed4991036a46a855f091f2913b959dc4a3c95cf8`，入口 `assets/index-B7aTGrd_.js`。总控报告已用生产数据库副本验证两次增量迁移幂等、原记录与 rowid 摘要不变，正式发布保留旧目录与 fresh backup；App 执行者未运行这些生产命令。主站迁移、保留新增数据的回退和串行发布证据以[总控发布记录](https://github.com/jinjinli226-netizen/ziwei/blob/25ded633cfb67e59f74165032e5a9e7c6a45f51e/docs/operations/2026-10-17-chat-forwarding.md)为准。

## 自动验证

- 193 项 App 单元测试通过，覆盖账号/工作区隔离、单飞、原草稿、读水位与旧列表竞态、弹层/后台队列守卫、回执未知状态、多请求持久标识和默认模式。
- 35 项共享后端合同、增量迁移、移动读取与运行查询测试通过，包含权限、重复请求优先恢复、原图字节和无部分写入。
- 50 组浏览器流程通过：原工作流20、原历史8、设置12、新转发10。使用真实内存 repository、成员身份及新 Express 路由，以 app.handle 直接调度，没有 HTTP 监听或真实账号流量。
- 新完整 App DOM 验证图文多选、空附言、原序快照、文本转义、原图解码、默认 reference 零执行、明确 execute 单个内存任务，以及已提交后故意丢回执再以同 key/body 恢复同一记录。
- 浏览器验证真实 DOM 长按锚点、移动和滚动取消、图片短触摸预览及360px布局。补充受控 Chromium 的真实 touchStart/hold/touchEnd：800ms及1200ms长按松手后菜单保持，随即主动点关闭仍有效。原合成 PointerEvents 与真实触摸分开计证，不能冒充实体手机验收。

隔离证据在 `.local/mobile-manager-forwarding-qa/result.json`、`.local/mobile-manager-qa/` 和 `.local/mobile-manager-history-qa/`；真实账号截图另存私有目录，不提交或上传 Release。一次初始整合缺少旧基线轻量 access 方法，测试如实失败后按总控原方法补齐；没有伪造成功回执。独立复核还修正了长按锚点分层选择与遮罩出现后排队已读仍发送的竞态。

初次模拟器验收中800ms长按没留下菜单，1200ms曾成功。额外真实 Chromium 触摸确证：500ms菜单已经打开，松手后的可信兼容 click 重定向到新遮罩按钮，被误当作主动关闭。原合成事件测试漏掉此兼容 click。修复只吞同一次长按的兼容点击，直到松指后再开始短期去重；新主动 pointerdown 立即清抑制，键盘点击不阻断。500ms阈值、滚动取消、全页文字选择和原生 Java 外壳保持。旧失败与修复事件元数据均留存；首个构建 `b7bcd630…` 未发布，最终源码为上面的 `2ce1383`。

## 安装包

`ziwei-manager-0.2.0-internal-code7.apk`，706114字节；SHA-256 `5a4b2a4a74b268a60dfb78c898beb31290881ba98bbc7cfec8c14a8c307059ff`。证书 SHA-256 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35` 与前版一致，包名 `com.ziwei.manager`、API26/35，仅 INTERNET 权限。15个打包 Web 资产均与已推源码一致，官网图标 SHA-256 仍为 `68452b1f4299b0af353ee35d3315302061fa64c72cc77ba66763ebb8ec81ca2c`。

签名包已复制到 `output/android-manager/v0.2.0-internal/`。590×590二维码经 Vision 解码核对为本版直接 APK URL。清单 `deviceVerified:false` 指用户实体手机尚未验证；不能用模拟器替代实体设备结果。

## 原 AVD 最终包验收

最终 SHA `5a4b2a4a…` 已在原 AVD 覆盖安装，版本7/0.2.0、原签名与 firstInstallTime 均核验，原账号登录保留。首页显示5条真实最近聊天；TikTok 原历史在12.724秒与30.435秒观察点保持，闲鱼由当时无障碍树的当前行 bounds 单击进入后核对原 header 与正文，无读取超时。上述均为含等待和截图的观察时刻，不声称精确 API 耗时。

最终包闲鱼气泡800ms原生长按，松指后等待0.6秒，完成截图距松指0.946秒时菜单仍保持，未出现原生文字选择。旧包偶发菜单消失不冒称通过，最终包单独留证据。

随后1000ms长按松指后立即主动点击多选，成功显示1/20条选择栏；由当前无障碍 bounds 点转发，选择另一位原员工 TikTokTrendS，进入原记录确认页。根执行者也目视复核最终包截图：reference单选圆点和“仅转发记录”提交按钮均为默认状态，execute未选中。没有点击提交，没有真实转发或执行。

一次旧画面序列中，header 返回后仅凭旧截图补发 native Back，最终观察为 Launcher。独立只读复核认为“已在首页又返回而正常退出”更符合源码和 Activity pause 先于 renderer 日志的时序，但缺少当时 DOM/finish marker，未当作确定因果或成功验收。该序列不计通过；重新打开原账号，按当时前台和无障碍树逐步确认后单击，避免凭迟到像素重发返回。没有为此无证据修改 Java 外壳。

必要设置读取与返回也在最终包通过：关闭转发确认后进入员工详情与模型能力，原模型、职责、已绑电脑和 Profile 能读取，最新配置加载结束；按当前无障碍 bounds 返回详情和聊天。我的入口进入设备互联，显示真实两台手机摘要；单次原生返回后当前无障碍标题为“我的”，前台仍为 MainActivity。测试 helper 最初将设备页返回预期写成聊天，已按 controller 的实际 My 返回规则修正；不把该预期错误算成产品故障。没有编辑或保存设置，没有提交真实转发、执行、检查或启用。

原 AVD 最终包既定必要范围整体通过。真实账号图片与原始无障碍内容仅留在私有 `.local/mobile-manager-android-qa/chat-forward-code7-fixed/`，不随源码或安装包发布；仍不声称完整设备行操作、全部 catalog 或实体手机验收。

## 公开交付

模拟器通过后，将已核对的私有草稿发布为 [Android 0.2.0 内部测试版](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.2.0-internal)。发布脚本再次验证远程 Android 分支 HEAD 等于清单源码 `2ce1383`，三项资产的长度与 SHA-256 匹配，再将草稿公开；未匿名读取前不计交付。公开 [APK 下载](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.2.0-internal/ziwei-manager-0.2.0-internal-code7.apk) 已匿名完整回读，SHA-256 等于本页 `5a4b2a4a…`；本地发布回执 `verifiedDownload:true`。Release 仅含 APK、校验文件和 manifest，未上传真实账号测试材料。

此前版本可同签名覆盖安装，无需卸载；实际模拟器覆盖后原登录仍在。交付二维码为直接 APK URL，保存于 `output/android-manager/v0.2.0-internal/install-qr.png`；本地输出随包附 manifest 与 checksum。

## 本机收尾

模拟器和本轮 ADB/调试服务已停止，登记261–265分别释放，均返回成功；不触碰其他任务的260预览。AVD数据和原登录保留，仅移除设备临时 UI XML。执行者清理收据 `chat-forward-code7-fixed/cleanup-result.json` 显示 `ok:true`、无归属冲突或未登记监听；根执行者随后独立运行项目端口 `check`，同样 `ok:true`、`conflicts:[]`、`unregistered:[]`，收据存于 `.local/mobile-manager-release-0.2.0/root-final-registry-check.json`。测试临时 node_modules 软链已移除；未停止或抢占其他项目服务。
