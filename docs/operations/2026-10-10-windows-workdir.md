# 2026-10-10 Windows 本地工作目录修复

本轮仅修改 Windows 客户端目录检查和原生 runtime 执行链。正式发布来源为 `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解`；原 `D:\灵光爸爸拆解` 和预先存在的未跟踪文件不参与提交。主 API、静态前端、控制服务和 Nginx 无需更换或重启。官方 Windows 包发布及真实客户端更新的结果在下方分别记录，不能用源码测试代替已安装客户端验收。

## 行为与边界

- 已配对用户可选择该 Windows 用户实际有权访问的本地 C/D 等盘符目录。`config.workdir` 是初始位置及相对路径基准，不再是目录选择或原生模型执行的唯一根目录。
- 目录检查和 native `agent.execute`、`conversation.execute`、`runtime.execute`、`automation.execute`、带 runtime/agent/modelId/prompt 的 `task.execute` 使用同一解析规则，并把真实路径传给 CLI 的 `cwd`。
- 相对 `workdir`、`cwd` 和目录别名只解析一次。明确的绝对目录不要求旧默认目录仍然存在。`C:`/`D:` 表示盘根；`C:relative` 拒绝，避免进程每盘当前目录的歧义。UNC、设备命名空间和不存在的盘符明确失败。
- 目录 junction/symlink 解析为真实本地目标；Windows ACL 保持。执行要求目录存在；浏览缺失目录只报告，只有明确的创建操作才创建。浏览仅返回目录名称，不返回文件内容。
- 已配对设备和工作区身份校验保持；普通 file/command 动作仍限私有 runtimeDir，附件真实路径仍必须包含在所选 cwd 下。Creator HOME/记忆、原认证、phone_ai、手机 MCP/绑定/配对及正式业务数据保持。非 Windows 的原路径规则保留，本轮未做 Mac 验收。

## 验证证据

Windows 专项 24 项覆盖真实 C/D 临时目录、中文空格、默认目录、相对路径、目录创建、文件/缺盘错误、UNC/设备路径、当前用户 ACL、跨盘 junction、目标身份及私有文件/命令/附件边界。native 执行使用隔离 CLI，正常 discovery 和缓存查询都先断言精确测试 binary，再以实际进程 `process.cwd()` 验证。本轮可靠 RED/GREEN 使用此流程；盘根用例只读检查或 dispatcher stub，不在真实盘根启动 CLI。

测试准备阶段曾因 discovery 注入未填充 adapter 缓存而启动一次宿主 Codex，使用隔离 CODEX_HOME 和 synthetic key，启动失败且没有成功模型结果；此异常留证，不能把整个开发过程称为零 CLI 启动。另一次完整回归为 478/479，旧版本探测 fixture 同时保留 `Path`/`PATH` 而误选宿主 Codex；已改为隔离 HOME 和白名单环境，两项均断言精确 binary，独立 17/17 通过。最终完整串行回归 **479/479、0 skip、0 fail**，lint **66** 源文件、build 和 diff 检查通过；构建资源仍为 `index-BakqZA2_.js` / `index-DArH7kBc.css`。

真实 bigtron 浏览器检查已在本人电脑 `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`、正式会话 `conv_bc178a71-0539-46a9-9a07-49e55b6b1a75` 复现旧程序错误：C/D 两个 directory.inspect 均失败“工作目录超出已批准根目录”。未发送模型请求、未创建员工/会话或目录，原会话 device/model/workdir 设置保持；只关闭本轮自行创建的浏览器页。

## 发布与实际安装状态

