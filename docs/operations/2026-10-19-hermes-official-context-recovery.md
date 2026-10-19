# Hermes 官方上下文恢复与手机未下发证明

本轮按用户要求优先使用 Hermes 官方实现。恢复适配层调用目标安装内的 `agent.conversation_compression_manual.compress_now`，采用原生 CLI 的安装/持久化顺序；不自建摘要、不执行 `/new`、不直接改写聊天 SQLite、不重新提交原用户任务。只有闭合的工具批次、可核实的外部回执、无后台任务且官方压缩真实缩小后，才允许原监督进程内继续一次未完成工作。派生配置保留公开压缩设置；仅为缺失的设置补默认压缩策略。

## 已发布代码与证据

- 主仓库 `6ea5b988e19817aa08c193a82db1f2a72688eb07`：官方压缩适配、原生 `sessions.compress`、手机未下发证明及旧只读截图占位判定。
- 主仓库 `36c58af`、`3f9eaae9749ad8d8a5f88266a6181ea87fde16f4`：发布期间发现的 SQLite 非热回滚日志预检查兼容；缺失主库的非空孤立 journal 仍拒绝。
- 互联仓库 `9d25509cf4a2f947465582d9442a2d1845a8af1b`：仅控制服务在分配命令前的具体前置条件拒绝分支签发 `not_dispatched`，主 API 与客户端逐层核验。历史中文错误、任意 HTTP 失败、已下发后丢失响应不能获得该证明。
- 首轮官方 Windows 包 build `92eb00de7cfff12077762b119e42d971ba25069a3ee7f659ac253729f7687375`，SHA256 `78fef67c50126f2f9ccf05fbd59febeab09b279c907e046b3084e3a1db50522f`，1178017 字节。最终包与目标电脑安装成功证据见下文，不能只凭发布包认定安装完成。

源码均先推 GitHub，再发布。07:18:27 UTC 独立只读核验确认主 API 7 个源文件、互联 3 个源文件、进程 cwd/PID、健康检查、官方包/元数据/固定更新脚本均匹配。前端仍 J，互联原 55 个 APK 文件、数据库身份和 schema 保留。完整私有现场凭证在 `.local/hermes-context-recovery/deployment-attestation.json`，不提交账号会话或业务明文。

最终联合无监听定向回归 130 项通过，0 失败/跳过；互联服务另有 9 项定向回归。发布工具 8 项、互联发布器 11 项通过。嵌套 Python fixture 不重复计入 130 项总数。

## 发布故障与恢复记录

首次 API 激活失败为 `LOCAL_HEALTH_FAILED`，原生数据库预检查拒绝了有效的非热 SQLite `-journal`；首次回滚也返回 `MAIN_NOT_SETTLED`，不能把该轮写成成功。该 journal 为完整头、前八字节为零，SQLite 官方定义属于非热日志。修复继续保留私有副本 `quick_check` 和源文件 SHA/身份检查；没有删除、清空 journal 或恢复业务数据库。

随后通过冻结的远端恢复程序叠加一项预检查源码修复，启动并核验成功。此轮执行驱动为 `frozen_remote_recovery_program`；发布工具仅提供校验辅助函数，没有冒充其标准发布驱动已执行。成功 API 为 `/opt/ziwei/releases/context-recovery-3f9eaae9749a-6fd704c7fc61/v2`，PID520792。回执 SHA256 为 `6f5b0be63addb421d886605e3913b71295520175a628852cc8d49a724c27bbd6`。

## 原闲鱼记录的边界

原动作 `action_49bd64e6-0105-4fd6-aff5-53f50b520d52` 于 2026-10-18 21:40:08 UTC 自然失败，早于本轮升级。root exit1 已确认；tree:false 与三项保留进程的旧证据没有被改写。567 条手机审计中，一条没有命令 ID 的只读截图前置拒绝造成聚合不确定；之后还有有效调用，所有实际写动作均有原命令 ID 的终态回执。

只有精确员工/设备/Profile/审计范围、根进程明确非零退出且唯一未决操作为只读截图时，服务端允许释放 Bot 排队占位。原执行不确定性与原进程证据仍保留，不能把历史中文错误补造成 `not_started`，也不重放业务操作。需要以新只读验收的实际成功确认当前员工能工作。

## 安装与真机验收

