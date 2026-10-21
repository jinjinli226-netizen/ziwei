import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {operations, unsupportedOperations, CLI_VERSION, STANDARD_VERSION, DEFAULT_API} from '../packages/workspace-cli/src/registry.mjs';

export const DOCUMENT_VERSION = '1.0.0';
export const UPDATED_AT = '2026-10-22';
const sourceBase = 'b8c8a669e0fb18623166628bd3e1088dfb133249';
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
  const metadata = `CLI ${CLI_VERSION} · 规范 ${STANDARD_VERSION} · 机器契约 v1 · 文档 ${DOCUMENT_VERSION} · 更新 ${UPDATED_AT}`;
  const intro = [
    '# 紫薇驾驶舱 CLI 接入说明', '',
    metadata, '',
    `本站：${DEFAULT_API}。公开索引：${DEFAULT_API}/docs；完整说明：${DEFAULT_API}/docs/cli.md；发现索引：${DEFAULT_API}/llms.txt。匿名阅读这些说明不授予任何业务权限。`, '',
    '## 定位与当前交付状态', '',
    '紫薇驾驶舱组织工作区、数字员工、Bot、任务、文档和已授权电脑。`@ziwei/workspace-cli` 的独立可执行命令是 `ziwei-workspace`，适合负责这些工作区资源的员工和管理员。业务请求直接访问本站已有后台，服务标识固定为 `workspace`。', '',
    '本主版本新 CLI 默认机器契约 v1，也接受显式 `--contract v1`。原有 `ziwei_user` 是电脑执行客户端，原管理 MCP 仍保留；手机 Control 的 `ziwei` 是配套工具。本 CLI 不安装或启动这些程序。', '',
    '当前是源码实现和本地 artifact 候选包，尚未发布到公共 npm，未部署这次文档路由或 CLI 改动到生产。以下绝对 URL 是本站发布目标，公网可用性 pending；仓库文件和本地测试不代表该 URL 已上线。统一账号/SSO 目标尚未配置，跨站身份验收 C13 为 pending。', '',
    `源码基线 commit：${sourceBase}；候选实现标识：workspace-cli-contract-v1；命令目录 SHA-256：${registrySha}。该指纹标识本文实际引用的 registry，不是安装包校验和，也不是生产版本。最终源码 commit、artifact SHA-256 与发布状态应从交付记录分别核对。`, '',
    `已有操作见下方从 registry 生成的 ${operations.length} 项命令/schema。原生网页登录身份和受限 managed 身份的覆盖不同，逐项以 transports 为准；未实现的后台功能仍可沿其原入口使用，不能由本 CLI 自动推断支持。未覆盖：统一身份、通用 actions cancel、dry-run、特权 force-abandon/failure-finalization、其他站点的业务命令。`, '',
    '## 安装、升级、卸载与包校验', '',
    '运行要求：Node.js >=20.11 与 npm；使用 Node 内置 fetch，无运行时第三方依赖。设计面向 Windows、macOS、Linux；各平台的实际安装验收以交付证据为准，不将本地 Windows 验证称为三平台实测。', '',
    '分发来源是本项目维护者交付的独立 tarball `ziwei-workspace-cli-1.0.0.tgz`，需要通过已授权的交付渠道取得文件及其独立可信 SHA-256。当前没有可宣称的公共 npm 包或公共下载地址。不要把旧电脑客户端的下载包当成本包。以下所有尖括号内容都必须替换为自己的授权参数。', '',
    '在 PowerShell 中先验证；文件名可按实际交付路径替换：', '',
    fence + 'powershell',
    '(Get-FileHash -Algorithm SHA256 -LiteralPath "<artifact-file.tgz>").Hash',
    '# 将结果与可信交付记录中的 <expected-sha256> 逐字比对，相同才安装。',
    'npm install --global "<artifact-file.tgz>"',
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
    '统一身份的目标是同一人或员工身份、每站分别授权及限定令牌受众。当前保留迁移期 native 登录与 legacy managed 工作区/设备凭据，未接通受信 SSO；`auth login --mode unified` 返回 `NOT_SUPPORTED` 并注明 pending。不会按同名或邮箱合并账号，不接受客户端自报 employeeId 作为身份。', '',
    'native 模式默认使用已有账号和工作区成员权限，需 `--email`、`--workspace`、`--password-stdin`。密码只从 stdin 读，命令不弹浏览器或交互提示，也不注册用户。下面 PowerShell 模板从仅本人可读的输入文件提供密码；也可通过自己的可信秘密管理器提供 stdin。不要把真实密码写进 argv、命令历史、业务 JSON 或日志。', '',
    fence + 'powershell',
    'Get-Content -LiteralPath "<protected-password-file>" -Raw | ziwei-workspace auth login --email "<account-email>" --workspace "<workspace-slug>" --password-stdin --profile "<profile>" --account "<account-slot>" --purpose person --non-interactive --json --contract v1',
    'ziwei-workspace auth status --profile "<profile>" --account "<account-slot>" --purpose person --json',
    'ziwei-workspace auth status --local --profile "<profile>" --account "<account-slot>" --purpose person --json',
    'ziwei-workspace config show --profile "<profile>" --account "<account-slot>" --purpose person --json',
    'ziwei-workspace auth logout --profile "<profile>" --account "<account-slot>" --purpose person --json',
    fence, '',
    '`auth status` 默认实际请求原 `/api/auth/me`（native）或对应工作区管理 health（managed）验证，只有成功才显示 `verification:server`；`--local` 仅检查本地非敏感摘要，`verification:local` 不表示权限有效。native/managed 身份来源明确标为 legacy。`config show` 只输出公开 selector/是否配置等信息，不输出凭据。', '',
    'managed 模式只导入操作者明确提供的原生短期受限凭据，不扫描其他程序配置、不使用管理员通用 token。必须选择 `--purpose employee`；这只是隔离存储用途，不是员工身份认证。凭据文件要求原生 `managed:true`、`audience:"ziwei-management"`、唯一 workspace、deviceId、未来 expiresAt、匹配本站 apiBase 及原 token。无通用凭据样例，也不在文档放真实账号或密钥。', '',
    fence + 'sh',
    'ziwei-workspace auth login --mode managed --purpose employee --managed-file "<protected-managed-credential.json>" --profile "<profile>" --account "<employee-slot>" --non-interactive --json',
    '# 或仅用 --managed-stdin，从可信秘密管理器通过 stdin 提供原生凭据 JSON；两者互斥。',
    'ziwei-workspace auth status --purpose employee --profile "<profile>" --account "<employee-slot>" --json',
    'ziwei-workspace auth logout --purpose employee --profile "<profile>" --account "<employee-slot>" --json',
    fence, '',
    '凭据槽按站点服务、API origin、profile、account 与 person/employee 用途隔离。可用 `ZIWEI_WORKSPACE_CONFIG_DIR` 显式指定独立绝对配置目录；CLI 不自动读取 ziwei_user 或其他站的凭据。本版本使用本地凭据文件并请求目录 0700/文件 0600，不是系统密钥链或加密保险库；Windows 上还应由操作者核对目录 ACL。秘密输入文件也须限制 OS 访问权限。', '',
    '每次业务调用继续由原服务校验会话/受众、工作区成员、角色、员工可见性、资源所有权及设备范围。安装、离线 catalog 或本地存在凭据不会产生权限。无凭据返回退出码 3；身份有效但资源/动作不允许返回 4。managed 不能跨其受限 workspace/origin 使用。', '',
    '`auth logout` 默认清理当前槽并尝试撤销该 native 会话，分别报告 localCleared 和 remoteRevocation；`--local` 仅本地清理。managed 远端撤销未由本 CLI 提供，标记 unsupported。网络失败可能是 unknown/failed，不能因此声称所有会话已撤销。无跨站全部退出操作。', '',
    '## 公共参数与输入规则', '',
    '| 参数 | 精确含义 |',
    '| --- | --- |',
    '| `--help` / `--version` | 文本帮助/版本；具体命令后接 `--help` 可读取其 schema |',
    '| `--json` | 机器调用显式声明；本主版本普通调用本来就输出单个 v1 JSON |',
    '| `--non-interactive` | 不等交互；缺参数或凭据立即失败 |',
    '| `--contract v1` | 本包仅支持 v1，默认也是 v1 |',
    '| `--profile <name>` | 环境槽名称，默认 default |',
    '| `--timeout <ms>` | 整数 100–300000，默认 30000，含响应正文读取；wait 采用总等待上限 |',
    '| `--api <HTTPS-origin>` | 默认本站 origin；无 userinfo、query 或业务子路径，仅隔离本机测试允许 loopback HTTP |',
    '| `--account <slot>` | 本站账号槽标识，默认 default，不代表已认证账号 |',
    '| `--purpose person` / `--purpose employee` | 凭据用途隔离；默认 person |',
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
    '`capabilities` 是离线命令/schema 说明，`authorization.verification:offline`、`grantsVerified:false`，不等于当前账号已获授权。`config show`、`auth login/status/logout` 是本地配置/身份辅助命令；`actions wait --id "<original-action-id>" --timeout 30000` 只轮询已有 action，不创建动作。', '',
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
    '本项目已有管理 MCP 是 stdio 服务器 `scripts/ziwei-mcp.mjs`。可核对[官方仓库源码](' + sourceRepository + '/blob/' + sourceBase + '/scripts/ziwei-mcp.mjs)（私有仓库需相应仓库权限）。它在内部调用原管理 HTTP API，HTTP 管理 API 地址不是远程 MCP transport URL。本包不新增 `ziwei-workspace mcp` 命令，也没有可宣称的公网 HTTP MCP endpoint。', '',
    '已通过平台接入的员工沿原 ziwei_user 自动配置与短期设备/workspace scope 工作，不需要手工复制凭据。需要外部客户端的操作者须单独取得原授权源和受限凭据，使用如下 stdio 客户端配置模板；路径均为自己的已授权来源/私有文件占位。', '',
    jsonBlock({mcpServers:{ziwei_management:{command:'node', args:['<authorized-source>/scripts/ziwei-mcp.mjs'], env:{ZIWEI_API_BASE:DEFAULT_API, ZIWEI_MCP_WORKSPACE:'<workspace-slug>', ZIWEI_MCP_TOKEN_FILE:'<protected-managed-token-file>'}}}}), '',
    'MCP 继续复用原业务 schema 和受限授权，不因读取本文或安装本 CLI 获得管理员、其他工作区或其他站权限。MCP stdout 保留 JSON-RPC 协议；原电脑执行客户端与手机绑定约束按原系统生效。', '',
    '## 命令目录与完整输入 schema', '',
    '以下内容直接由本包 registry 生成。命令拼写保留原资源和动作（包括大小写）；inputSchema 是该命令实际 CLI 校验。transports.native/managed 表示实现覆盖，routes 说明对应原 API；idempotencyByTransport 存在时须优先按实际传输判断幂等。readOnly、sideEffects、requiredPermissions、supportsDryRun、idempotency 与 resultQuery 同 capabilities 共用来源。Bot 的 data 保留原生嵌套 schema/业务校验，示例中的空对象需要根据原生能力补齐，不能据此推断任意字段有效。', '',
    '逐项 JSON 示例只展示根 schema 所需字段；请把它保存到自己的业务输入文件再使用该条命令。所有 ID、路径和其他尖括号值都是占位符。', ''
  ].join('\n');
  const catalog = operations.map(operation => [
    `<!-- operation:${operation.name} -->`,
    `### ${operation.name.replace('.', ' ')}`, '',
    operation.description, '',
    '输入 schema：', '', jsonBlock(operation.inputSchema), '',
    '行为、权限与真实查询入口：', '', jsonBlock(behavior(operation)), '',
    '输入文件模板：', '', jsonBlock(exampleForSchema(operation.inputSchema)), '',
    fence + 'sh', `ziwei-workspace ${operation.name.replace('.', ' ')} --input-file "<business-input.json>" --json --contract v1`, fence, ''
  ].join('\n')).join('\n');
  const unsupported = Object.entries(unsupportedOperations).map(([name, reason]) => '- `' + name.replace('.', ' ') + '`：' + reason).join('\n');
  const markdown = intro + catalog + '\n## 明确不支持项\n\n' + unsupported + '\n\n## 版本与线上边界\n\n' + metadata + '\n\n此文档和三个匿名入口是当前候选源码的一部分。包构建/安装、本地 HTTP、生产源码发布与公网读取分别验收；未部署前公网与 SSO 保持 pending。本站业务 API 和私有资料继续执行原鉴权。\n';
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
    '</ul>',
    '<p>当前候选源码和本地 artifact 尚未发布到公共 npm；此次改动未部署到生产，公网可用性 pending。统一账号/SSO 尚未配置，C13 pending。旧 ziwei_user 电脑客户端、原管理 stdio MCP 与配套 Control ziwei 保留各自用途。</p>',
    '<p>这些说明可匿名读取；阅读文档、安装 CLI 和离线 capabilities 不授予业务权限。业务 API、员工、工作区和设备仍由原服务器逐次鉴权。链接是发布目标，未部署前不能据本文推断已线上可读。</p>',
    '</main></body></html>', ''
  ].join('\n');
  const discovery = [
    '# 紫薇驾驶舱', '',
    '> 本站管理工作区、数字员工、Bot、任务和文档；命令 ziwei-workspace，包 @ziwei/workspace-cli。', '',
    metadata, '',
    `- 文档索引: ${DEFAULT_API}/docs`,
    `- 完整 CLI 使用说明和 schema: ${DEFAULT_API}/docs/cli.md`,
    `- 本发现索引: ${DEFAULT_API}/llms.txt`, '',
    '范围：本地候选源码/独立 artifact；未发布到公共 npm；此次文档与 CLI 改动未部署，公网读取 pending。',
    '身份：迁移期 legacy native / legacy managed；统一账号与 SSO pending（C13）。',
    'MCP：原 scripts/ziwei-mcp.mjs 是 stdio，接入模板见完整说明；不提供虚构的公网 HTTP MCP URL。',
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
