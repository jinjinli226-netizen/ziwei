# 变更记录

## 2026-10-10 Windows 本地跨盘工作目录

- 目录检查和原生会话/任务/runtime 执行允许配对用户实际有权访问的本地 C/D 等盘目录；config.workdir 作为初始位置及相对路径基准。相对路径只解析一次，盘符简写一致规范化，缺失目录仅明确创建时建立，ACL及身份/私有文件/附件边界保持。
- Windows专项24/24，完整479/479、0skip，lint66/build通过；版本探测测试改为隔离HOME和白名单PATH，并断言精确fixture binary。真实旧客户端C/D错误已复现，官方新包发布与用户电脑实际更新分别记录于[工作目录运维记录](docs/operations/2026-10-10-windows-workdir.md)。

## 2026-10-10 内置数字员工 Creator（已部署 db0aa68，真实 Hermes 验收与精确清理完成）

- 员工市场增加 `ziwei-employee-creator` / 数字员工·Creator 1.0.0；复用原员工管理校验、创建及持久会话流程，按 workspace/owner/template 幂等复用，默认 personal。重复安装保留用户定制配置；兼容旧同名实例仅明确采用并标记原配置来源，不伪称已应用模板人格。
- Creator payload 的模板来源及职责/人格/指令从数据库重建，新增同 workspace/employee/conversation 的有界 user/assistant 历史，排除当前消息、最多16条/12,000字符；历史只作引用，当前请求最后，普通员工保持旧行为。任务会话绑定不一致在入库前拒绝。
- Hermes Creator 使用按 origin/workspace/employee 绑定的持久实例 HOME，MEMORY/state/SOUL 隔离；原认证存储、锁与刷新保持，配置白名单避免复制 source auth、`.env` 与内联秘密。当前支持范围为 openai-codex+本地 memory；其他provider、远程memory和source profile迁移会明确拒绝。可信 runtime 路由在原生 dotenv 重读后恢复，管理与手机用途隔离继续保持；缺 native 确认回执不能报告隔离成功。
- 主站 `db0aa68b0735c30c65acdf342c3080655892a286` 于北京时间00:08:06（`2026-10-09T16:08:06Z`）部署，前一版1ca9c6b，备份 `/opt/ziwei-backups/creator-platform/20261009T144859Z`。仅主API重启；控制8a4fe59、Nginx原hash、Android code15及既有增量保留。新前端 `index-DRTDY7kv.js` / `index-CJMLdFH9.css` 与旧hash资源均200，主站healthy、三服务active；本次双APK仅HEAD200，未重做hash验收。
- 本地最终 **398/398**、0 skip，lint60/build通过，native/runtime隔离新fixture9/9、focused47/47，fixture无模型/手机调用。正式生产市场三视口确认可见、持久会话打开、刷新保留、pageErrors0；不扩大为模型任务通过。
- 公开 tgz 24文件/73,936B，SHA `355aef510a8d52d43308e73d580a7aa93a9390bfd14be2a57d3288fc8c4c04ee` 与metadata/local manifest一致；真实全局客户端PID48624、20242、build `ca0807e0a3f3ace0fa9184c58886dd5e14e76191aae97982865d27caa0800068` ready，原配置不变。
- 正式phone_ai员工 `employee_743801eb-189d-4a57-bb57-64adebf7b571` 与首会话 `conv_3c72ac45-1551-44d2-a1ed-c0900adc137a` 已创建并保留：Hermes/default/原shared电脑/personal/template1.0.0。新只读baseline确认原7员工不变、模板记录1、原主站保护数据除正式实例外不变、控制10保护表不变。
- 真实 Hermes create/verify/repeat/history 四个 Creator parent 全 succeeded / MCP loaded；两名不同岗位/人格的临时 Hermes default 子员工、两任务及共六个 action 全 succeeded，子任务实际输出各自成功 marker。故意 missing 查询真实失败后修正创建；repeat 返回原两员工 ID。history 当前请求不含 ID，仅六次 get 成功回读原两员工/两任务/两 action；历史6条/7,185字符，真实助手回复含六个原ID。
- 四次 Creator 实际模型均为 `gpt-6.1-sol`，原生持久 HOME/state/SOUL 确认、auth/`.env` 未克隆、原配置不变；普通子员工仅确认执行/MCP成功，未宣称其HOME隔离。正式实例最终复用200、duplicate=true、原员工/首会话ID及配置不变。
- `16:22:00Z` 按批准计划 SHA `ade946133e3b71e950643ff9fab26b68a88f8b223a3177bc2ed6d918ee9a6e70` 精确清理 QA 2员工/1会话/2任务/6action及8消息/23事件/2task message/4management request，0模板记录；18张主/控制保护表count/stablehash一致、正式三资源baseline保持、8员工全enabled、FK通过、QA残留0，既有设备/配对/手机/邀请保持。
- 最终两区管理API只读18/18，自身200/匿名401/跨区403，PID48624/20242持续ready；watcher33376心跳ready，先前两区queue=0留证。团队布局两区三视口6/6、18截图、6context全关闭、卡片126px/间距32px，page/console/request/unexpected错误和业务写请求0。16:23:14Z健康通过，16:25:24Z QA登录会话撤销、旧cookie401、服务器私有文件及本机临时token清除。
- Codex真机按用户要求取消、0Codex执行/0手机动作；模板支持保留，其他provider/远程memory/普通员工HOME隔离及APK hash不扩大结论。旧管理MCP发布历史继续保留；实际安全证据在 `.local/creator-platform/` 对应结果JSON/log，详情见 [Creator 运维记录](docs/operations/2026-10-09-creator-platform.md)。

