# 2026-10-09 默认自动管理 MCP 发布与验收记录

当前主站已发布 `1ca9c6b`，真实 default Hermes 四工具创建/回读链路与独立 profile 三工具只读链路均通过实际加载验收。独立 profile 保留原 SOUL 的只读限制，没有完成请求的写入序列、没有第二个子员工。首次 failed/无握手属于修复前历史，继续留证。精确 QA 清理、18 项保护数据 count/stablehash 与最终健康检查已通过；两区最终只读18/18与QA会话精确撤销亦已完成；Codex 实机取消、手机离线实机暂缓。

## 当前发布与范围

| 项目 | 当前事实 |
| --- | --- |
| 主站已推送/部署代码 | `1ca9c6b8761a8ee17adb2fd6d4fa92f385718c05` |
| 发布时点 | `2026-10-09T13:18:32Z`，北京时间 21:18:32 |
| 上一版与备份 | `/opt/ziwei/releases/1ac0395`；`/opt/ziwei-backups/management-default/20261009T130953Z` |
| 前端资源 | `index-Caqrwk2Y.js` / `index-C30xBdgl.css` |
| 控制服务 | `/opt/ziwei-control/releases/8a4fe59` 保持 |
| 开发接续工作树 | `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解` |
| 当前来源分支 | `codex/ziwei-terminal-console` |
| 默认行为 | 所有工作区的新旧员工管理 MCP 有效开启，无逐员工手动授权 |
| 客户端正式包 | `https://qzelynth.top/downloads/cli/ziwei-latest.tgz` |
| 客户端正式发布元数据 | `https://qzelynth.top/downloads/cli/release.json` |
| 包文件与大小 | 22 文件，66542 bytes |
| 包 SHA-256 | `ae27327bbcfcbcd9f7518cc9b74e357374c04a228189391e91ba4151360d5da4` |
| 真实全局客户端 | PID 48208，ready=true，端口 20242，watcher PID 50908，原配置不变 |
| 客户端 build 指纹 | `f26077c6abcb6479a63948439938097151888751b150780069eb714bf36348b4` |
| 实际运行时验收 | default Hermes succeeded/loaded、四工具ok；独立 profile succeeded/loaded、只读三工具ok，未创建第二个子员工 |
| 注入实现边界 | Codex/Hermes 支持；其他运行时缺适配明确失败，不宣称全部CLI真实验收 |
| 用户取消/暂缓 | 本轮 Codex 实机不做；Mac 检测取消；手机离线，实机暂缓 |

本轮保留 `f790f09` 弹窗勾选框与滚动修复、`82c4f8e` 邀请注册、`628482d` 手机平台技能、管理工具、团队卡片与公开 Android 安装页。默认管理 MCP 不更改手机控制协议、APK、现有手机授权或绑定，不消耗真实邀请。当前主站切换 `/opt/ziwei/releases/1ca9c6b`，只重启 `ziwei-api.service`；控制服务保持，Nginx 配置 hash 保持，六份旧 hash 资源保留。QA清理于13:22:32Z完成，随后18项保护数据复验通过；两区最终只读18/18及短期会话精确撤销/旧cookie401后验亦已完成，安全证据保留。

客户端升级 ready 证据时间为 `2026-10-09T13:11:22.6854795Z`，原生模型验收汇总归档为 `13:17:47.941Z`；服务端发布于 `13:18:32Z`，正式包下载/hash/metadata 复核于 `13:19:50.487Z`。这组记录分别证明实际原生客户端、模型工具结果与正式部署/下载，不以网页历史回执替代。

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