验收开始时，李金晋电脑为 V build `daf73ba86f7fb883cb022edd0807820cfddacfe6bcb3ab5b971060699240ec35`。首个升级请求 `client-update_dd19462c-dfba-4fe7-925d-5d4af0c77255` 因用户正在执行的 Codex 网站运维任务无法检查点而等待空闲。为避免等候期间冻结其他员工，安装前已取消该请求；没有伪称升级成功。知微同一动作 `action_c5e891f7-b52a-4012-9c5f-95eab7705f29` 确实按 generation1 暂停、取消升级后恢复并最终 succeeded。

真实安装的 Hermes 源码为 0.21.3，具备官方压缩核心；非交互 query 不会把字面 `/compress` 当 CLI 命令。因此提供薄适配，而非让模型口头声称执行了 `/compress`。两次生活管家任务外层 succeeded，但模型明确拒绝执行，未计为压缩成功。随后 Creator 执行的第一次验收在 `import_cli` 阶段出现 `NameError: base_events`；只读初始化诊断证明压缩核心调用为零，原会话仍为 5831 条历史、1599 条 active，角色计数完全相同。其原因是临时验收脚本把 `subprocess.Popen` 类替成函数，破坏 Windows asyncio 的继承；这是验收脚本问题，没有据此修改产品或官方 Hermes。

临时脚本改为保留原类接口的拒绝构造子类后，`action_a3f41e92-0c7c-46bd-be99-4e19fa9a8c99` 于 08:49:03 UTC 真实完成官方压缩：原 session `20261015_120149_45e77a` 保持，估算 token 579723 → 331744，`fallbackUsed:false`、`persisted:true`、`safeToContinue:true`，未调用手机、未发原业务 prompt、未安装客户端、YAML 未改。消息数量未作为 token 缩小的替代证明。

随后通过正常 Bot 原生 API 的 `sessions.read`（`action_5f0911a3-5386-4983-8f5f-dcd1a8a860fd`）独立回读同一 profile/session，成功，nativeVersion 0.21.3、1599 条 active、root/tree 均 exit0。再恢复 Bot active（r7/e23），向原主聊天发送独立的无工具验收消息：`action_5cd837b4-c153-4e9e-a0d0-43177fb0d5b8` 于 08:54:40 UTC 成功，真实 `gpt-6.1-sol` 在同一原生 session 回复“闲鱼恢复验收通过”，root50528 exit0/tree0/activeProcesses0，无后台保留。原失败动作的选定原始字段前后完全相同，当前标准化摘要均为 `41ced0f73c2ebd8a79d32defb9104439664ccf48cfef831f1eb07f1f20bca5b8`；其旧 uncertain/tree:false 未被改写。

## 升级调度及后续维护问题

`e7ecaf6a52ed2b1229008b881be4d5084ca717e0` 已先推双分支，再仅叠加 `backend/device-updates.mjs` 到实际混合 API。当前 API `/opt/ziwei/releases/update-hold-e7ecaf6a52ed-e34be1d8f780/v2`，PID524164；独立核验全匹配。新升级仅在 requested 阶段等待同一设备/工作区当前 ACKed 的非 Hermes 执行，claim 时再查，避免等待长 Codex 任务时先关闭全部员工 admission。历史 expired/failed/uncertain 不新增服务器升级锁；最终安全停止仍由原客户端恢复/idle 检查负责。66 项定向回归及实际混合 API 的 45 项测试通过。

第一次实际安装请求 `client-update_ef73db4d-1fb8-43ef-a1b3-eeff1253978a` 被旧客户端 `CONTROL_REJECTED` 拒绝，未装入 92eb。只读健康检查发现历史分类器不接受执行器新增的 `hardDeadline` 字段。修复 `5125260e0b587052f24ae97680723350ec3a32ca` 仅允许该已知字段并按共享预算校验；隔离/未知额外字段仍拒绝，不改旧进程退出或手机回执。190 项回归通过，Root 另独立复跑 132 项通过。

中间官方包 build `c5f37afc45e8f1c368fab4b4fc7eba3ea770eb470da238ff93e165acf39ae7bd`、SHA256 `864ec095cad416603d08c26de2fbf70f6e2c0fecd430705a0143d663f8061489` 已先推再发布，仅修改一个源码和真实 provenance 描述文件，其余 939 个成员字节/权限保留。请求 `client-update_cf30cf8a-51a3-4681-8855-660564547db3` 已通过候选归档分类，但在原生准确实例停止阶段仍被拒绝；当时旧安装保留、李电脑仍是 V。此失败记录继续保留，不能被后续成功覆盖。