## 2026-10-09 默认自动管理 MCP（已部署 1ca9c6b，真实 Hermes 分范围验收通过）

- 所有工作区的新旧员工默认启用管理 MCP，取消逐员工授权开关和手工 bearer 步骤；准备中、自动接入失败或客户端需更新不会单独阻止保存有效员工配置。工作区、真实电脑在线、CLI、认证/provider 与显式 profile 检查继续保留。
- 有效配对的电脑连接通过 scoped bootstrap 自动领取管理用途、单工作区、短期凭据；每条主/shared 连接独立缓存、续期与恢复，跨区、匿名、失效/撤销身份及错误 audience 继续拒绝。浏览器状态只返回安全准备信息，不返回凭据；普通成员身份与手机独立授权边界不变。
- 开放平台、员工 MCP 页和表单显示自动准备状态、具体失败原因、重试与官方客户端更新入口；接口显式捕获 workspace 并拒绝过期响应串区。API 健康、注入、实际握手与本次工具回执分别展示，`ok:false` 工具调用不标绿。
- Hermes 支持所选真实 `default` 或显式 profile 的原生临时 managed overlay，保留原 `HERMES_HOME` 与认证，不为管理授权强迫独立 profile；手机技能的独立 profile 约束保持。实际管理注入支持 Codex/Hermes，其他运行时缺适配明确失败，不宣称全部 CLI 已真实验收。新安装源改为正式 HTTPS `/downloads/cli/ziwei-latest.tgz`；旧客户端更新沿用原安装/启动入口，不生成配对码或重新连接。
- 主站 `1ca9c6b8761a8ee17adb2fd6d4fa92f385718c05` 已推送并于北京时间 21:18:32 部署，前一版 1ac0395；前端仍为 `index-Caqrwk2Y.js` / `index-C30xBdgl.css`，控制 8a4fe59 保持。备份 `/opt/ziwei-backups/management-default/20261009T130953Z`。保留邀请、手机、卡片与弹窗修复；下方 f790f09 等均是历史发布，其手工 MCP 开关说明不再适用于当前版本。
- 修复首次 default Hermes 无握手，并增加原生 MCP 准备门槛；最终 343/343、lint52/build 通过，真实 default Hermes succeeded/loaded，discover/list/create/get 全成功且子员工 default/精确电脑回读正确。独立 profile succeeded/loaded，discover/list/health 成功；原 SOUL 只读约束保持，写序列未完成、无第二个子员工，不能写成两 profile 均创建成功。首次失败继续留证。
- 官方 tgz 22 文件/66542 bytes，下载与 release metadata/hash 一致；真实全局客户端 PID48208、20242、原配置保持，watcher50908。相同前端包的真实浏览器6/6、弹窗10/10与两区只读18/缓存恢复/续期/主动重试证据保留。0 Codex/手机执行，Codex取消、手机实机暂缓；13:22:32Z精确清理4员工/3会话/3action及6消息/11事件/4管理引用，0tasks；FK通过、原18保护表count/stablehash保持、7原员工均enabled，最终health通过。13:29:09Z两区最终只读18/18通过、自身API200/匿名401/跨区403、queue0；PID48208持续ready。13:29:51Z会话精确撤销、服务器私有文件移除/本机token清除，旧cookie真实401。详见[发布与验收记录](docs/operations/2026-10-09-default-management-mcp.md)。

