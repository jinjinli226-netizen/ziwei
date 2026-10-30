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
