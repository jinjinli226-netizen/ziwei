# E02 owned Profile 首链验收

最终验收时间：2026-10-13 14:50:12（Asia/Shanghai）。新 Bot 使用服务端生成的原生命名 Profile，并将配置、记忆、会话和状态放在该 Profile 的实际 HOME。已有 Bot/Creator 保留原模式。

## 候选与复现

- 基线：`427da4128195820dae6f261b24dcf410a0cd2afe`（Gateway P2，E03 已挑入）。
- 首链计划：`fc0f3b61a47c45affc3db3679e5d453e1c8a9e51`。随后一个实现提交包含本契约、实现、测试及回执，最终 SHA 写入本地 `.local/e02-owned-profile-handoff.json`。
- 真实原生验收：`node scripts/verify-hermes-owned-profile.mjs`。
- 完整 Node 回归：`node --test --test-concurrency=4`；最终 **800/800** 通过，0 失败/取消/跳过，80.884 秒。
- 最后兼容定向回归 **32/32**；lint 检查 **99** 个源码文件；Python AST **3** 个文件通过；`git diff --check` 通过。

第一轮全量 799 项有两处兼容失败，原日志保留为 `.local/owned-profile-full-node-initial.log`。已将旧前端 API 测试预置改为先取得开通证明，并恢复普通原生 Profile 的原认证错误提示；没有放宽认证检查。随后加入 owned-to-owned 来源拒绝用例，最终全量达到 800 项。

本次仅使用此 E02 工作树、临时 HOME、内存数据库、临时 loopback HTTP/model 协议和已安装 Hermes。安装版本 **0.21.3**，HEAD `bbaf7af5c83546d19f8060f4097d3bb25cd1a3c3`。禁止外部 connect/DNS；没有真实账号、手机或正式设备动作。安装源码哈希和既有 Git tracked 状态前后相同。

## 真实证明

原始回执：`.local/owned-profile-1791874169103/receipt.json`。脱敏持久副本：`docs/ops/2026-10-13-e02-owned-profile-receipt.json`，含原始文件绝对路径、SHA256、真实 action ID/PID/session ID、每项 HOME 和进程证明。

| 范围 | 已验证事实 |
| --- | --- |
| 原生布局 5 项 | 两 Profile 被安装版 resolver 识别且 HOME 一致；重复 provision 保留配置/记忆；拒绝无归属目录；两个 OAuth 保存入口拒写来源；拒绝另一个 owned Bot 作为模板 |
| Bot A | `bot-10058e32d69ecb9aea1f1594`，原生 session `20261013_144940_746709` |
| Bot B | `bot-548b64ae080288b2b4b03304`，原生 session `20261013_144949_8bacd4` |
| 异步创建/验证 | 两个真实 `hermes.bot.provision` action、两个 config-only validate，随后正常 activate |
| 主聊天 | 三个实际 Hermes 模型 action；A 经原生 memory 工具写入记忆，B 未读到 A 记忆，重建执行器后 A 继续使用原 HOME/session/记忆 |
| 普通任务 | 管理 API 创建普通 task，actual `task.execute` 回执与 A 的 HOME/session 一致；未等待 Profile 发现心跳刷新 |
| 原生操作 | actual `hermes.bot.native` memory read 返回 A 保存的记忆，bootstrap 证明指向同一 HOME |
| 模型认证 | 四个模型 action 共五次 loopback model HTTP 调用，均使用来源 `.env` 的进程内测试凭据引用；来源 config/auth/.env 哈希不变 |
| 进程终态 | 开通 2、模型 4、原生 memory 1，加原生 fixture harness 1，共 8 个 Windows Job 回执均 launched/rootConfirmed/treeConfirmed=true、rootExitCode=0、activeProcesses=0 |

总计 **9 个真实首链 action**。现有两个 config-only validation 不提供独立 Windows Job processExit 字段；不把它们算作进程树验收。来源配置故意包含不可执行的全局 phone MCP 项，实际本轮 config/调用没有采用它。

## 必要负例与边界

服务端和设备共用开通回执证明：错误 workspace/employee/device/profile/ownership/action、HOME 不一致、缺失结构、未启动、根进程未确认、非零退出、仍有进程、取消/信号/监管失败均不能宣告开通成功。设备证据不完整时返回 EXECUTION_UNCERTAIN；重启发现未完成的开通 journal 时隔离。创建幂等、确定失败同身份恢复、未知状态查询原 action、改名身份不变及 legacy 保留均有测试。

认证状态按新 Bot 的实际 provider 计算，不照搬模板就绪值。来源可选择 default 或普通原生 Profile；发现字段 `owned_profile` / `initialization_source` 可用于 UI 过滤，另一个 owned Bot 在创建前及设备端均明确拒绝。不实现递归认证继承。

认证复用不等于凭据复制。来源 `.env` 只进当前进程，原生 OAuth 存储只读引用；`_save_auth_store`、`_save_codex_tokens` 写入测试已拒绝且来源字节不变。到期 OAuth 的自动刷新仍不支持，需要处理来源授权。`configured` 是配置快照，不能替代真实云端模型验证。

本轮未验收 owned Bot 管理 MCP loader、手机 MCP loader/命令或完整 native driver 组合，也未改手机后续代码。没有修改 E03 工作树/预览、原项目服务/端口、正式客户端或已安装 Hermes；没有 push、merge、部署。首链提交后结束本轮，由 E03 独立挑入并接页面。

E03 具体字段、状态与顺序见 `docs/contracts/2026-10-13-hermes-owned-profile-api.md`。
