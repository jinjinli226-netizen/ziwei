# E02 固定旧来源解释器与 seal 最终谓词

这是独立代码能力与隔离验证的产品检查点，不是原生产 namespace 完整证明、Q01 验收或发布。daemon 本地停止修复为 `22363a945fe4f0143a0ed6b5a23bc89826059b95`；只解析准确原 TGZ 的归档校验器为 `4f060249eb2edb1436b6a253369ad7043a27538d`。旧 raw capture/cache/logger、复制回执、代码参数及失败记录只保存在 E02 `.local/preservation-legacy-original`，未入 Git。

## 原始材料的有限读取

获准的 2884 原 TGZ 只读一次，复制到本工作树私有目录后只使用该副本。原文件 95626B/SHA `e2a446c65def0f09cfb23d51142c2ca9666dc0d32c91d62d4a25bc71a9af377a`。准确副本验证 30 个 regular USTAR member、336798B payload、六模块 raw/CRLF-normalized SHA，并得到原 Windows installed build `7c2d47abb3982eb31fbdd2245fe0550235efed9ec418848de901dfead8bdaf64`；不解包、不 import、不执行旧脚本。

三份原 context/inspect/native snapshot、原 cache 与两份原轮转日志均按批准 SHA/bytes 读取。首次 Win32 final path 检查发现 MSIX LocalCache 重定向并拒绝；同用户隐藏 native reader 随后用只读 handle 得到准确 final path 和批准原字节，6/6 完成。reader 只读取固定批准文件，未读取原 auth、任意环境或正式 DB，也未进行服务、模型或设备动作。

真实材料的 `auditHistoricalSource()` 通过：前 33 个旧 `{key,result}` 按原 compact V1 serializer 重建 193341B/SHA `d2c43bb88abacf8a039509864dd093790893545074416940bd50decd3d683851`；snapshot 原锚点匹配。原 logger start/exit 为同一 51880 birth；原 captured active log 的 3223860B 完整前缀与第二份后来轮转的原日志匹配。archive、原 root/config/native birth/command digest、runtime/logs 同根和完整旧 boot 日志之间逐项验证。

第一历史审计尝试因对所有 event 时间戳单调性的错误假设而拒绝，原失败文件保留。准确旧 logger 在默认时间戳后展开 native event 字段，native progress 的 `at` 可以较早；实际原材料有一次 361ms 回退。实现保留原追加顺序并严格要求 boot 首 start、尾 exit、全 PID 的唯一目标记录及真实 target/poll 时间关系，不把 event 时间排序成新历史。对应独立 fixture 覆盖此差异。

历史审计明确返回 `scope:'historical-source-only'`、`currentConfigVerified:false`、`namespaceComplete:null`。本任务没有读取实际原 action row 或当前完整配置，也没有为实际 8668 签发 `legacy-never-dispatched-v1`。原 action digest 固定为 `0e6f6100f2bb73194500a30ff6db97b637366477a3897888274507a16dd37b71`；原 expired/ACK/空字符串 result 保留。

## 独立代码能力

```js
createLegacySourceInterpreter({
  authorization, // 独立批准、复制并冻结的一条 subject/host/scope/原始文件 pins
  requestBinding: {operationId, specHash, freezeDigest, challenge},
  readBytes, // 可省略；同步代码 reader，不来自 JSON/wire
});
```

authorization 精确描述 `schemaVersion:1,kind:'ziwei-approved-legacy-source-v1',hostId,origin,workspace,workspaceId,deviceId,generation,subject,historicalCache,archivePolicy,artifacts`。generation 含原 pid/birth/build/config SHA、root/executable/configPath/runtimeDir/logDir/command SHA。subject 含唯一 actionId/nativeActionDigest、原 payload/result/dedupe SHA、唯一 timeout error SHA 及原 raw 字段。artifacts 固定七个 role：archive、context、inspect、snapshot、cache、loggerStart、loggerEnd；每项是 `{path,sourcePath,sha256,bytes}`。参数由受信代码按已批准的准确引用构造；R analysis JSON 的 eligibility/approved 布尔值不是授权。

capability 的方法是 `connectionProof({productionRequest,connection,state})`、`neverDispatchedProof({productionRequest,connection,action,state})` 与信息性 `auditHistoricalSource()`。`isLegacySourceInterpreter()` 只认模块私有 WeakSet 内原对象。正式 `scanNativeFiles(options,{legacySource:capability})` 的第二参数是代码参数；第一参数、request JSON 或展开复制的对象不能启用它。本地 daemon wrapper 仍固定只执行本地解析。

