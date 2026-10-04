# 紫薇项目管理与 AI 接手手册

> **唯一维护入口**：本文是紫薇项目的当前状态、开发约定、运维流程和 AI 接手说明。
>
> **项目目录**：`D:\灵光爸爸拆解`
>
> **文档状态**：以 2026-10-04 工作区实际代码为准；每次结构、运行方式或功能边界发生变化时必须更新本文。

> **当前本机运行态**：当前 `ziwei_user` 已接入工作区 `bjc-ops`。文中的 `test-111` 是默认示例和历史验收 fixture；接手时必须先读取 `data/ziwei_user.json` 与 `/readyz`，不要把示例工作区当成当前运行工作区。

> **版本事实**：本次 Hermes 独立人格改动位于分支 `codex/hermes-independent-profile`；服务器已按该分支部署，生产 Git `main` 仍保持不变。工作树仍保留既有未跟踪临时文件 `tmp_gzgov.html`。不要在未审查 `git status --short` 前执行 reset、clean 或覆盖式 checkout。

### 2026-10-05 通用 ziwei_user daemon 配对（本地已验证，服务器未部署）

- 归属层：daemon、API/A2A 鉴权、SQLite/repository、CLI 和前端设备引导；目标是让任意远程电脑安装同一个 `ziwei_user`，一次配对后发现并连接该电脑上的 Claude、Codex、Gemini、Hermes 四类 Agent。
- 网页设备入口通过 `POST /api/workspaces/:slug/devices/pairing` 生成短时一次性配对码；目标电脑执行 `ziwei_user connect --api ... --code ...`，服务器只返回一次 workspace 绑定的设备凭证，心跳、runtime 注册和 A2A 请求使用该设备凭证。配对码和完整凭证不会写入审计日志。
- SQLite 新增 `device_pairing_codes`、`device_credentials` 及索引；配对消费和设备/凭证写入在同一事务中完成，撤销或停用设备后凭证立即失效。成员可以配对自己控制的电脑，但设备删除、停用和其它管理操作仍需 owner/admin。
- CLI 增加用户目录模式和 npm `bin`：`npm install --global github:jinjinli226-netizen/ziwei` 后使用 `ziwei_user connect` / `ziwei_user start`；配置、日志、动作状态写入用户目录，执行工作目录取配对时的当前目录，不落到 npm 包缓存。项目 checkout 模式仍保留给本地开发。
- 前端设备弹窗已改为通用四 Agent 配对引导，移除依赖当前项目路径的 `install-ziwei-user.ps1` 命令；正式域名证书无需额外 CA，私有证书仍可通过 `--tls-ca-file` 指定。
- 新建数字员工时不再把 Hermes 设为默认运行时；页面会优先选择当前 `ziwei_user` 发现的第一个 Agent，四个运行时仍可在同一选择器中分别配置，Hermes profile 只在选择 Hermes 时出现。
- 本地证据：配对/API 鉴权、四 runtime 心跳、CLI、引导契约和真实子进程 daemon→HTTP heartbeat/A2A 链路均有测试；`test/daemon-link.test.mjs` 使用临时 API、临时用户目录和真实 daemon 进程，确认设备 online 且四类 runtime 均回报。服务器尚未替换，必须完成全量门槛后再部署。
- 当前未覆盖：多设备对同一工作区的 runtime metadata 聚合和按设备的员工调度仍需后续设计；本轮不把第二台电脑的状态伪装成第一台，也不以全局 A2A token 代替新设备凭证。回滚方式是恢复本节涉及的代码提交并保留/恢复部署前 SQLite 备份；未部署前不会触碰服务器数据。

## 1. 先看结论

紫薇当前已经具备可运行的本地工作区产品闭环：Vue 前端、Express API、SQLite 持久化、本机 `ziwei_user` 桥接 daemon、A2A action、真实 CLI 运行时发现、任务执行事件、对话收件箱、数字员工、自动化、文档、技能、邀请、设备和通知链路都已接入代码。

当前通过的本地质量门槛：

```text
npm test       125 passed
npm run lint   passed
npm run build  passed
```

