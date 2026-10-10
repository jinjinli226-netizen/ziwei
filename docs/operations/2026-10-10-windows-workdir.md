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

源码提交、官方包 SHA/build、备份路径及发布后保护复核待写入。发布流程从精确 Git commit 归档打包，在新的隔离 npm prefix 实际安装并验证 Windows clientBuild；官方 metadata 分别记录 sourceBuild 与真实安装 build，保留既有 PowerShell 升级入口。

发布只原子更新官方 `ziwei-latest.tgz` 和 `release.json`。发布前使用 SQLite backup API 备份两库、检查 integrity/FK，并保存全部既有身份、正式员工/会话/Creator/phone MCP/绑定、配置及服务身份。发布后先关闭生产数据库读连接，再从离线快照复核；不整库恢复、不清理正式数据、不启动 T8。

用户终端 `ziwei_user status` 显示 bigtron 在线，20242 心跳持续更新；实际运行 build 为旧包 `6d0709a2f20acb43d6887b9182937cc8020e25a178df16e1e5ad9fd80dad3df8`。维护工具进程读到同路径历史 disconnected 配置，与运行进程缓存身份不一致；不据此改写、重配对或停止用户连接。官方新包核对完成后，应在用户当前显示 bigtron 在线的同一终端运行 `ziwei_user update`，再以 `ziwei_user update-status --json` 及真实目录检查确认生效。未更新前不能声称用户电脑已修复。

回滚只还原本轮备份的官方包及 metadata；PowerShell、主站、控制、数据库和配置不需要回退。真实用户客户端是否已更新需单独核实，禁止用隔离安装的 build 替代它。
