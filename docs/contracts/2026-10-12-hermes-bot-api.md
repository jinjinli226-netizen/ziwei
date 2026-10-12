# Hermes Bot API v1 — E02 / E03 实施契约

2026-10-12。本文件是本次实现合同，接口实现与测试状态见后续验收记录；不得把合同当作已上线证明。

基线 6eaf7de；后端工作树 `C:\Users\25941\.codex\worktrees\v2-e02-hermes-bot\灵光爸爸拆解`，分支 `codex/v2-e02-hermes-bot`。前端由 E03 负责。

## 路径

所有新接口属于当前认证工作区 `/api/workspaces/:slug`；MCP 使用相同服务的 `/mcp/v1/workspaces/:slug`。

| 方法和相对路径 | 请求 | 响应 |
| --- | --- | --- |
| GET `/bots/capabilities?deviceId=...` | 无 | `{schemaVersion:1, workspace, deviceId, runtime, capabilities:Capability[]}` |
| GET `/bots` | 无 | `{bots:Bot[]}` |
| POST `/bots` | `BotCreate`，必传 `idempotencyKey` | `Bot`；201，新请求；200，duplicate |
| POST `/employees/:id/bot` | `{idempotencyKey,config?}` | 初始化现有 Hermes 岗位员工能力，返回同 employee ID；原员工和聊天保持，旧 HOME/记忆不迁移或覆盖；Creator 明确拒绝普通岗位初始化。 |
| GET `/bots/:id` | employee ID | `Bot` |
| PATCH `/bots/:id` | `{expectedRevision, employee?:EmployeePatch, config?:BotConfig}` | `Bot` |
| POST `/bots/:id/validate` | `{expectedRevision,idempotencyKey}` | `{action}`，202；异步本机配置检查，不调用模型 |
| POST `/bots/:id/control` | `{expectedRevision,expectedControlEpoch,operation:'activate'|'pause'|'resume'|'stop'}` | `Bot`；从最新响应取 `control_epoch`，防旧启用请求覆盖新暂停 |
| GET `/bots/:id/runs` | 无 | `{runs:Action[]}` |
| GET `/bots/:id/routines` | 无 | `{routines:Routine[]}` |
| POST `/bots/:id/routines` | `{name,prompt,schedule,timezone,idempotencyKey}` | `Routine` |
| PATCH `/bots/:id/routines/:routineId` | `{name?,prompt?,schedule?,timezone?,status?:'active'|'paused'}` | `Routine` |
| DELETE `/bots/:id/routines/:routineId` | 无 | `{id,deleted:true}` |
| POST `/bots/:id/routines/:routineId/run` | `{idempotencyKey}` | automation run，202 |

主聊天沿用现有 GET `/api/conversations/:conversationId`、POST `/api/conversations/:conversationId/messages`；消息带 `{content,clientMessageId,attachments?}`。主会话 ID 为 `main_conversation_id`。新 Bot 默认 draft，先 validate 回读 action succeeded，再明确 activate。旧 Creator 不自动转为 Bot，旧 HOME/记忆/会话保持。

团队管理的数字员工是唯一实体。Bot 附表 `hermes_bots.employee_id` 一对一引用 employee；两入口创建、名称/模型/人格编辑、暂停、删除均操作同一个 ID。团队管理原 PATCH 员工接口会将已有 Bot 的修改汇入本服务，运行配置变化同样转 draft 并等待验证；暂停同步 employee.status。Bot 列表来自同工作区/owner/visibility 的 Hermes 员工列表。尚未初始化的既有员工返回 `configuration_state:'uninitialized'`、`revision:0`、`main_conversation_id:string|null`；前端应提供初始化入口，禁止以新建 Bot 替代。`kind:'creator'` 表示原受信 Creator，保留其管理/会话路径，普通岗位初始化不适用。

## 类型

```ts
type BotCreate = {
  idempotencyKey:string;
  name:string; targetDeviceId:string; runtimeProfile:string; model?:string;
  persona?:string; description?:string; instructions?:string;
  visibility?:'personal'|'workspace'; skills?:string[];
  config?:BotConfig;
};
type BotConfig = {
  provider:string|null; // null 沿用来源 profile
  toolsets:string[]; // 原生工具集；默认 []，明确配置后才开启工具
  maxTurns:number; // 1..100，默认 20，有界单次执行
  memory:{enabled:boolean,userProfile:boolean};
  skills:{disabled:string[]};
  mcpServers:Record<string,{command:string,args:string[],env?:Record<string,string>,enabled?:boolean}>;
  permissions:{mode:'read_only'|'execute'}; // read_only 原生无工具，只对话；execute 才使用明确选择的工具
};
type Bot = {
  id:string; employee_id:string; workspace:string;
  employee:Employee; config:BotConfig; revision:number;
  control_state:'draft'|'active'|'paused'; control_epoch:number;
  main_conversation_id:string; scheduler_authority:'ziwei';
  validation:{status:'not_checked'|'pending'|'succeeded'|'failed'|'stale',action_id:string|null,revision:number|null,error:string|null};
  latest_run:Action|null; capabilities:Capability[];
  duplicate?:boolean;
};
type Capability = {
  id:string; label:string;
  status:'available'|'requires_configuration'|'requires_dependency'|'unsupported_version'|'not_integrated'|'unknown';
  configurable:boolean; reason:string; evidence:string[];
};
type Routine = Automation & {employee_id:string;conversation_id:string;authority:'ziwei'};
```

能力全集至少包含 `bot_identity, persistent_chat, profile_memory, model_provider, skills, tools_mcp, routines, groups_mentions, delegation, gateway, voice, multimodal, session_search, goals, heartbeat, kanban, observability`。status 是连接与实现证据，不是按官网或已安装版本号自动标绿。缺依赖和未接入必须具体展示；未知/未支持配置请求报错，禁止静默保存。

## 生效与错误

配置采用完整 config 对象替换；employee 采用 PATCH。运行配置、model、persona、instructions、skills 的实质变化才使 revision 增加并让验证过期。name/avatar/description/visibility 对显示与后续身份快照生效，不停掉 Bot、不撤销验证；空修改直接读回。employee PATCH 仅允许上述八个字段。运行配置在途不可变，先暂停/停止并等待实际终态。source profile、设备迁移不自动执行。Bot 配置进入实际执行 payload；独立 HOME 按服务 origin/workspace/employee 生成，禁止用户自报路径。每次执行记录配置 revision 与隔离回执。

错误为 `{error:string,code:string}`。冲突 409（revision、在途、已删请求、暂停/未激活/未验证）；越权或资源不存在 404/403；非法或未知配置 400；依赖尚未满足 409。`EXECUTION_UNCERTAIN` 保留占用与原 action，不重跑业务。Routine 复用既有 automation tick、schedule/timezone/next_run，禁止启用同意图的 Hermes native Cron。暂停不代表正在运行的子进程已经停止；stop 必须展示实际确认结果。

本机 validate 是无模型的配置检查；运行回执才证明模型/工具加载。持久聊天的有界平台历史是立即可用路径，原生 session 恢复只有实际接入并验证后才标为 available。全量能力接入仍持续实施，`not_integrated` 不等于项目完成。
