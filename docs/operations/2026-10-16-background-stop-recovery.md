# 2026-10-16 公司台式后台历史导致更新 409

## 现场

用户升级 24 小时客户端失败，维护 result 为 stop_client / CONTROL_REJECTED / HTTP409。公司台式健康接口：safe=false、stopSafe=false、pending=0、blocked=0、gatewaySafe=true、gatewayWorkers=[]，唯一 fileIssue 和 stopIssue 为 ACTION_STATE_CORRUPT，指向用户 runtime/action-state.json。

服务器原动作 action_5b4dc026-2a9e-45db-8169-a08086e6e525 于 12:00:25（Asia/Shanghai）回传 succeeded，rootPid=28996、rootExitCode=0、hostExitCode=0，但 treeConfirmed=false、activeProcesses=1。设备仍在同一 daemon PID27544、build 993639eb… 上运行。

原 Windows supervisor 的既有契约允许根进程正常退出后留下开发服务：清除 Job kill-on-close、释放 Job，并保留后台进程。dispatcher 正常成功只要求根进程退出；已有测试明确覆盖该行为。维护扫描却递归将 treeConfirmed=false 当作损坏并阻塞停止，造成旧客户端既不能 stop 也不能 update。不能从 root/host 退出推断原后台子进程已停止。

## 修复

- 新增 isRetainedBackgroundCompletion 精确识别合法成对的原生模型任务成功历史：原身份/资源绑定、root0/host0、无取消/失败/隔离、正整数后台数量；不放宽其他嵌套未知回执或 Gateway 工作。
- 本地维护输出 BACKGROUND_PROCESS_RETAINED 和 retainedBackgroundCount，保留 safe=false，但该类历史自身不再阻塞 stopSafe。正式保存/回退证明仍不通过，不能把未知进程树冒充完全退出。
- 原 action-state、delivery 记录不迁移、不删改；原 ID、防重放、treeConfirmed=false 与进程数量均保留。
- 对已审计旧包 993639eb / 6b8449d9 / ba86b25d，新候选更新器可在旧 daemon 明确 draining、active/poll/quarantine/辅助任务/队列/Gateway 均空时，使用候选扫描重新验证。仅接受这个精确旧误判；真实 JSON 损坏、身份改变、额外阻塞仍拒绝。
- 最后在原 Windows Process handle 上重新核对 PID 创建时间、命令哈希、监听归属、配置/状态哈希、健康 nonce、直接子进程为空，只停止原 daemon 本身。后台程序不被终止，前后原状态字节必须相同，不记录虚假的执行整树退出。
- 新 supervisor 回执加 backgroundProcessesRetained 显式标记；JS 验证并在持久状态/duplicate 中保留。旧标记缺省与新 true 均被精确兼容；显式 false 或不一致继续拒绝。

## 验证边界

相关禁监听回归分组：基础恢复/维护/24h 150/150；最终 scanner + helper 等 161/161；包含真实生产 stopClient 控制流的最后联测 78/78；Windows receipt reader 与 daemon 持久化专项 21/21。分组有重叠，不相加。覆盖合法旧/新后台历史、候选恢复前后文件哈希、停止仅原 daemon、不重放、各身份/活动/队列/损坏反例、原 prelaunch 特例保持。

lint 151 源文件、构建、离线依赖闭包、diff 检查通过。无本机监听。真正 Windows Job/Process handle 测试需要 Windows；本 Mac 的原 runtime-process 测试另有两个既有平台断言问题（/var realpath、ENOENT close code），已用 HEAD 原代码复现，未为此做 Mac 适配。不能把本地模拟验证说成公司机已经升级成功。

## 发布

先推 GitHub 分支 codex/v2-20261014-release，产品提交 5db7d834deaf3524adfada59a434bc764fda750a，再于 2026-10-16 12:57:05 发布官方客户端下载。

- clientBuild：208f2350ff390bbf7506e6baaef60eb7c8d467f2c8630a86c670ce01aada1044。
- tgz：1079459 字节，SHA256 2aadef1b066953fb81ff247ec16cd1a5e5e91a8d34490b66b8d47f11fa13d734。
- 主站/API 保持 /opt/ziwei/releases/v2-hotfix-eabe098af3b6/v2。
- 备份：/opt/ziwei-staging/backups/background-stop-recovery-client-20261016T045705Z。
- 发布证据：/opt/ziwei-staging/background-stop-5db7d834deaf/publish-result.json。

公开 release.json/tgz 与构建哈希一致，主站、中控、Nginx 服务进程及数据库 inode 未变。仅发布客户端。回退此包可恢复备份中的两个下载文件；不覆盖数据库、不删本机记录。

用户使用同一官方 PowerShell 更新入口，无需先 stop；更新器会自动走候选恢复。后续读取公司台式新 build 心跳及更新结果，再确认实际成功；本包保留 24 小时默认执行预算。若仍拒绝须读取新具体原因，不能让用户删除整份状态文件或按旧 PID 猜杀。