本轮在已有初始化账号的实例上补充了公开注册入口：`POST /api/auth/register` 会创建新的本地账号并自动登录；填写已有工作区标识时以 `member` 身份加入，填写不存在的标识时创建新工作区并成为 Owner。`/api/auth/setup` 仍只用于空数据库的首次初始化，避免把后续注册误判成重复初始化。

最近一次验证环境为 Windows、Node v24.13.0、npm 11.6.2；当前分支为 `codex/hermes-independent-profile`，工作区只保留既有未跟踪临时文件。接手时先运行 `git status --short`，把这些修改视为现有工作，不要重置、清理或覆盖。

这不等于所有部署边界都完成。远端 Git 同步、生产级 PostgreSQL/Redis/对象存储、云端 OAuth、计费、真正的沙箱隔离以及完整浏览器逐页截图验收仍属于后续工作。不要把这些项目写成“已完成”。

### 2026-10-04 发布与真实链路验证

- 服务器 `154.202.118.5` 已部署分支 `codex/hermes-independent-profile` 的提交 `8a95ac8`；服务器 `main` 未被改写。部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T104845Z.before-8a95ac8`。
- 服务器 `ziwei-api` 重启后保持 active；本地和公网 `/healthz` 均返回 200。服务器前端构建产物包含岗位说明内联编辑入口。
- 最新服务器替换已快进到 `59f0715`；部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T114756Z.before-59f0715`。systemd 已配置 `ZIWEI_TLS_CERT_FILE=/etc/ziwei/server.crt`，Nginx 已增加精确 `/server.crt` 反代并通过语法检查。
- 本机 `data/ziwei_user.json` 以 `bjc-ops` 为工作区，A2A 令牌与服务器已重新同步；本机 `/readyz` 为 ready，daemon 日志持续记录 `heartbeat` 和 `a2a_poll` 成功。
- 真实服务器动作已完成两次独立验收：`runtime=Hermes`、`profile=ziwei-aigc`，分别返回 `HERMES_PROD_PROFILE_OK` 和 `HERMES_PROD_PROFILE_RECHECK_OK`，结果均为 `succeeded`。服务器返回结果包含独立 profile，profile 不存在时仍会明确失败。
- 本机和服务器 `bjc-ops` 均已创建数字员工“调研大师”：本机 ID 为 `employee_53dae986-9446-4e05-b474-3e0c000472a6`，服务器 ID 为 `employee_f5deedce-1404-4764-86ae-835c4f219bc6`，两者都绑定 `runtime=Hermes`、`profile=ziwei-research`。该 profile 拥有独立的 `SOUL.md`、记忆、会话和技能目录；本机 `executeRuntime` 返回 `RESEARCH_PROFILE_OK`，服务器真实 A2A 链路返回 `SERVER_RESEARCH_PROFILE_OK`。服务器 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T021917Z.before-research-master`；生产 `main` 未修改。
- MCP 管理入口已部署：`/mcp/v1/workspaces/:slug/employees`、`/tasks`、`/documents` 由独立 bearer 文件和显式工作区白名单保护，MCP 客户端只调用 HTTPS API，repository 负责所有持久化。服务器 Nginx 已为 `/mcp/` 增加反代；本机 `ziwei-research` profile 已注册 `ziwei_management`，通过服务器真实 MCP 链路完成员工列表、描述更新回读与原值恢复，确认没有直接打开 SQLite。令牌文件和服务器自签 CA 仅保存在被忽略的 `data/` 文件中。
- 本轮代码验证：此前数字员工/MCP 版本为 `npm test` 104/104；当前引导补丁的本地门槛为 `npm test` 111/111、`npm run lint`、`npm run build`，公网引导入口待部署后复测。

### 2026-10-04 正式域名证书切换进度

- 已在服务器安装 Certbot，并为 `qzelynth.top` / `www.qzelynth.top` 配置了可回滚的 ACME webroot：`/var/www/letsencrypt/.well-known/acme-challenge/`。Nginx 已通过语法检查，源站直连挑战文件返回 200。
- 真实 Let’s Encrypt webroot 申请已执行但未通过：两个域名当前仍解析到 Cloudflare 代理 IP，CA 从公网获取挑战文件时收到 403。没有生成或替换任何证书，现有 `/etc/ziwei/server.crt` 与 `/etc/ziwei/server.key` 保持不变。
- 继续申请前需将 Cloudflare 中 `@` 和 `www` 临时切换为 DNS only（灰云），或改用 Cloudflare DNS-01。解析切回服务器 `154.202.118.5` 后再重试；签发成功才会切换 Nginx/systemd 到 `/etc/letsencrypt/live/qzelynth.top/`。
- 本轮服务器 Nginx 配置备份：`/etc/nginx/sites-available/ziwei.20261004T121751Z.before-qzelynth-acme.bak`。重复的旧备份 symlink 已移出 `sites-enabled`，当前 `nginx -t` 无重复 `server_name` 警告。

### 2026-10-04 主域名正式证书已切换

- `qzelynth.top` 的 A 记录已直连腾讯云服务器 `154.202.118.5`；真实 Let’s Encrypt webroot 申请成功，证书位于 `/etc/letsencrypt/live/qzelynth.top/`，有效期至 2027-01-02。Certbot 自动续期任务已启用，`certbot renew --dry-run --no-random-sleep-on-renew` 模拟续期成功，并配置 deploy hook 自动 reload Nginx。
- Nginx 已切换到 `fullchain.pem` / `privkey.pem`，systemd `ziwei-api` 的 `ZIWEI_TLS_CERT_FILE` 已同步到公开 fullchain；切换前备份为 `/etc/nginx/sites-available/ziwei.20261004T141659Z.before-letsencrypt.bak` 和 `/etc/systemd/system/ziwei-api.service.d/onboarding.conf.20261004T141659Z.before-letsencrypt.bak`。
- 真实验证：使用正常 TLS 校验连接 `qzelynth.top`，Node 报告 `authorized=true`，证书主题为 `qzelynth.top`、签发者为 Let’s Encrypt YR1；直连源站 `/healthz=200`、`/server.crt=200`，下载证书 SHA-256 与服务器 fullchain 一致；Nginx 与 `ziwei-api` 均 active。
- `www.qzelynth.top` 当前仍解析到 Cloudflare 代理 IP，未纳入本次证书 SAN；需要把 `www` 也设为灰云并直连 `154.202.118.5` 后，再重新申请包含 `www` 的证书。当前正式可用入口是 `https://qzelynth.top`。

