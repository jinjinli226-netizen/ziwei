# 数字员工·Creator 实现与操作记录

## 当前状态

**已发布并完成本轮验收。** 生产代码 `db0aa68b0735c30c65acdf342c3080655892a286`，发布时间 UTC `2026-10-09T16:08:06Z`，北京时间 **2026-10-10 00:08:06**。正式 `phone_ai` Creator 与首个用户对话保留；真实 Hermes 四阶段、两个子任务、历史追问、精确清理、保护数据和线上布局通过。本文文件名沿用任务开始的 UTC 日期。

用户最新要求取消 Codex 真机排障与验收，不恢复该项；模板继续支持明确选择 Codex。本轮实际使用原生 Hermes，实际证据如下。用户暂时无法操作手机，手机实机验收暂缓；手机动作、邀请消费和新设备配对均为 0。

## 用户操作

1. 登录并切到目标工作区，让实际选定电脑原有的 `ziwei_user` 保持在线。
2. “团队管理（成员与设备）→ 添加数字员工 → 从伙伴市场创建 → 数字员工·Creator”。
3. 明确选择在线电脑和 Codex/Hermes。Hermes 优先使用真实发现且认证/provider 已就绪的 `default`，否则仅在唯一就绪 profile 时自动选择；多个独立就绪 profile 时明确选择。显式 profile 不回退。模型默认沿用 CLI/profile。
4. “创建并开始对话”返回绑定员工及所选电脑的持久聊天；市场默认创建个人可见实例。已有实例直接打开，同成员、同工作区、同模板重复创建复用原实例，不覆盖定制配置。
5. 明确请求创建或维护岗位员工。Creator 应实际发现环境、配置并回读员工，再执行低影响小任务，回读 task/action、管理 MCP 工具回执和业务结果。只有真实执行成功且结果满足要求才能报告完成；失败保留原 ID 和上下文，不以更换标识盲目重建。

不要求复制提示词、管理 bearer、设备凭据或 provider 密钥。安装模板不会自动授予手机能力、分配手机或执行手机动作。

## 实现范围

- 静态目录：`backend/employees/creator-template.mjs`，模板 `ziwei-employee-creator`，目录版本 `1.0.0`，名称“数字员工·Creator”。职责、人格与操作指令分别保存；静态技能为空，执行时只选择真实发现的技能。
- 实例服务：`backend/employees/templates.mjs` 复用现有 `management.createEmployee` 和持久聊天，不建立独立员工系统。Actor 来自认证，并以实际成员记录确定角色；请求体身份或角色字段不提升权限。
- 持久来源：`employee_template_instances` 记录 workspace、owner、employee、template/version、origin、初始配置 hash 和 conversation。`workspace + owner + template` 唯一，employee 外键级联删除，conversation 删除置空。迁移仅新增表，不改写旧员工或手机配置。
- 创建员工、来源记录、会话和管理幂等记录在同一事务中提交。失败全部回滚；审计通知在提交后发布。明确不同安装配置返回 409；POST `{}` 复用已安装实例并保留原配置。
- 历史采用：仅同 owner、同名且环境配置兼容的 Creator 可采用，不覆盖原职责、人格、指令和技能。返回 `origin: adopted-existing`、`customized: true`、`templateApplied: false`、应用版本 `null`，避免把未应用过的模板记作已套用。
- 前端：`CreatorMarket.vue`、`creator-market.js` 和显式工作区 API，展示目录、实际电脑/运行时/profile、失败与重试、已有实例和持久聊天。目录不返回用户人格、指令、凭据或配置原文。
- 工作区与聊天请求：`load()` 按请求代次和当前工作区提交结果；切区立即清空旧会话、执行状态、草稿、附件和路由并停止轮询。对话打开也按代次保留最新选择，打开失败不报告 Creator 已成功进入聊天。Hermes helper 只接受明确的认证/provider 就绪证据，未知状态不能启用创建。
- 持久会话目标：同区刷新已有会话时保留其 `device_id`，旧会话没有保存该字段时保留当前绑定；仅未选定会话才使用第一台在线电脑。双设备、第二台绑定及延迟会话列表已验证，不在加载窗口切换发送目标。
- 有界聊天历史：仅服务端可信 Creator 来源及同员工、同工作区的绑定会话附带历史；当前消息必须是该会话中的 user 消息。最多最近 16 条 user/assistant 文本，历史 JSON 序列化长度不超过 12,000 字符，按时间顺序呈现，排除当前消息和附件；历史明示为引用数据，不构成新增执行授权，不覆盖当前请求。
- Hermes 实例状态：`creator-runtime-home.mjs`、原生 bootstrap 和运行时适配器按 API origin、workspace、employee 绑定持久私有 HOME，source profile 更改要求明确迁移。记忆、用户画像、state、SOUL、sessions/logs 使用实例目录；配置初始值使用白名单，认证和 `.env` 不复制或链接。原生认证仍使用所选 source 的单一存储及原锁、原子刷新路径，管理 MCP 保持执行 overlay，ordinary 执行清理 Creator 路由环境变量。实际 native 隔离确认从 stderr 精确匹配 `result.creatorIsolation`；缺少确认即使退出码为 0 也失败。
- 当前隔离适配边界：Creator Hermes 仅支持已核实的 `openai-codex` 原生认证路径和本地 memory；其他 provider 或尚无独立 namespace 证据的外部 memory provider 在模型启动前明确失败。Codex 状态隔离本轮未实现或验收，用户取消的 Codex 实机任务保持取消。手机能力仍须独立安装、绑定和执行授权，管理 MCP 默认接入与 Creator 模板不改变此边界。
- 调度：每 connection 最多 3 个动作，同员工互斥；聊天与具有服务端可信 Creator 来源的父任务共用一个管理槽，为普通岗位子任务保留容量。`employeeTemplateId` 从实例表生成，忽略请求体伪造；pending/acked 动作恢复可信标记，终态历史不改写。

