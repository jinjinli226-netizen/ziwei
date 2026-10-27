# Hermes 0.22.5 已有独立 Profile 的入口兼容修复

2026-10-26，实际 Hermes UV 安装为 `0.22.5+1507.gc2c5eef.dirty`，原生解释器为该安装的 `venv/Scripts/python.exe`。已安装紫薇客户端仍是 build `ed4a194f…`；与源码 `67b85ab` 的 `runtime-adapters.mjs` 字节差异仅为换行，整个文件及初始 probe 片段经 LF 归一化均相等。launcher 与 Python bootstrap 原始哈希也与源码相同。不能把其他磁盘的候选 checkout 当实际安装。

## 原因

已有独立 Profile 的执行，在模型启动前会先执行受绑定的 `--probe`。旧适配器在此要求原生 `profiles.py` 同时提供查询函数和创建辅助函数 `_finish_profile_layout`。实际 Hermes 0.22.5 已移除后者，查询函数 `get_profile_dir` / `profile_exists` 仍在。结果是已有员工也被拒绝；外层笼统提示将其描述为 managed MCP discovery 不兼容或安装变化。

修复将已有 Profile 的入口契约限定为实际使用的查询函数。新建 Profile 的创建契约仍由 `hermes-owned-profile.py` 单独检查，未绕过或宣称已适配新建流程。原生入口、Python、Profile/HOME、身份校验、源码哈希绑定以及执行前变化检查保持原有约束。

## 证据与验证

- 隔离合成安装先红后绿：只提供新版保留的查询函数、没有旧创建辅助函数时，旧适配器拒绝，修复后通过；删掉必要查询函数仍拒绝。
- 对实际安装使用同一原生 Python、合成 HOME、空 MCP 配置，并通过审计钩子禁止网络、子进程、真实业务/凭据读取和安装目录写入。旧适配器退出 **125**，白名单异常原因明确为 `owned profile layout`，耗时 172 ms；修复候选退出 **0**，返回有效源码绑定，耗时 281 ms。两次无被阻止的写入/网络尝试、模型调用为零，不保留原始 stderr。
- 相关 Node 回归 36 项：33 通过、3 因默认 Python 测试发现不可用而跳过、0 失败。入口/bootstrap 关键回归使用已有原生 Python 实际执行；已确认受保护的真实安装 probe 成功，不以跳过用例代替此证据。

```powershell
node --test test/hermes-mcp-bootstrap.test.mjs test/hermes-launcher.test.mjs test/hermes-owned-runtime.test.mjs test/hermes-owned-profile.test.mjs test/hermes-owned-diagnostics.test.mjs
```

## 发布和业务边界

源码修复与实际客户端加载分开验收。客户端修复包应保留现场原安装及已有增量，只改变本项适配文件；不能因本次故障回退源码分支或替换成其他运行时。通过受支持的原生维护/设备更新流程，在准确核实空闲、安全停止、配置和包哈希后更新。不得通过 WMI 启动 updater 绕过既有审批拒绝。

原失败动作和 uncertain 回执保留，不补造退出证明。没有重放原派工、启动 Routine 或代用户调用付费模型；入口通过不代表原业务已完成，后续真实业务由用户重试。

## 实际客户端安装验收

2026-10-26 22:35:51（Asia/Shanghai），受支持的产品设备更新请求已成功，服务端确认目标构建认证心跳。已安装 build 为 `613938f68b01278260d7ba93825871a9e3bd14431cb9dc855dcf85d27b81842e`，安装包 SHA-256 为 `23b27cb5e59395ecaef7dbc1db74b63f2f36ffa7c298e033945e0fc6a00e32ab`，实际 bootstrap 文件 SHA-256 为 `61a4ed44d732500360914d231f540b0e5acba8d7648c3565d9111d56d03bfa46`。

本次是现场客户端基线上的单文件补丁，未回退源码分支或整树替换服务器。两域元数据与实际包已核对，冷离线安装证明与目标 build 一致。产品更新使用 `waitForIdle:true`，原生维护程序返回 `complete`、配置保留且原运行状态恢复；没有通过 WMI 启动 updater。

原 Windows 用户、安装位置、工作区/设备、配置路径、Profile 名单和 63 个受保护文件指纹均保持一致。两条原失败回执摘要哈希一致，仍是 failed/uncertain，没有补造退出或业务成功。已安装文件在完整独立员工标志、合成 HOME 与禁止联网/子进程/安装写入的条件下，`--probe` 退出 0 并返回有效绑定。

独立只读退出/健康观察器已重新挂接新 PID，10 秒采样至少 16 条健康且身份匹配，端口登记仅更新诊断备注，原端口不变。详细脱敏证据位于本机 `D:\AINavtie\ops\ziwei\hermes-managed-mcp-20261026\CLIENT-INSTALLATION-ACCEPTANCE.json`；未上传本机私有原始材料。原业务未自动重试，也未调用付费模型验收。

## 后续文字聊天参数兼容（23:07 用户回报）