## 2026-10-09 员工弹窗勾选框修复（已发布f790f09）

- 修复管理MCP和保存后配置手机技能的勾选框继承文本框宽高、文字被挤到最右的问题；共享原生控件18×18、不收缩、标签相邻，保留点击和键盘焦点。SKILLS复用共享类，敏感值控件同步回归。
- 手机继续配置选项移入正文滚动区；编辑标题准确且隐藏创建专属选项。管理MCP未就绪仍阻止提交，可取消不需要的选项，其他就绪条件继续生效。
- 296/296、lint49/build、隔离弹窗11/11、原功能UI36/36、真实五视口创建/编辑10/10、独立footer/body最终5/5通过。生产15次控件交互与员工摘要hash不变，0业务写请求/手机动作；35次交互为隔离计数。临时QA会话撤销实测401。
- 北京时间12:13:51仅前端原子发布，控制端8a4fe59、三服务PID与Nginx配置不变，保留邀请/手机功能、旧hash、数据和APK。详见[验收与回滚记录](docs/operations/2026-10-09-employee-modal-checkbox-fix.md)。

## 2026-10-09 邀请注册修复（已发布82c4f8e）

- 修复个人工作区有效邀请注册400；注册与接受邀请统一事务绑定当前账号，立即获得目标工作区权限，新受邀角色按member/admin、历史同邮箱Owner保留。
- 未知工作区无邀请码明确拒绝并回滚；普通空工作区注册保留创建个人Owner行为。错误持续显示并支持修正重试、已有账号登录接受。
- 完整296/296、隔离邀请6/6、线上新上下文6/6及原UI30/30通过；真实邀请未消费，QA清理完成。发布只重启主API，保留手机技能/路由/数据/APK/旧hash。详见[运维记录](docs/operations/2026-10-09-invitation-registration-fix.md)。


本文件只记录可追溯的项目级变更摘要；详细设计、验证命令和未完成边界见 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)。

## 2026-10-09 手机 MCP 平台技能与完整配置（已发布，实机动作待手机在线）

- `628482d` 登记“紫薇·互联手机操控”v1.0.0 到真实平台技能安装/版本机制；技能中心、员工技能/MCP、互联绑定共用完整向导，支持原表单新增员工返回配置、Codex/Hermes 明确电脑/profile/手机和分阶段证据。
- 每次员工执行以当前工作区电脑身份换取短期精确 capability，桥接原十工具和现有中控队列/回执；管理搭建师新增六项手机技能管理工具共21项，显式授权 phone_ai，原 test_222 主连接与20242保留。同 daemon 双 Owner grant 独立连接，原生重载后两连接从磁盘恢复、配置字节不变。
- 真实网页创建正式 Codex 手机员工；正式搭建师真实模型创建独立 Hermes profile、手机员工和绑定。补齐公网 `/terminal-mcp/v1/` 的 Nginx 代理后，两真实持久员工会话均 MCP loaded/list/status成功，手机offline、commandId为空；无手机动作，不宣称实机通过。
- 276/276、lint/build、手机向导12/12、长卡片12/12、管理UI6/6、真实HTTPS配置9/9、加载后最终只读9/9与匿名transport门槛通过。完整备份双库integrity=ok/12配置，旧hash/APK保留；仅主API重启、Nginx reload，控制端不变。新增用户指南和[发布验收记录](docs/operations/2026-10-09-phone-platform-skill-acceptance.md)，客户端独立退出诊断已补齐，未知退出原因仍如实保留。最新主站由邀请注册T7接续至82c4f8e，完整保留手机增量；本轮文档不再发布。

