# 紫薇

## Windows 客户端维护（2026-10-10）

当前维护任务先支持 Windows：`ziwei_user stop` 保留连接并停止，`ziwei_user update` 按官方包升级，`ziwei_user update-status --json` 查看真实结果，`ziwei_user uninstall` / `remove` 卸载程序并保留用户配置、认证与记忆。旧版没有这些命令时使用纯 PowerShell 入口 `irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex`。实现与发布验收进度见 [Windows 运维记录](docs/operations/2026-10-10-windows-client-maintenance.md)。

下方 test_222/PID 等属于历史验收。本机已按用户要求清空全部工作区连接并停止；用户后来新增的工作区、邀请和电脑连接是正式数据，继续保留，不自动重建已删除测试区。

紫薇是一个前后端分离的智能工作区原型，复刻了 AuraBaba 示例工作区的核心流程、任务、文档、运行时、技能、自动化和连接器流程。项目中的本机 daemon 由我们自己实现，服务名称是 `ziwei_user`。

## 数字员工·Creator：从伙伴市场开始协作

**已发布 `db0aa68`，北京时间 2026-10-10 00:08:06。** `phone_ai` 的正式 Creator 已创建并保留，[打开持久对话](https://qzelynth.top/phone_ai/inbox/conv_3c72ac45-1551-44d2-a1ed-c0900adc137a?employee=employee_743801eb-189d-4a57-bb57-64adebf7b571)。本轮真实 Hermes 创建、两个子任务、失败修正、幂等和历史 ID 追问均通过；完整证据、兼容范围与回滚见[Creator 操作记录](docs/operations/2026-10-09-creator-platform.md)。

1. 登录并切到目标工作区，让所选电脑原有的 `ziwei_user` 在线。
2. 打开“成员与设备 → 添加数字员工 → 从伙伴市场创建”，选择官方内置的“数字员工·Creator”。
3. 选择实际在线电脑和明确的 Codex/Hermes 运行时。Hermes 自动选择已就绪的 `default` 或唯一已就绪 profile；存在多个独立就绪 profile 时，需要明确选择。未指定模型时沿用 CLI/profile 配置，不自动替换运行时或 profile。
4. 点击“创建并开始对话”，进入绑定该员工和所选电脑的持久聊天。市场创建默认仅本人可见；同一成员在同一工作区重复操作会复用已有实例与对话，已有实例可以直接“打开持久对话”。采用兼容的历史 Creator 时保留其原职责、人格、指令和配置，不宣称已经应用新版模板。
5. 在聊天中明确请求创建或维护岗位员工，例如“在这台电脑创建一个 Hermes 资料整理员工，职责是整理工作区文档，人格严谨清楚；使用已发现的就绪 profile，回读配置，再执行一个只读小任务并报告真实结果”。Creator 应实际发现环境与技能、保存并回读配置，再检查 task/action 和产物；保存成功、MCP 已准备或任务仍在运行，都不能当作任务完成。

不需要复制提示词或密钥。模板版本更新只自动用于新实例，已有实例的定制配置继续保留；要变更已安装实例的运行时、电脑、profile、模型或可见性，应明确编辑原员工，重新安装不会覆盖这些字段。失败时保留原资源 ID 和上下文，根据具体错误修正后重试。

Creator 的默认管理 MCP 只在当前身份有权访问的工作区内使用。安装模板不会自动分配手机、绑定手机技能或执行手机动作。本轮正式实例使用 Hermes `default`，模型沿源 profile 默认值，本次实际为 `gpt-6.1-sol`。Creator 原生状态隔离目前验证 `openai-codex` provider 和本地 memory；其他 provider、远程 memory 或更换 source profile 需要兼容适配或明确迁移。Codex 模板支持保留，Codex 真机排障与验收按用户最新要求取消；手机实机暂缓，本轮 0 手机动作。

## 维护与 AI 接手

开发、启动、架构、真实完成边界、扩展规范、故障排查、发布门槛和接手顺序统一维护在 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)；项目级变更摘要见 [CHANGELOG.md](CHANGELOG.md)。需要把项目交给新 AI 时，直接使用 [NEW_AI_SESSION_PROMPT.md](NEW_AI_SESSION_PROMPT.md) 中的提示词。任何 AI 接手项目时先读维护手册，再读本文件和 `HANDOFF.md`；不要只依据旧截图或历史计划判断当前状态。

