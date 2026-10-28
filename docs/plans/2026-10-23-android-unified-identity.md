# Android 管理 App 统一身份适配与验收计划

日期：2026-10-23（Asia/Shanghai）。这是按本会话的人类授权准备的本机候选，不是生产发布回执。

## 已核来源

- 仓库：`https://github.com/jinjinli226-netizen/ziwei.git`。本轮 `git ls-remote` 核得 `main=98dfa12e74d0fbda6b05659448e14259080e21ae`。
- Android 分支：`codex/android-selfhost-notifications=ea76741b52161d76d10eff146c46d1b886f9a5d7`，目录 `mobile-manager/`。
- 当前公开 Release：`android-manager-v0.5.4-internal`，发布时间 2026-10-21 19:24:52 北京时间；产品提交 `6a857c54c197fc774e5549aa4ffcdca6779afc7b`。
- 包名 `com.ziwei.manager`，versionName `0.5.4-internal`，versionCode `16`，API 26–35。
- 匿名下载 APK SHA-256 `1d1cb8269472ebaa51ddd59ba8edb52770d5aae37a24323ed2c21ef5c9576366`；manifest SHA-256 `fb54450c923af6348e21f376c9e8e7a4b39503d7b7a16cd636ac3793ba2766bf`。
- `apksigner verify --verbose --print-certs` 通过 v2/v3，证书 SHA-256 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`。证书公开指纹不证明本机持有私钥。

10/20 地图记载的 code15 已由上述真实远端核对更新。代码中的构建默认值仍是 code15，不能用默认值推断已发布 APK 身份。

## 现状与选择

管理端当前在本地 WebView 装入 `https://qzelynth.top/__ziwei_manager__/` 打包资源，通过 `/api/auth/login` 提交旧密码，依赖 HttpOnly Cookie。原生自托管通知也取 Cookie，使用 notifications-v2 GET 长轮询、前台服务与约十五分钟补充检查。管理端不是被控手机 Agent/Updater，也不是 Windows `ziwei_user`。

选择保留原 WebView 业务界面和本机存储源，仅在原生增加 OIDC 会话及受限 API 桥。直接在 WebView 打开身份页不符合本次系统浏览器登录要求；重写整套原生业务界面会增加与当前聊天、汇报和权限合同的偏差。本次只改变已明确的身份接入。

## 最小设计

1. 固定 issuer `https://auth.qzelynth.top/realms/ziwei`，API `https://ziwei.qzelynth.top`，单一 access-token audience `ziwei-workspace-api`。候选 public client `ziwei-android-manager`；不得携带 confidential client secret。
2. 系统浏览器 Authorization Code + PKCE S256；随机 state/nonce，固定精确回调 `com.ziwei.manager:/oauth2redirect`，一次性消费并限时。该回调只是注册候选，不代表已获 provider 注册。
3. 原生校验 RS256 签名、固定 JWKS 来源、issuer/aud/azp/sub/iat/exp/type，ID token 校验 client audience 与 nonce；Keystore AES-GCM 加密原子存储，刷新 singleflight。退出先本机失效，迟到回执不得恢复会话；网络失败不伪装成凭据失效。
4. JS 只能得到非敏感状态与业务回执。JSON API 走固定源原生桥；受保护图片也由原生携带 bearer。请求不跟随重定向，不把 Cookie 与 bearer 混用，不重放结果未知的写入。
5. 工作区与账号 ID 来自服务端鉴权结果。保留原员工、聊天、草稿、失败回执、Profile/HOME、电脑配对和手机控制协议；不在 App 猜测或硬编码 BigTron ID。
6. 后台通知共用原生会话。401/403 或服务端明确禁用时停止并显示真实状态；点击通知仍重新核验当前用户和工作区权限。WS/SSE 不在本机擅自开放。
7. provider/native route gate 尚未核实注册完成时，候选保持明确未配置状态，禁止旧 Cookie/旧密码回退。

## 写域与执行角色

| 角色 | 写域 / 职责 |
| --- | --- |
| 本会话总控 | 来源定位、计划与交付文档、构建编排、结果核对；不接管实现者代码 |
| 原生实现子任务 | `mobile-manager/android/`、`scripts/test-android.py`；认证、桥、通知、JVM 边界测试 |
| 移动网页实现子任务 | `mobile-manager/web/`、`mobile-manager/test/`；统一登录入口、原生桥适配与回归 |
| 合同/构建子任务 | 当前身份合同与脱敏发布 receipt 核验；`scripts/build-android.py`、构建测试 |
| 独立验收子任务 | 完成实现后另派只读审查，复核安全、会话竞争、数据隔离和产物 |

不写 `D:\\灵光爸爸拆解` 的原未提交文件，不整分支合并生产，不登录 154，不 SSH/更改 provider/shared edge，不安装或操作真实手机，不运行付费模型。

## 验证及交付顺序

1. 固定远端分支、Release、APK/manifest SHA 和公开证书，保留下载原字节。
2. 先做 PKCE/回调/URL/JWT/会话代际与网页桥错误场景测试，再运行原移动界面回归。
3. Windows JDK17 + Android35 原生编译、DEX、资源、zipalign、包名/权限、打包源字节校验。缺原签名时只产出明确 unsigned 候选，不能称可安装覆盖包。
4. 保存构建日志、候选 SHA、源文件哈希及未提交状态；在正式签名前将最终产品源码固定到提交。无真 provider fixture、模拟器和真机的项目分别标未验。
5. 交付 public client 注册候选、native API/通知 gate 变更候选和升级/回退说明，经主生态与唯一生产写方协调完成受审注册和真实 fixture 后才能激活。正式发布、签名交付、真机覆盖安装另外验收。

## 外部依据

- [当前 code16 Release](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.5.4-internal)
- [RFC 8252：Native Apps](https://www.rfc-editor.org/rfc/rfc8252)
- [RFC 7636：PKCE](https://www.rfc-editor.org/rfc/rfc7636)
- [OIDC Core ID Token Validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)

上述规范支持本设计，不能替代真实 provider、签名或真机验收。
