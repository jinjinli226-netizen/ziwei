# R01：Git 已保存，包修复与真实迁移材料待闭合

2026-10-14 当前检查点。用户已授权安全源码推送及满足实际条件后的服务器部署，并停止 Mac 产品适配；Windows 实机测试仍由用户后续执行。本检查点不是上线回执。

Git 版本分支 `codex/v2-20261014-release` 已正常非 force 推送 `7467eed41f8eee0614d2020d74bb93460a335d19`；remote refs 与 GitHub commit API 回读 tree `9427705c1cbe64ec500a26379affabc3e283e081` 匹配。源码包含 E02 cad5886d / E03 最终修复、R01 安全运维接线、Q01 安全文档。R01 operations 87/87 pass 仅代表隔离 ops 验证。main、Release、公开客户端 metadata 未改变。

六包哈希、源码成员及实际解压只读维护 CLI 检查通过；Q01 独立空缓存安装随后的 Express 导入失败，两角色遗漏全部 28 个直接依赖。Q safe evidence commit `7f964bb69930f891100c3728d95047b7e4e43f98` 已仅取入两份文档（R branch cherry-pick `9272897`）。本批包未签收；E02 负责修 builder，新 clean SHA 必须重生成六包、两 manifest 并独立验证，旧归档不得发布或启动。详见 [Q01 缺陷记录](../qa/2026-10-14-q01-7467eed-package-checkpoint.md)。

SSH 已成功完成当前服务器只读预检。原主 API current 为 `/opt/ziwei/releases/a66df9c-sqlite-179d0d46`、PID181593，control current 为 `/opt/ziwei-control/releases/8a4fe59`、PID134533，Nginx PID737；主/控制 DB integrity=ok、FK=0，`data -> /opt/ziwei/data`、`.local -> /opt/ziwei/.local`。首次明确授权目标登记 host key 后后续只用 strict pinned RejectPolicy，凭据只在内存，不入源码或回执正文。

四个旧批 API archive/manifest 暂存 `/opt/ziwei-staging/v2-7467eed`，远端字节 SHA 回读一致，仅四个私有文件写入。没有解包、安装、current 切换、服务动作、DB/HOME 写入或 Windows 操作。暂存不是包验收。

私有保护副本位于 `/opt/ziwei-staging/backups/pre-v2-7467eed-20261014T032535Z`，目录0700、文件0600。主/控制 SQLite 使用在线 backup API，副本 integrity=ok/FK=0，分别40/45表；旧代码与静态资源、非DB持久文件、官方CLI、服务与Nginx配置已归档并回读。在线持久文件复制不能宣称停写一致性，`formalStoppedProof=false`、`formalBackupProof=false`；current、服务PID/创建时间、受保护发布文件前后稳定。回退只换同批代码并保持当前 DB/HOME 与增量/墓碑，不整体恢复该旧库副本。

| 私有证据 | SHA256 |
| --- | --- |
| server-current-02.json | 3a3d2859b7624f78043ce8b7632c4b8c4e67944aad86cf2e9a8ebae73c4be58b |
| server-staging-01.json | 417cf06b09cf82cba48ea459cbd628952957680510d8f7dc6489f4b7838d7278 |
| server-online-protection-01.json | 846b9e04a7ade591c5e560f68158864eaaadd2c25dbcfd558a8cfd63d2389867 |
| protection-manifest.json（服务器） | 5d7bcebaf6893a81d9969bb218fbf7e052a0e2c5a661d705724d608d251519a1 |
| main.sqlite（保护副本） | e521833eecd9b860ec3713b2caad66152a429db001488145a6b8ce0000b96cc2 |
| control.sqlite（保护副本） | 71cecb3f2d34c2b107284590026c323a838e0cd3fd275db781fff42b5ecc509a |

当前仅一条明确原动作债务：`action_8668054e-e2e9-476b-acb1-d20f561eb661` 保持 expired、已有 ACK、原结果为空且无可用于正式 prepare 的 qualified action proof，真实数据命中 `PRODUCTION_ORIGINAL_DEBT`。不能改行、清队列、以 expiry 视作退出或从文档 hash 重造原材料；其余 failed/历史行不能因此扩大成同类债务。原 Windows R `.local/r01-abi-legacy-qualification-20261014/handoff-abi-legacy-qualification-01.json` 与准确26 refs 尚未迁移，已从一次历史writer/recheck读取恢复准确26组合，并提供 [固定原handoff的私有导出工具与具体命令](2026-10-14-r01-one-subject-private-export.md)，不新采 SDK/OS、auth 或整个 HOME；当前原bytes仍未迁移。

正式源码顺序为原实例受控 pause/drain/stop 与真实 scope proof → signed collect/fresh recheck/债务核验 → offline prepare → 停写一致 backup/restore-read → seal 回执 → 同批兼容角色切换。prepare 也要求原实例已停止，旧准备文档的先 prepare 后 drain 已更正。普通 `--apply` 没有 proofProvider，不可用其 plan 或历史回执代替真实跨host source 接线。当前线上版本仍原实例，部署未放行。
