# 紫薇项目 HandOff

## 2026-10-10 当前接续：Windows 本地工作目录

目录 inspect 与原生执行不再把 config.workdir 当唯一批准根；用户可访问本地 C/D 等盘，默认目录仅作起点及相对基准。两层统一词法/真实路径解析，修复相对路径重复解析和盘符简写；Windows ACL、设备/工作区、runtimeDir/附件边界保留，非 Windows 原规则保持。24 项专项及隔离 CLI 实际 cwd、旧 bigtron 客户端 C/D 错误已有证据。源码/官方包发布及用户实际更新分别记录，见 [工作目录运维记录](docs/operations/2026-10-10-windows-workdir.md)；不得据历史 disconnected 磁盘配置停止或重配对当前在线 bigtron 实例。

> **当前维护入口**：请先阅读根目录 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)。本文保留阶段性交接时间线；其中较早的验证数字和“待完成”描述可能已经过时，当前状态以项目管理手册、代码和最近一次真实验证为准。

> **2026-10-08 历史环境区分说明**：本地 checkout、5178 前端、4178 API 和项目 `data/ziwei_user.json` 是 `bjc-ops` 的本地代码验收环境；真实本机 `ziwei_user` daemon 由全局命令启动，使用用户目录配置连接 `https://qzelynth.top` 的服务器工作区 `test_222`。不要把项目配置或项目 daemon 当成服务器 daemon；接手时分别核对用户目录配置、项目配置和各自 `/readyz`。详细维护约定统一见 `PROJECT_MANAGEMENT.md`。

## 2026-10-10 当前发布：Windows 客户端检测与维护（已上线）

最新范围仅Windows：设备树与后端读取每台电脑自身runtime元数据，CLI区分未找到/检测失败/未上报/设备离线，新增安全stop/update/uninstall与旧版PowerShell官方升级入口。主站36d6bf1于04:02:12Z部署、仅主API重启；最终静态前端4464bb5于04:22:16Z发布且服务PID不变，控制8a4fe59/Nginx/Android保持。用户本人bigtron/device_bfd9a3d2…实际页面4/4可用、另一台791独立1/4，三视口24/24、39截图、零业务写和正常错误；版本标签裁切已修。

完整回归454/454、0skip，最终WinPS5编码新增回归1/1，lint65/build、布局fixture24/24；实际纯IRM|IEX隔离全局升级/停止/恢复/卸载11/11。公开包SHA628976fc…、93,329bytes、Windows真实npm安装build6d0709a2…，原归档sourceBuildcf30d9b6…（npm仅归一shebang换行），公开metadata已区分。最终ASCII无BOM脚本来源c5b720b，公开SHA与真实HTTP解码已验证；两次OwnerQA均撤销、旧cookie401、私有token文件清除。

本人实际PID58720/旧build40af5811、20242在线，本轮未停止/升级/重连；Gemini旧误报Codex版本仍展示现有心跳，需更新原客户端才上报新探测。旧用户目录断开配置hash不变，不能把磁盘历史0连接当作当前运行状态。用户新正式工作区/账号/邀请/设备保留，不重跑清理；Creator/phone_ai/手机MCP/配对/认证/工作目录保持。最终备份 `/opt/ziwei-backups/windows-client/20261010T035832Z`，两库integrity/FK与保护资源复核通过，回滚仅代码不整库覆盖。Mac适配、本人daemon升级、模型/provider和手机实机未执行。完整证据、准确命令与限制见 [Windows 运维记录](docs/operations/2026-10-10-windows-client-maintenance.md)。

## 2026-10-10 历史接续：业务清理与本机全部断开（已完成）

- 最新用户授权覆盖下方历史“test_222 主连接保留”目标：删除 `test_222` 和其他无关工作区、员工及业务记录，保留 `phone_ai` Creator/手机 MCP；当前电脑 `ziwei_user` 最终清空所有主/shared 连接并停止，不自行重新配对或重新运行员工。
- Creator 原 shared 持久 HOME、记忆、人格、profile、正式会话和模板，两个手机 MCP 宿主、技能/配置/绑定，以及手机配对/节点/控制服务均受保护。客户端程序、工作目录、CLI/provider 认证和其他项目数据不属于删除范围。
- 生产主站 `3421046684a2ab1b484674500b803ea6dd1c14b7` / `/opt/ziwei/releases/3421046`，控制仍 `8a4fe59`，Nginx 不变。一次性 seed marker 和 native forget 已发布。`02:20:20Z` 按审核 SHA `b7077d642890aa6b4a691e23d0731958b8c4ecce6bce2d3101a5559f43aae7a2` 删除 6,665 行、迁移 5 项平台技能归属。真实剩余 phone_ai 1 区、Creator+2 手机宿主、f956 1 电脑/凭据、Owner 1、技能 6、正式会话/模板各 1；普通任务/消息/历史为 0，手机配置/绑定各 2、中控手机 2/节点 4（页面活跃 1/2）保留。
- 本机全局包升级 PID48624→52780 后原生 forget 已完成：0 连接/4 对应缓存删除/20242 无监听，两个 daemon 与观察器均退出，不自行 start/connect。Creator 原 HOME 20 持久文件、2 action-state、4 源 config/SOUL 哈希不变，认证及用户目录保留。
- 停写前备份 `/opt/ziwei-backups/launch-cleanup/20261010T021519Z-predelete`，本机最终备份 `C:\Users\25941\AppData\Local\Ziwei\backups\launch-cleanup-disconnect-20261010T021200Z`，双库及 Creator state 独立恢复校验通过。断开前实际 Creator 只读 succeeded/loaded；断开后不宣称可执行。桌面/390px 实际 18/18、34 图、正常错误与业务写请求 0；原图长摘要两行/卡高126/环境gap32，正式会话打开刷新正确。
- 在线 SQL 验收长读锁曾使主服务短暂退出，systemd 于02:22:10Z恢复；保留首轮17/18及502证据，改用 backup API 离线快照后复验通过。最终85表仅接受既有登录last_seen变化、已撤销QA一行及控制启动单设备lease宽限这一精确例外，其余保留字段与删除后清单一致。临时QA已撤销/旧cookie401/两端token文件清除；原4账号保留。实际手机动作、Codex执行均0。完整结果见 [2026-10-10 运维记录](docs/operations/2026-10-10-business-cleanup.md)。

