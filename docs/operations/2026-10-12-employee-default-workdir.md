# 2026-10-12 员工默认工作目录、Windows 维护诊断与实际验收

功能、官方客户端升级与真实执行验收已通过。精确 QA 清理停留在预检查阶段，尚未执行任何删除：真实用户期间继续创建员工、邀请、文档并执行会话，必须保留这些正式记录。

## 发布来源与当前版本

本轮工作树为 `C:\Users\25941\.codex\worktrees\a2a-delivery-recovery\灵光爸爸拆解`，GitHub 分支为 `codex/employee-default-workdir`。原 `D:\灵光爸爸拆解` 和其他接续工作树的未提交修改不作为发布来源。

| 项目 | 实际版本或路径 |
| --- | --- |
| 员工默认目录、前端与官方客户端提交 | `274a418353b66d3c1dec23590274597921dccc34` |
| 主 API 锁争用修复提交 | `a66df9c76de5ed016932ca0193a307f3df72f47f` |
| 当前主 API 发布目录 | `/opt/ziwei/releases/a66df9c-sqlite-179d0d46` |
| 当前主 API PID | `181593` |
| 官方客户端实际 Windows build | `c7b83a41d997ace8b9aa5d07e6acf5ebcc189fad4f9f41d2f6ed0c436242fab5` |
| 官方包 SHA-256 | `67c0b78948a367b756822e30210c3a3738a2f101af725b1ad7d3bcaea74be31d` |
| 官方包大小 / 文件数 | `112679` 字节 / `32` 文件 |
| 当前公开 release.json 原始字节 SHA | `38b64cb04443e2eb96a774b9e029d82bd0be677119cc25bfe490c47711486fcd` |
| 前端业务资源 | `index-BTklAvoe.js` / `index-BzSMaS9U.css` |
| 客户端原生版本号 | `0.1.0`；通过 build、提交及包 SHA 区分实际版本 |

## 最终行为

员工创建、编辑及 Creator 保存默认工作目录和验证电脑。服务端核对实际成功的 `directory.inspect` 回执、可信请求身份、工作区、设备、目录及完成后十分钟时效。改变电脑后需要重新验证或明确清空默认目录。

新会话省略目录或传 null 时使用员工默认目录；显式非空目录只覆盖当前会话。选择结果保存在会话快照中，因此修改员工默认目录只影响之后创建的会话。旧员工的两个新字段迁移为 NULL，原有会话、员工 HOME 和记忆目录保持原规则。

已安装管理 MCP 实际公开 23 个工具，新增 `ziwei_inspect_workdir` 与 `ziwei_create_conversation`，员工创建和更新工具包含默认目录及检查回执字段。会话创建工具只创建会话，不自动发送消息。

Windows 维护结果增加有界、脱敏的阶段、原因代码、退出码或信号、HTTP 状态及恢复失败信息。ThinkPad 的后续只读实机回执已确认实际端口为 33001，旧 health 协议缺少 deviceId、clientBuild、activeActionCount、pollingCount，因而在 stop_client 阶段触发 CLIENT_IDENTITY_MISMATCH。历史源码证实这一代也没有 pause/drain 控制接口；该机兼容升级仍待修复和实际验收，不能将未知执行状态当作空闲。

## 本地与构建验收

| 检查 | 已获得的结果 |
| --- | --- |
| 功能提交精确 git archive 全量测试 | 658/658，fail/cancelled/skipped/todo 均为 0 |
| 主 API 热修复精确 git archive 全量测试 | 662/662，fail/cancelled/skipped/todo 均为 0 |
| lint / 前端构建 | 78 个文件通过；1764 个模块构建成功 |
| Windows 官方包隔离实装 | 32 个已安装文件与发布 manifest SHA 匹配 |
| 独立源码审查 | 34/34 |
| 实际构建 Edge DOM fixture | 8/8，1440/390 长中文路径、设备变化、回执与 Creator payload |
| Windows 维护隔离行为测试 | 17/17，含失败、恢复、锁及敏感信息保护 |
| SQLite 争用新回归 | 4/4，使用第二个真实进程持有数据库读锁 |

Creator 的本轮结论来自源码、API/模板及实际构建 DOM fixture；本轮没有再次通过正式 Creator 页面启动模型，不把 fixture 结果称为正式 Creator 真机运行。

## 部署、锁争用与备份

功能发布在北京时间 12:21 完成，原发布目录为 `/opt/ziwei/releases/274a418-workdir-0252d3b5`，备份为 `/opt/ziwei-backups/employee-default-workdir/20261012T042109Z-c54963d6da33447790aa0e8e34765c78`。

12:44 的只读快照期间，旧 API 的 WebSocket 认证同步执行过期会话清理，遭遇 SQLite 读锁并产生未捕获的 `ERR_SQLITE_ERROR` / errcode 5，主 API 被 systemd 自动重启一次。保留了原失败日志，没有恢复数据库。

热修复为每个连接设置 `busy_timeout=5000`，并对 WebSocket 升级认证增加异常边界；锁争用返回 503 和短重试提示，其他内部错误返回 500。13:10 发布热修复，备份为 `/opt/ziwei-backups/server-lock-fix/20261012T051032Z-f60eb892a0c8436d8c2810730e003c15`。修复后只读快照保持主 API 同一进程。

本轮主 API 有两次计划内停启、上述一次旧代码自动重启；控制服务 PID134533、Nginx PID737 保持，没有控制或 Nginx 重启。热修复没有再次写入官方客户端包或前端业务资源。两次发布均没有整体恢复数据库。

## 本机真实升级与进程

