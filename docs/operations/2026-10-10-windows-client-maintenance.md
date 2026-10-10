# Windows CLI 发现与客户端维护

本轮以用户最新“只适配 Windows”为准。修复共用设备数据映射，新增 Windows `stop`、`update`、`uninstall`；不新增 macOS 发现适配或声称远端 Mac 实测通过。此前清理后用户新建的工作区、邀请、账号和电脑连接都是正式数据，不重复清理。此前清理的用户目录配置仍为 `disconnected`、0 连接，但用户侧已启动新的真实实例：`03:50Z` 只读 health 为 bigtron / 李金晋电脑 / PID58720、旧 build40af5811。本轮不停止、升级或重连该实际实例，不把历史“20242 无监听”继续当作当前事实。

## 原因与修复范围

1. 原团队设备树对每台电脑循环同一份 workspace runtimes。服务端汇总忽略 `runtime_device_metadata`，优先使用服务器发现或其他电脑覆盖的 workspace 元数据，可能造成跨电脑假离线或假可用。每个设备现在读取自己的精确上报；工作区汇总只能从实际设备证据生成，不推断本地服务器 CLI 属于用户电脑。
2. 原 CLI locator/版本错误被统一标为 unavailable，网页再显示等待心跳。新 Windows 发现分别报告可用、未找到、检测失败及安全原因；`--version` 超时、依赖缺失或无法解析，不冒称未安装。认证或缓存模型存在不等于 CLI 版本探测成功。
3. 原 native start 使用 npm 包根目录作为 daemon cwd，Windows 更新重命名包目录时存在自锁。新 daemon 从持久数据目录启动。更新由包外 worker 等待发起 CLI 退出，先校验官方包并 staging 安装全部依赖，再排空并停止精确原 daemon、同父目录更换程序，保留原 prefix、bin 和连接。
4. 原 Windows npm shim 探测对所有入口尝试邻近 Codex JS。李金晋电脑自己的旧上报中 Gemini 入口是 `gemini.ps1`，版本却为 `codex-cli 0.159.2`。新 shortcut 仅用于 Codex shim；本机只读真实检测分别为 Claude2.1.285、Codex0.162.0-alpha.2、Gemini0.51.0、Hermes0.21.3，不能把这份工作树版本证据冒称实际旧 daemon 已升级。
5. 周期 heartbeat 不再每 tick 强制同步冷探测，改为复用现有30秒缓存，实际 `checkedAt` 不伪刷新；启动与手动/profile刷新仍强制。原1秒夹具频繁探测导致3秒本机控制请求超时，新回归从3次心跳6次冷调用 RED 转为1次 GREEN。TTL到期的冷探测仍是有期限的同步调用，本轮没有实现异步发现。

## 李金晋电脑的精确证据

用户明确“我就是李金晋”，验收目标是 bigtron 的 `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`，Owner `user_c6deeadf-d2b3-43c2-820d-644d5829acf2`。此前另一台 `device_791…` 的结果不能作为本人电脑验收。

`2026-10-10T03:48:53Z` SQLite backup-to-memory 只读快照显示本人设备心跳新鲜、凭据有效，自己的四项 `runtime_device_metadata` 全部 available；workspace最后写入的元数据却是另一设备“只有Codex available”。旧后端还合并服务器发现，旧前端重复显示workspace catalog。该矛盾证明显示映射有误，不能据页面灰色断言本人缺少CLI。截图灰3/Hermes绿的具体瞬时来源无法从稍后快照完整复原；修复按本人精确ID回读，不伪造四项可用。

## 用户命令

在需要维护的那台 Windows 电脑的终端执行。以下命令是纯文本，网址不含 Markdown 链接语法。

```powershell
ziwei_user stop
ziwei_user start
ziwei_user update
ziwei_user update-status --json
ziwei_user uninstall
```

`stop` 保留主/shared 连接、设备身份、认证、工作目录和记忆。它暂停领取新任务并等待在途任务完成，忙超时会恢复原连接并返回失败，不能用该命令强杀其他 Node/模型进程。重复停止是幂等操作。

`update` 首先返回 queued，包外 worker 后续执行；用 `update-status` 检查 complete 或 failed。官方包取自固定 HTTPS URL 和 SHA-256 发布清单，安装完成还检查实际源 build。仅原先运行且仍连接的实例恢复；原先停机或主动断开不会自动 start。下载或 staging 失败不动原程序；更换后验证失败回退原包目录。原程序备份与维护日志留存。Windows 外部文件占用不能通过 npm `--force` 解除，本命令也不提供突破 OS 锁的 force 选项。

