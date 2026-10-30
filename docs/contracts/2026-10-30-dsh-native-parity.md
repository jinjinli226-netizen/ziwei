# DSH 原生完整能力：差距与设备桥合同

状态：2026-10-30 至 10-31，后端与设备桥实现已落地，正在做最终整链集成，尚未发布。下方差距表保留调查基线；当前实现与验收见末节。网页和 CLI 的最终接线由主会话负责。Hermes 继续使用其原生能力，本合同不修改 Hermes 配置、Loader 或审批。

## 来源

作者 `D:/dshbot` 当前工作树包含未提交但已打包的原生能力，不能只按测试提交 `d6ef4f7433d1508576980bfd9c22bbc61fdc37bd` 或其 HEAD 判断。源码和原生方法核对来自 `README.md`、`docs/runtime-protocol.md`、`ui/{modes,native-plugins,providers,runtime,groups,app}.js`、`server.rs`、`groups.rs`、`routines.rs`，以及已安装 Harness 的对应 `typert.host.js`/controller。没有调用正式 Bot 的写 API。

本次读取的作者模块 SHA256：

| 文件 | SHA256 |
| --- | --- |
| `ui/modes.js` | `9ebbb409aba5d7e83da4b48de5de85e0f9f34da458ade8a7c18702974dc1d840` |
| `ui/native-plugins.js` | `94516e7e09fa553a54db5e90ece09e34cc91cb3ffc690d8fc8918913886b86ec` |
| `ui/providers.js` | `6f3f088a978d2d642197c74ba64ed58f354b3d0ca77b3f46a424deb7e0ab8f46` |
| `ui/runtime.js` | `4f6b11bce5a2068f5cf12570197c06b4d73aaa2b67c917ec59a7da190a47f796` |
| `ui/groups.js` | `6720a76b94773fe0a71db46c02bce4d38a51ed8a1efea22fe7135e299940941f` |

紫薇调查基线 `c289028`（含公开技术 ID 投影修复）。`backend/dsh-adapter.mjs` 的 groups/routines/files/log 等仅是 transport helper，没有产品路由和设备接线，不算已对齐。

## 调查基线差距表

