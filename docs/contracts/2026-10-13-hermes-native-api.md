# Hermes 原生能力增量 API — 实施合同 v2

日期2026-10-13。后端基线 `90e588b`，隔离树 `C:\Users\25941\.codex\worktrees\v2-e02-native-capabilities\灵光爸爸拆解`，分支 `codex/v2-e02-native-capabilities`。当前5283/4283预览不修改。此合同已按实际接口更新；候选SHA与最终验收单独记录。

所有资源属于原 employee_id，对应同一 Bot 原生 HOME/SessionDB；原生状态不复制到第二个记忆、技能或目标数据库。

新增 `POST /api/workspaces/:slug/bots/:id/native/actions`；MCP同 `/mcp/v1/workspaces/:slug/bots/:id/native/actions`，`ziwei_bot operation:'native'`。请求：

```ts
type NativeRequest = {
  expectedRevision:number; expectedControlEpoch:number; idempotencyKey:string;
  resource:'memory'|'sessions'|'skills'|'mcp'|'goals'|'heartbeat'|'kanban'|'gateway'|'voice'|'groups';
  operation:string; input?:Record<string,unknown>;
};
// 202，读取 Bot runs 或原 ziwei_get_action 直到终态；同请求返回原 action。
type NativeResponse = {action:Action};
// action.result.nativeOperation（或result.result.nativeOperation）
type NativeReceipt = {
  schemaVersion:2; resource:string; operation:string; employeeId:string;
  revision:number; nativeVersion:string|null; status:'succeeded'|'failed'|'requires_authorization'|'requires_dependency';
  data:unknown; // 文本/搜索/技能目录/MCP工具/原生状态/音频附件，密钥只返回configured
};
```

操作及字段白名单的可执行源是 `src/hermes-native-contract.mjs:NATIVE_OPERATIONS`。`_prepare/_settle/_fail` 是设备监管器内部阶段，HTTP/MCP请求不能提交。失败回执有 `status:'failed',code`，同时 action 为 failed。`requires_authorization` 只表示 staged 或安装扫描待复核，不能显示成已落盘。

Bot `get` 新增 `nativeResources`：每个资源当前 revision 的最近真实回执（包含 actionId/actionStatus/completedAt）。这用于结果展示，不是另一份记忆/技能/目标存储。需获取实时状态时仍提交 read/status/list。

`groups` 支持 list/read/step；read/step 输入 `{groupId}`。回读 `{room,events,decision,plan}`，原生 Room 是冻结2–6人 roster。group collaboration 会由有限 worker 按原生 `plan_next_task` 顺序逐个派发；结果验证后 `plan_publication` 记录 message.member/turn.settled。目标按当前工作区员工配置授权，未知 @ 不回退全员。发起 Bot 被 @ 时在原父 action 内执行；发起者及各目标都绑定自己员工的 Group 专属会话。room log 完整分页回放；同 groupId 的冻结 roster 必须一致。成员 uncertain、领取后 expired 或查询失败会保留父 action uncertain，不继续推进。返回 result.nativeGroup 有 groupId/runs/bounded/decision，runs关联实际成员action与原生task身份。

新增 Routine `nativeDriver:{resource:'goals'|'heartbeat'|'kanban'|'groups',operation:'step'|'dispatch',input?:{taskId?:string,groupId?:string}}`。其余name/schedule/timezone/status字段同现有Routine。仍使用原 automation 与 ziwei_bot 调度；无第二个Cron。暂停后原未开始 action 不能启动；已完成回合可以结算，但不能再调用模型。原生 Goals resume保留预算，Heartbeat resume重锚时间不补历史tick。

目录检查沿原聊天接口，Bot请求必须附 expectedRevision/expectedControlEpoch；电脑必须等于员工绑定。目录属于维护操作，可在draft/paused检查，但旧epoch action不能落盘。主聊天 model/device 显式值不得与员工绑定冲突，初始化发现冲突会拒绝。