## 2026-10-09 团队员工卡片重叠修复（已发布）

- `dc39173` 修复完整 instructions 把组织卡片撑高并覆盖设备表的问题；卡片与环境员工行使用两行岗位摘要，完整指令保留在详情与编辑。组织列表按实际排数撑高，最后一排菜单仍可点击，390px 环境员工行文字恢复可读宽度。
- 235/235、lint/build、1440/2048/2549/390px × 三员工/12员工/缺描述共 12 组隔离布局，MCP UI 回归 6/6，以及真实线上 8/8 均通过。线上卡片 787px → 126px，环境与末卡保持 32px 间距；0 写请求、0 设备动作。
- 北京时间 00:50:22 发布，备份 `/opt/ziwei-backups/terminal-console/20261008T164821Z` 双库 integrity=ok、12 配置。runtime 字节一致，三服务及本机 daemon 均未重启。390px 顶部四管理按钮的既有裁切仍保留为范围边界。详见[修复记录](docs/operations/2026-10-09-team-card-layout-fix.md)。

## 2026-10-09 管理 MCP 与正式员工搭建师（已发布）

- 管理实现 `bef1944`：15 项工作区管理 MCP 工具、持久幂等、真实设备/CLI/profile/认证发现、独立 bearer 作用域及 Codex/Hermes stdio 启动注入；凭据保存在 daemon 私有配置，真实握手/工具调用按 execution 审计并反馈到员工页。
- 开放平台展示安全 stdio 接入、真实工具与配置状态；员工配置显式选择电脑/runtime/profile、独立人格和真实技能，Hermes 使用独立 profile，不静默回退。`4acfeb4` 修复 profile 下拉 Escape 关闭整个员工弹窗，`4db30ce` 修复窄屏员工标题被横向按钮挤成竖排。
- 正式“紫薇员工搭建师”已在 test_222 接入；真实模型创建两名 QA 员工、独立 Hermes profile，各重复创建返回同 ID。首次及 daemon 刷新后共 4 项任务 succeeded、实际管理 MCP 工具成功。235/235、lint/build、隔离 UI 6/6、真实 HTTPS 1440/390 通过。
- 该轮主站 `/opt/ziwei/releases/4db30ce`，控制端仍 8a4fe59；原用户配置和 20242 保留，全局客户端已替换旧源码 link。双 SQLite/配置备份、旧 hash 与 APK 保留，未执行手机动作。完整 IDs、证据和限制见 [最终验收记录](docs/operations/2026-10-09-management-mcp-acceptance.md)。

## 2026-10-08 紫薇·互联公开 Android 安装页（已发布）

