# Native configuration and DSH discovery audit

核对时间：2026-11-01 14:05（Asia/Shanghai）。源码分支 `codex/ziwei-current-baseline-20261029`，审计时本地与远端均为 `120252edb2dc890942114b8f99ffcc6db870ece4`。运行客户端来自 `d6861e8`，build 为 `8c073023495770737159bbd5fd08626672b4661080f46c9832fc1900e3897fe6`。

## 工作区配置

当前原生 daemon PID `30044`，workspace 为 `ziwei-ops`，device 为 `device_b7b53eaa-094e-4290-8fae-f8c3ede3f6e5`。

同用户隐藏 WMI 只读 reader 使用文件 handle 的 `GetFinalPathNameByHandle` 核实了两个不同文件：

- 原生 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json`：423 bytes，workspace `ziwei-ops`，SHA-256 `1eb525a9be88126517a266aa63059fc87cc430ccb1f85628a1ad497fe0275171`，与 `/readyz.lifecycle.configSha256` 精确一致。
- Codex MSIX `C:\Users\25941\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Ziwei\ziwei_user\ziwei_user.json`：447 bytes，workspace `bigtron`，SHA-256 `29a3673cc7bb461214e328da0f805a744c13fc661a32c925ba1bdb1d20fb4ccc`。

因此不是正式配置未保存；Codex 包上下文将普通 LocalAppData 读取重定向到了旧缓存。正式原生文件已持久化。本次没有重启来验收启动行为，也不据此保证任意自定义环境或缓存路径的启动命令等价。

后续连接变更应使用正式原生上下文中的 `ziwei_user connect` / `change`；它们的写入和启动必须指向同一个原生配置。不能仅改 workspace 字符串、拷贝 MSIX 旧配置覆盖正式文件，或将缓存文件的读取结果当作正式文件。维护前比较原生 final path、磁盘摘要与运行进程加载摘要；若不一致，先排除命名空间差异。

## DSH

原生 Hub `127.0.0.1:7878/api/state` 可读取；本机 `/readyz` 和当前工作区正式管理 MCP 的只读 `discoverEnvironment` 均返回：

- DSH `status/cliStatus=available`，服务端 `available=true`、`issues=[]`。
- `community-lead`：running/ready。
- `wenji-wechat`：未运行，ready=false；这与 Hub 不可达是不同状态。
- 服务端检测时间 `2026-11-01T06:05:19.402Z`，metadata lastSeen `2026-11-01T06:05:23.798Z`。

当前未复现 `DSH_HUB_UNAVAILABLE`，不能据旧界面或旧回执认定检测仍失败。现有 `src/dsh-runtime-discovery.mjs` 已从原生 Hub `/api/state` 探测，10 秒 TTL，启动与显式刷新强制探测，周期心跳将结果写入服务端。连接失败、HTTP 失败、无效状态与超时分别保留诊断；Hub 可达与单个 Bot 就绪分别呈现。实现提交 `9a8a3cd4b457598fd4fdb92861ca58cb7f347547` 已在当前分支及实际安装内。

本次不启动停止中的 Bot，不清除历史失败，也不将连接故障伪装为成功。若再次发生，应比较同一设备的新检测时间、Hub 监听、实际进程的 `ZIWEI_DSH_BASE_URL` 和 Bot 状态；恢复原生 Hub 后由现有心跳更新，网页读取最新设备证据。

## 验证与变更边界

- DSH discovery、onboarding HTTP/management/web 与设备运行时呈现：17/17 通过。
- CLI 配对配置持久化、配置路径与配置保留定向测试：4/4 通过。
- 最终 readyz：ready/safe/stopSafe=true，pending/blocked=0。
- 未修改产品源码、正式配置、进程、journal、SQLite 或其他工作区；没有新功能修复提交需要部署。本次提交仅记录审计结论。
- 脱敏本地证据：`.local/ops-config-audit-20261101/native-config-metadata.json`、`native-server-discovery.json`。reader 仅输出文件摘要、绑定及 DSH 状态，凭据未输出或复制到证据。