## 2026-10-10 追加接续：紫薇 Logo favicon

- `74cefd5485916614d8357e779fdb3f223b1d53e8` 仅增前端head PNG favicon声明，复用全局品牌原图与内容版本URL，构建/diff check通过；02:41:16Z以os.replace原子替换3421046的静态index，后端仍3421046、控制8a4，业务JS/CSS/53项旧assets、三服务PID/重启计数、CLI/APK与数据库均保持。
- 正确图片URL为 `https://qzelynth.top/ziwei-logo.png?v=68452b1f4299`，实际200/image/png/hash与全局一致。五个无Cookie浏览器入口5/5、context全关闭、16/32px解码渲染通过，错误/业务写0；Headless自动标签图标未目视，证据边界如实记录。当前本机继续disconnected/0、20242无监听；旧HTML备份 `/opt/ziwei-backups/favicon/20261010T024116Z`，只恢复静态index即可回退。详见 [favicon运维记录](docs/operations/2026-10-10-favicon.md)。

## 2026-10-10 历史接手续记：内置 Creator 发布、真实 Hermes 验收与清理已完成

- 生产代码为 `db0aa68b0735c30c65acdf342c3080655892a286`，北京时间 **00:08:06**（`2026-10-09T16:08:06Z`）发布 `/opt/ziwei/releases/db0aa68`，前一版 `1ca9c6b`。备份 `/opt/ziwei-backups/creator-platform/20261009T144859Z`；仅主 API 重启，控制仍为 `8a4fe59`，Nginx 原 hash 不变。新前端 `index-DRTDY7kv.js` / `index-CJMLdFH9.css`，新/旧资源均 200，主站健康、三服务 active、Android code15 双 APK HEAD200 已证；此处没有新增 APK hash 或手机实机结论。
- 市场模板 `ziwei-employee-creator` 1.0.0 使用现有员工、管理校验和会话系统，按 workspace/owner/template 幂等复用；默认 personal，不自动覆盖已定制实例。旧同名兼容实例采用时保留原配置并标记 `adopted-existing`，不假称已应用 v1。跨区/私有成员/伪造 actor 与真实电脑、CLI、auth/provider/profile 检查继续保留。
- 正式 `phone_ai` Creator **保留**：员工 `employee_743801eb-189d-4a57-bb57-64adebf7b571`、首个会话 `conv_3c72ac45-1551-44d2-a1ed-c0900adc137a`，Hermes `default` / `device_f9568c06-d932-4264-9d4c-acc5122097ea` / personal / template 1.0.0。三组真实视口 1440×900、390×844、720×450 已确认市场可见、持久会话打开、刷新保留、pageErrors 0；原员工 7 个不变，正式实例与 1 条模板元数据已纳入新的只读 baseline。
- Creator 每次会话执行只拼接本会话、本员工、本工作区最近 user/assistant 文本：排除当前消息，最多16条/12,000字符，历史是引用，当前请求最后作为执行依据。普通员工不扩历史；派发快照不包含之后才产生的前轮回复。Hermes 实例 MEMORY/state/SOUL 使用独立持久 HOME，原认证路径不复制；当前只验证 openai-codex+本地 memory，绑定 profile 迁移/其他 provider/远程 memory 安全拒绝。模型及工具调用仍需本次真实 action 结果与 MCP audit。
- 发布前本地 **398/398** 测试、0 skip，lint60/build通过；runtime无模型 fixture 新9/9、focused47/47。公开客户端24文件/73,936B，SHA `355aef510a8d52d43308e73d580a7aa93a9390bfd14be2a57d3288fc8c4c04ee` 与公开metadata一致。原生全局 PID48624、20242、build `ca0807e0a3f3ace0fa9184c58886dd5e14e76191aae97982865d27caa0800068` ready；原配置保持，不重新配对。
- **真实 Hermes 四阶段验收通过**：四个 Creator parent 的 create/verify/repeat/history 均 succeeded / MCP loaded；两名不同岗位/人格的 Hermes default 临时子员工、两任务及共六个 action 全部 succeeded，子任务返回各自成功 marker。故意 missing 查询真实失败后完成修正创建，repeat 返回原两员工 ID；history 当前请求无资源 ID，仅六次 get 回读原两员工/两任务/两 action，派发历史 6 条 / 7,185 字符且包含真实助手返回的六个 ID。四次 Creator 实际模型均为 `gpt-6.1-sol`，同一持久 HOME 的原生 state/SOUL 确认存在、auth/`.env` 未复制、原配置不变；普通子员工未宣称 HOME/memory 隔离。
- `16:22:00Z`（北京时间00:22:00）批准计划 SHA `ade946133e3b71e950643ff9fab26b68a88f8b223a3177bc2ed6d918ee9a6e70` 已执行，精确删除 QA 2员工/1会话/2任务/6action，以及8消息/23事件/2task message/4management request，0模板记录；正式 Creator、首个用户会话与模板记录保持新 baseline `/opt/ziwei/.local/creator-platform/formal-baseline.sqlite`。清理后18张保护表count/stablehash一致、8员工全enabled、FK通过、QA残留0；旧management-default清理计划不适用，既有设备/配对/手机/邀请未改。正式 POST 复用最终200、duplicate=true、配置与原正式ID不变。
- 最终两区 health/discovery/employees 只读18/18，自身200/匿名401/跨区403；PID48624/20242持续ready，先前两区queue=0留证，watcher33376最新心跳仍指向同一ready进程。团队布局两区三视口实际6/6、18截图、6 context全关闭，卡片126px/环境间距32px；page/console/request/unexpected错误与业务写请求为0。最终health在16:23:14Z通过；16:25:24Z QA登录会话撤销、旧cookie401、服务器私有文件删除及本机临时token清除均已完成。
- Codex真机本轮按用户要求取消，实际0次Codex执行/0手机动作；模板支持保留，其他provider/远程memory/普通员工HOME隔离及APK hash不扩大结论。本机缓存/synthetic目录此前自动审批拒绝的清理不得绕过。安全证据集中在 `.local/creator-platform/` 的 `native-creator-qa-result.json`、`native-execution-detail.json`、`cleanup-execute-result.json`、`data-final-result.json`、`client-final-readonly.json`、`live-team-layout-final/results.json`、`formal-reuse-result.json`、`session-final-result.json` 和 `health-final.log`；详见 [Creator 运维记录](docs/operations/2026-10-09-creator-platform.md)。