### 2026-10-04 已有工作区的注册入口

- 问题归属：API/auth 与登录前端。生产复现证据是已有账号时 `POST /api/auth/setup` 返回 `400 本机已经完成初始化，请直接登录`，页面“首次使用，创建账号”因此无法创建第二个账号。
- 修复内容：新增 `POST /api/auth/register`，前端登录页增加“注册新账号”；注册成功会建立真实 `local_users`、工作区成员关系和会话，不直接操作 SQLite 文件。若存在同邮箱的待接受邀请，会在注册事务中绑定原成员记录。
- 本地验证：`npm test` 113/113、`npm run lint`、`npm run build` 全部通过；注册成功、加入已有工作区、自动登录和重复邮箱错误均有 HTTP 测试覆盖。
- 生产验证：服务器 `/opt/ziwei` 已快进到 `7fa17dd`，部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T151310Z.before-7fa17dd`；构建成功并重启 `ziwei-api`，服务保持 active。公网 `GET /api/auth/status=200`、已有邮箱注册返回预期 `400`、注册预检 `OPTIONS=204`，正式页面构建产物包含“注册新账号”。

### 2026-10-04 新注册用户的 ziwei_user 引导

- 问题归属：前端 onboarding 状态与成员权限兼容。新注册账号是 `member`，工作区设置读取会被后端正确返回 403；此前 `load()` 把它和设备、任务请求放在同一个 `Promise.all`，导致离线心跳检查没有执行。同时“稍后”标记使用全浏览器共享 key，旧账号关闭过引导会抑制新账号的首次提示。
- 修复内容：成员跳过 owner/admin 专用的设置读取，继续加载设备和工作区基础数据；引导关闭标记按认证用户和工作区隔离。检测到真实 `ziwei_user` 离线且当前账号未关闭过时，打开包含 API 地址、工作区、证书下载和安装命令的连接引导。没有伪造在线状态，也不依赖 AuraBaba daemon。
- 本地验证：`npm test` 116/116、`npm run lint`、`npm run build` 全部通过；UI contract 覆盖成员权限下的加载路径、新账号登录后加载与引导 key 隔离。
- 生产验证：服务器已快进到 `5b50452`，部署前 SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T161858Z.before-5b50452`；前端构建成功，`ziwei-api` 保持 active，公网 `/healthz=200`，正式页面已返回包含新成员加载逻辑的构建包。数据库只读核对确认该账号属于 `test-111` 且 `ziwei_user` 状态为 offline；刷新账号页面后应进入离线引导。

