# 员工强制移除与彻底删除

普通删除仍要求先处理在途动作。管理员可在 Bot 工作台或团队管理明确选择强制移除，服务端将员工隐藏、暂停 Bot 和例行工作，并禁止新的执行；原回执仍可补传。该操作不会声称原电脑进程已退出。

DELETE 员工接口支持严格布尔值 `{ "force": true }`。只有同时明确传入 `{ "force": true, "purge": true }`，才永久删除服务器员工及其级联配置。彻底删除仍暂停关联例行工作，保留动作审计，返回 `nativeCleanupConfirmed: false`，不把服务器删除冒充为本机文件清理。该路径与普通移除不同，不支持恢复原员工。

Hermes 的原生文件必须在实际绑定电脑处理。旧版 Bot 的 `legacy_private_home` 位于客户端 runtime 的 `bot-instances` 子目录，来源 `default` Profile 可由其他员工共享。清理必须核对该实例的 `ziwei-instance.json`、员工、工作区、origin 和目录哈希；不得删除共享来源 HOME，也不得按所有 Python 或 Hermes 进程进行批量终止。

本次特定目标的 Windows 清理脚本为 `scripts/remove-hermes-test-home.ps1`。默认只检查，显式 `-Apply` 才删除。文件占用或权限错误会报告失败；脚本不伪造进程停止或清理成功。当前旧客户端无远程删除接口，且 `command.execute` 的 PowerShell 请求被本机允许列表拒绝，因此文件清理需要在 Windows 本机执行该脚本。

发布沿用普通 V2：先提交并推送 GitHub，再构建已提交版本、验证离线运行包、备份当前 SQLite、切换 API 和静态资源。主数据库位置不变，不覆盖为旧备份，不改 Nginx 或控制服务。发布时记录实际提交、包哈希和公开资源校验结果。回退代码不能撤销已经执行的永久删除。