记忆 read 返回 `{scope,content,entries,hash,limit,saved,mutation}`；hash为原生读取后的规范化文本SHA256，Windows BOM/CRLF同义。write必填content/expectedHash，使用原生scanner/锁/漂移/最终预算/atomic batch；多条记忆的全文清空仍按原生策略拒绝。技能 read/update/remove 的 expectedHash 使用原生 content_hash（含sha256:前缀），不能自行转换；安装和更新回查Hub lock/文件。

MCP inspect返回 `{server,connected,tools:[{name,schema}],status}`，call输入工具列表返回的name；工具include/exclude在原生注册和调用生效。保存的server key是逻辑名称，设备运行时使用保留命名空间避免与内置toolset重名；HTTP/SSE/stdio均进入原生MCP dispatcher。env/headers只允许外部服务${ENV}引用，ZIWEI_/CONTROL_MCP_/HERMES_等内部变量被拒绝。command/args/URL/其他文本禁止任何嵌入式变量；原始配置在原生展开前再次校验。技能包根 name 必须与API name一致、符合原生命名规则，单个包不能带入额外可发现技能。

Voice status仅返回provider/enabled/configured及credentialsReturned:false；transcribe返回原生transcript/provider；synthesize返回 `{files:[{name,mimeType,audioBase64}],provider,...}`（每个音频至多5MiB），前端可播放data URL。必须先在 BotConfig.voice 明确STT/TTS provider，禁止默默切云。

Gateway connect输入platform/durationSeconds（1–86400秒，默认86400），仅受监管原生adapter worker；返回connected是实际connect回执。disconnect回stopConfirmed/processExit，不能把请求受理当停止。监听器只产生紫薇入站记录与action；忙时消息以 platform/chatId/messageId 持久排队，同一聊天原ID不重复执行。入站与回复绑定确切 sourceActionId；已ACK的同平台 disconnect 或新connect永久撤销旧lease，其他平台不受影响。旧连接消息不能借另一条连接复活，需重新授权；delivery_started 与未确认发送不会自动重放。状态文件按平台独立，过期心跳显示unconfirmed。worker会在Bot版本/epoch授权撤销后关闭，日志位于该Bot HOME/logs/ziwei-native-lifecycle.jsonl，并记录独立监管健康与退出证据。

BotConfig扩展：memory.charLimit/userCharLimit；skills.autoLoad；MCP transport/url/headers/timeout/connectTimeout/tools；permissions.management（默认true）；voice.stt/tts（provider/model/baseUrl/keyEnv/voice/language/enabled）；gateway.platforms（enabled/tokenEnv/envRefs/extra/allowedUsers）与profileRoutes；collaboration.enabled/targetEmployeeIds；drivers.maxTotalTurns/expiresAt。配置字段均严格验证且随revision保存；source auth只是只读引用，源认证需refresh时该Bot拒绝写原store。

| resource | operations | 主要输入/结果 |
| --- | --- | --- |
| memory | read, write | scope `memory`/`user`；正文content、乐观expectedHash；返回正文/hash，原生memories文件 |
| sessions | list, search, read | query/limit/sessionId；真实原生SessionDB，限定本Bot目录 |
| skills | list, read, install, update, remove, enable, disable, hub_search, hub_install | name/content/expectedHash/source与hub源；安装只在Bot隔离HOME，原生验证/Hub接口；不升级Hermes |
| mcp | inspect, call | server/tool/arguments；原生stdio/HTTP配置、加载/调用结果，凭据环境引用 |
| goals | status, start, pause, resume, stop, step | objective/maxTurns；原生GoalManager状态与有限决策，驱动经过同一Bot执行门 |
| heartbeat | status, start, pause, resume, stop, step | prompt/intervalSeconds；原生HeartbeatManager持久状态，紫薇automation唯一触发 |
| kanban | list, create, show, edit, claim, complete, block, dispatch | native task字段；原生DB/CAS，受控worker及结果 |
| gateway | status, configure, connect, disconnect, inbound, outbound | channel/profile路由、环境凭据引用、真实连接状态及原消息幂等；无凭据明确requires_authorization |
| voice | status, transcribe, synthesize | 音频base64/mime/text/provider；原生STT/TTS接口及音频结果，缺依赖/授权明确返回 |

