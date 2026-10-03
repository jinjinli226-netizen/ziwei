# 紫薇项目 HandOff

> **当前维护入口**：请先阅读根目录 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)。本文保留阶段性交接时间线；其中较早的验证数字和“待完成”描述可能已经过时，当前状态以项目管理手册、代码和最近一次真实验证为准。

> **当前接管状态（2026-10-03）**：核心本地功能和真实 `ziwei_user`/A2A/CLI 链路已落地；最新工作区验证为 `npm test` 87/87、lint 和 build 通过。生产前端已修复 API 地址误指向本机 `127.0.0.1:4178` 的问题，默认使用当前 HTTPS 页面 origin，并保留显式 `VITE_API_URL` 覆盖。Codex CLI 已补上 Windows 系统代理自动继承，真实短请求验证成功。当前本机运行工作区是 `bjc-ops`，示例和历史验收仍可能使用 `test-111`，接手时以 `data/ziwei_user.json` 与 `/readyz` 为准。远端 Git、生产外部存储/队列、OAuth/计费/沙箱和完整浏览器截图验收仍延期。详细维护约定统一见 `PROJECT_MANAGEMENT.md`。

这份文档用于把当前工作交给 Claude 继续。项目根目录是：

```text
D:\灵光爸爸拆解
```

## 目标

紫薇是 AuraBaba 的自有实现，前后端分离，使用自己的 `ziwei_user` 作为本机桥接 daemon。后续实现只认紫薇自己的设备、心跳、A2A 动作和 Agent/CLI 发现，不依赖 AuraBaba daemon 是否运行。

## 当前架构和端口

| 服务 | 原生入口 | 端口 | 作用 |
| --- | --- | ---: | --- |
| 前端 | `npm run dev:frontend`，由 `npm run dev` 启动 | `5178` | Vue 3 + Vite 页面 |
| 后端 | `npm run dev:backend`，由 `npm run dev` 启动 | `4178` | Express + SQLite API |
| 本机桥接 | `npm run ziwei:start` | `20242` | `ziwei_user` 健康检查和就绪检查 |

端口已经登记为项目“紫薇”。不要换端口，也不要为端口登记另起一套服务。日志目录：

```text
D:\灵光爸爸拆解\.local\logs\backend.log
D:\灵光爸爸拆解\.local\logs\frontend.log
D:\灵光爸爸拆解\.local\logs\daemon.log
D:\灵光爸爸拆解\.local\logs\health.log
```

`data/ziwei_user.json` 是本机配置，当前 workspace 是 `test-111`，API 指向 `http://127.0.0.1:4178`，健康端口是 `20242`。不要把 token、Cookie 或认证头写入日志。

## 启动和检查

在项目根目录运行：

```powershell
npm run dev
npm run ziwei:start
npm run ziwei:status
```

