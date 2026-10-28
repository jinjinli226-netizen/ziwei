# 驾驶舱统一身份：账号与数据清理准备

本项依据 CLI 标准 1.3.0、统一身份 CONTRACT 1.0.1 与共享 cleanup-manifest 契约。实现位于 `backend/identity-cleanup/`，本机只读命令为 `scripts/workspace-identity-cleanup.mjs`；生产只读快照与隔离 SQL 验证分别为 `server-snapshot.mjs` / `server-worker.mjs`。未发布、未切换登录、未清理生产数据。186 只读诊断通过既有安全 SSH 封装与独立 ASCII CommandFile 进行；154 完全不访问。真实账号/资源稳定 ID 清单只保存在受控 evidence 目录，不进入 Git。

## 范围与不可推断项

指定主管理员通过共享契约的固定邮箱条件精确解析原 `local_users.id`，保留其原 ID 与已证明归属数据。邮箱冲突时保留所有匹配 ID 的保护锚点并设 pending，不合并账号、不按邮箱授予统一身份。其他旧账号和唯一明确归属资源仅可准备审阅集合；普通实际候选源未获独立确认时不产生删除项。shared/global/unowned/mixed/unknown 均 pending，绝不转给管理员。

本站清单只描述本站原生引用，不操作中央 subject/user 或其他站授权。全部 collaboration 中央 subject 保留。闲鱼身份、账号、tenant 数据完全排除。中央保留集合仍须由协调者单独核实“指定管理员对应 subject ∪ 全部现有协作计划经核实 subject”及其关系；没有本地 ready 就删除中央主体的通路。旧 actor、员工、外部平台账号、电脑/手机配对和运维凭据分别使用 native-actor/platform-account/device-pairing/system-credential，不能等同网站 login-account。

## 只读探测与字段最小化

`probeWorkspaceSource({databasePath})` 要求显式绝对文件路径，不导入应用、repository、auth 初始化器或迁移代码。直接使用 `node:sqlite DatabaseSync(path,{readOnly:true})`、`PRAGMA query_only=ON` 和 BEGIN/ROLLBACK 一致读事务。只记录表/列名与类型、PK、FK、表计数、明确白名单的稳定 ID/归属字段及关系。查询密码条件或读取 token/hash/body 的 SELECT 不存在；指定邮箱只用来过滤并返回原稳定 ID。

全表 schema 范围从 sqlite_schema 实际发现，表名安全引用。已知表族位于 `catalog.mjs`；新表、无可安全枚举 PK、超限、未投影 FK、复合 FK 等明确 unresolved 并阻断完整性。未知表只查 schema/count，不读取可能是令牌的 id。身份 sessions/transactions/logout 状态只查 schema/count，不投影 Cookie hash、state/browser hash、tokens、secret 或 jti。已知基础设施表明确标 infrastructure 并记录计数，没有假称清理其记录。

单独 `probeWorkspaceSource` 的兼容 `sourceFingerprint` 明确为 metadata-only 占位，`sourceFingerprintComplete:false`，不能成为共享契约所需的完整 source baseline。`metadataInventoryFingerprint` 绑定 schema、安全 ID/归属/依赖与计数，并排除会变的文件 mtime；`inventoryFingerprint` 使用共享函数对 typed stable ID 计算。完整 v2 `sourceFingerprint` 来自关闭的一致 SQLite backup 工件 SHA-256、该快照 SQL 对象引用与所引用内容摘要，以及**包括未引用文件**的全对象目录相对路径/大小/内容摘要。活跃 main DB 文件 hash 不参与冒充一致源。正文、关系、引用对象或未引用对象内容变化均改变完整摘要，不读取/输出正文或凭据值。v1 只覆盖 SQL 引用对象的历史证据保留原范围，不能升级解释成全对象范围。

## 原生归属与级联映射

