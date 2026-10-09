# 2026-10-09 默认自动管理 MCP 发布与验收记录

本记录区分已经发布的默认接入实现、已完成的安全/客户端/网页检查，以及尚待修复复验的真实 default Hermes 员工链路。当前快照为主站 `1ac0395`；本轮不能声明真实 default Hermes MCP 验收成功，后续修复版本、时间及实际结果由发布负责人补录。此前独立 Hermes、Codex 和手机技能的成功记录保留其原发布版本与执行时间。

## 当前发布与范围

| 项目 | 当前事实 |
| --- | --- |
| 主站已推送/部署代码 | `1ac03954836543d2d6af0881fcae8ff3d40b2acf` |
| 已知发布时点 | 2026-10-09 20:11，北京时间 |
| 前端资源 | `index-Caqrwk2Y.js` / `index-C30xBdgl.css` |
| 开发接续工作树 | `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解` |
| 当前来源分支 | `codex/ziwei-terminal-console` |
| 默认行为 | 所有工作区的新旧员工管理 MCP 有效开启，无逐员工手动授权 |
| 客户端正式包 | `https://qzelynth.top/downloads/cli/ziwei-latest.tgz` |
| 实际运行时验收 | 新 default Hermes 首次 failed、无握手，后续 runtime 修复/无模型加载已通过，真实模型 QA 仍待复验 |
| 用户取消/暂缓 | 本轮 Codex 实机不做；Mac 检测取消；手机离线，实机暂缓 |

本轮保留 `f790f09` 弹窗勾选框与滚动修复、`82c4f8e` 邀请注册、`628482d` 手机平台技能、管理工具、团队卡片与公开 Android 安装页。默认管理 MCP 不更改手机控制协议、APK、现有手机授权或绑定，不消耗真实邀请。部署服务、客户端最终运行版本/PID、备份路径、包 hash、QA 清理与后续修复发布以发布负责人最终回填为准；这里不预先声明其全部完成。

## 用户操作与兼容行为

1. 在目标工作区使用已有电脑连接。首次连接新电脑仍在原“添加设备”入口生成一次性码，并在电脑运行原 `connect/start` 流程；创建工作区本身不要求先连接电脑。
2. 在开放平台查看“新旧员工默认开启”及当前工作区电脑的自动接入进度。已有员工不需要重新编辑、勾选或保存；新员工也不需要复制 token 或申请单独管理授权。
3. 新增/编辑员工时明确选择本工作区电脑、运行时及需要的真实 profile。pending、failed、client_required 等自动准备状态可先保存有效员工配置；电脑离线、工作区不匹配、CLI/auth/provider 或显式 profile 缺失仍返回其真实问题。
4. 自动准备失败时查看具体原因与 reasonCode；“重试自动接入”只请求精确电脑连接在下一次心跳刷新管理配置。它不执行员工任务，不创建或修改员工/profile，也不提交手机动作。普通成员可在其有权限的工作区请求该重试。
5. client_required 时沿原安装方式更新 `ziwei_user`，使用原生启动入口刷新，再查看设备发现与自动接入状态。已有配对连接不需要生成新配对码或重新 connect；保留主/shared 连接、设备身份、profile、工作目录和本机 `20242`。
6. 员工真正执行后，在员工 MCP 页看该次 action/execution 的注入、握手和每项工具回执。历史成功回执只说明其当时的执行，不替代本轮验收。

首次安装使用正式 HTTPS 包：

```powershell
npm install --global "https://qzelynth.top/downloads/cli/ziwei-latest.tgz"
ziwei_user connect --api "https://qzelynth.top" --code "<网页一次性配对码>" --name "我的电脑"
ziwei_user start
```

已有配对客户端升级只执行包安装与原生启动，不重新 connect：

```powershell
npm install --global "https://qzelynth.top/downloads/cli/ziwei-latest.tgz"
ziwei_user start
```

正式入口不再使用旧 GitHub 开发分支 tarball。应核对实际客户端版本/状态与当前页面准备结果，不能仅凭 npm 安装完成就声称运行中的 daemon 已更新。Windows/macOS/Linux 安装命令的浏览器回归只验证命令展示与复制，不代表实体 Mac/Linux 安装；本轮 Mac 检测已取消。

Hermes 管理接入支持真实发现的 `default` 或显式 profile，UI 继续要求明确选择真实 profile。执行使用所选 profile 的原生临时 managed overlay，原配置、人格与认证保留，认证仍来自原 `HERMES_HOME`，不复制 auth 或改写主 profile。管理授权不强迫独立 profile；**手机 MCP 的独立 profile 约束仍保留**。其他 CLI 的发现状态不代表已实际通过 MCP 握手与工具验收。

历史显式 scoped bearer 外部客户端集成仍兼容。`mcp:token`、token 文件和开发者 stdio 模板属于可选外部集成，不是普通平台员工的前置步骤。`scripts/ziwei-mcp.mjs` 仍提供 stdio 服务并在内部经 HTTPS 请求 `/mcp/v1`；HTTP 管理 API 地址不能填作远程 MCP transport URL。

