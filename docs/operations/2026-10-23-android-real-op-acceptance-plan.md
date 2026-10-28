# Android 真实 OP 与原生验收计划（执行前置条件，未获执行授权）

日期：2026-10-23（Asia/Shanghai）。本计划状态：**blocked；本轮仅本机准备，未执行注册／enable、激活构建、安装或真实 OP／设备测试。实际 client 状态待唯一 writer fresh readback。** 本文件与 [机器证据模板](android-real-op-evidence-template.json) 是后续执行的输入，不是操作授权或成功回执。

## 固定基线与本次检查所得缺口

本次只读核对 [候选交付记录](2026-10-23-android-identity-candidate.md)、`D:/AINavtie/ops/identity/member-onboarding-20261023/android-public-client-review/REPORT.md`、同目录 `registration-guard.json`，以及当前 Android 源码。没有把这些历史材料当作 fresh OP／部署状态。

| 项目 | 固定事实与仍缺的证据 |
| --- | --- |
| 当前产品 | `07623c39f7050b0c811c01a71ad9e278ed5d0dc0`；`com.ziwei.manager`，`0.6.0-identity-candidate / code17`。 |
| 已签字节 | APK SHA-256 `ad3e3c61aa1753b9249f5007bb7c2b6a5ddedade549c0cabfdaae666fed882ba`；原证书 SHA-256 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`。这是未激活审阅包；本计划没有重验签名或签名材料。 |
| 禁用的真实影响 | `OidcRules.CONFIGURED=false`；`IdentitySession` 构造直接跳过恢复，`login()` 不打开浏览器，`bearer()` 拒绝请求。disabled client 也不能完成真实 code flow。把注册完成、签名通过或一般 `ready:true` 当成 Android 验收入口会产生循环依赖。 |
| Android 协议规则 | 固定 issuer/client/audience；初始 ID token 必须匹配 nonce，刷新 ID token 可省略 nonce，但若携带必须匹配。pending 仅在内存，300 秒、一次消费；冷进程收到旧 callback 应丢弃并要求重新登录。上述规则有离线源码／JVM 覆盖，没有真实 Android Intent 与 OP 证据。 |
| RT 响应丢失 | `bearer()` 只在 `token()` 返回后记录 accepted；OP 已轮换、响应到达前丢失时，本地可能仍持有旧 RT。传输失败不证明 OP 未消费旧 RT。需以 OP 真实策略验证允许恢复或安全重新登录，不能承诺离线重试一定恢复。 |
| 原生存储 | `IdentityStore` 使用 AndroidKeyStore AES-GCM 与 noBackupFilesDir 的 AtomicFile；JVM／浏览器 fixture 不能证明实际 Keystore、写入中断、进程恢复或备份行为。 |
| 退出 | `logout()` 先本机清空，再异步 best-effort revoke AT/RT；没有全局 OP logout 或浏览器 Cookie 清理。退出 App、撤销 token、OP 全局会话失效须分开观察。 |
| 服务端接线 | registration review 只允许 disabled 注册差异审阅；精确 Android `azp + binding.kind=human`、scope 闭包、独立 Android readiness 与真实部署字节没有本次 fresh 证据。不能只拓宽 allowed-client Set。 |
| 通知与流 | 较新源码已有 mobile-v2 初读／唤醒／超时和 WS/SSE delivery／heartbeat 重新授权；本地源码存在不等于线上已部署或撤权已生效。原生通知在投递前 resolve item，点击后还须重新 resolve。 |
| 现有测试边界 | 520 移动端、362 Java/静态 checks、16 构建 checks 和 8 项合成桥 UI 场景来自候选记录；现有 browser-native-identity fixture 拦截网络并声明 synthetic。它们不能填入本计划的真实 OP、OS 或手机通过栏。 |

这些是运行证据与 owner 决策的实际缺口，不据此声称已有实现漏洞或已修复问题。

## 执行顺序及 bootstrap 决策

每个关口须有具名责任人、明确范围、起止时间、停止／恢复条件及脱敏批准回执。职责别名见模板。Main 已确认把 QA 协议／client enable／测试构建窗口与正式 ready／发布分开，并已转身份负责人；当前只允许本机准备，具体 QA 窗口、限制机制、具名执行者与设备授权仍 **decision pending**。确认拆分不等于批准 enable、构建或安装。

**disabled 注册可独立先行。** 已通过参数 review 的唯一 writer 可按原 guard 做 fresh exact lookup、差异审阅和 create-if-absent disabled 注册；真实 client/native/OS/设备验收不能反过来成为该 disabled 创建的前置条件。QA enable 仅依赖已核注册／配置／human gate 与获批的隔离窗口及主体权限，不依赖未来真实协议或 OS 成功。真实协议证据约束后续 QA 原生构建，真实 OS／手机证据约束正式 ready／交付，不能反向阻塞用来测量它们的 QA 构建。原 guard 的“先真实 fixture，再 flip”保留为正式开放门禁；解决测试 bootstrap 的受限 enable 与新构建窗口必须另审，不能自行推定。

| 关口 | 后续允许的范围 | 进入条件、责任人与证据 |
| --- | --- | --- |
| G0：仅准备 | 本地读取资料、编写计划与空模板 | 当前授权到此为止；无 OP、网络、服务、ADB／模拟器、账号／设备动作。本次不读密码／keyfile，不修改 App。 |
| G1：隔离真实协议 fixture 窗口 | 在 canonical issuer、精确 Android public client 上，由身份 owner 主持受控真实协议 fixture | 身份 owner + Main 批准单独窗口；完成 fresh 注册／scope／后端部署差异审查、QA human 与合成资源授权。disabled client 必须先有另行审阅的临时 enable 方案；一般 Android readiness 继续 false。若 enable 对所有人全局生效，必须说明如何强制限定 QA 主体与暴露面；无法限定时仍 blocked，不能把“隔离”作为事实。禁止默换 issuer/client 来声称本客户端已验收。 |
| G2：真实协议验收 | 真实 Code+S256、token／introspection／binding 与流协议；全部只用隔离 QA 资源 | G1 回读和隔离有效；协议责任人保留脱敏结果。此层不需要也不证明系统浏览器、Android callback、Keystore 或手机行为。坏签名／错 claim 等真实 OP 不会合法签发的负例另标 protocol_fixture；不得把合成 token 称为 OP 签发。 |
| G3：授权的 QA-enabled 原生候选 | 审阅最小激活差异后，由有权构建者准备独立原生候选，再作模拟器 OS 验收 | G2 所列协议层子集通过（仅 protocol_fixture/real_op_protocol，不要求尚不可运行的 Android/OS 结果）；身份 owner + Main 显式批准解决 CONFIGURED bootstrap 的 QA 构建／enable 窗口。未来 `code18` **仅预留、未产出**，不是当前版本；若已有更高版本，须重新选递增 code。任何 CONFIGURED 变化均是不同 APK 字节／产品源哈希，重新构建、原证书签名、清单及独立审阅后才能申请安装。不得改写 code17 来源／哈希。 |
| G4：物理手机验收 | 在逐台明确授权的管理手机上按原生流程覆盖安装与验收 | 模拟器门禁及独立安装前审阅通过；用户／设备 owner 确定设备、时间、可保留的合成数据及停止方式。模拟器授权不包含手机授权。 |
| G5：推广决定 | owner/Main 另行判断是否 enable／公布 Android readiness／交付 | G2–G4 的所有必需用例有对应层级证据；当前 human 改密状态、撤权与数据保留无未决问题，独立 reviewer 签字。QA 窗口结束时按事先审阅方案 readback 状态；不能自动执行禁用一个已 live client。没有本计划隐含的正式激活或发布授权。 |

code18 的 QA-enabled 候选与将来正式交付可以另行选择相同或不同源字节，但任何配置、版本或字节变化都使既有验收失去自动继承资格，须列差异及必要复验。仅保留相同包名和原证书不代表升级数据已验证。

## QA 主体、数据和观察通道

身份 owner 提供隔离 QA-H1、QA-H2（human），QA-E1（employee/machine 负例），以及 QA-W1、QA-W2 和可撤回的成员／角色绑定；映射表由 owner 在受限环境持有。App 从服务端 current memberships 的 `workspace_id + slug` 选择工作区；不得硬编码 BigTron，也不得按 email、列表第一项、同名 workspace 或 App 自报 ID 绑定。不得复用既有 owner 的新旧密码、token、浏览器配置、备份或 keyfile。

QA fixture 只有合成历史／图像／通知事件／草稿／失败回执。真实跨 client 负例的 public client 来源与主体必须由身份 owner 另行确认在 QA 窗口范围内；不能借用 confidential web/API/CLI/worker secret，不能默认有权创建另一 client，来源未批准即 blocked。唤醒测试由 fixture 管理器写入隔离事件源，不能触发真实员工、设备、配对、任务、模型、消息或付费推理。写权限成功路径只能在经审阅的无副作用 fixture sink 验证；真实业务 API 仅允许明确批准的读取和安全拒绝用例。不得为验收创建业务配对、执行设备动作、重启业务服务或接管端口。

身份 owner 负责 OP/admin 观察、轮换／session／introspection 状态与 QA 角色变更；后端 owner 负责 native gate、实际部署源 SHA 和逐次重新授权计数；Android QA 负责系统浏览器、Intent、Keystore、进程／升级／通知 OS 行为。使用受限 harness 在**进程内部**计算等值、状态与次数并即时丢弃敏感值，输出脱敏元数据。不得收集原始 HAR、请求／响应 body、Authorization、Cookie、完整 callback URL、token／code／verifier／nonce／密码／密钥文件，亦不以其哈希代替脱敏。

## 逐案执行合同

下列 ID 与 JSON 模板一一对应。每案的证据责任人必须先填具名执行者及批准引用；观测缺失、基础设施不能注入故障或批准未到时记 blocked，不以推断填 passed。负例先在 protocol_fixture 覆盖，再对可安全复现的真实 OP／Android 路径重复；不能由真实 OP 签发的坏签名负例只能支持验证器结论。

| ID | 触发与预期条件 | 证据责任人／关口与最小脱敏证据 |
| --- | --- | --- |
| PRE-01 | owner/Main 决定是否提供受限 enable、协议 fixture 与 QA-enabled 原生窗口；明确各层先后及回收条件。决定缺失即停止。 | 身份 owner + Main；G0→G1／G3；批准引用、范围／时限、QA 限制与一般 readiness=false。 |
| PRE-02 | fresh exact client 唯一读回、disabled 注册状态、default/optional scopes、mapper/role 闭包；无 secret/SA/password/device/implicit、wildcard、offline_access 或其它站 audience。profile/email 缺失／异型先停。 | 身份 owner；G1 前；原 guard 差异审阅引用及脱敏回读。既有 client 不重建或覆盖。 |
| PRE-03 | 固定实际部署 SHA，Android 仅 human azp；保留 web/CLI/employee 及 native/stream gate，独立 Android readiness=false。 | 后端 owner；G1 前；部署来源／精确 diff／读取配置与 gate 观察。staging SHA 不代替部署。 |
| PRE-04 | QA 主体、受信 issuer/sub 绑定、workspace_id+slug、合成资源、读／拒绝／无副作用 sink、故障注入点均获授权。 | 身份 owner + 数据 owner；G1 前；QA 别名矩阵和授权范围，无实际 subject/业务内容。 |
| PRE-05 | QA 原生构建有不同源 SHA/APK SHA、递增 code（18 仅预留）、原证书、CONFIGURED 和测试限制；独立审阅才可安装。 | Android 构建者 + 独立 reviewer；G3 前；公开 manifest／签名回执／源差异和批准引用。 |
| PRE-06 | 分别批准模拟器和物理手机；安装前确认现装包、证书、versionCode、合成保留样本、UID/firstInstallTime 比较方式。 | 设备 owner + Android QA；G3／G4；脱敏设备别名与安装前清单。 |
| OP-01 | 真实 public authorization_code + S256；精确 issuer/client/redirect/scope，无 secret、旧 Cookie/password fallback 或 embedded WebView 登录。token 与 fresh introspection 的单站 aud、azp/sub 一致。 | 协议 QA + 身份 owner；G2；grant/challenge 类型、静态参数、交换次数、claim 等值布尔值及 OP 观察引用。 |
| OP-02 | Android 通过系统浏览器完成精确 custom callback；warm onNewIntent 与 activity 重建分别验收；当前进程 pending 有效才交换，一次消费。 | Android QA；G3→G4 各留记录；浏览器包／OS 版本、Intent 路径类别、交换次数，无完整 URI。 |
| NEG-01 | 错 state、300 秒边界／超时、重复消费、重复 query、fragment／authority 别名拒绝；错误回调不能替换当前会话。 | 协议 QA + Android QA；G2/G3；变体标签、拒绝阶段、token exchange 计数；可真实执行的 Android 负例另留 OS 证据。 |
| NEG-02 | 初始 ID nonce 缺失／不符拒绝；refresh ID nonce 省略可按当前规则接受、携带不符拒绝；ID/AT sub 不符拒绝。 | 协议 QA + Android QA；G2/G3；nonce presence/match、subject-match 布尔值、fixture／OP 来源区别。 |
| NEG-03 | 缺／错 verifier、plain、重复使用 code 必须被 OP 拒绝；不降级 S256、不重放业务操作。 | 协议 QA + 身份 owner；G2；OP error 类别和交换次数，无 verifier/code。 |
| NEG-04 | 错 callback iss（若携带）、错 token issuer、错站 discovery／JWKS 或重定向拒绝；不访问替代站来成功登录。 | 协议 QA + Android QA；G2/G3；检查类别／拒绝阶段／外站请求计数；坏 token 来源标 fixture。 |
| NEG-05 | AT 错／多 audience、ID 非精确 client audience 拒绝；不接受 account／其它站 aud。 | 协议 QA + 后端 owner；G2；aud 类别与拒绝，不输出 JWT。 |
| NEG-06 | Android 原生验证器拒绝错 azp/client、其它 client 的 code 或 token；签名正确不能绕过 Android client 和 human 限制。后端原 web/CLI 分支仍按原合同，不因本负例被全局拒绝。 | 协议 QA + 后端 owner；G2；获批负例 public client 类别、OP/native 验证结果及 Android human binding gate 结果。 |
| NEG-07 | authorize/token redirect 不精确、host 别名、尾斜线、fragment 拒绝；当前唯一 URI 不扩白名单。 | 协议 QA + Android QA；G2/G3；redirect 变体类别和拒绝，不记录带 code 的 URI。 |
| OP-03 | RS256/JWKS、签名、iat/exp/nbf、AT≤300s／ID≤600s 与 5s 容差按源码拒绝；fresh introspection signed/current role/scope 交集。 | 协议 QA + 后端 owner；G2；算法／时间边界标签、交集结果与 freshness，不保存 token。 |
| BIND-01 | 同一 Android azp 的 human 允许授权的只读；employee/machine binding 即使签名与 scope 合法也拒绝；email、客户端自报 user/tenant/workspace 不赋权。 | 后端 owner；G2；QA 别名、binding-kind、拒绝 gate；不改变原 employee 分支。 |
| RT-01 | 真实 RT rotation 后安全保存新记录；旧 RT 重用结果符合已审 OP 策略，当前 family 无歧义；有新 AT 也仍需当前权限。 | 身份 owner + Android QA；G2/G3；轮换序号／旧新状态类别与安全存储完成布尔值，无 token 哈希。 |
| RT-02 | 到期前后并发前台 API、原生通知与多等待请求；同一 session/epoch 只一个 refresh 在途，等待者使用最终会话；无轮换竞态和 mutation 自动重试。 | Android QA + 身份 owner；G3；并发数、refresh 同时数／成功数、epoch 关系、无副作用 sink 次数。 |
| RT-03 | 区分请求未送达的离线、OP 已提交轮换而响应丢失、已收到 tokens 后验签/JWKS/安全保存失败。前者保留可恢复记录；后两者按策略恢复或 fail closed 重新登录，无混合凭据、无限重试或业务重放。 | 身份 owner + 协议/Android QA；G2/G3；故障注入边界、OP 轮换提交观察、恢复／invalid_grant 结果。没有可信提交边界则 blocked。 |
| RT-04 | 完全断网→恢复与 OP invalid_grant 分开；断网不伪称撤销，不在本机残留已判无效会话；恢复后只读再验当前权限。 | Android QA + 身份 owner；G3/G4；网络阶段标签、存储 retained/cleared 布尔值和重新授权结果。 |
| STORE-01 | 浏览器往返前杀进程：旧 pending 不恢复、旧 callback 不换 token，重新开始登录；已登录正常杀进程重开仅从加密 RT 恢复且 handle/subject 边界不串号。 | Android QA；G3/G4；进程阶段、交换数／恢复状态、别名等值，无导出密文或秘钥。 |
| STORE-02 | AndroidKeyStore 与 AtomicFile 写前／写中／提交前后中断，仅恢复完整受认证记录或 fail closed；缺 key、损坏／截断记录要求重登。身份清理不清业务草稿；确认禁备份与 noBackup 边界。 | Android QA；G3；隔离 QA 数据 fault harness 审阅引用、边界／结果、Keystore provider 类别；无 keyfile/明文／密文导出。 |
| FENCE-01 | 登录／刷新／GET/HEAD／图片／通知在途时切账号、退出或换文档；旧 epoch 结果不能安装或显示，read 被取消，已派发 mutation 不重放。 | Android QA；G3；代际关系、取消／丢弃次数与 fixture sink 次数；不以真实业务 mutation 验收。 |
| LOGOUT-01 | App logout 立即清本机 AT/RT/pending/通知；在线 revoke 与 revoke 离线失败分别观测，重开不能复活；浏览器仍有 OP 会话时明确再次授权结果。 | Android QA + 身份 owner；G2/G3/G4；本机清理结果、revoke 结果类别、OP session 独立状态；不宣称全局退出。 |
| LOGOUT-02 | 身份 owner 在 QA OP 做另行批准的 session/global logout；旧 RT／API／流如何失效按书面策略验收，Android 再请求安全重登。 | 身份 owner + 后端/Android QA；G2/G3；失效策略、旧 AT/RT/session 结果布尔值／状态码与流关闭时间。 |
| PW-01 | disposable QA human 改密／session 失效：逐项观察此前 AT、RT、browser OP session 和 API/流；确定改密策略及最大撤权时延，不能凭“改密成功”推定全失效。 | 身份 owner；G2/G3；策略引用、前后状态类别、权限检查时延，无密码/token。 |
| PW-02 | 对用户已改密后的当前 human account，由身份 owner 在用户明确批准范围内提供当前状态的脱敏证明；是否需额外失效／重登另审。QA 结果不代替该真实账号结论，agent 不接触新旧 owner 凭据或现有会话材料，不为测试再次改密。 | 身份 owner + Main；G5 前；单独授权引用、当前状态证明和未决项；资料不足仍 blocked。 |
| AUTH-01 | 撤回 role／scope 后，即使旧 signed AT 与缓存 introspection 带读写 scope，fresh 交集及 native role gate 拒绝；scope 请求不授角色，admin 不隐含 read/write。 | 后端 owner + 身份 owner；G2；撤回先后、freshness、各 gate 结果；成功写仅无副作用 sink。 |
| AUTH-02 | 撤回 membership／binding.workspaceIds／resource 归属后，active:true 和旧 scope 不能继续读 API/图片/员工/设备；原 native IDs 不迁移、不按 email 合并。 | 后端 owner；G2/G3；撤回事件与下一次读取拒绝、稳定 ID 等值布尔值。 |
| MV2-01 | list、items 和 wait 初读分别在撤权前／后调用；每路以 current principal/membership/resource 决定。旧 cursor、旧 item 与不符 envelope 不泄漏。 | 后端 owner + 协议 QA；G2；route 模板、initial check 计数与状态码，无 item body/cursor。 |
| MV2-02 | wait 已开始后撤权，再由合成事件唤醒；必须重新鉴权后拒绝，无旧 item/新 cursor 泄漏。 | 后端 owner；G2；wait/wakeup/recheck 事件顺序、拒绝与零泄漏布尔值。 |
| MV2-03 | wait 已开始后撤权，期间不发事件，直到 timeout；仍在超时返回前重验并拒绝，不能成功空页掩盖撤权。 | 后端 owner；G2；wait/timeout/recheck 时间顺序、拒绝码。 |
| NOTIF-01 | 逐 item resolve 前撤权不投递；已投递后撤权再点击，重新 resolve 拒绝且不打开旧 target；用户主动 opt-in、账号切换／退出清 pending/通知。 | 后端 owner + Android QA；G2/G3/G4；resolve 次数、post/click 阶段、结果、OS 权限状态，无标题／内容。 |
| STREAM-01 | WS handshake、每次 delivery 与 heartbeat 分别撤权／过期；下一授权点关闭（既有合同 1008）无 payload，重连先安全刷新与重新授权。 | 后端 owner + 协议 QA；G2；每类 recheck 计数、close code、时延／泄漏计数；非手机结论。 |
| STREAM-02 | SSE 建连、每次 delivery 与 15 秒 heartbeat 分别撤权／过期；失败关闭且不发保活掩盖失权；重连 cursor 不越权。 | 后端 owner + 协议 QA；G2；recheck/close 事件、延迟／泄漏计数；无原 SSE body。 |
| ISO-01 | QA-H1→H2（含相同 workspace slug）→H1：服务端 principal/账号、本地草稿／失败回执／已读／pending/通知 cursor 不串号；原账号回来仍能恢复本人草稿。 | Android QA；G3/G4；别名顺序、各分区存在／不泄漏／恢复布尔值。 |
| ISO-02 | 同账号 QA-W1/W2 切换，以 current workspace_id+slug 配对；旧 wait/list/item/cursor／通知点击与旧 workspace 响应丢弃或拒绝，资源 membership 实时生效。 | Android QA + 后端 owner；G2/G3/G4；工作区别名、配对等值与旧代际丢弃／拒绝计数。 |
| ISO-03 | 先加载合成受保护图片再切账号／撤权／换文档；WebView 内存/HTTP/解码缓存不得显示旧图片，缓存命中也需会话边界；新账号只得到其当前有权图像。 | Android QA；G3/G4；合成图像标签、缓存阶段／访问结果，无业务截图。 |
| UPG-01 | 获授权模拟器先建立真实 code16 基线及非空合成样本，再同包/原签/递增 code 覆盖；UID/firstInstallTime 不变，草稿/置顶/历史/汇报队列/HOME/员工和设备关联/既有 pairings/失败回执保留；首次 OIDC 重新登录，旧 Cookie 不变 token。 | Android QA + 设备 owner；G3；前后比较布尔值和版本/证书/APK SHA；不卸载、清数据、整库恢复或创建新业务 pairing。 |
| UPG-02 | 模拟器通过后，逐台获授权物理手机重复 UPG-01 与系统浏览器／冷暖 Intent、用户 opt-in、前后台通知、点击、离线／进程恢复；记录 OS/厂商节电设置。手机结论仅适用于实测型号/版本。 | 设备 owner + Android QA；G4；设备别名、OS/厂商、比较结果、通知阶段与授权引用；不替用户开权限／改设置。 |
| SAFE-01 | 对所有真实运行核对仅 QA 资源、允许路由和无副作用 sink；真实设备／员工／模型／任务／消息／pairing 业务写与付费调用为零。 | 数据 owner + 独立 reviewer；G2–G4；经脱敏 route-template 计数、业务写/付费/跨账号泄漏计数。发现越界立即停窗口。 |
| PROMOTE-01 | 独立 reviewer 逐项核对必需证据 tier、来源字节、未决项与各 owner 签字；没有自动把 protocol_fixture 推成 Android 或手机通过，QA enable 不改一般 ready。 | 独立 reviewer + 身份 owner + Main；G5；有范围的结论、残留风险、单独推广决定引用。 |

API 路径沿用 `/api/workspaces/:slug/mobile/notifications-v2`、`/wait` 和 `/items/:eventId`；具体 wait 参数／envelope／scope 以获审实际部署源码为准，不能为通过 fixture 修改协议。WS/SSE 必须按当前实际 endpoint 记录 route template，不能臆造地址或复用旧 8f2d 后端准备包。

## 证据填写与完成条件

模板是待填实例及允许输出的 JSON schema。每案初值 pending/blocked、actual=null、evidenceRecords=[]，没有通过结果。具名执行者获得授权后另存每次 run；保留失败与重试历史，不覆盖失败为成功，不生成示例通过数据。历史离线回执只能作为 priorEvidenceReferences，不能填写 actual。

证据分 `protocol_fixture`、`real_op_protocol`、`android_emulator_os`、`android_physical_os`；准备审批另属 `review_metadata`，不能代替执行证据。每条观测都明确层级。真实 OP 测试不证明 OS，模拟器不证明手机，Keystore/callback/升级／后台通知须有对应 OS 记录。真实 OP 无法产生的坏签名／claim 只能填 protocol_fixture；真实 OP 负例另留拒绝观测。每个 variantResults.requiredTiers 的各层均满足才可关闭该变体；case.requiredTiers 是变体层级的并集，不要求把坏签名等合成负例伪装成真实 OP 发行。G3 构建前仅核 G2 的 protocol_fixture/real_op_protocol 子集，之后才采集 Android OS 层；无法复现写 blocked 并保留原因。

可保存：case/run ID、时间、公开 issuer/client/audience/redirect 静态参数、产品/APK/证书/部署 SHA、设备别名与 OS、QA 别名、受控变体、HTTP 状态／OP error 类别、顺序／次数／耗时、等值／隔离／数据保留布尔值、脱敏 artifact 的路径与哈希、授权／独立审阅引用。禁止 token、密码、code、verifier、nonce、Cookie、私钥/keyfile、真实 sub/email/设备序列号、完整授权/回调 URL、cursor、数据库／HOME 内容、通知/聊天/业务正文，禁止把它们的哈希作为证据输出。截图仅可用隔离合成画面且遮蔽登录标识与 URL；原始网络包／原始 OP/admin dump 不进入普通证据包。

正式验收前必须关闭 bootstrap/注册/部署/QA 身份和数据授权/新构建/安装授权阻塞，冻结准确候选字节；完成分层用例与独立审查。遇到失败，停止相关后续层，按预先批准的 QA 窗口恢复方案交 owner 处理；不自行回滚生产、禁用未知 live client、重置账号、清 App 数据或降级安装。任何新实现或字节变化均须另行审阅并决定重验范围。

本次交付仅有本计划和空证据模板；当前 code17、CONFIGURED=false、disabled 注册审阅结论和一般 readiness 均未因此改变。
