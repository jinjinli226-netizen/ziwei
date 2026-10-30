# 2026-10-30 DSH 会话终态与 CLI 维护

## 根因与修复

本机维护扫描将已成功投递的 DSH 原生会话误报为 `UNMAPPED_NATIVE_EXECUTION`。DSH 使用持久化的 `dshBinding` 和 `sessionExit` 表示会话结束，维护扫描原先只识别 CLI 的 `processExit`，因此一条正常历史阻止了更新。

`backend/preservation-native-evidence.mjs` 现在在本机维护路径复用 `confirmedDshSessionExit`，同时验证 started/completed、投递 journal、员工、设备与工作区身份。仅已确认投递且原生会话终态匹配时放行；不生成进程退出证据、不改写原执行历史。正式版本封存路径保持原规则。

## 验证

- `test/daemon-dsh-maintenance.test.mjs` 新增 21 项真实 DSH 协议 fixture → dispatcher → repository → delivery 回归，修复前复现失败，修复后通过。包含完成、已确认取消、身份错配、未确认取消、缺少 journal 等情况。
- 与 maintenance-files、background-maintenance、DSH supervision、native-file-identity 合跑 135/135 通过；lint 345 个源文件、diff 检查通过。独立代码审查通过。
- 2026-10-30 10:49（Asia/Shanghai）只读扫描当前本机用户 HOME：`safe=true`、`stopSafe=true`、issues 为空，`action-state.json` 原字节不变。该结果是候选源码扫描，不能代替已装 CLI 验收。
- 扩展的 `daemon-local-stop-admission` 有 8 项在扫描前失败，其旧 VM fixture 未提供当前 daemon 使用的 `maintenancePausedActions` 等字段；`failed-background-history-maintenance` 也存在旧 supervision fixture 不兼容。这些未计入通过结果，本次未修改相关产品流程或测试。

## 安装边界

用户明确允许终止已核实归属的旧紫薇 CLI 进程，不再补旧版本兼容；账号配置、员工 Profile、聊天和历史文件保持。旧员工若影响重新搭建，用户允许通过正式管理入口删除。CLI 安装与实际 build/ready 验收由“紫薇 CLI 对齐与安全升级”会话统一执行，网页端 `57531bd` 已独立发布。

现有固定历史任务的 force-abandon 授权不适用于本次 DSH 成功回执，服务端 grant 不是这次误判的修复方式。昨天的损坏/孤儿投递计数也不是当前维护状态。

## 实际安装验收

源码修复提交 `4d090095291f524e6621362345d12d9af46c4335` 已推送并核对远端。CLI 维护会话按用户要求撤回旧版兼容增量，核实并终止旧 daemon 后，通过官方本地包更新流程安装；随后按同会话的新指令一并安装两项 Hermes 修复。最终整合包来源为 `b62cbef7c3121fad7b042a9753278cb76a7f1e43`，包 SHA-256 为 `686a05c8dcee88863353b4173aad3d687aafd948ecc7c584829d20c92c853e2b`。

2026-10-30 10:59–11:00（Asia/Shanghai）独立复核：实际版本仍为 `0.1.4`，安装与运行 build 均为 `2c5c054d8ac48e380652da6eaf2c10f3bd604eca450a3f880053d7e4caf1ed29`；端口 `20242` 单实例监听，health/ready 为 200，工作区连接为 connected。新业务验收运行期间维护检查可暂时显示忙碌；空闲后 `safe=true`、`stopSafe=true`、待投递/阻塞/active/quarantine 均为零。原配置、action-state 和 DSH 回执保留，本次未删除员工或更新网页。Hermes 真实业务验收由对应会话继续，不由本次 CLI 安装健康推断完成。

原始安装和回滚证据保存在维护会话本机交付目录，未进入 Git。npm 安装会将 CLI 入口换行规范为 LF，因此以安装后的源码 build 核验，不将解包时的不同换行指纹误报为更新成功或失败。