| 作者当前功能 | 紫薇当前状态 | 必要接入/验收 |
| --- | --- | --- |
| Bot 原生运行状态、独立 HOME/work/进程/端口 | 可发现并绑定既有 Bot；聊天用真实 Bot | 增加绑定 Bot 的状态与原生 start/stop 控制；不从服务器 localhost 操作，不泄漏原生 token URL |
| 新建/删除原生 Bot | 平台创建员工不等于创建原生 Bot | 明确单独生命周期动作。原生 delete 会停止并删除 HOME/聊天/work，不能映射普通员工归档或默默执行 |
| 人设、显示名、头像、分组、置顶/隐藏/通知 | 平台自己的员工资料；未同步全部原生 metadata | 原生 persona/metadata 具名读写与回读；复用品牌头像等平台显示时明确来源，不能宣称原生已保存 |
| 标准/PTC/极简/创造与自定义 preset | 普通 session/create，没有 preset 控制 | 动态读取所有原生 presets，read 组成，空白原生会话可 select；有内容则明确新建平台 conversation 与原生 session，旧会话/草稿保留 |
| Plan 独立开关与 pending 状态 | 无操作和完整投影 | 仅 `/plan`、`/plan off` 两个固定命令；读回 `values.plan`，不开放任意 commands/execute |
| 工具权限单次允许/拒绝 | 仅 stage 提示“等待审批”，没有可回答通道 | 设备持有真实 `$events` clientId/eventId；公开安全交互引用，用户明确回答后回原通道；不自动批准、不支持虚构永久允许 |
| Plan 全文审批、交互提问、continued question | 没有问题正文及 live/continued 路由 | 呈现问题/计划 detail；live `$events/result` 与 continued `userQuestions/answer` 分路，撤销与断线失效；不能把历史记录当待审事件 |
| 会话历史、更早记录、Markdown/工具/协作来源、导出 | 有平台聊天和原生当前 turn 流；未完整导入原生历史/投影 | 原生 follow/control/projections 的只读订阅和分页。导出目前作者也是客户端导出已加载 messages，无专有 export RPC |
| 文本、图片附件和粘贴 | 平台可收附件，但 DSH local-action 目前转成“本机附件路径”文本 | DSH prompt content 必须传原生 image block；保留 MIME、图片内容、数量/大小限制和原平台附件权限，不能声称文本路径等同视觉输入 |
| 停止生成与未知 turn 恢复 | 已接 request/turn/end 与 WeakMap supervision | 继续保留当前取消与终态协议；不能因新增管理 RPC 放宽真实 session 监督 |
| 离线 Web bundle 组合 | 已接真实 Hub GET/PUT，保存/下次启动区分 | 保持现有接口与 source，不重新造 catalog 或组合库 |
| 原生 runtime bundles/entries/Loader/presets | 有只读子集 | 补 `listPlugins` 的 patchId/readOnlyReason/meta/version/installTarget，支持原生 bundle/entry 启停和卸载；实际加载仍看 fiberPhase |
| 插件配置 schema、revision、dirty 字段、敏感留空 | 只读 schema，丢弃当前安全值，不能编辑 | 原生已脱敏 namespace value/base/user/secrets + schema/revision；真正 settings/mutate，冲突保留，写后读回；秘密值分加密通道 |
| 市场索引、搜索分页、兼容性、版本选择 | 未接 | 原生 listIndexes/setIndexes/search；选原生返回的版本和来源再安装，不伪造市场。未启用市场 service 时如实 unavailable，不自动启用或重启 |
| 来源检查、包名/Git/压缩包/本机来源安装 | 未接 | inspect 明确接受来源后再确认 install；只能通过专门安装输入处理原生 spec，不能开放任意文件读写或 RPC |
| 安装日志、查询、取消、构建脚本审批、替换版本 | 未接 | 稳定 sourceActionId/nativeRequestId、本机持久化 attempt/result、真实事件、明确 build 包名。unknown 不重发；替换是 remove 后 install，分别报告部分完成 |
| Provider 目录、自定义 Provider、发现模型 | DSH 不接受平台非原生模型覆盖；没有编辑入口 | 读原生注册表/可配置目录/安全 settings，具名增改移除/发现模型；原生存储为唯一配置来源 |
| 凭据状态、写入、留空保留 | 现有安全输入业务限定 Hermes | DSH 独立加密投递，复用密码学/设备密钥，不套用会推进 Hermes revision 的服务；原生 credentials/set，读 describe 状态，不回填 Key |
| 默认模型、会话下一轮、实际使用模型 | 原生执行可用，平台未完整展示/编辑 | 默认通过 settings；会话 selectModel 及 projections.modelSelection。原生 selectModel 也尝试保存默认，需分别回读 next/lastUsed/default，报告部分成功 |
| 2–6 人群、@定向、多 Bot 回复、群独立 session/审批/停止 | 有未挂载 group primitive，没有完整员工调度接线 | 成员必须是当前可见绑定员工，同设备原生 group；每成员走既有员工 action/session 监督，不能 primitive 一次绕过成员授权或混入私人 session |
| 原生例行 CRUD、启停、立即执行、历史/结果 session | 只有未挂载 adapter，不是原生 Routine 管理 | 通过目标设备的 Hub routines API；让原生 scheduler 单独调度，紫薇不复制建同一 schedule，保留真实 lastSessionId/lastAttemptId/中断 unknown |
| 工作空间列表/UTF-8预览、日志与掉线诊断 | 有普通目录工具，不等于原生 Bot workspace 面板 | 只接原生 Bot work 下的相对文件入口（预览≤1MiB）和受限日志行数；不读 HOME/credentials，不允许请求任意绝对路径；复用原生日志，不新增服务实例 |

custom 的实际作者能力是枚举、阅读并选择已由原生提供的自定义 preset；作者 `modes.js` 没有另一个“创建 custom preset”编辑器，本轮不凭名称扩展出作者没有的功能。

## 产品 API（已挂载源码，尚未发布到正式服务）

所有入口同时挂 `/api/workspaces/:slug` 和 `/mcp/v1/workspaces/:slug`，复用现有当前身份/可见性/设备归属。保留已发布 `/employees/:id/plugins` 三接口。

