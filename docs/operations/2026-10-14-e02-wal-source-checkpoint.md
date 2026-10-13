# WAL 来源检查点：未知旧尾拒绝

状态：拒绝边界已闭合；正常 SDK reset 旧尾的独立历史来源尚未接入，因此 native 四阶段尚未签收。70c0df6 和其 `.local/preservation-native-state-final` 包已标 NOT_ACCEPTED。不得把这些包部署或视为 Q01 通过。

当前规则验证主 DB/WAL/journal/SHM 文件类型、非链接身份、hash与稳定性；完整 current WAL header/逐帧 checksum/salt、SHM 双 header/native checksum/mxFrame/最后 commit checksum/nPage/backfill，再由私有 SQLite 副本读取实际 metadata/claims。源 DB/WAL/SHM不交给SQLite、不清理、不 checkpoint、不切 journal mode。

若 physical WAL 有 SHM mxFrame 之后的旧尾，当前严格返回 NATIVE_WAL_UNPROVEN。双header/盐差/代次 counter/“不延续当前checksum”都不是旧段首的独立来源证明。private fixture已复现 salt-only、以及 salt+首 stored checksum（后段按该错误seed连续）可以把新增 committed pending伪装成旧段；现在均拒绝，原字节保留。

6766b3f 实际 SDK 四阶段失败证据保留在本树 `.local/preservation-rehearsal/1791912450705`：owned state.db 有85 physical帧，current valid/index mxFrame50，51属于旧第1代、52–85属于旧第3代。这是合法SDK复用的样本；不能为了演练通过将其猜成safe，也不能清原尾。该样本不构成“有待执行”的业务结论，只说明本候选缺少旧generation来源，必须拒切。

最小未来接受接口应是 source-bound prior-generation archive/witness，而不是 JSON safe 标志。它必须满足：

1. 在旧前缀仍完整时，独立源 observer 读取真实原 DB identity、完整 WAL generation与index，验证完整current链后形成原始每帧SHA（包含24-byte header和page）、物理index/offset、header/salt/pageSize/counter与indexDigest；只记录来源metadata，不上送正文。
2. witness绑定原 action/full execution binding、helper阶段/nonce、actual监督root/树、canonical HOME/marker/ownership、workspace/device/nativeSDK fingerprint，并由父侧持久原回执/原来源审计固定digest；不能在首次看见可疑旧尾后补签来源。
3. collector只按同DB identity、同generation/header、同位置逐帧SHA精确匹配既有来源；原driver/Gateway/claim/结果/退出树仍另行闭环。见证证明字节来源，不证明业务完成。
4. 缺原来源、未覆盖SDK连接/旁路、索引损坏、callback/observer采样不稳、错scope/offset/nonce、原receipt不匹配，均继续unknown。只能由已验签并绑定原scope的source collector代码传可信resolver；用户spec/peer字段不提供函数或任意history。

源收集不能在已有SQLite连接的同一Python进程普通open/read/close主DB或SHM；这会破坏POSIX advisory locks。应由独立reader/父侧观测，且不能修改已装SDK或源auth。仅包commit不完整；实际SDK有SQL COMMIT、executescript、context exit、cursor finalize、close及后台连接。未观测的generation仍拒绝，不能声称全覆盖。

最小冻结批次只承诺拒绝未知旧尾、读取有完整current链且无未知尾的真实claims。若未来需要承诺正常SDK reset旧尾可切换，必须另外实现原来源producer并让Q01验收，不能把本检查点的拒绝测试当作正常SDK四阶段PASS。

native fail-closed与同事务hook联合31/31 PASS；历史950全量结果对应此前工作点，当前新拒绝策略还需最终全量/准确同批解压包回归。正式production adapter/sourceCLI由E03独立实施；同事务hook检查点为57a4ee7，最终由E02组合源码/包，Q01独验，R01唯一正式发布。