- 新增无需登录的精确 `/android-install`（含尾斜杠），主站完整“紫薇·互联”增加安装入口和安全工作区返回链接；双 APK 从真实 index/manifest 选最新版本及大小，本地 QR、复制中控地址与双应用安装/权限/入网/审批/绑定指引完整，原主站认证与手机协议保留。
- T4 提交 `81b6ec8d0eb5693f3faf5eab88cd7ff2aeabdb00` 已快进主发布分支并推送，北京时间 22:23 切 `/opt/ziwei/current -> releases/81b6ec8`，source 保持 `8a4fe59`；前端 `index-BUxdmKav.js` / `index-C8foC8Iv.css`。备份 `/opt/ziwei-backups/terminal-console/20261008T142230Z` 保存 mainBefore=`a625350`、sourceBefore=`8a4fe59`、12 配置与两份 integrity 通过的 SQLite。
- backend 和 69 个 runtime lock 条目无变化，新增 jsqr/qrcode-generator 仅 dev 构建/QA；生产复用原 modules。此次未重启服务、未改 Nginx/DNS/daemon/数据/APK，回滚前端 symlink 到 `a625350` 无需重启 API。
- 保留 a625 assets 并补回 f88 的旧 hash JS/CSS，修复独立合成旧文档重放中确认的模块 MIME 白屏：旧 JS 333563 B application/javascript、CSS 172282 B text/css，生产重放登录可见、0 errors。用户已恢复的事故未复现，根因仍未证实，不把此独立缺陷直接归因为用户事故。详见 [白屏调查记录](docs/operations/2026-10-08-white-screen-investigation.md)。后续发布继续保留缓存 HTML 引用的 hash 资产。
- T4 全套 207/207、安装 UI 9/9、终端 UI 6/6，root fresh lint 39 files/build 通过。生产匿名安装页 1440/390 两组通过，QR 像素解码、复制、真实版本/大小及双端 HEAD/GET/SHA-256 匹配，返回管理受登录保护，无 errors/overflow/设备动作；Owner 主站安装入口→安装页→同工作区终端通过，终端 6 checks/5 probes 通过。
- 北京时间 22:26:46 最终生产记录：主站/控制 health=true、三服务 active/NRestarts 0，手机 0/待审 0；临时 QA 会话已撤销、remaining 0，临时 token 文件已删除。证据 `.local/install-live/` 下 results、main-entry、terminal/results、stale-assets/results、deployment JSON。
- 实机安装、权限授权、入网自动配置、真实操控和升级仍未验收。详见 [安装页实施记录](docs/plans/2026-10-08-android-install.md)。

## 2026-10-08 紫薇·互联完整终端管理（主站与源归档兼容均已发布）

### Added

- 主站“紫薇·互联”复用原完整终端页面，提供左右手机列表与详情、待审批准/拒绝及加载/提交/成功/失败/空/过期态、双端健康、手动登记和配置下载、原像素截图操控、控制端切换/暂停、回执核实、APK 选择及双端升级、归档。
- 当前手机绑定已有数字员工和外部账号；保留原员工动作、执行记录和诊断。主站工作区代理使用原登录与 Owner/Admin 权限，管理凭据留服务端，复用原手机配对、状态数据库和 MCP/设备协议。

### Fixed

- summary 省略终态回执造成历史消失和升级预检超时：刷新后读取完整详情，升级预检按捕获手机 ID 校验成功截图；离页后停止后续升级提交。
- delivered/executing 不再提前停止员工运行轮询；acknowledged 保持人工核实语义，终端核实会同步旧运行记录；批准与归档成功提示、首条其他手机绑定混入当前账号等问题同时修复。

### Verification

- `npm test -- --test-concurrency=1`：189/189；lint/build 通过。
- 源归档兼容 Android/terminal-console 测试 36/36、生产 build 通过；覆盖旧 schema 迁移、归档安全阻断、双角色凭据失效及历史保留。
- 默认并发运行在构建 CPU 负载下曾触发既有 daemon 60 ms/100 ms 计时测试失败；隔离 daemon 7/7、完整串行 189/189 通过，没有修改 daemon。
- 隔离真实 HTTP/SQLite 协议验证 6 组、合成浏览器 6/6；覆盖原管理页面、审批状态、完整回执、精确 summary 契约、升级预检/离页停止、员工绑定隔离和窄屏弹窗。
- 真实域名只读浏览器使用主站 Owner cookie 验证 1440/390 px、匿名 401/登录 200、无需源登录、页面/弹窗/导航；0 page/console/request 错误、0 真实设备动作。证据 `.local/terminal-live-evidence/results.json`，真实手机 0/待审 0。

### Release

