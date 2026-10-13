# R01 旧 ACK / never-dispatched 有界评估

状态：**外部 legacy assessment 候选；CODE/CACHE VERIFIED / 正式admission仍待核、未放行、未生成正式签名**。2026-10-14（北京时间）。只读核既有准确历史证据、当前原生缓存与固定旧源码；不新增正式产品接口、不迁移，不改原action的expired状态/空result，不补synthetic Job、rootPID或treeConfirmed。本轮结束后R01 checkpoint idle。

## Subject 与原证据

原action `action_8668054e-e2e9-476b-acb1-d20f561eb661`，workspace `ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e` / bigtron，device `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`，employee `employee_d64dd3bd-3a17-4568-bb8b-5c5a8ade3c26`，conversation `conv_bc178a71-0539-46a9-9a07-49e55b6b1a75`。原ACK `2026-10-11T14:26:40.455Z`、expired/completed `14:42:41.671Z`，result为空；原dedupe SHA `6be18704a2c8dc626bddc16f78aec234160d9039ee64ea819639f8be5379b223`。

可靠V1树 `C:\Users\25941\.codex\worktrees\a2a-delivery-recovery\灵光爸爸拆解` 下既有证据已经fresh核hash，不复制正文到Git：

| 原证据 | SHA256 / 核到的事实 |
| --- | --- |
| `.local/a2a-recovery/native-view-20261012/context-result.json` | `89071077023b66a9ad7597f02e02f563da58eebd0b9c23b9ff7f3449d89a263c`；原PID51880 pending1 poll `14:26:38.903Z` → 同action唯一 `a2a_action_failed` `14:26:41.906Z`，错误符合AbortSignal timeout；其后193次poll pending0直到`14:42:54.078Z`。错误窗口与队列数不单独证明未执行 |
| `.local/a2a-recovery/native-view-20261012/result.json` | `6e5dce6563e61f71109a4b963784a3b22cc535ad6ed92c315d87df1ca1359d06`；原log与cache为plain AppData final path；原state mtime `13:10:59.909518Z`早于该action创建。旧摘要按actionId found=false，不自动证明dedupe原键缺失 |
| `.local/a2a-recovery/native-view-20261012/native-snapshot.json` | `a8ffa54827ddc9c2cbb23464e10d09e6916eb3af0e9c8e4d087a81c7f6048c6c`；原51880创建`2026-10-10T10:40:39.884Z`；installed/running build `7c2d47abb3982eb31fbdd2245fe0550235efed9ec418848de901dfead8bdaf64`；config SHA7913bf…、bigtron/bfd、shared空；原state SHA `d2c43bb88abacf8a039509864dd093790893545074416940bd50decd3d683851` /193341bytes |
| `.local/a2a-recovery/server-preflight-20261012.json` | `5275cd58196a781c41705cb58a6b3d9b797681b184c130570d086befd894bbee`；原exact ACK/expired/empty-result元数据 |

R01先前有界读取的原轮转日志 `legacy-journals-04-history.json` SHA `41d82c46894238be49fac17247d66c981eb0cf1237168e7b57d955255ab8dc62` 关联原daemon51880，原start、drain、stop/exit code0与现在PID不存在；这是原daemon generation证据，不是该action的原native Job。当前12132不用于补证。

## 旧协议静态条件命题

只读 `git show 0349b919fef49471d061b63f8a23c1685d223a10:<file>`。未执行旧module或产品测试。

- `daemon/ziwei_user.mjs:233` await原ACK完成后，`:234`才dispatch；ACK reject/timeout的该次调用不会dispatch。
- `postAction`固定3000ms超时，同时用于ACK、event、result。scheduler的统一 `a2a_action_failed` 可能来自后续HTTP步骤，因此同action/3秒错误本身不能唯一定位ACK阶段。
- `src/daemon.mjs:101` 同步发 `action.started`；daemon onEvent先同步 `fs.appendFileSync` 日志且不吞错；后面才通过Promise.then调用execute。该started append失败会在安排execute之前进入catch，因此不会因该失败继续native spawn。运行后的output/stage日志失败不适用此结论。
- completed/inFlight duplicate都不会新run/execute。需要核原dedupe缓存；旧V1只保存completed、key使用原dedupe串，缺started数据库是旧协议结构，不能要求其产生不存在的Job，也不能拿字段缺失造安全证明。

精确Git blob SHA：