| 方法 | 前缀后路径 | 用途 |
| --- | --- | --- |
| GET | `/employees/:id/dsh/native/capabilities` | 已实现具名 operation 目录与目标设备实际发现状态，不能把实现目录当现场就绪 |
| GET | `/employees/:id/dsh/native/state?conversationId=…` | 当前 subject 的最近原生观察、各资源 checkedAt/freshness/权限、pending actions、交互与安装状态；不直连设备 |
| POST | `/employees/:id/dsh/native/refresh` | `{resources:[具名只读资源],conversationId?,idempotencyKey?}`，排设备只读 action |
| POST | `/employees/:id/dsh/native/actions` | `{resource,operation,input,conversationId?,expectedSubjectHash,idempotencyKey}`，固定 registry 校验后排设备动作 |
| GET | 已有 `/actions/:actionId` | 原 action 的安全回执、事件与结果；不新增一套执行查询协议 |
| POST | `/employees/:id/dsh/native/secure-requests` | owner 明确发起凭据/敏感配置/临时发现密钥输入，返回绑定、公钥、短时投递引用；不接明文秘密 |
| POST | `/employees/:id/dsh/native/secure-requests/:requestId/answer` | `{envelope}`；密文临时中继，设备执行许可后领取，终态清除，不落普通 action/聊天/日志 |

实现状态：API、MCP 路由和设备 action registry 已挂载到当前源码；目标设备仍需报告 `dsh_native_controls_v1`，且正式服务发布和现场写入验收另行进行。未接入的原生能力不会因出现在 registry 之外而被伪装成可用。

具名操作例：

```json
{
  "resource":"plugins",
  "operation":"setBundleEnabled",
  "input":{"name":"@deepseek-ai/dsh-experimental-badge-skill-bundle","enabled":true},
  "expectedSubjectHash":"state 返回的完整绑定哈希",
  "idempotencyKey":"native-toggle-1"
}
```

```json
{
  "resource":"settings",
  "operation":"mutate",
  "input":{"ns":"agent-loop","expectedRevision":7,"ops":[{"op":"set","path":["maxParallelToolCalls"],"value":8}]},
  "expectedSubjectHash":"…",
  "idempotencyKey":"config-1"
}
```

```json
{
  "resource":"plan",
  "operation":"set",
  "conversationId":"原平台conversation-id",
  "input":{"active":true},
  "expectedSubjectHash":"…",
  "idempotencyKey":"plan-1"
}
```

不会接收 `method`、Hub/base URL、原生 cookie/token、其他 Bot 名称或随意的 native sessionId。Provider/registry/市场索引地址属于具名功能本身的明确输入，不是 transport 地址；从市场选版本、安装本机来源、workspace 相对文件必须走各自专门 operation，不变成任意地址/路径透传。

设备 feature 拟为 `dsh_native_controls_v1`，原 `dsh_plugins_v1` 保留。新 feature 仅在实现、测试及客户端打包包含所需模块后宣告，不能仅改心跳让老客户端假称支持。

## 固定原生映射

以下均由设备本机已配置 Hub 发起，运行时 RPC 使用原生 client-request/rpcId envelope；registry 不允许调用表外方法。