- 主站提交 `a625350b23926597810fe5181741937933303170` 已推送 `origin/codex/ziwei-terminal-console`，服务器 `/opt/ziwei/current -> /opt/ziwei/releases/a625350`；旧版本 `f88d6f8`，前端 `index-noIbPxU1.js`。
- 部署前双 SQLite/config 备份 `/opt/ziwei-backups/terminal-console/20261008T122923Z`，integrity 检查通过；原数据 symlink、凭据、APK/`dist/downloads` 保留。
- 源归档兼容提交 `8a4fe59f0b2486fb584962fd3006e9a47418037a` 已推送 `origin/codex/phone-archive-compat` 并于 `2026-10-08T12:47:46Z` 部署，`current -> releases/8a4fe59`，服务 active/health 200，兼容列真实存在、手机 0。第二备份 `/opt/ziwei-backups/terminal-console/20261008T124627Z` 含 12 配置与两份 SQLite，integrity 均通过。增量仅 `archived_at` 兼容迁移及原归档行为，保留历史、撤销双角色凭据并隐藏手机；原下载/数据/依赖目录继续链接，旧 `af63071` 兼容额外列，可用于代码回滚。
- 源更新后最终生产复核（`2026-10-08T12:49:03Z`）：真实域名 6 检查/5 探针全部通过；两端 health=true，主站/控制/Nginx 三服务 active，归档列存在、手机 0。1440/390 px 无溢出，0 page/console/request 错误、0 设备动作。APK manifest 与双端下载 200，815470/815474 bytes，SHA-256 均匹配；临时 QA 会话已撤销，服务器/本机临时 token 文件已删除。证据 `.local/terminal-live-evidence/deployment.json`。

### Deferred

- 实机 APK 安装、申请获批后自动领取配置、双端心跳、真实屏幕操作与升级仍待手机验收。未改 DNS/子域名或本机 daemon/配置/数据；本机 `20242` PID `33260`、工作区 `test_222` 本轮仅只读核对。

## 2026-10-06 Hermes Profile 与 Codex 风格会话工作区（已发布）

### Added

- Hermes Profile 创建改为网页发起、目标设备上的 `ziwei_user` 本地落盘；Profile 按设备隔离并支持幂等重试。
- 持久会话增加目标设备、模型和工作目录设置；会话附件通过 A2A 传递并在目标电脑工作目录的 `.ziwei/attachments` 下落盘后交给本机 CLI。

### Verification

- `npm test`：152 passed
- `npm run lint`：passed
- `npm run build`：passed
- 真实本地 A2A Profile 派发链路：passed

### Release

- GitHub：`codex/hermes-independent-profile` 已推送提交 `d18121e`
- 服务器：`/opt/ziwei` 已快进到 `d18121e`，SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261006T073416Z.before-d18121e`，`ziwei-api` active，公网 `/healthz=200`

### Deferred

- 浏览器逐项附件选择和四种真实 CLI 的附件读取仍待手工验收。

### Fixed

- 修复 Windows `ziwei_user` 执行 Codex 时通过 PowerShell `.ps1` 传递标准输入标记 `-` 导致参数绑定失败的问题；daemon 会优先发现用户目录中的新版 `codex.exe`，旧包装器则直接调用其 Node 入口，避免把任务交给 PowerShell 参数解析。
- 全站控件视觉统一：主页加号“通过数字伙伴创建”弹窗、收件箱会话、任务状态、日历筛选和工作区创建等入口改用 `@ziwei/ui` 的 `ZiSelect`，移除前端模板中的原生 `<select>` 残留；目标设备下拉不再显示浏览器默认控件。
- 为原生输入框、文本域、复选框、按钮和自定义 tab/listbox 补齐紫薇蓝色令牌、hover/active/focus-visible/disabled 状态；设备/技能/设置/数字伙伴页 tab 增加 `role="tablist"`、`role="tab"` 和 `aria-selected`。
- 数字伙伴创建弹窗新增 Escape 关闭、Tab 焦点循环、打开时聚焦和关闭后焦点恢复；创建者与目标设备选择器保留真实设备/员工数据和 API 调度逻辑。

- 分离账号、成员关系、工作区类型和设备归属：无邀请注册创建个人工作区，加入团队必须匹配有效邀请；设备配对记录 `owner_user_id`，个人设备查询隔离，团队成员可查看和定向使用团队设备，普通成员不能管理他人设备。
- 增加 `workspaces.kind` 与 `devices.owner_user_id` 兼容迁移；历史设备归属未知时保留空值，不伪造主人。
- 清理前端角色/工作区默认文案和 daemon/CLI/A2A 的 `test-111` 用户数据默认；数据库种子和测试兼容 fixture 保留并记录边界。
- 工作区创建入口支持个人/团队选择；普通团队成员仍可添加并使用自己的设备，但成员邀请、成员编辑和成员移除操作只在 Owner/Admin 页面显示。
- 首次初始化改为只创建本地账号，不创建或接管任何工作区；登录后由用户显式创建第一个个人/团队工作区，初始化页面不再从 URL 推断 `test-111`。
- 个人数字员工记录创建者归属，团队成员无法通过列表、任务、会话或配置接口绕过 `visibility='personal'`；个人工作区任务/会话目标设备在带身份的 API 路径强制校验设备主人。

### Verification

- `npm test`：145 passed
- `npm run lint`：passed（30 source files）
- `npm run build`：passed（Vite production build）
- 源码复现确认：前端 Vue 模板已无原生 `<select>`；未启动或重启现有 20242 daemon，未改数据库或 API 数据逻辑。
- `npm test`：140 passed
- `npm run lint`：passed（30 source files）
- `npm run build`：passed（Vite production build）
- 已推送 `1fe9df7` 到 `codex/hermes-independent-profile` 并部署服务器；SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261005T102338Z.before-1fe9df7`，公网 `/healthz` 和前端入口均返回 200。
### Fixed

