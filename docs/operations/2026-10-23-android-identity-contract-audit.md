# Android 统一身份合同与后端依赖审计

日期：2026-10-23。只读核对本机源码和已有脱敏回执；没有访问服务器、154、真实账号、设备或付费模型，没有执行注册、部署、账号清理或发送消息。此报告不把有时间戳回执视为实时服务器状态。

## 来源与证据优先级

| 来源 | 精确位置 / 提交 | 边界 |
| --- | --- | --- |
| 原根目录 | `D:/灵光爸爸拆解`，历史 `f88d6f8678face7ea3d414674e4e76707d7fc376` | 有原用户修改；本轮不改、不 reset/clean。 |
| 旧身份候选 | `C:/Users/25941/.codex/worktrees/workspace-cli-contract-v1/灵光爸爸拆解`，`8f2d6f100b822566c473ef956e9d077759bb3475` | 本次检查为干净树；准备期实现，不能据此推断当前生产不支持 mobile-v2。 |
| 当前 Android 候选编辑树 | `C:/Users/25941/.codex/worktrees/android-unified-login/灵光爸爸拆解`，初始 detached `ea76741b52161d76d10eff146c46d1b886f9a5d7` | `com.ziwei.manager` 独立产品；共享编辑树由本轮各实现者协作，不切分支、不提交其他人的半成品。 |
| 较新的完整身份源码 | `D:/AINavtie/ops/full-sso-cutover-20261022/workspace-team/workspace`，`6ceffb2cf0f9ec4ece477bc7c16e2bed94909607` | 已有统一移动通知及逐次实时流鉴权。 |
| 已有运行回执 | `D:/AINavtie/ops/full-sso-cutover-20261022/workspace-team/workspace-team-native-cutover-final-handoff.json:15` | 记录原生 source base `5acada2a529ec1885e2cce9812bc402542b5e58a`、bridge `6ceffb2...`；68–69 行明确真人 browser/CLI 完整登录仍未验。 |
| 后续原生成员准备 | `D:/AINavtie/ops/full-sso-cutover-20261022/workspace-team/native-member-adapter-staging-20261023/isolated-source-receipt.json:7` | 基于已部署角色修复 `a6e4c4cb355845f2d5ead276e4f52ad298da6da8`，候选 `65dbaec542df773117a11bab9811a7f7ee46630d`；staging/default off，不代表成员开通已上线。 |

适用仓库规则来自身份候选根 `AGENTS.md`、`AI_HANDOFF.md`、`docs/FEATURE_MAP.md` 及 `docs/handoffs/2026-10-20-release-map.md`。版本地图的 Android code15 来源是历史快照，不能覆盖本轮已独立下载校验的 code16。新 Android 树没有根 `AGENTS.md`，仍遵循本会话提供的规则和已核项目保护边界。

共同合同是 `D:/AINavtie/ops/identity/CONTRACT.md`、同目录 `contract.json` 和 **`D:/AINavtie/CLI-STANDARD.md`**。`D:/AINavtie/ops/identity/CLI-STANDARD.md` 不存在。共同目录不是 Git 仓库，不能为其编造 commit。

## 固定身份与现有原生验证

共同合同 `CONTRACT.md:11–19,25–31` 和 `contract.json:112–132` 指定：

- issuer：`https://auth.qzelynth.top/realms/ziwei`；业务 origin：`https://ziwei.qzelynth.top`；API audience/introspector：`ziwei-workspace-api`。
- 当前已定义网页客户端 `ziwei-workspace-web` 与公共设备 CLI `ziwei-workspace-cli`；合同没有定义 Android 公共客户端。Android 不能复用 confidential web/API secret，不能冒用 CLI 或 worker 身份。
- RS256、AT payload `typ:Bearer`、精确单站 audience、允许的 `azp`、`iss/sub/iat/exp`，AT 最长 300 秒，容差 5 秒。每次服务端 confidential introspection 必须 fail closed。
- 有效权限是签名 AT 的本站 roles/scopes 与当前 introspection roles/scopes 交集，再交原生当前成员、员工、设备与资源权限。`access` 必需；读需 `read + workspace:read`；写需 `write + workspace:write`；管理需 `admin + workspace:write + 原生 Owner/Admin`。admin 不隐含其它角色，scope 请求不授予权限。
- 人类稳定身份是 `(issuer, subject)`，保留原 native user/member/workspace/resource IDs；不按邮箱自动合并，不让客户端自报账号/员工获得身份。