## 2. 60 秒启动和验收

在项目根目录打开 PowerShell：

```powershell
Set-Location 'D:\灵光爸爸拆解'

# 第一次或依赖变化后执行
npm install

# 启动前先确认没有重复实例
Get-NetTCPConnection -LocalPort 5178,4178,20242 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess,State

# 启动前端和后端；已有服务运行时不要重复启动
npm run dev

# 另开一个 PowerShell，启动本机桥接器
npm run ziwei:start

# 查看桥接器状态
npm run ziwei:status
```

浏览器入口：

```text
http://127.0.0.1:5178/test-111/home
```

快速健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4178/healthz
Invoke-RestMethod http://127.0.0.1:20242/readyz
Invoke-RestMethod http://127.0.0.1:4178/api/workspaces/test-111/summary
```

只改了前端时，可单独运行 `npm run dev:frontend`；只改了后端时，可单独运行 `npm run dev:backend`。修改 daemon 或 `src/` 运行时后，必须重启 `ziwei_user`，否则旧进程不会加载新代码。

## 3. 服务、端口和日志

| 组件 | 原生入口 | 端口 | 职责 | 主要日志 |
| --- | --- | ---: | --- | --- |
| Vue/Vite 前端 | `npm run dev:frontend` | 5178 | 页面、路由、交互、实时刷新 | `.local/logs/frontend.log` |
| Express 后端 | `npm run dev:backend` | 4178 | API、认证、领域写入、A2A API | `.local/logs/backend.log` |
| `ziwei_user` | `npm run ziwei:start` | 20242 | 心跳、动作轮询、CLI 执行、结果回传 | `.local/logs/daemon.log` |
| 健康监控 | `npm run diagnose` / `npm run monitor` | 无 | 记录前后端健康状态 | `.local/logs/health.log` |

端口归属固定为 5178/4178/20242。不要为了排查随意换端口、另起一套业务实例或终止用户正在使用的服务。需要隔离测试时使用临时测试端口和独立数据目录，并在结束后清理。

本机配置：

```text
data/ziwei_user.json       # 不提交令牌；当前本机以文件内容为准，并引用本机私有 TLS CA 路径
data/ziwei.sqlite          # 本地持久化数据库
 data/a2a.token             # 本机 A2A 令牌，禁止写入日志或提交
.local/runtime/             # daemon 动作状态
.local/server.crt           # 服务器自签名证书副本，仅供本机 daemon 的 NODE_EXTRA_CA_CERTS 使用
.local/logs/                # 追加日志，单文件超过 5 MiB 会轮转
```

## 4. 系统架构和数据流

```text
浏览器 Vue
  │ fetch / WebSocket / SSE
  ▼
backend/app.mjs（Express API）
  │ repository / models / auth / sanitize / storage
  ▼
SQLite（data/ziwei.sqlite）
  │ 创建 task.execute / conversation.execute A2A action
  ▼
ziwei_user daemon（daemon/ziwei_user.mjs）
  │ poll → ack → ActionDispatcher → local action/runtime adapter
  ▼
本机 CLI（Codex、Claude、Gemini、Hermes）
  │ action.stage / action.output / result
  ▼
