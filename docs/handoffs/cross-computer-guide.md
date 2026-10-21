# 紫薇：跨电脑迁移详细说明

更新日期：2026-10-20（北京时间）。本文件仅在跨电脑迁移、私有材料交接时按需阅读；项目总入口为 [AI_HANDOFF.md](../../AI_HANDOFF.md)，历史时间线保留在 [HANDOFF.md](../../HANDOFF.md)。版本均注明证据来源，接手后仍须核对现场。本轮只更新交接，不部署产品或升级设备。

2026-10-21 补充：换服务器前已重新核对今早性能、10条分页和知识库源码均在 GitHub main。正式环境仍需迁移数据、附件、密钥、Control及运行产物；详细范围见[换服源码核对](2026-10-21-server-migration-source-audit.md)，不要将本篇开发电脑迁移命令当作完整服务器安装流程。

## 1. 取得正确源码

仓库：<https://github.com/jinjinli226-netizen/ziwei>。当前推荐源码入口为 `main`，已合入最新主项目代码、AI 导航及原 main 改动。取得源码后以实际远端 SHA 为准。此前迁移盘点的接续基线为 `faea63d1d3814d89977407879a8e85e38c402230`，保留用于追溯，不能当作当前分支头。

在新建的空目录逐行执行，PowerShell、macOS/Linux shell 均可使用：

```sh
git clone --branch main https://github.com/jinjinli226-netizen/ziwei.git ziwei
cd ziwei
git status --short --branch
git log -5 --oneline
git ls-remote --heads origin main codex/remote-client-upgrade codex/v2-20261014-release
```

已有 checkout 先查看 status、分支、worktree 和远端，保留原修改，在独立工作树继续。不要 reset/clean/覆盖式切分支。部分旧分支没有 upstream，不能假定 `git pull` 会更新正确分支。

合并前迁移盘点时，原 Mac 主目录为 `codex/hermes-independent-profile@f88d6f8`，有3个前端文件未提交；当时 main 尚未合入主项目最新代码，目前已完成合并。旧 Windows `D:\灵光爸爸拆解` 和 `bot-historical-recovery` 目录名均不能代替实际分支核对。原目录不应整份覆盖到服务器。

## 2. 按迁移任务选择资料

以下资料按本次迁移范围选择；迁移源码不要求先了解全部生产层或其他员工。

1. 本文件及 [AGENTS.md](../../AGENTS.md)：跨机边界与项目规则。
2. [分层版本/并行分支地图](../../docs/handoffs/2026-10-20-release-map.md)：代码、API、网页、中控、Windows下载、实际设备与Android分别定位。
3. [HANDOFF.md](../../HANDOFF.md) 顶部最新日期及其专项运维/QA：验收、失败和待办。
4. [PROJECT_MANAGEMENT.md](../../PROJECT_MANAGEMENT.md)：架构与开发约定；旧日期、路径、PID仅在对应历史环境有效。
5. 仅接续小红书 TRO 员工时，阅读 [TRO员工交接](../../docs/operations/2026-10-20-xiaohongshu-tro-employee.md)及[脱敏证据](../../docs/qa/2026-10-20-xiaohongshu-tro-employee.json)：复用原员工/聊天/产物，不重复创建或重发旧任务。
6. [新AI接手提示词](../../NEW_AI_SESSION_PROMPT.md)：可粘贴到新电脑。

历史V2分工、旧聊天授权、暂停及实施计划用于追溯，不自动成为新任务；执行以当前用户要求与当前环境指令为准。

## 3. 整个项目的范围

| 部分 | 源码/资料入口 | 接手时核对 |
| --- | --- | --- |
| 主站与API | `frontend/`、`backend/`、`package.json` | 网页资源、实际API文件/进程和持久数据库分别定位 |
| Windows客户端 | `daemon/`、`src/`、`scripts/ziwei-user.mjs` | 官方包SHA/build、各电脑实际认证心跳及安装回执 |
| Hermes Bot/员工 | `backend/bots.mjs`、`src/hermes-bot-config.mjs` | workspace/employee/device/Profile/HOME/聊天绑定及revision/epoch |
| 移动功能 | 地图中的并行分支；`mobile-manager/`位于Android分支而非本主树 | 已提交、已集成、APK已发布、真手机已安装分别核对 |
| 紫薇·互联中控 | 独立`ziwei-system`仓库、分层地图引用 | 单独取得仓库权限与实际运行版本 |
| 外部业务服务 | 员工既有连接及服务自身仓库/文档 | 按账号、scope与真实工具回执核对 |

生产存在分层发布及增量混合源码。Git HEAD、网页、API、中控、客户端下载、设备实际build和APK可能不同。部署前须核对实际文件/manifest/保护范围，按专项流程增量处理；不能整份Git树覆盖生产，不能用旧SQLite快照覆盖当前正式数据。

## 4. 跨电脑权限与私有资料

开发接手可先取得源码并只读盘点；生产维护另行通过用户认可的安全渠道配置对应权限。

