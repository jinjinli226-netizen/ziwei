# 紫薇

紫薇是一个前后端分离的智能工作区原型，复刻了 AuraBaba `test-111` 的核心工作区、任务、文档、运行时、技能、自动化和连接器流程。项目中的本机 daemon 由我们自己实现，服务名称是 `ziwei_user`。

## 已实现

- Vue 3 + Vite 前端，使用本地 `@ziwei/ui@0.1.1` 组件包。
- Express 5 独立后端，API 监听 `127.0.0.1:4178`。
- Node 24 内置 SQLite，数据库文件为 `data/ziwei.sqlite`。
- A2A v1 Agent Card、Task、Task list、Message、状态查询接口。
- 邀请成员、登记设备、创建数字员工和自动化会真实写入 SQLite。
- `daemon/ziwei_user.mjs` 本机 daemon：心跳、A2A 任务轮询、本地健康检查。
- 独立诊断日志：`.local/logs/backend.log`、`frontend.log`、`daemon.log`、`health.log`。

## 启动

```powershell
npm install
npm test
npm run build
npm run dev       # 前端 + 后端
npm run daemon    # 单独启动 ziwei_user daemon
npm run ziwei:setup -- --workspace test-111 --api http://127.0.0.1:4178 --health-port 20242
npm run ziwei:status # 查看本机 ziwei_user 配置和健康状态
npm run ziwei:version
npm run ziwei:start  # 已配置时复用现有进程，否则后台启动 ziwei_user
npm run diagnose  # 单次健康检查
```

`npm run dev` 启动前端 `5178` 和后端 `4178`；daemon 健康接口使用 `20242`。参考 AuraBaba daemon 已占用 `20241`，紫薇不会抢占它。

## ziwei_user 安装引导

紫薇提供本地安装脚本，安装脚本只调用当前项目里的 npm 和 Node.js，不下载或启动 AuraBaba CLI。配置完成后会检查已有的 `ziwei_user`，没有在线进程时自动后台启动本机 daemon，并等待首次心跳：

```powershell
# PowerShell
.\scripts\install-ziwei-user.ps1 --workspace test-111 --api http://127.0.0.1:4178 --health-port 20242

# Windows cmd
scripts\install-ziwei-user.bat --workspace test-111 --api http://127.0.0.1:4178 --health-port 20242
```

引导会把不含令牌的配置写到 `data/ziwei_user.json`（也可用 `ZIWEI_CONFIG` 指定路径），再调用 `scripts/start-ziwei-user.mjs` 复用或后台启动 daemon。`ziwei:status` 同时检查本机 `ziwei_user` 的 `/healthz` 存活和 `/readyz` 就绪状态；只有最近心跳已接入当前工作区才报告在线。配置命令拒绝 `--token`、`--auth`、`--secret` 等凭据参数，也会清理 API 地址中的查询串、凭据和片段，避免把敏感值写入配置或日志。

## API 入口

- `GET /healthz`
- `GET /api/workspaces/test-111/summary`
- `GET|POST /api/workspaces/test-111/tasks`
- `PATCH /api/tasks/:id`、`GET|POST /api/tasks/:id/messages`
- `POST /api/tasks/:id/state`
- `GET|POST|PATCH|DELETE /api/workspaces/test-111/automations`（模板、运行记录和执行接口见 `/api/automations/:id/*`）
- `GET|POST|PATCH|DELETE /api/workspaces/test-111/documents`（单文档操作使用 `/api/documents/:id`）
- `GET|POST /api/workspaces/test-111/members`
- `GET|POST /api/workspaces/test-111/devices`
- `POST /api/workspaces/test-111/heartbeat`（仅接受 `ziwei_user`，用于设备与运行时健康链路）
- `GET|POST /api/workspaces/test-111/api-keys`、`POST /api/api-keys/:id/revoke`、`POST /api/api-keys/:id/rotate`
- `GET|POST /api/external/workspaces/:slug/*`（需要 `Authorization: Bearer zwi_...` 或 `X-Ziwei-Api-Key`）
- `GET|POST /api/workspaces/test-111/notifications`（支持 `unread`/`archived`、未读统计和已读；`GET /api/workspaces/test-111/notifications/stream` 提供 SSE 实时边界）
- `GET|POST /api/workspaces/test-111/conversations`、`GET|POST /api/conversations/:id/messages`（新对话、消息和附件元数据）
- `GET|POST /api/workspaces/test-111/skills`、`PATCH /api/skills/:id`
- `POST /api/skills/:id/uninstall`、`GET /api/skills/:id/versions`、`POST /api/skills/:id/rollback`
- `GET|POST /api/workspaces/test-111/employees`
- `GET /a2a/v1/agents`
- `POST /a2a/v1/register`
- `GET|POST /a2a/v1/actions`、`POST /a2a/v1/actions/:id/ack`、`POST /a2a/v1/actions/:id/result`
- `GET|POST /a2a/v1/tasks`
- `GET /a2a/v1/tasks/:id`
- `POST /a2a/v1/tasks/:id/messages`

设备与运行时在线状态只由 `ziwei_user` daemon 的心跳决定。超过心跳有效期的设备和运行时会自动显示为离线；AuraBaba 或其他参考 daemon 的进程状态不会参与紫薇页面健康判断。

## 命名约定

产品/工作区叫“紫薇”，本机连接 daemon 服务叫 `ziwei_user`，工作区兼容 slug 保留为 `test-111`。任何访问令牌、Cookie、Authorization 和密码都不能写入日志或提交到仓库。

## 界面约定

页面布局、导航层级、操作位置和流程参考 AuraBaba；配色、字体、Logo 和基础组件使用紫薇自己的品牌与 `@ziwei/ui`。保持浅色背景，主操作和选中态使用组件库的紫色令牌 `--ziwei-violet`，成功与告警色沿用组件库语义色。不要把原站蓝灰配色作为视觉验收要求。

## 还未接生产的部分

生产 PostgreSQL/Redis、云端 OAuth、对象存储、真正的任务执行沙箱、WebSocket/队列、计费和伙伴市场仍保留在适配边界中；本地 SQLite 已支持 API Key 轮换、A2A action 重试、通知 SSE、Webhook HMAC 签名与重试、文档回收站和技能回滚。

## 许可证

本项目以 MIT 许可证发布，详见 [LICENSE](LICENSE)。




