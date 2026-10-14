# E02 同事务 hook 检查点

状态：产品 hook 已实施；production adapter/source CLI 由 E03 在独立树实施，正式入口和最终合并候选仍待验收。70c0df6 的 WAL 旧尾接受策略已标 NOT_ACCEPTED，不作为发布源。

`createPreservation(db, options)` 新增三个独立代码参数，不能从 spec/peer JSON 取得：

```js
beforeCommit({db, command, operationId, row})
persistReceipt({db, command, operationId, row, report})
verifySourceRecord({db, kind, record})
```

beforeCommit 在 prepare/seal/restore/abort 既有 BEGIN IMMEDIATE 内、控制/phase 写入之前调用。seal 已先完成原 action/Inbox/文件清单等校验，再调用此 hook；E03在这里复核当前 DB identity/语义 projection/freeze/scope。persistReceipt 在既有 phase/审计与控制写入之后、同一 COMMIT 之前调用，E03在此保存 operation/specHash/databaseId/command 的原持久 receipt。任一 hook 抛错会回滚该事务与 hook 的所有 SQL 写入；不另开嵌套事务。guard 已提交的重复调用保持原语义，不二次调用 hook；adapter 的原 receipt 快路径由 E03先读取，以区分命令提交时 state 与当前 state。

三个 hook 只接受同步函数。AsyncFunction 在构造时拒绝；同步函数返回 Promise/thenable 在事务内拒绝并回滚。constructor 的 readOnly:false 本身仍初始化保护表/触发器，所以完整 spec/trust/首轮 source proof 必须在调用它之前验证；hook 不代替 first-write gate。

verifySourceRecord 的 kind 为 file 或 directory。返回 undefined 使用原本本机 fs 摘要/inode/目录核验；返回严格 true 表示 E03可信闭包已经为这个具体原 record 核验 source host collect+fresh recheck/namespace/manifest；其他值和 Promise 拒绝。E03应使用验证后记录对象的 WeakSet 或等效闭包集合，不能因 record.remote/hostId/pathFlavour 等 JSON 标签返回 true。不存在 resolver 时，这些标签不会跳过本机读取。全量 action/Inbox/native DB/sidecar覆盖校验一直保留。

sealed Inbox 的 HOME/path 关联现在使用 source 路径所属 win32/posix path API，Linux 不把 Windows 路径拼成混合分隔符。该更正不赋予任何远端文件读取能力，仍依赖上述可信 resolver。

验证：5个新增 hook 用例（同事务三phase、拒绝回滚、首写前拒 async/JSON hook、thenable回滚、remote标签不能绕过），与既有 version/native-seal 联合23/23 PASS。另有当前 native fail-closed/相关hook联合31/31 PASS；这些是产品 hook 单元/集成证据，不是 production签名/transport/backup/bootstrap 已通过。

owner：E02保留 backend/version-preservation.mjs、native模块、既有 scripts/v2-preservation.mjs、打包器；E03承接 backend/production-preservation.mjs、scripts/production-source-proof.mjs 及其专属新tests。E03提出CLI分流、包闭包等具体需求后由E02合入。最终同批源码与六产物由Q01独验，R01唯一正式执行。

E02 CLI衔接已加入：mode=production先于原rehearsal/stringDB检查分流；CLI必须单独 --trust <independent.json>，不能与spec同一realpath，原spec完整交给严格validator（不删掉额外JSON字段）。程序调用的第二个code参数可传trust/proofProvider/backupProof/packageRoot；spec JSON不能提供provider函数或信任材料。production无drain/VACUUM，未指定 --apply默认仍plan。E03 module由明确dynamic import载入；缺少模块会拒绝，不fallback到rehearsal。2个新CLI拒绝用例与DB只读用例联合3/3 PASS，原sentinel字节/目录/sidecar零改动；正向签名与实际包入口待E03冻结组合后验证。