原生升级任务 `update-9a3e3d56-77fc-45e9-aaf3-e50503f4e785` 在 `2026-10-12T04:24:24.087Z` 得到真实完成结果。升级保留当时的停止状态；用户随后自行启动原连接，实际 PID36264、创建时间 `2026-10-12T04:28:44.880Z`，ready=true，工作区 bigtron。

配置 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json` 的 SHA 为 `7913bf1c1b490ecf9b6d6760787973c28f8c484703c144eb0028b57ef8166b72`。执行后只读复验仍为同一 PID、构建和连接，活动任务为 0；原生入口、设备凭据、Codex auth `59f575…` 和 config `b48715…` 与升级后基线相同，没有再次升级、停止或重配对。

项目独立健康与退出观察器 PID39608 已验证。日志为 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\logs\client-exit-watch.jsonl`，10 秒周期，包含进程身份、健康、退出码或未知原因；5 MiB×5 轮转，日志不含密钥。状态位于 `...\diagnostics\client-exit-watch.state.json`。这是当前 PID36264 实例的观察器，客户端退出后观察器退出；未来 PID 或重启需要重新挂接，未声称已有自动开机守护。

端口登记保持原项目 4178、5178、20242，没有启动新的本地前端/API 实例或改端口。

## 本轮真实 QA

QA run 为 `d7b9a08c-5314-42ad-90a1-70c81c702a0f`，使用独立账号、两个 personal 员工及精确记录的会话/动作。

1. 原客户端只读检查发现 `D:\digital` 不存在，实际 action succeeded/exists=false/created=false。随后明确创建该路径一次，并在 `D:\digital\ziwei-workdir-qa-<run>` 下创建本轮隔离子目录。未把缺失目录报告为已存在。
2. 员工 A 两条不同会话省略/null 目录均继承 `D:\digital`；临时覆盖只影响对应会话，员工 B 使用另一个目录。修改 A 默认目录后，新会话继承新值，旧会话保持。退出登录后旧 cookie401，重新登录后员工和会话快照相同。
3. 全局已安装 `scripts/ziwei-mcp.mjs` 的真实 stdio 工具列表为 23；恰好调用两个新工具。创建会话省略显式目录并继承保存值，目录工具只读检查 D 盘目录成功。使用本轮新私有缓存，原共享缓存和原设备凭据保持；此短期 capability 引用原凭据、不能单独撤销，不能撤销正式设备凭据来清理它。
4. 实际已安装 Edge 的本轮独立 profile 通过长中文路径保存、刷新和三次正常 UI 登录检查。1440/390 视口没有横向溢出，完整路径可读，底部保存按钮可点击。新建会话请求省略目录并继承实际保存值。首次加载时的未选员工点击没有产生 POST；只读核对无未知会话后，等待选择器加载再完成一次新建，没有重复原修改请求。
5. 唯一只读消息 action `action_9ad030d9-347a-4d25-a6a8-b2a68c8f82d6` succeeded，Codex gpt-6.1-sol 退出码 0，返回精确 `WDIR_QA_<run>` 标记。实际只观察到一个 CLI 子进程 PID33448、父进程36264；原生 PEB cwd、页面保存值、会话快照和 action cwd 匹配。管理 MCP loaded，工具调用列表为空，outputArtifacts 为空，手机动作 0。原生 stdout 包含未使用的旧技能格式和模型列表刷新诊断，未影响本次实际终态和结果。

## 精确清理与证据保留

验收前封存的 main 40 表、3701 行和 control 45 表、52 行，完整 PK 与原始行 inventory 已独立核对。main SQLite SHA 为 `05a11417a9d7fc3b64602594b59d741c4539a9d5e8c7533b9ca4f55b7e1277bc`。传输不完整时只恢复同一已完成快照的下载，没有重放捕获或业务动作。

清理预检查发现另一个账号并发新增的 user/member/session 三条记录，以及正常页面为 QA 个人工作区同步的一条平台技能。三条外部记录须通过精确 PK、完整原始行 SHA、同用户关系、时间窗口和原始封存快照证明后保留；同时保留该用户接受既有邀请产生的唯一 status、accepted_at、member_id 转换，其余邀请字段原始值一致。上述正式用户记录均不能成为本轮删除或回退目标。QA 技能仅以已记录的 ID、完整行 SHA、QA 个人工作区和固定 catalog 纳入删除；未知第四条新增仍拒绝。正式旧行、手机目录、任务和设备凭据继续保护。

只允许原客户端自动续期造成 `devices.management_mcp_json.$.expiresAt` 的精确标量变化，其他 JSON 原始字节保持。证据来自实际 plain AppData 缓存、readyz 和发布源码；当前源码没有独立 bootstrap 日志，不虚构成功事件。没有基线已过期会话，因此本轮不使用过期会话删除豁免。

清理状态：尚未 apply 或删除。后续预检查发现新的正式业务记录：69 条 action event、1 条 action、77 条审计、2 条会话消息、文档及版本各 1、1 名员工、1 条邀请、2 条管理请求和 77 条通知。它们不属于本轮 QA；保留完整快照与精确 QA 清单，待重建包含正式并发业务的保留基线后再恢复清理。并发用户会话最近访问时间已核对为认证代码的单列更新，其他原始字段保持。最终独立验证还需绑定提交时的最新会话时间下界；当前没有提交，因此不存在由此造成的写入。全部 QA cookie401 和空目录清理仍待实际执行。不得重新执行旧清理，不整体恢复数据库，不删除用户 HOME、认证或旧被拦截的本地目录。

详细私有证据保存在工作树 `.local/employee-default-workdir/release` 和 `.local/employee-default-workdir/qa/d7b9a08c-5314-42ad-90a1-70c81c702a0f`，凭据及完整数据库不提交 GitHub。
