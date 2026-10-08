# 2026-10-09 管理 MCP 真实员工验收与发布

## 交付结论

管理 MCP、开放平台接入说明、员工运行时注入及正式“紫薇员工搭建师”已上线。搭建师的真实 Codex 模型经 stdio 管理 MCP 发现设备/CLI/profile/技能、创建独立 Hermes profile、创建两名 QA 员工、安排只读任务并回读终态。两个 runtime 首次和 daemon 进程刷新后的共四项 QA 任务均实际 `succeeded`，有真实握手、工具调用审计和各轮结果标记；没有以宿主工具、管理员代建 QA、API 健康或配置注入冒充员工工具调用。

正式域名为 `https://qzelynth.top`，工作区 `test_222`，目标电脑 `zheng`。本轮没有调用手机工具、修改手机绑定、控制源、DNS、IP 或端口。`phone_ai` 员工、绑定和主站员工运行记录最后仍为 0；手机管理历史的旧 MCP/TLS 问题不在本轮已通过范围。

## 代码、发布与客户端

| 项目 | 最终事实 |
| --- | --- |
| 发布分支 | `origin/codex/ziwei-terminal-console`，GitHub 已推送 |
| 管理 MCP 实现 | `bef1944d67d62be1b316ef1a9533d53a13a4bb63` |
| 当前线上代码 | `4db30ce6d5cca2955d4e2a09103c55b53271ee36`；4acfeb4 修复 profile Escape，4db30ce 修复窄屏标题 |
| 主站 current | `/opt/ziwei/releases/4db30ce` |
| 控制端 current | `/opt/ziwei-control/releases/8a4fe59`，本轮未改 |
| 前端资源 | `index-Bebxc5Te.js` / `index-DejeXhlj.css` |
| 首次管理发布 | 北京时间 2026-10-09 00:03:50，仅重启既有 `ziwei-api.service` |
| Escape 前端补丁发布 | 北京时间 2026-10-09 00:14:28，无服务重启；backend/daemon/src/package/lock/MCP 脚本与 bef1944 逐字节一致 |
| 窄屏标题补丁发布 | 北京时间 2026-10-09 00:28:55，无服务重启；主 API PID 保留，运行时代码与前一版逐字节一致 |
| 运行状态 | 主 API、控制 API、Nginx 均 active，NRestarts=0，主站 health=true，双 SQLite quick_check=ok |
| 真实全局客户端 | `D:\work\nodejs\node_global\node_modules\ziwei`，已替换指向旧 D checkout 的 npm link |
| 客户端包 | 实现 bef1944 的 `ziwei-0.1.0.tgz`，19 文件，shasum `7652718ff0b3b59736645dd545bf648ffc4aa949` |
| 实际 CLI | Codex `0.162.0-alpha.2`；Hermes `0.21.3` |
| 真实 daemon | 用户目录配置，test_222，`20242`，刷新后 PID `49296`，ready=true，管理 MCP configured=true |

本轮在 `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解` 接续；原 `D:\灵光爸爸拆解` 用户修改及本工作树三份原未跟踪文件保留。项目 `data/ziwei_user.json` 的 `bjc-ops` 仅用于隔离代码验证，没有启动项目 daemon 冒充真实服务器结果，也未新增本机业务服务实例。

升级前备份了用户配置和全局 shims。原 API、workspace、设备身份/凭据、workdir、健康端口全部保留，只新增私有 `managementMcp`；原配置字段逐项比较一致。安全确认没有 pending/acked 的有效 action 后刷新 `1700 → 49296`，用户配置 SHA-256 不变。原生 `ziwei_user change` 对同一工作区不刷新进程，第一次调用仅返回“已是当前工作区”；随后核对准确 daemon PID/命令路径，停止该已授权进程，再用原生 `ziwei_user start` 启动，实际首次心跳恢复后才派发复验。

## 正式员工与复现入口

正式员工 **紫薇员工搭建师**：