状态检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4178/healthz
Invoke-RestMethod http://127.0.0.1:20242/readyz
Invoke-RestMethod http://127.0.0.1:4178/api/workspaces/test-111/summary
```

当前已验证的启动结果：前端 `5178`、后端 `4178`、`ziwei_user` `20242` 都能监听；最近一次 `ziwei_user` PID 为 `8232`，但 PID 会随重启变化。Windows 启动器已改成直接执行 `daemon/ziwei_user.mjs`，不要改回 `npm.cmd + detached`，后者在本机返回 `spawn EINVAL`。

## 已完成的关键实现

### 本机 ziwei_user

- `daemon/ziwei_user.mjs` 使用真实心跳、A2A action 拉取、ACK、执行和结果回传。
- 本机动作执行在 `src/local-action.mjs`，支持受控的 `message.deliver`、`local.message`、`task.execute`、`file.read`、`file.write`；命令执行有白名单和工作目录限制。
- `src/daemon.mjs` 负责过期、幂等、路径穿越/符号链接检查、超时和终态结果判断。
- `/healthz` 表示进程活着，`/readyz` 只有最近心跳成功才返回 ready；前端和 CLI 使用 ready 状态，不把进程存在误判为在线。
- 设备状态、bridge 版本、Agent CLI 版本分开存储；不能用 bridge 版本冒充 Agent CLI 版本。
- 首次进入页面且自己的 `ziwei_user` 不在线时，会弹出本机安装引导；引导只介绍紫薇自己的安装和启动命令。

### 前端页面

已有路由：

```text
/test-111/home
/test-111/issues
/test-111/autopilots
/test-111/calendar
/test-111/project-docs
/test-111/members
/test-111/runtimes
/test-111/skills
/test-111/settings
/me/invite
/invite?code=<one-time-code>
/test-111/open-platform
/test-111/inbox
```

已经接入的行为包括：

- 任务看板/列表、状态移动、任务详情、Markdown/纯文本/HTML 描述格式、消息、附件上传/下载/删除。
- 日历月/周/日视图、任务显示开关、人类任务过滤、项目过滤、月份切换和创建入口。
- 文档搜索、目录树、文件夹创建、Markdown 创建、文件上传、下载；后端按 base64 保留二进制文件。
- 团队页、设备列表、自己的 `ziwei_user` 在线状态、运行时版本、数字员工创建。
- 自定义运行时/模型下拉框，不使用浏览器原生 `<select>` 作为员工创建的运行时和模型选择器。
- 邀请记录、生成链接、撤销、查找和接受邀请。
- Skills 平台/团队标签、安装/停用、团队技能创建、`SKILL.md` 文件或文本导入。
- 设置、开放平台、A2A agent card 和收件箱基础入口。

主要前端文件：

```text
frontend/src/App.vue
frontend/src/api.js
frontend/src/components/WorkspaceShell.vue
frontend/src/style.css
```

## 当前验证证据

以下命令在这次交接前已通过：

```text
npm test       -> 56/56 passed
node --test test/routes.test.mjs -> 5/5 passed
npm run build  -> Vite build passed
npm run lint   -> lint ok: 19 source files checked
```

后端专项测试覆盖 A2A action、daemon 心跳、安装/状态、任务附件、二进制文档、邀请生命周期、技能导入、日历、自动化、API key、权限和资源矩阵。

## 需要后续处理的边界工作

以下项目属于部署或浏览器证据边界，不能用本地测试冒充已完成：

1. 用 Edge/Codex 浏览器逐页打开本地页面，与 AuraBaba 截图逐项比对，重点检查像素级布局：左侧栏、顶部快捷托盘、日历开关、加号按钮、任务看板、文档目录树、团队环境树和数字员工创建弹窗。
2. 逐个点击所有按钮和菜单，做浏览器证据留档；功能入口已接到紫薇后端真实 API。
3. 验证邀请流程：创建邀请 -> 复制真实 link -> 新标签打开 `/invite?code=...` -> 查找 -> 接受 -> 成员和邀请状态持久化 -> 撤销邀请后链接不可接受。
4. 验证 Skills：导入合法/非法 `SKILL.md`、重复导入、版本和校验错误提示，确认 UI 不吞掉后端错误。
5. 验证文档二进制：上传图片/压缩包，下载后 byte-for-byte 一致；确认目录树展开、进入、返回根目录和搜索行为。
6. 验证 A2A 真链路：创建 pending action，确认 `ziwei_user` ACK、实际执行、回传 succeeded/failed；重复 action 必须幂等；过期 action 不得执行。
7. 验证 Agent CLI 发现：桥接器版本和四个 Agent 的 CLI 版本分别从发现结果获取；不可使用固定 catalog 值冒充在线版本。
8. 对照 AuraBaba 的安装体验补齐跨平台安装说明；当前仓库安装脚本是本地项目脚本，并不是远程下载器，不能在报告里声称已经等同 AuraBaba 的公网安装流程。
9. 14 点基线已经按当前实现更新为 `complete`；历史实施记录中的旧 partial 只作为时间线保留，不要据此回退状态。
10. 不要为了验证而关闭用户正在使用的服务；需要做离线分支时使用隔离测试进程或独立临时端口。

## 推荐验收顺序

```powershell
# 1. 先确认服务和本机桥接
npm run ziwei:status

# 2. 跑静态和全量测试
node --test test/routes.test.mjs
npm test
npm run build
npm run lint