源码修复提交 [`0349b919fef49471d061b63f8a23c1685d223a10`](https://github.com/jinjinli226-netizen/ziwei/commit/0349b919fef49471d061b63f8a23c1685d223a10) 已推送 `codex/ziwei-terminal-console`。修复起点为远端最新 `4c41c4adb279aa94fc7bafb344c4d6dae06178e3`；发布前重新 fetch 验证远端为新提交祖先、1 ahead/0 behind，没有遗漏远端新修改。最新版检测及维护 `36d6bf1`、ASCII PowerShell `c5b720b` 均为祖先；CLI 检测、外置 worker、防 EBUSY 更新、update/update-status、stop/start、uninstall 的实现与起点逐文件比较一致，479 项完整回归包含原维护测试。

`2026-10-10T10:20:38.402350Z`（北京时间 **18:20:38**）仅更新官方 Windows 包和 metadata。精确 commit 归档打包后，在新的隔离 npm prefix 真正安装并校验所有文件；仅接受 npm 对 bin shebang 的 CRLF→LF 归一。版本仍为 `0.1.0`，不能用这个版本号判断本次修复是否安装。

| 发布字段 | 实测值 |
| --- | --- |
| 源码 commit | `0349b919fef49471d061b63f8a23c1685d223a10` |
| archive sourceBuild | `86228203ecf5aeb33fbc4422b4c4268f321c113862e0443933897a277fcd614a` |
| Windows 实际安装 clientBuild | `7c2d47abb3982eb31fbdd2245fe0550235efed9ec418848de901dfead8bdaf64` |
| 官方 tgz SHA256 | `e2a446c65def0f09cfb23d51142c2ca9666dc0d32c91d62d4a25bc71a9af377a` |
| tgz 大小/文件数 | 95,626 bytes / 30 文件 |
| 原 PowerShell SHA256（保持） | `e78e39f3e1eeb9808ecd4ed32f2f856a82947f81e4ee2ca60f20383c766c332a` |

公开 metadata、tgz、ASCII 无 BOM PowerShell 均 HTTP 200，hash/sourceBuild/必需文件/维护命令及支持范围核对通过；Windows 实际安装 build 与归档 sourceBuild 分别记录。旧官方包 build 为 `6d0709a2…`，新包从当前源码增量出包，没有回退或用历史归档覆盖。

发布只原子更新官方 `ziwei-latest.tgz` 和 `release.json`。发布前使用 SQLite backup API 备份两库至 `/opt/ziwei-backups/windows-workdir/20261010T102013Z-ad5d66cf`，检查 integrity/FK，并保存全部既有身份、正式员工/会话/Creator/phone MCP/绑定、配置及服务身份。发布后先关闭生产数据库读连接，再从离线快照复核；两库 integrity=ok、FK=0，全部既有表身份仍在，正式受保护行保持，未放宽自然到期门槛。无整库恢复、无正式数据清理，T8 未启动。

主站 `/opt/ziwei/releases/36d6bf1`、控制 `/opt/ziwei-control/releases/8a4fe59`、前端 index 与 Nginx/签名 key/共享路径/原 PowerShell 均保持。三服务 PID 分别 140116/134533/737、NRestarts=0，启动时间与备份一致，未重启。主站本地及公网健康为 200/ok。维护日志、Creator HOME/记忆、原认证和用户配置不属于本次 downloads 发布范围。

用户终端 `ziwei_user status` 显示 bigtron 在线；发布前实际 PID52440、运行 build 为旧包 `6d0709a2f20acb43d6887b9182937cc8020e25a178df16e1e5ad9fd80dad3df8`。维护工具进程读到同路径历史 disconnected 配置，与运行进程缓存身份不一致；没有据此改写、重配对或停止用户连接。官方新包核对完成后，用户已在自己终端运行更新，实际安装已核实如下。

- `update-9db8b625-5677-4d85-ad39-3674a74b4e0a` 于 `2026-10-10T10:22:00.737Z`（北京时间18:22:00）**complete**：旧build6d0709a2…→新build7c2d47ab…，SHA与官方一致，configurationPreserved=true、restoredRunning=true，原prefix仍 `D:\work\nodejs\node_global`。
- 用户随后手动执行 `stop`，回执 PID34312 已停止；之后 `update-428d6602…`、`update-5728098a…` 分别于18:22:22/18:22:29 **complete**，均新build→同一新build、配置保持、restoredRunning=false，忠实保留停止状态。
- `update-9f2681bc…`、`update-78717e0a…` 于18:22:25/18:22:27因另一任务仍在运行被维护锁拒绝。失败请求的结果和日志保留；`update-status` 的 latest 指针当前指到最后提交的787任务，因此显示该次失败，不代表此前成功安装被回退。未伪造成功结果、未手动删除锁或改latest指针。18:26排查时 operation.lock 已正常释放、无维护worker和20242 listener。
- 直接校验实际全局安装目录的clientBuild为完整 `7c2d47abb3982eb31fbdd2245fe0550235efed9ec418848de901dfead8bdaf64`。从已安装模块实际检查 C/D 两盘均存在且可用；把同一24项专项仅改为导入实际全局安装模块后再次 **24/24、0fail**，含隔离CLI真实cwd、ACL、身份/私有边界，用户配置hash和安装build保持。该验证未启动daemon、真实模型或手机动作。

用户电脑**新程序已安装，当前保持手动停止状态**。真实网页选择/保存/刷新 after 尚未执行，需用户恢复其原连接在线后才能做；不能把安装模块的24项专项或旧网页错误复现替代这项结果。配置、凭据和正式会话没有因排查被修改。

回滚只还原本轮备份的官方包及 metadata；PowerShell、主站、控制、数据库和配置不需要回退。真实用户客户端是否已更新需单独核实，禁止用隔离安装的 build 替代它。