connectionProof 从原 archive 与原 cache 前缀解释已经证明的旧记录，返回 recordDigests；仅命中的 `{key,result}` 可作为 migrated legacy history。当前安装已是另一 V2 root/源码时，仍使用准确旧 archive；新增任意 `legacy:true` 不能继承前缀资格。现代 started/completed、delivery、resident 和其它未知状态仍由原 scanner 完整检查。

neverDispatchedProof 检查独立 requestBinding、host/workspace/device/origin/runtime/config SHA；原 signed projection 必须仍含唯一 raw row，完整 nativeActionDigest、原 payload/result/dedupe SHA 与字段均匹配。retained/current 全缓存都不得有目标 action 或 dedupe；完整两份日志中所有 PID 的目标记录只能有同一旧 generation 的唯一固定 timeout failure，且无 target started。mandatory start-before-executor 与 ACK-before-dispatch 来自核对的原协议源码，不能只凭超时、count=0、mtime 或 analysis 标志推断。

proof 绑定 op/spec/challenge/freeze/host/action 与 authorization/history/policy/source/cache/logger/artifact digests，只包含 `conclusion:'never-dispatched'` 与代码产生的 verified。它不生成 processExit、Job、tree 或 namespace proof。各 artifact/config 文件及身份继续进入 scanner files 清单，参与完整 source manifest/fresh recheck。

## 最终事务接口

```js
createPreservation(db, {
  legacyActionPolicy: {
    actionId, actionDigest, hostId, workspaceId, deviceId, origin, specHash,
    authorizationDigest, historicalGenerationDigest, policyDigest,
    sourceDigest, cacheDigest, loggerDigest,
    requiredFiles: [{path, sha256}],
  },
  verifySourceRecord,
});
```

默认 policy 为 null。policy 存在时，最终 seal 事务重新 SELECT 原 row，要求普通 V1、固定 digest/workspace/device、expired、原 ACK、result_json 严格为空字符串；要求唯一 actionBinding 与唯一 special kind proof。proof 的全部固定字段、operation、conclusion 与 sourceRecord 相同对象/kind 必须匹配。所需文件在 native.files 中唯一且 pinned，并继续走原文件/来源循环。调用者改 constructor 原参数或在 seal JSON 传 policy 无效。

特殊 proof 出现但没有独立代码 policy 或同对象可信登记时拒绝。E03 source 会剥离嵌入 proof 的 challenge 以保持 collect/recheck evidenceDigest 稳定；最终谓词不要求该已剥离字段，challenge/TTL 由外层签名与受信登记绑定。原全量 actionBindings、投影复核、beforeCommit 与原 identity/control/snapshot 验证保持。

E03 待补窄接点：从严格批准的 static nativeSourceRefs 构造 interpreter/requestBinding；source CLI 用固定第二代码参数执行 scanner；特殊 proof 验签/唯一性/固定绑定完成后以原对象和 exact kind 登记，并独立传 legacyActionPolicy 给 guard。不得将任意 nativeStateProofs 或 assessment JSON 全部放进 WeakSet。此接点完成前生产 apply 继续默认拒绝。

## 验证与后续

归档 15 项、解释器/scanner 31 项、最终 SQLite guard 49 项，合计 95/95 PASS、0 fail/skip。最终 guard 首轮实际 RED 39 fail/6 pass；正例保持 raw V1 行、ACK/dedupe/空 result 不变、重复 seal 不再采集。负例覆盖 clone/伪 JSON、缺失/重复/另一 kind/host/spec、raw JSON 字节变化、null result、缺 bindings/files、pending/acked/V2 和采集后原行变化。

首轮全量 1119 项中的 21 项 production fixture 因漏打包新增两个模块而按 loaded closure 正确拒绝；fixture 补齐真实依赖后 production 26/26 PASS，产品校验未放宽。修正后全量 **1119/1119 PASS，0 fail/skip**，lint 检查 128 个产品 source PASS。完整失败日志与修正后日志分别保存在 `.local/legacy-source-full-suite.log` 与 `.local/legacy-source-full-suite-02.log`。最终全量结果在私有 handoff 固定，不用早先候选或作者 fixture 代替 Q01 资格。

下一独立集成：已明确批准的 E03 `ac1b4d51a97def8f3f8589f8a7c4d450f0fedfb8` 与 API 私有身份 hook。Windows 默认 native inspection/client identity 仍等待 E03 实现；当前 PID12132 的完整 PEB/HOME/worker/maintenance namespace 仍未知。没有正式停止、provider/model/phone、push/deploy 或 Q01 验收声明。