## 默认自动管理 MCP（2026-10-09 当前发布）

当前主站代码为 `1ca9c6b8761a8ee17adb2fd6d4fa92f385718c05`，已推送并于北京时间 21:18:32（`2026-10-09T13:18:32Z`）发布；前端仍为 `index-Caqrwk2Y.js` / `index-C30xBdgl.css`，控制服务保持 `8a4fe59`。所有工作区的新旧员工默认使用管理 MCP，无需逐员工勾选、手工授权或复制 bearer。前提仍是该工作区已有有效的电脑连接；没有电脑时显示等待连接，不会自动取得其他工作区的电脑身份。

`ziwei_user` 使用每条已配对连接自己的设备凭据，自动领取并续期仅限当前工作区、用途为管理 MCP 的短期凭据。主连接与 shared 连接分别准备，匿名、跨工作区、已撤销或过期身份继续拒绝；浏览器、员工人格、模型提示词和日志不接收设备凭据或管理 token。普通成员使用管理功能不会改变其网页角色；手机 MCP 的独立 capability、精确绑定与 Owner/Admin 授权规则保持。

创建或编辑员工时显示自动准备进度、失败原因、“重试自动接入”和客户端更新入口。准备中或自动接入失败时可先保存有效员工配置；工作区、电脑在线、CLI、认证/provider 和显式 profile 缺失检查仍生效。Hermes 管理接入可使用真实发现的 `default` 或显式 profile，执行使用所选 profile 的原生临时配置 overlay，保留原配置与认证；手机技能的独立 profile 要求继续适用。管理 MCP 实际运行时注入支持 Codex/Hermes；其他运行时缺适配会明确失败，不能把发现到 CLI 当作真实 MCP 验收。API 健康、凭据就绪和配置注入均不等于实际 MCP 握手，工具结果须按本次执行回执判断，`ok:false` 不标成功。

343/343 单测、lint 52 文件与 build 通过；相同前端包的真实域名平台/既有 Hermes 页 6/6、只读弹窗 10/10、两工作区只读 18 项及缓存恢复/续期/主动重试证据保留。**真实 default Hermes 已 succeeded、loaded，discover/list/create/get 四工具均成功，子员工回读确认 default profile 和精确电脑；独立 `ziwei-qa-mgmt-20261008` 已 succeeded、loaded，discover/list/health 三工具成功。** 独立 profile 原 SOUL 明确只读且禁止创建业务，因此请求的写入序列未完成、没有第二个子员工；原 profile config/SOUL 保持。首次 failed/无握手保留为修复前历史，不再是当前待验结果。官方客户端已更新到原生全局入口，真实 PID 48208、端口 20242，配置不变。本轮 0 Codex 执行、0 手机动作；Codex 实机按用户要求取消，手机离线实机暂缓。精确 QA 资源已于 13:22:32Z 清理，外键检查通过，18 项原保护表计数/稳定 hash 均保持；最终健康检查通过。最终两区只读 18/18 于 13:29:09Z 通过，当前 PID 48208 持续 ready、两区 queue 0；QA 会话已精确撤销，服务器私有文件移除、本机 token 清除，旧 cookie 于 13:29:51Z 实测 401，完整证据见[默认管理 MCP 发布记录](docs/operations/2026-10-09-default-management-mcp.md)。

## 员工创建 / 编辑勾选框修复（2026-10-09 历史发布）

该次主站 `f790f09` 于北京时间12:13:51发布，包含邀请、手机技能、管理MCP与团队卡片修复。创建/编辑窗口的原生勾选框恢复18×18、文字相邻且可点击，手机继续配置选项随正文滚动；短窗口和390px下底部按钮可达，编辑标题正确。当时未配置管理MCP会阻止提交，可取消该选项；此手工开关规则已由上方默认自动接入取代，勾选框布局修复继续保留。

