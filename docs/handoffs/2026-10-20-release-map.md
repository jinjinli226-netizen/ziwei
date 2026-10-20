# 2026-10-20 紫薇分层来源与发布地图

本文用于其他电脑的 AI 接续整个紫薇项目，依据截至 2026-10-20 已提交的运维、QA 和 Git 记录整理。本轮只整理文档，没有登录生产、查询现场设备、读取凭据或重新验收服务。因此，下列是**各层最后有记录的状态**，不是对阅读时实时生产状态的承诺；历史 PID、目录和升级回执也不是当前健康证明。

## 1. 开发接续入口

主仓库为 [`jinjinli226-netizen/ziwei`](https://github.com/jinjinli226-netizen/ziwei)。本次交接以 `codex/remote-client-upgrade` 的 `faea63d1d3814d89977407879a8e85e38c402230` 为已提交起点；该提交记录公司台式 10/20 的真实升级与验收。先读仓库根 [HANDOFF.md](../../HANDOFF.md) 的最新日期段落，再按本表进入对应层的记录。[PROJECT_MANAGEMENT.md](../../PROJECT_MANAGEMENT.md) 可补充架构和管理约定，其中历史快照不能覆盖较新的运维记录。

| 入口 | 定位与使用边界 |
| --- | --- |
| 主源码接续 | [`codex/remote-client-upgrade@faea63d`](https://github.com/jinjinli226-netizen/ziwei/commit/faea63d1d3814d89977407879a8e85e38c402230)。这是源码与文档基线，不表示 API、网页、所有客户端和手机都运行该提交的整树。 |
| 本机近期工作树 | `/Users/zhangjie/.codex/worktrees/bot-historical-recovery/紫薇` 的实际分支是 `codex/remote-client-upgrade`；目录名称不是分支或版本依据。另一台电脑应依仓库、分支和完整 SHA 重新定位，不复制 worktree 的 `.git` 指针。 |
| 本次交接编辑树 | `/Users/zhangjie/.codex/worktrees/cross-computer-handoff/紫薇` 从上述 `faea63d` 隔离创建。交接文档的后续提交不应被误记为本轮产品发布。 |
| 旧根工作区，不能作为最新接续入口 | `/Users/zhangjie/Documents/ChatGPT/紫薇` 停在 `codex/hermes-independent-profile@f88d6f8678face7ea3d414674e4e76707d7fc376`，有未提交的 `frontend/src/App.vue`、`frontend/src/api.js`、`frontend/src/styles.css` 及本地输出等。保留这些内容，不以 reset、clean 或整树复制处理。 |
| 旧 `main`，不能作为最新接续入口 | 本机缓存 `origin/main` 为 `339b1db1862882c5305ebddceead85d487c8c9d0`（10/03）。本轮没有 fetch；不要因默认分支叫 `main` 就把它当作 10/20 基线。 |

## 2. 生产、官方包与已装设备分别定位

同一时刻存在多个有意保留的版本层。主源码 HEAD、API 发布标识、网页资产、官方下载包、某台电脑实际安装版本，须分别核对。

| 层 | 最后有记录的来源 / 产物 | 证据与限制 |
| --- | --- | --- |
| 主站 API | 发布标识 `d185cb9e6a8f5ec49b06c953706d6d136b9b502b` | [10/19 QA](../qa/2026-10-19-codex-conversation-memory.json) 的 `publication.apiCommit`、`maintenanceOwnedTreeCleanup.serverPreservation`；[10/20 QA](../qa/2026-10-20-company-creator-codex-mcp.json) 的 `publication.apiCommit` 再次记录保留该层。不是本轮重新探测。 |
| 主站前端 | J，`241f0cc59bbd2cb7800ac3072470b1a85a77dfd1` | [10/18 工作目录发布](../operations/2026-10-18-employee-execution-workdir.md) 记录 J 主站发布；[10/20 QA](../qa/2026-10-20-company-creator-codex-mcp.json) 的 `publication.mainSiteCommit` 记录仍为 J。后续客户端修复没有同时换前端。 |
| 互联 / Control 服务 | 独立私仓 `jinjinli226-netizen/ziwei-system`，`9d25509cf4a2f947465582d9442a2d1845a8af1b` | [10/19 官方上下文恢复](../operations/2026-10-19-hermes-official-context-recovery.md) 及 [10/19 QA](../qa/2026-10-19-codex-conversation-memory.json) 的 `maintenanceOwnedTreeCleanup.serverPreservation.controlCommit`。主仓库克隆不包含此私仓；需另有仓库访问权。 |
| 官方 Windows 下载包 | 修补源码 `df311dfd07858f298c2f0ab1f727e71670275e73`；build `7c249fffd02e0a529e333bbbc56864a8b694809861cb6cfce0ee3c6c265a1e26`；归档 SHA-256 `beb75315e5e52c9f6e8e821e17c8a683b137e3010e29033c42205d60642fb10c` | [10/20 发布记录](../operations/2026-10-20-company-creator-codex-mcp.md) 与 [QA](../qa/2026-10-20-company-creator-codex-mcp.json)。记录于 02:41:50 UTC（北京时间 10:41:50）发布并独立 HTTPS 下载核对。942 个归档成员仅改 3 个源文件及 descriptor，其余 938 个保持；不代表从该 Git 整树重建了所有字节。 |
| 公司台式实际已装 | 上述 build `7c249fff…` | [10/20 QA](../qa/2026-10-20-company-creator-codex-mcp.json) 的 `unifiedRemoteUpdate`：`client-update_f133c641-ebef-471c-857d-0bd56ade70e3` 于 02:43:59.015 UTC 收到目标 build 认证心跳，`succeeded` / `heartbeatVerified:true`；原 Creator 聊天两轮真实 provider 的 exec / resume 验收见同日运维记录。 |
| 李金晋电脑实际已装 | 修补源码 `223b7efcabf7f50e6182713b53da8c53871b51e3`；build `15687444502be073f3dc432d8c6817ec27b2f6635019da28f97dde1b3635d0f7`；归档 SHA-256 `e3e323ac0ed9be5e9c1f1b905fbb9e42cb04afd86a641d609550620606a1e46f` | [10/19 QA](../qa/2026-10-19-codex-conversation-memory.json) 与 [HANDOFF.md 的 10/19 最新安装段](../../HANDOFF.md)：`client-update_d9cc7216-5f24-4f8f-a045-76cbd683d87e` 于 12:12:17.585 UTC（北京时间 20:12:17）目标认证心跳成功。10/20 操作只升级公司台式，不能据官方下载已更新推断李机或其他电脑也已升级。 |

10/20 QA 中 `unifiedRemoteUpdate.currentBuild=156874…` 是该次升级的**来源版本**，`targetBuild=7c249…` 和成功的目标认证心跳才是公司台式的安装结果。不要把该字段回读成公司台式仍停在旧版。

## 3. Android 与 mobile 的并行来源

以下分支是独立接续入口，其 tip 不在主基线 `faea63d` 的祖先链中。需要处理对应模块时，先比较精确提交与目标文件，不能假定主树已经合入，也不能直接整分支合并生产。

| 分支 / 产品 | 固定来源与记录 | 最后有记录的状态 |
| --- | --- | --- |
| Android 管理 App | `codex/android-selfhost-notifications@c9e20e42b44305e39262d21c1acc38dcce7155f6`；[该提交的运维记录](https://github.com/jinjinli226-netizen/ziwei/blob/c9e20e42b44305e39262d21c1acc38dcce7155f6/docs/operations/2026-10-19-android-historical-observation-occupancy.md) 与 [mobile-manager/README.md](https://github.com/jinjinli226-netizen/ziwei/blob/c9e20e42b44305e39262d21c1acc38dcce7155f6/mobile-manager/README.md) | `com.ziwei.manager`，`0.5.3-internal / versionCode 15`。准确 APK 产品源码为 `94379947947b2304895ee144c55acf073174e97a`，不是文档 tip c9e20e4。修复历史只读观察误占位，不改原失败结果或放开未知写保护。 |
| mobile 自托管通知后端 | `codex/mobile-selfhost-notifications@0c8dc4a955ef7b65bc496ce7f43246b88201a088`；[固定提交](https://github.com/jinjinli226-netizen/ziwei/commit/0c8dc4a955ef7b65bc496ce7f43246b88201a088)、[backend/mobile-notifications-v2.mjs](https://github.com/jinjinli226-netizen/ziwei/blob/0c8dc4a955ef7b65bc496ce7f43246b88201a088/backend/mobile-notifications-v2.mjs) | 独立通知后端来源。Android README 记录采用自托管直接连接与用户自行开启的接收器；此前第三方推送候选已被用户停止，旧候选文档不能当作当前配置指南。此处不据分支存在断言整条分支当前全部上线。 |
| 被控手机 Agent / Updater | 独立私仓 `ziwei-system`；[10/16 手机生命周期记录](../operations/2026-10-16-phone-input-lifecycle.md) | 现有官方双角色为 `0.4.4 / code15`，包名为 `com.ziwei.device.agent` / `com.ziwei.device.updater`。计划 `0.4.5 / code16` 在 `8be4604f2938271bf54798db9e74ac3dfa0c3b37` 已做编译与自动回归，但该记录仍等待原签名，未发布、未安装、未做物理手机验收；不能把它和管理 App 的 code15 混为同一 APK。 |

管理 App code15 的公开产物是 [0.5.3-internal Release](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.5.3-internal)，APK SHA-256 为 `6938df37c25f529c522ed92e06e32b0264ec9b76fa4780a9f284563b3d0d1d6f`。公开下载与同一模拟器 code14→15 覆盖安装已验证；[主树 10/19 QA](../qa/2026-10-19-codex-conversation-memory.json) 的 `androidStaleBanner.physicalPhoneVerified` 明确为 `false`。**物理手机安装与现场验收仍是边界**，不能以模拟器成功、发布 APK 或 Windows 升级替代。Agent / Updater 的 code16 另需原签名、双角色实际升级及输入、断网、熄屏、重启和长期存活验收；接手者不得用新临时签名冒充覆盖更新。

## 4. 跨仓库依赖

| 仓库 | 作用与可定位来源 | 接手边界 |
| --- | --- | --- |
| `jinjinli226-netizen/ziwei` | 主 API、网页、Windows 客户端；并行分支还包含 Android 管理 App 与 mobile 通知改动。主接续点见第 1 节。 | 一个 Git HEAD 不等于所有生产层的统一部署清单。 |
| `jinjinli226-netizen/ziwei-system`（私有） | Control 与被控手机 Agent / Updater；Control 已记录发布源 `9d25509…`，Agent / Updater 待签名候选来源另列于第 3 节。 | 主仓库文档只有来源与发布证据，不包含此仓库全部源码、签名或访问权限。 |
| `jinjinli226-netizen/ai-viral-library`（私有、可选外部 MCP） | [10/18 Bot MCP 接入记录](../operations/2026-10-18-bot-deferred-mcp-config.md)：服务修复源码 `082390c4767db1f0caa4261e60e5fe33831a7476`，`main` / `codex/long-lived-mcp-grants`；后续仅文档的两 ref 记录为 `1603dde3eb72e9249d1adfe987583561d56cfc3e`。 | 记录于 18:24:48 成功发布同一源码候选，随后精确授权和真实模型读取通过；未等待 15 分钟后真实刷新。该库基于实际源导入，不声称找回原 Git 历史。它是可选 MCP 服务，不替代紫薇的员工库和权限系统；已有授权不能推广为所有员工已连接或已加载。 |

## 5. 混合字节、数据与待核验边界

[10/19 维护续做发布](../operations/2026-10-19-maintenance-checkpoint-resume.md) 明确记录 API 在实际 J 混合树上叠加指定 4 文件；[同日上下文恢复发布](../operations/2026-10-19-hermes-official-context-recovery.md) 继续分别核对 API 与 Control 的限定源文件；10/20 官方包也仅叠加 3 个源文件及 descriptor。由此，部署或回退时必须先确认实际 current、文件清单 / 哈希与对应备份，再依该层发布记录操作。**不能从 faea63d、d185、df311 或任何单个 Git 提交整树覆盖生产**，也不能把本次文档整理当作新的部署授权。

- Git 可传递已提交源码、文档及公开 QA 摘要；忽略的 `.local/` 运维原始证据、生产数据库、员工 Profile / HOME、登录状态、设备凭据和签名材料不随克隆转移。若某项操作依赖这些私有材料，需由用户指定安全的访问或移交方式，不把秘密补进交接文档。
- 代码回退不覆盖当前业务数据库；手机覆盖更新须保持原包名、原签名和有效版本递增。已有数据、员工、设备和会话不因接手而重建，不重放旧业务来证明环境恢复。
- 继续开发前以仓库 / 分支 / 完整 SHA 定位源码；涉及发布时另行核对该层实际来源、当前产物、空闲条件与保护对象。官方下载存在、升级请求被接受、合成测试通过，均不能替代指定设备的目标 build 认证心跳及所需现场验收。
- 本文不宣称所有层已同步到同一版本，也不宣称所有电脑、手机或可选 MCP 都完成现场验收。应保留各份运维 / QA 中的失败回执、历史状态和未验证项，不用较新一项成功抹除其它未知结果。
