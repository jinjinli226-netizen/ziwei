# V2 用户可见会话台账

## 当前状态入口（2026-10-15）

下方台账保留早期会话与方案阶段记录，**不是完整的最新发布清单**。V2 已经上线；最近主站/API 提交 `ead2ac9281c47624929f433bc190b44e2659498c`，最新验收、Windows 设备问题和接手步骤统一见 [HANDOFF.md](../../HANDOFF.md#2026-10-15-最新接手状态)。

Windows 真模型双图验收仍待完成；李金晋电脑 stop 409 已定位并发布 `6ddb51d` 客户端修复，须用官方 PowerShell 入口更新，实机结果待回读；公司台式 Hermes 版本探测超时仍待复查。后续仅交接文档提交不会触发产品部署。下方会话分工按历史语境阅读，不因旧的“未实现／未发布”判断当前状态。

## 以下为历史会话台账

2026-10-12 E02更新：已形成实际后端本地预览候选，原E01方案状态作为历史保留。E02 `01a13088-968c-7ee3-9ac5-06d4e663abf1`（local，V2-E02-全天岗位配置与运行实现），隔离树 `C:\Users\25941\.codex\worktrees\v2-e02-hermes-bot\灵光爸爸拆解`、分支 `codex/v2-e02-hermes-bot`、基线 `6eaf7de`；API/运行/Creator/MCP与同员工身份实现，725项全量回归、lint82、构建1764模块、真实CLI+loopback假模型两轮隔离证据见[交付](2026-10-12-e02-hermes-bot-preview.md)。用户要求仅本地预览，未上线/未24小时实测。

E03 `01a13089-a04c-75c3-a56a-94cd82bb0305`（local，V2-E03-紫薇Bot配置与使用界面）负责前端与最终集成树唯一隔离预览；具体提交/界面验收/端口与日志以E03真实回执为准。本E02内部协作者仅做源码/官方资料只读核实和独立审查，没有承接实现、测试、发布或业务操作。

更新日期：2026-10-12（Asia/Shanghai）。**V2 当前处于方案中；24 小时岗位产品未实现、未实测、未发布。** 本文件记录实际会话与文档范围，不以候选路线、计划或原生源码能力冒充交付。

本次追加：Creator公共模板跨工作区复用、实例各守当前workspace；全天能力仅面向Hermes。E01继续在原隔离树修订Creator接入合同、实施与联调验收文档，未建立生产Creator与E01研发会话的依赖，未做真实联调。

最后复用核验：紫薇已有定时自动化，Hermes原生Cron源码也存在，后者当前运行状态unknown。设计第3节明确直接复用现parser、单一tick、automation表/运行记录、通知、HMAC投递和A2A补传；Routine以一对一automation扩展补岗位身份/主聊天/记忆/revision/去重/控制，不重做通用Cron或并行调度权。原生Gateway桥接仅列未来hook/authority转移条件。本轮另补draft/resume与过期activate竞态，以及只读验证实际toolset/MCP允许清单，不能仅靠提示词声明只读。

规则来源：[V2 大脑交接](V2_BRAIN_HANDOFF.md)。总控只负责规划、只读核对、派工与审查，实际落地由用户可见 E/Q/R 执行会话完成。最多两个活跃执行者，依赖串行，发布由一个 R 执行者处理。

## 实际会话

| 标题（按应用返回原文） | threadId | hostId | 范围与状态 | 依赖 / 证据 |
| --- | --- | --- | --- | --- |
| V2-B00-总控大脑 | `01a12fe0-a8f2-7c50-bf23-38ff2230015f` | `local` | V2 协调、需求确认、只读审查与后续派工；不实现 | 交接文件及本轮 list_threads；向 E01 明确用户已选现有 Windows 持续开机路线 |
| V2-E01-24小时岗位员工方案 | `01a12ff4-63d3-7fd2-a874-0ebcb116c8ce` | `local` | 全天岗位方案及追加Creator接入合同/实施/联调验收/台账文档；文档供审查，产品未实现 | 首轮list_threads核实自身身份；原附属树继续使用；依赖首个业务岗位职责及后续真实Q验证 |

本轮未创建其他用户可见会话。Q 独立验收与 R 发布尚未分派，标题、编号、threadId、hostId 均不虚构。内部协作者仅提供公开资料/源码的只读研究与文档审查意见，未承接实际文档写入、代码、测试、发布或业务。

## E01 基线、工作树与提交定位

| 项目 | 已核实值 |
| --- | --- |
| 本机项目 | 灵光爸爸拆解；projectId `88ef81dd-3d16-4ff6-86b6-8482a2f4cc09`（应用会话返回） |
| 原会话 cwd | `D:\灵光爸爸拆解`；只作为项目来源，不在此落地修改 |
| 可靠接续源 | `C:\Users\25941\.codex\worktrees\a2a-delivery-recovery\灵光爸爸拆解` |
| 文档接续基线 | `2ebe3dfee2f438a0b6aa3045d46c83bb67d7341b`；源分支 `codex/employee-default-workdir`，本轮核对干净 |
| 实时远端核对 | E01首轮文档交付前 `git ls-remote origin refs/heads/codex/employee-default-workdir` 返回 `2ebe3dfee2f438a0b6aa3045d46c83bb67d7341b`，不是使用本地tracking ref推断；追加文档从下行本地提交继续，不宣称远端已同步新文档 |
| E01首轮文档提交 | `2bd2c511881efee8242874dcf19304b4124be35b`，仅5份Markdown；本次Creator修订开始时HEAD为此SHA、工作树干净 |
| V1 封版 / 产品修复 | `c2e360a3af12eda2152023876cee16cfaf29a949` / `324731e79c6a855fad1f501379630bbfa67e5d34` |
| E01 隔离工作树 | `C:\Users\25941\.codex\worktrees\v2-e01-24h-role-design\灵光爸爸拆解` |
| E01 分支 | `codex/v2-e01-24h-role-design` |
| 创建与附属证据 | create_worktree 操作 `11d3ce9b-e326-4cbd-a4dc-ac92d9f91368` completed；list_artifacts 返回本任务同路径 worktree |
| 提交定位 | 本文件与下列文档的本地提交；在该树执行 `git log -1 --format=%H -- docs/handoffs/V2_SESSION_LEDGER.md` 获取精确 SHA，最终交付回执亦记录完整 SHA；避免在同一提交正文中伪造自引用 SHA |
| 发布层 | 无：未推送/合并/发布，未安装或更换客户端，未触碰线上数据库/服务 |

创建前本会话附件为空；既有 D/2884 树为保护对象，其他树并非本会话可复用的空闲附属执行树。因此从已核实可靠基线用应用原生工具新建专用树，再建立上述 codex/ 分支。未将 create_thread(local) 当作隔离环境，未改可靠接续树或原用户修改。

## E01 文档变更范围

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| [设计](../superpowers/specs/2026-10-12-24h-role-employee-design.md) | 3条路线、岗位底座；第11节Creator→Hermes全天模板、旧实例overlay、7项提议MCP工具、draft/verify/activate及多实例合同 | 方案中，供审查 |
| [实施计划](../plans/2026-10-12-24h-role-employee.md) | 3个工作包、12项任务（含C1–C3）、候选文件/接口与测试步骤、Q/R后续门槛 | 所有产品任务 NOT_STARTED |
| [验收设计](../plans/2026-10-12-24h-role-employee-acceptance.md) | A01–A23及Creator联调C01–C16；隔离真实24小时窗口、48个fixture/12个模型探针计划、故障与计数 | 产品/联调验收NOT_RUN，actual全部null |
| 本台账 | 已创建会话、范围、基线、树/分支、证据、依赖、发布层 | 仅记实际事实 |
| [项目管理顶部](../../PROJECT_MANAGEMENT.md) | 新增当前V2状态与文档入口，保留其余历史 | 方案中/未实现未发布 |

E01 仅做本地文档审查：检查相对链接、引用路径、方案/计划/验收一致性、Git diff空白和文档白名单；使用 verification-before-completion 的证据原则，不运行产品测试。不存在新构建、模型调用、正式员工/手机/外部账号动作、端口登记/服务启动、电源或开机配置变更。V1 历史709项测试和真实nonce未在本轮重跑，也不计入V2结果。

## 用户已决定与后续依赖

- 已决定：可配置长期职责的24小时岗位仅针对Hermes Agent；先在现有Windows电脑持续开机时工作。
- 已决定：Creator为公共员工工厂模板，各workspace+owner安装独立实例并创建当前区员工；“全局”是模板复用，不是跨区管理。Creator现有Codex/Hermes支持保持，与目标Hermes分别选择。E01不是生产员工。
- 本次允许：可审查方案/分期计划/验收/会话台账，隔离树文档本地提交；不推送合并发布。
- 推荐待审：紫薇唯一调度权 + Hermes有界执行 + 每岗独立状态；默认预算和missed-run参数是提案，并未配置到产品。
- 必需业务输入：第一个岗位负责什么、交付什么、允许访问哪些资源、何时找用户。未提供前不创建正式通用助理、闲鱼员工或恢复旧员工。
- 后续执行门槛：总控根据已确认方案安排新的用户可见E实现、Q独立验收、R发布；本E01没有授予后续自动执行或部署权限。

## Creator追加文档的证据与待核实项

已只读核对`backend/employees/creator-template.mjs`、`templates.mjs`、`backend/management.mjs`、`backend/db.mjs`/repository、`scripts/ziwei-mcp.mjs`、`frontend/src/components/CreatorMarket.vue`及creator-market/api：现catalog只有Creator 1.0.0，MCP只有现有普通员工等工具；全天模板七项工具、draft验证/激活和能力overlay均不存在。现模板表的owner/workspace/template唯一约束保留，全天来源采用本方案已有role行的template/version/hash/provenance字段，以workspace+employee独立应用，不复用Creator单例表。

旧Creator接入采用待实现的可信capability/discovery与版本化执行指导overlay，覆盖template/adopted-existing/customized；sourceTemplateVersion与capabilityVersion分开，不改原persona/instructions/SOUL/记忆、不把null来源版本假报升级。新增指导不是已部署事实。

bigtron当前正式Creator元数据核查（2026-10-12）：

| 字段 | 当前证据状态 |
| --- | --- |
| employeeId、template来源/实例应用版本 | unknown；没有新只读服务端/登录页回执 |
| runtime、profile、model、targetDeviceId | unknown；不套用历史事故快照 |
| 主聊天ID、管理MCP当前prepare/loaded/toolCalls | unknown；未创建会话、未调用模型 |
| 合法只读尝试 | 当前工具没有员工管理读取连接器；浏览器inventory中Edge `nodeRepl.fetch request failed`，本会话IAB无已有tab |
| 本轮边界 | 未读/展示密钥，未建登录/凭据，未查询手机，未修改正式Creator或员工；unknown不代表实例不存在 |

本次原工作树及附件已重新核对，继续在`codex/v2-e01-24h-role-design`仅改上述5份Markdown；无新会话、无产品代码/配置/数据库、测试/构建/模型/业务或发布动作。首轮提交保留，追加提交SHA由本文件最新Git提交及交付回执定位。

## 保护和未完成边界

正式用户/workspace/员工/Creator HOME/记忆/会话/手机MCP/绑定/凭据及后续删除状态保持；不恢复整库/快照、不重放原Creator创建消息、不重建已删除员工。T8用户停止、T9平台阻断只保留，不唤醒、不改述或转交受阻路线。automation-2仍暂停，本轮未创建Codex自动跟进。ThinkPad只确认历史54a053升级complete，在线/7e2状态未核实。

24小时候选演示窗口是未预约计划，不是正在运行的验收。实际开始/结束、调用次数、费用、遗漏/重复均未知，不填0。正式服务和本机电源设置不保证电脑休眠/断电时仍可执行；客户端离线和任务状态按证据分别呈现。
