# 紫薇驾驶舱 CLI 接入说明

CLI 2.0.0 · 规范 1.3.0 · 身份契约 1.0.1 · 机器契约 v1 · 文档 2.0.0 · 更新 2026-10-22

本站：https://ziwei.qzelynth.top。公开索引：https://ziwei.qzelynth.top/docs；完整说明：https://ziwei.qzelynth.top/docs/cli.md；发现索引：https://ziwei.qzelynth.top/llms.txt。匿名阅读这些说明不授予任何业务权限。

## 定位与当前交付状态

紫薇驾驶舱组织工作区、数字员工、Bot、任务、文档和已授权电脑。`@ziwei/workspace-cli` 的独立可执行命令是 `ziwei-workspace`，适合负责这些工作区资源的员工和管理员。业务请求直接访问本站已有后台，服务标识固定为 `workspace`。

本主版本新 CLI 默认机器契约 v1，也接受显式 `--contract v1`。原有 `ziwei_user` 是电脑执行客户端，原管理 MCP 仍保留；手机 Control 的 `ziwei` 是配套工具。本 CLI 不安装或启动这些程序。

当前统一身份已在候选源码接线，CLI 使用公共设备授权、按站 AT/RT、显式刷新与退出；真实 OP、本站端到端和生产切换的验收须分别核实，不能以离线通过盖章 C13。尚未发布到公共 npm，未部署这次身份、文档路由或 CLI 改动到生产。以下绝对 URL 是本站发布目标，公网可用性 pending；仓库文件和本地测试不表示 URL 已上线。

准备期服务器默认 legacy，保留现网原入口；CLI 默认 unified，这是 2.0.0 的明确行为变更。只有部署方显式配置 `ZIWEI_IDENTITY_MODE=unified`、完整受信 issuer/API 与 web secret/session key，并完成原生身份绑定后，默认 CLI 登录才可用。配置缺失不自动降级旧密码。准备兼容不是最终统一身份交付。

源码基线 commit：19876c0f006af18c9fe3b6ef4a7d9e94c75c14c6；候选实现标识：workspace-unified-identity（未提交增量，尚无新的发布 commit）；命令目录 SHA-256：cffc6c3b931fe0944b3e37d577824de9e198812f3736651416006c908c7f6abf。该指纹只标识本文实际引用的 registry，不是安装包校验和或生产版本。最终源码 commit、artifact SHA-256 与发布状态须从交付记录分别核对。

已有操作见下方从 registry 生成的 44 项命令/schema。统一身份只在服务器公开配置明确允许的 native/mcp HTTP 路由上传本站 AT：优先对应 native 路由，否则可用原有 MCP 路由。原生资源、角色和幂等边界保持逐项定义。员工绑定可能只允许自己的员工/Bot 路径，集合查询可被明确拒绝。未覆盖：员工机器 client_credentials、全站 OP 退出、通用 actions cancel、dry-run、特权 force-abandon/failure-finalization、其他站点业务命令。

## 安装、升级、卸载与包校验

运行要求：Node.js >=20.11 与 npm；使用 Node 内置 fetch，无运行时第三方依赖。设计面向 Windows、macOS、Linux；各平台的实际安装验收以交付证据为准，不将本地 Windows 验证称为三平台实测。

分发来源是本项目维护者交付的独立 tarball `ziwei-workspace-cli-2.0.0.tgz`，须通过授权渠道取得文件及独立可信 SHA-256。真实不可变 HTTPS 下载 URL 在发布后由交付回执提供；当前没有可宣称已可用的公共 npm 包或公共下载地址。不要把电脑客户端的下载包当成本包。以下尖括号必须替换为真实获授权的交付参数。

在 PowerShell 中先验证；文件名可按实际交付路径替换：

```powershell
(Get-FileHash -Algorithm SHA256 -LiteralPath "<artifact-file.tgz>").Hash
# 将结果与可信交付记录中的 <expected-sha256> 逐字比对，相同才安装。
npm install --global "<artifact-file.tgz>"
# 发布后也可直接安装回执给出的真实 HTTPS 版本包；下面 URL 是模板，当前不可声称已上线。
npm install --global "https://<trusted-release-origin>/<release-path>/ziwei-workspace-cli-2.0.0.tgz"
ziwei-workspace --version
ziwei-workspace --help
```

macOS/Linux 可用 `shasum -a 256 "<artifact-file.tgz>"` 或 `sha256sum "<artifact-file.tgz>"` 比对同一可信值。仅计算 hash 不能证明来源可信。升级和回退都安装对应已核验版本的交付 tarball；升级不会授予额外业务权限。

```sh
npm install --global "<verified-new-or-previous-artifact.tgz>"
npm uninstall --global @ziwei/workspace-cli
```

卸载 npm 包仅移除程序。需要清理当前凭据槽时先运行对应 selector 的 `auth logout`；其他 origin/profile/account/purpose 槽须分别处理。不得把卸载描述为全部站点或全部副本的会话撤销。

## 登录、身份、权限和安全输入

统一身份使用同一人或员工的受信 `(issuer, subject)`，每站分别授权并限制 audience。本站公共设备客户端固定 `ziwei-workspace-cli`，API audience 为 `ziwei-workspace-api`。只申请 `openid workspace:read workspace:write`，普通刷新不申请 `offline_access`。不会按同名/邮箱合并账号，也不把客户端自报 employeeId、email 或角色当身份。

CLI 默认 unified；`auth login --mode unified --workspace "<workspace-slug>"` 先匿名读取所选 origin 的 `GET /api/identity/config`，精确核对服务、client、audience、scope、issuer 与 readiness。可选 `ZIWEI_IDENTITY_ISSUER` 只作精确 pin；服务器配置缺失时不能使用缓存 issuer 降级。OP discovery issuer 必须一致，device/token/revocation endpoint 必须是该 issuer origin/realm 下的受信 HTTPS 地址，拒绝重定向。公开 `ready:true` 只表示本地配置齐备，不证明 OP/DNS/绑定/生产已验收。

每次设备流生成随机 PKCE S256。login 返回公开 verificationUri/userCode 与 `state:authorization_required,completed:false`；CLI 不自动打开浏览器、不等人工输入、不隐式创建账号。device_code 与原 verifier 仅在私有凭据文件中跨进程保存，兑换/退出后删除，不进入 stdout、普通日志或安装包。

```sh
ziwei-workspace auth login --mode unified --workspace "<workspace-slug>" --profile "<profile>" --account "<account-slot>" --non-interactive --json --contract v1
# 在自己的浏览器访问公开 verificationUri 并输入 userCode；未批准时继续 pending。
ziwei-workspace auth complete --profile "<profile>" --account "<account-slot>" --non-interactive --json
ziwei-workspace auth wait --profile "<profile>" --account "<account-slot>" --timeout 30000 --non-interactive --json
ziwei-workspace auth status --profile "<profile>" --account "<account-slot>" --json
ziwei-workspace auth refresh --profile "<profile>" --account "<account-slot>" --non-interactive --json
ziwei-workspace auth logout --profile "<profile>" --account "<account-slot>" --json
```