## 2026-10-09 历史接手续记：默认自动管理 MCP

- 已推送/部署代码 `1ca9c6b8761a8ee17adb2fd6d4fa92f385718c05`，北京时间 21:18:32（13:18:32Z）；前一版 1ac0395，备份 `/opt/ziwei-backups/management-default/20261009T130953Z`。前端仍为 `index-Caqrwk2Y.js` / `index-C30xBdgl.css`，控制保持 8a4fe59。下面的 f790f09、82c4f8e、628482d 等保持为历史快照，功能均已包含，历史 PID、手工开关与 token 配置不作为当前操作指引。
- 所有工作区新旧员工有效管理配置默认开启。每条已配对电脑连接用自己的设备身份领取单工作区、短期、management-only 凭据，按 origin/workspace/device 私有缓存并自动恢复/续期；跨区、匿名、撤销/过期及错误 audience 继续拒绝，不让浏览器或模型拿到设备凭据。新增 shared 连接仍需原双 Owner 授权，普通成员的网页角色及手机 capability/精确绑定规则不变。
- 表单不再提供管理 MCP 授权 checkbox；准备中或自动准备失败可先保存有效员工配置，原 device/workspace/offline/CLI/auth/provider/显式 profile 检查继续生效。页面显示准备进度、失败原因、重试与更新入口，workspace 切换/刷新有显式 slug 和 generation 防串区。重试仅请求指定连接在下一次心跳刷新管理配置，不创建任务、员工或手机动作。
- Hermes 管理 MCP 支持真实发现的 default 或显式 profile。执行使用所选 profile 的原生临时 managed overlay，认证继续来自原 `HERMES_HOME`，不复制 auth、不改原配置；手机技能独立 profile 限制保留。实际管理 MCP 注入支持 Codex/Hermes，其他运行时缺适配会明确失败，不宣称全部 CLI 完成实际验收。官方客户端来源为 `https://qzelynth.top/downloads/cli/ziwei-latest.tgz`；已配对电脑升级只用 npm 全局安装与原生 start，不重新配对、不切工作区或端口。
- 最终 343/343、lint52/build 通过；同一前端包的真实域名开放平台/既有 Hermes 6/6、五视口创建/编辑只读10/10，以及两工作区只读18/缓存缺失恢复/续期/主动重试证据保留。浏览器全部关闭、只读0写请求/手机动作，员工hash不变；后续模型QA资源写入与清理由发布负责人精确管理。
- **本轮 default Hermes 实际 succeeded/loaded，discover/list/create/get 四工具均ok，子员工精确default/电脑回读正确；独立 ziwei-qa-mgmt-20261008 实际 succeeded/loaded，discover/list/health 三工具ok。** 独立原 SOUL 明确只读/不创建业务，写序列未完成且没有第二个子员工，原config/SOUL均不变。首次failed/无握手保留为修复前历史；旧员工页历史回执与这两次新action分别保留。用户取消本轮Codex，实际0次Codex执行；手机离线、实机暂缓、0手机动作。
- 正式客户端 tgz 22文件/66542bytes、SHA `ae27327bbcfcbcd9f7518cc9b74e357374c04a228189391e91ba4151360d5da4`。原生全局客户端 PID48208、build `f26077c6abcb6479a63948439938097151888751b150780069eb714bf36348b4`、20242、watcher50908，配置不变。实际包/metadata与运行证据见[默认管理 MCP 发布记录](docs/operations/2026-10-09-default-management-mcp.md)。13:22:32Z已按精确计划清理QA4employee/3conversation/3action及6消息/11事件/4管理引用，0tasks；FK通过，原18保护表count/stablehash保持，7原员工全enabled，最终health通过。两区最终只读18/18于13:29:09Z通过：test_222员工3/phone_ai员工2、自身API200/匿名401/跨区403、两区queue0，PID48208持续ready。QA会话精确撤销，服务器私有文件移除/本机token清除，旧cookie于13:29:51Z真实401；安全汇总证据保留，私有凭据未公开。