| 文件 | SHA256 |
| --- | --- |
| `src/management-bootstrap.mjs` | `bddce314efe7bc836d6b67f19d64aa98b8801527f2a64a173eac9982e086fb74` |
| `daemon/ziwei_user.mjs` | `7225a515885af09317d2f23976bb74f562ac3d6579eec1bd88ae0855cce35a2f` |
| `src/daemon.mjs` | `1e5ab24e166466e5036d74b4a46b44485f61e9c8fcecc6ce69f125f8a6a3ff41` |
| `src/daemon-action-scheduler.mjs` | `a2e2181e029d7e09b1b4ed82b26115013c792aaa1dfc1f19610e135e24c70a6e` |
| `src/local-action.mjs` | `88cf1bd4b32411c47eb6e277209ff453f858948ae24fc75611db2c599104fa3c` |
| `src/runtime-adapters.mjs` | `3295b1eabf47c58d47e7e3d80148909f1bf854d1f7043d68b0b4866b43c14b39` |

## 原cache与actual identity精核结果

当前原生cache按actionId（含completed.result.actionId）及原dedupe SHA未见对应entry，state完整SHA `a8157f76404b26651a3be61c19acc5b4960fa9ecc021b655d8ec1d1b3ff6867c`，读取前后未变化；这仍不是原历史state的逐字节身份。

前两次cache审计实际上处理了全部51条completed而没有截取历史前缀，未匹配193341bytes/原SHA；首次reader另有UTF8分块风险并修正。两次失败原样保留，不能把审计实现缺项解读为真实cache损坏或历史证据丢失。

总控指出prefix实现疑点后，核原snapshot reader发现status counts递归包含nested结果，不能把8 failed+43 succeeded自动当top-level历史count。修正为只尝试当前保留原序列的0..51前缀，先精确字节长度过滤，再在原mtime前1000ms/后100ms内核原完整SHA。**第三次原生审计精确匹配原33条completed、updatedAt `2026-10-11T13:10:59.907Z`、193341bytes、SHA `d2c43bb88abacf8a039509864dd093790893545074416940bd50decd3d683851`。** 原dedupe摘要在此完整历史33条及当前全部51条均不存在，matchingStarted=false；current state bytes/identity读取前后稳定。没有写回原state或返回native正文。该结论来源是完整原文件byte/hash匹配，不是计数、mtime猜测或“未找到字符串”。

独立隐藏只读代理最初按旧clientBuildIdentity固定列表+daemon/src mjs/py共26 Gitblob、默认ASCII排序、path/NUL/bytes/NUL算出 `7a28d87b044a7cf3d3cb239246066eaf830ce1078c98b24809ff4a64c6ffebcc`，全部Gitblob为LF，首shebang CRLF→LF不改变值。该失败计算保留；Git LF字节与Windows实际包CRLF字节不同，不能据此认定旧包不同或猜转换凑值。

总控随后提供准确旧archive，并授权仅一次有边界只读对照：`C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解\.local\windows-workdir\public-0349b91-4d7bc2bf-116d-4c7e-8f07-9299b1dbfa2b\public-ziwei-latest.tgz`。fresh SHA为 `e2a446c65def0f09cfb23d51142c2ca9666dc0d32c91d62d4a25bc71a9af377a` /95626bytes/30常规文件。在内存读取tar按旧rule精确算sourceBuild `86228203ecf5aeb33fbc4422b4c4268f321c113862e0443933897a277fcd614a`；只对bin首shebang CRLF→LF后算Windows installedBuild `7c2d47abb3982eb31fbdd2245fe0550235efed9ec418848de901dfead8bdaf64`，与原native snapshot吻合。6关键module实际CRLF字节normalize LF后均等于上表固定Gitblob，完整30文件manifest及实际SHA私有留证。**此次旧包→实际build→关键协议代码的identity锚点已闭合。** 未解包、执行旧模块、安装、测试或写入2884，不扩大搜索。

原source runtime/log由ZIWEI_USER_HOME决定；configPath可以独立override。plain AppData config自身不能推出runtime/log根。需把原日志canonical path/文件hash/全覆盖区间、原PID/startedAt或nonce/build、实际home/runtime根归属核为同一boot/scope。当前有历史原PID/build/config/path、精确原cache byte identity和实际source bytes；将这些来源接入正式proof时，仍须回核同一boot/scope根归属与日志完整覆盖，不能让peer自证key或借新generation。

