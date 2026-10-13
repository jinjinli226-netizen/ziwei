# E02 正式保留数据入口短契约

状态：接口约定，实施与独立验收待完成；不是正式放行。2026-10-14。

产品 owner E02 承接`backend/preservation-native-evidence.mjs`、`backend/preservation-native-databases.mjs`、`backend/version-preservation.mjs`、`scripts/v2-preservation.mjs`、角色导出器/打包器及其产品测试；E03按总控2026-10-14拆分承接`backend/production-preservation.mjs`、`scripts/production-source-proof.mjs`及其专属新tests。R01 可在自己的 `scripts/operations/` 实现 transport、原实例 pause/stop、备份/restore-read、部署 staging 与 phase controller；不得修改这些产品文件。Q01 独立验收准确新候选及真实解压包。289d4f4 冻结包只承载已交付 G1，不包含以下新接口。

## 产品接口与调用方责任

预定导出 `validateProductionSpec({spec, trust, database, packageRoot})`、`runProductionPreservation({command, apply, spec, trust, proofProvider, backupProof, packageRoot})`，后者由 `scripts/v2-preservation.mjs --spec <private.json> --trust <independent-private-trust.json> [--apply]` 调用。`inspect` 和未加 `--apply` 的 prepare/seal/restore/abort 均只读；compat 角色只能 inspect/plan，不能 restore。

`spec.mode` 必须为 `production`，`schemaVersion=1`；包含 operationId、授权目标/有限范围、specHash（去除此字段后的 canonical SHA256）、当前 DB canonical 绝对路径及持久 identity、origin/workspace/device 集合、准确 candidate/QA commit+evidence hash、同批六产物/两 manifest SHA、FROZEN_VERSIONS、当前 API role/source identity、所有原 API/client root/native entry/config/userHome/runtime/baseHOME/shared scope、原 PID+创建时间+nonce 摘要及 service manager。spec 不携带任何密钥，也不提供自己的验证公钥。所有字段在第一项写入之前验证；同 operation 异 spec 必须拒绝。

`trust` 是 R01 单独批准的私有文件，由命令行独立参数传入；机器 id 映射到已有私有 HMAC key 文件引用和允许的 host/device/origin/roots。不得从 spec 或 peer proof 选择信任 key；不得把原配对 token 当签名 key。HMAC 同一专用 ops secret 在 source signer 与 server verifier 各有独立可信本地 keyRef；双方仅读取各自私有副本。通过既有可信 transport 预配，不使用 device 配对 token/provider auth，不经 spec/proof/Git/包/日志携带 secret。R01 当前只创建隔离 fixture keys，正式预配等待最终门槛。R01 负责建立和保留可信传输及私有引用。产品校验 signer、HMAC、challenge、specHash、operation、DB projection、scope 和新鲜度。

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

## R01 并行准备的精确序列化接口（v1）

签名使用 HMAC-SHA256，hex 小写；签名输入为 UTF-8 canonical JSON payload，对象 key 按 UTF-16 code unit 字典顺序（JS 字符串 < / >，非 localeCompare）直接编码排序后的 key/value 对、数组顺序保留，不使用 localeCompare。产品将导出 canonicalProduction/digestProduction/signProductionEnvelope/verifyProductionEnvelope，运维导入这些纯函数；不复制签名算法。每次 challenge 为 crypto.randomUUID()，有效期 60,000ms；issuedAt/expiresAt 为 UTC ISO 时间，collect/recheck 的 challenge 不同且单次消费，允许时钟偏差不超过 5,000ms。