`ed9165e7bd018dfba1ea59043044eb8cf9a26c36` 增加闭合的原生 `LHxx` 拒绝诊断及保留最初失败 phase，23 条原停止条件及顺序均不变。83 项定向回归全通过，扩展 256 项通过、6 项 Windows 条件跳过；没有把规则标记作为退出证明。运行中的旧 V 更新器序列化器不会随候选包立即改变，候选日志能够保留新规则；不能由此声称旧 updater 已装入新字段。

## 最终远程升级与新客户端验收

最终官方包来自 `ed9165e7bd018dfba1ea59043044eb8cf9a26c36`：build `e0cfb63ee43c3d837a049b9c4f0c6d1362cab64918f8987b35597b9e549c4c18`，归档 SHA256 `e947bb79cda87009070351bf4b572c3546d61d8c4c556e8c6c0967c4425271b9`，1176999 字节。在实际上一版归档基础上只改两份维护脚本和真实 provenance 描述，其他 938 个成员字节/权限保留。包内定向回归 222 项通过、发布边界 8 项通过；冷缓存离线安装、候选校验、来源闭包校验与 source-proof 模块导入通过，不与前述重叠测试数累加。

专用远程协议请求 `client-update_3ec158a0-3756-4697-b3aa-8eb23e18cd54` 已成功。2026-10-19 09:09:24.281 UTC 服务器收到李金晋电脑的认证新版本心跳，`heartbeatVerified:true`、`completionSource:heartbeat`，实际 build 与目标 e0cf 完全一致。没有更新其他电脑。此前准确实例停止的拒绝未捕获具体 LH 规则，不能仅凭本次成功反推其历史根因已经证明。

09:09:43 UTC 独立只读部署核验确认官方下载归档、磁盘包、元数据、固定更新脚本、描述文件和两份源码均匹配；主 API e7/PID524164、互联 9d/PID521384、既有数据库身份/schema 与 55 个 APK 均保持。私有凭证为 `.local/hermes-context-recovery/observability-client-deployment-attestation.json`，`allMatched:true`。

已安装客户端通过常规原生 API 执行 `sessions.compress` 的 `preview:true`（`action_cb5542cb-f0cd-4161-98a1-c16b896821ef`），09:11:45.784 UTC succeeded。原 profile/session 保持，官方方法 `official_compress_now`、nativeVersion0.21.3，root35440 exit0/treeConfirmed:true/activeProcesses0。该预览没有压缩持久化，`persisted:false`、`safeToContinue:false` 是预览约定，不能拿它代替前述真实压缩成功证据。

最后再从原主聊天提交一条无工具验收消息，新客户端动作 `action_feb8f4ae-0fce-47e3-a45c-4fbcbf039708` 于09:20:33.025 UTC succeeded。真实模型 `gpt-6.1-sol` 在同一原生 session 精确回复“新版恢复验收通过”，root51780 exit0/treeConfirmed:true/activeProcesses0，无后台保留，已加载的管理与终端 MCP 的 toolCalls 均为空。本轮 ACK 到完成346.506秒，120秒静默提示未触发强停；耗时较长，不能表述为即时回复。请求审计保留 max 匹配结果、`nativeActual:xhigh` 与 `mode:verified_gpt61_sol_max` 的原始映射证据。

手机投影独立回读确认 Bot active r7/e23，Bot 最新动作和主聊天 execution 均指向该 succeeded、error:null。没有给手机发布新 APK。真实官方压缩、原会话回复与新版安装已现场通过；本轮未故意触发 typed context-overflow 补偿分支，诊断也没有 `ZIWEI_CONTEXT_RECOVERY` 标记，因此自动溢出补偿的证明范围仍为代码回归，不能以两次请求推断其已现场触发。

参考：[Hermes 配置](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/)、[官方压缩与缓存](https://hermes-agent.nousresearch.com/docs/developer-guide/context-compression-and-caching/)、[SQLite 回滚日志规则](https://www.sqlite.org/lockingv3.html)。