**本轮分析结论：对这一个subject，精确旧包、原cache缺原dedupe、唯一action失败记录/无started与3秒时间线共同支持never-dispatched候选。** 正式admission仍是未接/待核状态：缺独立正式签名、operation/spec/challenge/当前冻结DB关联以及由E02/Q审核的同boot/scope日志根/覆盖验证。没有签成生产PASS、不释放bootstrap；无需补不存在的rootPID/Job或改原result，可由明确外部legacy assessment类型承接这种旧协议证明。该结论不能推广到其他39条legacy终态或全实例排空。

## 外部legacy assessment最小待接契约

这是给E02/Q的字段与验证要求，不是R新增产品接口；本轮不接正式mutation、不生成生产签名。

1. `assessmentKind=legacy-never-dispatched`、schema/评估器code digest、独立authority/keyId/算法与trust引用；签名绑定operation/specHash、产品fresh challenge与原DB freeze/action projection，不能proof自带key。
2. Subject精确origin/workspace/device/employee/conversation/action/dedupe摘要；原payload与ACK/expiry/empty-result摘要，原记录保持。不得同名员工或不同scope复用assessment。
3. 原daemon PID/创建时间/startedAt或nonce摘要、actual oldinstalled/running build、config SHA/native namespace，以及home/runtime/log canonical roots；不借新generation。
4. 原archive/pack/installation manifest和关键实际module bytes/SHA；明确旧协议ACK前置/started同步logger/duplicate路径及dispatcher cache key规则。
5. 独立原历史artifact引用(path/hash/capture)、完整覆盖时间区间、sameaction全部events、started负证据及logger完整性；原dedupe cache按实际键的可验证byte/projection身份、原scope和缺失证明。不能只依据timeout、队列0、摘要found=false或source文档标签。
6. 明确结论 `never-dispatched` 或 `unknown` 与reason codes；只对已核subject有效。未知/缺来源不默认safe；签名unknown也不能放行。E02 guard仍校验state/operation/全量其他claims/排空，不把外部assessment写成job/processExit。

Q最小用例：完整已核fixture可接受该外部证明但不改原expired/empty-result；错workspace/origin/device/dedupe或原instance拒绝；原cache已有该key/同action拒绝never-dispatched；日志缺区间/started出现/记录损坏/actual module不匹配拒绝；错artifact hash/签名/key/challenge和已有unknown拒绝。本轮只cache算法9项隔离用例通过，含历史prefix/后续同key拒绝；完整legacy assessment/Q接口用例 **NOT_RUN**，不能用fixture数字代替。

## 本轮安全交付与证据

新增 `scripts/operations/r01-legacy-assessment.mjs` 只做纯cache byte audit和有限JSON输入；`r01-legacy-cache-readonly.py` 同用户原生只读采集，固定原helper与历史snapshot hash，stdout不输出native body。9/9纯fixture、Python语法与Git差异检查在提交前核验；不运行原D/2884产品或变化writer产品测试。

私有根 `C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解\.local\r01-legacy-assessment-20261014`：

- `original-cache-byte-audit-01.json` SHA `e7c543a9ec30efb2f428a1151994dd5c6c10e751fab3f1275a681c1a96a0176f`，首次未匹配保留。
- `original-cache-byte-audit-02.json` SHA `13f31933e8a790133ecbddd4c39e0e0bdeac208b4e64a83cb91982bd609e7553`，UTF8修正后的有界复核仍拒绝；sourceStateWrites0、identity/source bytes稳定。
- `original-cache-byte-audit-03-prefix.json` SHA `7a61211c8ca424dd917eaa0ee41117b9a156862fa61d76f1e4027acca735d229`，原33条完整byte/hash匹配；无source写入。
- `cache-prefix-final.log` SHA `ebe7c23d5db824de2a780cfed7ade7b613fa9150b496201388d22f2b70369aa5`，9项；原cache-final7项、cache-red/utf8-red/prefix-red及绿日志保留。数据库/auth/HOME/log原始正文与私有产物不入Git。
- `original-archive-byte-audit-01.json` SHA `43cfebbfe785f8f7635a2c03ee1e3a5ff000afb1b1e68b31dad39f7aeba9d43d` 保存上述一次准确旧archive的30文件字节manifest、source/Windows build与6module identity；取证脚本 `r01-legacy-archive-readonly.py` 只接受准确历史包hash/size并拒绝非正规成员，不执行包。

不扩大扫描。由总控决定下一次有界只读补原pack/cache/log锚点或把此scope保持unknown；R本轮保存脱敏报告后idle，释放可见执行槽。最终Gate齐备后R仍唯一publisher，沿已有授权接续safeGitHub push/读回与实部署。
