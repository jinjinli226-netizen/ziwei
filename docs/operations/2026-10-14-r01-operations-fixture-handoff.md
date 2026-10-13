# R01 运维适配器隔离准备交接

状态：**OPS FIXTURE PREPARATION / 正式入口未接通 / 未放行**。2026-10-14（北京时间）。沿用R01唯一正式发布者、E02唯一产品owner、Q01独立签收。G1动态子集27/27及报告 `68928aac` 是局部证据，不能扩为G1–G5或正式发布通过。

工作树 `C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解`，分支 `codex/v2-r01-release-preparation`。原准备提交 `70a9c1c`；本轮新代码只在 `scripts/operations/`，未改E02产品模块、packager/guard/collector，不读变化writer进行产品测试。不在原D或2884树写入/测试。本轮正式服务/client start/stop/update、正式密钥写入、模型与手机业务均0。

## 已实现的运维侧边界

| 模块 | 能执行的准备行为 | 不能据此声称的能力 |
| --- | --- | --- |
| `r01-proof-provider.mjs` | independent trust固定host、trusted verifier明确true；collect/recheck转交原request与原signed envelope；challenge不复用；超时不重发；本机read-only collector以独立固定executable/entry SHA、stdin JSON、无shell、有限时间/输出执行 | 未接E02 envelope/schema、source CLI与跨host可信SSH/WMI proof传输；fixture priorEvidenceDigest暂为canonicalDigest(envelopes)，必须按E02实际算法接；不能代签/补safe或用peer key自证 |
| `r01-offline-backup.mjs` | 实际SQLite backup API；完整文件/目录manifest复制与恢复读取；逐表schema/PK/all-row digest、对象/HOME字节、int64、增量/墓碑；stop proof绑定原operation/spec/DB、canonicalRoot与DB/requiredFiles集合；输入跨await冻结；原source改变拒绝并留failure，不覆写旧证据 | stopped proof由trusted外层验证，当前规范化字段是R fixture schema，尚不是E02实际字段；未证明生产all-writers stopped或Windows ACL/native namespace；没有整库回写或启动恢复业务的入口 |
| `r01-phase-controller.mjs` | read-only `plan`可运行；业务mutation仅委托E02 API；独立release/backup verifier均须明确true；backupProof是单独参数不改spec；compat只inspect/plan；restore每次fresh role inspect；spec/trust/proof深冻结；own ledger/attempt/锁留证；丢已提交回执只inspect恢复，不重新collect或apply | E02产品模块/source/spec/receipt normalizer/package pins未交付并独立签收；实际CLI当前**仅plan**，`--apply`拒绝；没有薄wrapper/QA marker豁免，也没有临时DB schema写入fallback |
| 只读legacy readers | SSH内存SQLite投影原action ACK/terminal/tree字段/原device及dedupe摘要；同用户原生路径读runtime journal/state与原daemon轮转日志，白名单meta/hash | 不把terminal、没有uncertain标签、当前PID不同或active0当旧任务退出证明；不清缓存、不改status、不补synthetic Job |

HMAC统一约定来自总控：source signer/server verifier各有同一专用ops secret的独立私有reference，经可信transport预配；独立trust固定算法/keyId/host/roots，spec/proof/包/日志不携带secret，不用device token/provider auth，不放BotHOME。本轮只fixture生成两份随机私有key；**未向正式server/host预配key**。E02仍需给精确sourceCLI、signed payload字段、freshness、trust/keyref与验签算法；R不会默认其字段。

## 可执行命令

以下命令在R隔离树运行，不改变正式服务。

```powershell
Set-Location -LiteralPath 'C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解'
node scripts/operations/r01-phase-controller.mjs plan --package-root .
node --test scripts/operations/r01-proof-provider.test.mjs scripts/operations/r01-offline-backup.test.mjs scripts/operations/r01-phase-controller.test.mjs
```

当前plan实际输出 `willApply=false`、`productionReady=false`，缺 `backend/production-preservation.mjs` 和 `scripts/production-source-proof.mjs`。尝试以下mutation会在CLI处拒绝：

```powershell
node scripts/operations/r01-phase-controller.mjs plan --package-root . --apply
```

SSH只读legacy投影沿既有private reference，独立参数指定既有Paramiko路径，输出必须是本树`.local`下新文件。该读入口已真实执行，未复制凭据值：

```powershell
& 'C:\Users\25941\AppData\Local\Programs\Python\Python311\python.exe' scripts/operations/v2-run-server-preflight.py --reader legacy-actions --ssh-reference 'C:\Users\25941\Documents\ChatGPT\抖音数字员工\.local\ssh-handoff-20261008\ssh-credentials.json' --paramiko-path 'C:\Users\25941\Documents\ChatGPT\抖音数字员工\.local\cli-publish\pydeps' --output '.local\r01-ops-20261014\legacy-actions-new.json'
```

本机journal reader使用已核同用户原生隐藏WMI只读进程，不在MSIX重定向环境假报成功；既有V1 helper SHA固定 `668f306a02a278ce1c969a107a88214a6b201e92f5c6590ad62ac78a92f0bd3d`。运行参数为 `r01-legacy-journal-readonly.py --helper <原V1只读helper绝对路径> --helper-sha256 <上述准确SHA> --output <本树.local新文件>`；原生launcher精确命令保留在会话工具回执，reader不含业务控制命令。不得为了看旧日志重启用户服务。

## 现场已确定的bootstrap缺项

两次正式只读projection均为30 succeeded / 9 failed / 1 expired，40项均acked但旧result协议没有完整tree/root/active0字段。**这不等于40项都在途，也不能据此放行**；仍须原host独立证据。

