# Android 登记后联调与激活构建运行单

日期：2026-10-23（Asia/Shanghai）。状态：**准备完成待审，当前仍阻塞激活**。本文件不执行注册、启用、服务器访问、构建、安装或设备动作。

## 固定入口与已证明事实

- 当前产品：`07623c39f7050b0c811c01a71ad9e278ed5d0dc0`，`com.ziwei.manager`，`0.6.0-identity-candidate / code17`。
- 准确签名 APK SHA-256：`ad3e3c61aa1753b9249f5007bb7c2b6a5ddedade549c0cabfdaae666fed882ba`。原内部证书：`507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`。同签名和 27 项静态验收已通过；系统登录、Keystore 现场行为、覆盖升级与用户数据保留仍未验收。
- 源码和原签名 code17 均保留 `CONFIGURED=false`；App 不会因服务端 disabled 注册完成而自动可用。此前签名材料存放在仓库外受限目录，不向其他会话或本运行单交付。
- 身份负责人独立报告：`D:/AINavtie/ops/identity/member-onboarding-20261023/android-public-client-review/REPORT.md`，结论仅为 `disabled_registration_candidate_review_passed_activation_blocked`。四个指定 SHA 及 manifest 内八文件闭包已由本手机会话复算匹配，未执行其中脚本。
- 复算与对账：[登记差异对账](android-disabled-registration-reconciliation.json)、本机 `.local/android-identity-code17/activation-preparation/review-intake-receipt.json`。后者是本地读取证据，不是生产注册回执。

## 执行与验收分工

| 负责方 | 本阶段职责 |
| --- | --- |
| 主生态总控 | 串行窗口协调，确认测试与启用范围，保持 Main native 优先，不把手机工作挤入开户发布窗口 |
| 身份规范负责人 | 精确 public client、scope 闭包、Android human gate 及隔离 QA 授权方案独立复核 |
| 唯一 186 写方 | 实际现网 source-hash、native/stream 字节回读，受审 disabled 注册与限定增量、状态回读及脱敏回执 |
| 手机实现执行者 | 接受安全回执后，在手机工作树完成单独审阅的 QA/激活改动与本机构建，不 SSH/代替生产写方 |
| 独立验收者 | 分别复算源码、APK、真实 OP/native 证据与升级证据，不能由实现成功自证业务通过 |
| 人类设备持有者 | 明确授权具体模拟器/管理手机、安装动作及可用时间；未授权时不安装或调用设备业务 |

## 阶段 A：只读现网和 disabled 登记回执

**disabled 初始登记可以依据已通过的独立差异审阅先行。下列真实 OP、native 现场、QA 构建和设备证据不构成 disabled 创建的前置；它们约束后续测试启用、正式 readiness 和发布。** 本阶段列出的后端接线与读取材料可以由相应负责人并行准备，不能把验收依赖反向套到初始登记。

由身份负责人/写方提供以下**实际结果**，本手机会话不使用旧 owner 文件、新旧 owner 密码或 confidential secret 自行取得：

1. 现网 workspace 的准确 source/hash 清单及 readiness 来源，指出待叠加的最小文件。保留当前 native member、mobile-v2、SSE/WS 每次 delivery/heartbeat 授权。`65dbaec5...` 是较新 staging，`6ceffb2...` 是已有来源，均不代替 fresh 现网字节；禁止退回 `8f2d...`。
2. Fresh exact client GET 查重、完整定义/默认与 optional scopes/直接 mappers/直接 role-scope mappings 的私有快照及脱敏摘要。只在不存在时创建 disabled；结果未知先回读，不能盲重 POST。已存在或漂移先审差异。
3. 原生 body 采用已审 `client.create-disabled.json`：独立 public code flow、S256、精确唯一 `com.ziwei.manager:/oauth2redirect`、初始 `defaultClientScopes:[]` / `optionalClientScopes:[]`，不依赖 realm defaults。
4. Fresh exact 核对 `ziwei-workspace-audience`、`workspace:read`、`workspace:write` 及 stock 26.8.1 `profile`/`email` 的完整定义与 mapper/role 闭包。仅关联 Android：audience/sub 为 default；read/write/profile/email 为 optional。缺失/异型单独最小创建审阅，原 client 继续 disabled；不修改共享 scope 或 realm defaults，不关联 offline_access/account/其它站 audience。
5. 服务端明确同时检查 `azp=ziwei-android-manager` 和 **`binding.kind===human`**，并有 Android+human 允许、Android+employee/machine 拒绝的独立证据。不能仅扩大通用 allowed-client 集合。保留 web/CLI/employee 原路径、签名/fresh introspection 交集及当前 native 资源权限。
6. 单独 Android clientId、固定回调与 readiness 元数据，不借已有 web `ready:true`。disabled 注册成功、API 健康或源代码已部署都不能把 Android readiness 设为通过。

登记阶段不创建或合并用户，不授予用户角色，不消费邀请，不猜测 BigTron。人类 QA 主体/原生成员与资源授权是另一个受审前置项，未获批或尚不存在时仍阻塞。

## 阶段 B：消除真实联调的启用依赖循环

处于 disabled 状态的 client 无法完成真实 code flow，`CONFIGURED=false` 又阻止 App 发起浏览器登录和 bearer 请求；实际现网 client 状态仍等唯一写方 fresh readback，不由本机候选推断。需要身份负责人和主生态**明确区分**以下授权，本运行单不自行解决或放开：