后端持久化事件 → WebSocket 优先、SSE fallback → 页面实时更新
```

职责边界：

- `frontend/src/App.vue`：页面路由、工作区入口和页面组合；不要在这里伪造业务数据。
- `frontend/src/components/WorkspaceShell.vue`：全局侧栏、顶部快捷托盘、工作区切换和统一导航。
- `frontend/src/api.js`：前端 API 封装；新增后端能力应先在这里建立明确方法。
- `backend/app.mjs`：HTTP 路由、鉴权边界和请求编排；持久化逻辑下沉到 repository。
- `backend/repository.mjs`：业务实体和状态变更的持久化入口，禁止在路由里直接拼 SQL。
- `backend/db.mjs`：SQLite 连接、表结构和迁移初始化；新增字段必须兼容已有数据库。
- `backend/realtime.mjs`：通知 WebSocket/SSE 通道。
- `backend/storage.mjs`：本地内容寻址对象存储边界。
- `backend/sanitize.mjs`：用户输入 HTML 净化边界。
- `backend/git-sync.mjs`：当前仅本地 Git 导入/导出，不代表远端 Git 已完成。
- `src/daemon.mjs`：动作幂等、ACK 后租约、超时、取消、工作目录校验和事件分类。
- `src/local-action.mjs`：允许的本地动作和运行时执行入口。
- `src/runtime-adapters.mjs`：本机 CLI 发现、版本/模型发现、代理继承、流式输出解析和公开推理摘要。
- `daemon/ziwei_user.mjs`：心跳、A2A 轮询、动作执行和终态回传；在线状态只认自己的心跳。

## 5. 当前真实功能边界

### 已落地并可继续维护

- 工作区创建、独立 slug 路由、工作区切换和账号会话注销。
- 任务看板、列表、负责人视图、状态流转、任务详情、消息、附件和 due date。
- 数字员工创建、运行时选择、任务安排、持久会话和对话收件箱。
- `ziwei_user` 首次安装引导、心跳、就绪状态、设备和 Agent CLI 版本发现。
- Codex/Claude/Gemini/Hermes 本机 CLI 适配；Codex 使用真实本机配置和系统代理，不使用伪造输出。
- Hermes 独立人格：数字员工可绑定本机 Hermes profile；执行时隔离 `HERMES_HOME`，并把岗位说明注入真实 task/conversation prompt。profile 不存在时明确失败，不回退主 profile。服务器当前运行 `codex/hermes-independent-profile`，已用真实 A2A action 验证 `runtime=Hermes`、`profile=ziwei-aigc` 和独立输出。
- 数字员工配置页已接入员工级环境变量、自定义 JSON 参数、MCP 状态/健康检查和 Hermes profile 发现；敏感变量使用 AES-256-GCM 加密存储，列表与审计不暴露原值。当前环境变量和自定义参数完成配置持久化，尚未注入 A2A/CLI 执行环境；MCP 仍是员工、任务、文档的窄管理面，不提供这两类配置工具。
- MCP 客户端继续通过 HTTPS /mcp/v1 窄管理面调用 repository，不直接打开 SQLite；开放能力明确限定为员工、任务和文档。
- 数字伙伴岗位说明页支持内联编辑；保存只更新岗位说明，不再打开完整的数字伙伴配置弹窗。
- A2A action 的创建、去重、ACK、事件、执行租约、结果、失败和过期处理。
- 公开推理摘要、命令/工具安全摘要、CLI 输出量和阶段状态；不展示模型原始私有思维链。
- 文档目录树、文件夹、Markdown、二进制附件、下载、回收站、净化和本地 Git 导入/导出。
- Skills 的文本、文件、URL、ZIP 和在线工位导入，校验、版本、停用、卸载和回滚。
- 邀请生命周期、设备管理、成员管理、API Key、Webhook、自动化、日历和通知实时通道。
- 浅色品牌主题、统一蓝色主色、跨页面快捷“数字伙伴创建”入口和运行状态展示。

### 2026-10-04 数字员工配置页验证

- 本地 `npm test` 104/104、`npm run lint`、`npm run build` 通过；隔离 HTTP 链路使用真实 `scripts/ziwei-mcp.mjs` 客户端验证 health、员工列表和窄管理面能力。
- 未启动或修改 5178/4178/20242 生产入口，未写入生产 SQLite；既有 `tmp_gzgov.html` 保持未跟踪。

### 2026-10-04 新用户服务器连接引导（本地与服务器已验证）

- 归属层：前端引导 + CLI 配置 + API 公开证书入口；不直接写 SQLite，不依赖 AuraBaba daemon。
- 首次账号页要求明确填写工作区标识；设备连接弹窗显示当前 API 地址、工作区和证书下载入口。Windows、macOS、Linux 命令都携带明确的 `--api` 与 `--tls-ca-file`，不会通过关闭 TLS 校验来掩盖证书问题。
- `GET /server.crt` 只返回配置的公开 PEM 证书；缺失、格式错误或包含私钥时拒绝服务。CLI 会校验证书文件存在并把路径写入本机 `data/ziwei_user.json`，启动器继续通过 `NODE_EXTRA_CA_CERTS` 注入 daemon 子进程。
- 本地证据：`npm test` 111/111、`npm run lint`、`npm run build` 通过；隔离 HTTP 链路验证 `/healthz=200`、证书下载 `200`、首次账号创建 `201` 且工作区标识持久化；另以临时配置跑过真实本地 daemon 心跳，`/readyz` ready 且设备 online。
- 服务器证据：`/opt/ziwei` 已部署 `59f0715` 并重启 `ziwei-api`；公网 `/healthz=200`、前端 `200`、`/api/auth/status=200`、未授权 MCP `401`；公网 `/server.crt=200`，`application/x-x509-ca-cert`，下载 SHA-256 与 `/etc/ziwei/server.crt` 一致。Nginx 既有重复 `server_name` 警告仍存在，但配置语法检查成功。
- 回滚：代码执行 `git revert 59f0715` 后重新构建/重启；数据库恢复 `/opt/ziwei-backups/ziwei.sqlite.20261004T114756Z.before-59f0715`；Nginx 与 systemd 原文件备份在同一部署时间戳下的 `.bak` 文件中。未验证边界仍包括真实新用户浏览器下载自签证书后的跨平台安装体验，以及正式域名证书替换。

### 明确延期或有边界的能力

- 远端 Git 仓库同步：当前只保留受控的本地 Git 导入/导出。
- 生产级 PostgreSQL、Redis、对象存储、队列和多实例部署。
- OAuth/SSO、计费、伙伴市场、云端权限模型和生产沙箱隔离。
- 完整浏览器逐页像素对比、四态截图证据和跨浏览器兼容验收。
- 原始模型思维链：页面只展示 provider 提供的公开 reasoning summary；没有公开摘要时不能伪造。

### 当前架构风险

- SQLite、对象存储和自动化 scheduler 都是单机实现；scheduler 使用单进程约 15 秒轮询，没有分布式锁，不适合多实例部署。
- `backend/db.mjs` 当前使用启动时建表和兼容性 `ALTER TABLE`，还没有独立的 migration/version 目录。涉及结构变更时必须先备份数据库，并补充可重复执行的迁移测试。
- 当前工作区有较多未提交修改；在形成领域化提交前，不要把工作树当作干净发布版本。
- 当前自动化测试使用 Node `--test`、HTTP 测试和 UI contract，没有 Playwright 级别的跨浏览器像素验收。

## 6. 扩展新功能的标准流程

功能状态统一使用下面的枚举，并附证据，不使用没有上下文的“完成”：

```text
implemented       已写入代码，但可能还未完成真实运行验收
verified          代码、自动化测试和真实链路均有证据
blocked           有明确外部阻塞，记录阻塞原因和解除条件
deferred          明确延期，记录触发条件
needs-confirmation 需要用户或产品确认范围
```

### 6.1 先写工作项

每项改动先在 issue、计划文件或交接记录中写清：

```text
目标：用户能完成什么动作
边界：哪些不在本次范围
入口：页面路由和 API 路由
数据：新增/修改哪些持久化字段
执行链：是否需要 A2A、daemon 或 CLI
验收：至少一个自动化测试 + 一个真实运行验证
风险：兼容、权限、数据迁移、回滚方式
```

### 6.2 后端改动顺序

1. 在 `backend/db.mjs` 增加兼容初始化或迁移。
2. 在 `backend/repository.mjs` 增加读写方法和状态约束。
3. 在 `backend/app.mjs` 增加参数校验、权限判断和 HTTP 错误。
4. 在 `frontend/src/api.js` 增加明确的 API 方法。
5. 为成功、失败、权限、重复请求和旧数据库各补测试。

路由不能直接操作 SQLite；不要把业务规则只写在前端；所有用户提交的 HTML、文件名、路径和 URL 都要经过现有净化/边界检查。

### 6.3 数字员工和运行时改动顺序

A2A 动作必须遵循：

```text
create pending → daemon poll → ack → action.started
→ action.stage/output → result succeeded/failed
```

新增动作类型时必须同时处理：

- 幂等键和重复投递。
- ACK 后的执行租约和过期判断。
- AbortSignal 取消、超时和 CLI 退出码。
- 结果和失败信息脱敏。
- 前端实时事件和刷新后的历史恢复。
- 无 daemon、daemon 离线、CLI 未安装和网络不可达时的可读错误。

不要用固定模型目录、静态版本或假在线状态代替 `ziwei_user` 的真实发现结果。不要把 AuraBaba daemon 作为紫薇的运行依赖。

### 6.4 前端改动标准

- 所有异步操作必须有 loading、成功、失败和空状态。
- 页面显示的数据必须来自 API 或实时事件；演示数据只能存在于显式 fixture/test 中。
- 选择器使用项目组件，不要恢复浏览器原生 `<select>` 作为员工创建的运行时/模型选择器。
- 任务状态由后端动作结果驱动；用户拖拽只是发起状态变更，不能成为执行状态的唯一来源。
- 长列表、CLI 输出和活动记录必须有边界滚动，不得让内容撑破弹窗或页面。
- 保持紫薇浅色品牌、蓝色主色和共享 UI 令牌；不要重新引入紫色主题残留。

## 7. 常见故障排查

### 页面显示数字员工离线

```powershell
Invoke-RestMethod http://127.0.0.1:20242/healthz
Invoke-RestMethod http://127.0.0.1:20242/readyz
npm run ziwei:status
Get-Content .local/logs/daemon.log -Tail 80
```

`healthz` 只表示进程活着；`readyz` 还要求最近心跳成功并且接入当前工作区。页面只应以 ready/heartbeat 判断在线。

### 任务显示 `A2A action timed out after 600000ms`

这代表动作在 daemon 的 10 分钟执行窗口内没有终态结果，常见根因是 CLI 网络不可达、CLI 进程卡住、工作目录错误或 daemon 未回传结果。不要先把前端提示改成成功。

排查顺序：

```powershell
Get-Content .local/logs/daemon.log -Tail 120
Invoke-RestMethod http://127.0.0.1:20242/readyz
# Windows 代理配置
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer
```

当前 Codex 适配器会自动继承显式 `HTTP_PROXY`/`HTTPS_PROXY`，没有显式变量时读取启用的 Windows Internet Settings 代理。原有失败记录会继续显示失败；修复后需要重新发送任务，不会篡改历史结果。

### 任务执行了但对话没有回复

先查 action 和事件，再查 conversation 关联：

```powershell
Invoke-RestMethod 'http://127.0.0.1:4178/a2a/v1/actions?workspace=test-111&agent=ziwei_user&status=all&includeAcked=1'
Invoke-RestMethod 'http://127.0.0.1:4178/api/workspaces/test-111/summary'
```

重点确认 `task.execute` 是否带有正确的 `conversationId`，ACK、事件和 result 是否都已回传。历史动作关联逻辑在 `backend/repository.mjs`，不要只修页面拼接。

### 修改代码后页面仍是旧行为

- 前端：确认 Vite 页面已刷新，必要时使用强制刷新。
- 后端：重启 4178 服务。
- daemon/运行时：重启 `ziwei_user`，因为 Node 进程会缓存模块。
- 不要同时启动第二个 daemon；先查 20242 的占用 PID。

### 端口冲突

先查实际占用和日志，不要直接杀进程：

```powershell
Get-NetTCPConnection -LocalPort 5178,4178,20242 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess,State
```

## 8. 测试、构建和发布门槛

每次代码修改至少执行：

```powershell
npm test
npm run lint
npm run build
```

涉及以下内容时增加专项验证：

| 改动 | 必跑专项 |
| --- | --- |
| A2A/daemon/运行时 | `node --test test/daemon.test.mjs test/a2a-actions.test.mjs test/runtime-adapters.test.mjs`，再做一次真实短 CLI 请求 |
| 路由/API/权限 | `node --test test/routes.test.mjs test/api.test.mjs test/permissions-devices.test.mjs` |
| 文档/存储/文件 | `node --test test/docs-dataflow.test.mjs test/storage-sanitize-git.test.mjs` |
| Skills | `node --test test/skills-import.test.mjs` |
| 前端契约 | `node --test test/ui-contract.test.mjs test/e2e/aura-14-point.spec.mjs` |

发布前必须确认：

1. 三项质量命令通过。
2. `/healthz`、`/readyz` 返回预期状态。
3. 新增功能在真实 API 和真实 SQLite 上走通一次。
4. 没有 token、Cookie、Authorization、邀请码或用户正文进入日志和提交。
5. `data/ziwei.sqlite` 和 `data/` 私有配置已备份，且不会被提交。
6. 文档中的“已完成/延期/已知限制”与代码一致。

## 9. 数据、权限和回滚

变更数据库结构时优先采用向后兼容的 `CREATE TABLE IF NOT EXISTS`、`ALTER TABLE ... ADD COLUMN` 或明确版本迁移；不得要求用户删除 SQLite 才能启动。破坏性数据变更必须提供备份和回滚步骤。

发布前备份示例：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item data/ziwei.sqlite "data/ziwei.sqlite.$stamp.bak"
```

