# 网页重构基线纠正

核对日期：2026-10-29。仅对齐源码；没有发布、升级正式客户端或重放业务。部署材料包含 2026-10-28 回执及另一任务在 2026-10-29 提供的只读状态，本轮未重新连接生产。

| GitHub main | 当前重构基线 | 已部署平台回执 | 本机安装 |
| --- | --- | --- | --- |
| `51a68fe6f1a8c9c8868897db5fa1367def6ed0f4` | `8e4f37af60a473ecc2b811fa66d8461c11d66e7d` | `/opt/ziwei/releases/capability-reporting-8e4f37a-20261028-retry2` | daemon `0.1.4`，build `23923648dbcb72ba6f74feba00fd4bacab651513596c528ae4defe4fc55c999b`；Workspace CLI `2.0.3` |

基线分支包含当前 main，以及按顺序的 `343bfbe`（失败终态）、`b5a54bc`（能力界面清理）、`8e4f37a`（员工主动回填）。已用 Git 祖先关系确认。

部署状态回执位于本机 `D:/AINavtie/ops/ziwei/capability-reporting-rollout-20261028/DEPLOYMENT-STATUS.json`，详细验收为同目录 `DEPLOYMENT-ACCEPTANCE.json`。回执记录平台部署、Web/API 与本机一次 CLI/MCP 安装核验，必需部署待办为空；并不表示所有员工或设备均已在线验收。关联证据 hash 已由本轮只读核对。

2026-10-29 05:36 UTC 的后续只读观测仍指向同一 release，但 Workspace API 为 `activating/auto-restart`，观测到重启计数 513；有限日志没有建立其具体原因。记录为 `D:/AINavtie/ops/ziwei/version-baseline-readonly-20261029/SUMMARY.json`。独立生态 API 的 `member_configuration` 错误由其他任务处理，不能据此推断 Workspace API 同因，也不能把昨天的部署回执当成今天服务健康的证明。本分支不接管服务修复或部署。

正式 daemon 当前 `127.0.0.1:20242` 无监听，配置 API 为 `https://qzelynth.top/`，workspace 为空。Workspace CLI 现有统一身份槽属于 `https://ziwei.qzelynth.top`、person、bigtron。这两层身份和配置不得互相覆盖。

## 旧改动的恢复点

- 原基线：`f88d6f8678face7ea3d414674e4e76707d7fc376`（2026-10-08），相对当前 main 落后 370 提交。
- 原工作树 64 个源码、测试和文档文件已保存为 `0d9f504629d175eb3fd7250ebd5594ce03078f2d`，分支 `codex/ziwei-legacy-refactor-snapshot-20261029`。
- 本机另存并核验增量 bundle 与完整补丁：`D:/AINavtie/ops/ziwei/legacy-refactor-snapshot-20261029-134056/`。四个原有历史临时文件保存在同目录，不进入 Git。
- 旧 `.local/`、历史测试数据和截图仍保留在本机，不作为最新平台或正式设备在线证据。
- 原先 304 项测试及模型验收仅属于旧工作树，不能转述为本基线回归通过。
- 当前分支：`codex/ziwei-current-baseline-20261029`，从完整的 `8e4f37a` 开始有选择地迁移。

## 差异处置

最新代码已有持久 action 排队、按员工串行和跨员工调度、精确 Codex thread 绑定、原生 Hermes owned profile、统一登录、provider 专用密文通道、手机互联和员工能力主动回填。不得用旧 `App.vue`、repository、daemon、runtime adapter 或固定 legacy 身份声明覆盖这些模块。

可迁移增量限定为：队列在网页上的管理合同、DSH 原生协议接入、Skill 明确要求的 IME/滚动/分栏规则，以及在最新实现中仍能复现的具体缺陷。每项先用新基线测试复现，再最小适配。详细步骤见 `docs/plans/2026-10-29-current-baseline-web-refactor.md`。

部署混合层、既有身份/账号/员工/设备、owned HOME/Profile、provider 凭据版本和墓碑、失败或未知回执、活进程禁止重放等均为保留项。生产发布须由既有部署流程另行处理，本工作分支只交付可审查源码提交。