296/296、lint49/build、弹窗隔离11/11、原功能UI回归36/36与真实生产五视口创建/编辑10/10、独立footer/body最终5/5通过。仅前端原子切换，三服务未重启，线上员工数据未修改，未操作真实手机。证据、备份与回滚见[弹窗修复记录](docs/operations/2026-10-09-employee-modal-checkbox-fix.md)。

## 邀请注册修复（2026-10-09 历史发布）

该次邀请修复发布为 `82c4f8e`，后续弹窗发布 `f790f09` 已包含它，同时保留手机技能 `628482d`、管理 MCP 和团队卡片修复；这些实现继续包含在顶部当前发布中。个人与团队工作区的有效邀请都可注册加入，普通受邀者按邀请获得 member/admin；历史 Owner 不被降权。已有账号可在原邀请页切换登录并接受，当前会话立即可访问目标工作区。页面持续显示无效、过期、撤销、邮箱不匹配等具体错误；未知工作区且无邀请码会明确拒绝，不创建误填的工作区。

用户刷新原邀请链接即可重试。完整串行296/296、隔离邀请6/6、真实域名新上下文6/6和原手机/卡片/管理回归30/30通过；真实邀请未消费，独立QA已清理。仅主API重启，原数据、手机MCP路由、APK和旧hash资源保留。发布、备份与回滚见[邀请注册修复记录](docs/operations/2026-10-09-invitation-registration-fix.md)。

## 手机 MCP 平台技能（2026-10-09 历史发布，实机暂缓）