| 表/来源 | 可用事实与保守边界 |
| --- | --- |
| `backend/auth.mjs` 的 `local_users` / `local_sessions` | 网站登录 ID 与其原会话分开。只选 ID/user_id，不选 password_hash/token_hash。旧会话不可因业务恢复重新生效。 |
| `members.user_id` | 登录 ID 到工作区成员的明确关联；成员角色不证明其拥有全部工作区资源。 |
| `employees.owner_user_id`、`devices.owner_user_id`、`employee_template_instances.owner_user_id` | 显式稳定 owner 关联；员工/设备仍是原生独立资产，待独立审阅，不能跟网站旧账号一并盲删。 |
| `tasks.created_by` / 消息 sender 等 | 原源码可为通用 actor、可变来源或缺失；只保留来源提示，不当作唯一资产所有权证明。 |
| `documents`、`automations`、`skills`、`conversations` 等 workspace 范围记录 | 原 schema 只有 workspace 并不代表专属于 workspace owner。默认 shared/unowned/global/pending；不会按工作区 owner 扩大删除。 |
| FK `ON DELETE CASCADE/SET NULL/NO ACTION` | 记录所有可投影依赖与反向 cascade。保留/待判定记录依赖待删目标时，撤回目标删除提案；未知表或跨界 cascade 阻断批次，不扩充清除范围。触发器存在时额外 pending。 |
| `backend/storage.mjs` 与 documents/document_versions/task_attachments | 单独 metadata probe 只统计 storage_key 数量。服务器 snapshot 在私有进程内部读取 SQL key/checksum，对内容寻址的源文件、复制件和源二次读取逐项哈希相等核验，不输出 key 或正文。未引用文件只计数/哈希，保持原位 pending，无目录清空能力。 |
| unified identity bindings/sessions/transactions/logout 状态 | 全部视为身份安全状态，未知/保留待审，不恢复旧授权，也不触碰中央主体或其他站关系。 |
| `device_updates` | `backend/device-updates.mjs` 的设备维护意图与回执，native-actor 系统项；不投影 claim_token/idempotency_key，不视为旧网站账号业务，不执行升级。 |
| `ziwei_connect_bindings` / `ziwei_connect_runs` | `backend/ziwei-connect.mjs` 的 Control 外部账号绑定和执行回执，分别为 platform-account/native-actor。只投影本地稳定引用，外部 account_id/label、凭据和 result_json 不读取；不解除绑定或重放动作。 |
| `management_requests` | 幂等键由调用方提供，复合原生 PK 不作为普通 id 明文传播。分片工具用整套 `(workspace_id,kind,request_key)` 的 SHA-256 生成 opaque 稳定引用，原映射仅 root 私有文件。`backend/management.mjs` 的具体 kind→resource 关系保留为阻断依赖。 |

## 草案、独立 probe 与共享验证

每次运行分别生成 `probe.json`、`proposed-manifest.json`、`dry-run.json`。proposal wrapper 为 `status:pending_source_baseline`、`dryRun:true`，保存真实未齐字段与 blockers。没有真实备份 artifact hash 或隔离恢复证据时，必需字段故意缺失；共享 validator 如实返回 schema errors，不填全零 hash、空库 hash或虚构 verified。proposal digest 是共享纯函数的摘要，绝不是已独立审阅或执行授权。

共享 validator/schema 原样 vendor 于 `backend/identity-cleanup/vendor/`，provenance 指明冻结上游 commit `b6c53862fb07b2e23f2a05fea39ca843dd7c61e3` 与文件 SHA-256。测试核对文件字节和导出 schema 一致，运行时无外部盘符依赖。更新共享源时必须重新核对 hash，不能另写平行 schema。

`validateCleanupManifest` 的 context 始终缺省 `{}`；本实现没有从提交的 manifest 自动构造 sourceBaseline/adminBaseline/reviewedBatchDigest。真正独立原生探测、保护账号锚点和锁定审阅摘要要由受信协调代码组装，不接受 CLI --input 透传自证。

`partition-manifests.mjs` 复用一个既有关闭备份，按表流式生成有界 typed-reference 分片。每个主引用只出现于一份分片，管理员锚点与跨片依赖可作为 context 重复；已有依赖和 FK/原生软关系均取实际闭包，跨片 reverse cascade 明确 unresolved。不会把单表 5000 行的初步投影上限当作永久排除大表的理由。集合 index 分开统计主引用与重复 context，记录每表 count/represented、未投影具体原因、每片摘要和共享验证代码计数。单片及集合始终 `globalInventoryComplete:false`，完整安全 ID 覆盖不等于所有权/级联已审阅，更不等于删除许可。

## 本机候选源的真实结论

本轮只读取用户明确指定的两个旧目录候选文件。较新的 `ziwei.sqlite` 可只读：33 表、1 条网站登录记录、2 个 workspace，指定邮箱精确匹配唯一旧登录 ID。旧 `aurababa.sqlite` 可只读：11 表、1 个 workspace，无 `local_users`，members 也无 user_id，属于无法核实登录归属的旧 seed 模型。两份文件来自旧工作目录；其 checkout/ref 不证明 DB 构建来源，更不等于当前混合生产版本。

