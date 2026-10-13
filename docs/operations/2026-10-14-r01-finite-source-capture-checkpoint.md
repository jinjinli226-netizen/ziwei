# R01 有限原生 source capture checkpoint

本轮只交 operations producer、真实只读来源和隔离 fixture。正式 pause/drain/stop、更新、部署、签名密钥 provisioning、源 host 产品 CLI、Q 独立验收和最终发布全部未执行。R01 自己的树为 `C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解`；产品基底仍是未获准发布的旧候选，不把本树产品文件当成 accepted candidate。D/2884 没有写入或测试；本轮没有重复读取此前获准的一次旧 archive。

## 固定输入和所有权

读取 E02 clean `12a68314681d4733ebc746b9b4df22e9297966e4` 的 `.local/preservation-production-finite-checkpoint/handoff-finite-checkpoint.json`，逐字节复核六产物、两 manifest、四 frozen contract，共 12 个 pin 全部匹配。E02 author full 993、target 41、lint 126，以及真实两角色解压 CLI plan/first-write refusal 均是作者证据；不等同 Q/G1-G5 或正式执行许可。

source CLI 固定为 `node scripts/production-source-proof.mjs collect|recheck --request ... --trust ... --output ...`；recheck 的 `--previous` 是整个有序 collect-envelope 数组，产品的 `priorEvidenceDigest` 绑定整个数组。产品 provider 给 ops 的是已生成的 signed `requests`；ops 必须透传，不能合成 action/HOME 清单或补签字段。request 还包含 `command`、`targetOrigins`、`installed`（非 restore 为 null）。本轮没有修改 E02/E03 产品文件，也没有复制 E03 未提交的 observer/handler。

E03 已合入 E02 的 `6358f286`/`2b45d693` contract 是冻结输入。E03 `docs/operations/2026-10-14-e03-source-namespace-design.md` 在读取时还是该树的 `??`，只作为设计建议，等待其 clean checkpoint 固定 ABI。原 ops generic provider/backup/controller 尚未同步此最新产品 ABI，不能宣称已接通。

## Linux fresh 事实

准确私有来源：`.local/r01-finite-source-20261014/linux-source-03.json`，SHA256 `4b3601444b1064e1072b62000516dc5f47d6a726e44491aabba384b801a713a1`。采集时间 `2026-10-14T04:11:06.22777+08:00` 至 `04:11:06.772416+08:00`；原 API/service/source 身份两轮稳定。SSH 使用已存在的私有 reference 和 known-host RejectPolicy，只在远端 stdin 运行 Python，无远端 probe 文件写入，无 environ 或正式 signing key 读取。

| 原生范围 | fresh 事实 | 限制 |
|---|---|---|
| API | PID 181593；native startTicks `39225172`；物理 root `/opt/ziwei/releases/a66df9c-sqlite-179d0d46` | ticks 是 nativeBirth，未改成 ISO；磁盘代码不代表实际加载模块 |
| OS boot | `/proc/sys/kernel/random/boot_id` = `590c099e-78a8-4fd6-ada1-1951d181df08`；CLK_TCK=100；probe 与 PID1 同 PID namespace | broad /proc 中 90 个进程缺 exe（kernel/zombie 等不可见字段），不声称全 OS namespaceComplete |
| API generation | systemd 实际属性 `InvocationID` 摘要 `f525d303988f01afa8e3f16f3caef5f74d797f08d95f587d0dccf18d8800129f` | identityKind=`systemd-invocation`；不是 API self-reported nonce |
| API manager | ControlGroup `/system.slice/ziwei-api.service`；KillMode=control-group；SendSIGKILL=yes；Delegate=no；Restart=always；ActiveState=active；SubState=running；start=`Mon 2026-10-12 05:10:37 UTC` | 本轮没 stop；不能因当前 cgroup 仅主 PID 而说无历史 child/worker |
| API unit | `/etc/systemd/system/ziwei-api.service` SHA `a2e327a86494d881ecf410fafd0e1d7171085930a19dada18659005215dc807b`；onboarding.conf SHA `a7cd0bf2a5028e5318629f820e66e91301a031fbcafbe67feda67ed1f9f17d04` | drop-in 精确路径和 bytes 在原记录中 |
| recursive cgroup | API 当前成员 181593；control 当前 134533；两者递归目录/member 读取可见且双读稳定 | 只有当前窄 containment；原生 controller 前后 provenance、restart/外部 updater/脱离成员仍需正式验证 |
| control/nginx | control startTicks `20923406`，Restart=on-failure；nginx PID737/startTicks3281，成员737/165517/165518/165519/165520，KillMode=mixed | 没有控制这些服务；control DB writer 也不能由 API stop 推出已停 |
| original health | 原 a66 health 只有 ok/service/time | self pid/nonce、实际 DB/operation/sealed fence 均没有；实际新 V2 需 E03 private identity handler |
| disk API source | 333 个 recursively sorted source 文件，buildDigest `530bb085eea3d9e45411a98fd0ae99bddb7a083207eabf8997d15854298e0db2` | 使用 frozen E03 完整数组 JSON.stringify SHA 算法；不是 entry hash，也不是 running build proof |