`auth complete` 只在轮询间隔到期后兑换一次；`auth wait` 按 interval/slow_down 在总 --timeout 内等待，已知未批准时返回 `state:pending,completed:false,timedOut:true`，不把待批准说成登录完成。每流只允许一个兑换在途。终止拒绝/到期只清理对应版本；已发兑换或刷新超时/SIGINT保留 unknown，禁止自动重放。

CLI 将 AT/RT 作为不透明凭据；保存登录/刷新前必须用新 AT 请求 `GET /api/identity/me`，由服务器实际验签、逐次 confidential introspection 与原生绑定验证，并确认工作区 membership。刷新必须保持原 issuer/subject。每个后续业务请求还需本站 access/read/write/admin 角色、scope 与原生资源权限交集；安装和本地凭据不授予权限。员工可用自己的交互设备账号，非交互员工使用 `auth login --mode machine --purpose employee --workspace <slug> --worker-file <绝对私有JSON>`，文件固定本站 issuer/origin/clientId/subject/clientSecret；仅登记的单员工 client 可用，300秒 AT 先经后端验签、实时 introspection 和原生绑定，secret 不进 token 槽；过期需显式重新授权。

每项命令公开 `unifiedAuthorization` 的实际 requiredRole/requiredScope，并与服务器两个路由族做对照测试。尤其 `phone-mcp configure` 是绑定管理，需当前 access + admin、workspace:write 及原生工作区 owner/admin；普通 task/document 写仍需 write。字段是离线规则，不能据此宣称当前账号有 grant。

`auth status` 默认验证 `/api/identity/me`，区分 unified 与 legacy，并保留安全的服务器原生状态；`--local` 只报告本地非敏感摘要、`verification:local,serverVerified:false`。短跨进程锁和版本 CAS 保护凭据：网络与等待不持锁；logout 原子取走最新 AT/RT，迟到刷新/兑换不复活槽，并尽力显式撤销返回 token。异常清理失败或结果未知如实保留。

统一模式 logout 默认只撤当前站点/槽最新 RT 和 AT，直接使用公共 client 的受信 OP revocation endpoint，不把 RT 发给业务 API。RFC 7009 HTTP 200 仅报告 `remoteRevocation:accepted,revocationConfirmed:false`，不证明 token 已 inactive。`--local` 为 not_requested；远端失败/超时不抹去 localCleared。它不代表全站或 OP SSO 退出。待批准设备码本地退出后按 OP 原期限失效，不虚称已取消 OP 授权。

准备期显式兼容：只有服务器公开声明 `mode:legacy,legacyAllowed:true` 时，才可使用 `--mode native` 或 `--mode managed`。统一服务器拒绝旧密码、旧 Cookie、静态 owner Bearer 和旧 MCP 网站凭据；不以兼容请求成功算统一交付。1.x 本地 legacy 记录须重新显式授权后才能供服务器调用，仍可读取本地摘要和退出。

legacy native 需 `--mode native`、`--email`、`--workspace`、`--password-stdin`。密码只从 stdin 读且不保存，记录原 Set-Cookie 会话。下面模板只在准备期 legacy 服务器使用；保护秘密输入文件及 OS 权限，不把真实密码放入 argv、历史、业务 JSON 或日志。

```powershell
Get-Content -LiteralPath "<protected-password-file>" -Raw | ziwei-workspace auth login --mode native --email "<account-email>" --workspace "<workspace-slug>" --password-stdin --profile "<profile>" --account "<account-slot>" --purpose person --non-interactive --json --contract v1
ziwei-workspace auth status --profile "<profile>" --account "<account-slot>" --purpose person --json
ziwei-workspace auth status --local --profile "<profile>" --account "<account-slot>" --purpose person --json
ziwei-workspace config show --profile "<profile>" --account "<account-slot>" --purpose person --json
ziwei-workspace auth logout --profile "<profile>" --account "<account-slot>" --purpose person --json
```

显式 legacy status 实际请求原 `/api/auth/me`（native）或对应工作区管理 health（managed），成功才显示 `verification:server`。native/managed 来源标为 legacy。`config show` 只输出公开 selector/配置状态，不输出凭据。

managed 模式只导入操作者明确提供的原生短期受限凭据，不扫描其他程序配置、不使用管理员通用 token。必须选择 `--purpose employee`；这只是隔离存储用途，不是员工身份认证。凭据文件要求原生 `managed:true`、`audience:"ziwei-management"`、唯一 workspace、deviceId、未来 expiresAt、匹配本站 apiBase 及原 token。无通用凭据样例，也不在文档放真实账号或密钥。

```sh
ziwei-workspace auth login --mode managed --purpose employee --managed-file "<protected-managed-credential.json>" --profile "<profile>" --account "<employee-slot>" --non-interactive --json
# 或仅用 --managed-stdin，从可信秘密管理器通过 stdin 提供原生凭据 JSON；两者互斥。
ziwei-workspace auth status --purpose employee --profile "<profile>" --account "<employee-slot>" --json
ziwei-workspace auth logout --purpose employee --profile "<profile>" --account "<employee-slot>" --json
```

凭据槽按站点服务、API origin、profile、account 与 person/employee 用途隔离。可用 `ZIWEI_WORKSPACE_CONFIG_DIR` 显式指定独立绝对配置目录；CLI 不自动读取 ziwei_user 或其他站的凭据。本版本使用本地凭据文件并请求目录 0700/文件 0600，不是系统密钥链或加密保险库；Windows 上还应由操作者核对目录 ACL。秘密输入文件也须限制 OS 访问权限。

每次业务调用继续由原服务校验会话/受众、工作区成员、角色、员工可见性、资源所有权及设备范围。安装、离线 catalog 或本地存在凭据不会产生权限。无凭据返回退出码 3；身份有效但资源/动作不允许返回 4。managed 不能跨其受限 workspace/origin 使用。

legacy native logout 清当前槽并尝试原会话退出；legacy managed 远端撤销未由本 CLI 提供，报告 unsupported。此项兼容退出与统一 OP grant 撤销有不同语义，均分别报告本地与远端结果。

## 公共参数与输入规则

| 参数 | 精确含义 |
| --- | --- |
| `--help` / `--version` | 文本帮助/版本；具体命令后接 `--help` 可读取其 schema |
| `--json` | 机器调用显式声明；本主版本普通调用本来就输出单个 v1 JSON |
| `--non-interactive` | 不等交互；缺参数或凭据立即失败 |
| `--contract v1` | 本包仅支持 v1，默认也是 v1 |
| `--profile <name>` | 环境槽名称，默认 default |
| `--timeout <ms>` | 整数 100–300000，默认 30000，含响应正文读取；wait 采用总等待上限 |
| `--api <HTTPS-origin>` | 默认本站 origin；无 userinfo、query 或业务子路径；仅显式 ZIWEI_WORKSPACE_ALLOW_LOOPBACK_HTTP=1 的隔离测试可用 literal loopback HTTP |
| `--account <slot>` | 本站账号槽标识，默认 default，不代表已认证账号 |
| `--purpose person` / `--purpose employee` | 凭据用途隔离；默认 person |
| `--workspace <slug>` | 明确目标工作区，须通过原服务器权限验证；与业务 JSON 同字段不可重复 |

