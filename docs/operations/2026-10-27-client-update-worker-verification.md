# 客户端升级真实完成与回滚恢复

来源：2026-10-27 本机产品更新 `client-update_75cde577-22e7-4cf5-895b-49032632f28a` 的正式服务端回执、原生维护终态与安装文件核对。该次目标为 `0.1.1 / 5c493588…`；短暂目标心跳使服务端先记为 succeeded，但维护程序随后在 `restart_client` 返回 `PROCESS_EXIT_NONZERO / exit 1`，并恢复旧安装与运行状态。实际恢复为 `0.1.0 / ee06381c…`，不能以服务端的早期成功替代实际安装验收。

旧客户端持久记录停在 `succeeded + worker_launch`，而实际 worker 已退出、维护锁已释放、安装已回滚。旧 tick 在查询新请求前只等待目标构建匹配，因而永久提前返回。同包再建请求不能解除这一状态；没有为此清队列、改业务数据库、伪造回执或手工修改运行账本。

## 修复合同

- 请求创建时按源客户端的 `native_worker_update_verification_v1` 能力冻结协议。`native_worker_v1` 要求认证目标心跳和真实 worker 完成证明共同成立；到达顺序任意，单个心跳不能使仍安装中的请求终结。`legacy_heartbeat` 保留旧客户端首次升级兼容，目标端后续能力不能修改已创建请求的协议。
- 原生 inspector 校验原请求、claim、安装根、安装包哈希、外层及内层 worker 代际、维护锁、真实终态文件哈希、实际安装与启动身份。新启动保存已认证源构建和配置原字节摘要，缺失字段不能编造。
- 旧成功记录也先观察真实 worker 终态。真实回滚使本机协调器进入 failed；早期服务端 succeeded 不得覆盖本机已证实的失败或清除待补报记录。原请求、worker、证据及暂停任务权限均保留，不重跑原请求。
- 强回滚证明只在完整原生恢复证据、对应源构建新鲜心跳及完整授权都满足时才允许正式修正终态。旧记录缺少历史配置或启动身份时仅追加 `observedFailure`，保留原成功事实和 verified_at，明确仍需对账，不把后来新构建伪装成原失败时的构建。
- 旧协议的实际完成使用独立 typed `legacyCompletion`，同样校验真实 job/worker/terminal 链及当前目标启动身份；不填造历史配置前置摘要。新协议不能降级使用它。
- 启动入口使用 60 秒实际等待预算，保留 PID 与构建身份校验；升级器外层启动子进程预算同步为 90 秒。原生终态只证明启动子进程退出 1，启动等待窗口的归因还须结合下述实际日志证据，不能仅凭退出码推断。

实现入口：`backend/device-updates.mjs`、`src/client-remote-update.mjs`、`src/client-remote-update-receipt.mjs`、`scripts/client-remote-update-worker.mjs`、`src/client-start-readiness.mjs`、`scripts/start-ziwei-user.mjs`、`scripts/client-update.mjs`。版本递增至 `0.1.2`。

## 本机恢复与验收边界

本机旧协调器已不能领取远程新请求，恢复使用受支持的原生产品 CLI。准备阶段复用了既有 Hermes canonical `shell.exec` 管理会话，保留 local source、`session:control`、终端后端及危险命令检查，只执行版本、状态和文件身份的只读核查，没有调用模型或执行升级。该上下文的子进程仍读到 MSIX 虚拟化的 AppData 配置副本：即使固定到实际 daemon 使用的 `C:\Program Files\nodejs\node.exe`，安装根和配置路径均相符、健康接口仍报告预期配置摘要 `7913bf1c…`，文件读取摘要却不一致。哈希门禁因此拒绝执行；没有删除门禁、覆盖真实配置、改用副本配置或修改维护账本。

最终真实上下文来自**已存在的 Windows Explorer 对象**的 `Document.Application.ShellExecute`。它是非 UI 的系统进程 broker，实际只读探针确认了同用户真实配置摘要后，才分阶段调用原生 Node 下的官方 CLI；不是在 UI 终端键入命令，也没有通过 WMI 启动 updater。创建新 `Shell.Application` 后直接调用它自身的 `ShellExecute` 不等同于这一已核验上下文。WMI 在此前仅用于只读诊断，没有执行停止、升级或启动。