回滚原则：

- 先停止新代码对应的服务，再恢复代码和数据库备份。
- 不删除用户日志、动作历史和附件对象。
- 对失败的 A2A action 使用重试/新 dedupe key，不直接改写旧终态。
- 回滚后重新执行健康检查和最小真实任务。

## 10. 给其他 AI 的接手顺序

`HANDOFF-CLAUDE-进度记录.md` 是一次历史接手记录，保留用于追溯，不是当前事实来源。任何新 AI 接手本项目时，按下面顺序执行：

1. 阅读本文，再读 `README.md`、`HANDOFF.md` 和最近的 `docs/plans/*.md`。
2. 执行 `git status --short`，把已有工作区修改视为用户资产，不要覆盖或清理。
3. 检查 5178/4178/20242 和三份日志；不要为了“确认启动”重复启动服务。
4. 运行 `npm test`、`npm run lint`、`npm run build`，建立当前基线。
5. 根据问题所在层定位：页面 → API → repository/SQLite → A2A → daemon → CLI。
6. 先复现并记录证据，再改一个根因；不要用假数据、静态成功状态或扩大超时掩盖问题。
7. 完成功能后跑对应专项测试和一次真实本地链路验证。
8. 更新本文的“当前状态”“已知限制”和“最近验证”；同时在 `HANDOFF.md` 追加简短时间线。
9. 最终报告必须说明：改了什么、为什么、验证了什么、未验证什么、如何回滚。