独立 verifier trust 文件字段：schemaVersion=1、algorithm='hmac-sha256'、hosts 数组，每项 {hostId,keyId,keyRef,bindingDigest}；keyRef 为 verifier 本机专用私有文件绝对路径，bindingDigest 是下述 spec.hosts 中对应对象的 digestProduction。source trust 使用相同结构，只包含该 source host 的私有 keyRef。verifier trust 另固定 approvedSpecs=[{operationId,specHash}] 与 backupHostId；spec 自哈希不等于批准，未在独立 trust pin 的 spec 必须拒绝。source trust 也需 pin 同 approved spec（或经可信 server request 验证该 pin）。hostId/keyId/algorithm 必须匹配 trust，proof 不能另选 key。key 为 32 bytes 以上原始随机 bytes（文件直接读取 bytes，不将文本/hex 猜测解码）。fixture 可独立造双方私有副本并校验 hash，但不得输出 key 值。

所有 request/proof envelope 形状统一：

```json
{"schemaVersion":1,"algorithm":"hmac-sha256","hostId":"fixed-host","keyId":"fixed-ops-key","payload":{},"signature":"hex-hmac"}
```

request.payload 精确字段为 {domain:'ziwei-production-request-v1',schemaVersion:1,kind:'collect'|'recheck',collector:'ziwei-production-source-v1',challenge,issuedAt,expiresAt,operationId,specHash,databaseIdentity,freezeDigest,binding,actionProjection,gatewayInbox,homes,priorEvidenceDigest}。binding 为 spec.hosts 对应完整原对象；actionProjection/gatewayInbox/homes 由产品从当前同 DB 投影构造，只经私有 transport 交源 host，不能由 ops 自行合成清单。recheck 同样携带原操作/DB/冻结投影，只增加 priorEvidenceDigest；缺 prior 原 envelope 拒绝。

source CLI 预定精确调用：node scripts/production-source-proof.mjs collect|recheck --request <signed-private-request.json> --trust <source-private-trust.json> --output <new-private-envelope.json>，recheck 另需 --previous <original-collect-envelope.json>。输出文件必须新建（wx），stdout 只输出 {complete,path,hostId,operationId,evidenceDigest}；错误只输出有限 code/reason，不输出正文、环境或 key。源码只读原 config/journal/HOME/原 process，不能 pause/stop/start、执行模型或业务；这些动作由 R 原生 controller 先完成。collect/recheck 的 proof.payload 的 domain 分别为 ziwei-production-collect-proof-v1 / ziwei-production-recheck-proof-v1，与 request 互斥；包含上述 request identity/freshness（不含 action 原文）及 bindingDigest、原实例状态 observations、native evidence（files/directories/nativeDatabases/nativeStateProofs/gatewayInboxProofs/actionBindings/issues）、safe 和 evidenceDigest；recheck 必须核 priorEvidenceDigest、原完整文件/目录与原实例观察，不能只签名一段 safe:true。

runProductionPreservation 的 proofProvider.collect/recheck 接收产品生成的 signed requests 数组和原 operation/spec/DB/freeze 摘要，返回对应 signed proof envelopes 数组；R01 仅运输并调用 source CLI，不改 payload 或 native 结论。没有 transport 时 apply 必须 fail-closed。packageRoot 是显式 staged 实际解压 API 根（默认模块上层），产品核静态 PRODUCT_ROLE、preservation-package.json、准确 manifest 中该 API 全 source 文件；root 参数不能改变角色。

production spec 顶层字段固定为：schemaVersion、mode、operationId、specHash、authorization、database、packages、candidateCommit、qa、versions、hosts、backupScope、bootstrap。database={path,canonicalPath,identity:{dev,ino},databaseId}：path/realpath 精确等于 canonicalPath，原普通非链接 file 且 nlink=1，dev/ino 用字符串；databaseId 为 R 在私有 spec 分配的 UUID，首次写入时与 operation/specHash/file identity 一起持久绑定，后续不能换库或换 ID。文件内容 hash 是当前投影证明，不能当持续写入 DB 的稳定 identity。qa={commit,evidenceSha256}；packages 沿现有 verifyPreservationPackages 目录/manifest 参数并绑定六 artifact/两 manifest hash。

