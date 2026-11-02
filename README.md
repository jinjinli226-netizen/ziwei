# 紫薇

紫薇是一个数字员工工作平台。用户在工作区中创建岗位员工，通过网页或 Android 管理 App 聊天派活、查看结果、管理设备和例行工作。任务由绑定电脑上的 `ziwei_user` 调用 Codex、Hermes 或 DSH 执行；需要操作手机时，再通过紫薇互联和受控手机上的 Agent 执行。

本文按 2026-11-02 的仓库源码整理。源码、API、网页、官方下载包、电脑实际安装和 Android 各自有版本与验收记录，不能用一个 Git 提交代表所有层的运行状态。

使用入口：[紫薇驾驶舱](https://ziwei.qzelynth.top) · [公开 CLI 文档](https://ziwei.qzelynth.top/docs/cli.md)。

## 先从这里开始

- 接手项目：[AI_HANDOFF.md](AI_HANDOFF.md) → [功能索引](docs/FEATURE_MAP.md) → 当前任务对应的源码与测试。
- 开发规则：[AGENTS.md](AGENTS.md)；新会话可用[简短接手提示词](NEW_AI_SESSION_PROMPT.md)。
- 查发布来源和跨仓库关系：[分层版本地图](docs/handoffs/2026-10-20-release-map.md)；近期变化再看下方专题，历史记录见 [HANDOFF.md](HANDOFF.md)。
- 跨电脑移交：[迁移说明](docs/handoffs/cross-computer-guide.md)。本机私有资料、登录凭据和员工 HOME 不随 Git 克隆转移。

## 当前产品能力

| 能力 | 当前源码中的行为与入口 |
| --- | --- |
| 员工与统一聊天 | Codex、Hermes、DSH 员工共用员工列表和主聊天入口，保留各自运行电脑、岗位配置和原生会话。支持历史分页、连续消息队列、Markdown、附件和真实 assistant 正文流式输出。[统一工作台](docs/operations/2026-10-29-unified-employee-workspace.md)、[正文流式链路](docs/operations/2026-11-01-conversation-response-stream.md)。 |
| 混合员工群聊 | 同一工作区可组合 Hermes、DSH、Codex 员工；每位成员仍使用自己的原生运行时、action 和会话。群入口位于员工聊天旁，结果进入群历史。[混合群实现](docs/operations/2026-11-01-mixed-group-chat.md)、[工作区群入口](docs/operations/2026-11-01-workspace-group-entry.md)。 |
| 例行工作与结果 | 例行页管理定义、启停和运行记录；绑定会话的文本、图片结果进入员工主聊天。DSH 沿用原生 Routine 调度，由后台读取原生结果并去重保存，不另建一套任务调度。[主聊天图文回显](docs/operations/2026-10-31-routine-chat-echo.md)。 |
| DSH 原生能力 | 经员工绑定电脑访问原生插件、市场、设置、Provider/模型、会话交互、群组和例行工作；插件 UI 通过同源 relay 承载。插件配置、Loader 实际状态和本轮调用结果分别展示。[插件同步](docs/operations/2026-10-30-dsh-plugin-sync.md)、[原生控制与网页入口](docs/operations/2026-10-31-dsh-native-controls.md)。 |
| Hermes 原生能力 | 员工使用独立 Profile/HOME，按其配置加载模型、记忆、Skill、MCP 和原生工具；工作台提供 Routine、goals、heartbeat、kanban、Gateway、语音等原生能力入口。可用性取决于原生版本、配置和实际回执。[独立 Profile 合同](docs/contracts/2026-10-13-hermes-owned-profile-api.md)、[Gateway 工具集适配](docs/operations/2026-10-30-hermes-gateway-toolsets.md)。 |
| 员工能力回填 | 员工或管理 AI 可通过正式 CLI/MCP 登记、更新、移除 Skill/MCP/CLI 明细，离线也能读取保存的清单。清单区分自动发现、人工/AI 报告和关联证据；自报可调用不等于独立执行验收。[能力回填协议与命令](docs/operations/2026-10-28-employee-capability-reporting.md)。 |
| 文件与图片 | 聊天和混合群支持最高 500 MiB 的分块上传、流式传输及附件引用。大文件传输上限不等于模型视觉输入上限，各运行时仍保留自己的读图规则。[附件完整链路与验收](docs/operations/2026-11-01-streamed-chat-attachments.md)。 |

Creator 伙伴模板帮助创建、配置岗位员工；它与普通员工沿用同一工作区权限、电脑绑定和结果回读规则。使用流程见 [Creator 专题](docs/operations/2026-10-09-creator-platform.md)，具体实现从功能索引定位。

## 网页、电脑与手机分别做什么

| 层 | 职责 |
| --- | --- |
| 网页与 HTTP API | 管理工作区、员工、权限、聊天、任务、例行和设备，保存消息与执行回执。网页源码在 `frontend/`，API 在 `backend/`。 |
| 电脑执行客户端 `ziwei_user` | 在用户电脑上领取获授权的动作，调用本机 Codex/Hermes/DSH，回传进度、真实结果和附件；保存本机执行、投递与恢复记录。 |
| Android 管理 App | `mobile-manager/` 是手机上的管理入口：员工聊天、群聊、任务、提醒和设备设置。它使用同一后端，员工任务仍在绑定电脑执行。[管理 App 说明](mobile-manager/README.md)。 |
| 紫薇互联、手机 Agent / Updater | 承担受控手机连接、截图、输入、动作回执和应用更新；Control 与 Agent/Updater 源码位于独立 `ziwei-system` 私仓，不属于管理 App APK。[手机 MCP](docs/PHONE_MCP.md)、[手机生命周期](docs/operations/2026-10-16-phone-input-lifecycle.md)。 |

Android 管理 App、手机 Agent、Updater 是不同应用，不能用其中一个安装成功证明其他应用或物理手机业务已验收。管理 App 的近期附件与发布边界见[附件发布记录](docs/operations/2026-11-01-streamed-chat-attachments.md)，身份接入见 [code18 统一登录记录](docs/operations/2026-10-25-android-unified-login-code18.md)；各记录中的日期与适用版本分别判断。

## 两个 CLI

| CLI | 用途与真实入口 |
| --- | --- |
| `ziwei_user` | npm 包 `ziwei` 的电脑执行客户端。安装后入口为 `scripts/ziwei-user.mjs`，转入 `scripts/ziwei-cli.mjs`；原生启动入口是 `scripts/start-ziwei-user.mjs`。提供 `connect`、`start`、`status`、`stop`、`update`、`update-status` 等命令，Windows 维护边界见[客户端维护记录](docs/operations/2026-10-10-windows-client-maintenance.md)。 |
| `ziwei-workspace` | 独立包 `@ziwei/workspace-cli` 的工作区管理 CLI，入口为 `packages/workspace-cli/bin/ziwei-workspace.mjs`。用于登录、查询和管理员工、任务、文档、Bot、设备等资源，不承担电脑上的 daemon 执行。用法见[包说明](packages/workspace-cli/README.md)和[生成的完整 CLI 文档](docs/public/workspace-cli/cli.md)；2.0.4 发行与文档对齐见[具体发布记录](docs/operations/2026-11-02-workspace-cli-docs-refresh.md)。 |

安装后可先查看帮助和能力目录：

```sh
ziwei_user --help
ziwei_user status --json
ziwei-workspace --help
ziwei-workspace capabilities --json --contract v1
```

源码开发入口 `npm run ziwei:setup`、`npm run ziwei:start` 与全局客户端的默认数据目录不同。`ZIWEI_CONFIG` 指定配置文件，`ZIWEI_USER_HOME` 指定客户端数据根；维护已安装实例时沿用其原配置和原生入口。Workspace CLI 有独立登录和凭据槽，不借用 daemon 的设备凭据。异步命令已受理、电脑已领取、工具成功和业务完成是不同状态，应按原 action 的结果查询确认。

## 源码目录

```text
frontend/src/              网页组件、聊天状态与 API 请求
backend/                   HTTP API、权限、数据、任务与自动化
daemon/                    ziwei_user 服务入口、配置与健康接口
src/                       本机运行时适配、会话、执行与结果恢复
mobile-manager/            Android 管理 App、内嵌网页与测试
packages/workspace-cli/    独立工作区管理 CLI
scripts/                   CLI/MCP、安装升级、诊断与发布工具
skills/                    项目内置技能
test/                      本机运行、协议和端到端测试
docs/                      功能索引、合同、运维与 QA 记录
```

具体功能的源码和测试入口以 [FEATURE_MAP.md](docs/FEATURE_MAP.md) 为索引，再沿实际调用关系展开；无需先通读所有历史交接材料。

## 本地开发与验证

使用 Node.js 24 或更新版本和 npm。在仓库根目录安装依赖并执行静态检查、网页构建：

```sh
npm ci --ignore-scripts
npm run lint
npm run build
```

需要启动本地开发环境时，先按目标电脑的端口登记规则核对实际占用、归属和诊断日志，再使用已有 `npm run dev`，或分别使用 `npm run dev:backend`、`npm run dev:frontend`。保留项目原端口，端口冲突时先核实，不自动递增或接管其他服务。

测试按改动范围选择，例如正文流式展示和结果投递：

```sh
node --test frontend/src/conversation-stream.test.mjs test/daemon-response-delivery.test.mjs
node scripts/build-workspace-cli-docs.mjs --check
```

`npm test` 会启动全库 Node 测试发现；部分测试创建本地监听、隔离子进程或依赖 Windows/原生运行时，运行前应检查对应测试与环境要求。历史[全库回归中间记录](docs/operations/2026-10-29-broad-regression-intermediate.md)不是当前全量通过证明。纯文档改动检查链接、格式和 diff；测试通过、源码推送、正式发布、指定设备安装及实际业务完成分别验收。

## 最近修复与证据入口

| 日期 | 变更 |
| --- | --- |
| 2026-11-02 | [结果投递优先级](docs/operations/2026-11-02-result-delivery-priority.md)：普通 output/stage/progress 队列不再阻挡已持久保存的终态；DSH 必需 binding、附件完整回执和未知结果保留规则继续生效。 |
| 2026-11-02 | [Hermes 会话准备超时](docs/operations/2026-11-02-luna-gateway-session-prepare.md)：有限准备预算、保留真实错误分类，并通过既有进度通道报告准备状态。 |
| 2026-11-02 | [Workspace CLI 与公共文档对齐](docs/operations/2026-11-02-workspace-cli-docs-refresh.md)：认证续期修复、现有插件/混合成员 schema、生成文档和真实下载产物逐项对照。 |
| 2026-11-01 | [正文流式输出](docs/operations/2026-11-01-conversation-response-stream.md)、[500 MiB 附件](docs/operations/2026-11-01-streamed-chat-attachments.md)、[工作区群入口](docs/operations/2026-11-01-workspace-group-entry.md)：网页、移动端与运行时各自的实现和发布范围见专题。 |
| 2026-11-01 | [Hermes Gateway 断连收尾](docs/operations/2026-11-01-atlas-gateway-disconnect.md)、[本地执行收敛与隔离](docs/operations/2026-11-01-local-execution-convergence.md)：核对原 admission/turn 与退出证据，保留失败和未知结果。 |

以上是实现与证据索引，不是实时健康页或全产品验收声明。发布及回退前，按对应专题核对实际层、产物和现场状态；历史 PID、旧聊天状态或一次成功回执不能代替当前验证。

## 许可证

本项目以 MIT 许可证发布，见 [LICENSE](LICENSE)。
