# 2026-10-10 业务清理与本机断开

本轮由用户明确要求清空工作区和普通员工，保留数字员工 Creator 与手机 MCP；随后明确要求删除 `test_222`，清空当前 Windows 电脑 `ziwei_user` 的全部工作区连接配置，并追加“除了让你保留的全都删了”。最终目标是服务器仅保留 Creator/手机 MCP 必要依赖，当前电脑未配对、未连接。无需重新接入电脑来满足验收。

## 执行前核对与保留边界

只读盘点时间 `2026-10-10T01:30:56Z`：主站 `/opt/ziwei/releases/db0aa68`，控制端 `/opt/ziwei-control/releases/8a4fe59`，两库 integrity=ok、FK=0；5 个工作区、8 名员工。所有主站 action 与 33 条 Android command 均已进入终态，实际客户端主/shared 领取队列为 0。执行前仍须重新检查并停止既有 API 的并发写入。

精确保留 `phone_ai`（`ws_d7a5479d-e2e2-4219-a2de-545874f2cfe0`）以及：

- 正式 Creator `employee_743801eb-189d-4a57-bb57-64adebf7b571`，首会话 `conv_3c72ac45-1551-44d2-a1ed-c0900adc137a`、模板记录 `template_e61b8710-455d-452c-a524-e59932f43023`；Hermes/default/personal、原人格、配置、技能、目标电脑保持。
- 两个手机 MCP 宿主 `employee_b723a169-826a-4a27-8cf5-2e50747432ab` 和 `employee_e60938a6-0d9a-4e77-a6a8-27939ab1c853`。现有手机绑定依赖这两名员工，不可删除后仅保留代码；其技能版本、配置 revision、目标电脑、profile、环境参数与两个精确 binding 原样保留。
- 手机技能 `skill_ebe63c34-5dea-4da8-8bcf-f967e5a017c1` / `ziwei-phone-control`，中控两台已有手机、四个 Agent/Updater 节点、配对、入网、会话与升级能力。用户暂时不能操作手机，本轮手机动作数为 0。
- 原四个用户账号和有效登录资料保留为登录基础设施；业务依赖仅保留 `phone_ai` Owner 成员和实际 Creator/手机 MCP 目标电脑 `device_f9568c06-d932-4264-9d4c-acc5122097ea` 的身份与凭据。其他电脑登记、工作区成员和旧区连接凭据精确删除，不额外保留归档电脑记录。原先讨论的额外身份归档方案尚未执行，已被最新用户指令取消。
- 五项可复用平台技能保留原 ID、仅迁入剩余工作区；团队示例技能、旧自定义业务技能及重复未安装 phone catalog 属于清理范围。最终预计六项技能（五个平台技能与已安装手机技能）。

普通业务记录按实际主键、关联、快照哈希规划删除；不用模糊名称，不使用旧 QA 清理脚本历史 ID，不删除数据库文件、用户工作目录、认证目录、手机 profile 或整个 runtime。机器计划、全量受保护对象 hash 与精确删除 ID 仅存 ignored `.local/launch-cleanup/`；待独立审查和实际执行后补入下方结果。

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

启动回填修复与本机原生 forget 功能、独立审查、发布、实际删除和清理后桌面/390px 只读验收仍在执行中。尚未将计划数量记为已删。