`uninstall` / `remove` 仅卸载已核实的全局 ziwei 包及它自己的入口，默认保留用户数据、连接与认证，不请求服务器删除任何资源。用户数据仍位于旧包内的遗留安装会拒绝操作，防止误删；不会把“已做一个备份”当作默认保留原数据。卸载由包外 worker 执行，结果与日志位置由命令返回。

旧版没有 update/stop 时，在 PowerShell 运行官方升级入口：

```powershell
irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex
```

该入口读取当前 npm root，校验官方包，在临时 prefix 准备新版更新器，再精确更新原安装；不改变原 npm prefix，不生成配对码。提交后仍用 `ziwei_user update-status --json` 确认实际结果。若外部终端工作目录或其他进程仍占用安装目录，需退出该目录/解除真实占用后重试，不能报告强制成功。

第一次安装仍使用：

```powershell
npm install --global "https://qzelynth.top/downloads/cli/ziwei-latest.tgz"
```

## 验证与发布记录（已发布）

主站于 `2026-10-10T04:02:12Z`（北京时间12:02:12）发布 `36d6bf108002353bfcba96abb2a2663e63828bbc`，`/opt/ziwei/current -> /opt/ziwei/releases/36d6bf1`。只重启 `ziwei-api.service`，最终 PID140116、NRestarts0。控制服务保持 `8a4fe59` / PID134533，Nginx保持PID737；后两者未重启，Nginx配置SHA仍为 `faf170c39866d8c307ed68cc49d96cf7cc28dfac442e979d3f3d8c35cf494967`。手机路由、APK与签名身份保留。

最终发布前备份为 `/opt/ziwei-backups/windows-client/20261010T035832Z`，两库 integrity通过、foreign-key问题0；早期 `20261010T032015Z` 备份也保留。检查使用 SQLite backup API 后离线快照，没有长在线读事务。04:23:14Z最终复核仍为2工作区、3电脑、5登录账号、4成员、4邀请、3员工、7技能、1正式会话/模板、3设备凭据、2手机MCP配置/绑定；保护资源精确ID、phone_ai三名员工完整记录及中控2手机/4节点保持。以上是用户清理后的正式使用，不能当作待删除清单或整库回滚目标。

### 本人实际页面与布局

最终静态前端来源 `4464bb5ea9504ef9c4508718578fc379fd7985d4`，04:22:16Z原子发布；资源 `index-BakqZA2_.js` / `index-DArH7kBc.css`，旧hash资源继续保留。该次仅修复元数据标签换行与窄窗口可达性，三服务PID/重启计数均未改变。favicon继续复用全局紫薇Logo，图片SHA为 `68452b1f4299b0af353ee35d3315302061fa64c72cc77ba66763ebb8ec81ca2c`。

04:23:41Z本人实际页面 **24/24** 通过：李金晋电脑精确bfd设备显示Claude/Codex/Gemini/Hermes **4/4可用**；另一台791设备保持只有Codex **1/4可用**，状态与版本没有混用。1440×900、390×844、720×450共39张截图，所有元数据标签边界在卡片/行内、长版本换行、四项都能垂直滚动到达；3个浏览器context全部关闭，业务写、页面/console/请求/异常响应错误、外部请求、WebSocket发送、模型/手机/设备动作均0，三场景员工0→0且完整hash一致。结果与可展示截图在 `.local/client-maintenance/device-ui-live-wrap-final/results.json`、`1440x900-li-jinjin-four-CLI.png`。

实际旧daemon仍是PID58720、20242在线、build `40af5811c95e3c251ddb0daa887eb60bf9f4135365b0afdea46f3bcb45a6b6d6`；04:24:09Z只读复核未被停止、升级或重连。旧心跳没有clientBuild字段且仍误报Gemini `codex-cli 0.159.2`；页面忠实展示该现有记录，不能把页面四绿当作客户端已升级。新版只读真实探测Gemini为0.51.0，更新实际旧客户端后才会按新探测上报。用户目录旧断开配置文件hash `A633F98812BDF96098AA42642A74FCAD2B73AAE233BF24BB1464D8200E6EED8E` 保持；磁盘历史配置状态不能替代正在运行实例的health事实。

两次临时Owner QA会话均已精确撤销，最后一次04:24:07Z撤销、04:24:09Z旧cookie实测401，服务器私有文件和本机临时token已移除。证据为 `.local/client-maintenance/session-first-final-result.json` 与 `session-final-result.json`。

### Windows公开包与真实升级入口

