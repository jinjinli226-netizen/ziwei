import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {operations, unsupportedOperations, CLI_VERSION, STANDARD_VERSION, DEFAULT_API} from '../packages/workspace-cli/src/registry.mjs';

export const DOCUMENT_VERSION = '2.1.0';
export const IDENTITY_CONTRACT_VERSION = '1.0.1';
export const UPDATED_AT = '2026-11-02';
const sourceBranch = 'codex/ziwei-current-baseline-20261029';
const nativeMcpSourceRef = '4bd8b22a55464928bcd799eeb9e73137c61b2aa6';
const sourceRepository = 'https://github.com/jinjinli226-netizen/ziwei';
const outputRoot = fileURLToPath(new URL('../docs/public/workspace-cli/', import.meta.url));
const fence = '```';
const jsonBlock = value => [fence + 'json', JSON.stringify(value, null, 2), fence].join('\n');
const escapeHtml = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function behavior(operation) {
  const {name, description, inputSchema, ...details} = operation;
  return details;
}

function exampleForSchema(schema, name = 'value') {
  if (schema.enum?.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find(value => value !== 'null') : schema.type;
  if (type === 'object') return Object.fromEntries((schema.required || []).map(key => [key, exampleForSchema(schema.properties?.[key] || {}, key)]));
  if (type === 'array') return [];
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return schema.minimum || 0;
  return `<${name}>`;
}

export function buildWorkspaceCliDocs() {
  const registrySha = crypto.createHash('sha256').update(JSON.stringify(operations)).digest('hex');
  const metadata = `CLI ${CLI_VERSION} · 规范 ${STANDARD_VERSION} · 身份契约 ${IDENTITY_CONTRACT_VERSION} · 机器契约 v1 · 文档 ${DOCUMENT_VERSION} · 更新 ${UPDATED_AT}`;
  const releaseBase = `${DEFAULT_API}/downloads/workspace-cli/${CLI_VERSION}`;
  const artifactName = `ziwei-workspace-cli-${CLI_VERSION}.tgz`;
  const artifactUrl = `${releaseBase}/${artifactName}`;
  const releaseUrl = `${releaseBase}/release.json`;
  const intro = [
    '# 紫薇驾驶舱 CLI 接入说明', '',
    metadata, '',
    `本站：${DEFAULT_API}。公开索引：${DEFAULT_API}/docs；完整说明：${DEFAULT_API}/docs/cli.md；发现索引：${DEFAULT_API}/llms.txt。匿名阅读这些说明不授予任何业务权限。`, '',
    '## 定位与当前交付状态', '',
    '紫薇驾驶舱组织工作区、数字员工、Bot、任务、文档和已授权电脑。`@ziwei/workspace-cli` 的独立可执行命令是 `ziwei-workspace`，适合负责这些工作区资源的员工和管理员。业务请求直接访问本站已有后台，服务标识固定为 `workspace`。', '',
    '本主版本新 CLI 默认机器契约 v1，也接受显式 `--contract v1`。原有 `ziwei_user` 是电脑执行客户端，原管理 MCP 仍保留；手机 Control 的 `ziwei` 是配套工具。本 CLI 不安装或启动这些程序。', '',
    '本站三个文档入口可匿名读取。CLI 默认 unified，使用公共设备授权、按站 AT/RT、续期与退出；人员可按需申请长期授权，已登记员工可使用受限机器身份。文档可读、版本包分发、统一身份配置和真实业务完成是不同状态，应分别核对。', '',
    '截至本次文档更新，本站 `GET /api/identity/config` 公开配置为 `mode:unified`、`ready:true`、`legacyAllowed:false`，并声明 native 与 mcp 两种 CLI HTTP 路由族。运行时以所选站点的实时响应为准；配置缺失不自动降级旧密码。`ready:true` 只表示身份配置就绪，不代表所有模型或 SSO 全流程均已验收。每次业务仍须验证当前身份、工作区和原生资源授权。', '',
    `官方源码：[当前维护分支](${sourceRepository}/tree/${sourceBranch})（私有仓库需权限）；命令目录 SHA-256：${registrySha}。该指纹只标识本文实际引用的 registry，不是安装包校验和或生产版本。版本包的来源与校验值见下方发布回执；电脑客户端的实际安装版本另行核对。`, '',
    `已有操作见下方从 registry 生成的 ${operations.length} 项命令/schema。统一身份只在服务器公开配置明确允许的 native/mcp HTTP 路由上传本站 AT：优先对应 native 路由，否则可用原有 MCP 路由。原生资源、角色和幂等边界保持逐项定义。员工绑定可能只允许自己的员工/Bot 路径，集合查询可被明确拒绝。未覆盖：全站 OP 退出、通用 actions cancel、dry-run、特权 force-abandon/failure-finalization、其他站点业务命令。`, '',
    '## 安装、升级、卸载与包校验', '',
    '运行要求：Node.js >=20.11 与 npm；使用 Node 内置 fetch，无运行时第三方依赖。设计面向 Windows、macOS、Linux；各平台的实际安装验收以交付证据为准，不将本地 Windows 验证称为三平台实测。', '',
    `本站按版本分发独立包 [${artifactName}](${artifactUrl})；同目录 [release.json 发布回执](${releaseUrl})用于核对版本、SHA-256 与发布来源。安装使用这个版本化 tarball，不使用公共 npm 包名，也不要把 \`ziwei_user\` 电脑客户端的下载包当成本包。`, '',
    '在 PowerShell 中下载包与发布回执，先比对可信 SHA-256，再安装：', '',
    fence + 'powershell',
    `Invoke-WebRequest -Uri "${artifactUrl}" -OutFile "${artifactName}"`,
    `Invoke-WebRequest -Uri "${releaseUrl}" -OutFile "release.json"`,
    `(Get-FileHash -Algorithm SHA256 -LiteralPath "${artifactName}").Hash`,
    '# 将结果与 release.json 及可信交付记录中的 SHA-256 比对，相同才安装。',
    `npm install --global "./${artifactName}"`,
    '# 也可使用同一个版本化 HTTPS 包地址安装：',
    `npm install --global "${artifactUrl}"`,
    'ziwei-workspace --version',
    'ziwei-workspace --help',
    fence, '',
    'macOS/Linux 可用 `shasum -a 256 "<artifact-file.tgz>"` 或 `sha256sum "<artifact-file.tgz>"` 比对同一可信值。仅计算 hash 不能证明来源可信。升级和回退都安装对应已核验版本的交付 tarball；升级不会授予额外业务权限。', '',
    fence + 'sh',
    'npm install --global "<verified-new-or-previous-artifact.tgz>"',
    'npm uninstall --global @ziwei/workspace-cli',
    fence, '',
    '卸载 npm 包仅移除程序。需要清理当前凭据槽时先运行对应 selector 的 `auth logout`；其他 origin/profile/account/purpose 槽须分别处理。不得把卸载描述为全部站点或全部副本的会话撤销。', '',
    '## 登录、身份、权限和安全输入', '',
    '统一身份使用同一人或员工的受信 `(issuer, subject)`，每站分别授权并限制 audience。本站公共设备客户端固定 `ziwei-workspace-cli`，API audience 为 `ziwei-workspace-api`。默认申请 `openid workspace:read workspace:write`；人员可显式加 `--long-lived` 申请 `offline_access`，授权范围与有效期以服务端实际返回为准。不会按同名/邮箱合并账号，也不把客户端自报 employeeId、email 或角色当身份。', '',
    'CLI 默认 unified；`auth login --mode unified --workspace "<workspace-slug>"` 先匿名读取所选 origin 的 `GET /api/identity/config`，精确核对服务、client、audience、scope、issuer 与 readiness。可选 `ZIWEI_IDENTITY_ISSUER` 只作精确 pin；服务器配置缺失时不能使用缓存 issuer 降级。OP discovery issuer 必须一致，device/token/revocation endpoint 必须是该 issuer origin/realm 下的受信 HTTPS 地址，拒绝重定向。公开 `ready:true` 只表示本地配置齐备，不证明 OP/DNS/绑定/生产已验收。', '',
    '每次设备流生成随机 PKCE S256。login 返回公开 verificationUri/userCode 与 `state:authorization_required,completed:false`；CLI 不自动打开浏览器、不等人工输入、不隐式创建账号。device_code 与原 verifier 仅在私有凭据文件中跨进程保存，兑换/退出后删除，不进入 stdout、普通日志或安装包。', '',
    fence + 'sh',
    'ziwei-workspace auth login --mode unified --workspace "<workspace-slug>" --profile "<profile>" --account "<account-slot>" --non-interactive --json --contract v1',
    '# 在自己的浏览器访问公开 verificationUri 并输入 userCode；未批准时继续 pending。',
    'ziwei-workspace auth complete --profile "<profile>" --account "<account-slot>" --non-interactive --json',
    'ziwei-workspace auth wait --profile "<profile>" --account "<account-slot>" --timeout 30000 --non-interactive --json',
    'ziwei-workspace auth status --profile "<profile>" --account "<account-slot>" --json',
    'ziwei-workspace auth refresh --profile "<profile>" --account "<account-slot>" --non-interactive --json',
    'ziwei-workspace auth logout --profile "<profile>" --account "<account-slot>" --json',
    fence, '',
    '人员需要长期登录时，可将上面的 login 替换为以下命令，其余 complete/wait/status 步骤相同。长期授权取决于服务端策略与实际返回的期限，不保证固定天数：', '',
    fence + 'sh',
    'ziwei-workspace auth login --mode unified --purpose person --long-lived --workspace "<workspace-slug>" --profile "<profile>" --account "<account-slot>" --non-interactive --json',
    fence, '',
    '`auth status` 的安全摘要区分 `accessExpiresAt`、`refreshIdleExpiresAt`、`loginSessionExpiresAt` 和 `loginMode`。AT 到期不等于整次登录失效；刷新闲置期限随成功续期变化，最终会话上限仍由身份服务执行。缺少期限时不推算固定登录时长。', '',
    '`auth complete` 只在轮询间隔到期后兑换一次；`auth wait` 按 interval/slow_down 在总 --timeout 内等待，已知未批准时返回 `state:pending,completed:false,timedOut:true`，不把待批准说成登录完成。每流只允许一个兑换在途。终止拒绝/到期只清理对应版本；已发兑换或刷新超时/SIGINT保留 unknown，禁止自动重放。', '',
    'CLI 将 AT/RT 作为不透明凭据；登录或续期后的新 AT 必须请求 `GET /api/identity/me`，由服务器实际验签、逐次 confidential introspection 与原生绑定验证，并确认工作区 membership。续期必须保持原 issuer/subject；新轮换的 AT/RT 先持久保存，再验证新 AT，验证暂时不可用不会丢弃已经轮换的 RT。每个后续业务请求还需本站 access/read/write/admin 角色、scope 与原生资源权限交集；安装和本地凭据不授予权限。', '',
    '业务调用前，AT 临近过期且槽内有可用 RT 时会自动续期；也可显式运行 `auth refresh`。这不是后台常驻保活。业务返回 401 或网络失败时不重发业务请求；写入结果 unknown 仍须按原 action 回读。续期结果未知会保留围栏，`invalid_grant` 要求重新授权；不能靠重试刷新或重发业务绕过。', '',
    '员工可用自己的交互设备账号；非交互员工使用 `auth login --mode machine --purpose employee --workspace <slug> --worker-file <绝对私有JSON>`。受保护文件固定本站 issuer/origin/clientId/subject/clientSecret，仅已登记的单员工 client 可用；不借用共享管理员身份。机器 AT 最长 300 秒，经后端验签、实时 introspection 和原生绑定后使用；secret 不进凭据槽，不保存 RT，不能套用人员长期授权或 RT 自动续期，到期后需重新执行受限机器授权。', '',
    '每项命令公开 `unifiedAuthorization` 的实际 requiredRole/requiredScope，并与服务器两个路由族做对照测试。尤其 `phone-mcp configure` 是绑定管理，需当前 access + admin、workspace:write 及原生工作区 owner/admin；普通 task/document 写仍需 write。字段是离线规则，不能据此宣称当前账号有 grant。', '',
    '`auth status` 默认验证 `/api/identity/me`，区分 unified 与 legacy，并保留安全的服务器原生状态；`--local` 只报告本地非敏感摘要、`verification:local,serverVerified:false`。同一 origin/profile/account/purpose 的续期与注销使用跨进程身份锁，文件更新另用短锁和版本 CAS；logout 清除最新 AT/RT，迟到兑换不复活已退出的槽，并尽力显式撤销返回 token。异常清理失败或结果未知如实保留。', '',
    '统一模式 logout 默认只撤当前站点/槽最新 RT 和 AT，直接使用公共 client 的受信 OP revocation endpoint，不把 RT 发给业务 API。RFC 7009 HTTP 200 仅报告 `remoteRevocation:accepted,revocationConfirmed:false`，不证明 token 已 inactive。`--local` 为 not_requested；远端失败/超时不抹去 localCleared。它不代表全站或 OP SSO 退出。待批准设备码本地退出后按 OP 原期限失效，不虚称已取消 OP 授权。', '',
    '旧协议显式兼容：只有所选服务器公开声明 `mode:legacy,legacyAllowed:true` 时，CLI 才可使用 `--mode native` 或 `--mode managed`；本站当前 `legacyAllowed:false`，不提供这两个旧登录入口。旧密码、旧 Cookie、静态 owner Bearer 不能替代统一身份。已配对设备的受限管理 bootstrap 凭据沿原生设备守卫验证，不等于 CLI 人员登录。1.x 本地 legacy 记录仍可读取本地摘要和退出。', '',
    'legacy native 需 `--mode native`、`--email`、`--workspace`、`--password-stdin`。密码只从 stdin 读且不保存，记录原 Set-Cookie 会话。下面模板只供明确允许 legacy 的服务器使用；保护秘密输入文件及 OS 权限，不把真实密码放入 argv、历史、业务 JSON 或日志。', '',
    fence + 'powershell',
    'Get-Content -LiteralPath "<protected-password-file>" -Raw | ziwei-workspace auth login --mode native --email "<account-email>" --workspace "<workspace-slug>" --password-stdin --profile "<profile>" --account "<account-slot>" --purpose person --non-interactive --json --contract v1',
    'ziwei-workspace auth status --profile "<profile>" --account "<account-slot>" --purpose person --json',
    'ziwei-workspace auth status --local --profile "<profile>" --account "<account-slot>" --purpose person --json',
    'ziwei-workspace config show --profile "<profile>" --account "<account-slot>" --purpose person --json',
    'ziwei-workspace auth logout --profile "<profile>" --account "<account-slot>" --purpose person --json',
    fence, '',
    '显式 legacy status 实际请求原 `/api/auth/me`（native）或对应工作区管理 health（managed），成功才显示 `verification:server`。native/managed 来源标为 legacy。`config show` 只输出公开 selector/配置状态，不输出凭据。', '',
    'managed 模式只导入操作者明确提供的原生短期受限凭据，不扫描其他程序配置、不使用管理员通用 token。必须选择 `--purpose employee`；这只是隔离存储用途，不是员工身份认证。凭据文件要求原生 `managed:true`、`audience:"ziwei-management"`、唯一 workspace、deviceId、未来 expiresAt、匹配本站 apiBase 及原 token。无通用凭据样例，也不在文档放真实账号或密钥。', '',
    fence + 'sh',
    'ziwei-workspace auth login --mode managed --purpose employee --managed-file "<protected-managed-credential.json>" --profile "<profile>" --account "<employee-slot>" --non-interactive --json',
    '# 或仅用 --managed-stdin，从可信秘密管理器通过 stdin 提供原生凭据 JSON；两者互斥。',
    'ziwei-workspace auth status --purpose employee --profile "<profile>" --account "<employee-slot>" --json',
    'ziwei-workspace auth logout --purpose employee --profile "<profile>" --account "<employee-slot>" --json',
    fence, '',
    '凭据槽按站点服务、API origin、profile、account 与 person/employee 用途隔离。可用 `ZIWEI_WORKSPACE_CONFIG_DIR` 显式指定独立绝对配置目录；CLI 不自动读取 ziwei_user 或其他站的凭据。本版本使用本地凭据文件并请求目录 0700/文件 0600，不是系统密钥链或加密保险库；Windows 上还应由操作者核对目录 ACL。秘密输入文件也须限制 OS 访问权限。', '',
    '每次业务调用继续由原服务校验会话/受众、工作区成员、角色、员工可见性、资源所有权及设备范围。安装、离线 catalog 或本地存在凭据不会产生权限。无凭据返回退出码 3；身份有效但资源/动作不允许返回 4。managed 不能跨其受限 workspace/origin 使用。', '',
    'legacy native logout 清当前槽并尝试原会话退出；legacy managed 远端撤销未由本 CLI 提供，报告 unsupported。此项兼容退出与统一 OP grant 撤销有不同语义，均分别报告本地与远端结果。', '',
    '## 公共参数与输入规则', '',
    '| 参数 | 精确含义 |',
    '| --- | --- |',
    '| `--help` / `--version` | 文本帮助/版本；具体命令后接 `--help` 可读取其 schema |',
    '| `--json` | 机器调用显式声明；本主版本普通调用本来就输出单个 v1 JSON |',
    '| `--non-interactive` | 不等交互；缺参数或凭据立即失败 |',
    '| `--contract v1` | 本包仅支持 v1，默认也是 v1 |',
    '| `--profile <name>` | 环境槽名称，默认 default |',
    '| `--timeout <ms>` | 整数 100–300000，默认 30000，含响应正文读取；wait 采用总等待上限 |',
    '| `--api <HTTPS-origin>` | 默认本站 origin；无 userinfo、query 或业务子路径；仅显式 ZIWEI_WORKSPACE_ALLOW_LOOPBACK_HTTP=1 的隔离测试可用 literal loopback HTTP |',
    '| `--account <slot>` | 本站账号槽标识，默认 default，不代表已认证账号 |',
    '| `--purpose person` / `--purpose employee` | 凭据用途隔离；默认 person |',
    '| `--long-lived` | 人员 unified login 显式申请长期授权；期限由服务端决定，不适用于机器 client_credentials |',
    '| `--workspace <slug>` | 明确目标工作区，须通过原服务器权限验证；与业务 JSON 同字段不可重复 |', '',
    '公共参数在资源/动作前后都有效。重复参数、未知参数、非法超时或跨来源同字段冲突均拒绝。工作区 slug 使用 2–63 位字母数字、下划线或连字符。普通 JSON 输入保持长 ID 为字符串；金额按原 schema 的精确类型传递，不将字符串 ID/金额转换成浮点数。', '',
    '业务结构化输入三选一：`--input <JSON>`、`--input-file <path>`、`--input-stdin`。文件/标准输入必须是单个 JSON 对象。原 schema 顶层字段可用同名快捷参数，如 `--id "<action-id>"`、`--data "<JSON-object>"`；同一字段与 JSON 重复，即使值相同也拒绝。token/password/secret 等原文不得混入通用业务输入，应使用已有授权 Profile/环境引用。', '',
    fence + 'sh',
    'ziwei-workspace --profile "<profile>" --account "<account-slot>" employees list --json --contract v1',
    'ziwei-workspace employees list --input "{}" --profile "<profile>" --account "<account-slot>" --json',
    'ziwei-workspace tasks get --input-file "<task-query.json>" --profile "<profile>" --account "<account-slot>" --json',
    'ziwei-workspace actions get --id "<original-action-id>" --json',
    'ziwei-workspace capabilities --json --contract v1',
    fence, '',
    '`capabilities` 是离线命令/schema 说明，`authorization.verification:offline`、`grantsVerified:false`，不等于当前账号已获授权。`config show`、`auth login/complete/wait/refresh/status/logout` 是配置/身份命令；`actions wait --id "<original-action-id>" --timeout 30000` 只轮询已有 action，不创建动作。', '',
    '## v1 输出和固定退出码', '',
    '普通调用 stdout 只有一个 JSON 对象；参数错误也遵守。诊断/交互提示只可写 stderr；`--help`/`--version` 保留文本，原 MCP stdout 专用于协议。本包没有混用单 JSON 的流式输出或文件下载模式。', '',
    jsonBlock({schemaVersion:1, service:'workspace', ok:true, data:{native:{id:'<original-resource-id>'}}, requestId:'<cli-request-id>'}), '',
    jsonBlock({schemaVersion:1, service:'workspace', ok:false, error:{code:'FORBIDDEN', message:'<redacted-safe-message>', nativeCode:'<original-code-if-present>'}, requestId:'<cli-request-id>'}), '',
    '`data.native` 保留原服务响应。若响应有可识别异步状态，另提供 `data.operation`；`requestId` 只是本次 CLI 关联 ID，绝不是服务器回执。错误可保留 `error.nativeCode`、httpStatus 与必要脱敏详情。CLI 映射不会改后端 HTTP 状态。', '',
    '| 退出码 | error.code / 语义 |',
    '| --- | --- |',
    '| 0 | 请求被成功处理；异步受理不代表业务完成 |',
    '| 1 | INTERNAL_ERROR：内部异常 |',
    '| 2 | USAGE：命令、参数、本地输入或 schema 不合法 |',
    '| 3 | UNAUTHENTICATED：缺身份、过期或登录被拒绝 |',
    '| 4 | FORBIDDEN：身份有效但无资源/动作权限 |',
    '| 5 | NOT_FOUND：服务端确认不存在 |',
    '| 6 | CONFLICT：原服务的版本、状态或幂等键冲突 |',
    '| 7 | SERVICE_UNAVAILABLE：配置/网络/服务不可用，或只读等待/读取超时 |',
    '| 8 | OUTCOME_UNKNOWN：已发送写入可能执行，必须读回核实 |',
    '| 9 | NOT_SUPPORTED：此版本/后端不支持 |',
    '| 130 | CANCELLED：调用者取消；写入已发送时仍保留 outcomeUnknown |', '',
    '## 异步、幂等、超时和取消', '',
    '异步规范视图区分 accepted、running、succeeded、failed、unknown，保留 nativeState、原 serverReceiptId 与 resultQuery。accepted/running 的 completed:false；unknown 也不是业务完成。`ok:true` 是 CLI 请求成功，原业务 failed 可在 data.native/data.operation 中保留，调用方必须读取业务状态。Routine run ID 不一定是 action ID，要用该操作的真实 resultQuery。', '',
    jsonBlock({state:'accepted', completed:false, nativeState:'pending', serverReceiptId:'<original-action-id>', resultQuery:{command:'ziwei-workspace actions get --id <original-action-id>'}}), '',
    '写入只有一次 dispatch，no automatic write retry。写入超时、响应丢失或无效成功响应可能返回 OUTCOME_UNKNOWN；先保留原输入、幂等键、服务器 ID 与 resultQuery，再回读原资源/动作。没有 ID 时按原资源查询人工核实；不得把 requestId 当查询 ID，也不得自动重发来试探结果。只读请求/已有状态的 wait 超时返回 SERVICE_UNAVAILABLE，不把已知执行状态伪装成写入结果未知。', '',
    '命令目录的 idempotency 仅指原端点真实能力，其 scope、传输方式与字段见对应条目；支持键也不是自动重试保证。CLI 只透传原 input 中的 idempotencyKey，不自造服务器去重。尤其 native tasks create 和 conversations create 不支持服务端幂等，即使 managed 同名操作支持，也不能跨传输推广保证。bots update 普通立即更新也不支持幂等，仅原生 deferUntilIdle:true 路径具有 conditionalIdempotency 描述的去重能力。', '',
    '本包 `--dry-run` 明确返回 NOT_SUPPORTED，不能用真实执行冒充预览。查询副作用以 readOnly/sideEffects 为准：Bot list/get/runs 是原只读查询，mcpConnections 查询可能清理服务器进程内过期 OAuth relay 项，但不发设备动作或持久业务写入。', '',
    '`actions cancel` 不支持通用服务端取消。Ctrl+C 取消本地请求/等待；已发写入可能继续执行，此时 CANCELLED 保留 outcomeUnknown:true 和核实信息。Bot 原 control stop 与 cancelMcpConnection 仅按各自原边界作用，不保证停止所有后代/物理设备或其他会话。', '',
    '会创建员工、Profile、配置、文档、Routine 或真实执行的命令必须先确认业务授权。tasks create 的 execute:true、phone-mcp check/trial、Bot Routine/native/collaboration 等可能触发收费模型、设备或消息动作，按逐项 sideEffects 判断。例子只是占位模板，不是运行这些业务动作的授权。', '',
    '## 原管理 MCP 接入', '',
    '本项目已有管理 MCP 是 stdio 服务器 `scripts/ziwei-mcp.mjs`。可核对[管理 MCP 源码](' + sourceRepository + '/blob/' + nativeMcpSourceRef + '/scripts/ziwei-mcp.mjs)及上方当前维护分支（私有仓库需权限）。它内部调用管理 HTTP API，HTTP API 地址不是远程 MCP transport URL。本包不新增 `ziwei-workspace mcp` 命令，也不把 HTTP 管理 API 当作公网 MCP endpoint。', '',
    '原 stdio 脚本未新增统一 OP 授权、设备流或 RT 刷新。其保留的 managed token-file 模板只适用于原协议受控兼容条件，不能当成统一模式 CLI 的代理授权，也不能推断所有 Bot 管理 MCP 已迁完。CLI 的统一 AT HTTP 路由覆盖与 stdio 运行时身份迁移分别验收。既有 daemon pairing/A2A/terminal 机器协议有独立认证边界，不自动等于网站 MCP 授权。', '',
    '以下 stdio 模板须使用当前受支持流程取得的受限管理凭据，并由服务器原生策略校验；它不是 CLI 统一身份的代理登录入口，不能填入旧静态 owner 凭据绕过授权。路径均为自己的授权来源/私有文件占位：', '',
    jsonBlock({mcpServers:{ziwei_management:{command:'node', args:['<authorized-source>/scripts/ziwei-mcp.mjs'], env:{ZIWEI_API_BASE:DEFAULT_API, ZIWEI_MCP_WORKSPACE:'<workspace-slug>', ZIWEI_MCP_TOKEN_FILE:'<protected-managed-token-file>'}}}}), '',
    'MCP 业务 schema 与资源边界保留，原脚本 stdout 仍为 JSON-RPC。统一身份下每个实际员工运行时/工具的凭据获取、刷新、撤销、actor 与原生范围仍须专项验收；未完成时如实 pending，不借用共享管理员凭据。', '',
    '## 命令目录与完整输入 schema', '',
    '以下内容直接由本包 registry 生成。命令拼写保留原资源和动作（包括大小写）；inputSchema 是实际 CLI 校验。transports.native/managed 与 routes 说明原 API 族；unified 根据本站公开 cliTransports 在这些精确路由上使用 AT，不导入旧 managed token。idempotencyByTransport 须按实际选中的路由族判断。readOnly、sideEffects、requiredPermissions、supportsDryRun、idempotency 与 resultQuery 同 capabilities 共源。Bot data 保留原生嵌套校验，示例空对象须按原生能力补齐，不代表任意字段有效。', '',
    '混合群成员通过 `bots collaboration` 的 `data.members` / `data.memberDescriptors` 描述，运行时可为 Hermes、DSH、Codex；仍沿该操作的原员工、工作区、版本和授权边界。本包没有独立的 groups CLI 命令，不能把成员 schema 当作额外命令。', '',
    '逐项 JSON 示例只展示根 schema 所需字段；请把它保存到自己的业务输入文件再使用该条命令。所有 ID、路径和其他尖括号值都是占位符。', ''
  ].join('\n');
  const catalog = operations.map(operation => [
    `<!-- operation:${operation.name} -->`,
    `### ${operation.name.replaceAll('.', ' ')}`, '',
    operation.description, '',
    '输入 schema：', '', jsonBlock(operation.inputSchema), '',
    '行为、权限与真实查询入口：', '', jsonBlock(behavior(operation)), '',
    '输入文件模板：', '', jsonBlock(exampleForSchema(operation.inputSchema)), '',
    fence + 'sh', `ziwei-workspace ${operation.name.replaceAll('.', ' ')} --input-file "<business-input.json>" --json --contract v1`, fence, ''
  ].join('\n')).join('\n');
  const unsupported = Object.entries(unsupportedOperations).map(([name, reason]) => '- `' + name.replaceAll('.', ' ') + '`：' + reason).join('\n');
  const markdown = intro + catalog + '\n## 明确不支持项\n\n' + unsupported + '\n\n- 全站 OP 退出，以及为原 stdio MCP 新增统一 OP 设备授权/RT 刷新，不在本 CLI 的实现范围。\n\n## 版本与线上边界\n\n' + metadata + '\n\n文档正文、版本包及 release.json、实时身份配置和每次业务结果分别核对。公开文档可读不代表当前账号有业务权限；包可下载不证明目标电脑已经安装；配置 ready 不代表所有模型或 SSO 全流程均已验收。业务完成以原生资源或原 action 的真实终态为准；未知结果不自动重放。\n';
  const html = [
    '<!doctype html>', '<html lang="zh-CN">', '<head>', '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>紫薇驾驶舱 · AI 接入文档</title>',
    '<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:3rem auto;padding:0 1.25rem;line-height:1.75;color:#172b4d;background:#f8fbff}a{color:#245acc}code{background:#eaf1fb;padding:.1rem .3rem;border-radius:.25rem}li{margin:.5rem 0}</style>',
    '</head>', '<body><main>', '<h1>紫薇驾驶舱 · AI 接入文档</h1>',
    '<p>工作区、数字员工、Bot、任务、文档与受限电脑的接入说明。独立命令为 <code>ziwei-workspace</code>，包名 <code>@ziwei/workspace-cli</code>。</p>',
    `<p>${escapeHtml(metadata)}</p>`,
    '<ul>',
    `<li><a href="${DEFAULT_API}/docs/cli.md">完整 CLI Markdown：登录、参数、schema、命令、权限、退出码与 MCP</a></li>`,
    `<li><a href="${DEFAULT_API}/llms.txt">llms.txt 纯文本发现索引</a></li>`,
    `<li><a href="${DEFAULT_API}/docs">本站文档索引</a></li>`,
    `<li><a href="${artifactUrl}">${escapeHtml(artifactName)} 版本包</a> · <a href="${releaseUrl}">release.json 发布回执</a></li>`,
    '</ul>',
    '<p>CLI 默认 unified；本站本次核对的公开身份配置为 mode:unified、ready:true、legacyAllowed:false，并允许 native 与 mcp HTTP 路由族。运行时以实时 /api/identity/config 为准，不回退旧密码登录。人员可显式申请长期授权，已登记员工可使用受限机器身份。</p>',
    '<p>这些说明可匿名读取。版本包分发、目标电脑安装、身份配置与真实业务验收分别核对；文档上线不代表所有模型或 SSO 全流程均已验收。阅读文档、安装 CLI 和离线 capabilities 不授予业务权限，员工、工作区和设备仍由原服务器逐次鉴权。</p>',
    '</main></body></html>', ''
  ].join('\n');
  const discovery = [
    '# 紫薇驾驶舱', '',
    '> 本站管理工作区、数字员工、Bot、任务和文档；命令 ziwei-workspace，包 @ziwei/workspace-cli。', '',
    metadata, '',
    `- 文档索引: ${DEFAULT_API}/docs`,
    `- 完整 CLI 使用说明和 schema: ${DEFAULT_API}/docs/cli.md`,
    `- 本发现索引: ${DEFAULT_API}/llms.txt`,
    `- 版本包: ${artifactUrl}`,
    `- 发布回执: ${releaseUrl}`, '',
    `范围：独立 ziwei-workspace CLI；${operations.length} 项工作区操作/schema，不安装或启动 ziwei_user 电脑客户端或手机 Control。混合成员沿 bots collaboration，不另设 groups CLI。`,
    '身份：CLI 默认 unified；本站本次核对为 mode:unified、ready:true、legacyAllowed:false、native+mcp。每次授权以实时 /api/identity/config 与原生绑定为准。人员可选 --long-lived；机器身份必须使用已登记员工的 --worker-file，不保存 RT。',
    'MCP：原 scripts/ziwei-mcp.mjs 是 stdio，其管理 HTTP API 不等于远程 MCP transport；设备 bootstrap 与人员 CLI 授权各按原生范围校验。',
    '状态边界：文档读取、版本包分发、电脑安装、统一配置和真实业务完成分别核对；不代表所有模型或 SSO 全流程均已验收。',
    '能力目录是离线说明，不是当前账号授权；业务权限仍由原服务逐次校验。',
    '这是普通纯文本发现索引，不是授权接口，也不保证任何 AI 产品自动发现或执行。', ''
  ].join('\n');
  return {'index.html':html, 'cli.md':markdown, 'llms.txt':discovery};
}

export function writeWorkspaceCliDocs({outputDirectory = outputRoot, check = false} = {}) {
  const files = buildWorkspaceCliDocs();
  if (!check) fs.mkdirSync(outputDirectory, {recursive:true});
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(outputDirectory, name);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) throw new Error(`Public CLI documentation is stale or missing: ${name}`);
    } else fs.writeFileSync(target, content, 'utf8');
  }
  return Object.keys(files).length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(value => value !== '--check') || process.argv.length > 3) throw new Error('Usage: node scripts/build-workspace-cli-docs.mjs [--check]');
    const check = process.argv.includes('--check');
    const count = writeWorkspaceCliDocs({check});
    process.stdout.write(`workspace CLI docs ${check ? 'current' : 'generated'}: ${count} files; ${operations.length} operations\n`);
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
