# 紫薇·互联手机操控平台技能实施计划

> 本轮按用户已授权的完整配置、真实员工实机验收和发布范围在当前会话分工执行。

**Goal:** 用户从技能中心安装手机操控技能，完成员工/电脑/手机配置，并由真实 Codex 与 Hermes 员工经 MCP 操控已绑定手机。

**Architecture:** 现有平台技能与版本机制登记 `ziwei-phone-control`，结构化 integration 驱动统一配置向导。现有员工配置与手机绑定是唯一配置来源，原中控仍拥有状态、队列、截图与回执；每次员工执行通过自己的工作区电脑身份领取短期、限定员工和手机的 capability，再由本机 stdio `ziwei-terminal` 调用主站代理。单 daemon 保留 test_222 主连接，通过明确的双工作区 Owner 授权新增 phone_ai 独立身份连接。

**Tech Stack:** 现有 Vue 3/Vite、Express、Node SQLite、ziwei_user、Codex app-server、Hermes ACP、MCP stdio 和原 Android 中控协议。

## 设计取舍与已授权边界

单放 SKILL.md 无法确保工具接入；共享管理员文件会扩大员工权限。采用平台版本记录、结构化依赖、员工绑定和执行 capability，把安装、保存、API健康、工具发现、MCP加载与手机回执分别展示。三个入口共用 PhoneSkillSetup，避免状态分叉。工作区电脑共享使用一次性 grant，原连接令牌不能跨工作区通用。

用户已授权既有完整十项手机工具和本轮有限验收，不增加逐动作审批。未知手机/运行时/profile明确失败；不得替换或广播目标。真机两runtime串行，截图观察后有限打开系统设置/返回或读取本人抖音作品数据；不发消息、评论、视频，不点赞关注，不改账号/系统设置，不升级或重启手机。超时/uncertain读取原commandId，不能盲目重放。

## Task 1：平台技能、绑定与状态（API agent）

文件：backend/db.mjs、repository.mjs、management.mjs、app.mjs、ziwei-connect.mjs，新增手机技能服务/测试。

先写失败测试覆盖真实目录/安装版本、原子保存与重试、scope、卸载保留其他数据，再实现 seed/upsert 与统一配置。聚合 `GET /api/workspaces/:slug/phone-mcp/setup`；员工 phone-mcp 配置 PUT 和状态/check/trial 路由。试运行建立真实员工持久会话而非管理员直接手机请求。保持原 bindings/runs 数据源，按当前配置匹配回执，旧配置成功不得冒充当前成功。管理搭建师可发现技能和回读配置/验收状态。

## Task 2：安全能力与电脑共享（API + runtime agents）

私有 bootstrap：`POST /api/workspaces/:slug/terminal-mcp/bootstrap`，当前工作区 x-device-token，body `{employeeId,deviceId,actionId}`，返回短期 capability 与完整 scoped baseUrl。仅当前实际指派执行/电脑/员工/绑定有效时签发；网页与普通 action 查询不能取得秘密。

调用：`POST /terminal-mcp/v1/workspaces/:slug/employees/:id/call`，Bearer capability，body `{name,arguments}`。服务器再核对工作区、员工、安装/挂载、手机和执行，转原中控接口，不建第二份手机队列或凭据库。

共享：Owner明确选择 source workspace/computer 和 target workspace，服务器验证两工作区权限，给 primary 排 `device.workspace.connect`，payload仅grantId与primary deviceId。daemon用 primary身份调用 `POST /api/daemon/workspace-grants/:grantId/claim`，获取target独立deviceId/deviceToken/apiBase并持久化私有文件；每个连接独立心跳和dispatcher。primary配置/20242保持原值。

## Task 3：stdio桥接与技能内容（root）

文件：scripts/ziwei-terminal-mcp.mjs、skills/ziwei-phone-control/SKILL.md、manifest.json、package.json、test/terminal-mcp-bridge.test.mjs。

先测试RED，再实现原十工具定义、严格HTTPS/capability文件scope、一次请求无不确定重放、MCP图片、脱敏审计。只使用 ZIWEI_TERMINAL_*，不读取宿主源管理员 ZIWEI_CONTROL_*。私有文件包含token/workspace/employeeId/deviceId/actionId/expiresAt/baseUrl；API_BASE为完整 scoped 前缀。审计只记握手/发现/工具名/目标ID/commandId/状态，不记token、args、图片或业务正文。

## Task 4：Codex/Hermes注入与回执（runtime agent）

文件：src/runtime-adapters.mjs、daemon/ziwei_user.mjs/config.mjs，相关CLI与测试。

先RED覆盖bootstrap、并存/卸载、scope及真实审计。payload.terminalMcp `{enabled,workspace,employeeId,deviceId}`；每次执行领取cap并写0600临时文件，结束清理。环境使用 ZIWEI_TERMINAL_API_BASE/WORKSPACE/TOKEN_FILE/AUDIT_FILE/EMPLOYEE_ID/DEVICE_ID。result.terminalMcp与管理MCP证据并列；禁止未挂载员工继承用户global的管理员手机入口。Hermes保留独立人格与provider，不修改主profile。客户端打包包含桥接脚本。

## Task 5：统一配置向导与浏览器（frontend agent）

文件：frontend/src/App.vue、PhoneSkillSetup.vue、现有技能/员工/互联入口、相关CSS，新增隔离浏览器回归。

安装技能→选择已有或新员工→选电脑/runtime/profile→选真实手机→保存安全配置→检测→员工试运行→回读。支持明确电脑共享授权，不能要求手改TOML/JSON/复制token或开终端。显示未配置/等待电脑/等待手机/认证失败/MCP已加载/实机通过，以及保存/API/发现/回执各项。桌面与390px、刷新、错误/重试、卸载、三入口一致；保留长指令卡片回归。

## Task 6：集成与真实链路（root）

完整串行测试、lint/build、手机技能隔离浏览器、管理MCP回归和团队布局回归。先备份主站/控制SQLite、配置和客户端，推送代码后按原服务发布方式部署；保留旧hash、APK、数据和用户dirty/untracked，必要时升级既有daemon，保留主连接。

真实域名浏览器配置phone_ai，实际Owner授权电脑共享，安装/挂载技能并绑定精确手机。真实Codex和独立Hermes员工持久会话分别完成工具发现、list/status/screenshot以及有限动作；逐项核对commandId、原回执、前后截图、主站执行和MCP审计。刷新/重载配置后再验，不以管理端代调代替员工证明。

## Task 7：发布后验与交接（root）

生产桌面/窄屏与员工→MCP→真机复验，记录实际通过和具体未通过边界。清理短期QA会话/执行cap，保留正式员工和配置；更新PROJECT_MANAGEMENT/README/HANDOFF/CHANGELOG及运维验收记录，提交推送文档。用户最终拿到技能入口、配置步骤、已配置员工/手机/工作区、两runtime实机证据、服务器与Git提交及具体限制。