公共参数在资源/动作前后都有效。重复参数、未知参数、非法超时或跨来源同字段冲突均拒绝。工作区 slug 使用 2–63 位字母数字、下划线或连字符。普通 JSON 输入保持长 ID 为字符串；金额按原 schema 的精确类型传递，不将字符串 ID/金额转换成浮点数。

业务结构化输入三选一：`--input <JSON>`、`--input-file <path>`、`--input-stdin`。文件/标准输入必须是单个 JSON 对象。原 schema 顶层字段可用同名快捷参数，如 `--id "<action-id>"`、`--data "<JSON-object>"`；同一字段与 JSON 重复，即使值相同也拒绝。token/password/secret 等原文不得混入通用业务输入，应使用已有授权 Profile/环境引用。

```sh
ziwei-workspace --profile "<profile>" --account "<account-slot>" employees list --json --contract v1
ziwei-workspace employees list --input "{}" --profile "<profile>" --account "<account-slot>" --json
ziwei-workspace tasks get --input-file "<task-query.json>" --profile "<profile>" --account "<account-slot>" --json
ziwei-workspace actions get --id "<original-action-id>" --json
ziwei-workspace capabilities --json --contract v1
```

`capabilities` 是离线命令/schema 说明，`authorization.verification:offline`、`grantsVerified:false`，不等于当前账号已获授权。`config show`、`auth login/complete/wait/refresh/status/logout` 是配置/身份命令；`actions wait --id "<original-action-id>" --timeout 30000` 只轮询已有 action，不创建动作。

## v1 输出和固定退出码

普通调用 stdout 只有一个 JSON 对象；参数错误也遵守。诊断/交互提示只可写 stderr；`--help`/`--version` 保留文本，原 MCP stdout 专用于协议。本包没有混用单 JSON 的流式输出或文件下载模式。

```json
{
  "schemaVersion": 1,
  "service": "workspace",
  "ok": true,
  "data": {
    "native": {
      "id": "<original-resource-id>"
    }
  },
  "requestId": "<cli-request-id>"
}
```

```json
{
  "schemaVersion": 1,
  "service": "workspace",
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "<redacted-safe-message>",
    "nativeCode": "<original-code-if-present>"
  },
  "requestId": "<cli-request-id>"
}
```

`data.native` 保留原服务响应。若响应有可识别异步状态，另提供 `data.operation`；`requestId` 只是本次 CLI 关联 ID，绝不是服务器回执。错误可保留 `error.nativeCode`、httpStatus 与必要脱敏详情。CLI 映射不会改后端 HTTP 状态。

| 退出码 | error.code / 语义 |
| --- | --- |
| 0 | 请求被成功处理；异步受理不代表业务完成 |
| 1 | INTERNAL_ERROR：内部异常 |
| 2 | USAGE：命令、参数、本地输入或 schema 不合法 |
| 3 | UNAUTHENTICATED：缺身份、过期或登录被拒绝 |
| 4 | FORBIDDEN：身份有效但无资源/动作权限 |
| 5 | NOT_FOUND：服务端确认不存在 |
| 6 | CONFLICT：原服务的版本、状态或幂等键冲突 |
| 7 | SERVICE_UNAVAILABLE：配置/网络/服务不可用，或只读等待/读取超时 |
| 8 | OUTCOME_UNKNOWN：已发送写入可能执行，必须读回核实 |
| 9 | NOT_SUPPORTED：此版本/后端不支持 |
| 130 | CANCELLED：调用者取消；写入已发送时仍保留 outcomeUnknown |

## 异步、幂等、超时和取消

异步规范视图区分 accepted、running、succeeded、failed、unknown，保留 nativeState、原 serverReceiptId 与 resultQuery。accepted/running 的 completed:false；unknown 也不是业务完成。`ok:true` 是 CLI 请求成功，原业务 failed 可在 data.native/data.operation 中保留，调用方必须读取业务状态。Routine run ID 不一定是 action ID，要用该操作的真实 resultQuery。

```json
{
  "state": "accepted",
  "completed": false,
  "nativeState": "pending",
  "serverReceiptId": "<original-action-id>",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <original-action-id>"
  }
}
```

写入只有一次 dispatch，no automatic write retry。写入超时、响应丢失或无效成功响应可能返回 OUTCOME_UNKNOWN；先保留原输入、幂等键、服务器 ID 与 resultQuery，再回读原资源/动作。没有 ID 时按原资源查询人工核实；不得把 requestId 当查询 ID，也不得自动重发来试探结果。只读请求/已有状态的 wait 超时返回 SERVICE_UNAVAILABLE，不把已知执行状态伪装成写入结果未知。

命令目录的 idempotency 仅指原端点真实能力，其 scope、传输方式与字段见对应条目；支持键也不是自动重试保证。CLI 只透传原 input 中的 idempotencyKey，不自造服务器去重。尤其 native tasks create 和 conversations create 不支持服务端幂等，即使 managed 同名操作支持，也不能跨传输推广保证。bots update 普通立即更新也不支持幂等，仅原生 deferUntilIdle:true 路径具有 conditionalIdempotency 描述的去重能力。

本包 `--dry-run` 明确返回 NOT_SUPPORTED，不能用真实执行冒充预览。查询副作用以 readOnly/sideEffects 为准：Bot list/get/runs 是原只读查询，mcpConnections 查询可能清理服务器进程内过期 OAuth relay 项，但不发设备动作或持久业务写入。

`actions cancel` 不支持通用服务端取消。Ctrl+C 取消本地请求/等待；已发写入可能继续执行，此时 CANCELLED 保留 outcomeUnknown:true 和核实信息。Bot 原 control stop 与 cancelMcpConnection 仅按各自原边界作用，不保证停止所有后代/物理设备或其他会话。

会创建员工、Profile、配置、文档、Routine 或真实执行的命令必须先确认业务授权。tasks create 的 execute:true、phone-mcp check/trial、Bot Routine/native/collaboration 等可能触发收费模型、设备或消息动作，按逐项 sideEffects 判断。例子只是占位模板，不是运行这些业务动作的授权。

## 原管理 MCP 接入