两份实际草案都为 pending_source_baseline，删除提案数 0；真实管理员/员工/设备 ID 不写入本文。受控证据位于 `D:/AINavtie/ops/cli-standard/identity-readiness/workspace/` 的 local-ziwei/local-aurababa 分目录，按每次运行时间/随机 ID 保留；路径只在内部记录使用。没有复制/打包真实 DB、读取真实密码/hash、改写配对或执行数据库/目录清理。

## 隔离备份与恢复

`fixtures.mjs` 的备份/恢复 API 只接受该进程发行的 opaque WeakSet context：目录必须是 OS temp 下指定前缀的实际目录，DB 的随机合成 marker 必须相符，不能用普通对象/真实路径替代。仅接受列出的合成表及已知可隔离凭据列；未来身份表/未知秘密列拒绝恢复，不自动复活授权。备份使用 `node:sqlite.backup`，包括已提交 WAL，禁止只复制 main DB 文件。目标必须未存在，不覆盖历史工件；备份工件 SHA-256、源安全指纹、受限路径/mode、保留策略分别记证据。

恢复落在独立隔离目录，校验确切备份 hash；保持业务正文、管理员 stable IDs、inventory 与 device/pairing 关系及状态。仅在隔离 DB 中把网站旧密码设为无效标记、会话设过期、网站静态 API key 设不可用。电脑/平台/运维凭据和配对码不在该网站登录撤销集合中：有效配对保持原有效状态，已撤销凭据和已消费配对码保持原状态。合成测试验证原凭据材料未改变，服务器代码不读取这些原材料，仅用禁止写其表的 SQLite authorizer 和安全状态摘要验证保持。缺最新撤销账本时，任何实际恢复启用仍 pending，绝不能从旧快照推断现时仍有效。

合成与服务器工件要求目录 0700/文件 0600，服务器额外验证 root 所有权和非符号路径；Windows fixture 不将 POSIX mode 冒充已核实 Windows ACL。服务器工件仅保留 root 私有目录，原库不下载、不打包；保留策略是 7 天内人工复核，不自动清除。`verifyIsolatedSnapshot` 只接受同进程发行的 WeakSet context、随机 nonce 与匹配工件 hash，复制到全新隔离文件。SQLite authorizer 只允许网站三个表的指定凭据列 UPDATE，拒绝其他 UPDATE/全部 INSERT/DELETE，不改 schema，不运行 app/scheduler/queue。CLI 没有 apply/delete/reset/生产写入选项，不生成生产破坏 SQL。

对象恢复不信任 capture 的布尔状态：私有还原映射本身须匹配摘要，对每份复制件重新验证字节 hash/大小与非符号路径，再复制到新的隔离对象树并再次哈希。复制件缺失/篡改、映射变化或路径逃逸均拒绝。`object-store-extension.mjs` 允许对旧关闭工件补全对象范围：只有全目录摘要与原捕获摘要精确一致、所有文件复制并还原核验通过才声明覆盖完整；原 DB 不重新备份或修改，旧证据不覆写。来源对象有漂移时保持 pending，不能用当前对象拼出未经证明的旧快照。

## 186 真实源与工件（2026-10-22）

独立 `systemd MainPID → /proc cwd/受限 runtime 配置 → 同 PID DB/WAL FD → 文件 dev/inode` 链确认真实 Workspace 使用 `/opt/ziwei/data/ziwei.sqlite` 及其 WAL，对象目录为 `/opt/ziwei/data/objects`。服务与部署代码摘要在捕获前后相符；生产 `db.mjs` / `storage.mjs` / `package.json` 有 overlay，不能把本机旧 33 表或单一 Git HEAD 当作其完整来源。本轮在实际 49 表 schema/FK 上盘点，主管理员精确匹配 1 个真实稳定 ID（与旧本机候选不同），不在 Git 公开该 ID，不根据 email 推断全部 workspace 数据归属。

追加静态只读核查确认：生产 `device-updates.mjs` 与 `ziwei-connect.mjs` 的字节 hash 与当前 HEAD/原部署基线一致，上述三表分类有同源码依据；`management.mjs`、`version-preservation.mjs`、`production-preservation.mjs` 另有生产 overlay。仅检查 imports/exports、DDL/FK 名、包依赖版本和幂等记录安全静态语义，没有导入执行。管理幂等层仍按原复合键查询与保存返回资源 ID；额外 overlay 的确切作者/构建来源尚未核实，保留现状，不能从静态声明推断所有动态行为。保全/维护表始终视独立系统项。