Hermes 管理接入支持真实发现的 `default` 或显式 profile，UI 继续要求明确选择真实 profile。执行使用所选 profile 的原生临时 managed overlay，原配置、人格与认证保留，认证仍来自原 `HERMES_HOME`，不复制 auth 或改写主 profile。管理授权不强迫独立 profile；**手机 MCP 的独立 profile 约束仍保留**。原生管理 MCP 实际注入适配支持 Codex/Hermes，其他运行时缺适配会明确失败；本轮 Codex 实机已取消，其他 CLI 的发现状态不代表真实 MCP 握手/工具验收。

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
| 最终代码单元/API 检查 | 343/343，lint52/build通过；原1ac0395的338及中间341保留历史，不作为最终计数 |
| scoped 前端单测 | 18/18，含默认值、缺失/失败允许保存、workspace 竞态与真实失败回执 |
| 新安装入口 | onboarding 12/12；旧 GitHub 来源 RED 后官方 tgz GREEN；浏览器管理 13/13，含安装命令展示与复制 |
| 隔离浏览器回归 | 员工弹窗 12/12、手机 12/12、团队 12/12、邀请 6/6、Android 安装 9/9，管理 13/13，共 64 项 |
| 真实两个工作区只读 | 18 项；身份/工作区隔离与安全准备状态，详见发布负责人证据 |
| 实际客户端自动恢复 | 缓存缺失恢复、临到期续领、主动重试通过；另一工作区缓存保持，详见发布负责人证据 |
| 真实浏览器平台/既有 Hermes | 同一前端包于1ac0395测得6/6；三视口 × 两入口，initial/refresh/reload 各读，36 截图 |
| 真实浏览器创建/编辑弹窗 | 同一前端包于1ac0395测得10/10；五视口 × 创建/编辑，仅打开/修改未提交表单与关闭，30 截图 |
| 最终原生 default Hermes 模型 QA | succeeded/loaded，discover/list/create/get四工具全部ok，子员工精确default/电脑回读通过 |
| 最终独立 Hermes 模型 QA | succeeded/loaded，discover/list/health三工具ok；遵守原SOUL只读，不创建第二个子员工 |
| 原 profile 与业务动作 | 原config/SOUL不变；0phone动作、0Codex执行 |
| 正式客户端与原生启动 | 22文件/66542bytes包及hash/metadata一致；PID48208/20242/ready，配置不变 |
| 最终清理与保护数据 | 精确QA清理/FK通过，原18保护表count/stablehash保持；原7员工全enabled |
| 最终健康 | 主站1ca9c6b/控制8a4fe59健康、三service active、前端两assets与APK双包HEAD200、Nginx hash保持、0phoneactions |
| 最终两区客户端只读 | 13:29:09Z，18/18；test_222员工3/phone_ai员工2，自身API200/匿名401/跨区403，queue0、PID48208持续ready |
| 最终QA会话撤销 | 13:29:51Z，精确撤销/服务器私有文件移除/本机token清除，旧cookie真实401 |

隔离 management/install 用例主动制造 503 以验证失败恢复，预期 HTTP 错误保留在对应结果中；无非预期页面/控制台错误。隔离弹窗验证原生 skills/phone checkbox 的布局、label/点击、Tab 可见焦点与 Space，并验证保存后手机向导联动；这不等于生产提交员工或手机动作。

真实 HTTPS 浏览器全部请求限定 GET/HEAD/OPTIONS，0 写请求、0 页面/控制台/请求错误、0 手机动作，员工摘要 hash/数量保持 3→3。创建/编辑覆盖 1250×882、1440×900、1280×720、720×450、390×844；底部正文和 footer 可达，管理授权 checkbox 已移除、编辑不显示创建专属手机继续项。五个创建 phone checkbox 均 18×18、gap 8，label/点击/Tab/focus-visible/Space 通过。真实 skills 下拉没有打开，其交互证据来自隔离 fixture。720×450 是 CSS 视口，不声明实际浏览器 200% 缩放。

真实平台/员工页覆盖 1440×900、390×844、720×450；每组初读、刷新、reload 后身份与状态不串区。`test_222` 连接 `device_ceb28133-2103-46c9-8720-b101d2e8acbc` 显示 safe ready，未暴露 credential。既有 Hermes 员工 `employee_748360a3-a0e4-444b-9125-5fe96f943d39`，profile `ziwei-qa-mgmt-20261008`，展示的是旧 `action_e53e820f-d5e0-4d18-a393-633cc3b525bc` 于 `2026-10-08T16:13:55.396Z` 完成的 loaded/三工具成功回执；**该独立 profile 历史记录不能替代本轮 default Hermes 验收**。