第一次 `linux-source-01.json` 查了错误大小写 `InvocationId`，保留该尝试。已改为真实 `InvocationID` 并用 fixture 验证；最终只以 source-03 为 checkpoint。原 API 可以 spawn discovery/git 子进程；producer 没有“API无child”假设。

## Windows fresh 事实

准确来源 `.local/r01-finite-source-20261014/windows-source-02.json`，SHA `250339868bab66ca0166ca7bd7c0f0eb84a0b20f124a84100f11421a9639c743`，`2026-10-14T04:09:49.439794+08:00` 至 `04:10:07.231146+08:00`。用已核 helper SHA `668f306a02a278ce1c969a107a88214a6b201e92f5c6590ad62ac78a92f0bd3d`，通过同用户隐藏 WMI native worker 读取；没有启动业务实例。两个 worker 49188/46472 均已自然结束。

- 主 PID12132，PPID1848，CIM birth `2026-10-12T10:19:53.29Z`；exe `C:\Program Files\nodejs\node.exe`；20242 的 native listener owner12132。
- installed 与 health build `7e2ae40a8e9cb12ad8592514db263b6952f27bd0eae6fe01d3b84fe8cd3d1950`；root `D:\work\nodejs\node_global\node_modules\ziwei`，entry `daemon\ziwei_user.mjs`。build 按原 `clientBuildIdentity` byte 算法纯文件计算，没有执行原模块。
- 原 config `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json`，每文件 Win32 handle final path 精确匹配 `\\?\` native 路径；SHA `7913bf1c1b490ecf9b6d6760787973c28f8c484703c144eb0028b57ef8166b72`；原 nonceDigest `d9796e2420a8db139ef94c927c12db3c574573b38c6eb996ab7d898e4b56dec6`；lifecycle startedAt `2026-10-12T10:19:53.98Z`。配置与进程、监听、nonce、source bytes 两轮稳定。
- bigtron、device `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`、workdir `C:\Users\25941`，原 config 无 shared connections；逐个连接的 runtime/delivery/cache/source refs 在私有清单里。当前 ready/connected、active0/polling0/managedAuxiliaryCount0 只作为 health counters，不能证明 worker 排空。
- 已精确枚举原 userHome 的 runtime、maintenance、logs、diagnostics：7,165 files、1,361 dirs，47 个 runtime 文件；第二轮 directory membership 复核无变化、可解析原 receipt/log 范围 issues0。每个文件有 exact path/nativeFinalPath/byte SHA/bytes；第三方 stage package/JSONC 只按 opaque bytes 保存，不把它解释成业务 receipt。当前日志仍可能在读取后继续追加，此 checkpoint 不是 sealed manifest。
- 全部 11 个 update maintenance 目录都有 job/result/maintenance.jsonl：8 complete/3 failed；全部有原 maintenance_exit（成功8、退出1三条）。保留各目录文件 SHA、parent/worker PID、heartbeat/exit 原记录，没有只读 latest。没有读取到 preserved processExit reports，原 Job start/membership/breakaway、worker birth 完整证据仍未具备。

当前 cache 为原 native runtime/action-state.json，268755 bytes/SHA `a8157f76404b26651a3be61c19acc5b4960fa9ecc021b655d8ec1d1b3ff6867c`。完整当前 raw cache 保留不写；原一次性 Job receipt 正常执行可能已被关闭/删除，不制造旧 Job、start 或 processExit。raw command.execute/automation.execute 的 root exit 不当树证明，当前 PID/PPID 图不当历史 lineage。

补充的有界 `windows-boot-coverage-02.json` SHA `4ef00c4419bd5eaaf193f285b266dfa7c02b22d1a5fd8dca0803ec243de3dbb0` 仅核原 PID12132 的精确 boot。原始 CIM birth 实际保存为 `/Date(1791800393290)/`，换算 ISO 为 `2026-10-12T10:19:53.290Z`；capture 中未替换原始值。原 start 日志 `2026-10-12T10:19:56.094Z` 与 native birth 匹配；所有已知 native userHome/logs 文件目录成员双查一致，logger JSON 无坏行/错workspace。

此 boot 的同PID logger位于 `daemon.log.1791866508730`（SHA `4141402c7059d940f0283fced339226ae6f533d1cfaab2515553a1904308ad25`，16758条，start 至 `2026-10-13T04:41:48.730Z`）及本次读取的 active `daemon.log`（SHA `158461d1d211b77384c7a7f70a1fc07c9592ad8d240aa1a0d41b2d9489628060`，14214条，`04:41:52.778Z` 至 `20:20:20.011Z`）。同PID event 计数：started1/a2a_poll22813/heartbeat8005/heartbeat_failed153；无 actionId 记录、无 action.started，也无退出事件。这是已知目录内的真实日志覆盖，不据此推断全部 source-spawn 类别没有启动或不存在另一 override logger。

原 current cache 51 completed、18 started；18 个 action-delivery 文件按准确 native path/SHA/bytes 单独列出。这些原 cache/delivery 历史不归到12132 boot，也不和8668的51880 boot混为一谈。11个维护日志的精确 worker PID/heartbeat/exit/source SHA 均在私有记录里；所有日志记录的 worker PIDs 与此次当前 CIM inventory 没有同PID项。缺原 birth，仍不将此“没有当前PID匹配”解释为原全tree已退出，不 kill 或补造复用PID的原generation。完整原PEB/HOME overrides 仍 unknown；现有可靠CIM接口不提供原进程环境，未读取或回显任意 environment/auth。

## 一条 legacy subject 的精确引用范围

私有 `.local/r01-finite-source-20261014/legacy-one-subject-source-references.json` SHA `e79be8c32e90660aa7862c6e2f727206b2fe78325a6fbc8c14d422fce694a020` 提供 path/SHA/bytes/kind/scope、完整旧 archive manifest、六模块 raw/normalized hashes、原 cache prefix/history/logger 关系。它是 **提议给 E02 native interpreter 的引用范围**，`externalArtifactRangeApproved:false`，不是 safe:true 的正式 proof。Windows subject 的证据不搬到 Linux 冒充本地 proof。

subject `action_8668054e-e2e9-476b-acb1-d20f561eb661` fresh rawActionDigest=`0e6f6100f2bb73194500a30ff6db97b637366477a3897888274507a16dd37b71`，按 clean12a 的 nativeActionDigest（保留完整 raw row，补 parsed payload/result，JS localeCompare canonical）在原 server disposable Node stdin 内计算，只输出摘要；原 row/result/dedupe 不改变。expired/ACK14:26:40.455Z、completed14:42:41.671Z、result 空、40条状态30 succeeded/9 failed/1 expired，仍准确保留。

| raw source | exact path | SHA256 | relation |
|---|---|---|---|
| 原 poll history | `C:\Users\25941\.codex\worktrees\a2a-delivery-recovery\灵光爸爸拆解\.local\a2a-recovery\native-view-20261012\context-result.json` | `89071077023b66a9ad7597f02e02f563da58eebd0b9c23b9ff7f3449d89a263c` | 原PID51880；唯一action失败、随后pending0 |
| 原 inspect | 同上目录 `result.json` | `6e5dce6563e61f71109a4b963784a3b22cc535ad6ed92c315d87df1ca1359d06` | 原native scope/config/runtime/file metadata |
| 原 boot/cache anchor | 同上目录 `native-snapshot.json` | `a8ffa54827ddc9c2cbb23464e10d09e6916eb3af0e9c8e4d087a81c7f6048c6c` | 原birth `2026-10-10T10:40:39.884Z`/installed7c2/config7913 |
| packed source | `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解\.local\windows-workdir\public-0349b91-4d7bc2bf-116d-4c7e-8f07-9299b1dbfa2b\public-ziwei-latest.tgz` | `e2a446c65def0f09cfb23d51142c2ca9666dc0d32c91d62d4a25bc71a9af377a` | 95626B/30files；先前一次 byte audit；本轮未重读 |
| same boot logger1 | `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\logs\daemon.log.1791689059232` | `447bf1c4db2b8a51f15f71e433803e030ec84ba3124b407987e1f3bd53c02403` | 5245726B；PID51880 start 起覆盖 |
| same boot logger2 | 同上 logs `daemon.log.1791772341015` | `4794319aa2c10cab415febc45305e29e3b1c5dd13400b1dc92e4e8b6ba248456` | 5243346B；覆盖目标及原 exit |
| retained raw cache | `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\runtime\action-state.json` | `a8157f76404b26651a3be61c19acc5b4960fa9ecc021b655d8ec1d1b3ff6867c` | 当前51 completed；原前33精确序列化 prefix 关系 |

原 cache prefix 33 条、updatedAt=`2026-10-11T13:10:59.907Z`，精确重建193341 bytes/SHA `d2c43bb88abacf8a039509864dd093790893545074416940bd50decd3d683851`。原/current 均无该 dedupe，same-boot logger 两文件共完整原 start→exit，无此 action.started，唯一对应 a2a_action_failed。原 archive sourceBuild86228203 与首 shebang CRLF→LF 后原 Windows installed7c2d47ab 均闭合；六模块 normalized 与 exact0349 Git 一致。此前 audit 只是分析参照；正式 interpreter 必须独立复核上述 raw 关系、完整 source scope 和 fresh op/spec/challenge/host/actionDigest，不信任 audit 的 eligible:true。

## 有限 capture ABI 提议

`scripts/operations/r01-finite-source-capture.mjs` 导出 `writeFiniteCapture`/`recheckFiniteCapture`/`codeDigest`。draft domain=`r01-finite-native-capture-draft-v1`，不声称 E03 产品 wire 已接受。

1. 固定 descriptor：schemaVersion、hostId、producer id/code files SHA/codeDigest、私有 evidenceDirectory、静态 namespace、明确 staticReferences。禁止 descriptor 反向包含 generated capture SHA、challenge/op/specHash/observedAt。正式 spec 仅 pin 此代码、批准 namespace/证据目录/identity origin/静态 refs。
2. future controller 传入已验 request 的准确 `{operationId,specHash,challenge,databaseIdentity,freezeDigest,bindingDigest,command,kind}`；writer 自身没有 request authentication 权限。baseline 用 binding=null，phase=baseline-readonly，controllerStatus=NOT_RUN。
3. normal before-stop/after-stop/recheck 分别保留 native observation 与真实正常 controller receipt 的 path/SHA/bytes/kind/scope，write-once wx。after-stop 必须有实际 controller 文件，但只是 RECORDED_UNVERIFIED，不能由回执推导完整排空。
4. capture SHA 在签名 source manifest/envelope 中绑定，再由 observer 用同 host native namespace 和原 source bytes 独立复核。spec 不 pin 含 specHash 的 capture SHA。`retainedSourceDigest` 只指保留源字节集合；新的观察会有新时间/字节，不能冒充产品稳定 evidenceDigest。稳定原 generation/coverage 的选择和 fresh challenge/observedAt 验证属于 E03 observer。
5. writer 的 namespaceComplete/workerScopeComplete 固定 null、formalGatePassed=false、authentication=not-performed-by-producer。当前 baseline 是 R 本机保存的 SSH/native stdout 证据，无 source host 产品签名；不对 Linux 或 Windows 正式 key provisioning。等待 E03 clean ABI 后才能做源 host adapter 和 challenge-bound collect/recheck。

两份最终 baseline descriptor 和实际 wx capture `*-02.json` 已产出并 byte recheck。Linux capture SHA `33239e80bb6ec095ab7364eba669522fdb080ad92b377c3f7e2bb9e011b1d0da`；Windows capture SHA `ac706b34cb9bfa9bca76480eaa72b43636336a285bea15a75dde8db41002e29d`。精确绝对路径及全部 refs/pins 在 `.local/r01-finite-source-20261014/handoff-finite-source-checkpoint-02.json`，SHA `0ca702cba97adfd4e1fe821645049ff39f5e408b6a27d3065eb8a78980e75995`。此前 baseline pin 了 review 修复前 producer 的字节，保留但 superseded；旧尝试不能换新代码后继续当作成功 recheck。

## 当前 unknown、产品依赖和验证

- 两 host 实际 stopped capture 均 NOT_RUN；原正常 pause/drain/stop/controller provenance、再启动/残留 worker 与完整 membership 待正式窗口。
- Windows 历史 Job/assignment/breakaway/detached/raw command lineage、原 updater worker birth、PEB source HOME、shared/Creator/override/SDK/MCP 全范围均不完整。不能用原父PID消失、Job名字或现有计数补足。
- Linux 全原 OS namespace 并不完整，窄 systemd 当前 containment 不等于原全worker排空；原 service Restart/外部 updater/生成替换边界待前后捕获。InvocationID、boot_id、startTicks 各自保留实际来源。
- restore 仍需 E03 private API handler 的实际同DB/role/build/root/boot/fence、fresh challenge-bound signed proof，加独立 native listener/birth；磁盘 manifest/PID 不够。
- E02 待下一 slot 接一条 never-dispatched interpreter、明确外部 artifact allowlist、daemon local pause→stop 与保留 legacy cache 的衔接；没有绕过现有 stop409、清 cache 或重分类旧 history。E03 待修 source 每host semantic scope，使本host proof不被要求替其他host背书，并保留 aggregate global pending/uncertain gate。
- 最终同批 E02/E03产品、真实解压六产物、Q G1-G5、准确 accepted SHA/manifest、real backup/restore-read/transport/source signing 全部仍待完成。本树未 push/deploy。

仅新 ops fixture：Node capture11/11，Python native source10/10。测试覆盖 wx/output越界/producer或源字节篡改、循环 pin、producer/code嵌套动态字段、缺 controller、未认证与unknown保持、真实 InvocationID 大小写、native ticks、recursive cgroup child、不可见/新增/迁移成员、Windows root-only/zero receipt不造Job、PID复用、两个logger boot隔离及Microsoft native birth解析。只读 review 找到 producer/code 嵌套动态 pin 的确切校验缺口，已用精确白名单修复；boot第一尝试Microsoft日期解析失败亦保留，最终只用boot-02。四个 Python reader/runner syntax、Node语法、git diff --check通过；私有最终日志保存于此 checkpoint 目录。没有运行 E02 产品测试或调用正式 model/phone。

提交范围仅 R01 ops 新代码/测试、既有 readonly runner 的新 reader 分支和本页。停止在此有限 checkpoint，把第二可见执行 slot 交回总控安排 E02/Q。
