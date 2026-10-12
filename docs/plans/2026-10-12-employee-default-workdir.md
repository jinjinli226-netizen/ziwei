# Employee default working directory implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保存每名员工绑定电脑的默认工作目录，使新会话继承且已有会话保持自己的快照。

**Architecture:** 后端保存员工目录与验证设备，所有会话创建入口统一经过 repository。真实设备的 `directory.inspect` 回执验证保存路径，前端使用同一目录选择流程并按编辑身份隔离异步结果。已有员工迁移为 NULL，不改变员工 HOME、记忆或旧会话。

**Tech Stack:** Node.js / SQLite / A2A directory.inspect / Vue / Windows 原生 CLI。

---

本方案沿用用户已批准的设计，在当前隔离工作树执行；不新增执行聊天，不使用原 D 目录或 2884 的未完成改动。各任务先添加行为测试并观察预期失败，再改生产代码，最后由主代理独立复验。

### Task 1: 数据、验证与统一继承

**Files:** `backend/db.mjs`, `backend/repository.mjs`, `backend/management.mjs`, `backend/app.mjs`，新增对应后端行为测试。

1. RED：覆盖 NULL 迁移、默认目录继承、显式覆盖、员工隔离、旧会话不变、错误设备/用户/工作区回执与原子拒绝。
2. 增加 `employees.default_working_directory TEXT NULL` 与 `default_working_directory_device_id TEXT NULL`。不回填设备目录。
3. API 接受 `defaultWorkingDirectory` / snake alias，以及 `defaultWorkingDirectoryActionId` / snake alias。PATCH 省略保留；null 清空两列；拒绝空白、控制字符、超过4096字符与非字符串。
4. 非空新值需要同工作区、实际目标电脑、受信任调用身份的 succeeded `directory.inspect`，且 `exists === true`、`isDirectory === true`；保存规范 `result.path`，服务器推导设备绑定。不信任客户端 checked、role 或 binding 字段。原值同设备的普通编辑可保留。
5. 更换电脑但未清空或取得新电脑回执，409 `DEFAULT_WORKDIR_REVALIDATION_REQUIRED`，员工、审计和通知均不部分写入。
6. 会话 CREATE 优先级：非空显式目录 → 当前设备匹配的员工默认目录 → 原设备目录/既有原生回落。null/空白视为省略。设备不匹配且没有显式目录时 `DEFAULT_WORKDIR_DEVICE_MISMATCH`；保存实际选定路径快照。已有会话读取、消息和 PATCH 不动态读取员工默认值；任务不扩展。
7. 设备目录检查：POST `/api/workspaces/:slug/devices/:deviceId/workdir/inspect`，GET 同路径 `/workdir/actions/:actionId`。复用原 `directory.inspect`，无临时业务会话；`createIfMissing` 仅显式 true。保留在线、停用、身份、成员和本机目录安全规则。
8. GREEN：`node --test` 对应新测试及受影响现有测试。

### Task 2: 管理 MCP 与 Creator

**Files:** `scripts/ziwei-mcp.mjs`, `backend/employees/templates.mjs`, `backend/employees/creator-template.mjs`，对应 MCP/模板测试。

1. RED：实际 HTTP/MCP 省略继承、显式覆盖、受限设备与身份、Creator 首会话继承、重复安装不覆盖。
2. 员工创建/修改工具公开默认目录与回执字段；增加 `ziwei_inspect_workdir`（设备真实检查）与 `ziwei_create_conversation`（仅创建，不发送或执行）。MCP 对应 POST `/mcp/v1/workspaces/:slug/devices/:deviceId/workdir/inspect` 与 `/mcp/v1/workspaces/:slug/conversations`，回执沿用 get_action。
3. 模板配置传递目录和回执，首/修复会话走中央继承。NULL 默认值保持旧 configurationHash 完全一致；非空时才加入目录维度。
4. GREEN：实际 McpHandler、API 与模板回归。静态 MCP 工具变更需要官方新客户端包和原生安全升级，后端部署不能代替。

### Task 3: 页面选择、异步保护和窄屏

**Files:** `frontend/src/App.vue`, `api.js`, `components/CreatorMarket.vue`, `creator-market.js`，复用的目录组件/控制器及测试、CSS。

1. RED：真实 payload、deferred promise 场景覆盖切电脑、改路径、关闭/切编辑、迟到检查与保存响应、会话临时覆盖。
2. 员工创建/编辑及市场提供可选目录，复用目录列表、明确检查和明确创建，不使用 localStorage 持久化员工设置。新建会话不主动发送电脑目录覆盖后端默认，优先员工目标电脑。
3. 改电脑保留路径草稿、失效旧回执；检查绑定 workspace、员工/会话、电脑、路径及编辑代次，迟到响应不可污染后续界面。保存完成不可关闭后来打开的编辑器。
4. 已有会话使用服务端快照，刷新同步干净状态且保留用户未保存草稿。临时目录仅修改该会话。
5. 长中文路径可查看，1440和390实际浏览器检查滚动及底部按钮；避免嵌套弹窗焦点/ESC 冲突。

### Task 4: 独立升级失败诊断

**Files:** 客户端 maintenance 模块、worker 与对应行为测试（以实际源码定位为准）。

1. RED：安装/恢复等阶段失败回执须含真实结构化阶段及安全原因，原恢复和进程保护仍通过。
2. 修复 cause 被通用错误覆盖的诊断缺口；输出有界、脱敏、结构化阶段及原因代码，不打印 token、配置、任意 stdout/stderr。Thinkpad 本次具体原因等待该机证据，不据路径猜测、不用本机缓存替代。

### Task 5: 发布、真机验收与精确清理

1. 源码全量 `npm test`、`npm run lint`、`npm run build`；精确 git archive 全量再验。核对 npm 包、官方 metadata、实际 Windows 安装文件 SHA。
2. 保存部署前双库与服务基线；只允许本轮两列 NULL 迁移，保护原正式行与既有历史。串行主站发布，保持控制/Nginx及设备、认证、HOME。发布必要官方客户端包并只进行一次原生安全升级，等待真实结果与 ready。
3. 独立 QA 员工/目录/会话：至少两次继承 `D:\digital`、修改只影响新会话、临时覆盖与旧会话保持、员工隔离、刷新/重登录、API 与 MCP、省略/显式优先级；最小只读 Windows 原生执行以 PEB cwd 核对。不得执行手机动作或重放旧过期消息。
4. 1440/390真实浏览器验证页面和按钮。回归 A2A 恢复、手机目录摘要、会话图片；不以 fixture 代替真实模型/原生证据。
5. 只按本轮精确 QA manifest 清理，完整数据库与正式资源保护复验；不恢复整库、不重跑旧清理或旧被拦截本地删除。
6. 更新 PROJECT_MANAGEMENT、HANDOFF 和运维记录实际结果、SHA、验收与限制。GitHub push 并核对 ls-remote；未完成的验收不声称上线完成。