## 2026-10-09 历史接手续记：员工弹窗勾选框修复

- 生产代码 `f790f099ae80b8cac8d272c9b260527f8c611e0b` 已于北京时间12:13:51发布，目录 `/opt/ziwei/releases/f790f09`，JS/CSS为 `index-Bxj_j2AJ.js` / `index-Du5DwJBi.css`。包含82c4f8e邀请及全部手机/管理/卡片增量；文档与截图helper后续提交不改变该生产代码版本。
- 文本框规则排除checkbox/radio；共享原生18px勾选框保留label和键盘交互，SKILLS不缩小、敏感项同步回归。手机继续选项进入正文滚动区，编辑标题正确且不显示创建专属项。真实未授权管理MCP仍阻止提交，取消后按其他条件恢复可用。
- 296/296、lint49/build、隔离弹窗11/11、原UI36/36、生产五视口创建/编辑10/10及独立footer/body最终5/5通过；生产15个checkbox均18×18/gap8、无错误和业务写请求、员工摘要hash及2→2数量不变。720×450为CSS视口而非真实200%缩放。手机动作仍待在线，不以UI验收代替实机结果。
- 备份 `/opt/ziwei-backups/employee-modal/20261009T035856Z` 双库ok、13配置。服务PID80617/44591/737全不变、0重启；后端/runtime字节一致，Nginx手机路由与hash保留，六份旧hash HEAD200、Android最新code15。回滚只切回82c4f8e，不重启、不恢复旧库。
- QA会话已撤销并用旧cookie验证401，服务器私有文件删除、本机token已移除。仅截图helper补充隐去背景账户区域，避免遮罩盖住前景。最终无遮挡截图、结构化结果、中间脚本和网络失败记录见[弹窗修复记录](docs/operations/2026-10-09-employee-modal-checkbox-fix.md)。

## 2026-10-09 历史接手续记：邀请注册修复

- 主站已于北京时间11:12:26发布 `82c4f8e`，目录 `/opt/ziwei/releases/82c4f8e`；控制 `8a4fe59`。手机技能628482d、管理MCP、卡片与原Nginx手机路由保留，只有主API重启。文档Git头可晚于该代码发布。
- 根因是个人工作区有效邀请被注册kind限制拒绝；共享事务校验现支持个人/团队邀请、即时user_id绑定、同邮箱legacy Owner保持与未知工作区无code拒绝。错误持续可见，已有账号登录接受后即时进入目标工作区；普通受邀者无owner权限。
- 296/296、lint49/build、隔离邀请6/6、真实新上下文邀请6/6和原UI30/30通过。独立QA四账号三工作区已删除、session0、外键检查无新增问题；真实bjc邀请在清理后仍pending且未被验收消费。Mac场景为Chromium UA模拟，非实体Mac。
- 备份 `/opt/ziwei-backups/invite-registration/20261009T030846Z` 双库ok、13配置；API PID80617，控制44591/nginx737未重启。APK code15双包hash、旧JS/CSS、手机/管理匿名401 JSON均通过。回滚628482d仅需切symlink并重启主API，不恢复旧库。
- 独立邀请树发布，未覆盖原D与2884树任何dirty/untracked；T8手机文档与验收增量已合并保留。用户可刷新原邀请链接注册，已注册邮箱登录后接受。详细记录见[邀请注册发布记录](docs/operations/2026-10-09-invitation-registration-fix.md)。