本合同中operation必须由实际schema校验；未知字段/未支持操作报具体错误，不能静默存入DB。所有读写都是设备受控action，受原身份/设备/revision/epoch/occupancy约束。只读管理可在draft/paused配置期间使用；模型、外部发送、工具调用、driver step需要active验证和对应明确权限。暂停只阻止后续启动，stop仍以真实原action回执为准，uncertain不能解除占用。

协作新增 `POST /bots/:id/collaboration`：`{expectedRevision,expectedControlEpoch,idempotencyKey,sourceActionId?,mode:'message'|'delegate'|'group',targetEmployeeIds:string[],content:string,groupId?}`。目标从当前workspace真实employee roster核验，不接用户自报HOME或native profile路径。返回原生envelope/交接ID、发送者/目标/会话/action关联；目标执行用原会话/A2A链，不能由native工具自行spawn越过暂停/授权。

BotConfig增量将保留已有字段并增加原生可验证的高级配置与HTTP MCP；具体字段以共享 `src/hermes-bot-config.mjs` schema为准，前端加载后应保留未编辑的高级字段。原生Goal/Heartbeat/Kanban的authority为 `ziwei`；原生状态管理与驱动已接入后才展示相应状态，实际凭据/设备/模型依赖分别展示，缺凭据不等于未实现接口。

Gateway多凭据示例：`envRefs:{SLACK_APP_TOKEN:"${SOCKET_KEY}"}`，Feishu可映射`FEISHU_APP_ID/FEISHU_APP_SECRET`；worker调用原生env override填充所选PlatformConfig。这里只保存完整外部变量引用，实际密钥在目标电脑进程内读取；缺SDK/凭据的connect不会显示成功。DM/delegate经原生schema与envelope派发到授权员工，返回背景交接和原action标识；结果通过受控action查询，source stop撤销未开始子任务并请求停止已领取子任务。

## 2026-10-13 P2 修订

Group 首条正文可精确 `@发起员工ID`。发起者从受信 action context 加入原生冻结 roster，`targetEmployeeIds` 仍只填获授权的其他员工，不能把发起者重复放入目标数组。识别规则与原生 Discussion 的完整 mention 正则一致；未知成员、跨工作区 ID、合法 ID 加 `.fake`/`:other` 等后缀均不能通过前缀匹配授权。父任务只登记一次聚合监督，覆盖每轮发起者模型及 native read/publish 子进程；停止确认必须等待任务结束且所有已登记进程树有终态证据，第一轮退出不能替第二轮证明停止。

Gateway 渠道状态使用原生 adapter 的 fatal/is_connected/send_path_degraded；当前已验证 0.21.3 的 Mattermost WebSocket task/socket 与 Webhook serving site。`connect()` 返回 true 但接收路径尚未证实可用时为 `retrying`；认证或监听致命失败保留 `failed` 和脱敏 `code`，进程心跳不能改回 connected。每个心跳携带观察到的渠道状态，正常断开也不能覆盖已有失败原因。

JS 管理器状态额外区分 `processAlive:true|false|null` 与 `processExit`：null 表示 Windows 监督结束但原进程树退出未确认，此时 disconnect 返回 `stopConfirmed:false`，新 connect 返回 `EXECUTION_UNCERTAIN`，不会启动替代 worker。停止准入独立锁存，缓冲的 connected/heartbeat 事件不能重新开放收发。临时恢复只继续同一 sourceActionId 的 pending/accepted 原消息；恢复事件与旧观察者并发时保留一次待处理事件，服务端仍按原消息幂等读取原 action。delivery_started/delivered/delivery_failed 均不会被恢复发布，未知发送继续保持不可自动重发。