| 产品 resource.operation | 原生方法/路径与参数 |
| --- | --- |
| `presets.list/read/select` | `agentPresets/list {}`；`read {agentPreset}`；`select {agentId:解析出的sessionId,agentPreset}`，select 后读 projections |
| `sessions.create` | `session/create {request:{cwd:员工已授权目录,agentPreset?}}`，只绑定专属新平台 conversation |
| `sessions.projections/list` | `session/projections {request:{sessionId}}`；`session/list {_request:{}}`，结果仅属于当前 Bot；导入另有显式选择与新 conversation |
| `plan.capabilities/set` | `commands/list {agentId}`；`commands/execute {agentId,line:'/plan'或'/plan off',submittedAttachments:[]}`；读回 `values.plan` |
| `interactions.approve` | 本机原 `$events` 通道的 `$events/result {clientId,eventId,outcome:{kind:'result',value:'allowed-once'或'rejected'}}`；浏览器只传交互引用和decision |
| `interactions.answer/dismiss` | live question：`$events/result ... outcome:{kind:'result',value:{answers}}`；dismiss 为原生 `kind:'rejected',error:{name:'UserQuestionError',code:'ASK_CANCELLED',message:…}`；continued：`userQuestions/answer {agentId,callId,answer:{answers}}` |
| `plugins.list` | `pluginManager/listBundles {}`、`listPlugins {}`、`pluginInventory/list {}` |
| `plugins.setBundleEnabled/setPluginEnabled/removeBundle` | `{name,enabled}` / `{id:entryId,enabled}` / `{name}` |
| `settings.describe/mutate` | `settings/describe {}`；`mutate {ns,ops:[{op:'set',path:string[],value}|{op:'unset',path:string[]}],expectedRevision:number}` |
| `market.listIndexes/setIndexes/search` | `pluginMarket/listIndexes {}`；`setIndexes {urls}`；`search {url,query:{text?,sort:{kind:'relevance'或'index'},offset,limit,fetchedAt?}}` |
| `plugins.registries/inspect` | `pluginManager/registries {}`；`inspect {spec,options?:{registry:string或null}}` |
| `plugins.installBundle` | `{spec,options:{enabled,saveExact:true,requestId:本机稳定原attemptId,registry?,approvedBuilds?}}`；非短时提交 RPC，不伪造 job/start |
| `plugins.waitForInstall/cancelInstall` | `{requestId:从原sourceActionId派生}`，不接受随意 requestId；取消返回 cancelled/too-late/not-running，不等同最终安装结果 |
| `providers.list/directory/modelCatalog` | `llm/listProviders {}`、`llm/listConfigurableProviders {}`、`session/modelCatalog {}` |
| `providers.upsert/remove` | 按原生目录声明 `settingsNs/settingsPath` 和 revision 形成固定 settings ops；custom 位于 `llm-pi-ai.providers.<id>`，只改编辑字段，保留其余高级字段；remove 不删除credentials |
| `providers.discoverModels` | `llm/discoverModels {settingsNs:'llm-pi-ai',request:{api,baseURL,provider?,apiKey?}}`；临时 apiKey 必须加密输入，不写进普通 action |
| `credentials.describe/set` | `{refs:从原生Provider目录解析的ref[]}`；`{ref,value:设备本机解密值}`；原生set为void，随后describe核对configured，留空不写 |
| `models.setDefault/selectSession` | 默认以 `agent-default-model` namespace/revision 写 provider/model/reasoningEffort；`session/selectModel {request:{sessionId,provider,model,reasoningEffort?}}` |
| `routines.list/create/get/update/delete/run` | Hub `/api/bots/:boundName/routines[/id][/run]`；GET/POST/GET/PUT/DELETE/POST。输入 title/prompt/intervalMinutes/enabled；interval为原生支持的1/15/60/1440分钟；保留历史和真实session |
| `files.list/preview` | Hub GET `/api/bots/:boundName/files?path=原生work下相对路径`、`/file?path=…`；由Hub既有safe_work_path保证work约束，不能读取home |
| `logs.read` | Hub GET `/api/bots/:boundName/log?n=受限行数`；安全投影，含未知归属的诊断不当作执行成功 |
| `bot.state/start/stop/persona/metadata` | 单Bot状态来自Hub `/api/state`；POST `/api/bots/:name/start/stop`、PUT `/persona {persona}`、PUT `/metadata`（displayName/avatar/section/pinned/hidden/notify）；不公开start结果的token URL |
| `groups.list/create/get/update/delete` | Hub `/api/groups[/id]` GET/POST/GET/PUT/DELETE。group为2–6个当前授权DSH员工派生Bot标识，不能浏览或修改无权成员的群；messages/sessions更新仅来自本机真实群协议 |

原生 Bot 创建/删除属于独立生命周期能力，需要用户明确的创建或永久删除动作和确认；不混入普通管理配置保存。原生窗口 open 是目标电脑本地窗口行为，不作为网页中任意跳转地址。

## 原生事实：配置、安装、交互