## 安全身份与状态合同

`POST /api/workspaces/:slug/mcp/bootstrap` 仅接受该工作区当前连接的有效设备凭据，由服务端推导 workspace/device/credential、期限和 `ziwei-management` audience。凭据短期、单工作区且只用于管理；cookie、API Key、全局 A2A、手机 capability、匿名或调用方伪造 role/scope 不构成 bootstrap 身份。响应 no-store，实际 token 只由客户端私有保存，浏览器安全状态不返回 token、私有路径或设备长期凭据。

每个管理请求继续检查工作区、设备/凭据有效性、到期与撤销。主连接与已有 shared 连接各用自己的 origin/workspace/device 缓存；缺失、临到期或主动刷新会重新准备，不能用 `test_222` 主 token 替代 `phone_ai` 身份。自动管理能力不改变普通成员的网页角色或个人资源归属；新增 shared 连接仍需原双 Owner 授权。

安全可见准备状态为 pending、ready、failed、client_required，附带当前工作区、configured/managed、必要的 reasonCode/reason/expiry。状态、发现及员工回执请求显式捕获 slug，并以 generation 丢弃切换工作区后返回的旧响应。服务器服务 healthy/default_enabled 不会把没有电脑的工作区标为员工已加载。

| 入口 | 范围 |
| --- | --- |
| `GET /api/workspaces/:slug/mcp/status` | 平台默认策略、安全连接准备状态与员工历史执行回执 |
| `GET /api/workspaces/:slug/mcp/discovery` | 当前工作区真实电脑、CLI/profile 与安全自动准备状态 |
| `GET /api/workspaces/:slug/employees/:id/mcp/status` | 本工作区员工配置与其实际 execution 证据 |
| `POST /api/workspaces/:slug/mcp/retry`，`{deviceId}` | 精确连接的下次心跳管理刷新请求，不产生员工/手机业务动作 |
| `POST /api/workspaces/:slug/mcp/bootstrap` | 设备身份专属领取；不是浏览器按钮调用或网页登录凭据接口 |

管理 MCP 的手机技能发现/配置工具不授予手机操作 capability。手机执行仍使用原 workspace/employee/computer/profile/phone/revision/action 精确短期授权，Owner/Admin、精确绑定和既有中控队列/回执继续生效；源管理员凭据不下发员工。

## 准备、握手与回执的证据边界

| 阶段 | 可以说明 | 不能说明 |
| --- | --- | --- |
| 平台/API healthy、默认策略开启 | 服务器管理入口可用 | 电脑已连接、员工实际加载 |
| 连接 ready/credential configured | 自动短期管理身份已准备 | 原生模型完成 MCP 初始化 |
| injected | 本次运行配置注入 | initialize/tools/list 或工具成功 |
| 本次实际 loaded/握手证据 | 该 action 的原生 MCP 加载 | 每项工具都成功、员工业务成功 |
| 本次 tool_calls `ok:true` | 对应工具本次成功 | 未调用工具成功、手机动作成功 |
| tool_calls `ok:false` 或缺少回执 | 失败或待确认 | 绿色成功或历史回执代替本次结果 |

页面按这些层次分别展示。历史执行的时间/action ID 保留，不因升级或自动准备 ready 改写；重试不会篡改旧失败。任务成功标记必须结合本次真实握手与工具结果，不能由 host 工具或直接管理员 API 替代员工原生链路。

## 已完成验证

| 验证 | 结果与范围 |
| --- | --- |
| 已发布代码单元/API 检查 | 1ac0395：338/338，lint/build 通过 |
| scoped 前端单测 | 18/18，含默认值、缺失/失败允许保存、workspace 竞态与真实失败回执 |
| 新安装入口 | onboarding 12/12；旧 GitHub 来源 RED 后官方 tgz GREEN；浏览器管理 13/13，含安装命令展示与复制 |
| 隔离浏览器回归 | 员工弹窗 12/12、手机 12/12、团队 12/12、邀请 6/6、Android 安装 9/9，管理 13/13，共 64 项 |
| 真实两个工作区只读 | 18 项；身份/工作区隔离与安全准备状态，详见发布负责人证据 |
| 实际客户端自动恢复 | 缓存缺失恢复、临到期续领、主动重试通过；另一工作区缓存保持，详见发布负责人证据 |
| 真实浏览器平台/既有 Hermes | 6/6；三视口 × 两入口，initial/refresh/reload 各读，36 截图 |
| 真实浏览器创建/编辑弹窗 | 10/10；五视口 × 创建/编辑，仅打开/修改未提交表单与关闭，30 截图 |
| 后续 runtime 修复本地 | 341/341；独立无模型验证门槛取得真实 MCP 加载，最终修复发布版本待回填 |
| 本轮新 default Hermes 模型 QA | 首次 failed、无握手；后续模型复验待完成，不能计通过 |

