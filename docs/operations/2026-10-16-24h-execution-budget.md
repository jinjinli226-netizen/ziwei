# 2026-10-16 长任务默认 24 小时

## 现场证据与范围

TikTokTrendS 在公司台式的两次模型执行分别运行约 898635ms 和 898160ms 后由 A2A 硬超时结束：`action_427a095b-9aa8-4672-8873-5ac8755f52cb`、`action_0c721692-7517-408c-8be3-2bb3bd88f8fc`。第二次超时前约 19 秒仍有输出。两次都有原进程及进程树结束证据，不能将它们解释成单纯模型未响应或手机离线。

原 daemon 默认硬时限 15 分钟，服务器执行租约为 15 分钟加 60 秒，Hermes 配置与 CLI 参数另有 840 秒软预算。用户明确要求改为 24 小时。

## 实现

- 共享 `src/action-execution-budget.mjs`：原生 conversation/agent/runtime/automation、携模型运行参数的 task，以及实际调用模型的原生 goals/heartbeat/groups step、group collaboration、kanban dispatch 默认执行 86400000ms。
- 初始、ACK、事件及结果交付续租统一使用执行预算加 60000ms。显式短 timeout 仍约束执行，服务器保留至少 15 分钟加 60 秒的原回执交付窗口，避免短动作无法上传结果。
- Hermes HOME 的 run_budget_seconds 与 CLI --run-budget 同为 86400。新 Kanban 卡片沿用此预算，领取租约为 86460 秒；旧卡片历史元数据未批量改写，受控模型执行不按旧卡片 840 秒字段硬停止。
- Gateway 持续读取原 action，使用相应执行租约作为等待预算，不重派业务动作。
- 手机 MCP 执行授权覆盖该次长任务，并以数据库原动作真实 expires_at 为上限；普通请求保留原 30 分钟上限。修正公开 action 视图缺少 expires_at 导致旧到期检查得到 NaN 的问题。结束、设备撤销、配置变动或越范围仍拒绝调用；单条手机命令超时未更改。
- 手动停止、失联控制、明确较短时限、最大轮数、进程树退出证明、去重和终态回执继续有效。24 小时是单次执行上限，不等于无限轮数或电脑关机仍运行。

## 验证

15 个相关测试文件在禁监听环境串行执行：142 项，141 通过、1 个既有 Windows 进程树专项跳过。包含加速时钟下跨越 15 分钟并在 24 小时停止、短 timeout、手动停止、旧短 ACK 租约约束、服务器续租、手机凭据 31 分钟/24 小时边界及撤销、Gateway 跨 31 分钟后回传同一回复、实际 Python bridge 将 86400/86460 传给 Kanban API。

未更改的一项 Windows 路径断言在 Mac 上失败，已在上一发布源码 d915129 同样复现，最终专项运行排除该不适用用例；未为此做 Mac 适配。首次并发执行遇到已有 100ms idle 测试的调度抖动，改为串行后完整相关回归通过。lint 151 源文件、Python AST、前端构建、离线运行依赖闭包通过。日志在工作树 `.local/24h-release-tests.log`、`.local/24h-baseline-mac-test.log`、`.local/24h-build.log`。

未在 Windows 上实际持续运行满 24 小时，也没有重放用户的 Camoufox 安装任务；模拟时钟验证与实机运行明确区分。

## 发布与回退

先推 GitHub `codex/v2-20261014-release`：`eabe098af3b6c0e7d76cf4121052e3606e022888`。2026-10-16 12:14（Asia/Shanghai）发布：

- 主站/API：`/opt/ziwei/releases/v2-hotfix-eabe098af3b6/v2`。
- 上一主站：`/opt/ziwei/releases/v2-hotfix-891685f70e9e/v2`；已保留其全部手机回执及终端诊断改动。
- 官方 Windows clientBuild：`ba86b25db751ac6322d74c6c7e1353a7984b69d5a18a97c7e87beee46c6f195a`。
- 官方客户端 tgz：1077188 字节，SHA-256 `b48c6ce510dbd6a3e2221e30764877d0f5d96e4f7202129017ff1b541ff35202`。
- 备份：`/opt/ziwei-staging/backups/24h-execution-20261016T041424Z`，含原下载包/元数据及发布时 SQLite 一致快照。
- 部署证据：`/opt/ziwei-staging/24h-execution-eabe098af3b6/deploy-result.json`。

部署验收确认主站/API healthy、公开前端 JS 与构建哈希一致、登录状态接口正常、公开下载包/元数据一致；数据库 inode/schema 未改变；中控服务、Nginx 进程及配置未改变。发布过程中仅重启主站 API。

回退本补丁时切回上一主站符号链接并重启主站 API，恢复备份中的官方客户端 tgz 与 release.json；保留正在使用的数据库，不能拿发布前快照覆盖发布后的业务数据。已安装新客户端的电脑如需回退须使用对应旧包；仅回退服务器不会改变本机安装。

## Windows 接续

发布包不表示电脑已升级。使用官方更新入口：

```powershell
Invoke-RestMethod -Uri ('https' + '://qzelynth.top/downloads/cli/update-windows.ps1') | Invoke-Expression
```

确认公司台式心跳 client_build 为新值后再发起任务。已有旧客户端进程和已启动 action 的计时器不会因为服务器部署自动改变；不强制终止用户当前任务、不自动重复安装、不重建 Bot/Profile/HOME。后续核实长任务是否越过 15 分钟并仍有正常进度/终态回执。
