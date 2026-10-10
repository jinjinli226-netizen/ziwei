# 2026-10-10 业务清理与本机断开

本轮由用户明确要求清空工作区和普通员工，保留数字员工 Creator 与手机 MCP；随后明确要求删除 `test_222`，清空当前 Windows 电脑 `ziwei_user` 的全部工作区连接配置，并追加“除了让你保留的全都删了”。最终目标是服务器仅保留 Creator/手机 MCP 必要依赖，当前电脑未配对、未连接。无需重新接入电脑来满足验收。

## 执行前核对与保留边界

执行前只读盘点时间 `2026-10-10T01:30:56Z`：当时主站 `/opt/ziwei/releases/db0aa68`，控制端 `/opt/ziwei-control/releases/8a4fe59`，两库 integrity=ok、FK=0；5 个工作区、8 名员工。所有主站 action 与 33 条 Android command 均已进入终态，实际客户端主/shared 领取队列为 0。正式执行前再次核对 queue=0，停止原两项 API 并保存冻结备份。

精确保留 `phone_ai`（`ws_d7a5479d-e2e2-4219-a2de-545874f2cfe0`）以及：

- 正式 Creator `employee_743801eb-189d-4a57-bb57-64adebf7b571`，首会话 `conv_3c72ac45-1551-44d2-a1ed-c0900adc137a`、模板记录 `template_e61b8710-455d-452c-a524-e59932f43023`；Hermes/default/personal、原人格、配置、技能、目标电脑保持。
- 两个手机 MCP 宿主 `employee_b723a169-826a-4a27-8cf5-2e50747432ab` 和 `employee_e60938a6-0d9a-4e77-a6a8-27939ab1c853`。现有手机绑定依赖这两名员工，不可删除后仅保留代码；其技能版本、配置 revision、目标电脑、profile、环境参数与两个精确 binding 原样保留。
- 手机技能 `skill_ebe63c34-5dea-4da8-8bcf-f967e5a017c1` / `ziwei-phone-control`，中控两台已有手机、四个 Agent/Updater 节点、配对、入网、会话与升级能力。用户暂时不能操作手机，本轮手机动作数为 0。
- 原四个用户账号和有效登录资料保留为登录基础设施；业务依赖仅保留 `phone_ai` Owner 成员和实际 Creator/手机 MCP 目标电脑 `device_f9568c06-d932-4264-9d4c-acc5122097ea` 的身份与凭据。其他电脑登记、工作区成员和旧区连接凭据精确删除，不额外保留归档电脑记录。原先讨论的额外身份归档方案尚未执行，已被最新用户指令取消。
- 五项可复用平台技能保留原 ID、仅迁入剩余工作区；团队示例技能、旧自定义业务技能及重复未安装 phone catalog 已删除。最终六项技能（五个平台技能与已安装手机技能）。

普通业务记录已按实际主键、关联和快照哈希删除；没有使用模糊名称、旧 QA 清理脚本历史 ID，未删除数据库文件、用户工作目录、认证目录、手机 profile 或整个 runtime。机器计划、受保护对象 hash 与精确删除 ID 保存在 ignored `.local/launch-cleanup/`；实际结果如下。

## 可恢复备份

服务器备份 `/opt/ziwei-backups/launch-cleanup/20261010T013929Z`（目录 0700，文件 0600）：使用 SQLite backup API 保存主站和中控，并分别生成独立恢复副本；两份恢复副本均 integrity=ok/FK=0。另有 16 项服务器配置、签名密钥、部署入口与 CLI 包备份，内容私密。

- 主站 `main.sqlite` SHA256 `abb53c63e8937a72534f2cff8659f5cab04f0efae447eb11f370f8b7dcd2d976`。
- 中控 `control.sqlite` SHA256 `fbd77394719e191a32a527f2d2798f20960c2e1f0421eabd03c36861276048dc`。
- 元数据和恢复副本都在同一目录。此处是清理前初始快照；实际事务执行时还会保存停止并发写入后的快照。