模板更新只自动用于新实例。已有实例仍显示自身应用版本和目录版本，用户定制保留；兼容的历史采用记录不伪称应用过目录版本。

## API 合同

| 接口 | 行为 |
| --- | --- |
| `GET /api/workspaces/:slug/employee-templates` | 返回目录及当前 actor 自己的实例 metadata；即使 owner/admin，也不汇总其他成员实例。 |
| `POST /api/workspaces/:slug/employee-templates/:id/instances` | 输入 `targetDeviceId`、`runtime`，可选 `runtimeProfile`、`model`、`visibility`；新建返回 201，复用/采用返回 200。 |

POST 返回 `{employee, conversation, template, duplicate}`。`template` 包含 `id`、应用 `version`、`catalogVersion`、`origin`、`customized`、`templateApplied`。GET 的 `instance` 包含员工/会话 ID、应用版本、runtime/profile、目标电脑、模型和可见性；`updatePolicy` 为 `new-instances-only`。

主要错误包括 `TEMPLATE_NOT_FOUND`（404）、`TEMPLATE_INSTANCE_CONFIG_CONFLICT` / `TEMPLATE_EXISTING_EMPLOYEE_CONFLICT`（409）、`TEMPLATE_PROFILE_SELECTION_REQUIRED` / `TEMPLATE_PROFILE_NOT_READY`（400），以及现有设备、CLI、认证/provider 和 profile 错误。匿名请求拒绝，跨工作区设备拒绝；个人工作区成员仍受设备 ownership 限制。普通 API key、请求体 actor 和 device capability 字段不能代替网页登录身份。

## 已完成的本地验证

2026-10-10 本地验证：以下结果使用内存、合成数据或安装的 Hermes launcher 搭配合成 HOME/auth；生产域名和实际模型的独立结果见下文。最后 `.env` reserved routing 补丁已完成独立原生复核，并重新通过完整 398/398、skip 0、exit 0 验证。