- 修复设备目录硬编码创建日期和静态“最后在线”状态，改为读取 SQLite 设备创建时间与心跳时间。
- 增加设备显示名称编辑入口；配对流程保存名称并把名称传给目标电脑，避免所有设备都显示为 `ziwei_user`。
- 允许清理历史种子设备，删除时撤销对应设备凭证。

### Verification

- `npm test`：129 passed
- `npm run lint`：passed
- `npm run build`：passed

## Unreleased（2026-10-03）

### Added

- 新增 `PROJECT_MANAGEMENT.md`，集中维护架构、启动、数据、扩展、排障、测试、发布和 AI 接手流程。
- 新增代理解析与继承：`ziwei_user` 在没有显式代理环境变量时，可读取 Windows Internet Settings 的启用代理并传递给本机 CLI。
- Codex CLI 调用使用 ephemeral 会话，避免桥接器复用遗留 CLI 会话状态。

### Fixed

- 分离账号、成员关系、工作区类型和设备归属：无邀请注册创建个人工作区，加入团队必须匹配有效邀请；设备配对记录 `owner_user_id`，个人设备查询隔离，团队成员可查看和定向使用团队设备，普通成员不能管理他人设备。
- 增加 `workspaces.kind` 与 `devices.owner_user_id` 兼容迁移；历史设备归属未知时保留空值，不伪造主人。
- 清理前端角色/工作区默认文案和 daemon/CLI 的 `test-111` 用户数据默认；保留 A2A/测试兼容 fixture 并记录边界。

### Verification

- `npm test`：133 passed
- `npm run lint`、`npm run build`：待本轮最终验证
### Fixed

- 修复 Codex CLI 因 daemon 未继承本机代理而持续等待并最终报告 `A2A action timed out after 600000ms` 的问题。
- 修复生产前端登录请求仍指向 `http://127.0.0.1:4178` 的问题：开发模式保留本机 API 默认值，生产模式默认使用当前页面 origin，并允许 `VITE_API_URL` 显式覆盖；WebSocket/SSE 也随同源地址工作。
- 真实短 CLI 请求已通过代理返回 `OK`；历史失败动作仍保留原始失败状态，需要重新发送。

### Verification