### 配置编辑与安全输入

`settings/describe` controller 明确调用 `redactSecrets:true`，返回 `{writable,hasDocument,namespaces:[{autoGenerate,ns,schema,value,base?,user?,applies:'live',secrets:[{path,set}],revision}]}`。原生会删除 secret 值及 secret schema 默认等敏感元数据。新桥保留这份原生脱敏后的安全值、schema 与 secrets 状态，不能继续只保留 schema、把真实编辑留在原生页面。public ns/module/provider/model/entry ID 独立投影，不再对长技术标识做统一秘密替换。

只提交 dirty set/unset，敏感空白表示保留。普通 metadata action 不允许夹带 secret 字段；敏感字段/headers、credentials/set、含临时 apiKey 的模型发现通过 DSH 专属端到端密文中继。复用 `bot-secret-crypto.mjs`、设备公钥和本机私钥保护，不调用 Hermes 的 `bots.get` 或推进其 revision。AAD 绑定 workspace/employee/device/Bot、operation/input元数据、namespace/revision或credential ref、action/投递 ID、key ID、有效期。服务器不解密，不建另一份Provider配置。

原生 `settings/conflict` 保留 expected/actual revision，要求刷新；不得无提示自动读新revision再重写。成功后读回revision与非秘密值。Provider settings成功、Key失败、模型下一轮成功而default未核实分别报告 partial，不能把多步操作伪装原子事务。

### 安装不是原生幂等 job API

已核对 manager 实现：`installBundle` 仅在运行时 `installs` Map 注册 requestId，没有相同ID去重；完成后 finally 删除。`waitForInstall` 只能等待当前 active 安装，完成后可能返回 null。null 不证明成功、失败、取消或未执行，绝不能因此再调用 install。

因此设备在提交前必须持久记录原平台action与本机attempt/requestId，接原生长RPC并订阅事件；完成回执也必须持久化后再通过既有ActionDelivery上传。不能凭普通HTTP rpcId或同requestId自称原生恰好一次。网络/进程中断后，只允许从原attempt查询、等待、取消或显示unknown；不自动重放原安装。安装与交互等待使用独立明确预算，不复用15秒metadata超时；ACK/上传租约需覆盖通用result传输预算。

原生 `install-state` phase为 installing/applying/cancelling，可能含attempt registry/index/total；`install-log` 含 requestId/jobId/argv/cwd/stream/text/exitCode。公开保留原attempt标识、phase、stream、脱敏text/退出码，去掉argv/cwd/logPath等可能携带凭据和本机路径的细节。

cancelled 表示原生已完成取消/回滚步骤，仍等安装最终回执；too-late说明已进入应用阶段；not-running不能证明已经结束。构建脚本由原生回执给 pendingBuilds，用户逐包明确批准后才以这些准确包名发起新的授权attempt；不能传通用approve-all。替换版本是 remove 后 install，两步都需明确授权并分别保留回执，unknown安装不重复移除/安装。

### 会话、Plan、审批与提问

从 `conversation_dsh_sessions` 按 workspace/conversation/employee/device/Bot 解析nativeSession，浏览器不指定sessionId。新创建的管理session需要受限的绑定登记，不能借管理回执伪造模型turn/end，也不覆盖已存在conversation映射。

已有内容切preset返回 `DSH_PRESET_REQUIRES_NEW_CONVERSATION`，前端明确新建才创建新的平台conversation/native session。空白判定同时参考平台消息和原生 `sessionListMetadata.blank`。preset列表来自运行时，不能硬编码只允许四项。

Plan `pending ? !active : active` 是UI所表达的有效选择；仍报告active/pending原始值。`commands/execute` 返回result.kind success后需读回projections，而非仅凭RPC成功显示开启。

`$events` 的 ready.clientId 和 live eventId 由同一个设备事件连接持有。现 `src/dsh-runtime.mjs` 没保存ready.clientId，只有stage提示，必须补完整交互代理。审批/提问公开引用绑定 sourceActionId、conversation、nativeSession、设备和事件连接代次；断线/cancel/已答后失效，不重用历史eventId。Plan review显示完整detail，批准答案为原生问题的 `intent.approve`，不是桥猜“同意”文字；continued问题只走原生userQuestions/answer。