# 3. 打开页面
# http://127.0.0.1:5178/test-111/issues
# http://127.0.0.1:5178/test-111/calendar
# http://127.0.0.1:5178/test-111/project-docs
# http://127.0.0.1:5178/test-111/members
# http://127.0.0.1:5178/test-111/skills
```

## 重要约束

- 品牌名称和 UI 使用“紫薇”；本机桥接名称统一为 `ziwei_user`。
- 不要依赖、启动或修复 AuraBaba 的 daemon；只判断自己的 `ziwei_user` 是否在线。
- 不要把 `daemon/ziwei_user.mjs` 改名回 AuraBaba 名称，也不要在 UI 文案里出现 Aura daemon 作为运行依赖。
- 不要把 token、Cookie、完整邀请码或请求正文写入日志。
- 用户要求的是功能和视觉复刻，不能用“弹一个提示”代替已有的真实流程。
- 修改后必须重新跑测试和构建，并在浏览器里实际检查页面，而不是只看源码。

## 2026-09-30 继续执行记录

- 已把此前孤立的 `backend/storage.mjs`、`backend/sanitize.mjs`、`backend/git-sync.mjs` 接入生产路径：文档/附件可使用内容寻址本地对象存储，HTML 任务描述入库前净化，文档支持受控 Git 导出/导入接口和页面按钮。
- 文档页窄窗口下快捷托盘曾遮挡“导出 Git”按钮，实际点击会命中收件箱；已加入窄屏避让和操作栏层级，内置浏览器复测能打开 Git 同步弹窗。
- 开放平台“创建 API Key”已接真实创建、一次明文显示、复制、轮换、撤销和脱敏列表；数字伙伴创建弹窗的“创建”已写入真实任务。
- 技能文件名解析已修正，根目录 `SKILL.md` 和子目录路径都能正确推导名称。
- 验证：`npm test` **62/62**、`npm run lint`、`npm run build` 均通过；真实服务端口保持 5178/4178/20242，`ziwei_user` 仍以自身 ready/heartbeat 作为在线来源。
- 已补齐：通知 WebSocket 优先、SSE fallback、指数退避和 ready 后补偿刷新；A2A 生产令牌已落到本机权限文件并由 `ziwei_user` 自动读取。仍需后续处理：远端 Git、完整浏览器四态和截图比对；这些外部验收项不能仅凭本轮构建标记完成。

## 2026-10-01 真实功能落地记录

- `ziwei_user` 继续作为唯一本机桥接器：运行时和模型只取本机实际发现结果，AuraBaba daemon 不参与在线判断。
- 技能中心已经接入四种真实来源：SKILL.md 文本/文件、URL、ZIP（服务端校验并只提取 SKILL.md）和在线 ziwei_user 工位复制。
- 工作流侧边栏已接入自动化页面，不再弹出“敬请期待”；自动化创建支持计划、指令、Webhook 回调、输出方式和重试配置。
- 开放平台的 Webhook 卡片已连接到自动化配置入口；任务/日历/文档/团队页的助手快捷按钮会进入真实数字伙伴编排器，不再只弹提示。
- 紫色主题残留已统一替换为紫薇的蓝色主色和浅蓝中性表面，包含 daemon 提示和任务泳道 hover 状态。
- 本轮只做前端构建级检查，按要求暂不进行完整浏览器验收和全量验证；端口与现有服务入口保持不变。

## 2026-10-01 后续补齐（Git 远程同步暂缓）

- 清理了工作区中多余的离线设备记录；当前仅保留在线 canonical `device-ziwei-user`。
- 团队页组织架构图和目录树增加多余设备移除入口，在线 canonical 设备受保护。
- 任务页新增负责人泳道视图、任务卡拖拽切换状态、快捷托盘真实菜单。
- 日历月/周/日视图支持拖动自定义日程到日期；任务拖动会更新 due date。
- 团队成员、数字员工、设备数量改为动态显示；数字员工支持头像选择/清除、删除和运行时下属列表；成员支持移除非 Owner 成员。
- 自动化新增编辑、启用/暂停、立即运行、删除和运行记录入口。
- 后端增加员工头像持久化、成员/员工编辑删除接口、A2A action events 查询接口与终态事件保护。
- 运行状态：前端 5178、后端 4178、ziwei_user 20242 均监听；`ziwei_user` 在线。
- 验证：`npm run build`、`npm run lint`、`npm test`（59/59）及设备/权限/A2A/自动化/邀请相关测试通过；Git 远程同步未处理。

### 2026-10-01 追加

- 任务泳道、看板拖拽改状态、日历事件/任务拖动改日期均已接通。
- 自动化支持编辑、暂停/启用、立即执行和删除；开放平台 API Key 支持轮换/撤销。
- 快捷创建弹窗支持附件上传并随任务保存；移除遗留的“敬请期待/头像预留/快捷菜单提示”占位。
- 成员与数字员工列表可动态展示，非 Owner 成员和数字员工可移除。
- 已将旧测试中的静态模型断言改为先经过 `ziwei_user` 心跳再断言真实 CLI 模型；`npm test` 59/59 通过。
- Git 远程同步仍暂缓，当前只保留已有本地 Git 导入/导出能力。

本轮文档校准（2026-10-01）：以上状态以当前工作区代码和最近一次 `npm test` 62/62、`npm run lint`、`npm run build` 结果为准。日历拖拽、自动化生命周期、成员/数字员工/设备动态管理、A2A 终态事件保护、WebSocket/SSE 实时双通道、登录用户创建工作区路由和真实会话注销已落地；远端 Git 同步、完整浏览器四态/截图验收仍明确延期。
- 追加落地：数字伙伴编排器麦克风使用浏览器 SpeechRecognition（无支持时给出明确反馈），工作区语言属性和浅色/深色/跟随系统主题设置会实际应用到页面根节点。

### 2026-10-04 Hermes 独立人格服务器验收

- 服务器 `/opt/ziwei` 已切换到 `codex/hermes-independent-profile`，部署提交 `d1a4c9c`；部署前备份为 `/opt/ziwei-backups/ziwei.sqlite.20261003T165528Z`，生产 `main` 保持不变。
- 本机 `bjc-ops` daemon 与服务器 A2A 令牌已同步。由于服务器使用自签名证书，启动器现在支持配置 `tlsCaFile` 并把证书作为 `NODE_EXTRA_CA_CERTS` 传给子进程，不再依赖关闭 TLS 校验。
- 真实动作验收通过：Hermes profile `ziwei-aigc` 返回 `HERMES_PROD_PROFILE_OK` 与 `HERMES_PROD_PROFILE_RECHECK_OK`，服务器动作终态为 `succeeded`。
- 本轮质量门槛：`npm test` 90/90、`npm run lint`、`npm run build` 通过。工作树中的 `tmp_gzgov.html` 继续保留，未改动。