隔离 management/install 用例主动制造 503 以验证失败恢复，预期 HTTP 错误保留在对应结果中；无非预期页面/控制台错误。隔离弹窗验证原生 skills/phone checkbox 的布局、label/点击、Tab 可见焦点与 Space，并验证保存后手机向导联动；这不等于生产提交员工或手机动作。

真实 HTTPS 浏览器全部请求限定 GET/HEAD/OPTIONS，0 写请求、0 页面/控制台/请求错误、0 手机动作，员工摘要 hash/数量保持 3→3。创建/编辑覆盖 1250×882、1440×900、1280×720、720×450、390×844；底部正文和 footer 可达，管理授权 checkbox 已移除、编辑不显示创建专属手机继续项。五个创建 phone checkbox 均 18×18、gap 8，label/点击/Tab/focus-visible/Space 通过。真实 skills 下拉没有打开，其交互证据来自隔离 fixture。720×450 是 CSS 视口，不声明实际浏览器 200% 缩放。

真实平台/员工页覆盖 1440×900、390×844、720×450；每组初读、刷新、reload 后身份与状态不串区。`test_222` 连接 `device_ceb28133-2103-46c9-8720-b101d2e8acbc` 显示 safe ready，未暴露 credential。既有 Hermes 员工 `employee_748360a3-a0e4-444b-9125-5fe96f943d39`，profile `ziwei-qa-mgmt-20261008`，展示的是旧 `action_e53e820f-d5e0-4d18-a393-633cc3b525bc` 于 `2026-10-08T16:13:55.396Z` 完成的 loaded/三工具成功回执；**该独立 profile 历史记录不能替代本轮 default Hermes 验收**。

截图前只临时隐藏背景 `.sidebar-account` 并在 finally 恢复，不使用会遮挡前景弹窗的白色 mask。所有自建隔离浏览器 context 已关闭，没有操作用户浏览器/profile。

## 本地证据索引

以下路径均相对本接续工作树；`.local` 是 ignored 私有证据目录，不提交原始会话、缓存或诊断全文到 Git。结果与截图用于审计，不包含 token。发布负责人最后补齐真实 QA、发布备份/包 hash 与清理结果。

- 真实平台/既有员工：`.local/management-default/live-browser/results.json` 与同目录 36 PNG。
- 真实五视口创建/编辑：`.local/management-default/live-modal/results.json` 与同目录 30 PNG；代表图 `live-create-390x844-bottom-ready.png`、`live-create-720x450-bottom-ready.png`。
- 安装源 RED/GREEN：`.local/official-client-install-red/results.json`、`.local/official-client-install-green/results.json`。
- 隔离管理默认合同：`.local/default-management-ui-final/results.json`；最新官方包场景以 `official-client-install-green` 为准。
- 隔离弹窗：`.local/default-management-modal-final/results.json`。
- 手机/团队/邀请/Android 安装回归：`.local/default-management-phone-regression/results.json`、`.local/default-management-team-regression/results.json`、`.local/default-management-invite-regression/results.json`、`.local/default-management-install-regression/results.json`。
- 发布负责人客户端、安全及新 default Hermes QA 的最终证据：待其按实际结果补录；不得读取或复制 private-session、token/cache 文件内容到本记录。

## 待完成与接续要求

1. 新 default Hermes 首次模型执行 failed/无握手保留。后续 runtime 修复本地 341/341 与无模型验证门槛的真实 MCP 加载已通过，接续仍需取得新员工本次真实模型 initialize/tools/list、实际工具成功和服务端 execution 回读；补录实际 employee/action IDs、最终版本、时间及失败原因。完成模型复验前不将本轮真实模型链路标为完成。
2. 本轮 Codex 实机按用户“codex这个不用管了”取消，Mac 检测同样保持取消；不为补齐表格另发任务或调整用户配置。
3. 手机“小饱饱”仍 offline，用户暂时无法操作手机。手机配置/只读历史成功保留，截图、有限动作和手机业务实机继续暂缓，无手机 trial/动作提交，不能用管理 MCP 验证代替手机执行。
4. 后续修复发布仍保留主/shared 连接身份、工作目录、`20242`、持久诊断日志、邀请修复、旧 hash 资源、Nginx `^~ /terminal-mcp/v1/` 与 APK/控制服务。不得用项目 `bjc-ops` daemon 冒充真实用户 `test_222/phone_ai` 证据。
5. 发布负责人按真实资源归属完成 QA 资源及短期会话撤销/清理，验证实际拒绝与原业务数据保持后回填结果。代码回滚不自动撤销持久资源；不恢复旧库覆盖后续用户数据，不写入或公开秘密。最终备份/回滚步骤待负责人按实际发布目录补录。

设计合同见[默认管理 MCP 实施计划](../plans/2026-10-09-default-management-mcp.md)；手机独立配置与回执语义见[手机技能用户指南](../PHONE_MCP.md)，其历史发布边界见[手机平台技能验收](2026-10-09-phone-platform-skill-acceptance.md)。当前维护与交接以根目录 PROJECT_MANAGEMENT、README、HANDOFF 的当前默认管理条目为准。