acked-expired原 `action_8668054e-e2e9-476b-acb1-d20f561eb661` 的target是当前原bfd设备，workspace `ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e`；ACK `2026-10-11T14:26:40.455Z`、expired/completed `14:42:41.671Z`（北京时间22:26–22:42），早于当前PID12132的10月12日创建。result_json空（SHA e3b0…），无processExit；dedupe_key SHA `6be18704a2c8dc626bddc16f78aec234160d9039ee64ea819639f8be5379b223`。

本机原生runtime当前投影47相关文件：18 delivery均confirmed，action-state v2含51 completed/18 started。按原actionId（含completed.result.actionId）、dedupe摘要关联，尚未找到该expired的对应记录。nativeRuntime字段计数为0只表示旧记录字段观察，不能升级成原Job树证明。原scope/cache/terminal/session/轮转日志只读追溯限定在既有userHome与已知原scope，不无限扫盘、不停进程。没有原scope收敛证据就拒绝bootstrap；更新后的新Job或新generation不能补证旧任务。

进一步限定读取原生userHome现有4份daemon轮转日志，找到该action在原 **daemon PID51880** 的 `a2a_action_failed`，时间 `2026-10-11T14:26:41.906Z`（北京时间22:26:41）；行SHA `2007f54b03da597f6653333681e6abfc62bdd28ba5fa65a28307604be33f87e2`。同原PID日志有start `2026-10-10T10:40:42.458Z`、drain `2026-10-11T20:00:20.424Z`、stop/exit `20:00:21.171Z` / code0；本轮原生process查询51880不存在。这证明原daemon generation及其退出留痕，**仍未证明该action原native子树/rootPID/session和补传已经收敛**；不能把daemon exit、失败event或当前12132作为原Job证明。缺项保持，不扩大扫盘。

## 隔离验证与证据

本轮采用先红再绿。最终新ops三套46/46，0 fail/cancelled/skipped/todo；5个Python文件AST语法PASS，Git差异检查通过。provider18项含真实fixture HMAC双keyref/两fresh challenge、错key/签名/stale/binding/replay拒绝；backup14项含真实SQLite/对象/HOME/int64/墓碑/源根替换/跨await篡改/变化/损坏拒绝；phase14项含无产品入口/无Gate/backup缺失/compat拒绝、丢回执原operation回读、并发inspect保护、跨await spec/trust冻结与self-trust拒绝。

隐藏子代理只读审查发现phase recovery并发、spec可变引用、backup root mapping和int64四项，均有红→绿回归并修正；后续trust别名和backup输入冻结也加回归。审查者没有改代码、运行测试或访问正式业务。以上都是ops fixture与真实文件算法层，**不是E02实际prod-spec/no-QA-marker验证、真正oldV1停机/原Job、Q最终G1–G5或正式部署验收**。

私有证据绝对根：`C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解\.local\r01-ops-20261014`；各自fixture目录 `.local/ops-transport-*`、`.local/ops-hmac-*`、`.local/ops-backup-*`、`.local/ops-phase-*` 保留原数据/失败，不入Git。

- `ops-final.log` SHA `93ab584f4b52e1b39581b31d7d841a97a4b01c2d3a6e8a711bfe71a91230c2e3`；transport/backup/phase/review/bigint/freeze各次红与绿日志均保留。
- `legacy-actions-01.json` SHA `7f9bdc2569d0a016d50d56278625b7a69ac1e6adf496d52855372b172c1cc145`；含dedupe摘要的新 `legacy-actions-02.json` SHA `e328ae1f91a02280a04576b26bc1adcc0c4edc0349757f1827b82e56fb49ba7c`。
- `legacy-journals-01/02`原投影保留；完整actionId关联版 `legacy-journals-03.json` SHA `be154438719ae2fc8f9723d077d82a7aa477d0ad942d61f8b09e89bf88fb216c`；有界輪转历史版 `legacy-journals-04-history.json` SHA `41d82c46894238be49fac17247d66c981eb0cf1237168e7b57d955255ab8dc62`。

## 下一依赖与正式顺序

E02先交付准确production/source接口、bootstrap projection-v1（不依赖尚缺V2 table/UDF/intent、排除heartbeat/phase/challenge自变化）、实际spec/envelope/receipt/backupProof schema及native source CLI；scope必须覆盖原所有shared writers/claims/cache/outbox，unsupported非空Group/collab明确拒绝。`backupProof`单独传入；丢已提交回执返回原receipt不重collect；seal最终projection复核在原BEGIN IMMEDIATE事务hook中，不外层嵌套。

R随后将这些**实际冻结字段**接到trusted verifier/receipt normalizer/source transport/module和六产物pins，补真正无QA marker的prod-spec、跨host与old-V1-stopped fixture，交Q独审。native original tree/旧expired缺证不能默认。原pause/stop必须沿native生命周期且有独立树证据；old updater自动start/失败resume不可默认已暂停。当前没有执行这些native mutations，也没有可用的正式stop/apply包装器。

放行后顺序仍为：准确Gate+GitHub push/读回 → staging → 原V1全部writer pause/drain/stop及原树证明 → 同DB离线schema/init/prepare/seal → 持久sealed回读 → 安装保持stopped、启动前已有fence → 只需变层切换 → 同批compat/V2身份联验；restore只在匹配V2安装/运行仍sealed时调用，结果保持paused。两库/对象/HOME/config/key/缓存一致备份及offline restore-read须独立验证；不整库恢复旧快照、不清新HOME/unknown、不重放旧任务。全部Gate通过后已有用户授权仍有效，不重复请求同一批准。
