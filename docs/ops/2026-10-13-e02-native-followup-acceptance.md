# E02 Group / Gateway P2 补丁验收

日期：2026-10-13。父提交：`037cb777c5f23d81622d451a5d1b67cd2098b786`。分支：`codex/v2-e02-native-capabilities`。
工作树：`C:\Users\25941\.codex\worktrees\v2-e02-native-capabilities\灵光爸爸拆解`。补丁 SHA 见 `.local/e02-native-followup-handoff.json` 与本分支 HEAD。

## 修复结果

1. Group 初始正文的精确 @source 使用受信 context 建立的原生冻结 roster 校验。完整 mention 解析同时关闭 `.fake` / `:other` 等前缀误匹配；不修改前端目标数组约定。
2. Group 在同一个父 action 下执行多次 source 回合时只注册一个监督器。所有本机模型及 read/publish 子进程登记到该监督器；seal 与全部 child 终态共同决定聚合证据。停止会关闭后续模型准入，第二轮的未知树、甚至 launched:false 但未确认回收，都不能升级成已停止。
3. Gateway 观察原生 fatal、running、send_path_degraded 及明确的接收路径。Mattermost 认证失败、WebSocket listener 结束、Webhook site 停止后不再报 connected。失败状态与脱敏原因保留，停止准入先于 cleanup，JS 同步阻止入站派发与新发送。
4. JS 停止门闩防止缓冲事件重新开放准入。短暂恢复重新观察原 source 的 pending/accepted；保留与旧观察者并发的恢复事件。原生发送 CAS 仍保证 delivery_started 未知结果不重发。Windows 树未知时 processAlive 为 null，disconnect 不报确认，新 connect 不创建 worker。

## 本轮新增证据

- 最终 Node 全量：`node --test --test-concurrency=4`，787/787 通过，0 失败/跳过，85.06 秒。日志 `.local/native-followup-tests-bounded.log`；新增 Group 监督与 Gateway 状态/竞态共 11 项。原 776 项没有作为本补丁的新证明复用。
- 默认并发的一次复跑为 785/787：既有 idle-progress 窄时间窗口失败、既有 detached-service 测试在 cleanup 时目录 EPERM。失败日志保留 `.local/native-followup-tests-final.log`；不修改这些测试，单独复核对应两个文件 16/16 通过（`.local/native-followup-existing-recheck.log`），随后以上限制并发的完整测试通过。此前新增第 11 个测试前的默认并发全量也是 786/786。
- Lint：96 个 source files 通过；两个 Python 文件 AST 解析通过；`git diff --check` 通过。
- 实际安装 Hermes 0.21.3，源码 HEAD `bbaf7af5c83546d19f8060f4097d3bb25cd1a3c3`。安装目录原有四个 tracked 修改仍在，未变更安装或启动入口。
- 原生 Group 验证：`.local/native-followup-1791856695927/receipt.json`。初始精确 @source 实际执行 source → peer → source，共 3 个原生模型调用回合；预算上限为 1、暂停的 allowEvaluation:false 均只完成 source 首轮；第二 source 回合等待模型响应期间由 ActionDispatcher.cancel 取消，原 action 重投不重跑。四个场景各仅注册 1 个父监督器，最终树确认且 activeProcesses:0。
- 最新原生 Room / Gateway 回归：`.local/native-followup-1791856821008/receipt.json` 与 `adapter-tests.log`，9/9 通过（2 个 Room、7 个 Gateway 场景）。其中 Mattermost 保留真实 connect/_ws_loop/fatal/disconnect，仅隔离注入认证响应和本地故障；Webhook 实际监听 127.0.0.1 的系统分配端口，再停止该测试 listener。整个 Python 验证进程由 Windows Job 监管，rootExitCode:0、treeConfirmed:true、activeProcesses:0。
- 可移交的精简证据：`docs/ops/2026-10-13-e02-native-followup-receipt.json`。完整模型结果和每个子进程证据保存在上述 `.local` 目录。

## 验证边界与 E03 接入

Group 的 source 和 peer 都调用本机实际安装的 Hermes 执行链，使用不同员工的隔离 HOME/会话。模型服务、平台 A2A 派发及结算响应使用 loopback 协议夹具；测试了真实原生计划、模型调用、Room 发布和 Windows Job 停止，没有使用外部云账号或向第三方发送消息。暂停场景模拟受控结算返回 allowEvaluation:false；平台真实授权/调度由全量 API 和 scheduler 回归另行覆盖。

原生健康探针依据已核对的 0.21.3 接口；没有泛扫所有后台 task，也没有接管 GatewayRunner。其他云渠道仍需其有效账号和目标电脑 SDK 验证。本次不声称 E03 组合预览已应用此补丁。

E03 集成时保留 `targetEmployeeIds` 仅含其他授权成员；正文可 @发起者。页面应按渠道 status/code 展示失败或恢复中，按独立 processExit/stopConfirmed 展示停止证据。尤其不要把 processAlive:null 或请求受理视为树退出确认。

此提交仅修改 E02 隔离树。未操作当前 E03 工作树/运行实例、原目录、2884 正式链路、设备业务或外部账号；未 push、merge、部署或重启服务。由协调者取补丁后交 E03 完成组合验收。
