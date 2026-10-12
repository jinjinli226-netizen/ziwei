# E02 后端本地预览候选

日期：2026-10-12（Asia/Shanghai）。基线 `6eaf7de850e627c038e90515e75b0baf4c7bcca9`，受管树 `C:\Users\25941\.codex\worktrees\v2-e02-hermes-bot\灵光爸爸拆解`，分支 `codex/v2-e02-hermes-bot`。状态：本地候选，未发布。前端与唯一长期预览由 E03 最终集成树负责，本树没有长期业务服务。

## 同一数字员工

`employees` 是唯一身份权威；`hermes_bots.employee_id` 一对一附加能力，`bot_routines` 一对一绑定既有 automation。Bot 创建返回的 `id` 就是团队数字员工 `id`，owner/visibility/workspace/模型/profile/设备共享。团队入口编辑汇入 Bot 服务，显示字段保留启用状态，运行相关变化要求重新验证；控制同步员工状态。删除后保留幂等意图与不可执行 Routine 墓碑，不能重建或降级执行。

现有普通 Hermes 员工：`POST /api/workspaces/:slug/employees/:id/bot`，稳定 `idempotencyKey`，可选 config。保留 employee ID 与最近活动聊天，不增加员工、不复制来源私有记忆或认证。初始化明确转 draft。旧 Creator 拒绝此初始化，保留原管理者人格/HOME/记忆/会话；执行 prompt 附加版本化 `ziwei_bot` 指导，公共模板实例仍各 workspace 独立。

完整接口见 [API 合同](../contracts/2026-10-12-hermes-bot-api.md)。控制请求必须含 `expectedControlEpoch`，从最近 Bot 回读取 `control_epoch`。Routine 操作响应不明时，复用原 `idempotencyKey` 与原参数回读/重试，不能换标识重复运行。主聊天中的 runtime/model/profile/device 由 Bot 保存配置控制，不允许临时越过验证。

## 生效和运行

每次执行冻结 config revision、control epoch、employee、设备、profile、模型、具体 conversation。新执行在创建、ACK 和本机 spawn 前复核；结果补传续租保持原设备/工作区身份且不要求 Bot 仍 active。单 Bot 持久占用，busy/uncertain 不允许再开始；原生 message_agent、Cron、Goals、Heartbeat、Kanban 自主驱动尚未纳入执行门，因此入口明确未集成。

Hermes 使用员工私有 HOME，按 origin/workspace/employee 稳定生成。没有复制 `auth.json/.env/来源memories`，认证由原生单一来源存储处理；API key 仅内存引用。自定义 provider 必须用 key_env，字面 API key 复制明确拒绝。原生 managed policy 与保存值冲突会在模型开始前报告字段；宿主额外 MCP 被过滤，read_only 禁全部工具与 MCP，execute 仅使用显式工具集和本执行授权的 MCP。HOME 不是操作系统沙箱。

原生 native Chat 按具体 conversation 的稳定标题恢复同一 SessionDB 会话；普通 Hermes 的平台历史同时有界注入16条/12000字符，Creator原路径保持。源码 `0.21.3` 的 `--version` 入口可能在3秒内未结束，已改为绑定真实 launcher 解释器、核实 native entrypoint 并读取原生模块版本；不把静态 metadata 伪装成可运行证据，不升级安装。

## 隔离预览启动

E03 先查询端口登记与实际监听，最终在它的集成树启动**唯一**预览。沿用 `backend/app.mjs` 的导出 `startServer(options)`，可传真实已支持的 `port/host/filename/objectStoreDir/enableScheduler/authOptions`。例如写一个仅在 `.local` 的启动模块，导入 startServer，传：

```js
startServer({
  host: '127.0.0.1',
  port: previewBackendPort, // 由实际避让/登记结果给定
  filename: absolutePreviewSqlite,
  objectStoreDir: absolutePreviewObjectStore,
  enableScheduler: false,
  requireAuth: true,
  requireDeviceAuth: true,
  authOptions: { cookieName: 'ziwei_preview_e03_session' }
});
```

`filename`、对象目录、启动模块、日志、账号与所有测试数据均在集成树 `.local/preview`；数据库从空库建立，禁止复制生产库。`FRONTEND_ORIGIN` 设实际 loopback 前端地址，再由 E03 沿 Vite 原生 `--host 127.0.0.1 --port <已避让端口>` 启动。不要用原4178/5178/20242。独立 cookie 防止同 localhost 的正式登录被覆盖。首版预览不接现有正式 daemon/手机/MCP，不用正式来源 profile；真实CLI验收用下方临时HOME与假模型工具，不虚构在线设备。

预览进程的持久 stdout/stderr、启动/退出/PID/退出码/10–30秒心跳和独立健康/退出观察由 E03 最终启动器落实并登记绝对日志路径及状态。本树只有短时测试服务器与CLI子进程，已收尾；没有为验收重启/停止正式服务。

## 可复现检查