该次手机技能首次发布实现为 `628482d`，后续邀请/弹窗发布 `82c4f8e`、`f790f09` 均保留该实现；这些功能继续包含在顶部当前发布中，控制服务保持 `8a4fe59`。在 [`phone_ai / 技能中心`](https://qzelynth.top/phone_ai/skills) 安装 **紫薇·互联手机操控 v1.0.0**，通过统一向导选择已有或新员工、真实电脑、Codex/Hermes 配置和精确手机，然后保存、检测并回读证据。员工的技能/MCP 页与紫薇·互联手机绑定共用此向导，无需手改配置或复制密钥。完整步骤见[手机技能使用指南](docs/PHONE_MCP.md)。

同一本机客户端保留 `test_222` 主连接，通过双 Owner 明确授权新增 `phone_ai` 独立连接；端口仍为 `20242`。正式员工“紫薇手机运营-Codex”和“紫薇手机运营-Hermes”已在 `phone_ai` 配置，Hermes 使用独立 `ziwei-phone-ops-20261009`。管理 MCP 现提供 21 工具，正式搭建师可显式指定获授权的 `workspace: "phone_ai"` 发现、安装和配置手机技能。

本轮完整串行 276/276、lint/build、手机向导隔离 12/12、团队卡片 12/12、原管理 MCP UI 6/6、真实 HTTPS 配置 9/9 与最终只读复验 9/9 通过。两正式员工在持久会话中实际加载 MCP，设备列表和精确手机状态查询均成功。手机“小饱饱”当前离线，用户暂时无法操作手机；截图、有限动作与手机业务实机验收仍待完成，不能把保存、API 健康或 MCP 加载当成手机执行成功。版本、真实员工检测与具体边界见[发布验收记录](docs/operations/2026-10-09-phone-platform-skill-acceptance.md)。

后续发布必须保留 Nginx `^~ /terminal-mcp/v1/` 到主 API 的转发，匿名鉴权应返回 401 JSON。执行 `node scripts/verify-phone-mcp-transport.mjs` 可发现漏转发、HTML 错误页和认证边界退化；该检查没有凭据或手机动作。

## 团队员工卡片重叠修复（2026-10-09 历史发布）

该次主站发布为 `dc39173`，已包含在上方手机技能版本中。团队卡片和设备下员工行展示两行岗位摘要，完整指令保留在员工详情与编辑表单；多排卡片会撑高组织图，避免覆盖下方 Agent 环境。覆盖 1440/2048/2549/390px 的 12 组隔离布局测试、真实线上 8 项检查，以及当时完整串行 235/235 均通过。该次仅更新前端，服务未重启。原因、发布与回滚见[修复验收记录](docs/operations/2026-10-09-team-card-layout-fix.md)。

## 管理 MCP 与正式员工搭建师（2026-10-09 首次发布记录）

管理 MCP 首次实现为 `bef1944`，后续包含 profile 下拉框 Escape、员工页窄屏标题与团队卡片修复，控制服务仍为 `8a4fe59`。首次发布提供 15 项管理工具，上方手机技能发布增加到 21 项。登录后打开 [`test_222 / 开放平台`](https://qzelynth.top/test_222/open-platform)，可以查看当前真实工具、工作区、设备发现与安全 stdio 接入示例；员工详情的 MCP 页签显示该员工实际执行的握手及工具调用回执。

正式员工 **紫薇员工搭建师** 已在 `test_222` 创建并接入管理 MCP，runtime 为 Codex，模型 `gpt-6.1-sol`，绑定电脑 `zheng`，挂载真实的“员工搭建与只读验收”技能。可在[员工详情](https://qzelynth.top/test_222/employee/employee_eddccbcf-3faa-4f55-a2f9-a12de9c679fe)进入对话，例如：“在 zheng 创建一个 Codex 员工，职责是只读检查工作区状态，人格严谨直白，挂载员工搭建与只读验收技能，启用管理 MCP，安排一次只读验收并回读结果。”如需 Hermes，将 runtime 明确写为 Hermes 并要求新建独立 profile；搭建师会先发现设备、CLI、认证/provider、profile 和技能，条件缺失时返回具体错误。

本轮由搭建师的真实模型通过 MCP 创建两名带 QA 名称的员工，各重试一次返回相同 ID；Codex 与独立 Hermes profile 的首次任务和 daemon 刷新后任务均真实 `succeeded`，都有本次 stdio 握手、health/list 工具成功及结果标记。全套串行测试 235/235、lint/build、隔离 UI 6/6、真实域名 1440/390 px 验收通过。完整 IDs、版本、证据、边界及回滚见[最终验收记录](docs/operations/2026-10-09-management-mcp-acceptance.md)。

管理 MCP 以 `scripts/ziwei-mcp.mjs` 提供 **stdio** 服务，内部经 HTTPS 请求 `/mcp/v1`；该 HTTP 管理 API 地址不能填作远程 MCP transport URL。MCP bearer、普通 API Key、设备凭据相互独立。该次真实 daemon 的私有 `managementMcp` 配置保存专用 token 文件路径；当前平台员工改为自动领取连接专属短期凭据，旧显式 scoped bearer 接入仍兼容。凭据不进入员工人格、提示词、命令行参数、前端或 Git。仅 Codex/Hermes 完成首次发布的实际管理 MCP 验收；其他 CLI 的发现状态不代表已完成认证或工具调用验收。手机执行、绑定和旧手机 MCP 配置未包含在该次管理 MCP 发布的通过范围；后续手机技能的实际进展与边界见上方当前记录。

## 紫薇·互联 Android 安装页（已上线并完成真实域名验收）

安装页公开路径为 [`https://qzelynth.top/android-install`](https://qzelynth.top/android-install)，无需登录；登录主站后，“系统 → 紫薇·互联”标题栏新增“安装手机端”入口。安装页可以返回当前工作区的手机管理，扫码入口则使用不含会话或凭据的固定公开地址。

页面分别提供“紫薇 Agent（手机操作）”和“紫薇 Updater（更新与维护）”下载，版本、大小和具体 APK 来自当前 `/downloads/android/index.json` 及其发布 manifest，按发布数据选择最新版本，不固定某个历史版本。二维码由本地脚本生成，不调用第三方服务。首次在同一台安卓手机安装两个应用并确认必要系统权限，在两应用“连接配置”的“HTTPS 中控根地址”填写 `https://qzelynth.top`，使用相同手机名分别点击“申请入网权限”；管理员回主站“待审核入网”批准，显示在线后绑定已有数字员工。后续更新继续使用原中控流程。

本轮基于 `c91f331`（包含 `a625350` 完整终端控制台）开发，仅变更前端与验证工具，不修改后端认证或手机协议。完整串行测试 207/207、lint/build、安装页浏览器 9/9、原终端浏览器回归 6/6 均通过。提交 `81b6ec8` 已于 2026-10-08 22:23（北京时间）上线，生产安装页在 390/1440px 匿名访问、真实发布数据、二维码解码、复制地址、主站入口及返回管理均已验证；两个 APK 的实际下载大小与 SHA-256 匹配清单。保留既有 APK、控制服务、数据与旧版 hash 资源，本次没有重启服务。未在真实手机执行安装或授权。详见 [本轮实施与验收记录](docs/plans/2026-10-08-android-install.md)。

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
npm run ziwei:setup -- --workspace <workspace-slug> --api http://127.0.0.1:4178 --health-port 20242
npm run ziwei:status # 查看本机 ziwei_user 配置和健康状态
npm run ziwei:version
npm run ziwei:start  # 已配置时复用现有进程，否则后台启动 ziwei_user
npm run mcp:token -- --workspace bjc-ops  # 可选：为显式外部集成生成 scoped bearer 文件
npm run mcp:manage -- --api-base http://127.0.0.1:4178 --workspace bjc-ops --token-file data/mcp.token  # 可选：显式外部 stdio 接入
npm run diagnose  # 单次健康检查
```

`npm run dev` 启动前端 `5178` 和后端 `4178`；daemon 健康接口使用 `20242`。参考 AuraBaba daemon 已占用 `20241`，紫薇不会抢占它。

普通平台员工自动接入管理 MCP，不需要执行 `mcp:token` 或编辑私有 token 文件。上述两个命令只保留给明确需要独立外部集成的开发场景。

## 验收环境边界

- **本地代码验收**：项目 checkout、本地前端 `5178`、本地 API `4178`、单元/API 测试和浏览器回归使用项目 `data/ziwei_user.json` 的 `bjc-ops` 工作区。需要运行项目 daemon 时，只使用项目入口并先核对该配置；它代表本地代码环境。
- **真实服务器 daemon/A2A 验收**：使用全局 `D:\work\nodejs\node_global\ziwei_user`，读取用户配置 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json`，目标服务器 API 为 `https://qzelynth.top`，工作区为 `test_222`。先核对 `ziwei_user status --json` 和 `http://127.0.0.1:20242/readyz` 的工作区身份。
- `npm run daemon`、`npm run ziwei:start` 和项目 `data/ziwei_user.json` 不得用于冒充或替代 `test_222` 的服务器证据；不要为了服务器验收启动项目 daemon、切换项目配置或把令牌写入日志。

## ziwei_user 设备连接

创建工作区和管理项目不需要先连接设备。只有要让某台电脑运行数字员工时，才在网页的“添加设备”里生成一次性配对码。`ziwei_user` 在每台电脑上只需安装一次；后续给同一台电脑连接新的工作区时，直接运行 `connect` 和 `start`，不要重复执行 `npm install`。

```powershell
npm install --global "https://qzelynth.top/downloads/cli/ziwei-latest.tgz"
ziwei_user connect --api "https://qzelynth.top" --code "<网页生成的一次性配对码>" --name "我的电脑"
ziwei_user start
```

上面第一行用于这台电脑第一次安装；已经安装当前客户端时可跳过。`--name` 是网页设备目录中的显示名称，例如“办公室电脑”，不代表远程账号或新的 Agent。`connect` 会保存新工作区的配对凭证；`change` 会检查 20242 上是否有旧的 `ziwei_user`，在确认它是本 daemon 后停止旧进程，再启动当前配置，因此切换工作区不需要手动找 PID，也不需要重新安装 npm 包。第一次没有旧 daemon 时，`change` 也可以直接启动；`ziwei_user start` 仍可作为只启动命令。配置、日志和运行时状态写入用户目录，不依赖项目源码目录，也不会安装网页前端依赖。普通 connect 配对保存并切换主连接，每个工作区使用自己的凭据；切换前应先在网页确认目标工作区。若需要同一电脑同时连接多个工作区，可由源、目标工作区双 Owner 明确授权新增 shared 连接；同一 daemon 会保留主连接，并使用独立设备身份、私有凭据和心跳运行获授权的连接，不把主 token 跨区复用。正式 HTTPS 域名不需要下载证书；只有私有证书或本地地址才需要在 `ziwei_user setup` 中通过 `--tls-ca-file` 指定公钥证书。

已配对电脑需要更新客户端时，运行下面的官方包安装与原生启动命令，然后核对 `ziwei_user version`、`status` 和页面自动接入状态；保留原配置、设备身份、工作区、profile、工作目录与 `20242`。更新不会要求生成新配对码或重新 `connect`。

```powershell
npm install --global "https://qzelynth.top/downloads/cli/ziwei-latest.tgz"
ziwei_user start
```

## API 入口

- `GET /healthz`
- `GET /server.crt`（下载配置的公开服务器证书，不需要登录）
- `GET /api/workspaces`、`POST /api/workspaces`（登录用户列出/创建项目；创建后访问 `/<slug>/<page>`）
- `GET /api/workspaces/<workspace-slug>/summary`
- `GET|POST /api/workspaces/<workspace-slug>/tasks`
- `PATCH /api/tasks/:id`、`GET|POST /api/tasks/:id/messages`
- `POST /api/tasks/:id/state`
- `GET|POST|PATCH|DELETE /api/workspaces/<workspace-slug>/automations`（模板、运行记录和执行接口见 `/api/automations/:id/*`）
- `GET|POST|PATCH|DELETE /api/workspaces/<workspace-slug>/documents`（单文档操作使用 `/api/documents/:id`）
- `GET|POST /api/workspaces/<workspace-slug>/members`
- `GET|POST /api/workspaces/<workspace-slug>/devices`
- `POST /api/workspaces/<workspace-slug>/heartbeat`（仅接受 `ziwei_user`，用于设备与运行时健康链路）
- `GET|POST /api/workspaces/<workspace-slug>/api-keys`、`POST /api/api-keys/:id/revoke`、`POST /api/api-keys/:id/rotate`
- `GET|POST /api/external/workspaces/:slug/*`（需要 `Authorization: Bearer zwi_...` 或 `X-Ziwei-Api-Key`）
- `GET|POST /api/workspaces/<workspace-slug>/notifications`（支持 `unread`/`archived`、未读统计和已读；`/notifications/ws` 优先使用 WebSocket，`/notifications/stream` 提供 SSE fallback）
- `GET|POST /api/workspaces/<workspace-slug>/conversations`、`GET|POST /api/conversations/:id/messages`（新对话、消息和附件元数据）
- `GET|POST /api/workspaces/<workspace-slug>/skills`、`PATCH /api/skills/:id`
- `POST /api/skills/:id/uninstall`、`GET /api/skills/:id/versions`、`POST /api/skills/:id/rollback`
- `GET|POST /api/workspaces/<workspace-slug>/employees`
- `POST /api/workspaces/<workspace-slug>/mcp/bootstrap`（仅该连接有效设备凭据，自动领取短期管理身份）
- `GET /api/workspaces/<workspace-slug>/mcp/status`、`/mcp/discovery`、`/employees/:id/mcp/status`（安全准备状态与实际员工回执）
- `POST /api/workspaces/<workspace-slug>/mcp/retry`，body 为 `{deviceId}`（成员请求精确连接下次心跳刷新；不创建员工任务）
- `GET|POST /mcp/v1/workspaces/<slug>/employees`、`PATCH /mcp/v1/workspaces/<slug>/employees/:id`（自动短期管理身份或兼容的 scoped MCP bearer）
- `GET|POST /mcp/v1/workspaces/<slug>/tasks`、`GET|POST /mcp/v1/workspaces/<slug>/documents`（同一工作区限定令牌）
- `GET /a2a/v1/agents`
- `POST /a2a/v1/register`
- `GET|POST /a2a/v1/actions`、`POST /a2a/v1/actions/:id/ack`、`POST /a2a/v1/actions/:id/result`
- `GET|POST /a2a/v1/tasks`
- `GET /a2a/v1/tasks/:id`
- `POST /a2a/v1/tasks/:id/messages`

A2A 注册、轮询和任务接口都要求显式传入 workspace；服务端不会把请求落到历史示例工作区。

首次初始化只创建本地账号，不会自动创建或加入 `test-111`。登录后必须在页面选择“新建工作区”，显式创建个人或团队工作区；普通注册则会自动创建独立个人工作区，加入已有团队必须使用有效邀请。

设备与运行时在线状态只由 `ziwei_user` daemon 的心跳决定。超过心跳有效期的设备和运行时会自动显示为离线；AuraBaba 或其他参考 daemon 的进程状态不会参与紫薇页面健康判断。

普通平台员工的管理 MCP 凭据由当前工作区电脑连接自动 bootstrap，短期、单工作区且仅用于管理；客户端私有缓存自动续期，不要求用户编辑 token 文件。独立外部集成仍可使用显式 `data/mcp.token` 或 `ZIWEI_MCP_TOKEN_FILE`，必须携带工作区白名单；这不是普通员工的前置步骤。凭据不提交 Git、不进入日志、页面或人格。stdio MCP 服务内部经 HTTPS 调用 `/mcp/v1`，服务器路由只调用 repository，不向客户端暴露 SQLite。

## 命名约定

产品/工作区叫“紫薇”，本机连接 daemon 服务叫 `ziwei_user`，`test-111` 仅作为历史/测试兼容工作区示例，账号注册不会默认加入它；实际工作区必须来自当前会话与成员关系。任何访问令牌、Cookie、Authorization 和密码都不能写入日志或提交到仓库。

## 界面约定

页面布局、导航层级、操作位置和流程参考 AuraBaba；配色、字体、Logo 和基础组件使用紫薇自己的品牌与 `@ziwei/ui`。保持浅色背景，主操作和选中态使用紫薇的蓝色主色令牌，成功与告警色沿用组件库语义色。

## 还未接生产的部分

生产 PostgreSQL/Redis、云端 OAuth、外部对象存储、真正的任务执行沙箱、队列、计费和伙伴市场仍保留在适配边界中；本地 SQLite 已支持 API Key 轮换、A2A action 重试、通知 WebSocket（SSE fallback）、Webhook HMAC 签名与重试、文档回收站和技能回滚。远端 Git 同步按当前范围保留本地 Git 导入/导出，暂不连接远端仓库。

## 紫薇·互联手机终端管理

登录主站后，在目标工作区左侧“系统 → 紫薇·互联”进入完整终端控制台；手机工作区的正式入口为 `https://qzelynth.top/phone_ai/ziwei-connect`。Owner/Admin 使用现有主站登录即可审批手机，不需要另登录原中控。

- 手机双端填写 `https://qzelynth.top` 并申请入网后，在页面上方“待审核入网”查看名称、Agent/Updater 角色、版本和有效期，批准或拒绝；批准后双端通过原配对协议自动取得各自配置。
- 左侧选择手机，右侧查看双端健康、心跳与错误、截图及原尺寸坐标操控、控制端切换/暂停、完整命令回执与人工核实、已发布 APK 和升级事务、归档。
- “登记手机”保留手动登记和双角色 JSON 配置下载；当前手机详情可绑定工作区内已有数字员工与外部账号，不创建额外数字员工。
- 主站代理入口为 `/api/workspaces/:slug/ziwei-connect/terminal/android-devices/*`。生产默认经 `http://127.0.0.1:5191/api` 连接原服务；手机状态、入网申请、命令、升级和截图仍由原服务持久保存，主站只保存员工绑定和运行记录。
- 隔离回归：构建后运行 `node scripts/verify-ziwei-terminal-ui.mjs`；真实源协议回归运行 `node scripts/verify-ziwei-terminal-protocol.mjs <原中控源码目录>`。两者均不操作真实手机；域名只读浏览器验收使用 `scripts/verify-ziwei-terminal-live.mjs --session-file <私密短期主站会话文件>`。

## 许可证

本项目以 MIT 许可证发布，详见 [LICENSE](LICENSE)。




