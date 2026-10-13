# Owned Bot 正常 SDK storage 收尾

状态：自有桥引用释放与 confirmed owned HOME 正常 SDK 收尾已实施；新的真实四阶段尚待执行。未知 WAL 旧尾规则保持拒绝，原失败样本不变，不能把源码结论或 close 返回 count 当成 release acceptance。

本次只更改自有 `src/hermes-native-bridge.py`、`src/hermes-mcp-bootstrap.py` 和回归测试，没有修改已装 SDK、源 auth 或既有 failed HOME。`_prepare` 自己 acquire 的 pending DB 在成功、原 pending 拒绝与异常路径都 finally close，归还 shared reference。Gateway 每条 inbound handler 与整个 worker 的引用分别 finally 归还；adapter.disconnect 完成、worker 返回以后 bootstrap 才收尾 owned cache。

实际 Bot 模型入口由 runtime-adapters 生成 `chat --query-file - --format stream-json`。SDK cmd_chat → cli.main 的 single-query 路径在自己的 finally 完成 agent/global cleanup 后 SystemExit；它没有关闭所有 per-HOME shared storage cache。bootstrap 仅对确认 `kind=hermes-bot`、`mode=owned_profile` 的路径返回 callable wrapper，以 finally 在 native.main 返回或 SystemExit 后执行正常 storage 收尾。普通/default/alias、Creator 与 legacy private Bot 仍直接调用原 native.main。SDK `-z` 的 os._exit 分支会跳过该 finally，本次不声称覆盖它。

收尾使用原 SDK `hermes_state_registry.close_all_under(isolation['home'])`，参数只来自已经确认的 canonical owned isolation；不以 collector/env/source/base HOME 为目标，不打开新 DB，不另发 checkpoint SQL、删除 sidecar、改变 journal mode。SDK0.21.3 的正常 close 自己执行 PASSIVE、排 token writer/read pool并关闭原连接；这是原生生命周期行为，不能表述为内部没有 checkpoint。

registry 可以吞掉 close 异常或保留 unsafe pinned handle；返回 count 不是“清理成功”证据。收尾后以原生 `sqlite_safe_read.has_live_connection` 只读进程内 tracking，state.db/kanban.db 仍有 tracked handle 则拒绝；该 false 只代表当前进程 tracking，不代表外部进程、裸连接或所有 claims 安全。父监督树、journal/native metadata/full WAL/SHM/文件身份与 seal-time 校验仍独立全部要求。native RESULT 在收尾后才打印，不因 count 放行。

owned fingerprint 增加 registry 与 sqlite_safe_read 的真实 module source/path/required function shape，并在调用时再核实际 imported module path。缺失或 source 变化拒绝，不 fallback 到全局 close_all。

验证记录：新增回归先复现 operation 无 finalization、native.main 完成/SystemExit 无 finalization、SDK吞 close 后仍live却产生成功结果三个失败，然后修复转绿。6个 bootstrap/owned tests（新用例含15个 scope/error/ref balancing 检查）PASS；实际安装 SDK 的16个 receive-health加9个 prior-native adapter tests PASS，原监督根退出/tree完成，安装源/status未变。全量957/957 PASS（0fail/0skip），lint125文件PASS。私有日志位于本树 `.local/preservation-profile-window/owned-finalization-*`，适配器原回执 `.local/receive-health-1791917671467/receipt.json`。fresh package/实际 SDK 四阶段仍须完成后另记。

先前 strict fail-closed 冻结检查点为 b88cbd6fc0c16c6554e973115110710bdde9c5d1，目录 `.local/preservation-native-safe-checkpoint`，6产物、2 manifests、actual extracted API readonly入口证明与956/956全量结果已核。handoff-native-safe-checkpoint.json 明确 nativeFourphase.accepted=false；不能将它或70c0df6包视为正式发布候选。