较新 `source-workspace/backend/identity/verifier.mjs:69,174–179` 仍只允许 `ziwei-workspace-web/cli` 或显式注册 worker；即使 Android token 的签名/audience 正确，新的 Android `azp` 也会被拒绝。`backend/identity/index.mjs:55–69` 当前公开配置只暴露 web/CLI，没有 Android readiness/redirect 元数据。

`backend/identity/index.mjs:32–46` 接收 Bearer 或服务端 BFF Cookie，再统一 `authorizeToken`/native 校验；Bearer 不依赖 WebView Cookie。`routes.mjs:99–119` 保留旧密码/注册/令牌禁用。Android 不得因新 client 未完成接入而退回旧密码。

## mobile-v2 与 WS/SSE：历史合同必须区分

旧候选 `8f2d6f1/backend/identity/routes.mjs:133–157` 返回 `UNIFIED_STREAM_DISABLED`，`backend/app.mjs:1063` 拒绝 unified WS，`backend/mobile-notifications-v2.mjs:67` 只认 `local_sessions`。其 README:52 所述限制真实，但已经不是后续源码能力。

较新 `D:/AINavtie/ops/full-sso-cutover-20261022/workspace-team/workspace` 有以下修复：

| 文件与行 | 行为 |
| --- | --- |
| `backend/identity/routes.mjs:122–127` | 普通 API 等待异步统一验证完成；不再提前拒绝 streams/mobile-v2。 |
| `backend/app.mjs:317` | 注入 mobile-v2 的异步统一重新授权回调。 |
| `backend/mobile-notifications-v2.mjs:67–73` | 从真实 server-verified unified principal 取 native user；重查当前 workspace membership、会话、员工可见性和设备归属。 |
| `backend/mobile-notifications-v2.mjs:124–139` | wait 限 1–25 秒；事件只唤醒新的授权与持久化查询，初读/事件/超时前重验。每账号至多 3 条等待，全局 256。 |
| `backend/app.mjs:675–678` | list、wait、items 仍沿用 v2 路径、cursor 和 envelope。 |
| `backend/app.mjs:655` | SSE 每条发送及 15 秒 heartbeat 前重新授权，失败关闭流。 |
| `backend/app.mjs:1053–1069,1078–1092` | WS handshake 和推送/heartbeat 重新授权，固定 URL workspace 权威；失败 1008 关闭。 |

因此最低后端依赖应复用并核实这些实际部署字节，不复制旧候选拒绝逻辑，也不为了 Android 去掉身份 gate。原生长轮询必须发本站 Bearer；cursor、已读和提醒点击仍按账号+workspace 隔离并重新核查。流中原 AT 到期可以正常关闭，客户端通过安全刷新后重连，不能让长期连接永久延长授权。

## 工作区、tenant 与 BigTron

`source-workspace/backend/identity/native.mjs:49–55` 返回 **当前成员关系 ∩ 受信 binding.workspaceIds**。响应 membership 的 `id` 是 member ID，`workspace_id` 才是稳定工作区 ID，`slug` 用于 `/api/workspaces/:slug/...` 路由。`verifier.mjs:144–147,234–235` 的 `nativeTenantId` 只是已有受信 binding 可选字段，Android 不应凭空生成 tenant。

`native.mjs:228–230` 的顶层 `workspace` 用同 role 的首条 membership 选择；多个 Owner 工作区时不可靠。Android 必须从服务器返回的 membership 列表保存明确的 `workspace_id + slug`，再用该选择发请求，不能从 role、列表位置或显示名称推断当前资源。

BigTron 不是可猜测的 slug。已有只读回执 `.../native-member-adapter-staging-20261023/bigtron-resource-receipt.json:3–6,14–17,32–34` 在 **2026-10-23T05:23:29.540994Z** 记录：用户明确选定、Unicode 完全同名唯一匹配，稳定 ID `ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e`，原三个工作区和 Owner 关系保留。这是后端配置证据，**不在 Android 硬编码该 ID**。

