# Windows Hermes 升级暂停与原会话续做

用户已授权直接修复、测试后先推 GitHub 再发布；真机仅使用李金晋电脑，闲鱼原手机业务不重放。API R、Windows 客户端 U/V 已按下述范围发布。李金晋电脑已完成 U→V 的真实工作任务暂停、升级及原会话续做；服务器事件、认证目标心跳、同一 session 的原生 SQLite 工具结果和专用测试文件交叉核验通过。

## 已确认的发布与现场记录

API R `a6411aad5586073691b727dcea6d0f824dfd9f10` 于 `2026-10-19T03:42:53Z` 发布完成，当前 API 目录 `/opt/ziwei/releases/maintenance-resume-a6411aad5586-62297df2d67b/v2`、主 PID `510535`。它在实际 J 混合 API 上仅叠加本轮 4 个文件；主站/前端仍为 J `241f0cc59bbd2cb7800ac3072470b1a85a77dfd1`，数据库 schema、原库身份、前端及官方下载在 API 发布阶段保持。后续客户端阶段只更换官方 `ziwei-latest.tgz` 与 `release.json`，没有再次部署 API、重启其它服务或更新其它电脑。

李金晋电脑先经统一请求 `client-update_ca881cc8-3d4e-472d-93f7-c2797823df59` 装入 R 基础支持，再经 `client-update_e50e1a97-0eb8-4a88-9d05-00bce1e198de` 从 R 升至 U；后者于 `2026-10-19T04:07:16.723Z` 由目标 build 认证心跳确认 succeeded。U 为 `75c35204ca708f2ae85b512c074ff854ea84ed29`，设备 build `b2cbdeb72250ef5b1a08060947e2a430619373b8635717e045730e183b5f04e5`。这是基础能力安装成功，不等于一个正在工作的任务已经跨升级续做。

首轮两个任务 `action_5db8afde-53ea-4139-ab66-1ffae1032504`、`action_71a7b3a7-239a-43f9-a046-5f9aad72ec13` 均失败于 admission，原回执为 `admissionRejected:true`、`executionState:not_dispatched`、错误“维护恢复许可无效”；没有启动原生进程或写入测试/业务文件，原失败记录保留。原因是普通任务的 delivery 无维护历史时返回 null，客户端误将其当成非法恢复许可。U 修为 null/undefined 均表示本机无许可且不发送该 JSON 字段；非空恢复许可仍严格校验并完整传给 admission、Bot 启动、事件和结果。U 的定向回归 55/55 通过。

U 安装后的知暖普通任务 `action_890da648-5f3b-4ca5-8ec2-0f70b86bcc99` 已 succeeded：不手动设置工具 workdir 或 cd，执行一次裸 node，返回 cwd `D:\AIUSE\life-assistant`、exit code 0，root PID `18384`、rootExitCode 0、treeConfirmed true、activeProcesses 0，原生 session `20261019_120827_d3f417`。该证据证明 U 的普通任务启动和 D 盘目录；本轮尚未独立回读此 session 的原生 SQLite 工具行，不把模型最终摘要等同于跨升级工具去重证明。

V `e3ddc12f132a1cd770ba6d1486be72ee25a0bf7b` 已推送两个发布分支并于 `2026-10-19T04:09:52Z` 仅发布官方客户端：build `daf73ba86f7fb883cb022edd0807820cfddacfe6bcb3ab5b971060699240ec35`，包 SHA256 `8a3e845507d67d5d89be2b673356694dd059886801e37efe7e1f62a90c9f1ac2`。V 增加待提交维护检查点健康计数，作为本次 U→V 跨升级目标。

首次 UV 实验 `action_af6754dd-7a2f-440c-957a-b4dae381fbfc` 的原生 session `20261019_121138_faaa1e` 中，terminal 参数与测试计划命令一致，但 Windows 原生 shell 传递后 eval 字符串中的反斜杠减少，工具返回 `TEST_CWD_MISMATCH`、exit_code 1，没有创建阶段文件。外层 Hermes action/CLI 最终 succeeded 不代表这个工具测试通过。只读 SQLite 证明 `action_b05f5ad6-b048-40e2-94b6-8541ccf85da3` 保留了原 tool_call 与失败工具结果；该实验没有当作产品恢复成功。随后使用独立 UV2 文件、base64 加 SHA 校验的命令重新实测，未覆盖首实验记录或重跑业务。

UV2 原任务 `action_53440ccf-7295-4a03-8310-4b3612897082` 在 U 上先完成阶段1，独立只读回执确认专用文件计数为1/0。维护检查点 generation1 保留原 action、session `20261019_121912_0ff447`、`zhi-nuan-life` Profile、对应独立 HOME 及 cwd `D:\AIUSE\life-assistant`；pendingTools 0、消息数6，原根57340退出0、treeConfirmed true、activeProcesses 0。随后同一个更新请求 `client-update_cf3c86e0-8f00-4520-9c9e-d26796ce7a46` 从 U 升至 V，目标认证心跳于 `2026-10-19T04:23:20.961Z` 确认 succeeded。

原任务的 `maintenance.resume` 引用同一检查点和 generation1，恢复后的 `action.started` 带同一代次。任务于 `2026-10-19T04:26:04.637Z` succeeded，仍为原 action 和原 nativeSessionId；新根44476退出0、treeConfirmed true、activeProcesses 0。没有创建替代业务 action。最终只读证明 `action_aec7ae7e-f096-4e89-8aa1-1e11062cb60b` 直接查询精确 session 的 SQLite terminal 调用：阶段1命令 SHA256 `0d916782a490d719a990f7c65f7f8900aa7bf7495df21155dd6869e160c2af2d`、阶段2 `a97abd9f31cc4132ca9c34c6740c3d0686bed4816779e5e69bc40dd49163880b`，各调用一次、各有一条原工具结果，exit_code均0；没有仅依据员工总结判断。