- `npm test`：84 passed
- `npm run lint`：passed
- `npm run build`：passed
- `ziwei_user /readyz`：ready
- 后端 `/healthz`：HTTP 200
- 生产 API 预检：`OPTIONS https://154.202.118.5/api/auth/login` 返回 204，并包含允许当前 HTTPS origin 的 CORS 头。
- 前端 API 地址回归测试：开发默认、本页面 origin 和显式覆盖均通过。
- 服务器 `https://154.202.118.5`：HTTPS、前端、API 和 SQLite 已部署；服务器证书已加入当前 Windows 用户信任存储。
- 本机 `bjc-ops` Agent 已通过真实 A2A action 完成回传；用户级启动目录脚本 `ZiweiUserRemoteAgent.vbs` 已验证可拉起 daemon，无需管理员权限。
- 已初始化测试登录账号 `admin@ziwei.local` 并验证登录、`/api/auth/me` 与工作区列表；服务器 root 密码未修改。

### Deferred

- 远端 Git 双向同步、生产级 PostgreSQL/Redis/对象存储/队列、OAuth/计费/沙箱，以及完整浏览器像素和跨平台安装验收仍未纳入本次完成范围。

## 维护规则

每次功能变更都追加日期、目的、影响边界、验证命令、未验证项和回滚方式；不要修改历史条目来掩盖旧状态。
# 2026-10-03

- 修正本地 `@ziwei/ui` tarball 的 `package-lock.json` integrity，确保干净服务器执行 `npm install` 可复现。
- 完成本地工作区与远端服务器的真实部署验证：服务器由 systemd 管理 API，Nginx 提供 HTTPS，Windows `ziwei_user` 通过出站 A2A 轮询连接服务器并成功执行回传。
- 当前服务器证书按 IP 使用临时自签名证书；接入正式域名后应替换为受信任证书。

## Unreleased（2026-10-04）

### Added

- 数字员工详情页的环境变量已接入 repository/API/SQLite：员工级变量采用 AES-256-GCM 加密存储，敏感值列表和 UI 只返回掩码；本机 `ziwei_user` 变量仅展示名称与来源，不进入普通列表或日志。环境变量写入仅限 Owner/Admin，读取仍遵循工作区成员权限。
- 自定义参数支持 JSON 对象读取、编辑、校验、全量替换和持久化；新增表使用 `CREATE TABLE IF NOT EXISTS` 与迁移兼容旧数据库。
- MCP 详情页接入真实状态、工作区范围、HTTPS 管理端点、健康检查和窄管理面边界；`scripts/ziwei-mcp.mjs` 新增 `ziwei_mcp_health`，继续只通过 `/mcp/v1` 管理员工、任务、文档。
- Hermes profile 发现、profile 名称校验和独立 `HERMES_HOME` 说明已接入；已发现 profile 之外的名称会给出明确失败，远程 API 无法看到本机 profile 时仍由 `ziwei_user` 作为运行时来源。

### Verification

- 新增 repository、API、UI contract、Hermes profile discovery 测试；专项测试和现有 MCP/runtime 测试通过。
- `npm test`：104 passed；`npm run lint`：passed；`npm run build`：passed；服务器已快进到 `8a95ac8`，SQLite 备份为 `/opt/ziwei-backups/ziwei.sqlite.20261004T104845Z.before-8a95ac8`，API 重启后健康检查通过。
- 隔离 HTTP 验证：实际 `scripts/ziwei-mcp.mjs` 客户端通过 `/mcp/v1` 返回 health、员工列表和窄管理面能力；本机 Hermes profile 发现 5 个，`ziwei-aigc` 校验通过。

### Deferred

- 伙伴市场、帮助中心和邮件发送保持现状并延期；本轮未用假页面标记为完成。远端 Git、生产外部存储/队列、OAuth、计费、沙箱和完整浏览器逐页截图验收仍延期。
- 环境变量和自定义参数当前仅完成加密持久化与配置页编辑，尚未进入 A2A/CLI 执行环境；MCP 尚未提供这两类配置的工具入口。

### Rollback

- 本轮未触碰 `tmp_gzgov.html`，生产 SQLite 只做了备份和兼容迁移初始化。代码可用 `git revert 8a95ac8` 回滚，服务器数据可恢复 `/opt/ziwei-backups/ziwei.sqlite.20261004T104845Z.before-8a95ac8`。