- 隔离 QA 所需的 client 启用窗口、限定人类 QA binding/资源/角色及恢复条件；这不等于普通用户开放或正式 Android readiness。
- 先开展的真实协议 fixture（注册、精确 native human gate 和受控测试条件已满足）；它证明真实 OP/API 合同，不证明 Android OS 行为。
- 可执行真实系统浏览器回调、Keystore 和后台行为的 QA-enabled 原生构建授权，以及具体测试模拟器/手机授权。
- 完成实际原生/撤权/升级验收后才可提升的正式发布/readiness。

在收到明确阶段授权与回执前，手机源、已签 code17、client 登记候选都保持现状。测试主体不得借用旧 owner 会话，也不能把公开 CLI/Account Console client 当成手机 client。

主生态已在本轮协调回复中确认上述分阶段边界，并已转身份负责人处理；具体 QA 接线/窗口/设备授权仍待交付。本机不把这项确认解释成 client、App 或正式 readiness 的启用授权。

## 阶段 C：受审 QA 原生构建

仅在前置回执通过并获限定 QA 构建授权后，由实现者准备差异；本阶段当前**尚未发生**。

1. 将回执准确 SHA、当前 client/readiness/后端 source-hash 及授权范围写入构建记录；校验 issuer、API、唯一 audience、client、redirect 均与独立报告一致。
2. 新构建的版本暂预留 `0.6.0-identity-qa / code18`。实际 versionCode 必须再核 GitHub 当前发布和获授权目标已装版本，保证递增；“预留”不代表已构建或已发布。
3. 在合适隔离树中只准备受审 QA 开关/必要兼容差异和版本。不开启旧密码/Cookie 回退，不改变用户/工作区/员工/设备协议，不嵌入任何 secret。由另一人复核改动与阶段授权，再固定新产品提交；不能把当前 code17 SHA 当新包 SHA。
4. 按实际改动运行移动 520 套、原生规则、构建回归及登录桥浏览器 fixture，并做独立代码验收；既有通过结果仅属于原 code17。实际工具版本沿现有 JDK17/Android35 构建记录，无需为此次准备启动服务或端口。
5. 使用原生构建脚本显式指定新版本、原证书预期 SHA 和本机受控签名通道。密码只从受限文件读取，参数/日志不含密码值；不导出密钥到项目或审阅包。
6. 独立复核签名、包名/版本/SDK/权限、源码/资源 SHA、zipalign、sourceRevision/sourceDirty 与受审新字节。先产本地 QA 候选，不自动发布 Release、不自动安装任何设备。

原签名只解除签名身份阻塞，不解除协议、原生 OS、授权设备或实际升级门槛。

## 阶段 D：真实 OP、原生 OS 和升级验收

具体用例、最小证据及状态见[真实 OP 验收计划](2026-10-23-android-real-op-acceptance-plan.md)和[待填证据模板](android-real-op-evidence-template.json)。所有模板结果初始 pending/blocked；没有真正执行的项目不写 pass。

- 真实 OP fixture：受控人类 QA 主体的系统浏览器 code/PKCE，精确 callback/state/nonce/issuer/aud/client 验证及负例；刷新轮换、并发/响应丢失、断网恢复、退出和已改密后的旧 AT/RT/OP 会话实际行为。
- 当前 native 权限：已签及 introspection scope 仍旧时，撤销 role/member/binding/资源后必须由实时 native gate 拒绝。API、mobile-v2 初读/唤醒/超时、通知 item/click、WS/SSE delivery/heartbeat 分开记录，不把一次 list 成功扩展成整条链通过。
- 实际 Android：系统浏览器与 URI 回调、旋转/进程死亡/Keystore/原子 RT 保存、读取消、后台连接与恢复、用户通知权限、账号/工作区和受保护图像隔离，均须有 OS 场景结果；普通 Chromium 模拟不能替代。
- 精确升级目标：先由人类授权具体模拟器，再实际 code16（如有 code17 也据实记录）覆盖 QA 新包；保存目标标识的脱敏证明、已装/新包版本和 signer、UID/firstInstallTime、本机非空草稿/置顶/汇报队列及原数据只读核验。真实管理手机另授权、另验收，不卸载/清数据。
- 保留员工/Profile/HOME/原聊天及失败/未知回执、电脑配对和手机连接，不运行付费模型、不派真实手机业务、不为验收重启/清理设备或覆盖数据库。

将来若获授权测试需要启动模拟器、ADB 或调试监听，先按当前电脑 `port-manager` 规则核对归属、实际占用与项目持久化诊断日志；登记本身不提供启动授权。本次准备没有启动这些进程或变更端口。该流程不需要模型下载；将来任何 AI 权重、下载/安装缓存或新增推理环境均遵循用户最新 D 盘存储要求。

真实 provider、QA 资源操作、模拟器安装和真机安装各自需要已明确的范围，不能互相推导授权。普通安装签名校验通过仍不是数据保留或实际登录成功。

## 阶段 E：正式交付或保持阻塞

只在完整回执与独立验收通过、阶段授权允许后，协调正式 readiness/发布和指定设备安装。若 QA 字节需改动，产生更高版本并重新走受影响验收；不能用同一个产品 SHA 描述新字节。

正式交付条件未满足时保留已签 code17、原回执和明确失败原因，Android 正式 readiness 继续不通过；客户端状态以实际已批准的阶段和 QA 窗口恢复策略为准，只由唯一写方按受审计划处理。本机 review 不擅自禁用已启用/已在线 client，也不以某项尚待验收为由回滚别人的 client。前进修复包保留包名与原签名；不以卸载、恢复旧库或回退旧密码来解阻。当前手机会话不执行生产切换或主生态窗口中的账号动作。