截图前只临时隐藏背景 `.sidebar-account` 并在 finally 恢复，不使用会遮挡前景弹窗的白色 mask。所有自建隔离浏览器 context 已关闭，没有操作用户浏览器/profile。

## 最终原生模型结果与历史失败

| Profile | 本次员工/action | 实际结果 |
| --- | --- | --- |
| `default` | `employee_ee92c101-baeb-4bbe-987a-9e4062f5e1a1` / `action_4c1c1dd2-1fdf-4858-98f7-d72698a044c5` | succeeded、loaded=true；`ziwei_discover_environment`、`ziwei_list_employees`、`ziwei_create_employee`、`ziwei_get_employee`全部ok=true |
| `ziwei-qa-mgmt-20261008` | `employee_f9867a4c-2e68-4a47-8bd6-f5efa9999847` / `action_d2d34adf-1646-4185-9c2d-4b5a260e1529` | succeeded、loaded=true；`ziwei_discover_environment`、`ziwei_list_employees`、`ziwei_mcp_health`全部ok=true |

default 链路创建的子员工为 `employee_62e5c7e1-8486-47f2-88eb-606b2de22f47`，回读 `profile=default`，精确电脑 `device_ceb28133-2103-46c9-8720-b101d2e8acbc` 范围正确。独立 profile 原有 SOUL 明确仅允许只读 QA、禁止业务数据创建，因此原请求 discover/list/create/get 写序列没有完成，也没有第二个子员工。该 profile 的三项实际只读工具成功与写序列未完成分别记录；不能描述为两个 profile 都创建成功，也不能为了验收覆盖其原政策。

安全汇总 `native-acceptance-result.json` 确认 `defaultWriteChainPassed=true`、`independentReadPassed=true`、`readOnlyPolicyConfirmed=true`、`independentRequestedWriteSequenceCompleted=false`、`originalConfigsUnchanged=true`、`phoneActions=0`、`codexExecutions=0`。这里的通过范围是默认写链与独立只读链，未扩大到独立 profile 的原始四工具写需求。

首次失败保留在 `native-qa-first-failure.json`：`employee_e3c696be-1f01-4ba8-b209-6eac234d154f` / `action_1d9d3705-d6d7-4eeb-9f6b-c1e553a91c12`，profile default，failed/loaded=false，诊断为 Hermes 退出未收到管理 MCP 握手。后续原生 MCP 准备门槛补齐并取得上表新 action 实际成功；旧失败不改写成功，也不再当作当前待验结果。

## 精确QA清理与最终健康

`2026-10-09T13:22:32Z` 按已核对的精确计划清理4名QA员工、3个conversation、3个terminal action及6条conversation message、11条action event、4条management request引用；tasks删除数0，外键检查通过。审计/通知留痕、原生profile、电脑/手机数据保留，不按名称前缀广泛删除业务资源。

与 `20261009T120235Z` 原baseline对照，18项保护表的count与stablehash全部保持，这是原数据保护验收依据。原7名员工全部management enabled，disabled/null均0；手机配置/绑定各2、邀请8、设备7、配对18、凭据身份5、shared grant1与控制端设备身份均保持。这些数量作为信息快照，不能单独替代稳定hash比较。

最终 `health-final.json` 于 `2026-10-09T13:22:45Z` 通过：主站release1ca9c6b、控制release8a4fe59、三services active，Caq/C30两assets200，Nginx SHA保持原值，Android code15/双APK HEAD200，真实手机动作0。两区最终只读于 `2026-10-09T13:29:09Z` 18/18通过：test_222员工3、phone_ai员工2，自身API200、匿名401、跨区403，两区queue0，原PID48208持续ready。QA会话已精确撤销，服务器私有文件移除、本机token清除；`13:29:51Z` 旧cookie真实401，分别有独立安全证据，不由清理/健康推断。

## 本地证据索引

以下路径均相对本接续工作树；`.local` 是 ignored 私有证据目录，不提交原始会话、缓存或诊断全文到 Git。以下安全汇总与截图用于审计，不包含 token。最终会话撤销与客户端两区只读结果均已归档。