| 资料/权限 | 原位置 | 新电脑接续方式 |
| --- | --- | --- |
| 已提交源码、文档、脱敏QA | GitHub | clone正确分支并核对SHA |
| 各工作树未提交代码 | 原电脑worktree | 从私有包取得base和patch，先审查再在独立树恢复，不直接套最新分支 |
| 未跟踪输出、截图、APK、参考图 | 原电脑`output/`等 | 私有包列清单/摘要，具体文件按需要单独安全移交 |
| 网页账号 | <https://qzelynth.top> | 正常登录并核对workspace，默认进入phone_ai不等于已切到bigtron |
| 服务器SSH/运维权限 | 用户授权体系/安全存储 | 在新电脑配置受信入口并核对主机指纹/角色，不从旧helper提取密钥 |
| 中控等私仓 | 各自仓库 | 单独获得权限和对应版本 |
| 主库、控制库、对象文件及服务配置 | 服务器持久路径/备份 | 有权现场盘点；只换开发电脑不必搬走生产库 |
| 设备凭据、CLI登录态、代理、HOME/记忆/原生Session | 各目标电脑 | 保留原实例，通过原平台/设备继续访问；运行设备迁移另行安排，不默认重新配对或克隆HOME |
| 原始.local回执和临时SSH helper | 原电脑忽略目录 | 摘要随Git；原件仅按需要移交。旧helper依赖Mac私有路径，不是可移植维护工具 |
| 端口中心/机器级AI规则 | 每台开发电脑 | 读取目标电脑规则，不复制原机端口占用结论 |

权限只记录已配置/缺失/待配置，不填写密码、token、Cookie、私钥、恢复码或认证配置。用户头像原图和完整聊天不作为公开交接附件。

### 私有离线交接包

离线资料位置为原Mac被忽略目录 `.local/handoff-export/20261020-cross-computer/`，迁移归档为其上级的 `ziwei-cross-computer-20261020.tar.gz`，旁边有 `.sha256` 校验文件。包内包含Git bundle、各工作树已跟踪修改的patch、分支/提交/文件清单及SHA-256；以随包manifest和实际校验确认本轮生成完成。bundle保存Git本地分支历史，patch单独保存未提交代码，不把它们直接合入发布分支。

该目录不在GitHub。接续未提交工作或离线恢复时，由用户通过安全渠道传递交接归档及校验文件。包内README/manifest说明恢复顺序、基线和未收录材料；不含业务数据库、认证配置、员工HOME、完整聊天或未跟踪文件正文。未收录材料保留在原电脑，按清单另取；这不是整个磁盘备份。

## 5. 开发与端口

项目使用Node.js24内置SQLite、npm、Vue/Vite及Express。锁文件与 `artifacts/ziwei-ui-0.3.0.tgz` 已跟踪，脚本以当前package.json为准。首次只读接手无需安装、跑模型、启动服务或生产验收。

实际开发时在隔离树安装锁文件依赖，按改动选择测试、lint/构建与现场验收；不把Mac跳过项/单元夹具称为Windows实机通过。文档变更检查链接、JSON、diff与敏感内容即可。

历史API4178/前端5178/daemon20242是代码默认，不等于新电脑已登记或空闲。原Mac统一端口中心为 `http://127.0.0.1:4780`，CLI为 `/Users/zhangjie/Documents/Codex/tools/port-registry/registry.py`：先list，新用途先allocate/register，启动后check。换电脑按其端口中心与规则执行；登记系统故障不能静默绕过。本次文档更新不启动监听服务。

## 6. 按本次迁移范围核对

根据本次要迁移的材料选择相应项，报告必要信息后继续当前任务。仅获取源码时，无需先盘点全部生产权限、设备和员工业务：

- 源码：分支、HEAD、远端SHA、未提交修改及并行worktree。
- 发布：各层最后文档证据和本轮有权实时核对的范围分开；无权限项标未核实。
- 权限：GitHub、网页workspace、服务器、私仓及设备的可用性，不打印秘密。
- 未完成：本次接续涉及的失败/不确定执行、未安装包或未集成分支；接续TRO时另核对其保护文件写入边界，不重放旧任务。
- 迁移：需要旧worktree修改时，取得私有包并校验SHA；缺失材料不能声称自动迁移。
- 下一步：当前要求涉及哪一层、需要的实际权限与最小验证。

发布顺序为验证→推送并回读远端→按实际分层发布→对应现场验收。文档推送、服务部署、设备安装、原生工具成功和业务完成分别报告。

## 7. 后续维护

每次影响接手判断的工作，同次更新本入口/分层地图、HANDOFF顶部及对应脱敏运维/QA，注明观察时间、来源commit、实际部署层/包SHA/设备build、业务action、未验证/失败和恢复依据。秘密及完整业务记录留在受控位置。

变更接续分支时同步README和新AI提示词；旧时间线保留日期，旧计划不重新变为当前待执行任务。