本机备份 `C:\Users\25941\AppData\Local\Ziwei\backups\launch-cleanup-20261010T014200Z`：仅当前用户 SID 与 SYSTEM 可访问。19 个 Creator 持久文件、8 项有效连接和凭据缓存引用、主/shared action-state 已保留；状态 SQLite 通过 backup API 与独立 restore-copy 检查。原目录、配置和认证未改，备份期间稳定字段一致。备份 inventory SHA256 `a93ab31db44f72397455918a1e6b75ddf25b728b9044ecb44b8c04bf7da92e61`。

Creator 持久 HOME 仍为 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\runtime\shared-workspaces\phone_ai\device_f9568c06-d932-4264-9d4c-acc5122097ea\creator-instances\e04bb6b8c9ba7ec9f36a13adf8f07d67b090d521ada065509e0531a05b8a9cd1`。本轮取消把 shared 连接提升为 primary，避免改变该 HOME 路径；最后按用户要求断开全部连接。

恢复时先确认业务写入边界和当前数据；优先按私密 manifest 精确恢复被删/迁移记录，不直接整库回滚覆盖清理后的新用户数据。需要整库灾难恢复时短暂停止原两项 API、先保存当前数据库，再由 SQLite backup API 恢复并核验 FK/integrity，沿原服务启动。客户端重连由用户在官方设备页重新配对，不恢复旧连接配置以偷偷接入；Creator HOME 备份可独立恢复。

## 已取得验收证据

`2026-10-10T01:42:07Z` 的实际原生 Hermes Creator 只读验收通过：临时 QA 会话派发 action `action_4cb2851f-5995-4767-a8da-4d13638b4050` succeeded、管理 MCP loaded；实际调用 `ziwei_discover_environment`、`ziwei_list_employees` 均成功。Creator isolation key、employee/workspace/default profile 与原持久 HOME 一致，使用 source-native-store。正式首会话未触碰，临时 QA 会话、action 和关联消息/事件会纳入本轮精确清理。此为断开前证据，不宣称断开后可执行。

## 发布与实际清理结果

生产代码 `3421046684a2ab1b484674500b803ea6dd1c14b7` 于 `2026-10-10T02:10:08Z`（北京时间10:10:08）发布，`/opt/ziwei/current -> /opt/ziwei/releases/3421046`；控制端仍 `8a4fe59`，Nginx SHA `faf170c39866d8c307ed68cc49d96cf7cc28dfac442e979d3f3d8c35cf494967` 未变。前端仍 `index-DRTDY7kv.js` / `index-CJMLdFH9.css`，新旧 hash 资源均 HEAD200。官方客户端 24 文件、78,137 bytes，公开 metadata、实际下载包、本地包 SHA 均为 `71ed66d6b89102b62a8c732b9ec6fea4c8d638ea477472a087d88008c3a32e1e`。

一次性 marker `2026-10-10-initial-seed-once` 在首次升级保存；只对新库播种，既有空库不重建示例区，audit→notification 的启动回填也只做一次。全套 412/412、0 skip，lint60、diff check、build 通过；新增 disjoint config/data 根目录凭据清理验证通过。清理 helper 在完整85表与实际两个控制触发器的合成库通过11/11，旧备份/未知schema/变更trigger/部分提交/计划hash变化均有拒绝证据。

初次计划预检因控制库两项既有触发器未纳入 inventory 而拒绝，未进入删除，原服务恢复。独立核对后精确绑定 `ops_assignment_single_insert`、`ops_assignment_single_update` 的 type/name/table/SQL hash；它们只对员工终端指派 INSERT/UPDATE 检查唯一性，不影响本次 Android command DELETE。未知或变更对象仍拒绝。

最终停写备份 `/opt/ziwei-backups/launch-cleanup/20261010T021519Z-predelete`，目录0700/文件0600。主站4,251,648 bytes，SHA `714d5ba2530358411b06f11a799c366f0ef5e922d242918a125065678e2e7cd3`；中控3,735,552 bytes，SHA `8288e0351bfdd30b13f027bd0b418d99cff2ff6212a721244535ce6a9c622ffa`。两份独立恢复副本均 integrity=ok/FK=0；备份逐表原行、schema、路径、大小和 SHA 与最终计划完全匹配。

根代理与独立审查均通过最终计划 SHA `b7077d642890aa6b4a691e23d0731958b8c4ecce6bce2d3101a5559f43aae7a2`；`2026-10-10T02:20:20.138Z` 精确事务执行完成。主库删6,632行、中控删33行，总6,665行，唯一更新为五项平台技能的 workspace_id。control、main依次提交，两个独立 SQLite 库不是跨库原子事务；本次都完整成功，没有部分提交或恢复需要。原两项 API 沿 systemd 恢复，Nginx 未重启。

| 数据 | 执行前 | 执行后 | 实际处理 |
| --- | ---: | ---: | --- |
| 工作区 | 5 | 1 | 删除 test-111、bjc-ops、test_222、bjc，仅 phone_ai |
| 员工 | 8 | 3 | Creator 与两个手机 MCP 宿主保持全字段 |
| 电脑 / 设备凭据 | 7 / 5 | 1 / 1 | 仅保留原 f956 身份和凭据 |
| 工作区成员 | 8 | 1 | 仅原 phone_ai Owner |
| 会话 / 消息 | 19 / 43 | 1 / 0 | 正式首会话原本0消息，保持；其余精确删除 |
| 任务 / 任务消息 | 9 / 9 | 0 / 0 | 全部普通业务删除 |
| action / action event | 46 / 1355 | 0 / 0 | 包括本轮只读 QA 资源 |
| audit / 通知 | 1678 / 3356 | 0 / 0 | 全部业务历史删除，重启未回填 |
| 邀请 / 配对码 / 工作区共享授权 | 8 / 18 / 1 | 0 / 0 / 0 | 普通工作区记录删除；手机中控配对依赖另表保持 |
| 管理请求 | 16 | 0 | 旧请求与临时验收引用删除 |
| 技能 / 技能版本 | 10 / 2 | 6 / 1 | 五个平台技能迁归属，已安装手机技能与版本保持 |
| 手机 MCP 配置 / 绑定 / 模板实例 | 2 / 2 / 1 | 2 / 2 / 1 | 配置、revision、ID全保持 |
| 中控手机 / 节点 / 会话 | 2 / 4 / 4 | 2 / 4 / 4 | 原配对和凭据保持，归档手机在页面隐藏 |
| Android command | 33 | 0 | 仅既定终态33条，未发送新手机动作 |
| 登录账号 / session | 4 / 11 | 4 / 10 | 清理事务全部保留；验收完成后仅撤销本轮临时 QA session |

文档、自动化、日历事件、Webhook、手机升级等队列原为0，仍为0；运行时与设备元数据各保留剩余工作区必需4条。没有保留额外归档电脑或旧成员。

## 本机原生断开与恢复备份

沿原全局入口 `D:\work\nodejs\node_global\ziwei_user.cmd` 升级客户端，原配置hash不变，PID48624→52780，build `40af5811c95e3c251ddb0daa887eb60bf9f4135365b0afdea46f3bcb45a6b6d6`。确认主/shared queue=0后，本机最终私密备份 `C:\Users\25941\AppData\Local\Ziwei\backups\launch-cleanup-disconnect-20261010T021200Z`，inventory SHA `7360f29385546e5efc9abd547252b720fae998b2a0fba6a7e0ae5b99cffbabf3`。

实际 native `forget --expected-pid 52780` 通过已认证的本机 pause/drain，active0后清空全部 main/shared 连接、删除4个精确管理凭据缓存，配置 `connectionState:disconnected` / `connectionCleanup.state:complete`。原生 status `configured:false`、`connectionCount:0`、`cleanupPending:false`；20242 无监听，daemon48624/52780与观察器33376/56168均退出，未自动start/connect。断开墓碑使环境变量不能暗中回填连接。

独立核对 Creator 原HOME20个持久文件、两个action-state及四个源config/SOUL文件hash完全一致；实例未复制 auth/.env，源认证文件字节相等不在此基线中、未扩大断言。最终备份28个持久文件hash一致，state.db与独立restore0.sqlite完整性和所有行内容签名通过；四个SQLite临时WAL/SHM清单条目在关闭后消失，作为临时文件记证，不宣称所有清单路径仍在。

日志保持 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\logs\daemon.log`（轮转历史）、`logs\client-upgrade.jsonl`、独立 `diagnostics\client-exit-watch.jsonl`。实际pause/退出/观察器结束已落盘，可离线读取。端口登记原记录 `2fc1eec40b979a39` 保留4178/5178/20242归属，仅补充本机已断开与日志备注；没有新建业务实例、改端口或接管原启动入口。

