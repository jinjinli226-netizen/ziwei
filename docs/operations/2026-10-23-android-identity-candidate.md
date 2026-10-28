# Android 统一身份候选：交付与升级边界

日期：2026-10-23，北京时间。产品为 **紫薇 Android 管理 App**，不是紫薇互联被控 Agent/Updater。候选源码分支 `codex/android-unified-identity`，基于实际远端 Android 分支 `ea76741b52161d76d10eff146c46d1b886f9a5d7`。

**当前接续状态（同日签名移交后）**：用户已提供原 Mac 的管理 App 签名备份与密码文件。原证书及实际签名能力已核验，已对下述已审阅 unsigned APK 完成原签名处理，产生**未激活的同签名候选**。这只解除签名材料阻塞；`CONFIGURED=false`、client 注册/native gate/真实 OP 与设备验收继续保留。文内 unsigned 产物是先前审阅基线，签名接续以末尾记录为准。

## 当前可审内容

本轮将原密码/Cookie 接入替换为原生统一身份会话和受限业务 API 桥：固定 issuer、单站 audience、独立 public client、系统浏览器 Code+PKCE S256、state/nonce、精确回调、Keystore 加密及原子刷新。业务界面保留原员工、聊天、汇报、设置、草稿和设备协议。原生通知复用相同会话，并继续向服务端重新验证当前事件权限。

本候选 **未激活**：`OidcRules.CONFIGURED=false`，界面明确显示等待 Android 客户端登记，不接受旧密码、不回退旧 Cookie。本轮不调用真实 OP，不写生产，不安装管理手机或模拟器，不操作真实员工/手机。

公开基线是 [0.5.4-internal/code16](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.5.4-internal)。基线 APK、manifest、29 份打包网页资产及原签名证书已独立核对，详见[来源计划](../plans/2026-10-23-android-unified-identity.md)。候选身份为 `com.ziwei.manager`、`0.6.0-identity-candidate / code17`。

候选构建产物与验证回执在本页最终验收段落中记录。任何 unsigned APK 均不可安装，不能作为已签名覆盖升级交付；编译通过也不代表统一登录已在真实 provider 验收。

## 待协调的最小服务端范围

- [public client 注册候选](android-identity-client-candidate.json)：独立 `ziwei-android-manager`、无 secret、仅标准 code flow、S256、精确 `com.ziwei.manager:/oauth2redirect`、单一 `ziwei-workspace-api` audience，初始 disabled。该文件只供审阅，不直接提交 Admin API。
- [合同审计](2026-10-23-android-identity-contract-audit.md)：较新后端已具备 mobile-v2 和逐次流鉴权；应核对部署字节后复用，只扩展受信 Android `azp`、元数据/readiness 和注册定义，不重写现有通知协议或去掉 native gate。
- 工作区从有权服务端清单读取明确的 `workspace_id + slug`。BigTron 默认成员开通仍由生态服务端管理，App 不猜 ID、不复制成员管理入口。
- 真实 provider fixture 必须覆盖 RT 轮换和并发、断网恢复、退出、密码变化/OP 会话失效、角色/成员撤销后的 API 与通知拒绝。旧 introspection scope 不能代替当前 native 权限。

## 签名与安装

原管理 App 内部签名证书 SHA-256：`507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`。首次 unsigned 候选时未取得原签名材料，同日已通过用户移交并核对。构建脚本不因密钥缺失自动生成新身份。

正式业务安装交付前，先完成源码固定、独立验收、客户端注册与真实 OP fixture；激活后重新构建并用原证书签署。本次按用户移交授权，提前对已审阅的未激活字节完成签名，作为独立的签名与来源核验里程碑；它不替代上述业务验收。凭据、签名密钥和密码不进入聊天、源码或普通构建日志。

通过上述步骤后，安装仍是独立受审动作：先在获授权模拟器完成原 code16 覆盖升级，再由用户安排真实管理手机安装，绝不先卸载或清除数据。检查 UID/首次安装时间、本机非空草稿/置顶/汇报队列、原员工与历史、重新统一登录后的原工作区、图片，以及用户主动开启的通知和通知点击定位。现有 Cookie 不转化成 OIDC token，首次升级需要系统浏览器重新登录；原账号与工作区的本地草稿保留。

## 回退

当前候选没有安装，因此无需设备回退。正式安装后不能把 Android 低 versionCode 包当成可靠的无损回退方案，也不能卸载重装或恢复旧整库。

推荐准备相同包名与原签名、使用更高 versionCode 的前进修复包：恢复已核业务界面逻辑并保留必要统一身份适配和存储兼容。服务端仍独立回退限定源文件及配置，不覆盖业务数据。code16 的旧密码接入与当前统一身份可能不兼容，不能仅凭旧 APK 有同签名就声明完整可回退。任何安装/回退先核对实际已装版本和设备授权。