## 2026-10-09 手机 MCP 平台技能接续快照

本节保留手机技能发布时的版本、客户端及验收记录；当前管理默认规则和待验边界以顶部为准。管理默认开启不替代手机授权；下文旧“两 runtime 顺序实机验收”计划已调整为 Codex 本轮取消、手机实机暂缓。

- 最新主站已由邀请注册T7接续发布 `82c4f8e`（北京时间11:12:26），包含手机功能 `628482d`；前端 `index-C8RY6SXs.js`。本工作树已快进包含该邀请增量，本轮只提交文档与验证脚本、不再发布。邀请验收及其QA清理以T7独立记录为准。
- 手机技能代码 `628482d` 已推送并发布 `/opt/ziwei/releases/628482d`，前端 `index-DL3srw7J.js/index-F195zgZe.css`，控制 `8a4fe59`、Android code15不变。仅主API重启；公网真实员工检测发现并补齐 Nginx `^~ /terminal-mcp/v1/ →4178`，后续发布必须保留并运行匿名 transport 门槛。
- 平台目录 `ziwei-phone-control` v1.0.0，三个入口共用向导，原创建表单可返回手机配置；既有版本、卸载、人格与其他技能保留。每次执行的短期 capability 限定 workspace/employee/computer/profile/phone/revision/action，源管理员凭据不下发；原十工具/队列/回执保留。
- 正式搭建师仍在test_222，原persona/runtime/device/技能保留，岗位说明补充用户授权的phone_ai搭建流程；既有bearer精确增加phone_ai、bjc-ops继续403，管理stdio21工具真实验证。phone_ai正式Codex b723a169…由网页创建；Hermes e60938a6…与独立ziwei-phone-ops-20261009由真实搭建师MCP创建配置。完整IDs见[验收记录](docs/operations/2026-10-09-phone-platform-skill-acceptance.md)。
- 同一全局客户端保留test_222/20242，双Owner grant新增phone_ai/device_f9568c06…独立身份。原生重载后PID29976从磁盘恢复两连接、配置字节不变。两真实员工最终check action790f3310…/be35fa83… succeeded，实际MCP loaded/list/status均成功，读到手机offline。
- 276/276、lint/build、隔离phone12/12、team12/12、management6/6、真实配置9/9与加载后最终只读9/9均通过，搭建师同一持久会话复验succeeded。**用户暂时不能操作手机，本轮没有手机命令；截图/有限动作/业务实机验收仍待完成**，不能用只读MCP成功代替该边界。下一步手机在线后两runtime顺序验收，沿原commandId/实际截图，不重放uncertain，不改控制源、不升级/重启手机。
- 双库/12配置完整备份20261009T020417Z，scope与Nginx另有原子变更备份，客户端私有包/配置/入口/日志备份保留。PID53712曾未知退出，已恢复并补独立user日志观察，当前观察PID29976；不宣称退出根因修复。全局旧管理员手机MCP虽canonical已修正，旧密码仍401，禁止重置源口令或分发给员工。
- 邀请注册T7已独立接续发布，后续先核对最新服务器/Git并合并双方增量，不能覆盖手机技能、管理MCP、卡片或邀请修复。本轮临时Owner QA会话已撤销实测401、执行capability文件0；本机三份临时私有文件删除被自动审批拦截，仍在ignored目录待清理。用户三份untracked保留。使用指南见[PHONE_MCP.md](docs/PHONE_MCP.md)，历史快照在下方。

## 2026-10-09 历史接手续记：团队员工卡片重叠修复

- 用户截图揭示此前未覆盖的团队页长指令布局：最高卡片 787px，组织区固定 500px，卡片与设备表重叠。`instructions` 优先展示、后置 CSS 取消截断、绝对定位列表不能撑高父容器共同导致问题。
- 该历史发布主站为 `dc3917341cd801d4e83bda8da24fe794d35f23f2`，北京时间 00:50:22 发布；前端 `index-PEvi9Z0Z.js` / `index-DyDgRE0D.css`。岗位摘要优先 description，缺失时有界取指令首句；详情和编辑保留完整指令。组织列表随排数撑高，390px 员工文字列恢复可读宽度。
- 235/235、lint/build、卡片隔离 12/12、MCP UI 回归 6/6、真实线上四视口 8/8 通过。线上三卡统一 126px，与环境区间距 32px；没有写请求或设备动作。390px 顶部四个管理按钮的既有裁切未在本轮修复，不宣称整页窄屏控件全部完善。
- 最新备份 `/opt/ziwei-backups/terminal-console/20261008T164821Z`，12 配置和双 SQLite integrity=ok；原 runtime 文件逐字节一致，三服务 PID/启动时间不变，daemon 仍 test_222/20242/PID49296/ready。当前前端回滚至 `/opt/ziwei/releases/4db30ce`，不需重启 API。详细证据与临时 QA 会话清理状态见[修复记录](docs/operations/2026-10-09-team-card-layout-fix.md)。