接手时禁止做的事：

- 不读取、输出或提交令牌、Cookie、完整 Authorization、邀请码和用户私密正文。
- 不依赖 AuraBaba daemon，不为了验证关闭用户自己的 `ziwei_user`。
- 不把旧失败记录改写成成功，不把截图或静态 fixture 当成真实链路。
- 不在没有测试和回滚方案时直接改数据库结构。
- 不把“构建通过”写成“浏览器验收完成”。

## 11. 后续路线图

### P0：持续可靠性

- 补一键重试失败 conversation/action 的用户入口，并保留原始失败记录。
- 增加 CLI 进程退出、网络不可达、代理不可用和取消动作的独立状态展示。
- 把真实浏览器验收纳入发布门槛，覆盖工作区、任务、数字员工、对话、文档和 Skills。

### P1：生产化基础

- 抽象 SQLite 到 PostgreSQL 的 repository 适配层。
- 引入持久队列/锁和多实例 daemon 协调，替换单进程轮询假设。
- 将对象存储、日志、指标和审计事件做可配置后端。
- 完善权限矩阵、OAuth/SSO 和密钥轮换策略。

### P2：外部集成

- 远端 Git 双向同步和冲突处理。
- 伙伴市场、Webhook 管理界面和更多外部连接器。
- 计费、配额和组织级审计报表。

## 12. 工作记录模板

新工作完成后，在 `HANDOFF.md` 或对应计划文件追加：

```markdown
### YYYY-MM-DD <主题>
- 目标：
- 变更：
- 影响文件：
- 数据/兼容：
- 验证：`npm test`、`npm run lint`、`npm run build`、真实链路
- 未验证或延期：
- 回滚方式：
```

这份手册是维护入口，不替代代码、测试和运行日志。任何结论都必须能回到真实文件、真实 API、真实进程或真实测试结果。