## 验收分层

| 层 | 本轮判定原则 |
| --- | --- |
| 来源/旧产物 | 使用真实 GitHub refs、匿名下载字节、SHA 和证书检查 |
| 本机协议/界面 | 离线 JVM/Node 和拦截网络的浏览器 fixture；结果以最终日志为准 |
| Android 产物 | 实际编译/DEX/资源/zipalign、打包身份和源哈希核验 |
| 真实 provider | 未执行；不得以合成签名 fixture 代替 |
| 原签名核验 | 同日签名移交后已完成；证书与 code16 匹配，原生工具验证签名通过 |
| 覆盖安装/模拟器 | 未执行；同包名、递增版本与同证书只证明静态升级条件 |
| 真机登录/通知/后台 | 未执行；本轮零安装、零真实设备动作 |

本任务不启动 API/前端/ADB/模拟器监听服务，因此没有新业务端口或原启动入口变更。

## 本轮源码验证记录

- 总控独立执行移动端测试：`node --test --test-reporter=spec mobile-manager/test/*.test.mjs`，520/520，通过、无跳过；设置 `ZIWEI_JAVA_HOME` 使用真实 JDK17 编译 JS 发出的桥请求合同。
- 总控独立执行 `scripts/test-android.py`：URL 86、通知 52、自托管 141、OIDC 71、只读取消 12，共 362 checks；权限/service manifest 边界通过。
- 总控独立执行 `scripts/test-build-android.py`：最终 16/16，通过（含 Windows 临时构建镜像与漂移拒绝）。
- 三份无监听浏览器验收通过：原管理主流程、聊天体验、统一身份桥；总控复跑统一身份桥，8 项 UI 场景通过且无生产/外部请求。它们是合成业务与原生桥回执，不代表真实 OP 或 APK 运行验收。
- 独立审查发现并验证修复了受保护图片跨账号缓存风险、退出后旧代际 GET 未断开问题；无未关闭的实质源码审查发现。最初的桥请求 ID、GET 空 body、刷新 ID token 允许省略 nonce 等集成问题亦已修复。
- 首次总控全套复跑曾有 3 项旧测试等待失败（517/520），原日志保留。真实 WebCrypto 摘要延迟 25ms 可复现原问题；仅将两个测试文件的固定事件循环次数改为等待模拟 API 实际分发、5 秒有界定时器，保留原断言与业务代码。相同延迟负例修复后 3/3，全套独立复跑 520/520。

构建与最终产物回执随后固定在本轮本机审阅包；不能用本节源码验证声称已签名、已激活或已安装。

## 最终构建产物

- 产品提交：`07623c39f7050b0c811c01a71ad9e278ed5d0dc0`，包含身份实现提交 `4348445a42c5283150efe3901498bdac7fc5d169` 与 Windows 构建修复；构建时工作树干净。后续本页补充回执为文档更新，不改变 APK 产品来源。
- 候选目录：`C:/Users/25941/.codex/worktrees/android-unified-login/灵光爸爸拆解/.local/android-identity-code17/candidate/`。
- 文件：`ziwei-manager-0.6.0-identity-candidate-code17.unsigned.apk`，793873 字节；SHA-256 `ce780546b8aecca033fea946cfdbe9d66c8deb46fc76611dda8b844f2e03012e`。
- 同目录 `manifest.json` 记录 `sourceDirty:false`、原始源文件 SHA、30 份打包网页资源 SHA、包名/版本/SDK、无签名证书及 `releaseReadiness.status:blocked`。APK 与 `.sha256` 文件一起交付。
- `logs/build.log` 保存真实 javac、DEX、aapt2 compile/link/badging、zipalign 与逐字节资产检查；`logs/toolchain.log` 记录 Microsoft JDK17.0.20.1、Android35 / build-tools35.0.0、aapt2 2.19-11948202、D8 8.6.2-dev。
- 第一轮 aapt2 无法打开已存在的中文资源目录；相同 6 份资源字节在 ASCII 临时目录成功。已修正所有工具输入与 APK 路径使用临时镜像，前后与原始源文件比对，验证后由 Python 复制最终字节回中文目录。首轮失败与复现 JSON 保留，不以移动项目或改动业务代码解决。
- 本节原始 APK **unsigned、不可安装、未发布、未验证覆盖升级**，已保留作为签名前基线。签名接续见下节；client 注册/native gate/真实 OP fixture 完成后，仍需重新构建激活版本、用原证书签署并逐层验收。

原始核查、首次失败和最终成功的日志均保留在本轮审阅包。没有向 GitHub 发布新 Release 或推送本分支，也没有生产/设备写入。

