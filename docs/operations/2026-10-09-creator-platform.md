# 数字员工·Creator 实现与操作记录

## 当前状态

2026-10-09：本功能已完成本地实现和下述指定范围测试，**尚未部署**。本记录先保存实现、验收与回滚骨架；正式发布、真实实例、Hermes 自然语言任务和清理结果均待 root 上线后填写，不能据本地测试宣称生产已通过。

用户最新要求取消 Codex 真机排障与验收，不恢复该项；模板继续支持明确选择 Codex。当前真实验收计划使用已有验证证据的 Hermes，仍须重新记录本轮 Creator 实际执行结果。手机动作、真实手机业务、邀请消费和新设备配对不属于本轮验收。

## 用户操作

1. 登录并切到目标工作区，让实际选定电脑原有的 `ziwei_user` 保持在线。
2. “成员与设备 → 添加数字员工 → 从伙伴市场创建 → 数字员工·Creator”。
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

2026-10-10 本地验证：代码已本地提交，尚未发布。以下结果使用内存、合成数据或安装的 Hermes launcher 搭配合成 HOME/auth；不代表真实模型、生产域名、正式实例或生产客户端执行通过。最后 `.env` reserved routing 补丁已完成独立原生复核，并重新通过完整 398/398、skip 0、exit 0 验证。

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

运行时 reserved routing 补丁完整复验已通过。真实生产、正式实例、实际 Hermes 模型和客户端验收由 root 后续填写；下述生产记录保持待验证，不借用上一轮默认管理 MCP 或本轮无模型 native fixture 结果代替。

## 发布与正式实例：待验证

| 证据 | 本轮实际值 |
| --- | --- |
| Git full SHA / 推送时间 | 待验证、待填写 |
| 生产 release 目录 / 原子切换时间 / 时区 | 待验证、待填写 |
| 前端 JS/CSS hash 与旧资源保留 | 待验证、待填写 |
| 主 API 健康 / Nginx 管理与手机路由 | 待验证、待填写 |
| 控制服务版本、APK 与其他服务是否变化 | 待验证、待填写 |
| 发布前 DB/config/Nginx 备份路径 | 待验证、待填写；只记录路径及安全 hash，不记录凭据值 |
| 客户端官方包 URL/hash / 原全局入口 / PID / build | 待验证、待填写 |
| 原工作区、设备身份、端口 20242 与持续 ready | 待验证、待填写；不得为验收启动替代业务实例 |
| `phone_ai` 正式 Creator employee ID / owner / visibility | 待验证、待填写；可见性须记录实际明确选择 |
| 正式实例 template/version/origin | 待验证、待填写 |
| Hermes runtime/profile/model/精确电脑 | 待验证、待填写；不输出 auth/provider 私有配置 |
| 首个正式持久 conversation ID / 刷新后复用 | 待验证、待填写；正式员工和首个用户聊天保留 |

## 真实 Hermes 验收：待验证

| 场景 | 通过条件 | 实际证据 |
| --- | --- | --- |
| 市场创建并打开对话 | 实际所选电脑持久绑定，刷新后直接打开同实例/会话 | 待验证、待填写 |
| 默认管理 MCP | 本次执行实际握手 `loaded: true` 且所需工具真实成功 | 待验证、待填写 action ID/安全回执 |
| 自然语言创建岗位子员工 | Creator 经真实工具发现环境、创建并 get 回读精确配置 | 待验证、待填写 employee ID 与工具结果 |
| 低影响任务 | 原子任务/task 与 action 回读 succeeded，真实产物满足请求 | 待验证、待填写 task/action ID、结果；父任务不因等待子任务堵住轮询 |
| 安全失败及恢复 | 明确报告原错误，保留原意图/ID，按修正参数完成可核实结果 | 待验证、待填写 |
| 重复与定制保留 | 同实例重试复用，保存的人格、指令、技能及未请求配置不被覆盖 | 待验证、待填写 |
| 桌面、390px、短窗口、键盘与切区竞争 | 创建、刷新、已有对话、错误重试可用，无旧 scope/旧对话回写 | 待验证、待填写 |

Codex 本轮真机任务已按用户要求取消，不列作待完成项。手机本轮不执行动作，也不把旧手机 MCP 的加载证据写成手机业务通过。

## 精确 QA 清理与保护复验：待验证

清理基线须在正式 Creator 和首个正式持久聊天创建后捕获，把它们及全部非 QA template metadata 纳入保护范围。验收使用独立临时 QA 对话及枚举的子员工、任务、actions；临时对话可以绑定被保留的正式 Creator，清理必须按对话 ID 精确检查，不能按 parent 员工 ID 扩大删除。

| 项目 | 实际值 |
| --- | --- |
| 本轮 QA manifest 路径、精确 ID 和 counts | 待验证、待填写；不复用上一轮清理计划 |
| dry-run 计划 SHA / 精确主资源与子记录 counts | 待验证、待填写；计划变化即停止，不扩大范围 |
| 删除前无进行中 action / 正式资源仍受保护 | 待验证、待填写 |
| 本轮 cleanup helper / 执行结果 / 外键检查 | 待验证、待填写 |
| 发布前原保护表计数/hash 和原员工对照 | 待验证、待填写；heartbeat 活动字段可按既定规则变化 |
| 正式 Creator 创建后的非 QA 来源/会话保护对照 | 待验证、待填写 |
| 手机配置/绑定、邀请、原设备与 credential identities、控制表 | 待验证、待填写；仅安全计数/hash，不输出秘密或执行手机 API 动作 |
| 最终 ready、queue、真实域名及只读 scope 检查 | 待验证、待填写 |
| 临时 QA 会话撤销及凭据清理 | 待验证、待填写；不打印凭据，不绕过已拒绝的清理动作 |

正式 Creator、首个正式用户聊天、用户已有员工/定制、真实配对、邀请和手机数据不得作为 QA 清理对象。安全证据只保存 IDs、版本、状态、计数/hash 和脱敏回执。

## 回滚骨架：待验证

1. 记录待回滚版本、上一可用 release/前端/客户端及各备份的实际路径与 hash，核对正在运行的任务，保留完整失败证据。
2. 优先回滚本次应用代码、前端与官方客户端到匹配版本，沿用原服务和原端口。保留旧 hash 资源、Nginx 手机转发、控制服务、APK 和持久化诊断日志，不启动替代实例。
3. 新来源表为增量结构，代码回滚时保留表与正式员工/聊天。不要为恢复代码直接用整库旧备份覆盖发布后的真实业务数据；只有确认数据损坏并形成精确恢复范围后，才按实际备份实施数据恢复。
4. 回滚后复验主 API/客户端健康、匿名与跨区拒绝、原员工/手机/邀请/设备数据和保护表。旧串行客户端可能无法完成 Creator 等待子任务的流程，不能把代码启动成功当作 Creator 工作流已恢复。

**本轮实际回滚命令、路径、版本、执行记录与复验结果：待验证、待填写。**
