# R01 产品 ABI 接线与限定 legacy logger 资格核验

本检查点交付 R 自有 operations 接线、隔离测试和 action8668 原 logger 的有限来源核验。正式发布状态为 `NOT_READY`。本轮没有 push、部署、pause/drain/stop/restart、更新、签名密钥 provisioning、模型调用或设备动作，也没有执行获准复制的旧 `inspect.py`。

R 树为 `C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解`，起点 commit `acd33dc80a956580a5745fa1eeb62cd340057311`。改动限于 `scripts/operations` 与本文档；E02/E03 的产品文件由各自作者维护。

## 接线基底与接口

隔离测试固定读取 E02 clean `2ea61b6a5ff748c9a22502ba1df3f177cee7c693` 的两份模块；测试在导入前核对文件 SHA256。

| 产品依赖 | SHA256 |
|---|---|
| `backend/production-preservation.mjs` | `9a8ad9567fb130517c96cad390c7dff417ce9ca5fe08e6979041c971cdaa86d6` |
| `backend/preservation-source-namespace.mjs` | `dafcbce34bfc427ad067db131f50d79c9716183fb45d2db2e2f0c3813e8d4c2e` |

新增 `r01-production-wire.mjs` 的四个 factory，由原 ops 文件以清晰的新名称再导出。原 generic factory 保留用于既有隔离 fixture；正式接线必须选择以下新导出，并使用最终获验收产品模块及独立 trust。

- `createProductionProofProvider` 使用产品自己的 canonical/digest/request validator 和返回 payload 的 envelope verifier。逐 host 原样透传产品已签名 requests；recheck 使用整个有序 collect envelope 数组及其产品 digest。错误 host/order/key/context、缺失或更改的 previous 和重复 challenge 均拒绝；已受理失败的 challenge 不重放。
- `createSourceCliTransport` 使用独立批准的固定 executable、entry、cwd、trust file 及代码 SHA，以文件参数调用 `collect|recheck --request --trust --output [--previous]`。请求、整组 previous、输出和回执写入新的私有 attempt 目录；无 stdin 旧协议、无 shell 拼接。未知结果保留记录。超时清理仅限该 transport 自己启动的 reader 子进程。
- `createProductionPhaseController` 接受合法 `absent` plan；失去 apply 回执后，通过原 `pending.command` 的 `apply:false` 读取嵌套持久化 receipt。只有同 operation/spec/command 的产品回执能清除 pending，单独 inspect state 不能清除。apply 默认因未提供独立 release gate 而拒绝，seal 还要求 backup proof。测试中的 phase adapter 是隔离替身，不能计作真实 SQLite/G1 或正式四阶段验收。
- `createNamespaceCaptureWriter` 使用产品冻结的 refs/policy/capture schema，写固定 `before-stop.json` / `after-stop.json`，并以整个 before envelope 的 digest 连接 after。host、原实例、policy、producer 和本机观测字段逐一绑定。systemd 使用原始 InvocationID、native birth、递归 members、布尔 manager 属性及单调时钟字段；合法默认 boot-nonce 可以没有 nativeBirth，此时必须核对实际 createdAt 和 nonceDigest。draft 或 unknown 观测不能被转换为合格 namespace。

writer 要求外部 `observeNative` 提供真实观测，并不启动生命周期控制或 API probe。Windows 完整 scope、实际 sameDB API runtime identity、host 汇总及恢复验收仍由最终产品实现和正式门禁核验。本轮没有将后续 E03 未提交改动或新修复投影到此处的已测试基底。

Linux 只读 reader 的代码补充 `ExecMainStartTimestampMonotonic`、`ActiveEnterTimestampMonotonic` 与原始 `nativeInvocationID`。本轮未重采 Linux。此前 `acd33dc` 的实际 capture 继续属于此前 producer，不因代码更新而变成新 producer 的证据。

## 原 collector、调用与原字节的有限关系

新获准的原 `inspect.py` 仅复制一次到 R 私有目录，未执行。批准副本为 3036 bytes，SHA256 `8c4fb3952a5f03c09c66b53c8263c7bddad9dd7f2fd55b2af5655dcd91802636`。其规则是完整 sorted 顶层 `daemon.log*` glob，没有枚举截断；其宽松解码与异常后部分输出不能直接证明完整覆盖，因此核验器另行严格检查全部批准 logger bytes，并拒绝 capture 的 error 字段。

只读查找的原 session call 记录闭合了：当时 Get-Content 的完整 collector 源码、复制到原 capture 目录、精确 Python 路径和该目录下 inspect 的 WMI Create、实际 reader PID，以及随后对同一 `result.json` 的只读摘要。相关原 call/output 摘录只保存在 `.local`，不进入 Git。