同一只读证明确认原文件阶段1/2各一条、阶段1时间仍为升级前的 `2026-10-19T04:19:50.394Z`，阶段2为 `2026-10-19T04:24:13.117Z`，两个守卫文件有效。V 本机健康 build 正确、daemon PID44384、maintenancePausedActionCount 0、maintenancePendingCommitCount 0。命令摘要由固定只读探针从原 SQLite 参数计算，原工具结果原文/字节数/哈希随回执保留；未回传整库或全部命令正文。本次确认范围为这台 Windows 电脑、这个普通 Hermes 任务与 session 的跨升级续做，不推广成所有运行时或所有外部业务都能自动恢复。

最终离线汇总 `live-uv2-attestation.json` 为 passed、5/5 检查通过，SHA256 `71faa50e330387079615133ac96218872a772af5dc22b3f5492a86615aab2493`。它仅汇总上述真实原回执，无网络请求、无凭据读取、没有重跑任务。

原始发布、认证心跳观察、失败任务和普通 smoke 保存在私有目录 `.local/maintenance-resume-release/`，分别见 `server-maintenance-a6411aad5586-62297df2d67b/result.json`、对应三个 `client-maintenance-publication-*/result.json`、`li-maintenance-*-observations-*.jsonl`、`live-test-latest.json`、`phase-proof-latest.json`、`smoke-u-latest.json`、`uv-failed-sqlite-ledger-latest.json`、`uv2-4339358a42804df88999aedd5fd9695e-checkpoint-action.json`、同前缀的 `task-ledger-latest.json` 与 `20261019_121912_0ff447-final-sqlite-ledger-latest.json`。交接文档只保留非秘密的标识和结论，不复制设备令牌或恢复许可。

## 执行与恢复

统一远程升级仍复用现有入口。支持该能力的 Windows Hermes 普通模型任务在收到维护意图后，等待整批工具结束、结果写入原生 SQLite，再正常退出并提交严格检查点。手机命令尚无终态、原生后台进程未退出、未知管理异步写入和不支持的原生 ABI 均继续等待，不用取消信号杀工具来伪装暂停。Codex、原生群组/driver 等未接入的路径继续按原空闲策略维护。

同一 action、任务、会话和 Bot active 锁保持，不提交 failed/result，不创建重复任务。检查点绑定原 executionBinding、更新目标、精确 Profile/HOME/cwd、实际当前 session、消息摘要、计数与真实 root/tree 退出证据。压缩合法切换 child session 时使用当前 session，不要求永远沿用第一次的 ID。

新客户端需等目标 build 的认证心跳、更新器完成及安装锁释放，再由设备专用接口核对当前员工、配置/控制版本、取消意图和原截止时间，取得持久代次许可。仅恢复精确原 session，不重灌原用户 prompt；原会话缺失或消息摘要变化时拒绝重放。已结束 action 的去重不放开，恢复启动前持久化启动窗口，不能把未知的新进程假定为未启动。

Hermes 原生受控中断可能返回 130。只有严格检查点成立，紫薇 wrapper 才把此次维护让出作为实际正常退出 0，同时日志保留 nativeExitCode130/maintenanceExitCode0；普通 130 仍保持失败。工具运行结果不因维护而变成业务成功。

## 失败与权限边界

暂停前先送达原代次事件，暂停/恢复提示由专用服务器记录产生；原代次迟到的普通结果和事件不能结束已经恢复的新代次。普通查询不得取得恢复 token，保留维护事件禁止经通用 events 伪造。原任务总截止时间不因更新重置。

取消尚未启动的升级时，在原安装与原进程身份确认后继续。已启动更新失败，仅在包外 worker 明确证明安装未改或已还原、锁已释放且当前 source build 新鲜心跳吻合时续做；模糊启动窗口不当作还原成功。旧暂停尚未处理前，不能覆盖其唯一更新授权上下文。

手动停止、员工删除、配置/权限或 Bot 控制版本改变时不会恢复旧业务。专用接口在严格确认原退出检查点后明确结束原 action，或接纳精确取消回执，清理原锁；原预算到期也明确结算。网络失败则保留检查点和事件重试，不把永久拒绝伪装成无限网络重试。

本机维护扫描仅对原 action、暂停 blob、started 记录和真实退出证据精确一致的暂停放行；正式版本保全不把这份局部证明当作完整生产命名空间证明。没有删除历史回执、Profile、HOME 或员工数据。

## 验证与发布要求

定向回归覆盖真实 Python bootstrap/SQLite 工具批次、并行、130、摘要篡改、后台及手机待回执、原生不兼容；客户端覆盖暂停/重启/许可持久化、事件失败重传、取消与到期；服务端覆盖真实仓库、设备权限、跨工作区、合法会话覆盖、代次 fencing、幂等、事务失败与公开信息脱敏。Windows 真机未完成前，不用模拟树退出证据冒称现场通过。

发布保留实际 J API 混合树，只覆盖 app、repository、新 action-maintenance 和共享检查点合同。客户端从原官方包显式覆盖本轮闭包，保留依赖和官方更新入口。先装入基础支持，再用独立无外部业务任务做跨升级实测；检查原始 session 工具记录和本次专用测试产物中是否出现重复步骤。未实现通用进程栈恢复、损坏上下文自动迁移或所有 CLI 运行时续做。