- `npm ci --ignore-scripts`（只在隔离树）。
- `node --test test/hermes-bots.test.mjs test/hermes-bots-api.test.mjs test/hermes-bot-runtime.test.mjs`：配置/身份/幂等/暂停/不确定/Routine/两个入口/独立cookie。
- `node scripts/verify-hermes-bot-native.mjs`：真实安装 Hermes、临时 source/HOME、loopback 假 Chat Completions、禁止非loopback socket；两轮同 native session、第二轮有第一轮上下文、无工具、真实 Windows Job退出。输出 `.local/native-bot-acceptance-<stamp>/receipt.json`。不是外部模型验收。
- `npm test`、`npm run lint`、`npm run build` 与 `git diff --check`，以最后回执为准。

本次 native 通过证据：`.local/native-bot-acceptance-1791818450838/receipt.json`，0.21.3，两个root exit0、Job activeProcesses0，session `20261012_232055_70958d`，请求messageCount2→4。另保留最初CLI版本超时、假模型context window不足、loopback代理502及新增隔离门捕获宿主MCP的失败日志，修复后回归通过。正式 provider/OAuth业务模型、跨Bot原生协作、外部Gateway、语音、全天24小时耐久运行未验证。

冻结前最新 native 回执：`.local/native-bot-acceptance-1791819347072/receipt.json`，session `20261012_233551_fa65b6`，两个进程31320/10624退出0、Job均空。冻结前专项16/16、全量725/725、lint82、构建1764模块；独立静态审查发现的初始化uncertain遗漏与旧员工PATCH激活epoch遗漏已修复并加入回归。`git diff --check`没有空白错误（Windows换行提示不是失败）。正式Q和E03界面/预览日志验收仍按它们的实际回执。

## 全量原生能力对照

本机只读核实：安装 metadata/PKG-INFO `0.21.3`，源码 HEAD `bbaf7af5c83546d19f8060f4097d3bb25cd1a3c3`；既有4处修改未触碰。官网当前陈述与本机静态支持、紫薇接入状态分别判断。

| 能力 | 本机0.21.3源码 | 本候选接入/证据与剩余工作 |
| --- | --- | --- |
| Bot身份/profile | SOUL/profile.yaml/Bot mode实现存在 | 同employee独立HOME与主聊天；原生跨Bot protocol关闭，待统一受控驱动 |
| 持久聊天/恢复 | chat -c/--resume，SessionDB压缩链 | 两轮真实CLI同session，平台历史有界；外部模型待独立验收 |
| 记忆/会话检索 | memory开关、独立HOME、session_search | 原生本地记忆隔离/开关生效；记忆浏览/管理UI和检索工具实际调用仍待接入 |
| 模型/provider | config model/provider/custom providers/key_env | 保存→快照→原生配置→loopback请求证据；自定义字面key不复制，正式OAuth实际运行未验 |
| 技能 | skills.disabled/autoload/hub | 禁用配置进入原生；essential不能关闭时明确拒绝；平台技能正文沿既有prompt，原生安装/hub管理待接入 |
| 工具/MCP | 原生toolsets/stdio/HTTP/filter | 显式工具集与stdio配置进入原生，权限门无工具实测；Bot自定义MCP实际工具成功、HTTP MCP高级配置待验收 |
| Cron/Routines | native cron持久计划和Gateway ticker | 紫薇既有automation唯一调度，绑定Bot/聊天/身份与结果；native Cron未启动，不双调度 |
| 群聊/@/Bot消息 | bot_mode_dm、groups driver/RPC | 原生会自行spawn目标，紫薇统一权限/暂停桥未接；明确not_integrated |
| 委派 | delegate_task/model/provider/limits | 统一执行控制未接；禁自主委派工具集，明确not_integrated |
| Gateway/跨设备 | platforms/profile_routing/peer API | 真实平台凭据、网络、allowlist与Gateway驻留未接；无外部发送 |
| 语音 | stt/tts/voice原生支持 | 音频设备、provider、codec和驱动未接，明确not_integrated |
| 图片/多模态 | chat --image与vision | 沿既有Hermes单图附件/结果链；模型视觉能力未实测 |
| Goals | 有界judge/continuation状态 | quiet prompt不是slash控制；原生驱动与暂停门未接 |
| Heartbeat | 会话idle poll/SessionDB watch | 不以one-shot伪装驻留；驱动和事件桥未接 |
| Kanban | native CLI/DB/dispatcher | 依赖/worker/调度权限桥未接，不与紫薇自动化双触发 |
| 运行/可观测 | stream-json/native日志 | session、配置revision、隔离/Windows退出回执、现A2A events与主聊天结果；产物沿现附件机制，结构化时间线待UI集成 |

一手资料：[Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode)、[Profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles)、[Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)、[Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)、[MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)、[Cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)、[Messaging](https://hermes-agent.nousresearch.com/docs/user-guide/messaging)、[Delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)、[Voice](https://hermes-agent.nousresearch.com/docs/user-guide/features/voice-mode)、[Vision](https://hermes-agent.nousresearch.com/docs/user-guide/features/vision)、[Goals](https://hermes-agent.nousresearch.com/docs/user-guide/features/goals)、[Heartbeat](https://hermes-agent.nousresearch.com/docs/user-guide/features/heartbeat)、[Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)。未接入项是后续实际开发缺口，不代表全量任务已完成。

回滚：候选未上线，不对正式库执行回滚。最终预览关闭仅处理精确预览PID；回到上一代码提交后保留预览数据与日志。新增表为兼容附表，不要求删除既有SQLite。