| 范围 | 结果 | 说明 |
| --- | --- | --- |
| 新模板 API `test/employee-templates-api.test.mjs` | 23/23 | 成员隔离、伪造身份、跨区与私有设备、重复并发、自定义保留、实际 profile、历史采用/冲突、版本保留、事务回滚、提交后通知、可信执行来源及有界历史/会话绑定边界。 |
| 静态目录 `test/creator-template.test.mjs` | 7/7 | 真实工具/schema、行为与授权、运行时/profile 保留、目录深拷贝和模板配置。 |
| 调度 `test/daemon-action-scheduler.test.mjs` | 6/6 | 父任务等待普通员工子任务、管理槽预留、同员工串行、有界并发、重复轮询和失败释放。 |
| 完整项目 `node --test` | 398/398，exit 0，skip 0 | `.local/creator-platform/full-test-final.log`；包含最后 reserved routing 补丁，涵盖相关 API、员工/聊天、repository、身份/设备、管理 MCP/auth、手机边界及新增隔离测试。 |
| lint / 前端 build | 60 个源文件通过 / build 通过 | `.local/creator-platform/build-final.log`；当前资源 `index-DRTDY7kv.js` / `index-CJMLdFH9.css`。 |
| Creator helper/API/scope | 11/11 | helper 5、显式工作区 API 1、实际 App 函数行为 5；包括旧区 load 迟到、同区旧对话迟到、切区禁止旧目标发送、打开失败无成功提示、第二台电脑绑定保留。 |
| Creator headless fixture | 12/12 | `.local/creator-market-ui-device-final/results.json`；1440×900、390×844、720×450，创建/刷新/已有实例/键盘、default/歧义、失败恢复、重复、409、缺会话补建、未知认证与两类切区竞争。pageErrors/requestfailed 均 0；console 2 条为预期 503/409。 |
| 组织卡片与设备列表 headless fixture | 15/15 | `.local/creator-platform/team-final/results.json`；包含 1440、2048、2549、390×844、720×450 和 3/12/无描述员工场景。三张长职责卡片在桌面/390/矮窗口均为 126px，摘要 28px 两行，组织列表与设备区域间隔 32px，无横向溢出；详情/编辑保留完整指令，所有错误统计为 0。 |
| 创建/编辑弹窗 headless fixture | 12/12 | `.local/creator-platform/modal-final/results.json`；五种视口含 720×450，checkbox、label、键盘、正文滚动、footer、phone 继续与自动管理准备/恢复。pageErrors/console/requestfailed 均 0。 |
| 手机技能界面 headless fixture | 12/12 | `.local/creator-platform/phone-final/results.json`；全部为合成 API/手机回执，未执行实际手机动作。pageErrors/非预期 console/requestfailed 均 0，另 1 条预期 HTTP 503。 |
| 管理 MCP headless fixture | 13/13 | `.local/creator-platform/management-final/results.json`；官方安装入口、默认接入、状态/工具失败、重试、profile、scope 等回归。pageErrors/requestfailed 均 0；console 2 条均为预期 503 恢复场景。 |
| 邀请 headless fixture | 6/6 | `.local/creator-platform/invitation-final/results.json`；独立 `:memory:` SQLite，页面错误/非预期响应均 0。该脚本未采集 console/requestfailed，不把未采集指标记为 0。 |
| Creator Hermes native 无模型隔离 | 9/9，skip 0；相关 47/47 | `.local/creator-platform/runtime-isolation-fixture-result.json`；安装的 native launcher、3 个合成实例、default/selected 与两工作区，验证 memory/state/SOUL、原 source config/SOUL 不变、认证只在合成 source 原存储刷新、scope/profile/alias/provider/外部 memory 拒绝。native main/模型调用/真实手机动作均未执行。 |
| exact cleanup synthetic SQLite | 16/16 | `.local/creator-platform/cleanup-qa-fixture-result.json`；QA owner 必须等于保留正式 Creator 和 provenance owner，visibility 必须 personal；其他成员同前缀或缺 owner 均拒绝。固定 phone_ai/前缀、正式实例/原聊天/metadata、exact IDs、计划 hash 和执行门保护仍通过。0 生产 DB/execute、网络、手机动作。 |
| Git diff whitespace 检查 | 通过 | 无 whitespace 错误，Git 仅提示已有 CRLF 转换设置。 |

23、7、6、前端 helper/scope 和 native 单测已包含在完整项目快照中，不能相加当作额外单测。headless fixture 和 Python cleanup 是另行执行的验收，不与 398 相加。新 API 先确认缺少入口的 RED，再实现 GREEN；提交前事件、可信模板标记、请求竞争和第二台设备也分别观察失败后修复。清理 owner/visibility 新增 5 个负例在原 11 项基础上先产生 5 个 RED failure，再达到 16/16 GREEN。

旧 workspace load 覆盖新 workspace、切区残留旧发送目标、同区迟到旧对话、未知 Hermes 认证/provider 被视作 ready、同区刷新改成第一台电脑等审查项均已本地修复并通过行为与浏览器回归。独立只读 scope/helper/API 复核通过；持久 HOME/native auth/ordinary env/stderr receipt/手机边界也已只读复核。本地证据中的“成功”仅适用于各行明确的测试环境。

