# 私有 API 身份 hook 的有限稳定检查点

当前稳定组合基点为 `8a1af2cf344f8097946b78acaa3401b310c26708`，来自明确批准的 E03 `ac1b4d51a97def8f3f8589f8a7c4d450f0fedfb8`。导入时仅 production fixture 源码清单冲突，已同时保留 namespace 与 E02 两个 legacy 模块。之前 E02 legacy 稳定检查点为 `3ca5339aff8bab35cac47c5baa8a2d50cfefc474`：1119/1119、lint128，私有 handoff SHA `6ea526ed4273808b2636bbc0c580df5baedc8f00447161fd80310f3e3f24fd01`。

本次 app hook 尚未在真实 API 启用。Root 独立审查指出此前 E03 的默认 Linux `readApiDatabaseConnectionIdentity()` 重新 open/close `/proc/self/fd/N`，可能释放现有 SQLite fcntl 锁。E03 稳定修复 `05879fcd2882bbf3eea689ab283cacafede29721` 已精确导入为 `c591e86`；现在只观察已有 FD 的 fstat/readlink/positional read，不另开或关闭同 inode FD。E03 在真实 Linux Node/SQLite 独立竞争事务上保留旧红/新绿、1/1 零 skip 资格，详见同树 `2026-10-14-e03-linux-db-fd-lock-fix.md`。E02 没有修改该函数，也没有在正式 API/DB 上验证。此 Windows 本轮对应 Linux 专项明确 skip，不借隔离 IO 声称新的 Linux 资格。

已实现的私有接口只有 `POST /internal/preservation/identity`。它直接把已有 `repo.db` 传给 E03 factory，不另建 repository/database。配置缺省时不初始化 handler、不挂载该路由，public health 仍是原四字段。启用入口为：

```js
createApp({
  repository: existingRepository,
  privatePreservationIdentity: {hostId, trust},
});
```

也可用代码参数 `privatePreservationIdentityConfigPath` 或明确环境变量 `ZIWEI_PRODUCTION_IDENTITY_CONFIG` 指定私有 JSON `{schemaVersion:1,hostId,trust}`。文件要求规范绝对路径、普通单链接文件、256KiB 上限、无任何父路径链接。inline 与 file/env 配置不能同时选择；形状、文件和读取错误统一为 `SOURCE_API_CONFIGURATION`，不返回原配置/异常内容。完整 trust/HMAC/approved spec/target/freshness/fence 判断由 E03 handler 执行。

`createApp(options,{productionIdentityIo})` 第二参数为独立代码 IO，用于隔离平台测试；请求 JSON 没有 callback、factory、DB 或 reader 选择能力。真实默认 API handler 的 Linux FD 逻辑不能用此 synthetic IO 替代或声称已经资格通过。

新实际 Express 测试 28/28 PASS、0 skip：inline/file/env 三入口、只有原 file-backed `repo.db`、POST 签名验证、GET404、无配置 POST404、错误 HMAC/host/spec/operation/target/DB/fence/过期与 JSON callback 403+no-store；主库/WAL/journal/config 字节和 total_changes 均未变化。实际 fixture restore 后原 sealed 请求拒绝。代码 IO 显式注入 native bootstrap/connection identity，且所有 key/config/DB 都在临时目录，不涉及正式密钥或服务。

此前 API 稿组合全量在 `.local/private-api-combined-full-suite.log`：1162/1162 PASS、0 fail/skip，属于加入 FD 修复与本轮 legacy 覆盖拒绝前的检查点。本轮最终直接相关组合 `.local/finite-api-legacy-targeted-03.log`：**218 项、217 PASS、0 fail、1 Linux 专项平台 skip**；覆盖实际 route28、namespace、production、archive、legacy/final guard、native files、build/manifest 与本地 daemon maintenance。lint129 PASS。单独 API/namespace/FD 组合40 PASS、1 Linux skip。没有重复完整 SDK 四阶段或宣称新全量/完整 Windows namespace/client 身份资格。

只读包审查另找到 Windows client npm files 漏导出 `scripts/verify-preservation-packages.mjs` 的真实静态依赖；已补该文件及 `scripts/v2-preservation.mjs`，同时加入 client build 输入。namespace/legacy 模块继续进入两类包 shared/meta/files。修复后必须从真实新 TGZ 的隔离安装目录导入 source proof/namespace/production 模块，并核两 CLI 文件，不只检查 staging。

daemon 启动现在以同一份实际配置 bytes 解析 config 并保存 `loadedConfigSha256`，不从后来磁盘重读伪装 loaded config；值尚未用于 proof 输出。E03 client factory 尚无获准的稳定导出，E02 没有猜名接线。其后续 hook 必须逐项核 actual draining、polling、delivery、Gateway/aux 和连接范围，不能只读一个 safe flag 或零计数，也不由 client 断言服务端 DB/fence。

legacy 完整轮转范围另有新拒绝门槛：原捕获 JSON 的两条列表与相邻时间不是完整 inventory 资格。新 verifier 默认缺省时，单主体动作证明拒绝；仅历史缓存审计可保留。详见 `2026-10-14-e02-legacy-logger-coverage-gate.md`，实际源完整捕获 producer/witness 仍待提供与审核。

Root 最新要求本轮提交有限稳定源码后待命，不再生成六个中间包。Windows 默认 namespace/client 的干净实现合入后，再一次性冻结最终同批六包与最终验证；上述 packaging 清单修复尚未从新 TGZ 验真。当前无新正式包签收、source gate、服务动作、模型/手机、push/deploy；既有冻结包和失败/审计记录保留。