本项目已有管理 MCP 是 stdio 服务器 `scripts/ziwei-mcp.mjs`。可核对[保留的原管理 MCP 源码](https://github.com/jinjinli226-netizen/ziwei/blob/543e81d344fa0337328b088134cf742128c1d43d/scripts/ziwei-mcp.mjs)（私有仓库需权限；该文件与当前候选字节一致，该远端标识不含本轮未提交身份增量）。它内部调用管理 HTTP API，HTTP API 地址不是远程 MCP transport URL。本包不新增 `ziwei-workspace mcp` 命令，也没有可宣称的公网 HTTP MCP endpoint。

原 stdio 脚本未新增统一 OP 授权、设备流或 RT 刷新。其保留的 managed token-file 模板只适用于原协议受控兼容条件，不能当成统一模式 CLI 的代理授权，也不能推断所有 Bot 管理 MCP 已迁完。CLI 的统一 AT HTTP 路由覆盖与 stdio 运行时身份迁移分别验收。既有 daemon pairing/A2A/terminal 机器协议有独立认证边界，不自动等于网站 MCP 授权。

以下 stdio 模板仅用于已获授权且服务端允许的旧协议/准备兼容；服务器 unified 时不能用旧 managed token 绕过 AT 验证。路径均为自己的授权来源/私有文件占位：

```json
{
  "mcpServers": {
    "ziwei_management": {
      "command": "node",
      "args": [
        "<authorized-source>/scripts/ziwei-mcp.mjs"
      ],
      "env": {
        "ZIWEI_API_BASE": "https://ziwei.qzelynth.top",
        "ZIWEI_MCP_WORKSPACE": "<workspace-slug>",
        "ZIWEI_MCP_TOKEN_FILE": "<protected-managed-token-file>"
      }
    }
  }
}
```

MCP 业务 schema 与资源边界保留，原脚本 stdout 仍为 JSON-RPC。统一身份下每个实际员工运行时/工具的凭据获取、刷新、撤销、actor 与原生范围仍须专项验收；未完成时如实 pending，不借用共享管理员凭据。

## 命令目录与完整输入 schema

以下内容直接由本包 registry 生成。命令拼写保留原资源和动作（包括大小写）；inputSchema 是实际 CLI 校验。transports.native/managed 与 routes 说明原 API 族；unified 根据本站公开 cliTransports 在这些精确路由上使用 AT，不导入旧 managed token。idempotencyByTransport 须按实际选中的路由族判断。readOnly、sideEffects、requiredPermissions、supportsDryRun、idempotency 与 resultQuery 同 capabilities 共源。Bot data 保留原生嵌套校验，示例空对象须按原生能力补齐，不代表任意字段有效。

逐项 JSON 示例只展示根 schema 所需字段；请把它保存到自己的业务输入文件再使用该条命令。所有 ID、路径和其他尖括号值都是占位符。
<!-- operation:workdirs.inspect -->
### workdirs inspect

在指定在线电脑检查真实工作目录。返回异步 action，以 ziwei_get_action 等待 succeeded 后，将 result.path 和 action.id 作为员工 defaultWorkingDirectory/defaultWorkingDirectoryActionId 保存。检查回执10分钟内有效。仅用户明确要求创建时传 createIfMissing:true；不会创建会话或执行员工任务。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "deviceId",
    "path"
  ],
  "properties": {
    "deviceId": {
      "type": "string"
    },
    "path": {
      "type": "string",
      "maxLength": 4096
    },
    "createIfMissing": {
      "type": "boolean",
      "default": false
    },
    "idempotencyKey": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_inspect_workdir",
  "readOnly": false,
  "sideEffects": [
    "Inspect remote filesystem; create only when createIfMissing:true"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/devices/{deviceId}/workdir/inspect"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/devices/{deviceId}/workdir/inspect"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "deviceId": "<deviceId>",
  "path": "<path>"
}
```

```sh
ziwei-workspace workdirs inspect --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:conversations.create -->
### conversations create

为当前工作区员工创建新会话，返回持久化目录快照；不发送消息或执行任务。省略 workingDirectory 会继承员工绑定该电脑的默认目录，再沿用设备目录。非空显式目录仅覆盖该会话。使用稳定 idempotencyKey 安全重试。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "employeeId"
  ],
  "properties": {
    "employeeId": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "deviceId": {
      "type": "string"
    },
    "workingDirectory": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 4096
    },
    "model": {
      "type": "string"
    },
    "idempotencyKey": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_create_conversation",
  "readOnly": false,
  "sideEffects": [
    "Create persistent employee conversation; no message or execution"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": "No transport-independent guarantee: only the managed endpoint supports original persisted keys; native endpoint is unsupported. See idempotencyByTransport.",
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/conversations"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/conversations"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "employeeId": "<employeeId>"
}
```

```sh
ziwei-workspace conversations create --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:management.health -->
### management health

检查当前紫薇工作区 MCP 管理入口状态与窄管理面边界。

输入 schema：

```json
{
  "type": "object",
  "properties": {
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_mcp_health",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "unsupported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/health"
    },
    "native": null
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{}
```

```sh
ziwei-workspace management health --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:environment.discover -->
### environment discover

先调用本工具：查询当前工作区真实目标电脑、在线状态、已发现的 CLI/runtime、模型、Hermes profiles、认证/provider 就绪信息及技能。不得猜测或替换运行时。

输入 schema：

```json
{
  "type": "object",
  "properties": {
    "deviceId": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_discover_environment",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/discovery"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/mcp/discovery"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{}
```

```sh
ziwei-workspace environment discover --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:employees.get -->
### employees get

按 ID 回读员工职责、人格、技能、runtime/profile 和绑定电脑。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_get_employee",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "unsupported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/employees/{id}"
    },
    "native": null
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace employees get --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:employees.mcp-status -->
### employees mcp-status

查询员工管理 MCP 的配置和最近真实执行调用证据；HTTP 健康不代表员工已经加载。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_get_employee_mcp_status",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/employees/{id}/mcp/status"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/employees/{id}/mcp/status"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace employees mcp-status --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:profiles.create -->
### profiles create

在指定在线电脑创建独立 Hermes profile（本地继承 provider，主 profile 不变）。返回异步 action，必须使用 ziwei_get_action 等待 succeeded，再发现 profile 后创建 Hermes 员工。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "profile",
    "deviceId",
    "soul"
  ],
  "properties": {
    "profile": {
      "type": "string"
    },
    "deviceId": {
      "type": "string"
    },
    "soul": {
      "type": "string"
    },
    "memory": {
      "type": "string"
    },
    "identity": {
      "type": "string"
    },
    "inheritProvider": {
      "type": "boolean",
      "default": true
    },
    "idempotencyKey": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_create_hermes_profile",
  "readOnly": false,
  "sideEffects": [
    "Create isolated Hermes Profile on the selected computer"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/hermes/profiles/requests"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/hermes/profiles/requests"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  },
  "inputNotes": "Business profile must come from JSON input. The public --profile flag only selects the credential slot and never supplies this native field."
}
```

输入文件模板：

```json
{
  "profile": "<profile>",
  "deviceId": "<deviceId>",
  "soul": "<soul>"
}
```

```sh
ziwei-workspace profiles create --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:actions.get -->
### actions get

回读当前工作区异步 profile 或员工执行 action 的真实状态、结果、错误和事件。pending/acked 不表示成功。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_get_action",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/actions/{id}"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/actions/{id}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace actions get --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:tasks.get -->
### tasks get