交互回答和安装cancel属于明确受限控制操作，必须能在原运行action等待期间送达。不能让一般配置或任意RPC绕过调度；也不能把它排在同员工的原模型任务之后形成死锁。会启动/继续模型的结果仍由原request/turn/end监督，配置action成功不等于模型完成。

## 动作、结果与权限合同

新action拟为 `employee.dsh.operation`，payload只含workspace/workspaceId/userId/deviceId，嵌套 `dshOperation:{schemaVersion,subject,scope,resource,operation,input,requestedBy}`。不加顶层runtime DSH，避免被现有模型会话终态协议误判。secret只带投递引用，不带秘密或密文正文。scope分Bot、已绑定conversation、原安装attempt/interaction，不接受外部任意scope。

创建须 `BOT_INTERNAL` 专属入口；ACK、execution-admission、通用action读取都复用当前成员/可见性/设备凭据、完整subject和scope核验。幂等身份固定workspace+employee+resource/operation+key，不跟随subject变化；同key不同input冲突，同key旧subject与当前不同则409，不把重试改投新Bot。已发出但未知的native mutation只能查原attempt，不以“再试一次”重放。

结果分开报告：action提交/投递状态、native application、保存或覆盖/重启要求、模型turn终态。例如native application允许 applied/restart-required/overridden/failed/cancelled/unknown；不把 A2A succeeded 或 HTTP200 当作 native applied。原生错误公开保留已知code及安全revision/details，不返回含凭据的原始诊断。

`/settings`路径在现identity/native.mjs会自动归admin；上述新入口用明确resource registry授权并让统一身份role/scope目录同步，不绕过现管理权限。Lifecycle/安装/卸载/secret等写操作必须有对应当前授权；所有审批都要求用户明确决定。

## 文件边界与实施顺序

| 归属 | 文件与职责 |
| --- | --- |
| 本协作会话后端/设备桥 | 新 `src/dsh-native-contract.mjs` 固定operation类型/预算/参数映射；新 `src/dsh-native-operations.mjs` 本机RPC/Hub/回读/安全descriptor；新 `backend/dsh-native-operations.mjs` current subject/scope、幂等、快照、action及安全结果 |
| 本协作会话交互/秘密 | 独立DSH事件连接/交互引用与安全密文投递模块；复用密码学和设备密钥，保留Hermes strict业务服务；本机安装attempt只保存操作证据，不建配置库 |
| 本协作会话必要接线 | `src/local-action.mjs`、`src/dsh-runtime.mjs`、`src/daemon.mjs`/scheduler仅明确控制操作、预算与daemon feature；`backend/repository.mjs`、`management.mjs`、`version-preservation.mjs` 的受限注册/ACK/授权/投影；独立routes模块供Root挂载 |
| Root | `frontend/`完整功能面板、聊天/模式/Plan/审批/模型/群例行等UI；`backend/app.mjs`最终路由挂载和已部署热修保留；集成、提交、构建、分层发布 |
| 后续CLI接线 | `scripts/ziwei-mcp.mjs`源定义、workspace-cli registry/transport，按现脚本再生vendor/schema/公开文档，保留身份和unknown不重发 |
| 作者DSH仓库 | 当前功能源码与打包由作者负责；本协作会话不重写其存储，不部署/重启DSH；需要接口时先证明已有原生方法不足 |

实施按依赖推进：①固定registry、状态/安全值、设置/插件/provider非秘密读写；②原生session映射与preset/Plan/图片；③交互和端到端秘密通道；④安装attempt日志/取消/build审批/未知恢复；⑤原生groups/routines/files/log/lifecycle与CLI补齐。每步先回归再实现，未实现operation不标supported，不以部分阶段宣称整套对齐。

验收优先无监听：真实内存repo/API→ACK/执行许可→Dispatcher/LocalAction→ActionDelivery→结果/快照；原生解析/Loader隔离测试单独证明原生加载。涉及真实原生写读、安装、mode/plan与事件时只使用经明确隔离的fixture，先遵守端口登记规则，不能用正式Bot或新启动业务来替代。当前没有启动、停止、重启或安装任何正式能力。