## 2026-10-09 管理 MCP 真实员工链路发布快照

- 当前开发/发布接续目录为 `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解`。原 D checkout 的用户 dirty/untracked 文件和本工作树 `.domain-occurrences.txt`、`.local-ziwei-readonly-evidence.json`、`tmp_gzgov.html` 均保留，不执行 reset/clean。
- 本节发布快照为 `4db30ce`，管理实现 `bef1944`，前端 `index-Bebxc5Te.js` / `index-DejeXhlj.css`；控制端 `8a4fe59` 未变。00:03:50 管理代码上线仅重启主 API；00:14:28 Escape 与 00:28:55 窄屏标题前端补丁均未重启服务，运行时代码逐字节一致。当时备份 `/opt/ziwei-backups/terminal-console/20261008T162818Z` 双 SQLite integrity=ok、12 配置。
- 全局客户端已用验证后的 tgz 替换旧 D checkout link，真实 package 在 `D:\work\nodejs\node_global\node_modules\ziwei`。原用户配置及设备凭据保留，工作区 `test_222`、canonical API、工作目录和 `20242` 不变。daemon 实际刷新 `1700 → 49296`，配置哈希不变、ready/MCP 正常。项目 `bjc-ops` 配置只供隔离代码验收。
- 正式“紫薇员工搭建师”ID `employee_eddccbcf-3faa-4f55-a2f9-a12de9c679fe` 已可在网页对话，Codex / gpt-6.1-sol / zheng，挂载真实“员工搭建与只读验收”技能。模型实际 stdio MCP 发现→独立 Hermes profile→两名 QA 员工→真实任务→回读链路已通过；每名 QA 相同创建请求重试返回同 ID。
- Codex `employee_20f5a646-025c-4e05-aed9-d08ba60edd72`、Hermes `employee_748360a3-a0e4-444b-9125-5fe96f943d39` 都仅一名；Hermes 使用独立 `ziwei-qa-mgmt-20261008`。首次与刷新后共 4 个 task/action succeeded，均 loaded=true、实际管理工具成功，并有两轮各自结果标记。不要把宿主工具或直接管理员创建当成这些真实员工证据。
- 开放平台展示真实 15 工具和安全 stdio 配置，员工 MCP 页签展示实际证据。HTTP `/mcp/v1` 不是远程 MCP URL；专用 bearer 与 API Key/设备凭据隔离。作用域实测 test_222 200、bjc-ops/phone_ai 403，Owner cookie 不能替代 bearer。
- 235/235 串行测试、lint/build、隔离 UI 6/6、真实 HTTPS 桌面/移动宽度验证已完成。完整资源 IDs、临时会话清理、浏览器截图/错误记录、客户端与服务证据、限制和回滚见 [最终验收记录](docs/operations/2026-10-09-management-mcp-acceptance.md)。旧手机 MCP 的 TLS 配置问题仍属单独历史边界；本轮未操作手机或绑定。

## 2026-10-08 真实手机技术验收历史补记

- 本轮在 `phone_ai` 管理入口唯一可见的目标手机来自源中控全局设备目录；员工绑定 0，不代表手机独占归属该工作区。Agent/Updater v0.4.4/code15 双端 online、无障碍 true、亮屏未锁、peerBound/canInstall true、无 pending，当前 Agent 控制。下文手机 0 和未实机验收记录是较早阶段历史。
- 设备动作由主任务独占，经真实域名主站 Owner 代理完成 33 条命令：17 截图、9 点击、5 系统返回、2 启动应用，全部 succeeded；系统设置启动后已通过截图确认，并成功返回原应用。23:24:47 最终记录 updates/pending 0、三服务 active，主站/控制端仍 `81b6ec8/8a4fe59`。
- 两次大响应读取 20 秒超时，命令已 succeeded，未重放；17 readback 为只读补取。04 点击虽回执成功但首次页面未切换，观察后 06 新点击才进入目标页，不将命令成功等同导航成功。
- 北京时间 23:25:04–23:25:26 动作后网页只读后验通过：真实 JPEG 720×1612 正常渲染，详情 33 条 succeeded、DOM 最近 20 条均成功且有完整回执入口；双端 online、待审/绑定 0，页面/控制台/请求失败/响应体读取失败/告警/阻止写请求均 0，后验设备动作 0。短期主站 Owner QA 会话已撤销，服务器与本机私有会话文件已删除；未创建员工或手机设备令牌。
- 员工 0、员工绑定 0；宿主 Codex 可用不代表员工手机执行链路已通过。终端 MCP 实际 list/status 失败，旧 IP 配置触发 ERR_TLS_CERT_ALTNAME_INVALID；正式域名健康 200，本轮未修配置，也未改 test_222 daemon。员工/MCP 链路、真实双端升级、业务消息仍未验收。
- 提交文档仅保留技术状态，见 [脱敏验收记录](docs/operations/2026-10-08-real-phone-acceptance.md)。完整账号、作品与指标只保存在 ignored `.local/real-phone-acceptance/report.md`；本地结构化总结果 `result.json`、`final-state.json` 和截图保留，不推送私人数据。