回读任务、员工真实执行 action 与结果。用本工具验证试运行，不可把创建成功当成执行成功。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_get_task",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/tasks/{id}"
    },
    "native": {
      "method": "GET",
      "path": "/api/tasks/{id}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace tasks get --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:employees.list -->
### employees list

列出指定紫薇工作区的数字员工。

输入 schema：

```json
{
  "type": "object",
  "properties": {
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_list_employees",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/employees"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/employees"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{}
```

```sh
ziwei-workspace employees list --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:employees.create -->
### employees create

发现环境后，按用户明确选择的 runtime、目标电脑和 profile 创建员工。职责 description、人格 persona、岗位指令 instructions、技能 skills 分别保存；指定 Codex/Hermes 不会回退。使用稳定 idempotencyKey 安全重试。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "name",
    "runtime",
    "targetDeviceId"
  ],
  "properties": {
    "name": {
      "type": "string"
    },
    "runtime": {
      "type": "string"
    },
    "targetDeviceId": {
      "type": "string"
    },
    "runtimeProfile": {
      "type": "string"
    },
    "model": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "persona": {
      "type": "string"
    },
    "instructions": {
      "type": "string"
    },
    "managementMcpEnabled": {
      "type": "boolean"
    },
    "idempotencyKey": {
      "type": "string"
    },
    "visibility": {
      "type": "string",
      "enum": [
        "workspace",
        "personal"
      ]
    },
    "skills": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "defaultWorkingDirectory": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 4096,
      "description": "省略保留；null明确清空；非空路径须先在目标电脑检查并传回执，员工新会话继承，旧会话不变。"
    },
    "defaultWorkingDirectoryActionId": {
      "type": "string",
      "description": "目标电脑 ziwei_inspect_workdir succeeded 检查的 action.id；10分钟内有效。"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_create_employee",
  "readOnly": false,
  "sideEffects": [
    "Create employee; may create required management configuration"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace employees list",
    "idField": "id"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/employees"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/employees"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "name": "<name>",
  "runtime": "<runtime>",
  "targetDeviceId": "<targetDeviceId>"
}
```

```sh
ziwei-workspace employees create --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:employees.update -->
### employees update

更新已有数字员工的职责、人格、技能、目标电脑和明确的运行时配置。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "runtime": {
      "type": "string"
    },
    "targetDeviceId": {
      "type": "string"
    },
    "runtimeProfile": {
      "type": "string"
    },
    "model": {
      "type": "string"
    },
    "persona": {
      "type": "string"
    },
    "managementMcpEnabled": {
      "type": "boolean"
    },
    "description": {
      "type": "string"
    },
    "instructions": {
      "type": "string"
    },
    "status": {
      "type": "string"
    },
    "visibility": {
      "type": "string"
    },
    "skills": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "defaultWorkingDirectory": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 4096,
      "description": "省略保留；null明确清空；非空路径须先在目标电脑检查并传回执，员工新会话继承，旧会话不变。"
    },
    "defaultWorkingDirectoryActionId": {
      "type": "string",
      "description": "目标电脑 ziwei_inspect_workdir succeeded 检查的 action.id；10分钟内有效。"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_update_employee",
  "readOnly": false,
  "sideEffects": [
    "Change employee configuration for future execution"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace employees list",
    "idField": "id"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "PATCH",
      "path": "/mcp/v1/workspaces/{workspace}/employees/{id}"
    },
    "native": {
      "method": "PATCH",
      "path": "/api/workspaces/{workspace}/employees/{id}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace employees update --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:tasks.list -->
### tasks list

列出指定紫薇工作区的任务。

输入 schema：

```json
{
  "type": "object",
  "properties": {
    "state": {
      "type": "string"
    },
    "assignee": {
      "type": "string"
    },
    "q": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_list_tasks",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/tasks"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/tasks"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{}
```

```sh
ziwei-workspace tasks list --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:tasks.create -->
### tasks create

创建任务；试运行时 employeeId + execute:true，沿用员工明确配置并校验目标电脑、CLI 和 profile。回读 ziwei_get_task/ziwei_get_action 确认真正执行结果。使用稳定 idempotencyKey 避免重复任务。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "title"
  ],
  "properties": {
    "title": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "employeeId": {
      "type": "string"
    },
    "assignee": {
      "type": "string"
    },
    "targetDeviceId": {
      "type": "string"
    },
    "runtime": {
      "type": "string"
    },
    "runtimeProfile": {
      "type": "string"
    },
    "execute": {
      "type": "boolean"
    },
    "idempotencyKey": {
      "type": "string"
    },
    "priority": {
      "type": "string"
    },
    "labels": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_create_task",
  "readOnly": false,
  "sideEffects": [
    "Create task; execute:true dispatches real employee work and may use paid models"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": "No transport-independent guarantee: only the managed endpoint supports original persisted keys; native endpoint is unsupported. See idempotencyByTransport.",
  "resultQuery": {
    "command": "ziwei-workspace tasks get --id <taskId>",
    "idField": "id"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/tasks"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/tasks"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "title": "<title>"
}
```

```sh
ziwei-workspace tasks create --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:documents.list -->
### documents list

列出指定紫薇工作区的文档。

输入 schema：

```json
{
  "type": "object",
  "properties": {
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_list_documents",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original document ownership/workspace guard"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/documents"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/documents"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{}
```

```sh
ziwei-workspace documents list --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:documents.get -->
### documents get

读取紫薇工作区内的文档。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_read_document",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original document ownership/workspace guard"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/documents/{id}"
    },
    "native": {
      "method": "GET",
      "path": "/api/documents/{id}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace documents get --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:documents.write -->
### documents write

在紫薇工作区创建文档，或更新已有文档。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "name"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "type": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "mimeType": {
      "type": "string"
    },
    "parentId": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_write_document",
  "readOnly": false,
  "sideEffects": [
    "Create or update workspace document"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original document ownership/workspace guard"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace documents get --id <documentId>",
    "idField": "id"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/documents"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/documents"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "name": "<name>"
}
```

```sh
ziwei-workspace documents write --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:phone-mcp.setup -->
### phone-mcp setup

只读发现手机平台技能、电脑runtime/profile与原中控手机目录。数量查询使用 view:"summary"，返回 control_catalog 的唯一手机ID数量、当前可见员工与电脑数量及简短目录；不是工作区已绑定手机数。默认 view:"full" 保留完整配置资料。员工绑定手机后才会获得完整十工具。

输入 schema：

```json
{
  "type": "object",
  "properties": {
    "view": {
      "type": "string",
      "enum": [
        "summary",
        "full"
      ],
      "default": "full"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_phone_mcp_setup",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/phone-mcp/setup"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/phone-mcp/setup"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{}
```

```sh
ziwei-workspace phone-mcp setup --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:skills.install -->
### skills install

安装或卸载当前工作区已发现的真实平台技能ID，并保留版本记录；卸载手机技能不删除员工人格、其他技能或手机绑定。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "installed": {
      "type": "boolean",
      "default": true
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_install_skill",
  "readOnly": false,
  "sideEffects": [
    "Install/uninstall an existing platform skill, preserving history"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/skills/{id}/install"
    },
    "native": {
      "method": "PATCH",
      "path": "/api/skills/{id}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace skills install --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:phone-mcp.configure -->
### phone-mcp configure

为当前工作区员工配置已安装手机技能、精确电脑/runtime/profile和手机绑定。不会复制管理员凭据。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "enabled"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "enabled": {
      "type": "boolean"
    },
    "phoneDeviceId": {
      "type": "string"
    },
    "targetDeviceId": {
      "type": "string"
    },
    "runtime": {
      "type": "string"
    },
    "runtimeProfile": {
      "type": [
        "string",
        "null"
      ]
    },
    "accountId": {
      "type": "string"
    },
    "accountLabel": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_configure_phone_mcp",
  "readOnly": false,
  "sideEffects": [
    "Persist exact employee/phone/runtime binding; no device command"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND admin; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original native workspace owner/admin required",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "admin",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": true,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace phone-mcp status --id <employeeId>",
    "idField": "id"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "PUT",
      "path": "/mcp/v1/workspaces/{workspace}/employees/{id}/phone-mcp"
    },
    "native": {
      "method": "PUT",
      "path": "/api/workspaces/{workspace}/employees/{id}/phone-mcp"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "enabled": false
}
```

```sh
ziwei-workspace phone-mcp configure --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:phone-mcp.status -->
### phone-mcp status

回读员工手机技能保存、API、实际MCP加载和本配置手机命令/截图验收结果；不能把配置成功当成实机成功。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_get_phone_mcp_status",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/employees/{id}/phone-mcp/status"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/employees/{id}/phone-mcp/status"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace phone-mcp status --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:phone-mcp.check -->
### phone-mcp check

创建员工持久会话实际加载手机MCP并读取list/status。此次capability只准只读检测，返回action需回读。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "idempotencyKey": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_check_phone_mcp",
  "readOnly": false,
  "sideEffects": [
    "Create real employee conversation/action and load phone MCP for list/status; may use paid model"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/employees/{id}/phone-mcp/check"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/employees/{id}/phone-mcp/check"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace phone-mcp check --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:phone-mcp.trial -->
### phone-mcp trial

创建真实员工持久会话执行已绑定手机health或screenshot，返回action需回读commandId/状态/截图；幂等键避免重复试运行。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "action": {
      "type": "string",
      "enum": [
        "health",
        "screenshot"
      ]
    },
    "idempotencyKey": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_trial_phone_mcp",
  "readOnly": false,
  "sideEffects": [
    "Create real employee execution and issue phone health or screenshot; may use paid model and physical device"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/employees/{id}/phone-mcp/trial"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/employees/{id}/phone-mcp/trial"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace phone-mcp trial --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.capabilities -->
### bots capabilities

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": []
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "capabilities",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/bots/capabilities"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/bots/capabilities"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{}
```

```sh
ziwei-workspace bots capabilities --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.list -->
### bots list

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": []
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "list",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/bots"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/bots"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{}
```

```sh
ziwei-workspace bots list --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.create -->
### bots create

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "name",
        "targetDeviceId",
        "idempotencyKey"
      ]
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "create",
  "readOnly": false,
  "sideEffects": [
    "Create employee, isolated Profile provisioning action and main conversation"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/bots"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/bots"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "data": {
    "name": "<name>",
    "targetDeviceId": "<targetDeviceId>",
    "idempotencyKey": "<idempotencyKey>"
  }
}
```

```sh
ziwei-workspace bots create --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.initialize -->
### bots initialize

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "idempotencyKey"
      ]
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "initialize",
  "readOnly": false,
  "sideEffects": [
    "Initialize Bot on the same employee and create main conversation if absent"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/employees/{id}/bot"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/employees/{id}/bot"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "data": {
    "idempotencyKey": "<idempotencyKey>"
  }
}
```

```sh
ziwei-workspace bots initialize --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.get -->
### bots get

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": []
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "get",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/bots/{id}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace bots get --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.update -->
### bots update

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "expectedRevision"
      ],
      "description": "deferUntilIdle:true additionally requires expectedControlEpoch and idempotencyKey. connectMcpServers is allowed only with deferUntilIdle:true."
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "update",
  "readOnly": false,
  "sideEffects": [
    "Update versioned configuration; deferred update can later validate, reconnect MCP and restore original authorization"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace bots get --id <employeeId>",
    "idField": "deferredConfig.id",
    "note": "Deferred configuration ID is not an action ID; read deferredConfig and its original action IDs"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "PATCH",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}"
    },
    "native": {
      "method": "PATCH",
      "path": "/api/workspaces/{workspace}/bots/{id}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  },
  "conditionalIdempotency": "Only data.deferUntilIdle:true has original persisted idempotency; normal immediate update is unsupported"
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "data": {
    "expectedRevision": 0
  }
}
```

```sh
ziwei-workspace bots update --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.provision -->
### bots provision

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "expectedRevision",
        "idempotencyKey"
      ]
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "provision",
  "readOnly": false,
  "sideEffects": [
    "Queue original employee Profile provisioning/recovery"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/provision"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/bots/{id}/provision"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "data": {
    "expectedRevision": 0,
    "idempotencyKey": "<idempotencyKey>"
  }
}
```

```sh
ziwei-workspace bots provision --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.validate -->
### bots validate

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "expectedRevision",
        "idempotencyKey"
      ]
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "validate",
  "readOnly": false,
  "sideEffects": [
    "Queue native configuration validation; no model generation"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/validate"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/bots/{id}/validate"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "data": {
    "expectedRevision": 0,
    "idempotencyKey": "<idempotencyKey>"
  }
}
```

```sh
ziwei-workspace bots validate --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.control -->
### bots control

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string",
          "enum": [
            "activate",
            "pause",
            "resume",
            "stop"
          ]
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "expectedRevision",
        "expectedControlEpoch",
        "operation"
      ]
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "control",
  "readOnly": false,
  "sideEffects": [
    "Activate/resume enables scheduling; pause cancels pending work; stop may request running work and descendant termination; requires revision and control epoch"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace bots get --id <employeeId>",
    "idField": "id"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/control"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/bots/{id}/control"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "data": {
    "expectedRevision": 0,
    "expectedControlEpoch": 0,
    "operation": "activate"
  }
}
```

```sh
ziwei-workspace bots control --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.runs -->
### bots runs

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": []
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "runs",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/runs"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/bots/{id}/runs"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace bots runs --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.routines -->
### bots routines

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": []
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "routines",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/routines"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/bots/{id}/routines"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace bots routines --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.createRoutine -->
### bots createRoutine

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "idempotencyKey"
      ]
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "createRoutine",
  "readOnly": false,
  "sideEffects": [
    "Persist schedule; active schedule can dispatch future paid work"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace bots routines --id <employeeId>",
    "idField": "id",
    "note": "Routine run result appears in original Routine.last_result; do not treat automation run ID as an action ID"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/routines"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/bots/{id}/routines"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "data": {
    "idempotencyKey": "<idempotencyKey>"
  }
}
```

```sh
ziwei-workspace bots createRoutine --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.updateRoutine -->
### bots updateRoutine

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "routineId",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": []
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "updateRoutine",
  "readOnly": false,
  "sideEffects": [
    "Change schedule and future execution"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace bots routines --id <employeeId>",
    "idField": "id",
    "note": "Routine run result appears in original Routine.last_result; do not treat automation run ID as an action ID"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "PATCH",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/routines/{routineId}"
    },
    "native": {
      "method": "PATCH",
      "path": "/api/workspaces/{workspace}/bots/{id}/routines/{routineId}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "routineId": "<routineId>",
  "data": {}
}
```

```sh
ziwei-workspace bots updateRoutine --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.deleteRoutine -->
### bots deleteRoutine

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "routineId"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": []
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "deleteRoutine",
  "readOnly": false,
  "sideEffects": [
    "Delete original Routine schedule"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace bots routines --id <employeeId>",
    "idField": "id",
    "note": "Routine run result appears in original Routine.last_result; do not treat automation run ID as an action ID"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "DELETE",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/routines/{routineId}"
    },
    "native": {
      "method": "DELETE",
      "path": "/api/workspaces/{workspace}/bots/{id}/routines/{routineId}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "routineId": "<routineId>"
}
```

```sh
ziwei-workspace bots deleteRoutine --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.runRoutine -->
### bots runRoutine

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "routineId",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "idempotencyKey"
      ]
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "runRoutine",
  "readOnly": false,
  "sideEffects": [
    "Dispatch real Routine work; may use paid models or configured native driver"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace bots routines --id <employeeId>",
    "idField": "id",
    "note": "Routine run result appears in original Routine.last_result; do not treat automation run ID as an action ID"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/routines/{routineId}/run"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/bots/{id}/routines/{routineId}/run"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "routineId": "<routineId>",
  "data": {
    "idempotencyKey": "<idempotencyKey>"
  }
}
```

```sh
ziwei-workspace bots runRoutine --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.native -->
### bots native

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "expectedRevision",
        "expectedControlEpoch",
        "idempotencyKey",
        "resource",
        "operation"
      ],
      "x-nativeOperations": {
        "memory": {
          "read": [
            "scope"
          ],
          "write": [
            "scope",
            "content",
            "expectedHash"
          ]
        },
        "sessions": {
          "list": [
            "limit"
          ],
          "search": [
            "query",
            "limit",
            "roleFilter",
            "after",
            "before",
            "sort"
          ],
          "read": [
            "sessionId",
            "aroundMessageId",
            "window"
          ],
          "compress": [
            "sessionId",
            "keepLast",
            "focusTopic",
            "preview"
          ]
        },
        "skills": {
          "list": [],
          "read": [
            "name",
            "filePath"
          ],
          "install": [
            "name",
            "content",
            "files"
          ],
          "update": [
            "name",
            "content",
            "files",
            "expectedHash"
          ],
          "remove": [
            "name",
            "expectedHash"
          ],
          "enable": [
            "name"
          ],
          "disable": [
            "name"
          ],
          "hub_search": [
            "query",
            "source",
            "limit"
          ],
          "hub_install": [
            "identifier",
            "name"
          ],
          "check_updates": [
            "name"
          ]
        },
        "mcp": {
          "inspect": [
            "server"
          ],
          "authorize": [
            "server"
          ],
          "call": [
            "server",
            "tool",
            "arguments"
          ]
        },
        "goals": {
          "status": [],
          "start": [
            "objective",
            "maxTurns",
            "contract"
          ],
          "pause": [],
          "resume": [],
          "stop": [],
          "step": []
        },
        "heartbeat": {
          "status": [],
          "start": [
            "prompt",
            "intervalSeconds"
          ],
          "pause": [],
          "resume": [],
          "stop": [],
          "step": []
        },
        "kanban": {
          "list": [
            "status",
            "limit"
          ],
          "create": [
            "title",
            "body",
            "priority",
            "parents",
            "triage",
            "maxTurns"
          ],
          "show": [
            "taskId"
          ],
          "edit": [
            "taskId",
            "result",
            "summary",
            "title",
            "body"
          ],
          "claim": [
            "taskId"
          ],
          "complete": [
            "taskId",
            "runId",
            "result",
            "summary"
          ],
          "block": [
            "taskId",
            "runId",
            "reason"
          ],
          "unblock": [
            "taskId"
          ],
          "dispatch": [
            "taskId"
          ]
        },
        "gateway": {
          "status": [],
          "configure": [
            "config"
          ],
          "connect": [
            "platform",
            "durationSeconds"
          ],
          "disconnect": [
            "platform"
          ],
          "inbound": [
            "platform",
            "route",
            "body",
            "headers"
          ],
          "outbound": [
            "platform",
            "chatId",
            "content",
            "replyTo"
          ]
        },
        "voice": {
          "status": [],
          "configure": [
            "config"
          ],
          "transcribe": [
            "audioBase64",
            "mimeType",
            "model"
          ],
          "synthesize": [
            "text",
            "speed",
            "instructions",
            "provider"
          ]
        },
        "collaboration": {
          "message": [
            "targets",
            "content",
            "mode",
            "groupId"
          ],
          "publish": [
            "groupId",
            "task",
            "status",
            "result"
          ]
        },
        "groups": {
          "list": [],
          "read": [
            "groupId"
          ],
          "step": [
            "groupId"
          ]
        }
      }
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "native",
  "readOnly": false,
  "sideEffects": [
    "Queue original native operation; effects depend on resource/operation including memory writes, skill install, MCP external calls, goal/heartbeat/group steps, kanban dispatch, gateway messages and voice provider calls"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/native/actions"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/bots/{id}/native/actions"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "data": {
    "expectedRevision": 0,
    "expectedControlEpoch": 0,
    "idempotencyKey": "<idempotencyKey>",
    "resource": "memory",
    "operation": "<operation>"
  }
}
```

```sh
ziwei-workspace bots native --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.collaboration -->
### bots collaboration

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "expectedRevision",
        "expectedControlEpoch",
        "idempotencyKey",
        "targetEmployeeIds",
        "content"
      ]
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "collaboration",
  "readOnly": false,
  "sideEffects": [
    "Dispatch explicitly authorized messages/delegation/group work to employees; may use paid models"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/collaboration"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/bots/{id}/collaboration"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "data": {
    "expectedRevision": 0,
    "expectedControlEpoch": 0,
    "idempotencyKey": "<idempotencyKey>",
    "targetEmployeeIds": [],
    "content": "<content>"
  }
}
```

```sh
ziwei-workspace bots collaboration --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.mcpConnections -->
### bots mcpConnections

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": []
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "mcpConnections",
  "readOnly": false,
  "sideEffects": [
    "May prune expired OAuth relay entries in server process memory; no device action or persisted business write"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": null,
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/mcp/connections"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/bots/{id}/mcp/connections"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace bots mcpConnections --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.connectMcp -->
### bots connectMcp

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "data"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": [
        "expectedRevision",
        "expectedControlEpoch",
        "idempotencyKey",
        "server"
      ]
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "connectMcp",
  "readOnly": false,
  "sideEffects": [
    "Queue native inspect/authorize on target employee Profile; opens OAuth authorization workflow when required"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "supported",
  "idempotencyScope": "Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.",
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "POST",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/mcp/connections"
    },
    "native": {
      "method": "POST",
      "path": "/api/workspaces/{workspace}/bots/{id}/mcp/connections"
    }
  },
  "idempotencyByTransport": {
    "managed": "supported",
    "native": "supported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "data": {
    "expectedRevision": 0,
    "expectedControlEpoch": 0,
    "idempotencyKey": "<idempotencyKey>",
    "server": "<server>"
  }
}
```

```sh
ziwei-workspace bots connectMcp --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:bots.cancelMcpConnection -->
### bots cancelMcpConnection

Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "connectionId"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "routineId": {
      "type": "string"
    },
    "connectionId": {
      "type": "string",
      "description": "cancelMcpConnection 必填的原连接 action ID"
    },
    "deviceId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "expectedControlEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._:-]{1,160}$"
        },
        "name": {
          "type": "string"
        },
        "targetDeviceId": {
          "type": "string"
        },
        "sourceProfile": {
          "type": "string"
        },
        "runtimeProfile": {
          "type": "string"
        },
        "runtime": {
          "type": "string",
          "enum": [
            "Hermes"
          ]
        },
        "model": {
          "type": "string"
        },
        "persona": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "workspace",
            "personal"
          ]
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "avatar": {
          "type": "string"
        },
        "config": {
          "type": "object"
        },
        "employee": {
          "type": "object"
        },
        "deferUntilIdle": {
          "type": "boolean"
        },
        "connectMcpServers": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "operation": {
          "type": "string"
        },
        "resource": {
          "type": "string",
          "enum": [
            "memory",
            "sessions",
            "skills",
            "mcp",
            "goals",
            "heartbeat",
            "kanban",
            "gateway",
            "voice",
            "collaboration",
            "groups"
          ]
        },
        "input": {
          "type": "object"
        },
        "server": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "message",
            "delegate",
            "group"
          ]
        },
        "targetEmployeeIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "content": {
          "type": "string"
        },
        "groupId": {
          "type": "string"
        },
        "prompt": {
          "type": "string"
        },
        "nativeDriver": {
          "type": "object"
        },
        "schedule": {
          "type": "string"
        },
        "timezone": {
          "type": "string"
        },
        "status": {
          "type": "string"
        }
      },
      "required": []
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_bot",
  "nativeOperation": "cancelMcpConnection",
  "readOnly": false,
  "sideEffects": [
    "Cancel the original OAuth connection action; does not promise cancellation of unrelated work"
  ],
  "requiredPermissions": [
    "Unified site roles: access AND write; issued/current intersection",
    "Unified scope: workspace:write; issued/current intersection",
    "Original server workspace membership and role policy",
    "Original employee visibility and device scope checks"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "write",
    "requiredScope": "workspace:write",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "DELETE",
      "path": "/mcp/v1/workspaces/{workspace}/bots/{id}/mcp/connections/{connectionId}"
    },
    "native": {
      "method": "DELETE",
      "path": "/api/workspaces/{workspace}/bots/{id}/mcp/connections/{connectionId}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  }
}
```

输入文件模板：

```json
{
  "id": "<id>",
  "connectionId": "<connectionId>"
}
```

```sh
ziwei-workspace bots cancelMcpConnection --input-file "<business-input.json>" --json --contract v1
```

<!-- operation:actions.wait -->
### actions wait

Bounded readonly polling of the original actions.get endpoint until a terminal state or the overall --timeout. No action is created and no server wait/cancel endpoint is invented.

输入 schema：

```json
{
  "type": "object",
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "workspace": {
      "type": "string",
      "description": "可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。"
    }
  },
  "additionalProperties": false
}
```

行为、权限与真实查询入口：

```json
{
  "nativeTool": "ziwei_get_action",
  "readOnly": true,
  "sideEffects": [],
  "requiredPermissions": [
    "Unified site roles: access AND read; issued/current intersection",
    "Unified scope: workspace:read; issued/current intersection",
    "Original server workspace membership and role policy"
  ],
  "unifiedAuthorization": {
    "requiresAccess": true,
    "requiredRole": "read",
    "requiredScope": "workspace:read",
    "nativeOwnerAdmin": false,
    "verification": "server every request; issued/current roles and scopes intersect native policy"
  },
  "supportsDryRun": false,
  "idempotency": "unsupported",
  "idempotencyScope": null,
  "resultQuery": {
    "command": "ziwei-workspace actions get --id <actionId>",
    "idField": "action.id or id",
    "note": "Use only the original server action ID; a CLI requestId is not a receipt"
  },
  "transports": {
    "managed": "supported",
    "native": "supported"
  },
  "routes": {
    "managed": {
      "method": "GET",
      "path": "/mcp/v1/workspaces/{workspace}/actions/{id}"
    },
    "native": {
      "method": "GET",
      "path": "/api/workspaces/{workspace}/actions/{id}"
    }
  },
  "idempotencyByTransport": {
    "managed": "unsupported",
    "native": "unsupported"
  },
  "cliImplementation": "poll actions.get with one shared deadline; no mutation retry"
}
```

输入文件模板：

```json
{
  "id": "<id>"
}
```

```sh
ziwei-workspace actions wait --input-file "<business-input.json>" --json --contract v1
```

## 明确不支持项

- `actions cancel`：The workspace backend has no generic action cancel endpoint. Bot control stop and cancelMcpConnection have their documented, narrower boundaries.
- `bots force-abandon`：Privileged failure recovery is not exposed by this CLI version.
- `bots failure-finalization`：Privileged failure recovery is not exposed by this CLI version.

- 员工机器 client_credentials、全站 OP 退出和原 stdio MCP 的统一授权迁移未由本 CLI 实现。

## 版本与线上边界

CLI 2.0.0 · 规范 1.3.0 · 身份契约 1.0.1 · 机器契约 v1 · 文档 2.0.0 · 更新 2026-10-22

此文档和三个匿名入口是候选源码的一部分。服务器准备期 legacy 与 CLI 默认 unified 必须分别核对；统一切换需经受控发布窗口、完整配置/显式绑定及验收，不能用长期兼容替代交付。包构建/安装、纯 handler/本地 HTTP、真实 OP、生产源码和公网读取分别验收。未部署前公网与生产 SSO 保持 pending。