- ID：`employee_eddccbcf-3faa-4f55-a2f9-a12de9c679fe`。
- 入口：[正式员工详情](https://qzelynth.top/test_222/employee/employee_eddccbcf-3faa-4f55-a2f9-a12de9c679fe)，由员工页进入对话。
- Runtime/model：Codex / `gpt-6.1-sol`；目标电脑 `device_ceb28133-2103-46c9-8720-b101d2e8acbc`（zheng）。
- 职责：梳理需求、发现真实运行环境、按显式 runtime 创建/调整员工并验证交付。人格：严谨、耐心、直白、证据优先。
- 真实技能“员工搭建与只读验收”，ID `skill_e3843bd0-6fde-4fa0-9a6e-c4f6e8f22fd5`；管理 MCP 开关开启，凭据由 daemon 私有配置注入。

Codex 示例指令：“在 zheng 创建一个 Codex 员工，名叫只读巡检员，职责是只读检查工作区状态，人格严谨直白，挂载员工搭建与只读验收技能，启用管理 MCP，安排只读试运行并回读实际结果。重复请求先核对，不重复创建。”

Hermes 示例指令：“在 zheng 创建一个 Hermes 员工，名叫资料核验员，使用新建的独立 profile，职责只读核验工作区资料，人格耐心可靠，挂载员工搭建与只读验收技能，启用管理 MCP。先发现 provider/auth 是否就绪，再安排只读试运行并报告真实 task/action 结果。”

运行环境不满足时应报告具体 CLI/profile/provider/auth/设备错误，不允许静默替换 runtime 或退回主 Hermes profile。新员工名称与稳定幂等键应和该次业务意图绑定；同一 key 改变意图返回 409。

## 模型实际创建证据

首次搭建师会话 `conv_fcd81ec0-ec00-4499-b6bc-97e35034f7d2`、action `action_e3ba2784-f6d0-4eb5-8cd3-a40d05bdbff7` 最终 `succeeded`。本机 stdio 审计记录 31 次实际工具调用，0 失败，含 discovery、独立 profile、员工创建、任务创建及 action/task/MCP 状态回读。

| QA 资源 | 真实 ID 与配置 |
| --- | --- |
| Codex QA | `employee_20f5a646-025c-4e05-aed9-d08ba60edd72`，名称 `QA-管理MCP-Codex-20261008`，Codex / gpt-6.1-sol / default |
| Hermes QA | `employee_748360a3-a0e4-444b-9125-5fe96f943d39`，名称 `QA-管理MCP-Hermes-20261008`，Hermes / `ziwei-qa-mgmt-20261008` |
| 独立 profile 创建 | `action_eaae6160-c137-4edd-8f19-9e940090c1cd`，succeeded，inheritedProvider=true，随后设备发现 auth/provider ready |

两个 QA 均绑定上述真实电脑，保存明确的岗位职责、独立 persona、真实技能和管理 MCP 开关。搭建师对每名员工实际调用 `ziwei_create_employee` 两次，各自返回同一 ID；读取列表确认各仅一名。QA 由模型实际创建，管理员 API 仅用于正式搭建师及技能的授权引导配置。

Hermes 独立 SOUL 与创建 action 内容一致。主 Hermes config 的 SHA-256 与独立 profile 注入前备份一致；主 config/SOUL 修改时间早于本次 QA 创建，独立 auth 文件的真实路径不同。独立 config 的 MCP 节点经 YAML 合并、保留已有 provider/MCP 并备份，秘密值使用 `${ZIWEI_*}` 环境引用，file-token 模式没有未设置的字面 token。未覆盖主 profile；主 SOUL 没有任务开始前的独立哈希快照，未覆盖判断使用实际文件时间和配置备份证据。

## 四项真实只读任务

| 阶段/runtime | Task ID | Action ID | 真实结果 |
| --- | --- | --- | --- |
| 首次 Codex | `task_4d58b354-604f-4e3e-a851-5a330dc60ab2` | `action_ecf39f05-2702-4be7-bcbb-b31d5b15318c` | succeeded，`CODEX_MANAGEMENT_MCP_OK` |
| 首次 Hermes | `task_7df20d4d-a3f0-4cf6-a00f-698363b8bee5` | `action_47d0a3ea-ecb1-4b4c-a2a2-fcf84f480b8d` | succeeded，`HERMES_MANAGEMENT_MCP_OK` |
| 刷新后 Codex | `task_15d0cbd7-cfc8-4147-ab51-469f7329f387` | `action_535380cf-879c-4c36-b444-b98cb7ede62b` | succeeded，`CODEX_REFRESH_MCP_OK` |
| 刷新后 Hermes | `task_ea97e57c-4ccd-47a8-9f07-2d6b00930a98` | `action_e53e820f-d5e0-4d18-a393-633cc3b525bc` | succeeded，`HERMES_REFRESH_MCP_OK` |

四项结果的实际 runtime/profile 均匹配员工配置，Hermes 始终为独立 QA profile。首次各实际调用 `ziwei_mcp_health`、`ziwei_list_employees`；刷新后两者还调用 discovery。每次独立审计均有 initialize/tools-list 握手与本次成功工具调用，回传 `managementMcp.loaded=true`。任务包含当前工作区、员工名称、runtime/profile 和本轮标记。Hermes model 字段为 null，表示沿用已发现且就绪的独立 profile provider 配置，没有猜测或强制替换模型。

Codex 的 `result.output` 还包含模型的过程说明，未严格遵循试运行提示词要求的“仅五项”输出格式；搭建师已在会话如实指出该格式不符合项。本轮通过结论针对真实 runtime/profile、管理 MCP 工具调用和任务执行链，不宣称严格五行/机器可解析输出格式通过，也没有删除原始说明来制造通过结果。Codex 继承环境的其他技能解析/无关 MCP 诊断亦保留，未阻断本轮管理 MCP；本轮未修这些既有环境项。

刷新后正式搭建师会话 `conv_52665ee4-1946-4fd3-a4d9-9dff5f04d865`、action `action_178ba8c0-4073-4c07-a144-50c0bcc7d5e4` 最终 succeeded；该会话没有调用创建员工工具，两 QA ID 和名称计数不变。

## 安全与状态边界

- 真正的 MCP transport 是本机 stdio；Node MCP 服务内部经 HTTPS 调 `/mcp/v1`，不直接读取服务器 SQLite。开放平台不能把 HTTP 管理根地址当成远程 MCP URL。
- 专用 MCP bearer、用户 API Key、daemon 设备凭据独立。既有 bjc-ops bearer 保留，新增 test_222 独立作用域凭据；实际 test_222 health=200，bjc-ops/phone_ai=403。匿名和 Owner cookie 直接 MCP health=401；Owner 可以读取自己的网页状态/discovery，但 cookie 不能替代 bearer。
- daemon 仅信任本机私有 managementMcp 配置，action 不可覆盖 token/baseUrl/工作区。员工 launch 注入 runtime/profile/device/workspace 一致性检查；无握手、工具全部失败或认证/provider 不就绪明确失败。API 健康、configured、injected、loaded、tool_calls 分开记录。
- 专用 token 文件位于用户私有目录，仅记录路径；文件权限收紧。未进入人格、职责、技能、提示词、前端、Git 或日志。分执行 JSONL 审计仅含方法、工具名、状态及资源 ID，不存参数、提示词或密钥。
- 实际员工文本、五份日志、审计及 170 个当时活动进程参数扫描未发现已知 credential 值；已退出 CLI 的历史 argv 无法事后观测，未把这项有限扫描夸大为全历史证明。
- 只有 Codex/Hermes 完成本轮实际管理 MCP 验收。Claude/Gemini 等仅发现 CLI 的环境仍不代表认证或工具链就绪；旧 provider 缺失的 Hermes profile 不会被标为可用。旧手机 MCP 配置未修改，手机员工执行和升级没有新增验收结论。

## 自动化与浏览器验证

- Escape 修复后的完整串行 `npm test -- --test-concurrency=1`：235/235，0 fail/skip；fresh lint 43 files、生产 build 通过。后续窄屏员工标题样式修复单独完成 build 与隔离浏览器验证，没有重复无关 Node 测试。
- 隔离浏览器 6/6；包含发现、明确 runtime/profile、独立 Hermes 创建、幂等重试、加载证据和错误恢复。两条预期 503 控制台记录来自故意注入的失败恢复用例，页面错误/请求失败均 0，没有当作真实域名无错误证据。
- Escape 补丁 4acfeb4 的真实生产开放平台 7 项检查、6 个认证探针通过，实际 JS 为 index-quKVAEMI.js。1440/390 px 各显示 test_222、15 工具、API 健康、安全 stdio 复制、真实电脑与 Codex/Hermes profiles。Escape 第一次只关下拉，第二次关闭员工编辑弹窗。12 张侧栏账号脱敏截图；0 page/console/request/http 错误，0 写请求和设备动作。后续 4db30ce 仅改变员工页窄屏 CSS，综合后验与真实标题截图另存最终证据。
- 真实 employee/task/conversation 后验使用只读 Owner 浏览器，13 项检查通过，核对正式搭建师与两 QA 的实际工具证据、QA 任务列表及持久会话结果，保留两种宽度 12 张截图；0 page/console/request 错误、0 写请求和设备动作。人工截图检查发现窄屏员工标题被横向按钮挤成竖排，另以员工页范围的窄屏 CSS 修正并复验。
- 失败历史保留：生产首轮 Escape 问题、第二轮脚本读取 profile 异步结果过早，以及 root 在搭建师最新 action 尚未终态时等待 loaded 状态超时。持久会话检查还修正了缺少员工查询上下文及错误状态文案的脚本断言。修复/调整后复验，未删除原证据，未将尚未完成误报为成功。

## 本机证据位置

完整证据保存在接续工作树 ignored `.local/management-mcp/`，不向 Git 推送真实用户任务内容、session 或私有配置：

| 文件/目录 | 用途 |
| --- | --- |
| `live-api-acceptance.json` | 首次链路 11 项检查、资源 ID、幂等、profile 与任务实际结果 |
| `live-runtime-acceptance.json` | 实际 profile、主配置保留、审计、凭据脱敏扫描 |
| `client-upgrade.json` / `client-refresh.json` | 真正全局安装、原配置字段、PID 刷新与就绪 |
| `live-refresh-acceptance.json` / `exercise-refresh-latest.json` | 两 QA 刷新后任务与搭建师收尾 |
| `live-open-platform-final/results.json` | 最终生产开放平台、认证、复制与 Escape，12 截图 |
| `live-browser/results.json` | 最终员工/任务/持久会话只读浏览器和截图 |
| `live-header-final/results.json` | 最终 4db30ce 员工标题 390/1440 只读几何与截图 |
| `bearer-scope.json` | 本工作区 200、跨工作区 403 |
| `npm-test-final-ui.log` | 最终 235/235 完整测试 |
| `deployment.json` / `deployment-ui.json` / `deployment-final.json` / `final-server-state.json` | 发布与服务/数据库核验 |
| `session-cleanup.json` | 临时 Owner 会话撤销与私有传输文件删除 |
| `final-acceptance.json` | 最终 15 项交付检查、版本、错误计数和边界汇总 |

本机实际 MCP 审计目录：`C:\Users\25941\AppData\Local\Ziwei\ziwei_user\runtime\management-mcp-audit`，按 action/实例分文件。daemon 持久日志在同一用户目录 `logs\daemon.log`，保留轮转历史；升级日志 `logs\client-upgrade.jsonl`。端口登记保留原项目归属，5178/4178 未启动本地服务，20242 由真实全局 daemon 使用。

## 备份、回滚与保留资源

管理代码发布前备份 `/opt/ziwei-backups/terminal-console/20261008T160342Z`；两次前端补丁前备份 `/opt/ziwei-backups/terminal-console/20261008T161330Z`、`/opt/ziwei-backups/terminal-console/20261008T162818Z`。三次主站/控制 SQLite integrity 均 ok，每次保存 12 配置。真实 data/.local 目录、服务端凭据、APK、旧 hash 资源均保留。

最新前端补丁回滚可切 current 至 4acfeb4，backend 字节相同，无需重启 API。完整管理代码回滚至 81b6ec8 需重启既有主 API 并检查健康；新增 SQLite 列/表为兼容增量，代码回滚不删除正式/QA 员工、profile、任务或专用 bearer。不要为回滚盲目恢复整份数据库覆盖发布后的有效数据。客户端恢复须使用已备份用户配置和原安装来源，不使用项目 bjc-ops 配置。

正式搭建师、真实技能、两个明确 QA 命名的员工及独立 QA profile 保留，便于复现。北京时间 00:31:33 已撤销临时 Owner QA session，并实测原会话读取返回 401；两端临时 session/credential 传输文件已删除。专用生产 MCP bearer 保留供正式员工持续运行，不误删实际配置。00:31:36 最后服务器检查为主站/控制/Nginx active、主站 health=true、两 SQLite quick_check=ok；真实 daemon 仍 ready=true、PID49296、test_222，管理 MCP configured=true。最终 15 项汇总检查全部通过，严格 Codex 五项输出格式仍单独列为未通过边界。