已有 Profile 的初始 probe 通过后，用户重试进一步到达 Hermes 的 Gateway 聊天入口，但被 `Unsupported gateway CLI options: --run-budget` 拒绝，退出码 2。实际安装的 `hermes_cli/gateway_chat.py` 明确拒绝此参数，并要求使用 `agent.run_budget_seconds`。这与前一项查询契约故障是不同的启动阶段；初始 probe 通过不能代表完整聊天已验收。

紫薇已经在员工独立的 `config.yaml` 中生成 `agent.run_budget_seconds: 86400`，因此本项去掉重复且被新版拒绝的 CLI 参数，不删除时间限制。这里的预算是单次执行最长时间（24 小时），不是费用或 token 额度；正常完成会提前退出。轮数设置、聚合任务预算、外层进程监督、员工身份和权限保持原合同。`hermesBotChatInvocation` 由实际执行路径调用，便于在 Windows 上直接测试最终聊天参数；原 POSIX 实际 spawn 回归仍保留。

验证先用保留旧参数的构造器重现回归失败，再去掉参数通过。相关回归 36 项中 32 通过、4 因 POSIX shebang / 默认 Python 测试发现限制跳过、0 失败；lint 检查 264 个源码文件通过。另用现场已绑定原生 Python，在合成 HOME 和审计保护下执行实际安装的完整 argparse、Gateway `validate_options` 函数和原生 effective-config reader：修正后的文字聊天参数接受，恢复旧参数则准确重现原拒绝，读取的时间预算仍为 86400、最大轮数仍为 9007199254740991。无 Gateway、模型、真实 MCP 或业务启动；原生依赖探测 Windows 版本的三次子进程尝试均由保护钩子拦截，其余外部写入/业务读取不允许。详细证明在本机 `D:\AINavtie\ops\ziwei\hermes-run-budget-20261026\NATIVE-CHAT-CONTRACT.json`。

本项验证覆盖此次文字聊天参数拒绝及配置读取，不宣称新版 Gateway 的读图、Provider 请求、工具调用和实际业务已经通过。原 `--image` 路径与完整 Gateway 生命周期若有其他变化，须依据对应现场结果单独验收；不擅自改走其他运行时。原失败记录保留，不自动重试。正式客户端安装需另外确认目标 build、文件哈希和认证心跳，不能把源码修复或离线包就绪当作已经生效。

## run-budget 补丁的实际安装与验收

源码修复 `d2b0e59a7766f8d1de155a8c391b3215c077f187` 已推送并核对远端。正式补丁以现场 `613938f6…` 客户端为基线，仅改变 `src/runtime-adapters.mjs`，保留前次 bootstrap 修复及其他客户端增量。包 SHA-256 为 `484d2573f179abaa71526bca094bc531bced8aa470b09a2b5e6b17140d9ff60b`，大小 1,220,671 字节；两个官方域名的元数据与实际下载内容均已核验。API、网页及其他正式制品保持既有版本。

第一次受支持产品升级因 `restart_client / PROCESS_EXIT_NONZERO` 失败并恢复原安装：现场首次心跳超时，原生启动程序等待 15 秒，而恢复后的首次成功心跳约在启动 25 秒后到达。保留原失败维护结果；通过同一请求已绑定的正式维护接口如实登记失败，没有改业务数据库、补造认证心跳或通过 WMI 启动更新程序。自动审批曾拒绝维护失败回报及临时加密文件清理，用户明确要求重新申请后，正式审批执行成功（HTTP 200），临时 DPAPI 加密凭据文件已删除。

使用一个新的稳定重试标识、`waitForIdle:true`，重新确认实际安装、配置和零活动动作后，产品升级于 **2026-10-27 00:39:07（Asia/Shanghai）** 获得服务端目标构建认证心跳。实际安装及运行 build 为 `ee06381cab88a4119bbf053a2d175e8e8ffe4c1bcf3f0b4a0b57cb3ec2f98871`。原生维护结果为 `complete`，配置保留且原运行状态恢复；实际适配文件 SHA-256 为 `253e0d8d102e691c1d7d26f288046136d1829f944f73fc4abb993e8cec694d23`，bootstrap 仍为 `61a4ed44…`。

08:09 的最终验收确认原 Windows 身份、设备/工作区、数据根、配置、Profile 名单及三条原失败回执一致；未重放业务或调用模型。63 个受保护文件中 62 个指纹不变；唯一变化为原生 `auth.json`，修改时间为 08:00:06，晚于维护完成七个多小时。此差异原样记录，当前原生授权存储保留在原处，未用旧副本回填，不能宣称全部 63 个文件字节相同。

从实际安装模块生成的文字聊天参数再次通过同一原生 Python 的 argparse、Gateway 选项校验和 effective-config reader；旧参数仍会准确触发拒绝，时间预算仍为 86400。独立只读退出观察器已挂接当前实际进程，至少两次 10 秒间隔健康采样确认身份，日志继续追加并保留历史，端口登记仅更新备注。详细脱敏验收在本机 `D:\AINavtie\ops\ziwei\hermes-run-budget-20261026\`，包括 `FINAL-VERIFICATION-SUMMARY.json`、`INSTALLED-NATIVE-CHAT-CONTRACT.json` 及产品升级、原生维护、原回执与观察器证明。真实 Provider/模型对话仍由用户发起下一条新消息验收。
