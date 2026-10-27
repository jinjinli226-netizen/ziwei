# 客户端升级真实完成与回滚恢复

来源：2026-10-27 本机产品更新 `client-update_75cde577-22e7-4cf5-895b-49032632f28a` 的正式服务端回执、原生维护终态与安装文件核对。该次目标为 `0.1.1 / 5c493588…`；短暂目标心跳使服务端先记为 succeeded，但维护程序随后在 `restart_client` 返回 `PROCESS_EXIT_NONZERO / exit 1`，并恢复旧安装与运行状态。实际恢复为 `0.1.0 / ee06381c…`，不能以服务端的早期成功替代实际安装验收。

旧客户端持久记录停在 `succeeded + worker_launch`，而实际 worker 已退出、维护锁已释放、安装已回滚。旧 tick 在查询新请求前只等待目标构建匹配，因而永久提前返回。同包再建请求不能解除这一状态；没有为此清队列、改业务数据库、伪造回执或手工修改运行账本。

## 修复合同

- 请求创建时按源客户端的 `native_worker_update_verification_v1` 能力冻结协议。`native_worker_v1` 要求认证目标心跳和真实 worker 完成证明共同成立；到达顺序任意，单个心跳不能使仍安装中的请求终结。`legacy_heartbeat` 保留旧客户端首次升级兼容，目标端后续能力不能修改已创建请求的协议。
- 原生 inspector 校验原请求、claim、安装根、安装包哈希、外层及内层 worker 代际、维护锁、真实终态文件哈希、实际安装与启动身份。新启动保存已认证源构建和配置原字节摘要，缺失字段不能编造。
- 旧成功记录也先观察真实 worker 终态。真实回滚使本机协调器进入 failed；早期服务端 succeeded 不得覆盖本机已证实的失败或清除待补报记录。原请求、worker、证据及暂停任务权限均保留，不重跑原请求。
- 强回滚证明只在完整原生恢复证据、对应源构建新鲜心跳及完整授权都满足时才允许正式修正终态。旧记录缺少历史配置或启动身份时仅追加 `observedFailure`，保留原成功事实和 verified_at，明确仍需对账，不把后来新构建伪装成原失败时的构建。
- 旧协议的实际完成使用独立 typed `legacyCompletion`，同样校验真实 job/worker/terminal 链及当前目标启动身份；不填造历史配置前置摘要。新协议不能降级使用它。
- 启动入口使用 60 秒实际等待预算，保留 PID 与构建身份校验；升级器外层启动子进程预算同步为 90 秒。原失败只证明启动子进程退出 1，不能单凭现有回执断言本次唯一原因是旧的 15 轮等待。

实现入口：`backend/device-updates.mjs`、`src/client-remote-update.mjs`、`src/client-remote-update-receipt.mjs`、`scripts/client-remote-update-worker.mjs`、`src/client-start-readiness.mjs`、`scripts/start-ziwei-user.mjs`、`scripts/client-update.mjs`。版本递增至 `0.1.2`。

## 本机恢复与验收边界

本机旧协调器已不能领取远程新请求，恢复使用受支持的原生产品 CLI。原生 Hermes canonical `shell.exec` 是本机 CLI 的管理入口，保留真实 local source、session:control、终端后端及危险命令检查；不调用模型，不通过 WMI 启动 updater。先以实际同用户配置、安装哈希与空闲证据绑定此安装，再执行官方维护命令。必要时先正式 stop，再 update，最后独立 start，避免旧维护 helper 的 30 秒外层时限覆盖新启动预算。

程序文件、配置、真实版本、实际构建、认证心跳、维护终态、旧回滚历史补记与知微的新消息分别验收。首次 `0.1.1` 的早期服务端成功、原生失败和回滚事实均保留。验收前不宣称本机已更新，不重放原业务。

客户端/服务端/原生 inspector 联合隔离测试覆盖冻结协议、到达顺序、缺失或伪造证明拒绝、真实 producer 与 coordinator 对接、旧客户端首次升级、重报去重和暂停任务权限。另以真实 Windows npm 离线包交换夹具验证完整依赖保留与启动失败回滚；这些夹具无业务进程、模型或监听器。现场证据仍位于本机 `D:\AINavtie\ops\ziwei\hermes-gateway-parked-20261027\`；实际安装结论以最终验收文件为准。