同目录 `server-resource-configuration-plan.json:7–29` 计划由服务器配置 `ZIWEI_WORKSPACE_MEMBER_WORKSPACE_ID`；provisioner subject 尚待真实注册。`release-preparation-review.json:151–165` 明确 flags/env 尚未写，未建 enrollment 表，正式新 release/备份/调用者注册/激活仍待完成。Android 注册或新成员加入入口只指向 `https://qzelynth.top`，不提供并行建人/邀请系统；是否已获得 BigTron 成员关系只能以当前服务端返回结果判断。

## 待登记 Android 客户端与最低后端变更

本轮可审候选在本目录 `android-identity-client-candidate.json`，client ID 是 **`ziwei-android-manager`**，`com.ziwei.manager:/oauth2redirect` 是待共同审核的精确回调。它不是已登记客户端或可直接提交的 Admin API wrapper。

唯一 186 现网写入者按当前授权执行以下步骤；本报告不执行：

1. 新增共同原生客户端描述与公开 readiness 元数据，明确该客户端只访问 `ziwei-workspace-api`。使用独立 public Authorization Code + PKCE S256；无 secret、implicit/password/service-account/device grant，精确 redirect，无通配，默认 disabled。
2. 精确 fresh GET 同名 client，唯一匹配、完整私有快照漂移比较、串行最小变更、再回读；不存在才 disabled POST。保留其它 clients、secrets、mappers、用户与会话，禁止 realm import。参见 `D:/AINavtie/ops/identity/registry/README.md:40–56` 和 `registry.mjs:11,22–38`。
3. 为原生客户端接相同 workspace audience/sub mapper、本站 read/write scopes 与角色映射；profile/email 如需展示另审关联，不因它们授业务权限；禁止 account/其它站 audience 和默认 offline_access。
4. 在受信服务端配置/验证器中精确允许 Android `azp`，保留现有 web/CLI/employee 验证；`/api/identity/config` 返回原生 client ID、redirect 与是否真正 ready。未部署/未登记时 Android 显式 blocked，不能自认为配置存在即完成接入。
5. `/api/identity/me`、`/api/workspaces` 与移动读取继续返回原 native user 和有权 membership；服务端处理默认 BigTron 开通/加入，不让 Android 自报 native user/tenant/workspace 来扩大 binding。
6. 以真实 OP 隔离 fixture 和正确发布字节验证 code/PKCE/state/nonce/redirect、错站/错 client、RT 轮换及并发、退出、停用/角色和成员撤销，及 mobile-v2/流等待中的撤权。特别验证密码变化/服务端会话失效后旧 native AT/RT 的真实拒绝；不能凭 active:true 或旧 scope 声称实时撤权已满足。

共同合同目前只描述 web 与 CLI，Android 是显式扩展待验项；现有本地真实 OP/BFF/CLI 测试不自动证明 Android public code flow、系统浏览器回调或 native token store 已通过。

## 已发现文档矛盾与验收边界

- `CONTRACT.md:3,11` 和 `CLI-STANDARD.md:9` 已更新为正式 issuer 基础设施上线；各旧准备文档“issuer DNS/TLS 尚未部署”的说法已过时。provider 上线仍不证明站点/Android已切换。
- 旧 `8f2d6f1/docs/operations/2026-10-22-workspace-identity-deployment.md:5` 称闲鱼不改登录，与共同合同最新完整切换范围不符；本轮 Android 不据此更改闲鱼。
- 旧 README 的 mobile-v2/WS/SSE 禁用是旧候选状态；较新完整源码已改为逐次鉴权。新版源码和既有运行回执仍不等于本审计 fresh production 验收。
- 顶层 workspace 首个同角色选择不能作为稳定默认工作区合同；Android 要以 memberships 中的稳定 workspace_id 为准。
- `nativeAppCutoversComplete:true` 的既有回执同时明确真人完整 browser/CLI login 未验；该字段仅代表其记录的原生 unit/数据库/配置切换。

Android 基线 code16：APK SHA256 `1d1cb8269472ebaa51ddd59ba8edb52770d5aae37a24323ed2c21ef5c9576366`；原证书 SHA256 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`，来自本轮 `.local/baseline-code16/manifest-code16.json` 及独立包校验。密钥缺失时 code17 只能产明确 **unsigned** 候选；不得自动新建签名冒充同签名更新，不卸载/清除数据。正式签名、原生客户端登记、实际 OP 联调、模拟器覆盖升级和真机通知各自验收；不得用一次编译成功替代。