hosts 每项 {hostId,deviceIds,workspaceIds,clients,apiInstances}；client={root,entryPath,configPath,userHome,runtimeDir,baseHome,configSha256,installedRole,clientBuild,originalInstance:{pid,createdAt,nonceDigest}}，包括全部 shared scope。apiInstance={root,entryPath,role,buildDigest,serviceManager,originalInstance:{pid,createdAt,nonceDigest}}。authorization={executor:'R01',targetOrigins,allowedCommands}；bootstrap={fromRole:'v1'|'v2',offline:true,allOriginalWritersStopped:true} 是要求，由 source 观察证明，不是相信布尔值。后续 restore 的 installed/running V2 identity 由新可信 proof 绑定同批 manifest，不能改 spec 冒充原实例。

backupProof 是独立参数或 proofProvider.backup 返回值，不写入 immutable spec；为 signed ops envelope，domain='ziwei-production-backup-proof-v1'、kind='backup-restore-read'，绑定 operation/specHash/databaseIdentity、完整备份 manifestDigest、主/控制 DB integrity/FK/稳定 PK digest、对象引用/全 HOME/journal/config/私有引用清单摘要、独立隔离 restore-readDigest、originalWritersStopped 与 safe；signer 必须为 trust.backupHostId 指定的 server host/keyId，secret 不进 proof。产品验签并核同 operation/DB/有限有效期与完整字段，R01 独审备份及 restore-read 实际内容；不得以此字段跳过 native 排空。specHash 仅去除 specHash 字段，包含完整固定 backupScope；backupProof 在 freeze 后独立取得并签名绑定 operation/specHash/freezeDigest，不能通过改 spec 附加结果。同 op/spec 已提交的命令重试直接回读原持久 receipt，不重复 collect/recheck 或替换 evidence；先确认未提交才取新 challenge。


旧 V1 bootstrap 使用 schema-aware bootstrap-projection-v1：写保护 schema 前，从当前旧 DB 的原 actions/workspaces/employees/tasks/conversations/bindings 与全部原 journal scope 只读构造；不依赖 hermes_bots/UDF/intent，控制表缺失为 absent 而非 sealed。collect/recheck/最后事务使用同一语义投影，排除 heartbeat/audit/本次 phase/challenge 自变化，但保留原 payload、ACK/结果、旧在途与源 worker。最终本地 projection 复核是既有 seal 自己 BEGIN IMMEDIATE 内的 trusted hook，不由 ops 开外层事务或查后再 seal。原历史 legacy 终态不重跑、不重造 V2 Job 凭证；原在途/unknown/cache/源 worker 仍须实际排空证明。


JSON 输入在 hash 前拒绝非 JSON 值、getter/toJSON/function、非有限数字、非 plain object、未知字段和 symbol，不执行其回调。canonical encoder 不能把 sorted entries 放回普通对象再 stringify（数字形 key 会被枚举重排）；直接编码所有排序键，数组保留顺序且不得有 holes/extra keys。request/proof/backup 的 domain、host/keyId、用途/command 与 expected challenge 都须精确绑定，HMAC 正确但不同 domain 也拒绝。

legacy-terminal-history-v1 与 source-stopped/worker-scope-complete 分开：旧 ACK+succeeded/failed、合法 v1 completed 或 v2 legacy:true cache 可原字节保留，不补树；expired+acked、started无completed、uncertain、retainEvidence/blocked、明确非空树仍是债务。旧普通 Job 可 release 后台 child 并清 receipt，command/automation 可 raw spawn；只有停父 PID 不能证明已排空。原停止前 inventory 或可靠完整 namespace/registry，停后 fresh 观察与重启/updater 检查必须覆盖全部 scope。旧 SDK ROOT/shared-state.db、ROOT/kanban.db 与 kanban/boards、ROOT/bot_relay、processes.json、gateway PID/锁、cron jobs/executions/locks，以及 Creator/source HOME、payload HOME overrides、MCP/overlays/shared旧目录，都需纳入真实 source 覆盖；不能用当前 Bot HOME 隔离表替代。缺关联保留 unknown，不重执行旧动作或修补原记录。