## 清理后真实界面与最终核对

最终浏览器 `2026-10-10T02:25:03.287Z–02:26:34.046Z`：真实 HTTPS 域名1440×1000与390×844共18/18、34张截图，两个context均关闭。唯一phone_ai、3员工、1电脑、正式Creator模板/原会话打开刷新、两份手机配置、活跃手机/双节点、Android安装、空业务及四个旧工作区拒绝访问均通过。旧区预期403与对应console按精确旧slug单独留证，不与phone_ai正常页面错误混记。

卡片240×126px，职责摘要line-clamp2/28px，两端均无卡片交叠或侵入设备区域，Agent环境间距32px，树摘要最多两行；所有页面documentWidth=viewport。两个视口员工/手机保护配置hash前后相同。正常page/console/request/unexpected错误、业务写请求、WebSocket发送、模型/Codex执行、手机动作均为0。原图布局错误未复现；本机f956在页面显示offline，手机配置仍never_run/commandnull，符合本轮断开与实机暂缓范围。

首轮曾17/18：在线SQLite验收helper的长BEGIN读锁与auth.purgeExpired写冲突，主服务于02:22:07Z因database locked退出，systemd02:22:10Z恢复，导致Creator与通知502。首轮完整证据保留，没有把失败算成功或仅修改等待条件遮蔽。之后使用SQLite backup API短暂获取一致性快照，再在离线快照里执行全85表hash核验，实际PID134804/NRestarts1在最终验收前后保持不变；无需在线长读事务。

