# Windows 早期客户端迁移（2026-10-12）

## 原因与兼容范围

ThinkPad 的实际健康端口为 33001；旧服务返回正确 service、agentId、PID 和 workspace，但缺 deviceId、clientBuild、activeActionCount、pollingCount。历史源码确认这一代没有认证 pause/drain 接口。常规维护的身份校验因此拒绝停止，重复 update 无法解决。不存在将缺失计数补成零的可靠办法。

新增 `ziwei_user update-check --json`，只读检查返回 stopped、ready 或 legacy_confirmation_required。失败返回有界 reasonCode/原因，不输出原始配置、进程命令或环境。旧版兼容只接受八个已核对的历史 daemon 入口及对应配置模块；目标 Windows 进程的 Node 路径、唯一入口、创建时间、同用户、真实 PEB 工作目录及配置环境、配置 SHA 和 loopback 监听 PID 均须匹配。未采集的跨驱动相对环境路径直接拒绝。MSIX 跨上下文仅接受目标环境明确给出的物理 LocalCache 配置路径。

## 官方入口与确认

原入口保持：

```powershell
irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex
```

脚本先下载并校验官方包，再从临时目录运行新版检查器。现代客户端和已停止客户端沿原维护路径执行。已核实的早期实例显示 PID、配置路径和任务状态 UNKNOWN，要求先结束或取消当前工作，并明确输入 YES 同意停止和恢复原连接。任何其他输入取消。

确认绑定原始五分钟 proof；CLI、job、worker 和最终停止检查均保留原实例及原有效期，不为新 PID 自动续签确认。停止前持有 Windows 进程句柄，重新核验创建时间、命令、Node、配置 SHA 和实际监听 PID，只结束该句柄并等待退出。

旧版无法证明任务已排空。恢复连接后客户端可能重新取得服务器上的未完成任务；此迁移不提供“绝不重放”保证，也不修改服务器队列或代用户发送业务动作。返回值保留 activeActionCount/pollingCount 为 null、drained=false 和 unfinishedTasksMayResume。

## 失败与恢复

先完整准备候选包，再停止已确认实例；在同一 node_modules 内保留备份并更换程序，原 npm prefix、入口和用户配置保留。迁移后或回退启动前，维护器独立确认没有现存实例；启动后再次核验真实运行进程、安装和配置，不能仅凭历史 start 脚本退出码 0 报告恢复成功。

停止已完成而后续检查失败时，内部退出回执传给 updater，避免赋值未完成而遗漏恢复。结果分别提供 originalInstallationRestored 和 runningStateRestored；配置或安装已被外部改变时拒绝自动恢复，不覆盖新配置。原文件恢复成功但启动失败会明确报告原运行状态未恢复。

完整历史包验收还复现了 Windows Node 24.13.0 的 `fs.cpSync` 原生退出 `0xC0000409`：独立复制已准备好的依赖树也崩溃，没有进入 JavaScript catch/exit hook，旧客户端保持运行。因此候选复制改用逐层 lstat、mkdir 和独占 copyFile，拒绝链接及特殊文件，仍在停止前完成全部复制。70 个实际依赖包、857 个安装文件逐个 SHA 验证通过；junction 负例在停止前拒绝，未复制隔离目录外数据。

## 验收与发布边界

历史包完整验收采用 d18121e 的原 Git 归档和独立 npm prefix，共16个旧包文件逐个核对。正常升级、坏候选启动退出23后的回退、真实停止完成后携带退出回执抛错的恢复，三场景均通过并清理各自隔离实例。成功迁移核验新版健康字段与实例，回退两场景核验原包全部文件、原配置/认证/memory 字节及重新运行的实际旧 PID。局部生命周期单测的历史入口加隔离业务依赖不等同于这项完整旧安装包验收。

第四场景执行实际 PowerShell bootstrap→CLI→job→独立 worker，只有两次官方下载改接隔离 loopback mock，精确 YES 回答限定本次隔离实例。原 proof 与 job 一致，worker43924实际 complete/exit0，新daemon41940恢复原配置，最终原runner通过全部断言并清理实例。PowerShell 在08:49:37Z已完成，外层execFile等待至约08:54才返回；保留了这一标准流关闭延迟的日志，没有重放升级或将中间仍在等待的状态报告为失败。

最终完整回归 **678/678**，fail/cancelled/skipped/todo 均0；lint78通过，前端1764模块构建通过。独立复制/更新回归10/10，身份核验7/7，早期生命周期5/5。最终候选的四个完整历史安装场景全部通过。

最终候选从已暂存 Git tree 归档生成，Windows 独立 npm 安装34个包文件均与归档逐字节一致，唯一允许差异为 npm 对 bin 第一行 shebang 的 CRLF→LF 归一。包 SHA256 `5c0fdbbab4c4d6c384b3e8e8ed079613cc0ed46213b58834d1ec9e621d7952f3`、124143 bytes；Windows build `54a0530deb0d0a0a6936a64abc77793fa7f1e72d91bb416204656687e6bf0ee7`，sourceBuild `e42c1538a789e037aa9c5052879604f283e9fed5b149bb16b61bff618f136ab4`。所有发布文件和 bootstrap 的 Git blob 已逐个核对，与源码提交 `d01dc8307f04145f17ee5fef0b643dc565eee36e` 相同。

## 已发布结果

源码 `d01dc83` 已推送 `origin/codex/employee-default-workdir`。北京时间2026-10-12 16:58:55完成仅客户端发布，操作 `bc71b6b0c1cd49b1a8f4e467416e1110`；仅替换 ziwei-latest.tgz、update-windows.ps1、release.json，metadata 最后切换。原文件备份在 `/opt/ziwei-backups/client-legacy-maintenance/bc71b6b0c1cd49b1a8f4e467416e1110`。

公开 HTTPS 三资源已在发布后及独立只读 verify 各下载核对 SHA/大小。bootstrap SHA 为 `45af42a6d314974c74818a93ecdaafff8ea3f5c7454d5bdd3767369fa4d9591e`，metadata SHA 为 `86078e0be7cc78aa766c43e1a88847c38cb2edae0772d1eba98b1cb53cf8ee06`。主 API181593、control134533、Nginx737、release标记、前端首页及Nginx配置与发布前完全一致；发布器没有数据库操作。

发布后本机只读核对仍为 PID36264、build c7b83…、bigtron、ready=true、activeActionCount=0，观察器39608仍运行。此次未再次升级或停启本机。磁盘配置当前 SHA 为 a633f988…，不同于更早功能验收时的7913bf1c…，本发布未写该配置，未将其字节相同列为本次验收结论。

本次仅发布官方客户端下载文件；主 API、前端、控制服务、Nginx 和本机已验收的 PID36264/观察器39608不因发布而重启。ThinkPad 本机是否完成升级须以其实际 update-status 和健康结果为准，不能用隔离环境的成功代替。

员工默认工作目录已完成的验收和仍待精确清理的 QA 数据沿用 [原运维记录](2026-10-12-employee-default-workdir.md)，本次不重新执行清理。