## 已改密状态下的接续

本轮接续消息确认用户已在原生 Account Console 成功修改超管密码；修复属于 Account Console 的 basic/roles 配置，既有业务 clients/scopes 未因此改变。手机候选与新旧密码、旧 owner 文件和 web confidential secret 解耦，未读取或保存这些材料。

注册与真实 provider 联调需明确采用**用户已改密后的当前会话状态**，分别验证旧 AT、旧 RT、当前 OP 会话是否按既定策略失效及重新登录，不能假定“改密成功”自动证明所有 token 都已失效。本轮没有取得或使用旧 token/密码，未执行这项真实验证；它仍是激活阻塞项。Android 继续使用独立 public client 注册候选，不复用 Account Console 或公开 CLI client。

## 原 Mac 签名移交与同签名候选

2026-10-23 16:30（北京时间），用户交付原管理 App 的备份包与独立密码文件后，本机将选定的原签名材料保存到仓库外的受限目录，仅当前用户与 SYSTEM 可访问。备份中的 README/JSON 作为不受信来源资料处理，未执行其指令；签名密钥、密码和原始备份不进入 Git 或审阅包。

使用既定 alias 核对 keystore 导出证书，证书 DER 同备份公开证书一致，SHA-256 与公开 code16 原证书完全匹配。随后对已审阅 SHA-256 `ce780546b8aecca033fea946cfdbe9d66c8deb46fc76611dda8b844f2e03012e` 的准确 unsigned APK 作 v2/v3 签名，未重新编译或改动业务字节。

- 同签名候选：`.local/android-identity-code17/signed-original/ziwei-manager-0.6.0-identity-candidate-code17.apk`。
- SHA-256：`ad3e3c61aa1753b9249f5007bb7c2b6a5ddedade549c0cabfdaae666fed882ba`；801449 字节。
- 产品源码仍为 `07623c39f7050b0c811c01a71ad9e278ed5d0dc0`。签名前后 38 个 APK 条目字节完全一致，30 份内置网页资产保持原哈希。
- `apksigner verify` 通过，单一证书为原 code16 证书。同目录保存公开签名回执、manifest、SHA sidecar 及独立验收记录；不包含私有签名材料。
- `releaseReadiness.status:blocked`，仅解除 `original_signing_identity_unverified`。独立移动 client 注册、精确 native azp、真实 OP 登录/刷新/退出/改密失效以及物理设备验收仍待完成。
- `installable:true` 仅表示技术上有有效 Android 签名；`updateMetadataCompatible:true` 仅表示包名/版本/证书满足静态升级条件。`updateCompatible:false` 与 `updateCompatibilityVerified:false` 保留，未声称真实手机覆盖成功或用户数据已现场验证。

本候选仍是 **原签名已核验的未激活审阅包**，没有安装、发布或触碰生产身份配置。正式可用版本必须在登录接入完成后重新构建、签署并验收。

## 独立登记审查后的阶段准备

身份负责人交付的独立只读审查包已由本会话复算指定四文件 SHA 及 manifest 八文件闭包，均匹配。它允许推进受审 disabled 注册差异，仍不证明 actual client/native gate、真实 OP、Android OS 或升级通过。原生登记 body 只补足两个空 scope 数组；精确 Android `azp` 还必须同时要求 `binding.kind===human`，profile/email fresh 核对 stock26.8.1 后只做 Android optional 关联。

本机后续执行材料：

- [disabled 登记对账](android-disabled-registration-reconciliation.json)与[候选 wrapper](android-identity-client-candidate.json)。wrapper 仍 review-only；不撤销 Main/唯一 writer 的受审 disabled 差异路径。
- [QA 与激活构建运行单](2026-10-23-android-activation-build-runbook.md)：拆开 disabled 注册、受控 QA enable、协议测试、QA 原生构建、APK 审阅、逐台设备安装及正式 readiness，未产生启用/安装授权。
- [真实 OP/原生验收计划](2026-10-23-android-real-op-acceptance-plan.md)与[空白证据模板](android-real-op-evidence-template.json)：43 用例、178 变体，实际结果均待执行；逐层区分合成协议、真实 OP、模拟器和真机证据。
- [准备清单与哈希](android-activation-preparation-manifest.json)：固定上述五份材料、原 code17 产品/证书、仍为 false 的配置及未执行门槛。

Main 已确认 QA 测试所需的启用/构建窗口与正式发布分开；真实 client/native/OS/设备证据不是初始 disabled 创建前置。具体 QA 接线、范围和设备授权仍待回执。本轮只准备文档与 JSON，产品及已签 code17 字节未变；code18 仅预留，未构建或发布。