对原 `result.json` 使用直接 UTF-8 bytes 和 JSON.parse 检查，原保存字符串是 `2026-10-11T17:10:33.527386+00:00`；其 SHA256 仍为 `6e5dce6563e61f71109a4b963784a3b22cc535ad6ed92c315d87df1ca1359d06`。历史 PowerShell `ConvertFrom-Json` / `ConvertTo-Json` 控制台摘要出现 `+08:00`，仅摘要字段发生显示转换。此前将该摘要误述为原文件保存时间的判断已纠正。核验器没有声称摘要等于完整 stdout bytes，也没有新增历史 Python stdlib SHA 门禁。

`r01-legacy-native-bytes-readonly.py` 仅针对已批准的两份保留轮转日志与一个 cache 读取原生 final path、核 bytes 并保存 R 私有副本。该一次 reader 已自然退出；未写原文件，未读取额外 HOME/auth，也未新增业务实例。

## 独立 logger 核验结果与范围

`r01-legacy-logger-qualification.mjs` 独立重读固定 SHA/size 输入并严格解析，拒绝 partial error、错误路径、非法 UTF-8/JSON、活动前缀边界或 lastAt 不符、额外 inventory，以及不完整调用关系。活动路径固定为批准 logDir 的 `daemon.log`；保留的 loggerEnd 是其后续轮转文件，核验器以精确前缀和批准轮转时间连接两者，不将两条不同时间的路径误当同一路径。

同步 `createLoggerCoverageVerifier` 必须接收完整的精确候选。它拒绝 missing/falsy 候选和 coverage truthy 标志；historicalGenerationDigest 从独立批准 generation 投影计算，loggerDigest 从固定 logger path/bytes/SHA 投影计算，每条 chain 的 rotationAt 必须等于批准文件名的轮转时间。两个 digest 使用 E02 既有 legacy encoder。

实际有限审核 `actual-logger-qualification-02.json` SHA256：`e4c059309e4b9bd19f090ed17821e9e136e7bd3f0b61ff8f5a3ac34b0222a60e`，`qualified:true`，`candidateVerifierAccepted:true`，findings 为空。

| 原字节检查 | 实际结果 |
|---|---|
| loggerStart | 5,245,726 bytes；23,196 严格 JSON 行；SHA256 `447bf1c4db2b8a51f15f71e433803e030ec84ba3124b407987e1f3bd53c02403` |
| loggerEnd | 5,243,346 bytes；22,815 严格 JSON 行；SHA256 `4794319aa2c10cab415febc45305e29e3b1c5dd13400b1dc92e4e8b6ba248456` |
| 原活动前缀 | 3,223,860 bytes；13,809 行；SHA256 `ba13f7e67f18bcec145cc2d5681706c86ed67328c1f061bd1c3fdae025e4eac7`；lastAt 精确对应原 capture |
| 解析遗漏 | 无 replacement 解码；invalid JSON 0；skipped records 0 |
| 候选原 generation digest | `cc6d61407e933d5775d9db639dd5392446bfa2fba2515071677368b9ca28f5f8` |
| 候选 logger digest | `b4523750ab9585f60399516047a01d961d23c1cbc9b9c390d6d5646d794d2937` |

这项资格只针对原 logger 来源与覆盖范围。此前原 cache 33 条、193,341 bytes 的前缀重构和去重缺席事实保留在私有报告引用中；第二版审核没有重读当前原 cache，也没有生成 never-dispatched action proof。`namespaceComplete:null`、`originalActionProofMinted:false`、`formalGatePassed:false`。E02 的默认拒绝门禁没有被 R 修改；真正接入该 callback、形成最终六产物/两 manifest 和动作证明，须在 E02 被调度后以最终源码独立验证。

## 验证和交接

最终 R 自有 operations 回归：Node 86/86 pass，0 fail、0 skip；其中新 wire 11 项、logger 9 项。Python native reader fixture 10/10 pass；两份修改/新增 Python source 通过 AST 语法检查，没有因此执行 collector。`git diff --check` 通过。首次 combined 新测试的 3 项失败属于测试夹具将 candidate factory 与 audit 的 candidate 输入同名，修正后通过；失败日志保留，不删除或改写。

私有目录为 `.local/r01-abi-legacy-qualification-20261014/`。原 call 摘录、批准 source 副本、保留 cache/logger bytes、原 capture 引用、实际审核与测试输出留在该目录；随机 fixture key 只存在于测试临时目录并在结束后清理。Git 仅收录安全 ops source、tests 和此说明。clean commit 后的精确源码与私有引用保存在该目录的新 handoff JSON。

尚未满足的正式门禁保持：E03 最终原生 source/runtime 汇总修复、E02 单一最终源码六产物/两 manifest 与真实 SDK 四阶段、Q 独立 G1-G5/生产验收、R fresh source/backup/恢复只读验证，以及最终获验收 SHA 的正式生命周期和部署。已有最终发布授权继续有效，本检查点不将其提前变成执行许可。
