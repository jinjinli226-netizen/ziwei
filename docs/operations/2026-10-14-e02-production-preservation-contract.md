# E02 正式保留数据入口短契约

状态：接口约定，实施与独立验收待完成；不是正式放行。2026-10-14。

唯一产品 owner E02 承接 `backend/production-preservation.mjs`、`backend/preservation-native-evidence.mjs`、`backend/preservation-native-databases.mjs`、`backend/version-preservation.mjs`、`scripts/v2-preservation.mjs`、`scripts/production-source-proof.mjs`、角色导出器/打包器及其产品测试。R01 可在自己的 `scripts/operations/` 实现 transport、原实例 pause/stop、备份/restore-read、部署 staging 与 phase controller；不得修改这些产品文件。Q01 独立验收准确新候选及真实解压包。289d4f4 冻结包只承载已交付 G1，不包含以下新接口。

## 产品接口与调用方责任

预定导出 `validateProductionSpec({spec, trust, database, packageRoot})`、`runProductionPreservation({command, apply, spec, trust, proofProvider})`，后者由 `scripts/v2-preservation.mjs --spec <private.json> --trust <independent-private-trust.json> [--apply]` 调用。`inspect` 和未加 `--apply` 的 prepare/seal/restore/abort 均只读；compat 角色只能 inspect/plan，不能 restore。

`spec.mode` 必须为 `production`，`schemaVersion=1`；包含 operationId、授权目标/有限范围、specHash（去除此字段后的 canonical SHA256）、当前 DB canonical 绝对路径及持久 identity、origin/workspace/device 集合、准确 candidate/QA commit+evidence hash、同批六产物/两 manifest SHA、FROZEN_VERSIONS、当前 API role/source identity、所有原 API/client root/native entry/config/userHome/runtime/baseHOME/shared scope、原 PID+创建时间+nonce 摘要及 service manager。spec 不携带任何密钥，也不提供自己的验证公钥。所有字段在第一项写入之前验证；同 operation 异 spec 必须拒绝。

`trust` 是 R01 单独批准的私有文件，由命令行独立参数传入；机器 id 映射到已有私有 HMAC key 文件引用和允许的 host/device/origin/roots。不得从 spec 或 peer proof 选择信任 key；不得把原配对 token 当签名 key。密钥文件只在所属 host 读取，不复制进包或日志。R01 负责建立和保留可信传输及私有引用。产品校验 signer、HMAC、challenge、specHash、operation、DB projection、scope 和新鲜度。

`proofProvider` 是 trusted controller 的代码接口，不能由 spec JSON 注入函数。它提供：

```text
collect({challenge, operationId, specHash, databaseIdentity,
         freezeDigest, actionProjection, requiredHosts}) -> signed host envelopes[]
recheck({freshChallenge, operationId, specHash, databaseIdentity,
         freezeDigest, priorEvidenceDigest, requiredHosts}) -> signed recheck envelopes[]
```

challenge 每次由产品生成，有限有效期且不得复用。host envelope 绑定 collector/schema/host/同 operation/spec/DB/准确原实例与 build/config/runtime/HOME/marker，带全量原 journals/results/claims/tree/delivery 的安全结论、文件/目录 manifest 和 action/native proof 摘要。源 host 用 `scripts/production-source-proof.mjs` 的只读入口在原生 namespace 收集；Linux 不尝试读取 Windows 路径。`recheck` 在 seal 前验证同一原停止/排空实例没有重新启动或残留 worker，全部原文件/目录/配置/marker/process identity 仍一致，绑定上一份 evidenceDigest 和新的 challenge。缺 host、缺全量覆盖、未知树、版本/schema/claim/发送不明一律拒绝；没有回执不能换 key 或 operation 重跑。

产品在 seal 的最后事务再次核本地 DB identity、freeze/intent/versions、全量原 action 和 Inbox digest，再调用已有原子 seal 控制写入。远程文件只由已验证的 source-host manifest/recheck 证明，不伪装成本机可读文件；其 evidence 与 native proof 仍受上述全量关联约束。prepare、seal、restore、abort 的提交结果带 operation/state/specHash 与 intent/snapshot/evidence digest；丢回执先 inspect 同 operation。

## 首次原 V1 → V2 bootstrap

R01 先针对 spec 内全部原实例沿原维护入口 pause/drain/stop，并独立核原 PID、创建时间、nonce、配置和退出状态。旧 V1 health 的 active0/auxiliary0 不等于 V2 maintenance.safe；必须取得原 journals/results/原 Job 树与全部 HOME claim 的证明。旧 updater 可能自动 resume/start；失败后必须重新观察原实例与 phase，不能默认已停。

原 API 和全部写入方停止后，E02 的 staged V2 **离线**入口在同一当前 DB 上验证 production spec 和 bootstrap host proof、初始化保护 schema、提交 prepare 并 seal；全过程不 createApp、不启动 scheduler/client，也不调用模型/native 业务。首项 schema 写入前 spec、原停止实例、DB identity 与签名 proof 已通过。R01 只在持久 sealed 回读成功后安装/启动同批 V2；新进程首轮轮询已有 fence。禁止先启新 API/客户端再补 prepare。若 claim/旧树无法证明，保留 preparing/unknown 或原停止状态，不制造 safe。

后续回退与恢复沿同一当前 DB/HOME。回到 V2 的顺序为停 compat → 安装/启动匹配 V2（仍 sealed）→ 实际 installed/running role/build/DB 验证 → restore，保持 Bot/Routine 暂停。不恢复发布前整库、不清新 HOME、不启用 Bot、不重放历史 tick。seal 还要求 R01 独立完整 backup/restore-read proof（主/控制 DB、对象、全部 HOME、journals/config/私有引用）；`VACUUM INTO` 单文件不能代替。

## 本轮原生支持边界

Hermes 0.21.3/state schema30 才按已核对规则解释。Goals/Heartbeat 历史 pending 绑定原 settled/source action/tree；Kanban driver 绑定原 run，直接 claim 后 complete/block 仅接受明确 runId 和原回执共有字段；历史记录保留。Gateway 必须绑定 Python 原生 key、正文摘要、原成功回复及非空输出、原 connect 与实际退出证明。非空 Group/collaboration 状态目前明确 unsupported，拒绝切换，不声明其业务验收。legacy HOME 只有原 marker、已绑定 config 的明确 baseHOME、成功 validation/fingerprint/isolation/tree 才能证明原 native version；后续版本冲突拒绝。

实施验收必须含没有 rehearsal marker 的生产 spec 隔离用例、错误 scope/DB/role/build/signature/challenge/refusal、first-write 前拒绝、原 V1 stopped bootstrap、丢回执同 operation 回读、跨 host freshness/recheck、真实两角色解压 API 入口，以及 native/WAL/action 最后复核。实现前 R01 可按这些字段组装 transport/backup/controller，不执行正式 mutation；接口变动须更新此文档并通知总控，不能由运维临时绕 scope。