最终离线快照核对时间02:27:55Z：两库integrity=ok/FK=0，精确保留行和全部业务0与计划一致。仅以下真实运行变化单独验证：原登录session.last_seen_at随登录读取变化；本轮临时QA session在完成后精确撤销；控制8a4原constructor将活动设备6378的lease_until从1791598322625延至1791598838123，扣除原15000+2500ms宽限恰为02:20:20.623Z控制重启窗口。该设备所有其他配置/epoch/lease_session/节点/凭据字段及其他设备租约逐列保持；没有把lease加入通用volatile豁免，也没有改变已执行计划SHA。

QA session `session_launch_cleanup_20261010` 于02:27:51Z撤销，旧cookie真实401，服务器与本机临时token文件已移除；其余账号与登录敏感字段不变。02:26:58Z公共健康复核通过：主/控制/Nginx active、主站healthy、新旧静态资源200、Androidcode15双APK HEAD200（本轮未重新验APK hash）。02:31:05Z官方CLI metadata/实际下载hash验证通过。Creator断开前模型证明保留在上方；断开后只检查界面与存储，不宣称能执行。手机仍离线，实机结果继续暂缓。

安全证据在 `.local/launch-cleanup/`：`reviewed-plan.json`、`independent-plan-review.json`、`execute-result.json`、`post-qa-database-verification.json`、`native-final-verification.json`、`public-client-final.json`、`session-final-result.json`、`health-final.json`、`live-acceptance-final-v2/results.json`；首次失败计划和首轮浏览器证据均保留。最终业务页面 [phone_ai团队](https://qzelynth.top/phone_ai/members)；[正式Creator会话](https://qzelynth.top/phone_ai/inbox/conv_3c72ac45-1551-44d2-a1ed-c0900adc137a?employee=employee_743801eb-189d-4a57-bb57-64adebf7b571)。后续只有用户明确重连时才沿原官方配对流程接入电脑。