官方包 `https://qzelynth.top/downloads/cli/ziwei-latest.tgz`：version0.1.0、93,329bytes、29项必需文件，SHA-256 `628976fc1edda7a0bbc7bfc8f665bee0f517aa2e280097a809d6369d3157ea08`。来源为36d6bf1的客户端程序。

- Windows真实npm安装后的clientBuild：`6d0709a2f20acb43d6887b9182937cc8020e25a178df16e1e5ad9fd80dad3df8`。
- 原归档sourceBuild：`cf30d9b6ac6c76f60af2798fc7e8e31c3c047a11f29d2ae296ac9bd435002109`。
- 两者差异仅为npm bin-links将 `scripts/ziwei-user.mjs` 的shebang行CRLF归一为LF，其余文件字节一致。公开metadata已分别记为clientBuild/sourceBuild、clientBuildPlatform=win32，不能把解包hash当作安装运行hash。证据 `.local/client-maintenance/installed-build-publication.json`。

最终PowerShell入口来源 `c5b720b6d7317ad384b7371600c17c65c0e6e75d`，4,093bytes、全ASCII无BOM，SHA-256 `e78e39f3e1eeb9808ecd4ed32f2f856a82947f81e4ee2ca60f20383c766c332a`。使用显式UTF-8读取JSON，临时设置并恢复Console.OutputEncoding，以.NET计算SHA。先前UTF-8无BOM在Windows PowerShell5 `-File`失败、加BOM又在octet-stream的实际 `irm` 解码失败；两份失败证据保留，最终以真实HTTP/WinPS5验证，不能只凭本地ParseFile通过。

**实际纯 `irm … | iex` 综合验收11/11通过**：隔离的真实npm全局prefix中运行原116c1e7旧包与两个独立main/shared身份，先断言PowerShell npm root精确指向夹具prefix，再下载公开metadata/包/脚本执行旧版升级；结果actual complete、新PID/安装build/ready正确、身份/认证/记忆/工作目录/bin字节保持。随后stop、重复stop、同身份start、包外uninstall均通过，其他CLI及无关Node保持。04:14:05Z开始、04:14:41Z更新完成、04:19:27Z卸载完成；全部隔离进程已退出，没有更新本人实际global。证据 `.local/client-maintenance/windows-global-acceptance.json` / `windows-global-final.log`。

04:23:17Z公开域名复核包、metadata、PowerShell、两前端资源均200，内容SHA匹配、主站health=true；证据 `.local/client-maintenance/public-release-verification.json`。程序升级必须在该台电脑原有Windows终端环境中执行上方命令，再查 `ziwei_user update-status --json` 的真实结果；缺少精确实例控制凭据或身份不符时安全失败，不自动重配对或扩大停止范围。

### 代码验证与边界

- 完整串行回归 `node --test --test-concurrency=1` **454/454、0 skip**，日志 `full-tests-final.log`；该完整运行在最终PowerShell编码与CSS修复前。编码修复后另增Windows PowerShell5真实HTTP解码/语法回归 **1/1**，不能合并声称完整455/455。
- 最终lint65文件通过，构建通过；浏览器换行几何fixture先RED后GREEN **24/24**，实际线上独立 **24/24**，证据 `device-ui-wrap-red`、`device-ui-wrap-green`、`device-ui-live-wrap-final`。
- `client-update.test.mjs` **6/6**：真实npm隔离prefix staging/目录替换、停机不自启、原连接/记忆/bin/其他CLI保留；坏包在停止前失败；更换后启动失败恢复原包、原运行入口和原配置字节。
- 生命周期 **7/7**，native-refresh **2/2**；wrong-build夹具已去除目录名包含build造成的假通过，要求真正启动后返回准确的实际build不匹配诊断。runtime重点 **67/67** 含真实native-forget **10/10**、心跳缓存回归。
- Creator原HOME20持久文件、2 action-state、4源profile/config/SOUL hash只读复核不变。

本轮完成Windows发现、设备状态映射、页面布局及Windows程序维护的发布验收；本人现有daemon升级、模型/provider执行、手机业务实机及Mac适配没有执行。TTL到期仍可能触发同步冷探测，不宣称全异步发现或消除所有版本命令超时。

回滚程序只切换对应代码/前端或公开包，保留现有data/.local和新正式数据；不得直接恢复整库覆盖用户新增资源。数据库schema新增字段保持兼容，需数据库恢复时另按明确目标与最新备份核实。最终生产只读证据在 `.local/client-maintenance/production-final.log`，服务器备份目录内也保留postdeploy-verification记录。