- 真实平台/既有员工：`.local/management-default/live-browser/results.json` 与同目录 36 PNG。
- 真实五视口创建/编辑：`.local/management-default/live-modal/results.json` 与同目录 30 PNG；代表图 `live-create-390x844-bottom-ready.png`、`live-create-720x450-bottom-ready.png`。
- 安装源 RED/GREEN：`.local/official-client-install-red/results.json`、`.local/official-client-install-green/results.json`。
- 隔离管理默认合同：`.local/default-management-ui-final/results.json`；最新官方包场景以 `official-client-install-green` 为准。
- 隔离弹窗：`.local/default-management-modal-final/results.json`。
- 手机/团队/邀请/Android 安装回归：`.local/default-management-phone-regression/results.json`、`.local/default-management-team-regression/results.json`、`.local/default-management-invite-regression/results.json`、`.local/default-management-install-regression/results.json`。
- 最终分范围原生验收：`.local/management-default/native-acceptance-result.json`；原始安全QA摘要 `.local/management-default/native-qa-result.json`。
- 修复前首次失败：`.local/management-default/native-qa-first-failure.json`。
- 原生全局客户端升级：`.local/management-default/client-native-upgrade-result.json`。
- 主站runtime修复发布：`.local/management-default/deployment-hermes-result.json`。
- 正式HTTPS包/hash/metadata只读核验：`.local/management-default/public-download-result.json`。
- 精确QA清理：`.local/management-default/qa-cleanup-result.json`；18原保护表与默认状态复验：`.local/management-default/db-final-safe.json`。
- 最终健康/资源/手机动作边界：`.local/management-default/health-final.json`。
- 最终两区客户端只读18/18：`.local/management-default/client-final-readonly-result.json`。
- QA会话精确撤销/旧cookie401与私有文件清理：`.local/management-default/session-final-result.json`。
- 仅引用安全汇总，不读取或复制private-session、token/cache原文到本记录；QA本机token已清除。

## 最终收尾与后续边界

1. 本轮default Hermes四工具创建回读与独立profile三工具只读已完成实际加载验收；独立原请求写序列未完成，不自动追加写动作或修改其SOUL。精确QA清理、FK与原18项保护表count/stablehash保持已通过；会话精确撤销/旧cookie401及客户端最终两区18/18亦有独立证据，收尾完成。
2. 本轮 Codex 实机按用户“codex这个不用管了”取消，Mac 检测同样保持取消；不为补齐表格另发任务或调整用户配置。
3. 手机“小饱饱”仍 offline，用户暂时无法操作手机。手机配置/只读历史成功保留，截图、有限动作和手机业务实机继续暂缓，无手机 trial/动作提交，不能用管理 MCP 验证代替手机执行。
4. 后续修复发布仍保留主/shared 连接身份、工作目录、`20242`、持久诊断日志、邀请修复、旧 hash 资源、Nginx `^~ /terminal-mcp/v1/` 与 APK/控制服务。不得用项目 `bjc-ops` daemon 冒充真实用户 `test_222/phone_ai` 证据。
5. 发布备份为 `/opt/ziwei-backups/management-default/20261009T130953Z`，前一版 `/opt/ziwei/releases/1ac0395`；回滚需同时核对服务端与原生客户端运行代码，按原入口与备份执行。代码回滚不自动撤销持久资源；不恢复旧库覆盖后续用户数据，不写入或公开秘密。QA资源精确清理及原业务保护复验已完成，短期QA会话已精确撤销、服务器私有文件移除、本机token清除，旧cookie实测401；安全结果归档。

设计合同见[默认管理 MCP 实施计划](../plans/2026-10-09-default-management-mcp.md)；手机独立配置与回执语义见[手机技能用户指南](../PHONE_MCP.md)，其历史发布边界见[手机平台技能验收](2026-10-09-phone-platform-skill-acceptance.md)。当前维护与交接以根目录 PROJECT_MANAGEMENT、README、HANDOFF 的当前默认管理条目为准。