新的 `node:sqlite.backup` 捕获窗口为 02:09–02:11 UTC，关闭 DB 工件约 309 MB、49 表 / 152582 行。SQLite integrity 与 FK 检查均通过（FK 0）。3 个 workspace / 9 个网站登录账号；SQL 对象引用 6 条，对应 3 份独立内容。全对象目录为 4 文件 / 24288 字节，其中 1 份未引用文件 63 字节保留 pending；对象延伸复核证明全目录摘要与原捕获一致，4 文件已复制到 root 私有工件并在独立对象树逐项恢复核验。

原 SQL 隔离副本验证：9 条网站密码设为无效格式、23 条会话过期、0 条 API key；生产源未改。所有表计数、schema、管理员稳定 ID 与运维/配对状态保持，完整性/FK 检查仍通过。有效配对保持和已撤销不复活由合成正反例验证；缺“恢复时最新撤销账本”，任何实际启用仍 pending。没有运行应用、调度、队列、设备动作或闲鱼业务。

真实工件仅在服务器 `/var/lib/ziwei-workspace-identity-prep/` 的单独 snapshot 目录，root 0700 / 文件 0600；原始 DB 未下载。脱敏 summary、工具 hash、独立只读复核、分片 index 与错误/待审代码计数记录在 `D:/AINavtie/ops/cli-standard/identity-readiness/workspace/production-inventory/`。复核已确认关闭 DB 和 SQL 隔离副本在 RO/query_only 检查前后 hash 不变。慢速分片 v2 的部分输出保留作 incomplete 历史；仅核实自有 worker 的 exact Node 参数、唯一父命令 marker 和只读备份 FD 后停止，没有终止业务服务。优化后的 v3 完整分片状态以单独 index/summary 为准，不把初步 1237 条清单当作全量。

现场事实状态为 `observed_production_snapshot_independently_read_back`：主审使用独立 CommandFile 两次只读读回 closed DB/SQL 恢复与全对象扩展，验证 hash、权限、完整性与 4/4 对象复制/还原。历史 proposal 的 `pending_source_baseline` 仅表示共享 validator 的逐批 source/admin/review 锚点尚未正式组装，不能解释为仍在使用本机假源。逐批恢复指纹绑定、未知资源归属/跨片 reverse cascade、未引用对象归属和最新运维撤销账本仍 pending；没有从 manifest 自签任何可信 context。

v3 已于同日完成 152 / 152 分片，49 表 / 152582 行中 **152580 条主 typed references 全部进入清单**，另 2 条 schema_migrations 基础设施记录保留；无仍因性能或未知表而排除的记录。主清单为 preserve 34 / delete 0 / pending 152546，重复保护与依赖 context 不计入主引用总数。共享 validator 对 152 片均无 errors，全部为 pending；pending 计数含重复 context，不能误当唯一资源总数。真实 ID、原生复合幂等键映射与管理员锚点仍只在服务器 root 私有分片文件。

只读代理配置补查证实 Nginx 配置中 `qzelynth.top`、`ziwei.qzelynth.top`、`www.qzelynth.top` 指向 `127.0.0.1:4178`，配置文件摘要保存在脱敏 observation。该次静态解析未确认 443/TLS 终止，故“实际业务 HTTPS origin 已核实”仍不能成立；没有依据历史默认域名或此次 HTTP upstream 推断 HTTPS/callback 已部署。

## 验证

`node --test test/workspace-identity-cleanup.test.mjs test/workspace-identity-cleanup-snapshot.test.mjs test/workspace-identity-cleanup-partitions.test.mjs`：25 pass / 0 fail；独立审查者重复通过。覆盖只读不变、secret sentinel 不外泄、共享契约 hash/schema、未核实源零删除、同邮箱冲突、seed/未知表、owner/正文/未引用对象变更指纹、共享/全局/混合/无归属、跨界 cascade、WAL 一致备份、逐对象引用/复制/还原 hash、缺失或非法对象/篡改阻断、证据路径相等/父子/Windows 大小写别名拒绝、FK 异常拒绝、旧网站凭据仅隔离禁用、有效配对保持/已撤销不复活、跨片依赖闭包与 opaque request key、伪造 context/工件篡改拒绝及中央 subject 无操作。

只读入口示例：

```powershell
node scripts/workspace-identity-cleanup.mjs prepare --db "<显式绝对SQLite路径>" --label "<安全证据标签>"
```

stdout 仅返回状态/计数/摘要/证据目录，不输出账号清单或逐条 pending。真实源及受保护一致 DB 备份、全对象补充复制/隔离还原已有证据；完整所有权/跨片 cascade、未引用对象归属、最新运维撤销账本、共享独立 source/admin/review 锚点与最终统一身份切换仍 pending。当前工作不授权清生产库、移除目录、重置密码或删除中央身份。