恢复顺序为：重新核对源 PID `43364`、`0.1.0 / ee06381c…`、实际配置摘要 `7913bf1c…`、执行与轮询均为零及 `stopSafe=true`；官方 `stop`；官方 `update --package … --sha256 … --expectedBuild … --json`；读取该次官方维护终态，确认 complete、配置保留及维护锁释放；最后独立官方 `start`。启动沿原入口在隐藏窗口进程执行，避免旧维护 helper 的 30 秒外层时限覆盖新启动预算。各阶段单独保留白名单 JSON，未知结果不自动重跑。

### 首次启动失败的实际日志

只读读取真实用户目录的原 `daemon.log`，PID `41508` 的事件为：`03:34:03.147Z started`、`03:34:06.940Z heartbeat_failed`、`03:34:20.054Z connection_drain_requested`、`03:34:21.858Z stopped`、`03:34:21.867Z exited`。对原错误字段的固定分类确认为 `HEARTBEAT_TIMEOUT`；该扫描未发现模块缺失、语法、端口冲突或 Ready 身份不匹配的错误。原始日志保留，未把配置、凭据或业务正文写入诊断报告。

服务端先在 `03:34:06.147Z` 收到目标心跳并记成功，本地随后记录心跳超时。结合心跳请求 3 秒时限、后续重试节奏及旧启动入口的 15 轮等待，证据支持“首次心跳超时，旧启动等待窗口不足以等到本地就绪”的解释。启动 CLI 的原 stdout/stderr 没有持久化，因此不能把具体退出 1 的唯一分支表述为已直接证实。维护终态仍保留原 `restart_client / PROCESS_EXIT_NONZERO / exit 1` 与原安装、运行恢复事实。

### 0.1.2 实际安装验收

本次恢复包对应源码 `eee73b5c56102661a6eafa7f240cca981398052e`，包 SHA-256 为 `fca4705df464633103471b534a764da10e98d3a19b902636be5c4a54ddfd8c49`。新官方维护任务为 `update-4f340d22-0329-41fc-814b-98da98238c4b`，worker PID `6788`，于 `04:53:00.094Z` 返回 complete：源构建 `ee06381c…`，目标构建 `cffd540438d4c7d4142e4df750e2ac2b981e6a4caba82e97649ee0eaffaa08db`，`configurationPreserved=true`，`restoredRunning=false`。后者符合升级前已由官方 stop 停机的实际状态，不能改写成升级器自动恢复运行。

独立 start 后于 `04:54:39.075Z` 完成原生验收：实际版本 `0.1.2`、实际构建 `cffd5404…`、daemon PID `31944`、原生进程身份核验通过、`ready=true`、认证心跳确认、维护锁已释放；真实配置 SHA-256 仍为 `7913bf1c1b490ecf9b6d6760787973c28f8c484703c144eb0028b57ef8166b72`。这是新的官方维护任务及独立启动验收，没有把旧 v1 请求改成成功。

证据文件包括 `NATIVE-CLI-RECOVERY-ATTEMPT.json`、`NATIVE-CLI-SYSTEM-TERMINAL-20261027T045434823Z.json`、`NATIVE-SHELL-BROKER-READONLY.json` 与 `NATIVE-CLI-STARTUP-DETAIL-READONLY-a3ce1b98fbbb4da183a827255cce7dd9.json`。知微的唯一 smoke v2 已由主会话发送，**截至本次文档补记仍等待主会话确认结果**；本机安装通过不能替代消息实际回复验收。

程序文件、配置、真实版本、实际构建、认证心跳、维护终态、旧回滚历史补记与知微的新消息分别验收。首次 `0.1.1` 的早期服务端成功、原生失败和回滚事实均保留，不重放原业务。

客户端/服务端/原生 inspector 联合隔离测试覆盖冻结协议、到达顺序、缺失或伪造证明拒绝、真实 producer 与 coordinator 对接、旧客户端首次升级、重报去重和暂停任务权限。另以真实 Windows npm 离线包交换夹具验证完整依赖保留与启动失败回滚；这些夹具无业务进程、模型或监听器。现场证据仍位于本机 `D:\AINavtie\ops\ziwei\hermes-gateway-parked-20261027\`；实际安装结论以最终验收文件为准。
