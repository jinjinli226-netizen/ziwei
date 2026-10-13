# 当前 daemon 停止与保留旧历史

本次修复只用于当前主 daemon 的本地停止判断。原 `healthPayload()` 将没有原 actions/production request 的连接送入正式 preservation scanner；保留的 V1 completed cache 被判为损坏，迁移后的 `legacy:true` 完成历史被要求提供原生产源码与 action 证明，合法升级因而一直返回维护 stop 409。

固定 `inspectLocalDaemonMaintenanceFiles({connections})` 共用原 fresh 文件解析与交付扫描；它对结构合法的旧完成记录保留原字节，不要求当前停止时提供正式历史证明。内部模式只由词法代码决定，调用者 JSON 不能改变 `scanNativeFiles()` 的正式语义。本地返回值没有 original action、legacy history 或 namespace proof。

V1 缓存可缺省 `updatedAt`，与现有 dispatcher 的兼容范围一致；提供了无效日期仍拒绝。旧记录要求 terminal status、非空 key/action ID、有限 completedAt，且无重复 action ID、未知 wrapper、显式 uncertain/pending/retain 或不完整退出字段。V2 started/completed 配对与身份、native/Gateway 退出检查继续生效。Delivery 的 corrupt、pending/result_pending/blocked、confirmed+retain/events、孤儿或临时文件仍阻止停止。Gateway 内存检查要求原受管进程树已确认退出，且命令、入站与 observer 均排空。

stop 控制继续要求 loopback token、准确原 boot nonce、draining、activeActionCount=0、pollingCount=0 和 maintenance.safe。成功停止主 daemon 不证明原生产 namespace 为空；正式源码、原历史与源完整性门槛仍须独立满足。

验证记录：

- 新真实隔离 daemon 回归先运行 RED：2/2 按预期失败，分别保留有/无 updatedAt 的主 V1 cache 和共享工作区 V2 legacy history，失败原因是 ACTION_STATE_CORRUPT/LEGACY_PROTOCOL_UNPROVEN/LEGACY_HISTORY_UNPROVEN。
- 修复后同两个实际 daemon 均 pause 排空、错误 nonce stop 409、正确 nonce stop 200，并由原 child handle 观察 exit 0；cache/config 字节保持不变，没有 action ACK/result 或模型调用。
- 定向 daemon/文件/交付/Gateway 检查 40/40 PASS，0 skip。全量 `node scripts/run-preservation-tests.mjs` 1022/1022 PASS，0 fail/skip；日志保存在 `.local/daemon-maintenance-full-suite.log`。
- 另新增真实 Windows Job resident 测试 2/2 PASS，0 skip：活 worker、pending command、held inbound/duplicate、频道断开但进程仍活以及 Job 已空但 observer 未排空均拒绝；原 Job exit 与 observer 全排空后才 safe。真实 fixture supervisor 丢失始终 unknown，不用 PID 消失代替原树证明。
- `node scripts/lint.mjs` 检查 126 个产品 source PASS。独立只读复核未发现本次 diff 的 formal bypass 或关键 false-safe。

全部测试只使用临时 HOME、无害 Node worker 和 loopback fixture；没有停止/重启正式服务、读写 SDK/auth/config、运行正式手机或模型，也没有 push/deploy。此提交不更新既有冻结包或宣称生产验收通过。
