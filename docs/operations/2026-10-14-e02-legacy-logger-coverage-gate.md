# 单主体 legacy 动作证明的完整 logger 范围门槛

Root 审查原 `3ca5339a` 发现 P1：解释器只选择 loggerStart/loggerEnd，要求边界时间不超过一秒，却没有排除中间轮转。有限反例中捕获清单 A→B→C 的 B 含目标 action.started，仅读取 A/C 且相差六毫秒，原实现仍会签发 never-dispatched。新反例保留旧 RED43 项中的33 PASS/10 FAIL、0 skip；此后对 producer partial-error 和 rotation lastAt 各单独 RED1。修复后解释器45/45 PASS、0 skip。完整红/绿日志只在 E02 `.local` 保留。

独立只读检查使用已批准准确 TGZ 副本，不解包、不 import/执行历史代码。旧 `daemon/ziwei_user.mjs` raw21731B/SHA `9c1acc4b66f939fd11156934863b9c2208b0e4a4a65629049a65ad238a65bbcd`，normalized SHA 与既有六协议 pin 相符。它逐条同步 append 到共享 daemon.log；heartbeatConnection 的 finally 才检查 size>5MiB 并 rename 成 daemon.log.${Date.now()}，错误吞掉。后缀是墙钟毫秒，没有连续编号、前驱 hash、轮转事件或目标名唯一性保证。源没有内建剪枝，但这不能排除外部历史删除。两个原端点差六毫秒不能据此升级为完整链。

本固定两 segment profile 现在拒绝 captured.logs 的缺失、额外、重复、未知或损坏项及原 capture 的 error 字段；必须恰好首 rotation 和 active。首 rotation 的 lastAt 与严格解析原 bytes 的末记录匹配；原 active prefix 按准确 byte 长度匹配完整 successor，结束于记录边界；两 rotation 名字的毫秒值要求首段在 capture 之前、successor 在 capture 之后。原 append 顺序、唯一 boot start/exit、所有 PID 的目标记录与原 ACK/failure/cache/source pins 继续检查。

这些关系仍不能自己证明捕获程序枚举了全部文件。因此新增独立代码参数 `verifyLoggerCoverage`，默认 null。解释器把冻结的候选范围交给该同步 verifier：原 logDir、generation digest、原 capture path/SHA/bytes/captureUTC/全部 entries、两 segment path/SHA/bytes/rotation timestamp、active prefix SHA 与 loggerDigest。只有 verifier 精确同步返回 true，才允许该动作证明；没有 verifier、false/undefined/truthy object/Promise、请求或 assessment JSON 的 complete/verified flags 均拒绝。capability 的 WeakSet 身份及单主体/host/request binding 不变。该 verifier 必须审查独立 producer/历史 membership witness，不能实现成恒 true 或只重新相信 captured.logs。

fixture 的 verifier 用实际临时 logDir 全成员与大小核对，额外未列出的中间 segment 也使证明拒绝。它是作者隔离测试的独立 producer，不能复用到实际原来源。`auditHistoricalSource()` 始终 loggerCoverageComplete:false，不从历史-only 分支生成当前动作证明；缓存锚点审计仍可用。

实际原副本的新历史审计保持33记录，currentConfigVerified:false / namespaceComplete:null / loggerCoverageComplete:false。没有读取原正式 action row 或当前配置，没有签发原8668动作证明。新审计文件为 E02 私有 `.local/preservation-legacy-original/historical-source-audit-05-producer-binding-pending.json`，SHA `b13ff3f25a971d21369e17899d031833aabe6f73ab2861837f6da8a585117637`。早先失败及 audit02/03 不覆盖。

Root 后续明确批准只列原 recovery `native-view-20261012` 精确目录的非递归文件 metadata。找到并再次获准只读的原 producer 为 `C:\Users\25941\.codex\worktrees\a2a-delivery-recovery\灵光爸爸拆解\.local\a2a-recovery\native-view-20261012\inspect.py`，3036B / SHA `8c4fb3952a5f03c09c66b53c8263c7bddad9dd7f2fd55b2af5655dcd91802636`。只复制一次到 E02 私有 `original-inspect-producer.py`，不执行/修改原脚本，不扩读其它文件。

原 producer 第15行确实用 sorted((base/'logs').glob('daemon.log*')) 非递归枚举全部匹配项，16–23行每文件无条件 append。aid 条件只过滤 actionRecords，不过滤文件；没有数量上限或切片。第35–36行外层异常留下 out.error 后仍写脚本相邻 result.json，故产品必须拒绝 partial-error。独立静态审查已核对其原 native logDir/subject/outputPath 与 generation/批准 result sourcePath 一致；输出六个 keys、两项 FinalPath 与原 result 对应。

静态核对回执 `.local/preservation-legacy-original/logger-producer-static-audit.json` SHA `935ad11166abd2ae49811ee1dee575b8190a444ee10a49ee7ec5bbe4dae6b550`。它明确 formalLoggerCoverageQualified:false / verifierWired:false / historicalScriptExecuted:false：现存 source 和结构关系还没有独立绑定该 SHA 在 capture 时执行、执行所用 Python/runtime 的枚举错误行为、及该执行输出对应原 capture SHA `6e5dce6563e61f71109a4b963784a3b22cc535ad6ed92c315d87df1ca1359d06`。无 out.error 也不能自己证明底层枚举无静默遗漏。这些有限原调用/输出关系由 R01 承接核验；已有 producer 可用于资格化，不能因路径相邻就把 verifier 实现成恒 true。当前目录列表不能倒推捕获前没有删除过段。

本轮最终直接相关组合218项、217 PASS、0 fail、1 Linux 锁专项平台 skip，lint129 PASS。完整 Windows namespace/client、实际 logger 完整范围、E03 source 特殊 proof/guard 接线、最终同批六包与 Q01 签收仍有缺项。Root 已要求本轮源码稳定后待命；没有重新打包、SDK四阶段、正式服务或设备动作。
