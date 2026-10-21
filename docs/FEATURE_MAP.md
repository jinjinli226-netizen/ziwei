# 紫薇功能索引

先用[项目入口](../AI_HANDOFF.md)理解系统，再选与当前任务有关的行。代码与测试路径相对于仓库根目录；专题链接相对于本文件。每项先读对应模块，沿实际调用关系补充上下文。

## 按用户说的功能找实现

| 功能或关键词 | 优先源码 | 相关测试 | 需要背景时再读 |
| --- | --- | --- | --- |
| 员工 Creator、伙伴市场、岗位模板 | `backend/employees/templates.mjs`、`backend/employees/creator-template.mjs`、`frontend/src/components/CreatorMarket.vue`、`frontend/src/creator-market.js` | `test/creator-template.test.mjs` | [Creator 平台](operations/2026-10-09-creator-platform.md)、[Codex 启动修复](operations/2026-10-20-company-creator-codex-mcp.md) |
| 团队员工、身份、人格、可见范围 | `backend/repository.mjs` 的员工方法、`src/employee-runtime.mjs`、`frontend/src/App.vue` | `test/employee-config-api.test.mjs` | [项目管理手册](../PROJECT_MANAGEMENT.md) |
| Bot 创建、配置、独立 Profile/HOME | `backend/bots.mjs`、`backend/bot-profiles.mjs`、`src/hermes-owned-profile.mjs`、`src/hermes-bot-runtime.mjs`、`frontend/src/bot-owned-profile.js` | `test/hermes-bots-api.test.mjs`、`frontend/src/bot-profile-create.test.mjs` | [独立 Profile 合同](contracts/2026-10-13-hermes-owned-profile-api.md) |
| Bot 伙伴打开卡顿、列表及配置按需加载 | `backend/bot-roster-view.mjs`、`backend/bot-workbench-view.mjs`、`frontend/src/bot-page-load.js`、`frontend/src/bot-workbench.js` | `backend/bot-page-read-view.test.mjs`、`frontend/src/bot-page-load.test.mjs`、`frontend/src/bot-workbench-loading.test.mjs` | [网页性能](operations/2026-10-21-bot-page-performance.md) |
| 能力组合、配置缺项、开关和真实状态 | `backend/bot-capabilities.mjs`、`frontend/src/bot-capability-actions.js`、`frontend/src/bot-workbench.js` | `test/bot-capabilities.test.mjs`、`frontend/src/bot-capability-actions.test.mjs` | [手机能力状态](operations/2026-10-15-bot-phone-capability-status.md) |
| 长期聊天、Codex 记忆、原生会话续接 | `src/codex-conversation-session.mjs`、`src/runtime-adapters.mjs`、`frontend/src/components/BotMainChat.vue`、`frontend/src/bot-main-chat.js` | `test/codex-conversation-session.test.mjs` | [记忆与续接 QA](qa/2026-10-19-codex-conversation-memory.json) |
| 网页聊天打开慢、历史每次10条、向上翻页 | `backend/conversation-thread-view.mjs`、`frontend/src/conversation-history.mjs`、`frontend/src/components/BotMainChat.vue`、`frontend/src/App.vue` | `backend/conversation-thread-view.test.mjs`、`frontend/src/conversation-history*.test.mjs` | [历史按需读取](operations/2026-10-21-conversation-history-pagination.md) |
| Hermes 上下文过长、官方压缩 | `src/hermes-official-compression.py`、`src/hermes-native-bridge.py`、`src/runtime-adapters.mjs` | `test/hermes-bot-compression-config.test.mjs` | [官方上下文恢复](operations/2026-10-19-hermes-official-context-recovery.md) |
| D 盘、默认工作目录、目录选择或绑定 | `backend/employee-workdir.mjs`、`src/windows-workdir.mjs`、`frontend/src/workdir.js`、`frontend/src/components/WorkdirPicker.vue` | `test/employee-execution-workdir.test.mjs`、`test/directory-inspection.test.mjs` | [执行目录](operations/2026-10-18-employee-execution-workdir.md)、[聊天绑定](operations/2026-10-17-chat-directory-binding.md) |
| CLI 检测、模型/provider、代理、启动失败 | `src/runtime-cli-discovery.mjs`、`src/runtime-adapters.mjs`、`src/hermes-launcher.mjs`、`src/hermes-mcp-bootstrap.py` | `test/runtime-profile-discovery.test.mjs`、`test/codex-mcp-configuration.test.mjs` | [Hermes 非交互执行](operations/2026-10-19-hermes-noninteractive-tty.md) |
| 多员工并行、停止不了、执行待核实、进程树 | `src/daemon.mjs`、`src/runtime-process.mjs`、`src/runtime-process.ps1`、`backend/bot-execution-occupancy.mjs` | `test/daemon-employee-parallel.test.mjs`、`test/bot-stop-protocol.test.mjs` | [失败历史与维护](operations/2026-10-19-client-failed-runtime-maintenance.md) |
| 执行失败自动收尾、结束本次执行、失败不再卡住 | `backend/bot-failure-finalization.mjs`、`src/bot-failure-finalization-contract.mjs`、`src/client-failed-action-finalization.mjs`、`src/runtime-launch-evidence.mjs`、`frontend/src/bot-failure-finalization.mjs` | `backend/bot-failure-finalization.test.mjs`、`test/bot-start-network-prelaunch.test.mjs`、`frontend/src/bot-failure-finalization.test.mjs` | [失败执行自动收尾](operations/2026-10-21-failed-execution-finalization.md) |
| 客户端升级、远程更新、维护锁 | `backend/device-updates.mjs`、`src/client-remote-update.mjs`、`scripts/client-remote-update-worker.mjs`、`scripts/client-local-history-stop-recovery.mjs`、`src/client-failed-action-finalization-recovery.mjs` | `test/client-remote-update.test.mjs`、`test/client-update-lock-recovery.test.mjs`、`test/client-failed-action-finalization-legacy-health.test.mjs` | [统一远程升级](operations/2026-10-18-remote-client-updates.md)、[失败恢复](operations/2026-10-21-failed-execution-finalization.md) |
| 升级时暂停、断点续干 | `src/maintenance-checkpoint.mjs`、`src/client-maintenance-resume.mjs`、`backend/action-maintenance.mjs` | `test/client-maintenance-resume.test.mjs` | [维护续做](operations/2026-10-19-maintenance-checkpoint-resume.md) |
| 管理 MCP、自动设备授权、创建员工工具 | `scripts/ziwei-mcp.mjs`、`backend/management.mjs`、`backend/management-bootstrap.mjs`、`src/management-bootstrap.mjs` | `test/management-bootstrap-security.test.mjs`、`test/management-mcp-runtime.test.mjs` | [默认管理 MCP](operations/2026-10-09-default-management-mcp.md) |
| 员工互聊、伙伴协作、消息与委派 | `backend/bots.mjs` 的collaboration、`backend/repository.mjs` 的dispatchBotCollaboration、`src/hermes-native-bridge.py` 的install_collaboration_tools | `test/hermes-native.test.mjs` | [Ins与TK真实文字往返](operations/2026-10-21-ins-tk-collaboration-live.md) |
| 手机连接、截图、读图、手机操作 | `backend/phone-mcp.mjs`、`scripts/ziwei-terminal-mcp.mjs`、`src/conversation-image-artifacts.mjs` | `test/mcp-phone-summary.test.mjs`、`test/terminal-mcp-runtime.test.mjs` | [手机 MCP](PHONE_MCP.md)、[真实读图链路](operations/2026-10-15-phone-vision-default-tools.md) |
| 紫薇映界、共享知识库、全员默认知识技能 | `skills/ziwei-world-memory/`、`backend/skills/catalog.mjs`、`backend/repository.mjs` 的executionPayload | `backend/world-memory-skill.test.mjs` | [知识库技能与真实授权边界](operations/2026-10-21-world-memory-skill.md) |
| 聊天粘贴、多图、JPG、附件与图片产物 | `backend/conversation-attachments.mjs`、`frontend/src/conversation-compose.js`、`src/raster-image.mjs` | `frontend/src/conversation-paste.test.mjs`、`test/conversation-image-upload-compat.test.mjs` | [剪贴板多图](operations/2026-10-15-chat-clipboard-multiple-images.md) |
| 爆款库/Team Planner、外部 MCP、OAuth、轮后配置 | `backend/bot-mcp-connections.mjs`、`backend/bot-deferred-config.mjs`、`src/hermes-remote-mcp-oauth.py`、`src/hermes-mcp-config.mjs` | `test/bot-mcp-oauth-http.test.mjs`、`backend/bot-deferred-config.test.mjs` | [远程 OAuth](operations/2026-10-17-remote-mcp-oauth.md)、[轮后自动应用](operations/2026-10-18-bot-deferred-mcp-config.md) |
| Routine、定时任务、24 小时、不限轮数 | `backend/bots.mjs` 的 Routine 方法、`backend/repository.mjs` 的 automation 方法、`src/hermes-bot-config.mjs` | `test/automations.test.mjs`、`test/hermes-bot-turn-limits.test.mjs` | [默认不限轮数](operations/2026-10-18-default-unlimited-turns.md) |
| goals/heartbeat/kanban、Gateway、语音等 Hermes 能力 | `src/hermes-native-contract.mjs`、`src/hermes-native-bridge.py`、`src/hermes-native-runtime.mjs`、`frontend/src/bot-native-operations.js` | `frontend/src/bot-native-operations.test.mjs`、`test/hermes-driver-runtime.test.mjs` | [Bot 原生能力交接](handoffs/2026-10-13-e03-hermes-native-ui-candidate.md) |
| 手机聊天同步、通知、已读、执行状态 | `backend/mobile-notifications-v2.mjs`、`backend/mobile-read-view.mjs`、`backend/conversation-read-state.mjs` | `backend/mobile-notifications-v2.test.mjs`、`backend/mobile-read-view.test.mjs` | [手机聊天同步](operations/2026-10-17-mobile-chat-sync.md) |
| Android 管理 App、汇报入口、手机通知界面 | 当前主树不含 `mobile-manager/`；先按右侧地图取得对应并行分支源码 | 对应 Android 分支测试与 APK 验收 | [Android 来源及分支](handoffs/2026-10-20-release-map.md) |
| 紫薇互联、被控手机 Agent/Updater、后台存活 | 独立 `ziwei-system` 私仓；主仓连接端为 `backend/phone-mcp.mjs` | 对应私仓与物理手机验收 | [手机生命周期](operations/2026-10-16-phone-input-lifecycle.md)、[仓库地图](handoffs/2026-10-20-release-map.md) |
| 登录、邀请、工作区权限、设备归属与数据 | `backend/auth.mjs`、`backend/a2a-auth.mjs`、`backend/db.mjs`、`backend/storage.mjs`、`backend/repository.mjs` | `test/permissions-devices.test.mjs`、`test/identity-workspace-devices.test.mjs` | [数据保留合同](v2-preservation-contract.md) |
| 部署、回退、实际源码与客户端下载版本 | `scripts/server-code-rollout.mjs`、`scripts/production-source-proof.mjs`、`scripts/verify-preservation-runtime-closure.mjs` | `test/preservation-runtime-closure.test.mjs` | [分层发布地图](handoffs/2026-10-20-release-map.md) |

## 沿调用链继续定位

网页通常经过组件/功能 JS → `frontend/src/api.js` → `backend/app.mjs` 路由 → 专项服务或 `backend/repository.mjs`。执行再经过 A2A 动作 → `daemon/ziwei_user.mjs` → `src/local-action.mjs` → `src/runtime-adapters.mjs` → 本机 CLI；结果回传后由网页/移动端展示。

需要公共路由、数据方法或页面位置时，在这些总入口内搜索目标接口、方法名或用户看到的文字：

```sh
rg -n '目标接口或方法名' backend src frontend/src scripts
rg --files test frontend/src backend | rg '相关功能关键词.*test'
rg -n '报错代码' src backend frontend/src test
```

测试命令及开发脚本看根目录 `package.json`。部分旧测试会启动本地监听，运行前遵守目标电脑的端口登记规则。修复范围、测试通过、正式部署和真实设备安装分别确认。

## 维护这张地图

路径和模块职责以当前代码为准，专题记录保留日期。新增或移动主要功能时更新对应行；临时会话分工、具体员工业务内容和本机私有原始回执不放进索引。某模块不在当前树时，注明正确分支或仓库。
