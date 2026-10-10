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

## 验证与发布记录

发布验收进行中。初次安全备份 `/opt/ziwei-backups/windows-client/20261010T032015Z` 已通过两库 integrity / foreign-key 校验，读取使用 SQLite backup API 后离线检查，没有长在线读事务；发布前继续捕获最新正式数据。此时正式主站已有2工作区、3电脑、5登录账号，反映用户清理后的新使用；这些数量不能当作待删除清单。

- 完整串行回归 `node --test --test-concurrency=1` **454/454、0 skip**，lint65通过，PowerShell入口语法检查通过。
- `client-update.test.mjs` **6/6**：真实npm隔离prefix staging/目录替换、停机不自启、原连接/记忆/bin/其他CLI保留；坏包在停止前失败；更换后启动失败恢复原包、原运行入口和原配置字节。
- 生命周期 **7/7**，native-refresh **2/2**；wrong-build夹具已去除目录名包含build造成的假通过，要求真正启动后返回准确的实际build不匹配诊断。
- Windows完整旧包运行→包外更新→stop/start→包外卸载综合 **10/10**，真实npm全局布局，主/shared身份、认证、记忆、工作目录和其他CLI/无关Node保持。
- Windows构建浏览器fixture **18/18**，1440×900、390×844、720×450，3context关闭、错误与业务写均0；前端 `index-Dajd_2io.js` / `index-D3d_EiaE.css`。
- Creator原HOME20持久文件、2 action-state、4源profile/config/SOUL hash只读复核不变。

提交、公开包SHA/actualbuild、部署与本人真实网页回读在发布后补录；上述隔离测试不代表本人实际daemon已经升级，也不代表模型/provider或手机业务验收通过。
