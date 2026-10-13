# E02 Hermes 原生能力候选验收

本页保留首轮候选 `037cb777` 的历史证据。Group / Gateway 后续 P2 补丁及新增验证见 [补丁验收](2026-10-13-e02-native-followup-acceptance.md)，最新补丁 SHA 见 `.local/e02-native-followup-handoff.json`。

日期：2026-10-13。基线：90e588b84a7a69a0ec41fbe41e5ebfb18debdb8a。候选分支：codex/v2-e02-native-capabilities。
工作树：C:\Users\25941\.codex\worktrees\v2-e02-native-capabilities\灵光爸爸拆解。实现提交以该分支HEAD和.local/e02-native-handoff.json为准。

## 实现与数据归属

Bot仍是原员工，不建立第二份employee/roster。独立HOME按origin/workspace/employee绑定；记忆、技能、会话、Goals、Heartbeat、Kanban和Room数据由原生Hermes保存。源profile/auth只读引用，禁止Bot刷新或写入源认证文件。Workspace Creator保留原管理身份与模板；受信指导增量升级到v2，创建岗位和长期目标沿原Ziwei管理链。

新增原生资源动作API与管理MCP；配置统一版本化。身份、设备、revision、controlEpoch、验证和占用在领取/启动/派发前核验。原生驱动通过prepare→一次模型回合→settle，沿原automation触发，不新增Cron。撤权后仅允许记账，不再调用judge；明确未开始Heartbeat退回fire_count，Goal真实回合计预算，Kanban沿原run结算或阻塞。回执缺失、未知退出和结算传输异常保留EXECUTION_UNCERTAIN，不重跑。

MCP使用原生注册/dispatcher，支持stdio、HTTP、SSE和工具过滤。Memory写入使用原生scanner/锁/CAS/budget/atomic batch。Skills使用原生命名/frontmatter、quarantine、扫描、Hub lock和读取hash；一个包只有一个可发现身份。会话检索限定该Bot原生SessionDB。Voice使用明确保存的STT/TTS provider，返回原生文字和可播放音频。

DM/委派保留原生schema/envelope，但交接由平台员工授权链接管。Group使用原生计划、冻结roster、完整日志重放和原生发布；源成员在父action内回答，各成员使用自己的Group会话。群父任务保留子任务容量；成员未知时停止推进。

Gateway仅启动被授权的原生adapter，不启动GatewayRunner。Worker受Windows Job监管，24小时以内有界；入站只进入平台持久队列与同一个action。去重键包含platform/chatId/messageId，source绑定不得跨连接替换；原生发送持久CAS认领，delivery_started不重发。disconnect ACK即撤销旧来源授权，真实退出证据单独报告。每平台状态文件和该Bot HOME/logs/ziwei-native-lifecycle.jsonl保留心跳、独立监管健康及退出记录。

## 验证

- 全量node --test：776/776通过，0失败/跳过，46.65秒。日志：.local/native-full-tests-final-2.log。
- 新故障/授权/调度回归：28/28通过。日志：.local/native-fault-tests.log。
- Lint：96源文件通过。Python AST解析通过。git diff --check通过。
- 前端构建成功，6.62秒；原有500kB主chunk警告仍存在。日志：.local/native-build-final.log。
- 实际安装Hermes：0.21.3，源码HEAD bbaf7af5c83546d19f8060f4097d3bb25cd1a3c3。原四个已有tracked修改未变；没有升级或重启Hermes。
- 三个只读审查代理确认本轮定位的driver回执缺失、Group终态/调度/会话边界、Gateway交付/租约/多平台/跨聊天、凭据引用与技能身份问题已闭合。
- 最新真实原生协议验收：通过。原始回执：.local/native-capabilities-1791830424578/receipt.json；可移交汇总：docs/ops/2026-10-13-e02-native-protocol-receipt.json。共49个资源回执；Group实际完成2个成员回合（含发起Bot原生模型），原生日志回放115条事件；Webhook实际回复记为delivered，重复请求返回原生去重200且入站仅一次，Windows Job树退出已确认。

## 可证明的范围与后续接入

真实Hermes验收使用隔离HOME、loopback OpenAI兼容模型/语音服务、MCP/Hub协议peer和本地HMAC Webhook；阻断外部网络连接。实际安装的Hermes执行模型工具回合、DM、委派、Group源成员、资源操作和adapter生命周期。目标成员的跨设备平台回执使用协议fixture；真实平台授权和调度另由内存repository/scheduler测试核验。没有向外部账号发送测试消息，没有进行24小时墙钟运行或云渠道实账号连通验收。

Telegram/Slack/Feishu等具体渠道仍需目标电脑原生SDK和有效凭据；只读source认证过期时须由用户正常刷新源profile。原生Memory多条全文清空仍按原生策略拒绝，staged/扫描待复核不能显示已保存。旧Gateway来源消息不会自动迁移到新连接；需明确重新授权后处理。新frontend由E03接合同与候选提交，最终组合预览尚待E03独立验收。

当前5283/4283预览保持原进程；未操作原目录/2884正式链路，没有正式配置、数据、设备业务动作、push、merge或部署。本候选只提交本地代码和可核验合同。
