# 公司台式 Creator 的 Codex 启动配置修复

2026-10-20。对象是 bigtron 的公司台式，以及其「数字员工·Creator」原聊天。

## 原因与修复

真实失败动作 `action_c514566f-fdb7-48a7-8fd7-4f4a6351a758` 的 Codex 输出为 `Error loading config.toml: invalid transport`，指向 `mcp_servers.ziwei-terminal`。未加载管理工具、未生成原生线程，根进程退出1、进程树退出且无残留。它不是模型额度或员工岗位问题。

原适配器在所有 Codex 调用中追加 `mcp_servers.ziwei-terminal.enabled=false`；原生配置没有此服务器时，这会创建一个没有 command/url 的无效表。现在通过同一 CLI、HOME、Profile 和工作目录的官方 `mcp list --json` 先读取现有服务器，只禁用确实存在的项。内部禁用名单也只处理现有名称。原生配置不落盘修改，发现结果仅保留服务名，失败不转储配置中的环境变量或请求头，并记录受信的未启动证明。

此次失败留下的无线程映射仅在原动作精确匹配上述解析错误、同一作用域、根和树已退出、没有工具调用且当前收到新消息时恢复。只使用新消息启动官方 `exec`，保留原失败记录；其他未知退出和缺失线程仍不推测恢复。后续继续使用同一线程的官方 `exec resume`。

授权手机和管理 MCP 的现有注入逻辑、Hermes、员工权限和岗位配置保持。本次不声称解决原生同名 HTTP 服务器与授权 stdio 注入的所有兼容问题。

## 发布前验证

- 新配置纯测试5项、完整 Codex 会话测试33项，38项全部通过、无跳过。前者禁止网络、监听、子进程；后者禁止网络、监听，允许隔离的合成 CLI。独立审查合并手机、管理检查共56项全部通过，另4项管理配置检查通过；这些与前38项存在重叠，不累加。
- 官方 Codex 0.162.0-alpha.17.2 在隔离 HOME 下，缺项、已有 stdio、已有 HTTP、无关服务器四种配置均解析通过，原文件内容未改变；未调用模型，未创建监听服务。
- 一次额外旧 `runtime-adapters.test.mjs` 全文件检查包含 Mac 上失败的既有 Windows 路径断言；已保留记录，未将其记作全量通过，也未添加 Mac 产品适配。

发布必须先推送 GitHub，再发布官方下载包；随后仅对公司台式使用统一远程升级，收到目标 build 的新认证心跳后，在原 Creator 聊天用真实 provider 验收。发布及真机结果追加于本文件，不能以合成测试代替。

## 发布与公司台式真机验收完成

源码 `df311dfd07858f298c2f0ab1f727e71670275e73` 已先推 GitHub 双分支，随后于02:41:50 UTC发布官方客户端。Build `7c249fffd02e0a529e333bbbc56864a8b694809861cb6cfce0ee3c6c265a1e26`，包 SHA `beb75315e5e52c9f6e8e821e17c8a683b137e3010e29033c42205d60642fb10c`，1188216字节。942成员仅改3源及descriptor，其余938字节与权限保持；包内38/38及服务器冷测通过。另以HTTPS独立下载核对包摘要和三个Git源。API、主站、数据库、APK、维护helper及scanner保持，没有重启服务。

统一远程升级 `client-update_f133c641-ebef-471c-857d-0bd56ade70e3` 于02:43:59.015 UTC收到公司台式新build认证心跳，succeeded、heartbeatVerified:true、completionSource:heartbeat；设备在线，确实完成安装。仅更新公司台式，未更新其他电脑。

原员工 `employee_20031698-3abd-42a0-9b96-48a7c97bb88e`、原聊天 `conv_ffe2d620-ea56-41d0-b5fb-1fdd578b91a4` 实测两轮真实gpt-6.1-sol。第一轮 `action_5636e27d-e560-4104-8fd9-fbcae643228e` 官方exec回复启动验收通过；第二轮 `action_ad2cc7e1-b5e1-45bd-8ae8-b7379af25026` 官方exec.resume使用同一线程 `01a15732-bcb3-7002-8405-416c53099c73`，正确回忆仅在上一条出现的口令，实际ziwei_get_employee成功读取自己原记录。两轮管理MCP均已加载，code/root0、tree确认、active0、无后台残留。旧两条failed记录保留，没有重跑旧消息，没有以新建替代员工掩盖原聊天故障；验收没有创建或修改业务员工。

完整机器可读结果见[QA记录](../qa/2026-10-20-company-creator-codex-mcp.json)。