## 2026-10-08 接手续记：公开 Android 安装页已上线

- **当前生产版本**：T4 提交 `81b6ec8d0eb5693f3faf5eab88cd7ff2aeabdb00` 已快进进入并推送 `codex/ziwei-terminal-console`；北京时间 22:23 切 `/opt/ziwei/current -> /opt/ziwei/releases/81b6ec8`，前端 `index-BUxdmKav.js` / `index-C8foC8Iv.css`。source 保持 `8a4fe59`；下文完整终端的 `a625350` 发布是较早阶段历史，当前状态以本节与维护手册顶部为准。
- 公开 `https://qzelynth.top/android-install`（尾斜杠也 200），无需登录。主站完整终端标题栏的“安装手机端”实际跳转 `/android-install?workspace=phone_ai`，返回同工作区终端通过真实 Owner 浏览器验收。只精确安装路径公开，原主站及手机管理认证保留。
- 双按钮从真实 index/manifest 选最新发布并显示大小；目前 code15/v0.4.4 的 Agent/Updater 为 815470/815474 B，生产 HEAD、GET、SHA-256 均匹配。QR 实际渲染解码为 canonical 安装页；复制根地址正确。首次同机安装双应用、确认权限、两端填写同一根地址/手机名并分别申请，管理员回原终端审批及绑定；不默认要求手工 token/JSON。
- 发布备份 `/opt/ziwei-backups/terminal-console/20261008T142230Z`：mainBefore=`a625350`、sourceBefore=`8a4fe59`、12 配置、两 SQLite integrity 通过。backend 和 69 个运行时 lock 条目均无变化，新增 jsqr/qrcode-generator 仅 dev 构建/QA，生产复用原 modules。此次未重启任何服务、未改 Nginx/DNS/daemon/数据/原 APK。
- 最终验证：T4 完整串行 207/207、安装 UI 9/9、终端回归 6/6；root fresh lint 39 files、build 通过。真实匿名安装页 1440/390 两组 passed，二维码/复制/版本大小/下载/认证返回正确，0 errors/overflow/设备动作。主站 Owner 终端 6 checks/5 probes 通过，手机与待审 0。生产证据 `.local/install-live/results.json`、`main-entry.json`、`terminal/results.json`、`stale-assets/results.json`、`deployment.json`。
- 北京时间 22:26:46 生产记录：主站/控制 health=true，三服务 active/NRestarts 0，启动时间未因安装页发布改变（主站 20:35、控制 20:47；Nginx UTC 2026-10-07 16:13:39，即北京时间 10-08 00:13:39）。临时 QA 会话已撤销、remaining 0，服务器/本机 token 文件已删除。
- 用户白屏恢复后进行了只读排查，未复现用户事故，根因尚未证实。独立实验确认旧 f88d6f8 HTML 引用缺失 hash 时会被 SPA fallback 返回 HTML 而触发模块 MIME 白屏；新 dist 已携带 a625 assets 和 f88 旧 JS/CSS，同一旧 HTML 真实生产请求现返回正确 MIME/大小，登录可见、0 errors。不能把这项合成复现当作用户事故根因。后续发布继续保留缓存 HTML 所需旧 hash，详见 [排查记录](docs/operations/2026-10-08-white-screen-investigation.md)。
- 本机 daemon 最新只读 `/readyz` 为 ready=true，PID `33260`、`20242`、工作区 `test_222`，与发布前一致；原 D 目录和源中控所有 dirty/untracked 文件保留。
- 回滚仅切前端 symlink 回 `a625350`，backend 未变，无需重启 API；保留 source、原 data/APK 与旧 hash。实机 APK 安装、权限、入网、真实操控升级未验收。详见 [安装页最终记录](docs/plans/2026-10-08-android-install.md)。

## 2026-10-08 接手续记：主站完整终端控制台（较早阶段历史）