## 当前实现与接线

`src/dsh-native-contract.mjs` 现在提供固定具名操作与预算。设备适配层已覆盖运行时 bundle/entry 管理、原生配置、Provider/模型、preset/Plan/session/history、live/continued 交互、安装/等待/取消/逐包构建批准、Bot 状态与启停/metadata/persona、files/log、原生 routines 和 groups。`commands/execute` 仍只有 Plan 的固定内部调用，不开放任意 RPC。Bot 创建/永久删除仍走明确的独立生命周期授权；不把员工归档映射为原生删除。

原生市场搜索接受 category/labels/refresh，以及 index/relevance、published+direction、key+id+direction 四种排序。分类、标签和自定义排序来自 search 结果 metadata。Provider upsert 只要求 provider/expectedRevision；省略字段不改，api/baseURL 的空值与 models 的空列表/null 撤销用户覆盖并恢复继承。自定义 Provider 新建仍要求真实协议、地址和非空模型列表。

服务器 `createDshNativeService` / `createDshNativeSecrets` / `createDshNativeGroupDispatch` 通过 `mountDshNativeRoutes` 挂载。前两者分别负责具名动作与安全密文输入，群协调器作为 `groupDispatchService` 传入。新增设备端点只接受当前已配对设备，不能由浏览器直接指定 Bot、工作目录或 native session。

群发使用 `groups.send {groupId,content,targetEmployeeIds?,attachments?}`，取消使用 `groups.cancel {sourceActionId}`，两者的 expectedSubjectHash 都来自当前 Bot state。目标缺省按原生 @ tokenizer 解析；未知 @ 拒绝，@all/@everyone 发全体。服务器固化 groupTargets 与已授权 roster，每位成员获得标准 conversation.execute、群专用 conversation、最长 15 分钟预算和原生 turn 监督。native 群 SID 不能占用私人会话。父动作 unknown 不抹掉已发出的子动作；新具名取消动作仅排既有 action.cancel，终态仍看原子动作。

群附件使用现有会话附件校验和保存机制，浏览器仅提交 name/mimeType/contentBase64，最多 10 个、每个 2 MiB、总计 10 MiB；原生群历史只记附件名，图片内容随每个成员的标准动作进入原生 image block。群协调器独立限额为 1，成员保留原员工锁与普通并发预算，concurrency=1 也能运行发起 Bot 自己的成员动作。群取消原子移除未领取的成员消息，仅为执行中成员排原 action.cancel；不会让排队成员在取消后继续启动，也不伪造 native sessionExit。精确审批/回答/取消操作可在维护排队期间经过原 ACK/admission 送达。

设备上的 `dsh-native-install.mjs` 和 `dsh-native-journal.mjs` 在写前保存已准备证据，写后保存安全结果；重启后不重放未知安装或配置。安装及 wait 使用 900000 ms 执行预算、至少 960000 ms ACK 交付租约；密文输入 330000 ms。默认两分钟无输出不会提前取消这些明确预算，显式 idle 限制仍保留。

设置入口复用 `publicDshSettings`，同时净化原生 schema roles/sidecar 与原生 Provider 未标 secret 的实际凭据字段；保留公开技术 ID、类型和 apiKeyEnv 引用。HTTP/Git 源中含 userinfo、密码或明确凭据 query 的普通请求，在写入 action 之前拒绝，不先遮蔽后安装错误来源。当前查看者与原发送者的群成员权限都要通过，旧 owner 快照或幂等回执不向无权查看 private 成员的用户泄露。

无监听整链测试位于 `test/dsh-native-delivery.test.mjs`、`test/dsh-native-group-delivery.test.mjs`，通过真实 auth/API/repository、ACK/续租、Dispatcher/LocalAction、ActionDelivery 和状态投影；原生传输边界使用内存 fixture。其余精确协议、journals、秘密绑定、调度/预算与权限测试分别在同名测试文件中。这里的通过不等于正式 DSH 现场写入、已发布客户端或任意原生 React 插件面板已接入；作者合同第 11 节的动态 Web 插件宿主边界保持明确。