运行时 reserved routing 补丁完整复验已通过。下述生产记录来自本轮实际执行，不借用上一轮默认管理 MCP 或本轮无模型 native fixture 结果代替。

## 发布与正式实例

| 证据 | 本轮实际值 |
| --- | --- |
| Git full SHA | `db0aa68b0735c30c65acdf342c3080655892a286`，已推送 `codex/ziwei-terminal-console`；文档收口另行提交，不重发业务代码。 |
| 生产 release / 时间 | `/opt/ziwei/releases/db0aa68`；UTC `2026-10-09T16:08:06Z` / 北京时间 `2026-10-10 00:08:06`；原版本 `/opt/ziwei/releases/1ca9c6b`。 |
| 前端与旧资源 | `index-DRTDY7kv.js` / `index-CJMLdFH9.css`；旧 `index-Caqrwk2Y.js` / `index-C30xBdgl.css` 及更早资源保留；新旧 HEAD 均 200。 |
| 健康 / Nginx | API、控制、Nginx 三服务 active；主 healthz 200；Nginx SHA `faf170c39866d8c307ed68cc49d96cf7cc28dfac442e979d3f3d8c35cf494967` 不变；保留 `/terminal-mcp/v1/` 与 `/downloads/android/`。 |
| 服务与 APK | 本次只重启 `ziwei-api.service`；控制保持 `8a4fe59`；APK versionCode 15、两个下载 HEAD 200。本轮未下载校验 APK hash，也未操作手机。 |
| 发布前备份 | `/opt/ziwei-backups/creator-platform/20261009T144859Z`，main/control DB integrity ok、14 个配置备份；签名 key 仍为私有原文件。正式创建后独立保护基线 `/opt/ziwei/.local/creator-platform/formal-baseline.sqlite`。 |
| 官方客户端包 | [ziwei-latest.tgz](https://qzelynth.top/downloads/cli/ziwei-latest.tgz)，24 文件、73936 bytes，SHA-256 `355aef510a8d52d43308e73d580a7aa93a9390bfd14be2a57d3288fc8c4c04ee`；公开 GET/HEAD、metadata、实际本地包一致。包从 Git archive 独立目录生成，未包含工作树 ignored 字节码缓存。 |
| 原安装与持续诊断 | 原入口 `D:\work\nodejs\node_global\ziwei_user.cmd`；只替换核实的原 PID48208 后沿原入口启动，PID48624 ready；build `ca0807e0a3f3ace0fa9184c58886dd5e14e76191aae97982865d27caa0800068`，原 config hash 一致、20242 不变。外部 observer PID33376 记录 target48624 周期 heartbeat/health/ready。 |
| 客户端备份 / 日志 | `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解\.local\creator-platform\client-before-20261009T160831233Z`；日志 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\logs\daemon.log`、`client-upgrade.jsonl`、`client-exit-watch.jsonl`（后两者同绝对父目录）。日志保留启动/升级停止请求/ready/独立心跳历史。 |
| 正式员工 / actor | `employee_743801eb-189d-4a57-bb57-64adebf7b571`；owner `user_c6deeadf-d2b3-43c2-820d-644d5829acf2`；workspace `phone_ai`；默认 personal 可见性。 |
| 模板来源 | `ziwei-employee-creator` / `1.0.0` / `origin: template` / `customized: false` / `templateApplied: true`。 |
| 实际运行环境 | zheng Windows，`device_f9568c06-d932-4264-9d4c-acc5122097ea`；Hermes `default`；保存的 model 为继承默认，本次 Creator 四次实际结果均 `gpt-6.1-sol`、exitCode 0。普通子员工 result.model 为 null，表示 CLI 默认，不把它冒充已回执的模型名。 |
| 正式首个聊天 | `conv_3c72ac45-1551-44d2-a1ed-c0900adc137a`；[打开对话](https://qzelynth.top/phone_ai/inbox/conv_3c72ac45-1551-44d2-a1ed-c0900adc137a?employee=employee_743801eb-189d-4a57-bb57-64adebf7b571)。三个视口刷新复用同会话；POST `{}` 实测 200 duplicate、配置与原 ID 保持。 |

## 真实 Hermes 验收

| 场景 | 通过条件 | 实际证据 |
| --- | --- | --- |
| 市场与持久对话 | 实际选电脑、刷新复用同实例/会话 | 线上 1440×900 / 390×844 / 720×450 三场景通过；原正式对话保留。首次脚本等待 networkidle 超时，改用实际 DOM 就绪后通过，无员工重复创建。 |
| 默认管理 MCP 与独立状态 | 同次原 action 的 loaded/工具/native 路由回执 | 四个 Creator action 与两个子任务均 succeeded/exit0/loaded；四个 Creator 的 `creatorIsolation` key 为 `e04bb6b8c9ba7ec9f36a13adf8f07d67b090d521ada065509e0531a05b8a9cd1`，workspace/employee/default 均一致。实际私有 HOME 有 state.db/SOUL，无复制 auth.json/.env。 |
| 自然语言创建 | discover/list/create/get 实际回读 | 两名 child 名称 `QA-Creator-20261009-Hermes-A/B`；ID `employee_c2865d71-dc26-4f68-90ff-c9064b4ceccf`、`employee_7134fb87-7f52-4c15-91ba-e875683084e6`；Hermes/default/精确电脑/owner/personal/描述与人格回读正确。由模型经工具创建，宿主未代建。 |
| 两个子任务 | 原 task/action succeeded，工具和结果匹配 | `task_05072f39-409a-462a-ae5a-1b2eb576e782` → `action_494a6413-2da7-42fb-91e0-1eb73bb4f6ac` 输出 `CREATOR_CHILD_0_OK`；`task_5530b589-8189-4cc1-be08-35b19b0701b7` → `action_2b310f1a-801d-4031-8979-71dfd9e96733` 输出 `CREATOR_CHILD_1_OK`；各自实际 `ziwei_mcp_health` ok，MCP receipt.action_id 精确匹配。父任务等待期间子任务持续执行。 |
| 安全失败与修正 | 原失败真实报告、正确意图继续 | phase-create 首次 get 明确不存在的 QA 标识实际失败，未创建该名字；随后 discover/list/create/get 两名正确岗位成功。 |
| 幂等与配置保持 | 同 key 重试回原 ID | phase-repeat 两次真实 createEmployee 复用相同参数/key 返回原两员工；仍仅两名、两任务。正式模板 POST `{}` 复用原员工/首会话且配置 hash 不变；将来模板升级不覆盖定制另有 API 单测，未实际发布第二模板版本。 |
| 历史追问 | 当前请求无资源 ID，由历史取原 ID 并回读 | phase-history 同 QA convo、前轮已完成，初始 payload 实际 assistant 历史包含两员工/两任务/两子 action；6 条、7185 JSON 字符。模型只调用 getEmployee/getTask/getAction 成功覆盖六原 ID，无 list/create。历史是在派发时取快照，提前排队的新问不包含随后才完成的助手回复。 |
| 实际布局与本地交互 | 卡片不重叠、三个视口/两工作区 | 线上 `test_222`、`phone_ai` 共 6/6 场景、18 截图，card 126px、摘要两行、org→environment 32px；无横向溢出，page/console/requestfailed/unexpectedResponse 均 0，6 contexts 全关闭。键盘、错误重试与切区/第二电脑竞争由上文 fixture/单测覆盖。 |

四个 parent 原 ID：create `action_d7b9d61b-428b-4369-b436-dc56e5ae65ca`；verify `action_4f1cd7fd-9f12-4f5d-8e0c-be03bce431c5`；repeat `action_1df56645-af5f-46dc-9ca2-ee48c4ddef70`；history `action_96be383d-2c6e-4bc5-a2f6-005b247fb0ff`。安全回执留在 `.local/creator-platform/native-creator-qa-result.json` 与 `native-execution-detail.json`；上述临时 action/员工/任务已按精确计划清理，生产 get 不再返回这些 QA 记录。

Codex 本轮真机任务已按用户要求取消，不列作待完成项。手机本轮不执行动作，也不把旧手机 MCP 的加载证据写成手机业务通过。

## 精确 QA 清理与保护复验

清理基线须在正式 Creator 和首个正式持久聊天创建后捕获，把它们及全部非 QA template metadata 纳入保护范围。验收使用独立临时 QA 对话及枚举的子员工、任务、actions；临时对话可以绑定被保留的正式 Creator，清理必须按对话 ID 精确检查，不能按 parent 员工 ID 扩大删除。

| 项目 | 实际值 |
| --- | --- |
| 本轮 manifest | `.local/creator-platform/qa-resources.json`，固定 phone_ai + `QA-Creator-20261009`，2 employees / 1 QA convo `conv_045e2ec1-ca76-435a-a52f-507ed993b19a` / 2 tasks / 6 actions。保留 formal ID 单独列出，0 profile 清理。 |
| 审过的计划 | SHA-256 `ade946133e3b71e950643ff9fab26b68a88f8b223a3177bc2ed6d918ee9a6e70`；准确删除上述主资源及 8 conversation_messages、23 action_events、2 task_messages、4 management_requests；0 attachments / template_instances。 |
| 删除前保护 | 两 scope pending/acked queue 均 0；每个 QA owner 与 formal/template owner 相同且 personal；正式员工、首会话与来源记录纳入 baseline。 |
| 实际精确清理 | UTC `2026-10-09T16:22:00.053027Z`（北京时间 00:22:00），BEGIN IMMEDIATE 重建计划 hash 再精确删除、保护复验、FK 检查后提交；counts 一致，QAremainder 0。fixture 16/16 含 owner/visibility 负例。 |
| 原员工与保护表 | 发布前 7 原员工逐行不变，仅加入 1 formal；清理后对 formal-baseline main8 + 发布前 control10，共18表 count/stablehash 一致；8员工 managementMcp 全 enabled。 |
| 来源与首会话 | 正式 employee、conversation、employee_template_instances 整行与 baseline 一致，非 QA 会话/消息/任务/actions 保护通过。 |
| 手机/邀请/设备 | employee_phone_mcp、connect_bindings、invitations、设备/credential/grant/配对身份、控制10表均保持；无邀请消费、新配对或手机动作。 |
| 最终只读与健康 | `client-final-readonly.json` 18/18：两区自身200/匿名401/跨区403，PID48624/20242 ready；`health-final.log` UTC16:23:14 全通过；匿名 terminal MCP POST 401 JSON，0 action。 |
| QA session | UTC `2026-10-09T16:25:24.933Z`，精确撤销 `session_creator_platform_20261009`、删除服务器私有文件，本机 token 清除；旧 cookie 实际401。 |

正式 Creator、首个正式用户聊天、用户已有员工/定制、真实配对、邀请和手机数据均未作为 QA 清理对象。安全证据只保存 IDs、版本、状态、计数/hash 和脱敏回执；审计/通知及原生 Hermes 会话/诊断历史保留，没有宣称清空底层 CLI 历史。普通 QA 子员工不启用 Creator HOME 隔离，不能把其执行证据扩为普通员工状态已隔离。

## 回滚方案（已准备，未执行）

1. 记录待回滚版本、上一可用 release/前端/客户端及各备份的实际路径与 hash，核对正在运行的任务，保留完整失败证据。
2. 优先回滚本次应用代码、前端与官方客户端到匹配版本，沿用原服务和原端口。保留旧 hash 资源、Nginx 手机转发、控制服务、APK 和持久化诊断日志，不启动替代实例。
3. 新来源表为增量结构，代码回滚时保留表与正式员工/聊天。不要为恢复代码直接用整库旧备份覆盖发布后的真实业务数据；只有确认数据损坏并形成精确恢复范围后，才按实际备份实施数据恢复。
4. 回滚后复验主 API/客户端健康、匿名与跨区拒绝、原员工/手机/邀请/设备数据和保护表。旧串行客户端可能无法完成 Creator 等待子任务的流程，不能把代码启动成功当作 Creator 工作流已恢复。

主站代码回滚目标 `/opt/ziwei/releases/1ca9c6b`。在确认没有运行任务后，可在生产以独立临时 symlink 指向该目录，再 `os.replace` 原子替换 `/opt/ziwei/current`，仅 `systemctl restart ziwei-api.service` 并检查三服务/healthz/新旧 assets。控制端 `8a4fe59`、Nginx、APK 和数据不回滚。DB/config 原始备份为上表目录；正式 Creator 与新的来源表保留，不整库覆盖。

客户端回滚先复核正在监听20242的当前PID、安装路径与队列，停止核实的原客户端，恢复上表私有 `client-before-20261009T160831233Z/package` 和 `entries`，保持原 config 后沿 `D:\work\nodejs\node_global\ziwei_user.cmd start` 启动并重新验证身份/build/ready及外部 observer。官方包的旧版本和 metadata 位于服务器发布前备份的 `cli-before-ziwei-latest.tgz` / `cli-before-release.json`，恢复时核对它们的配套 hash。**本轮健康发布未触发回滚，没有把准备方案写成回滚已实跑。**