- 主站功能提交 `a625350b23926597810fe5181741937933303170` 已推送 `origin/codex/ziwei-terminal-console` 并上线；`/opt/ziwei/current -> /opt/ziwei/releases/a625350`，上一个发布为 `f88d6f8`。前端 `index-noIbPxU1.js`。原控制服务提交 `8a4fe59f0b2486fb584962fd3006e9a47418037a` 已推送 `origin/codex/phone-archive-compat` 并于 `2026-10-08T12:47:46Z` 部署至 `/opt/ziwei-control/releases/8a4fe59`；第二次部署前备份为 `/opt/ziwei-backups/terminal-console/20261008T124627Z`（12 配置、两份 SQLite，integrity 均通过；mainBefore=`a625350`、sourceBefore=`af63071`）。
- 用户登录主站后，进入左侧“系统 → 紫薇·互联”；手机工作区为 `https://qzelynth.top/phone_ai/ziwei-connect`。Owner/Admin 可以在“待审核入网”直接批准/拒绝手机，无需再登录原中控。手机连接页填本站 HTTPS 根地址后提交申请，获批后沿原配对协议自动取 Agent/Updater 配置。
- `frontend/src/components/terminal/TerminalConsole.vue` 实质复用原完整手机管理页：列表/详情、双端健康、手动登记配置、截图操控、控制端、回执核实、升级和归档；App 内的当前手机插槽绑定已有员工与账号，原员工运行记录及诊断保留。API 通过主站工作区身份代理，管理员凭据不发给浏览器，手机状态与命令仍由原控制服务保存。
- 重点维护：不要把列表 summary 当完整回执；它会省略成功命令与结果。当前刷新串行读取完整详情，升级预检直接按捕获的手机 ID 读取成功截图与新画面，离页后不再提交升级。acknowledged 表示人工核实，不能标成 succeeded 或重放；delivered/executing 需继续轮询。
- 发布前双 SQLite 与配置备份：`/opt/ziwei-backups/terminal-console/20261008T122923Z`，integrity 检查通过。真实数据及原 `data/.local/node_modules` symlink、服务端凭据、既有 APK/`dist/downloads` 均保留；不改 DNS/子域名，不启停本机 daemon、不切换配置、不新增本机业务实例。
- 源 `af63071` 复核缺少归档 API 和 `archived_at`。源增量只补归档与兼容列，保留历史、撤销双角色凭据和配对授权、从列表隐藏。源 `8a4fe59` 已 active/health 200，兼容列真实存在，手机数 0；只重启原控制服务，主站/Nginx 未为此重启，源 `node_modules/.local/data/dist/downloads` 链接原目录以保留 APK/CLI。旧 `af63071` 可兼容额外列，代码回滚不会自动恢复撤销的凭据。
- 验证：主站完整串行测试 189/189、lint/build 通过；隔离真实 HTTP/SQLite 6 组、合成浏览器 6/6 通过。默认并发运行在构建 CPU 负载下曾触发既有 daemon 60 ms/100 ms 计时测试失败，隔离 daemon 7/7 与全套串行复核通过，未改 daemon。
- 真实域名只读浏览器：`.local/terminal-live-evidence/results.json`，1440/390 px、主站 Owner cookie、匿名 401/登录 200/直接源管理 401，无源登录，0 page/console/request 错误、0 设备动作；真实手机和待审均为 0。实机 APK 安装、自动领取配置、双端心跳、屏幕控制和升级仍未验证。
- 源更新后的最终生产复核已完成（`2026-10-08T12:49:03Z`）：真实域名 6 检查/5 探针全部通过，Owner 200/匿名 401/源直接 API 401，1440/390 px 无溢出，0 page/console/request 错误、设备动作 0。`.local/terminal-live-evidence/deployment.json` 记录两端 health=true、三服务 active、归档兼容列存在、手机 0；v0.4.4/code 15 manifest 与 Agent/Updater APK GET 均 200，APK 分别 815470/815474 bytes，SHA-256 匹配清单。临时 QA 会话已撤销，服务器/本机临时 token 文件已删除，没有额外登录残留。
- 当前本机 daemon 只读事实：`20242`、PID `33260`、工作区 `test_222`。下文旧 PID/部署条目仅是历史记录。原有 dirty 文件和 `tmp_gzgov.html` 保留，禁止 reset/clean 覆盖。
- 回滚：主站切回 `f88d6f8` 发布 symlink，源端需要时切回 `af63071`，仅重启对应既有服务；恢复数据库前核对对应备份和发布后的有效数据。详细版本、协议、证据和边界见 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md) 与 [本轮实施记录](docs/plans/2026-10-08-ziwei-terminal-integration.md)。

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

`data/ziwei_user.json` 只代表本地项目验收配置，workspace 是 `bjc-ops`。真实服务器 daemon 使用 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json`，workspace 是 `test_222`，API 是 `https://qzelynth.top`，健康端口仍为 `20242`。不要把 token、Cookie 或认证头写入日志。

环境边界必须保持清晰：本地 checkout、前端/API、单元/API 测试和浏览器回归属于 `bjc-ops`；服务器 daemon/A2A 证据只来自全局 `D:\work\nodejs\node_global\ziwei_user` 及用户目录配置。`npm run daemon` 和 `npm run ziwei:start` 只能在明确的本地 `bjc-ops` 验收中使用，不能用于服务器验收或代替 `test_222` 结果。服务器验收前分别核对项目配置、用户配置、端口和 `/readyz`，不得切换配置或把凭据写入日志。

## 启动和检查

本地 `bjc-ops` 代码验收时，在项目根目录运行：

```powershell
npm run dev
npm run ziwei:start
npm run ziwei:status
```

上述项目 daemon 命令不属于服务器验收流程；服务器 daemon/A2A 证据只用全局 `ziwei_user status --json`、用户目录配置和 `test_222` 工作区核对。

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

