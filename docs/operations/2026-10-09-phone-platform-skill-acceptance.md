# 2026-10-09 手机 MCP 平台技能发布与验收

## 实际交付与未完成边界

平台技能 **紫薇·互联手机操控 v1.0.0** 已上线。真实域名完成安装、电脑独立工作区授权、原表单创建员工和精确手机配置；真实 Codex 和独立 Hermes 员工通过自己的持久会话完成 MCP 初始化、工具发现、`ziwei_phone_list` 与 `ziwei_phone_status`。这些只读查询均成功，返回目标手机离线。

用户明确表示暂时无法操作手机。“小饱饱”的 Agent/Updater 均离线，本轮没有手机 health、截图、点击、返回、应用操作、升级或其他业务命令。两员工的手机验证保持 `never_run`、`command_id=null`。完整配置与只读 MCP 连通已验收；手机截图和有限无害动作、手机业务目标的实机验收仍未完成。

操作入口与详细指南见 [PHONE_MCP.md](../PHONE_MCP.md)。主站为 [phone_ai 技能中心](https://qzelynth.top/phone_ai/skills)。技能中心、员工技能/MCP 和互联绑定共用同一配置向导，新建员工使用既有表单并自动返回配置。

## 版本、部署与备份

- 手机技能代码：`628482dfa1dc98db8d8531e8def200cc1b6cf636`，已推送 `origin/codex/ziwei-terminal-console`，本次发布目录 `/opt/ziwei/releases/628482d`，北京时间 2026-10-09 10:05:25 发布。邀请注册 T7 随后独立接续发布 `82c4f8e1f26ab5493e67e2a0c52856b3b5aa2bf6`（03:12:26Z）；03:15:50Z 只读确认当前 `/opt/ziwei/current → releases/82c4f8e`，仍包含手机技能与原代理路由。本工作树已快进包含 T7 增量，本轮交接文档与探针不再触发产品发布；邀请验收以 T7 自身记录为准。
- 前端：`index-DL3srw7J.js`、`index-F195zgZe.css`。控制服务 `/opt/ziwei-control/releases/8a4fe59`，Android v0.4.4/code15 保留；旧 hash 资源、APK、数据目录和原控制队列均保留。
- 发布前完整备份：`/opt/ziwei-backups/terminal-console/20261009T020417Z`。主站和控制 SQLite `integrity=ok`，12 配置与旧 symlink 元数据已保存。canonical `mcp.token` 和 Nginx 修改前配置另有本次专用备份。
- 主 API 为加载新后端代码重启；手机控制服务不重启。Nginx 在后续公网工具验证发现路由遗漏后仅 reload，见下节。每次后续发布都应先核对线上 release，保留并行邀请注册任务的最终增量。
- 客户端仍为原全局物理包 `D:\work\nodejs\node_global\node_modules\ziwei`，npm 包版本 `0.1.0`、本次 tgz SHA-256 `6a79600a4e7899145f5c2d8148f7b8b90670b9f0de0bdc593a61f4a464a665eb`，包内包含新手机 stdio 桥接脚本。客户端完整包、入口、配置和历史日志的私有备份在 ignored `.local/phone-skill/client-before-20261009T020900595Z`。
- 原主工作区 `test_222`、主设备身份、工作目录、managementMcp 和 `20242` 保留。双 Owner 授权添加独立 `phone_ai` 身份；原生重载 `45896 → 29976` 后同进程从磁盘恢复两连接，整个配置文件字节不变，分别报告真实心跳与手机 MCP 能力。

## 公网反向代理遗漏与修复

隔离接口测试通过后，首次真实 Codex 与 Hermes 检测都取得 MCP 握手，但 list/status 全部失败。实际工具错误是“手机 MCP 响应无法解析”。匿名公网鉴权探针证明 `/terminal-mcp/v1/.../call` 返回 `405 text/html`，同路径直接访问原 `127.0.0.1:4178` 返回正确的 `401 application/json`，定位为 Nginx 路由遗漏。

已保存 `/etc/nginx/sites-available/ziwei` 原文件到本次备份目录的 `nginx-before-phone-mcp-route.conf`，复用既有 `/mcp/` 代理参数增加 **`location ^~ /terminal-mcp/v1/` → `http://127.0.0.1:4178`**。配置并发校验、原子替换、`nginx -t`、reload 和公网认证/健康检查通过。reload 的旧 worker 短暂返回旧 405，随后正确 401 JSON；发布检查必须容许有限的 worker 切换时间，不把第一条旧响应当成新配置终态。

后端 `/terminal-mcp/v1` 路由在 session 中间件前注册，使用执行 capability 鉴权，不依赖网页 cookie。公网修复后的匿名 phone API 与管理 API 都为 401 JSON，主站 health 为 200。新增发布门槛：

```powershell
node scripts/verify-phone-mcp-transport.mjs
```

该探针没有凭据，只验证健康和未认证边界，不会下发手机命令。遗漏路由、HTML 错误页或鉴权退化均失败。旧的失败 action 已结束，修复后用新只读 check；旧 capability 没有重放。

## 正式资源与真实员工证据

| 对象 | 实际标识 |
| --- | --- |
| phone_ai 平台技能 | `skill_ebe63c34-5dea-4da8-8bcf-f967e5a017c1`，catalog `ziwei-phone-control`，v1.0.0 |
| 原主电脑 | `test_222 / device_ceb28133-2103-46c9-8720-b101d2e8acbc`，zheng |
| 双 Owner grant | `grant_509d2cde-0a65-4066-9447-391b220c2446` |
| 新工作区电脑身份 | `phone_ai / device_f9568c06-d932-4264-9d4c-acc5122097ea`，同一物理电脑 |
| 精确手机 | 小饱饱，`android-6378b05a-dff0-4dc3-8f88-ea37616949c1` |
| Codex 正式员工 | `employee_b723a169-826a-4a27-8cf5-2e50747432ab`，默认 CLI，无指定 profile |
| Hermes 正式员工 | `employee_e60938a6-0d9a-4e77-a6a8-27939ab1c853`，独立 `ziwei-phone-ops-20261009` |
| Hermes profile 创建 | `action_3c4bc2b9-e996-43bb-ab0e-8605d860edb3`，succeeded，provider 本机继承 |
| 正式搭建师持久会话 | `conv_55c101c9-fe54-4e7e-a89a-65b5e807af4c` |
| 搭建师创建与配置执行 | `action_23eae35c-f3d6-414d-93c3-82c875a82e05`，succeeded |
| 搭建师修复后复验执行 | `action_32371278-17f4-4c49-936e-4947fc276201` |
| Codex 修复后检测 | `action_790f3310-fad4-4475-9629-342ddd42333c`；持久会话 `conv_5e3d7e3f-d707-4841-b2a3-86bac9f8b3dc` |
| Hermes 修复后检测 | `action_be35fa83-17c2-46c8-a10c-ccaa9b3a571b`；持久会话 `conv_5b89bba7-fbf4-40c9-825d-5d450adbd092` |

Codex 员工由真实网页原创建表单完成。Hermes 的 profile、员工与手机配置由原正式“紫薇员工搭建师”的实际模型通过管理 MCP 完成：先发现、创建 profile、回读 succeeded、重新发现 provider/auth/独立 SOUL，再创建员工、安装挂载和保存精确绑定。没有把宿主工具直接创建冒充搭建师能力。搭建师原主电脑/runtime/persona/技能保留，岗位说明补充了用户新授权的 phone_ai 手机技能搭建流程。

管理 MCP 新增六个手机技能管理工具，共 21 工具；每个工具可以显式指定 workspace，服务器仍要求 bearer 已获授权。只把与本机既有 test_222 secret 唯一匹配的服务端 child scope 增加 phone_ai，顶层 bjc-ops 与其他 child 未改；原子替换前后分别验证 `test_222/phone_ai/bjc-ops` 从 `200/403/403` 变为 `200/200/403`。本机 tokenFile 保留单默认 test_222，无需改变 daemon 主身份。真实已安装 stdio 初始化、21 工具发现、两区 health 和越权拒绝均通过。

修复并重载客户端后，两个员工检测均 **succeeded**、`checkOnly=true`、`terminalMcp.loaded=true`，各有 `ziwei_phone_list` 与精确 `ziwei_phone_status` 的 `ok=true`。正式搭建师修复后复验执行也为 **succeeded**，在同一持久会话通过实际管理 MCP 创建新 check、轮询并回读两员工结果，其最终回复准确保留手机离线和实机未验收边界。实际结果报告手机 offline；手机运行记录和 commandId 均未生成。Hermes 模型沿独立 profile 既有 provider，回执 `model=null`，没有证据可写具体模型名。

手机能力只经本次执行的私有短期文件注入；每次调用重验配置修订、有效执行、未撤销电脑身份和精确绑定。宿主旧管理员手机 MCP 在所有未挂载员工执行中禁用；挂载员工明确替换为新桥接且清空六个旧管理员环境键，Codex 真实 CLI 已验证覆盖配置可解析。源管理员口令、手机角色 token 不进入前端、员工提示词、技能、命令行或 Git。

## 验证与诊断记录

- 全量串行 Node 测试 **276/276**，lint **48** source files，生产构建通过。新增桥接、安全 capability、版本/卸载、权限、同 daemon 双工作区、真实回执/图片与运行时终态均有 RED→GREEN 测试。
- 隔离手机向导 **12/12**，团队长卡片回归 **12/12**，原管理 MCP UI **6/6**。管理 UI 两条故意 503 单列为预期错误；手机 UI 一条故意 503 用于稳定幂等重试验证，不计为生产无错误。
- 真实 HTTPS 配置 **9/9**：双 Owner grant、真实目标心跳、原表单创建、平台安装、原子保存，以及 1440/390 初次与刷新恢复。0 page/console/request errors、0 blocked writes、0 手机动作。账户区域截图遮罩为白色。
- 实际加载后的最终真实 HTTPS 只读复验 **9/9**：两员工各 1440/390 初次打开和刷新共八页，加搭建师最终持久会话；精确 action、profile、修订、`loaded=true` 和两个成功工具结果与 API 一致。顶部仍为“等待手机”，试运行禁用，`never_run` / `command_id=null`。24 张白色遮罩/单卡截图已目视核对；0 写请求、手机动作、被阻止写入、页面/console/request 错误。
- 发布后匿名 transport 3 项通过；真实两个员工 MCP 初始化/发现/list/status 通过，手机动作不在该通过范围。
- 03:04:15Z 服务器只读快照：主 API PID76260、控制 PID44591、Nginx PID737 均 active、NRestarts=0，主站 health=true、双 SQLite quick_check=ok；phone_ai 有两员工、两绑定，手机运行记录为0。此快照先于 T7 注册修复接续发布，后续 PID/release 应重新读取。
- T7 发布后 03:15:50Z 再次只读确认：主 API PID80617、控制 PID44591、Nginx PID737 均 active、NRestarts=0；health=true、双 SQLite quick_check=ok；phone_ai 仍两员工、两绑定、运行记录0。原客户端 PID29976 在03:15Z仍 ready，两独立连接和手机 MCP 能力均 ready/configured；观察器 PID30988 的周期健康记录持续正常。
- 客户端 PID53712 升级就绪后，在最后成功轮询02:28:09Z之后无退出尾日志而消失；没有证据能确定终止者或归因宿主会话。原生恢复后完成配置与重载，当前 PID29976；不宣称未知退出根因已修复。
- 为后续诊断，独立只读观察脚本保存于用户目录 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\diagnostics\client-exit-watch.mjs`，追加 `logs\client-exit-watch.jsonl`，5MiB轮转保留5份，当前观察 PID29976。隔离退出、健康、身份、轮转/脱敏测试4/4；真实原生重载时已记录旧PID消失与观察器正常退出。它不拉业务 action，不重启或终止进程，未知退出码/原因明确记录 null/unknown；若观察器也同时被清理，下次启动只报告前次未正常退出。

完整证据保存在 ignored `.local/phone-skill/`，包括 full-tests/lint/build、ui-root/team-root/management-root、live-configure-20261009、live-loaded-final、management-stdio、employee-mcp-acceptance、两员工最终 action/status、builder-recheck-conversation-final、nginx-route-release、transport-after、client-refresh 和 watcher 记录。截图、实际会话完整内容与私有文件不提交 Git。

## 临时验收材料清理

两员工执行已结束，用户 runtime 下 `terminal-mcp-credentials` 文件数实际为0。03:15:49Z 精确撤销本轮 Owner QA 会话 `session_phone_platform_skill_20261009`，原会话公网 `/api/auth/me` 从200变为401；未撤销正式管理 bearer、独立工作区凭据或员工能力配置。服务器临时会话文件和 scope 比对用指纹文件已删除。

本机三个临时私有文件仍存在：ignored `.local/phone-skill/private-session.json`（会话已撤销）、`builder-token-fingerprint.private`（比对指纹）和 `server-admin-auth.private.json`（旧管理员认证比对材料）。本机删除被自动审批以 `blocked by policy` 拒绝，未提供更具体原因；没有绕过拦截，记录为待清理，不声称文件已删除。私有回滚备份、正式客户端凭据和日志继续保留。八份拟提交文档/验证文件已按实际私有凭据扫描，命中0；原用户三份 untracked 未纳入提交。

## 宿主旧入口与后续实机验收

用户全局 Codex `ziwei-terminal` 的旧 IP API 已更正为 canonical `https://qzelynth.top/api`，其既有私有登录文件 URL 更正为 canonical `/terminal`，其他 TOML 结构保持不变、TLS 校验保留；修改前有本机私有备份。fresh 原入口只读 stdio 发现十工具，但管理员登录为401；私下与服务端现有 hash 比对确认本机保存的旧密码不匹配。没有重置源管理员密码，也没有把管理员明文复制给员工。主站原中控连接是 server loopback，并不代表可恢复新的管理员明文。该宿主旧管理员入口目前仍不能宣称可用；它需要用户已有正确登录凭据，与新员工执行 capability 分开维护。

待用户方便时让精确手机联网，打开 Agent 和 Updater 并启动连接。核对实际控制端在线后，对两 runtime **顺序**执行当前授权的健康检查、实际截图和有限无害动作，按原 commandId/终态/实际图片核验；不发送消息、评论或发布，不点赞关注，不改账号或系统设置，不升级/重启手机。任何 uncertain/timeout 先查询原回执，不盲目重放。没有这组实机证据前，本任务手机动作与业务验收仍为待完成。

代码回滚不应直接恢复旧数据库覆盖后续邀请、员工或手机数据。需保留新增技能、配置、独立工作区凭据和 source 资源；关闭/卸载手机技能会撤销新执行能力，但不会删除员工人格、其他技能或既有绑定。回滚主站代码需重启原主 API，控制服务保持原发布；后续新发布仍需完整保留两边增量及手机 MCP 代理路由。
